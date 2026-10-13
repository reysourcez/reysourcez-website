# Form Scanner — delivery manifest (v6.8, 2026-10-13)

| File | Version | Status | Goes where |
|---|---|---|---|
| `form-scanner-proxy-worker.js` | v6.8 | DONE — **redeploy** (one prompt rule) | Cloudflare Worker: Edit code, paste, Deploy (no new secrets) |
| `form-scanner.html` | v6.8 | DONE | GitHub repo root |
| `form-scanner.js` | v6.8 (`?v=9`) | DONE | GitHub repo root |
| `form-scanner-engine.js` | v6.8 (`?v=7`) | DONE | GitHub repo root |
| `FORM_SCANNER_SETUP_AND_GLOSSARY.md` | v6.8 | DONE | repo docs (replaces v6.7) |
| `FORM_SCANNER_CHANGE_NOTES.md` | v6.8 | DONE | repo docs (replaces v6.7) |
| `nav-config.js`, `site-config.js`, `styles.css` | unchanged (`styles.css?v=19`) | not re-delivered | — |

## What was tested (mocked: the sandbox has no network)
- Worker: 52 checks (`tests/worker_tests68.mjs`)
- Engine: 26 checks, incl. a before/after PDF proof of the stray "xs" fix (`tests/engine_tests68.js`)
- Page: 36 checks in real Chromium with the real pdf-lib 1.17.1 (`tests/smoke_page68.js`)
- Not tested: any real provider; that Qwen on Cloudflare now keeps the printed sample text (needs one real run).

## Tests folder
Scripts were run in the build sandbox, so their paths (`/home/claude/v68`, `/mnt/project`) must be adjusted to run elsewhere. They need Node 20+; the page test also needs Playwright and `pdf-lib`. `fixtures/` holds the Dots3 and Gemini label texts used for the wording-merge regression and the four comparison sheets (`M1`–`M4`) from the 2026-10-13 analysis.

## Open items
See the KIV list at the end of `FORM_SCANNER_CHANGE_NOTES.md` (v6.8 entry). The two original PDFs (Resit Rasmi, Daily Wastage Sheet) were not in the project folder on 2026-10-13: re-attach them to score layout.
