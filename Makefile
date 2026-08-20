# Dermaga -- a macOS UI for Apple's `container` runtime.
#
#   make dev      run the app against a live agent build
#   make check    everything CI would run
#   make dist     build the signed-adhoc DMG

# The version comes from the most recent tag, so a build always names the
# release it belongs to. Override with `make VERSION=1.2.3` when cutting one.
VERSION ?= $(patsubst v%,%,$(shell git describe --tags --abbrev=0 2>/dev/null || echo 0.0.0))
COMMIT  := $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
DATE    := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
DMG     := dist/Dermaga-$(VERSION)-arm64.dmg
APP     := dist/Dermaga.app

# Every Go command here compiles the Objective-C for the same macOS, which is
# what keeps the linker quiet.
#
# Go links darwin/arm64 for macOS 11 whatever anything says, while cgo compiles
# Wails' Objective-C against the installed SDK. Left to disagree, that is one
# warning per object file -- twenty-odd lines burying the actual output. What
# the app really requires is stated where it is enforced, in
# LSMinimumSystemVersion; raising this to match would only put the two back at
# odds.
#
# Said through CGO_CFLAGS rather than MACOSX_DEPLOYMENT_TARGET because Go keys
# its build cache on the one and not on the other. With the environment
# variable, objects compiled once against the SDK are reused by every later
# build and warn every time -- which is exactly what adding an Objective-C file
# and building it once without the variable set does.
export CGO_CFLAGS := -O2 -g -mmacosx-version-min=11.0

# Wails asks the linker for -lobjc, and so does the toolchain. Saying so once
# per build tells nobody anything, so the tests link as quietly as the bundle
# already does.
QUIET_LD := -extldflags=-Wl,-no_warn_duplicate_libraries

AGENT   := bin/dermaga-agent
LDFLAGS := -X main.Version=$(VERSION) -X main.Commit=$(COMMIT) -X main.BuildDate=$(DATE)

.PHONY: all agent icon notices changelog desktop-deps dev check test lint fmt dist verify-dist install release publish notes version clean

all: agent

## Build the Go agent.
agent:
	go build -ldflags "$(LDFLAGS)" -o $(AGENT) ./cmd/dermaga-agent

## Derive the app icon from the one checked-in logo, so it is never a
## second copy that can drift.
icon: build/icon.png desktop/public/splash-logo.png

build/icon.png: assets/logo.png
	@mkdir -p build
	sips -z 1024 1024 $< --out $@ >/dev/null

desktop/public/splash-logo.png: assets/logo.png
	sips -z 256 256 $< --out $@ >/dev/null

desktop-deps:
	cd desktop && npm install

## Collect the licences of everything shipped. MIT, ISC and BSD all require
## their notice to travel with the binary, so this is a condition of
## distributing the DMG rather than a courtesy -- and generated, because a
## hand-written list drifts the moment a dependency moves.
notices:
	node scripts/notices.mjs

changelog:
	node scripts/changelog.mjs

## Run Vite and the app together, with a freshly built agent.
##
## Notifications need a bundle identifier, so there is no useful way to run this
## outside a .app: the bundle is the development build as well as the shipped
## one. What tells them apart is where it sits -- a bundle anywhere but
## /Applications keeps to its own agent socket, so trying a build out never
## disturbs the Dermaga you have installed.
##
## Ctrl-C stops both.
dev: agent icon notices changelog internal/window/assets/dist/index.html
	VERSION=$(VERSION) ./scripts/bundle.sh --dev
	cd desktop && npx concurrently -k -n vite,dermaga -c cyan,magenta \
		"npx vite" \
		"npx wait-on tcp:127.0.0.1:3000 && FRONTEND_DEVSERVER_URL=http://localhost:3000 ../$(APP)/Contents/MacOS/Dermaga"

## Everything that has to pass: vet, tests, types, lint.
check: test lint
	go vet ./...
	cd desktop && npx tsc -b --force

test: internal/window/assets/dist/index.html
	go test -ldflags "$(QUIET_LD)" ./...
	cd desktop && npm test

## The Go app embeds the built frontend, so it cannot be compiled without one.
internal/window/assets/dist/index.html:
	cd desktop && npm run build

lint:
	gofmt -l . | tee /dev/stderr | (! read)
	cd desktop && npm run lint

fmt:
	gofmt -w .
	cd desktop && npm run format

