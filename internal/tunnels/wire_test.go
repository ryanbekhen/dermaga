package tunnels

import (
	"encoding/json"
	"testing"
)

// Everything that crosses to the window is read there by a lower-case name. A
// struct without json tags marshals with Go's own capitalised field names,
// which is not an error at either end: every field simply arrives undefined,
// and the window draws a running container as a stopped one.
//
// That happened to Target. This is the check that would have caught it.
func TestEverythingCrossingToTheWindowIsTagged(t *testing.T) {
	cases := []struct {
		name  string
		value any
		want  []string
	}{
		{
			name: "Target",
			value: Target{
				Kind: KindContainer, Name: "api",
				Address: "192.168.64.3", Ports: []string{"80"},
			},
			want: []string{"kind", "name", "address", "ports"},
		},
		{
			name: "Route",
			value: Route{
				Hostname: "api.example.com", ZoneID: "z1", ZoneName: "example.com",
				Subdomain: "api", Kind: KindContainer, Target: "api", Port: "80",
				Address:  "192.168.64.3",
				TunnelID: "t1", AccountID: "a1", Created: "now", Status: StatusRunning,
			},
			want: []string{
				"hostname", "zoneId", "zoneName", "subdomain", "kind", "target", "port",
				"address", "tunnelId", "accountId", "created", "status", "reachable",
			},
		},
		{
			name:  "Tunnel",
			value: Tunnel{ID: "t1", Name: "dermaga", AccountID: "a1", Status: StatusRunning},
			want:  []string{"id", "name", "accountId", "status", "routes"},
		},
		{
			name:  "Status",
			value: Status{Connected: true, Domains: 2, Accounts: 1, Routes: 3, Running: 1},
			want: []string{
				"connected", "domains", "accounts", "installed", "brewAvailable",
				"routes", "running",
			},
		},
		{
			name:  "Zone",
			value: Zone{ID: "z1", Name: "example.com", Account: Account{ID: "a1", Name: "Ryan"}},
			want:  []string{"id", "name", "account"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := json.Marshal(tc.value)
			if err != nil {
				t.Fatalf("marshal = %v", err)
			}

			var got map[string]json.RawMessage
			if err := json.Unmarshal(raw, &got); err != nil {
				t.Fatalf("unmarshal = %v", err)
			}

			for _, key := range tc.want {
				if _, found := got[key]; !found {
					t.Errorf("no %q in %s; got %s", key, tc.name, raw)
				}
			}

			// Anything starting with a capital is an untagged field, which is
			// the mistake this test exists for.
			for key := range got {
				if key[0] >= 'A' && key[0] <= 'Z' {
					t.Errorf("%s has an untagged field %q", tc.name, key)
				}
			}
		})
	}
}

// A list that arrives as null is a list the window cannot read.
//
// Go marshals a nil slice as `null`, and TypeScript's type for it says array --
// so `ports.length` throws, and with no error boundary that blanks the window.
// A machine and the host declare no ports at all, which is exactly where a nil
// slice comes from.
func TestATargetNeverSendsNullPorts(t *testing.T) {
	targets := map[string]Target{
		"a machine":             MachineTarget("t2", "192.168.65.2", nil),
		"a stopped machine":     MachineTarget("t2", "", nil),
		"the host":              HostTarget(),
		"a container":           ContainerTarget(Source{Name: "api", Exposed: []string{"80/tcp"}}, nil),
		"a container with none": ContainerTarget(Source{Name: "buildkit"}, nil),
	}

	for name, target := range targets {
		raw, err := json.Marshal(target)
		if err != nil {
			t.Fatalf("%s: marshal = %v", name, err)
		}

		var got struct {
			Ports *[]string `json:"ports"`
		}
		if err := json.Unmarshal(raw, &got); err != nil {
			t.Fatalf("%s: unmarshal = %v", name, err)
		}

		if got.Ports == nil {
			t.Errorf("%s: ports arrived as null; the window reads it as an array: %s", name, raw)
		}
	}
}
