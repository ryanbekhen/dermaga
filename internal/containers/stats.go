package containers

import (
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"sync"

	"github.com/ryanbekhen/dermaga/internal/cli"
	"time"
)

// statsInterval is how often the sampler shells out. `container stats
// --no-stream` takes ~2s to return, so it must not sit in the request path.
const statsInterval = 5 * time.Second

type cliStats struct {
	ID               string `json:"id"`
	CPUUsageUsec     int64  `json:"cpuUsageUsec"`
	MemoryUsageBytes int64  `json:"memoryUsageBytes"`
	MemoryLimitBytes int64  `json:"memoryLimitBytes"`
}

type sample struct {
	taken            time.Time
	cpuUsageUsec     int64
	memoryUsageBytes int64
	memoryLimitBytes int64
	// cpuPercent is usage as a share of a single core, derived from the
	// previous sample. Zero until two samples exist.
	cpuPercent float64
}

// StatsSampler polls `container stats` in the background and caches the last
// sample per container. CPU time is cumulative, so a percentage needs the
// delta between two samples.
type StatsSampler struct {
	runner *cli.Runner
	logger *slog.Logger

	mu      sync.RWMutex
	samples map[string]sample
	// Kept alongside the latest sample: the shape over time is what diagnoses
	// anything, and the sampler is the only place it passes through.
	history map[string][]Point
}

func NewStatsSampler(runner *cli.Runner, logger *slog.Logger) *StatsSampler {
	return &StatsSampler{
		runner:  runner,
		logger:  logger,
		samples: map[string]sample{},
		history: map[string][]Point{},
	}
}

// Run polls until the context is cancelled.
func (s *StatsSampler) Run(ctx context.Context) {
	s.collect(ctx)

	ticker := time.NewTicker(statsInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.collect(ctx)
		}
	}
}

func (s *StatsSampler) collect(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, statsInterval*2)
	defer cancel()

	output, err := s.runner.Run(ctx, "stats", "--format", "json", "--no-stream")
	if err != nil {
		// Stats are best-effort: a missing daemon or an empty host should not
		// produce error spam on every tick.
		s.logger.Debug("Stats collection failed", "error", err)
		return
	}

	var raw []cliStats
	if err := json.Unmarshal(output, &raw); err != nil {
		s.logger.Debug("Stats parse failed", "error", err)
		return
	}

	now := time.Now()

	s.mu.Lock()
	defer s.mu.Unlock()

	next := make(map[string]sample, len(raw))
	for _, r := range raw {
		cur := sample{
			taken:            now,
			cpuUsageUsec:     r.CPUUsageUsec,
			memoryUsageBytes: r.MemoryUsageBytes,
			memoryLimitBytes: r.MemoryLimitBytes,
		}

		if prev, ok := s.samples[r.ID]; ok {
			elapsed := now.Sub(prev.taken).Microseconds()
			delta := r.CPUUsageUsec - prev.cpuUsageUsec
			if elapsed > 0 && delta >= 0 {
				cur.cpuPercent = float64(delta) / float64(elapsed) * 100
			} else {
				// Container restarted (counter reset) or clock went backwards.
				cur.cpuPercent = prev.cpuPercent
			}
		}

		next[r.ID] = cur
		s.record(r.ID, now, cur.cpuPercent, cur.memoryUsageBytes)
	}

	live := make(map[string]struct{}, len(next))
	for id := range next {
		live[id] = struct{}{}
	}
	s.forget(live)

	s.samples = next
}

// Apply merges the latest sample into each running container in place.
func (s *StatsSampler) Apply(containers []Container) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if len(s.samples) == 0 {
		return
	}

	for i := range containers {
		smp, ok := s.samples[containers[i].ID]
		if !ok {
			continue
		}

		// Report CPU as a share of what the container was allocated, so the
		// UI meter tops out at its own ceiling rather than at host capacity.
		cpu := smp.cpuPercent
		if cores := containers[i].CPUAllocation; cores > 1 {
			cpu /= float64(cores)
		}
		containers[i].CPUUsage = round2(clampPercent(cpu))

		if smp.memoryUsageBytes > 0 {
			containers[i].MemoryUsage = formatMebibytes(smp.memoryUsageBytes)
		}
		if smp.memoryLimitBytes > 0 {
			pct := float64(smp.memoryUsageBytes) / float64(smp.memoryLimitBytes) * 100
			containers[i].MemoryUsagePercent = round2(clampPercent(pct))
		}
	}
}

func clampPercent(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}
