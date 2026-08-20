<p align="center">
  <img src="assets/logo.png" alt="Dermaga" width="140">
</p>

<h1 align="center">Dermaga</h1>

<p align="center">
  A native macOS app for Apple's <a href="https://github.com/apple/container"><code>container</code></a> runtime.<br>
  Manage containers, images, volumes, networks and machines without leaving the keyboard.
</p>

<p align="center">
  <a href="https://github.com/ryanbekhen/dermaga/releases/latest"><img alt="download" src="https://img.shields.io/github/v/release/ryanbekhen/dermaga?label=download&color=CE1126"></a>
  <img alt="platform" src="https://img.shields.io/badge/macOS%2026-Apple%20Silicon-CE1126">
  <img alt="signed" src="https://img.shields.io/badge/signed-%26%20notarized-CE1126">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-CE1126">
</p>

---

**[Install](#install)** · **[First launch](#first-launch)** · **[Features](#features)** ·
**[Everyday use](#everyday-use)** · **[Worth knowing](#worth-knowing)** ·
**[Privacy](#privacy)**

---

Dermaga is a lightweight alternative to Docker Desktop for Apple Silicon. It is a real Mac app — a
ten-megabyte download, with no browser engine inside it — and it drives Apple's own `container` CLI
rather than replacing it. Everything you do here is immediately visible to `container ls`, and everything
you do in a terminal shows up here within seconds.

It opens no ports. The app and its agent talk over a socket in your own home directory, and nothing
about your containers or images is sent anywhere.

No daemon by default: the agent belongs to the app and goes when it does. There is one if you want
it — a per-user background service you switch on in Settings, which keeps watching your containers,
and restarting the ones you asked it to, while Dermaga is closed.

## Install

Download the DMG from **[Releases](https://github.com/ryanbekhen/dermaga/releases/latest)**, open it
and drag Dermaga to Applications. That is the whole of it: the agent travels inside the app, and
there is no separate service to install.

Dermaga is signed with an Apple Developer ID and notarized by Apple, so it opens the first time
without warnings or trips to System Settings.

**Requirements**

| | |
| --- | --- |
| macOS | 26 or later |
| Mac | Apple Silicon |
| [Homebrew](https://brew.sh) | how Dermaga installs the `container` CLI and the scanner for you |

Apple's `container` runtime is [supported on macOS 26 and no
earlier](https://github.com/apple/container#requirements) — it depends on virtualisation and
networking introduced in that release — so Dermaga inherits that floor.

You do not need to install the `container` CLI yourself. Dermaga checks for it on first launch and
installs it through Homebrew, then starts the background services.

## First launch

The splash screen is a bootstrap, not a progress bar. It runs five checks and fixes what it can:

1. **Starting the agent** — the process behind the app
2. **Checking Homebrew** — if it is missing, Dermaga explains why it is needed and closes, because
   nothing further can succeed
3. **Checking the container CLI** — installs it with `brew install container` if absent, showing the
   live progress
4. **Checking container services** — starts them, and installs the default Linux kernel if this Mac
   has none
5. **Loading your containers**

Anything it cannot fix is reported there rather than dropped into an empty window.

The kernel deserves a note: the services start perfectly well without one, and the failure only
surfaces later as *"default kernel not configured for architecture arm64"* when something tries to
run. Dermaga asks directly instead of waiting to be told, and installs it — 569 MB from GitHub, so
on a slow line it takes a while. The splash waits as long as the download keeps moving; if it stops
entirely the window opens anyway and the status bar keeps the reminder, with the command to run by
hand.

The vulnerability scanner sets itself up separately, in the background: Trivy through Homebrew, then
its database. That never holds up the window — you can work while it happens, and the status bar
reports where it has got to.

## Features

- **Containers** — create, start, stop, restart, edit and remove; multi-select for bulk actions. Per
  container: live CPU and memory, IPv4/IPv6, gateway, MAC, MTU, DNS, mounts, environment,
  capabilities and runtime flags, plus the last half hour of CPU and memory as a chart. Published
  ports open in your browser.
- **Terminal** — a real shell in any running container or machine, backed by a pty, with a prompt,
  line editing, colours and resize. Open it as the image's own user, as root, or as anyone else.
- **Logs** — follow container, machine and service logs, with filtering and follow-on-scroll.
- **Images** — build from a Dockerfile with live progress, pull, inspect layers, build history and
  the config a container inherits. Tags sharing a digest are shown as one image. Save one out as an
  OCI archive, or load an archive back in.
- **Files** — browse a container's filesystem, drag files and folders in from Finder, and save them
  back out again.
- **Registries** — sign in to a registry, tag an image and push it. Credentials go to Apple's CLI on
  stdin and are never held here.
- **Vulnerabilities** — every image is scanned in the background and the counts appear beside it in
  the list. Per image: the CVEs, the package each one is in, and the version that fixes it. Runs
  entirely on your Mac; nothing about your images is sent anywhere.
- **Networks** — create and delete, and open one to see it drawn: the network in the middle, every
  container attached to it around the edge with the address it holds there, and the gateway as a
  node of its own. Attach an existing container to a network, or detach it, from the network's page
  or the palette.
- **Volumes** — create and delete, see which containers mount one and where it lands inside each,
  and read what it actually costs on disk rather than the half-terabyte cap it was created with.
  Open one and look inside it, even when no container has it mounted.
- **Containers that start with Dermaga** — mark one and it comes up when the agent does: when you
  open the app, or at login with the background service on. Apple's CLI has nothing like it.
- **Machines** — create, boot, stop, resize (CPU, memory, home mount) and delete the Linux VMs.
- **System** — start and stop the background services, read their logs, and reclaim disk space.
- **Speaks up** — a container that stops without being asked to is reported: in the window, as a
  sound when the window is not what you are looking at, and as a notification.
- **Menu bar** — Dermaga keeps an item by the clock that says whether the services are up and what
  is running, and opens any of it in one click, with no window in sight.
- **Command palette** — `⌘K` finds any container, image, volume, network, machine or page by name,
  starts or stops a container without hunting for its row, runs a container from an image, attaches
  or detaches one from a network, and opens the create, pull, build and load forms directly.
- **Live by default** — no refresh button anywhere. Changes made in a terminal appear within two
  seconds; changes made in Dermaga appear immediately.
- **Updates itself** — when a newer release exists the status bar says so; one click downloads it,
  opens the installer and stands aside.

## Everyday use

| Shortcut | Action |
| -------- | ------ |
| `⌘K`     | Command palette — jump to any container, image, volume, network, machine or page |
| `⌘F`     | Focus the search box on this page |
| `Esc`    | Clear search, or close the palette |
| `⌘,`     | Settings |

Preferences live in `~/.dermaga/config.json` as plain JSON, safe to edit by hand or keep in
dotfiles. Dermaga merges partial updates and repairs out-of-range values rather than failing.

## Worth knowing

Things worth knowing before they surprise you.

**Starting with Dermaga means with Dermaga.** A marked container comes up when the agent starts —
when you open the app, or at login if the background service is on. It is not a restart policy:
nothing watches a container that dies later, because without the service there is nothing running to
watch it, and a promise that only half holds is worse than none.

**Browsing a container needs a shell in it.** Apple's CLI cannot read a container's filesystem, so
Dermaga runs `ls` inside the container and reads what it prints. An image built `FROM scratch` has
no `ls`, and says so rather than pretending to be empty.

**A volume opens without a network.** Reading a volume that no container has mounted means starting a
small helper container, and `container run` fetches its image when it is missing — which would put a
registry between you and your own data. Dermaga keeps its own copy as an OCI archive in
`~/.dermaga/helper-image.tar` and loads that back when the image is gone. The copy is refreshed once
a week, and left exactly as it is whenever the registry cannot be reached.

**Local registries speak plain HTTP.** A registry on this machine has no TLS, and the CLI told to
use HTTPS anyway fails with `-9836: bad protocol version` — sometimes after a push has reached 100%.
Pull, push and login default to plain HTTP for `localhost` and friends; the checkbox is there to
disagree with.

**Scanning is ambient, and cached.** Images are scanned when they appear, not when you ask, so the
answer is usually waiting by the time you open one. Results live in `~/.dermaga/scans.json` and are
rescanned when the vulnerability database turns over, when Trivy is upgraded, when a tag moves to a
different digest, or after a week — whichever comes first. Tags sharing a digest share one scan.
Results for images you have deleted are cleared automatically; nothing else is.

**A pull is not finished when the image appears.** The runtime registers an image while its layers
are still unpacking, and scanning it then finds an image that is not all there — which reads as "no
vulnerabilities". Sweeps wait for changes to settle, and any result that found nothing is checked
again before it is believed.

**Editing a container recreates it.** Apple's CLI has no `update` verb, so saving the edit form
stops, deletes and re-runs the container with the new spec. Named volumes survive; the container
filesystem does not, and the form says so before you commit. If the new spec fails to start, the
previous container is restored — and what you typed is kept, so a failed edit can be picked up where
it left off rather than typed again.

**Deleting an image removes every tag pointing at it.** References that share a digest are one
image, and removing a single tag would leave the bytes on disk under another name.

**Machines and containers are separate.** Containers run inside a Linux VM ("machine"). If nothing
starts, check **System** — without the background services running, nothing else can work, and
Dermaga replaces its whole window with a button to start them.

**The CLI updates from inside the app.** System shows the installed `container` version and offers an
update when Homebrew has a newer one. The check reads Homebrew's local index rather than running
`brew update`, so it costs nothing and never mutates your Homebrew state on its own. A CLI installed
from Apple's `.pkg` is left alone — upgrading that means an installer asking for a password.

## Privacy

Dermaga needs no macOS permissions of its own: no network access, no disk access prompts, no
accessibility, no administrator password. It runs Apple's CLI as your user and talks to its agent
over a socket in your own home directory.

Three things it does ask about, and asks in the app: installing the `container` CLI through
Homebrew, installing a Linux kernel if the services need one, and installing the background service
— a per-user launchd job in `~/Library/LaunchAgents`, which needs no administrator either and is
removed from the same switch.

Notifications are the one system permission it will ask for, the first time a container stops
without being asked to. Turn them off in Settings and it never asks again.

## Support

Something broken, or missing? [Open an issue](https://github.com/ryanbekhen/dermaga/issues) — the
version from **Settings → About** and what you were doing is usually enough to go on.

## For developers

Dermaga is a Go app: a small agent wraps Apple's CLI, and the window is drawn by
[Wails](https://wails.io) around a React frontend.

| | |
| --- | --- |
| [Contributing](CONTRIBUTING.md) | setting up, running it locally, and the conventions |
| [Architecture](docs/architecture.md) | the three layers, the packages, streaming, and the full RPC surface |
| [Vulnerability scanning](docs/scanning.md) | when images are scanned, what is cached, and why |

## License

[MIT](LICENSE) © Achmad Irianto Eka Putra
