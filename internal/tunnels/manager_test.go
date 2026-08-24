package tunnels

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ryanbekhen/dermaga/internal/cli"
	"github.com/ryanbekhen/dermaga/internal/notify"
	"github.com/ryanbekhen/dermaga/internal/store"
)

// manager builds one against a database of its own, and a token store that
// never touches the login keychain.
func manager(t *testing.T) *Manager {
	t.Helper()

	t.Setenv("HOME", t.TempDir())

	db, err := store.Open()
	if err != nil {
		t.Fatalf("store.Open = %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	m := NewManager(cli.New(), slog.New(slog.DiscardHandler), notify.Nop)
	m.keys = &memory{}
	m.UseStore(db)

	return m
}

func route(t *testing.T, m *Manager, hostname, container, port, tunnelID, account string) {
	t.Helper()

	if err := m.saveRoute(Route{
		Hostname:  hostname,
		Kind:      KindContainer,
		Target:    container,
		Port:      port,
		Address:   "192.168.64.10",
		TunnelID:  tunnelID,
		AccountID: account,
		ZoneID:    "z1",
		DNSRecord: "rec-" + hostname,
	}); err != nil {
		t.Fatalf("saveRoute = %v", err)
	}
}

func carrier(t *testing.T, m *Manager, id, account, name string) {
	t.Helper()

	if err := m.saveCarrier(Tunnel{ID: id, AccountID: account, AccountName: name}); err != nil {
		t.Fatalf("saveCarrier = %v", err)
	}
}

func hostnames(routes []Route) []string {
	out := make([]string, 0, len(routes))
	for _, r := range routes {
		out = append(out, r.Hostname)
	}

	return out
}

// --- reading --------------------------------------------------------------

// Routes, tunnels and the connection record share one bucket, told apart by
// prefix. Nothing must read one as another.
func TestTunnelsSeparatesRoutesFromTheOtherRecords(t *testing.T) {
	m := manager(t)

	if err := m.db.Put(store.BucketTunnels, connectionKey, connection{Domains: 3}); err != nil {
		t.Fatalf("put = %v", err)
	}

	carrier(t, m, "tun1", "acc1", "Ryan")
	route(t, m, "api.example.com", "api", "3000", "tun1", "acc1")

	got := m.Tunnels()
	if len(got) != 1 {
		t.Fatalf("got %d tunnels, want 1", len(got))
	}

	if len(got[0].Routes) != 1 || got[0].Routes[0].Hostname != "api.example.com" {
		t.Errorf("routes = %v", hostnames(got[0].Routes))
	}
}

// One container with several ports is several routes on one tunnel, which is
// the whole point of the shape.
func TestOneContainerCanHaveARoutePerPort(t *testing.T) {
	m := manager(t)
	carrier(t, m, "tun1", "acc1", "Ryan")
	route(t, m, "api.example.com", "app", "3000", "tun1", "acc1")
	route(t, m, "admin.example.com", "app", "8080", "tun1", "acc1")

	got := m.Tunnels()
	if len(got) != 1 {
		t.Fatalf("got %d tunnels, want them on one", len(got))
	}

	if len(got[0].Routes) != 2 {
		t.Fatalf("routes = %v, want both", hostnames(got[0].Routes))
	}
}

// A tunnel belongs to one Cloudflare account, so routes on domains in different
// accounts cannot share one.
func TestRoutesInDifferentAccountsGetDifferentTunnels(t *testing.T) {
	m := manager(t)
	carrier(t, m, "tun1", "acc1", "Ryan")
	carrier(t, m, "tun2", "acc2", "A client")
	route(t, m, "api.mine.com", "app", "3000", "tun1", "acc1")
	route(t, m, "api.theirs.com", "app", "3000", "tun2", "acc2")

	got := m.Tunnels()
	if len(got) != 2 {
		t.Fatalf("got %d tunnels, want one per account", len(got))
	}

	// Sorted by account name, so the order is stable on screen.
	if got[0].AccountName != "A client" || got[1].AccountName != "Ryan" {
		t.Errorf("order = %q, %q", got[0].AccountName, got[1].AccountName)
	}
}

func TestARouteWithNoConnectorReadsAsStopped(t *testing.T) {
	m := manager(t)
	carrier(t, m, "tun1", "acc1", "Ryan")
	route(t, m, "api.example.com", "api", "3000", "tun1", "acc1")

	got := m.Tunnels()[0]
	if got.Status != StatusStopped || got.Routes[0].Status != StatusStopped {
		t.Errorf("status = %q / %q", got.Status, got.Routes[0].Status)
	}

	if got.Routes[0].URL != "https://api.example.com" {
		t.Errorf("url = %q", got.Routes[0].URL)
	}
}

// A route to a container that is not up is live at Cloudflare and answers
// nothing. Saying so is better than leaving it to be discovered.
func TestARouteKnowsWhetherItsContainerIsUp(t *testing.T) {
	m := manager(t)
	carrier(t, m, "tun1", "acc1", "Ryan")
	route(t, m, "api.example.com", "api", "3000", "tun1", "acc1")

	if m.Tunnels()[0].Routes[0].Reachable {
		t.Error("reachable before anything reported the container")
	}

	m.Observe([]Target{{Kind: KindContainer, Name: "api", Address: "192.168.64.10", Ports: []string{"3000"}}})

	if !m.Tunnels()[0].Routes[0].Reachable {
		t.Error("not reachable after the container was seen running")
	}

	// Stopped: still a route, no longer reachable.
	m.Observe([]Target{{Kind: KindContainer, Name: "api", Ports: []string{"3000"}}})

	if m.Tunnels()[0].Routes[0].Reachable {
		t.Error("still reachable with no address")
	}
}

// --- reconciling ----------------------------------------------------------

// A container recreated on a new address keeps its hostname, and the route has
// to follow it or the hostname resolves and answers nothing.
func TestReconcileFollowsAContainerToItsNewAddress(t *testing.T) {
	m := manager(t)
	carrier(t, m, "tun1", "acc1", "Ryan")
	route(t, m, "api.example.com", "api", "3000", "tun1", "acc1")

	// No token, so nothing is pushed to Cloudflare -- but the record must
	// still be corrected, which is what the next push will send.
	m.Reconcile(t.Context(), []Target{{Kind: KindContainer, Name: "api", Address: "192.168.64.99"}})

	got, _ := m.route("api.example.com")
	if got.Address != "192.168.64.99" {
		t.Errorf("address = %q, want the new one", got.Address)
	}

	if got.Service() != "http://192.168.64.99:3000" {
		t.Errorf("service = %q", got.Service())
	}
}

// A container that is merely stopped is usually between restarts. Dropping
// somebody's hostname for that would be its own bug.
func TestReconcileKeepsARouteWhoseContainerIsNotThere(t *testing.T) {
	m := manager(t)
	carrier(t, m, "tun1", "acc1", "Ryan")
	route(t, m, "api.example.com", "api", "3000", "tun1", "acc1")

	m.Reconcile(t.Context(), []Target{{Kind: KindContainer, Name: "something-else", Address: "192.168.64.2"}})

	if _, found := m.route("api.example.com"); !found {
		t.Error("the route was dropped for a container that was only away")
	}
}

// --- ingress --------------------------------------------------------------

// Cloudflare takes the ingress as one document, so every change sends all of a
// tunnel's routes.
func TestRoutesOnATunnelAreWhatItsIngressIsBuiltFrom(t *testing.T) {
	m := manager(t)
	carrier(t, m, "tun1", "acc1", "Ryan")
	route(t, m, "a.example.com", "app", "3000", "tun1", "acc1")
	route(t, m, "b.example.com", "app", "8080", "tun1", "acc1")
	route(t, m, "c.other.com", "app", "9000", "tun2", "acc2")

	on := m.routesOn("tun1")
	if len(on) != 2 {
		t.Fatalf("routesOn = %v, want only the two on tun1", hostnames(on))
	}
}

// --- credentials ----------------------------------------------------------

func TestConnectStoresNothingWhenCloudflareRefuses(t *testing.T) {
	m := manager(t)
	held := m.keys.(*memory)

	serve(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w,
			`{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}`)
	})

	if _, err := m.Connect(t.Context(), "bad-token"); err == nil {
		t.Fatal("Connect with a refused token: want an error")
	}

	if token, found := held.read(t.Context()); found {
		t.Errorf("stored %q for a token Cloudflare refused", token)
	}

	if m.Status(t.Context()).Connected {
		t.Error("reported as connected after a refusal")
	}
}

