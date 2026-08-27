package containers

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ryanbekhen/dermaga/internal/notify"
	"github.com/ryanbekhen/dermaga/internal/oci"
	"github.com/ryanbekhen/dermaga/internal/store"
)

// Trimmed from real `container list --all --format json` output (CLI 1.2.2).
const listFixture = `[
  {
    "configuration": {
      "creationDate": "2026-08-17T07:12:13Z",
      "id": "postgres",
      "image": {
        "descriptor": {"digest": "sha256:4d1f5a", "mediaType": "application/vnd.oci.image.index.v1+json"},
        "reference": "docker.io/library/postgres:18.6"
      },
      "initProcess": {"environment": ["POSTGRES_USER=postgres"]},
      "labels": {"app": "db"},
      "mounts": [
        {
          "destination": "/var/lib/postgresql",
          "options": [],
          "source": "/Users/me/Library/Application Support/com.apple.container/volumes/postgres-data/volume.img",
          "type": {"volume": {"format": "ext4", "name": "postgres-data"}}
        },
        {
          "destination": "/etc/conf",
          "options": ["ro"],
          "source": "/Users/me/conf",
          "type": {"virtiofs": {}}
        }
      ],
      "networks": [{"network": "default", "options": {"hostname": "postgres", "mtu": 1280}}],
      "publishedPorts": [{"containerPort": 5432, "count": 1, "hostAddress": "0.0.0.0", "hostPort": 5432, "proto": "tcp"}],
      "resources": {"cpuOverhead": 1, "cpus": 2, "memoryInBytes": 2147483648}
    },
    "id": "postgres",
    "status": {"startedDate": "2026-08-17T07:12:14Z", "state": "running"}
  },
  {
    "configuration": {
      "creationDate": "2026-08-16T19:11:09Z",
      "id": "worker",
      "image": {"reference": "docker.io/library/alpine:3.20"},
      "labels": {},
      "mounts": [],
      "networks": [],
      "publishedPorts": [],
      "resources": {"cpus": 1, "memoryInBytes": 536870912}
    },
    "id": "worker",
    "status": {"state": "stopped"}
  }
]`

func TestParseContainerList(t *testing.T) {
	containers, err := parseContainerList([]byte(listFixture))
	if err != nil {
		t.Fatalf("parseContainerList: %v", err)
	}

	if len(containers) != 2 {
		t.Fatalf("got %d containers, want 2", len(containers))
	}

	pg := containers[0]
	if pg.ID != "postgres" || pg.Name != "postgres" {
		t.Errorf("id/name = %q/%q", pg.ID, pg.Name)
	}
	if pg.Image != "docker.io/library/postgres:18.6" {
		t.Errorf("image = %q", pg.Image)
	}
	// Which image the reference meant at creation. The runtime reports it under
	// the descriptor and nowhere else, and without it there is nothing to
	// notice a rebuilt tag against.
	if pg.ImageDigest != "sha256:4d1f5a" {
		t.Errorf("image digest = %q", pg.ImageDigest)
	}
	if pg.Status != "running" || pg.State != "running" {
		t.Errorf("status/state = %q/%q", pg.Status, pg.State)
	}
	if pg.CreatedAt != "2026-08-17T07:12:13Z" || pg.StartedAt != "2026-08-17T07:12:14Z" {
		t.Errorf("timestamps = %q/%q", pg.CreatedAt, pg.StartedAt)
	}
	if pg.CPUAllocation != 2 || pg.MemoryAllocation != "2048m" {
		t.Errorf("resources = %d/%q", pg.CPUAllocation, pg.MemoryAllocation)
	}
	if pg.Labels["app"] != "db" {
		t.Errorf("labels = %v", pg.Labels)
	}
	if len(pg.EnvironmentVars) != 1 || pg.EnvironmentVars[0] != "POSTGRES_USER=postgres" {
		t.Errorf("env = %v", pg.EnvironmentVars)
	}

	if len(pg.Ports) != 1 {
		t.Fatalf("got %d ports, want 1", len(pg.Ports))
	}
	if pg.Ports[0] != (Port{Host: "5432", Container: "5432", Protocol: "tcp"}) {
		t.Errorf("port = %+v", pg.Ports[0])
	}

	if len(pg.Mounts) != 2 {
		t.Fatalf("got %d mounts, want 2", len(pg.Mounts))
	}
	// A volume mount surfaces its volume name, not the backing image path.
	want := Mount{Source: "postgres-data", Destination: "/var/lib/postgresql", Type: "volume"}
	if pg.Mounts[0] != want {
		t.Errorf("volume mount = %+v, want %+v", pg.Mounts[0], want)
	}
	if !pg.Mounts[1].ReadOnly || pg.Mounts[1].Source != "/Users/me/conf" {
		t.Errorf("bind mount = %+v", pg.Mounts[1])
	}

	worker := containers[1]
	if worker.Status != "stopped" {
		t.Errorf("worker status = %q", worker.Status)
	}
	if worker.StartedAt != "" {
		t.Errorf("stopped container has startedAt = %q", worker.StartedAt)
	}
	// A container with no network still needs a usable name.
	if worker.Name != "worker" {
		t.Errorf("worker name = %q", worker.Name)
	}
	// Nothing is invented for a listing that carries no descriptor: an unknown
	// digest is compared against nothing, which is what an older CLI gets.
	if worker.ImageDigest != "" {
		t.Errorf("invented an image digest: %q", worker.ImageDigest)
	}
	// JSON encoding relies on these being non-nil so the UI never sees null.
	if worker.Ports == nil || worker.Mounts == nil || worker.Labels == nil {
		t.Errorf("nil slices/maps on %+v", worker)
	}
}

