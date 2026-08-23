package window

import (
	"os"
	"path/filepath"
	"testing"
)

// The drag people actually do: the Dockerfile they have been editing, from the
// Finder window it is sitting in.
func TestADroppedDockerfileBringsItsFolderWithIt(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "api")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(dir, "Dockerfile")
	if err := os.WriteFile(path, []byte("FROM alpine\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	drop, ok := buildFromDrop(path)
	if !ok {
		t.Fatal("a Dockerfile is the one thing this has to recognise")
	}
	if drop.Context != dir {
		t.Errorf("context = %q, want the folder the file is in (%q)", drop.Context, dir)
	}
	// The CLI looks for this name by itself, so filling the field in would only
	// repeat what leaving it empty already means.
	if drop.Dockerfile != "" {
		t.Errorf("named the default Dockerfile explicitly: %q", drop.Dockerfile)
	}
	if drop.Name != "api:latest" {
		t.Errorf("suggested tag = %q, want it from the folder", drop.Name)
	}
}

// Dockerfile.dev and dev.Dockerfile are both ordinary, and neither is what the
// CLI finds on its own -- so both have to be named.
func TestADockerfileByAnotherNameIsNamedExplicitly(t *testing.T) {
	dir := t.TempDir()

	for _, name := range []string{"Dockerfile.dev", "dev.Dockerfile", "dockerfile"} {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("FROM alpine\n"), 0o644); err != nil {
			t.Fatal(err)
		}

		drop, ok := buildFromDrop(path)
		if !ok {
			t.Fatalf("%s was not recognised as a Dockerfile", name)
		}
		if drop.Dockerfile != name {
			t.Errorf("%s: dockerfile = %q, want it named", name, drop.Dockerfile)
		}
	}
}

// A project folder is the other half of the same drag, and the only file that
// makes it one is the one the CLI would look for.
func TestAFolderIsBuildableOnlyWithADockerfileInIt(t *testing.T) {
	dir := t.TempDir()

	if _, ok := buildFromDrop(dir); ok {
		t.Error("offered to build a folder with no Dockerfile in it")
	}

	if err := os.WriteFile(filepath.Join(dir, "Dockerfile.dev"), []byte("FROM alpine\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Still not buildable: a folder cannot say which file was meant, and
	// `container build` only finds the plain name.
	if _, ok := buildFromDrop(dir); ok {
		t.Error("offered to build a folder whose only Dockerfile the CLI will not find")
	}

	if err := os.WriteFile(filepath.Join(dir, "Dockerfile"), []byte("FROM alpine\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	drop, ok := buildFromDrop(dir)
	if !ok {
		t.Fatal("a folder with a Dockerfile in it is a build")
	}
	if drop.Context != dir || drop.Dockerfile != "" {
		t.Errorf("drop = %+v, want the folder alone", drop)
	}
}

// Everything else resolves to nothing, which is how the window knows to say so
// rather than to open a form about a file nobody can build.
func TestAnythingElseIsNotABuild(t *testing.T) {
	dir := t.TempDir()

	other := filepath.Join(dir, "notes.txt")
	if err := os.WriteFile(other, []byte("hello\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, ok := buildFromDrop(other); ok {
		t.Error("offered to build a text file")
	}
	if _, ok := buildFromDrop(filepath.Join(dir, "gone")); ok {
		t.Error("offered to build a path that does not exist")
	}
}

// The suggestion is a tag, not a folder name: the runtime takes lowercase
// letters, digits and separators, and a name it would reject is worse than no
// suggestion.
func TestTheSuggestedTagIsOneTheRuntimeWouldAccept(t *testing.T) {
	cases := map[string]string{
		"/Users/me/API":            "api:latest",
		"/Users/me/My Project":     "myproject:latest",
		"/Users/me/web-app_2":      "web-app_2:latest",
		"/Users/me/-leading":       "leading:latest",
		"/Users/me/日本語":            "",
		string(filepath.Separator): "",
	}

	for dir, want := range cases {
		if got := tagFrom(dir); got != want {
			t.Errorf("tagFrom(%q) = %q, want %q", dir, got, want)
		}
	}
}
