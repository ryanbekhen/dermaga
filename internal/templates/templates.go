// Package templates offers starting points for the create form.
package templates

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	neturl "net/url"
	"strings"
	"sync"
	"time"

	"github.com/ryanbekhen/dermaga/internal/containers"
	"github.com/ryanbekhen/dermaga/internal/store"
)

// Where the templates come from, and why not from the window.
//
// A template is a half-filled container specification: it fills in the create
// form and is never run. The person still reads every field and presses the
// button, which is what makes taking them from a public catalogue reasonable at
// all.
//
// The window cannot fetch them itself -- it is served under `connect-src
// 'self'` and has no network of its own, deliberately -- so the agent does it
// and hands them over. That is the same boundary everything else here respects.
//
// The catalogue is online, and a copy of it is kept. Offline, the copy is what
// gets offered; back online, it is replaced by whatever the catalogue says now.
// Nothing is built into this binary: one source, so there is nothing to drift
// away from it, and a template fixed in the catalogue is fixed for everybody
// without waiting for a release.
//
// The cost is honest and worth stating: a machine that has never once reached
// the catalogue has no templates. Everything else about the create form works,
// and it fills as soon as anything gets through.

// Catalogue is what the published index.json holds, and what is kept on disk.
type Catalogue struct {
	SchemaVersion int        `json:"schemaVersion"`
	Templates     []Template `json:"templates"`
}

// Template is one starting point.
type Template struct {
	SchemaVersion int    `json:"schemaVersion"`
	ID            string `json:"id"`
	Name          string `json:"name"`
	Summary       string `json:"summary"`
	// What the template cannot do for the person, said before it is discovered.
	Caveat   string `json:"caveat,omitempty"`
	Homepage string `json:"homepage,omitempty"`
	// A data URI by the time the window sees it.
	//
	// The catalogue publishes a path relative to itself, which is right for a
	// catalogue -- a fork serves its own without rewriting anything. But the
	// window is locked to `img-src 'self' data:` and has no business fetching
	// from another host, so the agent reads the logo while it is fetching
	// everything else and inlines it. Offline that costs nothing extra: the
	// logos are in the copy along with the templates.
	Logo string `json:"logo,omitempty"`
	// Spec is typed rather than passed through: a catalogue entry that is not a
	// container specification should be refused here, not discovered by the
	// form when somebody clicks it.
	Spec containers.ContainerSpec `json:"spec"`
}

// Where the catalogue is published.
const source = "https://ryanbekhen.github.io/dermaga-templates/index.json"

// The only version this build understands. A template claiming a newer one is
// skipped rather than guessed at -- a field this build does not know about
// could be the one that made the template safe.
const supported = 1

const (
	// Templates change when an image publishes a new major or moves its data
	// directory, which is a handful of times a year. Weekly is plenty.
	maxAge = 7 * 24 * time.Hour
	// Long enough that a slow line still finishes, short enough that nothing
	// waits on it: nobody is blocked while this happens.
	fetchTimeout = 30 * time.Second
	// A first launch has other things to do. This is not one of them.
	settle = 2 * time.Minute
	check  = 6 * time.Hour
)

// Manager keeps the catalogue, and keeps it current.
type Manager struct {
	logger *slog.Logger
	// Nil until the agent hands one over; without it the catalogue is fetched
	// fresh every launch and never kept, which is what a machine that has
	// never been online has anyway.
	db     *store.Store
	client *http.Client

	mu     sync.RWMutex
	loaded []Template
}

// catalogueRecord is the copy, and when it was taken.
//
// The timestamp is stored rather than read off the file, which is where it used
// to come from: a modification time is a property of a file, and there is no
// file any more. Keeping it in the record also means it says what it means --
// when the catalogue was fetched -- rather than when something last happened to
// write it down.
type catalogueRecord struct {
	FetchedAt time.Time       `json:"fetchedAt"`
	Raw       json.RawMessage `json:"raw"`
}

