package window

import (
	"encoding/json"
	"errors"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The bootstrap.
//
// The splash is the bootstrap, not a progress bar over one. It checks each
// prerequisite and fixes what it can: installing the CLI through Homebrew,
// starting the services if they are down. Without Homebrew there is nothing it
// can do, so it says so and the app closes rather than opening onto a UI that
// cannot work.

// On a warm machine every step finishes in a few hundred milliseconds, and a
// splash that flashes past reads as a glitch rather than as progress. Hold it
// long enough to actually be read.
const (
	minSplash    = 2200 * time.Millisecond
	splashSettle = 700 * time.Millisecond
)

// The kernel is 569 MB and the runtime fetches it from GitHub, so on a slow
// line this legitimately takes the best part of an hour. There is no time
// limit on it -- only on silence: if nothing at all is reported for this long,
// the download has stalled rather than slowed, and the window opens anyway.
const kernelStall = 3 * time.Minute

func (a *App) startUp() {
	startedAt := time.Now()

	// macOS opened this, not the user: it starts in the menu bar with no
	// window, no splash and no Dock icon. Someone who launches Dermaga
	// themselves is asking for a window; someone logging in is not.
	atLogin := openedAtLogin()

	if atLogin {
		// macOS opened this: no window, no splash, and no Dock icon either.
		a.dock.HideAppIcon()
	} else {
		a.createSplash()
	}

	// 1. The agent itself: the one already running, or one started here.
	a.splashStep("agent", "active", "")
	if err := a.StartAgent(); err != nil {
		log.Println("[dermaga] could not reach an agent:", err)
	}

	var toolchain struct {
		BrewAvailable bool   `json:"brewAvailable"`
		Installed     bool   `json:"installed"`
		Version       string `json:"version"`
	}

	agent := a.Agent()
	if agent == nil {
		a.splashFatal("The Dermaga agent did not start", "No agent binary was found. Run `make agent` and open Dermaga again.")
		return
	}

	if err := agent.InvokeInto("toolchain.status", nil, &toolchain); err != nil {
		log.Println("[dermaga] agent did not answer:", err)
		a.splashFatal("The Dermaga agent did not start", err.Error())
		return
	}
	a.splashStep("agent", "done", "")

	// 2. Homebrew, which everything else here depends on.
	a.splashStep("brew", "active", "")
	if !toolchain.BrewAvailable {
		a.splashFatal(
			"Homebrew is required",
			"Dermaga installs and updates Apple’s container CLI through Homebrew. Install it from brew.sh, then open Dermaga again.",
		)
		return
	}
	a.splashStep("brew", "done", "Homebrew found")

	// 3. The container CLI, installed here if it is missing.
	if toolchain.Installed {
		a.splashStep("cli", "done", strings.TrimSpace("Container CLI "+toolchain.Version))
	} else {
		a.splashStep("cli", "active", "Installing the container CLI…")

		err := a.runStream("toolchain.install", nil, func(line string) {
			if trimmed := strings.TrimSpace(line); trimmed != "" {
				a.splashStep("cli", "active", clip(trimmed, 60))
			}
		})

		if err != nil {
			log.Println("[dermaga] install failed:", err)
			a.splashFatal("Could not install the container CLI", err.Error())
			return
		}

		a.splashStep("cli", "done", "Container CLI installed")
	}

	// 4. The background services, started here if they are down.
	a.splashStep("services", "active", "")
	if err := a.prepareServices(); err != nil {
		log.Println("[dermaga] services did not start:", err)
		// Not fatal: the app opens on its own "services are down" screen,
		// which offers the fix and can say more than one line of splash can.
		a.splashStep("services", "failed", "Could not start services")
	}

	// 5. The menu bar item, before the window: from here on Dermaga has a face
	// even when nothing is open.
	a.startTray()

	// Launched at login, this is the whole of startup: the agent is up, the
	// menu bar is watching, and exit notices work without anything on screen.
	if atLogin {
		return
	}

	// 6. The window itself.
	a.splashStep("ui", "active", "")
	window := a.createWindow()

	// Whichever comes first: the window reporting itself ready, or a timeout
	// so a stuck load cannot trap the user behind the splash.
	a.waitForWindow(window, 8*time.Second)

	a.splashStep("ui", "done", "")

	// Let the last step register as complete, then hold the whole splash to
	// its minimum so a fast start still shows what happened.
	time.Sleep(splashSettle)
	if remaining := minSplash - time.Since(startedAt); remaining > 0 {
		time.Sleep(remaining)
	}

	a.closeSplash()
	window.Show()
	window.Focus()
}

func (a *App) prepareServices() error {
	agent := a.Agent()
	if agent == nil {
		return ErrNotRunning
	}

	var report struct {
		Status struct {
			Running bool `json:"running"`
		} `json:"status"`
	}

	if err := agent.InvokeInto("system.status", nil, &report); err != nil {
		return err
	}

	if report.Status.Running {
		a.splashStep("services", "done", "Services running")
	} else {
		a.splashStep("services", "active", "Starting services…")
		if err := a.startServices(); err != nil {
			return err
		}
		a.splashStep("services", "done", "Services started")
	}

	// Checked whether or not the services needed starting: they run happily
	// with no kernel at all, and the failure is saved up for the first
	// container anyone tries to run.
	a.ensureKernel()

	return nil
}

// startServices starts the container services, installing the Linux kernel
// first if that is what is in the way.
//
// A Mac that has never run a container has no kernel, and the runtime refuses
// to start until one is set -- telling the user to go and run
// `container system kernel set` by hand. Nothing works without it, so this is
// part of getting ready rather than a choice worth interrupting for.
func (a *App) startServices() error {
	agent := a.Agent()
	if agent == nil {
		return ErrNotRunning
	}

	_, err := agent.Invoke("system.start", map[string]any{"installKernel": false})
	if err == nil {
		return nil
	}

	// The runtime refuses to start until a kernel is set on some versions;
	// installing it is what ensureKernel does, so let it through and try again.
	if !strings.Contains(strings.ToLower(err.Error()), "kernel") {
		return err
	}

	a.ensureKernel()

	_, err = agent.Invoke("system.start", map[string]any{"installKernel": true})

	return err
}

// ensureKernel makes sure a default kernel exists, installing it if not.
//
// The services start perfectly well without one; what fails is the first
// container, with "default kernel not configured for architecture arm64" and
// an instruction to go and run a CLI command. So this asks the agent directly
// rather than waiting to be told at the worst possible moment, and the splash
// grows to show the download rather than sitting on one silent line.
func (a *App) ensureKernel() {
	agent := a.Agent()
	if agent == nil {
		return
	}

	var kernel struct {
		Configured bool `json:"configured"`
	}

	// A question that cannot be asked is not an answer of "no".
	if err := agent.InvokeInto("system.kernelConfigured", nil, &kernel); err != nil {
		return
	}
	if kernel.Configured {
		return
	}

	a.splashStep("services", "active", "Installing the Linux kernel…")
	a.splashSetup("Setting up the default Linux kernel", "Starting the download…", false)

	// However long it takes: a 569 MB download on a poor connection is slow,
	// not broken, and cutting it off at some arbitrary minute means starting
	// again from nothing. Only silence is a failure.
	alive := make(chan struct{}, 64)
	done := make(chan error, 1)

	go func() {
		done <- a.runStream("system.installKernel", nil, func(line string) {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" {
				return
			}

			select {
			case alive <- struct{}{}:
			default:
			}

			a.splashSetup("Setting up the default Linux kernel", clip(trimmed, 200), false)
		})
	}()

	var err error

watch:
	for {
		select {
		case err = <-done:
			break watch
		case <-alive:
		case <-time.After(kernelStall):
			err = errors.New("kernel install stalled")
			break watch
		}
	}

	if err != nil {
		log.Println("[dermaga] kernel install failed:", err)
		a.splashStep("services", "failed", "Kernel not installed — retry from System")
	} else {
		a.splashStep("services", "done", "Kernel installed")
	}

	a.splashSetup("", "", true)
}

