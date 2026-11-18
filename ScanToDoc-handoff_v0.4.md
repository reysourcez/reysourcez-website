# ScanToDoc - continuity dossier (v0.4, 2026-11-17)
Working codename; rename freely (all files must then follow the owner's rule ProjectName-file_vX.Y with one shared version). Replaces v0.3 (v0.3 = first browser build; v0.4 adds the accuracy work in section 9).
STATUS: browser version v0.4 BUILT and tested with the reading engine mocked; the owner tried it live and reports local reading is not yet as good as Qwen (expected, see section 9). Real Tesseract.js, Malay, PDF input and MS Word opening are NOT yet verified (no network in the build sandbox). Side track of the Form Scanner; no Form Scanner file is changed (one nav line is added by the owner).

## 1. Goal, constraints, owner decisions
- Turn a scanned text document (skewed, black artifacts) into an editable text document: real text, alignment, sensible fonts.
- Private (nothing leaves the browser), free, no cloud AI. GitHub Pages (static) + Cloudflare; NO Worker, NO API key.
- OWNER DECISIONS (2026-11-17): (a) inputs are mostly STANDARDS documents: mostly plain text with certain alignments, not forms/tables. (b) Review step like the Form Scanner's editable functions AND the owner can ADD his own text where the scan is not faithful. (c) Languages: English AND Malay together from the start; more languages later (so a language = one config line).
- Standing rules: pinned external libraries, tooltips for descriptions, site nav / styles.css, version in every file name and in the page, one shared version for the deploy set, layman deploy steps, dossier + manifest every iteration.

## 2. Verdict (from probes, see section 4)
Feasible in the browser. Works: deskew, dark-edge/speck removal, lighting flatten, local reading, per-word confidence, paragraphs + alignment + hanging indents, Word export. Weak: headings (about 67%), list markers, heavy damage, dust streaks, original font/bold/italic (NOT recoverable by OCR), tables/figures (out of scope for v0.4).

## 3. Verified facts (checked online 2026-11-17; re-check versions when building)
- Tesseract.js v7.0.0 latest shown (15 Dec), Apache-2.0, WebAssembly port, does NOT read PDFs (pdf.js renders pages). API (docs/api.md): `createWorker(langs, oem, options)` (options: logger, errorHandler, workerPath, corePath, langPath, cachePath, cacheMethod, gzip), `worker.setParameters()`, `worker.recognize(image, options, output)`; since v6 only text unless `{ blocks: true }` (blocks > paragraphs > lines > words with text, confidence 0-100, bbox {x0,y0,x1,y1}). Input may be a canvas. CDN script: `https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js` (README pattern; pin confirmed only by the README form, check on first load).
- Defaults load core + language data from jsDelivr (pictures never uploaded). Self-hosting: `workerPath`, `corePath` (FOLDER; copy the whole folder, v7 adds a relaxedsimd build), `langPath` (`<code>.traineddata.gz`). Language data cached in IndexedDB. Multiple languages = array, e.g. ['eng','msa'].
- Malay = `msa` in official tessdata; Apache-2.0 data. LSTM engine gives NO font name/bold/italic.
- Tesseract guide: >=300 dpi; skew and dark scanner borders hurt; dark text on light.
- Scribe.js is AGPL-3.0 (not used). PaddleOCR.js exists as a local neural option (Malay not verified).
- Word export is written without any library (own ZIP + WordprocessingML); validated with python-docx and LibreOffice, NOT with MS Word.

## 4. Research probes (v0.2 set, unchanged, not deployed)
Probe 1 (ScanToDoc-probe_v0.2.py): Wastage Sheet damaged on purpose; plain Tesseract 74% of words, after clean-up 92% (98.7% on a clean raster); low confidence flagged 95% of wrong words; heavy damage stays 30-53%.
Probe 2 (ScanToDoc-layout-probe_v0.2.py): invented 2-page standards-style sample with known layout, damaged + cleaned: alignment 97%, paragraph starts 94%, headings 67%, words 89% (rules tuned on that sample after a first pass of 82%: optimistic).

## 5. What v0.4 is (deploy set, all v0.4)
| File | Role |
|---|---|
| ScanToDoc_v0.4.html | page: controls, Scan pane, Document (review) pane, Diagnostics; uses site nav/styles.css; sd- prefixed CSS |
| ScanToDoc-config_v0.4.js | every setting (languages, engine paths, clean-up/layout thresholds, fonts, sizes); optional override from RZ_SITE_CONFIG.scanToDoc |
| ScanToDoc-clean_v0.4.js | crop to paper, deskew (projection profile), lighting flatten, gaussian local threshold, speck/blotch removal; typed arrays, no DOM |
| ScanToDoc-layout_v0.4.js | OCR lines -> paragraphs, alignment, headings, hanging indents, document model; language-aware NOTE/Annex words |
| ScanToDoc-docx_v0.4.js | .docx (stored ZIP + WordprocessingML) and .txt export; no outside library |
| ScanToDoc-ocr_v0.4.js | Tesseract.js wrapper (LSTM, page mode, blocks output), self-test, mock engine for tests |
| ScanToDoc-app_v0.4.js | UI logic: files (PDF or pictures), per-page clean/read/rebuild, review list, undo, export |
Flow: choose PDF or pictures > per page: gray > clean-up (JS) > canvas > engine.recognize (blocks) > linesFromBlocks > infer > toDocModel > review list > export. Previews are kept small (1100 px) so long documents stay light.
Document model paragraph: { id, origin:'ocr'|'user', type:'heading'|'body'|'list'|'note', align, text, sizePt, bold, indentMm, firstLineMm, conf, tokens[{t,c}], edited, page, box{l,t,r,b} }.
Review features: edit text (yellow = doubtful, clears when touched), Enter splits, add paragraph (marked "added by you"), merge, delete, move up/down, type + alignment switches, undo (40 steps), outline of the paragraph on the scan, page navigation, font + text-size choice. Header/footer strips (top/bottom 8.5%) are left out and counted.
Hosting: the 7 files go in the repo root; one line added to nav-config.js (see ScanToDoc-DEPLOY_v0.4.md).

## 6. Tests (all pass; run from the outputs folder)
- ScanToDoc-parity_v0.4.py: JS clean-up vs Python clean-up on the same damaged pages: skew exact (-2.4 / +1.8 deg), about 1.1 s per 4.6 Mpx page, words found 89.3% vs 89.4%; JS layout rules give identical scores to the Python rules on the same input (alignment 86.6% on JS-cleaned pages vs 97.0% on Python-cleaned: caused by different OCR words, not by the rules).
- ScanToDoc-tests_v0.4.py: Word export, 15 checks (zip CRCs, python-docx reads alignment/indent/fonts/escaping, LibreOffice converts and renders).
- ScanToDoc-smoke_v0.4.js: page in real Chromium, engine mocked with a REAL desktop-Tesseract reading of the browser-cleaned picture: 35 checks (both languages ticked by default, paragraphs rebuilt, yellow words, outline follows selection, typing, Enter split, add, alignment/type switch, merge, delete, undo x2, add at end, Word + text downloads, self-test, empty reading) plus rotate control, spell-check switch, 90-degree turn; plus 4 checks on the downloaded files. ScanToDoc-unit_v0.4.js: 7 checks on rotateQuarter and a resolution-scaled clean-up. Parity part 3: at 300 dpi the JS clean-up reads 95.7% of words vs 96.7% for the Python one (about 2.5 s per 9.8 Mpx page).
Helpers: ScanToDoc-cleanfile_v0.4.js, ScanToDoc-layoutfile_v0.4.js, ScanToDoc-docxmake_v0.4.js, ScanToDoc-fixture_v0.4.py.

## 7. NOT tested / risks (verify on first deploy)
1. Real Tesseract.js: script URL, createWorker/setParameters/recognize behaviour, `blocks` shape, speed (the page tolerates a refused extra setting and logs it). The Diagnostics self-test checks this.
2. Malay (`msa`) accuracy and language-file loading; NOTE/Annex word lists for Malay are starter guesses.
3. PDF input path (same pdf.js loader as Form Scanner, never run here); long documents (memory/time); phones.
4. Opening the .docx in Microsoft Word (only python-docx and LibreOffice were used).
5. Rules were tuned on one invented, clean, single-column sample: expect lower accuracy on real standards; headings, list markers, header/footer junk are the known weak points. Tables, figures, footnotes, TOC, multi-column are not handled.
6. Text accuracy on a heavily damaged scan is about 1 word in 9 wrong (English model): the review step is essential.

## 8. KIV / next steps (priority order)
1. Owner deploys the 7 files + nav line, runs the self-test, tries 2-3 real standards (English, Malay) and reports; send the log if anything fails.
2. Retune paragraph/heading/list rules on real pages (and add real Malay note/annex words).
3. Multi-page extras: repeated header/footer detection, page numbers, TOC dot leaders as tab stops, hyphenation, footnotes.
4. Optional PDF export with real text (pdf-lib; embed a font for symbols), settings sheet (Excel) if wanted.
5. Tables later (ruled-line detection + per-cell OCR via `rectangle`).
6. Self-hosting the engine files (ASSETS paths) if a fully self-contained site is wanted; optional local neural reader (PaddleOCR.js) after verifying Malay.
7. Idea (untested): offer the clean-up as a pre-step for the Form Scanner's blurry sources.
8. Open a fresh chat when work resumes and paste this dossier.

## 9. Accuracy work (2026-11-17): why Qwen reads better, what text-scan.com teaches, what was changed
- Owner's finding: local reading is not as good as Qwen. Expected: Tesseract is a small LSTM, Qwen is a very large vision-language model. No classical tweak closes the whole gap.
- text-scan.com (checked 2026-11-17): free tier appears to be Tesseract (its language list is Tesseract's own tessdata list, incl. equ and osd modules); the paid tier advertises Google Cloud Vision for better accuracy; files are uploaded to their servers. Their features page shows classical pre-processing: black-and-white conversion, connected-component analysis, removal of long components (hand-drawn underlines), perspective correction, handling of dark / uneven backgrounds, show-through (transparent paper) and highlighter marks. Lesson: the best accuracy there also comes from a cloud engine, not from pre-processing alone.
- Measured here (ScanToDoc-accuracy-probe_v0.4.py, damaged 2-page sample, English model, bag-of-words): 200 dpi 93.8% found; 300 dpi 96.7%; clean 300 dpi raster 100%. Enlarging a 200 dpi picture afterwards does not help (93.9 / 94.2%); feeding grey instead of black-and-white is worse at 200 dpi (76.7%) and equal at 300 dpi; removing long vertical dust lines changed nothing; Tesseract's heavy-noise switch did not help. Biggest lever = real resolution (about 300 dpi).
- Changed in v0.4: default picture size raised (MIN_EDGE_PX 3300 about 280 dpi on A4, MAX 4200); PDF pages already render at 300 dpi; clean-up thresholds now scale with resolution (DPI option); manual Turn control (90 / 180 / 270) for sideways pages; browser spell-check on the review list (English works; Malay depends on the browser dictionary).
- Not done (candidates): perspective correction for phone photos; show-through suppression; highlighter/underline marks; automatic page-orientation detection (needs Tesseract OSD, not available in the default Tesseract.js build); optional hybrid "AI wording check" through the owner's existing Form Scanner Worker (Qwen/Gemini engines; NOT private; would align the AI words to the local layout and only correct words); a local neural reader (PaddleOCR.js or a small vision model on WebGPU): still on-device but heavier and unverified for Malay.
- DECISION PENDING from the owner: whether to add the optional, off-by-default AI wording check (breaks "no cloud AI" for that document only) or stay fully local.
