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
	if m.source == nil {
		return
	}

	refs, err := m.source(ctx)
	if err != nil {
		m.logger.Debug("Could not list images to scan", "error", err)
		return
	}

	// Results for images that are gone are dead weight in the database and
	// noise in the UI, so every pass clears them out.
	m.forgetMissing(refs)

	// And so is a warning about an image that is no longer here. A failure
	// stays on screen until something else replaces it, which meant deleting
	// the offending image left its complaint sitting in the status bar with
	// nothing left to explain it.
	m.forgetStaleFailure(refs)

	// Clearing up comes first and is not the scanner's to refuse. Forgetting
	// an image that has been deleted needs no Trivy and no vulnerability
	// database -- it needs the list of images, which is already in hand. Under
	// the old order these two lines sat below the check, so somebody who never
	// installed the scanner, or whose database had not downloaded yet, kept
	// every result for every image they had ever deleted.
	if !m.Status().Installed || !m.Status().DatabaseReady {
		return
	}

	// Only what actually needs doing, so the count the user sees counts down
	// to zero rather than sitting at "1 of 12" while eleven are skipped.
	//
	// Images nobody has an answer for come first, and images whose answer has
	// merely gone stale come after. The difference matters twice: on a fresh
	// install every image is in the first group and the page fills in the
	// order somebody is likely to open them, and after an upgrade -- where the
	// stored reports are all suddenly too old at once -- a newly pulled image
	// is not stuck behind a queue of rescans that already have something to
	// show. A stale report stays on screen until its rescan replaces it, so
	// waiting costs the reader nothing.
	var unscanned, stale []ImageRef

	for _, ref := range refs {
		// An image with no arm64 in it cannot be read here at all. Left in the
		// list it is attempted on every pass, fails on every pass, and leaves a
		// warning that no amount of waiting clears.
		if !ref.scannable() {
			continue
		}

		if m.hasFreshReport(ref) {
			continue
		}

		if _, held := m.Report(ref.Reference); held {
			stale = append(stale, ref)
		} else {
			unscanned = append(unscanned, ref)
		}
	}

	pending := append(unscanned, stale...)

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

// maxReportAge is how long an answer is trusted for.
//
// Database and scanner versions catch most of what makes a result wrong, and
// between them they are what usually invalidates a result: Trivy publishes a
// database roughly daily, and every stored report is rescanned when it does.
// This is the backstop for everything else.
//
// Twelve hours, and the number is a budget rather than a preference. A scan
// exports the whole image to a temporary directory, runs Trivy over it and
// reads its package database -- so on a Mac with twenty images, halving this
// number doubles a real amount of disk and CPU, for ever, in the background.
// Twelve picks up a new vulnerability database within half a day of it landing
// while costing a quarter of what three hours did.
const maxReportAge = 12 * time.Hour

// outdatedResult decides whether a stored result still speaks for the image.
// Anything that could change the answer counts: a newer vulnerability
// database, a newer scanner, or simply too much time.
func (m *Manager) outdatedResult(report Report) bool {
	status := m.Status()

	// Written in a shape whose numbers cannot be compared with today's. See
	// reportFormat.
	if report.Format != reportFormat {
		return true
	}

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
