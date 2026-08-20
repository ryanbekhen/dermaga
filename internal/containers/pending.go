package containers

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"
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
	path   string
	mu     sync.RWMutex
}

// NewPendingStore resolves the file. If the home directory cannot be found the
// store still works, it just never persists -- an edit is no worse off than it
// was before this existed.
func NewPendingStore(logger *slog.Logger) *PendingStore {
	home, err := os.UserHomeDir()
	if err != nil {
		logger.Warn("Could not resolve home directory; unfinished edits will not be kept", "error", err)
		return &PendingStore{logger: logger}
	}

	return &PendingStore{
		logger: logger,
		path:   filepath.Join(home, ".dermaga", "pending-edits.json"),
	}
}

func (p *PendingStore) load() map[string]PendingEdit {
	if p.path == "" {
		return map[string]PendingEdit{}
	}

	raw, err := os.ReadFile(p.path)
	if err != nil {
		// A missing file is the normal case: nothing was left unfinished.
		if !os.IsNotExist(err) {
			p.logger.Warn("Could not read unfinished edits", "path", p.path, "error", err)
		}
		return map[string]PendingEdit{}
	}

	edits := map[string]PendingEdit{}
	if err := json.Unmarshal(raw, &edits); err != nil {
		p.logger.Warn("Unfinished edits file is not valid JSON; starting over", "path", p.path, "error", err)
		return map[string]PendingEdit{}
	}

	return edits
}

func (p *PendingStore) write(edits map[string]PendingEdit) error {
	if p.path == "" {
		return nil
	}

	if err := os.MkdirAll(filepath.Dir(p.path), 0o755); err != nil {
		return fmt.Errorf("could not create %s: %w", filepath.Dir(p.path), err)
	}

	encoded, err := json.MarshalIndent(edits, "", "  ")
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')

	// Write-then-rename, so a crash in the middle cannot leave half a file --
	// which would lose the very thing this is here to protect.
	temp := p.path + ".tmp"
	if err := os.WriteFile(temp, encoded, 0o644); err != nil {
		return fmt.Errorf("could not write %s: %w", temp, err)
	}
	if err := os.Rename(temp, p.path); err != nil {
		_ = os.Remove(temp)
		return fmt.Errorf("could not save %s: %w", p.path, err)
	}

	return nil
}

// Begin records an edit before anything is taken apart.
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
