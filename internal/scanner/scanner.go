// Package scanner reports known vulnerabilities in images, using Trivy.
//
// Everything here happens in the background. Installing the scanner, fetching
// the ~100 MB vulnerability database, refreshing it when it goes stale and
// scanning an image are all slow enough that doing any of them in front of the
// user would mean a frozen window; instead the work runs on its own goroutine
// and reports where it has got to, which the status bar shows in a line.
//
// Trivy is driven as a command rather than linked in as a library: it is a Go
// program, but embedding it would pull a dependency tree far larger than the
// rest of this app put together and inflate every release by hundreds of
// megabytes.
package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/ryanbekhen/dermaga/internal/cli"
)

// Formula is Trivy's Homebrew name.
const Formula = "trivy"

const (
	// How long to wait after the image list changes. A pull registers the image
	// as soon as its manifest lands, while unpacking the layers can take a
	// minute; scanning in between finds an image that is not all there.
	settleDelay = 30 * time.Second

	// How long to wait before double-checking a result that found nothing.
	emptyRetryDelay = 45 * time.Second
)

// What the background worker is doing, so the UI can say so in one line.
const (
	StateIdle       = "idle"
	StateInstalling = "installing"
	StateUpdatingDB = "updatingDatabase"
	StateScanning   = "scanning"
	StateUpdating   = "updating"
	StateFailed     = "failed"
)

// Status is the whole of what the UI needs to draw the scanner's line in the
// status bar.
type Status struct {
	Installed     bool   `json:"installed"`
	Version       string `json:"version,omitempty"`
	BrewAvailable bool   `json:"brewAvailable"`

	// Set when Homebrew has a newer Trivy than the one installed.
	UpdateAvailable bool   `json:"updateAvailable"`
	LatestVersion   string `json:"latestVersion,omitempty"`

	State  string `json:"state"`
	Detail string `json:"detail,omitempty"`
	// The image being scanned, kept after the scan so the window knows which
	// report just became available.
	Target string `json:"target,omitempty"`
	// Where this scan sits in a sweep of several, so the status bar can say
	// "3 of 12" rather than leaving the user wondering how long it goes on.
	Position int `json:"position,omitempty"`
	Total    int `json:"total,omitempty"`
	// 0 when the work has no measurable progress.
	Percent int    `json:"percent,omitempty"`
	Error   string `json:"error,omitempty"`

	// When the database was last written, and when Trivy wants it refreshed.
	DatabaseUpdatedAt string `json:"databaseUpdatedAt,omitempty"`
	// The Trivy that produced it. A newer scanner can find things in the same
	// image that the previous one walked straight past -- new detectors, new
	// package ecosystems, fixed parsing bugs.
	ScannerVersion string `json:"scannerVersion,omitempty"`
	DatabaseNextAt string `json:"databaseNextAt,omitempty"`
	DatabaseReady  bool   `json:"databaseReady"`
}

// Finding is one vulnerability in one package.
type Finding struct {
	ID        string `json:"id"`
	Package   string `json:"package"`
	Installed string `json:"installed,omitempty"`
	// Empty when upstream has not fixed it yet, which is worth showing.
	Fixed    string `json:"fixed,omitempty"`
	Severity string `json:"severity"`
	Title    string `json:"title,omitempty"`
	URL      string `json:"url,omitempty"`
}

// Report is one scan of one image.
type Report struct {
	Reference string `json:"reference"`
	// The database this result was produced against. When Trivy publishes a
	// new one the result is out of date by definition -- the whole point of a
	// vulnerability database is that yesterday's answer is not today's.
	DatabaseUpdatedAt string `json:"databaseUpdatedAt,omitempty"`
	// The Trivy that produced it. A newer scanner can find things in the same
	// image that the previous one walked straight past -- new detectors, new
	// package ecosystems, fixed parsing bugs.
	ScannerVersion string `json:"scannerVersion,omitempty"`
	// The image the result belongs to. A tag that has since moved to a new
	// digest means the stored report describes something else.
	Digest    string `json:"digest,omitempty"`
	ScannedAt string `json:"scannedAt"`
	OS        string `json:"os,omitempty"`
	// How many things Trivy managed to analyse -- an OS package list, a
	// language lockfile. Zero means it read nothing at all, which is what a
	// half-unpacked image looks like; it is not the same as finding nothing.
	Targets  int            `json:"targets"`
	Summary  map[string]int `json:"summary"`
	Findings []Finding      `json:"findings"`
}

