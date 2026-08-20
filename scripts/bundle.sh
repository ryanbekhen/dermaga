#!/usr/bin/env bash
#
# Assembles Dermaga.app around the Wails binary.
#
# There is no packaging tool here to do it, and there does not need to be:
# a macOS bundle is a directory with an Info.plist, an executable and whatever
# it needs beside it. The agent travels in Resources, exactly where the app
# looks for it, and packaging fails rather than shipping a bundle without one.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="${VERSION:-0.0.0}"

# A development bundle is the same bundle without the production tag, which is
# what lets Wails serve the window from the Vite dev server instead of from the
# files embedded at build time. It is still a bundle: notifications refuse to
# register without a bundle identifier, so there is no lighter way to run this.
tags="production"
strip="-s -w"
if [ "${1:-}" = "--dev" ]; then
	tags=""
	strip=""
fi

app="$root/dist/Dermaga.app"
contents="$app/Contents"

rm -rf "$app"
mkdir -p "$contents/MacOS" "$contents/Resources"

# 1. The binary, with the frontend embedded in it.
#
# Two things keep the linker quiet, and both are about agreeing on a version
# rather than hiding a problem:
#
#   - cgo compiles Wails' Objective-C against whatever SDK is installed, while
#     Go links darwin/arm64 for macOS 11. Left alone that is one warning per
#     object file -- twenty-odd lines burying the actual output. Building the
#     objects for the same version Go links for is the agreement.
#
#     It is said as a compiler flag rather than as MACOSX_DEPLOYMENT_TARGET
#     because Go keys its build cache on the flags and not on that variable:
#     objects compiled against the SDK once are otherwise reused here and warn
#     every time. The Makefile exports the same value for everything it runs,
#     so a `go test` beforehand cannot leave mismatched objects behind either.
#
#   - Wails asks for -lobjc, and so does the toolchain. Saying so once per
#     build tells nobody anything.
echo "==> building Dermaga $version"
CGO_CFLAGS="-O2 -g -mmacosx-version-min=11.0" go build \
	-tags "$tags" \
	-ldflags "-X main.Version=$version $strip -extldflags=-Wl,-no_warn_duplicate_libraries" \
	-o "$contents/MacOS/Dermaga" \
	./cmd/dermaga/

# 2. The agent, which the app starts when no service is holding the socket.
test -x "$root/bin/dermaga-agent" || {
	echo "FAIL: bin/dermaga-agent is missing; run \`make agent\` first" >&2
	exit 1
}
cp "$root/bin/dermaga-agent" "$contents/Resources/dermaga-agent"

# 3. The Info.plist, stamped with the version this build calls itself.
sed "s/__VERSION__/$version/g" "$root/build/darwin/Info.plist" >"$contents/Info.plist"

# 4. The icon, derived from the one checked-in logo so it can never be a second
#    copy that drifts.
iconset="$(mktemp -d)/icons.iconset"
mkdir -p "$iconset"
for size in 16 32 64 128 256 512; do
	sips -z $size $size "$root/assets/logo.png" --out "$iconset/icon_${size}x${size}.png" >/dev/null
	sips -z $((size * 2)) $((size * 2)) "$root/assets/logo.png" --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$contents/Resources/icons.icns"

# 5. An ad-hoc signature. Without one macOS treats every launch as a new app
#    and the notification permission is asked for again each time.
codesign --force --deep --sign - "$app"

echo "==> $app"
du -sh "$app"
