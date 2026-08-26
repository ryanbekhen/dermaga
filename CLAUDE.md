# Dermaga

A macOS app for Apple's `container` runtime. Four pieces: a Go agent
(`cmd/dermaga-agent`) that drives the CLI and keeps what the runtime has no
concept of, a Cocoa/WebKit window (`cmd/dermaga`, `internal/window`), a React
frontend (`desktop`) the window embeds, and one domain package per subject
under `internal/`. The window and the agent speak JSON-RPC over a socket in
`~/.dermaga` — never a port.

[CONTRIBUTING.md](CONTRIBUTING.md) is the long version, and worth reading before
a first change. [docs/architecture.md](docs/architecture.md) is how the pieces
fit. What follows is the part an agent gets wrong.

## Do not, unless you were asked to in so many words

- **Do not write `CHANGELOG.md`, and never pick a version number.** This is the
  one that keeps happening. The changelog is the public claim about what a
  release means and the version is a claim about how much it means; both belong
  to the maintainer, who decides when there is a release at all. A branch cannot
  know that about itself. Say what changed in the pull request description
  instead — that is where it is read from when the release is written.
  `desktop/src/generated/changelog.json` is built from that file, so it is not a
  way round this either.
- **Do not commit, push, tag, open a pull request, or release.** Leave finished
  work in the working tree and say what is in it. Every one of those is a
  separate ask.
- **No attribution trailers in commit messages.** No `Co-Authored-By` for the
  model, no "generated with". The commit is the author's.
- **Do not run `make install`.** It replaces the copy in `/Applications`, which
  is the app the user actually runs. `make dev` is how a change is tried.
- **Do not edit generated files.** `desktop/src/generated/changelog.json`,
  `THIRD-PARTY-NOTICES.md` and `internal/window/assets/dist` are all built —
  `make changelog`, `make notices`, `bun run build`. Editing one only means it
  is wrong until the next build.
- **Do not delete or prune anything of the user's** — images, volumes,
  containers, `~/.dermaga/dermaga.db`. Diagnosing a problem is not a reason to
  throw away the state that shows it.

## Commands

```bash
make check    # go vet, go test, gofmt, tsc, eslint — the floor
make fmt      # gofmt + prettier
make dev      # builds the agent, bundles it, runs Vite and the app together
make notes VERSION=x.y.z   # what the release notes would say
```

`make check` must pass on the tree of every commit, not only at the tip. A
commit that does not compile on its own is a commit nobody can bisect through.

## Three things that look like bugs and are not

- **`/Applications` answers to the same bundle identifier.** `open -a Dermaga`,
  the Dock, or a notification can raise the installed app instead of the build
  under test, and the change appears to have done nothing. A bundle outside
  `/Applications` keeps to `~/.dermaga/dev.sock`, so the two do not drive each
  other — they only look alike.
- **The embedded frontend is built once and left alone.**
  `internal/window/assets/dist` is a make target with no prerequisites, so
  `make check` and `make dev` reuse whatever is there. Under `make dev` the
  window loads from Vite so it does not matter; anywhere else, run
  `cd desktop && bun run build` first.
- **Vite's port is pinned to 127.0.0.1:3000.** If it is busy it stops rather
  than moving, because the app proxies to that address and a silent move is a
  blank window.

## Writing code here

The conventions in [CONTRIBUTING.md](CONTRIBUTING.md#conventions) are the list;
these are the ones that need saying to something that writes quickly.

- **Match the comments already around you.** This codebase explains *why* at
  length and in plain English, in the voice of somebody who hit the problem.
  Match that density and that voice. Never state a principle the code does not
  hold to, and never quote a rule back as though it were the author's — a
  comment is what was learned here, not a policy.
- **Adding an operation is three steps in order**: a method on the domain
  manager, a case in `internal/agent`, a call in `desktop/src/services/api.ts`.
  A domain package never imports the watcher or the RPC layer.
- **`internal/cli` is the only thing that builds a `container` command.**
- **Never decide a command failed by looking for "error" in its output.** Build
  logs are full of it — `liberror-perl`, `libgpg-error0`. The exit status is the
  truth.
- **Never write a `<script>` inside an HTML file.** Production serves under
  `default-src 'self'`, so it silently does nothing once packaged. `make dist`
  refuses a bundle containing one.
- **Updates are pushed, never polled**, and there are no refresh buttons. Icons
  are real vector icons — lucide or inline SVG — never emoji.

## Before you say it works

`make check` proves the code compiles and the tests still pass. It does not
prove the thing you changed is fixed: much of this only fails on a real machine
— a CLI that hangs without a pty, a window that traps on the wrong thread, a
script the CSP blocks. Run it, say what you exercised and what it did, and name
anything you could not verify rather than leaving it to be found.

Two rules for diagnosing, both learned the hard way. Capture output to a file
and read it — residue from an earlier run lies. And never `pkill` broadly:
match the project path, or you will take somebody's editor with you.
