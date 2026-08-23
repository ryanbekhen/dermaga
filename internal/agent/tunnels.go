package agent

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"

	"github.com/ryanbekhen/dermaga/internal/containers"
	"github.com/ryanbekhen/dermaga/internal/machines"
	"github.com/ryanbekhen/dermaga/internal/networks"
	"github.com/ryanbekhen/dermaga/internal/rpc"
	"github.com/ryanbekhen/dermaga/internal/tunnels"
)

// --- tunnels --------------------------------------------------------------

func (a *Agent) registerTunnels() {
	a.server.Register("tunnels.status", func(ctx context.Context, _ json.RawMessage) (any, error) {
		return a.tunnels.Status(ctx), nil
	})

	// The whole picture the window draws: every tunnel, and the routes on it.
	a.server.Register("tunnels.list", func(_ context.Context, _ json.RawMessage) (any, error) {
		return a.tunnels.Tunnels(), nil
	})

	a.server.Register("tunnels.connect", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Token string `json:"token"`
		}](params)
		if err != nil {
			return nil, err
		}

		status, err := a.tunnels.Connect(ctx, args.Token)
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		// Whatever was already published starts serving again.
		//
		// Disconnecting keeps the routes on purpose, and the dialog says so --
		// "connect again and they come back". Until this, they only came back
		// when Dermaga was restarted, because that was the only thing that ran
		// Restore. A promise the code did not keep.
		//
		// Its own context: a connector outlives the call that asked for it, and
		// this one returns as soon as the token is stored.
		go a.tunnels.Restore(context.Background())

		return status, nil
	})

	a.server.Register("tunnels.disconnect", func(ctx context.Context, _ json.RawMessage) (any, error) {
		if err := a.tunnels.Disconnect(ctx); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{}, nil
	})

	a.server.Register("tunnels.zones", func(ctx context.Context, _ json.RawMessage) (any, error) {
		zones, err := a.tunnels.Zones(ctx)
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return zones, nil
	})

	// Everything a route could point at: the containers, the Linux VMs, and
	// this Mac. One call rather than one per kind, because the form needs the
	// whole list to fill its fields.
	a.server.Register("tunnels.targets", func(ctx context.Context, _ json.RawMessage) (any, error) {
		targets, err := a.tunnelTargets(ctx)
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return targets, nil
	})

	a.server.Register("tunnels.addRoute", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[tunnels.Spec](params)
		if err != nil {
			return nil, err
		}

		// The targets are read again rather than trusted from the form: they
		// decide where traffic from the internet is sent, and a container that
		// has moved on since the form opened would otherwise publish whatever
		// is at that address now.
		if _, err := a.tunnelTargets(ctx); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		route, err := a.tunnels.AddRoute(ctx, args)
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return route, nil
	})

	a.server.Register("tunnels.removeRoute", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Hostname string `json:"hostname"`
		}](params)
		if err != nil {
			return nil, err
		}

		if strings.TrimSpace(args.Hostname) == "" {
			return nil, rpc.Fail("which hostname?")
		}

		if err := a.tunnels.RemoveRoute(ctx, args.Hostname); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{}, nil
	})

	a.server.Register("tunnels.start", func(ctx context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Tunnel string `json:"tunnel"`
		}](params)
		if err != nil {
			return nil, err
		}

		if err := a.tunnels.StartTunnel(ctx, args.Tunnel); err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{}, nil
	})

	a.server.Register("tunnels.stop", func(_ context.Context, params json.RawMessage) (any, error) {
		args, err := decodeParams[struct {
			Tunnel string `json:"tunnel"`
		}](params)
		if err != nil {
			return nil, err
		}

		a.tunnels.StopTunnel(args.Tunnel)

		return map[string]any{}, nil
	})

	a.server.Register("tunnels.install", func(ctx context.Context, _ json.RawMessage) (any, error) {
		if !a.runner.Has("brew") {
			return nil, rpc.Fail(
				"Homebrew is not installed, so Dermaga cannot install cloudflared for you")
		}

		id, err := a.streams.runCommand(ctx, "install", func(ctx context.Context) (*exec.Cmd, error) {
			return a.tunnels.InstallCommand(ctx), nil
		})
		if err != nil {
			return nil, rpc.Fail(err.Error())
		}

		return map[string]any{"streamId": id}, nil
	})
}

