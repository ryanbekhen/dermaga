package scanner

import (
	"testing"
	"time"
)

// The shape apk actually writes, taken from alpine:3.20's own database: records
// separated by a blank line, "S:" the download size and "I:" the installed one.
// The two are easy to confuse and only one of them answers "how much room does
// this take", so the parser is pinned to it.
func TestParseApkSizesReadsInstalledNotDownload(t *testing.T) {
	body := []byte("C:Q1x\nP:alpine-baselayout\nV:3.6.5-r0\nS:8504\nI:315392\nL:GPL-2.0-only\n\nP:musl\nV:1.2.5-r0\nI:634880\n\n")

	sizes := parseApkSizes(body)

	if sizes["alpine-baselayout"] != 315392 {
		t.Fatalf("alpine-baselayout = %d, want the installed size 315392", sizes["alpine-baselayout"])
	}
	if sizes["musl"] != 634880 {
		t.Fatalf("musl = %d, want 634880", sizes["musl"])
	}
	if len(sizes) != 2 {
		t.Fatalf("read %d packages, want 2", len(sizes))
	}
}

// A package with no size recorded is left out rather than reported as zero:
// "nothing" and "not stated" are different answers.
func TestParseApkSizesSkipsRecordsWithoutOne(t *testing.T) {
	sizes := parseApkSizes([]byte("P:with\nI:2048\n\nP:without\nV:1.0\n\n"))

	if _, ok := sizes["without"]; ok {
		t.Fatal("a package with no I: line should not be reported")
	}
	if sizes["with"] != 2048 {
		t.Fatalf("with = %d, want 2048", sizes["with"])
	}
}

// dpkg states its Installed-Size in kibibytes, so the number in the file is a
// thousandth of the answer. Reporting it raw would have made every Debian
// package look a thousand times smaller than it is.
func TestParseDpkgSizesConvertsFromKibibytes(t *testing.T) {
	body := []byte("Package: bash\nStatus: install ok installed\nInstalled-Size: 1024\n\nPackage: coreutils\nInstalled-Size: 17\n\n")

	sizes := parseDpkgSizes(body)

	if sizes["bash"] != 1024*1024 {
		t.Fatalf("bash = %d, want %d", sizes["bash"], 1024*1024)
	}
	if sizes["coreutils"] != 17*1024 {
		t.Fatalf("coreutils = %d, want %d", sizes["coreutils"], 17*1024)
	}
}

// Trivy reports the layers itself, under capitalised keys -- "Size", "Digest"
// -- while Dermaga's own shape uses lowercase ones because that is what the
// window reads. Go's decoder matches those case-insensitively, which is why
// one struct can serve both; it is subtle enough to be worth pinning down, so
// that nobody "fixes" the tags and quietly loses every layer size.
func TestParseReportTakesLayerSizesFromTrivy(t *testing.T) {
	out := []byte(`{
      "Metadata": {
        "OS": {"Family": "alpine", "Name": "3.22.4"},
        "Layers": [
          {"Size": 8860672, "Digest": "sha256:58e777", "DiffID": "sha256:eeaa73"},
          {"Size": 87413760, "Digest": "sha256:1ff8ce", "DiffID": "sha256:7d3c7c"}
        ]
      },
      "Results": []
    }`)

	report, err := parseReport("bun:1.3-alpine", out)
	if err != nil {
		t.Fatal(err)
	}

	if len(report.Layers) != 2 {
		t.Fatalf("%d layers, want 2", len(report.Layers))
	}
	if report.Layers[0].SizeInBytes != 8860672 {
		t.Fatalf("first layer = %d, want 8860672", report.Layers[0].SizeInBytes)
	}
	if report.Layers[1].Digest != "sha256:1ff8ce" {
		t.Fatalf("second digest = %q", report.Layers[1].Digest)
	}
	// Order is the manifest's, which is build order -- the nth layer belongs to
	// the nth layer-producing step of the history.
	if report.Layers[0].SizeInBytes >= report.Layers[1].SizeInBytes {
		t.Fatal("layers were reordered; they must stay in the order Trivy gave them")
	}
}

