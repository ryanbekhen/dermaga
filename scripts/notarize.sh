#!/usr/bin/env bash
#
# Sends a signed artefact to Apple and staples the answer to it.
#
# Notarizing is Apple looking at the thing and saying it has seen it. Gatekeeper
# asks about that on first launch, and without an answer it shows the
# "could not verify Dermaga is free of malware" panel that has to be talked past
# in System Settings.
#
# Stapling writes the answer into the file itself, so a Mac that is offline --
# or that has just been handed a DMG on a stick -- does not have to ask.
#
#   usage: scripts/notarize.sh path/to/Dermaga.app
#          scripts/notarize.sh path/to/Dermaga.dmg
#
# Both are worth doing. The ticket from the DMG covers the app inside it, but
# only while the app is still inside it: once dragged to Applications, an app
# that was never stapled itself has to ask the network. Notarizing the app
# first and the image afterwards is what makes an offline install work.
set -euo pipefail

target="${1:?usage: notarize.sh <path to .app or .dmg>}"

test -e "$target" || {
	echo "FAIL: $target is not there" >&2
	exit 1
}

# Credentials, in the order that leaves the secret in the fewest places.
#
# A keychain profile is the one to want: the password is handed to
# `xcrun notarytool store-credentials` once and never appears in a command
# line, an environment or a shell history again. The variables are the fallback
# for a machine where storing it is not an option, a CI runner most likely.
if [ -n "${NOTARY_PROFILE:-}" ]; then
	set -- --keychain-profile "$NOTARY_PROFILE"
else
	: "${APPLE_ID:?set NOTARY_PROFILE, or APPLE_ID to the Apple ID the membership is under}"
	: "${APPLE_TEAM_ID:?set APPLE_TEAM_ID to the ten-character team identifier}"
	: "${APPLE_APP_SPECIFIC_PASSWORD:?set APPLE_APP_SPECIFIC_PASSWORD to an app-specific password from appleid.apple.com, not the account password}"

	set -- --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" \
		--password "$APPLE_APP_SPECIFIC_PASSWORD"
fi

# A bundle cannot be uploaded as it is: notarytool takes a single file, and a
# .app is a directory. ditto is used rather than zip because it is the one that
# preserves the symlinks and the extended attributes a signature is made of --
# zip quietly breaks the signature it is supposed to be carrying.
submission="$target"
scratch=""

case "$target" in
*.app)
	scratch="$(mktemp -d)"
	trap 'rm -rf "$scratch"' EXIT
	submission="$scratch/$(basename "$target").zip"
	ditto -c -k --keepParent "$target" "$submission"
	;;
esac

echo "==> notarizing $(basename "$target")"

# --wait because there is nothing useful to do in the meantime, and because a
# release that carried on without the answer would staple nothing and ship a
# file that warns on the other side.
xcrun notarytool submit "$submission" "$@" --wait

# Stapled to the real thing, never to the zip: the zip was only ever a way to
# post it.
xcrun stapler staple "$target"
xcrun stapler validate "$target"

echo "==> stapled $(basename "$target")"
