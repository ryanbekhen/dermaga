package containers

import (
	"encoding/json"

	"github.com/ryanbekhen/dermaga/internal/projects"
	"github.com/ryanbekhen/dermaga/internal/store"
)

// Settings are what Dermaga keeps about a container that the runtime has no
// place for.
//
// This used to be a label. A label is honest about where it belongs -- it
// travels with the container, `container inspect` shows it, and a container
// deleted from a terminal leaves nothing behind to reconcile -- but it can only
// be written by `container run`. So changing one meant recreating the
// container, and ticking "start this with Dermaga" on something already running
// cost that container its filesystem. A tick should not cost that.
//
// Keyed by name, which on this runtime is also the container's id. That is
// deliberately the same key across a recreate: editing a container, or
// recreating it on a newer image, makes a different container with the same
// name, and the setting is about the thing the name refers to rather than about
// the particular instance. The cost is that a name freed and taken again would
// inherit it, so the row is dropped when Dermaga deletes the container and
// again, for anything left over, when the agent starts.
type Settings struct {
	// AutoBoot starts the container when Dermaga starts.
	AutoBoot bool `json:"autoBoot"`
	// Project is the group this container is filed under. Empty means default,
	// which means no project -- so every container that existed before projects
	// did is already filed correctly, with nothing written and nothing moved.
	Project string `json:"project,omitempty"`
}

// Settings reads what is kept about one container.
func (cm *Manager) Settings(name string) Settings {
	cm.settingsMu.RLock()
	defer cm.settingsMu.RUnlock()

	return cm.settings[name]
}

// SetSettings records what Dermaga keeps about a container.
//
// A record saying no to everything is still written, and it was tempting not
// to: it looks the same as having no record at all. It is not. A container
// made before 1.11.0 carries a `dermaga.autoboot` label that cannot be removed
// without recreating it, and the only way to turn that off is a record that
// says so out loud. Deleting the row instead handed the decision straight back
// to the label, and the tick came back on by itself.
//
// Rows for containers that have gone are cleaned up where that can be known:
// on delete, and at startup. Not here.
func (cm *Manager) SetSettings(name string, settings Settings) error {
	cm.settingsMu.Lock()
	cm.settings[name] = settings
	db := cm.db
	cm.settingsMu.Unlock()

	cm.changed.Changed()

	if db == nil {
		return nil
	}

	return db.Put(store.BucketContainers, name, settings)
}

// forgetSettings drops what was kept about a container that has gone.
func (cm *Manager) forgetSettings(name string) {
	cm.settingsMu.Lock()
	_, kept := cm.settings[name]
	delete(cm.settings, name)
	db := cm.db
	cm.settingsMu.Unlock()

	if !kept || db == nil {
		return
	}

	if err := db.Delete(store.BucketContainers, name); err != nil {
		cm.logger.Debug("Could not forget a container's settings", "name", name, "error", err)
	}
}

// PruneSettings drops records for containers that are no longer here.
//
// The other half of forgetting: a container deleted from a terminal never
// passed through this process, and its record would otherwise wait for a
// container of the same name to arrive and inherit it. Called once at startup,
// with the whole list, because deciding a record is dead needs the whole list.
func (cm *Manager) PruneSettings(live []Container) {
	names := make(map[string]struct{}, len(live))
	for _, container := range live {
		names[container.Name] = struct{}{}
		names[container.ID] = struct{}{}
	}

	cm.settingsMu.Lock()
	var gone []string
	for name := range cm.settings {
		if _, here := names[name]; !here {
			gone = append(gone, name)
		}
	}
	for _, name := range gone {
		delete(cm.settings, name)
	}
	db := cm.db
	cm.settingsMu.Unlock()

	if db == nil {
		return
	}

	for _, name := range gone {
		if err := db.Delete(store.BucketContainers, name); err != nil {
			cm.logger.Debug("Could not drop a stale container record", "name", name, "error", err)
		}
	}
}

// loadSettings reads the records back at startup.
func (cm *Manager) loadSettings(db *store.Store) map[string]Settings {
	loaded := map[string]Settings{}

	err := db.All(store.BucketContainers, func(name string, raw []byte) error {
		var settings Settings
		if err := json.Unmarshal(raw, &settings); err != nil {
			// One unreadable record is one container back to its default, not
			// a reason to abandon the rest.
			cm.logger.Warn("Ignoring an unreadable container record", "name", name, "error", err)
			return nil
		}

		loaded[name] = settings

		return nil
	})
	if err != nil {
		cm.logger.Warn("Could not read what is kept about containers", "error", err)
	}

	return loaded
}

// SetProject files a container under a project. Empty, or "default", files it
// under none.
//
// A write to Dermaga's own record, like the tick above it: the container is not
// stopped, not recreated, and not told. That is the point of keeping this here
// rather than in a label -- moving a container between projects is a change of
// mind about how it is filed, and a change of mind should never cost a
// filesystem.
func (cm *Manager) SetProject(name, project string) error {
	if projects.IsDefault(project) {
		project = ""
	}

	settings := cm.Settings(name)
	settings.Project = project

	return cm.SetSettings(name, settings)
}

// ClearProject sends everything filed under a project back to default. What a
// deleted project leaves behind is containers, exactly where they were.
func (cm *Manager) ClearProject(project string) error {
	return cm.rewriteProject(project, "")
}

func (cm *Manager) rewriteProject(from, to string) error {
	if from == "" {
		return nil
	}

	cm.settingsMu.Lock()
	var touched []string
	for name, settings := range cm.settings {
		if settings.Project != from {
			continue
		}

		settings.Project = to
		cm.settings[name] = settings
		touched = append(touched, name)
	}
	db := cm.db
	cm.settingsMu.Unlock()

	if len(touched) == 0 {
		return nil
	}

	cm.changed.Changed()

	if db == nil {
		return nil
	}

	cm.settingsMu.RLock()
	defer cm.settingsMu.RUnlock()

	for _, name := range touched {
		if err := db.Put(store.BucketContainers, name, cm.settings[name]); err != nil {
			return err
		}
	}

	return nil
}
