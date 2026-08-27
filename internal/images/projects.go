package images

import (
	"encoding/json"
	"sync"

	"github.com/ryanbekhen/dermaga/internal/projects"
	"github.com/ryanbekhen/dermaga/internal/store"
)

// What Dermaga keeps about an image, which today is one thing: the project it
// belongs to.
//
// Keyed by reference -- `linxpay-dash:dev` -- rather than by digest, and that
// is the whole of the rule. An image's project is where it was *built*, and a
// tag is what somebody builds; build it again and the tag moves to new bytes
// that are the same work, in the same project. Keyed by digest, every rebuild
// would land in default and have to be filed again, which is the opposite of
// "never asked".
//
// Nothing is recorded for an image that was pulled. `postgres` came from a
// registry and belongs to no project, so it stays in default and is borrowed
// by whoever needs it -- which is what default is for.
type Settings struct {
	Project string `json:"project,omitempty"`
}

type settingsStore struct {
	mu    sync.RWMutex
	db    *store.Store
	known map[string]Settings
}

// UseStore attaches the database and reads back what is already there.
func (m *Manager) UseStore(db *store.Store) {
	loaded := map[string]Settings{}

	err := db.All(store.BucketImages, func(reference string, raw []byte) error {
		var settings Settings
		if err := json.Unmarshal(raw, &settings); err != nil {
			m.logger.Warn("Ignoring an unreadable image record", "reference", reference, "error", err)
			return nil
		}

		loaded[reference] = settings

		return nil
	})
	if err != nil {
		m.logger.Warn("Could not read what is kept about images", "error", err)
	}

	m.settings.mu.Lock()
	m.settings.db = db
	m.settings.known = loaded
	m.settings.mu.Unlock()
}

// SetProject files an image under a project. Empty, or "default", files it
// under none.
func (m *Manager) SetProject(reference, project string) error {
	if projects.IsDefault(project) {
		project = ""
	}

	m.settings.mu.Lock()
	if m.settings.known == nil {
		m.settings.known = map[string]Settings{}
	}
	m.settings.known[reference] = Settings{Project: project}
	db := m.settings.db
	m.settings.mu.Unlock()

	m.changed.Changed()

	if db == nil {
		return nil
	}

	return db.Put(store.BucketImages, reference, Settings{Project: project})
}

// ClearProject sends everything filed under a project back to default.
func (m *Manager) ClearProject(project string) error {
	return m.rewriteProject(project, "")
}

func (m *Manager) rewriteProject(from, to string) error {
	if from == "" {
		return nil
	}

	m.settings.mu.Lock()
	touched := map[string]Settings{}
	for reference, settings := range m.settings.known {
		if settings.Project != from {
			continue
		}

		settings.Project = to
		m.settings.known[reference] = settings
		touched[reference] = settings
	}
	db := m.settings.db
	m.settings.mu.Unlock()

	if len(touched) == 0 {
		return nil
	}

	m.changed.Changed()

	if db == nil {
		return nil
	}

	for reference, settings := range touched {
		if err := db.Put(store.BucketImages, reference, settings); err != nil {
			return err
		}
	}

	return nil
}

// applySettings marks each image with the project it was built in.
func (m *Manager) applySettings(images []Image) {
	m.settings.mu.RLock()
	defer m.settings.mu.RUnlock()

	for i := range images {
		images[i].Project = m.settings.known[images[i].Reference].Project
	}
}

// PruneSettings drops records for images that are no longer here.
//
// A tag deleted from a terminal never passed through this process, and its
// record would otherwise wait for a tag of the same name to arrive and inherit
// it. Called at startup, with the whole list, because deciding a record is dead
// needs the whole list.
func (m *Manager) PruneSettings(live []Image) {
	here := make(map[string]struct{}, len(live))
	for _, image := range live {
		here[image.Reference] = struct{}{}
	}

	m.settings.mu.Lock()
	var gone []string
	for reference := range m.settings.known {
		if _, still := here[reference]; !still {
			gone = append(gone, reference)
		}
	}
	for _, reference := range gone {
		delete(m.settings.known, reference)
	}
	db := m.settings.db
	m.settings.mu.Unlock()

	if db == nil {
		return
	}

	for _, reference := range gone {
		if err := db.Delete(store.BucketImages, reference); err != nil {
			m.logger.Debug("Could not drop a stale image record", "reference", reference, "error", err)
		}
	}
}
