// Package oci reads the image metadata Apple's `container` keeps on disk.
//
// It exists for one fact the CLI will not part with: the ports an image
// declares it listens on. `container image inspect` reports an image's
// command, entrypoint, environment and working directory, and drops the rest
// of the config -- so a redis that has said `EXPOSE 6379` since it was built
// looks, through the CLI, like an image that listens on nothing.
//
// The bytes are there. What the runtime keeps under Application Support is an
// ordinary OCI layout: content-addressed blobs, an index pointing at manifests,
// a manifest pointing at a config. This package walks those three and reads the
// answer out of the last one.
//
// Reading another program's directory is a liberty, and it is taken carefully:
// nothing here writes, every failure is silent and answers "nothing known",
// and the layout is the OCI specification's rather than Apple's invention. The
// cost of being wrong is the behaviour Dermaga had before this existed.
package oci

import (
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Where the runtime keeps its blobs, under the user's home.
const contentDir = "Library/Application Support/com.apple.container/content/blobs/sha256"

// maxBlobSize bounds what is read into memory.
//
// An index, a manifest and a config are all a few kilobytes; a layer is
// gigabytes. Nothing here should ever open a layer, and this is what makes a
// mistake about that cheap rather than fatal.
const maxBlobSize = 4 << 20

// Store is the runtime's content store, as somewhere to read from.
type Store struct {
	root string
}

// Open reads the store in its usual place. A Store whose root does not exist
// is not an error: it answers "nothing known" to everything, which is what a
// Mac without the runtime installed should say.
func Open() *Store {
	home, err := os.UserHomeDir()
	if err != nil {
		return &Store{}
	}

	return &Store{root: filepath.Join(home, contentDir)}
}

// OpenAt reads a store somewhere else, which is how this is tested.
func OpenAt(root string) *Store {
	return &Store{root: root}
}

// descriptor is the part of an OCI descriptor this package follows.
type descriptor struct {
	Digest   string `json:"digest"`
	Platform struct {
		OS           string `json:"os"`
		Architecture string `json:"architecture"`
	} `json:"platform"`
}

// blob is an index and a manifest at once: an index carries `manifests`, a
// manifest carries `config`. Reading both shapes into one struct is what lets
// the walk below take either without asking which it has.
type blob struct {
	Manifests []descriptor `json:"manifests"`
	Config    descriptor   `json:"config"`
}

// imageConfig is the config blob, of which one field is wanted.
type imageConfig struct {
	Config struct {
		ExposedPorts map[string]any `json:"ExposedPorts"`
	} `json:"config"`
}

// ExposedPorts is what the image behind a descriptor says it listens on, as
// "6379/tcp" and friends, sorted.
//
// The digest is whichever the caller has: a container records the index it was
// created from, an image variant records its own manifest, and both arrive
// here as one descriptor to follow. Nothing known comes back as nothing --
// most images genuinely declare no ports, and that is not a failure.
//
// Platform is "linux/arm64" or empty. It picks between the manifests of a
// multi-platform image; empty, or matching none, takes the first, since every
// variant of an image declares the same ports in practice.
func (s *Store) ExposedPorts(digest, platform string) []string {
	if s.root == "" || digest == "" {
		return nil
	}

	var top blob
	if !s.read(digest, &top) {
		return nil
	}

	// An index: follow it to the manifest for this platform.
	config := top.Config.Digest
	if len(top.Manifests) > 0 {
		var manifest blob
		if !s.read(pick(top.Manifests, platform).Digest, &manifest) {
			return nil
		}

		config = manifest.Config.Digest
	}

	var image imageConfig
	if !s.read(config, &image) {
		return nil
	}

	ports := make([]string, 0, len(image.Config.ExposedPorts))
	for port := range image.Config.ExposedPorts {
		ports = append(ports, port)
	}
	sort.Strings(ports)

	if len(ports) == 0 {
		return nil
	}

	return ports
}

// pick chooses the manifest for a platform, or the first when it cannot.
func pick(manifests []descriptor, platform string) descriptor {
	os, arch, found := strings.Cut(platform, "/")
	if found {
		for _, manifest := range manifests {
			if manifest.Platform.OS == os && manifest.Platform.Architecture == arch {
				return manifest
			}
		}
	}

	return manifests[0]
}

// read decodes one blob by digest. False means "could not", for every reason
// there is: no such blob, unreadable, not JSON, too big to be one of these.
func (s *Store) read(digest string, into any) bool {
	hex := strings.TrimPrefix(digest, "sha256:")
	if hex == "" || strings.ContainsAny(hex, "/\\.") {
		// Never let a digest from a file become a path of its own.
		return false
	}

	file, err := os.Open(filepath.Join(s.root, hex))
	if err != nil {
		return false
	}
	defer file.Close()

	return json.NewDecoder(io.LimitReader(file, maxBlobSize)).Decode(into) == nil
}
