package window

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	neturl "net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"

	"github.com/ryanbekhen/dermaga/internal/cli"
	"github.com/ryanbekhen/dermaga/internal/system"
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
		notifyOnExit   bool
		notifyOnFinish bool
	}
	pendingOpen string
	pendingTask string
}

// NewBridge wires the bridge to the running app.
func NewBridge(app *App) *Bridge {
	bridge := &Bridge{app: app}
	bridge.settings.notifyOnExit = true
	bridge.settings.notifyOnFinish = true

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
func (b *Bridge) SyncSettings(notifyOnExit, notifyOnFinish bool) {
	b.mu.Lock()
	b.settings.notifyOnExit = notifyOnExit
	b.settings.notifyOnFinish = notifyOnFinish
	b.mu.Unlock()
}

func (b *Bridge) notifyOnExit() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.settings.notifyOnExit
}

func (b *Bridge) notifyOnFinish() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	return b.settings.notifyOnFinish
}

// RegisterContainerNames tells macOS to route the container domain to the
// runtime's DNS service.
//
// This is the half that needs an administrator: it writes a resolver file under
// /etc/resolver, which is root's. The other half -- registering containers under
// the domain at all -- is a file in the user's own home directory and the agent
// does it without asking.
//
// Asked for here rather than in the agent because the prompt is a window on a
// screen: macOS shows its own authorization panel, which is also what lets it
// accept Touch ID. The password is typed into that panel and never passes
// through Dermaga, which is the point of using it rather than asking for one.
func (b *Bridge) RegisterContainerNames() error {
	command := fmt.Sprintf("%s system dns create %s", containerBinary(), system.Domain)

	// osascript rather than sudo: sudo would need a terminal and a password on
	// a pipe. This is the panel every Mac app uses to ask.
	script := fmt.Sprintf("do shell script %q with administrator privileges", command)

	if out, err := exec.Command("osascript", "-e", script).CombinedOutput(); err != nil {
		message := strings.TrimSpace(string(out))

		// Cancelling is an answer, not a failure, and should read like one.
		if strings.Contains(message, "-128") || strings.Contains(message, "User canceled") {
			return errors.New("cancelled")
		}
		if message == "" {
			message = err.Error()
		}

		return fmt.Errorf("could not set up container names: %s", message)
	}

	return nil
}

// containerBinary is where Apple's CLI is, spelled out in full.
//
// The privileged shell runs with root's PATH rather than the user's, and
// Homebrew is not on it. A bare "container" there is a command not found, after
// the password has already been typed.
func containerBinary() string {
	if path, err := exec.LookPath(cli.Binary); err == nil {
		return path
	}

	return "/opt/homebrew/bin/" + cli.Binary
}

// OpenNotificationSettings offers the door rather than pretending it can open
// it: notifications are macOS's to allow or refuse, and its settings are the
// only place that can be changed.
func (b *Bridge) OpenNotificationSettings() error {
	return exec.Command("open", "x-apple.systempreferences:com.apple.preference.notifications").Run()
}

// OpenExternal hands a web address to macOS to open in the default browser.
//
// The window needs this because it is not a browser: an anchor with
// target="_blank" has nowhere to open a tab, so every link in the app -- a CVE
// on the vulnerability list, a project's homepage, a port published to
// localhost -- did nothing at all when it was clicked.
//
// Only http and https, and that is a rule about safety rather than tidiness.
// These addresses come from outside: Trivy reports the CVE link, a licence
// file names the homepage. `open` will happily act on any scheme macOS knows,
// so an unchecked one could be asked to run a file:// path or a
// x-apple.systempreferences: URL that this app would never offer on purpose.
// Anything that is not a plain web address is refused and said so.
func (b *Bridge) OpenExternal(address string) error {
	parsed, err := neturl.Parse(address)
	if err != nil {
		return fmt.Errorf("not an address: %w", err)
	}

	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return fmt.Errorf("refusing to open %q: only http and https", parsed.Scheme)
	}

	// A URL with no host is "https:" and a path, which `open` resolves against
	// something that is not a website.
	if parsed.Host == "" {
		return fmt.Errorf("refusing to open an address with no host")
	}

	return exec.Command("open", parsed.String()).Run()
}

