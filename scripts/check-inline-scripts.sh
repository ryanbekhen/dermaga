#!/bin/sh
# Fails if any built HTML carries an inline <script>.
#
# The window serves itself under `default-src 'self'`, which blocks inline
# scripts. An inline <script> therefore does nothing at all once packaged --
# silently, with no error the user or the developer ever sees. Development
# applies no policy, so it works there and only there, which is exactly how the
# splash shipped inert through several releases.
#
#   usage: scripts/check-inline-scripts.sh path/to/dist
set -eu

dist="${1:?usage: check-inline-scripts.sh <dist directory>}"

[ -d "$dist" ] || { echo "FAIL: $dist is not there; build the frontend first"; exit 1; }

found=0

for file in $(find "$dist" -name '*.html'); do
	# An opening <script> followed by anything other than its closing tag. The
	# character class excludes "<" deliberately: without that, `<script
	# src="x"></script>` matches its own closing bracket and every external
	# script is reported as inline.
	if tr '\n' ' ' < "$file" | grep -qE '<script[^>]*>[[:space:]]*[^<[:space:]]'; then
		echo "FAIL: $file has an inline <script>, which the window's CSP blocks"
		found=1
	fi
done

if [ "$found" -eq 1 ]; then
	echo "      Move it to its own file and load it with <script src=\"…\">."
	exit 1
fi

echo "check-inline-scripts: no inline scripts in the build"