// connected stands up a Cloudflare that answers the two calls Connect makes.
// Nothing here answers /accounts: a token scoped to tunnels and DNS cannot list
// accounts, and Connect must not need to.
func connected(t *testing.T, zones string) {
	t.Helper()

	serve(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/zones"):
			ok(w, zones)
		case strings.HasPrefix(r.URL.Path, "/accounts"):
			t.Errorf("called %s; the account comes from the zones", r.URL.Path)
			ok(w, `[]`)
		default:
			ok(w, `{"status":"active"}`)
		}
	})
}

// The case a token scoped exactly as documented runs into: it can list zones
// and manage tunnels, and it cannot list accounts.
func TestConnectWithATokenThatCannotListAccounts(t *testing.T) {
	m := manager(t)
	connected(t, `[{"id":"z1","name":"example.com","account":{"id":"acc1","name":"Ryan's Account"}}]`)

	status, err := m.Connect(t.Context(), "tunnel-and-dns-only")
	if err != nil {
		t.Fatalf("Connect = %v", err)
	}

	if !status.Connected || status.AccountName != "Ryan's Account" {
		t.Errorf("status = %+v", status)
	}
}

// The shape of a real token in the wild: many domains, spread across accounts
// belonging to different people.
func TestConnectWithATokenSpanningSeveralAccounts(t *testing.T) {
	m := manager(t)
	connected(t, `[
		{"id":"z1","name":"one.com","account":{"id":"acc1","name":"Ryan"}},
		{"id":"z2","name":"two.com","account":{"id":"acc2","name":"A client"}},
		{"id":"z3","name":"three.com","account":{"id":"acc2","name":"A client"}}
	]`)

	status, err := m.Connect(t.Context(), "wide-token")
	if err != nil {
		t.Fatalf("Connect = %v", err)
	}

	if status.AccountName != "" {
		t.Errorf("named %q as the account; the token spans several", status.AccountName)
	}

	if status.Accounts != 2 || status.Domains != 3 {
		t.Errorf("status = %+v, want 2 accounts across 3 domains", status)
	}
}

