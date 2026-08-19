package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

// The identifier of the display the pointer is on, or 0 if it is on none.
//
// Wails knows every screen but not where the pointer is, and AppKit is the
// only thing that does. The identifier is what comes back rather than a
// position, because a position would have to be converted between Cocoa's
// coordinates and Wails' before it meant anything, and the identifier needs no
// conversion at all: Wails builds Screen.ID from this same number.
static unsigned int displayUnderCursor(void) {
	NSPoint where = [NSEvent mouseLocation];

	for (NSScreen *screen in [NSScreen screens]) {
		if (NSPointInRect(where, [screen frame])) {
			NSNumber *number = [[screen deviceDescription] objectForKey:@"NSScreenNumber"];
			return [number unsignedIntValue];
		}
	}

	return 0;
}
*/
import "C"

import (
	"strconv"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// screenUnderCursor is where the user is looking.
//
// Windows open on the display the pointer is on, not on whichever one macOS
// calls primary. It is the best available guess and it is what every other Mac
// app does -- on a two-monitor desk, a window that always opens on the other
// screen is the difference between an app that behaves and one that does not.
//
// Returns nil when there is no answer, which leaves the placement to the
// system rather than putting the window somewhere worse.
func (a *App) screenUnderCursor() *application.Screen {
	display := uint(C.displayUnderCursor())
	if display == 0 {
		return nil
	}

	id := strconv.FormatUint(uint64(display), 10)

	for _, screen := range a.wails.Screen.GetAll() {
		if screen.ID == id {
			return screen
		}
	}

	return nil
}
