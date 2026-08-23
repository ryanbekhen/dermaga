// Package tunnels publishes containers on this Mac to public hostnames,
// through Cloudflare Tunnel.
//
// Apple's runtime gives a container an address on this machine and nothing
// beyond it. Showing somebody what you are working on means a hostname on the
// internet, and getting one today means the Cloudflare dashboard in one window,
// a terminal in another, and a config file in between.
//
// What the user adds is a route: a hostname, and what answers behind it. That
// is usually a container and a port, but not only -- the Linux VMs have
// addresses of their own, and so does macOS, where somebody's dev server
// usually runs long before it is in a container at all.
//
// Tunnels are not something they make. A Cloudflare tunnel carries any number
// of routes but belongs to exactly one account, so Dermaga keeps one per
// account and makes it the first time a route needs it -- which is why a
// container with six ports is six routes rather than six tunnels.
//
// Every tunnel is remotely managed (`config_src: "cloudflare"`), so its routing
// lives in the account rather than in a file here. Adding, moving or removing a
// route is one call, with nothing restarted.
//
// Nothing is left behind anywhere. A route removed takes its DNS record with
// it, and the tunnel too when it was the last one on it; disconnecting removes
// every route before it forgets the token, because the token is the only thing
// that could have cleared them afterwards.
//
// A route records what it was made for -- a kind, a name and a port -- and
// separately the address that resolves to right now. Containers change address
// when they are recreated, so the second is a fact with a shelf life: Reconcile
// re-points anything that has moved, which is what keeps a route working
// without anybody coming back to it.
package tunnels

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/ryanbekhen/dermaga/internal/cli"
	"github.com/ryanbekhen/dermaga/internal/notify"
	"github.com/ryanbekhen/dermaga/internal/store"
)

// Binary is the connector Cloudflare runs, and the Homebrew formula it comes
// from. Both are "cloudflared".
const Binary = "cloudflared"

// What a tunnel's connector is doing, as the UI reports it.
const (
	StatusRunning  = "running"
	StatusStarting = "starting"
	StatusStopped  = "stopped"
	StatusError    = "error"
)

// Keys in the store. One bucket, three kinds of record, told apart by prefix.
const (
	connectionKey = "connection"
	tunnelPrefix  = "tunnel:"
	routePrefix   = "route:"
)

// Route is one public hostname and what answers on it.
type Route struct {
	Hostname string `json:"hostname"`
	ZoneID   string `json:"zoneId"`
	ZoneName string `json:"zoneName"`
	// Subdomain is the part in front of the domain, kept so the form can be
	// reopened with what was typed rather than with the two spliced together.
	Subdomain string `json:"subdomain"`

	// What the route was made for. This is the user's intent and does not
	// change on its own.
	//
	// Kind is "container", "machine" or "host"; Target names which one, and is
	// empty for the host because there is only ever the one.
	Kind   string `json:"kind"`
	Target string `json:"target"`
	Port   string `json:"port"`
	// What a route written before the target had a kind called its container.
	// Read so those routes survive the change, never written: normalise()
	// moves it across and clears it, and the next save drops the field.
	legacyContainer string `json:"-"`

	// Where that is right now. Re-resolved when the container moves.
	Address string `json:"address"`
	// The gateway of the network it sits on, and what that network is called.
	// Containers on different networks have different gateways, so this is per
	// route rather than one for the picture.
	Gateway string `json:"gateway,omitempty"`
	Network string `json:"network,omitempty"`

	// Which tunnel carries it, and in which account.
	TunnelID  string `json:"tunnelId"`
	AccountID string `json:"accountId"`

	// DNSRecord is the CNAME that makes the hostname resolve here, kept so it
	// can be taken away again with the route.
	DNSRecord string `json:"dnsRecord,omitempty"`
	Created   string `json:"created"`

	// Worked out live, never stored.
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
	URL    string `json:"url,omitempty"`
	// Reachable is whether the container behind it is running and has an
	// address. A route to a stopped container is live at Cloudflare and
	// answers nothing, which is worth saying rather than leaving to be
	// discovered.
	Reachable bool `json:"reachable"`
}

// normalise repairs a route read from an earlier shape.
//
// Routes used to name a container directly, before one could point at a machine
// or at this Mac. A record written then has no kind, and reading it as it
// stands leaves every one of them pointing at nothing -- which on screen is
// several hostnames collapsing into a single nameless box.
func (r Route) normalise() Route {
	if r.Kind == "" {
		r.Kind = KindContainer

		if r.Target == "" {
			r.Target = r.legacyContainer
		}
	}

	r.legacyContainer = ""

	return r
}

// UnmarshalJSON reads both shapes: the current one, and the one that named a
// container in a field of its own.
func (r *Route) UnmarshalJSON(raw []byte) error {
	type plain Route

	var wire struct {
		plain
		Container string `json:"container"`
	}

	if err := json.Unmarshal(raw, &wire); err != nil {
		return err
	}

	*r = Route(wire.plain)
	r.legacyContainer = wire.Container

	return nil
}

