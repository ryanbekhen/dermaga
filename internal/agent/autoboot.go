package agent

import (
	"context"
	"time"

	"github.com/ryanbekhen/dermaga/internal/containers"
)

// WantsAutoBoot reports whether a container is marked to start with Dermaga.
//
// It used to be a label on the container, which travelled with it and showed up
// in `container inspect` -- but a label can only be written by `container run`,
// so changing one meant recreating the container. Ticking a box should not cost
// a container its filesystem. It is a record of Dermaga's own now, and the
// listing carries the answer; the old label is still read for containers that
// have one. See internal/containers/settings.go.
func WantsAutoBoot(c containers.Container) bool {
	return c.AutoBoot
}

// toBoot picks the containers that should be started: marked, and not already
// running.
func toBoot(list []containers.Container) []containers.Container {
	var wanted []containers.Container

	for _, container := range list {
		if container.Status == "running" || !WantsAutoBoot(container) {
			continue
		}

		wanted = append(wanted, container)
	}

	return wanted
}

const (
	// How long to keep waiting for Apple's services at login. launchd starts
	// this agent as soon as the user is in; the container system may still be
	// getting up, and giving up in the first second would make auto boot a
	// coin toss.
	bootWait  = 3 * time.Minute
	bootCheck = 5 * time.Second
)

// autoBoot starts the marked containers, once, when this agent starts.
//
// Apple's CLI has nothing like it, and it is the half of a restart policy that
// can be promised honestly: Dermaga cannot watch over a container it is not
// running to see, but it can bring one up when it starts -- at login, with the
// background service, or when the app is opened.
func (a *Agent) autoBoot(ctx context.Context) {
	if !a.waitForServices(ctx) {
		a.logger.Warn("Gave up waiting for the container services; nothing auto-booted")
		return
	}

	list, err := a.containers.List(ctx, true)
	if err != nil {
		a.logger.Warn("Could not read the containers to auto-boot", "error", err)
		return
	}

	// The whole list, once, which is what deciding a record is dead needs: a
	// container deleted from a terminal never passed through this process, and
	// what Dermaga kept about it would otherwise sit waiting for a container of
	// the same name to arrive and inherit it.
	a.containers.PruneSettings(list)

	// The same sweep for images, whose records are keyed by tag and outlive a
	// tag deleted from a terminal in exactly the same way.
	if all, err := a.images.List(ctx); err == nil {
		a.images.PruneSettings(all)
	}

	if all, err := a.volumes.List(ctx); err == nil {
		a.volumes.PruneSettings(all)
	}

	wanted := toBoot(list)
	if len(wanted) == 0 {
		return
	}

	a.logger.Info("Starting containers marked to boot with Dermaga", "count", len(wanted))

	for _, container := range wanted {
		if ctx.Err() != nil {
			return
		}

		if _, err := a.containers.Start(ctx, container.ID); err != nil {
			a.logger.Warn("Could not start a container marked to boot",
				"container", container.Name, "error", err)
			continue
		}

		a.logger.Info("Started with Dermaga", "container", container.Name)
	}
}

// waitForServices blocks until Apple's services are up, or gives up.
func (a *Agent) waitForServices(ctx context.Context) bool {
	deadline := time.Now().Add(bootWait)

	for {
		if status, err := a.system.Status(ctx); err == nil && status.Running {
			return true
		}

		if time.Now().After(deadline) || ctx.Err() != nil {
			return false
		}

		select {
		case <-ctx.Done():
			return false
		case <-time.After(bootCheck):
		}
	}
}