// Everything a finding carries, taken from a real Trivy record.
//
// The fields below are the whole reason a finding can be opened at all, and
// they arrive under names that do not match ours -- PkgName, CweIDs,
// PrimaryURL, a CVSS map keyed by vendor. Nothing about a missing one fails
// loudly: the detail panel simply shows less, which is exactly how a scan made
// by an older build looks, so a mistake here would be invisible.
func TestParseReportKeepsEverythingAboutAFinding(t *testing.T) {
	out := []byte(`{
      "Metadata": {"OS": {"Family": "debian", "Name": "12.15"}},
      "Results": [{
        "Target": "debian 12.15",
        "Type": "debian",
        "Vulnerabilities": [{
          "VulnerabilityID": "CVE-2026-13221",
          "PkgName": "perl-base",
          "InstalledVersion": "5.36.0-7+deb12u2",
          "Status": "affected",
          "Severity": "MEDIUM",
          "Title": "perl: Incorrect regular expression processing",
          "Description": "A flaw was found in perl.",
          "PrimaryURL": "https://avd.aquasec.com/nvd/cve-2026-13221",
          "CweIDs": ["CWE-1333"],
          "PublishedDate": "2026-01-02T00:00:00Z",
          "LastModifiedDate": "2026-03-04T00:00:00Z",
          "References": ["https://example.invalid/a", "https://example.invalid/b"],
          "Layer": {"Digest": "sha256:abc123", "DiffID": "sha256:def456"},
          "DataSource": {"ID": "debian", "Name": "Debian Security Tracker", "URL": "https://x.invalid"},
          "CVSS": {
            "nvd": {"V3Vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H", "V3Score": 7.5},
            "redhat": {"V3Vector": "CVSS:3.1/AV:L/AC:H/PR:L/UI:N/S:U/C:N/I:N/A:L", "V3Score": 3.3}
          }
        }]
      }]
    }`)

	report, err := parseReport("redis:7", out)
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Findings) != 1 {
		t.Fatalf("%d findings, want 1", len(report.Findings))
	}

	f := report.Findings[0]

	if f.Status != "affected" {
		t.Errorf("status = %q", f.Status)
	}
	if f.Description == "" {
		t.Error("description was dropped")
	}
	if len(f.Weaknesses) != 1 || f.Weaknesses[0] != "CWE-1333" {
		t.Errorf("weaknesses = %v", f.Weaknesses)
	}
	if f.Published == "" || f.LastModified == "" {
		t.Errorf("dates = %q / %q", f.Published, f.LastModified)
	}
	if len(f.References) != 2 {
		t.Errorf("%d references, want 2", len(f.References))
	}
	if f.Layer != "sha256:abc123" {
		t.Errorf("layer = %q", f.Layer)
	}
	if f.SourceName != "Debian Security Tracker" {
		t.Errorf("source = %q", f.SourceName)
	}

	// The headline is the worst score anybody gave it, carrying that vendor's
	// vector so the number and the words underneath cannot disagree.
	if f.Score != 7.5 {
		t.Errorf("score = %v, want the highest of 7.5 and 3.3", f.Score)
	}
	if f.Vector != "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H" {
		t.Errorf("vector = %q, want the one belonging to the 7.5", f.Vector)
	}

	// Every vendor is kept, in a stable order -- a Go map is walked differently
	// every time, and a panel that reshuffles between scans looks broken.
	if len(f.Ratings) != 2 {
		t.Fatalf("%d ratings, want 2", len(f.Ratings))
	}
	if f.Ratings[0].Source != "nvd" || f.Ratings[1].Source != "redhat" {
		t.Errorf("ratings out of order: %v", f.Ratings)
	}
}

// One flaw in twenty places is one flaw.
//
// Trivy reports a result per thing it read, and the same library is read out of
// every binary built with it -- so a flaw in Go's standard library came back
// once per Go binary. An image of Go binaries reported nine hundred findings
// where there were forty-five, listed as identical rows nobody could use, and
// the severity counts were nine hundred too.
func TestAFlawFoundInSeveralBinariesIsCountedOnce(t *testing.T) {
	out := []byte(`{
      "Results": [
        {
          "Target": "usr/local/go/bin/go",
          "Type": "gobinary",
          "Vulnerabilities": [
            {"VulnerabilityID": "CVE-2025-61729", "PkgName": "stdlib", "InstalledVersion": "1.23.12", "Severity": "HIGH"},
            {"VulnerabilityID": "CVE-2025-68121", "PkgName": "stdlib", "InstalledVersion": "1.23.12", "Severity": "LOW"}
          ]
        },
        {
          "Target": "usr/local/go/pkg/tool/linux_arm64/compile",
          "Type": "gobinary",
          "Vulnerabilities": [
            {"VulnerabilityID": "CVE-2025-61729", "PkgName": "stdlib", "InstalledVersion": "1.23.12", "Severity": "HIGH"}
          ]
        },
        {
          "Target": "usr/bin/other",
          "Type": "gobinary",
          "Vulnerabilities": [
            {"VulnerabilityID": "CVE-2025-61729", "PkgName": "stdlib", "InstalledVersion": "1.23.12", "Severity": "HIGH"}
          ]
        }
      ]
    }`)

	report, err := parseReport("golang:1.23-alpine", out)
	if err != nil {
		t.Fatal(err)
	}

	if len(report.Findings) != 2 {
		t.Fatalf("got %d findings, want 2 distinct", len(report.Findings))
	}

	places := map[string]int{}
	for _, finding := range report.Findings {
		places[finding.ID] = finding.Places
	}

	if places["CVE-2025-61729"] != 3 {
		t.Errorf("places = %d, want the three binaries it was read out of", places["CVE-2025-61729"])
	}
	// One place is still worth recording; the window shows it only above one.
	if places["CVE-2025-68121"] != 1 {
		t.Errorf("a flaw in one binary has %d places", places["CVE-2025-68121"])
	}

	if report.Summary["HIGH"] != 1 || report.Summary["LOW"] != 1 {
		t.Errorf("summary = %v, want one of each", report.Summary)
	}
}

