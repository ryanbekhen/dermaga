#!/usr/bin/env bash
#
# Wraps Dermaga.app in a disk image, with the drag-to-Applications shortcut
# every Mac user expects to find inside one.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="${VERSION:-0.0.0}"

app="$root/dist/Dermaga.app"
dmg="$root/dist/Dermaga-$version-arm64.dmg"

test -d "$app" || {
	echo "FAIL: $app is not there; run \`make dist\` rather than this alone" >&2
	exit 1
}

# Staged, so the image holds the app and the shortcut and nothing else -- a
# DMG made straight from the release directory would carry every earlier build
# in it.
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

cp -R "$app" "$staging/"
ln -s /Applications "$staging/Applications"

rm -f "$dmg"

echo "==> packaging $(basename "$dmg")"
hdiutil create \
	-volname "Dermaga $version" \
	-srcfolder "$staging" \
	-fs HFS+ \
	-format UDZO \
	-quiet \
	"$dmg"

echo "==> $dmg"
du -sh "$dmg"
