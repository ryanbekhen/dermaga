# Changelog

Every released version, and what landed in it. The entries here are written for someone deciding
whether to update; `scripts/release-notes.sh` generates the same ground from the commits, and the
GitHub release for each tag carries that generated list with its commit hashes.

This project follows [semantic versioning](https://semver.org): the version is bumped for what the
change means to someone using Dermaga, not for how much code moved.

## [v1.11.0] — 2026-08-23

### Added

- **A container knows when its image moved on.** Edit the code, press `Build`, and the container
  carries on running the build before it. Nothing said so: the row still reads `api:dev`, because the
  reference has not changed — only what it points at has. Putting the new build in meant opening
  Containers, remembering the spec, deleting by hand and typing it back. The row now marks itself
  **image moved on** and offers Recreate, which runs the container's own configuration again on what
  the tag means today: same name, ports, volumes, environment. Nothing pops up and nothing recreates
  itself — a build takes minutes, and the marker waits on the row until you come to it. An image that
  is no longer on this Mac is never marked, because there would be nothing to recreate it from.
- **Drop a Dockerfile on the window to build it.** Building one meant telling the dialog three
  things: the folder to build against, the file within it, and a tag. The first two are things the
  file already knows — they are where it is. Drag it in from Finder and the whole window says what
  dropping it would do; let go, and the build dialog opens with the folder and the filename filled
  in and the caret in the Tag field, on a name taken from the folder and selected so typing replaces
  it. A folder with a Dockerfile in it is the same drag. `Dockerfile.dev` and `dev.Dockerfile` are
  recognised as well, and anything that is not a build says so rather than opening a form about it.

## [v1.10.1] — 2026-08-23

### Fixed

- **Updating from inside the app left you with no app.** It offered "Restart to update", quit, and
  did not come back. Replacing the bundle in place was checked against the wrong directory — the
  parent, `/Applications`, which is writable, and never the bundle itself, which macOS has refused to
  let one app modify without App Management permission since Ventura. So the update looked
  installable, promised a restart, and failed after the window had already closed, with nothing left
  to fall back to.

  The question is now asked about the bundle, while the answer is still worth having: the update
  offers itself as a download to drag across, which is the path that works. Nothing here was new in
  1.10.0 — the updater is byte for byte what 1.9.0 shipped, so in-place replacement has most likely
  never worked on Ventura or later.

### Changed

- Built with Go 1.27.

## [v1.10.0] — 2026-08-23

### Changed

- **The interface, rebuilt.** Every page has been redrawn: a warm palette whose dark end stops short
  of the chrome's black, so in dark mode the sidebar and the page beside it no longer run into each
  other, and a type scale where each step is named for what it is for rather than how big it is.
  Actions are icons with their words as the tooltip — a row of four labelled buttons made all four
  look equally likely, and bare, the one thing a page exists for keeps the colour while the rest step
  back. Colour carries what the word carried: green starts, amber stops, red forces, orange destroys.
- **Packages and Vulnerabilities are one tab.** They were two, and they are not two things — every
  finding is a fact about a package that is already listed. So it is one list of packages, each with
  a bar showing how many findings of each severity it carries, worst first, with the rest of the
  inventory alphabetically underneath. Open a package to see the CVEs in it, and open a CVE for a
  window of its own.
- **`⌘K` searches from the title bar.** The command palette is gone, and the field at the top of the
  window replaced it: the results are a page rather than a panel over the one you were reading. It
  still does things as well as find them — start, stop or restart a container **or a machine**, run a
  container from an image, attach and detach a network, build from a folder or from a paste.
- **Work in progress moved to the title bar.** It was a stack of rows above each list, visible only
  from the page it belonged to — and a build takes minutes, long enough to have gone somewhere else.
  An icon appears while anything is running; press it for what each one is, which step, how far
  through, a Cancel, and for a failure its output.
- **Disk is cleaned one kind at a time.** One button used to free images, volumes and containers
  together and call it Reclaim. Two of those come back and two do not — an image can be pulled again,
  and a volume holds the only copy of whatever was written to it. Worse, they compounded: pruning
  stopped containers freed their volumes, which the volume prune in the next line then deleted. Each
  figure now carries its own cleanup, and each says what it is about to do in its own words.
- **Results are kept in a database rather than a folder of JSON.** Scans, templates and unfinished
  container edits were three files rewritten whole on every change. They now live in
  `~/.dermaga/dermaga.db`, written one record at a time.

  **Your existing files are moved into it on first launch and then removed**, so nobody is left with
  both. The move never overwrites a record already there, keeps any file it could not read, and
  leaves `config.json` alone — preferences are still plain JSON you can edit by hand.

### Added

- **A keyboard that reaches the whole app.** Any list is walked with the arrows, opened with Return
  and ticked with Space — all of it while the caret is still in the filter field, so a few letters,
  an arrow and Return is the whole gesture. `⌘1`–`⌘9` switch tabs on a detail page. Inside a dialog,
  Return in a list of ports or volumes adds another row and puts the caret in it, and `⌘↩` does what
  the main button does.
- **Build an image from a Dockerfile you paste.** Build wanted a project on disk; plenty of what
  people build has no project. Paste one in, give it a tag, and it is written to a directory of its
  own and built from there — removed when the build ends. A paste containing COPY or ADD asks for a
  folder, since there is nothing beside it to resolve them against.
- **Everything Trivy knows about a finding, not five fields of it.** Opening a CVE gives it a window
  of its own: the description, what upstream intends to do about it, when it was published and last
  revised, the weaknesses, every vendor's score where they disagree, and all of its references. The
  CVSS vector is read out in words as well as printed — a flaw reachable over the network with no
  privileges is a different morning's work from one needing a local account.
- **What is actually inside an image, and what it costs.** The package list carries sizes, read out
  of apk's and dpkg's own databases where the scanner does not report them, and each layer says how
  large it is.
- **Help you can search.** A field that filters, topics grouped under headings that say what kind of
  question they answer, troubleshooting first rather than fifth, and the way out at the bottom.

### Fixed

- **Stopping the container services appeared to do nothing.** Dermaga has a page for exactly that,
  and it never appeared: listing containers is what fails first when the services go down, and the
  watcher returned there — so the one pass able to report it was the one pass that never got as far
  as asking.
- **Creating a volume took minutes.** Making it takes six tenths of a second; what followed was a
  helper container, measured at over two minutes on a busy Mac, and the request waited for all of it.
  It now runs behind the caller.
- **The window opened four pixels too narrow.** It was sized for the images table, back when that was
  the widest thing in the app — so on a fresh install the licence column fell off the end of an
  image's package table, and the findings opened underneath went with it.
- **Clearing up after deleted images no longer waits on the scanner.** Forgetting an image that is
  gone needs the image list and nothing else, but it sat below the check for whether the scanner was
  installed.
- **Removing something that is already gone is no longer an error.** Browsing a volume starts a
  helper container and tidies it away afterwards, whether or not one ever ran; being told it was not
  there was written into the log as a failure.
- **The severity bar is five segments on every row.** Empty segments were painted white, which on a
  tinted row is a hole rather than a zero.
- The finding window follows the theme. It renders instead of the app rather than inside it, so the
  hook that turns dark mode on never ran for it.
- A dialog opened from the title bar inherited the chrome's near-white type onto a light panel.
- Dialogs no longer carry a close box: each has a Cancel or Close in its foot, and closes on Escape
  and on a click outside.
- Two lines in the file browser padded nothing, leaving the drop hint against the left edge and the
  bottom of the window at once.
- The manual button for clearing stale scan results is gone. The sweep that already runs on every
  change had been doing the work for some time.

## [v1.9.0] — 2026-08-21

### Added

- **Containers can find each other by name.** One container reaching another meant knowing its
  address, and the address changes every time it is recreated. Apple's runtime can register every
  container under a local domain instead, and Dermaga now sets that up: the part nobody should be
  asked about — writing the domain into the runtime's own configuration — happens on its own, and
  the part that belongs to root asks. macOS shows its own authorization panel for that, which is
  also what lets it take a fingerprint, and **the password goes to macOS, never through Dermaga**.
  The domain is `internal`, which ICANN reserves for private networks; `local` is the obvious guess
  and the one to avoid, because it belongs to Bonjour. Containers created before this keep the DNS
  they were made with — restarting one does not change it — so they are named in the warning rather
  than quietly recreated, which would lose their filesystem.
- **Start from a template.** A gallery of ready specifications — Postgres, MySQL, MariaDB, Redis,
  RabbitMQ — each filling the create form in and then getting out of the way: every field stays
  editable and nothing is created until you press the button. They come from a
  [public catalogue](https://github.com/ryanbekhen/dermaga-templates) anybody can contribute to, are
  kept for when you are offline, and the catalogue can be pointed elsewhere in Settings. Arrows move,
  Enter takes — the whole thing works without the mouse.
- **Live usage that shows what a container is actually doing.** `container stats` was already
  reporting network, disk and process count on every call, and Dermaga was reading two of the nine
  fields. All of it is carried now, as rates rather than counters, on charts you can read a number
  off: numbers up the side, time along the bottom, the reading spelled out beside the name, and the
  totals since the container started. The window is kept from the moment the agent starts, so
  opening the tab shows a chart that is already drawn and carries on rather than filling itself
  while you wait.
- **Log output keeps its colour.** Programs write colour by printing escape sequences, and a page
  draws none of it — so a systemd boot log arrived as a stray `[0;32m` in front of every line it was
  meant to colour. The sequences are read now: colour, bright colour, 256 and 24-bit, bold,
  underline. Everything that is not about colour is dropped rather than printed, a carriage return
  is treated the way a terminal treats it, and searching matches the line as it reads.
- **An update is downloaded before you want it.** The wait used to sit between pressing the button
  and being updated, which is the worst place for it. Now a release is fetched as soon as it is
  found — quietly, because nobody asked for it — verified, and only then does the corner offer
  **Restart to update**, which is also in the menu bar for when the window is closed. Dermaga checks
  again every six hours rather than only at launch: it lives in the menu bar for days, and a check
  that happens once means whoever never quits it hears about anything last.

### Changed

- **Filters live with the list they filter.** *Show stopped containers* and *Show Apple's builder*
  were in Settings, a page away from the thing they change, which made them read as preferences —
  something decided once and forgotten. They are two switches beside the search box now, and the
  summary above the list counts what the list is showing: switching the builder off used to leave it
  out of the rows and in the totals, which on a typical Mac is two CPUs and a gigabyte and a half
  belonging to something not on screen.
- **Dermaga is an app, not a browser in a window.** Right-click offered *Reload*, the menu bar
  carried a *View* menu of reload, force reload and the web inspector, and a *Help* menu whose only
  entry opened the website of the framework it is built with. Reload is the one that mattered: it
  throws away the window's state and reconnects, and whoever presses it is looking for a refresh
  button this app deliberately does not have, because nothing here is ever stale. All of it is gone;
  Cmd-R does nothing. Control-R still works, because in the terminal tab it is history search.
- **Apple's builder stays out of the way.** `buildkit` is made and managed by `container build`, and
  deleting it only means the next build makes another. It is left out of the container-names warning,
  and it can be switched out of the list — from the list, and out of everywhere at once: hidden from
  one place and offered by the command palette is not hidden.

### Fixed

- **Lists no longer claim to be empty before they know.** Registries decided there were none before
  the answer arrived and said so — on a Mac that was signed in — then replaced itself with the rows a
  moment later. Every table draws the shape of its answer while it waits now: same columns, same row
  height, and the rows land where the bars were.
- **A container's name is its name.** Once a DNS domain exists the runtime reports hostnames fully
  qualified, root dot and all, and the list was showing `whoami.internal.` where `whoami` belongs.
- **Settings that read badly.** *Keep watching while Dermaga is closed* described what it did rather
  than what it is for, and sat apart from the setting it depends on.

## [v1.8.1] — 2026-08-21

### Fixed

- **An image that cannot be scanned on this Mac no longer says something went wrong.** An image
  built only for Intel cannot be read on Apple Silicon, and the scanner kept reporting that as a
  failure and trying again on every sweep — so the status bar carried a warning that no amount of
  waiting would clear. Such an image is passed over now, and asking for it by hand answers with the
  reason instead of failing. A warning about an image you have since deleted goes with the image,
  and one you cannot do anything about can be dismissed.
- **Text that ran out of its box.** An image reference is one unbroken run of ninety characters with
  nowhere to break, and it was being drawn straight through the edge of whatever was reporting it —
  a toast, the scanner's panel, the tags column over the vulnerability count beside it. Seven places
  now wrap or truncate instead.

## [v1.8.0] — 2026-08-21

### Added

- **Updates install themselves.** An update used to end with the disk image open in Finder and you
  dragging Dermaga across. Now the download is checked — the signature intact, signed by the same
  Apple Developer ID as the copy you are running, and notarized — and only then put in place, with
  the app reopening already updated. Anything that cannot be proven falls back to opening the image,
  the way it always worked: an update that half happened would be worse than one that asks for a
  drag. Because the code doing this lives in the version already installed, **this one still has to
  be dragged across; the next one will not.**

## [v1.7.1] — 2026-08-21

### Fixed

- **Clicking a notification no longer closes Dermaga.** Clicking *"web stopped"* ended the app on
  the spot: no window, no menu bar item, and its agent left running behind it. Opening it again
  failed, and only worked on the third try. One fault produced all of that — asking macOS for the
  Dock icon from the thread a notification arrives on, which deadlocks and takes the app with it.
- **"The Dermaga agent did not start", with an agent that had started.** Launching waited for the
  agent's socket file to appear and then tried to connect once. A socket file left behind by a
  previous run was already there, so the wait ended immediately and the one attempt arrived before
  anything was listening. It waits for an answer now, which a leftover file cannot fake. Startup
  stopped at that point, before the menu bar item was created, which is why a failed launch had no
  tray either.

## [v1.7.0] — 2026-08-21

### Changed

- **Electron is gone; Dermaga is a real Mac app.** The window used to be a browser shipped alongside
  the app — a whole Chromium, for a UI that only ever talked to a Go process. It is now drawn by the
  system's own WebKit from that same Go process, so there is no second runtime to ship, start or keep
  up to date. The download went from **118 MB to under 10 MB**, and what you install is one binary
  with the agent inside it. Nothing about how you use it changed: every feature, every shortcut and
  every page is where it was.
- **Signed with an Apple Developer ID and notarized by Apple.** Earlier releases were ad-hoc signed,
  which meant Gatekeeper stopped them and you had to go to System Settings and click *Open Anyway*
  before Dermaga would run at all. That is over — it opens the first time, like any other app.
- **macOS 26 is the requirement, and now it says so.** The app claimed macOS 12 or later, which was
  never true: Apple's `container` runtime needs virtualisation and networking introduced in macOS 26,
  so a Mac that could install Dermaga would have found nothing it could talk to.

### Added

- **Notifications actually arrive.** A container that stops without being asked to has always been
  worth telling you about, and the notification has always been sent — macOS was dropping it,
  silently, because it refuses notifications from apps without a Developer ID signature. Now that
  there is one, they arrive. Turn them off in Settings if you would rather they did not.
- **A volume opens without a network.** Reading a volume that no container has mounted starts a small
  helper container, and the runtime fetched its image when it was missing — which quietly put a
  registry between you and your own data. Dermaga now keeps its own copy on disk and loads that back
  when the image is gone. Refreshed weekly, and left alone whenever the registry cannot be reached.
- **The menu bar points at the project.** *View on GitHub*, one click from the clock.

### Fixed

- **The menu bar opens on one click.** It took a two-finger click to open, and one finger did
  nothing at all. The menu is handed to the status item now and macOS opens it itself — either
  button, with the proper highlight, without pulling the app to the front.
- **An edit that fails no longer loses what you typed.** Saving the edit form recreates the
  container, and when the new one refused to start — an image built locally and since deleted, a port
  now taken — the previous container came back but your changes went with the failed attempt. What
  you asked for is written down before anything is taken apart, and offered back with the reason it
  did not finish.
- **Copying files in and out of a mounted volume.** Dropping a file onto a path that is a mounted
  volume did nothing at all, and pulling one out could hang until the container had to be killed.
  Both go through the container itself now, and neither can wedge the runtime.
- **Force stop, for a container the runtime has lost.** When a container cannot be stopped and the
  runtime will not let go of it, there is now a way to end it rather than restarting the services.
- **Files copied out of a container no longer arrive with `._` twins.** macOS was writing its own
  metadata into the archive on the way through.

## [v1.6.1] — 2026-08-19

### Fixed

- **What's new looks like the page it is.** It kept a back arrow from when it was reached from Help,
  which made no sense once it had an entry of its own in the sidebar — and italics in the notes were
  rendering as literal asterisks.
- **A notification, or the menu bar, opens the container even with no window.** Clicking *"web
  stopped"* did nothing at all when Dermaga was sitting in the menu bar with everything closed — and
  that is exactly when a notification about a container that died is worth clicking. The window is
  built first now, and the request waits for it: a renderer that does not exist yet cannot be told
  anything, so it collects the container it was opened for as it starts.

## [v1.6.0] — 2026-08-19

### Added

- **Containers that start with Dermaga.** Tick *Start this container when Dermaga starts* and it
  comes up when the agent does — at login with the background service on, or when you open the app.
  Apple's CLI has nothing like it. The mark is a label on the container rather than a record kept
  here, so it travels with the container and leaves nothing behind if the container is deleted from a
  terminal. It waits for Apple's services to be up first, since at login they are often still
  starting.

- **The agent can run as a background service.** A switch in Settings installs it as a per-user
  launchd job, so it starts at login and keeps watching containers whether or not a window is open —
  and brings up the ones marked to start with Dermaga before you have opened anything. Installing hands the socket over: the
  agent the app started is asked to stand down, and the service takes its place. Removing it puts the
  agent back inside the app. Opt-in, because a background process nobody asked for is not a feature.

- **A menu bar item.** It reports the runtime rather than the app — whether the container services
  are up, how many containers are running, and each of them by name, a click away from its page.
  Below that: Open Dermaga, Start services when they are stopped, and Quit. The icon is the logo cut
  down to what survives at 16pt, filled while the services run and hollow when they do not.
- **Open Dermaga at login**, in Settings. Opened that way it starts in the menu bar with no window
  and no splash — nobody logging in asked for a window — while the agent runs and exit notices still
  arrive. The setting belongs to macOS, so changing it in System Settings changes it here too.
- **Closing the window leaves the Dock.** With no window open Dermaga is a menu bar app; the icon
  comes back the moment a window does.

- **Volumes that database images can actually write to.** A volume here is an ext4 filesystem, and
  every ext4 filesystem has a `lost+found` in it. Images that look before they write read that as
  "this volume is not empty" and refuse to set themselves up: redis prints *"Notice: Unknown file
  './lost+found' found in data dir. Permissions will not be modified"*, then drops to its own user
  and fails with `Can't open or create append-only dir appendonlydir: Permission denied`. Volumes
  are prepared wherever they come into being — including the usual way, which is typing a name into a
  container's mount and letting it be created for you. `redis-server --appendonly yes` on a container
  with a brand new volume now simply runs, with nothing to set and no second visit to the volume page.
  A volume made outside Dermaga is prepared the first time a container mounts it, and can also be
  tidied from its own page.
- **A volume's owner, and a way to change it.** The Permissions section on a volume reports who owns
  its root directory and hands it to someone else in one step. This is the answer to most "permission
  denied" in a container with a volume: a volume is born owned by root, while the official database
  images run as somebody else — redis and postgres both as 999 — so the first write fails with an
  error that never mentions the word volume. Reading it is instant when a running container already
  has the volume, because that container is asked rather than a helper started.

### Fixed

- **The background service says when it is pointing at the wrong copy of Dermaga.** The service
  records the path of the app that installed it, so moving that app, deleting it, or switching
  between a development build and an installed one left a service that was switched on and serving
  nobody — silently. Settings now says which copy it points at, whether that copy is still there, and
  offers to point it at this one.
- **A development build no longer drives the installed app's agent.** Both looked for the same socket
  in `~/.dermaga`, so running `make dev` with Dermaga installed meant the build you are working on
  quietly steering the agent of the one you have — different code, the same containers, and nothing
  on screen to say so. A development build now keeps its socket inside the checkout, and a background
  service installed from one listens there too.

- **Table headings line up, and the cursor stops flickering.** The click belonged to each cell, so
  the gutters between columns belonged to nothing: the pointer changed at every column edge, and
  clicking between two columns did nothing at all. The row owns both now.
- **A stream that stops because reading failed says so.** A scanner ends on an error exactly as it
  ends at the end of the input, so a build or a terminal session cut short looked like one that
  finished.
- **Only one Dermaga at a time.** Opening the app while it was already running started a second copy,
  with a second agent, a second watcher and duplicate exit notifications. It now brings the running
  one forward — which matters more than it used to, since an app with no Dock icon is opened by
  launching it again.

## [v1.5.0] — 2026-08-19

### Added

- **A network detail page, drawn as a graph.** The network sits in the middle, its containers around
  it with the address each holds there, and the gateway as a node of its own. Hovering lights a node
  and its edge; clicking one opens that container. The canvas pans, zooms and fits itself. The list
  keeps a count where it used to print every attached container's name.
- **A container can sit on several networks.** The create and edit forms offer every network as a
  toggle instead of a single choice. An existing container can be attached to a network, or detached
  from it, from the network's page or the palette — each goes through a recreate, and says so first.
- **A volume detail page, and a way to look inside one.** Which containers mount it and where it
  lands inside each, the labels, and what it actually costs on disk rather than the half-terabyte cap
  it was created with. The Files tab reads the volume through whichever running container already has
  it; when none does, Dermaga starts a small helper container, says so, and removes it on the way out.
- **A usage tab for containers**, holding the live meters — now dials — and the last half hour of CPU
  and memory together, with a note that the history is Dermaga's own recording rather than something
  the CLI keeps.
- **Run a container from an image**, from the image's page, its row in the list, or `⌘K`.
- **Volumes and networks in the command palette**, by name, alongside containers, images and machines.

### Fixed

- **Editing a container no longer loses its settings.** Recreating it rebuilt the spec from what
  `inspect` reported, and that spec carried thirteen fields — so a read-only root came back writable,
  dropped capabilities came back granted, custom DNS reverted, and `--init`, `--tty`, `--rosetta`,
  `--ssh` and the runtime handler were forgotten. Everything the CLI both reports and accepts as a
  flag now survives. Three settings still cannot: `--rm`, `--sysctl` and the stop signal, which the
  CLI never reports back.
- **Table headings line up with their columns.** The header and the rows were separate grids given
  the same track list, and the trailing actions column sized itself differently in each, so every
  heading after the flexible column sat a few pixels left of its values. One grid now owns the
  columns; scrolling a long list also keeps the headings in view.

### Changed

- **One shape for every fact on a detail page.** A label above its value, wrapping rather than
  truncating, in a two-column grid. Right-aligned values of wildly different lengths — an IPv6 prefix
  beside an MTU, a digest beside a port — left a ragged edge, and anything that did not fit was cut
  short, which for an address is worse than showing nothing.

## [v1.4.1] — 2026-08-18

### Added

- Hide the tabs a container cannot support.
- Refuse to ship a bundle with inline scripts.

### Fixed

- Run the splash's script in packaged builds.

## [v1.4.0] — 2026-08-18

### Added

- Browse a container's files, and drag them in and out of Finder.
- Say when a container dies, and open its published ports in the browser.
- Manage registries, and push images to them.
- List every open-source licence the app ships.

### Fixed

- Show the running version on the splash.
- Stop making clean images wait for a second opinion.

## [v1.3.1] — 2026-08-18

### Fixed

- Apply a custom shell user on Enter, not on every keystroke.

## [v1.3.0] — 2026-08-18

### Added

- Open a container shell as root or any other user.
- Edit a container's environment as `.env` text or as fields.
- Give the splash the presence of a real product.

### Fixed

- Answer a rescan straight away.
- Stop reading `liberror-perl` as a failed build.
- Install the Linux kernel without hanging, and never silently.

## [v1.2.0] — 2026-08-18

### Added

- Scan images for known vulnerabilities in the background.
- Build images from a Dockerfile, with live progress.
- Select several machines at once, as every other list allows.
- Offer the update from the status bar.
- Build release notes from the commits rather than from pull requests.

### Fixed

- Make Reclaim actually reclaim, and say how much.
- Default a new machine to alpine rather than ubuntu.
- Show the splash when Dermaga is launched from a terminal.
- Stop stacking rules under the tab strip.
- Stop the fixed control height from squashing textareas.

## [v1.1.0] — 2026-08-18

### Added

- Install the recommended Linux kernel from the services screen.
- A publish target, so a failed release can be retried without rebuilding.

### Fixed

- Explain empty machine logs instead of relaying the runtime error.
- Correct the Gatekeeper instructions for macOS 15 and later.

## [v1.0.0] — 2026-08-17

First release: containers, images, volumes, networks and machines from one window, a terminal and
logs for each, and a Go agent wrapping Apple's `container` CLI with no daemon and no polling.

[v1.8.1]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.8.1
[v1.8.0]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.8.0
[v1.7.1]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.7.1
[v1.7.0]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.7.0
[v1.6.1]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.6.1
[v1.6.0]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.6.0
[v1.5.0]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.5.0
[v1.4.1]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.4.1
[v1.4.0]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.4.0
[v1.3.1]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.3.1
[v1.3.0]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.3.0
[v1.2.0]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.2.0
[v1.1.0]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.1.0
[v1.0.0]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.0.0
