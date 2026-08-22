package window

import (
	"encoding/json"
	"log"
	"log/slog"
	"net/http"
	neturl "net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/ryanbekhen/dermaga/internal/settings"
	"github.com/ryanbekhen/dermaga/internal/window/assets"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/dock"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

// Dermaga: a native macOS UI for Apple's `container` runtime.
//
// A small Go agent wraps the CLI and this app subscribes to it. This is the
// broker between the two, in the same language as the agent, with the system's
// own webview drawing the window.

// A .app launched from Finder inherits a bare PATH, which will not contain the
// `container` binary. Put the usual install locations back.
var extraPATH = []string{"/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"}

// App is everything with a lifetime: the agent, the window, the menu bar item,
// and what the window is allowed to ask for.
type App struct {
	wails   *application.App
	bridge  *Bridge
	tray    *Tray
	notify  *notifications.NotificationService
	dock    *dock.DockService
	version string

	mu     sync.Mutex
	agent  *Agent
	window *application.WebviewWindow
	splash *application.WebviewWindow

	// Streams the startup sequence is listening to, keyed by stream id.
	streams map[string]func(method string, params json.RawMessage)

	// The update waiting for a restart, once one has been downloaded and found
	// installable. The menu bar offers it too: the window is often closed, and
	// somebody watching from the clock would otherwise never be told.
	staged StagedUpdate
}

// stage records a downloaded update and offers it from the menu bar.
func (a *App) stage(update StagedUpdate) {
	a.mu.Lock()
	a.staged = update
	tray := a.tray
	a.mu.Unlock()

	if tray != nil && update.Restartable {
		tray.Offer(update.Version)
	}
}

// stagedUpdate is what is waiting, if anything is.
func (a *App) stagedUpdate() StagedUpdate {
	a.mu.Lock()
	defer a.mu.Unlock()

	return a.staged
}

// Run draws the window and does not return until it closes.
//
// The version is passed in rather than read from here: it is stamped onto the
// command at build time, and this package should not have to know how.
func Run(version string) error {
	log.SetFlags(0)

	app := &App{version: version, streams: make(map[string]func(string, json.RawMessage))}
	app.bridge = NewBridge(app)
	app.notify = notifications.New()
	app.dock = dock.New()

	app.wails = application.New(application.Options{
		Name:        "Dermaga",
		Description: "A native macOS UI for Apple's container runtime",
		Services: []application.Service{
			application.NewService(app.bridge),
			application.NewService(app.notify),
			application.NewService(app.dock),
		},
		// The window builds every call from this, so it can never be looking
		// for a method by a name this side does not answer to.
		Flags: map[string]any{"bridge": BridgeName()},
		Assets: application.AssetOptions{
			Handler:    application.AssetFileServerFS(assets.Frontend),
			Middleware: contentSecurityPolicy,
		},
		Mac: application.MacOptions{
			// Closing the window does not quit on macOS: the app keeps
			// watching from the menu bar, which is where it can be opened
			// again -- and where Quit lives, because an app with no window has
			// no menu to press Cmd-Q against.
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		// One window's worth of Dermaga per Mac. Without this, opening the app
		// while it is already running -- which is exactly what someone does
		// when it has no Dock icon to click -- starts a second copy with a
		// second agent, two watchers and two sets of exit notifications.
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "dev.ryanbekhen.dermaga",
			OnSecondInstanceLaunch: func(application.SecondInstanceData) {
				app.ShowWindow()
			},
		},
		OnShutdown: func() {
			if agent := app.Agent(); agent != nil {
				agent.Stop()
			}
		},
	})

	// Replaces the browser's menu with the app's -- no Reload, no inspector, no
	// link to wails.io. Set before Run, which is when macOS reads it.
	app.wails.Menu.Set(menuBar())

	// An update downloaded before the last restart has either been installed by
	// it or overtaken; either way it is not worth keeping.
	go forgetOldUpdates(version)

	// A container that died while nobody was looking is exactly what a window
	// cannot report, so a click on the notice has to be able to open one.
	app.notify.OnNotificationResponse(func(result notifications.NotificationResult) {
		if result.Error != nil {
			return
		}

		if id, ok := result.Response.UserInfo["containerId"].(string); ok && id != "" {
			app.OpenContainer(id)
		}
	})

	// Startup waits for the application to be ready rather than racing it from
	// a goroutine: in a development build Wails has to reach the frontend dev
	// server before it can serve a window anything, and a window created
	// before then loads nothing at all.
	app.wails.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		go app.startUp()
	})

	return app.wails.Run()
}