// runStream runs a streaming agent method to completion, reporting each line.
func (a *App) runStream(method string, params any, onLine func(string)) error {
	agent := a.Agent()
	if agent == nil {
		return ErrNotRunning
	}

	var started struct {
		StreamID string `json:"streamId"`
	}

	if err := agent.InvokeInto(method, params, &started); err != nil {
		return err
	}

	finished := make(chan error, 1)

	a.mu.Lock()
	a.streams[started.StreamID] = func(event string, payload json.RawMessage) {
		var chunk struct {
			Chunk string `json:"chunk"`
			Error string `json:"error"`
		}
		_ = json.Unmarshal(payload, &chunk)

		if event == "stream.data" {
			if onLine != nil {
				onLine(chunk.Chunk)
			}
			return
		}

		a.mu.Lock()
		delete(a.streams, started.StreamID)
		a.mu.Unlock()

		if chunk.Error != "" {
			finished <- errors.New(chunk.Error)
		} else {
			finished <- nil
		}
	}
	a.mu.Unlock()

	return <-finished
}

// --- the splash window ----------------------------------------------------

// A first-run job that takes minutes gets its own panel, and the window grows
// to hold it: a one-line label is not enough to explain why nothing is
// happening for two minutes.
const (
	splashWidth      = 620
	splashHeight     = 392
	splashSetupHeigh = 500
)

