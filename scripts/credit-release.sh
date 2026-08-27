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
# Running it twice replaces the line rather than adding a second one.
#
# It refuses rather than shrugs. Working out who wrote a commit needs GitHub,
# and without it the answer to "who worked on this" is not "nobody" -- it is "I
# could not find out". Those two look identical in a changelog, and v1.13.0
# went out with no names on exactly that: the step ran, could not ask, said
# nothing, and the release carried on. A release is the one moment where not
# knowing must stop the line rather than quietly become an answer.
#
#   usage: scripts/credit-release.sh v1.12.0
set -eu

tag="${1:?usage: credit-release.sh <tag>}"
here=$(dirname "$0")
changelog="$here/../CHANGELOG.md"

[ -f "$changelog" ] || { echo "no CHANGELOG.md beside $0"; exit 1; }

# Checked before asking, because the asking cannot report its own failure: a
# handle that could not be looked up and an author who has none both come back
# as nothing.
command -v gh >/dev/null 2>&1 || {
	echo "credit: gh is not installed, so nobody can be named. Install it, or run"
	echo "        the release again once it is there." >&2
	exit 1
}

gh auth status >/dev/null 2>&1 || {
	echo "credit: gh is installed but not logged in, so nobody can be named."
	echo "        Run \`gh auth login\` and try again." >&2
	exit 1
}

# The same answer the release notes give, said the same way, from the same
# place -- names, order and the point at which a list becomes a count are all
# decided once, over there.
#
# Exit 3 means it answered, but not for everybody: at least one author it could
# not put a handle to. The names it did find are still on stdout, and are still
# printed below, because a person deciding what to do about this wants to see
# what the line would have said.
set +e
who=$(sh "$here/release-notes.sh" --who "$tag")
asked=$?
set -e

if [ "$asked" = 3 ]; then
	if [ "${CREDIT_ALLOW_UNKNOWN:-}" = 1 ]; then
		echo "credit: going ahead without the authors listed above (CREDIT_ALLOW_UNKNOWN=1)"
	else
		echo "credit: $tag would have said \"$who\", leaving out the authors above."
		echo "        A name quietly missing reads exactly like a release that person"
		echo "        did not work on. Push the commits so GitHub knows them, or set"
		echo "        CREDIT_ALLOW_UNKNOWN=1 to release without them." >&2
		exit 1
	fi
elif [ "$asked" != 0 ]; then
	echo "credit: could not work out who wrote $tag" >&2
	exit 1
fi

# Every release has an author. An empty answer here is not a release nobody
# wrote -- it is a question that did not get through, most likely because the
# commits are still only on this machine and GitHub has never seen them.
[ -n "$who" ] || {
	echo "credit: nobody could be named for $tag."
	echo "        Every release has an author, so this is a lookup that failed rather"
	echo "        than an answer. The usual cause is commits that are not pushed yet:"
	echo "        GitHub is asked who wrote each one, and it cannot answer for a commit"
	echo "        it has never seen. Push them, then release." >&2
	exit 1
}

# Written in front of the first thing under the version, which is where a
# reader is already looking.
sentence=""
[ -n "$who" ] && sentence="This release carries work from $who."

# The other way a release used to go out uncredited. `make release` writes the
# entry before it gets here, so a missing one is not "too early to name
# anybody" -- it is a release about to be cut with nothing written about it.
if ! grep -q "^## \[$tag\]" "$changelog"; then
	echo "credit: there is no $tag entry in CHANGELOG.md."
	echo "        Write what the release means first; this only adds the names to it." >&2
	exit 1
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

echo "credit: $tag — $sentence"
