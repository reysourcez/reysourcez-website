# Form Scanner — Setup & Glossary (current state: v6.4, 2026-10-04)

Companion doc for the Form Scanner page. Read `AI_BUILD_BRIEF.md` first if you haven't touched this site before. What changed and why, round by round: `FORM_SCANNER_CHANGE_NOTES.md`. This file only describes the **current** state.

## What it does

Visitor chooses a photo or a PDF of a printed form. The browser sends one picture to the Worker. In **Auto** mode, **Qwen** reads the layout (a *layout spec*: bands, columns, tables) while **Gemini** reads every printed word at the same time; the page merges the two (Gemini's spelling fixes Qwen's misreads, labels nothing backs up are flagged amber). The result is shown **next to its source** as a live preview of the real PDF, built in the browser with pdf-lib (real AcroForm fields). Nothing about the file, the extracted data or the finished PDF is stored on our side.

Scope on purpose: rebuilds the **blank template** (labels, tables, sign-off blocks, tick boxes), not handwriting already on the page. Built for printed/typed forms. Not for dense handwriting, long prose or heavily designed layouts.

## Files and versions

| File | Version | Notes |
|---|---|---|
| `form-scanner.html` | v6.4 | Page, page-scoped CSS (`fs-` prefix), script tags |
| `form-scanner.js` | v6.4 (`?v=5`) | Page wiring: files, Worker calls, panes, log, editor, tooltips |
| `form-scanner-engine.js` | v6.4 (`?v=3`) | Layout engine + wording merge. No DOM code; runs under Node for tests |
| `form-scanner-proxy-worker.js` | functionally v6.3 | Cloudflare Worker. Holds both API keys. v6.4 changed only its header label |
| `nav-config.js`, `site-config.js`, `styles.css` | unchanged | Shared site files (`styles.css?v=19`) |

Script order in the HTML: pdf-lib (CDN, pinned 1.17.1), `site-config.js`, `nav-config.js`, `nav-dropdown.js`, `form-scanner-engine.js`, `form-scanner.js`. pdf.js 3.11.174 is loaded from cdnjs only when a PDF is chosen.

## Deploy steps

1. **Worker** (Cloudflare dashboard → Workers & Pages → your `form-scanner-proxy` Worker → Edit code): paste `form-scanner-proxy-worker.js` → Deploy.
2. **Secrets** (Settings → Variables and Secrets → Secret): `GEMINI_API_KEY` and `OPENROUTER_API_KEY` (Qwen goes through OpenRouter).
3. `PROXY_ENDPOINT` in `form-scanner-engine.js` (`FS_CONFIG`) must match the Worker's `*.workers.dev` URL.
4. GitHub repo root: add/replace `form-scanner.html`, `form-scanner.js`, `form-scanner-engine.js` (three files). Hard-refresh the page (Ctrl+F5).
5. Nav: `form-scanner.html` reads `nav-config.js` (see `NAV_RETROFIT_HOWTO.md`). Its label there is currently "Form Creator", not "Form Scanner": flagged, not changed.

## Settings reference

All page/engine tunables live in `FS_CONFIG` at the top of `form-scanner-engine.js`.

| Setting | Value | What it does |
|---|---|---|
| `PROXY_ENDPOINT` | `https://form-scanner-proxy.reysourcez-ent.workers.dev` | Worker URL: confirm it matches yours |
| `MAX_IMAGE_EDGE` / `MIN_IMAGE_EDGE` | `2000` / `1600` px | Longest edge: bigger photos are reduced, smaller screenshots enlarged before sending |
| `JPEG_QUALITY` | `0.9` | Quality of the picture sent |
| `MAX_FILE_MB` | `15` | Bigger uploads rejected in the browser |
| `MAX_SCANS_PER_DAY` | `20` per browser | Soft cap (localStorage) |
| `PRECISE_COST` / `TEXT_COST` | `2` / `0.5` | Cap cost of a Gemini "thorough" scan / of the wording read (an Auto scan counts 1.5) |
| `FIELD_TINT` | pale blue-grey | Only used when "Shade fillable fields" is ticked |
| `MIN_FONT_SCALE` | `0.55` | How far text may shrink to fit one page |
| `MAX_FIELDS` | `1500` | Safety cap on fillable fields |
| Worker `MODELS` | `fast` `gemini-flash-lite-latest`, `precise` `gemini-3.8-flash` | Gemini models |
| Worker `OR_MODELS` | `qwen` `qwen/qwen3.8-27b:free` | Qwen via OpenRouter (rate-limited free variant) |
| Worker `UPSTREAM_TIMEOUT_MS` | `55000` | Per-call timeout |

## How the page is laid out

Controls card (file, note, engine, shade, thorough, scan) → status line → **Source | Output** (same-size boxes, shared shape) → download bar and warnings → **Comparison log** (open by default) → **Edit wording** (open) → **What was read** (closed). On phones everything stacks.

## Glossary

- **Layout spec** — the JSON the Worker returns and the engine draws from: `{ title, reference_code, page, requested, frames, bands }`.
- **Band** — one full-width horizontal slice of the form. A **cells** band is side-by-side columns of coded items; a **table** band is a ruled grid.
- **Coded item** — a short string such as `F[box,rl] NAMA :` (`T` text, `F` field, `C` tick boxes, `HR` rule, `SP` spacer + flags). See the Worker's prompt.
- **Engine / Auto** — Auto = Qwen (structure) + Gemini (wording, `mode: "text"`) in parallel, merged by the page; Gemini alone takes over if Qwen fails. Qwen-only and Gemini-only exist for comparison.
- **Wording merge** (`mergeWording`) — matches each label to the closest line Gemini read and corrects it only when convincing. Labels with no support are **unconfirmed**: shown amber in Edit wording, never silently changed. Title and Ref. code (band 0) are never printed, so never flagged.
- **Source / Output panes** — left = the picture that was scanned (PDF: page 1 rendered); right = the generated PDF in the browser's own viewer. Both boxes share one shape so they line up.
- **Comparison log** — every scan this visit, grouped by source file (thumbnail + name spans the group). Show puts a run next to its own source; PDF downloads it. In memory only.
- **Edit wording** — every printed label as an editable box; the preview follows. Only printed wording is editable (structure is not).
- **Tooltip (`.fs-tip`)** — "?" button with a `data-tip` text; one popover element, fixed-position and clamped to the screen; hover, keyboard focus and tap. Page-scoped on purpose (the shared `.tooltip-icon` is hover-only and hidden under 600px). Candidate to promote to `styles.css`.
- **AcroForm field** — a real interactive PDF box, not text drawn on the page.

### The two tints people see (confirmed 2026-10-04)

1. **"Shade fillable fields" (checkbox).** Off by default. When off, the PDF's fields carry **no background at all**.
2. **Chrome's and Edge's own PDF viewer** highlights every fillable field on screen by default. It is a viewer setting, not part of the file: it does not show when printed (confirmed: prints colourless) or in Acrobat with highlighting off.

## Known limitations / KIV

- Qwen needs a picture: PDFs are rendered to a page image in the browser first. If that render fails, only Gemini can read that PDF.
- Only page 1 of a PDF is read. One file in, one form out.
- Free Qwen via OpenRouter is rate-limited, can be slow (up to ~2 minutes seen) and may keep what you send: test with blank or sample forms; check the data policy before making it the permanent default.
- Small or blurry sources cause most misread words; use the PDF itself or a large, sharp image.
- Structure is read-only; proportions can be off on some blocks (a box wider than the source).
- Ideas queued in the change notes: PDF-to-picture output preview, overlay compare, Claude as a third engine, bounding boxes.
