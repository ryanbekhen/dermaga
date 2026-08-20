package window

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

static unsigned int readDisplayUnderCursor(void) {
	NSPoint where = [NSEvent mouseLocation];

	for (NSScreen *screen in [NSScreen screens]) {
		if (!NSPointInRect(where, [screen frame])) {
			continue;
		}

		NSNumber *number = [[screen deviceDescription] objectForKey:@"NSScreenNumber"];
		return [number unsignedIntValue];
	}

	return 0;
}

// The identifier of the display the pointer is on, or 0 if it is on none.
//
// An identifier rather than a position, because the two sides do not agree on
// units: AppKit answers in the screen's own points -- 1710 wide for a display
// Wails calls 1470 -- so a rectangle from here means nothing over there. The
// identifier needs no conversion, since Wails builds Screen.ID from this same
// number.
//
// AppKit answers questions about screens on the main thread and nowhere else.
// The hop is made here rather than in Go because it has to be safe from either
// side: dispatch_sync onto the queue you are already on is a deadlock.
static unsigned int displayUnderCursor(void) {
	if ([NSThread isMainThread]) {
		return readDisplayUnderCursor();
	}

	__block unsigned int out = 0;
	dispatch_sync(dispatch_get_main_queue(), ^{
		out = readDisplayUnderCursor();
	});

	return out;
}
*/
import "C"

import (
	"strconv"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// screenUnderCursor is the display the user is looking at.
//
// Windows open where the pointer is, not on whichever display macOS calls
// primary. On a two-monitor desk a window that always opens on the other
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

	for _, screen := range a.screens() {
		if screen.ID == id {
			return screen
		}
	}

	return nil
}

// screens is Wails' list of displays, waited for rather than asked for once.
//
// The list is filled as the application comes up, and the splash is created
// before that has happened -- it came back empty, so the splash landed on the
// primary display while the window that followed it a second later, by which
// time the list was there, opened on the right one. Half a second is far
// longer than it takes, and it is only ever waited for once.
func (a *App) screens() []*application.Screen {
	for range 50 {
		if screens := a.wails.Screen.GetAll(); len(screens) > 0 {
			return screens
		}

		time.Sleep(10 * time.Millisecond)
	}

	return nil
}
