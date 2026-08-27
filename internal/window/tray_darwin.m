#import <Cocoa/Cocoa.h>

#import "tray_darwin.h"

// Implemented in Go.
extern void dermagaTrayToggled(void);
extern int dermagaPanelShown(void);

// The menu bar item, and the target its button points at.
//
// The click is handled here rather than by handing AppKit a menu and standing
// back, because there is no menu any more: either button opens the panel, which
// is a window and therefore this side's business to ask for.
@interface DermagaTray : NSObject
@property (nonatomic, retain) NSStatusItem *item;
@end

@implementation DermagaTray

- (void)buttonClicked:(id)sender {
	// Brought forward here, inside the click, and nowhere else.
	//
	// Only the active app has a key window, and a panel that is not key cannot
	// be closed with Escape, cannot notice the pointer going elsewhere, and
	// answers its first click by taking focus rather than by doing what was
	// pressed. That is the cost of the panel being an ordinary window: a
	// non-activating one is an NSPanel, and the window is Wails'.
	//
	// It has to be here because macOS only grants an app the front while it is
	// answering something the user did. Asked for a moment later -- from the
	// goroutine that shows the window -- it is refused, silently, and the panel
	// opens unfocused. Not on the way down, though: closing the panel is not a
	// reason to bring an app forward.
	if (!dermagaPanelShown()) {
		[NSApp activateIgnoringOtherApps:YES];
	}

	dermagaTrayToggled();
}

@end

// There is one menu bar item, for the life of the app.
static DermagaTray *tray = nil;

void trayApply(const unsigned char *icon, int iconLength, const char *tooltip) {
	void (^draw)(void) = ^{
		if (tray == nil) {
			tray = [[DermagaTray alloc] init];
			tray.item = [[NSStatusBar systemStatusBar]
				statusItemWithLength:NSVariableStatusItemLength];

			// Both buttons, and on the way down rather than on the way up: a
			// menu bar item that waits for the mouse to come back up feels like
			// a button that did not take.
			NSStatusBarButton *button = tray.item.button;
			button.target = tray;
			button.action = @selector(buttonClicked:);
			[button sendActionOn:(NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown)];
		}

		NSStatusBarButton *button = tray.item.button;

		if (icon != NULL && iconLength > 0) {
			NSImage *image = [[NSImage alloc]
				initWithData:[NSData dataWithBytes:icon length:iconLength]];
			// A template image follows the menu bar into dark mode and under
			// the highlight the open panel draws over it.
			[image setTemplate:YES];
			[image setSize:NSMakeSize([[NSStatusBar systemStatusBar] thickness],
			                          [[NSStatusBar systemStatusBar] thickness])];
			button.image = image;
			[image release];
		}

		if (tooltip != NULL) {
			button.toolTip = [NSString stringWithUTF8String:tooltip];
		}
	};

	// AppKit answers on the main thread and nowhere else. Called from either
	// side, so the hop is guarded: dispatch_sync onto the queue you are already
	// on is a deadlock.
	if ([NSThread isMainThread]) {
		draw();
	} else {
		dispatch_sync(dispatch_get_main_queue(), draw);
	}
}

void trayPositionWindow(void *nsWindow, int gap) {
	void (^place)(void) = ^{
		if (tray == nil || nsWindow == NULL) {
			return;
		}

		NSStatusBarButton *button = tray.item.button;
		NSRect item = [button.window convertRectToScreen:button.frame];

		NSScreen *screen = button.window.screen;
		if (screen == nil) {
			screen = [NSScreen mainScreen];
		}

		NSWindow *window = (NSWindow *)nsWindow;
		NSRect frame = window.frame;

		// Centred under the item, and pushed back onto the screen if the item
		// is near a corner -- which it will be, because the menu bar is where
		// everything else already is.
		CGFloat x = NSMidX(item) - frame.size.width / 2;
		CGFloat right = NSMaxX(screen.frame) - frame.size.width - gap;
		if (x > right) {
			x = right;
		}
		if (x < NSMinX(screen.frame) + gap) {
			x = NSMinX(screen.frame) + gap;
		}

		// Under the menu bar, which is what visibleFrame starts below. Read
		// from the screen rather than from the item: the item is as tall as the
		// bar, but a panel hung off the bottom of it sits a hair high on a
		// display with a notch.
		CGFloat y = NSMaxY(screen.visibleFrame) - frame.size.height - gap;

		frame.origin = NSMakePoint(x, y);
		[window setFrame:frame display:YES animate:NO];
	};

	if ([NSThread isMainThread]) {
		place();
	} else {
		dispatch_sync(dispatch_get_main_queue(), place);
	}
}

void trayHighlight(int on) {
	void (^draw)(void) = ^{
		if (tray != nil) {
			// What an open menu used to do to the item on its own. The panel is
			// not a menu, so it has to say so itself -- without this, the one
			// thing on screen that is showing a panel looks untouched.
			tray.item.button.highlighted = on ? YES : NO;
		}
	};

	if ([NSThread isMainThread]) {
		draw();
	} else {
		dispatch_sync(dispatch_get_main_queue(), draw);
	}
}
