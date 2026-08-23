package tunnels

import "testing"

func TestHostname(t *testing.T) {
	cases := []struct {
		name      string
		subdomain string
		domain    string
		want      string
		wantErr   bool
	}{
		{"a plain subdomain", "api", "example.com", "api.example.com", false},
		{"nothing publishes on the domain itself", "", "example.com", "example.com", false},
		{"case and spaces are the user's, not DNS's", " API ", "Example.com", "api.example.com", false},
		{"several labels are allowed", "api.staging", "example.com", "api.staging.example.com", false},
		{"stray dots are trimmed", ".api.", "example.com", "api.example.com", false},
		{"a leading hyphen is not a label", "-api", "example.com", "", true},
		{"a trailing hyphen is not a label", "api-", "example.com", "", true},
		{"spaces inside are not", "my api", "example.com", "", true},
		{"underscores are not", "my_api", "example.com", "", true},
		{"no domain, no hostname", "api", "", "", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := Hostname(tc.subdomain, tc.domain)

			if tc.wantErr {
				if err == nil {
					t.Fatalf("Hostname(%q, %q) = %q, want an error", tc.subdomain, tc.domain, got)
				}
				return
			}

			if err != nil {
				t.Fatalf("Hostname(%q, %q) = %v", tc.subdomain, tc.domain, err)
			}

			if got != tc.want {
				t.Errorf("Hostname(%q, %q) = %q, want %q", tc.subdomain, tc.domain, got, tc.want)
			}
		})
	}
}

func TestSuggestMakesALabelHostnameAccepts(t *testing.T) {
	cases := map[string]string{
		"api":          "api",
		"My_API":       "my-api",
		"web.frontend": "web-frontend",
		"--weird--":    "weird",
		"db_1":         "db-1",
		"a b  c":       "a-b-c",
	}

	for container, want := range cases {
		got := Suggest(container)
		if got != want {
			t.Errorf("Suggest(%q) = %q, want %q", container, got, want)
		}

		if _, err := Hostname(got, "example.com"); err != nil {
			t.Errorf("Suggest(%q) = %q, which Hostname refuses: %v", container, got, err)
		}
	}
}

func TestSuggestTrimsToALegalLength(t *testing.T) {
	long := ""
	for range 80 {
		long += "a"
	}

	got := Suggest(long)
	if len(got) != 63 {
		t.Fatalf("length = %d, want 63", len(got))
	}

	if _, err := Hostname(got, "example.com"); err != nil {
		t.Errorf("Hostname refused the trimmed suggestion: %v", err)
	}
}

// A route goes to the port the container listens on, not the port it happens
// to be published as. The host port is an accident of how it was published.
func TestContainerTargetUsesTheContainerSidePort(t *testing.T) {
	got := ContainerTarget(Source{
		Name:    "api",
		Address: "192.168.64.3",
		Ports:   []PortMapping{{Host: "8080", Container: "80", Protocol: "tcp"}},
		Exposed: []string{"80/tcp"},
	}, nil)

	if got.Address != "192.168.64.3" {
		t.Errorf("address = %q", got.Address)
	}

	if len(got.Ports) != 1 || got.Ports[0] != "80" {
		t.Fatalf("ports = %v, want just the container's own port", got.Ports)
	}
}

// Publishing a port is only ever needed to reach a container from this Mac, so
// most containers have none. They are reachable all the same.
func TestContainerTargetWithNothingPublished(t *testing.T) {
	got := ContainerTarget(Source{
		Name:    "web",
		Address: "192.168.64.4",
		Exposed: []string{"3000/tcp"},
	}, nil)

	if len(got.Ports) != 1 || got.Ports[0] != "3000" {
		t.Fatalf("ports = %v", got.Ports)
	}
}

// A container with several ports is several routes, which is the whole reason
// the port is chosen rather than guessed.
func TestContainerTargetListsEveryPortInOrder(t *testing.T) {
	got := ContainerTarget(Source{
		Name:    "app",
		Address: "192.168.64.5",
		Ports:   []PortMapping{{Host: "9000", Container: "8080", Protocol: "tcp"}},
		Exposed: []string{"443/tcp", "80/tcp", "8080/tcp"},
	}, nil)

	want := []string{"80", "443", "8080"}
	if len(got.Ports) != len(want) {
		t.Fatalf("ports = %v, want %v", got.Ports, want)
	}

	for i := range want {
		if got.Ports[i] != want[i] {
			t.Fatalf("ports = %v, want %v (sorted as numbers)", got.Ports, want)
		}
	}
}

func TestContainerTargetSkipsUDP(t *testing.T) {
	got := ContainerTarget(Source{
		Name:    "dns",
		Address: "192.168.64.6",
		Ports:   []PortMapping{{Host: "53", Container: "53", Protocol: "udp"}},
		Exposed: []string{"53/udp", "80/tcp"},
	}, nil)

	if len(got.Ports) != 1 || got.Ports[0] != "80" {
		t.Fatalf("ports = %v, want only the TCP one", got.Ports)
	}
}

// A stopped container has no address. That makes a route to it unreachable,
// which is a thing to say on screen rather than an error to raise here.
func TestContainerTargetForAStoppedContainer(t *testing.T) {
	got := ContainerTarget(Source{Name: "worker", Exposed: []string{"80/tcp"}}, nil)

	if got.Address != "" {
		t.Errorf("address = %q, want none", got.Address)
	}

	if len(got.Ports) != 1 {
		t.Errorf("ports = %v, want the port it would listen on", got.Ports)
	}
}