func TestConnectRefusesATokenThatReachesNoDomains(t *testing.T) {
	m := manager(t)
	connected(t, `[]`)

	_, err := m.Connect(t.Context(), "token-with-no-zones")
	if err == nil {
		t.Fatal("want an error")
	}

	if !strings.Contains(err.Error(), "Zone (Read)") || !strings.Contains(err.Error(), "nameservers") {
		t.Errorf("error = %q, want it to name what is missing", err)
	}
}

func TestDisconnectForgetsTheToken(t *testing.T) {
	m := manager(t)
	held := m.keys.(*memory)

	connected(t, `[{"id":"z1","name":"example.com","account":{"id":"acc1","name":"Ryan"}}]`)

	if _, err := m.Connect(t.Context(), "good-token"); err != nil {
		t.Fatalf("Connect = %v", err)
	}

	if err := m.Disconnect(t.Context()); err != nil {
		t.Fatalf("Disconnect = %v", err)
	}

	if _, found := held.read(t.Context()); found {
		t.Error("the token is still there")
	}

	if m.Status(t.Context()).Connected {
		t.Error("still reported as connected")
	}

}

func TestActionsWithoutATokenSayWhatIsMissing(t *testing.T) {
	m := manager(t)

	if _, err := m.Zones(t.Context()); err == nil {
		t.Fatal("Zones without a token: want an error")
	}

	_, err := m.AddRoute(t.Context(), Spec{Kind: KindContainer, Target: "api", Port: "80", ZoneID: "z1"})
	if err == nil {
		t.Fatal("AddRoute without a token: want an error")
	}
}

func TestReachNamesTheAccountWhenThereIsOnlyOne(t *testing.T) {
	got := reach([]Zone{
		{ID: "z1", Name: "a.com", Account: Account{ID: "acc1", Name: "Ryan"}},
		{ID: "z2", Name: "b.com", Account: Account{ID: "acc1", Name: "Ryan"}},
	})

	if got.Account.Name != "Ryan" || got.Accounts != 1 || got.Domains != 2 {
		t.Errorf("reach = %+v", got)
	}
}

func TestReachNamesNoAccountWhenTheTokenSpansSeveral(t *testing.T) {
	got := reach([]Zone{
		{ID: "z1", Name: "a.com", Account: Account{ID: "acc1", Name: "Ryan"}},
		{ID: "z2", Name: "b.com", Account: Account{ID: "acc2", Name: "Someone else"}},
	})

	if got.Account.ID != "" {
		t.Errorf("named %q, want no single account", got.Account.Name)
	}

	if got.Accounts != 2 {
		t.Errorf("accounts = %d, want 2", got.Accounts)
	}
}

