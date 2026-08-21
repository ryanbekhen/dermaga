package templates

import (
	"encoding/json"
	"testing"
)

// What the published catalogue actually serves, read as this build would read
// it. Kept as a fixture rather than fetched: a test that needs a network is a
// test that fails on a train.
const published = `{"schemaVersion":1,"templates":[
  {"schemaVersion":1,"id":"postgres","name":"PostgreSQL","summary":"Its data on a volume.",
   "caveat":"Set the volume owner.","logo":"templates/postgres/logo.svg",
   "spec":{"name":"postgres","image":"postgres:18-alpine","cpus":1,"memory":"512m",
     "env":["POSTGRES_PASSWORD=postgres"],
     "ports":[{"host":"5432","container":"5432","protocol":"tcp"}],
     "mounts":[{"type":"volume","source":"postgres-data","target":"/var/lib/postgresql"}]}}
]}`

func TestTheCatalogueIsReadAsThisBuildExpects(t *testing.T) {
	got, err := parse([]byte(published))
	if err != nil {
		t.Fatalf("the published catalogue does not parse: %v", err)
	}

	if len(got) != 1 {
		t.Fatalf("got %d templates", len(got))
	}

	template := got[0]

	if template.Spec.Image != "postgres:18-alpine" {
		t.Errorf("image: got %q", template.Spec.Image)
	}
	if template.Caveat == "" {
		t.Error("the caveat is the part that has to survive: it is what the template cannot do for you")
	}
	if len(template.Spec.Mounts) != 1 || template.Spec.Mounts[0].Target != "/var/lib/postgresql" {
		t.Errorf("mounts: got %+v", template.Spec.Mounts)
	}
	if template.Logo == "" {
		t.Error("the logo path should survive; it is what the window shows")
	}
}

// A template written for a later Dermaga is skipped rather than guessed at. The
// field this build does not understand could be the one that made it safe.
func TestATemplateFromTheFutureIsSkipped(t *testing.T) {
	raw := []byte(`{"schemaVersion":1,"templates":[
		{"schemaVersion":2,"id":"tomorrow","name":"Tomorrow","summary":"x","spec":{"name":"a","image":"a:1"}},
		{"schemaVersion":1,"id":"today","name":"Today","summary":"x","spec":{"name":"b","image":"b:1"}}
	]}`)

	got, err := parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}

	if len(got) != 1 || got[0].ID != "today" {
		t.Errorf("only the understood template should be kept, got %v", got)
	}
}

// Half a template is not a template. Offering one with no image would fill the
// form with something that cannot be created.
func TestAnIncompleteTemplateIsRefused(t *testing.T) {
	raw := []byte(`{"schemaVersion":1,"templates":[
		{"schemaVersion":1,"id":"empty","name":"No image","summary":"x","spec":{"name":"a"}}
	]}`)

	if _, err := parse(raw); err == nil {
		t.Error("a catalogue with nothing usable in it should be refused")
	}
}

func TestSomethingThatIsNotACatalogueIsRefused(t *testing.T) {
	for _, raw := range []string{"", "not json", "[]", `{"templates":"no"}`} {
		if _, err := parse([]byte(raw)); err == nil {
			t.Errorf("%q should not be read as a catalogue", raw)
		}
	}
}

// The spec is typed on the way in, so a catalogue entry that is not a container
// specification is refused here rather than discovered by the form.
func TestTheSpecIsRealRatherThanPassedThrough(t *testing.T) {
	got, err := parse([]byte(published))
	if err != nil {
		t.Fatal(err)
	}

	encoded, err := json.Marshal(got[0].Spec)
	if err != nil {
		t.Fatal(err)
	}

	var round map[string]any
	if err := json.Unmarshal(encoded, &round); err != nil {
		t.Fatal(err)
	}

	if round["image"] == nil {
		t.Error("the spec should survive being read and written as a container spec")
	}
}
