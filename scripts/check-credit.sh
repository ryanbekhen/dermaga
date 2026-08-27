#!/bin/sh
# Refuses a build whose What's new page cannot say who wrote this release.
#
# The credit is written into CHANGELOG.md before the tag, turned into
# desktop/src/generated/changelog.json, and bundled into the frontend the app
# embeds. Three steps, each of which used to fail quietly: v1.13.0 shipped with
# no names because the first one could not reach GitHub and said nothing about
# it, and nothing downstream was in a position to notice.
#
# This is the end of that chain, checked at the end. Not "was the line written"
# but "is it in the thing about to be handed to somebody" -- which is the only
# question that was ever being asked.
#
#   usage: scripts/check-credit.sh <assets-dir> <version>
set -eu

assets="${1:?usage: check-credit.sh <assets-dir> <version>}"
version="${2:?usage: check-credit.sh <assets-dir> <version>}"

[ -d "$assets" ] || { echo "FAIL: no built frontend at $assets"; exit 1; }

# Nothing to check against before the first release, and nothing to check on a
# build that is not one.
case "$version" in
0.0.0 | '') echo "check-credit: no version to check"; exit 0 ;;
esac

if ! grep -rq "This release carries work from " "$assets" 2>/dev/null; then
	echo "FAIL: the built frontend carries no credit for any release."
	echo "      CHANGELOG.md is where it starts and \`make changelog\` carries it"
	echo "      forward; one of the two did not happen before this was built." >&2
	exit 1
fi

# The line for *this* release, not merely some release. A stale bundle carries
# the last one's names perfectly well, which is exactly how this goes unnoticed.
if ! grep -rq "v$version" "$assets" 2>/dev/null; then
	echo "FAIL: the built frontend does not mention v$version at all."
	echo "      It was built before the changelog was, so What's new will open on" >&2
	echo "      the release before this one." >&2
	exit 1
fi

echo "check-credit: v$version is in the bundle, with its names"
