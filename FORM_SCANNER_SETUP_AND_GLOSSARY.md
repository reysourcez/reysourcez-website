# Form Scanner — Setup & Glossary

Companion doc for `form-scanner.html` + `form-scanner.js` + `form-scanner-proxy-worker.js`, in the same spirit as `MARKET_RADAR_SETUP_AND_GLOSSARY.md`. Read `AI_BUILD_BRIEF.md` first if you haven't touched this site before. For what changed in the most recent round and why, see `FORM_SCANNER_CHANGE_NOTES.md`.

## What it does

Visitor photographs a paper form, or uploads a PDF, → Gemini (via the Worker proxy) describes its blank template structure as JSON → the browser renders that back as a plain-English preview → "Download fillable PDF" walks the same JSON again and builds an actual PDF with real AcroForm fields, entirely client-side with pdf-lib. No photo/PDF, no extracted data, and no finished PDF ever touches our server — same rule as every other tool here.

**By default, the output matches the source's own page size, orientation, and form structure.** For a real PDF, the browser reads its exact page dimensions directly (no guessing). For a photo, the browser detects orientation from the image itself and Gemini gives its best-effort guess at the paper size. A note typed before scanning can explicitly ask for a different size, orientation, font, or text scale — see "render_directives" in the Glossary.

**Fillable fields are colorless by default.** A checkbox on the upload panel ("Shade fillable fields with a light tint") turns on a light tint matching the site's own `--accent-soft` token; left unchecked (the default), no background is written into the field at all.

**V1 scope, on purpose:** rebuilds the blank template (labels, table headers, row counts, sign-off blocks) — not any handwriting or filled-in values already on the page. Built for printed/typed forms with clear fields and tables (registers, checklists, intake sheets, vouchers). Not aimed at dense handwriting, long prose, or heavily designed layouts. Only the first page of a multi-page PDF is scanned. See KIV list below.

## Files

| File | Purpose |
|---|---|
| `form-scanner.html` | Page markup, nav, upload UI (image or PDF), results preview. |
| `form-scanner.js` | Image resize / PDF page-1 extraction, geometry detection, Worker call, preview rendering, pdf-lib PDF build, download. |
| `form-scanner-proxy-worker.js` | Cloudflare Worker — holds the Gemini key, calls `generateContent` with a structured JSON schema, sanitizes the response. |

If you have a `form-scanner-worker.js` (no `-proxy-`) or an alternate `form-scanner.html` with its own inline theme from an earlier round, those are superseded by the three files above — remove them from the repo to avoid confusion about which is current.

## Deploy steps

1. This reuses the **existing** `form-scanner-proxy` Worker — no need to create a new one. Cloudflare dashboard → Workers & Pages → your `form-scanner-proxy` Worker → Edit code → replace everything with `form-scanner-proxy-worker.js` → Deploy.
2. Settings → Variables and Secrets → confirm `GEMINI_API_KEY` is still set (Type: Secret). Unchanged from before if it's already there.
3. `PROXY_ENDPOINT` in `form-scanner.js` is unchanged (`form-scanner-proxy.reysourcez-ent.workers.dev`) — only touch it if you ever rename the Worker itself.
4. Add/replace `form-scanner.html`, `form-scanner.js` in the repo root alongside the other tools; push/merge as usual for GitHub Pages to pick it up.
5. Nav: this page now reads the "Business Analysis" dropdown live from `nav-config.js`'s `RZ_NAV_PAGES` (see `SITE_CONFIG_STANDARD.md`) rather than a hardcoded list — no other page needs editing for this page's nav entry to appear correctly. **Flag for you to confirm:** `nav-config.js` currently labels this page's entry "Form Creator", not "Form Scanner" — see the note at the top of the KIV list below.

## Settings reference

