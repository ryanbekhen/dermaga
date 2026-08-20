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

// The one menu bar item, and the rows it is currently showing.
//
// A package variable because there is exactly one of these for the life of the
// app, and because AppKit calls back with a number rather than a pointer: the
// row that was clicked has to be found again from here.
var (
	trayMu      sync.Mutex
	trayRows    []trayItem
	trayOwner   *Tray
	trayIconRun = assets.TrayRunning
)

// apply redraws the menu bar item from the state it has been given.
func (t *Tray) apply() {
	t.mu.Lock()
	state := t.state
	t.mu.Unlock()

	// Filled while the services are up, hollow when they are not: a broken
	// runtime is visible without opening the menu.
	icon := trayIconRun
	if state.Running != nil && !*state.Running {
		icon = assets.TrayStopped
	}

	rows := trayMenuItems(state)

	trayMu.Lock()
	trayRows = rows
	trayOwner = t
	trayMu.Unlock()

	items := make([]C.DermagaTrayItem, len(rows))
	for i, row := range rows {
		title := C.CString(row.Label)
		defer C.free(unsafe.Pointer(title))

		items[i] = C.DermagaTrayItem{
			title: title,
			// Tags start at one: nothing should answer to a row that was never
			// given a number.
			tag:       C.int(i + 1),
			enabled:   boolToC(!row.Disabled),
			separator: boolToC(row.Separator),
		}
	}

	tooltip := C.CString("Dermaga — " + trayLabel(state))
	defer C.free(unsafe.Pointer(tooltip))

	var first *C.DermagaTrayItem
	if len(items) > 0 {
		first = &items[0]
	}

	C.trayApply(
		(*C.uchar)(unsafe.Pointer(&icon[0])), C.int(len(icon)),
		tooltip, first, C.int(len(items)),
	)
}

func boolToC(value bool) C.int {
	if value {
		return 1
	}

	return 0
}

// dermagaTrayClicked is AppKit reporting a row.
//
//export dermagaTrayClicked
func dermagaTrayClicked(tag C.int) {
	trayMu.Lock()
	rows, tray := trayRows, trayOwner
	trayMu.Unlock()

	index := int(tag) - 1
	if tray == nil || index < 0 || index >= len(rows) {
		return
	}

	row := rows[index]

	// Off the main thread before anything is done about it. This is called
	// with AppKit's own stack underneath, and every handler here goes on to
	// ask the agent something or to ask Wails for a window -- both of which
	// want the main thread back before they will answer.
	go tray.run(row.Action, row.ID)
}

// run does what the row said.
func (t *Tray) run(action, id string) {
	switch action {
	case "open":
		t.call(t.handlers.OnOpen)
	case "open-container":
		if t.handlers.OnOpenContainer != nil {
			t.handlers.OnOpenContainer(id)
		}
	case "start-services":
		t.call(t.handlers.OnStartServices)
	case "quit":
		t.call(t.handlers.OnQuit)
	}
}

func (t *Tray) call(handler func()) {
	if handler != nil {
		handler()
	}
}
