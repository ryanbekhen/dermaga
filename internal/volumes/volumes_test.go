package volumes

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
