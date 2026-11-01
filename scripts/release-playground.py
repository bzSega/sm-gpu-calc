#!/usr/bin/env python3
"""Build the separate, deterministic game ZIP. Never publishes or changes distr/."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent
# Deliberate public allowlist: no directory copies, saves, plans or agent files.
FILES = (
    'LICENSE', 'sim-core.js', 'scenario-core.js',
    'playground/index.html', 'playground/hosting-index.html', 'playground/game.css', 'playground/app.js',
    'playground/session.js', 'playground/startup.js', 'playground/clock.js',
    'playground/presentation.js', 'playground/scene.js', 'playground/lessons.js',
    'playground/README.md', 'playground/assets/README.md',
    'playground/assets/server-room.png', 'playground/assets/workshop.png',
    'playground/assets/orbital.png', 'playground/assets/rack-shell.png',
    'playground/assets/visitor.png', 'playground/assets/answer-correct.wav',
    'playground/assets/answer-wrong.wav',
    'docs/LIVE-SESSION.md', 'docs/UNIFIED-SCENARIO.md',
)
README = '''# AI Startup — standalone educational game

Serve this extracted directory, preserving its layout:

    python3 -m http.server 8030 --bind 127.0.0.1

Open http://127.0.0.1:8030/playground/?lang=ru or ?lang=en.
To host elsewhere, upload this entire directory to a separate path and open
the directory root (the launcher preserves language/query settings) or its
playground/ subdirectory. Replacing an existing calculator needs explicit approval.
No backend, package installation, CDN, analytics or account is required.
Use a current browser with SVG and HTML dialog support. Fullscreen may require
HTTPS or localhost and a user gesture. Browser storage is specific to origin;
download your JSON save before moving to a new address. Imported saves remain
local. No offline catch-up is performed.

This is an educational simulation, not a hardware benchmark or sizing guarantee.
GPU names specify memory presets; speeds and concurrent-sharing curves are
assumptions. No GPU interconnect, prefix caching or chunked prefill is modeled.
See playground/README.md for play, saving, accessibility and limitations;
docs/ contains the shared calculation and live-session contracts.
The art is generated and the audio is locally synthesized; provenance is in
playground/assets/README.md. LICENSE contains the MIT license.

MANIFEST.json records every other file's SHA-256 and byte length. Archives are
byte-reproducible from identical allowlisted sources, independent of timestamps,
untracked files and local planning documents. Build using the source repository's
python3 scripts/release-playground.py command (Python 3 and Node.js).
'''


def build(output):
    tests = sorted(str(p.relative_to(ROOT)) for p in (ROOT / 'tests').glob('*.test.js'))
    subprocess.run(['node', '--test', *tests], cwd=ROOT, check=True)
    data = {name: (ROOT / name).read_bytes() for name in FILES}
    data['index.html'] = data.pop('playground/hosting-index.html')
    # Hash the actual packaged bytes, without editing the working tree.
    html = data['playground/index.html'].decode()
    def version(match):
        url = match[2]
        path = (ROOT / 'playground' / url).resolve().relative_to(ROOT).as_posix()
        if path not in data:
            raise ValueError('HTML dependency absent from allowlist: ' + path)
        digest = hashlib.sha256(data[path]).hexdigest()[:16]
        return match[1] + url + '?v=' + digest + match[3]
    html = re.sub(r'((?:src|href)=")([^"?]+\.(?:js|css))(?:\?v=[^"]*)?(")', version, html)
    data['playground/index.html'] = html.encode()
    data['README.md'] = README.encode()
    entries = {name: {'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest()}
               for name, body in sorted(data.items())}
    source_id = hashlib.sha256(json.dumps(entries, sort_keys=True).encode()).hexdigest()
    data['MANIFEST.json'] = (json.dumps({'format': 'ai-startup-release/1',
        'sourceDigest': source_id, 'files': entries}, indent=2, sort_keys=True) + '\n').encode()
    output.mkdir(parents=True, exist_ok=True)
    archive = output / ('ai-startup-' + source_id[:16] + '.zip')
    with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_STORED) as z:
        for name, body in sorted(data.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            z.writestr(info, body)
    with zipfile.ZipFile(archive) as z:
        assert z.namelist() == sorted(data)
        for name, body in data.items():
            assert z.read(name) == body
    print('ARCHIVE:', archive)
    print('SHA256:', hashlib.sha256(archive.read_bytes()).hexdigest())
    print('FILES:', len(data))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'releases')
    build(parser.parse_args().output.resolve())
