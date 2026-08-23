package tunnels

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

// serve stands up a fake Cloudflare and points the package at it.
func serve(t *testing.T, handler http.HandlerFunc) *client {
	t.Helper()

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	previous := endpoint
	endpoint = server.URL
	t.Cleanup(func() { endpoint = previous })

	return newClient("test-token")
}

func ok(w http.ResponseWriter, result string) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"success":true,"errors":[],"result":`+result+`}`)
}

func TestTheTokenTravelsAsABearerHeader(t *testing.T) {
	var got string

	api := serve(t, func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Get("Authorization")
		ok(w, `{"status":"active"}`)
	})

	if err := api.verify(context.Background()); err != nil {
		t.Fatalf("verify = %v", err)
	}

	if got != "Bearer test-token" {
		t.Errorf("Authorization = %q", got)
	}
}

// Cloudflare answers 200 with success:false, so the status code alone would
// read every refusal as a success.
func TestARefusalIsAnErrorEvenWithA200(t *testing.T) {
	api := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w,
			`{"success":false,"errors":[{"code":1004,"message":"DNS Validation Error"}],"result":null}`)
	})

	err := api.verify(context.Background())
	if err == nil {
		t.Fatal("want an error")
	}

	if !strings.Contains(err.Error(), "DNS Validation Error") {
		t.Errorf("error = %q, want Cloudflare's own wording", err)
	}
}

// 10000 is returned for every authentication and permission failure, and on its
// own tells the user nothing they can act on.
func TestAPermissionFailureNamesThePermissions(t *testing.T) {
	api := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w,
			`{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}`)
	})

	err := api.verify(context.Background())
	if err == nil {
		t.Fatal("want an error")
	}

	for _, want := range []string{"Cloudflare Tunnel (Edit)", "DNS (Edit)", "Zone (Read)"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error = %q, want it to mention %q", err, want)
		}
	}
}

func TestCreateTunnelAsksForARemotelyManagedOne(t *testing.T) {
	var body map[string]any

	api := serve(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/accounts/acc1/cfd_tunnel" || r.Method != http.MethodPost {
			t.Errorf("%s %s", r.Method, r.URL.Path)
		}

		_ = json.NewDecoder(r.Body).Decode(&body)
		ok(w, `{"id":"tun1","name":"dermaga-api","token":"run-token"}`)
	})

	tunnel, err := api.createTunnel(context.Background(), "acc1", "dermaga-api")
	if err != nil {
		t.Fatalf("createTunnel = %v", err)
	}

	if tunnel.ID != "tun1" || tunnel.Token != "run-token" {
		t.Errorf("tunnel = %+v", tunnel)
	}

	// Without this the routing lives in a local file, and changing a hostname
	// would mean rewriting it and restarting the connector.
	if body["config_src"] != "cloudflare" {
		t.Errorf("config_src = %v, want cloudflare", body["config_src"])
	}
}

// captureIngress returns a client whose configure calls land in the struct.
func captureIngress(t *testing.T, body *struct {
	Config struct {
		Ingress []map[string]any `json:"ingress"`
	} `json:"config"`
}) *client {
	t.Helper()

	return serve(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut {
			t.Errorf("method = %s, want PUT", r.Method)
		}

		_ = json.NewDecoder(r.Body).Decode(body)
		ok(w, `{}`)
	})
}

func TestConfigureEndsWithACatchAll(t *testing.T) {
	var body struct {
		Config struct {
			Ingress []map[string]any `json:"ingress"`
		} `json:"config"`
	}

	api := captureIngress(t, &body)

	err := api.configure(context.Background(), "acc1", "tun1", []rule{
		{hostname: "api.example.com", service: "http://192.168.64.3:3000"},
	})
	if err != nil {
		t.Fatalf("configure = %v", err)
	}

	if len(body.Config.Ingress) != 2 {
		t.Fatalf("ingress = %+v, want the rule and a catch-all", body.Config.Ingress)
	}

	if body.Config.Ingress[0]["hostname"] != "api.example.com" ||
		body.Config.Ingress[0]["service"] != "http://192.168.64.3:3000" {
		t.Errorf("first rule = %+v", body.Config.Ingress[0])
	}

	// Everything on the tunnel's hostnames arrives whether it matches a rule
	// or not, and without this what does not match gets no answer at all.
	if body.Config.Ingress[1]["service"] != "http_status:404" {
		t.Errorf("last rule = %+v, want a 404 catch-all", body.Config.Ingress[1])
	}
}

// Cloudflare takes the ingress as one document: there is no call that adds a
// single rule, so every change sends all of a tunnel's routes.
func TestConfigureSendsEveryRuleInOrder(t *testing.T) {
	var body struct {
		Config struct {
			Ingress []map[string]any `json:"ingress"`
		} `json:"config"`
	}

	api := captureIngress(t, &body)

	err := api.configure(context.Background(), "acc1", "tun1", []rule{
		{hostname: "api.example.com", service: "http://192.168.64.3:3000"},
		{hostname: "admin.example.com", service: "http://192.168.64.3:8080"},
		{hostname: "db.other.com", service: "http://192.168.64.4:5432"},
	})
	if err != nil {
		t.Fatalf("configure = %v", err)
	}

	if len(body.Config.Ingress) != 4 {
		t.Fatalf("ingress has %d entries, want 3 rules and a catch-all", len(body.Config.Ingress))
	}

	for i, want := range []string{"api.example.com", "admin.example.com", "db.other.com"} {
		if body.Config.Ingress[i]["hostname"] != want {
			t.Errorf("rule %d = %v, want %s", i, body.Config.Ingress[i]["hostname"], want)
		}
	}
}

// A tunnel whose last route has just gone still needs a valid document, or the
// connector keeps serving the routes that were removed.
func TestConfigureWithNoRulesIsJustTheCatchAll(t *testing.T) {
	var body struct {
		Config struct {
			Ingress []map[string]any `json:"ingress"`
		} `json:"config"`
	}

	api := captureIngress(t, &body)

	if err := api.configure(context.Background(), "acc1", "tun1", nil); err != nil {
		t.Fatalf("configure = %v", err)
	}

	if len(body.Config.Ingress) != 1 ||
		body.Config.Ingress[0]["service"] != "http_status:404" {
		t.Errorf("ingress = %+v, want only the catch-all", body.Config.Ingress)
	}
}

func TestUpsertDNSCreatesWhenThereIsNoRecord(t *testing.T) {
	var method, path string

	api := serve(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			ok(w, `[]`)
			return
		}

		method, path = r.Method, r.URL.Path
		ok(w, `{"id":"rec1"}`)
	})

	id, err := api.upsertDNS(context.Background(), "zone1", "api.example.com", "tun1")
	if err != nil {
		t.Fatalf("upsertDNS = %v", err)
	}

	if id != "rec1" {
		t.Errorf("id = %q", id)
	}

	if method != http.MethodPost || path != "/zones/zone1/dns_records" {
		t.Errorf("%s %s, want a POST to the collection", method, path)
	}
}

// Cloudflare refuses a duplicate CNAME. A hostname somebody had already pointed
// somewhere by hand would otherwise be unusable from here for ever.
func TestUpsertDNSReusesARecordAlreadyThere(t *testing.T) {
	var method, path string
	var body map[string]any

	api := serve(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			ok(w, `[{"id":"rec9","name":"api.example.com","content":"old.cfargotunnel.com"}]`)
			return
		}

		method, path = r.Method, r.URL.Path
		_ = json.NewDecoder(r.Body).Decode(&body)
		ok(w, `{"id":"rec9"}`)
	})

	id, err := api.upsertDNS(context.Background(), "zone1", "api.example.com", "tun2")
	if err != nil {
		t.Fatalf("upsertDNS = %v", err)
	}

	if id != "rec9" {
		t.Errorf("id = %q, want the record that was already there", id)
	}

	if method != http.MethodPatch || path != "/zones/zone1/dns_records/rec9" {
		t.Errorf("%s %s, want a PATCH to the existing record", method, path)
	}

	if body["content"] != "tun2.cfargotunnel.com" {
		t.Errorf("content = %v, want it repointed at the new tunnel", body["content"])
	}

	if body["proxied"] != true {
		t.Errorf("proxied = %v, want true; an unproxied CNAME never reaches the tunnel", body["proxied"])
	}
}

// The point of the call is that the record is not there afterwards.
func TestDeleteDNSForgivesARecordAlreadyGone(t *testing.T) {
	api := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w,
			`{"success":false,"errors":[{"code":81044,"message":"Record not found."}]}`)
	})

	if err := api.deleteDNS(context.Background(), "zone1", "rec1"); err != nil {
		t.Errorf("deleteDNS = %v, want it forgiven", err)
	}
}

func TestDeleteDNSWithNoRecordMakesNoCall(t *testing.T) {
	called := false

	api := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		called = true
		ok(w, `{}`)
	})

	if err := api.deleteDNS(context.Background(), "zone1", ""); err != nil {
		t.Fatalf("deleteDNS = %v", err)
	}

	if called {
		t.Error("called Cloudflare for a record that was never made")
	}
}

func TestZonesCarryTheirAccount(t *testing.T) {
	api := serve(t, func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/zones") {
			t.Errorf("path = %s", r.URL.Path)
		}

		ok(w, `[{"id":"z1","name":"example.com","account":{"id":"acc1"}}]`)
	})

	zones, err := api.zones(context.Background())
	if err != nil {
		t.Fatalf("zones = %v", err)
	}

	if len(zones) != 1 || zones[0].Name != "example.com" || zones[0].Account.ID != "acc1" {
		t.Errorf("zones = %+v", zones)
	}
}

// Cloudflare describes a malformed token as "Invalid request headers", which
// says nothing about the token somebody just pasted.
func TestAMalformedTokenSaysWhatToPasteInstead(t *testing.T) {
	for _, code := range []int{6003, 6111} {
		api := serve(t, func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = io.WriteString(w, `{"success":false,"errors":[{"code":`+
				strconv.Itoa(code)+`,"message":"Invalid request headers"}]}`)
		})

		err := api.verify(context.Background())
		if err == nil {
			t.Fatalf("code %d: want an error", code)
		}

		if !strings.Contains(err.Error(), "API Tokens") ||
			!strings.Contains(err.Error(), "Global API Key") {
			t.Errorf("code %d: error = %q, want it to name what to paste", code, err)
		}
	}
}

func TestAnUnknownTokenSaysSo(t *testing.T) {
	api := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w,
			`{"success":false,"errors":[{"code":1000,"message":"Invalid API Token"}]}`)
	})

	err := api.verify(context.Background())
	if err == nil || !strings.Contains(err.Error(), "does not recognise") {
		t.Errorf("error = %v", err)
	}
}

// Anything about a hostname or a record is Cloudflare's to explain, and it does
// it better than a paraphrase would.
func TestOtherErrorsArePassedThrough(t *testing.T) {
	api := serve(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w,
			`{"success":false,"errors":[{"code":81053,"message":"An A, AAAA, or CNAME record with that host already exists."}]}`)
	})

	err := api.verify(context.Background())
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Errorf("error = %v, want Cloudflare's own wording", err)
	}
}
