package agent

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/ryanbekhen/dermaga/internal/containers"
)

// RestartLabel is where a container's restart policy lives.
//
// On the container itself, rather than in a file of Dermaga's own: the policy
// belongs to the thing it describes. It travels with the container, `container
// inspect` shows it, and a container deleted from a terminal leaves no stale
// row behind in something we would then have to reconcile.
const RestartLabel = "dermaga.restart"

// Policy is what to do when a container stops.
//
// There is deliberately no on-failure: Apple's CLI does not report an exit
// code, so "did it fail?" is a question we cannot answer, and a policy that
// silently treats every exit as a failure would be a lie.
type Policy string

const (
	PolicyNo            Policy = ""
	PolicyAlways        Policy = "always"
	PolicyUnlessStopped Policy = "unless-stopped"
)

// PolicyOf reads the policy off a container, ignoring anything it does not
// understand -- a label is a free-text field and may hold anything.
func PolicyOf(c containers.Container) Policy {
	switch Policy(c.Labels[RestartLabel]) {
	case PolicyAlways:
		return PolicyAlways
	case PolicyUnlessStopped:
		return PolicyUnlessStopped
	default:
		return PolicyNo
	}
}

// How long to wait before each attempt. A container that dies instantly should
// not be restarted in a loop as fast as the watcher can notice.
var backoff = []time.Duration{
	time.Second,
	2 * time.Second,
	5 * time.Second,
	15 * time.Second,
	30 * time.Second,
}

// After this many tries in a row, the container is left alone: something is
// wrong that restarting will not fix, and a machine that spends all night
// booting the same broken container helps nobody.
const giveUpAfter = 8

// supervisor starts containers that were meant to stay up.
//
// Apple's CLI has no restart policy of its own, so this is one: it watches the
// same snapshots everything else does, and acts on the ones that stopped
// without being asked to.
type supervisor struct {
	mu       sync.Mutex
	attempts map[string]int
	nextTry  map[string]time.Time

	stopped *stoppedSet
	start   func(ctx context.Context, id string) error
	logger  *slog.Logger
	now     func() time.Time
}

func newSupervisor(start func(context.Context, string) error, logger *slog.Logger) *supervisor {
	return &supervisor{
		attempts: map[string]int{},
		nextTry:  map[string]time.Time{},
		stopped:  loadStopped(logger),
		start:    start,
		logger:   logger,
		now:      time.Now,
	}
}

// Check acts on one snapshot: it is called wherever the watcher reports, so a
// container that dies is noticed as quickly as the list itself changes.
func (s *supervisor) Check(ctx context.Context, list []containers.Container) {
	for _, container := range list {
		if container.Status == "running" {
			s.settled(container.ID)
			continue
		}

		if !s.shouldStart(container) {
			continue
		}

		s.logger.Info("Restarting a container that was meant to stay up",
			"container", container.Name, "policy", PolicyOf(container))

		if err := s.start(ctx, container.ID); err != nil {
			s.logger.Warn("Could not restart the container",
				"container", container.Name, "error", err)
		}
	}
}

// shouldStart decides, and records the attempt if the answer is yes.
func (s *supervisor) shouldStart(c containers.Container) bool {
	policy := PolicyOf(c)
	if policy == PolicyNo {
		return false
	}

	// "Unless stopped" means exactly that: a container the user put to bed
	// stays in bed, across a reboot and across the agent restarting.
	if policy == PolicyUnlessStopped && s.stopped.has(c.ID) {
		return false
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	tries := s.attempts[c.ID]
	if tries >= giveUpAfter {
		return false
	}

	if next, ok := s.nextTry[c.ID]; ok && s.now().Before(next) {
		return false
	}

	wait := backoff[min(tries, len(backoff)-1)]
	s.attempts[c.ID] = tries + 1
	s.nextTry[c.ID] = s.now().Add(wait)

	return true
}

// settled forgets the attempts for a container that is running again, so the
// next time it dies it gets the full patience again rather than the tail of an
// old streak.
func (s *supervisor) settled(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.attempts, id)
	delete(s.nextTry, id)
}

// Stopped records that the user put this container down on purpose, which is
// the difference between "unless-stopped" and "always".
func (s *supervisor) Stopped(id string) { s.stopped.add(id) }

// Started records the opposite: asked to run again, it is no longer stopped.
func (s *supervisor) Started(id string) {
	s.stopped.remove(id)
	s.settled(id)
}

// stoppedSet remembers deliberate stops across restarts of the agent. It is a
// list of ids and nothing else, so it stays a file rather than becoming a
// database.
type stoppedSet struct {
	mu     sync.Mutex
	ids    map[string]bool
	path   string
	logger *slog.Logger
}

func stoppedPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}

	return filepath.Join(home, ".dermaga", "stopped.json")
}

func loadStopped(logger *slog.Logger) *stoppedSet {
	set := &stoppedSet{ids: map[string]bool{}, path: stoppedPath(), logger: logger}

	raw, err := os.ReadFile(set.path)
	if err != nil {
		return set
	}

	var ids []string
	if err := json.Unmarshal(raw, &ids); err != nil {
		return set
	}

	for _, id := range ids {
		set.ids[id] = true
	}

	return set
}

func (s *stoppedSet) has(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.ids[id]
}

func (s *stoppedSet) add(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.ids[id] {
		return
	}

	s.ids[id] = true
	s.save()
}

func (s *stoppedSet) remove(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if !s.ids[id] {
		return
	}

	delete(s.ids, id)
	s.save()
}

// save writes the list. Called with the lock held.
func (s *stoppedSet) save() {
	if s.path == "" {
		return
	}

	ids := make([]string, 0, len(s.ids))
	for id := range s.ids {
		ids = append(ids, id)
	}

	encoded, err := json.Marshal(ids)
	if err != nil {
		return
	}

	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		s.logger.Debug("Could not keep the stopped list", "error", err)
		return
	}

	if err := os.WriteFile(s.path, encoded, 0o600); err != nil {
		s.logger.Debug("Could not keep the stopped list", "error", err)
	}
}
