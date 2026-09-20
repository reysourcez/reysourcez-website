# Form Scanner — Setup & Glossary

Companion doc for `form-scanner.html` + `form-scanner.js` + `form-scanner-proxy-worker.js`, in the same spirit as `MARKET_RADAR_SETUP_AND_GLOSSARY.md`. Read `AI_BUILD_BRIEF.md` first if you haven't touched this site before.

## What it does

Visitor photographs a paper form → Gemini (via the Worker proxy) describes its blank template structure as JSON → the browser renders that back as a plain-English preview → "Download fillable PDF" walks the same JSON again and builds an actual PDF with real AcroForm fields, entirely client-side with pdf-lib. No photo, no extracted data, and no finished PDF ever touches our server — same rule as every other tool here.

**V1 scope, on purpose:** rebuilds the blank template (labels, table headers, row counts, sign-off blocks) — not any handwriting or filled-in values already on the page. Built for printed/typed forms with clear fields and tables (registers, checklists, intake sheets). Not aimed at dense handwriting, long prose, or heavily designed layouts. See KIV list below.

## Files

| File | Purpose |
|---|---|
| `form-scanner.html` | Page markup, nav, upload UI, results preview. |
| `form-scanner.js` | Image resize, Worker call, preview rendering, pdf-lib PDF build, download. |
| `form-scanner-proxy-worker.js` | Cloudflare Worker — holds the Gemini key, calls `generateContent` with a structured JSON schema, sanitizes the response. |

## Deploy steps

1. Cloudflare dashboard → Workers & Pages → Create → Create Worker. Name it (e.g. `form-scanner-proxy`) → deploy the default template → Edit code → paste in `form-scanner-proxy-worker.js` → Deploy.
2. Settings → Variables and Secrets → Add → Type **Secret** → Name `GEMINI_API_KEY` → paste your key (the same one `food-worth-proxy-worker.js` already uses is fine, same Gemini account) → Save.
3. Copy the Worker's `*.workers.dev` URL and paste it into `PROXY_ENDPOINT` near the top of `form-scanner.js`.
4. Add `form-scanner.html`, `form-scanner.js` to the repo root alongside the other tools; push/merge as usual for GitHub Pages to pick it up.
5. Nav: `form-scanner.html` already appends as item 10 of the Business Analysis dropdown in its own markup. Other pages' nav still need the same 10th line added whenever nav gets reconciled centrally (see updated `NAV_ORDER_STANDARD.md`) — this file doesn't try to patch every existing page itself, matching how Rental Calculator and Market Radar were rolled out.

## Settings reference

| Setting | Where | Current value | What it does |
|---|---|---|---|
| `PROXY_ENDPOINT` | form-scanner.js | placeholder — **must be set after step 3 above** | Worker URL the browser calls |
| `MAX_IMAGE_EDGE` | form-scanner.js | `1280` px | Longest edge the photo is resized to before sending |
| `MAX_SCANS_PER_DAY` | form-scanner.js | `20` per browser | Soft usage cap (localStorage), same pattern as Food Worth / Market Radar |
| `FIELD_BACKGROUND_COLOR` | form-scanner.js | `null` (colorless) | Background fill for every generated PDF field — see note below |
| `GEMINI_MODEL` | form-scanner-proxy-worker.js | `gemini-flash-lite-latest` | Matches the rest of the site's default |
| `ALLOWED_ORIGINS` | form-scanner-proxy-worker.js | `reysourcez.com`, `www.reysourcez.com` | CORS allowlist |

**On `FIELD_BACKGROUND_COLOR`:** confirmed by inspecting a generated PDF's own field-appearance dictionary directly (not just eyeballing a preview) that reportlab — used for this project's earlier one-off `Borang_Daftar_Aset_Alih.pdf` — silently defaults every text field to a pale-blue fill even when told `fillColor=None`; only `colors.transparent` actually writes an empty background. That script has been fixed the same way. pdf-lib (what this tool uses) doesn't share that behavior — it only sets a background when one is explicitly passed — so leaving this `null` should already mean colorless by default, but that half hasn't been checked against the real library in an actual browser yet (this build environment has no network to load pdf-lib). Worth opening a downloaded PDF's fields once after deploying to confirm; if a tint ever turns up, that's the constant to fix.

## Glossary

- **AcroForm field** — an actual interactive PDF form field (a real clickable/typeable box), not just text drawn on the page. What makes the output "fillable" rather than a flat scan.
- **Structured output / responseSchema** — Gemini feature that forces its reply into a specific JSON shape (defined in `FORM_SCHEMA` in the Worker) instead of free-text that has to be parsed and hoped for.
- **Flat schema** — `FORM_SCHEMA` uses four parallel arrays (header_fields / tables / signature_blocks, plus title/reference_code) rather than one generic nested "blocks" tree. More reliable for the model to fill in correctly; the tradeoff is it can't perfectly capture every possible layout (see KIV).

## Known limitations / KIV

- Complex multi-section forms with repeating "label + several blank columns" rows (e.g. a Penyimpanan/Pemeriksaan-style block) get flattened into the closest table shape rather than reproduced exactly — usable, not pixel-perfect.
- The structure preview is read-only in V1. If Gemini misreads a column header or row count, the fix today is a clearer retake and rescan, not an inline correction.
- No Word/.docx output yet — fillable PDF only.
- No multi-page source photos yet (one photo in → one form out).
