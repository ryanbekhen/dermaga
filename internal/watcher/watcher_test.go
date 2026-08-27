package watcher

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/ryanbekhen/dermaga/internal/containers"
	"github.com/ryanbekhen/dermaga/internal/images"
	"github.com/ryanbekhen/dermaga/internal/machines"
	"github.com/ryanbekhen/dermaga/internal/networks"
	"github.com/ryanbekhen/dermaga/internal/system"
	"github.com/ryanbekhen/dermaga/internal/volumes"
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

// The whole of feature one: a container is a copy of an image taken at one
// moment, and after `container build` its tag means something else.
func TestAContainerKnowsWhenItsImageMovedOn(t *testing.T) {
	list := []containers.Container{
		{ID: "api", Image: "api:dev", ImageDigest: "sha256:old"},
		{ID: "redis", Image: "docker.io/library/redis:8-alpine", ImageDigest: "sha256:same"},
	}

	// The image listing reports digests without the algorithm in front; the
	// container listing reports them with it. Comparing the two as they come
	// would make every container look rebuilt, for ever.
	annotateImageDrift(list, []images.Image{
		{Reference: "api:dev", Digest: "new"},
		{Reference: "docker.io/library/redis:8-alpine", Digest: "same"},
	})

	if !list[0].ImageMoved {
		t.Error("api:dev was built again and the container did not notice")
	}
	if list[1].ImageMoved {
		t.Error("redis is on the image its tag still means, and was marked anyway")
	}
}

// A marker that cannot keep its promise is worse than none: pressing Recreate
// has to end in a container, and it cannot when there is no image to make one
// from.
func TestAnImageThatIsGoneIsNotAnImageThatMovedOn(t *testing.T) {
	list := []containers.Container{
		{ID: "deleted", Image: "gone:latest", ImageDigest: "sha256:old"},
		{ID: "buildkit", Image: containers.BuilderImage + "builder:0.13.1", ImageDigest: "sha256:old"},
		{ID: "ancient", Image: "api:dev", ImageDigest: ""},
	}

	annotateImageDrift(list, []images.Image{{Reference: "api:dev", Digest: "new"}})

	for _, c := range list {
		if c.ImageMoved {
			t.Errorf("%s was marked as rebuilt on evidence that does not exist", c.ID)
		}
	}
}

// A listing that failed arrives here as no images at all, which is not news
// about any container.
func TestAFailedImageListingMarksNothing(t *testing.T) {
	list := []containers.Container{{ID: "api", Image: "api:dev", ImageDigest: "sha256:old"}}

	annotateImageDrift(list, nil)

	if list[0].ImageMoved {
		t.Error("marked a container from an image listing that never arrived")
	}
}

// The sequence a user reported: Apple's CLI updated, the services stopped,
// started again from inside the app -- and the container list came back empty.
//
// It is here because the watcher was the first suspect and turned out to be
// innocent, which is worth keeping proof of. The list was empty in the window
// because every container was stopped and the stopped filter was off, not
// because the data never arrived.
//
// What it does check is the awkward middle: `container system start` returns
// once launchd has the job, which is before the API server answers, so the
// pass that the start pokes still cannot list anything. The pass after it can,
// and that one has to reach the window.
func TestTheListComesBackAfterTheServicesDo(t *testing.T) {
	up := false
	answering := false

	w := New(Sources{
		Containers: func(context.Context) ([]containers.Container, error) {
			if !answering {
				return nil, errors.New("cannot connect to the container service")
			}
			return []containers.Container{{ID: "redis"}, {ID: "mysql"}}, nil
		},
		System: func(context.Context) (*system.Status, error) {
			return &system.Status{Running: up}, nil
		},
		Machines: func(context.Context) ([]machines.Machine, error) { return nil, nil },
		Images:   func(context.Context) ([]images.Image, error) { return nil, nil },
		Volumes:  func(context.Context) ([]volumes.Volume, error) { return nil, nil },
		Networks: func(context.Context) ([]networks.Network, error) { return nil, nil },
	}, slog.New(slog.NewTextHandler(io.Discard, nil)))

	id, updates, _, _ := w.Subscribe()
	defer w.Unsubscribe(id)

	// The agent came up while the services were down, so nothing was ever
	// listed and there is no good state to fall back on.
	w.refresh(context.Background())

	// The Start button: the command returned, the watcher was poked, and the
	// API server is not answering yet.
	up = true
	w.refresh(context.Background())

	// The tick two seconds later.
	answering = true
	w.refresh(context.Background())

	var last Snapshot
	pushed := 0
	for {
		select {
		case s := <-updates:
			last = s
			pushed++
			continue
		default:
		}
		break
	}

	if pushed == 0 {
		t.Fatal("nothing was pushed, so the window would still be showing the empty list")
	}
	if len(last.Containers) != 2 {
		t.Fatalf("the list did not come back: got %d containers", len(last.Containers))
	}
	if last.System == nil || !last.System.Running {
		t.Fatal("the services came up and the snapshot did not say so")
	}
}
