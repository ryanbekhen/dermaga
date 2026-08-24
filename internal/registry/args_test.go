package registry

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

func TestThePasswordIsNeverAnArgument(t *testing.T) {
	// It goes in on stdin instead. An argument would be visible in the process
	// list to anything running on this Mac.
	args := loginArgs("me", "", "docker.io")

	same(t, args, []string{"registry", "login", "--username", "me", "--password-stdin", "docker.io"})
}

func TestLoggingInToALocalRegistrySaysTheScheme(t *testing.T) {
	same(t, loginArgs("me", "http", "localhost:5000"),
		[]string{"registry", "login", "--username", "me", "--password-stdin", "--scheme", "http", "localhost:5000"})
}

func TestPushingSaysTheSchemeToo(t *testing.T) {
	same(t, pushArgs("localhost:5000/app:1", "http"),
		[]string{"image", "push", "--progress", "plain", "--scheme", "http", "localhost:5000/app:1"})
}

func TestNothingIsSaidAboutTheSchemeWhenThereIsNone(t *testing.T) {
	for _, args := range [][]string{loginArgs("me", "", "docker.io"), pushArgs("nginx", "")} {
		if slices.Contains(args, "--scheme") {
			t.Errorf("--scheme appeared without being asked for: %v", args)
		}
	}
}

func TestTheServerAndTheReferenceComeLast(t *testing.T) {
	// Both are positional: a flag after them would be read as their value.
	if args := loginArgs("me", "http", "localhost:5000"); args[len(args)-1] != "localhost:5000" {
		t.Errorf("the server is not last: %v", args)
	}
	if args := pushArgs("nginx:1.27", "http"); args[len(args)-1] != "nginx:1.27" {
		t.Errorf("the reference is not last: %v", args)
	}
}
