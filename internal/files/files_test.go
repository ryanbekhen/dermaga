package files

import "testing"

// Real output: busybox pads differently from coreutils, names carry spaces,
// and a symlink prints its target. All three broke earlier attempts.
const busybox = `total 148
-rw-r--r--    1 root     root             7 Jun 13 15:17 alpine-release
drwxr-xr-x    4 root     root          4096 Jun 13 16:39 apk/
lrwxrwxrwx    1 root     root            12 Jun 13 15:17 mtab -> /proc/mounts
-rw-r--r--    1 root     root           103 Jun 13 15:17 my notes.txt`

func TestParse(t *testing.T) {
	entries := parse(busybox, "/etc")

	if len(entries) != 4 {
		t.Fatalf("got %d entries, want 4", len(entries))
	}

	if entries[1].Name != "apk" || !entries[1].IsDir {
		t.Errorf("directory = %+v, want apk marked as a directory", entries[1])
	}

	if entries[1].Path != "/etc/apk" {
		t.Errorf("path = %q, want /etc/apk", entries[1].Path)
	}

	link := entries[2]
	if !link.IsLink || link.Name != "mtab" || link.Target != "/proc/mounts" {
		t.Errorf("symlink = %+v, want mtab -> /proc/mounts", link)
	}

	spaced := entries[3]
	if spaced.Name != "my notes.txt" || spaced.Size != 103 {
		t.Errorf("spaced name = %+v, want \"my notes.txt\" of 103 bytes", spaced)
	}
}
