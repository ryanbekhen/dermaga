# Building and releasing

For contributors. Setting up to work on Dermaga is in
[CONTRIBUTING.md](../CONTRIBUTING.md).

```bash
make check     # go vet, go test, tsc, eslint
make fmt       # gofmt and prettier
make icon      # regenerate the app and splash icons from assets/logo.png
make clean
```

### Signing

Apple Silicon refuses to launch a bundle whose signature does not verify, so unsigned builds are
ad-hoc signed by `scripts/bundle.sh`. That is enough to run on the machine that built it,
but **not** enough for a Mac that downloaded it: Gatekeeper quarantines the file and blocks it.

Two ways to hand a build to someone else:

**Signed and notarized** — nothing to explain to the recipient. Provide credentials and the build
switches to a Developer ID identity, turns on the hardened runtime and notarizes:

```bash
CSC_NAME="Developer ID Application: Your Name (TEAMID)" \
APPLE_ID=you@example.com \
APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx \
APPLE_TEAM_ID=TEAMID \
make dist
```

**Unsigned** — the recipient has to let it through Gatekeeper themselves: open the app, then
**System Settings → Privacy & Security → Open Anyway**. Right-click → **Open** stopped working as a
bypass in macOS 15. From a terminal it is one command:

```bash
xattr -dr com.apple.quarantine /Applications/Dermaga.app
```

Notarizing needs paid membership of the Apple Developer Program; nothing else removes the warning.

### Releasing

```bash
make release VERSION=1.1.0
```

Runs the checks, bumps the version, tags `v1.1.0`, pushes, builds the DMG and publishes a GitHub
release with the artefact attached. It refuses to start on a dirty tree, a failing check, or an
existing tag.

Release notes are built from the commits between the two tags, grouped by their `feat:` / `fix:` /
`perf:` / `docs:` prefix; `make notes VERSION=1.1.0` prints them without publishing anything. Those
notes are the record of what moved; [CHANGELOG.md](../CHANGELOG.md) is the record of what changed for
whoever is deciding whether to update, and its `Unreleased` section becomes the new version's
heading as part of cutting the release. If the
last step fails — GitHub having a bad day, an expired token — `make publish VERSION=1.1.0` retries
just that part, without re-tagging or rebuilding.

The version and commit are stamped into the binary at link time, and the app reports them in the
bottom-right of the status bar — so any running build can be traced back to the commit it came from.
`make version` prints what the next build would report.
