package tunnels

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// The Cloudflare API token lives in the login keychain rather than in
// ~/.dermaga. It is the one thing Dermaga holds that can change somebody's DNS,
// the keychain encrypts it at rest, and it can be found and revoked in Keychain
// Access without going looking for a file.
const (
	keychainService = "dermaga-cloudflare"
	keychainAccount = "api-token"
)

// secrets is where the token is kept. An interface with one implementation,
// so a test never touches the real keychain -- and so what these tests assert
// does not depend on what is in the developer's.
type secrets interface {
	write(ctx context.Context, token string) error
	read(ctx context.Context) (string, bool)
	forget(ctx context.Context) error
}

// keychain reads and writes that one entry.
type keychain struct{}

// write stores the token, replacing any token already there.
//
// The command goes in over stdin using `security -i` rather than as arguments.
// Everything on a command line is visible to every other process on the machine
// through `ps`, and an API token is exactly the kind of thing worth keeping off
// it.
//
// `-T /usr/bin/security` is what keeps reading it silent. An item written with
// no trusted application is one macOS puts a permission dialog in front of on
// every single read -- which is a modal window appearing over the app each time
// it asks whether it is connected. Every read here goes through `security`, so
// naming it is exactly as much trust as this needs and no more.
func (keychain) write(ctx context.Context, token string) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "security", "-i")
	cmd.Stdin = strings.NewReader(fmt.Sprintf(
		"add-generic-password -a %s -s %s -w %s -U -T /usr/bin/security\n",
		keychainAccount, keychainService, token,
	))

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			detail = err.Error()
		}

		return fmt.Errorf("could not save the token to the keychain: %s", detail)
	}

	return nil
}

// read returns the token, and whether there was one at all.
func (keychain) read(ctx context.Context) (string, bool) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx,
		"security", "find-generic-password",
		"-a", keychainAccount, "-s", keychainService, "-w",
	)

	out, err := cmd.Output()
	if err != nil {
		return "", false
	}

	token := strings.TrimSpace(string(out))

	return token, token != ""
}

// forget removes the token. Not finding one is the outcome asked for, not a
// failure.
func (keychain) forget(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx,
		"security", "delete-generic-password",
		"-a", keychainAccount, "-s", keychainService,
	)

	if err := cmd.Run(); err != nil {
		if _, found := (keychain{}).read(ctx); !found {
			return nil
		}

		return fmt.Errorf("could not remove the token from the keychain: %w", err)
	}

	return nil
}
