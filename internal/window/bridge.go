package window

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
)

// The window's only way out.
//
// Every call is a JSON-RPC method on the agent, brokered here; the window has
// no network client of its own and no server to point one at. What the agent
// pushes comes back the other way as one event.
//
// Everything the window is allowed to ask for is here, in the process that
// already speaks to the agent.
type Bridge struct {
	app *App

	mu       sync.Mutex
	settings struct {
		notifyOnExit bool
	}
	pendingOpen string
}

// NewBridge wires the bridge to the running app.
func NewBridge(app *App) *Bridge {
	bridge := &Bridge{app: app}
	bridge.settings.notifyOnExit = true

	return bridge
}

// ServiceName identifies the bridge in Wails' service list.
func (b *Bridge) ServiceName() string {
	return "dermaga.bridge"
}

// BridgeName is what the window calls a bound method by.
//
// Wails names a bound method after the package it is declared in, so the name
// changes whenever this package moves -- and it breaks at runtime, in a call
// that used to work, rather than at build time. So the name is derived here and
// handed to the window rather than written out on both sides and left to drift.
func BridgeName() string {
	return reflect.TypeOf(Bridge{}).PkgPath() + ".Bridge"
}

// Invoke passes a method straight through to the agent.
func (b *Bridge) Invoke(method string, params json.RawMessage) (json.RawMessage, error) {
	agent := b.app.Agent()
	if agent == nil {
		return nil, ErrNotRunning
	}

	// A method called with no arguments sends no params at all, rather than a
	// null the agent would have to allow for.
	if len(params) == 0 || string(params) == "null" {
		return agent.Invoke(method, nil)
	}

	return agent.Invoke(method, params)
}

// IsFullScreen answers what the traffic lights are doing, since they disappear
// in fullscreen and the UI has to lay itself out around that.
func (b *Bridge) IsFullScreen() bool {
	window := b.app.MainWindow()
	if window == nil {
		return false
	}

	return window.IsFullscreen()
}

// SyncSettings keeps this side in step with preferences it has to act on
// without asking -- such as whether to raise a notification, which arrives at
// the moment it is needed.
func (b *Bridge) SyncSettings(notifyOnExit bool) {
	b.mu.Lock()
	b.settings.notifyOnExit = notifyOnExit
	b.mu.Unlock()
}

func (b *Bridge) notifyOnExit() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.settings.notifyOnExit
}

// OpenNotificationSettings offers the door rather than pretending it can open
// it: notifications are macOS's to allow or refuse, and its settings are the
// only place that can be changed.
func (b *Bridge) OpenNotificationSettings() error {
	return exec.Command("open", "x-apple.systempreferences:com.apple.preference.notifications").Run()
}

// TakePendingOpen collects a container the user asked for before there was a
// window to show it in -- from a notification, or from the menu bar. The
// window claims it as it starts.
func (b *Bridge) TakePendingOpen() string {
	b.mu.Lock()
	defer b.mu.Unlock()

	id := b.pendingOpen
	b.pendingOpen = ""

	return id
}

func (b *Bridge) setPendingOpen(id string) {
	b.mu.Lock()
	b.pendingOpen = id
	b.mu.Unlock()
}

// --- the background service ----------------------------------------------
//
// The agent as a launchd job, so containers are still watched -- and, with a
// restart policy, still restarted -- when no window is open. Installing it
// hands over the socket the app's own agent is holding.

// ServiceStatus reports what the background service is, if it is anything.
func (b *Bridge) ServiceStatus() ServiceStatus {
	return serviceStatus(agentBinary(), socketPath())
}

// InstallService puts the agent under launchd and reconnects to it.
func (b *Bridge) InstallService() (ServiceStatus, error) {
	binary := agentBinary()
	if binary == "" {
		return ServiceStatus{}, errors.New("the Dermaga agent binary is missing")
	}

	installed, err := installService(binary, socketPath(), func() {
		if agent := b.app.Agent(); agent != nil {
			agent.Stop()
		}
	})
	if err != nil {
		return ServiceStatus{}, err
	}

	// The service is holding the socket now; reconnect to it.
	if err := b.app.StartAgent(); err != nil {
		return installed, err
	}

	return installed, nil
}

