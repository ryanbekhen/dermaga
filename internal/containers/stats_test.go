package containers

import (
	"testing"
	"time"
)

// Everything except memory arrives as a counter that only climbs. Read as-is
// they answer "how much since it started", which is not what a live reading is
// for -- so the sampler turns each pair of readings into a rate, and that
// arithmetic is the part worth pinning down.
func TestFirstSampleHasNoRates(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	first := measure(now, cliStats{
		ID:             "web",
		CPUUsageUsec:   500_000,
		NetworkRxBytes: 1_000_000,
	}, sample{}, false)

	// One reading of a counter cannot be a rate. Dividing by the time since the
	// container started would report an average of its whole life as "now".
	if first.cpuPercent != 0 || first.networkRxPerSec != 0 {
		t.Errorf("first sample invented a rate: cpu %v, rx %v", first.cpuPercent, first.networkRxPerSec)
	}

	// The counters themselves are still carried: the totals are shown as well.
	if first.networkRxBytes != 1_000_000 {
		t.Errorf("counter not kept: %d", first.networkRxBytes)
	}
}

func TestRatesComeFromTheIntervalBetweenSamples(t *testing.T) {
	start := time.Unix(1_700_000_000, 0)
	previous := measure(start, cliStats{ID: "web"}, sample{}, false)

	// Five seconds later, a megabyte in and half a core spent.
	next := measure(start.Add(5*time.Second), cliStats{
		ID:              "web",
		CPUUsageUsec:    2_500_000,
		NetworkRxBytes:  5 * 1024 * 1024,
		NetworkTxBytes:  5 * 1000,
		BlockReadBytes:  10 * 1024,
		BlockWriteBytes: 0,
		Processes:       9,
	}, previous, true)

	if want := 1024.0 * 1024; next.networkRxPerSec != want {
		t.Errorf("rx rate is %v B/s, want %v", next.networkRxPerSec, want)
	}
	if next.networkTxPerSec != 1000 {
		t.Errorf("tx rate is %v B/s, want 1000", next.networkTxPerSec)
	}
	if want := 2048.0; next.blockReadPerSec != want {
		t.Errorf("read rate is %v B/s, want %v", next.blockReadPerSec, want)
	}
	// A counter that did not move is a real zero, not a missing reading.
	if next.blockWritePerSec != 0 {
		t.Errorf("write rate is %v B/s, want 0", next.blockWritePerSec)
	}
	if next.cpuPercent != 50 {
		t.Errorf("cpu is %v%%, want 50", next.cpuPercent)
	}
	if next.processes != 9 {
		t.Errorf("processes is %d, want 9", next.processes)
	}
}

// A restarted container begins its counters again at zero. The difference
// against the old ones is negative, and treating that as traffic would draw a
// spike that never happened -- or, unsigned, an enormous one.
func TestRestartDoesNotDrawTrafficThatNeverHappened(t *testing.T) {
	start := time.Unix(1_700_000_000, 0)
	before := measure(start, cliStats{ID: "web", NetworkRxBytes: 900_000_000, CPUUsageUsec: 9_000_000}, sample{}, false)
	before.cpuPercent = 42

	after := measure(start.Add(5*time.Second), cliStats{ID: "web", NetworkRxBytes: 1_024, CPUUsageUsec: 10}, before, true)

	if after.networkRxPerSec != 0 {
		t.Errorf("rate across a restart is %v B/s, want 0", after.networkRxPerSec)
	}

	// CPU is the exception, and deliberately: a share of a core describes the
	// process running now, so the last known figure beats a false zero.
	if after.cpuPercent != 42 {
		t.Errorf("cpu across a restart is %v, want the last known 42", after.cpuPercent)
	}
}

// Two samples taken within the same instant -- a tick that fired twice, a clock
// that did not move -- have no interval to divide by.
func TestNoElapsedTimeMeansNoRate(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	before := measure(now, cliStats{ID: "web", NetworkRxBytes: 100}, sample{}, false)
	same := measure(now, cliStats{ID: "web", NetworkRxBytes: 500}, before, true)

	if same.networkRxPerSec != 0 {
		t.Errorf("rate without an interval is %v, want 0", same.networkRxPerSec)
	}
}

// A recorded point and a live one have to mean the same thing. The runtime
// reports CPU as a share of one core; the app reports it as a share of the
// container's own allowance, and a chart drawn from both would step where they
// met if the ring kept the other number.
func TestRecordedCPUIsTheSameFigureTheAppShows(t *testing.T) {
	s := NewStatsSampler(nil, nil)
	now := time.Unix(1_700_000_000, 0)

	// Two cores, and half of both busy: 100% of one core is 50% of the
	// allowance.
	s.Apply([]Container{{ID: "web", CPUAllocation: 2}})
	s.record("web", sample{taken: now, cpuPercent: 100})

	points := s.History("web")
	if len(points) != 1 || points[0].CPUPercent != 50 {
		t.Fatalf("recorded %v, want 50%% of the allowance", points)
	}
}

// Nothing tells the sampler about a container it has never seen listed, and
// one core is the runtime's own default.
func TestAnUnknownAllowanceIsOneCore(t *testing.T) {
	s := NewStatsSampler(nil, nil)
	s.record("web", sample{taken: time.Unix(1_700_000_000, 0), cpuPercent: 42})

	if points := s.History("web"); points[0].CPUPercent != 42 {
		t.Errorf("recorded %v, want it left alone", points[0].CPUPercent)
	}
}

// A container that goes away takes its window with it, or the next container
// to use the name inherits somebody else's chart.
func TestForgetDropsWhatBelongedToTheDeparted(t *testing.T) {
	s := NewStatsSampler(nil, nil)
	now := time.Unix(1_700_000_000, 0)

	s.record("web", sample{taken: now})
	s.record("db", sample{taken: now})
	s.forget(map[string]struct{}{"web": {}})

	if len(s.History("db")) != 0 {
		t.Error("the window of a removed container survived")
	}
	if len(s.History("web")) != 1 {
		t.Error("the window of a live container was dropped")
	}
}

// The ring is a window, not a log: an agent left running for a day must not be
// holding a day of points.
func TestTheWindowStopsGrowing(t *testing.T) {
	s := NewStatsSampler(nil, nil)
	start := time.Unix(1_700_000_000, 0)

	for i := range historyPoints + 40 {
		s.record("web", sample{
			taken:            start.Add(time.Duration(i) * statsInterval),
			memoryUsageBytes: int64(i),
		})
	}

	points := s.History("web")
	if len(points) != historyPoints {
		t.Fatalf("kept %d points, want %d", len(points), historyPoints)
	}
	// And it is the newest that survive, not the first ever taken.
	if points[len(points)-1].MemoryBytes != int64(historyPoints+39) {
		t.Errorf("newest point is %d", points[len(points)-1].MemoryBytes)
	}
	if points[0].MemoryBytes != 40 {
		t.Errorf("oldest point is %d, want 40", points[0].MemoryBytes)
	}
}