// Where names what this route points at, the way a person would say it.
func (r Route) Where() string {
	if r.Kind == KindHost {
		return "this Mac:" + r.Port
	}

	return r.Target + ":" + r.Port
}

// Service is what the connector is configured with for this route.
func (r Route) Service() string {
	if r.Address == "" {
		return ""
	}

	return "http://" + r.Address + ":" + r.Port
}

// Tunnel is one Cloudflare tunnel: a connector, and the routes it carries.
//
// One per account, made by Dermaga rather than by the user.
type Tunnel struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	AccountID   string `json:"accountId"`
	AccountName string `json:"accountName,omitempty"`

	// Live.
	Status string  `json:"status"`
	Error  string  `json:"error,omitempty"`
	Routes []Route `json:"routes"`
}

// Status is what the UI needs to know before it can offer any of this.
type Status struct {
	// Connected is whether an API token is in the keychain.
	Connected bool   `json:"connected"`
	AccountID string `json:"accountId,omitempty"`
	// AccountName is set only when the token reaches exactly one account. A
	// token can span several, and naming one of them would be naming the wrong
	// one for most of the domains behind it.
	AccountName string `json:"accountName,omitempty"`
	// How much the token reaches, which is what the UI says instead when there
	// is more than one account.
	Domains  int `json:"domains"`
	Accounts int `json:"accounts"`
	// Installed is whether the cloudflared connector is on this Mac.
	Installed     bool `json:"installed"`
	BrewAvailable bool `json:"brewAvailable"`
	Routes        int  `json:"routes"`
	Running       int  `json:"running"`
}

// Spec is a request to add or move a route.
type Spec struct {
	// Replaces names the route this one takes the place of, for a move. Empty
	// adds a new one.
	Replaces  string `json:"replaces"`
	ZoneID    string `json:"zoneId"`
	Subdomain string `json:"subdomain"`
	Kind      string `json:"kind"`
	Target    string `json:"target"`
	Port      string `json:"port"`
}

// key is how this spec's target is looked up.
func (s Spec) key() string {
	return s.Kind + "/" + s.Target
}

// Target is something a route can point at, resolved from what is live now.
//
// Tagged like everything else that crosses to the window. Without the tags Go
// sends Kind/Name/Address and the window reads kind/name/address, which is not
// an error anywhere -- every field simply arrives undefined, and a running
// container reads as a stopped one.
type Target struct {
	// Kind is "container", "machine" or "host".
	Kind string `json:"kind"`
	// Name is which one. Empty for the host, of which there is only ever one.
	Name    string `json:"name"`
	Address string `json:"address"`
	// Gateway is the address the container's network hangs off, and Network is
	// what that network is called. The connector reaches the container through
	// the gateway, so it is a real hop and belongs on the picture rather than
	// being implied by two boxes side by side.
	//
	// Not one gateway for everything: containers on different networks have
	// different ones, and drawing them all through the first is drawing a path
	// that does not exist. A machine and the host are reached without one.
	Gateway string `json:"gateway,omitempty"`
	Network string `json:"network,omitempty"`
	// Ports it is known to listen on, as suggestions. Empty for a machine or
	// the host, which declare nothing -- so there the port is typed.
	Ports []string `json:"ports"`
}

// Key identifies a target across the two lists that mention it.
func (t Target) Key() string {
	return t.Kind + "/" + t.Name
}

// process is one running connector.
type process struct {
	cmd    *exec.Cmd
	cancel context.CancelFunc
	status string
	err    string
}

type Manager struct {
	runner *cli.Runner
	logger *slog.Logger
	notify notify.Notifier
	keys   secrets

	mu sync.RWMutex
	db *store.Store
	// The token, once read, so the UI asking whether Dermaga is connected does
	// not spawn a keychain lookup every time it asks.
	token  string
	loaded bool
	// One connector per tunnel, keyed by tunnel id.
	running map[string]*process
	// Where each container was last seen, so Reconcile can tell what moved.
	targets map[string]Target
}

func NewManager(runner *cli.Runner, logger *slog.Logger, changed notify.Notifier) *Manager {
	if changed == nil {
		changed = notify.Nop
	}

	return &Manager{
		runner:  runner,
		logger:  logger,
		notify:  changed,
		keys:    keychain{},
		running: map[string]*process{},
		targets: map[string]Target{},
	}
}

// UseStore hands over the database the records live in. Without one the manager
// still works for a session; nothing survives a restart.
func (m *Manager) UseStore(db *store.Store) {
	m.mu.Lock()
	m.db = db
	m.token, m.loaded = "", false
	m.mu.Unlock()
}

// --- credentials ----------------------------------------------------------

// connection is what Connect worked out about the token, kept so Status can
// answer without calling Cloudflare on every poll.
type connection struct {
	// Account is the one the token reaches, when it reaches exactly one.
	Account  Account `json:"account"`
	Accounts int     `json:"accounts"`
	Domains  int     `json:"domains"`
}

