package store

import (
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// The migration reads from ~/.dermaga, so the tests move HOME somewhere of
// their own. Anything else would read, and then delete, the developer's real
// scan results.
func inTempHome(t *testing.T) string {
	t.Helper()

	home := t.TempDir()
	t.Setenv("HOME", home)

	dir := filepath.Join(home, ".dermaga")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	return dir
}

func openStore(t *testing.T) *Store {
	t.Helper()

	s, err := Open()
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { s.Close() })

	return s
}

func quiet() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestMigrateMovesScansAndRemovesTheFile(t *testing.T) {
	dir := inTempHome(t)

	body := `{"reports":{"alpine:3.20":{"reference":"alpine:3.20","findings":[]},` +
		`"redis:7":{"reference":"redis:7","findings":[]}}}`
	if err := os.WriteFile(filepath.Join(dir, "scans.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}

	s := openStore(t)
	Migrate(s, quiet())

	var report struct {
		Reference string `json:"reference"`
	}
	found, err := s.Get(BucketScans, "redis:7", &report)
	if err != nil || !found {
		t.Fatalf("redis:7 not migrated (found=%v err=%v)", found, err)
	}
	if report.Reference != "redis:7" {
		t.Fatalf("reference = %q", report.Reference)
	}

	// One record per image, not one blob for the file.
	if found, _ := s.Get(BucketScans, "alpine:3.20", &report); !found {
		t.Fatal("alpine:3.20 not migrated")
	}

	// The point of migrating is that the old file stops existing.
	if _, err := os.Stat(filepath.Join(dir, "scans.json")); !os.IsNotExist(err) {
		t.Fatal("scans.json is still there after being migrated")
	}
}

// The database is authoritative the moment it has an answer: a scan that has
// already run wrote a fresher result than the file on disk, and importing must
// not undo it.
func TestMigrateDoesNotOverwriteWhatIsAlreadyThere(t *testing.T) {
	dir := inTempHome(t)

	s := openStore(t)
	if err := s.Put(BucketScans, "redis:7", map[string]string{"reference": "fresh"}); err != nil {
		t.Fatal(err)
	}

	body := `{"reports":{"redis:7":{"reference":"stale"}}}`
	if err := os.WriteFile(filepath.Join(dir, "scans.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}

	Migrate(s, quiet())

	var report struct {
		Reference string `json:"reference"`
	}
	if _, err := s.Get(BucketScans, "redis:7", &report); err != nil {
		t.Fatal(err)
	}
	if report.Reference != "fresh" {
		t.Fatalf("reference = %q, want the value already in the database", report.Reference)
	}
}

// "We could not read this" must never become "this is gone". A file that fails
// to import stays on disk, so a later version with a fix can still find it.
func TestMigrateKeepsAFileItCouldNotRead(t *testing.T) {
	dir := inTempHome(t)

	path := filepath.Join(dir, "scans.json")
	if err := os.WriteFile(path, []byte("{ this is not json"), 0o600); err != nil {
		t.Fatal(err)
	}

	s := openStore(t)
	Migrate(s, quiet())

	if _, err := os.Stat(path); err != nil {
		t.Fatal("a file that could not be migrated was removed anyway")
	}
}

// Settings are somebody's, not Dermaga's. They stay a file, and stay readable.
func TestMigrateLeavesConfigAlone(t *testing.T) {
	dir := inTempHome(t)

	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(`{"theme":"dark"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	s := openStore(t)
	Migrate(s, quiet())

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("config.json was removed")
	}
	if string(raw) != `{"theme":"dark"}` {
		t.Fatalf("config.json was rewritten: %s", raw)
	}
}

// Running twice is what actually happens: every launch after the first finds
// no files and must do nothing at all.
func TestMigrateIsSafeToRunAgain(t *testing.T) {
	dir := inTempHome(t)

	body := `{"reports":{"redis:7":{"reference":"redis:7"}}}`
	if err := os.WriteFile(filepath.Join(dir, "scans.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}

	s := openStore(t)
	Migrate(s, quiet())
	Migrate(s, quiet())

	count := 0
	if err := s.All(BucketScans, func(_ string, _ []byte) error {
		count++
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	if count != 1 {
		t.Fatalf("%d records after migrating twice, want 1", count)
	}
}

// The catalogue's age used to be the file's modification time. There is no
// file after migrating, so that time has to be carried into the record --
// otherwise every upgraded install would think its catalogue was brand new,
// or ancient, depending on what the zero value happened to mean.
func TestMigrateCarriesTheCatalogueFetchTime(t *testing.T) {
	dir := inTempHome(t)

	path := filepath.Join(dir, "templates.json")
	if err := os.WriteFile(path, []byte(`[{"id":"redis"}]`), 0o600); err != nil {
		t.Fatal(err)
	}

	written := time.Now().Add(-72 * time.Hour).Truncate(time.Second)
	if err := os.Chtimes(path, written, written); err != nil {
		t.Fatal(err)
	}

	s := openStore(t)
	Migrate(s, quiet())

	var record struct {
		FetchedAt time.Time       `json:"fetchedAt"`
		Raw       json.RawMessage `json:"raw"`
	}
	found, err := s.Get(BucketTemplates, "catalogue", &record)
	if err != nil || !found {
		t.Fatalf("catalogue not migrated (found=%v err=%v)", found, err)
	}

	if !record.FetchedAt.Equal(written) {
		t.Fatalf("fetchedAt = %v, want the file's modification time %v", record.FetchedAt, written)
	}
	if string(record.Raw) != `[{"id":"redis"}]` {
		t.Fatalf("catalogue = %s", record.Raw)
	}
}

func TestMigrateMovesPendingEditsOnePerContainer(t *testing.T) {
	dir := inTempHome(t)

	body := `{"web":{"id":"web"},"api":{"id":"api"}}`
	if err := os.WriteFile(filepath.Join(dir, "pending-edits.json"), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}

	s := openStore(t)
	Migrate(s, quiet())

	for _, id := range []string{"web", "api"} {
		var edit struct {
			ID string `json:"id"`
		}
		found, err := s.Get(BucketPending, id, &edit)
		if err != nil || !found {
			t.Fatalf("%s not migrated (found=%v err=%v)", id, found, err)
		}
		if edit.ID != id {
			t.Fatalf("id = %q, want %q", edit.ID, id)
		}
	}

	if _, err := os.Stat(filepath.Join(dir, "pending-edits.json")); !os.IsNotExist(err) {
		t.Fatal("pending-edits.json is still there after being migrated")
	}
}

func TestReplaceEmptiesTheBucketFirst(t *testing.T) {
	inTempHome(t)
	s := openStore(t)

	if err := s.Put(BucketTemplates, "gone", map[string]string{"name": "old"}); err != nil {
		t.Fatal(err)
	}

	if err := s.Replace(BucketTemplates, map[string]any{
		"catalogue": json.RawMessage(`{"name":"new"}`),
	}); err != nil {
		t.Fatal(err)
	}

	if found, _ := s.Get(BucketTemplates, "gone", &map[string]string{}); found {
		t.Fatal("Replace left a key behind")
	}
	if found, _ := s.Get(BucketTemplates, "catalogue", &map[string]string{}); !found {
		t.Fatal("Replace did not write the new value")
	}
}
