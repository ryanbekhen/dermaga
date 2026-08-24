package networks

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

func TestANetworkIsJustItsNameUnlessMoreIsAsked(t *testing.T) {
	same(t, createArgs(Spec{Name: "frontend"}), []string{"network", "create", "frontend"})
}

func TestBothSubnetsHaveTheirOwnFlag(t *testing.T) {
	// --subnet-v6 is a separate flag, not the same one given an v6 range.
	same(t, createArgs(Spec{Name: "frontend", Subnet: "10.1.0.0/24", SubnetV6: "fd00::/64"}),
		[]string{"network", "create", "--subnet", "10.1.0.0/24", "--subnet-v6", "fd00::/64", "frontend"})
}

func TestAnInternalNetworkSaysSoWithoutAValue(t *testing.T) {
	same(t, createArgs(Spec{Name: "frontend", Internal: true}),
		[]string{"network", "create", "--internal", "frontend"})
}

func TestALabelIsRenderedAsOnePair(t *testing.T) {
	// One label, not two: they come from a map, so with more than one the order
	// is whatever that run's iteration gives.
	same(t, createArgs(Spec{Name: "frontend", Labels: map[string]string{"owner": "dermaga"}}),
		[]string{"network", "create", "--label", "owner=dermaga", "frontend"})
}

func TestTheNetworkNameIsAlwaysLast(t *testing.T) {
	args := createArgs(Spec{Name: "frontend", Subnet: "10.1.0.0/24", Internal: true,
		Labels: map[string]string{"owner": "dermaga"}})

	if args[len(args)-1] != "frontend" {
		t.Errorf("the name is not last: %v", args)
	}
}
