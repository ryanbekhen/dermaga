package window

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework CoreServices
#import <Cocoa/Cocoa.h>
#import <CoreServices/CoreServices.h>

// Whether macOS opened this as a login item, rather than a person opening it.
//
// The launch carries an Apple Event, and an app started at login is marked in
// it. Nothing in the environment says so: a login item and a double-click from
// Finder are both started by launchd, both with an `application.<bundle-id>…`
// XPC name -- which an earlier version of this read and got backwards, so
// clicking the icon opened an app with no window at all.
//
// The event is only there while the application is starting; asked later, this
// answers no. That is the safe way round: the worst it costs is a window at
// login that could have stayed closed.
static int launchedAsLoginItem(void) {
	NSAppleEventDescriptor *event = [[NSAppleEventManager sharedAppleEventManager] currentAppleEvent];
	if (event == nil) {
		return 0;
	}

	if ([event eventClass] != kCoreEventClass || [event eventID] != kAEOpenApplication) {
		return 0;
	}

	NSAppleEventDescriptor *property = [event paramDescriptorForKeyword:keyAEPropData];
	if (property == nil) {
		return 0;
	}

	return [property enumCodeValue] == keyAELaunchedAsLogInItem ? 1 : 0;
}
*/
import "C"

// openedAtLogin reports whether macOS started this, rather than the user.
//
// Someone who opens Dermaga themselves is asking for a window; someone logging
// in is not, and gets the menu bar alone.
func openedAtLogin() bool {
	return C.launchedAsLoginItem() == 1
}
