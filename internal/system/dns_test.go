package system

import (
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
)

func quiet() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

// Whatever is in that file was put there by the person whose machine this is.
// Disagreeing with somebody's own configuration is worse than doing nothing.
func TestADomainAlreadyChosenIsLeftAlone(t *testing.T) {
	for _, config := range []string{
		"[dns]\ndomain = \"test\"\n",
		"[registry]\ndefault = \"docker.io\"\n\n[dns]\ndomain = \"lab\"\n",
		"[dns]\n  domain = 'dev'\n",
	} {
		if !hasDomain(config) {
			t.Errorf("this already names a domain and should be left alone:\n%s", config)
		}
	}
}

// A domain key belonging to another section is not this one. Reading the file
// loosely enough to confuse them would mean never setting anything up on a
// machine that happens to configure something else.
func TestADomainUnderAnotherSectionDoesNotCount(t *testing.T) {
	for _, config := range []string{
		"",
		"[network]\nsubnet = \"192.168.100.0/24\"\n",
		"[dns]\n\n[network]\ndomain = \"nope\"\n",
		"[kernel]\ndomain = \"not-dns\"\n",
	} {
		if hasDomain(config) {
			t.Errorf("nothing here sets a DNS domain:\n%s", config)
		}
	}
}

func TestItIsWrittenWhenNobodyHasChosen(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	written, err := EnsureDomain(quiet())
	if err != nil {
		t.Fatalf("EnsureDomain: %v", err)
	}
	if !written {
		t.Fatal("nothing was set up, and nothing was there")
	}

	raw, err := os.ReadFile(filepath.Join(home, ".config", "container", "config.toml"))
	if err != nil {
		t.Fatalf("no configuration was written: %v", err)
	}

	if !hasDomain(string(raw)) {
		t.Errorf("what was written does not name a domain:\n%s", raw)
	}

	// Twice is not twice: the second run has nothing to do, which is what stops
	// this restarting the services on every launch.
	again, err := EnsureDomain(quiet())
	if err != nil {
		t.Fatal(err)
	}
	if again {
		t.Error("it wrote again over its own work")
	}
}

// Everything else in that file belongs to somebody else, and a rewrite is how a
// tool loses somebody's settings while meaning well.
func TestTheRestOfTheConfigurationSurvives(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	path := filepath.Join(home, ".config", "container", "config.toml")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}

	theirs := "[kernel]\nbinaryPath = \"opt/kata/vmlinux\"\n\n[network]\nsubnet = \"192.168.100.0/24\"\n"
	if err := os.WriteFile(path, []byte(theirs), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := EnsureDomain(quiet()); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	got := string(raw)
	for _, kept := range []string{"[kernel]", "opt/kata/vmlinux", "[network]", "192.168.100.0/24"} {
		if !contains(got, kept) {
			t.Errorf("%q was lost:\n%s", kept, got)
		}
	}
	if !hasDomain(got) {
		t.Errorf("the domain was not added:\n%s", got)
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && (haystack == needle ||
		len(needle) == 0 || indexOf(haystack, needle) >= 0)
}

func indexOf(haystack, needle string) int {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return i
		}
	}
	return -1
}