type Manager struct {
	runner *cli.Runner
	logger *slog.Logger

	// push reports a change in status to whoever is listening -- in practice
	// the RPC server, which forwards it to the window.
	push func(Status)
	// A finished report, pushed as soon as it exists. A sweep never returns to
	// idle between images, so anything waiting for that would only ever see the
	// last one.
	pushReport func(Report)

	mu      sync.RWMutex
	status  Status
	reports map[string]Report
	// References already given a second chance, so an image that really is
	// empty is not scanned twice for ever.
	retried map[string]bool

	queue chan string
	// A single slot: many changes in a row collapse into one sweep.
	sweep  chan struct{}
	source func(context.Context) ([]ImageRef, error)
	once   sync.Once
}

// ImageRef is the little the scanner needs to know about an image, so this
// package does not depend on the one that lists them.
type ImageRef struct {
	Reference string
	Digest    string
	// What the image actually holds, as "linux/arm64" and friends. An image
	// built for another architecture cannot be exported here at all, and so
	// cannot be scanned here -- which is worth knowing before trying rather
	// than after failing.
	Platforms []string
}

// The architecture these Macs run, and the only one an image has to carry to
// be scannable on one.
const platform = "linux/arm64"

// scannable reports whether there is anything here to scan.
//
// An image with no arm64 in it is not a failure to report, it is a fact about
// the image: `container image save --platform linux/arm64` answers "no content
// for platform", every time, for as long as the image exists. Treated as an
// error it parks a warning in the status bar that no amount of retrying will
// clear, which is exactly what it did.
//
// An image that lists nothing is scanned rather than skipped: an empty list
// means the runtime did not say, not that the image is empty.
func (r ImageRef) scannable() bool {
	if len(r.Platforms) == 0 {
		return true
	}

	for _, p := range r.Platforms {
		if p == platform || strings.HasPrefix(p, platform+"/") {
			return true
		}
	}

	return false
}

func NewManager(runner *cli.Runner, logger *slog.Logger) *Manager {
	return &Manager{
		runner:  runner,
		logger:  logger,
		reports: make(map[string]Report),
		retried: make(map[string]bool),
		// A short queue is enough: scans are requested by hand, and a full
		// queue means the user is clicking faster than Trivy can work.
		queue: make(chan string, 16),
		sweep: make(chan struct{}, 1),
	}
}

// SetSource tells the scanner where to find the images worth scanning.
func (m *Manager) SetSource(source func(context.Context) ([]ImageRef, error)) {
	m.source = source
}

// Sweep asks for a pass over the image list, scanning whatever has no result
// yet. Never blocks: a sweep already pending absorbs this one.
func (m *Manager) Sweep() {
	select {
	case m.sweep <- struct{}{}:
	default:
	}
}

// OnChange registers the listener that receives every status change.
func (m *Manager) OnChange(push func(Status)) { m.push = push }

// OnReport registers the listener for finished scans.
func (m *Manager) OnReport(push func(Report)) { m.pushReport = push }

func (m *Manager) announceReport(report Report) {
	if m.pushReport != nil {
		m.pushReport(report)
	}
}

func (m *Manager) Status() Status {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.status
}

// Report returns the last scan of an image, if there is one.
func (m *Manager) Report(reference string) (Report, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	report, ok := m.reports[reference]

	return report, ok
}

// Scan queues an image. It returns immediately: the result arrives as a status
// change followed by a report the UI can fetch.
func (m *Manager) Scan(reference string) error {
	// Asked for by hand rather than found by the sweep, and the sweep is the
	// only place that used to check. Pressing Scan on an image built for
	// another architecture therefore went all the way to a failed export and
	// left a warning behind, every time, for something that can never work.
	if !m.canScan(reference) {
		return fmt.Errorf(
			"%s has no %s build in it, so there is nothing here to scan", reference, platform)
	}

	select {
	case m.queue <- reference:
		return nil
	default:
		return fmt.Errorf("too many scans are already queued")
	}
}

