#!/usr/bin/env bash
# Build a local release; never uploads to hosting.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
OUT_DIR="${1:-$ROOT/releases}"
mkdir -p "$OUT_DIR"
OUT_DIR=$(cd "$OUT_DIR" && pwd)
SOURCES=(simulation.html sim-core.js scenario-core.js)
PAGES=(index.html "${SOURCES[@]}")

echo 'Version JavaScript URLs'
# Stable content hashes invalidate long-lived browser caches on static hosts.
python3 - <<'PY_ASSETS'
import hashlib, pathlib, re
page = pathlib.Path('simulation.html')
html = page.read_text()
for name in ('sim-core.js', 'scenario-core.js'):
    digest = hashlib.sha256(pathlib.Path(name).read_bytes()).hexdigest()[:16]
    pattern = r'<script src="' + re.escape(name) + r'(?:\?v=[^"<>]*)?"></script>'
    html, count = re.subn(pattern, '<script src="' + name + '?v=' + digest + '"></script>', html)
    if count != 1:
        raise SystemExit('Expected exactly one script reference for ' + name)
if html != page.read_text():
    page.write_text(html)
PY_ASSETS

echo 'Sync distribution'
for f in "${SOURCES[@]}"; do cp "$f" "distr/$f"; done
cp simulation.html distr/index.html

echo 'Core tests'
node --test --test-reporter=tap tests/sim-core.test.js

echo 'Render checks'
for page in index.html simulation.html; do
  bash scripts/render-check.sh "distr/$page" '' "/tmp/release-$page.png"
done

echo 'Verify distribution'
for f in "${SOURCES[@]}"; do cmp "$f" "distr/$f"; done
cmp simulation.html distr/index.html
COMMIT=$(git rev-parse --short HEAD)
DIRTY=''
# Include new source files when identifying a local uncommitted build.
if [ -n "$(git status --porcelain --untracked-files=normal)" ]; then DIRTY='-dirty'; fi
STAMP="$(date -u +%Y-%m-%dT%H:%MZ) commit $COMMIT$DIRTY"
printf 'SM GPU Calc distributive\nbuilt: %s\n' "$STAMP" > distr/VERSION.txt
ZIP="$OUT_DIR/sm-gpu-calc-$COMMIT$DIRTY-$(date -u +%Y%m%d-%H%M%S).zip"
# Explicit allowlist excludes local instructions, data, source notes and credentials.
(cd distr && zip -q "$ZIP" "${PAGES[@]}" VERSION.txt)
echo "DISTRIBUTIVE: $ZIP"
unzip -l "$ZIP"
