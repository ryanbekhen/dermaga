package containers

import (
	"testing"
	"time"
)

// The buffer is what the charts read; a wrap that dropped the wrong end would
// draw the past as the present.
func TestHistoryKeepsTheNewestPoints(t *testing.T) {
	s := &StatsSampler{history: map[string][]Point{}}
	start := time.Unix(1_700_000_000, 0)

	for i := range historyPoints + 20 {
		s.record("web", start.Add(time.Duration(i)*statsInterval), float64(i), int64(i))
	}

	points := s.History("web")
	if len(points) != historyPoints {
		t.Fatalf("kept %d points, want %d", len(points), historyPoints)
	}

	// The last sample recorded must be the last one drawn.
	last := points[len(points)-1]
	if last.CPUPercent != float64(historyPoints+19) {
		t.Errorf("newest point is %v, want %v", last.CPUPercent, historyPoints+19)
	}

	// And the oldest kept is exactly one window back, not the first ever taken.
	if points[0].CPUPercent != float64(20) {
		t.Errorf("oldest point is %v, want 20", points[0].CPUPercent)
	}
}

// A container that goes away must take its samples with it, or a new container
// reusing the name inherits someone else's graph.
func TestForgetDropsContainersThatAreGone(t *testing.T) {
	s := &StatsSampler{history: map[string][]Point{}}
	now := time.Unix(1_700_000_000, 0)

	s.record("web", now, 1, 1)
	s.record("db", now, 2, 2)

	s.forget(map[string]struct{}{"web": {}})

	if len(s.History("db")) != 0 {
		t.Error("history for a removed container survived")
	}
	if len(s.History("web")) != 1 {
		t.Error("history for a live container was dropped")
	}
}
