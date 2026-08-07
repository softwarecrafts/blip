#!/usr/bin/env bash
#
# Download the bliptracker brand faces into extension/fonts/ and landing/fonts/.
#
# Both surfaces bundle their own copies. The extension has no choice — it
# cannot reach the Google Fonts CDN. The landing page bundles them by choice:
# a page whose whole pitch is "no server, no analytics, nothing leaves your
# browser" should not hand every visitor's IP to a third-party CDN before it
# renders a word. Bundling also drops two connection setups off the critical
# path, since cache partitioning means a CDN copy is re-downloaded per-site
# anyway.
#
# This script exists for provenance and reproducibility — the .woff2 files are
# committed, so you do NOT need to run it to build or load anything. Re-run it
# only to refresh or add a face.
#
# It asks the Google Fonts CSS API for one face at a time and pulls the woff2
# from the @font-face block whose unicode-range covers latin (U+0000-00FF),
# rather than hardcoding hashed URLs that rotate.
#
# Usage:  bash scripts/fetch-fonts.sh
set -euo pipefail

# A modern desktop UA is required — the CSS API serves ttf to unknown clients.
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/extension/fonts"
mkdir -p "$DEST"

# family_query  weight  style  outfile
fetch_face() {
  local family=$1 weight=$2 style=$3 out=$4
  local ital=0
  [ "$style" = italic ] && ital=1
  local url="https://fonts.googleapis.com/css2?family=${family}:ital,wght@${ital},${weight}&display=swap"

  local css src
  css=$(curl -sfL -A "$UA" "$url")
  src=$(printf '%s\n' "$css" \
    | awk -v RS='}' '/U\+0000-00FF/ { print }' \
    | grep -o 'https://[^)]*\.woff2' \
    | head -1)

  if [ -z "$src" ]; then
    echo "FAILED: no latin woff2 found for ${family} ${weight} ${style}" >&2
    exit 1
  fi

  curl -sfL -o "${DEST}/${out}" "$src"
  printf '%-34s <- %s\n' "$out" "$src"
}

fetch_face 'Chakra+Petch'   600 normal chakra-petch-600.woff2
fetch_face 'Chakra+Petch'   600 italic chakra-petch-600-italic.woff2
fetch_face 'Chakra+Petch'   700 normal chakra-petch-700.woff2
fetch_face 'Hanken+Grotesk' 400 normal hanken-grotesk-400.woff2
fetch_face 'Hanken+Grotesk' 400 italic hanken-grotesk-400-italic.woff2
fetch_face 'Hanken+Grotesk' 600 normal hanken-grotesk-600.woff2
fetch_face 'JetBrains+Mono' 400 normal jetbrains-mono-400.woff2
fetch_face 'JetBrains+Mono' 700 normal jetbrains-mono-700.woff2

# All three families are OFL-1.1; shipping the fonts obliges shipping this.
fetch_ofl() {
  curl -sfL -o "${DEST}/OFL-$2.txt" \
    "https://raw.githubusercontent.com/google/fonts/main/ofl/$1/OFL.txt"
  printf '%-34s <- google/fonts/ofl/%s\n' "OFL-$2.txt" "$1"
}

fetch_ofl chakrapetch   Chakra-Petch
fetch_ofl hankengrotesk Hanken-Grotesk
fetch_ofl jetbrainsmono JetBrains-Mono

echo
echo "Done. ${DEST}"
ls -lh "$DEST"

# ── landing/fonts ─────────────────────────────────────────────────────────
# The landing page uses a wider set of weights than the extension pages do.
# This list is derived from the faces actually resolved on the rendered page,
# not from guesswork: Chakra Petch 500/600/700 + 600 italic, Hanken Grotesk
# 400/500/600/700 + 400 italic, JetBrains Mono 400/500/700. Weights the page
# asks for but this list omits (Chakra 400, Mono 600) synthesise from the
# nearest face, exactly as they did when the CDN served them.
echo
DEST="$ROOT/landing/fonts"
mkdir -p "$DEST"

fetch_face 'Chakra+Petch'   500 normal chakra-petch-500.woff2
fetch_face 'Chakra+Petch'   600 normal chakra-petch-600.woff2
fetch_face 'Chakra+Petch'   600 italic chakra-petch-600-italic.woff2
fetch_face 'Chakra+Petch'   700 normal chakra-petch-700.woff2
fetch_face 'Hanken+Grotesk' 400 normal hanken-grotesk-400.woff2
fetch_face 'Hanken+Grotesk' 400 italic hanken-grotesk-400-italic.woff2
fetch_face 'Hanken+Grotesk' 500 normal hanken-grotesk-500.woff2
fetch_face 'Hanken+Grotesk' 600 normal hanken-grotesk-600.woff2
fetch_face 'Hanken+Grotesk' 700 normal hanken-grotesk-700.woff2
fetch_face 'JetBrains+Mono' 400 normal jetbrains-mono-400.woff2
fetch_face 'JetBrains+Mono' 500 normal jetbrains-mono-500.woff2
fetch_face 'JetBrains+Mono' 700 normal jetbrains-mono-700.woff2

fetch_ofl chakrapetch   Chakra-Petch
fetch_ofl hankengrotesk Hanken-Grotesk
fetch_ofl jetbrainsmono JetBrains-Mono

echo
echo "Done. ${DEST}"
ls -lh "$DEST"