// tunnelTargets lists everything a route could point at, and hands the same
// list to the tunnels manager so its view of where things are stays current.
//
// A machine that cannot be listed is not a reason to refuse the whole answer:
// the containers are what almost every route uses, and losing them because the
// VM list failed would be losing the useful part to the rare one.
func (a *Agent) tunnelTargets(ctx context.Context) ([]tunnels.Target, error) {
	live, err := a.containers.List(ctx, true)
	if err != nil {
		return nil, err
	}

	vms, err := a.machines.List(ctx)
	if err != nil {
		a.logger.Warn("Listing machines for tunnel targets failed", "error", err)
		vms = nil
	}

	nets, err := a.networks.List(ctx)
	if err != nil {
		a.logger.Warn("Listing networks for tunnel targets failed", "error", err)
		nets = nil
	}

	targets := targetsOf(live, vms, nets)
	a.tunnels.Observe(targets)

	return targets, nil
}

// targetsOf reduces the lists to what the tunnels package needs, so that
// package does not depend on this one's view of a container or a machine.
func targetsOf(
	live []containers.Container,
	vms []machines.Machine,
	nets []networks.Network,
) []tunnels.Target {
	targets := make([]tunnels.Target, 0, len(live)+len(vms)+1)

	// The networks, so anything that does not say where it sits can be placed:
	// a machine by the subnet its address falls in, a stopped container by the
	// network it is configured to join.
	on := make([]tunnels.Net, 0, len(nets))
	for _, network := range nets {
		on = append(on, tunnels.Net{
			Name:    network.Name,
			Subnet:  network.IPv4Subnet,
			Gateway: network.IPv4Gateway,
		})
	}

	for _, container := range live {
		source := tunnels.Source{
			Name: container.Name,
			// What it is configured to join, which it still says when it is
			// stopped and reports no interface at all.
			Networks: container.Networks,
			Exposed:  container.ExposedPorts,
		}

		for _, port := range container.Ports {
			source.Ports = append(source.Ports, tunnels.PortMapping{
				Host:      port.Host,
				Container: port.Container,
				Protocol:  port.Protocol,
			})
		}

		// The first address it holds. A stopped container has none, which is
		// what makes a route to it unreachable rather than wrong.
		for _, iface := range container.Interfaces {
			if iface.IPv4Address != "" {
				source.Address = stripMask(iface.IPv4Address)
				source.Gateway = stripMask(iface.IPv4Gateway)
				source.Network = iface.Network
				break
			}
		}

		targets = append(targets, tunnels.ContainerTarget(source, on))
	}

	for _, machine := range vms {
		targets = append(targets, tunnels.MachineTarget(machine.ID, machine.IPAddress, on))
	}

	// This Mac, last: it is always there, and it is what somebody reaches for
	// when the thing they are working on is not in a container yet.
	targets = append(targets, tunnels.HostTarget())

	return targets
}

// stripMask turns "192.168.64.3/24" into "192.168.64.3". The runtime reports an
// interface address with its prefix length, which is not part of an address
// anything can connect to.
func stripMask(address string) string {
	if host, _, found := strings.Cut(address, "/"); found {
		return host
	}

	return address
}

// restoreTunnels brings up the connectors for tunnels that have routes, after
// telling the manager where the containers currently are.
//
// The containers come first: a route re-points itself at the address its
// container holds now, and starting a connector before that is known would
// publish the address it held last time.
func (a *Agent) restoreTunnels(ctx context.Context) {
	if targets, err := a.tunnelTargets(ctx); err == nil {
		a.tunnels.Reconcile(ctx, targets)
	}

	a.tunnels.Restore(ctx)
}
