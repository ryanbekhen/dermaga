package agent

import (
	"strings"
	"sync"
	"time"

	"github.com/ryanbekhen/dermaga/internal/containers"
)

// exitWatch spots containers that stop without being asked to.
//
// The app already knows the moment anything changes, and it usually runs in the
// background -- so a container that dies at three in the morning is exactly the
// kind of thing worth saying out loud. What is not worth saying is "the thing
// you just stopped has stopped", which is why deliberate stops are remembered
// and stay quiet.
type exitWatch struct {
	mu sync.Mutex
	// Last known state per container, so a change of state can be seen at all.
	states map[string]string
	// Containers the user asked to stop or remove, and when. Anything here is
	// expected to go away, and does so silently.
	expected map[string]time.Time
	// Set once the first snapshot has been seen: everything already stopped at
	// startup stopped before Dermaga was watching, and is not news.
	primed bool
}

// expectedFor is how long a stop stays "asked for". Stopping a container takes
// a moment, and the snapshot that reports it may arrive a little later still.
const expectedFor = 60 * time.Second

func newExitWatch() *exitWatch {
	return &exitWatch{
		states:   map[string]string{},
		expected: map[string]time.Time{},
	}
}

// Expect records that this container is about to stop on purpose.
func (w *exitWatch) Expect(id string) {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.expected[id] = time.Now()
}

// Exit is one container that stopped on its own.
type Exit struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Image string `json:"image,omitempty"`
	State string `json:"state,omitempty"`
}

// Check compares this snapshot with the last and returns the unexpected exits.
func (w *exitWatch) Check(list []containers.Container) []Exit {
	w.mu.Lock()
	defer w.mu.Unlock()

	now := time.Now()
	for id, at := range w.expected {
		if now.Sub(at) > expectedFor {
			delete(w.expected, id)
		}
	}

	var exits []Exit
	seen := make(map[string]struct{}, len(list))

	for _, container := range list {
		seen[container.ID] = struct{}{}

		was, known := w.states[container.ID]
		w.states[container.ID] = container.Status

		if !w.primed || !known {
			continue
		}

		if was != "running" || container.Status == "running" {
			continue
		}

		if _, asked := w.expected[container.ID]; asked {
			delete(w.expected, container.ID)
			continue
		}

		exits = append(exits, Exit{
			ID:    container.ID,
			Name:  strings.TrimSpace(container.Name),
			Image: container.Image,
			State: container.Status,
		})
	}

	// A container that has been removed is gone rather than stopped, and the
	// user is the one who removed it.
	for id := range w.states {
		if _, ok := seen[id]; !ok {
			delete(w.states, id)
			delete(w.expected, id)
		}
	}

	w.primed = true

	return exits
}
