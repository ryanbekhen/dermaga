// Package toolchain looks after the `container` CLI itself: whether it is
// installed, whether it is new enough for Dermaga, whether a newer release is
// available, and installing or upgrading it without leaving the app.
//
// Only the Homebrew formula is managed. A CLI installed from Apple's .pkg is
// reported as such and left alone, because upgrading that means an installer
// asking for an admin password -- not something to run behind the user's back.
package toolchain

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ryanbekhen/dermaga/internal/cli"
	"github.com/ryanbekhen/dermaga/internal/notify"
)

// Formula is the Homebrew name of Apple's CLI.
const Formula = "container"

// MinimumVersion is the oldest CLI Dermaga expects to be talking to.
//
// Apple's 0.x releases were pre-release in the way that word actually means:
// subcommands appeared and were renamed between them, and nothing here was
// ever written against one. 1.0.0 is where the CLI's language settled, so it
// is where Dermaga's claim to work starts. This is a claim about what has been
// tried, not a guess -- raise it when something here needs a newer CLI, and
// say so in the same breath.
const MinimumVersion = "1.0.0"

// CheckInterval is how often the update check runs on its own.
//
// Homebrew refreshes its own index a few times a day at most, so asking more
// often only spends someone's battery to be told the same thing. The check is
// also run once at startup, which is what actually catches an update: the app
// is opened far more often than it is left running for six hours.
const CheckInterval = 6 * time.Hour

// How it got onto the machine, which decides what Dermaga may do about it.
const (
	ManagedByHomebrew = "homebrew"
	ManagedManually   = "manual"
)

type Status struct {
	Installed bool   `json:"installed"`
	Version   string `json:"version,omitempty"`
	// "homebrew", "manual", or empty when not installed.
	ManagedBy       string `json:"managedBy,omitempty"`
	BrewAvailable   bool   `json:"brewAvailable"`
	UpdateAvailable bool   `json:"updateAvailable"`
	LatestVersion   string `json:"latestVersion,omitempty"`
	// What Dermaga is written against, and whether the CLI on this machine is
	// older than that. Worked out from the version string alone, so it is
	// answered for a manually installed CLI too -- Dermaga cannot upgrade that
	// one, but it can still say why something is not working.
	MinimumVersion string `json:"minimumVersion"`
	BelowMinimum   bool   `json:"belowMinimum"`
	// Set when the update check could not run, so the UI can stay quiet about
	// updates rather than claiming everything is current.
	CheckError string `json:"checkError,omitempty"`
}

type Manager struct {
	runner   *cli.Runner
	logger   *slog.Logger
	notifier notify.Notifier

	// The last status worked out, so the watcher can put it in every snapshot
	// without any of them costing a call to Homebrew.
	mu     sync.RWMutex
	latest Status
	known  bool
}

func NewManager(runner *cli.Runner, logger *slog.Logger, notifier notify.Notifier) *Manager {
	if notifier == nil {
		notifier = notify.Nop
	}

	return &Manager{runner: runner, logger: logger, notifier: notifier}
}

// versionPattern pulls "1.2.2" out of
// "container CLI version 1.2.2 (build: release, commit: unspecified)".
var versionPattern = regexp.MustCompile(`version\s+(\S+)`)

// Watch keeps the cached status current until the context is cancelled.
//
// Nothing asks for this: it is checked here and pushed with the rest of the
// snapshot, so a new CLI shows up in the sidebar whether or not anybody
// happens to open the System page. That was the old shape of it, and it meant
// an update sat unnoticed for as long as nobody went looking.
func (m *Manager) Watch(ctx context.Context) {
	ticker := time.NewTicker(CheckInterval)
	defer ticker.Stop()

	m.check(ctx)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.check(ctx)
		}
	}
}

// Latest is the cached status, and whether there is one yet. A read, not a
// call -- the watcher includes it in every pass.
func (m *Manager) Latest() *Status {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if !m.known {
		return nil
	}

	status := m.latest

	return &status
}

// Refresh checks now rather than waiting for the next tick, and returns what
// it found. This is what the System page asks for: opening it, or finishing an
// upgrade on it, are both moments when the cached answer is the stale one.
func (m *Manager) Refresh(ctx context.Context) Status {
	return m.check(ctx)
}

// check refreshes the cache and announces the change, if it is one.
func (m *Manager) check(ctx context.Context) Status {
	status := m.Status(ctx)

	m.mu.Lock()
	changed := !m.known || m.latest != status
	m.latest = status
	m.known = true
	m.mu.Unlock()

	if changed {
		m.notifier.Changed()
	}

	return status
}

func (m *Manager) Status(ctx context.Context) Status {
	status := Status{
		Installed:      m.runner.Available(),
		BrewAvailable:  m.runner.Has("brew"),
		MinimumVersion: MinimumVersion,
	}

	if status.Installed {
		status.Version = m.version(ctx)
		status.ManagedBy = ManagedManually
		status.BelowMinimum = Older(status.Version, MinimumVersion)
	}

	if !status.BrewAvailable {
		return status
	}

	// Homebrew knows the formula only if it installed it.
	if status.Installed && m.installedByBrew(ctx) {
		status.ManagedBy = ManagedByHomebrew
	}

	if status.ManagedBy == ManagedByHomebrew {
		outdated, latest, err := m.outdated(ctx)
		if err != nil {
			status.CheckError = err.Error()
		} else {
			status.UpdateAvailable = outdated
			status.LatestVersion = latest
		}
	}

	if !status.Installed {
		status.LatestVersion = m.stableVersion(ctx)
	}

	return status
}

