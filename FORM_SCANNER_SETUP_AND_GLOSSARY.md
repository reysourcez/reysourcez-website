# Form Scanner — Setup & Glossary

Companion doc for `form-scanner.html` + `form-scanner-engine.js` + `form-scanner.js` + `form-scanner-proxy-worker.js`, in the same spirit as `MARKET_RADAR_SETUP_AND_GLOSSARY.md`. Read `AI_BUILD_BRIEF.md` first if you haven't touched this site before. For what changed in the v6.0 rebuild and why, see `FORM_SCANNER_CHANGE_NOTES.md` — this file only describes the *current* state.

## What it does

Visitor uploads a photo **or a PDF** of a paper form → Gemini (via the Worker proxy) describes its blank template as a **layout spec** — bands, stacked top-to-bottom, each either a row of side-by-side columns or a table — → the browser renders that back as a plain-English, band-by-band preview → "Download fillable PDF" walks the same spec again and builds an actual PDF with real AcroForm fields, entirely client-side with pdf-lib. No photo/PDF, no extracted data, and no finished PDF ever touches our server — same rule as every other tool here.

**V1 scope, on purpose:** rebuilds the blank template (labels, tables, sign-off blocks, checkboxes) — not any handwriting or filled-in values already on the page. Built for printed/typed forms with clear fields and tables. Not aimed at dense handwriting, long prose, or heavily designed layouts.

## Files

| File | Purpose |
|---|---|
| `form-scanner.html` | Page markup, nav, upload UI, two-column layout on desktop (upload/controls left, detected-structure preview right — single column on mobile, unchanged). |
| `form-scanner-engine.js` | The layout engine: turns the Worker's spec into measurements and pdf-lib drawing calls. No DOM code — also runs under plain Node for testing (`module.exports` at the bottom). |
| `form-scanner.js` | Page wiring only: file selection, the one Worker call, rendering the preview from the engine's normalised spec, the download button. |
| `form-scanner-proxy-worker.js` | Cloudflare Worker — holds the Gemini key, calls `generateContent` with the layout-spec JSON schema, sanitizes the response. |

Splitting the engine out from the page wiring (previously both lived in one `form-scanner.js`) is new in v6.0 — the engine grew too large to keep bundled once it had to model arbitrary layouts instead of a fixed schema. Two script tags now, not one — see Deploy steps.

## Deploy steps

