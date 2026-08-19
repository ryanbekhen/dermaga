// Package watcher keeps one authoritative view of the host and pushes it to
// subscribers whenever it changes. Nothing polls from the outside: the agent
// tells the UI when something happened.
package watcher

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/ryanbekhen/dermaga/internal/containers"
	"github.com/ryanbekhen/dermaga/internal/images"
	"github.com/ryanbekhen/dermaga/internal/machines"
	"github.com/ryanbekhen/dermaga/internal/networks"
	"github.com/ryanbekhen/dermaga/internal/volumes"
)

// Interval is how often the CLI is queried while at least one client is
// listening. Operations made through Dermaga do not wait for it -- they Poke
// the watcher and land within milliseconds. This tick exists to notice changes
// made outside the app, like `container run` in a terminal.
const Interval = 2 * time.Second

// subscriberBuffer keeps a slow subscriber from blocking the watch loop.
const subscriberBuffer = 4

// Snapshot is everything the UI renders, as one consistent view.
type Snapshot struct {
	Containers []containers.Container `json:"containers"`
	Machines   []machines.Machine     `json:"machines"`
	Images     []images.Image         `json:"images"`
	Volumes    []volumes.Volume       `json:"volumes"`
	Networks   []networks.Network     `json:"networks"`
}

// Sources are the lists a snapshot is built from. Passing them as functions
// keeps this package independent of how the managers are constructed.
type Sources struct {
	Containers func(context.Context) ([]containers.Container, error)
	Machines   func(context.Context) ([]machines.Machine, error)
	Images     func(context.Context) ([]images.Image, error)
	Volumes    func(context.Context) ([]volumes.Volume, error)
	Networks   func(context.Context) ([]networks.Network, error)
}

type Watcher struct {
	sources Sources
	logger  *slog.Logger

	mu          sync.RWMutex
	subscribers map[int]chan Snapshot
	nextID      int
	latest      Snapshot
	fingerprint [32]byte
	hasSnapshot bool

	poke chan struct{}

	// Called whenever the snapshot actually changed, including changes made
	// outside Dermaga entirely.
	onChange func(Snapshot)
}

// OnChange registers a listener for real changes. One listener is enough for
// what this serves; a second call replaces the first.
func (w *Watcher) OnChange(listener func(Snapshot)) {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.onChange = listener
}

func New(sources Sources, logger *slog.Logger) *Watcher {
	return &Watcher{
		sources:     sources,
		logger:      logger,
		subscribers: map[int]chan Snapshot{},
		poke:        make(chan struct{}, 1),
	}
}

// Changed satisfies notify.Notifier: any manager can announce a change without
// knowing the watcher exists.
func (w *Watcher) Changed() {
	select {
	case w.poke <- struct{}{}:
	default:
	}
}

// Run drives the watch loop until the context is cancelled. With no
// subscribers it does no work at all, so a closed window costs nothing.
func (w *Watcher) Run(ctx context.Context) {
	ticker := time.NewTicker(Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-w.poke:
			w.refresh(ctx)
		case <-ticker.C:
			// Nobody is reading the list, so nothing is asked of the CLI.
			if w.SubscriberCount() == 0 {
				continue
			}

			w.refresh(ctx)
		}
	}
}

func (w *Watcher) refresh(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	containerList, err := w.sources.Containers(ctx)
	if err != nil {
		w.logger.Debug("Watch refresh failed", "error", err)
		return
	}

	// Supporting resources are best-effort: containers still render without
	// them, and one flaky subcommand should not blank the whole UI.
	machineList := collect(ctx, w.sources.Machines, w.logger, "machines")
	imageList := collect(ctx, w.sources.Images, w.logger, "images")
	volumeList := collect(ctx, w.sources.Volumes, w.logger, "volumes")
	networkList := collect(ctx, w.sources.Networks, w.logger, "networks")

	annotateUsage(containerList, volumeList, networkList)

	snapshot := Snapshot{
		Containers: containerList,
		Machines:   machineList,
		Images:     imageList,
		Volumes:    volumeList,
		Networks:   networkList,
	}

	encoded, err := json.Marshal(snapshot)
	if err != nil {
		return
	}
	fingerprint := sha256.Sum256(encoded)

	w.mu.Lock()
	unchanged := w.hasSnapshot && fingerprint == w.fingerprint
	w.latest = snapshot
	w.fingerprint = fingerprint
	w.hasSnapshot = true

	if unchanged {
		w.mu.Unlock()
		return
	}

	onChange := w.onChange

	targets := make([]chan Snapshot, 0, len(w.subscribers))
	for _, ch := range w.subscribers {
		targets = append(targets, ch)
	}
	w.mu.Unlock()

	// Anything the host changed behind Dermaga's back -- an image pulled in a
	// terminal, a container removed by a script -- is only ever noticed here.
	if onChange != nil {
		onChange(snapshot)
	}

	for _, ch := range targets {
		select {
		case ch <- snapshot:
		default:
			// Subscriber is behind; it will get the next update.
		}
	}
}

func collect[T any](
	ctx context.Context,
	source func(context.Context) ([]T, error),
	logger *slog.Logger,
	name string,
) []T {
	values, err := source(ctx)
	if err != nil {
		logger.Debug("Refresh failed", "resource", name, "error", err)
		return []T{}
	}

	return values
}

// Subscribe returns a channel of snapshots plus the current one, so a new
// subscriber renders immediately instead of waiting for a change.
func (w *Watcher) Subscribe() (int, <-chan Snapshot, Snapshot, bool) {
	ch := make(chan Snapshot, subscriberBuffer)

	w.mu.Lock()
	id := w.nextID
	w.nextID++
	w.subscribers[id] = ch
	snapshot, ready := w.latest, w.hasSnapshot
	w.mu.Unlock()

	if !ready {
		// First subscriber in: fetch now rather than waiting for a tick.
		w.Changed()
	}

	return id, ch, snapshot, ready
}

func (w *Watcher) Unsubscribe(id int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	delete(w.subscribers, id)
}

func (w *Watcher) SubscriberCount() int {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return len(w.subscribers)
}

// annotateUsage marks which volumes and networks the given containers are
// attached to, so the UI can warn before deleting something in use.
func annotateUsage(
	containerList []containers.Container,
	volumeList []volumes.Volume,
	networkList []networks.Network,
) {
	volumeUsers := map[string][]string{}
	networkUsers := map[string][]string{}

	for _, c := range containerList {
		for _, m := range c.Mounts {
			if m.Type == "volume" {
				volumeUsers[m.Source] = append(volumeUsers[m.Source], c.Name)
			}
		}
		for _, n := range c.Networks {
			networkUsers[n] = append(networkUsers[n], c.Name)
		}
	}

	for i := range volumeList {
		if users, ok := volumeUsers[volumeList[i].Name]; ok {
			volumeList[i].UsedBy = users
		}
	}
	for i := range networkList {
		if users, ok := networkUsers[networkList[i].Name]; ok {
			networkList[i].UsedBy = users
		}
	}
}
