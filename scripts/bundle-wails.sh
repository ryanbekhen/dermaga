#!/usr/bin/env bash
#
# Assembles Dermaga.app around the Wails binary.
#
# There is no electron-builder here to do it, and there does not need to be:
# a macOS bundle is a directory with an Info.plist, an executable and whatever
# it needs beside it. The agent travels in Resources, exactly where the app
# looks for it, and packaging fails rather than shipping a bundle without one.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="${VERSION:-0.0.0}"

app="$root/desktop/release-wails/Dermaga.app"
contents="$app/Contents"

rm -rf "$app"
mkdir -p "$contents/MacOS" "$contents/Resources"

# 1. The binary, with the frontend embedded in it.
echo "==> building Dermaga $version"
go build \
	-tags production \
	-ldflags "-X main.Version=$version -s -w" \
	-o "$contents/MacOS/Dermaga" \
	./desktop/

# 2. The agent, which the app starts when no service is holding the socket.
test -x "$root/bin/dermaga-agent" || {
	echo "FAIL: bin/dermaga-agent is missing; run \`make agent\` first" >&2
	exit 1
}
cp "$root/bin/dermaga-agent" "$contents/Resources/dermaga-agent"

# 3. The Info.plist, stamped with the version this build calls itself.
sed "s/__VERSION__/$version/g" "$root/desktop/build/darwin/Info.plist" >"$contents/Info.plist"

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
