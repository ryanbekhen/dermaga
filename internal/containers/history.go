package containers

import (
	"time"
)

// A live number says almost nothing on its own. Memory climbing and never
// falling is a leak; CPU pinned at the allocation is a container being starved.
// Both are shapes, and a shape needs a history to be seen at all.
const (
	// How long a container's history reaches back.
	historyWindow = 30 * time.Minute
	// Points kept per container -- the window divided by the sampling interval,
	// with room to spare so a slow tick cannot silently shorten it.
	historyPoints = int(historyWindow/statsInterval) + 8
)

// Point is one moment in a container's life.
type Point struct {
	// Unix milliseconds, which is what the chart needs and what JSON carries
	// without argument.
	At          int64   `json:"at"`
	CPUPercent  float64 `json:"cpuPercent"`
	MemoryBytes int64   `json:"memoryBytes"`
}

// record appends to the ring, dropping whatever has fallen out of the window.
func (s *StatsSampler) record(id string, at time.Time, cpu float64, memory int64) {
	points := append(s.history[id], Point{
		At:          at.UnixMilli(),
		CPUPercent:  cpu,
		MemoryBytes: memory,
	})

	if len(points) > historyPoints {
		points = points[len(points)-historyPoints:]
	}

	s.history[id] = points
}

// History returns what is known about one container, oldest first. Empty for a
// container that has only just started: one sample cannot make a line.
func (s *StatsSampler) History(id string) []Point {
	s.mu.RLock()
	defer s.mu.RUnlock()

	points := s.history[id]
	out := make([]Point, len(points))
	copy(out, points)

	return out
}

// forget drops the history of containers that no longer exist, so a long-lived
// agent does not accumulate the dead.
func (s *StatsSampler) forget(live map[string]struct{}) {
	for id := range s.history {
		if _, ok := live[id]; !ok {
			delete(s.history, id)
		}
	}
}
