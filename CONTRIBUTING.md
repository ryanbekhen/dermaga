# Contributing

## Before you start

**You need a Mac.** Not for convenience: the window is Cocoa and WebKit through
cgo -- `internal/window` links `-framework Cocoa` -- so the app does not compile
anywhere else, which is why CI runs on a macOS runner. Apple Silicon on macOS 26,
the same as the app asks of anyone running it -- you cannot try a change without
the runtime it drives.

**There is nothing to sign.** No CLA, no DCO sign-off, and commits do not have
to be GPG-signed. What you open comes in under the [MIT licence](LICENSE), the
same terms as everything already here.

**Say what you are planning before building something large.** A fix, a rough
edge, a missing state -- go straight to a pull request, and an open issue
labelled `bug` is fair game without asking first. A new page, a new domain
package, or a change to how something already works is worth an issue of its own
before the code, so a week of work does not turn out to have been meant to look
or behave differently.

There is one maintainer, so a first reply can take a few days. A pull request
that has gone quiet for longer than that is worth a nudge in its own thread.

## What belongs here

A few things are settled, and a change that argues with them is not going to be
merged however well it is written:

- **It drives Apple's `container`, it does not replace it.** What exists is
  whatever the CLI says exists -- Dermaga keeps no second register of containers
  or images, which is why what you do in a terminal shows up here within seconds
  and what you do here is visible to `container ls`. It does keep what the
  runtime has no concept of, in `~/.dermaga`: scan results, templates, tunnel
  routes, which containers are marked to start. Never its own idea of what is
  running.
- **No ports, and no daemon unless one is asked for.** The window and its agent
  talk over a socket in your home directory, never a port. By default the agent
  belongs to the app and goes when it does; the background service is opt-in,
  and it is what lets a container marked to start come up at login with no
  window open.
- **The scanning stays on the machine.** Nothing about your containers, images or
  results is sent anywhere.
- **The window is the Mac's own WebKit.** Not a bundled browser engine, and not a
  second UI toolkit alongside it.

How something looks is decided before it is built, so a pull request that
redesigns a page is the one most likely to be turned down after the work is
already done. Open an issue with a screenshot or a sketch first and it can be
settled in a comment instead.

One thing gets a pull request closed rather than reviewed: not being able to say
what was actually run. `make check` proves the code compiles and the tests pass,
which is not the same as the thing being fixed. If the description cannot say
what was exercised on a real Mac and what it did, there is nothing here to review
yet.

## Getting set up

```bash
git clone https://github.com/<you>/dermaga   # your fork
cd dermaga
make desktop-deps   # npm install for the renderer
make dev            # builds the agent, then runs Vite + the app
```

You need Go 1.27 or newer -- [go.mod](go.mod) is the version that counts -- Node
20.19+ (Vite and ESLint both refuse anything older, and CI runs 20), and Apple's
[`container`](https://github.com/apple/container) CLI on your PATH. Everything
the app does goes through that CLI, so if a command misbehaves in Dermaga, try
it in a terminal first.

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

Two things about running it locally read as bugs and are not:

- **The copy in `/Applications` answers to the same bundle identifier.** So
  `open -a Dermaga`, the Dock icon or a notification can raise the installed app
  while you are looking for your build, and the change you just made appears to
  have done nothing. `make dev` runs `dist/Dermaga.app/Contents/MacOS/Dermaga`
  directly, and a bundle outside `/Applications` keeps to `~/.dermaga/dev.sock`
  rather than the installed app's socket -- so the two do not drive each other,
  they only look alike. Quitting the installed one while you work removes the
  confusion; `make install` replaces it, so it is not the way to try a build out.
- **The embedded frontend is built once and then left alone.** `internal/window/assets/dist`
  is a make target with no prerequisites, so `make check` and `make dev` reuse
  whatever is already there and only `make dist` rebuilds it. Under `make dev`
  the window loads from Vite, so it makes no difference -- but to see a frontend
  change in a run that Vite is not serving, `cd desktop && npm run build` first.

## Sending it

Work on a branch in your own fork and open the pull request against `main`. The
title becomes the commit subject when it is squashed, so give it one of the
prefixes below; the [pull request template](.github/pull_request_template.md)
asks for the rest, and the part worth spending time on is what you actually ran
-- much of this only fails on a real machine, and `make check` cannot see that.

Do not touch `CHANGELOG.md`, and do not pick a version number. It reads as the
obvious courtesy and it is the one thing here that cannot be contributed: the
file is the public claim about what a release means, the version is a claim
about how much it means, and both are decided when a release is cut rather than
when a change is written. An entry added on a branch has to invent a heading for
a release nobody has decided on yet.

What is wanted instead is a sentence in the pull request description saying what
a user would notice. That is what the entry gets written from. The same goes for
`desktop/src/generated/changelog.json`, which is built from that file and not
edited by hand.

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
  Vite writes its build into `internal/window/assets/dist`

## Where the rest is written down

- [Architecture](docs/architecture.md) — the layers, the packages, streaming, the RPC surface
- [Vulnerability scanning](docs/scanning.md) — what is scanned, when, and what is cached

## Conventions

- A domain package never imports the watcher or the RPC layer. If it needs to
  announce a change, it takes a `notify.Notifier`.
- `internal/cli` is the only package that runs Apple's CLI. Others do start
  processes -- `tar`, `ps`, `security`, `launchctl`, `codesign`, `open` -- but
  nothing else builds a `container` command.
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

Releases are cut by the maintainer, from a Mac holding the signing identity: the DMG is signed with
an Apple Developer ID and notarized by Apple, and neither is something a fork can reproduce. There
is nothing to do on your side -- a merged change ships with the next version.
