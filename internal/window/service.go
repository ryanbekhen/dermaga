package window

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// The Dermaga agent as a launchd service.
//
// Without it the agent is the app's child and containers are watched only
// while a window is open; with it the agent starts at login and keeps watching
// -- which is what makes a restart policy mean anything. It stays opt-in: a
// background process nobody asked for is not a feature.
//
// Everything here is per-user. It lives in ~/Library/LaunchAgents, runs as the
// user, and needs no administrator anywhere.

const serviceLabel = "dev.ryanbekhen.dermaga.agent"

// launchd starts services with almost no PATH, and the agent is useless
// without Apple's CLI on it.
var servicePATH = []string{
	"/opt/homebrew/bin",
	"/usr/local/bin",
	"/usr/bin",
	"/bin",
	"/usr/sbin",
	"/sbin",
}

// ServiceStatus is what the window is told about the background service.
type ServiceStatus struct {
	Installed bool   `json:"installed"`
	Binary    string `json:"binary"`
	Socket    string `json:"socket"`
	Running   bool   `json:"running"`
	Stale     bool   `json:"stale"`
	Missing   bool   `json:"missing"`
}

func plistPath() string {
	return filepath.Join(homeDir(), "Library", "LaunchAgents", serviceLabel+".plist")
}

func launchTarget() string {
	return fmt.Sprintf("gui/%d", os.Getuid())
}

func servicePlist(binary, socket string) string {
	logFile := filepath.Join(homeDir(), ".dermaga", "agent.log")

	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>%s</string>
	<key>ProgramArguments</key>
	<array>
		<string>%s</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<!-- Restart it when it fails, but not when it exits cleanly: standing down
	     because another agent already holds the socket is a clean exit, and
	     relaunching it in a loop would be a fight nobody wins. -->
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>ProcessType</key>
	<string>Background</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>%s</string>
		<!-- The service belongs to the build that installed it, and listens
		     where that build looks. A development build has its own socket. -->
		<key>DERMAGA_SOCKET</key>
		<string>%s</string>
	</dict>
	<key>StandardErrorPath</key>
	<string>%s</string>
</dict>
</plist>
`, serviceLabel, binary, strings.Join(servicePATH, ":"), socket, logFile)
}

var (
	plistBinary = regexp.MustCompile(`<string>([^<]*dermaga-agent)</string>`)
	plistSocket = regexp.MustCompile(`<key>DERMAGA_SOCKET</key>\s*<string>([^<]*)</string>`)
)

// serviceStatus reports what the service is, if it is anything: where it
// points, whether launchd is actually running it, and whether it belongs to
// the build asking.
//
// The last one matters because the plist records a path. Move the app, delete
// it, or switch between a development build and an installed one, and the
// service carries on pointing at wherever it was when it was installed --
// silently, which is the worst way for it to be wrong.
func serviceStatus(currentBinary, currentSocket string) ServiceStatus {
	contents, err := os.ReadFile(plistPath())
	if err != nil {
		return ServiceStatus{}
	}

	status := ServiceStatus{Installed: true, Running: serviceIsRunning()}

	if match := plistBinary.FindStringSubmatch(string(contents)); match != nil {
		status.Binary = match[1]
	}
	if match := plistSocket.FindStringSubmatch(string(contents)); match != nil {
		status.Socket = match[1]
	}

	if status.Binary != "" {
		if _, err := os.Stat(status.Binary); err != nil {
			status.Missing = true
		}
	}

	status.Stale = (currentBinary != "" && status.Binary != "" && status.Binary != currentBinary) ||
		(currentSocket != "" && status.Socket != "" && status.Socket != currentSocket)

	return status
}

// Whether launchd has the job loaded and up.
func serviceIsRunning() bool {
	out, err := exec.Command("launchctl", "print", launchTarget()+"/"+serviceLabel).Output()
	if err != nil {
		return false
	}

	return strings.Contains(string(out), "state = running")
}

// Polls, because launchd and a process on its way out answer to no promise.
func waitFor(condition func() bool, attempts int) bool {
	for i := 0; i < attempts; i++ {
		if condition() {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}

	return false
}

func socketGone(socket string) func() bool {
	return func() bool {
		_, err := os.Stat(socket)
		return err != nil
	}
}

func socketThere(socket string) func() bool {
	return func() bool {
		_, err := os.Stat(socket)
		return err == nil
	}
}

// installService writes the plist and hands the socket over.
//
// The order is the whole of this function. An agent is holding the socket, and
// a service booted while it is still there dials it, finds it answered and
// stands down -- cleanly, so launchd leaves it down, and the user is left with
// a service that is installed and doing nothing. So: ask the holder to let go,
// wait until it genuinely has, and only then boot the service.
func installService(binary, socket string, releaseSocket func()) (ServiceStatus, error) {
	if err := os.MkdirAll(filepath.Dir(plistPath()), 0o755); err != nil {
		return ServiceStatus{}, err
	}
	if err := os.MkdirAll(filepath.Join(homeDir(), ".dermaga"), 0o755); err != nil {
		return ServiceStatus{}, err
	}
	if err := os.MkdirAll(filepath.Dir(socket), 0o755); err != nil {
		return ServiceStatus{}, err
	}
	if err := os.WriteFile(plistPath(), []byte(servicePlist(binary, socket)), 0o644); err != nil {
		return ServiceStatus{}, err
	}

	if releaseSocket != nil {
		releaseSocket()
	}
	waitFor(socketGone(socket), 60)

	// Already loaded from an earlier install: replace it rather than fail.
	_ = exec.Command("launchctl", "bootout", launchTarget()+"/"+serviceLabel).Run()

	if err := exec.Command("launchctl", "bootstrap", launchTarget(), plistPath()).Run(); err != nil {
		return ServiceStatus{}, fmt.Errorf("launchd refused the service: %w", err)
	}

	// The socket coming back is the proof that the service is really up. A job
	// that stood down once stays down until asked plainly.
	if !waitFor(socketThere(socket), 30) {
		_ = exec.Command("launchctl", "kickstart", "-k", launchTarget()+"/"+serviceLabel).Run()
		waitFor(socketThere(socket), 30)
	}

	return serviceStatus(binary, socket), nil
}

// uninstallService removes the service. Whatever it started goes with it.
func uninstallService(socket string) ServiceStatus {
	_ = exec.Command("launchctl", "bootout", launchTarget()+"/"+serviceLabel).Run()
	_ = os.Remove(plistPath())

	if socket != "" {
		waitFor(socketGone(socket), 60)
	}

	return serviceStatus("", "")
}

func homeDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return os.Getenv("HOME")
	}

	return home
}