func TestMachineAndHostAreTargetsToo(t *testing.T) {
	machine := MachineTarget("default", "192.168.65.2", nil)
	if machine.Kind != KindMachine || machine.Name != "default" ||
		machine.Address != "192.168.65.2" {
		t.Errorf("MachineTarget = %+v", machine)
	}

	// A machine declares nothing about what listens on it, so the port is
	// typed rather than chosen from a list that would be empty anyway.
	if len(machine.Ports) != 0 {
		t.Errorf("machine ports = %v, want none to suggest", machine.Ports)
	}

	host := HostTarget()
	if host.Kind != KindHost || host.Name != "" || host.Address != HostAddress {
		t.Errorf("HostTarget = %+v", host)
	}
}

// A target is looked up by kind and name together: a machine and a container
// are allowed to share a name, and pointing at the wrong one would be silent.
func TestKeyTellsTheKindsApart(t *testing.T) {
	same := "api"

	if MachineTarget(same, "10.0.0.1", nil).Key() == ContainerTarget(Source{Name: same}, nil).Key() {
		t.Error("a machine and a container with the same name share a key")
	}
}

func TestServiceIsBuiltFromTheAddressAndPort(t *testing.T) {
	route := Route{Address: "192.168.64.3", Port: "3000"}
	if got := route.Service(); got != "http://192.168.64.3:3000" {
		t.Errorf("Service = %q", got)
	}

	// Nothing to point at is nothing, not a URL with a hole in it.
	if got := (Route{Port: "3000"}).Service(); got != "" {
		t.Errorf("Service without an address = %q, want empty", got)
	}
}

// A machine sits on one of the same networks the containers do: its address is
// inside that network's subnet, so it is reached through the same gateway and
// the picture should say so.
func TestAMachineIsPlacedOnTheNetworkHoldingItsAddress(t *testing.T) {
	on := []Net{
		{Name: "default", Subnet: "192.168.64.0/24", Gateway: "192.168.64.1"},
		{Name: "testing", Subnet: "192.168.80.0/24", Gateway: "192.168.80.1"},
	}

	got := MachineTarget("t2", "192.168.64.65", on)
	if got.Network != "default" || got.Gateway != "192.168.64.1" {
		t.Errorf("got network %q via %q, want default via 192.168.64.1", got.Network, got.Gateway)
	}

	// Worked out from the subnet, not from the name: which network is called
	// "default" is a convention, which one holds an address is a fact.
	other := MachineTarget("t3", "192.168.80.9", on)
	if other.Network != "testing" || other.Gateway != "192.168.80.1" {
		t.Errorf("got network %q via %q, want testing via 192.168.80.1", other.Network, other.Gateway)
	}
}

// A stopped machine has no address, and an address on no known network is not
// a reason to invent a gateway for it.
func TestAMachineWithNowhereToPlaceItGetsNoGateway(t *testing.T) {
	on := []Net{{Name: "default", Subnet: "192.168.64.0/24", Gateway: "192.168.64.1"}}

	for _, address := range []string{"", "10.9.9.9", "not-an-address"} {
		got := MachineTarget("t2", address, on)
		if got.Gateway != "" || got.Network != "" {
			t.Errorf("address %q placed on %q via %q", address, got.Network, got.Gateway)
		}
	}
}

// A stopped container reports no interface, so no address and no gateway. It
// still says which network it is configured to join, and the network says where
// its gateway is -- so it keeps its place on the picture rather than being drawn
// hanging off nothing.
func TestAStoppedContainerKeepsItsNetwork(t *testing.T) {
	on := []Net{
		{Name: "default", Subnet: "192.168.64.0/24", Gateway: "192.168.64.1"},
		{Name: "testing", Subnet: "192.168.80.0/24", Gateway: "192.168.80.1"},
	}

	got := ContainerTarget(Source{
		Name:     "whoami2",
		Networks: []string{"testing"},
		Exposed:  []string{"80/tcp"},
	}, on)

	if got.Address != "" {
		t.Errorf("address = %q, want none; it is not running", got.Address)
	}

	if got.Network != "testing" || got.Gateway != "192.168.80.1" {
		t.Errorf("placed on %q via %q, want testing via 192.168.80.1", got.Network, got.Gateway)
	}
}

// What the interface says wins: it is where the container actually is, and the
// configured list is only what it was asked to join.
func TestARunningContainerUsesItsInterfaceNotItsConfiguration(t *testing.T) {
	on := []Net{{Name: "testing", Subnet: "192.168.80.0/24", Gateway: "192.168.80.1"}}

	got := ContainerTarget(Source{
		Name:     "whoami",
		Address:  "192.168.64.61",
		Gateway:  "192.168.64.1",
		Network:  "default",
		Networks: []string{"testing"},
	}, on)

	if got.Network != "default" || got.Gateway != "192.168.64.1" {
		t.Errorf("placed on %q via %q, want where it actually is", got.Network, got.Gateway)
	}
}

// A container on a network nothing knows about is not a reason to invent a
// gateway for it.
func TestAContainerOnAnUnknownNetworkGetsNoGateway(t *testing.T) {
	got := ContainerTarget(Source{Name: "orphan", Networks: []string{"gone"}}, nil)

	if got.Network != "gone" {
		t.Errorf("network = %q, want what it says it joins", got.Network)
	}

	if got.Gateway != "" {
		t.Errorf("gateway = %q, want none invented", got.Gateway)
	}
}
