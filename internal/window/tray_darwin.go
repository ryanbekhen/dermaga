package window

/*
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>
#include "tray_darwin.h"
*/
import "C"

import (
	"sync"
	"unsafe"

	"github.com/ryanbekhen/dermaga/internal/window/assets"
)

// The one menu bar item.
//
// A package variable because there is exactly one of these for the life of the
// app, and because AppKit calls back into C functions rather than into
// anything holding a pointer: the click has to find its way home from here.
var (
	trayMu      sync.Mutex
	trayOwner   *Tray
	trayIconRun = assets.TrayRunning
)

// apply redraws the menu bar item from the state it has been given.
func (t *Tray) apply() {
	t.mu.Lock()
	state := t.state
	t.mu.Unlock()

	// Filled while the services are up, hollow when they are not: a broken
	// runtime is visible without opening anything.
	icon := trayIconRun
	if state.Running != nil && !*state.Running {
		icon = assets.TrayStopped
	}

	trayMu.Lock()
	trayOwner = t
	trayMu.Unlock()

	tooltip := C.CString("Dermaga — " + trayLabel(state))
	defer C.free(unsafe.Pointer(tooltip))

	C.trayApply((*C.uchar)(unsafe.Pointer(&icon[0])), C.int(len(icon)), tooltip)
}

func boolToC(value bool) C.int {
	if value {
		return 1
	}

	return 0
}

// dermagaTrayToggled is AppKit reporting a click.
//
//export dermagaTrayToggled
func dermagaTrayToggled() {
	trayMu.Lock()
	tray := trayOwner
	trayMu.Unlock()

	if tray == nil || tray.handlers.OnToggle == nil {
		return
	}

	// Off the main thread before anything is done about it. This is called
	// with AppKit's own stack underneath, and showing the panel asks Wails for
	// a window -- which wants the main thread back before it will answer.
	go tray.handlers.OnToggle()
}

// dermagaPanelShown lets the click handler ask whether the panel is already
// up, which is the difference between a click that opens one and a click that
// closes it -- and only the first is a reason to bring the app forward.
//
//export dermagaPanelShown
func dermagaPanelShown() C.int {
	trayMu.Lock()
	tray := trayOwner
	trayMu.Unlock()

	if tray == nil || tray.handlers.PanelShown == nil {
		return 0
	}

	return boolToC(tray.handlers.PanelShown())
}

// trayPositionWindow puts a window under the menu bar item.
func trayPositionWindow(nsWindow unsafe.Pointer, gap int) {
	C.trayPositionWindow(nsWindow, C.int(gap))
}

// traySetHighlighted draws the item as pressed while the panel is up.
func traySetHighlighted(on bool) {
	C.trayHighlight(boolToC(on))
}
