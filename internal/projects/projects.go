// Package projects keeps the groups a container can be filed under.
//
// A project here is a point of view, not isolation. Apple's runtime knows
// nothing about them -- `container ls` stays flat whatever this package says
// -- so a project decides what the window *shows* and what a new container is
// filed as, and never what anything can reach. Two containers in different
// projects talk to each other exactly as they did before.
//
// `default` is a project too, and it means *belongs to no project*. It is not
// stored, it cannot be made or removed, and everything that existed before
// this feature is in it without a single record being written. That is the
// whole of the migration: a container with no membership recorded is in
// default, which is what every container was on the day this shipped.
package projects

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/ryanbekhen/dermaga/internal/notify"
	"github.com/ryanbekhen/dermaga/internal/store"
)

// Separator is what sits between a project and what it named.
//
// An underscore, which is what Compose uses, and the reason to match it is that
// people arrive here already reading `myapp_db` as "db, in myapp". A separator
// is pure convention -- nothing resolves it, nothing parses it -- so the only
// thing it can be judged on is whether it says the right thing to somebody who
// has seen one before.
//
// Every kind takes it: containers, built images, networks, volumes. Checked
// against the runtime first, because a convention that half the commands refuse
// is not one.
const Separator = "_"

// Default is the name that means "filed under nothing".
//
// Held as a constant rather than as the empty string at every call site: what
// is written down is "", and what is shown is "default", and exactly one place
// should know that those are the same fact.
const Default = "default"

// Project is a group, and little else. There is nothing to configure about one
// -- what a project *does* is filter -- so it carries its name and when
// somebody made it, and that is all there is to keep.
type Project struct {
	Name string `json:"name"`
	// When it was made, RFC 3339. Only so the list can be shown oldest-first
	// where that reads better than alphabetical; nothing depends on it.
	CreatedAt string `json:"createdAt,omitempty"`
}

// Manager owns the list of projects.
type Manager struct {
	logger  *slog.Logger
	changed notify.Notifier

	mu    sync.RWMutex
	db    *store.Store
	known map[string]Project
}

func NewManager(logger *slog.Logger, changed notify.Notifier) *Manager {
	return &Manager{logger: logger, changed: changed, known: map[string]Project{}}
}

// Open attaches the database and reads back what is already there.
func (m *Manager) Open(db *store.Store) {
	loaded := map[string]Project{}

	err := db.All(store.BucketProjects, func(name string, raw []byte) error {
		var project Project
		if err := json.Unmarshal(raw, &project); err != nil {
			// One unreadable row is one project missing from the list, not a
			// reason to abandon the rest -- and the containers filed under it
			// are still there, in default, which is where an unknown project
			// lands anyway.
			m.logger.Warn("Ignoring an unreadable project record", "name", name, "error", err)
			return nil
		}

		if project.Name == "" {
			project.Name = name
		}

		loaded[project.Name] = project

		return nil
	})
	if err != nil {
		m.logger.Warn("Could not read the projects", "error", err)
	}

	m.mu.Lock()
	m.db = db
	m.known = loaded
	m.mu.Unlock()
}

// List is every project, alphabetically. `default` is not among them: it is
// not a record, it is the absence of one, and the window puts it at the head
// of the list itself.
func (m *Manager) List() []Project {
	m.mu.RLock()
	defer m.mu.RUnlock()

	list := make([]Project, 0, len(m.known))
	for _, project := range m.known {
		list = append(list, project)
	}

	sort.Slice(list, func(a, b int) bool {
		return strings.ToLower(list[a].Name) < strings.ToLower(list[b].Name)
	})

	return list
}

// Exists reports whether a name is a project that has been made. The empty
// string and `default` are both the absence of a project, and both answer true
// -- callers ask this to find out whether a name can be filed under, and those
// two always can.
func (m *Manager) Exists(name string) bool {
	if IsDefault(name) {
		return true
	}

	m.mu.RLock()
	defer m.mu.RUnlock()

	_, here := m.known[name]

	return here
}

// Create makes a project. Nothing is created on the runtime: this writes a row
// and pushes a change, which is the whole of what a project is.
func (m *Manager) Create(name string) (Project, error) {
	name, err := Validate(name)
	if err != nil {
		return Project{}, err
	}

	m.mu.Lock()
	if _, taken := m.known[name]; taken {
		m.mu.Unlock()
		return Project{}, fmt.Errorf("there is already a project called %q", name)
	}

	project := Project{Name: name, CreatedAt: time.Now().UTC().Format(time.RFC3339)}
	m.known[name] = project
	db := m.db
	m.mu.Unlock()

	if db != nil {
		if err := db.Put(store.BucketProjects, name, project); err != nil {
			return Project{}, err
		}
	}

	m.changed.Changed()

	return project, nil
}