// contentSecurityPolicy locks the window down to what it actually needs.
//
// The window has no network access of its own: everything goes to the agent
// through the bridge, so nothing here should ever open a connection. The
// runtime is served from the same origin, which is why 'self' is enough.
func contentSecurityPolicy(next http.Handler) http.Handler {
	// Vite's HMR client needs inline scripts and a websocket of its own, so a
	// development build gets none of this. The policy is about what a shipped
	// window may reach, and a shipped window has no dev server in front of it.
	if os.Getenv("FRONTEND_DEVSERVER_URL") != "" {
		return next
	}

	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Security-Policy",
			"default-src 'self'; connect-src 'self'"+cspConnectExtra+
				"; style-src 'self' 'unsafe-inline'; img-src 'self' data:")

		next.ServeHTTP(writer, request)
	})
}

// --- where things are -----------------------------------------------------

// socketPath is where this build's agent listens.
//
// A build under test keeps to its own socket. Sharing the installed app's
// socket meant the build you are working on quietly driving the agent of the
// one you have installed -- and later, with the background service running,
// never starting your own agent at all.
//
// The two are told apart by where the bundle sits rather than by a build flag,
// because that is the thing that actually decides it: the copy in
// /Applications is the one the user opens, and anything else is a build
// somebody is trying out.
func socketPath() string {
	// An explicit socket wins over both: it is how the agent itself is told
	// where to listen.
	if socket := os.Getenv("DERMAGA_SOCKET"); socket != "" {
		return socket
	}

	if isInstalled() {
		return filepath.Join(homeDir(), ".dermaga", "agent.sock")
	}

	return filepath.Join(homeDir(), ".dermaga", "dev.sock")
}

// isInstalled reports whether this is the copy in /Applications.
func isInstalled() bool {
	executable, err := os.Executable()
	if err != nil {
		return false
	}

	return strings.HasPrefix(executable, "/Applications/")
}

// agentBinary is the agent this app starts when nothing else is serving.
//
// It travels in the bundle's Resources, so it is always the one that matches
// this build -- an app and an agent that disagree about the protocol between
// them is a failure with no good error message.
func agentBinary() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}

	candidate := filepath.Join(filepath.Dir(filepath.Dir(executable)), "Resources", "dermaga-agent")
	if _, err := os.Stat(candidate); err != nil {
		return ""
	}

	return candidate
}

// --- the agent ------------------------------------------------------------

// Agent is whatever agent connection there is, if any.
func (a *App) Agent() *Agent {
	a.mu.Lock()
	defer a.mu.Unlock()

	return a.agent
}

// MainWindow is the window, if one is open.
func (a *App) MainWindow() *application.WebviewWindow {
	a.mu.Lock()
	defer a.mu.Unlock()

	return a.window
}

// StartAgent connects to whichever agent is running, starting one if none is.
func (a *App) StartAgent() error {
	binary := agentBinary()
	if binary == "" {
		log.Println("[dermaga] agent binary not found; run `make agent`")
		return nil
	}

	socket := socketPath()

	// DERMAGA_SOCKET travels to the agent this app starts, so it listens where
	// this app is looking.
	env := append(os.Environ(), "DERMAGA_SOCKET="+socket)
	env = append(env, "PATH="+mergedPATH())

	agent := NewAgent(binary, socket, env, a.onNotify, func(code *int) {
		log.Println("[dermaga] lost the agent", code)
	})

	a.mu.Lock()
	a.agent = agent
	a.mu.Unlock()

	return agent.Start()
}

func mergedPATH() string {
	seen := make(map[string]bool)
	var out []string

	for _, dir := range append(strings.Split(os.Getenv("PATH"), ":"), extraPATH...) {
		if dir == "" || seen[dir] {
			continue
		}
		seen[dir] = true
		out = append(out, dir)
	}

	return strings.Join(out, ":")
}

