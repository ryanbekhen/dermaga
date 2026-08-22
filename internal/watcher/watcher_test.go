package watcher

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/ryanbekhen/dermaga/internal/containers"
	"github.com/ryanbekhen/dermaga/internal/system"
)

// A pass that cannot list containers still reports why.
//
// Listing is what fails first when the services stop, and the watcher used to
// return there -- so the one pass able to say "the services are down" was the
// one pass that never asked. The window kept the last good state, and stopping
// the services from inside the app looked like it had done nothing.
func TestARefreshThatCannotListStillReportsTheServices(t *testing.T) {
	stopped := &system.Status{Running: false}

	w := New(Sources{
		Containers: func(context.Context) ([]containers.Container, error) {
			return nil, errors.New("cannot connect to the container service")
		},
		System: func(context.Context) (*system.Status, error) { return stopped, nil },
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	// A list from before things went wrong, so there is something to lose.
	w.latest = Snapshot{Containers: []containers.Container{{ID: "web"}}}
	w.hasSnapshot = true

	w.refresh(context.Background())

	w.mu.RLock()
	got := w.latest
	w.mu.RUnlock()

	if got.System == nil || got.System.Running {
		t.Fatal("the services stopped and the snapshot did not say so")
	}

	if len(got.Containers) != 1 {
		t.Errorf("emptied the list on a failed pass: one flaky subcommand should not blank the window, got %d", len(got.Containers))
	}
}
