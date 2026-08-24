package system

// The arguments for the commands built from more than a fixed list, kept apart
// from the calls that run them so what reaches the CLI can be checked without
// the CLI being installed. What each prune runs is rendered by Kind.args.

// startArgs is `container system start`. The kernel question is answered up
// front either way: asked nothing, the CLI prompts, and a prompt on a pipe
// hangs the request forever.
func startArgs(installKernel bool) []string {
	flag := "--disable-kernel-install"
	if installKernel {
		flag = "--enable-kernel-install"
	}

	return []string{"system", "start", flag}
}

// logsCommandArgs is `container system logs`.
func logsCommandArgs(last string, follow bool) []string {
	args := []string{"system", "logs"}

	if follow {
		args = append(args, "--follow")
	}
	if last != "" {
		args = append(args, "--last", last)
	}

	return args
}
