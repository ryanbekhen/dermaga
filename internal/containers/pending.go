package containers

import (
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/ryanbekhen/dermaga/internal/store"
)

// Edits that were begun and never finished.
//
// Editing a container means recreating it: the old one is stopped and deleted,
// and a new one is made from the new configuration. If that last step fails --
// the image was built locally and has since been deleted, a port is now taken,
// a volume is gone -- the previous container is put back, but the changes the
// user typed are gone with the failed attempt. They then have to remember what
// they had asked for and type it again, which is exactly what a person cannot
// do reliably at the moment something has just broken.
//
// So the intended configuration is written down before anything is destroyed,
// and kept until the edit succeeds. What is on disk is the answer to "what was
// I in the middle of?", which the window asks when it opens the form again.

// PendingEdit is an edit that was started and did not finish.
type PendingEdit struct {
	// ID names the container as it was when the edit began. Renaming is one of
	// the things an edit can do, so this is not necessarily the spec's name.
	ID string `json:"id"`
	// Spec is what the user asked for.
	Spec ContainerSpec `json:"spec"`
	// Previous is the configuration the container had, so a restore that also
	// failed can be tried again.
	Previous ContainerSpec `json:"previous"`
	// Reason is why it did not finish, in the words the runtime used.
	Reason string `json:"reason,omitempty"`
	// At is when it was written, so a stale one can be recognised.
	At string `json:"at"`
}

// PendingStore keeps unfinished edits in ~/.dermaga/pending-edits.json.
type PendingStore struct {
	logger *slog.Logger
	// Nil until the agent hands one over. Without it an edit still works; it
	// just does not survive the app closing mid-recreate, which is exactly
	// what it was before any of this existed.
	db *store.Store
	mu sync.RWMutex
}

// NewPendingStore makes the store. It works without a database, it just never
// persists -- an edit is no worse off than it was before this existed.
func NewPendingStore(logger *slog.Logger) *PendingStore {
	return &PendingStore{logger: logger}
}

// UseStore hands over where unfinished edits are kept.
func (p *PendingStore) UseStore(db *store.Store) {
	p.mu.Lock()
	defer p.mu.Unlock()

	p.db = db
}

func (p *PendingStore) load() map[string]PendingEdit {
	edits := map[string]PendingEdit{}

	if p.db == nil {
		return edits
	}

	err := p.db.All(store.BucketPending, func(id string, raw []byte) error {
		var edit PendingEdit
		if err := json.Unmarshal(raw, &edit); err != nil {
			// One unreadable record is one edit that cannot be resumed, not a
			// reason to abandon the others.
			p.logger.Warn("Ignoring an unreadable unfinished edit", "container", id, "error", err)
			return nil
		}

		edits[id] = edit

		return nil
	})
	if err != nil {
		p.logger.Warn("Could not read unfinished edits", "error", err)
	}

	return edits
}

// write replaces the set of unfinished edits.
//
// The whole set rather than the one that changed, because that is what the
// callers above know: they hand back the map they have just adjusted. It is
// never more than a handful of records and it is one transaction, so there is
// nothing to gain from being cleverer about it.
func (p *PendingStore) write(edits map[string]PendingEdit) error {
	if p.db == nil {
		return nil
	}

	values := make(map[string]any, len(edits))
	for id, edit := range edits {
		values[id] = edit
	}

	return p.db.Replace(store.BucketPending, values)
}

func (p *PendingStore) Begin(id string, spec, previous ContainerSpec) {
	p.mu.Lock()
	defer p.mu.Unlock()

	edits := p.load()
	edits[id] = PendingEdit{
		ID:       id,
		Spec:     spec,
		Previous: previous,
		At:       time.Now().UTC().Format(time.RFC3339),
	}

	if err := p.write(edits); err != nil {
		p.logger.Warn("Could not record the edit in progress", "id", id, "error", err)
	}
}

// Failed leaves the edit where it is and notes why, so the window can offer it
// back with the reason attached.
func (p *PendingStore) Failed(id string, reason error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	edits := p.load()

	edit, ok := edits[id]
	if !ok {
		return
	}

	edit.Reason = reason.Error()
	edits[id] = edit

	if err := p.write(edits); err != nil {
		p.logger.Warn("Could not record why the edit failed", "id", id, "error", err)
	}
}

// Done forgets an edit that landed.
func (p *PendingStore) Done(id string) {
	p.mu.Lock()
	defer p.mu.Unlock()

	edits := p.load()
	if _, ok := edits[id]; !ok {
		return
	}

	delete(edits, id)

	if err := p.write(edits); err != nil {
		p.logger.Warn("Could not clear the finished edit", "id", id, "error", err)
	}
}

// All returns every unfinished edit, keyed by the container it belongs to.
func (p *PendingStore) All() map[string]PendingEdit {
	p.mu.RLock()
	defer p.mu.RUnlock()

	return p.load()
}
