# Market Radar - _MANIFEST (v1.7.0, 2026-10-15)

This is the file list of **market-radar-v1.7.0-ALL-FILES.zip** (the ZIP keeps these folders). The 12-character fingerprint is the start of each file's SHA-256: if a file you hold has a different fingerprint, it is not this release. Tests: **87 automated tests** (engine 35, Worker 14, Overture builder 12, real-browser 26); run `sh tests/run-all.sh`.

| File | Where it goes | Version | Status | What is tested | Size (bytes) | Fingerprint |
|---|---|---|---|---|---|---|
| `START_HERE.md` | read first | 1.7.0 | DONE | every file it names is checked to exist in this package | 3,488 | `f8b40b978f52` |
| `market-radar.html` | UPLOAD to GitHub | 1.7.0 | DONE | browser suite 26 (real Chromium); NOT run against your live site/stylesheet | 18,550 | `283e591257c5` |
| `market-radar.js` | UPLOAD to GitHub | 1.7.0 | DONE | browser suite 26; syntax-checked | 50,227 | `4dd3f6c6e1c3` |
| `market-radar-engine.js` | UPLOAD to GitHub | 1.7.0 | DONE | unit 35 + browser suite + builder contract | 41,921 | `61afc8422e0c` |
| `market-radar-proxy-worker.js` | PASTE into Cloudflare | 1.7.0 | DONE | Worker 14 (real code, mocked upstreams) + browser suite; NOT yet on real Cloudflare | 23,699 | `2d75f5f390ac` |
| `tools/market-radar-build-overture.py` | RUN on your PC (optional) | 1.7.0 | DONE | builder tests 12; never run against live Overture data | 12,166 | `aa7855bb5257` |
| `MARKET_RADAR_SETUP_AND_GLOSSARY.md` | KEEP (reference) | 1.7.0 | DONE | on-screen wording checked against the code | 17,383 | `2f0b29318280` |
| `MARKET_RADAR_HANDOFF.md` | KEEP (give to a new AI session) | 1.7.0 | DONE | generated from the code + narrative claims checked against the code | 39,907 | `7194dbb7917a` |
| `market-radar-settings-reference.xlsx` | KEEP (reference) | 1.7.0 | DONE | generated from the code; 0 formula errors | 37,249 | `a956dac9a515` |
| `MARKET_RADAR_HISTORY.md` | KEEP (archive, ends at v1.6.2) | archive (ends v1.6.2) | ARCHIVE | v1.6.2 guide kept verbatim - not out of date, it is an archive | 69,143 | `2bb8f3babef2` |
| `_MANIFEST.md` | KEEP (file list) | 1.7.0 | GENERATED | written by tools/market-radar-build-package.py | - | (this file) |
| `tools/market-radar-build-settings.py` | developer / AI | 1.7.0 | DONE | ran; workbook recalculated | 28,448 | `abb3d11411a7` |
| `tools/market-radar-build-handoff.py` | developer / AI | 1.7.0 | DONE | ran; fails if a generated fact is missing from the code | 35,352 | `627aed5eb402` |
| `tools/market-radar-build-package.py` | developer / AI | 1.7.0 | DONE | ran; this manifest and the zip come from it | 9,185 | `a29877fec30d` |
| `tests/run-all.sh` | developer / AI | 1.7.0 | DONE | proven to fail when any suite fails (negative test) | 1,464 | `7019f5e72459` |
| `tests/engine.test.cjs` | developer / AI | - | DONE | 35 pass | 15,177 | `4e63c74b12c1` |
| `tests/worker.test.mjs` | developer / AI | - | DONE | 14 pass | 12,606 | `24a45c1ad450` |
| `tests/overture-builder.test.py` | developer / AI | 1.7.0 | DONE | 12 pass | 10,757 | `4aa75d3bb4c9` |
| `tests/e2e.mjs` | developer / AI | - | DONE | 26 pass | 29,825 | `43fe0bcc339b` |
| `tests/leaflet-stub.js` | developer / AI | - | DONE | support file for e2e | 5,321 | `ee486750ba99` |
| `tests/_worker.mjs` | developer / AI | 1.7.0 | GENERATED | copy of the Worker (suites refuse a stale copy); refreshed by run-all.sh | 23,699 | `2d75f5f390ac` |
| `archive-v1.6.2/market-radar-v1.6.2.html` | OLD - rollback only | v1.6.2 (old) | OLD (v1.6.2) | not maintained | 30,094 | `494153e226f8` |
| `archive-v1.6.2/market-radar-v1.6.2.js` | OLD - rollback only | v1.6.2 (old) | OLD (v1.6.2) | not maintained | 84,834 | `58e35ed162e5` |
| `archive-v1.6.2/MARKET_RADAR_HANDOFF-v1.6.2.md` | OLD - rollback only | v1.6.2 (old) | OLD (v1.6.2) | not maintained | 31,308 | `9969d479cd7c` |
| `archive-v1.6.2/MARKET_RADAR_SETUP_AND_GLOSSARY-v1.6.2.md` | OLD - rollback only | v1.6.2 (old) | OLD (v1.6.2) | not maintained | 68,207 | `1443ecd727e6` |
| `archive-v1.6.2/market-radar-settings-reference-v1.6.2.xlsx` | OLD - rollback only | v1.6.2 (old) | OLD (v1.6.2) | not maintained | 27,206 | `6c7977860b5c` |

**Not built yet (your step):** `market-radar-data/overture-<town>.json` - run `python tools/market-radar-build-overture.py --town all` on your PC, then upload the folder. Until then the page uses OpenStreetMap only and says so.

**Not verified live (the build environment had no internet):** Overpass, Overture download, OpenRouteService, DOSM, Gemini, Geoapify, your real site stylesheet, real phones. The smoke tests are in `MARKET_RADAR_SETUP_AND_GLOSSARY.md`, section 6.