// onNotify forwards everything the agent pushes -- snapshots, stream chunks,
// terminal output -- to the window as one channel, and acts on the few things
// that matter even when there is no window to forward to.
func (a *App) onNotify(message Notification) {
	// Startup runs its own streams before any window exists to forward to.
	if listener, id := a.streamListener(message.Params); listener != nil {
		listener(message.Method, message.Params)
		_ = id
	}

	switch message.Method {
	case "containers.exited":
		a.notifyExit(message.Params)

	case "events.snapshot":
		// The menu bar reads the same snapshots the window does, so it stays
		// right whether or not there is a window to send them to.
		a.updateTrayFromSnapshot(message.Params)
	}

	a.emit("dermaga:notify", message)
}

func (a *App) streamListener(params json.RawMessage) (func(string, json.RawMessage), string) {
	if len(params) == 0 {
		return nil, ""
	}

	var envelope struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(params, &envelope); err != nil || envelope.ID == "" {
		return nil, ""
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	return a.streams[envelope.ID], envelope.ID
}

func (a *App) emit(name string, data any) {
	if a.wails == nil {
		return
	}

	a.wails.Event.Emit(name, data)
}

// --- notifications --------------------------------------------------------

// notifyExit tells the user a container stopped without being asked to.
//
// The app usually sits in the background, so this is the one thing it has to
// say unprompted -- a container that died while nobody was looking is exactly
// what a window cannot report. Deliberate stops are filtered out by the agent,
// so anything reaching here is genuinely unexpected.
func (a *App) notifyExit(params json.RawMessage) {
	var exit struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Image string `json:"image"`
	}

	if err := json.Unmarshal(params, &exit); err != nil || exit.Name == "" {
		return
	}

	if !a.bridge.notifyOnExit() {
		log.Println("[dermaga] exit notification suppressed by settings")
		return
	}

	body := "Nothing asked it to stop."
	if exit.Image != "" {
		body = "Running " + exit.Image + ". Nothing asked it to stop."
	}

	log.Println("[dermaga] notifying about", exit.Name)

	// Notifications fail quietly on macOS -- an app that has not been granted
	// permission simply never shows one -- so the reason is written down.
	if err := a.notify.SendNotification(notifications.NotificationOptions{
		ID:    "exit-" + exit.ID,
		Title: exit.Name + " stopped",
		Body:  body,
		Data:  map[string]any{"containerId": exit.ID},
	}); err != nil {
		log.Println("[dermaga] could not raise a notification:", err)
	}
}

// --- the menu bar ---------------------------------------------------------

func (a *App) updateTrayFromSnapshot(params json.RawMessage) {
	if a.tray == nil {
		return
	}

	var snapshot struct {
		Containers []struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Status string `json:"status"`
		} `json:"containers"`
	}

	if err := json.Unmarshal(params, &snapshot); err != nil {
		return
	}

	running := make([]TrayContainer, 0, len(snapshot.Containers))
	for _, container := range snapshot.Containers {
		if container.Status == "running" {
			running = append(running, TrayContainer{ID: container.ID, Name: container.Name})
		}
	}

	a.tray.Update(nil, running)
}

// startTray brings up the menu bar item and keeps it current.
//
// This side subscribes to the agent in its own right rather than relying on
// the window having done so, because the whole point of the menu bar is to be
// right when there is no window.
func (a *App) startTray() {
	a.tray = NewTray(TrayHandlers{
		OnOpen:          a.ShowWindow,
		OnOpenContainer: a.OpenContainer,
		OnStartServices: func() {
			go func() {
				if err := a.startServices(); err != nil {
					log.Println("[dermaga] tray could not start services:", err)
				}
				a.refreshTrayServices()
			}()
		},
		OnOpenProject: a.OpenProjectPage,
		OnRestartUpdate: func() {
			staged := a.stagedUpdate()
			if staged.Path == "" {
				return
			}

			go func() {
				if err := a.bridge.InstallUpdate(staged.Path); err != nil {
					log.Println("[dermaga] the update could not be installed:", err)
				}
			}()
		},
		OnQuit: func() { a.wails.Quit() },
	})

	if agent := a.Agent(); agent != nil {
		if _, err := agent.Invoke("events.subscribe", nil); err != nil {
			log.Println("[dermaga] tray subscription failed:", err)
		}
	}

	a.refreshTrayServices()

	go func() {
		for range time.Tick(20 * time.Second) {
			a.refreshTrayServices()
		}
	}()

	log.Println("[dermaga] menu bar item up")
}

