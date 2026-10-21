#!/usr/bin/env python3
# Market Radar - package builder v1.7.0 (2026-10-15)
"""
Writes two things from the files that are actually on disk:
  1. _MANIFEST.md                          every file, its role, version, what is tested, size and a SHA-256 fingerprint
  2. market-radar-v1.7.0-ALL-FILES.zip     every file with folders kept, START_HERE.md first

Run it after the tests pass (from anywhere):   python tools/market-radar-build-package.py
It STOPS (nothing is written) if a listed file is missing, a current file does not carry the right version in its
header, START_HERE.md mentions a file that is not in the package, or a stray file would be left out unnoticed.
"""
import hashlib
import os
import re
import sys
import time
import zipfile

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VERSION = '1.7.0'
DATE = os.environ.get('MR_DATE') or time.strftime('%Y-%m-%d')
ZIP_NAME = 'market-radar-v%s-ALL-FILES.zip' % VERSION
PREFIX = 'market-radar-v%s/' % VERSION

# (path, where it goes, status, what is tested, header must carry the version?)
FILES = [
    ('START_HERE.md', 'read first', 'DONE', 'every file it names is checked to exist in this package', True),
    ('market-radar.html', 'UPLOAD to GitHub', 'DONE', 'browser suite 26 (real Chromium); NOT run against your live site/stylesheet', True),
    ('market-radar.js', 'UPLOAD to GitHub', 'DONE', 'browser suite 26; syntax-checked', True),
    ('market-radar-engine.js', 'UPLOAD to GitHub', 'DONE', 'unit 35 + browser suite + builder contract', True),
    ('market-radar-proxy-worker.js', 'PASTE into Cloudflare', 'DONE', 'Worker 14 (real code, mocked upstreams) + browser suite; NOT yet on real Cloudflare', True),
    ('tools/market-radar-build-overture.py', 'RUN on your PC (optional)', 'DONE', 'builder tests 12; never run against live Overture data', True),
    ('MARKET_RADAR_SETUP_AND_GLOSSARY.md', 'KEEP (reference)', 'DONE', 'on-screen wording checked against the code', True),
    ('MARKET_RADAR_HANDOFF.md', 'KEEP (give to a new AI session)', 'DONE', 'generated from the code + narrative claims checked against the code', True),
    ('market-radar-settings-reference.xlsx', 'KEEP (reference)', 'DONE', 'generated from the code; 0 formula errors', False),
    ('MARKET_RADAR_HISTORY.md', 'KEEP (archive, ends at v1.6.2)', 'ARCHIVE', 'v1.6.2 guide kept verbatim - not out of date, it is an archive', False),
    ('_MANIFEST.md', 'KEEP (file list)', 'GENERATED', 'written by tools/market-radar-build-package.py', False),
    ('tools/market-radar-build-settings.py', 'developer / AI', 'DONE', 'ran; workbook recalculated', True),
    ('tools/market-radar-build-handoff.py', 'developer / AI', 'DONE', 'ran; fails if a generated fact is missing from the code', True),
    ('tools/market-radar-build-package.py', 'developer / AI', 'DONE', 'ran; this manifest and the zip come from it', True),
    ('tests/run-all.sh', 'developer / AI', 'DONE', 'proven to fail when any suite fails (negative test)', False),
    ('tests/engine.test.cjs', 'developer / AI', 'DONE', '35 pass', False),
    ('tests/worker.test.mjs', 'developer / AI', 'DONE', '14 pass', False),
    ('tests/overture-builder.test.py', 'developer / AI', 'DONE', '12 pass', False),
    ('tests/e2e.mjs', 'developer / AI', 'DONE', '26 pass', False),
    ('tests/leaflet-stub.js', 'developer / AI', 'DONE', 'support file for e2e', False),
    ('tests/_worker.mjs', 'developer / AI', 'GENERATED', 'copy of the Worker (suites refuse a stale copy); refreshed by run-all.sh', False),
    ('archive-v1.6.2/market-radar-v1.6.2.html', 'OLD - rollback only', 'OLD (v1.6.2)', 'not maintained', False),
    ('archive-v1.6.2/market-radar-v1.6.2.js', 'OLD - rollback only', 'OLD (v1.6.2)', 'not maintained', False),
    ('archive-v1.6.2/MARKET_RADAR_HANDOFF-v1.6.2.md', 'OLD - rollback only', 'OLD (v1.6.2)', 'not maintained', False),
    ('archive-v1.6.2/MARKET_RADAR_SETUP_AND_GLOSSARY-v1.6.2.md', 'OLD - rollback only', 'OLD (v1.6.2)', 'not maintained', False),
    ('archive-v1.6.2/market-radar-settings-reference-v1.6.2.xlsx', 'OLD - rollback only', 'OLD (v1.6.2)', 'not maintained', False),
]
EXCLUDED_DIRS = ('tests/shots/',)          # screenshots made by the browser suite: regenerated, not packaged


def fail(msg):
    raise SystemExit('PACKAGE NOT WRITTEN: ' + msg)


