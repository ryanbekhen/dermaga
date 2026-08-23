package tunnels

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

func decode(raw []byte, out any) error {
	return json.Unmarshal(raw, out)
}

// label is one part of a hostname: letters, digits and hyphens, not starting or
// ending with one.
var label = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

// Hostname joins a subdomain to a domain, and refuses anything DNS would.
//
// An empty subdomain publishes on the domain itself, which is what somebody
// with a domain kept for this will want. A subdomain with dots in it is allowed
// and checked part by part: "api.staging" under "example.com" is an ordinary
// thing to want and Cloudflare will serve it.
func Hostname(subdomain, domain string) (string, error) {
	domain = strings.ToLower(strings.TrimSpace(domain))
	if domain == "" {
		return "", errors.New("a domain is required")
	}

	subdomain = strings.ToLower(strings.Trim(strings.TrimSpace(subdomain), "."))
	if subdomain == "" {
		return domain, nil
	}

	for _, part := range strings.Split(subdomain, ".") {
		if !label.MatchString(part) {
			return "", fmt.Errorf(
				"%q is not a valid subdomain. Letters, digits and hyphens only.", subdomain)
		}
	}

	return subdomain + "." + domain, nil
}

// Suggest turns a container name into a subdomain that will pass Hostname, so
// the form opens with the field filled in rather than empty.
func Suggest(container string) string {
	lowered := strings.ToLower(strings.TrimSpace(container))

	var out strings.Builder
	for _, r := range lowered {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			out.WriteRune(r)
		case r == '-' || r == '_' || r == '.' || r == ' ':
			out.WriteRune('-')
		}
	}

	suggestion := strings.Trim(out.String(), "-")
	for strings.Contains(suggestion, "--") {
		suggestion = strings.ReplaceAll(suggestion, "--", "-")
	}

	if len(suggestion) > 63 {
		suggestion = strings.TrimRight(suggestion[:63], "-")
	}

	return suggestion
}

// What a route can point at.
//
// A container is the common one, but not the only thing on this Mac worth
// putting a hostname on: the Linux VMs have addresses of their own, and so does
// macOS, where somebody's dev server is usually running long before it is in a
// container at all.
const (
	KindContainer = "container"
	KindMachine   = "machine"
	KindHost      = "host"
)

// HostAddress is where the host is reached from the connector, which runs on it.
const HostAddress = "127.0.0.1"

// PortMapping is one port a container publishes to this Mac.
type PortMapping struct {
	Host      string
	Container string
	Protocol  string
}

// Source is what a container offers, as the agent hands it over. A plain struct
// rather than the container itself, so this package does not depend on the one
// that lists them.
type Source struct {
	Name string
	// Address is where this Mac reaches it, empty when it is not running.
	Address string
	// Gateway is the address of the network it sits on, and Network is what
	// that network is called. Both come from the interface it holds while it is
	// running.
	Gateway string
	Network string
	// Networks is what it is configured to join, which it still says when it is
	// stopped and holds no interface at all.
	Networks []string
	// Ports it publishes to the host.
	Ports []PortMapping
	// Exposed is what the image declares it listens on, e.g. "80/tcp".
	Exposed []string
}

// ContainerTarget reduces a container to the ports a route can be pointed at.
//
// The ports are the container's own, not the host's. Publishing a port is only
// ever needed to reach a container from this Mac, and Apple's runtime gives
// every container an address here anyway -- so a route goes straight to what
// the container listens on, and a container with nothing published is as
// publishable as one with six.
func ContainerTarget(source Source, on []Net) Target {
	target := Target{
		Kind:    KindContainer,
		Name:    source.Name,
		Address: source.Address,
		Gateway: source.Gateway,
		Network: source.Network,
		Ports:   []string{},
	}

	// A stopped container holds no interface, so it reports no address and no
	// gateway -- but it still says which network it is configured to join, and
	// the network itself says where its gateway is. Between the two, a stopped
	// container keeps its place on the picture instead of being drawn hanging
	// off nothing.
	if target.Network == "" && len(source.Networks) > 0 {
		target.Network = source.Networks[0]

		for _, network := range on {
			if network.Name == target.Network {
				target.Gateway = network.Gateway
				break
			}
		}
	}

	seen := map[string]bool{}

	add := func(port string) {
		if port == "" || seen[port] {
			return
		}

		seen[port] = true
		target.Ports = append(target.Ports, port)
	}

	for _, port := range source.Ports {
		if port.Protocol != "" && !strings.EqualFold(port.Protocol, "tcp") {
			continue
		}

		// The container side. The host port is an accident of how it was
		// published and means nothing inside the container.
		if port.Container != "" {
			add(port.Container)
		} else {
			add(port.Host)
		}
	}

	for _, exposed := range source.Exposed {
		number, protocol := splitPort(exposed)
		if protocol != "" && !strings.EqualFold(protocol, "tcp") {
			continue
		}

		add(number)
	}

	sortPorts(target.Ports)

	return target
}

// MachineTarget is one of the Linux VMs. It has an address of its own and
// nothing that declares what listens on it, so the port is typed rather than
// chosen.
//
// The empty list is not decoration. A nil slice marshals as `null`, and the
// window reads it as an array -- so `ports.length` on a machine threw, and with
// no error boundary the whole window went blank.
func MachineTarget(name, address string, on []Net) Target {
	target := Target{Kind: KindMachine, Name: name, Address: address, Ports: []string{}}

	// A machine sits on one of the same networks the containers do -- its
	// address is inside that network's subnet -- so it is reached through the
	// same gateway, and the picture should say so. Worked out from the subnet
	// rather than from the name: which network is "default" is a convention,
	// and which one holds an address is a fact.
	if network, found := networkOf(address, on); found {
		target.Gateway = network.Gateway
		target.Network = network.Name
	}

	return target
}

// Net is one of this Mac's container networks, as the agent hands it over.
type Net struct {
	Name    string
	Subnet  string
	Gateway string
}

// networkOf finds the network an address belongs to.
func networkOf(address string, on []Net) (Net, bool) {
	ip := net.ParseIP(address)
	if ip == nil {
		return Net{}, false
	}

	for _, network := range on {
		_, block, err := net.ParseCIDR(network.Subnet)
		if err != nil || block == nil {
			continue
		}

		if block.Contains(ip) {
			return network, true
		}
	}

	return Net{}, false
}

// HostTarget is this Mac. Always reachable -- the connector runs on it -- and,
// like a machine, it says nothing about what is listening, so the port is
// typed.
func HostTarget() Target {
	return Target{Kind: KindHost, Name: "", Address: HostAddress, Ports: []string{}}
}

func sortPorts(ports []string) {
	sort.Slice(ports, func(i, j int) bool {
		a, aErr := strconv.Atoi(ports[i])
		b, bErr := strconv.Atoi(ports[j])

		if aErr == nil && bErr == nil {
			return a < b
		}

		return ports[i] < ports[j]
	})
}

// splitPort reads "80/tcp" as ("80", "tcp"). A port with no protocol is
// returned as it is.
func splitPort(exposed string) (string, string) {
	exposed = strings.TrimSpace(exposed)
	if exposed == "" {
		return "", ""
	}

	number, protocol, found := strings.Cut(exposed, "/")
	if !found {
		return number, ""
	}

	return number, protocol
}