// reach describes what a token can act on, from the domains it can see.
//
// The account is filled in only when every domain belongs to the same one. A
// token can span several accounts -- one belonging to somebody who works across
// a few -- and picking the first would name the wrong account for most of the
// domains behind it. Adding a route never uses this: it takes the account from
// the domain actually chosen.
func reach(zones []Zone) connection {
	found := connection{Domains: len(zones)}

	seen := map[string]Account{}
	for _, zone := range zones {
		if zone.Account.ID != "" {
			seen[zone.Account.ID] = zone.Account
		}
	}

	found.Accounts = len(seen)

	if len(seen) == 1 {
		for _, account := range seen {
			found.Account = account
		}
	}

	return found
}

// storedToken returns the API token, reading the keychain the first time and
// remembering the answer.
func (m *Manager) storedToken(ctx context.Context) (string, bool) {
	m.mu.RLock()
	token, loaded := m.token, m.loaded
	m.mu.RUnlock()

	if loaded {
		return token, token != ""
	}

	token, found := m.keys.read(ctx)

	m.mu.Lock()
	m.token, m.loaded = token, true
	m.mu.Unlock()

	return token, found
}

func (m *Manager) client(ctx context.Context) (*client, error) {
	token, found := m.storedToken(ctx)
	if !found {
		return nil, errors.New("Dermaga is not connected to Cloudflare yet")
	}

	return newClient(token), nil
}

func (m *Manager) Status(ctx context.Context) Status {
	status := Status{
		Installed:     m.runner.Has(Binary),
		BrewAvailable: m.runner.Has("brew"),
	}

	if _, found := m.storedToken(ctx); found {
		status.Connected = true
	}

	for _, tunnel := range m.Tunnels() {
		status.Routes += len(tunnel.Routes)

		if tunnel.Status == StatusRunning {
			status.Running++
		}
	}

	if stored, found := m.connection(); found {
		status.AccountID = stored.Account.ID
		status.AccountName = stored.Account.Name
		status.Accounts = stored.Accounts
		status.Domains = stored.Domains
	}

	return status
}

func (m *Manager) connection() (connection, bool) {
	db := m.store()
	if db == nil {
		return connection{}, false
	}

	var stored connection
	found, err := db.Get(store.BucketTunnels, connectionKey, &stored)

	return stored, found && err == nil
}

// Connect verifies an API token, works out what it reaches, and stores it.
//
// The token is checked before it is saved. The alternative is storing whatever
// was pasted and reporting the mistake later, on whichever action happens to
// fail first.
//
// What it reaches is read off the domains rather than from /accounts. Listing
// accounts needs a permission of its own -- one a token scoped to tunnels and
// DNS does not carry -- and asking for it would be asking for a permission this
// never uses.
func (m *Manager) Connect(ctx context.Context, token string) (Status, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return Status{}, errors.New("an API token is required")
	}

	api := newClient(token)
	if err := api.verify(ctx); err != nil {
		return Status{}, err
	}

	zones, err := api.zones(ctx)
	if err != nil {
		return Status{}, err
	}

	if len(zones) == 0 {
		return Status{}, errors.New(
			"the token is valid but reaches no domains. It needs Zone: Zone (Read), and the " +
				"domain has to be one whose nameservers are already Cloudflare's.")
	}

	reached := reach(zones)

	// Only if the zones named no account at all -- not merely when they named
	// more than one, which is a token spanning several and already correct.
	// Failure is ignored: it means the token cannot list accounts, which is the
	// normal case and not a reason to refuse one that can do everything else.
	if reached.Accounts == 0 {
		if found, err := api.accounts(ctx); err == nil && len(found) == 1 {
			reached.Account = found[0]
			reached.Accounts = 1
		}
	}

	if reached.Account.ID == "" && reached.Accounts == 0 {
		return Status{}, errors.New(
			"the token reaches domains but names no account, so there is nowhere to create a " +
				"tunnel. Check it has Account: Cloudflare Tunnel (Edit).")
	}

	if err := m.keys.write(ctx, token); err != nil {
		// The keychain can take its time -- a locked keychain puts a dialog in
		// front of the write -- and the command is killed when it does. Whether
		// it got there first is a question with an answer, so it is asked
		// rather than assumed: reporting a failure for a token that is now
		// stored would leave somebody reconnecting an account already
		// connected.
		if stored, found := m.keys.read(ctx); !found || stored != token {
			return Status{}, err
		}

		m.logger.Warn("The keychain write reported a failure but the token is there", "error", err)
	}

	m.mu.Lock()
	m.token, m.loaded = token, true
	m.mu.Unlock()

	if db := m.store(); db != nil {
		if err := db.Put(store.BucketTunnels, connectionKey, reached); err != nil {
			m.logger.Warn("Could not remember what the Cloudflare token reaches", "error", err)
		}
	}

	m.notify.Changed()

	return m.Status(ctx), nil
}

