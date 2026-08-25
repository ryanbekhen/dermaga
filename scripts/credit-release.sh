#!/bin/sh
# Writes who worked on a release into its entry in CHANGELOG.md.
#
# The changelog is the record a person reads, and until now it said what
# changed without ever saying who by. The names are in the git history, which
# is not somewhere anybody reads a release from.
#
# Run before the release is tagged, so the line travels with everything else:
# the tag, the generated list the app's What's new page is built from, and the
# release notes on GitHub, which say the same thing in their own place.
#
# Nothing happens where there is nobody outside the project to name -- most
# releases -- and running it twice replaces the line rather than adding a
# second one.
#
#   usage: scripts/credit-release.sh v1.12.0
set -eu

tag="${1:?usage: credit-release.sh <tag>}"
here=$(dirname "$0")
changelog="$here/../CHANGELOG.md"

[ -f "$changelog" ] || { echo "no CHANGELOG.md beside $0"; exit 1; }

# The same answer the release notes give, said the same way, from the same
# place -- names, order and the point at which a list becomes a count are all
# decided once, over there.
who=$(sh "$here/release-notes.sh" --who "$tag")

# Written in front of the first thing under the version, which is where a
# reader is already looking.
sentence=""
[ -n "$who" ] && sentence="This release carries work from $who."

if ! grep -q "^## \[$tag\]" "$changelog"; then
	echo "credit: no $tag entry in CHANGELOG.md yet, so nobody was named in it"
	exit 0
fi

# The marker is the sentence's own opening, so a line written by an earlier run
# is found and replaced rather than joined.
temp="$changelog.tmp"
trap 'rm -f "$temp"' EXIT

awk -v tag="$tag" -v sentence="$sentence" '
	BEGIN { state = 0 }

	state == 0 {
		print
		if (index($0, "## [" tag "]") == 1) state = 1
		next
	}

	# Between the heading and whatever it says first: the blank line, and a
	# line an earlier run left, are both ours to replace.
	state == 1 {
		if ($0 == "") next
		if (index($0, "This release carries work from ") == 1) next

		if (sentence != "") { print ""; print sentence }
		print ""
		print $0
		state = 2
		next
	}

	{ print }

	# A version with nothing under it yet still gets the line.
	END {
		if (state == 1 && sentence != "") { print ""; print sentence }
	}
' "$changelog" >"$temp"

mv "$temp" "$changelog"

if [ -n "$sentence" ]; then
	echo "credit: $tag — $sentence"
else
	echo "credit: $tag had no contributors from outside the project"
fi
