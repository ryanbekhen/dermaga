package system

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
	"time"

	"github.com/ryanbekhen/dermaga/internal/cli"
	"github.com/ryanbekhen/dermaga/internal/notify"
)

// SystemStatus describes the `container` services themselves. Without them
// running, nothing else in the app can work, so the UI surfaces this first.
type Status struct {
	Status           string `json:"status"`
	Running          bool   `json:"running"`
	APIServerVersion string `json:"apiServerVersion,omitempty"`
	CLIVersion       string `json:"cliVersion,omitempty"`
	APIServerBuild   string `json:"apiServerBuild,omitempty"`
	AppRoot          string `json:"appRoot,omitempty"`
	InstallRoot      string `json:"installRoot,omitempty"`
	LogRoot          string `json:"logRoot,omitempty"`
}

type cliStatus struct {
	Status           string `json:"status"`
	APIServerVersion string `json:"apiServerVersion"`
	APIServerBuild   string `json:"apiServerBuild"`
	APIServerAppName string `json:"apiServerAppName"`
	AppRoot          string `json:"appRoot"`
	InstallRoot      string `json:"installRoot"`
	LogRoot          string `json:"logRoot"`
}

// DiskUsage is `container system df`: what each resource type costs on disk and
// how much of it could be reclaimed.
type DiskUsage struct {
	Containers UsageEntry `json:"containers"`
	Images     UsageEntry `json:"images"`
	Volumes    UsageEntry `json:"volumes"`
}

type UsageEntry struct {
	Total            int   `json:"total"`
	Active           int   `json:"active"`
	SizeInBytes      int64 `json:"sizeInBytes"`
	ReclaimableBytes int64 `json:"reclaimable"`
}

type Manager struct {
	runner  *cli.Runner
	logger  *slog.Logger
	changed notify.Notifier
}

func NewManager(runner *cli.Runner, logger *slog.Logger, changed notify.Notifier) *Manager {
	return &Manager{runner: runner, logger: logger, changed: changed}
}

// cliVersionPattern pulls "1.2.2" out of
// "container CLI version 1.2.2 (build: release, commit: unspecified)".
var cliVersionPattern = regexp.MustCompile(`version\s+(\S+)`)

// CLIVersion reports the installed `container` CLI version, empty if it is not
// on PATH. The status bar shows it so a version mismatch is visible at a glance.
func (sm *Manager) CLIVersion(ctx context.Context) string {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	output, err := sm.runner.Run(ctx, "--version")
	if err != nil {
		return ""
	}

	if match := cliVersionPattern.FindSubmatch(output); len(match) == 2 {
		return string(match[1])
	}

	return strings.TrimSpace(string(output))
}

func (sm *Manager) Status(ctx context.Context) (*Status, error) {
	cliVersion := sm.CLIVersion(ctx)

	output, err := sm.runner.Run(ctx, "system", "status", "--format", "json")
	if err != nil {
		// A stopped apiserver makes the command fail rather than report
		// "stopped", which is itself the answer the UI needs.
		return &Status{Status: "stopped", Running: false, CLIVersion: cliVersion}, nil
	}

	var raw cliStatus
	if err := json.Unmarshal(output, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse system status: %w", err)
	}

	status := strings.ToLower(raw.Status)

	return &Status{
		Status:           status,
		Running:          status == "running",
		APIServerVersion: raw.APIServerVersion,
		CLIVersion:       cliVersion,
		APIServerBuild:   raw.APIServerBuild,
		AppRoot:          raw.AppRoot,
		InstallRoot:      raw.InstallRoot,
		LogRoot:          raw.LogRoot,
	}, nil
}

// Start brings the services up.
//
// `container system start` prompts before installing a default kernel, and a
// prompt would hang a request forever, so the answer is given up front. A
// generous timeout covers the kernel download that follows on a fresh install.
func (sm *Manager) Start(ctx context.Context, installKernel bool) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	if _, err := sm.runner.Run(ctx, startArgs(installKernel)...); err != nil {
		sm.logger.Error("Failed to start system services", "error", err)
		return err
	}

	sm.changed.Changed()

	return nil
}

