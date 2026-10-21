#!/usr/bin/env python3
# Market Radar - Overture extract builder v1.7.0 (2026-10-13)
"""
Builds market-radar-data/overture-<town>.json: the small per-town file the Market Radar page loads as its
second, independent source of businesses (a cross-check against OpenStreetMap).

Run it on your own PC (Python 3.8+, internet needed). It needs Overture's official command-line tool:

    python -m pip install overturemaps
    python market-radar-build-overture.py --town all

Then upload the four files it writes into your site's  market-radar-data/  folder on GitHub.
Run it again every few months (Overture publishes a new release monthly).

Facts this script relies on (checked against docs.overturemaps.org on 2026-10-13):
  - CLI:  overturemaps download --bbox=W,S,E,N -f geojsonseq --type=place -o <file>
  - Place fields (schema v2): names.primary, taxonomy.primary, basic_category, confidence (0..1),
    operating_status, sources[].dataset.  The old `categories` field is deprecated/removed; it is only
    used here as a fallback if `taxonomy` is missing.
  - https://stac.overturemaps.org/catalog.json has a top-level "latest" release id (used to label the file).
NOT verified live from the build sandbox (no internet there): the CLI's exact JSON nesting. The reader is
therefore tolerant (nested objects OR JSON strings) and the output is checked by tests/overture-builder.test.py
against the real classifier in market-radar-engine.js.
"""
import argparse
import gzip
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

VERSION = '1.7.0'
COLS = ['id', 'lat', 'lng', 'name', 'cat', 'basic', 'conf', 'src']

# Same four towns as TOWNS in market-radar.js (centre point); the file covers centre +/- HALF_SPAN_DEG.
TOWNS = {
    'miri': (4.4148, 113.9917),
    'kuching': (1.5535, 110.3593),
    'sibu': (2.2870, 111.8305),
    'bintulu': (3.1668, 113.0413),
}
HALF_SPAN_DEG = 0.20   # about 22 km each way: covers a 15-minute drive area around any pin in town
MIN_CONF = 0.4         # below the page's own 0.5 cut-off so the page can be loosened later without a rebuild
MIN_ROWS = 50          # refuse to write a file with fewer rows than this (probably a failed download)
ATTRIBUTION = ('Overture Maps Foundation places data (per-record source licences incl. Apache-2.0, '
               'CDLA-Permissive-2.0, CC0-1.0); attribution: https://docs.overturemaps.org/attribution/')


def bbox_for(town, span=HALF_SPAN_DEG):
    lat, lng = TOWNS[town]
    return [round(lng - span, 6), round(lat - span, 6), round(lng + span, 6), round(lat + span, 6)]  # W,S,E,N


def _j(v):
    """Some tools hand nested values over as JSON text; accept both."""
    if isinstance(v, str):
        s = v.strip()
        if s[:1] in ('{', '['):
            try:
                return json.loads(s)
            except ValueError:
                return v
    return v


def feature_to_row(f, min_conf=MIN_CONF):
    """One GeoJSON feature -> ([id, lat, lng, name, cat, basic, conf, src], None) or (None, reason)."""
    if not isinstance(f, dict):
        return None, 'not_feature'
    geom = f.get('geometry') or {}
    if geom.get('type') != 'Point':
        return None, 'not_point'
    try:
        lng, lat = float(geom['coordinates'][0]), float(geom['coordinates'][1])
    except (KeyError, IndexError, TypeError, ValueError):
        return None, 'bad_geometry'
    props = f.get('properties')
    if not isinstance(props, dict):
        props = {k: v for k, v in f.items() if k not in ('type', 'geometry')}
    if props.get('operating_status') == 'permanently_closed':
        return None, 'closed'
    names = _j(props.get('names'))
    name = names.get('primary') if isinstance(names, dict) else (props.get('name') if isinstance(props.get('name'), str) else '')
    name = ' '.join(str(name or '').split())
    if not name:
        return None, 'no_name'
    tax = _j(props.get('taxonomy'))
    cat = tax.get('primary') if isinstance(tax, dict) else ''
    if not cat:
        old = _j(props.get('categories'))          # deprecated field, fallback for older releases only
        cat = old.get('primary') if isinstance(old, dict) else ''
    basic = props.get('basic_category') or ''
    if not cat and not basic:
        return None, 'no_category'
    conf = props.get('confidence')
    conf = round(float(conf), 2) if isinstance(conf, (int, float)) and not isinstance(conf, bool) else None
    if conf is not None and conf < min_conf:
        return None, 'low_conf'
    srcs = _j(props.get('sources'))
    src = str(srcs[0].get('dataset') or '').lower() if isinstance(srcs, list) and srcs and isinstance(srcs[0], dict) else ''
    gid = str(f.get('id') or props.get('id') or '').replace('-', '')[:8]
    return [gid, round(lat, 6), round(lng, 6), name, str(cat or ''), str(basic), conf, src], None


