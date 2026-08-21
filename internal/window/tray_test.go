package window

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

func labels(state TrayState) []string {
	var out []string

	for _, item := range trayMenuItems(state) {
		if item.Separator {
			out = append(out, "—")
			continue
		}
		out = append(out, item.Label)
	}

	return out
}

func running(value bool) *bool { return &value }

func containers(count int) []TrayContainer {
	out := make([]TrayContainer, count)
	for i := range out {
		out[i] = TrayContainer{ID: fmt.Sprintf("id-%d", i), Name: fmt.Sprintf("container-%d", i)}
	}

	return out
}

func TestTrayLabelAnswersTheQuestionItExistsFor(t *testing.T) {
	cases := []struct {
		state TrayState
		want  string
	}{
		{TrayState{Running: running(true), Containers: containers(2)}, "Services running · 2 containers"},
		{TrayState{Running: running(true), Containers: containers(1)}, "Services running · 1 container"},
		{TrayState{Running: running(false)}, "Services stopped"},
		// Before the first answer arrives, it says so rather than claiming zero.
		{TrayState{}, "Checking the services…"},
	}

	for _, test := range cases {
		if got := trayLabel(test.state); got != test.want {
			t.Errorf("trayLabel = %q, want %q", got, test.want)
		}
	}
}

func TestTrayOffersStartServicesOnlyWhenStopped(t *testing.T) {
	if !slices.Contains(labels(TrayState{Running: running(false)}), "Start services") {
		t.Error("a stopped runtime should offer the way out of it")
	}

	if slices.Contains(labels(TrayState{Running: running(true)}), "Start services") {
		t.Error("services already running should not be offered a start")
	}

	// Unknown is not the same as stopped: nothing to recover from yet.
	if slices.Contains(labels(TrayState{}), "Start services") {
		t.Error("an unanswered state should not offer a start")
	}
}

func TestTrayAlwaysKeepsAWayInAndAWayOut(t *testing.T) {
	for _, state := range []TrayState{
		{Running: running(true)},
		{Running: running(false)},
		{},
	} {
		got := labels(state)

		for _, want := range []string{"Open Dermaga", "Quit Dermaga"} {
			if !slices.Contains(got, want) {
				t.Errorf("state %+v is missing %q", state, want)
			}
		}
	}
}

func TestTrayListsRunningContainersAndCountsTheRest(t *testing.T) {
	got := labels(TrayState{Running: running(true), Containers: containers(maxTrayContainers + 4)})

	if !slices.Contains(got, "container-0") {
		t.Error("the first container should be listed")
	}
	if !slices.Contains(got, fmt.Sprintf("container-%d", maxTrayContainers-1)) {
		t.Error("the last container within the limit should be listed")
	}
	if slices.Contains(got, fmt.Sprintf("container-%d", maxTrayContainers)) {
		t.Error("the list should stop at the limit")
	}
	if !slices.Contains(got, "…and 4 more") {
		t.Error("what was cut should still be counted")
	}
}

func TestTraySaysNothingIsRunningRatherThanShowingAGap(t *testing.T) {
	if !slices.Contains(labels(TrayState{Running: running(true)}), "No containers running") {
		t.Error("an empty list should say so")
	}
}

func TestTrayCarriesTheContainerIDToOpen(t *testing.T) {
	for _, item := range trayMenuItems(TrayState{Running: running(true), Containers: containers(2)}) {
		if item.Action != "open-container" {
			continue
		}

		if item.ID == "" {
			t.Errorf("%q has nothing to open", item.Label)
		}
	}
}

// Where Dermaga came from, reachable from the one part of it that is always on
// screen. The row carries an action rather than an address, so what it opens
// stays a decision the app makes in one place.
func TestTrayPointsAtTheProject(t *testing.T) {
	for _, state := range []TrayState{
		{Running: running(true), Containers: containers(2)},
		{Running: running(false)},
		{},
	} {
		if !slices.Contains(labels(state), "View on GitHub") {
			t.Errorf("the menu should always offer the project: %v", labels(state))
		}
	}

	var found bool
	for _, item := range trayMenuItems(TrayState{}) {
		if item.Action == "project" {
			found = true

			if item.Disabled {
				t.Error("a row nobody can click is not a link")
			}
		}
	}

	if !found {
		t.Error("no row carries the project action")
	}
}

// It has to come before the way out, or people find Quit first.
func TestTrayKeepsQuitLast(t *testing.T) {
	items := trayMenuItems(TrayState{Running: running(true)})
	last := items[len(items)-1]

	if last.Action != "quit" {
		t.Errorf("the last row should be the way out, got %q", last.Label)
	}
}

// An update that has already been downloaded is the one row in this menu with
// a deadline on it: nothing is left to do but close the app and open it again.
func TestTheMenuOffersAnUpdateOnceItIsDownloaded(t *testing.T) {
	running := true

	quiet := trayMenuItems(TrayState{Running: &running})
	for _, item := range quiet {
		if item.Action == "restart-update" {
			t.Fatal("the menu offered a restart with nothing downloaded")
		}
	}

	offered := trayMenuItems(TrayState{Running: &running, UpdateVersion: "1.9.0"})

	var found trayItem
	for _, item := range offered {
		if item.Action == "restart-update" {
			found = item
		}
	}

	if found.Action == "" {
		t.Fatal("a downloaded update was not offered")
	}
	// The version is in the row: "an update is ready" says nothing about
	// whether it is the one somebody has been waiting for.
	if !strings.Contains(found.Label, "1.9.0") {
		t.Errorf("the row reads %q, and does not say which version", found.Label)
	}
	if found.Disabled {
		t.Error("the row cannot be pressed")
	}
}