## Package the DMG. The agent travels in the bundle, and packaging fails rather
## than shipping one without it.
dist: agent icon notices changelog
	cd desktop && npm run build
	VERSION=$(VERSION) ./scripts/bundle.sh
	@# Notarized before packaging as well as after: the ticket on the image
	@# covers the app only while it is still inside the image, and the app is
	@# dragged out of it within the minute.
	@if [ -n "$$NOTARY_PROFILE" ] || [ -n "$$APPLE_ID" ]; then ./scripts/notarize.sh $(APP); \
	else echo "==> not notarizing: neither NOTARY_PROFILE nor APPLE_ID is set"; fi
	VERSION=$(VERSION) ./scripts/dmg.sh
	@if [ -n "$$NOTARY_PROFILE" ] || [ -n "$$APPLE_ID" ]; then ./scripts/notarize.sh $(DMG); fi
	@$(MAKE) --no-print-directory verify-dist

## Prove the artefact is self-contained before it goes anywhere.
verify-dist:
	@test -x "$(APP)/Contents/MacOS/Dermaga" || { echo "FAIL: binary missing from bundle"; exit 1; }
	@test -x "$(APP)/Contents/Resources/dermaga-agent" || { echo "FAIL: agent missing from bundle"; exit 1; }
	@test -f "$(APP)/Contents/Resources/icons.icns" || { echo "FAIL: icon missing"; exit 1; }
	@sh scripts/check-inline-scripts.sh internal/window/assets/dist || exit 1
	@test -f "$(DMG)" || { echo "FAIL: no DMG at $(DMG)"; exit 1; }
	@sh scripts/check-signature.sh "$(APP)" "$(DMG)" $(SIGNING) || exit 1
	@sh scripts/check-version.sh "$(APP)" "$(VERSION)" || exit 1
	@echo "verify-dist: binary, agent, icon, no inline scripts, DMG"

## Install the built app locally, clearing the quarantine flag that Gatekeeper
## sets on anything downloaded.
install: dist
	rm -rf /Applications/Dermaga.app
	cp -R $(APP) /Applications/
	xattr -dr com.apple.quarantine /Applications/Dermaga.app
	@echo "installed: /Applications/Dermaga.app"

## Cut a release: tag it, build it, publish it.
##
##   make release VERSION=1.1.0
##
## Refuses to run on a dirty tree or a failing check, so a tag always points at
## something that built.
release:
	@test "$(VERSION)" != "0.0.0" || { echo "set VERSION, e.g. make release VERSION=1.1.0"; exit 1; }
	@git diff --quiet && git diff --cached --quiet || { echo "working tree is dirty"; exit 1; }
	@git rev-parse "v$(VERSION)" >/dev/null 2>&1 && { echo "tag v$(VERSION) already exists"; exit 1; } || true
	$(MAKE) check
	cd desktop && npm version $(VERSION) --no-git-tag-version --allow-same-version >/dev/null
	@# npm stamps the version into the lockfile too, so both have to go in.
	git add desktop/package.json desktop/package-lock.json
	@# package.json can already be at this version -- tag the current commit then.
	@git diff --cached --quiet || git commit -m "release: v$(VERSION)"
	git tag -a "v$(VERSION)" -m "Dermaga v$(VERSION)"
	git push origin HEAD
	git push origin "v$(VERSION)"
	$(MAKE) VERSION=$(VERSION) SIGNING=--release dist
	$(MAKE) VERSION=$(VERSION) publish

## Publish an already-tagged, already-built version to GitHub. Split out of
## `release` so a failure at the last step -- a GitHub outage, an expired
## token -- can be retried on its own, without re-tagging or rebuilding.
publish:
	@git rev-parse "v$(VERSION)" >/dev/null 2>&1 || { echo "no tag v$(VERSION); run: make release VERSION=$(VERSION)"; exit 1; }
	@test -f "$(DMG)" || { echo "no DMG for $(VERSION); run: make VERSION=$(VERSION) dist"; exit 1; }
	@git push origin "v$(VERSION)" 2>/dev/null || true
	@set -e; \
	notes=$$(mktemp); \
	trap 'rm -f "$$notes"' EXIT; \
	sh scripts/release-notes.sh "v$(VERSION)" > "$$notes"; \
	if gh release view "v$(VERSION)" >/dev/null 2>&1; then \
		echo "release v$(VERSION) exists; updating it"; \
		gh release upload "v$(VERSION)" "$(DMG)" --clobber; \
		gh release edit "v$(VERSION)" --notes-file "$$notes"; \
	else \
		gh release create "v$(VERSION)" "$(DMG)" \
			--title "Dermaga v$(VERSION)" \
			--notes-file "$$notes"; \
	fi
	@echo "released: v$(VERSION)"

## Preview what the release notes for a version would say.
notes:
	@sh scripts/release-notes.sh "v$(VERSION)"

## What this build reports about itself.
version:
	@echo "version: $(VERSION)"
	@echo "commit:  $(COMMIT)"
	@echo "dmg:     $(DMG)"

clean:
	rm -rf bin dist internal/window/assets/dist build/icon.png desktop/public/splash-logo.png
