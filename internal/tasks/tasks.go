// Package tasks keeps what a command printed, after it has finished.
//
// A build's output is the only record of how an image was made, and it used to
// live in the window's memory and nowhere else: closing Dermaga threw away the
// log of everything it had built. Keeping it is what makes "how did this get
// like that" a question with an answer the next morning.
//
// Only finished work is here. Anything still running is the window's, because
// it is still arriving; this is the shelf it is put on afterwards.
package tasks

import (
	"encoding/json"
	"log/slog"
	"sort"
	"sync"

	"github.com/ryanbekhen/dermaga/internal/store"
)

// keep is how many finished commands are remembered.
//
// A number rather than an age: what makes a log worth reading is usually that
// it is one of the last few things you did, not that it happened today. Ten is
// a morning's work, and a build log is tens of kilobytes -- the pathological
// one is a couple of megabytes, and ten of those is still smaller than one
// image layer.
const keep = 10

// Record is one command that ran, and what it said.
type Record struct {
	ID string `json:"id"`
	// What the agent called the run it came from. A notification raised on the
	// Go side knows only this name, and Notification Center keeps a banner long
	// after the run -- sometimes past a restart -- so a click has to still find
	// its way here.
	StreamID string `json:"streamId,omitempty"`
	Kind     string `json:"kind"`
	Label    string `json:"label"`
	// Status is "done" or "failed". Nothing running is ever written here.
	Status string   `json:"status"`
	Error  string   `json:"error,omitempty"`
	Lines  []string `json:"lines"`
	// At is when it finished, RFC3339, which is also how the shelf is ordered
	// and how the oldest is chosen when there are too many.
	At string `json:"at"`
}

// Store is the shelf.
type Store struct {
	logger *slog.Logger

	mu sync.RWMutex
	// Nil until the agent hands one over. Without it nothing is remembered
	// across a restart, which is exactly where this started.
	db *store.Store
}

func New(logger *slog.Logger) *Store {
	return &Store{logger: logger}
}

func (s *Store) UseStore(db *store.Store) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.db = db
}

// Put writes one finished command and drops the oldest beyond `keep`.
func (s *Store) Put(record Record) error {
	s.mu.RLock()
	db := s.db
	s.mu.RUnlock()

	if db == nil {
		return nil
	}

	if err := db.Put(store.BucketTasks, record.ID, record); err != nil {
		return err
	}

	s.prune(db)

	return nil
}

// List returns what is remembered, newest first.
func (s *Store) List() []Record {
	s.mu.RLock()
	db := s.db
	s.mu.RUnlock()

	if db == nil {
		return []Record{}
	}

	records := s.all(db)
	sort.Slice(records, func(i, j int) bool { return records[i].At > records[j].At })

	return records
}

// Forget drops one, which is what dismissing it in the window means.
func (s *Store) Forget(id string) error {
	s.mu.RLock()
	db := s.db
	s.mu.RUnlock()

	if db == nil {
		return nil
	}

	return db.Delete(store.BucketTasks, id)
}

func (s *Store) all(db *store.Store) []Record {
	records := make([]Record, 0, keep)

	err := db.All(store.BucketTasks, func(id string, raw []byte) error {
		var record Record
		if err := json.Unmarshal(raw, &record); err != nil {
			// One unreadable record is one log nobody can read back, not a
			// reason to lose the others.
			s.logger.Warn("Ignoring an unreadable task record", "id", id, "error", err)
			return nil
		}

		records = append(records, record)

		return nil
	})
	if err != nil {
		s.logger.Warn("Could not read what was kept of finished commands", "error", err)
	}

	return records
}

// prune keeps the shelf the length it is meant to be.
func (s *Store) prune(db *store.Store) {
	records := s.all(db)
	if len(records) <= keep {
		return
	}

	// Oldest first, so the ones to drop are at the front.
	sort.Slice(records, func(i, j int) bool { return records[i].At < records[j].At })

	for _, record := range records[:len(records)-keep] {
		if err := db.Delete(store.BucketTasks, record.ID); err != nil {
			s.logger.Debug("Could not drop an old task record", "id", record.ID, "error", err)
		}
	}
}