def read_features(path):
    """Yields features from a geojsonseq/ndjson file, or from a plain GeoJSON FeatureCollection."""
    with open(path, 'r', encoding='utf-8') as fh:
        head = fh.read(2048)
        fh.seek(0)
        if head.lstrip().startswith('{"type": "FeatureCollection"') or head.lstrip().startswith('{"type":"FeatureCollection"'):
            try:
                whole = json.load(fh)
                for f in whole.get('features', []):
                    yield f
                return
            except ValueError:
                fh.seek(0)
        for line in fh:
            line = line.replace('\x1e', '').strip()      # RFC 8142 record separator, if present
            if not line:
                continue
            try:
                obj = json.loads(line)
            except ValueError:
                yield None
                continue
            if isinstance(obj, dict) and obj.get('type') == 'FeatureCollection':
                for f in obj.get('features', []):
                    yield f
            else:
                yield obj


def build_extract(town, features, release, bbox, min_conf=MIN_CONF, built=None):
    rows, dropped, total = [], {}, 0
    for f in features:
        total += 1
        row, why = feature_to_row(f, min_conf) if f is not None else (None, 'bad_line')
        if row is None:
            dropped[why] = dropped.get(why, 0) + 1
            continue
        rows.append(row)
    # Sort FIRST (on every column), then make ids unique: the result then never depends on the order the
    # download happened to arrive in, so re-running the builder gives small, readable git diffs.
    rows.sort(key=lambda r: (r[1], r[2], r[3], r[0], r[4], r[5], -1 if r[6] is None else r[6], r[7]))
    seen = set()
    for row in rows:
        base, k = row[0], 1
        while row[0] in seen:                          # 8-char id prefixes can (rarely) collide
            k += 1
            row[0] = '%s-%d' % (base, k)
        seen.add(row[0])
    out = {
        'v': 1, 'release': release, 'built': built or time.strftime('%Y-%m-%d'), 'town': town, 'bbox': bbox,
        'minConf': min_conf, 'attribution': ATTRIBUTION, 'cols': COLS, 'rows': rows,
    }
    return out, {'read': total, 'kept': len(rows), 'dropped': dropped}


def latest_release():
    try:
        with urllib.request.urlopen('https://stac.overturemaps.org/catalog.json', timeout=30) as r:
            return str(json.loads(r.read().decode('utf-8')).get('latest') or '')
    except Exception as e:                              # network off, format changed, ...
        print('  (could not read the latest release id: %s)' % e)
        return ''


def find_cli():
    exe = shutil.which('overturemaps')
    if exe:
        return [exe]
    here = os.path.dirname(sys.executable)
    for cand in (os.path.join(here, 'Scripts', 'overturemaps.exe'), os.path.join(here, 'Scripts', 'overturemaps'), os.path.join(here, 'overturemaps')):
        if os.path.exists(cand):
            return [cand]
    return None