// The one key in the templates bucket. A catalogue is fetched whole or not at
// all, so it is one record rather than one per template.
const catalogueKey = "catalogue"

func NewManager(logger *slog.Logger) *Manager {
	return &Manager{
		logger: logger,
		client: &http.Client{Timeout: fetchTimeout},
	}
}

// UseStore hands over where the catalogue is kept, and reads what is already
// there. Called once, before anything asks for a list.
func (m *Manager) UseStore(db *store.Store) {
	m.db = db

	loaded := m.read()

	m.mu.Lock()
	m.loaded = loaded
	m.mu.Unlock()
}

// List is what the window asks for.
func (m *Manager) List() []Template {
	m.mu.RLock()
	defer m.mu.RUnlock()

	out := make([]Template, len(m.loaded))
	copy(out, m.loaded)

	return out
}

// read takes the copy kept from the last time the catalogue was reached.
//
// Nothing is not a failure: it is what a machine that has never been online
// has, and it fills the moment anything gets through.
func (m *Manager) read() []Template {
	if m.db == nil {
		return nil
	}

	var record catalogueRecord
	found, err := m.db.Get(store.BucketTemplates, catalogueKey, &record)
	if err != nil || !found {
		return nil
	}

	templates, err := parse(record.Raw)
	if err != nil {
		// A copy that will not parse would be read again on every start, so it
		// is worth saying rather than swallowing.
		m.logger.Warn("The saved templates could not be read", "error", err)
		return nil
	}

	return templates
}

// parse reads a catalogue and keeps only what this build understands.
func parse(raw []byte) ([]Template, error) {
	var catalogue Catalogue
	if err := json.Unmarshal(raw, &catalogue); err != nil {
		return nil, fmt.Errorf("not a catalogue: %w", err)
	}

	out := make([]Template, 0, len(catalogue.Templates))
	for _, template := range catalogue.Templates {
		// Enough of a template to be worth offering. The rest of the checking
		// happens where it belongs, in the catalogue's own tests.
		if template.SchemaVersion != supported || template.ID == "" ||
			template.Name == "" || template.Spec.Image == "" {
			continue
		}

		out = append(out, template)
	}

	if len(out) == 0 {
		return nil, fmt.Errorf("a catalogue with nothing in this build can use")
	}

	return out, nil
}

// Refresh fetches the catalogue and keeps it, if the copy on disk has got old
// enough to be worth the trouble.
//
// Failing costs nothing: what is already loaded stays loaded, and the copy on
// disk is left exactly as it was, timestamp included, so the next pass tries
// again rather than recording a refresh that never happened.
func (m *Manager) Refresh(ctx context.Context, url string) {
	if m.db == nil || !m.stale() {
		return
	}

	m.fetch(ctx, url)
}

// FetchNow ignores the age and asks anyway. What the Settings panel calls when
// somebody changes where the catalogue comes from: the answer to "did that
// work?" should not be "wait a week".
func (m *Manager) FetchNow(ctx context.Context, url string) error {
	return m.fetch(ctx, url)
}

func (m *Manager) fetch(ctx context.Context, url string) error {
	from := url
	if from == "" {
		from = source
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, from, nil)
	if err != nil {
		return err
	}
	request.Header.Set("User-Agent", "Dermaga")

	response, err := m.client.Do(request)
	if err != nil {
		m.logger.Info("Could not fetch the templates; keeping the ones already here", "error", err)
		return err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		err := fmt.Errorf("%s answered %d", from, response.StatusCode)
		m.logger.Info("Could not fetch the templates; keeping the ones already here", "error", err)
		return err
	}

	// Bounded: this is a few kilobytes, and a catalogue that is not is either
	// wrong or hostile. Reading it into memory unbounded because it usually is
	// small is how a fetch becomes a way to exhaust the machine.
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return err
	}

	templates, err := parse(raw)
	if err != nil {
		// Refused rather than kept: what is loaded now is known to be good.
		m.logger.Warn("The fetched templates were not usable; keeping the ones already here",
			"from", from, "error", err)
		return err
	}

	m.inlineLogos(ctx, from, templates)

	// Kept as fetched-and-inlined rather than as it arrived, so the copy read
	// at the next start already has its logos in it.
	stored, err := json.MarshalIndent(Catalogue{SchemaVersion: supported, Templates: templates}, "", "  ")
	if err == nil {
		raw = append(stored, '\n')
	}

	m.mu.Lock()
	m.loaded = templates
	m.mu.Unlock()

	m.store(raw)
	m.logger.Info("Templates updated", "from", from, "count", len(templates))

	return nil
}

