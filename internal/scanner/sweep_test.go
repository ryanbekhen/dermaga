package scanner

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"

	"github.com/ryanbekhen/dermaga/internal/cli"
)

// A sweep with no scanner installed still clears up after deleted images.
//
// Tidying up is not the scanner's to refuse: forgetting an image that is gone
// needs the list of images and nothing else. This used to sit below the
// "installed and ready" check, so anyone who had not installed Trivy -- or
// whose vulnerability database had not finished downloading -- accumulated a
// result for every image they had ever deleted, with no way to be rid of them.
func TestSweepForgetsDeletedImagesWithoutTheScanner(t *testing.T) {
	m := &Manager{
		logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		reports: map[string]Report{"gone:1": {Reference: "gone:1"}, "here:1": {Reference: "here:1"}},
		source: func(context.Context) ([]ImageRef, error) {
			return []ImageRef{{Reference: "here:1"}}, nil
		},
	}

	// The state this is about: nothing installed, no database.
	if m.Status().Installed || m.Status().DatabaseReady {
		t.Fatal("the zero manager should look uninstalled")
	}

	m.runSweep(context.Background())

	if _, held := m.Report("gone:1"); held {
		t.Error("kept the result for an image that no longer exists")
	}

	if _, held := m.Report("here:1"); !held {
		t.Error("dropped the result for an image that is still here; rescanning it would cost minutes to learn nothing")
	}
}

// And a sweep that cannot list images at all leaves everything alone. Reading
// "no images" out of a failed listing would delete every result on the machine.
func TestSweepKeepsEverythingWhenImagesCannotBeListed(t *testing.T) {
	m := &Manager{
		logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		reports: map[string]Report{"here:1": {Reference: "here:1"}},
		source: func(context.Context) ([]ImageRef, error) {
			return nil, context.DeadlineExceeded
		},
	}

	m.runSweep(context.Background())

	if _, held := m.Report("here:1"); !held {
		t.Error("a listing that failed was read as an empty machine")
	}
}

// A database that disappears from under a running agent is downloaded again
// before anything is scanned against it.
//
// It lives in ~/Library/Caches, which anything may empty. The status still
// said it was ready, so every sweep went on to scan, every scan died on
// Trivy's "--skip-db-update cannot be specified on the first run", and each
// left a warning behind -- two images meant two of them after every change to
// the image list, until the hourly check came round.
func TestSweepDownloadsADatabaseThatHasGone(t *testing.T) {
	cache := t.TempDir()
	t.Setenv("TRIVY_CACHE_DIR", cache)

	// Stands in for `trivy image --download-db-only`: writes the metadata the
	// manager reads to tell whether there is a database.
	fakeTrivy(t, `mkdir -p "$TRIVY_CACHE_DIR/db" && echo '{"Version":2}' > "$TRIVY_CACHE_DIR/db/metadata.json"`)

	m := &Manager{
		logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		runner:  cli.New(),
		reports: map[string]Report{},
		status:  Status{Installed: true, DatabaseReady: true},
		source: func(context.Context) ([]ImageRef, error) {
			return nil, nil
		},
	}

	m.runSweep(context.Background())

	if _, err := os.Stat(filepath.Join(cache, "db", "metadata.json")); err != nil {
		t.Fatal("swept without downloading the missing database")
	}

	if got := m.Status().State; got != StateIdle {
		t.Errorf("state after the download = %q, want idle", got)
	}
}

// And when the download fails, that is the one thing reported, and nothing is
// scanned against a database that is not there.
func TestSweepStopsWhenTheDatabaseCannotBeDownloaded(t *testing.T) {
	t.Setenv("TRIVY_CACHE_DIR", t.TempDir())
	fakeTrivy(t, `exit 1`)

	listed := false
	m := &Manager{
		logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		runner:  cli.New(),
		reports: map[string]Report{},
		status:  Status{Installed: true, DatabaseReady: true},
		source: func(context.Context) ([]ImageRef, error) {
			listed = true
			return []ImageRef{{Reference: "here:1"}}, nil
		},
	}

	m.runSweep(context.Background())

	if !listed {
		t.Fatal("the sweep never ran")
	}

	status := m.Status()
	if status.State != StateFailed || status.Detail != "Could not update the vulnerability database" {
		t.Errorf("got %q %q, want the database failure", status.State, status.Detail)
	}

	if status.DatabaseReady {
		t.Error("still claims a database after failing to download one")
	}
}

// fakeTrivy puts a trivy on PATH that runs body and nothing else.
func fakeTrivy(t *testing.T, body string) {
	t.Helper()

	bin := t.TempDir()
	script := "#!/bin/sh\n" + body + "\n"
	if err := os.WriteFile(filepath.Join(bin, Formula), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}

	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
}
