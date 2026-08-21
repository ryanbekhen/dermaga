package scanner

import (
	"context"
	"io"
	"log/slog"
	"testing"
)

// quiet is a Manager with somewhere for its logging to go and nothing else.
func quiet() *Manager {
	return &Manager{logger: slog.New(slog.NewTextHandler(io.Discard, nil))}
}

// An image built for another architecture cannot be exported on this Mac, so it
// cannot be scanned on it either. Left in the sweep it was attempted on every
// pass, failed on every pass, and parked a warning in the status bar that no
// amount of waiting would clear -- with the reason buried in a Trivy export
// error nobody should have to read:
//
//	image ... has no content for platform linux/arm64/v8;
//	available platforms: linux/amd64
func TestAnImageWithoutThisArchitectureIsNotScanned(t *testing.T) {
	cases := []struct {
		name      string
		platforms []string
		want      bool
	}{
		{"the usual case", []string{"linux/arm64"}, true},
		{"multi-arch", []string{"linux/amd64", "linux/arm64"}, true},
		{"a variant is still this architecture", []string{"linux/arm64/v8"}, true},
		{"intel only", []string{"linux/amd64"}, false},
		{"somebody else's platform", []string{"windows/amd64", "linux/s390x"}, false},
		// The runtime not saying is not the same as the image being empty:
		// scanning and finding out beats skipping something scannable.
		{"nothing reported", nil, true},
	}

	for _, c := range cases {
		got := ImageRef{Reference: "example", Platforms: c.platforms}.scannable()
		if got != c.want {
			t.Errorf("%s: scannable(%v) = %v, want %v", c.name, c.platforms, got, c.want)
		}
	}
}

// Deleting the image is the most likely thing a person does about the warning,
// and doing so used to leave the warning behind with nothing left to explain it.
func TestAWarningGoesWithTheImageItWasAbout(t *testing.T) {
	m := quiet()
	m.fail("Could not scan example:latest", errTest{})
	m.mu.Lock()
	m.status.Target = "example:latest"
	m.mu.Unlock()

	// Still there: the warning stands.
	m.forgetStaleFailure([]ImageRef{{Reference: "example:latest"}})
	if m.Status().State != StateFailed {
		t.Error("a warning about an image that is still here should stand")
	}

	// Gone: so is the warning.
	m.forgetStaleFailure([]ImageRef{{Reference: "something-else:latest"}})
	if m.Status().State == StateFailed {
		t.Error("a warning about an image that has been deleted should go with it")
	}
	if m.Status().Error != "" {
		t.Errorf("and take its detail with it, got %q", m.Status().Error)
	}
}

// Only a failure is dismissed; work in progress is not something to wave away.
func TestOnlyAFailureCanBeDismissed(t *testing.T) {
	m := quiet()

	m.setState(StateScanning, "Scanning example…", 0)
	m.Dismiss()
	if m.Status().State != StateScanning {
		t.Error("a scan in progress should not be dismissable")
	}

	m.fail("Could not scan example", errTest{})
	m.Dismiss()
	if m.Status().State != StateIdle {
		t.Errorf("a failure should be dismissable, state is %q", m.Status().State)
	}
}

type errTest struct{}

func (errTest) Error() string { return "no content for platform linux/arm64" }

// Pressing Scan by hand used to go straight past every check, all the way to a
// failed export, and leave the warning behind -- for an image that can never be
// scanned here however many times it is asked.
func TestScanningByHandRefusesTheImpossible(t *testing.T) {
	m := quiet()
	m.queue = make(chan string, 4)
	m.SetSource(func(context.Context) ([]ImageRef, error) {
		return []ImageRef{
			{Reference: "intel-only:latest", Platforms: []string{"linux/amd64"}},
			{Reference: "ours:latest", Platforms: []string{"linux/arm64"}},
		}, nil
	})

	if err := m.Scan("intel-only:latest"); err == nil {
		t.Error("an image with nothing to scan here should be refused, with a reason")
	}

	if err := m.Scan("ours:latest"); err != nil {
		t.Errorf("an image that can be scanned should be queued: %v", err)
	}

	// An image the list has never heard of is attempted rather than refused:
	// not being able to ask the question is no reason to answer it.
	if err := m.Scan("unknown:latest"); err != nil {
		t.Errorf("an unknown image should still be attempted: %v", err)
	}
}

// A list that will not answer must not become a reason to refuse work.
func TestAnUnanswerableListLetsTheScanThrough(t *testing.T) {
	m := quiet()
	m.queue = make(chan string, 2)
	m.SetSource(func(context.Context) ([]ImageRef, error) {
		return nil, errTest{}
	})

	if err := m.Scan("anything:latest"); err != nil {
		t.Errorf("got %v", err)
	}
}
