#!/bin/sh
# Fails when a bundle contradicts itself about what version it is.
#
# The app and the agent inside it are stamped by separate build steps, so
# building them with different VERSION values produces a bundle that disagrees
# with itself. It does so quietly, which is the problem: the window's status bar
# reads the agent's version while the update check compares the app's, so the
# number on screen is not the number being compared -- and "why is there no
# update offered" cannot be answered from the window at all.
#
# Found the hard way, from a user's screenshot.
#
#   usage: scripts/check-version.sh path/to/Dermaga.app 1.8.0
set -eu

app="${1:?usage: check-version.sh <app> <version>}"
want="${2:?usage: check-version.sh <app> <version>}"

plist="$app/Contents/Info.plist"
agent="$app/Contents/Resources/dermaga-agent"

test -f "$plist" || { echo "FAIL: no Info.plist in $app"; exit 1; }
test -x "$agent" || { echo "FAIL: no agent in $app"; exit 1; }

bundle="$(defaults read "$(cd "$(dirname "$plist")" && pwd)/Info.plist" CFBundleShortVersionString)"
# The agent reports "1.8.0 (85b2832)"; the version is the first word.
inside="$("$agent" --version | awk '{print $1}')"

if [ "$bundle" != "$inside" ]; then
	echo "FAIL: the bundle says $bundle and the agent inside it says $inside"
	echo '      Build both from one make invocation so they carry the same VERSION.'
	exit 1
fi

if [ "$bundle" != "$want" ]; then
	echo "FAIL: built as $want but the bundle says $bundle"
	exit 1
fi

echo "check-version: $bundle, and the agent inside agrees"
