package containers

import "time"

// The window is kept whether or not anybody is looking at it.
//
// The sampler runs from the moment the agent does, so by the time somebody
// opens a container's usage the last few minutes already exist: the chart is
// drawn full and carries on, instead of starting empty and making them wait for
// it to fill. Reopening it a minute later picks up where it left off rather
// than beginning again.
//
// Rolling, not everything since launch. A day of samples is seventeen thousand
// points per container to answer a question about the last two minutes.
const (
	// How far back the ring reaches -- comfortably more than the window a chart
	// draws, so what is handed over always covers it.
	historyWindow = 5 * time.Minute
	// Points kept per container: the window over the sampling interval, with
	// room to spare so a slow tick cannot silently shorten it.
	historyPoints = int(historyWindow/statsInterval) + 8
)

// Point is one moment in a container's life.
//
// Rates rather than counters for the four that are counted: what a shape has to
// show is when the traffic happened, and a total only ever climbs.
type Point struct {
	// Unix milliseconds, which is what the chart needs and what JSON carries
	// without argument.
	At int64 `json:"at"`
	// A share of what the container was allocated, so a point drawn from here
	// means the same as one taken live. Anything else and a chart would step
	// when the two met.
	CPUPercent       float64 `json:"cpuPercent"`
	MemoryBytes      int64   `json:"memoryBytes"`
	NetworkRxPerSec  float64 `json:"networkRxPerSec"`
	NetworkTxPerSec  float64 `json:"networkTxPerSec"`
	BlockReadPerSec  float64 `json:"blockReadPerSec"`
	BlockWritePerSec float64 `json:"blockWritePerSec"`
}

// record appends to the ring, dropping whatever has fallen out of the window.
// Called with the lock held.
func (s *StatsSampler) record(id string, at sample) {
	points := append(s.history[id], Point{
		At:               at.taken.UnixMilli(),
		CPUPercent:       round2(clampPercent(at.cpuPercent / s.coresOf(id))),
		MemoryBytes:      at.memoryUsageBytes,
		NetworkRxPerSec:  at.networkRxPerSec,
		NetworkTxPerSec:  at.networkTxPerSec,
		BlockReadPerSec:  at.blockReadPerSec,
		BlockWritePerSec: at.blockWritePerSec,
	})

	if len(points) > historyPoints {
		points = points[len(points)-historyPoints:]
	}

	s.history[id] = points
}

// coresOf is what the container was allocated, as last seen on a listing.
//
// The runtime reports CPU as a share of one core; the app reports it as a share
// of the container's own allowance, which is the only figure that can be read
// against a limit. The sampler is not told about allowances, so it remembers
// the ones it has been shown -- and one core is the runtime's own default for
// anything it has not.
func (s *StatsSampler) coresOf(id string) float64 {
	if cores, ok := s.cores[id]; ok && cores > 1 {
		return cores
	}

	return 1
}

// History returns what is known about one container, oldest first.
func (s *StatsSampler) History(id string) []Point {
	s.mu.RLock()
	defer s.mu.RUnlock()

	points := s.history[id]
	out := make([]Point, len(points))
	copy(out, points)

	return out
}

// forget drops what belongs to containers that no longer exist, so a long-lived
// agent does not accumulate the dead. Called with the lock held.
func (s *StatsSampler) forget(live map[string]struct{}) {
	for id := range s.history {
		if _, ok := live[id]; !ok {
			delete(s.history, id)
			delete(s.cores, id)
		}
	}
}
