package window

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

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
	a.tray = NewTray(a.wails, TrayHandlers{
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

// --- the window -----------------------------------------------------------

func (a *App) createWindow() *application.WebviewWindow {
	options := application.WebviewWindowOptions{
		Title: "Dermaga",
		// Wide enough for the images table to fit without scrolling sideways:
		// the widest table needs 1030 for its columns, and the sidebar and the
		// page padding take 248 between them.
		Width:     1280,
		Height:    800,
		MinWidth:  900,
		MinHeight: 600,
		Hidden:    true,
		// A dropped file carries no path of its own to the web side; only this
		// side can resolve one, and only for files the user actually dropped.
		EnableFileDrop: true,
		Mac: application.MacWindow{
			TitleBar: application.MacTitleBar{
				AppearsTransparent: true,
				HideTitle:          true,
				FullSizeContent:    true,
			},
			InvisibleTitleBarHeight: 38,
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
		a.dock.HideAppIcon()
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
	a.dock.ShowAppIcon()
	window.Show()
	window.Focus()
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
