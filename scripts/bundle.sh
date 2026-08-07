#!/usr/bin/env bash
#
# Bundle extension/ into a Chrome Web Store upload zip.
#
# This script exists because bliptracker 0.1.1 was built by hand, zipped with
# the extension/ directory still wrapped around it, and silently never shipped.
# The Web Store reads manifest.json from the ROOT of the archive; a nested one
# is rejected with "Manifest file is missing or unreadable." The published
# 0.1.0 zip is flat, 0.1.1 is not, and that one level of nesting is the whole
# difference between a release and a zip file sitting in the repo root.
#
# So this script does not trust itself. It stages, zips, then re-opens the
# finished archive and asserts the things that actually go wrong:
#
#   - manifest.json is at the root, not one level down
#   - the version inside the zip is the version we meant to ship
#   - no .DS_Store / __MACOSX junk rode along
#
# Version comes from extension/manifest.json and nowhere else. The store reads
# the manifest and ignores the filename, so a filename that disagrees with the
# manifest is a lie waiting to confuse a bug report. There is no --version
# flag on purpose: bump the manifest, then run this.
#
# Usage:  bash scripts/bundle.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/extension"
[ -f "$SRC/manifest.json" ] || { echo "no manifest at $SRC/manifest.json" >&2; exit 1; }

# Single source of truth. Fail loudly rather than shipping an empty version.
VERSION="$(node -p "require('$SRC/manifest.json').version")"
[ -n "$VERSION" ] || { echo "could not read version from manifest" >&2; exit 1; }
OUT="$ROOT/bliptracker-$VERSION.zip"

# ---------------------------------------------------------------------------
# What does NOT ship. This is a DENYLIST: everything under extension/ is live
# code and ships by default, so adding lib/foo.js needs no change here.
#
# The choice is deliberate. An allowlist could never ship a stray file, but it
# fails the other way — add a directory, forget to list it, and you get a zip
# that packages cleanly and breaks on load in users' browsers. Note that
# adapters/claude.js imports ../lib/paginate.js, so the directories are not
# independent; an allowlist missing lib/ is a silent runtime break, which is a
# far worse outcome than an extra file in the archive.
#
# The denylist's weakness is stray files, so the patterns below cover the
# obvious editor/OS/secret leavings as well as the two known non-shippers.
# rsync patterns match anywhere in the tree unless anchored with a leading /.
# ---------------------------------------------------------------------------
EXCLUDES=(
  '.DS_Store'         # macOS junk, already gitignored
  'icons/icon.svg'    # source asset; the manifest references only the PNGs
  '.env*'             # never ship secrets
  '*.log'
  '*.swp'             # vim
  '*~'                # editor backups
  '*.orig'            # merge leftovers
  '*.rej'
)

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

rsync_args=(-a)
for pat in "${EXCLUDES[@]}"; do rsync_args+=(--exclude "$pat"); done
# Trailing slash on $SRC/ copies the CONTENTS of extension/, not the directory
# itself. This is the 0.1.1 bug, in one character.
rsync "${rsync_args[@]}" "$SRC/" "$STAGE/"

rm -f "$OUT"
# -X drops macOS extended attributes that otherwise become AppleDouble entries.
( cd "$STAGE" && zip -r -q -X "$OUT" . )

# --- verify the artifact, not our intentions ------------------------------
listing="$(unzip -Z1 "$OUT")"

grep -qx 'manifest.json' <<<"$listing" \
  || { echo "FAIL: manifest.json is not at the zip root" >&2; exit 1; }

zip_version="$(unzip -p "$OUT" manifest.json | node -p 'JSON.parse(require("fs").readFileSync(0,"utf8")).version')"
[ "$zip_version" = "$VERSION" ] \
  || { echo "FAIL: zip has version $zip_version, expected $VERSION" >&2; exit 1; }

if grep -qE '(^|/)(\.DS_Store|__MACOSX)' <<<"$listing"; then
  echo "FAIL: macOS junk in the archive:" >&2
  grep -E '(^|/)(\.DS_Store|__MACOSX)' <<<"$listing" >&2
  exit 1
fi

echo "ok  $OUT"
echo "    version $VERSION · $(wc -l <<<"$listing" | tr -d ' ') entries · $(du -h "$OUT" | cut -f1)"
