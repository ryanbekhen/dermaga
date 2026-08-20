package main

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

typedef struct {
	int found;
	int x;
	int y;
	int width;
	int height;
} WorkArea;

// The usable area of the display the pointer is on.
//
// Cocoa puts the origin at the bottom left of the primary screen with y going
// up; every window API here works top-left with y going down, so the origin is
// flipped on the way out. That is the same conversion Wails makes for its own
// screen list, which is what makes the two agree.
static WorkArea workAreaUnderCursor(void) {
	WorkArea out = {0, 0, 0, 0, 0};

	NSArray<NSScreen *> *screens = [NSScreen screens];
	if ([screens count] == 0) {
		return out;
	}

	// The first screen is the one with the menu bar, and every other screen's
	// position is measured against it.
	CGFloat primaryHeight = [[screens objectAtIndex:0] frame].size.height;
	NSPoint where = [NSEvent mouseLocation];

	for (NSScreen *screen in screens) {
		if (!NSPointInRect(where, [screen frame])) {
			continue;
		}

		NSRect area = [screen visibleFrame];

		out.found = 1;
		out.x = (int)area.origin.x;
		out.y = (int)(primaryHeight - area.origin.y - area.size.height);
		out.width = (int)area.size.width;
		out.height = (int)area.size.height;

		return out;
	}

	return out;
}
*/
import "C"

// placeUnderCursor is where a window of this size should open.
//
// Windows open on the display the pointer is on, not on whichever one macOS
// calls primary. On a two-monitor desk a window that always opens on the other
// screen is the difference between an app that behaves and one that does not.
//
// AppKit is asked directly rather than Wails' screen list, because that list is
// still empty when the splash is created -- which put the splash on one display
// and the window that followed it on another.
//
// Returns ok false when there is no answer, which leaves the placement to the
// system rather than putting the window somewhere worse.
func placeUnderCursor(width, height int) (x int, y int, ok bool) {
	area := C.workAreaUnderCursor()
	if area.found == 0 {
		return 0, 0, false
	}

	// A window larger than the display it lands on would otherwise be pushed
	// off-screen.
	fittedWidth := min(width, int(area.width))
	fittedHeight := min(height, int(area.height))

	return int(area.x) + (int(area.width)-fittedWidth)/2,
		int(area.y) + (int(area.height)-fittedHeight)/2,
		true
}
