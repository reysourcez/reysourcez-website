# ScanToDoc (working codename) - delivery manifest (v0.4, 2026-11-17)

## Deploy set (v0.4) - upload these 7 to the repo root, see ScanToDoc-DEPLOY_v0.4.md
| File | Version | Status |
|---|---|---|
| `ScanToDoc_v0.4.html` | v0.4 | DONE (tested with mock engine; real Tesseract.js untested) |
| `ScanToDoc-config_v0.4.js` | v0.4 | DONE |
| `ScanToDoc-clean_v0.4.js` | v0.4 | DONE (parity-tested vs Python) |
| `ScanToDoc-layout_v0.4.js` | v0.4 | DONE (parity-tested vs Python) |
| `ScanToDoc-docx_v0.4.js` | v0.4 | DONE (python-docx + LibreOffice; not MS Word) |
| `ScanToDoc-ocr_v0.4.js` | v0.4 | DONE (Tesseract.js wrapper untested live; self-test built in) |
| `ScanToDoc-app_v0.4.js` | v0.4 | DONE |
Also edit nav-config.js: add `{ href: 'ScanToDoc_v0.4.html', label: 'Scan to Document' },`

## Tests and helpers (v0.4) - do not upload
`ScanToDoc-smoke_v0.4.js` (35 page checks, Chromium) | `ScanToDoc-unit_v0.4.js` (7 clean-up checks) | `ScanToDoc-accuracy-probe_v0.4.py` (what improves local reading) | `ScanToDoc-tests_v0.4.py` (15 Word checks) | `ScanToDoc-parity_v0.4.py` (JS vs Python) | `ScanToDoc-cleanfile_v0.4.js`, `ScanToDoc-layoutfile_v0.4.js`, `ScanToDoc-docxmake_v0.4.js`, `ScanToDoc-fixture_v0.4.py` (helpers)

## Docs (v0.4)
`ScanToDoc-handoff_v0.4.md` (continuity dossier, replaces v0.2) | `ScanToDoc-DEPLOY_v0.4.md` (layman steps) | this manifest

## Research set (v0.2, unchanged, not deployed)
`ScanToDoc-probe_v0.2.py`, `ScanToDoc-layout-probe_v0.2.py`, `probe/` (evidence pictures, sample PDF, rebuilt .docx, result JSON files)

## Tested with
Node 22, Playwright 1.63 + Chromium, desktop Tesseract 5.3.4 (English only), OpenCV 5.0.0, python-docx, LibreOffice, reportlab. Run from this folder: `node ScanToDoc-smoke_v0.4.js`, `python3 ScanToDoc-tests_v0.4.py`, `python3 ScanToDoc-parity_v0.4.py`.
## Not tested
Tesseract.js live, Malay, PDF input, MS Word, phones, real standards scans, more than 2 pages. Existing Form Scanner v6.8 files untouched.
