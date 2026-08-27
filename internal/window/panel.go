package window

import (
	"log"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// The panel that hangs from the menu bar item.
//
// The same app, the same bridge and the same agent as the window -- a second
// page of the one bundle, at a hash that names it. What it is for is the two
// things people open the window to do and then close it again: see what is
// running, and start or stop one of them.
//
// It is a webview and not a drawn menu because the alternative was a menu with
// one hand-drawn row in it. Every pixel of an NSMenu except the text and the
// icon belongs to macOS -- background, highlight, row height, corners -- so a
// row with a button on it is a row that almost matches the ones above it, and
// a menu is where a person is least forgiving about almost. In a panel there
// are no system rows to be compared with.
//
// The native menu did not go away: it is the right button now. It draws when
// nothing else can -- before the frontend is up, with the agent down -- which
// is exactly when somebody is most likely to be asking the menu bar what is
// wrong.

const (
	// The panel's width, which is fixed: it is a column of rows, and a column
	// somebody can widen is a column somebody has to arrange.
	panelWidth = 380

	// Between the bottom of the menu bar and the top of the panel.
	panelGap = 6

	// What the page is allowed to ask for. The floor is one row and the
	// header; the ceiling is roughly a screen's worth, after which the list
	// inside it scrolls rather than the panel growing to the Dock.
	panelMinHeight = 140
	panelMaxHeight = 620

	// Between hiding and being allowed to open again.
	//
	// Clicking the menu bar item while the panel is open sends two things in
	// quick succession: the panel loses key and hides itself, and then the
	// click arrives here. Without this the second would undo the first and the
	// item would be a button that cannot close what it opened.
	panelReopenGuard = 250 * time.Millisecond
)

// Panel is the menu bar panel, and the little state that makes it behave like
// one: whether it is up, and when it last went down.
type Panel struct {
	app *App

	mu       sync.Mutex
	window   *application.WebviewWindow
	shown    bool
	hiddenAt time.Time
	height   int
}

func newPanel(app *App) *Panel {
	return &Panel{app: app, height: 420}
}

// Toggle is the left button on the menu bar item.
func (p *Panel) Toggle() {
	p.mu.Lock()
	shown, since := p.shown, time.Since(p.hiddenAt)
	p.mu.Unlock()

	if shown {
		p.Hide()

		return
	}

	// The panel hid itself a moment ago because this very click took the key
	// away from it. The click has already been answered.
	if since < panelReopenGuard {
		return
	}

	p.Show()
}

// Show puts the panel under the menu bar item.
func (p *Panel) Show() {
	window := p.ensure()
	if window == nil {
		return
	}

	p.mu.Lock()
	p.shown = true
	height := p.height
	p.mu.Unlock()

	// Sized before it is placed: the panel is pinned to the top of the screen
	// and grows downwards, so a stale height would put it in the right place
	// at the wrong size and then jump.
	window.SetSize(panelWidth, height)
	p.place(window)

	window.Show()
	window.Focus()
	traySetHighlighted(true)
}

// Shown is whether the panel is up, asked by the menu bar item before it
// decides what a click means.
func (p *Panel) Shown() bool {
	p.mu.Lock()
	defer p.mu.Unlock()

	return p.shown
}

// Hide takes it down.
func (p *Panel) Hide() {
	p.mu.Lock()
	if !p.shown {
		p.mu.Unlock()

		return
	}

	p.shown = false
	p.hiddenAt = time.Now()
	window := p.window
	p.mu.Unlock()

	if window != nil {
		window.Hide()
	}

	traySetHighlighted(false)
}

// Resize is the page saying how tall it has turned out to be.
//
// The panel is a list of whatever is running, and that is a different height
// on Monday than on Friday -- so the size is measured by the only side that
// can know it, and the window follows. Ignored while the panel is down, or the
// next thing to open would be sized for a list nobody is looking at.
func (p *Panel) Resize(height int) {
	if height < panelMinHeight {
		height = panelMinHeight
	}
	if height > panelMaxHeight {
		height = panelMaxHeight
	}

	p.mu.Lock()
	unchanged := p.height == height
	p.height = height
	window, shown := p.window, p.shown
	p.mu.Unlock()

	if unchanged || window == nil || !shown {
		return
	}

	window.SetSize(panelWidth, height)
	p.place(window)
}

// Warm makes the window before anybody asks for it.
//
// A menu bar panel is judged on the moment between the click and the list being
// on screen, and a webview booting in that moment is a panel that opens blank.
// Made a little after the app is up rather than during it: the window it is
// racing at startup is the real one, and this can wait for that to finish.
func (p *Panel) Warm() {
	p.ensure()
}

// ensure makes the panel window on first use and keeps it afterwards.
//
// Kept rather than remade. It costs a hidden window for the life of the app,
// which is the price of opening instantly.
func (p *Panel) ensure() *application.WebviewWindow {
	p.mu.Lock()
	if p.window != nil {
		window := p.window
		p.mu.Unlock()

		return window
	}
	p.mu.Unlock()

	window := p.app.wails.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:   "panel",
		Title:  "Dermaga",
		Width:  panelWidth,
		Height: 420,
		// Nothing to drag, nothing to resize, and no frame around it: the page
		// draws the whole of what is seen.
		Frameless:     true,
		DisableResize: true,
		Hidden:        true,
		// Above ordinary windows, at the level menus open at -- which is what
		// this is, whatever it is made of.
		AlwaysOnTop: true,
		// The panel's own surface, so opening it does not flash a colour the
		// page is about to paint over.
		BackgroundColour: panelSurface(),
		URL:              "/#panel",
		Mac: application.MacWindow{
			WindowLevel: application.MacWindowLevelPopUpMenu,
			WebviewPreferences: application.MacWebviewPreferences{
				AllowsBackForwardNavigationGestures: application.Disabled,
			},
		},
	})

	// Clicking anywhere else takes the panel down, which is what every menu on
	// this machine does and therefore the only thing that will not surprise
	// anybody. It is also how the menu bar item stops being a switch somebody
	// has to press twice.
	window.OnWindowEvent(events.Mac.WindowDidResignKey, func(*application.WindowEvent) {
		p.Hide()
	})

	p.mu.Lock()
	p.window = window
	p.mu.Unlock()

	return window
}

// place puts the panel under the menu bar item, on the screen the item is on.
//
// The arithmetic is in Objective-C rather than here: the item's own button is
// the only thing that knows where it ended up -- it moves with every other
// menu bar item that comes and goes -- and AppKit's coordinates start at the
// bottom of the screen, which is a conversion to get wrong in two places
// rather than one.
func (p *Panel) place(window *application.WebviewWindow) {
	native := window.NativeWindow()
	if native == nil {
		log.Println("[dermaga] the panel has no window to place yet")

		return
	}

	trayPositionWindow(native, panelGap)
}

// panelSurface is the colour the panel window is painted before its page
// arrives.
//
// The chrome's raised tone in each theme, which is what the page paints on top
// of -- the same reason the finding window asks for paper. A window that flashes
// the wrong colour for a frame is a panel that looks like it stuttered, and
// this one is opened and closed twenty times a day.
func panelSurface() application.RGBA {
	if darkMode() {
		// --chrome-raised, in the dark.
		return application.NewRGB(34, 29, 31)
	}

	// And in the light.
	return application.NewRGB(219, 213, 209)
}
