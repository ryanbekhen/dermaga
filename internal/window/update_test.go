package window

import "testing"

// Whether anybody is ever offered an update comes down to this comparison, and
// it had none of its own tests: a release that goes out with this wrong is a
// release nobody is told about, and nothing in the app would say so.
func TestVersionsCompareByWhatTheyMean(t *testing.T) {
	cases := []struct {
		candidate, current string
		want               bool
		why                string
	}{
		{"1.7.0", "1.6.1", true, "a new minor is an update"},
		{"1.6.2", "1.6.1", true, "so is a new patch"},
		{"2.0.0", "1.9.9", true, "and a new major"},
		{"1.6.1", "1.6.1", false, "the version already running is not an update"},
		{"1.6.0", "1.6.1", false, "nor is an older one, whatever GitHub calls latest"},
		{"1.10.0", "1.9.0", true, "ten is after nine, which string order would disagree with"},
		{"v1.7.0", "1.6.1", true, "the tag's v is not part of the version"},
		{"1.7", "1.6.1", true, "a two-part version still says what it means"},
	}

	for _, c := range cases {
		if got := isNewer(c.candidate, c.current); got != c.want {
			t.Errorf("isNewer(%q, %q) = %v, want %v -- %s", c.candidate, c.current, got, c.want, c.why)
		}
	}
}

func TestTheUpdateOfferedIsTheOneThatCanBeInstalled(t *testing.T) {
	release := githubRelease{
		TagName: "v1.7.0",
		HTMLURL: "https://github.com/ryanbekhen/dermaga/releases/tag/v1.7.0",
		Assets: []releaseAsset{
			// GitHub adds these on its own, and they are first in the list.
			{Name: "Source code (zip)", URL: "https://example.invalid/zip", Size: 10},
			{Name: "Dermaga-1.7.0-arm64.dmg", URL: "https://example.invalid/dmg", Size: 10276761},
		},
	}

	got := updateFromRelease(release, "1.6.1")

	if !got.Available {
		t.Fatal("a newer release with a DMG in it is an update")
	}
	if got.Version != "1.7.0" {
		t.Errorf("version: got %q", got.Version)
	}
	if got.AssetURL != "https://example.invalid/dmg" {
		t.Errorf("the DMG is what gets downloaded, not the first asset: got %q", got.AssetURL)
	}
	if got.Size != 10276761 {
		t.Errorf("size: got %d", got.Size)
	}
	if got.Current != "1.6.1" {
		t.Errorf("current: got %q", got.Current)
	}
}

// A release nobody can install is not worth interrupting anybody about. It
// happens: a tag pushed before the DMG has finished uploading is exactly this,
// and the window would otherwise offer an update that downloads nothing.
func TestNoInstallerMeansNoUpdate(t *testing.T) {
	release := githubRelease{
		TagName: "v1.7.0",
		Assets:  []releaseAsset{{Name: "Source code (tar.gz)", URL: "https://example.invalid/tar"}},
	}

	if got := updateFromRelease(release, "1.6.1"); got.Available {
		t.Error("a release with no DMG should not be offered")
	}
}

func TestRunningTheLatestIsNotAnUpdate(t *testing.T) {
	release := githubRelease{
		TagName: "v1.6.1",
		Assets:  []releaseAsset{{Name: "Dermaga-1.6.1-arm64.dmg", URL: "https://example.invalid/dmg"}},
	}

	got := updateFromRelease(release, "1.6.1")

	if got.Available {
		t.Error("the version already running should not be offered as an update")
	}
	if got.Current != "1.6.1" {
		t.Errorf("the answer should still say what is running: got %q", got.Current)
	}
}
