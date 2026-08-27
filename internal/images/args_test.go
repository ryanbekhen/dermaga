package images

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

func TestPullOfAPlainReferenceCarriesNoFlagsOfItsOwn(t *testing.T) {
	same(t, pullCommandArgs("nginx", "", ""),
		[]string{"image", "pull", "--progress", "plain", "nginx"})
}

func TestPullNamesThePlatformWhenOneWasChosen(t *testing.T) {
	same(t, pullCommandArgs("nginx:1.27", "linux/arm64", ""),
		[]string{"image", "pull", "--progress", "plain", "--platform", "linux/arm64", "nginx:1.27"})
}

func TestPullSaysTheSchemeSoALocalRegistryIsNotTriedOverTLS(t *testing.T) {
	// Registries on this machine have no TLS. Without --scheme the handshake
	// fails as "-9836: bad protocol version", which explains nothing to anyone.
	same(t, pullCommandArgs("localhost:5000/app", "", "http"),
		[]string{"image", "pull", "--progress", "plain", "--scheme", "http", "localhost:5000/app"})
}

func TestThePulledReferenceIsAlwaysTheLastArgument(t *testing.T) {
	// It is positional: a flag appended after it would be read as its value.
	args := pullCommandArgs("localhost:5000/app", "linux/amd64", "http")

	if args[len(args)-1] != "localhost:5000/app" {
		t.Errorf("reference is not last: %v", args)
	}
}

func TestBuildingAFolderIsTheProgressFlagAndThePath(t *testing.T) {
	same(t, buildCommandArgs(BuildOptions{Context: "/src"}),
		[]string{"build", "--progress", "plain", "/src"})
}

func TestEveryBuildOptionBecomesItsOwnFlag(t *testing.T) {
	same(t, buildCommandArgs(BuildOptions{
		Context:    "/src",
		Tag:        "app:1",
		Dockerfile: "Dockerfile.dev",
		Target:     "runtime",
		Platform:   "linux/arm64",
		BuildArgs:  []string{"A=1", "B=2"},
		NoCache:    true,
	}), []string{
		"build", "--progress", "plain",
		"--tag", "app:1",
		"--file", "Dockerfile.dev",
		"--target", "runtime",
		"--platform", "linux/arm64",
		"--build-arg", "A=1",
		"--build-arg", "B=2",
		"--no-cache",
		"/src",
	})
}

func TestTheContextStaysLastHoweverManyFlagsPrecedeIt(t *testing.T) {
	// The one ordering mistake that is invisible until a build runs: with the
	// context anywhere but the end, the CLI reads it as a flag's value.
	args := buildCommandArgs(BuildOptions{
		Context: "/src", Tag: "app:1", Target: "runtime", NoCache: true,
	})

	if args[len(args)-1] != "/src" {
		t.Errorf("context is not last: %v", args)
	}
}

func TestABuildArgumentThatIsOnlySpaceIsDropped(t *testing.T) {
	// An empty row in the form is not an argument, and passing one along makes
	// the CLI reject the whole build.
	same(t, buildCommandArgs(BuildOptions{Context: "/src", BuildArgs: []string{"", "   ", "A=1"}}),
		[]string{"build", "--progress", "plain", "--build-arg", "A=1", "/src"})
}

func TestNothingIsAskedForWhatWasLeftBlank(t *testing.T) {
	args := buildCommandArgs(BuildOptions{Context: "/src"})

	for _, flag := range []string{"--tag", "--file", "--target", "--platform", "--build-arg", "--no-cache"} {
		if slices.Contains(args, flag) {
			t.Errorf("%s appeared without being asked for: %v", flag, args)
		}
	}
}

func TestSaveWritesThroughAFlagRatherThanARedirect(t *testing.T) {
	same(t, saveCommandArgs("nginx", "", "/tmp/nginx.tar"),
		[]string{"image", "save", "nginx", "--output", "/tmp/nginx.tar"})
}

func TestSaveNamesThePlatformOnlyWhenOneWasChosen(t *testing.T) {
	same(t, saveCommandArgs("nginx", "linux/arm64", "/tmp/nginx.tar"),
		[]string{"image", "save", "nginx", "--output", "/tmp/nginx.tar", "--platform", "linux/arm64"})
}

// What a Dockerfile needs to reach a private repository. `default` is the only
// form the CLI takes -- the agent this Mac already has, rather than a named
// key -- so nothing here holds a key or asks for one.
func TestBuildArgsForwardTheSSHAgent(t *testing.T) {
	args := buildCommandArgs(BuildOptions{Context: ".", SSH: true})

	at := slices.Index(args, "--ssh")
	if at < 0 || args[at+1] != "default" {
		t.Fatalf("want --ssh default: %v", args)
	}
}

func TestBuildArgsLeaveTheAgentAloneByDefault(t *testing.T) {
	args := buildCommandArgs(BuildOptions{Context: "."})

	if slices.Contains(args, "--ssh") {
		t.Fatalf("the agent must not be forwarded unless asked: %v", args)
	}
}
