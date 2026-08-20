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
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

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

// Long enough for a large file on a slow disk, short enough that a copy which
// will never answer is reported instead of queueing every later command behind
// it.
const copyTimeout = 2 * time.Minute

// ErrNoShell is what a scratch image gives back: nothing to run ls with.
var ErrNoShell = fmt.Errorf("this image has no shell, so its files cannot be listed")

// HasShell reports whether there is a shell to browse or attach to.
//
// A container built FROM scratch has none, and neither the file browser nor
// the terminal can work without one -- so the UI is better off not offering
// them at all than offering them and failing.
func (m *Manager) HasShell(ctx context.Context, container string) bool {
	_, err := m.runner.Run(ctx, "exec", container, "/bin/sh", "-c", "exit 0")

	return err == nil
}

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
//
// Two ways in, because one of them quietly does nothing. `container copy` is
// the direct route and the right one nearly always -- but where the
// destination is a mounted volume it exits zero and writes nothing at all. So
// the destination is read back, and when the copy left no trace the contents
// are written from inside the container instead, which goes through the mount
// the way anything else running in there would.
func (m *Manager) CopyIn(ctx context.Context, container, hostPath, containerPath string) error {
	target := fmt.Sprintf("%s:%s", container, containerPath)

	if _, err := m.runner.Run(ctx, "copy", hostPath, target); err != nil {
		m.logger.Error("Copy into container failed", "container", container, "error", err)
		return err
	}

	landed := path.Join(containerPath, filepath.Base(hostPath))

	// Reading the destination back only proves anything when there was nothing
	// there to begin with: dropping a folder onto one that already exists finds
	// it either way, and the copy is called a success without having written a
	// byte. So a mount is recognised up front instead of inferred afterwards.
	if m.underMount(ctx, container, containerPath) {
		m.logger.Info("Destination is a mounted volume; writing from inside the container",
			"container", container, "path", landed)

		if err := m.streamIn(ctx, container, hostPath, landed); err != nil {
			m.logger.Error("Could not write into the container", "container", container, "error", err)

			return fmt.Errorf(
				"%s is a mounted volume, which `container copy` will not write into, and writing it from inside the container failed: %w",
				containerPath, err,
			)
		}

		return nil
	}

	arrived, err := m.exists(ctx, container, landed)
	if err != nil || arrived {
		// A container with nothing to answer with cannot be asked, and an
		// unanswered question is not a failure: the file browser is only
		// offered where there is a shell, so this is the rare one that got
		// through.
		return nil
	}

	m.logger.Info("Copy left nothing behind; writing from inside the container",
		"container", container, "path", landed)

	if err := m.streamIn(ctx, container, hostPath, landed); err != nil {
		m.logger.Error("Could not write into the container", "container", container, "error", err)

		return fmt.Errorf(
			"%s is a mounted volume, which `container copy` will not write into, and writing it from inside the container failed: %w",
			containerPath, err,
		)
	}

	if arrived, err := m.exists(ctx, container, landed); err == nil && !arrived {
		return fmt.Errorf("%s could not be written to %s", filepath.Base(hostPath), containerPath)
	}

	return nil
}

// underMount reports whether a path inside the container is at or below one of
// its mounts. `container copy` will not write into those: it exits zero and
// leaves nothing behind.
func (m *Manager) underMount(ctx context.Context, container, dir string) bool {
	out, err := m.runner.Run(ctx, "inspect", container)
	if err != nil {
		return false
	}

	var inspected []struct {
		Configuration struct {
			Mounts []struct {
				Destination string `json:"destination"`
			} `json:"mounts"`
		} `json:"configuration"`
	}

	if err := json.Unmarshal(out, &inspected); err != nil || len(inspected) == 0 {
		return false
	}

	clean := path.Clean(dir)

	for _, mount := range inspected[0].Configuration.Mounts {
		at := path.Clean(mount.Destination)
		if at == "/" || at == "." {
			continue
		}

		if clean == at || strings.HasPrefix(clean, at+"/") {
			return true
		}
	}

	return false
}

// exists reports whether a path is there inside the container. The error is
// reserved for not being able to ask at all.
func (m *Manager) exists(ctx context.Context, container, target string) (bool, error) {
	_, err := m.runner.Run(ctx, "exec", container, "test", "-e", target)
	if err == nil {
		return true, nil
	}

	if strings.Contains(err.Error(), "failed to find target executable") {
		return false, ErrNoShell
	}

	return false, nil
}

// streamIn writes the host path into the container over the standard input of
// a shell running inside it -- a file with `cat`, a directory with `tar`, both
// of which write through a mount rather than around it.
func (m *Manager) streamIn(ctx context.Context, container, hostPath, landed string) error {
	info, err := os.Stat(hostPath)
	if err != nil {
		return err
	}

	if info.IsDir() {
		return m.streamDirIn(ctx, container, hostPath, path.Dir(landed))
	}

	file, err := os.Open(hostPath)
	if err != nil {
		return err
	}
	defer file.Close()

	cmd := m.runner.Command(ctx, "exec", "-i", container, "sh", "-c", "cat > "+shellQuote(landed))
	cmd.Stdin = file

	var stderr strings.Builder
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if message := strings.TrimSpace(stderr.String()); message != "" {
			return errors.New(message)
		}

		return err
	}

	return nil
}