func (a *App) refreshTrayServices() {
	if a.tray == nil {
		return
	}

	running := a.servicesRunning()
	a.tray.Update(&running, nil)
}

func (a *App) servicesRunning() bool {
	agent := a.Agent()
	if agent == nil {
		return false
	}

	var report struct {
		Status struct {
			Running bool `json:"running"`
		} `json:"status"`
	}

	// The agent may be starting or gone; either way the services cannot be
	// reported as up.
	if err := agent.InvokeInto("system.status", nil, &report); err != nil {
		return false
	}

	return report.Status.Running
}

// OpenFindingWindow puts one vulnerability on screen in a window of its own.
//
// Deliberately an ordinary macOS window, title bar and all, where the main one
// is frameless: this is a secondary window about one thing, and the title bar
// is where that thing is named. It also means the window can be moved, zoomed
// and closed by the usual means without the app drawing any of it.
//
// Several can be open at once, one per finding, which is the point -- comparing
// two of them is the reason to open either.
// paper is the colour a document window is painted before its page arrives.
//
// It has to match what the page will be, or opening one flashes the opposite
// theme for as long as the webview takes to paint. The main window can get
// away with a fixed dark colour because its chrome is dark either way; this
// one is a sheet of paper in light mode and near-black in dark, so it has to
// ask.
//
// "system" is what the setting says by default, and the answer to that lives
// with macOS rather than with us.
func paper() application.RGBA {
	dark := false

	switch settings.NewStore(slog.New(slog.DiscardHandler)).Load().Theme {
	case "dark":
		dark = true
	case "light":
		dark = false
	default:
		out, err := exec.Command("defaults", "read", "-g", "AppleInterfaceStyle").Output()
		dark = err == nil && strings.Contains(string(out), "Dark")
	}

	if dark {
		// ink-950, which is what the page paints itself in dark mode.
		return application.NewRGB(30, 26, 28)
	}

	return application.NewRGB(255, 255, 255)
}

func (a *App) OpenFindingWindow(reference, id string) {
	// A page, not a panel. The width is fixed and the height is not, which is
	// what a sheet of paper is: the measure a line is set to does not change
	// because there is more to say, only how far down it goes. It also means
	// the reader never has to arrange anything -- the window opens at the
	// proportions it is meant to be read at.
	//
	// Close only. Minimise and zoom are for windows you keep; this one is open
	// while a question is being answered and shut afterwards, and a zoom button
	// on a fixed width would either do nothing or break the measure.
	const pageWidth = 620

	window := a.wails.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  id,
		Width:  pageWidth,
		Height: 820,
		// Equal minimum and maximum is how a width is fixed: macOS lets the
		// bottom edge be dragged and refuses the sides.
		MinWidth:  pageWidth,
		MaxWidth:  pageWidth,
		MinHeight: 420,

		MinimiseButtonState:   application.ButtonHidden,
		MaximiseButtonState:   application.ButtonHidden,
		FullscreenButtonState: application.ButtonHidden,
		Mac: application.MacWindow{
			// No title bar drawn, so no rule across the top of the page. A
			// sheet of paper does not have a strip at the top of it, and the
			// separator was the one line on screen that said "window" rather
			// than "document".
			//
			// The title is still set -- Mission Control and the Window menu
			// need a name for it -- it is just not painted over the page. The
			// page says the same thing in its own heading anyway, so drawing
			// it twice was only ever a way of drawing that line.
			TitleBar: application.MacTitleBar{
				AppearsTransparent: true,
				HideTitle:          true,
				FullSizeContent:    true,
				// Same trick the main window uses, for the same reason:
				// macOS centres the close button in whatever it considers
				// the title bar, and left alone that is the standard 28pt
				// strip -- so the button sat near the top of our 44px band
				// rather than in the middle of it. Reporting a toolbar makes
				// macOS grow the title bar to fit and re-centre the button
				// in the taller strip. The toolbar holds nothing and is
				// never seen; its separator would be the very line this
				// window is meant not to have.
				UseToolbar:           true,
				HideToolbarSeparator: true,
				ToolbarStyle:         application.MacToolbarStyleUnified,
			},
			// The strip the close button is centred in, and what the window
			// is dragged by. The page leaves the same room at the top, and
			// the two numbers have to agree or the button drifts off the
			// line the page starts on.
			InvisibleTitleBarHeight: 44,
			WebviewPreferences: application.MacWebviewPreferences{
				TabFocusesLinks: application.Enabled,
				// Nothing here is a document, so there is nothing to swipe back
				// to -- and a swipe that navigates this window away from the
				// app has no way back.
				AllowsBackForwardNavigationGestures: application.Disabled,
			},
		},
		// The page's own colour, so opening it does not flash the app's ground
		// before the sheet is drawn.
		BackgroundColour: application.NewRGB(255, 255, 255),
		// A hash, not a path: the asset server hands back one bundle whatever
		// is asked for, and the window reads its own address to know what it
		// is for.
		URL: "/#finding/" + neturl.PathEscape(reference) + "/" + neturl.PathEscape(id),

		// Where the pointer is, which is where the click that opened it came
		// from -- not on whichever display macOS calls primary. On a two-screen
		// desk, a window that always appears on the other one is the difference
		// between an app that behaves and one that does not; and this window
		// exists to sit beside the list it was opened from.
		InitialPosition: application.WindowCentered,
		Screen:          a.screenUnderCursor(),
	})

	window.Show()
}

