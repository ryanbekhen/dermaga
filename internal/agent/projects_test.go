package agent

import "testing"

func TestWithProjectNetworkKeepsWhatWasChosen(t *testing.T) {
	got := withProjectNetwork([]string{"default"}, "bengkel")

	if len(got) != 2 || got[0] != "default" || got[1] != "bengkel" {
		t.Fatalf("want [default bengkel], got %v", got)
	}
}

func TestWithProjectNetworkDoesNotRepeatItself(t *testing.T) {
	got := withProjectNetwork([]string{"bengkel"}, "bengkel")

	if len(got) != 1 {
		t.Fatalf("want one attachment, got %v", got)
	}
}

// No project means nothing to add, and in particular not an empty --network.
func TestWithProjectNetworkLeavesAloneWithoutAProject(t *testing.T) {
	got := withProjectNetwork([]string{"default"}, "")

	if len(got) != 1 || got[0] != "default" {
		t.Fatalf("want [default], got %v", got)
	}
}

func TestWithProjectNetworkOnAContainerThatChoseNone(t *testing.T) {
	got := withProjectNetwork(nil, "bengkel")

	if len(got) != 1 || got[0] != "bengkel" {
		t.Fatalf("want [bengkel], got %v", got)
	}
}
