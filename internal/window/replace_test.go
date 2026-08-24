package window

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// An ad-hoc signature reports "not set", and that has to read as no team at
// all. Taken literally it is a team name like any other -- and every ad-hoc
// build on earth would then match every other one, which is precisely the
// check that is supposed to stop a downloaded bundle replacing this app.
func TestAdHocHasNoTeamToMatch(t *testing.T) {
	adhoc := []byte(`Executable=/Applications/Dermaga.app/Contents/MacOS/Dermaga
Identifier=dev.ryanbekhen.dermaga
CodeDirectory v=20400 size=33231 flags=0x2(adhoc)
Signature=adhoc
TeamIdentifier=not set
`)

	if got := teamFrom(adhoc); got != "" {
		t.Errorf("an ad-hoc build has no team; got %q", got)
	}

	signed := []byte(`Identifier=dev.ryanbekhen.dermaga
CodeDirectory v=20500 size=22242 flags=0x10000(runtime)
Authority=Developer ID Application: Achmad irianto Eka putra (94842RX94P)
TeamIdentifier=94842RX94P
`)

	if got := teamFrom(signed); got != "94842RX94P" {
		t.Errorf("team: got %q", got)
	}

	if got := teamFrom([]byte("Signature=adhoc\n")); got != "" {
		t.Errorf("no team line at all is no team; got %q", got)
	}
}

// The app is found by shape rather than by name, so a release that renamed the
// bundle still installs instead of silently doing nothing.
func TestTheAppIsFoundInTheImage(t *testing.T) {
	mount := t.TempDir()

	for _, name := range []string{".fseventsd", "Applications"} {
		if err := os.Mkdir(filepath.Join(mount, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(mount, "Dermaga.app"), 0o755); err != nil {
		t.Fatal(err)
	}

	got, err := appInside(mount)
	if err != nil {
		t.Fatalf("appInside: %v", err)
	}

	if filepath.Base(got) != "Dermaga.app" {
		t.Errorf("got %q", got)
	}
}

func TestAnImageWithNoAppIsRefused(t *testing.T) {
	if _, err := appInside(t.TempDir()); err == nil {
		t.Error("an image with nothing in it should be refused, not installed")
	}
}

// A directory nobody can write to is the signal to leave the app alone and let
// the user drag it, rather than to ask for a password halfway through.
func TestSomewhereUnwritableIsRefused(t *testing.T) {
	dir := t.TempDir()
	locked := filepath.Join(dir, "locked")

	if err := os.Mkdir(locked, 0o500); err != nil {
		t.Fatal(err)
	}

	if err := writable(locked); err == nil {
		t.Error("a directory that cannot be written to should be refused")
	}

	if err := writable(dir); err != nil {
		t.Errorf("a writable directory should be accepted: %v", err)
	}
}

// The handover is the only part of this that can destroy the app, so it is
// worth watching do its work: it waits for a process to go, moves the old
// bundle aside, moves the new one in, and only then removes what it displaced.
func TestTheHandoverSwapsOnlyAfterTheAppIsGone(t *testing.T) {
	dir := t.TempDir()
	current := filepath.Join(dir, "Dermaga")
	staged := current + ".new"

	write := func(path, marker string) {
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(path, "which"), []byte(marker), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	write(current, "old")
	write(staged, "new")

	// Something to wait for, standing in for the app on its way out.
	going := exec.Command("/bin/sh", "-c", "sleep 1")
	if err := going.Start(); err != nil {
		t.Fatal(err)
	}

	if err := handOver(current, staged, going.Process.Pid); err != nil {
		t.Fatalf("handOver: %v", err)
	}

	// Nothing may move while it is still running: an app replaced underneath
	// itself is how a half-finished update happens.
	if which, _ := os.ReadFile(filepath.Join(current, "which")); string(which) != "old" {
		t.Fatalf("the swap happened too early: %q", which)
	}

	_ = going.Wait()

	// Putting the new version in place and clearing up what it displaced are
	// two steps, and waiting only for the first catches the script between
	// them often enough to matter. Wait for the whole sequence to settle.
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		which, err := os.ReadFile(filepath.Join(current, "which"))
		_, stagedErr := os.Stat(staged)
		_, displacedErr := os.Stat(current + ".old")

		if err == nil && string(which) == "new" &&
			os.IsNotExist(stagedErr) && os.IsNotExist(displacedErr) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}

	which, err := os.ReadFile(filepath.Join(current, "which"))
	if err != nil {
		t.Fatalf("nothing is in place any more: %v", err)
	}
	if string(which) != "new" {
		t.Errorf("the new version should be in place, found %q", which)
	}

	if _, err := os.Stat(staged); !os.IsNotExist(err) {
		t.Error("the staged copy should be gone once it is in place")
	}
	if _, err := os.Stat(current + ".old"); !os.IsNotExist(err) {
		t.Error("what was displaced should be cleared up, not left behind")
	}
}
