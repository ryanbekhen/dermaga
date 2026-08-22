package images

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestStageDockerfileWritesSomethingBuildable(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	dir, file, err := StageDockerfile("FROM alpine:3.20\nRUN apk add curl")
	if err != nil {
		t.Fatalf("StageDockerfile: %v", err)
	}
	defer os.RemoveAll(dir)

	// The name is what the build's error messages quote back, so it has to be
	// the one somebody can look for in the box they typed into.
	if filepath.Base(file) != "Dockerfile" {
		t.Errorf("staged as %q, want Dockerfile", filepath.Base(file))
	}

	body, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("reading it back: %v", err)
	}

	if !strings.HasSuffix(string(body), "\n") {
		t.Error("no trailing newline; every other tool that opens this will say so")
	}

	if !strings.Contains(string(body), "RUN apk add curl") {
		t.Errorf("content did not survive: %q", body)
	}
}

func TestSweepTakesEveryStagedBuildAndNothingElse(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	// Age is not what qualifies one: the caller holds the store's exclusive
	// lock and has served nothing, so a directory made a second ago is as
	// abandoned as one made yesterday.
	fresh, _, err := StageDockerfile("FROM alpine")
	if err != nil {
		t.Fatalf("StageDockerfile: %v", err)
	}

	old, _, err := StageDockerfile("FROM alpine")
	if err != nil {
		t.Fatalf("StageDockerfile: %v", err)
	}
	past := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(old, past, past); err != nil {
		t.Fatalf("aging it: %v", err)
	}

	// Not ours, and not touched: the directory is shared with nothing today,
	// but a sweep that deletes by location rather than by name is one rename
	// away from deleting somebody's data.
	theirs := filepath.Join(home, ".dermaga", stagingDir, "keep-me")
	if err := os.MkdirAll(theirs, 0o700); err != nil {
		t.Fatalf("making a neighbour: %v", err)
	}

	SweepStagedBuilds()

	for _, dir := range []string{fresh, old} {
		if _, err := os.Stat(dir); !os.IsNotExist(err) {
			t.Errorf("left %s behind; a leftover that survives a restart survives every restart", dir)
		}
	}

	if _, err := os.Stat(theirs); err != nil {
		t.Error("swept a directory that was not ours")
	}
}

func TestNeedsContext(t *testing.T) {
	cases := []struct {
		name string
		text string
		want bool
	}{
		{"nothing reaches outside", "FROM alpine\nRUN apk add curl\nCMD [\"sh\"]", false},
		{"a copy does", "FROM alpine\nCOPY . /app", true},
		{"an add does", "FROM alpine\nADD site.tar /srv", true},
		{"indented, and lower case", "FROM alpine\n  copy . /app", true},
		// The word inside a RUN is not an instruction, and asking for a folder
		// nobody needs is a field in the way.
		{"the word in passing is not the instruction", "FROM alpine\nRUN echo copy that", false},
		{"empty", "", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := NeedsContext(tc.text); got != tc.want {
				t.Errorf("NeedsContext() = %v, want %v", got, tc.want)
			}
		})
	}
}