| Setting | Where | Current value | What it does |
|---|---|---|---|
| `PROXY_ENDPOINT` | form-scanner.js | `form-scanner-proxy.reysourcez-ent.workers.dev` | Worker URL the browser calls |
| `MAX_IMAGE_EDGE` | form-scanner.js | `1280` px | Longest edge a photo is resized to before sending |
| `MAX_PDF_BYTES` | form-scanner.js | 25 MB | Guard so a very large PDF upload doesn't hang the browser while pdf-lib loads it client-side |
| `MAX_SCANS_PER_DAY` | form-scanner.js | `20` per browser | Soft usage cap (localStorage), same pattern as Food Worth / Market Radar |
| `FIELD_TINT_RGB` | form-scanner.js | matches `--accent-soft` | The light tint applied to fields only when the "Shade fillable fields" checkbox is on. Off by default — see below. |
| `STANDARD_SIZES` | form-scanner.js | A3 / A4 / A5 / Letter / Legal | Reference paper sizes in points, used whenever the app can't read an exact size from a real source PDF (i.e. for a photo, or when a note explicitly asks for a named size) |
| `GEMINI_MODEL` | form-scanner-proxy-worker.js | `gemini-flash-lite-latest` | Verified 2026-09-22 against Google's current docs — see the "Model choice" entry in the Glossary |
| `ALLOWED_ORIGINS` | form-scanner-proxy-worker.js | `reysourcez.com`, `www.reysourcez.com` | CORS allowlist |

**On field color:** pdf-lib only writes a field's background when a `backgroundColor` is actually passed to `addToPage()` — unlike reportlab (used for this project's earlier one-off scripts), which was found to silently default to a pale-blue fill even when told `fillColor=None`. So the default (checkbox unchecked) is genuinely colorless — no `/MK /BG` entry written at all — not just a pale color that happens to look white.

## Glossary

