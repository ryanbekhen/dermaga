package system

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Container names.
//
// Apple's runtime can register every container under a local domain, so one
// container reaches another by `<name>.<domain>` instead of by an address that
// changes every time it is recreated. It is off unless a domain is set, and the
// setting lives in the CLI's own configuration rather than anywhere Dermaga
// owns.
//
// So Dermaga writes it, once, if nobody has. There is no decision here worth
// putting in front of somebody: a machine where containers cannot find each
// other by name is not a preference, it is a machine that has not been set up.
//
// Never over a domain that is already there. Whatever is in that file was put
// there by the person whose machine this is, and a tool that quietly disagrees
// with your configuration is worse than one that does nothing.

// Domain is what containers are registered under when Dermaga sets this up.
//
// `internal` is reserved by ICANN for private networks, so it can never collide
// with anything on the public internet. `local` would have been the obvious
// guess and is the one to avoid: it belongs to mDNS, and taking it breaks
// Bonjour -- printers, AirPlay, every device on the network, and the Mac's own
// name.
const Domain = "internal"

// configPath is where Apple's CLI keeps its settings.
func configPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}

	return filepath.Join(home, ".config", "container", "config.toml"), nil
}

// hasDomain reports whether a configuration already names a DNS domain.
//
// Read rather than parsed: a TOML library for one key would be a dependency
// this project does not otherwise need, and the question is narrow enough to
// answer honestly without one -- is there a [dns] section, and does it set a
// domain before the next section begins.
var domainKey = regexp.MustCompile(`(?m)^\s*domain\s*=`)

func hasDomain(config string) bool {
	start := strings.Index(config, "[dns]")
	if start < 0 {
		return false
	}

	section := config[start+len("[dns]"):]

	// Only as far as the next section: a `domain =` under [network] is not this.
	if next := strings.Index(section, "\n["); next >= 0 {
		section = section[:next]
	}

	return domainKey.MatchString(section)
}

// EnsureDomain sets up container names if nothing has.
//
// Reports whether it wrote anything, because the caller has to know: the
// services read this only when they start, so a machine where they are already
// running needs them restarted before it means anything.
func EnsureDomain(logger *slog.Logger) (bool, error) {
	path, err := configPath()
	if err != nil {
		return false, err
	}

	existing, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return false, fmt.Errorf("could not read %s: %w", path, err)
	}

	config := string(existing)
	if hasDomain(config) {
		return false, nil
	}

	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, err
	}

	// Appended, never rewritten. Everything else in that file belongs to
	// somebody else and a rewrite is how a tool loses somebody's settings
	// while meaning well.
	next := config
	if next != "" && !strings.HasSuffix(next, "\n") {
		next += "\n"
	}
	if next != "" {
		next += "\n"
	}
	next += fmt.Sprintf("[dns]\ndomain = %q\n", Domain)

	temp := path + ".tmp"
	defer os.Remove(temp)

	if err := os.WriteFile(temp, []byte(next), 0o644); err != nil {
		return false, err
	}
	if err := os.Rename(temp, path); err != nil {
		return false, err
	}

	logger.Info("Containers can now find each other by name", "domain", Domain, "config", path)

	return true, nil
}

// Registered reports whether macOS itself has been told about the domain.
//
// Two halves make container names work, and only one of them belongs to the
// user's own files. This is the other: a resolver file under /etc/resolver that
// routes the domain to the container runtime's DNS service. Without it names go
// unanswered -- from the Mac, and from inside containers too, which take the
// same road out.
//
// Read from the CLI rather than by looking in /etc/resolver, because what
// counts is what the runtime believes rather than what is on disk.
func (sm *Manager) Registered(ctx context.Context) bool {
	out, err := sm.runner.Run(ctx, "system", "dns", "list")
	if err != nil {
		// Cannot tell, so do not claim it is missing: a warning shown because a
		// question failed is a warning nobody can act on.
		return true
	}

	for _, line := range strings.Split(string(out), "\n") {
		if strings.TrimSpace(line) == Domain {
			return true
		}
	}

	return false
}