// Disconnect takes everything down and then forgets the token.
//
// The routes go first, and that order is the whole point: the token is the only
// thing that can reach Cloudflare, so forgetting it first would strand every
// hostname, DNS record and tunnel it made -- alive in somebody's account, with
// nothing left here able to remove them. Whoever presses this has decided to
// stop; leaving litter behind that only they can clear by hand is not stopping.
//
// A route that cannot be removed does not stop the rest. It is named in the
// error instead, so what is left is a list rather than a surprise.
func (m *Manager) Disconnect(ctx context.Context) error {
	var stranded []string

	for _, route := range m.routes() {
		if err := m.RemoveRoute(ctx, route.Hostname); err != nil {
			m.logger.Warn("Could not remove a route while disconnecting",
				"hostname", route.Hostname, "error", err)

			stranded = append(stranded, route.Hostname)
		}
	}

	m.stopAll()

	if err := m.keys.forget(ctx); err != nil {
		return err
	}

	m.mu.Lock()
	m.token, m.loaded = "", true
	m.mu.Unlock()

	if db := m.store(); db != nil {
		_ = db.Delete(store.BucketTunnels, connectionKey)
	}

	m.notify.Changed()

	if len(stranded) > 0 {
		return fmt.Errorf(
			"disconnected, but %s could not be taken down and %s still in your Cloudflare account",
			strings.Join(stranded, ", "), were(len(stranded)))
	}

	return nil
}

// were keeps the sentence above readable for one hostname and for several.
func were(n int) string {
	if n == 1 {
		return "is"
	}

	return "are"
}

// Zones lists the domains the token can put a record on.
func (m *Manager) Zones(ctx context.Context) ([]Zone, error) {
	api, err := m.client(ctx)
	if err != nil {
		return nil, err
	}

	zones, err := api.zones(ctx)
	if err != nil {
		return nil, err
	}

	sort.Slice(zones, func(i, j int) bool { return zones[i].Name < zones[j].Name })

	return zones, nil
}

// --- reading what is here -------------------------------------------------

func (m *Manager) store() *store.Store {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.db
}

// routes reads every stored route, without the live parts filled in.
func (m *Manager) routes() []Route {
	routes := []Route{}

	db := m.store()
	if db == nil {
		return routes
	}

	_ = db.All(store.BucketTunnels, func(key string, raw []byte) error {
		if !strings.HasPrefix(key, routePrefix) {
			return nil
		}

		var route Route
		if err := decode(raw, &route); err != nil {
			m.logger.Warn("Ignoring an unreadable route", "key", key, "error", err)
			return nil
		}

		routes = append(routes, route.normalise())

		return nil
	})

	sort.Slice(routes, func(i, j int) bool { return routes[i].Hostname < routes[j].Hostname })

	return routes
}

// carriers reads the tunnels Dermaga has made, keyed by account.
func (m *Manager) carriers() map[string]Tunnel {
	carriers := map[string]Tunnel{}

	db := m.store()
	if db == nil {
		return carriers
	}

	_ = db.All(store.BucketTunnels, func(key string, raw []byte) error {
		if !strings.HasPrefix(key, tunnelPrefix) {
			return nil
		}

		var tunnel Tunnel
		if err := decode(raw, &tunnel); err != nil {
			return nil
		}

		carriers[tunnel.AccountID] = tunnel

		return nil
	})

	return carriers
}

// Tunnels is the whole picture: every tunnel, the routes it carries, and what
// each of them is doing now.
//
// This is what the window draws. A tunnel with no routes is not returned --
// there is never meant to be one, and showing an empty carrier would be showing
// plumbing.
func (m *Manager) Tunnels() []Tunnel {
	// Read from the store before taking the lock. Both carriers() and routes()
	// take it themselves, and a second RLock while a writer is waiting is a
	// deadlock rather than a re-entry.
	carriers := m.carriers()
	stored := m.routes()

	byAccount := map[string][]Route{}

	m.mu.RLock()
	for _, route := range stored {
		route.URL = "https://" + route.Hostname
		route.Status = StatusStopped

		if proc, ok := m.running[route.TunnelID]; ok {
			route.Status = proc.status
			route.Error = proc.err
		}

		target, known := m.targets[route.Kind+"/"+route.Target]
		route.Reachable = known && target.Address != ""

		byAccount[route.AccountID] = append(byAccount[route.AccountID], route)
	}
	m.mu.RUnlock()

	tunnels := make([]Tunnel, 0, len(byAccount))

	for account, routes := range byAccount {
		tunnel := carriers[account]
		tunnel.AccountID = account
		tunnel.Routes = routes
		tunnel.Status = m.statusOf(tunnel.ID)

		m.mu.RLock()
		if proc, ok := m.running[tunnel.ID]; ok {
			tunnel.Error = proc.err
		}
		m.mu.RUnlock()

		tunnels = append(tunnels, tunnel)
	}

	sort.Slice(tunnels, func(i, j int) bool {
		if tunnels[i].AccountName != tunnels[j].AccountName {
			return tunnels[i].AccountName < tunnels[j].AccountName
		}

		return tunnels[i].AccountID < tunnels[j].AccountID
	})

	return tunnels
}

