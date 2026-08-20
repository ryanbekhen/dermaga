#!/bin/sh
# Says what a build is actually good for, and refuses to let it claim more.
#
# An ad-hoc build and a notarized one look identical in Finder and behave
# nothing alike on somebody else's Mac. The difference is worth knowing before
# a release goes out rather than from the first person who downloads it.
#
#   usage: scripts/check-signature.sh <app> <dmg> [--release]
#
# --release makes anything short of Developer ID and notarized a failure. Without
# it an ad-hoc build is reported and allowed: that is what a contributor with no
# Apple membership can build, and it runs perfectly well where it was built.
set -eu

app="${1:?usage: check-signature.sh <app> <dmg> [--release]}"
dmg="${2:?usage: check-signature.sh <app> <dmg> [--release]}"
mode="${3:-}"

authority="$(codesign -dv --verbose=2 "$app" 2>&1 | sed -n 's/^Authority=//p' | head -1)"

case "$authority" in
"Developer ID Application"*) ;;
*)
	if [ "$mode" = "--release" ]; then
		echo "FAIL: this is not a Developer ID build (signed by: ${authority:-nobody})"
		echo "      A release has to be one, or every download is stopped by Gatekeeper"
		echo "      and no notification the app sends is ever delivered."
		exit 1
	fi

	echo "check-signature: ad-hoc -- runs on this Mac, stopped by Gatekeeper on any other"
	exit 0
	;;
esac

# The signature has to cover the nested agent as well as the app around it, and
# --strict is the difference between "there is a signature" and "it is intact".
codesign --verify --strict --verbose=2 "$app" 2>/dev/null || {
	echo "FAIL: the app's signature does not verify"
	exit 1
}

codesign --verify --strict "$app/Contents/Resources/dermaga-agent" 2>/dev/null || {
	echo "FAIL: the agent inside the bundle is not properly signed"
	exit 1
}

codesign -dv --verbose=2 "$app" 2>&1 | grep -q "^TeamIdentifier=[A-Z0-9]" || {
	echo "FAIL: the signature carries no team identifier"
	exit 1
}

# Hardened runtime, which notarizing requires and which cannot be added after
# the fact.
codesign -dv --verbose=2 "$app" 2>&1 | grep -q "flags=.*runtime" || {
	echo "FAIL: the app was signed without the hardened runtime"
	exit 1
}

# Stapled, both of them: the image so it can be handed over on a stick, and the
# app so it still passes once dragged out of the image on a Mac that is offline.
for target in "$app" "$dmg"; do
	xcrun stapler validate "$target" >/dev/null 2>&1 || {
		echo "FAIL: $(basename "$target") carries no notarization ticket"
		echo "      Notarize before packaging: scripts/notarize.sh $target"
		exit 1
	}
done

# The question Gatekeeper itself will ask on the other Mac.
spctl --assess --type exec "$app" >/dev/null 2>&1 || {
	echo "FAIL: Gatekeeper would refuse this app"
	exit 1
}

echo "check-signature: Developer ID, hardened, notarized and stapled"
