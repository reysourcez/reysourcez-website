# Scan to Document v0.4 - how to put it on the website (no coding)

## What you upload (7 files, all from the outputs folder, into the repo root next to form-scanner.html)
1. ScanToDoc_v0.4.html        (the page)
2. ScanToDoc-config_v0.4.js   (all settings: languages, fonts, thresholds)
3. ScanToDoc-clean_v0.4.js
4. ScanToDoc-layout_v0.4.js
5. ScanToDoc-docx_v0.4.js
6. ScanToDoc-ocr_v0.4.js
7. ScanToDoc-app_v0.4.js
The other files (probe, parity, tests, fixture, smoke, dossier, manifest) are for testing and notes: do NOT upload them to the website.

## Steps
1. GitHub > your repo > Add file > Upload files > drag the 7 files > Commit changes.
2. Open nav-config.js in GitHub (pencil icon) and add ONE line before the "Add a new tool here" comment:
   `  { href: 'ScanToDoc_v0.4.html', label: 'Scan to Document' },`
   Commit. (When the version changes, this line changes to the new file name.)
3. Wait about a minute, open the page (reysourcez.com/ScanToDoc_v0.4.html), hard refresh (Ctrl+F5).
4. Open "Diagnostics" at the bottom and press "Run self-test". You should see four lines starting with OK, the last one saying it read back "2026".
   - FAILED on "Could not load https://cdn.jsdelivr.net/...": the reading engine could not be downloaded. Check the internet connection, then press Copy log and send it to me.
5. Choose a scan (or a PDF), keep both languages ticked, press "Read the scan". The first run downloads the English and Malay language files once (a few MB), later runs are faster.
6. Check yellow words against the scan, edit or add text, then "Download Word (.docx)".

## What changed from v0.3 (replace all 7 files and the nav line)
- Pictures are read at a higher resolution, the clean-up scales with resolution, new "Turn" control for sideways pages, new "Spell-check" switch for the review list.
- Nav line now: `{ href: 'ScanToDoc_v0.4.html', label: 'Scan to Document' },` (delete the v0.3 files and the old nav line).

## Needs checking on the first real run (could not be tested where this was built)
- Tesseract.js itself (the self-test and the first scan prove it), Malay (`msa`) reading, PDF input (page renderer is the same one Form Scanner uses), and opening the .docx in Microsoft Word.

## Settings
Everything you may want to change is in ScanToDoc-config_v0.4.js (edit, commit, reload): languages (add one line per language), fonts, page layout modes, size limits, clean-up and paragraph thresholds.
To host the reading engine files yourself instead of jsDelivr, fill in the three paths under ASSETS in that file (the document is never uploaded either way).