// route finds one by hostname.
func (m *Manager) route(hostname string) (Route, bool) {
	db := m.store()
	if db == nil {
		return Route{}, false
	}

	var route Route
	found, err := db.Get(store.BucketTunnels, routePrefix+hostname, &route)

	return route.normalise(), found && err == nil
}

// routesOn is every route a tunnel carries, which is what its ingress is built
// from.
func (m *Manager) routesOn(tunnelID string) []Route {
	var on []Route
	for _, route := range m.routes() {
		if route.TunnelID == tunnelID {
			on = append(on, route)
		}
	}

	return on
}

// --- what containers are here ---------------------------------------------

// Observe records where the containers are. Called from the watcher, on every
// snapshot.
//
// Reconcile is what acts on it; this only keeps the picture current, because
// the same facts are what tell the UI whether a route's container is up.
func (m *Manager) Observe(targets []Target) {
	next := make(map[string]Target, len(targets))
	for _, target := range targets {
		next[target.Key()] = target
	}

	m.mu.Lock()
	m.targets = next
	m.mu.Unlock()
}

func (m *Manager) targetFor(key string) (Target, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	target, found := m.targets[key]

	return target, found
}

// --- routes ---------------------------------------------------------------

// AddRoute publishes a container's port on a hostname.
//
// The tunnel it goes on is Dermaga's business, not the user's: one per
// Cloudflare account, made the first time a route needs it. A route is moved
// rather than duplicated when Replaces names one.
func (m *Manager) AddRoute(ctx context.Context, spec Spec) (Route, error) {
	// Checked before anything else, cloudflared included: nothing is created
	// in somebody's Cloudflare account that cannot be written down here. A tunnel and a DNS record made without a record of
	// them are litter in an account Dermaga can no longer see into: nothing
	// would ever remove them, and the next attempt would try to make the same
	// tunnel again and be refused by name.
	//
	// The store is missing when a second Dermaga holds its lock, or the home
	// directory is read-only. Everything else here degrades to forgetting
	// something; this one would leave a mess behind, so it stops instead.
	if m.store() == nil {
		return Route{}, errors.New(
			"Dermaga cannot open its database, so it will not create anything in your " +
				"Cloudflare account it could not undo. Another copy of Dermaga is probably running.")
	}

	if !m.runner.Has(Binary) {
		return Route{}, fmt.Errorf("%s is not installed", Binary)
	}

	if spec.Kind != KindHost && strings.TrimSpace(spec.Target) == "" {
		return Route{}, fmt.Errorf("a route needs a %s to point at", spec.Kind)
	}

	if strings.TrimSpace(spec.Port) == "" {
		return Route{}, errors.New("a route needs a port")
	}

	api, err := m.client(ctx)
	if err != nil {
		return Route{}, err
	}

	zones, err := api.zones(ctx)
	if err != nil {
		return Route{}, err
	}

	var zone Zone
	for _, candidate := range zones {
		if candidate.ID == spec.ZoneID {
			zone = candidate
			break
		}
	}

	if zone.ID == "" {
		return Route{}, errors.New("that domain is not one this token can edit")
	}

	if zone.Account.ID == "" {
		return Route{}, errors.New("Cloudflare did not say which account that domain belongs to")
	}

	hostname, err := Hostname(spec.Subdomain, zone.Name)
	if err != nil {
		return Route{}, err
	}

	// Somebody else's route on the same hostname would be silently taken over
	// otherwise: the ingress rule replaced, the DNS record repointed, and the
	// original left in the list pointing at nothing.
	if existing, found := m.route(hostname); found && existing.Hostname != spec.Replaces {
		return Route{}, fmt.Errorf("%s already goes to %s", hostname, existing.Where())
	}

	target, known := m.targetFor(spec.key())
	if !known {
		if spec.Kind == KindHost {
			return Route{}, errors.New("this Mac is not reachable, which should not happen")
		}

		return Route{}, fmt.Errorf("there is no %s called %s", spec.Kind, spec.Target)
	}

	tunnel, err := m.carrierFor(ctx, api, zone.Account)
	if err != nil {
		return Route{}, err
	}

	route := Route{
		Hostname:  hostname,
		ZoneID:    zone.ID,
		ZoneName:  zone.Name,
		Subdomain: strings.TrimSpace(spec.Subdomain),
		Kind:      target.Kind,
		Target:    target.Name,
		Port:      strings.TrimSpace(spec.Port),
		Address:   target.Address,
		Gateway:   target.Gateway,
		Network:   target.Network,
		TunnelID:  tunnel.ID,
		AccountID: zone.Account.ID,
		Created:   time.Now().UTC().Format(time.RFC3339),
	}

	// The move is done as a removal and an addition rather than an edit in
	// place: the hostname is the identity of a route, and changing it is
	// changing which record and which DNS entry the old one owned.
	var replaced Route
	moving := false

	if spec.Replaces != "" && spec.Replaces != hostname {
		if found, ok := m.route(spec.Replaces); ok {
			replaced, moving = found, true
		}
	}

	if moving {
		m.forgetRoute(replaced.Hostname)
	}

	if err := m.saveRoute(route); err != nil {
		return Route{}, err
	}

	// The ingress for every tunnel touched, which is two of them when a move
	// crosses accounts.
	if err := m.pushIngress(ctx, api, tunnel.ID, zone.Account.ID); err != nil {
		return Route{}, err
	}

	if moving && replaced.TunnelID != tunnel.ID {
		if err := m.pushIngress(ctx, api, replaced.TunnelID, replaced.AccountID); err != nil {
			m.logger.Warn("Left an old route in a tunnel's ingress",
				"hostname", replaced.Hostname, "error", err)
		}
	}

	record, err := api.upsertDNS(ctx, zone.ID, hostname, tunnel.ID)
	if err != nil {
		return Route{}, err
	}

	route.DNSRecord = record
	if err := m.saveRoute(route); err != nil {
		return Route{}, err
	}

	if moving {
		if err := api.deleteDNS(ctx, replaced.ZoneID, replaced.DNSRecord); err != nil {
			m.logger.Warn("Left a DNS record behind",
				"hostname", replaced.Hostname, "error", err)
		}

		m.retireIfEmpty(ctx, api, replaced.TunnelID, replaced.AccountID)
	}

	if err := m.ensureRunning(ctx, tunnel); err != nil {
		return Route{}, err
	}

	m.notify.Changed()

	route.URL = "https://" + route.Hostname
	route.Status = m.statusOf(tunnel.ID)
	route.Reachable = target.Address != ""

	return route, nil
}

