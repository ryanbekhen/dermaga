package window

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// Replacing Dermaga with the version it just downloaded.
//
// Until now an update ended with the disk image open in Finder and the user
// dragging the app across, because there was no honest way to do it for them:
// every build was ad-hoc signed, so a downloaded bundle could not be told apart
// from anything else claiming to be Dermaga. Code that overwrites an app with a
// file from the internet it cannot verify is not an updater, it is a way in.
//
// Releases now carry a Developer ID and a team that does not change, which is
// what makes the check below possible and this whole file allowed to exist.
//
// Nothing here is best effort. Every step that cannot be proven returns an
// error, and the caller falls back to opening the image -- the way that has
// always worked. An update that half happened is far worse than one that asks
// for a drag.

// How long the handover waits for this app to exit before giving up. Long
// enough for a window to close, short enough that a wedged app does not leave
// something waiting on it for the rest of the session.
const handoverTimeout = 60 * time.Second

// bundlePath is the .app this process is running from, or empty when it is not
// running from one at all -- a `go run` during development, say.
func bundlePath() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}

	// …/Dermaga.app/Contents/MacOS/Dermaga
	bundle := filepath.Dir(filepath.Dir(filepath.Dir(executable)))
	if !strings.HasSuffix(bundle, ".app") {
		return ""
	}

	return bundle
}

// teamIdentifier reads who signed a bundle.
func teamIdentifier(bundle string) (string, error) {
	out, err := exec.Command("codesign", "-dv", "--verbose=2", bundle).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("could not read the signature of %s: %w", filepath.Base(bundle), err)
	}

	return teamFrom(out), nil
}

// teamFrom picks the team out of what codesign prints.
//
// An ad-hoc signature reports "not set", which has to read as no team at all
// rather than as a team called "not set" -- two ad-hoc builds would otherwise
// match each other and pass for genuine.
func teamFrom(out []byte) string {
	for _, line := range strings.Split(string(out), "\n") {
		team, ok := strings.CutPrefix(strings.TrimSpace(line), "TeamIdentifier=")
		if !ok {
			continue
		}

		if team == "not set" {
			return ""
		}

		return team
	}

	return ""
}

// trustworthy reports whether a downloaded bundle may replace this one.
//
// Three questions, and all three have to answer yes. The signature has to be
// intact, which says the bundle is not damaged or tampered with. The team has
// to be the same one that signed the app asking -- a valid signature by
// somebody else is exactly what an attacker would bring. And Gatekeeper has to
// accept it, which is the part that says Apple has seen it.
func trustworthy(candidate, current string) error {
	if err := exec.Command("codesign", "--verify", "--strict", candidate).Run(); err != nil {
		return fmt.Errorf("the downloaded app's signature does not verify")
	}

	want, err := teamIdentifier(current)
	if err != nil {
		return err
	}
	if want == "" {
		// An ad-hoc build has no team to match, and so no way to tell a
		// genuine update from anything else. Those keep the old path.
		return fmt.Errorf("this build is not signed with a Developer ID")
	}

	got, err := teamIdentifier(candidate)
	if err != nil {
		return err
	}
	if got != want {
		return fmt.Errorf("the downloaded app was signed by %q, not %q", got, want)
	}

	if err := exec.Command("spctl", "--assess", "--type", "exec", candidate).Run(); err != nil {
		return fmt.Errorf("the downloaded app is not notarized")
	}

	return nil
}

// mountImage attaches a disk image and answers where it landed.
func mountImage(dmg string) (string, error) {
	out, err := exec.Command("hdiutil", "attach", "-nobrowse", "-readonly", dmg).Output()
	if err != nil {
		return "", fmt.Errorf("could not open %s: %w", filepath.Base(dmg), err)
	}

	// The last line's last field is the mount point; the columns before it are
	// the device and the filesystem.
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	fields := strings.Split(lines[len(lines)-1], "\t")
	mount := strings.TrimSpace(fields[len(fields)-1])

	if mount == "" {
		return "", fmt.Errorf("could not find where %s was mounted", filepath.Base(dmg))
	}

	return mount, nil
}

