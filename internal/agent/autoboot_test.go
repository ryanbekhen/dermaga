package agent

import (
	"testing"

	"github.com/ryanbekhen/dermaga/internal/containers"
)

func labelled(id, state string, labels map[string]string) containers.Container {
	return containers.Container{ID: id, Name: id, Status: state, Labels: labels}
}

// The label is free text, written by hand as often as by the form.
func TestWantsAutoBoot(t *testing.T) {
	cases := map[string]bool{
		"true": true, "yes": true, "1": true,
		"false": false, "": false, "maybe": false,
	}

	for value, want := range cases {
		got := WantsAutoBoot(labelled("c", "stopped", map[string]string{AutoBootLabel: value}))
		if got != want {
			t.Errorf("WantsAutoBoot(%q) = %v, want %v", value, got, want)
		}
	}

	if WantsAutoBoot(labelled("c", "stopped", nil)) {
		t.Error("a container with no labels wants nothing")
	}
}

// Auto boot starts what is marked and down. Starting what is already running
// would be a pointless call, and starting the unmarked would be a surprise.
func TestToBoot(t *testing.T) {
	on := map[string]string{AutoBootLabel: "true"}

	picked := toBoot([]containers.Container{
		labelled("marked-down", "stopped", on),
		labelled("marked-up", "running", on),
		labelled("plain-down", "stopped", nil),
	})

	if len(picked) != 1 || picked[0].ID != "marked-down" {
		t.Fatalf("picked %v, want only marked-down", picked)
	}
}