1. Cloudflare dashboard → Workers & Pages → Create → Create Worker. Name it (e.g. `form-scanner-proxy`) → deploy the default template → Edit code → paste in `form-scanner-proxy-worker.js` → Deploy.
2. Settings → Variables and Secrets → Add → Type **Secret** → Name `GEMINI_API_KEY` → paste your key (same Gemini account as the site's other tools is fine) → Save.
3. Copy the Worker's `*.workers.dev` URL and paste it into `PROXY_ENDPOINT` near the top of `form-scanner-engine.js`'s `FS_CONFIG` block (this moved here from `form-scanner.js` in v6.0 — see Settings reference).
4. Add `form-scanner.html`, `form-scanner-engine.js`, `form-scanner.js` to the repo root alongside the other tools; push/merge as usual for GitHub Pages to pick it up. **Three files now, not two** — don't forget `form-scanner-engine.js`.
5. Nav: `form-scanner.html` now reads `nav-config.js` (the retrofit from `NAV_RETROFIT_HOWTO.md` is applied as of v6.0 — its own hand-written `<li>` list is gone). Nothing else to do here; see that file if the dropdown ever needs to change.

## Settings reference

All tunables now live in **one place**: the `FS_CONFIG` object at the top of `form-scanner-engine.js` (the "CONFIG (edit here only)" comment). `form-scanner.js` reads it via `window.FormScannerEngine.FS_CONFIG` rather than keeping its own copy, so there's only one number to change per setting, not two that can drift apart.

| Setting | Current value | What it does |
|---|---|---|
| `PROXY_ENDPOINT` | `https://form-scanner-proxy.reysourcez-ent.workers.dev` | Worker URL the browser calls — **confirm this matches your deployed Worker** |
| `MAX_IMAGE_EDGE` | `2000` px | Longest edge a photo is resized to before sending |
| `MAX_FILE_MB` | `15` | Upload rejected above this, client-side, before it's sent anywhere |
| `MAX_SCANS_PER_DAY` | `20` per browser | Soft usage cap (localStorage); a "more thorough" scan counts as `PRECISE_COST` (`2`) |
| `FIELD_TINT` | pale blue-grey | Only ever used when the person ticks "Shade fillable fields" — colourless by default. See the Glossary entry below on the *separate*, browser-level tint people also see. |
| `MIN_FONT_SCALE` | `0.55` | How far the engine will shrink text to make a dense form fit one page before giving up and just noting it in a warning |
| `MAX_FIELDS` | `1500` | Safety cap on fillable fields per generated PDF |
| `MODELS.fast` / `MODELS.precise` | `gemini-flash-lite-latest` / `gemini-3.8-flash` | In `form-scanner-proxy-worker.js`. The "More thorough reading" checkbox on the page selects `precise`. Verify these are still current models before relying on this doc — Google's model names/aliases move; this was checked against `ai.google.dev/gemini-api/docs/models` on 2026-09-24. |

## Glossary

- **Layout spec** — the JSON shape the Worker returns and the engine draws from: `{ title, reference_code, page, requested, frames, bands }`. Replaces v4.3's fixed `header_fields` / `tables` / `signature_blocks` arrays. See "The layout spec" below.
- **Band** — one full-width horizontal slice of the form, top to bottom (a title block, a row of fields, a table, a signature area, ...). A form is just a stack of bands.
- **Cells band vs. table band** — a *cells* band is one or more side-by-side columns, each holding a stack of items (the general case: arbitrary boxed sections, two-column layouts, a signature area). A *table* band is a ruled grid with column headers and blank/printed rows (the previous tool's only shape, now one of two).
- **Coded item** — a band's content, item by item, as a short string like `F[box,rl] NAMA :` (see the Worker's own prompt for the full code list: `T` text, `F` field, `C` checkboxes, `HR` rule, `SP` spacer, with flags for bold/size/alignment/blank-style/width). The engine parses these; the preview panel shows them back in plain English so a misread label is obvious before download.
- **AcroForm field** — an actual interactive PDF form field (a real clickable/typeable box), not just text drawn on the page. What makes the output "fillable" rather than a flat scan.
- **Structured output / responseSchema** — Gemini feature that forces its reply into a specific JSON shape (`FORM_SCHEMA` in the Worker) instead of free-text that has to be parsed and hoped for. The Worker falls back to a schema-free / thinking-free request automatically if Gemini rejects the schema as too complex for a given form — see the "attempt ladder" in the Worker code.
- **Tier (`fast` / `precise`)** — which Gemini model reads the form. `fast` (`gemini-flash-lite-latest`) is the default; the "More thorough reading" checkbox switches to `precise` (`gemini-3.8-flash`) for a denser or more unusual form, at roughly double the usage-cap cost.

### The two tints people see, and why they're different things

This has come up enough to spell out clearly, because they look similar but have nothing to do with each other:

1. **"Shade fillable fields with a light tint" (the checkbox on this page).** Off by default. When off, the generated PDF's fields carry **no background at all** — confirmed by inspecting the field's own `/MK` appearance dictionary directly, not just eyeballing a preview (see `FORM_SCANNER_CHANGE_NOTES.md` for how this was checked). When a person still sees a pale tint on screen with this box unchecked, it's almost always cause 2, below.
2. **Chrome's and Edge's own PDF viewer highlighting every fillable field.** Both browsers' built-in PDF viewers highlight interactive form fields on screen by default — a pale blue-grey box over every field — as a "here's where you can type" aid, the same way Adobe Acrobat, Xodo and most other PDF viewers do. It's a viewer preference, not something the PDF file controls, and (unlike Acrobat) Chrome/Edge don't currently expose an in-viewer toggle for it. It **does not appear when the PDF is printed** and does not appear in Acrobat with its own highlighting turned off. `form-scanner.html` now says this directly under the checkbox so it doesn't need re-explaining each time someone notices it.

## Known limitations / KIV

- **No visual PDF thumbnail preview yet.** Choosing a PDF shows its real page count and exact page size (read client-side with pdf-lib) instead of a thumbnail — accurate, and enough to catch a wrong-page-size problem immediately, but not a picture of the page. A true thumbnail needs `pdf.js`, and its current CDN build could not be verified from the environment this round was built in (no network access to actually load and test it — the previously-installed local copy turned out to be `pdfjs-dist@5.6.205`, which ships ES-module-only builds, a different loading pattern from every other script on this site). Worth picking up in a session that can load and test a real cdnjs URL end-to-end before shipping it.
- Complex forms can still get flattened where the source truly has no clean band/column equivalent — but this is now a much narrower case than before, since arbitrary side-by-side columns, boxed sub-sections and mixed table/non-table content are all representable in the spec directly (see `FORM_SCANNER_CHANGE_NOTES.md` for the before/after on this).
- The structure preview is read-only. If Gemini misreads a label, table column, or row count, the fix today is a clearer retake/rescan or a note in the guidance box, not an inline correction.
- One photo or one PDF page (page 1) in → one form out. A multi-page PDF is accepted but only its first page is read; the page shows a note when this applies.
- `nav-config.js` currently labels this page's nav entry "Form Creator", not "Form Scanner" — flagged, not changed, since that file isn't this page's to edit (per `NAV_RETROFIT_HOWTO.md`). Worth confirming whether that's an intentional rename.