def download(bbox, out_path):
    cli = find_cli()
    if not cli:
        raise SystemExit('Cannot find the "overturemaps" tool.\nInstall it with:   python -m pip install overturemaps\n'
                         'If it is installed but not found, close and reopen your terminal, or add Python\'s Scripts folder to PATH.')
    cmd = cli + ['download', '--bbox=' + ','.join('%.6f' % x for x in bbox), '-f', 'geojsonseq', '--type=place', '-o', out_path]
    print('  running: ' + ' '.join(cmd))
    subprocess.run(cmd, check=True)


def write_json_atomic(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(',', ':'))
    os.replace(tmp, path)


def existing_rows(path):
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            return len(json.load(fh).get('rows', []))
    except Exception:
        return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description='Build the per-town Overture extract used by Market Radar.')
    ap.add_argument('--town', required=True, help='miri | kuching | sibu | bintulu | all')
    ap.add_argument('--out-dir', default='market-radar-data', help='folder to write overture-<town>.json into')
    ap.add_argument('--from-file', help='skip the download and read this geojsonseq/GeoJSON file instead (one town only)')
    ap.add_argument('--release', default='', help='release id to stamp into the file (default: read from Overture STAC)')
    ap.add_argument('--span', type=float, default=HALF_SPAN_DEG, help='half-width of the area in degrees (default %s)' % HALF_SPAN_DEG)
    ap.add_argument('--min-conf', type=float, default=MIN_CONF)
    ap.add_argument('--min-rows', type=int, default=MIN_ROWS, help='refuse to write fewer rows than this (default %d)' % MIN_ROWS)
    ap.add_argument('--force', action='store_true', help='write even if the result looks too small')
    a = ap.parse_args(argv)

    towns = list(TOWNS) if a.town == 'all' else [a.town]
    for t in towns:
        if t not in TOWNS:
            raise SystemExit('Unknown town "%s". Choose one of: %s, all' % (t, ', '.join(TOWNS)))
    if a.from_file and len(towns) != 1:
        raise SystemExit('--from-file works with one --town at a time')
    os.makedirs(a.out_dir, exist_ok=True)

    status = 0
    for t in towns:
        print('== %s ==' % t)
        bbox = bbox_for(t, a.span)
        release = a.release or (latest_release() if not a.from_file else '') or 'unknown'
        tmpdir = None
        try:
            if a.from_file:
                src_path = a.from_file
            else:
                tmpdir = tempfile.mkdtemp(prefix='mr-overture-')
                src_path = os.path.join(tmpdir, t + '.geojsonseq')
                download(bbox, src_path)
                if not a.release:
                    after = latest_release()
                    if after and release != 'unknown' and after != release:
                        print('  WARNING: Overture published a new release while downloading (%s -> %s). Run again to be safe.' % (release, after))
            out, st = build_extract(t, read_features(src_path), release, bbox, a.min_conf)
        finally:
            if tmpdir:
                shutil.rmtree(tmpdir, ignore_errors=True)
        dest = os.path.join(a.out_dir, 'overture-%s.json' % t)
        old = existing_rows(dest)
        print('  read %d features, kept %d, dropped %s' % (st['read'], st['kept'], json.dumps(st['dropped'], sort_keys=True)))
        too_small = st['kept'] < a.min_rows or (old and st['kept'] < 0.5 * old)
        if too_small and not a.force:
            print('  NOT WRITTEN: only %d rows (minimum %d%s). Probably a failed or partial download. Use --force to override.'
                  % (st['kept'], a.min_rows, ', previous file had %d' % old if old else ''))
            status = 2
            continue
        write_json_atomic(dest, out)
        size = os.path.getsize(dest)
        with open(dest, 'rb') as fh:
            gz = len(gzip.compress(fh.read(), 6))
        print('  wrote %s  (%d KB, about %d KB when served compressed)  release=%s' % (dest, size // 1024, gz // 1024, release))
    return status


if __name__ == '__main__':
    sys.exit(main())