func TestParseContainerListEmpty(t *testing.T) {
	containers, err := parseContainerList([]byte(`[]`))
	if err != nil {
		t.Fatalf("parseContainerList: %v", err)
	}
	if len(containers) != 0 {
		t.Fatalf("got %d containers, want 0", len(containers))
	}
}

func TestFormatMebibytes(t *testing.T) {
	cases := map[int64]string{
		2147483648: "2048m",
		536870912:  "512m",
		0:          "",
		-1:         "",
	}

	for in, want := range cases {
		if got := formatMebibytes(in); got != want {
			t.Errorf("formatMebibytes(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestParseLogsLine(t *testing.T) {
	entry := ParseLogsLine("2026-08-17T14:22:15Z PostgreSQL started")
	if entry["timestamp"] != "2026-08-17T14:22:15Z" || entry["message"] != "PostgreSQL started" {
		t.Errorf("timestamped line = %v", entry)
	}

	// Lines without a leading timestamp keep their first word.
	entry = ParseLogsLine("LOG:  database system is ready")
	if entry["timestamp"] != "" || entry["message"] != "LOG:  database system is ready" {
		t.Errorf("plain line = %v", entry)
	}
}

// Apple's CLI takes one --network per attachment, so a container on two
// networks has to render two flags -- and a round trip through SpecOf has to
// keep both, or editing a container quietly drops one of its networks.
func TestSpecArgsRendersEveryNetwork(t *testing.T) {
	spec := ContainerSpec{Image: "alpine:latest", Networks: []string{"frontend", "backend"}}

	args := spec.Args()
	var seen []string
	for i, arg := range args {
		if arg == "--network" && i+1 < len(args) {
			seen = append(seen, args[i+1])
		}
	}

	if len(seen) != 2 || seen[0] != "frontend" || seen[1] != "backend" {
		t.Fatalf("got networks %v, want [frontend backend]", seen)
	}
}

func TestSpecOfKeepsEveryNetwork(t *testing.T) {
	spec := SpecOf(&Container{Name: "api", Image: "alpine", Networks: []string{"frontend", "backend"}})

	if len(spec.Networks) != 2 || spec.Networks[0] != "frontend" || spec.Networks[1] != "backend" {
		t.Fatalf("got networks %v, want [frontend backend]", spec.Networks)
	}
}

// Every edit, attach and detach goes through delete-and-run, so a setting the
// spec forgets is a setting the container silently loses: a read-only root
// comes back writable, a dropped capability comes back granted. Anything the
// CLI both reports and accepts as a flag has to survive the round trip.
func TestSpecOfSurvivesARecreate(t *testing.T) {
	hardened := &Container{
		Name:           "api",
		Image:          "alpine",
		ReadOnlyRoot:   true,
		UseInit:        true,
		Terminal:       true,
		Rosetta:        true,
		Virtualization: true,
		SSH:            true,
		Platform:       "linux/arm64",
		RuntimeHandler: "container-runtime-linux",
		CapAdd:         []string{"CAP_NET_RAW"},
		CapDrop:        []string{"CAP_MKNOD"},
		DNS: DNSConfig{
			Nameservers:   []string{"1.1.1.1"},
			SearchDomains: []string{"example.com"},
			Options:       []string{"ndots:2"},
			Domain:        "corp.local",
		},
	}

	args := SpecOf(hardened).Args()
	rendered := strings.Join(args, " ")

	for _, want := range []string{
		"--read-only", "--init", "--tty", "--rosetta", "--virtualization", "--ssh",
		"--platform linux/arm64", "--runtime container-runtime-linux",
		"--cap-add CAP_NET_RAW", "--cap-drop CAP_MKNOD",
		"--dns 1.1.1.1", "--dns-search example.com", "--dns-option ndots:2",
		"--dns-domain corp.local",
	} {
		if !strings.Contains(rendered, want) {
			t.Errorf("recreating drops %q\ngot: %s", want, rendered)
		}
	}
}

// A container that asked for nothing must not come back asking for something:
// an empty DNS block means "whatever the CLI does by default", which is not
// the same as no nameservers at all.
func TestSpecOfLeavesDefaultsAlone(t *testing.T) {
	args := strings.Join(SpecOf(&Container{Name: "api", Image: "alpine"}).Args(), " ")

	for _, unwanted := range []string{"--dns", "--read-only", "--init", "--tty", "--cap-add"} {
		if strings.Contains(args, unwanted) {
			t.Errorf("plain container gained %q: %s", unwanted, args)
		}
	}
}

// Apple's builder shares the list with somebody's containers and is not one of
// them: `container build` makes it, `container builder` manages it, and
// deleting it only means the next build makes another exactly like it.
func TestApplesBuilderIsNotSomebodysContainer(t *testing.T) {
	builder := Container{Name: "buildkit", Image: "ghcr.io/apple/container-builder-shim/builder:0.13.1"}
	if !IsBuilder(builder) {
		t.Error("the builder image should be recognised")
	}

	// Matched on the image, because the name is convention rather than
	// anything Dermaga is owed.
	renamed := Container{Name: "something-else", Image: "ghcr.io/apple/container-builder-shim/builder:0.13.1"}
	if !IsBuilder(renamed) {
		t.Error("a renamed builder is still the builder")
	}

	for _, theirs := range []Container{
		{Name: "buildkit", Image: "docker.io/library/redis:8-alpine"},
		{Name: "redis", Image: "redis:8.10-alpine"},
		{Name: "builder", Image: "ghcr.io/someone/builder:1"},
	} {
		if IsBuilder(theirs) {
			t.Errorf("%s (%s) is somebody's container", theirs.Name, theirs.Image)
		}
	}
}

// Once a DNS domain is configured the runtime reports hostnames fully
// qualified, root dot and all. A list of containers named "whoami.internal."
// is a list nobody asked for -- and the domain is the same for every row, so
// repeating it forty times only takes space from the part that differs.
func TestAContainerIsNamedWithoutItsDomain(t *testing.T) {
	cases := map[string]string{
		"whoami.internal.": "whoami",
		"whoami.internal":  "whoami",
		"whoami":           "whoami",
		"":                 "",
		".":                "",
		"redis.test.":      "redis",
	}

	for hostname, want := range cases {
		if got := firstLabel(hostname); got != want {
			t.Errorf("firstLabel(%q) = %q, want %q", hostname, got, want)
		}
	}
}

// A container outlives its image: delete the image of something still running
// and the blobs go with it. What the window reports about it should not fall
// from "6379" to nothing while the container carries on listening on 6379.
func TestWhatAnImageListensOnOutlivesTheImage(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	db, err := store.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	blobs := t.TempDir()
	config := writeBlob(t, blobs, `{"config":{"ExposedPorts":{"6379/tcp":{}}}}`)
	manifest := writeBlob(t, blobs, `{"config":{"digest":"`+config+`"}}`)

	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))

	// While the image is there, it is the authority and the answer is kept.
	first := NewManager(nil, quiet, notify.Nop)
	first.blobs = oci.OpenAt(blobs)
	first.UseStore(db)

	list := []Container{{ImageDigest: manifest}}
	first.applyExposedPorts(list)

	if len(list[0].ExposedPorts) != 1 || list[0].ExposedPorts[0] != "6379/tcp" {
		t.Fatalf("read from the image = %v", list[0].ExposedPorts)
	}

	// The image is deleted. A manager with nothing left to read still answers,
	// because what it read was written down.
	second := NewManager(nil, quiet, notify.Nop)
	second.blobs = oci.OpenAt(t.TempDir())
	second.UseStore(db)

	after := []Container{{ImageDigest: manifest}}
	second.applyExposedPorts(after)

	if len(after[0].ExposedPorts) != 1 || after[0].ExposedPorts[0] != "6379/tcp" {
		t.Errorf("remembered = %v, want the ports to survive the image", after[0].ExposedPorts)
	}

	// And an image nobody ever read is still simply unknown.
	unknown := []Container{{ImageDigest: "sha256:" + strings.Repeat("b", 64)}}
	second.applyExposedPorts(unknown)

	if unknown[0].ExposedPorts != nil {
		t.Errorf("invented ports for an image never seen: %v", unknown[0].ExposedPorts)
	}
}

// writeBlob puts one blob in a content store under its own digest.
func writeBlob(t *testing.T, root, content string) string {
	t.Helper()

	sum := sha256.Sum256([]byte(content))
	name := hex.EncodeToString(sum[:])

	if err := os.WriteFile(filepath.Join(root, name), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	return "sha256:" + name
}

// The record wins, and the label still carries the containers made before there
// was one.
//
// NOTE: TEMPORARY — the label half of this goes in 1.15.0, with the fallback
// it tests.
func TestWhatDermagaKeepsBeatsTheLabelItUsedToWrite(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	db, err := store.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	cm := NewManager(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), notify.Nop)
	cm.UseStore(db)

	if err := cm.SetSettings("recorded-off", Settings{AutoBoot: false}); err != nil {
		t.Fatal(err)
	}
	if err := cm.SetSettings("recorded-on", Settings{AutoBoot: true}); err != nil {
		t.Fatal(err)
	}

	list := []Container{
		// Made before this changed: the label is all it has, and it is enough.
		{Name: "labelled", Labels: map[string]string{"dermaga.autoboot": "true"}},
		// Turned off since. A label alone could never say this: it cannot be
		// removed without recreating the container.
		{Name: "recorded-off", Labels: map[string]string{"dermaga.autoboot": "true"}},
		{Name: "recorded-on", Labels: map[string]string{}},
		{Name: "plain", Labels: map[string]string{}},
	}

	cm.applySettings(list)

	for _, want := range []struct {
		name     string
		autoBoot bool
	}{
		{"labelled", true},
		{"recorded-off", false},
		{"recorded-on", true},
		{"plain", false},
	} {
		for _, got := range list {
			if got.Name == want.name && got.AutoBoot != want.autoBoot {
				t.Errorf("%s: autoBoot = %v, want %v", want.name, got.AutoBoot, want.autoBoot)
			}
		}
	}
}

// A name freed and taken again must not inherit what was kept about the last
// container to hold it.
func TestARecordDoesNotOutliveTheContainerItIsAbout(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	db, err := store.Open()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	cm := NewManager(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), notify.Nop)
	cm.UseStore(db)

	if err := cm.SetSettings("api", Settings{AutoBoot: true}); err != nil {
		t.Fatal(err)
	}
	if err := cm.SetSettings("worker", Settings{AutoBoot: true}); err != nil {
		t.Fatal(err)
	}

	// `worker` was deleted from a terminal, so nothing in this process saw it
	// go. Startup is where that is noticed.
	cm.PruneSettings([]Container{{Name: "api", ID: "api"}})

	if !cm.Settings("api").AutoBoot {
		t.Error("pruned a record whose container is still here")
	}
	if cm.Settings("worker").AutoBoot {
		t.Error("kept a record for a container that has gone")
	}

	// And it is gone from the database too, not just from this process.
	var raw Settings
	if found, _ := db.Get(store.BucketContainers, "worker", &raw); found {
		t.Error("the record was left on disk")
	}
}

// The runtime writes a bind mount as `type=bind` and reports it back as
// `virtiofs`. Untranslated, the edit form's type selector did not recognise it
// and fell back to `volume` -- and what a selector shows is what a save sends,
// so recreating turned a bind onto somebody's source directory into a request
// for a volume named after a path.
func TestMountKindReadsVirtiofsAsBind(t *testing.T) {
	if got := mountKind("virtiofs"); got != "bind" {
		t.Fatalf("want bind, got %q", got)
	}
}

func TestMountKindLeavesAVolumeAlone(t *testing.T) {
	if got := mountKind("volume"); got != "volume" {
		t.Fatalf("want volume, got %q", got)
	}
}

// A kind nobody has seen yet is passed through rather than guessed at: wrong
// and visible beats wrong and disguised as something familiar.
func TestMountKindPassesThroughWhatItDoesNotKnow(t *testing.T) {
	if got := mountKind("tmpfs"); got != "tmpfs" {
		t.Fatalf("want tmpfs, got %q", got)
	}
}
