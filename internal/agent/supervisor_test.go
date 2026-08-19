package agent

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/ryanbekhen/dermaga/internal/containers"
)

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func withPolicy(id, state, policy string) containers.Container {
	labels := map[string]string{}
	if policy != "" {
		labels[RestartLabel] = policy
	}

	return containers.Container{ID: id, Name: id, Status: state, Labels: labels}
}

// A label is free text and may hold anything; only the two policies Dermaga can
// honour count. There is no on-failure, because the CLI reports no exit code
// and a policy that treats every exit as a failure would be a lie.
func TestPolicyOf(t *testing.T) {
	cases := map[string]Policy{
		"always":         PolicyAlways,
		"unless-stopped": PolicyUnlessStopped,
		"on-failure":     PolicyNo,
		"":               PolicyNo,
		"ALWAYS":         PolicyNo,
	}

	for label, want := range cases {
		if got := PolicyOf(withPolicy("c", "stopped", label)); got != want {
			t.Errorf("PolicyOf(%q) = %q, want %q", label, got, want)
		}
	}
}

func TestRestartsOnlyWhatItShould(t *testing.T) {
	started := []string{}
	s := newSupervisor(func(_ context.Context, id string) error {
		started = append(started, id)
		return nil
	}, quiet())
	s.stopped = &stoppedSet{ids: map[string]bool{}}

	s.Check(context.Background(), []containers.Container{
		withPolicy("always-down", "stopped", "always"),
		withPolicy("unless-down", "stopped", "unless-stopped"),
		withPolicy("no-policy", "stopped", ""),
		withPolicy("already-up", "running", "always"),
	})

	if len(started) != 2 {
		t.Fatalf("started %v, want the two with a policy", started)
	}
}

// "Unless stopped" has to mean it across a restart of the agent, which is why
// the deliberate stops are remembered at all.
func TestUnlessStoppedRespectsADeliberateStop(t *testing.T) {
	started := []string{}
	s := newSupervisor(func(_ context.Context, id string) error {
		started = append(started, id)
		return nil
	}, quiet())
	s.stopped = &stoppedSet{ids: map[string]bool{"put-to-bed": true}}

	s.Check(context.Background(), []containers.Container{
		withPolicy("put-to-bed", "stopped", "unless-stopped"),
		withPolicy("died", "stopped", "unless-stopped"),
	})

	if len(started) != 1 || started[0] != "died" {
		t.Fatalf("started %v, want only the one that was not stopped on purpose", started)
	}
}

// A container that dies the moment it starts must not be restarted as fast as
// the watcher can notice, and must eventually be left alone.
func TestBackoffAndGivingUp(t *testing.T) {
	started := 0
	s := newSupervisor(func(_ context.Context, _ string) error {
		started++
		return nil
	}, quiet())
	s.stopped = &stoppedSet{ids: map[string]bool{}}

	now := time.Now()
	s.now = func() time.Time { return now }

	broken := []containers.Container{withPolicy("broken", "stopped", "always")}

	// Same instant, twenty snapshots: one attempt, because the rest are inside
	// the first wait.
	for range 20 {
		s.Check(context.Background(), broken)
	}
	if started != 1 {
		t.Fatalf("started %d times on one snapshot burst, want 1", started)
	}

	// Time passes generously; the attempts run out and it is left alone.
	for range 50 {
		now = now.Add(time.Minute)
		s.Check(context.Background(), broken)
	}

	if started != giveUpAfter {
		t.Fatalf("started %d times, want to stop at %d", started, giveUpAfter)
	}

	// Once it comes up on its own, patience is restored.
	s.Check(context.Background(), []containers.Container{withPolicy("broken", "running", "always")})
	now = now.Add(time.Minute)
	s.Check(context.Background(), broken)

	if started != giveUpAfter+1 {
		t.Fatalf("a container seen running should get its patience back, started %d", started)
	}
}
