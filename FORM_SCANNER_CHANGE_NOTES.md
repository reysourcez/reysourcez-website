# Form Scanner — change notes

(Covers `form-scanner.html` / `form-scanner-engine.js` / `form-scanner.js` / `form-scanner-proxy-worker.js`. Kept as a separate file from `FORM_SCANNER_SETUP_AND_GLOSSARY.md`, which describes the current state rather than what changed and why — same split as `COSTING_ANALYSIS_CHANGE_NOTES.md` / this doc's sibling.)

## 2026-09-24 — v6.0: layout-spec rebuild, four reported bugs

**What prompted this.** Four things reported directly against the live page, working from screenshots of an actual scan (a *Baucar Bayaran* payment voucher and a *Resit Rasmi* receipt, both real multi-section government-style forms):

1. The rebuilt form doesn't follow the source's actual structure — flagged as the main problem ("they change the structure of the source file, which we dont want").
2. Fillable fields still look shaded/grey even with the shading checkbox unchecked.
3. Switching from one uploaded file to another updates the preview image but not the file description/card — it stays stuck on the previous file. Separately, PDF uploads showed no preview at all (only an image did).
4. On desktop, the page is a single narrow column with a lot of unused space to the right; asked to use it, while leaving the mobile layout exactly as it is.

Each is addressed below, with what was actually wrong (not just what it looked like) and how the fix was checked.

### 1. Structure fidelity — root cause: the schema itself couldn't represent the source

The v4.3 Worker schema (`header_left` / `header_right` / `main_table` / `left_signatures` / `right_signatures`, or the earlier four-parallel-array version before that) hard-codes a *specific* page shape. Neither version has a way to say "two boxed columns, each with its own stack of labelled lines and a rule before the last two" — the exact shape of both test forms' signature blocks — so the model was always going to flatten anything that didn't match the schema's built-in assumptions, no matter how well it read the photo. This wasn't a prompting problem; it was a representable-output problem.

**Fix.** The Worker now returns a **layout spec**: a form is a stack of **bands** (full-width, top to bottom); each band is either a **table** (a ruled grid — the old tool's only shape) or **cells** (one or more side-by-side columns, each a free stack of coded items — text, a labelled blank, tick boxes, a rule, spacing). This can represent the two-column signature block, a boxed sub-section, a mixed field-grid-then-table layout, and so on directly, instead of forcing it into a fixed template. See `FORM_SCANNER_SETUP_AND_GLOSSARY.md`'s "The layout spec" / "Coded item" glossary entries for the exact shape.

**Checked by:** hand-authoring specs for both real forms (Baucar Bayaran, Resit Rasmi) plus a third (a Buku Tunai cash book, to exercise the table-band path with header groups and coloured columns) and rendering all three with the new engine; visually diffing the result against the source photos section by section. Also fuzz-tested the spec normaliser and PDF builder against ~400 malformed/randomised specs (missing fields, wrong types, out-of-range numbers, non-Latin text, empty bands, nonsense `kind` values) — 0 crashes, every failure mode degrades to a warning or an empty result instead of throwing. The Worker also has a schema/thinking "attempt ladder": if Gemini rejects the schema as too complex for a given form, it retries without the schema, then without extended thinking, rather than failing outright.

### 2. The grey tint — root cause: it isn't ours to fix, but it does need explaining

Confirmed empirically, not assumed: a field written with **no background key at all** (what the code already did when the shading checkbox is unchecked, both before and after this round) renders genuinely white/colourless when read directly — checked by rendering the actual PDF bytes through PDFium (the same engine Chrome and Edge use) with form-field highlighting explicitly turned off. Turn PDFium's own highlighting on — simulating Chrome/Edge's *default* viewer setting — and the exact same colourless field renders with a pale blue-grey tint. That is: **the tint people see is the browser's PDF viewer, not the file.** It isn't in `/MK`, it isn't a `/BG` key, there's nothing in the PDF to turn off — confirmed by dumping every field's appearance dictionary from the generated file. It also doesn't appear when the PDF is printed, and Adobe Acrobat has its own separate toggle for the same kind of highlighting (Chrome and Edge currently don't expose one).

**What actually needed fixing, and was:**
- The shading checkbox's own background colour is still applied correctly and *only* when checked — this was already true, reconfirmed this round (0/35 fields carry `/BG` with it unchecked, 35/35 do with it checked, on the same test file).
- **Checkboxes were a real, separate bug.** They were pure PDF form-field widgets with no drawn square — meaning their visible box came *only* from the viewer's own rendering of an unchecked checkbox widget, which most viewers draw with a light fill. Fixed by drawing an actual black-bordered square as normal page content (not a widget style) under every checkbox field, so the box is always there regardless of viewer/appearance-stream quirks. Verified by forcing `NeedAppearances` (a PDF flag some scripted fills set, which previously made these particular squares disappear in strict viewers) and re-rendering — the drawn squares survive; a widget-only square did not.
- **A related bug found while checking this:** generated fields had no `/DA` (default appearance) or `/DR` (default resources) entry on the AcroForm dictionary — legal-but-fragile, meaning a viewer with no better guess could fall back to an unavailable font when *typing into* a field. Fixed by writing both explicitly, checked by filling sample fields with `pypdf` and re-rendering — text now appears in the correct font with no missing-font warnings, where it previously rendered fine only in permissive viewers.
- The page and Worker now both say plainly, in-product, that the highlighting is the browser's — see the note under the shading checkbox in `form-scanner.html`, and the Glossary entry in `FORM_SCANNER_SETUP_AND_GLOSSARY.md` — so this doesn't need re-diagnosing from scratch next time someone notices it.

### 3. Preview/description going stale — root cause: no single place file-selection state lived

Rebuilt file selection around one function per file type (`showImageCard` / `showPdfCard`), each of which unconditionally resets *both* the image and the PDF card before showing its own — so there's no code path where the previous file's name or description can survive a new selection. A monotonic selection counter (`selId`) also guards the async work in between (reading the file, resizing an image, reading a PDF's page count) so a slow read for a file the person has since replaced can't land after the fact and overwrite what's now on screen.

Separately: **PDF uploads now show a real preview**, not just a filename. `form-scanner.js` reads the uploaded PDF's actual page count and exact page dimensions client-side (via pdf-lib, already loaded for the download step — no extra library) and shows both immediately, e.g. "1 page · 148 × 210 mm landscape". This is also what fixed the *other* long-standing bug in the same screenshots: the Resit Rasmi form coming out A4 portrait instead of its real A5 landscape — the previous version never read the source PDF's actual page size at all, it only used the note field or a plain default. A full visual thumbnail (rendering page 1 to an image, the way a photo preview already works) would need `pdf.js` from a CDN; see the KIV note in the setup doc for why that specifically was left for a session that can verify a live CDN build first.

**Checked by:** driving the real page in a real Chromium browser (Playwright): select a PDF → assert its card shows the right name and metadata → select a photo *without reloading the page* → assert the PDF card is hidden, the image card shows, and the status line updates — all directly against the live DOM, not a re-implementation of the check. Passed on both a desktop and a mobile viewport.

### 4. Desktop layout

`form-scanner.html`'s upload panel now sits in the left of a two-column grid above 800px width (the site's one existing small-screen breakpoint, reused rather than inventing a second one); the detected-structure preview — previously a separate section below the fold, empty until a scan completed — now sits to its right, with a calm placeholder ("...will appear here once you scan a form") before that. Below 800px, everything stacks in the original single-column order — nothing about the mobile layout changed.

One thing tried and deliberately reverted: making the (shorter) left column `position: sticky` so it stays in view while scrolling a long results list on the right. This looked right in isolation but never actually stuck during a real scroll — traced to `body { overflow-y: scroll; }` in `styles.css` (existing, intentional, used by every page on this site to stop the scrollbar causing layout shift — not something to change here), which makes `<body>` its own scroll container and breaks sticky positioning for elements inside it. Removed rather than fought; both columns just scroll together normally now. Flagging in case a future round wants sticky enough to justify revisiting the site-wide scroll setup — that's a bigger, cross-tool decision, not a Form Scanner–only one.

### Also changed, smaller

- **File split:** the engine (spec parsing, layout, pdf-lib drawing — the part with no DOM code) is now its own `form-scanner-engine.js`, separate from `form-scanner.js` (page wiring only). It grew too large to comfortably stay bundled once it had to model arbitrary layouts rather than one fixed shape, and splitting it means it can be loaded and unit-tested under plain Node without a browser — which is how all the testing described above was actually done.
- **Config consolidated.** Every tunable (`PROXY_ENDPOINT`, usage cap, max file size, field tint colour, etc.) now lives once, in `form-scanner-engine.js`'s `FS_CONFIG`, instead of being split across two files that could drift apart from each other.
- **Nav retrofit applied** (`NAV_RETROFIT_HOWTO.md`) — `form-scanner.html` now reads `nav-config.js` instead of carrying its own hand-written dropdown list. It was on that doc's "not yet" list; moved to "done" in the copy delivered alongside this note.
- **Model names checked, not assumed.** `gemini-flash-lite-latest` (unchanged default) and `gemini-3.8-flash` (new "more thorough" tier) were both confirmed against `ai.google.dev/gemini-api/docs/models` / `/changelog` on 2026-09-24 rather than carried over from memory — Google's recommended-models list moves, and the previous `gemini-flash-lite-latest` comment ("same default as menu-calculator-proxy-worker.js") is still accurate today but is exactly the kind of thing worth re-checking each time this file is touched, not just once.
- **A "more thorough reading" option** (checkbox, off by default) now exists end-to-end — Worker (`tier: 'fast' | 'precise'`), engine, and page — for a denser or more unusually laid-out form. Counts double against the daily usage cap.

### What this deliberately did NOT touch

- `form-scanner-proxy-worker.js`'s `ALLOWED_ORIGINS` — unchanged, still `reysourcez.com` / `www.reysourcez.com`. Confirm this Worker is deployed at the same `*.workers.dev` URL as before, or update `PROXY_ENDPOINT` in `FS_CONFIG` if not.
- `nav-config.js` itself — not edited from this session, per `NAV_RETROFIT_HOWTO.md`. Its `form-scanner.html` entry is currently labelled "Form Creator", not "Form Scanner" — flagged in the setup doc's KIV list, not changed, since it's not clear from here whether that's an intentional rename or a mismatch.
- A visual PDF-page thumbnail (see the KIV note above and in the setup doc) — deferred rather than shipped with an unverified CDN reference.
- The editable/inline-correction preview still flagged as a KIV in the original setup doc — still read-only in this round; the preview got much more informative (mirrors the exact spec, band by band) but not editable.

### Testing done

Real end-to-end testing this round, not just static review — a genuine change from previous rounds of this tool, worth continuing:
- `node --check` clean on all four files.
- The layout engine run under plain Node against three hand-authored real-form specs (rendered to PDF, then to PNG via `pdftoppm`, and visually compared against the source photos) and against ~400 fuzzed/malformed specs (0 crashes).
- Every generated PDF inspected structurally, not just visually: `pypdf` (field count, duplicate names, `/MK` background/border keys, AcroForm `/DR`/`/DA`), `qpdf --check` (structural validity), and a fill-then-rerender pass (typed sample values into fields, forced `NeedAppearances`, re-rendered) to catch appearance-stream problems a static render wouldn't show.
- The *actual page* (`form-scanner.html` + both JS files, served statically, exactly as GitHub Pages would serve them) driven in real Chromium via Playwright, with the Worker call mocked at the network layer (this sandbox has no outbound network access, so the real Worker/Gemini call itself could not be exercised — everything downstream of the Worker's response was): file selection and the description-desync fix, the scan → preview → download flow, the shading checkbox both states, the "more thorough" checkbox's `tier` reaching the mocked request body, and both a 1400px and a 390px viewport.
- The PDF that the *browser itself* downloaded via the real `pdf-lib` CDN build (not a Node re-implementation) was then inspected the same structural way as above, to confirm the in-browser build path — not just the Node test path — produces a correct file.

**Not testable from here, worth doing once deployed:** the real Worker call end to end (this sandbox has no network access to reach Cloudflare or Gemini) — in particular, that the schema/thinking fallback ladder actually triggers correctly against a real "Gemini rejects this schema" response rather than just the synthetic ones used above, and that a real photo of a new, not-yet-tried form produces a spec the engine handles well. Also worth a real look at `chrome://settings` (or the Edge equivalent) to see whether either browser has added a form-field-highlighting toggle since this was checked (2026-09-24) — the write-up above found none currently, but this is exactly the kind of thing that can change without a version bump anyone would notice.

## Deploy checklist

- [ ] Add `form-scanner-engine.js` (**new file**) alongside the other three.
- [ ] Replace `form-scanner.html`, `form-scanner.js`, and `form-scanner-proxy-worker.js` with the versions delivered alongside this note — all full-file replacements.
- [ ] Confirm `PROXY_ENDPOINT` in `form-scanner-engine.js`'s `FS_CONFIG` matches your deployed Worker's `*.workers.dev` URL.
- [ ] Replace `FORM_SCANNER_SETUP_AND_GLOSSARY.md` with the version delivered alongside this note.
- [ ] Update your copy of `NAV_RETROFIT_HOWTO.md`'s status list — move `form-scanner.html` from "Not yet" to "Done" (or take the copy delivered alongside this note, which already reflects that).
- [ ] No changes needed to `nav-config.js`, `site-config.js`, `styles.css`, or `nav-dropdown.js` — all read as-is, none touched this round.
- [ ] Open the deployed page once and confirm: the "Business Analysis" dropdown lists all current tools with Form Scanner marked current; a real photo scan still works end to end against the real Worker (this round's testing could not reach it).

## KIV / open items

- Visual PDF-page thumbnail preview — see "What this deliberately did NOT touch" above.
- The structure preview is still read-only — inline correction of a misread label/column is still a future round, same as it's been since v1.
- `nav-config.js`'s "Form Creator" label for this page — flag for confirmation, not this session's file to change.
- No multi-page form support (a multi-page PDF only has its page 1 read) — unchanged scope from before.
- A true site-wide sticky-while-scrolling pattern would need `body`'s `overflow-y: scroll` revisited — cross-tool decision, out of scope here; noted in case it comes up again.


## 2026-09-30 — v6.1: engine switch (Gemini / Qwen / Kimi) for side-by-side testing

**Why.** Gemini reads were slow and sometimes failed outright; v4.3's ~90% structure was close but placement was wrong. Instead of guessing, v6.1 lets the same form be read by three engines and compared, so one can be chosen as the long-term default.

**What changed.** Worker: new `provider` field (`gemini` default | `qwen` | `kimi`). Qwen/Kimi call OpenRouter with the SAME prompt and SAME sanitizer as Gemini, so results are comparable. Models are set in `OR_MODELS` (top of the Worker): `qwen/qwen3.8-27b:free`, `moonshotai/kimi-k2.6:free` (both checked on openrouter.ai 2026-09-30). Every reply now carries `_meta.provider/model/ms`. Page: engine dropdown + a comparison log (engine, seconds, sections/items, Show and PDF buttons per run; failed runs are logged too). Log lives in memory only. `form-scanner.js?v=1` bumped to `?v=2`.

**Deploy.** (1) openrouter.ai → sign up → Keys → create key. (2) Cloudflare → Workers & Pages → your form-scanner-proxy Worker → Settings → Variables and Secrets → Add → Secret → name `OPENROUTER_API_KEY` → paste key → Save. (3) Edit code → replace everything with the new `form-scanner-proxy-worker.js` → Deploy. (4) GitHub: replace `form-scanner.html` and `form-scanner.js`. (5) Hard refresh the page (Ctrl+F5).

**How to test.** Same form, each engine in turn (screenshot a PDF page for Qwen/Kimi). Read the log: seconds, failures, and whether "sections/items" match the original. Click PDF on each row and compare placement against the source. If all engines detect the same structure but the PDFs still place it wrongly, the problem is the layout engine, not the model.

**Limits / KIV.** Qwen/Kimi: images only (PDF reading would need page rasterising). Free OpenRouter models are rate-limited and may retain prompts, so use blank/sample forms while testing; data-policy routing not added because not verified. Reasoning models can be slow; the Worker asks for low reasoning and retries without it if rejected. Winner → set as default, remove the losers, re-check data policy.


## 2026-09-30 — v6.2: Qwen-first Auto engine, PDF page rendering, live PDF preview

**Why.** Testing showed Kimi unusable and Qwen better than Gemini at following source structure, but Qwen could not take PDFs (forms are mostly PDFs) and placement problems were only visible after downloading.

**What changed.** (1) Kimi removed. Engine dropdown is now **Auto** (Qwen first, Gemini if Qwen fails or times out; both attempts show in the log), **Qwen only**, **Gemini only**. (2) Choosing a PDF now renders page 1 to an image in the browser (pdf.js 3.11.174 from cdnjs, loaded only when a PDF is chosen): Qwen reads that image, Gemini still gets the original PDF, and the upload card shows a real page thumbnail. If rendering fails, only Gemini can read that file and the status says so. (3) The generated PDF now previews in the page itself (browser PDF viewer) beside the source, so placement can be judged without downloading; the structure list moved into a collapsible "What was read". `form-scanner.js?v=2` → `?v=3`.

**Deploy.** Replace the Worker code in Cloudflare (`OPENROUTER_API_KEY` secret stays as is), then replace `form-scanner.html` and `form-scanner.js` on GitHub and hard-refresh (Ctrl+F5).

**Limits / KIV.** pdf.js rendering and the inline PDF preview were not exercised in a real browser here (no network). Some phones cannot show PDFs inline; Download still works. Next experiments depending on what the preview shows: a "double-check" second pass (model re-reads the image against its own first answer), or asking Qwen for bounding boxes so placement comes from measured positions instead of percentages.


## 2026-10-03 — v6.3: Qwen structure + Gemini wording, measured page geometry, wording editor, Gemini fix

**What the 2026-10-03 test screenshots showed (Resit Rasmi, Baucar Bayaran; Qwen vs Gemini).**
1. **Gemini returned almost nothing** ("No fields or tables found" on Resit; only the two tables on Baucar). Cause: in the response schema `cells` was optional, so Gemini skipped it and every non-table band vanished. Fixed: `cells` is now required (empty `[]` for tables).
2. **Qwen got the structure but the wording was weaker** ("BALIC BAYARAN", invented labels) while Gemini read words well. The source screenshots were small and blurry; text-reading models fail first on small text.
3. **Qwen's Resit came out portrait with the form squeezed into the top part, no outer border, and a full-width "NO RESIT" box.** The model's page guesses were trusted blindly (it copied `fill_pct: 60` from the prompt example).

**What changed.**
- **Auto = Qwen reads the structure while Gemini reads the wording at the same time** (new Worker `mode: "text"`, flat list of every printed text item). The page matches each label to the closest wording line and corrects it only when the match is convincing (`mergeWording` in the engine). Labels nothing backs up are never silently changed: they are highlighted amber in the new **Edit wording** panel, with a one-click suggestion where there is a near match. The plain Qwen row stays in the log next to the merged "Qwen + Gemini wording" row so the two PDFs can be compared. If the wording read fails, the Qwen result is shown unchanged.
- **Edit wording panel**: every printed label in an editable box; edits update the spec and the live PDF preview (text is cleaned to the Latin set the standard PDF fonts can draw).
- **Page geometry measured from the picture** (`measureContent`): orientation from the picture's real shape, margins (min 4% so nothing prints edge to edge), vertical fill, and an outer border when long unbroken rules run the full height at both sides. A dark viewer surround is ignored (the paper is found first). For PDFs it measures the rendered page.
- **Small images are enlarged to 1600 px** (long edge) before sending; transparent PNGs are flattened to white.
- **Labels now sit on their rule** (like the printed form) instead of floating mid-row.
- **Prompt**: stronger instruction for outer borders (`frames`), blank widths (`wNN`, measured), example `fill_pct` 95 (was 60).
- **Deploy (four files change this time, including the engine):** (1) Cloudflare: replace the Worker code with the new `form-scanner-proxy-worker.js` and Deploy (no new secret needed). (2) GitHub: replace `form-scanner.html`, `form-scanner.js` and **`form-scanner-engine.js`** (the engine changed, don't skip it). (3) Hard refresh the page (Ctrl+F5). Script versions bumped: `form-scanner.js?v=4`, `form-scanner-engine.js?v=2`.
- **New settings** (top of `form-scanner-engine.js`, `FS_CONFIG`): `MIN_IMAGE_EDGE` 1600, `TEXT_COST` 0.5 (usage-cap cost of the wording read; an Auto scan costs 1.5 of the 20 per browser per day).

**Tested.** Engine functions on your two real source pictures (page measured, border detected on Resit and correctly not on Baucar, landscape from the picture), the wording merge on the real Baucar misreads (fixes "BALIC BAYARAN" and the "Surat ... Mkt." address line; flags invented labels), a rendered Resit PDF, the Worker's new modes with mocked Gemini, and the whole page in real Chromium with a mocked Worker (12 checks: enlarge, orientation, border, merge, editor, suggestion click, fallback, PDF raster). **Not tested:** real Qwen/Gemini answers and real pdf.js (no network here); inline PDF preview in headless Chrome.

**Known limits.** The merge fixes small misreads; it cannot repair a structure that was invented from an unreadable picture, so feed it the PDF itself or a large sharp image. Auto-border only when the border encloses almost everything (partial borders are left to the model). Wording read cannot tell which duplicate label is which (identical labels are all treated alike).

**KIV.** Second "structure double-check" pass; Qwen bounding boxes for measured placement; compare Qwen reasoning on/off for speed; check Qwen/OpenRouter data policy before making it the permanent default.


## 2026-10-07 — v6.4: source and output side by side, comparison log by source, tooltips, clean slate on a new file

**Why.** The v6.3 test went well (Qwen structure + Gemini wording confirmed as the approach: structure ~95%, wording ~90-95% even on the poor-quality Baucar source, page size matches the source on Resit). The requests were about the page itself: compare source and output without downloading, make the comparison log usable across files, clear the result when a new file is analysed, and move descriptive text into tooltips.

**What changed.**
- **Source | Output side by side.** Same-size boxes with one shared shape (taken from the source picture before a scan, from the output page after it), so they line up; stacked on phones. The empty source pane doubles as the "choose a file" target.
- **Comparison log.** Collapsible, **open by default**. New **Source** column: thumbnail + file name, one cell spanning every run of that file, so all engines' readings of the same form sit together. The run currently on the right is highlighted ("Showing"). **Show now also brings back that run's own source picture.** Engine names shortened (`qwen3.8-27b (free)`; full id on hover).
- **New file = clean slate.** Choosing a file, or starting a scan, empties the output pane (PDF frame, wording editor, list, download button, header) and shows an idle or busy state. A scan still running for the previous file can no longer paint over the new one (its runs are still logged under the right file, and the fallback engine is not started for it). Download can no longer hand out the previous file's form.
- **Tooltips.** Every description moved into a "?" tooltip (hover, keyboard focus, tap on phones; clamped to the screen). Page-scoped `.fs-tip` + one popover instead of the shared `.tooltip-icon`, because that one is hover-only and hidden under 600px, so phones would have lost every description. **FLAG for central review:** candidate to promote into `styles.css` + a shared script.
- **Source header** now says the picture's real size and whether it was enlarged or reduced for reading (small screenshots are the main cause of misread words).
- **Bugs found in the 2026-10-07 screenshots, fixed:**
  1. An **empty PDF card showed under the source picture** (present since v6.0): the page's `display` rules overrode the `hidden` attribute. `[hidden]{display:none!important}` added.
  2. **Title and Ref. code were flagged "to check"** although they are never printed (e.g. "Lampiran 6 [Ruj. 52 (a)]", a misread "SCF-EIT-WS01"). They are no longer flagged and are labelled as file-name-only in the tooltip. Engine change: `mergeWording` skips band 0 when listing unconfirmed labels.
  3. A **double quote inside a label** cut the wording editor's `value="..."` short (and editing then wrote the short text back). `escapeHTML` now escapes quotes.
  4. Choosing **the same file twice** did nothing (the input kept its value). Now reset.
- **Worker:** header label only, no functional change since v6.3. Redeploying is optional.

**Files and versions.**
| File | Version | Cache-bust in HTML |
|---|---|---|
| `form-scanner.html` | v6.4 | n/a |
| `form-scanner.js` | v6.4 | `?v=5` |
| `form-scanner-engine.js` | v6.4 | `?v=3` |
| `form-scanner-proxy-worker.js` | v6.4 label, functionally v6.3 | n/a |
| `nav-config.js`, `site-config.js`, `styles.css` | unchanged (`styles.css?v=19`) | |

**Tested (headless Chromium, real pdf-lib, Worker mocked, pdf.js stubbed): 52 checks, all pass.** First-load state; hidden attribute really hides; tooltip hover / click-to-pin / keyboard / Escape / stays on screen; file chosen (picture, size text, shared aspect); Auto scan (busy state, blob preview, 3 log rows under one spanning source cell, "Showing" highlight, thumbnail, misread label corrected, invented label flagged, Title/Ref never flagged); log collapses and reopens, and a tooltip inside the summary does not toggle it; second file clears the right side at once; Show on an older run restores its source; scan interrupted by a new file paints nothing but is logged; Qwen failure falls back to Gemini and the failed attempt is logged; PDF source (name, pages, mm, rendered page, Qwen gets the picture, wording read gets the PDF); download is a valid fillable PDF (8 fields, no duplicate names, no field background with Shade off, `qpdf --check` clean); phone viewport (panes stack, tap opens and closes the tooltip on screen); no script errors. Engine unit test for the `mergeWording` change.

**Not tested here:** real Qwen/Gemini answers; real pdf.js rendering of a real PDF (stubbed); the inline PDF viewer (headless Chromium has none, so the Output pane is blank in the test screenshots); Safari / Firefox.

**Deploy.** Replace `form-scanner.html`, `form-scanner.js` and `form-scanner-engine.js` on GitHub (the engine changed, don't skip it), hard-refresh (Ctrl+F5). Worker: nothing to do. Replace `FORM_SCANNER_CHANGE_NOTES.md` and `FORM_SCANNER_SETUP_AND_GLOSSARY.md` (the glossary was refreshed to the current state, it had been stuck at v6.0).

**KIV.**
- Render the generated PDF to a picture (pdf.js) instead of the browser's PDF viewer: pixel-aligned compare, and works on phones that can't show PDFs inline.
- Overlay mode: source semi-transparent over the output with a slider.
- Claude as a third engine in the Worker (`provider: 'claude'`, `ANTHROPIC_API_KEY` secret); worth a trial in the log.
- Bounding-box grounding if proportions are off (e.g. the NO RESIT box is wider than the source).
- Structure is still read-only (only printed wording is editable).
- Promote `.fs-tip` to the shared stylesheet.


## 2026-10-07 — v6.5: Qwen outage handling (404), full errors in the log, plain fallback message

**What prompted this.** Two Auto scans in a row fell back to Gemini and the layout came out bad (1 to 2 sections instead of the 5 Qwen reads on the same form). The comparison log showed why: both Qwen rows were "Failed: That model is not available on OpenRouter right now", after 0.8 s.

**Diagnosis.**
- **Not tokens and not a usage cap.** A scan is roughly 5k tokens in and a few thousand out (our estimate) against a very large context, and a request-cap hit comes back as 429 (the Worker words that differently: "rate-limited"), not 404. It also failed in 0.8 s, before any model work.
- It is an OpenRouter **404 on the free model** `qwen/qwen3.8-27b:free`. The model was still listed on OpenRouter when checked (2026-10-07), so it was not retired. A free model can have no provider for a while ("no endpoints found"), and a 404 is also what OpenRouter returns when the account's privacy settings block free models (two toggles at openrouter.ai/settings/privacy).
- **Which of the two it was could not be told from the log**: the log cut every error at 90 characters, and the Worker's old hint blamed the model id for every 404.
- The Gemini fallback is simply weaker at layout (flash-lite returned 1-2 sections on the form Qwen read as 5).

**What changed.**
- **Worker:** a 404 is retried once after 1.5 s (a free-pool blip often clears). A 404 that mentions the data policy is not retried and now tells you to switch on the two free-endpoint options in OpenRouter's privacy settings. Any other 404 says "no provider for this free model right now" instead of blaming the model id. OpenRouter's own sentence is appended (up to 300 characters), so the cause is visible next time.
- **Page:** the log shows the whole error (hover shows it in full). When Auto falls back, the status line is amber and says Qwen failed, Gemini made this layout, it is usually rougher, and to try again later.
- Engine: version label only.

**Files and versions.**
| File | Version | Cache-bust in HTML |
|---|---|---|
| `form-scanner.html` | v6.5 | n/a |
| `form-scanner.js` | v6.5 | `?v=6` |
| `form-scanner-engine.js` | v6.5 (label only) | `?v=4` |
| `form-scanner-proxy-worker.js` | v6.5, **functional change: redeploy** | n/a |
| `nav-config.js`, `site-config.js`, `styles.css` | unchanged (`styles.css?v=19`) | |

**Tested.** Worker, 6 checks with a mocked fetch: 404 retried once then explained; data-policy 404 not retried; a 404 blip that clears on the retry still returns a result; 402 and 429 unchanged; a very long upstream message is capped. Page: the 52 v6.4 checks plus one for the fallback status and the full error in the log, 53 in headless Chromium, all pass. **Not tested:** the real OpenRouter (no network here), so which of the two 404 causes it was is still unconfirmed.

**Deploy.** Redeploy the **Worker** (paste `form-scanner-proxy-worker.js` into Cloudflare, Deploy). Replace `form-scanner.html`, `form-scanner.js`, `form-scanner-engine.js` on GitHub, hard-refresh (Ctrl+F5). Replace the two `.md` docs.

**To find out which 404 it is.** Scan again: the log row now shows OpenRouter's own sentence. If it mentions the data policy, switch on both free-endpoint options at openrouter.ai/settings/privacy. If it says no endpoints were found, wait a few minutes, or change `OR_MODELS` in the Worker to the paid id `qwen/qwen3.8-27b` (same model, larger pool, needs a little OpenRouter credit).

**KIV.**
- Stronger automatic fallback: test first by ticking Thorough reading while Qwen is down (the fallback then uses `gemini-3.8-flash`); if the layout is clearly better, make that the automatic fallback.
- Optional paid-Qwen fallback inside the Worker (only when the free model has no provider), off by default.
- Second free vision model as a backup (untested, quality unknown).
