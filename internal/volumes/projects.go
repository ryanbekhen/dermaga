package volumes

import (
	"encoding/json"
	"sync"

	"github.com/ryanbekhen/dermaga/internal/projects"
	"github.com/ryanbekhen/dermaga/internal/store"
)

// What Dermaga keeps about a volume, which today is one thing: the project it
// belongs to.
//
// Kept as a record rather than read off the containers mounting it, which is
// how this started. Derivation had no answer for the ordinary cases: a volume
// made and not yet mounted was placed by nothing and turned up in every
// project, and one mounted from two projects belonged to both. Neither is a
// fact about the volume; both are facts about what happens to be running.
//
// A record rather than a label, too, even though `container volume create`
// takes one. A label can only be written when the volume is made, so a label
// would have nothing to say about `redis_data` and every other volume that
// existed before projects did -- and those are exactly the ones somebody wants
// to file.
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

	err := db.All(store.BucketVolumes, func(name string, raw []byte) error {
		var settings Settings
		if err := json.Unmarshal(raw, &settings); err != nil {
			m.logger.Warn("Ignoring an unreadable image record", "name", name, "error", err)
			return nil
		}

		loaded[name] = settings

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

// SetProject files a volume under a project. Empty, or "default", files it
// under none.
func (m *Manager) SetProject(name, project string) error {
	if projects.IsDefault(project) {
		project = ""
	}

	m.settings.mu.Lock()
	if m.settings.known == nil {
		m.settings.known = map[string]Settings{}
	}
	m.settings.known[name] = Settings{Project: project}
	db := m.settings.db
	m.settings.mu.Unlock()

	m.changed.Changed()

	if db == nil {
		return nil
	}

	return db.Put(store.BucketVolumes, name, Settings{Project: project})
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
	for name, settings := range m.settings.known {
		if settings.Project != from {
			continue
		}

		settings.Project = to
		m.settings.known[name] = settings
		touched[name] = settings
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

	for name, settings := range touched {
		if err := db.Put(store.BucketVolumes, name, settings); err != nil {
			return err
		}
	}

	return nil
}

// applySettings marks each image with the project it was built in.
func (m *Manager) applySettings(list []Volume) {
	m.settings.mu.RLock()
	defer m.settings.mu.RUnlock()

	for i := range list {
		list[i].Project = m.settings.known[list[i].Name].Project
	}
}

// PruneSettings drops records for images that are no longer here.
//
// A tag deleted from a terminal never passed through this process, and its
// record would otherwise wait for a tag of the same name to arrive and inherit
// it. Called at startup, with the whole list, because deciding a record is dead
// needs the whole list.
func (m *Manager) PruneSettings(live []Volume) {
	here := make(map[string]struct{}, len(live))
	for _, volume := range live {
		here[volume.Name] = struct{}{}
	}

	m.settings.mu.Lock()
	var gone []string
	for name := range m.settings.known {
		if _, still := here[name]; !still {
			gone = append(gone, name)
		}
	}
	for _, name := range gone {
		delete(m.settings.known, name)
	}
	db := m.settings.db
	m.settings.mu.Unlock()

	if db == nil {
		return
	}

	for _, name := range gone {
		if err := db.Delete(store.BucketVolumes, name); err != nil {
			m.logger.Debug("Could not drop a stale image record", "name", name, "error", err)
		}
	}
}
