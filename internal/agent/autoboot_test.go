package agent

import (
	"testing"

	"github.com/ryanbekhen/dermaga/internal/containers"
)

// marked builds a container as the listing hands one over: the answer to
// "does this start with Dermaga" is already on it, worked out from the record
// Dermaga keeps and, for older containers, from the label they still carry.
func marked(id, state string, autoBoot bool) containers.Container {
	return containers.Container{ID: id, Name: id, Status: state, AutoBoot: autoBoot}
}

// Auto boot starts what is marked and down. Starting what is already running
// would be a pointless call, and starting the unmarked would be a surprise.
func TestToBoot(t *testing.T) {
	picked := toBoot([]containers.Container{
		marked("marked-down", "stopped", true),
		marked("marked-up", "running", true),
		marked("plain-down", "stopped", false),
	})

	if len(picked) != 1 || picked[0].ID != "marked-down" {
		t.Fatalf("picked %v, want only marked-down", picked)
	}
}
