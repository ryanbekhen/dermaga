package volumes

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A volume image is sparse: created with a half-terabyte cap and holding a few
// megabytes. Reporting the cap as its size answers a question nobody asked.
func TestOnDiskMeasuresBlocksNotTheCap(t *testing.T) {
	path := filepath.Join(t.TempDir(), "volume.img")

	file, err := os.Create(path)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// Claim 64 MiB without writing any of it, the way the CLI claims half a
	// terabyte: apparent size large, blocks on disk close to none.
	if err := file.Truncate(64 << 20); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	file.Close()

	if used := onDisk(path); used >= 64<<20 {
		t.Errorf("onDisk = %d, which is the apparent size rather than the blocks", used)
	}

	if onDisk(filepath.Join(t.TempDir(), "missing.img")) != 0 {
		t.Error("a volume whose image has gone should measure zero, not guess")
	}
}

// The owner is passed to chown, so anything that is not plainly a uid or a
// uid:gid is refused here rather than becoming a flag or a name that means
// something else inside the helper.
func TestValidOwner(t *testing.T) {
	for _, ok := range []string{"0", "999", "999:999", "1000:20"} {
		if !ValidOwner(ok) {
			t.Errorf("ValidOwner(%q) = false, want true", ok)
		}
	}

	for _, bad := range []string{"", "redis", "999:", ":999", "--reference=/etc/passwd", "999 999", "-1", "999:999 /etc"} {
		if ValidOwner(bad) {
			t.Errorf("ValidOwner(%q) = true, want false", bad)
		}
	}
}

// A volume held by a running container cannot be mounted a second time, so the
// work goes through that container instead -- and only reaches for a helper
// when nothing has it.
func TestCommandGoesWhereTheVolumeIs(t *testing.T) {
	held := commandIn(&Mount{Container: "postgres", Path: "/var/lib/postgresql", Volume: "pgdata"},
		[]string{"chown", "-R", "999:999", "/var/lib/postgresql"})

	if held[0] != "exec" || held[1] != "postgres" {
		t.Fatalf("a mounted volume should be reached through its container, got %v", held)
	}
	if strings.Contains(strings.Join(held, " "), helperImage) {
		t.Errorf("no helper should be started for a volume already in use: %v", held)
	}

	free := commandIn(&Mount{Volume: "pgdata"}, []string{"stat", "-c", "%u:%g", helperPath})
	joined := strings.Join(free, " ")

	if free[0] != "run" {
		t.Fatalf("an unheld volume needs a helper, got %v", free)
	}
	if !strings.Contains(joined, "type=volume,source=pgdata,target="+helperPath) {
		t.Errorf("the helper must mount the volume it was started for: %v", free)
	}
	if !strings.Contains(joined, "--rm") {
		t.Errorf("the helper must not outlive the question: %v", free)
	}
}

// The tidy has to reach the volume the same way everything else does: through
// the container holding it, or through a helper that mounts it.
func TestTidyRemovesLostFoundWhereverTheVolumeIs(t *testing.T) {
	held := commandIn(&Mount{Container: "redis", Path: "/data", Volume: "redis-data"},
		[]string{"rm", "-rf", "/data/lost+found"})

	if strings.Join(held, " ") != "exec redis rm -rf /data/lost+found" {
		t.Errorf("held volume: got %v", held)
	}

	free := strings.Join(commandIn(&Mount{Volume: "redis-data"},
		[]string{"rm", "-rf", helperPath + "/lost+found"}), " ")

	if !strings.Contains(free, "run --rm") || !strings.Contains(free, helperPath+"/lost+found") {
		t.Errorf("free volume: got %s", free)
	}
}

// The name the CLI reports is fully qualified whatever was typed to pull the
// image, so a copy that compares against the short form would decide the image
// is missing on a machine that has it -- and restore over it, every time.
func TestHelperImageIsRecognisedInTheImageList(t *testing.T) {
	list := []byte(`[
		{"configuration":{"name":"docker.io/library/alpine:3.20"}},
		{"configuration":{"name":"docker.io/library/redis:8.10-alpine"}},
		{"configuration":{"name":"docker.io/library/alpine:latest"}}
	]`)

	held, err := holdsHelper(list)
	if err != nil {
		t.Fatalf("reading the image list: %v", err)
	}
	if !held {
		t.Errorf("the helper image is in that list; %q was not found in it", helperImage)
	}

	without := []byte(`[{"configuration":{"name":"docker.io/library/alpine:3.20"}}]`)

	held, err = holdsHelper(without)
	if err != nil {
		t.Fatalf("reading the image list: %v", err)
	}
	if held {
		t.Errorf("alpine:3.20 is not the helper image, but it was taken for it")
	}
}

// Absent is older than old: a machine with no copy has to take one, and the
// upkeep decides that by asking this.
func TestNoCopyCountsAsStale(t *testing.T) {
	store := &helperStore{path: filepath.Join(t.TempDir(), helperArchive)}

	if !store.stale() {
		t.Fatal("a copy that is not there should be stale")
	}

	if err := os.WriteFile(store.path, []byte("archive"), 0o644); err != nil {
		t.Fatal(err)
	}

	if store.stale() {
		t.Error("a copy written a moment ago should not be stale")
	}

	old := time.Now().Add(-helperMaxAge - time.Hour)
	if err := os.Chtimes(store.path, old, old); err != nil {
		t.Fatal(err)
	}

	if !store.stale() {
		t.Errorf("a copy older than %s should be stale", helperMaxAge)
	}
}

// Nowhere to keep a copy is not a failure, it is the state Dermaga was in
// before any copy was kept: the runtime fetches the image when it needs it.
func TestWithoutSomewhereToKeepItNothingHappens(t *testing.T) {
	store := &helperStore{}

	if store.stale() {
		t.Error("with nowhere to keep a copy there is nothing to call stale")
	}

	if err := store.restore(t.Context()); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("restoring from nowhere should report that there is nothing there, got %v", err)
	}
}
