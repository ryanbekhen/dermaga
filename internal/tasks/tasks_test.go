package tasks

import (
	"fmt"
	"io"
	"log/slog"
	"testing"

	"github.com/ryanbekhen/dermaga/internal/store"
)

func shelf(t *testing.T) *Store {
	t.Helper()
	t.Setenv("HOME", t.TempDir())

	db, err := store.Open()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })

	s := New(slog.New(slog.NewTextHandler(io.Discard, nil)))
	s.UseStore(db)

	return s
}

// The point of the whole package: what a build printed is still there later.
func TestWhatACommandPrintedIsKept(t *testing.T) {
	s := shelf(t)

	if err := s.Put(Record{
		ID:     "build:api",
		Kind:   "image",
		Label:  "api:dev",
		Status: "done",
		Lines:  []string{"#1 [1/2] FROM alpine", "#2 exporting"},
		At:     "2026-08-23T10:00:00Z",
	}); err != nil {
		t.Fatal(err)
	}

	kept := s.List()
	if len(kept) != 1 {
		t.Fatalf("kept %d, want 1", len(kept))
	}
	if len(kept[0].Lines) != 2 || kept[0].Lines[0] != "#1 [1/2] FROM alpine" {
		t.Errorf("lines = %v, want the output as it was printed", kept[0].Lines)
	}
}

// Newest first, because the log worth reading is nearly always the last thing
// you did.
func TestTheShelfReadsNewestFirst(t *testing.T) {
	s := shelf(t)

	for _, at := range []string{"2026-08-23T09:00:00Z", "2026-08-23T11:00:00Z", "2026-08-23T10:00:00Z"} {
		if err := s.Put(Record{ID: at, At: at, Status: "done"}); err != nil {
			t.Fatal(err)
		}
	}

	got := s.List()
	if got[0].At != "2026-08-23T11:00:00Z" || got[2].At != "2026-08-23T09:00:00Z" {
		t.Errorf("order = %v", []string{got[0].At, got[1].At, got[2].At})
	}
}

// A shelf is a shelf: the oldest falls off rather than the file growing for
// ever.
func TestOnlyTheLastFewAreKept(t *testing.T) {
	s := shelf(t)

	for i := range keep + 5 {
		at := fmt.Sprintf("2026-08-23T%02d:00:00Z", i)
		if err := s.Put(Record{ID: at, At: at, Status: "done"}); err != nil {
			t.Fatal(err)
		}
	}

	got := s.List()
	if len(got) != keep {
		t.Fatalf("kept %d, want %d", len(got), keep)
	}
	// The five oldest went, so the earliest still here is the sixth.
	if got[len(got)-1].At != "2026-08-23T05:00:00Z" {
		t.Errorf("oldest kept = %s, want the sixth", got[len(got)-1].At)
	}
}

// Dismissing it in the window is what this is.
func TestForgettingOne(t *testing.T) {
	s := shelf(t)

	if err := s.Put(Record{ID: "build:api", At: "2026-08-23T10:00:00Z", Status: "failed"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Forget("build:api"); err != nil {
		t.Fatal(err)
	}

	if len(s.List()) != 0 {
		t.Error("dismissed and still on the shelf")
	}
}

// Without a database everything still works; it just forgets on quit, which is
// where this started.
func TestWithoutADatabaseNothingBreaks(t *testing.T) {
	s := New(slog.New(slog.NewTextHandler(io.Discard, nil)))

	if err := s.Put(Record{ID: "x", Status: "done"}); err != nil {
		t.Errorf("Put: %v", err)
	}
	if got := s.List(); len(got) != 0 {
		t.Errorf("List = %v, want nothing", got)
	}
	if err := s.Forget("x"); err != nil {
		t.Errorf("Forget: %v", err)
	}
}
