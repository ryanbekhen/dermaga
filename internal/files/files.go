// Package files browses and moves files inside a container.
//
// Apple's CLI has no API for reading a container's filesystem, so listing is
// `ls` run inside the container and parsed. That is as portable as it sounds:
// `ls -lAp` prints the same shape under busybox and coreutils alike, which
// covers Alpine and Debian between them, and the trailing slash it puts on
// directories is more reliable than reading the mode bits back out of a string.
//
// An image built FROM scratch has no ls at all. That is reported as what it is
// rather than as an empty directory.
package files

import (
	"context"
	"fmt"
	"log/slog"
	"path"
	"strconv"
	"strings"

	"github.com/ryanbekhen/dermaga/internal/cli"
)

// Entry is one thing in a directory.
type Entry struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	Mode     string `json:"mode"`
	Owner    string `json:"owner,omitempty"`
	Modified string `json:"modified,omitempty"`
	IsDir    bool   `json:"isDir"`
	// A symlink is followed by the user, not by us: where it points may not
	// exist, and guessing is worse than showing what is written.
	IsLink bool   `json:"isLink"`
	Target string `json:"target,omitempty"`
}

type Manager struct {
	runner *cli.Runner
	logger *slog.Logger
}

func NewManager(runner *cli.Runner, logger *slog.Logger) *Manager {
	return &Manager{runner: runner, logger: logger}
}

// ErrNoShell is what a scratch image gives back: nothing to run ls with.
var ErrNoShell = fmt.Errorf("this image has no shell, so its files cannot be listed")

func (m *Manager) List(ctx context.Context, container, dir string) ([]Entry, error) {
	if dir == "" {
		dir = "/"
	}

	out, err := m.runner.Run(ctx, "exec", container, "ls", "-lAp", dir)
	if err != nil {
		if strings.Contains(err.Error(), "failed to find target executable") {
			return nil, ErrNoShell
		}

		return nil, err
	}

	return parse(string(out), dir), nil
}

// parse reads `ls -lAp` output. The name is everything after the eighth field,
// so spaces in names survive; a symlink's " -> target" is split off after that.
func parse(output, dir string) []Entry {
	entries := make([]Entry, 0, 16)

	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimRight(line, "\r")
		if line == "" || strings.HasPrefix(line, "total ") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 9 {
			continue
		}

		// Rejoin the name: busybox and coreutils pad differently, so the only
		// safe anchor is the field count before it.
		name := strings.Join(fields[8:], " ")
		if idx := strings.Index(line, fields[8]); idx > 0 {
			name = strings.TrimSpace(line[idx:])
		}

		entry := Entry{
			Mode:     fields[0],
			Owner:    fields[2],
			Modified: strings.Join(fields[5:8], " "),
		}

		if size, err := strconv.ParseInt(fields[4], 10, 64); err == nil {
			entry.Size = size
		}

		if before, after, found := strings.Cut(name, " -> "); found {
			entry.IsLink = true
			entry.Target = after
			name = before
		}

		// `-p` marks directories with a trailing slash, which is the one part
		// of ls output that means the same thing everywhere.
		if trimmed, ok := strings.CutSuffix(name, "/"); ok {
			entry.IsDir = true
			name = trimmed
		}

		entry.Name = name
		entry.Path = path.Join(dir, name)

		entries = append(entries, entry)
	}

	return entries
}

// CopyIn puts a file or directory from the host inside the container.
func (m *Manager) CopyIn(ctx context.Context, container, hostPath, containerPath string) error {
	target := fmt.Sprintf("%s:%s", container, containerPath)

	if _, err := m.runner.Run(ctx, "copy", hostPath, target); err != nil {
		m.logger.Error("Copy into container failed", "container", container, "error", err)
		return err
	}

	return nil
}

// CopyOut takes a file or directory out of the container.
func (m *Manager) CopyOut(ctx context.Context, container, containerPath, hostPath string) error {
	source := fmt.Sprintf("%s:%s", container, containerPath)

	if _, err := m.runner.Run(ctx, "copy", source, hostPath); err != nil {
		m.logger.Error("Copy out of container failed", "container", container, "error", err)
		return err
	}

	return nil
}