func (m *Manager) version(ctx context.Context) string {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	output, err := m.runner.Run(ctx, "--version")
	if err != nil {
		return ""
	}

	if match := versionPattern.FindSubmatch(output); len(match) == 2 {
		return string(match[1])
	}

	return strings.TrimSpace(string(output))
}

func (m *Manager) installedByBrew(ctx context.Context) bool {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	output, err := m.runner.RunTool(ctx, "brew", "list", "--formula", "--versions", Formula)

	return err == nil && strings.Contains(string(output), Formula)
}

// outdated asks Homebrew what it already knows. It deliberately does not run
// `brew update` first: that is slow, touches the user's Homebrew state, and
// Homebrew refreshes its index on its own schedule.
//
// The exit status is not read, which is the one place in this codebase that is
// true. `brew outdated` exits 1 precisely when something *is* outdated, and
// prints the JSON anyway -- so treating a non-zero status as failure inverted
// the whole feature: "up to date" whenever it was, "could not check" the
// moment there was anything to say. The JSON parsing below is the test of
// whether the command worked, because it is the thing that was actually asked
// for.
func (m *Manager) outdated(ctx context.Context) (bool, string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := m.runner.Tool(ctx, "brew", "outdated", "--json=v2", Formula)

	var stderr strings.Builder
	cmd.Stderr = &stderr

	output, runErr := cmd.Output()

	var report struct {
		Formulae []struct {
			Name           string `json:"name"`
			CurrentVersion string `json:"current_version"`
		} `json:"formulae"`
	}
	if err := json.Unmarshal(output, &report); err != nil {
		// No usable answer, so now the exit status is worth reporting -- along
		// with whatever Homebrew said on the way out.
		if runErr != nil {
			if message := strings.TrimSpace(stderr.String()); message != "" {
				return false, "", fmt.Errorf("brew outdated: %s", message)
			}

			return false, "", fmt.Errorf("brew outdated: %v", runErr)
		}

		return false, "", err
	}

	for _, formula := range report.Formulae {
		if formula.Name == Formula {
			return true, formula.CurrentVersion, nil
		}
	}

	return false, "", nil
}

func (m *Manager) stableVersion(ctx context.Context) string {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	output, err := m.runner.RunTool(ctx, "brew", "info", "--json=v2", Formula)
	if err != nil {
		return ""
	}

	var report struct {
		Formulae []struct {
			Versions struct {
				Stable string `json:"stable"`
			} `json:"versions"`
		} `json:"formulae"`
	}
	if err := json.Unmarshal(output, &report); err != nil || len(report.Formulae) == 0 {
		return ""
	}

	return report.Formulae[0].Versions.Stable
}

// InstallCommand and UpgradeCommand are streamed: a formula install can take
// minutes and prints its own progress.
func (m *Manager) InstallCommand(ctx context.Context) *exec.Cmd {
	return m.runner.Tool(ctx, "brew", "install", Formula)
}

func (m *Manager) UpgradeCommand(ctx context.Context) *exec.Cmd {
	return m.runner.Tool(ctx, "brew", "upgrade", Formula)
}

// Older reports whether version is behind floor.
//
// Both sides come from somewhere that adds its own decoration: Apple prints
// "1.2.2" but Homebrew calls the same thing "1.2.2_1", where the suffix is a
// rebuild of the formula rather than a release of the CLI. Everything from the
// first character that is not a digit or a dot is dropped, and what is left is
// compared a number at a time.
//
// An unreadable version is never called old. Nothing good comes of telling
// somebody their CLI is unsupported because its version string had a shape
// this did not expect.
func Older(version, floor string) bool {
	left, ok := parseVersion(version)
	if !ok {
		return false
	}

	right, ok := parseVersion(floor)
	if !ok {
		return false
	}

	for i := 0; i < len(left) || i < len(right); i++ {
		a, b := at(left, i), at(right, i)
		if a != b {
			return a < b
		}
	}

	return false
}

func parseVersion(version string) ([]int, bool) {
	version = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(version), "v"))

	cut := strings.IndexFunc(version, func(r rune) bool {
		return (r < '0' || r > '9') && r != '.'
	})
	if cut >= 0 {
		version = version[:cut]
	}

	if version == "" {
		return nil, false
	}

	parts := strings.Split(version, ".")
	numbers := make([]int, 0, len(parts))

	for _, part := range parts {
		number, err := strconv.Atoi(part)
		if err != nil {
			return nil, false
		}

		numbers = append(numbers, number)
	}

	return numbers, true
}

func at(numbers []int, i int) int {
	if i < len(numbers) {
		return numbers[i]
	}

	return 0
}
