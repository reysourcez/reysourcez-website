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
