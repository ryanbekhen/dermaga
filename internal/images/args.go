package images

import "strings"

// The arguments for the streamed commands, built apart from the calls that run
// them so what reaches the CLI can be checked without the CLI being installed.

// pullCommandArgs is `container image pull`. The reference is positional and
// comes last; the flags before it are only added when they were asked for.
func pullCommandArgs(reference, platform, scheme string) []string {
	args := []string{"image", "pull", "--progress", "plain"}

	if platform != "" {
		args = append(args, "--platform", platform)
	}
	// A registry on this machine has no TLS, and without being told so the CLI
	// fails the handshake with "-9836: bad protocol version".
	if scheme != "" {
		args = append(args, "--scheme", scheme)
	}

	return append(args, reference)
}

// buildCommandArgs is `container build`.
//
// `--progress plain` matters: the default emits TTY control codes that redraw
// in place, which turns into unreadable noise once it is relayed line by line.
func buildCommandArgs(opts BuildOptions) []string {
	args := []string{"build", "--progress", "plain"}

	if opts.Tag != "" {
		args = append(args, "--tag", opts.Tag)
	}
	if opts.Dockerfile != "" {
		args = append(args, "--file", opts.Dockerfile)
	}
	if opts.Target != "" {
		args = append(args, "--target", opts.Target)
	}
	if opts.Platform != "" {
		args = append(args, "--platform", opts.Platform)
	}
	for _, arg := range opts.BuildArgs {
		if strings.TrimSpace(arg) != "" {
			args = append(args, "--build-arg", arg)
		}
	}
	if opts.NoCache {
		args = append(args, "--no-cache")
	}
	// `default` is the only form the CLI takes: the agent this Mac already has,
	// rather than a named key. Nothing here has to hold a key or ask for one.
	if opts.SSH {
		args = append(args, "--ssh", "default")
	}

	// The context directory is positional and has to come last.
	return append(args, opts.Context)
}

// saveCommandArgs is `container image save`. The output path is a flag rather
// than a redirect, so the CLI writes the archive itself.
func saveCommandArgs(reference, platform, output string) []string {
	args := []string{"image", "save", reference, "--output", output}

	if platform != "" {
		args = append(args, "--platform", platform)
	}

	return args
}
