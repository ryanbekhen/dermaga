package terminal

import (
	"slices"
	"testing"
)

// These run without the `container` CLI installed, which is the point: CI has
// no Apple runtime, so this is the layer where a wrong flag can still be caught
// before somebody with a Mac notices it.

func same(t *testing.T, got, want []string) {
	t.Helper()

	if !slices.Equal(got, want) {
		t.Errorf("arguments\n got: %v\nwant: %v", got, want)
	}
}

func TestAMachineShellIsOpenedWithoutACommand(t *testing.T) {
	// No command means the machine's own interactive shell, and the runtime
	// boots the VM first if it is down.
	same(t, machineShellArgs("default", DefaultShell),
		[]string{"machine", "run", "--name", "default"})
}

func TestACommandForAMachineGoesAfterTheSeparator(t *testing.T) {
	// `machine run` puts its arguments through a shell already, so the command
	// is passed as it is rather than wrapped the way a container's is.
	same(t, machineShellArgs("default", "top -b"),
		[]string{"machine", "run", "--name", "default", "--", "top -b"})
}

func TestAContainerShellIsInteractiveAndHasATTY(t *testing.T) {
	// Both are needed: the session is attached to a pty, and without -t the
	// shell inside decides it is not talking to a terminal.
	same(t, containerShellArgs("api", "", "/bin/sh"),
		[]string{"exec", "-i", "-t", "api", "/bin/sh", "-c", "/bin/sh"})
}

func TestAUserIsAskedForOnlyWhenOneWasNamed(t *testing.T) {
	// A form that has been opened and closed leaves spaces behind, and
	// `--user "  "` is refused by the runtime.
	for _, blank := range []string{"", "   "} {
		if args := containerShellArgs("api", blank, "/bin/sh"); slices.Contains(args, "--user") {
			t.Errorf("--user appeared for %q: %v", blank, args)
		}
	}

	same(t, containerShellArgs("api", "root", "/bin/sh"),
		[]string{"exec", "-i", "-t", "--user", "root", "api", "/bin/sh", "-c", "/bin/sh"})
}
