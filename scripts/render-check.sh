#!/usr/bin/env bash
# Render a source/distribution page. A fresh screenshot is required for success.
set -euo pipefail
FILE="$1"; PARAMS="${2:-}"; OUT="${3:-/tmp/render-check.png}"
DIR=$(cd "$(dirname "$FILE")" && pwd)
NAME=$(basename "$FILE")
CHROME="${CHROME_BIN:-}"
if [ -z "$CHROME" ]; then
  if command -v google-chrome >/dev/null 2>&1; then CHROME=$(command -v google-chrome)
  elif [ -x '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' ]; then CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  else echo 'Chrome not found; set CHROME_BIN.' >&2; exit 1; fi
fi
CHECK_DIR=$(mktemp -d)
SRV=''
cleanup() { if [ -n "$SRV" ]; then kill "$SRV" 2>/dev/null || true; wait "$SRV" 2>/dev/null || true; fi; rm -rf "$CHECK_DIR"; }
trap cleanup EXIT
# Bind an OS-selected port and report it only after the server owns the socket.
python3 - "$DIR" "$CHECK_DIR/port" <<'PY' &
import functools, http.server, sys
handler=functools.partial(http.server.SimpleHTTPRequestHandler,directory=sys.argv[1])
with http.server.ThreadingHTTPServer(('127.0.0.1',0),handler) as server:
    with open(sys.argv[2],'w') as f: f.write(str(server.server_port))
    server.serve_forever()
PY
SRV=$!
for i in {1..50}; do [ ! -s "$CHECK_DIR/port" ] || break; kill -0 "$SRV" 2>/dev/null || exit 1; sleep .1; done
[ -s "$CHECK_DIR/port" ] || { echo 'Server did not start' >&2; exit 1; }
PORT=$(cat "$CHECK_DIR/port")
# macOS Chrome may remain alive after writing the screenshot. Own and stop only
# this isolated process group after a complete PNG, with a bounded timeout.
python3 - "$CHROME" "$CHECK_DIR" "http://127.0.0.1:$PORT/$NAME$PARAMS" <<'PY_RENDER'
import os, pathlib, signal, subprocess, sys, time
chrome, folder, url=sys.argv[1:]
folder=pathlib.Path(folder)
png=folder/'render.png'
args=[chrome,'--headless=new','--disable-gpu','--no-first-run',
      '--disable-background-networking','--disable-component-update',
      '--user-data-dir='+str(folder/'profile'),'--enable-logging=stderr','--v=0',
      '--window-size=1920,1080','--hide-scrollbars','--screenshot='+str(png),
      url,'--virtual-time-budget=4000']
with (folder/'chrome.log').open('w') as log:
    proc=subprocess.Popen(args,stderr=log,start_new_session=True)
    try:
        deadline=time.monotonic()+30
        while time.monotonic()<deadline:
            if png.exists() and png.read_bytes().endswith(b'\x00\x00\x00\x00IEND\xaeB`\x82'):
                break
            if proc.poll() is not None:
                raise SystemExit('Chrome exited without a complete screenshot')
            time.sleep(.1)
        else:
            raise SystemExit('Chrome render timed out')
    finally:
        try: os.killpg(proc.pid,signal.SIGTERM)
        except ProcessLookupError: pass
        try: proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid,signal.SIGKILL)
            proc.wait()
PY_RENDER

if grep -qi 'Uncaught' "$CHECK_DIR/chrome.log"; then
  grep -i 'Uncaught' "$CHECK_DIR/chrome.log"; exit 1
fi
[ -s "$CHECK_DIR/render.png" ] || { echo 'Chrome did not produce a screenshot' >&2; exit 1; }
cp "$CHECK_DIR/render.png" "$OUT"
echo 'NO_CONSOLE_ERRORS'
echo "SCREENSHOT: $OUT — inspect visually"