// streamDirIn does the same for a directory, with tar carrying the tree.
func (m *Manager) streamDirIn(ctx context.Context, container, hostPath, destination string) error {
	// Without this, macOS tar writes every file's extended attributes beside
	// it as an AppleDouble `._name` -- which is meaningless inside a Linux
	// container and looks like the copy went wrong. Both the flag and the
	// variable say the same thing; the flag is newer, the variable older.
	pack := exec.CommandContext(ctx, "tar", "--no-mac-metadata", "-cf", "-",
		"-C", filepath.Dir(hostPath), filepath.Base(hostPath))
	pack.Env = append(os.Environ(), "COPYFILE_DISABLE=1")

	unpack := m.runner.Command(ctx, "exec", "-i", container,
		"sh", "-c", "tar -xf - -C "+shellQuote(destination))

	pipe, err := pack.StdoutPipe()
	if err != nil {
		return err
	}
	unpack.Stdin = pipe

	var stderr strings.Builder
	unpack.Stderr = &stderr

	if err := pack.Start(); err != nil {
		return err
	}

	if err := unpack.Run(); err != nil {
		_ = pack.Wait()

		if message := strings.TrimSpace(stderr.String()); message != "" {
			return errors.New(message)
		}

		return err
	}

	return pack.Wait()
}

// shellQuote makes a path safe to hand to `sh -c`. Paths with spaces and
// quotes in them are ordinary, and a filename is not a place to trust.
func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

// CopyOut takes a file or directory out of the container.
//
// The same split as CopyIn, for the same reason. Where the source is inside a
// mounted volume, `container copy` does not fail -- it never returns at all,
// and every later command on that container queues up behind it until the
// container has to be killed. So a mount is read from inside instead, and even
// the ordinary path is given a limit rather than trusted to answer.
func (m *Manager) CopyOut(ctx context.Context, container, containerPath, hostPath string) error {
	if m.underMount(ctx, container, path.Dir(containerPath)) || m.underMount(ctx, container, containerPath) {
		m.logger.Info("Source is in a mounted volume; reading from inside the container",
			"container", container, "path", containerPath)

		return m.streamOut(ctx, container, containerPath, hostPath)
	}

	bounded, cancel := context.WithTimeout(ctx, copyTimeout)
	defer cancel()

	source := fmt.Sprintf("%s:%s", container, containerPath)

	_, err := m.runner.Run(bounded, "copy", source, hostPath)
	if errors.Is(bounded.Err(), context.DeadlineExceeded) {
		m.logger.Error("Copy out did not answer", "container", container, "path", containerPath)

		return fmt.Errorf("copying %s out did not answer within %s", containerPath, copyTimeout)
	}

	if err != nil {
		m.logger.Error("Copy out of container failed", "container", container, "error", err)
		return err
	}

	return nil
}

// streamOut reads a path out over the standard output of a command running
// inside the container -- a file with `cat`, a directory with `tar`.
func (m *Manager) streamOut(ctx context.Context, container, containerPath, hostPath string) error {
	isDir, err := m.isDir(ctx, container, containerPath)
	if err != nil {
		return err
	}

	if isDir {
		return m.streamDirOut(ctx, container, containerPath, hostPath)
	}

	file, err := os.Create(hostPath)
	if err != nil {
		return err
	}
	defer file.Close()

	cmd := m.runner.Command(ctx, "exec", container, "cat", containerPath)
	cmd.Stdout = file

	var stderr strings.Builder
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		os.Remove(hostPath)

		if message := strings.TrimSpace(stderr.String()); message != "" {
			return errors.New(message)
		}

		return err
	}

	return nil
}

// streamDirOut does the same for a directory, with tar carrying the tree.
//
// Unpacked into a directory of its own first, because the archive carries the
// name it had inside the container and the caller may have asked for another:
// untarring straight into the destination's parent would land it beside the
// requested path rather than at it.
func (m *Manager) streamDirOut(ctx context.Context, container, containerPath, hostPath string) error {
	staging, err := os.MkdirTemp(filepath.Dir(hostPath), ".dermaga-out-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(staging)

	pack := m.runner.Command(ctx, "exec", container,
		"tar", "-cf", "-", "-C", path.Dir(containerPath), path.Base(containerPath))

	unpack := exec.CommandContext(ctx, "tar", "-xf", "-", "-C", staging)

	pipe, err := pack.StdoutPipe()
	if err != nil {
		return err
	}
	unpack.Stdin = pipe

	var stderr strings.Builder
	pack.Stderr = &stderr

	if err := pack.Start(); err != nil {
		return err
	}

	if err := unpack.Run(); err != nil {
		_ = pack.Wait()

		if message := strings.TrimSpace(stderr.String()); message != "" {
			return errors.New(message)
		}

		return err
	}

	if err := pack.Wait(); err != nil {
		return err
	}

	// Into place under the name that was asked for.
	if err := os.RemoveAll(hostPath); err != nil {
		return err
	}

	return os.Rename(filepath.Join(staging, path.Base(containerPath)), hostPath)
}

// isDir asks the container what a path is.
func (m *Manager) isDir(ctx context.Context, container, target string) (bool, error) {
	_, err := m.runner.Run(ctx, "exec", container, "test", "-d", target)
	if err == nil {
		return true, nil
	}

	// Not a directory, or not there at all -- the copy that follows says which.
	return false, nil
}
