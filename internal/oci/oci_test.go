package oci

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

// write puts a blob in the store under its own digest, which is what makes a
// content store one, and hands back the digest to point at it with.
func write(t *testing.T, root, content string) string {
	t.Helper()

	sum := sha256.Sum256([]byte(content))
	name := hex.EncodeToString(sum[:])

	if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	return "sha256:" + name
}

// The whole point: the ports an image declares, which `container image inspect`
// does not report.
func TestTheWalkFromAnIndexToWhatAnImageListensOn(t *testing.T) {
	root := t.TempDir()

	config := write(t, root, `{"config":{"ExposedPorts":{"6379/tcp":{},"80/tcp":{}}}}`)
	manifest := write(t, root, `{"config":{"digest":"`+config+`"}}`)
	index := write(t, root, `{"manifests":[{"digest":"`+manifest+`","platform":{"os":"linux","architecture":"arm64"}}]}`)

	ports := OpenAt(root).ExposedPorts(index, "linux/arm64")

	if len(ports) != 2 || ports[0] != "6379/tcp" || ports[1] != "80/tcp" {
		t.Errorf("ports = %v, want both, sorted", ports)
	}
}

// An image variant hands over its own manifest rather than an index, and the
// walk is one step shorter. Both shapes arrive as a descriptor to follow.
func TestAManifestIsFollowedJustAsAnIndexIs(t *testing.T) {
	root := t.TempDir()

	config := write(t, root, `{"config":{"ExposedPorts":{"3000/tcp":{}}}}`)
	manifest := write(t, root, `{"config":{"digest":"`+config+`"}}`)

	ports := OpenAt(root).ExposedPorts(manifest, "")

	if len(ports) != 1 || ports[0] != "3000/tcp" {
		t.Errorf("ports = %v, want the config behind the manifest", ports)
	}
}

// A multi-platform image has a manifest each, and the container's own platform
// says which one it is running.
func TestThePlatformChoosesBetweenManifests(t *testing.T) {
	root := t.TempDir()

	amd := write(t, root, `{"config":{"digest":"`+write(t, root, `{"config":{"ExposedPorts":{"1/tcp":{}}}}`)+`"}}`)
	arm := write(t, root, `{"config":{"digest":"`+write(t, root, `{"config":{"ExposedPorts":{"2/tcp":{}}}}`)+`"}}`)

	index := write(t, root, `{"manifests":[
		{"digest":"`+amd+`","platform":{"os":"linux","architecture":"amd64"}},
		{"digest":"`+arm+`","platform":{"os":"linux","architecture":"arm64"}}
	]}`)

	store := OpenAt(root)

	if got := store.ExposedPorts(index, "linux/arm64"); len(got) != 1 || got[0] != "2/tcp" {
		t.Errorf("arm64 = %v, want the arm64 manifest's config", got)
	}
	// Unknown, or a platform that is not in there: the first will do, since
	// every variant of an image declares the same ports in practice.
	if got := store.ExposedPorts(index, ""); len(got) != 1 || got[0] != "1/tcp" {
		t.Errorf("no platform = %v, want the first manifest", got)
	}
}

// Most images declare nothing, and that is an answer rather than a failure.
func TestAnImageThatDeclaresNothingSaysSo(t *testing.T) {
	root := t.TempDir()

	config := write(t, root, `{"config":{"Env":["PATH=/usr/bin"]}}`)
	manifest := write(t, root, `{"config":{"digest":"`+config+`"}}`)

	if ports := OpenAt(root).ExposedPorts(manifest, ""); ports != nil {
		t.Errorf("ports = %v, want nothing", ports)
	}
}

// Every way of not knowing answers the same way, because the cost of being
// wrong here has to be the behaviour there was before any of this.
func TestNotKnowingIsNeverAnError(t *testing.T) {
	root := t.TempDir()

	store := OpenAt(root)
	missing := "sha256:" + hex.EncodeToString(make([]byte, 32))

	for name, got := range map[string][]string{
		"no such blob":    store.ExposedPorts(missing, ""),
		"no digest":       store.ExposedPorts("", ""),
		"no store at all": OpenAt("").ExposedPorts(missing, ""),
	} {
		if got != nil {
			t.Errorf("%s: got %v, want nothing", name, got)
		}
	}

	// A digest is a name in one directory and must never become a path out of
	// it -- these are read from files the runtime wrote, not from the user, but
	// the walk follows what it finds and that is exactly the kind of trust
	// worth not extending.
	if got := store.ExposedPorts("sha256:../../etc/passwd", ""); got != nil {
		t.Errorf("followed a digest out of the store: %v", got)
	}

	// And an unreadable blob is only an unreadable blob.
	broken := filepath.Join(root, hex.EncodeToString(make([]byte, 32)))
	if err := os.WriteFile(broken, []byte("not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := store.ExposedPorts(missing, ""); got != nil {
		t.Errorf("unreadable blob gave %v", got)
	}
}
