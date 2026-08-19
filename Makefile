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
DMG     := desktop/release/Dermaga-$(VERSION)-arm64.dmg

AGENT   := bin/dermaga-agent
LDFLAGS := -X main.Version=$(VERSION) -X main.Commit=$(COMMIT) -X main.BuildDate=$(DATE)

.PHONY: all agent icon notices changelog desktop-deps dev check test lint fmt dist verify-dist install release publish notes version clean

all: agent

## Build the Go agent.
agent:
	go build -ldflags "$(LDFLAGS)" -o $(AGENT) ./cmd/dermaga-agent

## Derive the app icon from the one checked-in logo, so it is never a
## second copy that can drift.
icon: desktop/build/icon.png desktop/electron/splash-logo.png

desktop/build/icon.png: assets/logo.png
	@mkdir -p desktop/build
	sips -z 1024 1024 $< --out $@ >/dev/null

desktop/electron/splash-logo.png: assets/logo.png
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

## Run Vite and Electron together, with a freshly built agent.
dev: agent icon notices changelog
	cd desktop && npm run dev:app

## Everything that has to pass: vet, tests, types, lint.
check: test lint
	go vet ./...
	cd desktop && npx tsc -b --force

test:
	go test ./...
	cd desktop && npm test

lint:
	gofmt -l . | tee /dev/stderr | (! read)
	cd desktop && npm run lint

fmt:
	gofmt -w .
	cd desktop && npm run format

## Package the DMG. The agent is embedded as a resource, and packaging fails
## rather than shipping a bundle without it.
dist: agent icon notices changelog
	cd desktop && npm version $(VERSION) --no-git-tag-version --allow-same-version >/dev/null
	cd desktop && npm run dist
	@$(MAKE) --no-print-directory verify-dist

## Prove the artefact is self-contained before it goes anywhere.
verify-dist:
	@app=desktop/release/mac-arm64/Dermaga.app; \
	test -x "$$app/Contents/Resources/dermaga-agent" || { echo "FAIL: agent missing from bundle"; exit 1; }; \
	test -f "$$app/Contents/Resources/icon.icns" || { echo "FAIL: icon missing"; exit 1; }; \
	test -f "$$app/Contents/Resources/app.asar" || { echo "FAIL: app.asar missing"; exit 1; }; \
	codesign --verify --deep "$$app" || { echo "FAIL: signature does not verify"; exit 1; }; \
	sh scripts/check-inline-scripts.sh "$$app" || exit 1; \
	echo "verify-dist: agent, icon, asar, signature and no inline scripts"

## Install the built app locally, clearing the quarantine flag that Gatekeeper
## sets on anything downloaded.
install: dist
	rm -rf /Applications/Dermaga.app
	cp -R desktop/release/mac-arm64/Dermaga.app /Applications/
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
	$(MAKE) VERSION=$(VERSION) dist
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
	rm -rf bin desktop/dist desktop/release desktop/build/icon.png desktop/electron/splash-logo.png
