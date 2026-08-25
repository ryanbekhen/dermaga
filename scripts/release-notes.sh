#!/bin/sh
# Builds release notes from the commits between the previous tag and this one.
#
# GitHub's own --generate-notes reads pull requests, and this project commits
# straight to main, so it produces an empty list. This reads the commits instead
# and groups them by their conventional-commit prefix.
#
#   usage: scripts/release-notes.sh v1.1.0
set -eu

# `--who` asks only who wrote it, one handle per line, and is how the release
# entry in CHANGELOG.md gets the same answer without the notes around it.
only_who=false
if [ "${1:-}" = "--who" ]; then
	only_who=true
	shift
fi

tag="${1:?usage: release-notes.sh [--who] <tag>}"

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
#
# Told apart by the handle rather than by an address, so it holds however many
# machines and addresses somebody commits from: they all belong to one account,
# and the account is what is asked about.
owner=${repo%%/*}

# email<tab>who, filled as authors are met. Two calls for a release with two
# outside contributors in it, rather than one per commit.
known=$(mktemp)
thanked=$(mktemp)
trap 'rm -f "$known" "$thanked"' EXIT

# Who wrote a commit, as a GitHub handle -- or nothing.
#
# A handle and not a name, because a name in a release note is a string and a
# handle is a person: it links, it is what they are called in the issue they
# opened, and it is the same in every release. Where one cannot be had, the
# line simply carries no name. Saying "by Muh Ihsan Nur" in one release and
# "@canks69" in the next is worse than saying it once, properly.
#
# Two ways. A no-reply address carries the handle in it and needs nothing;
# otherwise GitHub knows which account a commit belongs to, and is asked, once
# per author rather than once per commit. `make publish` cannot run without
# `gh` anyway, so the release itself is never the run that comes up empty --
# only a preview asked for with no network, which says so by naming nobody.
who() {
	email="$1"
	sha="$2"

	cached=$(grep -F "$email	" "$known" 2>/dev/null | head -1 | cut -f2) || true
	if [ -n "${cached:-}" ]; then
		# `-` is a question already asked and answered with nothing, which is
		# not the same as one nobody has asked yet.
		[ "$cached" = "-" ] || printf '%s' "$cached"
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

		# Checked against what a handle can be, not merely against being empty.
		# A commit GitHub has never seen -- one made here and not pushed yet,
		# which is every commit while a release is being prepared -- comes back
		# as a refusal printed where the answer would have been, and "@{"
		# message": "No commit found for SHA" ...}" is not a person.
		case "$login" in
		'' | null) ;;
		*[!A-Za-z0-9-]*) ;;
		*) handle="@$login" ;;
		esac
	fi

	if [ -z "$handle" ]; then
		printf '%s\t-\n' "$email" >>"$known"
		return 0
	fi

	printf '%s\t%s\n' "$email" "$handle" >>"$known"
	printf '%s' "$handle"
}

# One `hash<tab>subject<tab>credit` per line, newest first, merges left out.
# The credit is its own field and empty for the maintainer's own commits.
#
# Its own field, and set after the hash rather than after the sentence, because
# a subject is a sentence and a name on the end of one joins it: "say what will
# be made by @canks69" reads as a claim about what was made.
log=$(git log --no-merges --format='%h%x09%ae%x09%s' "$range" |
	while IFS='	' read -r hash email subject; do
		credit=$(who "$email" "$hash")

		if [ -z "$credit" ]; then
			printf '%s\t%s\t\n' "$hash" "$subject"
			continue
		fi

		# Everybody who wrote any of it is named once, at the end -- the
		# maintainer as much as anybody. A release is the list of who worked on
		# it, and leaving out the person who did most of the work is a strange
		# way to write one.
		grep -qxF "$credit" "$thanked" 2>/dev/null || printf '%s\n' "$credit" >>"$thanked"

		# Against a line, though, only somebody from outside the project.
		# Otherwise a release where the maintainer wrote most of it is a wall
		# of the same handle, and the point of a name against a line is that it
		# says something the lines around it do not.
		if [ "$credit" = "@$owner" ]; then
			printf '%s\t%s\t\n' "$hash" "$subject"
			continue
		fi

		printf '%s\t%s\t — %s\n' "$hash" "$subject" "$credit"
	done)

# Everybody who worked on it, as a sentence's worth of names.
#
# Twenty-five, then a count. A list this long is read to find one name in it,
# and past a couple of dozen it stops being a list and becomes a paragraph
# nobody finishes -- while the number says what the rest of it was there to
# say. Alphabetical, so who is named does not depend on who happened to commit
# first.
credited() {
	total=$(sort -u "$thanked" | wc -l | tr -d ' ')
	[ "$total" -gt 0 ] || return 0

	if [ "$total" -le 25 ]; then
		sort -u "$thanked" | paste -sd, - | sed -E 's/,/, /g; s/, ([^,]*)$/ and \1/'
		return 0
	fi

	printf '%s and %d more\n' \
		"$(sort -u "$thanked" | head -25 | paste -sd, - | sed -E 's/,/, /g')" \
		"$((total - 25))"
}

if [ "$only_who" = true ]; then
	credited

	exit 0
fi

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

# Everybody who worked on it, said once. "Contributors" and not "Thanks",
# because the maintainer is in this list too and a release does not thank
# itself: this is who wrote the version, which is a fact about it rather than
# a courtesy.
names=$(credited)
if [ -n "$names" ]; then
	printf '### Contributors\n\n'
	printf 'This release carries work from %s.\n\n' "$names"
fi

if [ -n "$repo" ] && [ -n "$prev" ]; then
	printf '**Full Changelog**: https://github.com/%s/compare/%s...%s\n' "$repo" "$prev" "$tag"
fi