func (a *App) createSplash() {
	options := application.WebviewWindowOptions{
		Title:            "Dermaga",
		Width:            splashWidth,
		Height:           splashHeight,
		Frameless:        true,
		DisableResize:    true,
		BackgroundColour: application.NewRGB(13, 13, 17),
		// The version travels in the URL rather than over an event: a round
		// trip that fails leaves the splash showing a placeholder, and it did
		// exactly that in 1.3.1. A query string cannot fail once the page has
		// loaded at all.
		URL: "/splash.html?version=" + a.version,
	}

	// The splash opens where the user is looking, and the window that follows
	// it a second later opens on the same display.
	options.InitialPosition = application.WindowCentered
	options.Screen = a.screenUnderCursor()

	window := a.wails.Window.NewWithOptions(options)

	a.mu.Lock()
	a.splash = window
	a.mu.Unlock()

	// Launched from a terminal rather than Finder, macOS leaves the app behind
	// whatever was in front -- so the splash runs its whole sequence unseen.
	window.Show()
	window.Focus()
}

func (a *App) splashStep(id, state, label string) {
	a.emit("splash:step", map[string]string{"id": id, "state": state, "label": label})
}

func (a *App) splashSetup(title, line string, done bool) {
	a.emit("splash:setup", map[string]any{"title": title, "line": line, "done": done})

	window := a.splashWindow()
	if window == nil {
		return
	}

	height := splashSetupHeigh
	if done {
		height = splashHeight
	}

	window.SetSize(splashWidth, height)
}

// splashFatal ends startup with an explanation the user can read, then closes
// the app.
func (a *App) splashFatal(title, detail string) {
	a.emit("splash:fatal", map[string]string{"title": title, "detail": detail})

	// A backstop in case the window is left untouched; the Quit button is the
	// intended way out.
	time.AfterFunc(60*time.Second, func() { a.wails.Quit() })
}

func (a *App) splashWindow() *application.WebviewWindow {
	a.mu.Lock()
	defer a.mu.Unlock()

	return a.splash
}

func (a *App) closeSplash() {
	window := a.splashWindow()
	if window == nil {
		return
	}

	a.mu.Lock()
	a.splash = nil
	a.mu.Unlock()

	window.Close()
}

// waitForWindow holds until the window says it has painted, or until the
// patience runs out.
func (a *App) waitForWindow(window *application.WebviewWindow, patience time.Duration) {
	ready := make(chan struct{})
	var once sync.Once

	cancel := a.wails.Event.On("dermaga:ready", func(*application.CustomEvent) {
		once.Do(func() { close(ready) })
	})
	defer cancel()

	select {
	case <-ready:
	case <-time.After(patience):
	}
}

func clip(value string, limit int) string {
	if len(value) <= limit {
		return value
	}

	return value[:limit]
}
