package scanner

import (
	"context"
	"io"
	"log/slog"
	"testing"
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