// RemoveRoute takes one hostname off the internet.
//
// The tunnel behind it goes too when it was the last route on it: a connector
// with nothing to carry is a process running for no reason, and a tunnel with
// no routes is a row in somebody's dashboard that Dermaga would never use
// again.
func (m *Manager) RemoveRoute(ctx context.Context, hostname string) error {
	route, found := m.route(hostname)
	if !found {
		return nil
	}

	// The record goes whatever happens next.
	//
	// Removing used to stop here when Cloudflare could not be reached -- no
	// token, or a token that had been revoked -- and a route in that state
	// could never be got rid of at all. Somebody asking to remove one has
	// decided; refusing for ever is worse than removing it and saying what was
	// left behind for them to clear up.
	defer func() {
		m.forgetRoute(hostname)
		m.notify.Changed()
	}()

	api, err := m.client(ctx)
	if err != nil {
		return fmt.Errorf(
			"%s is gone from Dermaga, but %s could not be reached to take the hostname down. "+
				"Its DNS record and tunnel are still in your Cloudflare account.", hostname, err)
	}

	if err := api.deleteDNS(ctx, route.ZoneID, route.DNSRecord); err != nil {
		m.logger.Warn("Could not remove the DNS record", "hostname", hostname, "error", err)
	}

	// Before the ingress is rebuilt, so the route being removed is not in it.
	m.forgetRoute(hostname)

	if err := m.pushIngress(ctx, api, route.TunnelID, route.AccountID); err != nil {
		m.logger.Warn("Could not update the tunnel's routing", "hostname", hostname, "error", err)
	}

	m.retireIfEmpty(ctx, api, route.TunnelID, route.AccountID)

	return nil
}

// --- tunnels, which Dermaga owns ------------------------------------------

// carrierFor is the tunnel for one account, made if this is the first route
// that needs it.
func (m *Manager) carrierFor(ctx context.Context, api *client, account Account) (Tunnel, error) {
	if existing, found := m.carriers()[account.ID]; found && existing.ID != "" {
		// Named again in case the account name arrived after the tunnel did.
		existing.AccountName = account.Name
		_ = m.saveCarrier(existing)

		return existing, nil
	}

	created, err := api.createTunnel(ctx, account.ID, carrierName())
	if err != nil {
		return Tunnel{}, err
	}

	tunnel := Tunnel{
		ID:          created.ID,
		Name:        created.Name,
		AccountID:   account.ID,
		AccountName: account.Name,
	}

	if err := m.saveCarrier(tunnel); err != nil {
		return Tunnel{}, err
	}

	return tunnel, nil
}

// carrierName is what the tunnel is called in the Cloudflare dashboard.
//
// Named after the Mac rather than after Dermaga alone: somebody with two
// machines will otherwise find two tunnels called the same thing and no way to
// tell which is which.
func carrierName() string {
	host, err := os.Hostname()
	if err != nil || host == "" {
		return "dermaga"
	}

	host = strings.TrimSuffix(host, ".local")

	return "dermaga-" + strings.ToLower(host)
}

// pushIngress sends a tunnel's whole routing table, built from the routes on
// it. A route whose container is not up is left out rather than pointed at an
// address that is not there.
func (m *Manager) pushIngress(ctx context.Context, api *client, tunnelID, account string) error {
	if tunnelID == "" {
		return nil
	}

	var rules []rule
	for _, route := range m.routesOn(tunnelID) {
		if service := route.Service(); service != "" {
			rules = append(rules, rule{hostname: route.Hostname, service: service})
		}
	}

	return api.configure(ctx, account, tunnelID, rules)
}