// inlineLogos turns each relative logo path into a data URI the window can
// actually show.
//
// Best effort, one at a time. A logo that will not load costs its template a
// picture and nothing else -- the window draws a monogram instead, which is a
// designed thing rather than a gap, so there is nothing here worth failing a
// whole catalogue over.
func (m *Manager) inlineLogos(ctx context.Context, from string, list []Template) {
	base, err := neturl.Parse(from)
	if err != nil {
		return
	}

	for i := range list {
		logo := list[i].Logo
		if logo == "" || strings.HasPrefix(logo, "data:") {
			continue
		}

		ref, err := neturl.Parse(logo)
		if err != nil {
			list[i].Logo = ""
			continue
		}

		encoded, err := m.readLogo(ctx, base.ResolveReference(ref).String())
		if err != nil {
			m.logger.Info("Could not read a template's logo", "template", list[i].ID, "error", err)
			list[i].Logo = ""
			continue
		}

		list[i].Logo = encoded
	}
}

func (m *Manager) readLogo(ctx context.Context, url string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	request.Header.Set("User-Agent", "Dermaga")

	response, err := m.client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("answered %d", response.StatusCode)
	}

	// An icon is a few kilobytes. Anything claiming to be one and arriving by
	// the megabyte is not an icon.
	raw, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil {
		return "", err
	}

	// Only SVG. A catalogue could name anything, and the window would render
	// whatever it was told to -- so what it is told is decided here.
	if !bytes.Contains(raw, []byte("<svg")) {
		return "", fmt.Errorf("not an SVG")
	}

	return "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString(raw), nil
}

// store writes the copy, and never fails anything: not being able to keep it is
// a slower tomorrow, not a broken today.
func (m *Manager) store(raw []byte) {
	if m.db == nil {
		return
	}

	record := catalogueRecord{FetchedAt: time.Now(), Raw: raw}

	if err := m.db.Put(store.BucketTemplates, catalogueKey, record); err != nil {
		m.logger.Warn("Could not save the templates", "error", err)
	}
}

// stale reports whether the copy is old enough to fetch again. None at all is
// stale by definition.
func (m *Manager) stale() bool {
	if m.db == nil {
		return true
	}

	var record catalogueRecord
	found, err := m.db.Get(store.BucketTemplates, catalogueKey, &record)
	if err != nil || !found {
		return true
	}

	return time.Since(record.FetchedAt) >= maxAge
}

// Run keeps the catalogue current for as long as the agent does. The URL is
// read each time round rather than held, so changing it in Settings is picked
// up without a restart.
func (m *Manager) Run(ctx context.Context, url func() string) {
	if m.db == nil {
		return
	}

	// Nothing to show and nothing to wait for: a machine with no copy yet has an
	// empty create form until this succeeds, so it is asked for at once. Where
	// there is a copy, the first pass can wait for the launch to settle.
	wait := settle
	if len(m.List()) == 0 {
		wait = time.Second
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}

		// Refresh only acts when the copy is old; with none at all it is always
		// old, so this fetches immediately and then settles into the schedule.
		m.Refresh(ctx, url())
		wait = check
	}
}