// InstallKernelCommand downloads and installs the recommended Linux kernel,
// which is what a fresh install is missing. It runs the same thing the CLI
// tells the user to run by hand, and it is streamed because the download is
// large enough that silence would look like a hang.
func (sm *Manager) InstallKernelCommand(ctx context.Context) *exec.Cmd {
	return sm.runner.Command(ctx, "system", "kernel", "set", "--recommended")
}

func (sm *Manager) Stop(ctx context.Context) error {
	if _, err := sm.runner.Run(ctx, "system", "stop"); err != nil {
		sm.logger.Error("Failed to stop system services", "error", err)
		return err
	}

	sm.changed.Changed()

	return nil
}

func (sm *Manager) DiskUsage(ctx context.Context) (*DiskUsage, error) {
	output, err := sm.runner.Run(ctx, "system", "df", "--format", "json")
	if err != nil {
		return nil, err
	}

	var usage DiskUsage
	if err := json.Unmarshal(output, &usage); err != nil {
		return nil, fmt.Errorf("failed to parse disk usage: %w", err)
	}

	return &usage, nil
}

// StreamLogs follows the services' own logs, which is where to look when a
// container refuses to start for no visible reason.
func (sm *Manager) LogsCommand(ctx context.Context, last string, follow bool) *exec.Cmd {
	return sm.runner.Command(ctx, logsCommandArgs(last, follow)...)
}

// PruneResult reports what a prune actually achieved, so the UI can say how
// much was freed rather than claiming success and leaving the same numbers on
// screen.
type PruneResult struct {
	FreedBytes int64    `json:"freedBytes"`
	Failures   []string `json:"failures,omitempty"`
}

// Kind names what a prune is allowed to touch.
//
// One kind at a time, deliberately. These used to run together behind a single
// "reclaim" button, which put two very different things under one press:
// images can be pulled again, and a volume holds the only copy of whatever was
// written to it. Worse, they compounded -- pruning stopped containers freed
// their volumes, which the volume prune in the next line then deleted.
type Kind string

const (
	KindImages     Kind = "images"
	KindVolumes    Kind = "volumes"
	KindContainers Kind = "containers"
)

func (k Kind) args() ([]string, bool) {
	switch k {
	case KindImages:
		// Without --all this removes only dangling images, while `system df`
		// counts every image no container uses as reclaimable -- so the button
		// would promise gigabytes and free nothing.
		return []string{"image", "prune", "--all"}, true
	case KindVolumes:
		return []string{"volume", "prune"}, true
	case KindContainers:
		return []string{"prune"}, true
	}

	return nil, false
}

// Prune reclaims the space one kind of resource is holding and reports how
// much that turned out to be.
func (sm *Manager) Prune(ctx context.Context, kind Kind) (PruneResult, error) {
	args, ok := kind.args()
	if !ok {
		return PruneResult{}, fmt.Errorf("nothing called %q can be pruned", kind)
	}

	before := sm.totalBytes(ctx)

	var failures []string
	if _, err := sm.runner.Run(ctx, args...); err != nil {
		sm.logger.Debug("Prune failed", "kind", kind, "error", err)
		failures = append(failures, strings.Join(args, " "))
	}

	sm.changed.Changed()

	freed := before - sm.totalBytes(ctx)
	if freed < 0 {
		freed = 0
	}

	return PruneResult{FreedBytes: freed, Failures: failures}, nil
}

// totalBytes is everything on disk across the resource types, or 0 if the
// figure cannot be read -- in which case the caller reports no space freed
// rather than an invented number.
func (sm *Manager) totalBytes(ctx context.Context) int64 {
	usage, err := sm.DiskUsage(ctx)
	if err != nil {
		return 0
	}

	return usage.Containers.SizeInBytes + usage.Images.SizeInBytes + usage.Volumes.SizeInBytes
}

// KernelConfigured reports whether a default kernel exists for this machine's
// architecture.
//
// It is answered from disk rather than from the CLI because the CLI has no
// "get" for this: the only way to learn there is no kernel is to run something
// that needs one and read the failure, which is far too late. Starting the
// services succeeds without a kernel, so nothing earlier in the bootstrap
// notices either.
func (sm *Manager) KernelConfigured() bool {
	home, err := os.UserHomeDir()
	if err != nil {
		return true // Cannot tell; assume it is there rather than nag.
	}

	dir := filepath.Join(home, "Library", "Application Support", "com.apple.container", "kernels")

	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}

	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "default.kernel-") {
			return true
		}
	}

	return false
}
