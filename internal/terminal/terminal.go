// Package terminal runs a shell on a pty and exposes it as a byte stream.
//
// Apple's CLI refuses to allocate a TTY unless its own stdin is a terminal, so
// a pty is not a nicety here -- without one, `exec -it` fails outright. It is
// also what gives the session a prompt, line editing and colours.
package terminal

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"

	"github.com/ryanbekhen/dermaga/internal/cli"
)

// DefaultShell prefers bash where the image has it. `if ...; then exec bash; fi`
// avoids the trap where a failed `exec` in a non-interactive shell kills the
// session before the fallback can run.
const DefaultShell = "if command -v bash >/dev/null 2>&1; then exec bash; fi; exec sh"

// Kind selects what the shell runs inside.
type Kind string

const (
	Container Kind = "container"
	Machine   Kind = "machine"
)

type Session struct {
	logger *slog.Logger
	cmd    *exec.Cmd
	pty    *os.File
	cancel context.CancelFunc
	once   sync.Once
}

// Open starts a shell and returns the live session. Output is delivered to
// onData until the process exits, at which point onClose fires once.
func Open(
	ctx context.Context,
	runner *cli.Runner,
	logger *slog.Logger,
	kind Kind,
	id string,
	command string,
	// user runs the shell as someone else -- "root", a name, or "uid:gid".
	// Empty means whoever the image declares, which is usually right.
	user string,
	onData func([]byte),
	onClose func(error),
) (*Session, error) {
	if command == "" {
		command = DefaultShell
	}

	ctx, cancel := context.WithCancel(ctx)

	var cmd *exec.Cmd
	switch kind {
	case Machine:
		// `machine run` joins its arguments and runs them through a shell
		// already, so the container fallback snippet would be parsed twice.
		// With no command it opens the machine's own interactive shell, and it
		// boots the VM first if it is down.
		cmd = runner.Command(ctx, machineShellArgs(id, command)...)

		// It opens wherever the caller was, which would be wherever the agent
		// was started from. Open in the user's home instead.
		if home, err := os.UserHomeDir(); err == nil {
			cmd.Dir = home
		}
	default:
		cmd = runner.Command(ctx, containerShellArgs(id, user, command)...)
	}

	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	ptmx, err := pty.Start(cmd)
	if err != nil {
		cancel()
		return nil, err
	}

	session := &Session{logger: logger, cmd: cmd, pty: ptmx, cancel: cancel}

	go func() {
		buffer := make([]byte, 32*1024)

		for {
			n, err := ptmx.Read(buffer)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buffer[:n])
				onData(chunk)
			}
			if err != nil {
				// EIO is how a pty reports that the child exited.
				if !errors.Is(err, io.EOF) {
					logger.Debug("Terminal ended", "kind", kind, "id", id, "error", err)
				}
				session.Close()
				onClose(nil)
				return
			}
		}
	}()

	logger.Info("Terminal opened", "kind", kind, "id", id)

	return session, nil
}

func (s *Session) Write(data []byte) error {
	_, err := s.pty.Write(data)
	return err
}

func (s *Session) Resize(cols, rows uint16) error {
	return pty.Setsize(s.pty, &pty.Winsize{Cols: cols, Rows: rows})
}

func (s *Session) Close() {
	s.once.Do(func() {
		s.cancel()
		_ = s.pty.Close()
		_ = s.cmd.Wait()
	})
}
