package registry

// The arguments for the commands built from more than a fixed list, kept apart
// from the calls that run them so what reaches the CLI can be checked without
// the CLI being installed.

// loginArgs is `container registry login`. The password never appears here: it
// goes in on stdin, which is what --password-stdin asks for, so it stays out of
// the process list.
func loginArgs(username, scheme, server string) []string {
	args := []string{"registry", "login", "--username", username, "--password-stdin"}

	// A registry on this machine has no TLS, and without being told so the CLI
	// fails the handshake rather than reaching it.
	if scheme != "" {
		args = append(args, "--scheme", scheme)
	}

	return append(args, server)
}

// pushArgs is `container image push`.
func pushArgs(reference, scheme string) []string {
	args := []string{"image", "push", "--progress", "plain"}

	if scheme != "" {
		args = append(args, "--scheme", scheme)
	}

	return append(args, reference)
}