// --- the window -----------------------------------------------------------

func (a *App) createWindow() *application.WebviewWindow {
	options := application.WebviewWindowOptions{
		Title: "Dermaga",
		// Sized by the widest thing in the app, which is no longer the images
		// table: an image's Packages tab puts a six-column table beside the
		// 320px rail, with the 232px sidebar left of both. Those columns need
		// 732 at their floors, so 1284 is where the table stops scrolling
		// sideways -- four pixels more than this window used to open at, which
		// is why the licence column kept falling off the end of a fresh
		// install.
		//
		// 1400 is that floor plus room for the name and licence columns to be
		// worth reading rather than merely present. Taller by the same logic:
		// a package opened onto its CVEs wants more than four of them visible
		// to be worth opening. macOS clamps both to the display, so a smaller
		// screen simply gets what it has.
		Width:  1400,
		Height: 860,
		// The floor is set by the widest thing the layout has to hold at once:
		// the sidebar (232), a detail page's rail (320), and enough content
		// column between them for a table to be read rather than guessed at
		// (about 500). Below that the panes stop being narrow and start being
		// squeezed -- headings wrapping onto three lines, columns colliding.
		//
		// It used to be 900, which predates the rail. A detail page at 900 left
		// under 350 for the thing the page is actually about.
		//
		// The ceiling on this number is the smallest display anyone runs on:
		// 1280x800 is the smallest common Mac resolution, so the floor has to
		// leave room to move the window on one.
		MinWidth:  1120,
		MinHeight: 720,
		Hidden:    true,
		// A dropped file carries no path of its own to the web side; only this
		// side can resolve one, and only for files the user actually dropped.
		EnableFileDrop: true,
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBar{
				AppearsTransparent: true,
				HideTitle:          true,
				FullSizeContent:    true,
				// macOS places the close/minimise/zoom buttons itself, centred
				// in whatever it considers the title bar to be -- there is no
				// option anywhere to move them. Left to itself that is the
				// standard 28pt strip, so the buttons sat near the top of our
				// 48px bar with the logo a good ten pixels below them.
				//
				// A unified toolbar is how a Mac app makes that strip taller:
				// the window reports a toolbar, macOS grows the title bar to
				// fit it, and it re-centres the buttons in the taller strip --
				// which brings them down onto the same line as everything else
				// in the bar. The toolbar itself holds nothing and is never
				// seen; its separator would be a second line under our own, so
				// it is hidden.
				UseToolbar:           true,
				HideToolbarSeparator: true,
				ToolbarStyle:         application.MacToolbarStyleUnified,
			},
			// Matches the bar the frontend draws, so the whole of it moves the
			// window and nothing below it does -- and, with the unified
			// toolbar above, the height macOS centres the buttons in. The two
			// numbers have to agree: at 48 against a 52pt toolbar the buttons
			// sat a couple of pixels below the logo.
			InvisibleTitleBarHeight: 52,
			WebviewPreferences: application.MacWebviewPreferences{
				// WebKit leaves buttons and links out of the tab order
				// unless asked. Without this, Tab inside a dialog skips
				// every control that is not a text field, which is most
				// of them.
				TabFocusesLinks: application.Enabled,
				// Nothing here is a document, so there is nothing to swipe
				// back to -- and a two-finger swipe that navigates the window
				// away from the app has no way back.
				AllowsBackForwardNavigationGestures: application.Disabled,
			},
		},
		// Avoids a white flash into a dark UI (and the reverse) on launch.
		BackgroundColour: application.NewRGB(19, 19, 23),
		URL:              "/",
	}

	options.InitialPosition = application.WindowCentered
	options.Screen = a.screenUnderCursor()

	window := a.wails.Window.NewWithOptions(options)

	// The traffic lights disappear in fullscreen, so the UI needs to know.
	window.OnWindowEvent(events.Common.WindowFullscreen, func(*application.WindowEvent) {
		a.emit("dermaga:fullscreen", true)
	})
	window.OnWindowEvent(events.Common.WindowUnFullscreen, func(*application.WindowEvent) {
		a.emit("dermaga:fullscreen", false)
	})

	// A file dragged in from Finder never reaches the page: the drag is caught
	// natively, before the web content sees it, so there is no DOM drop event
	// to read paths from. What arrives here instead is the drop -- with the
	// paths, and with the element it landed on, which is how the window knows
	// the file browser was the target and not some other part of the page.
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		dropped := map[string]any{"paths": event.Context().DroppedFiles()}

		if target := event.Context().DropTargetDetails(); target != nil {
			dropped["target"] = target.Attributes["data-file-drop-target"]
		}

		a.emit("dermaga:files-dropped", dropped)
	})

	// The window is gone, but the app is not: it keeps watching from the menu
	// bar, which is where it can be opened again.
	window.OnWindowEvent(events.Common.WindowClosing, func(*application.WindowEvent) {
		a.mu.Lock()
		a.window = nil
		a.mu.Unlock()

		// An app with a window belongs in the Dock; an app without one belongs
		// only in the menu bar, which is where it can be opened again.
		a.hideDockIcon()
	})

	a.mu.Lock()
	a.window = window
	a.mu.Unlock()

	return window
}

