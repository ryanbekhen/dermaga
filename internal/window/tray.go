package window

import (
	"fmt"
	"sync"
)

// The menu bar item: what Dermaga is watching, without a window.
//
// It reports the state of the container services rather than of Dermaga
// itself, which is the useful question here: Apple's CLI runs containers
// through launchd, so they outlive this app -- "is Dermaga running?" answers
// nothing, while "are the services up, and what is running?" answers the thing
// people open the window for.

// Beyond this the menu becomes a list to scroll rather than a glance.
const maxTrayContainers = 8

// TrayContainer is the little a menu row needs to know about a container.
type TrayContainer struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// TrayState is what the menu is drawn from. Running is a tri-state: nil means
// nobody has managed to ask yet, which reads differently from "stopped".
type TrayState struct {
	Running    *bool
	Containers []TrayContainer
}

// TrayHandlers are supplied by the caller; the menu names actions rather than
// binding them, so the decisions below can be read without a menu bar to hang
// them on.
type TrayHandlers struct {
	OnOpen          func()
	OnOpenContainer func(id string)
	OnStartServices func()
	OnOpenProject   func()
	OnQuit          func()
}

// Tray keeps the menu bar item current. The item itself is drawn in
// tray_darwin.go, which is where the reason for doing it by hand is written
// down.
type Tray struct {
	handlers TrayHandlers

	mu    sync.Mutex
	state TrayState
}

// trayLabel is the one line someone reads when they look up at the clock.
func trayLabel(state TrayState) string {
	if state.Running == nil {
		return "Checking the services…"
	}
	if !*state.Running {
		return "Services stopped"
	}

	count := len(state.Containers)
	if count == 1 {
		return "Services running · 1 container"
	}

	return fmt.Sprintf("Services running · %d containers", count)
}

// NewTray brings up the menu bar item.
func NewTray(handlers TrayHandlers) *Tray {
	tray := &Tray{handlers: handlers}
	tray.apply()

	return tray
}

// Update is called with whatever has just changed; the rest of the state is
// kept.
func (t *Tray) Update(running *bool, containers []TrayContainer) {
	t.mu.Lock()
	if running != nil {
		t.state.Running = running
	}
	if containers != nil {
		t.state.Containers = containers
	}
	t.mu.Unlock()

	t.apply()
}

// trayItem is one row of the menu, as data.
//
// The decisions are kept apart from the menu that carries them -- what counts
// as worth showing, when Start services is offered, how many rows before the
// list is cut -- so they can be read and tested without a menu bar to hang
// them on.
type trayItem struct {
	Label     string
	Action    string
	ID        string
	Disabled  bool
	Separator bool
}

// trayMenuItems is the menu, as rows. Actions are named rather than bound
// here; the caller supplies the handlers.
func trayMenuItems(state TrayState) []trayItem {
	items := []trayItem{
		{Label: trayLabel(state), Disabled: true},
		{Separator: true},
	}

	if state.Running != nil && *state.Running {
		switch {
		case len(state.Containers) == 0:
			items = append(items, trayItem{Label: "No containers running", Disabled: true})

		default:
			shown := state.Containers
			if len(shown) > maxTrayContainers {
				shown = shown[:maxTrayContainers]
			}

			for _, container := range shown {
				items = append(items, trayItem{
					Label:  container.Name,
					Action: "open-container",
					ID:     container.ID,
				})
			}

			if hidden := len(state.Containers) - maxTrayContainers; hidden > 0 {
				items = append(items, trayItem{
					Label:    fmt.Sprintf("…and %d more", hidden),
					Disabled: true,
				})
			}
		}

		items = append(items, trayItem{Separator: true})
	}

	items = append(items, trayItem{Label: "Open Dermaga", Action: "open"})

	// Only the way out of a stopped runtime is offered. Stopping the services
	// takes every container with it, which is not a thing to put one click
	// away from the clock.
	if state.Running != nil && !*state.Running {
		items = append(items, trayItem{Label: "Start services", Action: "start-services"})
	}

	// Where the app came from, one click from the clock. Dermaga is somebody's
	// weekend rather than a product, and the menu bar is the one part of it
	// that is always on screen -- so this is where it says so.
	items = append(items, trayItem{Label: "View on GitHub", Action: "project"})

	return append(items,
		trayItem{Separator: true},
		trayItem{Label: "Quit Dermaga", Action: "quit"},
	)
}