// OpenFinding opens one vulnerability in a window of its own.
//
// A window rather than a dialog because of what a finding is to read: a
// paragraph, eight metrics, a dozen scores and up to seventy links. Any of
// that over the top of the list is a choice between reading and looking, and
// the reason to read one is almost always to compare it with the next -- which
// a window that can sit on another screen allows and a dialog does not.
//
// It loads the same bundle at a hash the window recognises, and fetches the
// report itself over the same service. Nothing is passed through the URL but
// the two names needed to find it again: a URL is a poor place for a paragraph,
// and the report may be rescanned while the window is open.
func (b *Bridge) OpenFinding(reference, id string) error {
	if reference == "" || id == "" {
		return fmt.Errorf("a finding needs an image and an id")
	}

	b.app.OpenFindingWindow(reference, id)

	return nil
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

// TakePendingTask collects the output a notification asked for before there
// was a window to show it in.
func (b *Bridge) TakePendingTask() string {
	b.mu.Lock()
	defer b.mu.Unlock()

	id := b.pendingTask
	b.pendingTask = ""

	return id
}

func (b *Bridge) setPendingTask(id string) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.pendingTask = id
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

// StagedUpdate is a download that has landed, and what can be done with it.
type StagedUpdate struct {
	Path    string `json:"path"`
	Version string `json:"version"`
	// True when a restart is all it would take. False means the old road:
	// open the image and let somebody drag the app across.
	Restartable bool `json:"restartable"`
	// Why not, in the words the log would use. Never shown as an error --
	// there is nothing wrong, only a longer way round.
	Reason string `json:"reason,omitempty"`
}

// updatesDir is where a download waits until somebody restarts.
//
// Not Downloads: this one was never asked for. An update that arrives on its
// own has no business leaving a file in the folder somebody keeps their own
// downloads in -- and if it turns out a drag is needed after all, it is moved
// there then, where they would look for it.
func updatesDir() string {
	return filepath.Join(homeDir(), ".dermaga", "updates")
}

// StageUpdate downloads a release and says whether a restart could install it.
//
// The download is kept, so quitting without restarting does not throw it away:
// the next launch finds it already there and offers the restart immediately.
func (b *Bridge) StageUpdate(assetURL, version string) (StagedUpdate, error) {
	path, err := b.DownloadUpdate(assetURL, version)
	if err != nil {
		return StagedUpdate{}, err
	}

	staged := StagedUpdate{Path: path, Version: version, Restartable: true}
	if err := installable(path); err != nil {
		staged.Restartable = false
		staged.Reason = err.Error()
		log.Println("[dermaga] update needs the long road:", err)
	}

	b.app.stage(staged)

	return staged, nil
}

// forgetOldUpdates removes downloads for versions this app has caught up with.
//
// Run at launch, because that is when the answer changes: either the restart
// happened and this is the new version, or somebody installed it another way.
// Either way the image is 9 MB of nothing, and nobody would think to look for
// it.
func forgetOldUpdates(current string) {
	entries, err := os.ReadDir(updatesDir())
	if err != nil {
		return
	}

	for _, entry := range entries {
		version := strings.TrimSuffix(strings.TrimPrefix(entry.Name(), "Dermaga-"), "-arm64.dmg")
		if version != entry.Name() && isNewer(version, current) {
			continue
		}

		_ = os.Remove(filepath.Join(updatesDir(), entry.Name()))
	}
}

// tidyUpdates removes every download except the one still worth keeping.
func tidyUpdates(keep string) {
	entries, err := os.ReadDir(updatesDir())
	if err != nil {
		return
	}

	for _, entry := range entries {
		path := filepath.Join(updatesDir(), entry.Name())
		if path == keep {
			continue
		}

		_ = os.Remove(path)
	}
}

// DownloadUpdate fetches the DMG, reporting progress as it goes, and returns
// where it landed. A download already sitting there is taken as it is.
func (b *Bridge) DownloadUpdate(assetURL, version string) (string, error) {
	if err := os.MkdirAll(updatesDir(), 0o755); err != nil {
		return "", err
	}

	target := filepath.Join(updatesDir(), fmt.Sprintf("Dermaga-%s-arm64.dmg", version))
	tidyUpdates(target)

	// Already here, from a check before this app was even started. Nothing is
	// gained by fetching it twice, and the version is in the name.
	if info, err := os.Stat(target); err == nil && info.Size() > 0 {
		return target, nil
	}

	response, err := http.Get(assetURL)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download failed (%d)", response.StatusCode)
	}

	total := response.ContentLength

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

// InstallUpdate puts the downloaded version in place, and closes Dermaga so it
// can be.
//
// In place when the download can be proven to be Dermaga -- signature intact,
// the same team that signed this app, and notarized -- and the app can be
// written to without an administrator. The app comes back already updated and
// there is nothing to drag.
//
// Everything else falls back to opening the disk image, which is what Dermaga
// has always done and always works. An update that half happened would be far
// worse than one that asks for a drag, so anything short of certain takes the
// old road.
func (b *Bridge) InstallUpdate(dmgPath string) error {
	if err := b.app.replaceWith(dmgPath); err == nil {
		b.app.quitAfterOpeningInstaller()

		return nil
	} else {
		log.Println("[dermaga] not replacing in place:", err)
	}

	// The long road, which ends with somebody dragging the app across. The
	// image was staged out of the way because nobody asked for it; now that
	// they have to handle it themselves, it belongs where downloads live.
	if moved := filepath.Join(homeDir(), "Downloads", filepath.Base(dmgPath)); moved != dmgPath {
		if err := os.Rename(dmgPath, moved); err == nil {
			dmgPath = moved
		}
	}

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