// Start brings the scanner up and keeps it current, without ever blocking the
// caller. Installing Trivy and downloading the database happen here, on first
// run, while the user gets on with something else.
// canScan answers from the image list what the image itself will not say until
// the export has already failed.
//
// Anything it cannot establish -- no source, a list that will not answer, a
// reference that is not in it -- is allowed through. Refusing a scan because
// the question could not be asked would be worse than attempting one that
// turns out to be impossible.
func (m *Manager) canScan(reference string) bool {
	if m.source == nil {
		return true
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	refs, err := m.source(ctx)
	if err != nil {
		return true
	}

	for _, ref := range refs {
		if ref.Reference == reference {
			return ref.scannable()
		}
	}

	return true
}

func (m *Manager) Start(ctx context.Context) {
	m.once.Do(func() {
		// Read the cheap facts before returning: the window asks for status as
		// soon as it opens, and a goroutine that has not run yet would answer
		// "no scanner installed" for a scanner that is installed.
		m.refreshStatus(ctx)
		m.load()

		go m.run(ctx)
	})
}

func (m *Manager) run(ctx context.Context) {
	m.ensureReady(ctx)
	m.runSweep(ctx)

	// The schedule, in full:
	//
	//   at startup      install or update Trivy, refresh the database if it is
	//                   stale, then scan whatever has no current result
	//   on any change   scan images that have just appeared
	//   every 6 hours   the same as startup
	//
	// Trivy stamps its database with a NextUpdate 24 hours out, so a six-hourly
	// check picks up a new one within hours of it landing while costing nothing
	// when there is none -- it reads a local file. When the database does turn
	// over, every stored result is against the old one and is scanned again, so
	// the counts on screen always reflect the database in hand.
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()

	// nil until a change asks for a sweep; a select on a nil channel simply
	// never fires, which is exactly the wanted behaviour when none is pending.
	var settle <-chan time.Time

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.ensureReady(ctx)
			m.runSweep(ctx)
		case <-m.sweep:
			// A pull publishes the image before its layers have finished
			// unpacking, and scanning it then finds an image that is not all
			// there yet -- which reads as "no vulnerabilities". So the sweep
			// waits for the dust to settle first.
			//
			// The countdown starts on the first change and is never pushed
			// back by later ones. Restarting it looked tidier, but the watcher
			// reports something changed every couple of seconds -- container
			// stats alone see to that -- so the deadline never arrived and no
			// image was ever scanned automatically.
			if settle == nil {
				settle = time.After(settleDelay)
			}

		case <-settle:
			settle = nil
			m.runSweep(ctx)
		case reference := <-m.queue:
			m.scan(ctx, reference)
		}
	}
}

// ensureReady installs what is missing and refreshes what is stale.
func (m *Manager) ensureReady(ctx context.Context) {
	status := m.Status()

	if !status.Installed {
		if !status.BrewAvailable {
			return // Nothing can be done without Homebrew; stay quiet about it.
		}
		if err := m.install(ctx); err != nil {
			m.fail("Could not install the vulnerability scanner", err)
			return
		}
	}

	// Trivy finds nothing it does not know about, so an old scanner is a quiet
	// way to be told everything is fine. Upgrade it before scanning with it.
	if outdated, latest := m.outdated(ctx); outdated {
		m.mu.Lock()
		m.status.UpdateAvailable = true
		m.status.LatestVersion = latest
		m.mu.Unlock()

		if err := m.upgrade(ctx, latest); err != nil {
			// Not fatal: the installed version still scans, just with older
			// detectors, so this is reported and then carried on from.
			m.logger.Warn("Could not update the scanner", "error", err)
		}
	}

	if m.databaseStale() {
		if err := m.updateDatabase(ctx); err != nil {
			m.fail("Could not update the vulnerability database", err)
			return
		}
	}

	m.setState(StateIdle, "", 0)
}

func (m *Manager) install(ctx context.Context) error {
	m.setState(StateInstalling, "Installing the vulnerability scanner…", 0)

	cmd := m.runner.Tool(ctx, "brew", "install", Formula)
	if _, err := cmd.CombinedOutput(); err != nil {
		return err
	}

	m.refreshStatus(ctx)

	return nil
}

func (m *Manager) upgrade(ctx context.Context, latest string) error {
	m.setState(StateUpdating, "Updating the vulnerability scanner"+versionSuffix(latest), 0)

	if _, err := m.runner.Tool(ctx, "brew", "upgrade", Formula).CombinedOutput(); err != nil {
		return err
	}

	m.refreshStatus(ctx)

	return nil
}

func versionSuffix(version string) string {
	if version == "" {
		return "…"
	}

	return " to " + version + "…"
}

// percentPattern reads "10.19%" out of Trivy's progress bar, which is drawn for
// a terminal and has no machine-readable form.
var percentPattern = regexp.MustCompile(`(\d+(?:\.\d+)?)%`)