// appInside finds the one bundle in a mounted image.
//
// By shape rather than by name: an installer that renamed the app would
// otherwise be silently skipped, and there is only ever one.
func appInside(mount string) (string, error) {
	entries, err := os.ReadDir(mount)
	if err != nil {
		return "", err
	}

	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".app") {
			return filepath.Join(mount, entry.Name()), nil
		}
	}

	return "", fmt.Errorf("there is no app in the disk image")
}

// replaceWith swaps this app for the one in the downloaded image, and returns
// only when the handover has been armed -- the caller quits, and the swap
// happens in the gap.
func (a *App) replaceWith(dmg string) error {
	current := bundlePath()
	if current == "" {
		return fmt.Errorf("Dermaga is not running from an app bundle")
	}

	// Writing the replacement next to the original, so the move at the end is
	// a rename within one filesystem: instant, and either done or not done.
	// Across filesystems it would be a copy, which can fail halfway.
	if err := writable(filepath.Dir(current)); err != nil {
		return err
	}

	mount, err := mountImage(dmg)
	if err != nil {
		return err
	}
	defer exec.Command("hdiutil", "detach", mount, "-quiet").Run()

	candidate, err := appInside(mount)
	if err != nil {
		return err
	}

	if err := trustworthy(candidate, current); err != nil {
		return err
	}

	staged := current + ".new"
	_ = os.RemoveAll(staged)

	// ditto rather than cp: it is the one that carries the extended attributes
	// and symlinks a signature is made of. cp would deliver a bundle whose
	// signature no longer verifies.
	if out, err := exec.Command("ditto", candidate, staged).CombinedOutput(); err != nil {
		_ = os.RemoveAll(staged)
		return fmt.Errorf("could not stage the update: %s", strings.TrimSpace(string(out)))
	}

	// Downloaded, so quarantined, so Gatekeeper would ask about it on first
	// launch even though it is notarized. It has just been checked more
	// thoroughly than that dialog does.
	_ = exec.Command("xattr", "-dr", "com.apple.quarantine", staged).Run()

	if err := handOver(current, staged, os.Getpid()); err != nil {
		_ = os.RemoveAll(staged)
		return err
	}

	return nil
}

// writable reports whether this user can write in a directory, which decides
// whether replacing the app needs an administrator -- and if it does, this is
// not the way to do it.
func writable(dir string) error {
	if err := syscall.Access(dir, 0o2); err != nil {
		return fmt.Errorf("%s cannot be written to without an administrator", dir)
	}

	return nil
}

// handOver starts the small process that does the swap once this one is gone.
//
// An app cannot replace itself while it is running, so the last act is to hand
// the job to something that outlives it. Detached into its own session, or it
// would be taken down with the app it is waiting for.
//
// The order is what makes this survivable: the old bundle is moved aside rather
// than deleted, and only removed once the new one is in place. If the move
// fails, the old one goes back. There is no moment where neither exists.
func handOver(current, staged string, pid int) error {
	script := `
set -e
deadline=$(( $(date +%s) + ` + fmt.Sprint(int(handoverTimeout.Seconds())) + ` ))
while kill -0 "$3" 2>/dev/null; do
	[ "$(date +%s)" -lt "$deadline" ] || exit 1
	sleep 0.2
done

rm -rf "$1.old"
mv "$1" "$1.old"

if mv "$2" "$1"; then
	rm -rf "$1.old"
else
	mv "$1.old" "$1"
	exit 1
fi

# Only a bundle is worth reopening; the guard is what lets this be tested
# against a plain directory without Finder appearing.
case "$1" in
*.app) open "$1" ;;
esac
`

	cmd := exec.Command("/bin/sh", "-c", script, "sh", current, staged, fmt.Sprint(pid))
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

	return cmd.Start()
}
