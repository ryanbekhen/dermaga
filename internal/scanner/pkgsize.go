package scanner

import (
	"archive/tar"
	"bufio"
	"compress/gzip"
	"io"
	"os"
	"path"
	"strconv"
	"strings"
)

// Where each packaging system records what it has installed. Both files carry
// a size per package, which is the one number Trivy does not pass on: it reads
// these very files to find the packages and reports everything about them
// except how much room they take.
const (
	apkDatabase  = "lib/apk/db/installed"
	dpkgDatabase = "var/lib/dpkg/status"
)

// packageSizes reads the installed size of each OS package out of the image.
//
// Only OS packages have one. A Go module or an npm dependency is compiled or
// bundled into something else -- the modules listed for a Go binary are notes
// inside a single executable, not files on disk -- so there is no size to
// report and none is invented.
//
// Layers are read newest first and the walk stops at the first one holding a
// database, because that is the copy the image ends up with: a later layer
// that runs apk or apt writes the file again, and the earlier ones are what it
// replaced. Reading from the top also means an image whose packages were
// installed late is answered without ever decompressing its base.
func packageSizes(layout string, layers []Layer) map[string]int64 {
	for i := len(layers) - 1; i >= 0; i-- {
		body, name := findDatabase(layout, layers[i].Digest)
		if body == nil {
			continue
		}

		switch name {
		case apkDatabase:
			return parseApkSizes(body)
		case dpkgDatabase:
			return parseDpkgSizes(body)
		}
	}

	return nil
}

// findDatabase streams one layer looking for a package database, without
// unpacking it: the layer is read through once and only the file wanted is
// held, which for an image of any size is the difference between a few
// kilobytes of memory and all of it.
func findDatabase(layout, digest string) ([]byte, string) {
	file, err := os.Open(path.Join(layout, "blobs", "sha256", strings.TrimPrefix(digest, "sha256:")))
	if err != nil {
		return nil, ""
	}
	defer file.Close()

	buffered := bufio.NewReader(file)

	// Layers are usually gzipped and are allowed not to be. Sniffing the two
	// magic bytes is cheaper and more honest than trusting the media type,
	// which describes what the manifest says rather than what is on disk.
	var stream io.Reader = buffered
	if magic, err := buffered.Peek(2); err == nil && magic[0] == 0x1f && magic[1] == 0x8b {
		unzipped, err := gzip.NewReader(buffered)
		if err != nil {
			return nil, ""
		}
		defer unzipped.Close()
		stream = unzipped
	}

	reader := tar.NewReader(stream)
	for {
		header, err := reader.Next()
		if err != nil {
			return nil, ""
		}

		if header.Typeflag != tar.TypeReg {
			continue
		}

		name := strings.TrimPrefix(path.Clean("/"+header.Name), "/")
		if name != apkDatabase && name != dpkgDatabase {
			continue
		}

		body, err := io.ReadAll(reader)
		if err != nil {
			return nil, ""
		}

		return body, name
	}
}

// parseApkSizes reads apk's installed database: one record per package,
// separated by a blank line, "P:" naming it and "I:" giving the bytes it
// occupies once unpacked.
func parseApkSizes(body []byte) map[string]int64 {
	sizes := map[string]int64{}

	var name string
	var size int64

	flush := func() {
		if name != "" && size > 0 {
			sizes[name] = size
		}
		name, size = "", 0
	}

	for _, line := range strings.Split(string(body), "\n") {
		if line == "" {
			flush()
			continue
		}

		switch {
		case strings.HasPrefix(line, "P:"):
			name = line[2:]
		case strings.HasPrefix(line, "I:"):
			size, _ = strconv.ParseInt(line[2:], 10, 64)
		}
	}

	flush()

	return sizes
}

// parseDpkgSizes reads dpkg's status file. Its Installed-Size is in kibibytes,
// not bytes -- a package listed as "Installed-Size: 1024" takes a megabyte.
func parseDpkgSizes(body []byte) map[string]int64 {
	sizes := map[string]int64{}

	var name string
	var kib int64

	flush := func() {
		if name != "" && kib > 0 {
			sizes[name] = kib * 1024
		}
		name, kib = "", 0
	}

	for _, line := range strings.Split(string(body), "\n") {
		if strings.TrimSpace(line) == "" {
			flush()
			continue
		}

		switch {
		case strings.HasPrefix(line, "Package:"):
			name = strings.TrimSpace(strings.TrimPrefix(line, "Package:"))
		case strings.HasPrefix(line, "Installed-Size:"):
			kib, _ = strconv.ParseInt(strings.TrimSpace(strings.TrimPrefix(line, "Installed-Size:")), 10, 64)
		}
	}

	flush()

	return sizes
}