// UninstallService takes the service away; the app goes back to running its
// own agent.
func (b *Bridge) UninstallService() (ServiceStatus, error) {
	removed := uninstallService(socketPath())

	// Nothing is serving any more, so the app goes back to running its own.
	if err := b.app.StartAgent(); err != nil {
		return removed, err
	}

	return removed, nil
}

// GetOpenAtLogin reads the setting back from macOS rather than mirroring it,
// because macOS owns it: it can also be changed in System Settings, and under
// the hood it is a registration with SMAppService rather than a value of ours.
func (b *Bridge) GetOpenAtLogin() bool {
	enabled, err := b.app.wails.Autostart.IsEnabled()
	if err != nil {
		return false
	}

	return enabled
}

// SetOpenAtLogin registers or unregisters the app as a login item.
func (b *Bridge) SetOpenAtLogin(openAtLogin bool) (bool, error) {
	var err error
	if openAtLogin {
		err = b.app.wails.Autostart.Enable()
	} else {
		err = b.app.wails.Autostart.Disable()
	}

	if err != nil {
		return b.GetOpenAtLogin(), err
	}

	return b.GetOpenAtLogin(), nil
}

// --- pickers --------------------------------------------------------------
//
// The window has no filesystem of its own; the choice made in one of these
// dialogs is what grants access to that one path, so no permission prompt of
// ours is involved.

// PickDirectory asks for a folder -- where a build should run, for instance.
func (b *Bridge) PickDirectory(title string) (string, error) {
	if title == "" {
		title = "Choose a folder"
	}

	dialog := b.app.wails.Dialog.OpenFile().
		SetTitle(title).
		CanChooseDirectories(true).
		CanChooseFiles(false).
		CanCreateDirectories(true).
		SetButtonText("Choose")

	if window := b.app.MainWindow(); window != nil {
		dialog.AttachToWindow(window)
	}

	return dialog.PromptForSingleSelection()
}

// PickSaveFile asks where to write something -- an image archive, say.
func (b *Bridge) PickSaveFile(title, defaultName, extension string) (string, error) {
	if title == "" {
		title = "Save as"
	}

	dialog := b.app.wails.Dialog.SaveFile().SetMessage(title)

	if defaultName != "" {
		dialog.SetFilename(defaultName)
	}
	if extension != "" {
		dialog.AddFilter(strings.ToUpper(extension), "*."+extension)
	}
	if window := b.app.MainWindow(); window != nil {
		dialog.AttachToWindow(window)
	}

	return dialog.PromptForSingleSelection()
}

// PickFile asks which file to read back in.
func (b *Bridge) PickFile(title, extension string) (string, error) {
	if title == "" {
		title = "Choose a file"
	}

	dialog := b.app.wails.Dialog.OpenFile().
		SetTitle(title).
		CanChooseFiles(true).
		CanChooseDirectories(false).
		SetButtonText("Choose")

	if extension != "" {
		dialog.AddFilter(strings.ToUpper(extension), "*."+extension)
	}
	if window := b.app.MainWindow(); window != nil {
		dialog.AttachToWindow(window)
	}

	return dialog.PromptForSingleSelection()
}

// --- updates --------------------------------------------------------------
//
// Releases are ad-hoc signed, and no updater will swap an app whose signature
// it cannot match against the running one, so there is no silent self-update
// to be had. This is the honest version of it: fetch the release, download the
// DMG with progress, open it, and get out of the way so the user can drop the
// new build over the old one.

const updateRepo = "ryanbekhen/dermaga"

// UpdateCheck is what was found on GitHub, if anything newer is there.
type UpdateCheck struct {
	Available bool   `json:"available"`
	Current   string `json:"current"`
	Version   string `json:"version,omitempty"`
	URL       string `json:"url,omitempty"`
	AssetURL  string `json:"assetUrl,omitempty"`
	Size      int64  `json:"size,omitempty"`
}

type githubRelease struct {
	TagName string         `json:"tag_name"`
	HTMLURL string         `json:"html_url"`
	Assets  []releaseAsset `json:"assets"`
}

type releaseAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
	Size int64  `json:"size"`
}

// isNewer reports whether candidate is a later version than current.
func isNewer(candidate, current string) bool {
	parts := func(value string) [3]int {
		var out [3]int
		for i, piece := range strings.SplitN(strings.TrimPrefix(value, "v"), ".", 3) {
			if i > 2 {
				break
			}
			out[i], _ = strconv.Atoi(piece)
		}

		return out
	}

	a, b := parts(candidate), parts(current)

	for i := range 3 {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}

	return false
}

// CheckUpdate asks GitHub what the latest release is.
func (b *Bridge) CheckUpdate() (UpdateCheck, error) {
	current := b.app.version

	request, err := http.NewRequest(http.MethodGet,
		fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", updateRepo), nil)
	if err != nil {
		return UpdateCheck{}, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "Dermaga")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return UpdateCheck{}, err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return UpdateCheck{}, fmt.Errorf("GitHub answered %d", response.StatusCode)
	}

	var release githubRelease
	if err := json.NewDecoder(response.Body).Decode(&release); err != nil {
		return UpdateCheck{}, err
	}

	return updateFromRelease(release, current), nil
}

// updateFromRelease decides what to do about what GitHub answered.
//
// Apart from the fetch itself, which is the one thing here that cannot be
// tested without a network: whether there is an update at all, and which file
// it is, is the decision that governs whether anybody is ever offered one.
func updateFromRelease(release githubRelease, current string) UpdateCheck {
	version := strings.TrimPrefix(release.TagName, "v")

	// A release carries more than one file -- the source archives GitHub adds
	// on its own, at least -- and only one of them is an installer.
	var asset *releaseAsset
	for i := range release.Assets {
		if strings.HasSuffix(release.Assets[i].Name, ".dmg") {
			asset = &release.Assets[i]
			break
		}
	}

	// A release with no DMG in it is a release nobody can install, so it is not
	// worth telling anybody about.
	if version == "" || asset == nil || !isNewer(version, current) {
		return UpdateCheck{Available: false, Current: current}
	}

	return UpdateCheck{
		Available: true,
		Current:   current,
		Version:   version,
		URL:       release.HTMLURL,
		AssetURL:  asset.URL,
		Size:      asset.Size,
	}
}

// DownloadUpdate fetches the DMG, reporting progress as it goes, and returns
// where it landed.
func (b *Bridge) DownloadUpdate(assetURL, version string) (string, error) {
	response, err := http.Get(assetURL)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download failed (%d)", response.StatusCode)
	}

	total := response.ContentLength

	// Downloads, not a temp directory: if anything goes wrong the user still
	// has the installer where they would expect to find it.
	target := filepath.Join(homeDir(), "Downloads", fmt.Sprintf("Dermaga-%s-arm64.dmg", version))

	file, err := os.Create(target)
	if err != nil {
		return "", err
	}

	var received int64
	buffer := make([]byte, 256*1024)

	for {
		n, readErr := response.Body.Read(buffer)

		if n > 0 {
			if _, writeErr := file.Write(buffer[:n]); writeErr != nil {
				file.Close()
				os.Remove(target)
				return "", writeErr
			}

			received += int64(n)
			b.app.emit("dermaga:update-progress", map[string]int64{
				"received": received,
				"total":    total,
			})
		}

		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			file.Close()
			os.Remove(target)
			return "", readErr
		}
	}

	if err := file.Close(); err != nil {
		os.Remove(target)
		return "", err
	}

	return target, nil
}

// InstallUpdate opens the installer and closes Dermaga, so the app can be
// replaced.
func (b *Bridge) InstallUpdate(dmgPath string) error {
	if err := exec.Command("open", dmgPath).Run(); err != nil {
		return err
	}

	// Quitting immediately would race Finder mounting the image, and the user
	// would be left staring at a closed app and no window.
	b.app.quitAfterOpeningInstaller()

	return nil
}

// Quit closes the app. The splash offers it when a prerequisite is missing and
// there is nothing to open a window onto.
func (b *Bridge) Quit() {
	b.app.wails.Quit()
}
