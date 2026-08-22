package images

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ryanbekhen/dermaga/internal/store"
)

// stagingDir is where Dockerfiles typed into the app are put so the CLI has
// something on disk to build from.
//
// Under ~/.dermaga rather than the system temporary directory, for one reason:
// macOS empties /tmp on its own schedule, and a build that takes four minutes
// against a context that vanished halfway is a failure nobody can explain.
// Here, the only thing that removes a staged build is Dermaga.
const stagingDir = "builds"

// StageDockerfile writes a typed Dockerfile somewhere a build can read it.
//
// Returns the directory holding it and the path of the file itself. The
// directory is the caller's to remove, and the caller is the only thing that
// knows when the build is done with it.
func StageDockerfile(text string) (dir string, file string, err error) {
	root, err := store.Dir()
	if err != nil {
		return "", "", err
	}

	base := filepath.Join(root, stagingDir)
	if err := os.MkdirAll(base, 0o700); err != nil {
		return "", "", fmt.Errorf("could not make room for the Dockerfile: %w", err)
	}

	dir, err = os.MkdirTemp(base, "paste-")
	if err != nil {
		return "", "", fmt.Errorf("could not make room for the Dockerfile: %w", err)
	}

	// Named Dockerfile rather than something unique: the name is what the
	// error messages from the build will quote back, and "Dockerfile:7" is
	// the line somebody can find in the box they typed it into.
	file = filepath.Join(dir, "Dockerfile")

	// A file the build reads and nothing else does. 0600 rather than 0644
	// because a Dockerfile being typed can hold an ARG somebody meant as a
	// secret, whatever anyone thinks of that habit.
	if err := os.WriteFile(file, []byte(ensureTrailingNewline(text)), 0o600); err != nil {
		_ = os.RemoveAll(dir)

		return "", "", fmt.Errorf("could not write the Dockerfile: %w", err)
	}

	return dir, file, nil
}

// SweepStagedBuilds removes every staged directory left behind.
//
// Every one, with no age to qualify it, and the caller is what makes that
// safe: it is called at startup and only once this process holds the store's
// exclusive lock. Holding it means no other agent is running, and this one has
// not served a request yet -- so nothing anywhere is building, and anything
// still on disk is from a build that did not get to clean up after itself.
//
// An age threshold was the first attempt, guarding against a second agent
// sweeping away a live build's context. It guarded against the wrong thing:
// the lock already rules that out, while the threshold quietly meant a
// leftover survived every restart until six hours had passed.
func SweepStagedBuilds() {
	root, err := store.Dir()
	if err != nil {
		return
	}

	base := filepath.Join(root, stagingDir)
	entries, err := os.ReadDir(base)
	if err != nil {
		return
	}

	for _, entry := range entries {
		if !entry.IsDir() || !strings.HasPrefix(entry.Name(), "paste-") {
			continue
		}

		_ = os.RemoveAll(filepath.Join(base, entry.Name()))
	}
}

// NeedsContext reports whether a Dockerfile reaches for files beside it.
//
// A pasted Dockerfile has no directory of its own, so COPY and ADD have
// nothing to resolve against and the build fails on the line that uses them.
// Asked before the build, this turns that into a field asking which folder to
// build against.
func NeedsContext(text string) bool {
	for _, line := range strings.Split(text, "\n") {
		word, _, _ := strings.Cut(strings.TrimSpace(line), " ")
		switch strings.ToUpper(word) {
		case "COPY", "ADD":
			return true
		}
	}

	return false
}

// The CLI is content either way, but a file that does not end in a newline is
// a file every other tool will complain about the moment it is opened.
func ensureTrailingNewline(text string) string {
	if strings.HasSuffix(text, "\n") {
		return text
	}

	return text + "\n"
}
