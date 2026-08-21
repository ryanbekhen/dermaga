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

// Everything one line of `container stats` carries. The CLI reports the same
// set for every container, and reading all of it costs nothing: the call is
// already being made.
type cliStats struct {
	ID               string `json:"id"`
	CPUUsageUsec     int64  `json:"cpuUsageUsec"`
	MemoryUsageBytes int64  `json:"memoryUsageBytes"`
	MemoryLimitBytes int64  `json:"memoryLimitBytes"`
	NetworkRxBytes   int64  `json:"networkRxBytes"`
	NetworkTxBytes   int64  `json:"networkTxBytes"`
	BlockReadBytes   int64  `json:"blockReadBytes"`
	BlockWriteBytes  int64  `json:"blockWriteBytes"`
	Processes        int    `json:"numProcesses"`
}

type sample struct {
	taken            time.Time
	cpuUsageUsec     int64
	memoryUsageBytes int64
	memoryLimitBytes int64
	// cpuPercent is usage as a share of a single core, derived from the
	// previous sample. Zero until two samples exist.
	cpuPercent float64

	// Bytes moved since the container started. Counters, not readings: on their
	// own they only ever climb, and a line that only climbs says nothing about
	// what is happening now.
	networkRxBytes  int64
	networkTxBytes  int64
	blockReadBytes  int64
	blockWriteBytes int64

	// The same four as bytes per second, which is the part worth watching.
	// Zero until two samples exist, like cpuPercent.
	networkRxPerSec  float64
	networkTxPerSec  float64
	blockReadPerSec  float64
	blockWritePerSec float64

	processes int
}

// perSecond turns two readings of a counter that only climbs into a rate.
//
// A counter that went backwards means the container was restarted and began
// again from zero. The honest answer for that interval is nothing: the traffic
// belonged to a container that no longer exists, and reporting the difference
// would draw a spike that never happened.
func perSecond(now, before int64, elapsed time.Duration) float64 {
	seconds := elapsed.Seconds()
	if seconds <= 0 || now < before {
		return 0
	}

	return round2(float64(now-before) / seconds)
}

// measure reads one line of stats against the sample before it. Everything
// derived from two readings lives here, so there is one place where a restart
// is dealt with rather than four.
func measure(now time.Time, r cliStats, previous sample, known bool) sample {
	cur := sample{
		taken:            now,
		cpuUsageUsec:     r.CPUUsageUsec,
		memoryUsageBytes: r.MemoryUsageBytes,
		memoryLimitBytes: r.MemoryLimitBytes,
		networkRxBytes:   r.NetworkRxBytes,
		networkTxBytes:   r.NetworkTxBytes,
		blockReadBytes:   r.BlockReadBytes,
		blockWriteBytes:  r.BlockWriteBytes,
		processes:        r.Processes,
	}

	if !known {
		return cur
	}

	elapsed := now.Sub(previous.taken)

	if micros := elapsed.Microseconds(); micros > 0 && r.CPUUsageUsec >= previous.cpuUsageUsec {
		cur.cpuPercent = float64(r.CPUUsageUsec-previous.cpuUsageUsec) / float64(micros) * 100
	} else {
		// Container restarted (counter reset) or clock went backwards. CPU keeps
		// the last figure rather than dropping to zero: unlike the byte
		// counters, a share of a core is a statement about the process that is
		// running now, and the last one is the closest thing to true.
		cur.cpuPercent = previous.cpuPercent
	}

	cur.networkRxPerSec = perSecond(r.NetworkRxBytes, previous.networkRxBytes, elapsed)
	cur.networkTxPerSec = perSecond(r.NetworkTxBytes, previous.networkTxBytes, elapsed)
	cur.blockReadPerSec = perSecond(r.BlockReadBytes, previous.blockReadBytes, elapsed)
	cur.blockWritePerSec = perSecond(r.BlockWriteBytes, previous.blockWriteBytes, elapsed)

	return cur
}

// StatsSampler polls `container stats` in the background and caches the last
// sample per container. CPU time is cumulative, so a percentage needs the
// delta between two samples.
type StatsSampler struct {
	runner *cli.Runner
	logger *slog.Logger

	mu      sync.RWMutex
	samples map[string]sample
	// Kept alongside the latest sample, from the moment the agent starts: a
	// chart that has to be filled before it says anything is a chart that makes
	// somebody wait for what was already known.
	history map[string][]Point
	// CPU allowances, learned from the listings that pass through Apply. See
	// coresOf.
	cores map[string]float64
}

func NewStatsSampler(runner *cli.Runner, logger *slog.Logger) *StatsSampler {
	return &StatsSampler{
		runner:  runner,
		logger:  logger,
		samples: map[string]sample{},
		history: map[string][]Point{},
		cores:   map[string]float64{},
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
		prev, known := s.samples[r.ID]
		cur := measure(now, r, prev, known)

		next[r.ID] = cur
		s.record(r.ID, cur)
	}

	live := make(map[string]struct{}, len(next))
	for id := range next {
		live[id] = struct{}{}
	}
	s.forget(live)

	s.samples = next
}

// Apply merges the latest sample into each running container in place.
//
// It also teaches the sampler what each container was allocated. Nothing else
// tells it: `container stats` reports usage and not allowances, and a recorded
// point has to mean the same as a live one.
func (s *StatsSampler) Apply(containers []Container) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range containers {
		if cores := containers[i].CPUAllocation; cores > 0 {
			s.cores[containers[i].ID] = float64(cores)
		}
	}

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
			// The exact figure as well as the rounded one: the meter reads
			// "135m", and a chart drawn from that steps in whole mebibytes.
			containers[i].MemoryUsageBytes = smp.memoryUsageBytes
		}
		if smp.memoryLimitBytes > 0 {
			pct := float64(smp.memoryUsageBytes) / float64(smp.memoryLimitBytes) * 100
			containers[i].MemoryUsagePercent = round2(clampPercent(pct))
		}

		// Both halves of each pair: the rate answers "what is it doing?" and the
		// total answers "what has it done?" -- a container quiet now that has
		// pulled a gigabyte is a different container from one that has pulled
		// nothing.
		containers[i].NetworkRxBytes = smp.networkRxBytes
		containers[i].NetworkTxBytes = smp.networkTxBytes
		containers[i].NetworkRxPerSec = smp.networkRxPerSec
		containers[i].NetworkTxPerSec = smp.networkTxPerSec
		containers[i].BlockReadBytes = smp.blockReadBytes
		containers[i].BlockWriteBytes = smp.blockWriteBytes
		containers[i].BlockReadPerSec = smp.blockReadPerSec
		containers[i].BlockWritePerSec = smp.blockWritePerSec
		containers[i].Processes = smp.processes
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
