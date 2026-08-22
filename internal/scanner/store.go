package scanner

import (
	"encoding/json"

	"github.com/ryanbekhen/dermaga/internal/store"
)

// Scan results are kept so a result survives closing the app: rescanning every
// image on every launch would mean exporting gigabytes and waiting minutes for
// something that has not changed.
//
// One record per image, rather than one document holding all of them. The
// whole map used to be re-encoded and rewritten on every completed scan, so a
// sweep of twenty images wrote the entire store twenty times -- and the store
// grows with the images on the machine, so the cost of finishing one scan grew
// with how many others there were. Now finishing a scan writes that scan.

// UseStore hands the manager the database to keep its results in. Without one
// it works exactly as before minus the remembering: every launch rescans.
func (m *Manager) UseStore(s *store.Store) {
	m.store = s
}

// load reads previous results. A missing or damaged record is not an error
// worth reporting: the worst case is that an image is scanned again.
func (m *Manager) load() {
	if m.store == nil {
		return
	}

	loaded := map[string]Report{}

	err := m.store.All(store.BucketScans, func(reference string, raw []byte) error {
		var report Report
		if err := json.Unmarshal(raw, &report); err != nil {
			// One unreadable record, not a corrupt store: skip it and let the
			// sweep produce a new one.
			m.logger.Warn("Ignoring an unreadable scan result", "image", reference, "error", err)
			return nil
		}

		loaded[reference] = report

		return nil
	})
	if err != nil {
		m.logger.Warn("Could not read stored scan results", "error", err)
		return
	}

	m.mu.Lock()
	for reference, report := range loaded {
		m.reports[reference] = report
	}
	m.mu.Unlock()
}

// saveReport writes one result. Called where a scan finishes, so the cost of
// storing an answer is the size of that answer.
func (m *Manager) saveReport(reference string, report Report) {
	if m.store == nil {
		return
	}

	if err := m.store.Put(store.BucketScans, reference, report); err != nil {
		m.logger.Error("Could not store a scan result", "image", reference, "error", err)
	}
}

// forget removes the results for images that are no longer on the machine.
func (m *Manager) forget(references []string) {
	if m.store == nil {
		return
	}

	for _, reference := range references {
		if err := m.store.Delete(store.BucketScans, reference); err != nil {
			m.logger.Error("Could not remove a scan result", "image", reference, "error", err)
		}
	}
}

// Reports is every result held, for the UI to summarise in a list.
func (m *Manager) Reports() map[string]Report {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make(map[string]Report, len(m.reports))
	for reference, report := range m.reports {
		out[reference] = report
	}

	return out
}

func (m *Manager) hasRetried(reference string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.retried[reference]
}

func (m *Manager) markRetried(reference string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.retried[reference] = true
}