func (m *Manager) updateDatabase(ctx context.Context) error {
	m.setState(StateUpdatingDB, "Downloading the vulnerability database…", 0)

	cmd := m.runner.Tool(ctx, Formula, "image", "--download-db-only")

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	if err := cmd.Start(); err != nil {
		return err
	}

	// The bar redraws with carriage returns rather than newlines, so read runes
	// and split on both.
	go m.followProgress(stderr)

	if err := cmd.Wait(); err != nil {
		return err
	}

	m.refreshStatus(ctx)

	return nil
}

func (m *Manager) scan(ctx context.Context, reference string) {
	digest := m.digestOf(ctx, reference)

	m.mu.Lock()
	m.status.Target = reference
	m.mu.Unlock()

	m.setState(StateScanning, fmt.Sprintf("Scanning %s…", reference), 0)

	report, err := m.runScan(ctx, reference)
	if err != nil {
		m.fail(fmt.Sprintf("Could not scan %s", reference), err)
		return
	}

	report.Digest = digest
	report.DatabaseUpdatedAt = m.Status().DatabaseUpdatedAt
	report.ScannerVersion = m.Status().Version

	m.mu.Lock()
	m.reports[reference] = report
	m.mu.Unlock()

	m.save()
	m.announceReport(report)
	m.setState(StateIdle, "", 0)
}

// runScan exports the image and hands it to Trivy.
//
// Trivy reads an OCI *directory*, while `container image save` writes an OCI
// *tar*, so the archive is unpacked in between. The platform has to be pinned:
// the local store holds only the architecture that was pulled, and asking for
// the whole multi-arch index fails on the blobs it does not have.
func (m *Manager) runScan(ctx context.Context, reference string) (Report, error) {
	work, err := os.MkdirTemp("", "dermaga-scan-")
	if err != nil {
		return Report{}, err
	}
	defer os.RemoveAll(work)

	archive := filepath.Join(work, "image.tar")
	layout := filepath.Join(work, "oci")

	if _, err := m.runner.Run(ctx,
		"image", "save", reference, "--platform", "linux/arm64", "--output", archive,
	); err != nil {
		return Report{}, fmt.Errorf("could not export the image: %w", err)
	}

	if err := os.MkdirAll(layout, 0o755); err != nil {
		return Report{}, err
	}

	if err := exec.CommandContext(ctx, "tar", "-xf", archive, "-C", layout).Run(); err != nil {
		return Report{}, fmt.Errorf("could not unpack the image: %w", err)
	}

	// --skip-db-update because keeping the database current is this package's
	// job, done on its own schedule rather than in the middle of a scan.
	out, err := m.runner.Tool(ctx, Formula,
		"image", "--input", layout,
		"--format", "json",
		"--scanners", "vuln",
		"--skip-db-update",
		"--quiet",
	).Output()
	if err != nil {
		return Report{}, err
	}

	return parseReport(reference, out)
}

func parseReport(reference string, out []byte) (Report, error) {
	var raw struct {
		Metadata struct {
			OS struct {
				Family string `json:"Family"`
				Name   string `json:"Name"`
			} `json:"OS"`
		} `json:"Metadata"`
		Results []struct {
			Vulnerabilities []struct {
				VulnerabilityID  string `json:"VulnerabilityID"`
				PkgName          string `json:"PkgName"`
				InstalledVersion string `json:"InstalledVersion"`
				FixedVersion     string `json:"FixedVersion"`
				Severity         string `json:"Severity"`
				Title            string `json:"Title"`
				PrimaryURL       string `json:"PrimaryURL"`
			} `json:"Vulnerabilities"`
		} `json:"Results"`
	}

	if err := json.Unmarshal(out, &raw); err != nil {
		return Report{}, fmt.Errorf("could not read the scan result: %w", err)
	}

	report := Report{
		Reference: reference,
		ScannedAt: time.Now().UTC().Format(time.RFC3339),
		Summary:   map[string]int{},
		Findings:  []Finding{},
	}

	if family := raw.Metadata.OS.Family; family != "" {
		report.OS = strings.TrimSpace(family + " " + raw.Metadata.OS.Name)
	}

	report.Targets = len(raw.Results)

	for _, result := range raw.Results {
		for _, v := range result.Vulnerabilities {
			report.Summary[v.Severity]++
			report.Findings = append(report.Findings, Finding{
				ID:        v.VulnerabilityID,
				Package:   v.PkgName,
				Installed: v.InstalledVersion,
				Fixed:     v.FixedVersion,
				Severity:  v.Severity,
				Title:     v.Title,
				URL:       v.PrimaryURL,
			})
		}
	}

	return report, nil
}
