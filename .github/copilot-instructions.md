# Dermaga — instructions for AI assistants

A macOS app for Apple's `container` runtime: a Go agent (`cmd/dermaga-agent`),
a Cocoa/WebKit window (`cmd/dermaga`, `internal/window`), a React frontend
(`desktop`), and one domain package per subject under `internal/`. The window
and the agent speak JSON-RPC over a socket in `~/.dermaga`, never a port.

Read [CONTRIBUTING.md](../CONTRIBUTING.md) before a first change;
[docs/architecture.md](../docs/architecture.md) is how the pieces fit. The same
rules are written for Claude Code in [CLAUDE.md](../CLAUDE.md), which is the
fuller version of this file.

## Do not, unless you were asked to in so many words

- **Never write `CHANGELOG.md` and never pick a version number.** The changelog
  is the public claim about what a release means, and the version is a claim
  about how much it means. Both belong to the maintainer, who decides whether
  there is a release at all — a branch cannot know that about itself. Put what
  changed in the pull request description; the changelog is written from there
  when a release is cut. `desktop/src/generated/changelog.json` is built from
  that same file, so it is not a way round this.
- **Never commit, push, tag, open a pull request, or release** on your own
  initiative. Leave the work in the tree and say what is in it.
- **No attribution trailers in commits.** No `Co-Authored-By` for the model, no
  "generated with".
- **Never run `make install`.** It replaces the copy in `/Applications`, which
  is the app the user actually runs.
- **Never edit generated files.** `desktop/src/generated/changelog.json`,
  `THIRD-PARTY-NOTICES.md`, `internal/window/assets/dist` — all built, by
  `make changelog`, `make notices` and `npm run build`.
- **Never delete or prune the user's images, volumes, containers or
  `~/.dermaga/dermaga.db`.**

## Working here

- `make check` — go vet, go test, gofmt, tsc, eslint. It must pass on the tree
  of every commit, not only at the tip.
- `make fmt` — gofmt and prettier.
- `make dev` — builds the agent, bundles it, and runs Vite with the app.
- Pull request titles carry a conventional prefix (`feat:`, `fix:`, `perf:`,
  `docs:`, `chore:`) because the title becomes the commit subject on squash and
  the release notes are grouped by it.
- Adding an operation is three steps in order: a method on the domain manager, a
  case in `internal/agent`, a call in `desktop/src/services/api.ts`. A domain
  package never imports the watcher or the RPC layer, and `internal/cli` is the
  only package that builds a `container` command.
- Never decide a command failed by searching its output for "error" — build logs
  are full of it. The exit status is the truth.
- Never write a `<script>` inside an HTML file: production serves under
  `default-src 'self'` and it silently does nothing once packaged.
- Updates are pushed, never polled, and there are no refresh buttons. Icons are
  real vector icons — lucide or inline SVG — never emoji.
- Match the comments already around you: this codebase explains *why*, at
  length, in plain English. Never state a principle the code does not hold to.

## Before you say it works

`make check` proves the code compiles and the tests pass. It does not prove the
thing you changed is fixed — much of this only fails on a real Mac. Say what you
actually ran and what it did, and name anything you could not verify rather than
leaving it to be discovered.