// retireIfEmpty deletes a tunnel that has no routes left.
func (m *Manager) retireIfEmpty(ctx context.Context, api *client, tunnelID, account string) {
	if tunnelID == "" || len(m.routesOn(tunnelID)) > 0 {
		return
	}

	m.stopProcess(tunnelID)

	if err := api.deleteTunnel(ctx, account, tunnelID); err != nil {
		m.logger.Warn("Could not delete an empty tunnel", "tunnel", tunnelID, "error", err)
	}

	if db := m.store(); db != nil {
		_ = db.Delete(store.BucketTunnels, tunnelPrefix+account)
	}
}

// --- keeping routes pointing at the right place ---------------------------

// Reconcile re-points routes whose containers have moved, and drops records for
// containers that are gone.
//
// Called from the watcher, so it runs on every change rather than on a timer.
// A container recreated on a new address would otherwise keep a hostname that
// resolves and answers nothing, with nothing on screen to say why.
func (m *Manager) Reconcile(ctx context.Context, targets []Target) {
	m.Observe(targets)

	routes := m.routes()
	if len(routes) == 0 {
		return
	}

	moved := map[string]string{}

	for _, route := range routes {
		target, known := m.targetFor(route.Kind + "/" + route.Target)

		// Something that is not here at all keeps its route: a container is
		// usually stopped rather than gone, and dropping the hostname somebody
		// set up because it is between restarts would be its own bug.
		if !known {
			continue
		}

		if target.Address != route.Address || target.Gateway != route.Gateway ||
			target.Network != route.Network {
			route.Address = target.Address
			route.Gateway = target.Gateway
			route.Network = target.Network

			if err := m.saveRoute(route); err != nil {
				m.logger.Warn("Could not record a route's new address",
					"hostname", route.Hostname, "error", err)
				continue
			}

			moved[route.TunnelID] = route.AccountID
		}
	}

	if len(moved) == 0 {
		return
	}

	api, err := m.client(ctx)
	if err != nil {
		return
	}

	for tunnelID, account := range moved {
		m.logger.Info("A container moved; re-pointing its tunnel", "tunnel", tunnelID)

		if err := m.pushIngress(ctx, api, tunnelID, account); err != nil {
			m.logger.Warn("Could not re-point a tunnel", "tunnel", tunnelID, "error", err)
		}
	}

	m.notify.Changed()
}

// Forget drops every route to a container that has been deleted.
//
// It takes every name the container answered to. A route is keyed by hostname
// and records the container's name, but the runtime identifies one by an ID
// that is usually the same string and is not always -- a network hostname makes
// them diverge -- and a delete arrives with whichever the window was holding.
func (m *Manager) Forget(ctx context.Context, names ...string) {
	wanted := map[string]bool{}
	for _, name := range names {
		if name != "" {
			wanted[name] = true
		}
	}

	for _, route := range m.routes() {
		if route.Kind != KindContainer || !wanted[route.Target] {
			continue
		}

		m.logger.Info("Removing a route to a container that has gone",
			"hostname", route.Hostname, "container", route.Target)

		if err := m.RemoveRoute(ctx, route.Hostname); err != nil {
			m.logger.Warn("Could not remove the route", "hostname", route.Hostname, "error", err)
		}
	}
}

// --- connectors -----------------------------------------------------------

// Restore brings up a connector for every tunnel that has routes. Called once,
// after the agent has wired everything together.
func (m *Manager) Restore(ctx context.Context) {
	if !m.runner.Has(Binary) {
		return
	}

	if _, found := m.storedToken(ctx); !found {
		return
	}

	for _, tunnel := range m.Tunnels() {
		if tunnel.ID == "" {
			continue
		}

		if err := m.ensureRunning(ctx, tunnel); err != nil {
			m.logger.Warn("Could not bring a tunnel back up",
				"tunnel", tunnel.Name, "error", err)
		}
	}
}

// Close stops every connector. They are Dermaga's children and go when it does.
func (m *Manager) Close() {
	m.stopAll()
}

func (m *Manager) stopAll() {
	m.mu.RLock()
	ids := make([]string, 0, len(m.running))
	for id := range m.running {
		ids = append(ids, id)
	}
	m.mu.RUnlock()

	for _, id := range ids {
		m.stopProcess(id)
	}
}

// StopTunnel takes one connector down, leaving its routes and hostnames in
// place so starting again costs nothing.
func (m *Manager) StopTunnel(tunnelID string) {
	m.stopProcess(tunnelID)
	m.notify.Changed()
}

// StartTunnel brings one back up.
func (m *Manager) StartTunnel(ctx context.Context, tunnelID string) error {
	for _, tunnel := range m.Tunnels() {
		if tunnel.ID == tunnelID {
			if err := m.ensureRunning(ctx, tunnel); err != nil {
				return err
			}

			m.notify.Changed()

			return nil
		}
	}

	return fmt.Errorf("no tunnel %s", tunnelID)
}

