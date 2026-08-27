package projects

import (
	"log/slog"
	"testing"

	"github.com/ryanbekhen/dermaga/internal/notify"
)

func manager() *Manager {
	return NewManager(slog.Default(), notify.Nop)
}

// The whole migration story in one test: a container with nothing recorded is
// in default, and default is never a row anybody made.
func TestDefaultIsTheAbsenceOfARecord(t *testing.T) {
	m := manager()

	if !m.Exists("") {
		t.Fatal("an unset project should be a place a container can be")
	}
	if !m.Exists(Default) {
		t.Fatal("default should always exist")
	}
	if len(m.List()) != 0 {
		t.Fatalf("default should not be a row: got %d", len(m.List()))
	}
	if _, err := m.Create(Default); err == nil {
		t.Fatal("default should not be creatable")
	}
}

func TestCreateRefusesADuplicate(t *testing.T) {
	m := manager()

	if _, err := m.Create("bengkel"); err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := m.Create("bengkel"); err == nil {
		t.Fatal("a second project of the same name should be refused")
	}
	if got := len(m.List()); got != 1 {
		t.Fatalf("want 1 project, got %d", got)
	}
}

func TestListIsAlphabetical(t *testing.T) {
	m := manager()

	for _, name := range []string{"zebra", "apel", "mangga"} {
		if _, err := m.Create(name); err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
	}

	want := []string{"apel", "mangga", "zebra"}
	got := m.List()

	if len(got) != len(want) {
		t.Fatalf("want %d projects, got %d", len(want), len(got))
	}
	for i := range want {
		if got[i].Name != want[i] {
			t.Fatalf("at %d: want %q, got %q", i, want[i], got[i].Name)
		}
	}
}

func TestValidateRejectsWhatAContainerNameCouldNotCarry(t *testing.T) {
	for _, name := range []string{"", "   ", "with space", "slash/es", "dot.ted", "default"} {
		if _, err := Validate(name); err == nil {
			t.Fatalf("%q should have been refused", name)
		}
	}

	for _, name := range []string{"bengkel", "bengkel-api", "arsip_2026"} {
		if got, err := Validate(name); err != nil || got != name {
			t.Fatalf("%q should be allowed: got %q, %v", name, got, err)
		}
	}

	// Lowered on the way through: an image reference has no uppercase in it.
	if got, err := Validate("MyApp"); err != nil || got != "myapp" {
		t.Fatalf("want myapp, got %q, %v", got, err)
	}
}

func TestValidateTrims(t *testing.T) {
	got, err := Validate("  bengkel  ")
	if err != nil {
		t.Fatalf("validate: %v", err)
	}
	if got != "bengkel" {
		t.Fatalf("want %q, got %q", "bengkel", got)
	}
}

func TestIsDefault(t *testing.T) {
	for _, name := range []string{"", "  ", "default", "DEFAULT", "Default"} {
		if !IsDefault(name) {
			t.Fatalf("%q should read as default", name)
		}
	}
	if IsDefault("bengkel") {
		t.Fatal("a project name should not read as default")
	}
}

func TestPrefixedNamesWhatIsBornInAProject(t *testing.T) {
	if got := Prefixed("bengkel", "dashboard"); got != "bengkel_dashboard" {
		t.Fatalf("want bengkel-dashboard, got %q", got)
	}
}

// Default is the absence of a project, so it names nothing.
func TestPrefixedLeavesDefaultAlone(t *testing.T) {
	for _, project := range []string{"", "default"} {
		if got := Prefixed(project, "dashboard"); got != "dashboard" {
			t.Fatalf("%q: want dashboard, got %q", project, got)
		}
	}
}

// Somebody who types the prefix themselves gets what they typed, not
// bengkel-bengkel-dashboard.
func TestPrefixedDoesNotStutter(t *testing.T) {
	if got := Prefixed("bengkel", "bengkel_dashboard"); got != "bengkel_dashboard" {
		t.Fatalf("want bengkel-dashboard, got %q", got)
	}
}

func TestPrefixedOnNothing(t *testing.T) {
	if got := Prefixed("bengkel", "  "); got != "" {
		t.Fatalf("want empty, got %q", got)
	}
}

func TestUnprefixedReadsItBack(t *testing.T) {
	if got := Unprefixed("bengkel", "bengkel_dashboard"); got != "dashboard" {
		t.Fatalf("want dashboard, got %q", got)
	}
}

// The project's own prefix, like everything else it names.
func TestNetworkNameCarriesTheProjectPrefix(t *testing.T) {
	if got := NetworkName("bengkel"); got != "bengkel_default" {
		t.Fatalf("want bengkel-default, got %q", got)
	}
}

// Default is the absence of a project, so it has no network of its own -- the
// built-in one is where a container with no project already lands.
func TestNetworkNameForDefaultIsNothing(t *testing.T) {
	for _, project := range []string{"", "default"} {
		if got := NetworkName(project); got != "" {
			t.Fatalf("%q: want empty, got %q", project, got)
		}
	}
}
