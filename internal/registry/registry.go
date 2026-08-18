// Package registry manages the registries images are pulled from and pushed
// to: which ones are logged in to, and logging in and out of them.
//
// Credentials are never held here. `container registry login` takes the
// password on stdin and stores it itself, so Dermaga hands it over and forgets
// it; asking it for a password to keep would be asking for a responsibility it
// has no business accepting.
package registry

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os/exec"
	"regexp"
	"strings"
	"time"

	"github.com/ryanbekhen/dermaga/internal/cli"
)

// Login is one registry the user is signed in to.
type Login struct {
	Server   string `json:"server"`
	Username string `json:"username,omitempty"`
	Created  string `json:"created,omitempty"`
	Modified string `json:"modified,omitempty"`
}

type Manager struct {
	runner *cli.Runner
	logger *slog.Logger
}

func NewManager(runner *cli.Runner, logger *slog.Logger) *Manager {
	return &Manager{runner: runner, logger: logger}
}

func (m *Manager) List(ctx context.Context) ([]Login, error) {
	out, err := m.runner.Run(ctx, "registry", "list", "--format", "json")
	if err != nil {
		return nil, err
	}

	// Field names taken from the CLI's own output rather than guessed: the
	// address is `name`, and the timestamps are `creationDate` and
	// `modificationDate`.
	var raw []struct {
		ID       string `json:"id"`
		Name     string `json:"name"`
		Username string `json:"username"`
		Created  string `json:"creationDate"`
		Modified string `json:"modificationDate"`
	}

	if err := json.Unmarshal(out, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse registry logins: %w", err)
	}

	logins := make([]Login, 0, len(raw))
	for _, entry := range raw {
		server := entry.Name
		if server == "" {
			server = entry.ID
		}

		logins = append(logins, Login{
			Server:   server,
			Username: entry.Username,
			Created:  entry.Created,
			Modified: entry.Modified,
		})
	}

	return logins, nil
}

// localAddress matches a registry running on this machine.
var localAddress = regexp.MustCompile(`^(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(:\d+)?$`)

func timeoutFor(server string) time.Duration {
	if localAddress.MatchString(strings.TrimSpace(server)) {
		return 8 * time.Second
	}

	return 25 * time.Second
}

// Login signs in to a registry.
//
// The password goes over stdin rather than as an argument: anything on a
// command line is visible to every other process on the machine through `ps`.
func (m *Manager) Login(ctx context.Context, server, username, password, scheme string) error {
	// Told to speak HTTPS to a registry that only speaks HTTP, the CLI waits
	// for a handshake that never comes -- for minutes, silently. A bounded wait
	// turns that into an error the user can act on.
	//
	// A registry on this machine either answers at once or is not there, so it
	// gets a fraction of the patience a registry across the internet deserves.
	ctx, cancel := context.WithTimeout(ctx, timeoutFor(server))
	defer cancel()

	args := []string{"registry", "login", "--username", username, "--password-stdin"}
	if scheme != "" {
		args = append(args, "--scheme", scheme)
	}
	args = append(args, server)

	cmd := m.runner.Command(ctx, args...)
	cmd.Stdin = strings.NewReader(password)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = err.Error()
		}

		if ctx.Err() != nil {
			detail = fmt.Sprintf(
				"%s did not answer within %s. If it runs on this machine without TLS, tick Plain HTTP.",
				server, timeoutFor(server),
			)
		}

		m.logger.Error("Registry login failed", "server", server)

		return fmt.Errorf("%s", detail)
	}

	return nil
}

func (m *Manager) Logout(ctx context.Context, server string) error {
	if _, err := m.runner.Run(ctx, "registry", "logout", server); err != nil {
		m.logger.Error("Registry logout failed", "server", server, "error", err)
		return err
	}

	return nil
}

// TagCommand gives an existing image another reference, which is how an image
// built locally is named for the registry it is going to.
func (m *Manager) Tag(ctx context.Context, source, target string) error {
	if _, err := m.runner.Run(ctx, "image", "tag", source, target); err != nil {
		return err
	}

	return nil
}

// PushCommand uploads an image. Streamed, because it is a slow job with
// progress worth watching.
func (m *Manager) PushCommand(ctx context.Context, reference, scheme string) *exec.Cmd {
	args := []string{"image", "push", "--progress", "plain"}
	if scheme != "" {
		args = append(args, "--scheme", scheme)
	}
	args = append(args, reference)

	return m.runner.Command(ctx, args...)
}