// ensureRunning starts a connector for a tunnel unless one is already up.
func (m *Manager) ensureRunning(ctx context.Context, tunnel Tunnel) error {
	m.mu.RLock()
	proc, up := m.running[tunnel.ID]
	m.mu.RUnlock()

	if up && (proc.status == StatusRunning || proc.status == StatusStarting) {
		return nil
	}

	return m.start(ctx, tunnel)
}

// start runs the connector for one tunnel.
//
// The run token is fetched rather than stored. It is a second credential per
// tunnel, it is derivable from the API token that is already in the keychain,
// and one call at start-up is cheaper than keeping it correct on disk.
func (m *Manager) start(ctx context.Context, tunnel Tunnel) error {
	m.stopProcess(tunnel.ID)

	api, err := m.client(ctx)
	if err != nil {
		return err
	}

	token, err := api.runToken(ctx, tunnel.AccountID, tunnel.ID)
	if err != nil {
		return err
	}

	// Detached from the caller's context on purpose: a connector outlives the
	// RPC call that asked for it, and is stopped by name rather than by the
	// request going away.
	runCtx, cancel := context.WithCancel(context.Background())

	cmd := m.runner.Tool(runCtx, Binary, "tunnel", "--no-autoupdate", "run")

	// Asked to stop, cloudflared closes its connections to Cloudflare and
	// leaves; killed outright it does not, and the edge keeps sending requests
	// to a connector that has gone until it works that out for itself. So the
	// cancel is a TERM, with a kill behind it for one that ignores it.
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}

		return cmd.Process.Signal(syscall.SIGTERM)
	}
	cmd.WaitDelay = 5 * time.Second

	// The token goes in the environment rather than on the command line, where
	// `ps` would show it to every process on the machine. cloudflared reads
	// TUNNEL_TOKEN for exactly this.
	cmd.Env = append(cmd.Environ(), "TUNNEL_TOKEN="+token)

	if err := cmd.Start(); err != nil {
		cancel()
		return fmt.Errorf("could not start %s: %w", Binary, err)
	}

	proc := &process{cmd: cmd, cancel: cancel, status: StatusStarting}

	m.mu.Lock()
	m.running[tunnel.ID] = proc
	m.mu.Unlock()

	go m.watch(tunnel.ID, proc)

	return nil
}

// watch marks a connector running once it has stayed up, and records why it
// stopped if it did not.
//
// cloudflared reports its own readiness only on stderr, in prose that changes
// between releases. Waiting a moment and checking it is still alive says the
// same thing without reading its output.
func (m *Manager) watch(tunnelID string, proc *process) {
	settled := time.AfterFunc(3*time.Second, func() {
		m.mu.Lock()
		if m.running[tunnelID] == proc && proc.status == StatusStarting {
			proc.status = StatusRunning
		}
		m.mu.Unlock()

		m.notify.Changed()
	})

	err := proc.cmd.Wait()
	settled.Stop()

	m.mu.Lock()
	// Still the current connector for this tunnel means nobody asked it to
	// stop: stopProcess takes it out of the map before it signals, and a
	// replacement puts itself in. So reaching here is it failing on its own,
	// and worth reporting.
	if m.running[tunnelID] == proc {
		if err != nil {
			proc.status = StatusError
			proc.err = fmt.Sprintf("%s stopped: %v", Binary, err)
		} else {
			delete(m.running, tunnelID)
		}
	}
	m.mu.Unlock()

	m.notify.Changed()
}

// stopProcess takes down the connector for one tunnel, if there is one.
func (m *Manager) stopProcess(tunnelID string) {
	m.mu.Lock()
	proc, ok := m.running[tunnelID]
	if ok {
		delete(m.running, tunnelID)
	}
	m.mu.Unlock()

	if !ok {
		return
	}

	// The TERM, and the kill behind it, are both set up on the command itself.
	// watch() is already waiting on it, so there is nothing to wait for here.
	proc.cancel()
}

// statusOf is what the connector for one tunnel is doing right now.
func (m *Manager) statusOf(tunnelID string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if proc, ok := m.running[tunnelID]; ok {
		return proc.status
	}

	return StatusStopped
}

// --- writing ---------------------------------------------------------------

func (m *Manager) saveRoute(route Route) error {
	db := m.store()
	if db == nil {
		return nil
	}

	return db.Put(store.BucketTunnels, routePrefix+route.Hostname, route)
}

func (m *Manager) forgetRoute(hostname string) {
	if db := m.store(); db != nil {
		_ = db.Delete(store.BucketTunnels, routePrefix+hostname)
	}
}

func (m *Manager) saveCarrier(tunnel Tunnel) error {
	db := m.store()
	if db == nil {
		return nil
	}

	return db.Put(store.BucketTunnels, tunnelPrefix+tunnel.AccountID, tunnel)
}

// InstallCommand installs the connector through Homebrew. Streamed, like the
// runtime's own install.
func (m *Manager) InstallCommand(ctx context.Context) *exec.Cmd {
	return m.runner.Tool(ctx, "brew", "install", Binary)
}
