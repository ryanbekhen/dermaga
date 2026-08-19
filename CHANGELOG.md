# Changelog

Every released version, and what landed in it. The entries here are written for someone deciding
whether to update; `scripts/release-notes.sh` generates the same ground from the commits, and the
GitHub release for each tag carries that generated list with its commit hashes.

This project follows [semantic versioning](https://semver.org): the version is bumped for what the
change means to someone using Dermaga, not for how much code moved.

## Unreleased

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

[v1.4.1]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.4.1
[v1.4.0]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.4.0
[v1.3.1]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.3.1
[v1.3.0]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.3.0
[v1.2.0]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.2.0
[v1.1.0]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.1.0
[v1.0.0]: https://github.com/ryanbekhen/dermaga/releases/tag/v1.0.0