func TestCarrierNameSaysWhichMachine(t *testing.T) {
	name := carrierName()

	if !strings.HasPrefix(name, "dermaga") {
		t.Errorf("carrierName = %q, want it to say where it came from", name)
	}

	if strings.HasSuffix(name, ".local") {
		t.Errorf("carrierName = %q, want the .local suffix off", name)
	}
}

// Nothing is created in somebody's Cloudflare account that cannot be written
// down here. A tunnel made without a record of it is litter in an account
// Dermaga can no longer see into.
func TestAddRouteRefusesWithoutAStore(t *testing.T) {
	m := manager(t)
	m.keys = &memory{token: "a-token"}

	m.mu.Lock()
	m.db = nil
	m.mu.Unlock()

	called := false
	serve(t, func(w http.ResponseWriter, _ *http.Request) {
		called = true
		ok(w, `[]`)
	})

	_, err := m.AddRoute(t.Context(), Spec{Kind: KindContainer, Target: "api", Port: "80", ZoneID: "z1"})
	if err == nil {
		t.Fatal("want an error")
	}

	if !strings.Contains(err.Error(), "database") {
		t.Errorf("error = %q, want it to say why", err)
	}

	if called {
		t.Error("reached Cloudflare with nowhere to record what it made")
	}
}

// Routes written before a target had a kind named their container in a field of
// its own. Read as they stand they point at nothing, and on screen several
// hostnames collapse into one nameless box.
func TestARouteFromTheEarlierShapeStillReads(t *testing.T) {
	m := manager(t)

	old := `{"hostname":"a.example.com","zoneId":"z1","zoneName":"example.com",` +
		`"subdomain":"a","container":"testing","port":"80","address":"192.168.64.64",` +
		`"tunnelId":"tun1","accountId":"acc1"}`

	if err := m.db.Put(store.BucketTunnels, routePrefix+"a.example.com",
		json.RawMessage(old)); err != nil {
		t.Fatalf("put = %v", err)
	}

	got, found := m.route("a.example.com")
	if !found {
		t.Fatal("not found")
	}

	if got.Kind != KindContainer {
		t.Errorf("kind = %q, want %q", got.Kind, KindContainer)
	}

	if got.Target != "testing" {
		t.Errorf("target = %q, want the container it named", got.Target)
	}

	if got.Service() != "http://192.168.64.64:80" {
		t.Errorf("service = %q", got.Service())
	}
}

// The same, through the listing the window is drawn from: two old routes to two
// different containers must stay two, not collapse into one.
func TestOldRoutesDoNotCollapseIntoOne(t *testing.T) {
	m := manager(t)
	carrier(t, m, "tun1", "acc1", "Ryan")

	for _, r := range []struct{ host, container, port string }{
		{"a.example.com", "testing", "80"},
		{"b.example.com", "testing", "8080"},
		{"c.example.com", "whoami", "80"},
	} {
		raw := `{"hostname":"` + r.host + `","zoneId":"z1","container":"` + r.container +
			`","port":"` + r.port + `","address":"192.168.64.1","tunnelId":"tun1","accountId":"acc1"}`

		if err := m.db.Put(store.BucketTunnels, routePrefix+r.host, json.RawMessage(raw)); err != nil {
			t.Fatalf("put = %v", err)
		}
	}

	targets := map[string]bool{}
	for _, route := range m.Tunnels()[0].Routes {
		if route.Kind != KindContainer {
			t.Errorf("%s: kind = %q", route.Hostname, route.Kind)
		}

		targets[route.Target] = true
	}

	if len(targets) != 2 {
		t.Errorf("targets = %v, want testing and whoami", targets)
	}
}

// A route whose Cloudflare account can no longer be reached -- the token
// revoked, or removed -- used to be impossible to get rid of at all.
func TestRemoveRouteDropsTheRecordEvenWithoutCloudflare(t *testing.T) {
	m := manager(t)
	carrier(t, m, "tun1", "acc1", "Ryan")
	route(t, m, "api.example.com", "api", "3000", "tun1", "acc1")

	err := m.RemoveRoute(t.Context(), "api.example.com")
	if err == nil {
		t.Error("want an error saying what was left in the account")
	} else if !strings.Contains(err.Error(), "Cloudflare account") {
		t.Errorf("error = %q, want it to say what is left behind", err)
	}

	if _, found := m.route("api.example.com"); found {
		t.Error("the route is still here; it could never be removed")
	}
}

