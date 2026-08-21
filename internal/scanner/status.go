package scanner

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// versionPattern reads "0.74.0" out of "Version: 0.74.0".
var versionPattern = regexp.MustCompile(`Version:\s*(\S+)`)

// refreshStatus re-reads everything that can be learned without doing work.
func (m *Manager) refreshStatus(ctx context.Context) {
	installed := m.runner.Has(Formula)

	status := Status{
		Installed:     installed,
		BrewAvailable: m.runner.Has("brew"),
		State:         StateIdle,
	}

	if installed {
		if out, err := m.runner.Tool(ctx, Formula, "--version").Output(); err == nil {
			if match := versionPattern.FindSubmatch(out); len(match) == 2 {
				status.Version = string(match[1])
			}
		}
	}

	if meta, err := readDatabaseMetadata(); err == nil {
		status.DatabaseUpdatedAt = meta.UpdatedAt.UTC().Format(time.RFC3339)
		status.DatabaseNextAt = meta.NextUpdate.UTC().Format(time.RFC3339)
		status.DatabaseReady = true
	}

	m.mu.Lock()
	// Keep whatever the worker is currently reporting; this only refreshes the
	// facts around it.
	status.State = m.status.State
	status.Detail = m.status.Detail
	status.Percent = m.status.Percent
	status.Target = m.status.Target
	status.Position = m.status.Position
	status.Total = m.status.Total
	m.status = status
	m.mu.Unlock()

	m.announce()
}

type databaseMetadata struct {
	Version    int       `json:"Version"`
	NextUpdate time.Time `json:"NextUpdate"`
	UpdatedAt  time.Time `json:"UpdatedAt"`
}

// databasePath is where Trivy keeps the database it downloads. Reading its
// metadata is how staleness is judged without asking the network.
func databasePath() string {
	if dir := os.Getenv("TRIVY_CACHE_DIR"); dir != "" {
		return filepath.Join(dir, "db", "metadata.json")
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}

	return filepath.Join(home, "Library", "Caches", "trivy", "db", "metadata.json")
}

func readDatabaseMetadata() (databaseMetadata, error) {
	var meta databaseMetadata

	path := databasePath()
	if path == "" {
		return meta, os.ErrNotExist
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return meta, err
	}

	if err := json.Unmarshal(raw, &meta); err != nil {
		return meta, err
	}

	return meta, nil
}

// databaseStale is true when there is no database, or when Trivy's own
// NextUpdate has passed.
func (m *Manager) databaseStale() bool {
	meta, err := readDatabaseMetadata()
	if err != nil {
		return true
	}

	return time.Now().After(meta.NextUpdate)
}

// followProgress turns Trivy's terminal progress bar into a percentage. The bar
// redraws with carriage returns, so lines are split on those as well.
func (m *Manager) followProgress(stderr io.Reader) {
	scanner := bufio.NewScanner(stderr)
	scanner.Split(scanLinesOrReturns)

	for scanner.Scan() {
		match := percentPattern.FindStringSubmatch(scanner.Text())
		if len(match) != 2 {
			continue
		}

		value, err := strconv.ParseFloat(match[1], 64)
		if err != nil {
			continue
		}

		m.setState(StateUpdatingDB, "Downloading the vulnerability database…", int(value))
	}

	// Only the percentage stops arriving; the download itself is Trivy's and
	// carries on. Worth a line in the log, not a word to the user.
	if err := scanner.Err(); err != nil {
		m.logger.Debug("Stopped following the download progress", "error", err)
	}
}

func scanLinesOrReturns(data []byte, atEOF bool) (int, []byte, error) {
	for i, b := range data {
		if b == '\n' || b == '\r' {
			return i + 1, data[:i], nil
		}
	}

	if atEOF && len(data) > 0 {
		return len(data), data, nil
	}

	return 0, nil, nil
}

func (m *Manager) setState(state, detail string, percent int) {
	m.mu.Lock()
	m.status.State = state
	m.status.Detail = detail
	m.status.Percent = percent
	if state != StateFailed {
		m.status.Error = ""
	}
	m.mu.Unlock()

	m.announce()
}

// Dismiss puts a failure away.
//
// A scan can fail for a reason nothing here can fix -- a registry that is gone,
// an image the runtime cannot export -- and the warning would otherwise sit in
// the status bar until something else happens to replace it. Being able to say
// "yes, I know" is the difference between a report and a nag.
//
// Only a failure is dismissed: work in progress is not something to wave away.
func (m *Manager) Dismiss() {
	if m.Status().State != StateFailed {
		return
	}

	m.setState(StateIdle, "", 0)
}

func (m *Manager) fail(detail string, err error) {
	m.logger.Error(detail, "error", err)

	m.mu.Lock()
	m.status.State = StateFailed
	m.status.Detail = detail
	m.status.Percent = 0
	m.status.Error = strings.TrimSpace(err.Error())
	m.mu.Unlock()

	m.announce()
}

func (m *Manager) announce() {
	if m.push != nil {
		m.push(m.Status())
	}
}

// outdated asks Homebrew whether it holds a newer Trivy. It reads the local
// index rather than running `brew update`, so it costs nothing and never
// mutates Homebrew's own state behind the user's back.
func (m *Manager) outdated(ctx context.Context) (bool, string) {
	if !m.runner.Has("brew") {
		return false, ""
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	out, err := m.runner.Tool(ctx, "brew", "outdated", "--json=v2", Formula).Output()
	if err != nil {
		return false, ""
	}

	var report struct {
		Formulae []struct {
			Name              string   `json:"name"`
			CurrentVersion    string   `json:"current_version"`
			InstalledVersions []string `json:"installed_versions"`
		} `json:"formulae"`
	}

	if err := json.Unmarshal(out, &report); err != nil {
		return false, ""
	}

	for _, formula := range report.Formulae {
		if formula.Name == Formula {
			return true, formula.CurrentVersion
		}
	}

	return false, ""
}