def sha12(path):
    with open(path, 'rb') as fh:
        return hashlib.sha256(fh.read()).hexdigest()[:12]


def check():
    paths = [f[0] for f in FILES]
    for p in paths:
        if not os.path.isfile(os.path.join(ROOT, p)) and p != '_MANIFEST.md':
            fail('listed file is missing: ' + p)
    for p, _, _, _, must in FILES:
        if must and p != '_MANIFEST.md':
            head = open(os.path.join(ROOT, p), encoding='utf-8', errors='ignore').read(900)
            if ('v' + VERSION) not in head and VERSION not in head:
                fail('%s does not carry version %s in its header' % (p, VERSION))
    # stray files: anything on disk that is neither listed nor deliberately excluded nor a package output
    listed = set(paths) | {ZIP_NAME}
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d != '__pycache__']
        for fn in filenames:
            rel = os.path.relpath(os.path.join(dirpath, fn), ROOT).replace(os.sep, '/')
            if rel in listed or any(rel.startswith(x) for x in EXCLUDED_DIRS):
                continue
            fail('file on disk is not in the package list (add it to FILES or delete it): ' + rel)
    # START_HERE.md may only name files that exist in the package
    text = open(os.path.join(ROOT, 'START_HERE.md'), encoding='utf-8').read()
    text = re.sub(r'```.*?```', '', text, flags=re.S)
    for tok in set(re.findall(r'`([A-Za-z0-9_./\-]+\.(?:html|js|py|md|xlsx|zip|sh|mjs|cjs|json))`', text)):
        if tok in listed or tok.startswith('market-radar-data/') or tok == ZIP_NAME:
            continue
        if any(p.endswith('/' + tok) or p == tok for p in paths):
            continue
        fail('START_HERE.md mentions a file that is not in the package: ' + tok)


def write_manifest():
    rows = ['# Market Radar - _MANIFEST (v%s, %s)' % (VERSION, DATE), '',
            'This is the file list of **%s** (the ZIP keeps these folders). The 12-character fingerprint is the start of each file\'s SHA-256: '
            'if a file you hold has a different fingerprint, it is not this release. Tests: **87 automated tests** (engine 35, Worker 14, Overture builder 12, real-browser 26); run `sh tests/run-all.sh`.' % ZIP_NAME, '',
            '| File | Where it goes | Version | Status | What is tested | Size (bytes) | Fingerprint |', '|---|---|---|---|---|---|---|']
    for p, where, status, tested, _ in FILES:
        if p == '_MANIFEST.md':
            ver, size, fp = VERSION, '-', '(this file)'
        else:
            full = os.path.join(ROOT, p)
            head = open(full, encoding='utf-8', errors='ignore').read(900) if p.split('.')[-1] not in ('xlsx',) else ''
            m = re.search(r'v(\d+\.\d+\.\d+)', head)
            ver = 'v1.6.2 (old)' if p.startswith('archive-') else ('archive (ends v1.6.2)' if p == 'MARKET_RADAR_HISTORY.md' else (m.group(1) if m else VERSION if p.endswith('.xlsx') else '-'))
            size, fp = format(os.path.getsize(full), ','), '`%s`' % sha12(full)
        rows.append('| `%s` | %s | %s | %s | %s | %s | %s |' % (p, where, ver, status, tested, size, fp))
    rows += ['', '**Not built yet (your step):** `market-radar-data/overture-<town>.json` - run `python tools/market-radar-build-overture.py --town all` on your PC, then upload the folder. Until then the page uses OpenStreetMap only and says so.', '',
             '**Not verified live (the build environment had no internet):** Overpass, Overture download, OpenRouteService, DOSM, Gemini, Geoapify, your real site stylesheet, real phones. The smoke tests are in `MARKET_RADAR_SETUP_AND_GLOSSARY.md`, section 6.']
    with open(os.path.join(ROOT, '_MANIFEST.md'), 'w', encoding='utf-8', newline='\n') as fh:
        fh.write('\n'.join(rows) + '\n')


def write_zip():
    out = os.path.join(ROOT, ZIP_NAME)
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zf:
        for p, *_ in FILES:                                   # START_HERE.md is first in the list
            with open(os.path.join(ROOT, p), 'rb') as fh:
                data = fh.read()
            info = zipfile.ZipInfo(PREFIX + p, date_time=(2026, 10, 15, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            zf.writestr(info, data)
    return out


if __name__ == '__main__':
    open(os.path.join(ROOT, '_MANIFEST.md'), 'a').close() if not os.path.exists(os.path.join(ROOT, '_MANIFEST.md')) else None
    check()
    write_manifest()
    z = write_zip()
    with zipfile.ZipFile(z) as zf:
        bad = zf.testzip()
        n = len(zf.namelist())
    if bad:
        fail('zip is corrupt at ' + bad)
    print('wrote _MANIFEST.md and %s (%d files, %d KB)' % (ZIP_NAME, n, os.path.getsize(z) // 1024))
