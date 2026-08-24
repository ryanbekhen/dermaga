package volumes

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

func TestAVolumeIsJustItsNameUnlessMoreIsAsked(t *testing.T) {
	same(t, createArgs(Spec{Name: "data"}), []string{"volume", "create", "data"})
}

func TestASizeGoesInAsTheShortFlag(t *testing.T) {
	// The CLI takes -s and not --size; the long form is refused.
	same(t, createArgs(Spec{Name: "data", Size: "10g"}),
		[]string{"volume", "create", "-s", "10g", "data"})
}

func TestLabelsAndOptionsAreDifferentFlags(t *testing.T) {
	// One of each: they come from maps, so with more than one entry the order
	// is whatever that run's iteration gives.
	same(t, createArgs(Spec{Name: "data",
		Labels: map[string]string{"owner": "dermaga"},
		Opts:   map[string]string{"type": "ext4"},
	}), []string{"volume", "create", "--label", "owner=dermaga", "--opt", "type=ext4", "data"})
}

func TestTheVolumeNameIsAlwaysLast(t *testing.T) {
	args := createArgs(Spec{Name: "data", Size: "10g", Labels: map[string]string{"owner": "dermaga"}})

	if args[len(args)-1] != "data" {
		t.Errorf("the name is not last: %v", args)
	}
}

func TestSomethingHoldingTheVolumeIsUsedRatherThanAHelper(t *testing.T) {
	// Starting a helper for a volume a container already has mounted would
	// mount it twice, and the container is the one that can see it now.
	same(t, commandIn(&Mount{Container: "api", Volume: "data"}, []string{"ls", "-la"}),
		[]string{"exec", "api", "ls", "-la"})
}

func TestNothingHoldingItMeansAHelperThatMountsIt(t *testing.T) {
	args := commandIn(&Mount{Volume: "data"}, []string{"ls"})

	same(t, args, []string{"run", "--rm", "--mount",
		"type=volume,source=data,target=" + helperPath, helperImage, "ls"})
}

func TestAHelperForNoVolumeAtAllStillNamesTheMount(t *testing.T) {
	// The browser asks about a volume that has just been deleted often enough
	// that a nil mount has to produce something the CLI can refuse cleanly.
	if got := mountSpec(nil); got != "type=volume,source=,target="+helperPath {
		t.Errorf("mount spec for nothing: %q", got)
	}
}
