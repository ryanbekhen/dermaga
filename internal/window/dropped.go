package window

import (
	"os"
	"path/filepath"
	"strings"
)

// BuildDrop is a path dragged onto the window that turns out to be something
// to build.
//
// A Dockerfile on a Mac is almost never opened -- it is edited in one window
// and built in another, and the second window asks for the folder it is in,
// the file's name within that folder, and a tag. Two of those three the drop
// already knows. Dragging the file in and typing a tag is the whole job.
type BuildDrop struct {
	// Context is the folder the build runs against: the Dockerfile's own
	// folder, or the folder that was dropped.
	Context string `json:"context"`
	// Dockerfile names the file within the context, and is empty when it is
	// the plain `Dockerfile` the CLI looks for anyway.
	Dockerfile string `json:"dockerfile,omitempty"`
	// Name is a tag worth suggesting, from the folder's own name. Empty when
	// nothing usable can be made of it, and then the field opens blank.
	Name string `json:"name,omitempty"`
}

// ResolveBuildDrop answers what a drop is worth building, or nothing.
//
// The first path that resolves wins. Dropping a handful of files is a thing
// people do by accident far more often than on purpose, and building each of
// them is not what any of those accidents meant.
func (b *Bridge) ResolveBuildDrop(paths []string) *BuildDrop {
	for _, path := range paths {
		if drop, ok := buildFromDrop(path); ok {
			return &drop
		}
	}

	return nil
}

// buildFromDrop reads one dropped path.
//
// Two things are worth building: a Dockerfile, whose folder becomes the
// context, and a folder with a Dockerfile in it. Anything else is a drop that
// was not about building, and says so by resolving to nothing rather than by
// guessing.
func buildFromDrop(path string) (BuildDrop, bool) {
	path = strings.TrimSuffix(filepath.Clean(path), string(filepath.Separator))

	info, err := os.Stat(path)
	if err != nil {
		return BuildDrop{}, false
	}

	if info.IsDir() {
		// The plain name, because that is the only one `container build` looks
		// for by itself. A folder holding nothing but Dockerfile.dev is a
		// folder somebody has to say which file they meant in, and this drop
		// cannot ask.
		if _, err := os.Stat(filepath.Join(path, "Dockerfile")); err != nil {
			return BuildDrop{}, false
		}

		return BuildDrop{Context: path, Name: tagFrom(path)}, true
	}

	name := filepath.Base(path)
	if !looksLikeDockerfile(name) {
		return BuildDrop{}, false
	}

	context := filepath.Dir(path)
	drop := BuildDrop{Context: context, Name: tagFrom(context)}

	// Left empty when it is what the CLI would have found anyway, so the field
	// is only filled in when it is telling the reader something.
	if name != "Dockerfile" {
		drop.Dockerfile = name
	}

	return drop, true
}

// looksLikeDockerfile recognises the three shapes these files come in:
// `Dockerfile`, `Dockerfile.dev`, and `dev.Dockerfile`.
//
// Case-insensitively, because the file is named by whoever made the project
// and macOS does not care either.
func looksLikeDockerfile(name string) bool {
	lower := strings.ToLower(name)

	return lower == "dockerfile" ||
		strings.HasPrefix(lower, "dockerfile.") ||
		strings.HasSuffix(lower, ".dockerfile")
}

// tagFrom suggests a name for the image from the folder holding it, which is
// what people call these anyway -- an `api` folder builds `api`.
//
// A tag is not a folder name, though: the runtime takes lowercase letters,
// digits and separators, and nothing else. What cannot be carried over is
// dropped rather than substituted, and a name left with nothing in it is no
// suggestion at all.
func tagFrom(dir string) string {
	base := strings.ToLower(filepath.Base(dir))

	var b strings.Builder
	for _, r := range base {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '.' || r == '_' || r == '-':
			b.WriteRune(r)
		}
	}

	// Separators are only legal between characters, so a name that begins or
	// ends with one is not a name the runtime would accept.
	name := strings.Trim(b.String(), "._-")
	if name == "" {
		return ""
	}

	return name + ":latest"
}
