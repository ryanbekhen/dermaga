# Contributing

## Getting set up

```bash
make desktop-deps   # npm install for the renderer
make dev            # builds the agent, then runs Vite + the app
```

You need Go 1.23+, Node 18+, and Apple's [`container`](https://github.com/apple/container)
CLI on your PATH. Everything the app does goes through that CLI, so if a command
misbehaves in Dermaga, try it in a terminal first.

## Before opening a pull request

```bash
make check    # go vet, go test, tsc, eslint
make fmt      # gofmt + prettier
make notes VERSION=x.y.z   # what the release notes would say
```

Changes to the window are worth running: `make dev` builds the agent, wraps it
in a bundle and serves the window from Vite, so a saved file is on screen
without a rebuild. Note that Vite's port is pinned -- if 3000 is busy it stops
rather than moving, because the app proxies to that address and a silent move
means a blank window. It is pinned to 127.0.0.1 too: left to itself Vite binds
IPv6 only, and the app's asset server dials IPv4.

## Layout

The [architecture notes](docs/architecture.md) go through this properly. In short:

- `cmd/dermaga-agent` — the Go process; speaks JSON-RPC on stdio
- `internal/…` — one package per domain, none of which import each other's
  transports; `internal/scanner` also owns its own background worker and the
  results it keeps in `~/.dermaga`
- `cmd/dermaga` — the app's entry point; the window itself is a package
- `internal/window` — the window: draws through WKWebView, brokers everything
  it is asked for to the agent, and embeds the built frontend
- `desktop` — the React window, which has no network access of its own;
  Vite writes its build into `internal/window/dist`

## Where the rest is written down

- [Architecture](docs/architecture.md) — the layers, the packages, streaming, the RPC surface
- [Vulnerability scanning](docs/scanning.md) — what is scanned, when, and what is cached
- [Building and releasing](docs/releasing.md) — signing, packaging, cutting a release

## Conventions

- A domain package never imports the watcher or the RPC layer. If it needs to
  announce a change, it takes a `notify.Notifier`.
- `internal/cli` is the only package allowed to use `os/exec`.
- Adding an operation means: a method on the domain manager, then a case in
  `internal/agent`, then a call in `desktop/src/services/api.ts`.
- Anything long-running is a stream, so the UI can show progress and cancel it.
- Some of Apple's CLI refuses to work without a terminal: `container exec -it`
  and `container system kernel set` both hang on a plain pipe, printing nothing
  and exiting never. Run those through `streams.runCommandTTY`, which gives them
  a pty, splits output on carriage returns and strips the escape codes a
  progress bar draws with.
- Never decide a command failed by looking for "error" in its output. Build logs
  are full of it -- `liberror-perl`, `libgpg-error0` -- and the exit status is
  the truth. Anchored markers are a fallback, not the rule.
- Work that takes more than a moment belongs in the background with a line in
  the status bar, not behind a spinner the user has to sit and watch. The
  scanner is the model: it installs itself, fetches its database and scans on
  its own goroutine, and reports where it has got to.
- A pane that should fill its page needs `flex-1` the whole way up, not only
  where the content is. A layout that is merely as tall as its content leaves
  empty states stuck to the top and drop targets ending halfway down, and both
  read as unrelated bugs.
- Never write a `<script>` inside an HTML file. Production serves the app under
  `default-src 'self'`, which blocks inline scripts, so one does nothing at all
  once packaged -- silently, and only there. `make dist` refuses to build a
  bundle containing one.
- Registries on this machine have no TLS. Anything that talks to one -- pull,
  push, login -- defaults to plain HTTP for `localhost` and friends, because the
  failure otherwise is `-9836: bad protocol version`, which explains nothing.

## Commits

Write commit subjects that read as the change itself, prefixed by kind:

```
feat: multi-select for bulk container actions
fix: sidebar logo off-centre when collapsed
perf: skip the watcher tick when nothing is subscribed
docs: explain the bootstrap sequence
chore: bump wails to v3.0.0-beta.11
```

The prefixes group the release notes, so the subject is what users read.
[scripts/release-notes.sh](scripts/release-notes.sh) sorts the commits between two tags into
Features, Bug fixes, Performance, Documentation and Maintenance. Preview what a release would say
with `make notes VERSION=1.1.0`.

## Releasing

```bash
make release VERSION=1.1.0
```

That one command runs `make check`, bumps `desktop/package.json`, commits, tags `v1.1.0`, pushes,
builds the DMG with the version and commit stamped into it, and publishes a GitHub release with the
notes built from those commit prefixes and the DMG attached.

It refuses to start on a dirty working tree, on a failing check, or when the tag already exists, so
a tag always points at something that actually built. The version the app reports comes from
`git describe`, so a build can always be traced back to its commit.
