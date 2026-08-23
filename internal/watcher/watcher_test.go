package watcher

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/ryanbekhen/dermaga/internal/containers"
	"github.com/ryanbekhen/dermaga/internal/images"
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
