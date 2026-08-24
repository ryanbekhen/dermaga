package terminal

import "strings"

// The arguments each kind of shell is opened with, kept apart from the calls
// that run them so what reaches the CLI can be checked without the CLI being
// installed.

// machineShellArgs is `container machine run`. With no command of its own it
// opens the machine's interactive shell and boots the VM first if it is down.
//
// The command is passed after `--` and not wrapped in a shell snippet: machine
// run joins its arguments and runs them through a shell already, so the
// container fallback would be parsed twice.
func machineShellArgs(id, command string) []string {
	args := []string{"machine", "run", "--name", id}

	if command != DefaultShell {
		args = append(args, "--", command)
	}

	return args
}

// containerShellArgs is `container exec`. Interactive and with a tty, because
// the caller attaches it to a pty; the command goes through /bin/sh so a shell
// that is not there falls back to one that is.
func containerShellArgs(id, user, command string) []string {
	args := []string{"exec", "-i", "-t"}

	if strings.TrimSpace(user) != "" {
		args = append(args, "--user", user)
	}

	return append(args, id, "/bin/sh", "-c", command)
}
