package agent

import (
	"context"
	"strings"

	"github.com/ryanbekhen/dermaga/internal/networks"
	"github.com/ryanbekhen/dermaga/internal/projects"
)

// ProjectNetworkLabel marks a network Dermaga made for a project.
//
// A label, and here that is the right place for one -- unlike a container's
// membership, which had to leave its label because changing it meant recreating
// the container. A network is never edited: it is made once, for one project,
// and the answer never changes. So it travels with the thing it describes, and
// a network made here is still recognisable after Dermaga's own records are
// gone.
const ProjectNetworkLabel = "dermaga.project"

// ensureProjectNetwork makes the network a project's containers are attached
// to, and answers with its name.
//
// This is the one part of a project that does something rather than merely
// filtering. Everything else here decides what is *shown*; this decides what a
// container can find by name. Two services born in the same project reach each
// other as `api` and `db`, and a project alongside them does not get tangled in.
//
// Made with the project rather than with the first container that wants it. It
// was the other way round at first, on the grounds that a point of view should
// not leave anything on the runtime -- but that put the network's existence a
// step behind the project's, so moving a container into an empty project had to
// stop and make one, and "the project's network" was a thing that sometimes was
// not there. A project has a network. This is also called on the way in to a
// move and a create, for the projects made before that was true.
//
// The name is namespaced -- `dermaga-bengkel` -- so this can never adopt a
// network somebody made for their own reasons that happens to share a project's
// name. What it makes is the only thing it attaches to, and the only thing it
// ever removes.
func (a *Agent) ensureProjectNetwork(ctx context.Context, project string) (string, error) {
	name := projects.NetworkName(project)
	if name == "" {
		return "", nil
	}

	existing, err := a.networks.List(ctx)
	if err != nil {
		return "", err
	}

	for _, network := range existing {
		if network.Name == name {
			return name, nil
		}
	}

	if err := a.networks.Create(ctx, networks.Spec{
		Name:   name,
		Labels: map[string]string{ProjectNetworkLabel: strings.TrimSpace(project)},
	}); err != nil {
		return "", err
	}

	return name, nil
}

// withProjectNetwork adds a project's network to the ones a container is being
// created on, leaving whatever was already chosen alone.
//
// Added rather than substituted, deliberately. A container born in a project
// still belongs on the networks the form asked for -- usually `default`, where
// the database every project borrows is -- and taking those away in the name of
// grouping would make a filter into a fence, which is the one thing a project
// here is not.
func withProjectNetwork(chosen []string, network string) []string {
	if network == "" {
		return chosen
	}

	for _, name := range chosen {
		if name == network {
			return chosen
		}
	}

	return append(chosen, network)
}

// dropProjectNetwork removes the network a project was given, once the project
// is gone.
//
// Only while nothing is attached, and that is not a technicality: deleting a
// project deletes a way of looking at containers and never the containers, so
// a network still carrying some is a network still doing its job. Left behind,
// it is named after a project that no longer exists -- untidy, and the tidier
// alternative is taking something out from under a running container.
func (a *Agent) dropProjectNetwork(ctx context.Context, project string) {
	name := projects.NetworkName(project)
	if name == "" {
		return
	}

	existing, err := a.networks.List(ctx)
	if err != nil {
		a.logger.Debug("Could not read the networks to tidy one away", "project", project, "error", err)
		return
	}

	for _, network := range existing {
		// By name, and also by label. Networks made before the name was
		// namespaced are called after the project alone -- there is no rename
		// on this runtime, so they keep those names -- and the label is what
		// still identifies them as this project's. Matching both means putting
		// a project away takes its network with it whichever version made it.
		if network.Name != name && network.Labels[ProjectNetworkLabel] != strings.TrimSpace(project) {
			continue
		}

		if len(network.UsedBy) > 0 {
			a.logger.Info("Leaving a project's network; something is still attached",
				"network", network.Name, "attached", len(network.UsedBy))
			continue
		}

		if err := a.networks.Delete(ctx, network.Name); err != nil {
			a.logger.Warn("Could not remove a project's network",
				"network", network.Name, "error", err)
		}
	}
}
