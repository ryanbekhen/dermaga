package containers

import "fmt"

// The arguments for the one-shot and streamed commands, built apart from the
// calls that run them so what reaches the CLI can be checked without the CLI
// being installed. `container run` is rendered by ContainerSpec.Args instead,
// which has always been separate.

// listArgs is `container list`. Without --all the runtime reports only what is
// running, which is the sidebar's default view.
func listArgs(all bool) []string {
	args := []string{"list", "--format", "json"}

	if all {
		args = append(args, "--all")
	}

	return args
}

// stopArgs is `container stop`. A timeout of zero leaves the flag off, so the
// runtime's own grace period applies rather than an instant kill.
func stopArgs(id string, timeout int) []string {
	args := []string{"stop"}

	if timeout > 0 {
		args = append(args, "--time", fmt.Sprintf("%d", timeout))
	}

	return append(args, id)
}

// removeArgs is `container delete`. Force is what removes one that is still
// running; without it the runtime refuses.
func removeArgs(id string, force bool) []string {
	args := []string{"delete"}

	if force {
		args = append(args, "--force")
	}

	return append(args, id)
}

// logsCommandArgs is `container logs`. Follow keeps the process alive and is
// what the streaming reader depends on; tail bounds what arrives first.
func logsCommandArgs(id string, tail int, follow bool) []string {
	args := []string{"logs"}

	if follow {
		args = append(args, "--follow")
	}
	if tail > 0 {
		args = append(args, "-n", fmt.Sprintf("%d", tail))
	}

	return append(args, id)
}
