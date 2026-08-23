// Package cli runs Apple's `container` command. It is the only package that
// reaches for os/exec, so everything else can be tested against plain data.
package cli

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
)

// Binary is the command every call goes through.
const Binary = "container"

type Runner struct{}

func New() *Runner {
	return &Runner{}
}

// Available reports whether the CLI is installed at all.
func (r *Runner) Available() bool {
	return r.Has(Binary)
}

// Command builds a command without running it, for callers that need to stream
// its output or attach it to a pty.
func (r *Runner) Command(ctx context.Context, args ...string) *exec.Cmd {
	return r.Tool(ctx, Binary, args...)
}

// Tool builds a command for a binary other than `container` -- Homebrew, when
// installing or updating the runtime itself.
func (r *Runner) Tool(ctx context.Context, binary string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, binary, args...)
}

// Has reports whether a binary is on PATH.
func (r *Runner) Has(binary string) bool {
	_, err := exec.LookPath(binary)
	return err == nil
}

// Run executes a subcommand and returns stdout. Stderr is folded into the error
// so the CLI's own diagnostics reach the user instead of "exit status 1".
func (r *Runner) Run(ctx context.Context, args ...string) ([]byte, error) {
	return r.RunTool(ctx, Binary, args...)
}

// IsNotFound reports whether the CLI refused because the thing it was asked
// about is not there.
//
// The runtime says so in its own vocabulary, wrapped a couple of layers deep:
//
//	internalError: "failed to delete container"
//	  (cause: "notFound: "container with ID x not found"")
//
// which reaches here as text, since the CLI exits 1 for everything and has no
// distinguishable status to read instead.
//
// It matches the `notFound:` token rather than the words "not found" on their
// own. A missing binary fails with "executable file not found in $PATH", and
// reading that as "already gone" would turn an uninstalled CLI into a silent
// success on every delete.
func IsNotFound(err error) bool {
	if err == nil {
		return false
	}

	return strings.Contains(strings.ToLower(err.Error()), "notfound:")
}

// RunTool is Run for a binary other than `container`.
func (r *Runner) RunTool(ctx context.Context, binary string, args ...string) ([]byte, error) {
	cmd := r.Tool(ctx, binary, args...)

	var stderr strings.Builder
	cmd.Stderr = &stderr

	stdout, err := cmd.Output()
	if err != nil {
		if message := strings.TrimSpace(stderr.String()); message != "" {
			return nil, fmt.Errorf("%s %s: %s", binary, strings.Join(args, " "), message)
		}
		return nil, fmt.Errorf("%s %s: %w", binary, strings.Join(args, " "), err)
	}

	return stdout, nil
}

// Mebibytes reads the size syntax the `container` CLI accepts -- a number with
// an optional K, M, G or T -- and answers in mebibytes. Zero when it cannot
// tell, which every caller treats as "no opinion" rather than as "nothing".
//
// Here rather than in one of the domains because two of them need it and it is
// a fact about the CLI's language, which is what this package is for: a
// container is refused under 200 MiB and a machine under a gibibyte, and both
// would rather say so before the image is pulled than after.
func Mebibytes(value string) int64 {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	if trimmed == "" {
		return 0
	}

	digits, multiplier := trimmed, int64(1)

	switch trimmed[len(trimmed)-1] {
	case 'k':
		// Kilobytes round down to zero unless there are a lot of them.
		digits, multiplier = trimmed[:len(trimmed)-1], 0
	case 'm':
		digits = trimmed[:len(trimmed)-1]
	case 'g':
		digits, multiplier = trimmed[:len(trimmed)-1], 1024
	case 't':
		digits, multiplier = trimmed[:len(trimmed)-1], 1024*1024
	}

	amount, err := strconv.ParseInt(strings.TrimSpace(digits), 10, 64)
	if err != nil {
		return 0
	}

	if multiplier == 0 {
		return amount / 1024
	}

	return amount * multiplier
}