// ShowWindow puts the window in front, creating it if this launch never made
// one.
func (a *App) ShowWindow() {
	window := a.MainWindow()
	if window == nil {
		window = a.createWindow()
	}

	// The Dock icon comes back the moment there is a window to click it for.
	a.showDockIcon()
	window.Show()
	window.Focus()
}

// showDockIcon and hideDockIcon ask the Dock from somewhere other than the main
// thread, always.
//
// Wails' dock service is a bare dispatch_sync onto the main queue with no check
// for already being on it, and asking a queue you are already on to wait for
// you is a deadlock -- which the runtime turns into a trap and the app dies on
// the spot, with no crash report and no window, leaving its agent running.
//
// That is not hypothetical: a notification response arrives on the main thread,
// so clicking "web stopped" killed Dermaga outright. The menu bar survived it
// only because its handlers already run on a goroutine.
//
// Handing the ask to another goroutine is what makes the dispatch legal. It is
// asynchronous, which costs nothing: the Dock icon is not something anything
// waits on.
func (a *App) showDockIcon() {
	go a.dock.ShowAppIcon()
}

func (a *App) hideDockIcon() {
	go a.dock.HideAppIcon()
}

// OpenProjectPage opens the repository in the user's browser.
//
// The address is built from the same constant the update check reads releases
// from, so the menu bar can never point somewhere the app no longer updates
// from.
func (a *App) OpenProjectPage() {
	url := "https://github.com/" + updateRepo

	if err := exec.Command("open", url).Run(); err != nil {
		log.Println("[dermaga] could not open", url+":", err)
	}
}

// OpenContainer opens a container, from wherever the ask came: a notification
// about a container that died, or the menu bar. Both are used precisely when
// there is no window, which is what made them do nothing at all.
func (a *App) OpenContainer(id string) {
	had := a.MainWindow() != nil

	a.ShowWindow()

	// A window that was already up has a listener; a new one does not, and
	// will ask for this the moment it can.
	if had {
		a.emit("dermaga:open-container", id)
		return
	}

	a.bridge.setPendingOpen(id)
}

func (a *App) quitAfterOpeningInstaller() {
	go func() {
		time.Sleep(1500 * time.Millisecond)
		a.wails.Quit()
	}()
}
