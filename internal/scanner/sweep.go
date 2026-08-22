package scanner

import (
	"context"
	"time"
)

// runSweep scans whatever has no usable result yet.
//
// This is what makes the feature ambient rather than a button: by the time the
// user opens an image, the answer is usually already there. Scans run one at a
// time on this goroutine, so a machine full of images warms up gradually
// instead of exporting several gigabytes at once.
func (m *Manager) runSweep(ctx context.Context) {
	if m.source == nil || !m.Status().Installed || !m.Status().DatabaseReady {
		return
	}

	refs, err := m.source(ctx)
	if err != nil {
		m.logger.Debug("Could not list images to scan", "error", err)
		return
	}

	// Results for images that are gone are dead weight in the file and noise
	// in the UI, so every pass clears them out.
	m.forgetMissing(refs)

	// And so is a warning about an image that is no longer here. A failure
	// stays on screen until something else replaces it, which meant deleting
	// the offending image left its complaint sitting in the status bar with
	// nothing left to explain it.
	m.forgetStaleFailure(refs)

	// Only what actually needs doing, so the count the user sees counts down
	// to zero rather than sitting at "1 of 12" while eleven are skipped.
	pending := make([]ImageRef, 0, len(refs))
	for _, ref := range refs {
		// An image with no arm64 in it cannot be read here at all. Left in the
		// list it is attempted on every pass, fails on every pass, and leaves a
		// warning that no amount of waiting clears.
		if !ref.scannable() {
			continue
		}

		if !m.hasFreshReport(ref) {
			pending = append(pending, ref)
		}
	}

	for i, ref := range pending {
		if ctx.Err() != nil {
			break
		}

		// Checked again here, not just when the list was built: a tag scanned a
		// moment ago may be the twin of this one, and the answer is already in.
		if m.hasFreshReport(ref) {
			continue
		}

		m.mu.Lock()
		m.status.Position = i + 1
		m.status.Total = len(pending)
		m.mu.Unlock()

		m.scan(ctx, ref.Reference)
	}

	m.mu.Lock()
	m.status.Position = 0
	m.status.Total = 0
	m.mu.Unlock()
}

// hasFreshReport is true when the stored result still describes this image. A
// tag that has moved to a new digest is a different image wearing the same
// name, and its old report would be a lie.
func (m *Manager) hasFreshReport(ref ImageRef) bool {
	m.mu.RLock()
	report, ok := m.reports[ref.Reference]
	m.mu.RUnlock()

	if ok && m.outdatedResult(report) {
		return false
	}

	if !ok {
		// Tags that share a digest are the same bytes, so a result already held
		// under another name answers for this one too. Exporting and scanning
		// it again would cost minutes to learn nothing.
		if ref.Digest != "" {
			if twin, found := m.reportForDigest(ref.Digest); found {
				twin.Reference = ref.Reference

				m.mu.Lock()
				m.reports[ref.Reference] = twin
				m.mu.Unlock()

				m.saveReport(ref.Reference, twin)
				// The list is showing this reference too, and it now has an
				// answer without a scan ever running for it.
				m.announceReport(twin)

				return true
			}
		}

		return false
	}

	// Reports written before digests were recorded are trusted rather than
	// thrown away; they are still better than nothing.
	if report.Digest == "" || ref.Digest == "" {
		return true
	}

	return report.Digest == ref.Digest
}

// digestOf asks the source which image a reference currently points at, so the
// result can be tied to it. Empty when unknown, which only costs a rescan.
func (m *Manager) digestOf(ctx context.Context, reference string) string {
	if m.source == nil {
		return ""
	}

	refs, err := m.source(ctx)
	if err != nil {
		return ""
	}

	for _, ref := range refs {
		if ref.Reference == reference {
			return ref.Digest
		}
	}

	return ""
}

// reportForDigest finds a result held under any reference for the same image.
func (m *Manager) reportForDigest(digest string) (Report, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	for _, report := range m.reports {
		if report.Digest == digest {
			return report, true
		}
	}

	return Report{}, false
}

// forgetMissing drops results for images that no longer exist. Returns how many
// went, so a manual sweep can say what it did.
func (m *Manager) forgetMissing(refs []ImageRef) int {
	live := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		live[ref.Reference] = struct{}{}
	}

	m.mu.Lock()
	gone := make([]string, 0)
	for reference := range m.reports {
		if _, ok := live[reference]; !ok {
			delete(m.reports, reference)
			gone = append(gone, reference)
		}
	}
	m.mu.Unlock()

	if len(gone) > 0 {
		m.forget(gone)
		m.announce()
	}

	return len(gone)
}

// ForgetMissing is the manual form: the same clean-up the sweep does, for a
// user who wants the file tidied now. Results for images still present are
// kept -- throwing those away would only mean scanning them again.
func (m *Manager) ForgetMissing(ctx context.Context) int {
	if m.source == nil {
		return 0
	}

	refs, err := m.source(ctx)
	if err != nil {
		return 0
	}

	return m.forgetMissing(refs)
}

// maxReportAge is the backstop. Database and scanner versions catch almost
// everything, but if either is unreadable a result could otherwise sit there
// for ever; a week is short enough to stay honest and long enough not to churn.
const maxReportAge = 7 * 24 * time.Hour

// outdatedResult decides whether a stored result still speaks for the image.
// Anything that could change the answer counts: a newer vulnerability
// database, a newer scanner, or simply too much time.
func (m *Manager) outdatedResult(report Report) bool {
	status := m.Status()

	if report.DatabaseUpdatedAt != "" && status.DatabaseUpdatedAt != "" &&
		report.DatabaseUpdatedAt != status.DatabaseUpdatedAt {
		return true
	}

	if report.ScannerVersion != "" && status.Version != "" &&
		report.ScannerVersion != status.Version {
		return true
	}

	scannedAt, err := time.Parse(time.RFC3339, report.ScannedAt)
	if err != nil {
		return true // Unreadable timestamps are treated as too old to trust.
	}

	return time.Since(scannedAt) > maxReportAge
}

// forgetStaleFailure clears a failure about an image that is no longer here.
//
// Failures are sticky on purpose: a scan that went wrong should stay on screen
// rather than blink past. But the reason to keep it disappears with the image
// it was about, and deleting that image is the most likely thing a person does
// about the warning in the first place.
func (m *Manager) forgetStaleFailure(refs []ImageRef) {
	m.mu.Lock()
	failed, about := m.status.State == StateFailed, m.status.Target
	m.mu.Unlock()

	if !failed || about == "" {
		return
	}

	for _, ref := range refs {
		if ref.Reference == about {
			return
		}
	}

	m.setState(StateIdle, "", 0)
}