// Delete forgets a project. What was filed under it is not deleted and not
// stopped -- the agent clears those memberships, and they fall back to
// default. Deleting a way of looking at containers must never be a way of
// losing them.
func (m *Manager) Delete(name string) error {
	m.mu.Lock()
	if _, here := m.known[name]; !here {
		m.mu.Unlock()
		return fmt.Errorf("there is no project called %q", name)
	}

	delete(m.known, name)
	db := m.db
	m.mu.Unlock()

	if db != nil {
		if err := db.Delete(store.BucketProjects, name); err != nil {
			return err
		}
	}

	m.changed.Changed()

	return nil
}

// IsDefault reports whether a name means "filed under nothing". Both spellings
// answer true: "" is what is stored, "default" is what is shown.
func IsDefault(name string) bool {
	trimmed := strings.TrimSpace(name)

	return trimmed == "" || strings.EqualFold(trimmed, Default)
}

// Validate checks a name a person typed and returns it trimmed.
//
// The rules are the runtime's rather than this package's invention: a project
// name is offered as a prefix when naming containers, and a name that cannot
// be part of a container's name would be offered and then rejected one field
// later.
func Validate(name string) (string, error) {
	name = strings.TrimSpace(name)

	if name == "" {
		return "", fmt.Errorf("a project needs a name")
	}

	if IsDefault(name) {
		return "", fmt.Errorf("%q is what a container with no project is already in", Default)
	}

	if len(name) > 40 {
		return "", fmt.Errorf("a project name is at most 40 characters")
	}

	// Lowered, because a project names images as well as containers, and an
	// image reference has no uppercase in it -- `MyApp_api:dev` is refused by
	// the runtime, and would be refused at the end of a build rather than here
	// where it can still be fixed. Compose lowercases its project names for the
	// same reason.
	name = strings.ToLower(name)

	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '-', r == '_':
		default:
			return "", fmt.Errorf("a project name takes letters, digits, - and _")
		}
	}

	return name, nil
}

// Prefixed is the name a thing born in a project is given.
//
// Names on this runtime are global -- a container's name is its id -- so two
// projects cannot both hold a `dashboard`, and without help the second one is
// named `dashboard2` or `weba` by somebody who did not want to be naming
// things at all. The project already answers the question, so it answers it:
// `bengkel-dashboard`.
//
// The cost is paid in the hostname, and it is worth saying out loud because
// nothing here can soften it. A container's name is also its address on the
// networks it joins, and Apple's runtime offers neither `--hostname` nor a
// per-network alias, so a prefixed container is reached at `bengkel-dashboard`
// and not at `dashboard`. Both halves of that are the runtime's; if an alias
// ever appears, this is the line that gets to become invisible.
//
// A stamp taken at birth, never a live link. Renaming a project does not rename
// what was made in it: renaming on this runtime means recreating, and a rename
// that destroys and rebuilds every container in a project is not a rename, it
// is an outage.
func Prefixed(project, name string) string {
	name = strings.TrimSpace(name)
	if IsDefault(project) || name == "" {
		return name
	}

	prefix := strings.TrimSpace(project) + Separator
	if strings.HasPrefix(name, prefix) {
		return name
	}

	return prefix + name
}

// Unprefixed is Prefixed read backwards: the short name, for showing a thing
// inside the project that named it.
//
// The prefix is what makes two projects able to hold a `dashboard`; showing it
// back on every row inside the one project that already says it is noise. So
// the list is read short while a project is open, and long everywhere else,
// which is the same shape `docker compose ps` has.
func Unprefixed(project, name string) string {
	if IsDefault(project) {
		return name
	}

	return strings.TrimPrefix(name, strings.TrimSpace(project)+Separator)
}

// NetworkName is what a project's network is called.
//
// The project's own prefix, the same one its containers and its built images
// carry, and then `default` -- because that is what this is. Every project has
// a network its containers land on when nothing says otherwise; the default
// project's is the runtime's built-in `default`, and `bengkel`'s is
// `bengkel-default`.
//
// One prefix everywhere was the point. A vendor namespace was tried first and
// was worse for being a second rule: a reader who has learned that a project
// names what is made in it should not have to learn a different answer for
// networks.
func NetworkName(project string) string {
	if IsDefault(project) {
		return ""
	}

	return Prefixed(project, "default")
}
