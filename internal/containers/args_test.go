package containers

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

// valuesOf collects what was passed to each occurrence of a flag, for the
// arguments that repeat and the ones whose order is not fixed.
func valuesOf(args []string, flag string) []string {
	var found []string
	for i, arg := range args {
		if arg == flag && i+1 < len(args) {
			found = append(found, args[i+1])
		}
	}

	return found
}

func TestListingLeavesOutTheStoppedOnesUnlessAsked(t *testing.T) {
	same(t, listArgs(false), []string{"list", "--format", "json"})
	same(t, listArgs(true), []string{"list", "--format", "json", "--all"})
}

func TestStopWithoutATimeoutLeavesTheRuntimesOwnGracePeriod(t *testing.T) {
	// The flag absent is not the same as --time 0, which would kill at once.
	same(t, stopArgs("api", 0), []string{"stop", "api"})
	same(t, stopArgs("api", -1), []string{"stop", "api"})
}

func TestStopPassesTheTimeoutItWasGiven(t *testing.T) {
	same(t, stopArgs("api", 30), []string{"stop", "--time", "30", "api"})
}

func TestRemovingSomethingRunningTakesForce(t *testing.T) {
	same(t, removeArgs("api", false), []string{"delete", "api"})
	same(t, removeArgs("api", true), []string{"delete", "--force", "api"})
}

func TestLogsFollowAndTailAreBothOptional(t *testing.T) {
	same(t, logsCommandArgs("api", 0, false), []string{"logs", "api"})
	same(t, logsCommandArgs("api", 200, false), []string{"logs", "-n", "200", "api"})
	same(t, logsCommandArgs("api", 0, true), []string{"logs", "--follow", "api"})
	same(t, logsCommandArgs("api", 200, true), []string{"logs", "--follow", "-n", "200", "api"})
}

func TestTheContainerIsAlwaysTheLastArgument(t *testing.T) {
	// It is positional in all three: a flag appended after it would be read as
	// its value.
	for _, args := range [][]string{
		stopArgs("api", 30),
		removeArgs("api", true),
		logsCommandArgs("api", 200, true),
	} {
		if args[len(args)-1] != "api" {
			t.Errorf("the container is not last: %v", args)
		}
	}
}

func TestARunIsDetachedAndEndsWithTheImage(t *testing.T) {
	same(t, ContainerSpec{Image: "alpine:3.20"}.Args(),
		[]string{"run", "--detach", "alpine:3.20"})
}

func TestTheCommandFollowsTheImageItRunsIn(t *testing.T) {
	// Everything after the image belongs to the container, not to the runtime.
	same(t, ContainerSpec{Image: "alpine", Command: []string{"sh", "-c", "sleep 1"}}.Args(),
		[]string{"run", "--detach", "alpine", "sh", "-c", "sleep 1"})
}

func TestADefaultSpecAsksForNothingElse(t *testing.T) {
	args := ContainerSpec{Image: "alpine"}.Args()

	for _, flag := range []string{
		"--name", "--cpus", "--memory", "--network", "--workdir", "--user",
		"--entrypoint", "--read-only", "--init", "--rm", "--tty", "--rosetta",
		"--virtualization", "--ssh", "--platform", "--runtime", "--env",
		"--publish", "--mount", "--label", "--dns",
	} {
		if slices.Contains(args, flag) {
			t.Errorf("%s appeared without being asked for: %v", flag, args)
		}
	}
}

func TestEachPortBecomesItsOwnPublishFlag(t *testing.T) {
	// tcp is the runtime's default and is left off; anything else is named, or
	// the port is published as the wrong protocol.
	args := ContainerSpec{Image: "alpine", Ports: []Port{
		{Host: "8080", Container: "80"},
		{Host: "5353", Container: "53", Protocol: "UDP"},
		{Host: "9000", Container: "9000", Protocol: "tcp"},
	}}.Args()

	same(t, valuesOf(args, "--publish"), []string{"8080:80", "5353:53/udp", "9000:9000"})
}

func TestAMountSaysWhetherItIsAVolumeOrABind(t *testing.T) {
	// The shorthand -v cannot say which, and guessing wrong creates an empty
	// volume named after somebody's folder instead of mounting it.
	args := ContainerSpec{Image: "alpine", Mounts: []SpecMount{
		{Source: "data", Target: "/var/lib/data"},
		{Type: "bind", Source: "/Users/me/src", Target: "/src", ReadOnly: true},
	}}.Args()

	same(t, valuesOf(args, "--mount"), []string{
		"type=volume,source=data,target=/var/lib/data",
		"type=bind,source=/Users/me/src,target=/src,readonly",
	})
}

func TestTheResourceLimitsAreSentAsGiven(t *testing.T) {
	args := ContainerSpec{Image: "alpine", CPUs: 4, Memory: "512m"}.Args()

	same(t, valuesOf(args, "--cpus"), []string{"4"})
	same(t, valuesOf(args, "--memory"), []string{"512m"})
}

func TestEveryDNSSettingGetsItsOwnFlag(t *testing.T) {
	args := ContainerSpec{Image: "alpine", DNS: &DNSConfig{
		Nameservers:   []string{"1.1.1.1", "8.8.8.8"},
		SearchDomains: []string{"internal"},
		Options:       []string{"ndots:2"},
		Domain:        "lan",
	}}.Args()

	same(t, valuesOf(args, "--dns"), []string{"1.1.1.1", "8.8.8.8"})
	same(t, valuesOf(args, "--dns-search"), []string{"internal"})
	same(t, valuesOf(args, "--dns-option"), []string{"ndots:2"})
	same(t, valuesOf(args, "--dns-domain"), []string{"lan"})
}

func TestCapabilitiesGoInBothDirections(t *testing.T) {
	args := ContainerSpec{Image: "alpine",
		CapAdd:  []string{"NET_ADMIN"},
		CapDrop: []string{"CHOWN", "SETUID"},
	}.Args()

	same(t, valuesOf(args, "--cap-add"), []string{"NET_ADMIN"})
	same(t, valuesOf(args, "--cap-drop"), []string{"CHOWN", "SETUID"})
}

func TestTheSwitchesThatCarryNoValue(t *testing.T) {
	args := ContainerSpec{Image: "alpine",
		ReadOnly: true, Init: true, RemoveOnE: true, Terminal: true,
		Rosetta: true, Virtualization: true, SSH: true,
	}.Args()

	for _, flag := range []string{
		"--read-only", "--init", "--rm", "--tty", "--rosetta", "--virtualization", "--ssh",
	} {
		if !slices.Contains(args, flag) {
			t.Errorf("%s was asked for and is missing: %v", flag, args)
		}
	}
}

func TestALabelIsRenderedAsOnePair(t *testing.T) {
	// One label, not two: they come from a map, so with more than one the order
	// is whatever the runtime's iteration gives that run.
	args := ContainerSpec{Image: "alpine", Labels: map[string]string{"owner": "dermaga"}}.Args()

	same(t, valuesOf(args, "--label"), []string{"owner=dermaga"})
}

func TestANetworkThatIsBlankIsNotAsked(t *testing.T) {
	// The edit form leaves an empty row behind when a network is removed, and
	// `--network ""` is rejected by the runtime.
	args := ContainerSpec{Image: "alpine", Networks: []string{"frontend", ""}}.Args()

	same(t, valuesOf(args, "--network"), []string{"frontend"})
}
