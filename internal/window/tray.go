package window

import (
	"sync"
)

// The menu bar item: what Dermaga is watching, without a window.
//
// It reports the state of the container services rather than of Dermaga
// itself, which is the useful question here: Apple's CLI runs containers
// through launchd, so they outlive this app -- "is Dermaga running?" answers
// nothing, while "are the services up?" answers the thing people open the
// window for.
//
// The item itself holds almost nothing now. Clicking it opens the panel, and
// the panel is a page of the app: what is running, what is filed under which
// project, what to start and what to stop. This side is left with the two
// things a menu bar item says on its own -- a filled mark or a hollow one, and
// a line of hover text.
//
// There was a menu here until the panel could do everything it did. Keeping
// both meant two lists of the same containers, in two languages, with two sets
// of rules about which of them to show -- and the second list is the one
// nobody would remember to change.

// TrayState is what the item is drawn from. Running is a tri-state: nil means
// nobody has managed to ask yet, which reads differently from "stopped".
type TrayState struct {
	Running *bool
}

// TrayHandlers are supplied by the caller; the item names what a click is for
// rather than binding it.
type TrayHandlers struct {
	// The click, on either button: the panel opens, or closes if it is up.
	OnToggle func()
	// Asked before that, because a click that closes the panel is not a click
	// that should bring the app forward.
	PanelShown func() bool
}

// Tray keeps the menu bar item current. The item itself is drawn in
// tray_darwin.go, which is where the reason for doing it by hand is written
// down.
type Tray struct {
	handlers TrayHandlers

	mu    sync.Mutex
	state TrayState
}

// trayLabel is what the item says when the pointer rests on it.
func trayLabel(state TrayState) string {
	if state.Running == nil {
		return "Checking the services…"
	}
	if !*state.Running {
		return "Services stopped"
	}

	return "Services running"
}

// NewTray brings up the menu bar item.
func NewTray(handlers TrayHandlers) *Tray {
	tray := &Tray{handlers: handlers}
	tray.apply()

	return tray
}

// Update is called with whatever has just changed; nil is "unchanged".
func (t *Tray) Update(running *bool) {
	t.updateState(running)
	t.apply()
}

// updateState is the half of Update that does not need a menu bar, which is
// the half worth testing.
func (t *Tray) updateState(running *bool) {
	t.mu.Lock()
	defer t.mu.Unlock()

	if running != nil {
		t.state.Running = running
	}
}
