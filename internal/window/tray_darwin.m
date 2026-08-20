#import <Cocoa/Cocoa.h>

#import "tray_darwin.h"

// Implemented in Go.
extern void dermagaTrayClicked(int tag);

// The menu bar item, and the target its rows point at.
//
// Dermaga draws this itself rather than through the framework, because the
// framework opens the menu by synthesising a mouse press once the click has
// already been claimed -- which a right click survives and a left click does
// not, and a menu bar item that needs two fingers is not one people use.
//
// A menu handed to the status item is opened by AppKit itself, on either
// button, with the native highlight, and without bringing the app forward.
// That is the whole trick: hand it over and stop handling clicks.
@interface DermagaTray : NSObject
@property (nonatomic, retain) NSStatusItem *item;
@end

@implementation DermagaTray

- (void)rowClicked:(id)sender {
	dermagaTrayClicked((int)[(NSMenuItem *)sender tag]);
}

@end

// There is one menu bar item, for the life of the app.
static DermagaTray *tray = nil;

void trayApply(const unsigned char *icon, int iconLength, const char *tooltip,
               DermagaTrayItem *items, int count) {
	void (^draw)(void) = ^{
		if (tray == nil) {
			tray = [[DermagaTray alloc] init];
			tray.item = [[NSStatusBar systemStatusBar]
				statusItemWithLength:NSVariableStatusItemLength];
		}

		NSStatusBarButton *button = tray.item.button;

		if (icon != NULL && iconLength > 0) {
			NSImage *image = [[NSImage alloc]
				initWithData:[NSData dataWithBytes:icon length:iconLength]];
			// A template image follows the menu bar into dark mode and under
			// the highlight the open menu draws over it.
			[image setTemplate:YES];
			[image setSize:NSMakeSize([[NSStatusBar systemStatusBar] thickness],
			                          [[NSStatusBar systemStatusBar] thickness])];
			button.image = image;
			[image release];
		}

		if (tooltip != NULL) {
			button.toolTip = [NSString stringWithUTF8String:tooltip];
		}

		NSMenu *menu = [[NSMenu alloc] init];
		// Every row's state is decided in Go. Left to itself AppKit asks a
		// responder chain that knows nothing about any of this, and greys out
		// rows that are perfectly good.
		[menu setAutoenablesItems:NO];

		for (int i = 0; i < count; i++) {
			if (items[i].separator) {
				[menu addItem:[NSMenuItem separatorItem]];
				continue;
			}

			NSMenuItem *row = [[NSMenuItem alloc]
				initWithTitle:[NSString stringWithUTF8String:items[i].title]
				       action:@selector(rowClicked:)
				keyEquivalent:@""];
			row.target = tray;
			row.tag = items[i].tag;
			[row setEnabled:items[i].enabled ? YES : NO];
			[menu addItem:row];
			[row release];
		}

		tray.item.menu = menu;
		[menu release];
	};

	// AppKit answers on the main thread and nowhere else. Called from either
	// side, so the hop is guarded: dispatch_sync onto the queue you are
	// already on is a deadlock.
	if ([NSThread isMainThread]) {
		draw();
	} else {
		dispatch_sync(dispatch_get_main_queue(), draw);
	}
}
