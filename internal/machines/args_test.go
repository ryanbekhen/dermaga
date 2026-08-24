package machines

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

func TestLogsAreTheMachinesStdioUntilTheBootLogIsAskedFor(t *testing.T) {
	same(t, logsCommandArgs("default", 0, false, false), []string{"machine", "logs", "default"})
	same(t, logsCommandArgs("default", 0, false, true), []string{"machine", "logs", "--boot", "default"})
}

func TestFollowAndTailAreBothOptionalOnAMachine(t *testing.T) {
	same(t, logsCommandArgs("default", 50, true, false),
		[]string{"machine", "logs", "--follow", "-n", "50", "default"})
}

func TestTheMachineIsTheLastLogArgument(t *testing.T) {
	// It is positional: a flag appended after it would be read as its value.
	args := logsCommandArgs("default", 50, true, true)

	if args[len(args)-1] != "default" {
		t.Errorf("the machine is not last: %v", args)
	}
}

func TestSettingsAreKeyValuePairsRatherThanFlags(t *testing.T) {
	// `machine set` takes cpus=4, not --cpus 4. Sent as a flag it is refused.
	args, err := configureArgs("default", Settings{CPUs: 4, Memory: "8g"})
	if err != nil {
		t.Fatalf("configureArgs: %v", err)
	}

	same(t, args, []string{"machine", "set", "--name", "default", "cpus=4", "memory=8g"})
}

func TestSettingNothingIsNotACommand(t *testing.T) {
	// Running `machine set --name x` with no pairs asks the runtime to change
	// nothing, so the caller skips it entirely.
	args, err := configureArgs("default", Settings{})
	if err != nil {
		t.Fatalf("configureArgs: %v", err)
	}

	if args != nil {
		t.Errorf("empty settings still produced a command: %v", args)
	}
}

func TestAHomeMountIsOneOfThreeWords(t *testing.T) {
	for _, mount := range []string{"ro", "rw", "none"} {
		args, err := configureArgs("default", Settings{HomeMount: mount})
		if err != nil {
			t.Fatalf("%s was refused: %v", mount, err)
		}
		if !slices.Contains(args, "home-mount="+mount) {
			t.Errorf("%s did not survive: %v", mount, args)
		}
	}

	// Anything else is caught here rather than by the runtime, which reports it
	// as a failed command with nothing said about which setting was wrong.
	if _, err := configureArgs("default", Settings{HomeMount: "sideways"}); err == nil {
		t.Error("an unknown home mount was accepted")
	}
}

func TestTurningVirtualizationOffIsAlsoAChange(t *testing.T) {
	// It is a pointer for this reason: false and unset mean different things,
	// and only unset means leave it alone.
	off := false
	args, err := configureArgs("default", Settings{Virtualization: &off})
	if err != nil {
		t.Fatalf("configureArgs: %v", err)
	}

	same(t, args, []string{"machine", "set", "--name", "default", "virtualization=false"})
}

func TestCreatingAMachineEndsWithTheImage(t *testing.T) {
	same(t, Spec{Image: "ubuntu:26.04"}.CreateArgs(),
		[]string{"machine", "create", "--progress", "plain", "ubuntu:26.04"})
}

func TestEveryCreateOptionBecomesItsOwnFlag(t *testing.T) {
	same(t, Spec{
		Name: "dev", Image: "ubuntu:26.04", CPUs: 4, Memory: "8g",
		HomeMount: "rw", SetDefault: true, NoBoot: true, Virtualization: true,
	}.CreateArgs(), []string{
		"machine", "create", "--progress", "plain",
		"--name", "dev",
		"--cpus", "4",
		"--memory", "8g",
		"--home-mount", "rw",
		"--set-default",
		"--no-boot",
		"--virtualization",
		"ubuntu:26.04",
	})
}

func TestACreateAsksForNothingThatWasLeftBlank(t *testing.T) {
	args := Spec{Image: "ubuntu:26.04"}.CreateArgs()

	for _, flag := range []string{
		"--name", "--cpus", "--memory", "--home-mount", "--set-default",
		"--no-boot", "--virtualization",
	} {
		if slices.Contains(args, flag) {
			t.Errorf("%s appeared without being asked for: %v", flag, args)
		}
	}
}