// The routes go down before the token does. Forgetting the token first would
// strand every hostname and tunnel it made, alive in the account with nothing
// left here able to remove them.
func TestDisconnectTakesTheRoutesDownFirst(t *testing.T) {
	m := manager(t)

	var order []string

	serve(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/dns_records"):
			order = append(order, "dns "+r.Method)
			ok(w, `{"id":"rec1"}`)
		case strings.Contains(r.URL.Path, "/cfd_tunnel"):
			order = append(order, "tunnel "+r.Method)
			ok(w, `{}`)
		case strings.HasPrefix(r.URL.Path, "/zones"):
			ok(w, `[{"id":"z1","name":"example.com","account":{"id":"acc1","name":"Ryan"}}]`)
		default:
			ok(w, `{"status":"active"}`)
		}
	})

	if _, err := m.Connect(t.Context(), "good-token"); err != nil {
		t.Fatalf("Connect = %v", err)
	}

	carrier(t, m, "tun1", "acc1", "Ryan")
	route(t, m, "api.example.com", "api", "3000", "tun1", "acc1")

	if err := m.Disconnect(t.Context()); err != nil {
		t.Fatalf("Disconnect = %v", err)
	}

	// The hostname's record, then the tunnel it was the last route on -- both
	// while the token still worked.
	if len(order) < 2 || order[0] != "dns DELETE" {
		t.Errorf("calls = %v, want the DNS record removed first", order)
	}

	if !containsCall(order, "tunnel DELETE") {
		t.Errorf("calls = %v, want the emptied tunnel deleted too", order)
	}

	// And nothing left behind here either.
	if _, found := m.route("api.example.com"); found {
		t.Error("the route record survived")
	}

	if _, found := m.carriers()["acc1"]; found {
		t.Error("the tunnel record survived")
	}

	if _, found := m.connection(); found {
		t.Error("the connection record survived")
	}

	if m.Status(t.Context()).Connected {
		t.Error("still reported as connected")
	}
}

func containsCall(calls []string, want string) bool {
	for _, call := range calls {
		if call == want {
			return true
		}
	}

	return false
}

// Cloudflare takes an ingress whole, so two rewrites overlapping is two whole
// documents in flight -- and the one computed second can arrive first, leaving
// a routing table nobody asked for and nothing here able to notice.
func TestIngressIsNeverRewrittenTwiceAtOnce(t *testing.T) {
	m := manager(t)
	m.keys = &memory{token: "a-token"}

	var (
		mu      sync.Mutex
		inside  int
		overlap bool
		pushes  int
	)

	serve(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.URL.Path, "/configurations") {
			ok(w, `{}`)
			return
		}

		mu.Lock()
		inside++
		pushes++
		if inside > 1 {
			overlap = true
		}
		mu.Unlock()

		// Long enough that a second pass would be inside this one if it could.
		time.Sleep(20 * time.Millisecond)

		mu.Lock()
		inside--
		mu.Unlock()

		ok(w, `{}`)
	})

	carrier(t, m, "tun1", "acc1", "Ryan")
	route(t, m, "api.example.com", "api", "3000", "tun1", "acc1")

	// Every pass sees the container somewhere new, so every one has work to do.
	var wg sync.WaitGroup
	for i := range 12 {
		wg.Add(1)

		go func(n int) {
			defer wg.Done()

			m.Reconcile(t.Context(), []Target{{
				Kind:    KindContainer,
				Name:    "api",
				Address: fmt.Sprintf("192.168.64.%d", 20+n),
			}})
		}(i)
	}

	wg.Wait()

	if overlap {
		t.Error("two ingress rewrites were in flight at once")
	}

	// Skipped, not queued: twelve passes must not become twelve pushes waiting
	// behind each other and replaying against a world that has moved on.
	if pushes >= 12 {
		t.Errorf("%d pushes for 12 overlapping passes; they queued rather than gave way", pushes)
	}

	if pushes == 0 {
		t.Error("no push at all; the address changed and nothing was sent")
	}
}