- **AcroForm field** — an actual interactive PDF form field (a real clickable/typeable box, or an actual checkbox), not just text drawn on the page. What makes the output "fillable" rather than a flat scan.
- **Structured output / responseSchema** — Gemini feature that forces its reply into a specific JSON shape (defined in `FORM_SCHEMA` in the Worker) instead of free-text that has to be parsed and hoped for.
- **Flat(-ish) schema** — `FORM_SCHEMA` uses parallel arrays (header_fields / tables / reference_tables / signature_blocks, plus title/reference_code/etc.) rather than one generic nested "blocks" tree. More reliable for the model to fill in correctly; every field added for extra fidelity (column position, column groups, relative column widths) is optional with a safe fallback, so a richer schema never becomes all-or-nothing. A prior round that pushed further toward a fully generic shape in one go stopped scanning reliably and was abandoned — this schema deliberately stays short of that line.
- **Model choice** — `gemini-flash-lite-latest` was re-verified on 2026-09-22 directly against Google's current API docs, not assumed. Two things confirmed: the `-latest` alias pattern (auto-tracks the newest release of a given model tier, e.g. Google's own worked example is `gemini-flash-latest`) is real and current, so this doesn't need manual bumping as Google deprecates specific dated models; and the classic `generateContent` endpoint this Worker uses — as opposed to Google's newer "Interactions API" — is explicitly still Google's own recommended path for production ("remains fully supported... we will continue to actively develop and maintain it"), even though Interactions is now GA for other use cases. This also explains an odd bit of this project's own history: an earlier attempt at the Interactions API shape caused errors and was reverted (see the Worker file's own header comment) — Google's docs confirm that API was, and still partly is, flagged as subject to breaking changes, so reverting to the stable classic endpoint was and is the right call.
- **Orientation detection** — for a real PDF, read directly from the page's own dimensions (`width > height` = landscape). For a photo, read from the uploaded image's natural pixel dimensions before any resizing. Neither needs Gemini; both happen client-side.
- **`page_size_guess`** — Gemini's own best-effort guess at the source's paper size, used only when the source is a photo (a real PDF's exact size is always used instead). "unsure" if there's no confident signal, in which case the app falls back to A4.
- **`render_directives`** — a small object Gemini returns alongside the structure, populated **only** from an explicit request in the note typed before scanning (e.g. "make this A5 landscape", "bigger font", "use a serif font"). Every field defaults to `"auto"` (or `100` for `font_scale_pct`) when nothing was asked for, meaning "keep the source's own size/orientation/font." This is the "AI prompter" for forcing a different output format — it's Gemini reading the note, not a separate UI control, so it understands a full sentence rather than needing exact keywords.
- **Auto-scale** — font sizes, margins, and row heights all scale together relative to the resolved output page size (via a `SCALE` factor computed once per build), so a smaller page (e.g. A5) doesn't end up with A4-sized text overflowing everywhere. Area-based: same area as A4 (e.g. A4 landscape) scales 1×, half the area (A5) scales to ≈0.71×, and anything bigger than A4 is capped at 1× rather than scaled up — more paper should mean more breathing room, not bigger text.
- **`column_groups`** — an optional two-row table header, for a group label (e.g. "TUNAI") that sits over two or more of the columns below it (e.g. "Masuk" / "Keluar"). Falls back to an ordinary single-row header if the model's spans don't add up to the column count.
- **`columns_width_pct`** — the model's estimate of each table column's width as a percentage of the table's total width, used to size columns proportionally to the source instead of splitting them evenly. Falls back to the older header-text-length heuristic if the array is missing, the wrong length, or doesn't roughly sum to 100.
- **`reference_tables`** — a table that's already-printed reference/lookup information (e.g. an approval-threshold table) rather than something to fill in. Rendered as plain text in a bordered grid, no fields.
- **Multi-column header fields / signature blocks** — a `column` number (1, 2, 3...) on each header field or signature block lets forms with a genuinely side-by-side layout (a payment-voucher header, three signature blocks in a row) render that way instead of everything being forced into one stacked column.

## Known limitations / KIV

- **Naming: "Form Scanner" vs. "Form Creator".** This page's own title/branding, this doc, and the file names all say "Form Scanner" — but `nav-config.js`'s current `RZ_NAV_PAGES` entry for `form-scanner.html` is labelled "Form Creator". Not changed by this round (that's a shared, cross-page file); flagging it as likely drift rather than guessing which name is the intended one. Worth a one-line fix in `nav-config.js` once you confirm which name you want the dropdown to show.
- Only page 1 of a multi-page PDF is scanned/rebuilt. Turning a multi-page source into a matching multi-page fillable output (rather than just the first form) is a real, separate feature, not built this round.
- Complex multi-section forms with repeating "label + several blank columns" rows still get flattened into the closest table shape rather than reproduced exactly — better than before (column groups + relative widths help), still not pixel-perfect.
- Checkbox-style option fields (e.g. a payment-method choice) always render full-width, stacked after the plain header fields, regardless of which column Gemini assigned them to — a deliberate simplification for reliable text wrapping, not a bug. Positioning them exactly in place is a KIV.
- A header-fields or signature-blocks block that's genuinely laid out in more than one column doesn't paginate mid-block — the app makes a rough space estimate before starting one so it's unlikely to matter in practice, and logs a console warning if a build ever does overflow, but a note asking for a larger page size is the workaround today rather than automatic mid-block page-splitting.
- Standard-14 PDF fonts (Helvetica/Times/Courier) can't encode characters outside roughly Latin-1 — a label in Jawi, Chinese, or similar non-Latin script currently gets blanked out rather than mis-rendered. Embedding a real Unicode font via pdf-lib's `fontkit` plugin would fix this properly but adds a real dependency and a sizeable font file; flagged, not built.
- The structure preview is read-only. If Gemini misreads a column header or row count, the fix today is a clearer retake/rescan or a note, not an inline correction.
- Column widths and group spans are still the model's *estimate*, not true measured bounding boxes from the source image — good enough for "looks proportionally right," not pixel-exact. A specialised layout/OCR model could in principle supply real bounding-box data for this, at the cost of needing GPU-backed server infrastructure this site doesn't currently have (see `FORM_SCANNER_CHANGE_NOTES.md` for the evaluation of one such model considered this round).
