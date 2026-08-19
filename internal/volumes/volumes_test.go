package volumes

import (
	"os"
	"path/filepath"
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
