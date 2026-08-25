#!/bin/sh
# Builds release notes from the commits between the previous tag and this one.
#
# GitHub's own --generate-notes reads pull requests, and this project commits
# straight to main, so it produces an empty list. This reads the commits instead
# and groups them by their conventional-commit prefix.
#
#   usage: scripts/release-notes.sh v1.1.0
set -eu

tag="${1:?usage: release-notes.sh <tag>}"

# Works before the tag exists, so the notes can be read before cutting the
# release they describe: an unknown tag means "everything since the last one".
if git rev-parse -q --verify "$tag^{commit}" >/dev/null 2>&1; then
	head="$tag"
	prev=$(git describe --tags --abbrev=0 "$tag^" 2>/dev/null || true)
else
	head="HEAD"
	prev=$(git describe --tags --abbrev=0 2>/dev/null || true)
fi

if [ -n "$prev" ]; then
	range="$prev..$head"
else
	range="$head"
fi

repo=$(git remote get-url origin 2>/dev/null |
	sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##' || true)

# Whoever the repository belongs to. Their name is left off every line: a
# release where the maintainer wrote most of it reads as a wall of the same
# handle, and the point of naming anybody is that it says something.
owner=${repo%%/*}

# The same person, by the address they commit under.
#
# Read from the last `release:` commit, because releases are cut by the
# maintainer and by nobody else -- so the history says who that is without
# anything having to be configured, and says it with no network. Which matters:
# the handle above is only known once GitHub has been asked, and offline every
# line would otherwise be credited to the person who wrote most of them.
house=$(git log --no-merges --format='%aE' --grep='^release: ' -n 1 "$head" 2>/dev/null || true)

# email<tab>who, filled as authors are met. Two calls for a release with two
# outside contributors in it, rather than one per commit.
known=$(mktemp)
thanked=$(mktemp)
trap 'rm -f "$known" "$thanked"' EXIT

# Who wrote a commit, as a GitHub handle where one can be had.
#
# Three ways, cheapest first. A no-reply address carries the handle in it and
# needs nothing. Otherwise GitHub knows which account a commit belongs to, and
# is asked -- once per author, and only when `gh` is here and signed in.
# Failing both, the name as it was written in the commit: `make notes` is a
# preview somebody runs on a plane, and a release note that says "by canks"
# rather than nothing is the right way to be offline.
who() {
	email="$1"
	name="$2"
	sha="$3"

	cached=$(grep -F "$email	" "$known" 2>/dev/null | head -1 | cut -f2) || true
	if [ -n "${cached:-}" ]; then
		printf '%s' "$cached"
		return 0
	fi

	handle=""
	case "$email" in
	*@users.noreply.github.com)
		handle=${email##*+}
		handle="@${handle%@users.noreply.github.com}"
		;;
	esac

	if [ -z "$handle" ] && [ -n "$repo" ] && command -v gh >/dev/null 2>&1; then
		login=$(gh api "repos/$repo/commits/$sha" --jq '.author.login' 2>/dev/null || true)
		[ -n "$login" ] && [ "$login" != "null" ] && handle="@$login"
	fi

	[ -n "$handle" ] || handle="$name"

	printf '%s\t%s\n' "$email" "$handle" >>"$known"
	printf '%s' "$handle"
}

# One `hash<tab>subject<tab>credit` per line, newest first, merges left out.
# The credit is its own field and empty for the maintainer's own commits.
#
# Its own field, and set after the hash rather than after the sentence, because
# a subject is a sentence and a name on the end of one joins it: "say what will
# be made by @canks69" reads as a claim about what was made.
log=$(git log --no-merges --format='%h%x09%aE%x09%aN%x09%s' "$range" |
	while IFS='	' read -r hash email name subject; do
		# Known before anything is asked, so the maintainer's own commits
		# cost no lookup at all.
		if [ -n "$house" ] && [ "$email" = "$house" ]; then
			printf '%s\t%s\t\n' "$hash" "$subject"
			continue
		fi

		credit=$(who "$email" "$name" "$hash")

		if [ "$credit" = "@$owner" ] || [ "$credit" = "$owner" ]; then
			printf '%s\t%s\t\n' "$hash" "$subject"
			continue
		fi

		printf '%s\t%s\t — %s\n' "$hash" "$subject" "$credit"
		grep -qxF "$credit" "$thanked" 2>/dev/null || printf '%s\n' "$credit" >>"$thanked"
	done)

section() {
	pattern="$1"
	heading="$2"

	body=$(printf '%s\n' "$log" | grep -E "	${pattern}(\([^)]*\))?!?: " || true)
	[ -n "$body" ] || return 0

	printf '### %s\n\n' "$heading"
	printf '%s\n' "$body" |
		sed -E 's/^([0-9a-f]+)\t[a-z]+(\([^)]*\))?!?: (.*)\t(.*)$/- \3 (`\1`)\4/'
	printf '\n'
}

section 'feat' 'Features'
section 'fix' 'Bug fixes'
section 'perf' 'Performance'
section 'docs' 'Documentation'

# Anything left over, minus the release commit itself, which says nothing a
# reader of the release notes does not already know.
rest=$(printf '%s\n' "$log" |
	grep -Ev "	(feat|fix|perf|docs|release)(\([^)]*\))?!?: " || true)

if [ -n "$rest" ]; then
	printf '### Maintenance\n\n'
	printf '%s\n' "$rest" |
		sed -E 's/^([0-9a-f]+)\t([a-z]+(\([^)]*\))?!?: )?(.*)\t(.*)$/- \4 (`\1`)\5/'
	printf '\n'
fi

# Said once at the end as well as against each line. The lines are read by
# somebody deciding whether to update; this is read by the person who wrote it,
# and it is the only place in a release where their name is the subject rather
# than a footnote to a change.
if [ -s "$thanked" ]; then
	printf '### Thanks\n\n'
	printf 'This release carries work from %s.\n\n' "$(
		sort -u "$thanked" | paste -sd, - | sed -E 's/,/, /g; s/, ([^,]*)$/ and \1/'
	)"
fi

if [ -n "$repo" ] && [ -n "$prev" ]; then
	printf '**Full Changelog**: https://github.com/%s/compare/%s...%s\n' "$repo" "$prev" "$tag"
fi
