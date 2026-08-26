package toolchain

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/ryanbekhen/dermaga/internal/cli"
)

func TestOlderComparesANumberAtATime(t *testing.T) {
	cases := []struct {
		version string
		floor   string
		want    bool
	}{
		{"1.2.2", "1.0.0", false},
		{"0.12.3", "1.0.0", true},
		// Ten is not two, however it sorts as text.
		{"1.10.0", "1.9.0", false},
		{"1.9.0", "1.10.0", true},
		// Homebrew's own rebuild counter is not a release of the CLI.
		{"1.2.2_1", "1.2.2", false},
		{"1.0.0_3", "1.0.1", true},
		// A shorter version is that version with zeroes after it.
		{"1.2", "1.2.0", false},
		{"1.2", "1.2.1", true},
		{"v1.0.0", "1.0.0", false},
		// Nothing readable, so nothing said. Telling somebody their CLI is
		// unsupported because its version string had an unfamiliar shape is
		// worse than saying nothing at all.
		{"", "1.0.0", false},
		{"unknown", "1.0.0", false},
		{"1.0.0", "", false},
	}

	for _, c := range cases {
		if got := Older(c.version, c.floor); got != c.want {
			t.Errorf("Older(%q, %q) = %v, want %v", c.version, c.floor, got, c.want)
		}
	}
}

// `brew outdated` exits 1 precisely when something is outdated, and prints the
// JSON anyway. Reading the exit status instead of the answer inverted the whole
// feature: "up to date" whenever it was, "could not check for updates" the
// moment there was anything to say.
func TestAnOutdatedFormulaIsReadDespiteTheExitStatus(t *testing.T) {
	fakeBrew(t, `{"formulae":[{"name":"container","installed_versions":["1.2.2_1"],"current_version":"1.3.0"}],"casks":[]}`, 1)

	outdated, latest, err := newTestManager().outdated(context.Background())
	if err != nil {
		t.Fatalf("outdated: %v", err)
	}
	if !outdated || latest != "1.3.0" {
		t.Errorf("got outdated=%v latest=%q, want true and 1.3.0", outdated, latest)
	}
}

func TestNothingOutdatedIsNotAFailure(t *testing.T) {
	fakeBrew(t, `{"formulae":[],"casks":[]}`, 0)

	outdated, latest, err := newTestManager().outdated(context.Background())
	if err != nil {
		t.Fatalf("outdated: %v", err)
	}
	if outdated || latest != "" {
		t.Errorf("got outdated=%v latest=%q, want false and empty", outdated, latest)
	}
}

// Homebrew missing, broken, or answering with something else entirely. Only
// here is the exit status worth reading, because there is no answer to read
// instead.
func TestAnAnswerThatIsNotJSONIsAFailure(t *testing.T) {
	fakeBrew(t, "Error: No available formula with the name \"container\".", 1)

	if _, _, err := newTestManager().outdated(context.Background()); err == nil {
		t.Fatal("expected an error when Homebrew answered with prose")
	}
}

func newTestManager() *Manager {
	return NewManager(cli.New(), slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
}

// fakeBrew puts a `brew` on PATH that says one thing and exits with one status.
func fakeBrew(t *testing.T, output string, code int) {
	t.Helper()

	dir := t.TempDir()
	// printf rather than cat: PATH is about to become this directory and
	// nothing else, so the stand-in can only use what the shell has built in.
	script := "#!/bin/sh\nprintf '%s' " + strconv.Quote(output) + "\nexit " + strconv.Itoa(code) + "\n"

	if err := os.WriteFile(filepath.Join(dir, "brew"), []byte(script), 0o755); err != nil {
		t.Fatalf("writing the stand-in: %v", err)
	}

	t.Setenv("PATH", dir)
}
