package system

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

func TestTheKernelQuestionIsAnsweredBeforeItIsAsked(t *testing.T) {
	// Asked nothing, the CLI prompts, and a prompt on a plain pipe never
	// returns -- the request would hang rather than fail.
	same(t, startArgs(true), []string{"system", "start", "--enable-kernel-install"})
	same(t, startArgs(false), []string{"system", "start", "--disable-kernel-install"})
}

func TestSystemLogsFollowAndWindowAreBothOptional(t *testing.T) {
	same(t, logsCommandArgs("", false), []string{"system", "logs"})
	same(t, logsCommandArgs("1h", false), []string{"system", "logs", "--last", "1h"})
	same(t, logsCommandArgs("", true), []string{"system", "logs", "--follow"})
	same(t, logsCommandArgs("1h", true), []string{"system", "logs", "--follow", "--last", "1h"})
}

func TestPruningImagesTakesEveryUnusedOneAndNotOnlyTheDangling(t *testing.T) {
	// `system df` counts every image no container uses as reclaimable, so
	// without --all the button promises gigabytes and frees nothing.
	args, ok := KindImages.args()
	if !ok {
		t.Fatal("images cannot be pruned")
	}

	same(t, args, []string{"image", "prune", "--all"})
}

func TestEachKindPrunesThroughItsOwnCommand(t *testing.T) {
	volumes, ok := KindVolumes.args()
	if !ok {
		t.Fatal("volumes cannot be pruned")
	}
	same(t, volumes, []string{"volume", "prune"})

	containers, ok := KindContainers.args()
	if !ok {
		t.Fatal("containers cannot be pruned")
	}
	same(t, containers, []string{"prune"})
}

func TestAKindNobodyKnowsPrunesNothing(t *testing.T) {
	// The caller turns this into an error rather than running a bare `prune`,
	// which would take the containers.
	if args, ok := Kind("machines").args(); ok || args != nil {
		t.Errorf("an unknown kind produced %v", args)
	}
}
