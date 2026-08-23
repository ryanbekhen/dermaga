package settings

import (
	"encoding/json"
	"fmt"
	"log/slog"
	neturl "net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Settings are the user's preferences. They live in the home directory rather
// than in browser storage so they survive a reinstall, can be edited by hand,
// and are shared by every Dermaga window on the machine.
type Settings struct {
	Theme              string `json:"theme"`
	ShowStopped        bool   `json:"showStopped"`
	LogTail            int    `json:"logTail"`
	ConfirmDestructive bool   `json:"confirmDestructive"`
	// Whether to raise a macOS notification when a container stops on its own.
	NotifyOnExit bool `json:"notifyOnExit"`
	// And when work somebody started finishes: an image built, an image
	// pulled, a container or a machine created. Separate from the above
	// because they are opposite kinds of news -- one is something going wrong
	// while nobody watched, the other is something they asked for being done
	// -- and somebody can reasonably want one without the other.
	NotifyOnFinish   bool `json:"notifyOnFinish"`
	SidebarCollapsed bool `json:"sidebarCollapsed"`
	// Where the container templates are fetched from. Empty means Dermaga's
	// own, which is what almost everybody wants -- but a catalogue is a static
	// file, so anyone can publish their own and point at it. A team with its
	// own images and its own conventions gets its own starting points without
	// asking anybody.
	TemplatesURL string `json:"templatesUrl,omitempty"`
	// Whether Apple's builder container appears in the list. It is not
	// somebody's container -- `container build` makes it and manages it -- but
	// it is real, it uses memory, and hiding things by default is how a list
	// stops being trusted. So it shows, and can be turned off.
	ShowBuilder bool `json:"showBuilder"`
}

func Defaults() Settings {
	return Settings{
		Theme:              "system",
		ShowStopped:        true,
		LogTail:            200,
		ConfirmDestructive: true,
		NotifyOnExit:       true,
		NotifyOnFinish:     true,
		ShowBuilder:        true,
	}
}

// normalize repairs anything a hand-edited file (or an old version) got wrong,
// so a bad value degrades to the default instead of breaking the UI.
func (s Settings) normalize() Settings {
	switch s.Theme {
	case "light", "dark", "system":
	default:
		s.Theme = "system"
	}

	if s.LogTail < 10 {
		s.LogTail = 10
	}
	if s.LogTail > 5000 {
		s.LogTail = 5000
	}

	// Only http and https, and only something that parses. A catalogue is
	// fetched by the agent, so a URL that is not one -- or a file:// path
	// pointing somewhere on the machine -- is not a preference to honour.
	if url := strings.TrimSpace(s.TemplatesURL); url == "" {
		s.TemplatesURL = ""
	} else if parsed, err := neturl.Parse(url); err != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		s.TemplatesURL = ""
	} else {
		s.TemplatesURL = url
	}

	return s
}

type Store struct {
	logger *slog.Logger
	path   string
	mu     sync.RWMutex
}

// NewSettingsStore resolves ~/.dermaga/config.json. If the home directory
// cannot be determined the store still works, it just never persists.
func NewStore(logger *slog.Logger) *Store {
	home, err := os.UserHomeDir()
	if err != nil {
		logger.Warn("Could not resolve home directory; settings will not persist", "error", err)
		return &Store{logger: logger}
	}

	return &Store{
		logger: logger,
		path:   filepath.Join(home, ".dermaga", "config.json"),
	}
}

func (s *Store) Path() string {
	return s.path
}

func (s *Store) Load() Settings {
	if s.path == "" {
		return Defaults()
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	raw, err := os.ReadFile(s.path)
	if err != nil {
		// A missing file is the normal first run, not a problem worth logging.
		if !os.IsNotExist(err) {
			s.logger.Warn("Could not read settings", "path", s.path, "error", err)
		}
		return Defaults()
	}

	// Start from the defaults so a partial file keeps sensible values.
	settings := Defaults()
	if err := json.Unmarshal(raw, &settings); err != nil {
		s.logger.Warn("Settings file is not valid JSON; using defaults", "path", s.path, "error", err)
		return Defaults()
	}

	return settings.normalize()
}

func (s *Store) Save(settings Settings) (Settings, error) {
	settings = settings.normalize()

	if s.path == "" {
		return settings, nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return settings, fmt.Errorf("could not create %s: %w", filepath.Dir(s.path), err)
	}

	encoded, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return settings, err
	}
	encoded = append(encoded, '\n')

	// Write-then-rename so a crash mid-write cannot truncate the config.
	temp := s.path + ".tmp"
	if err := os.WriteFile(temp, encoded, 0o644); err != nil {
		return settings, fmt.Errorf("could not write %s: %w", temp, err)
	}
	if err := os.Rename(temp, s.path); err != nil {
		_ = os.Remove(temp)
		return settings, fmt.Errorf("could not save %s: %w", s.path, err)
	}

	return settings, nil
}