// A different version of the same package is a different flaw to fix, even
// under the same CVE -- two Pythons in an image, patched to different levels.
func TestTheSameFlawInTwoVersionsStaysTwoFindings(t *testing.T) {
	out := []byte(`{
      "Results": [
        {
          "Target": "python",
          "Type": "python-pkg",
          "Vulnerabilities": [
            {"VulnerabilityID": "CVE-2025-47273", "PkgName": "setuptools", "InstalledVersion": "70.3.0", "Severity": "HIGH"},
            {"VulnerabilityID": "CVE-2025-47273", "PkgName": "setuptools", "InstalledVersion": "84.0.0", "Severity": "HIGH"}
          ]
        }
      ]
    }`)

	report, err := parseReport("app:latest", out)
	if err != nil {
		t.Fatal(err)
	}

	if len(report.Findings) != 2 {
		t.Fatalf("got %d findings, want one per version", len(report.Findings))
	}
	if report.Summary["HIGH"] != 2 {
		t.Errorf("summary = %v, want both counted", report.Summary)
	}
}

// Raising the format is how every stored result is made stale at once, which is
// what a change to the way findings are counted needs.
func TestAReportInAnOlderShapeIsOutOfDate(t *testing.T) {
	m := &Manager{}

	if !m.outdatedResult(Report{ScannedAt: time.Now().UTC().Format(time.RFC3339)}) {
		t.Error("a report with no format was trusted; nothing before this had one")
	}

	fresh := Report{Format: reportFormat, ScannedAt: time.Now().UTC().Format(time.RFC3339)}
	if m.outdatedResult(fresh) {
		t.Error("a report in today's shape was thrown away")
	}
}

// The same library, read out of every binary built with it, is one thing
// installed -- not six. It was six rows in the list, each with the same name,
// the same version and the same findings hanging off it.
func TestAPackageReadOutOfSeveralBinariesIsOneRow(t *testing.T) {
	out := []byte(`{
      "Results": [
        {"Target": "usr/local/go/bin/go", "Type": "gobinary",
         "Packages": [{"Name": "stdlib", "Version": "1.23.12"}]},
        {"Target": "usr/local/go/pkg/tool/linux_arm64/compile", "Type": "gobinary",
         "Packages": [{"Name": "stdlib", "Version": "1.23.12"}]},
        {"Target": "usr/bin/other", "Type": "gobinary",
         "Packages": [{"Name": "stdlib", "Version": "1.23.12"}, {"Name": "golang.org/x/net", "Version": "0.30.0"}]}
      ]
    }`)

	report, err := parseReport("golang:1.23-alpine", out)
	if err != nil {
		t.Fatal(err)
	}

	if len(report.Packages) != 2 {
		t.Fatalf("got %d packages, want stdlib and x/net", len(report.Packages))
	}

	for _, pkg := range report.Packages {
		switch pkg.Name {
		case "stdlib":
			if pkg.Places != 3 {
				t.Errorf("stdlib places = %d, want the three binaries", pkg.Places)
			}
			// The first one it was read out of, so the row can still say where.
			if pkg.Source != "usr/local/go/bin/go" {
				t.Errorf("stdlib source = %q", pkg.Source)
			}
		case "golang.org/x/net":
			if pkg.Places != 1 {
				t.Errorf("x/net places = %d, want one", pkg.Places)
			}
		}
	}
}

// Two versions of the same package are two things to deal with, and stay two
// rows -- the same rule the findings follow.
func TestTwoVersionsOfAPackageStayApart(t *testing.T) {
	out := []byte(`{
      "Results": [
        {"Target": "python", "Type": "python-pkg",
         "Packages": [{"Name": "setuptools", "Version": "70.3.0"}, {"Name": "setuptools", "Version": "84.0.0"}]}
      ]
    }`)

	report, err := parseReport("app:latest", out)
	if err != nil {
		t.Fatal(err)
	}

	if len(report.Packages) != 2 {
		t.Fatalf("got %d packages, want one per version", len(report.Packages))
	}
}
