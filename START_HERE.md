# START HERE — Market Radar v1.7.0 (2026-10-15)

This ZIP is the **complete and final v1.7.0 package. Everything you need is inside it.**

**Ignore older copies in the chat's Artifacts panel.** It keeps every version I ever showed and I cannot delete them. Only the files in this ZIP are current. (The "1.6.2" cards you saw were rollback copies of the old version that had the same file names as the new ones. They now live in `archive-v1.6.2/` with `-v1.6.2` in their names.)

---

## 1. To make the website work — the only required step: 4 files

| File | What to do with it |
|---|---|
| `market-radar.html` | Upload to GitHub (your website repo, top level) |
| `market-radar.js` | Upload to GitHub (same place) |
| `market-radar-engine.js` | Upload to GitHub (same place). **New file in v1.7.0** |
| `market-radar-proxy-worker.js` | Cloudflare → Workers & Pages → market-radar-proxy → **Edit code** → select all → paste → **Deploy** |

Do all four, then press **Ctrl+F5** on the page. You should see **v1.7.0** next to the title.
Step-by-step instructions: `MARKET_RADAR_SETUP_AND_GLOSSARY.md`, section 3.

## 2. Recommended once (about 10 minutes): the Overture data files

The page works without them. With them it can estimate how complete the map data is and show businesses OpenStreetMap is missing.

`tools/` is just a normal folder inside this ZIP; it holds helper scripts. You only need **one** of them:

`tools/market-radar-build-overture.py` — run it on your PC (two commands: install `overturemaps`, then run the script). It creates a folder `market-radar-data/` with four small files. Upload that folder to GitHub. Full steps: setup guide, section 4. Repeat every 2–3 months.

## 3. Keep for reference (do not upload)

| File | What it is |
|---|---|
| `MARKET_RADAR_SETUP_AND_GLOSSARY.md` | how to deploy, how to read the page, troubleshooting, jargon |
| `MARKET_RADAR_HANDOFF.md` | give this to any new AI session **first** |
| `market-radar-settings-reference.xlsx` | every setting you can change, in one sheet |
| `MARKET_RADAR_HISTORY.md` | the old story up to v1.6.2. It says 1.6.2 because it is an archive, not because it is out of date |
| `_MANIFEST.md` | a list of every file with a short fingerprint, so you can check nothing is missing or changed |

## 4. Developer / AI helpers — you can ignore these

`tests/` (87 automated tests; run `sh tests/run-all.sh`) · `tools/market-radar-build-settings.py`, `tools/market-radar-build-handoff.py`, `tools/market-radar-build-package.py` (they regenerate the settings sheet, the handoff, and this ZIP) · `archive-v1.6.2/` (the **old** version, only for rolling back; it needs the old Worker too).

## Folder map

```
market-radar-v1.7.0/
  START_HERE.md                       <- you are here
  market-radar.html                   -> GitHub
  market-radar.js                     -> GitHub
  market-radar-engine.js              -> GitHub
  market-radar-proxy-worker.js        -> Cloudflare
  MARKET_RADAR_SETUP_AND_GLOSSARY.md  how-to + jargon
  MARKET_RADAR_HANDOFF.md             for the next AI session
  market-radar-settings-reference.xlsx
  MARKET_RADAR_HISTORY.md             archive (to v1.6.2)
  _MANIFEST.md                        file list + fingerprints
  tools/                              helper scripts (only the overture one matters to you)
  tests/                              automated tests (AI/developer)
  archive-v1.6.2/                     OLD version, rollback only
```
