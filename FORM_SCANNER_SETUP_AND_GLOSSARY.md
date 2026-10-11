# Form Scanner — Setup & Glossary (current state: v6.6, 2026-10-10)

Companion doc for the Form Scanner page. Read `AI_BUILD_BRIEF.md` first if you haven't touched this site before. What changed and why, round by round: `FORM_SCANNER_CHANGE_NOTES.md`. This file only describes the **current** state.

## What it does

Visitor chooses a photo or a PDF of a printed form. The browser sends one picture to the Worker. In **Auto** mode the best engine that has a key (Qwen3.8-27B on Groq first, Gemini last) reads the layout (a *layout spec*: bands, columns, tables) while **Gemini** reads every printed word at the same time (another engine takes over the wording if Gemini is refused); the page merges the two (the wording read's spelling fixes the layout engine's misreads, labels nothing backs up are flagged amber). **Compare all** sends the same file to every engine that has a key and lists each answer in the comparison log, so the best engine can be chosen on evidence. The result is shown **next to its source** as a live preview of the real PDF, built in the browser with pdf-lib (real AcroForm fields). Nothing about the file, the extracted data or the finished PDF is stored on our side.

Scope on purpose: rebuilds the **blank template** (labels, tables, sign-off blocks, tick boxes), not handwriting already on the page. Built for printed/typed forms. Not for dense handwriting, long prose or heavily designed layouts.

## Files and versions

| File | Version | Notes |
|---|---|---|
| `form-scanner.html` | v6.6 | Page, page-scoped CSS (`fs-` prefix), script tags |
| `form-scanner.js` | v6.6 (`?v=7`) | Page wiring: files, Worker calls, engine list, Auto / Compare all, panes, log, editor, tooltips |
| `form-scanner-engine.js` | v6.6 (`?v=5`) | Layout engine + wording merge + engine planning. No DOM code; runs under Node for tests. v6.6: planning helpers and tunables only, layout/PDF code unchanged |
| `form-scanner-proxy-worker.js` | v6.6 | Cloudflare Worker. Holds every API key. **v6.6 changed it (engine registry): redeploy** |
| `nav-config.js`, `site-config.js`, `styles.css` | unchanged | Shared site files (`styles.css?v=19`) |

File names stay fixed on purpose (the page loads them by name; renaming one would break the page). The version lives in each file's header comment, the badge on the page and the `?v=` numbers: hard-refresh after replacing files.

Script order in the HTML: pdf-lib (CDN, pinned 1.17.1), `site-config.js`, `nav-config.js`, `nav-dropdown.js`, `form-scanner-engine.js`, `form-scanner.js`. pdf.js 3.11.174 is loaded from cdnjs only when a PDF is chosen.

## Deploy steps

1. **Worker** (Cloudflare dashboard → Workers & Pages → your `form-scanner-proxy` Worker → Edit code): select all, paste `form-scanner-proxy-worker.js` → Deploy.
2. **Secrets**: keep `GEMINI_API_KEY` and `OPENROUTER_API_KEY`. Add one secret per extra engine you want (table below): Settings → Variables and Secrets → Add → type *Secret* → exact name → paste the key → Deploy. **No key = that engine stays greyed out on the page; nothing breaks.** Add the keys one engine at a time and reload the page: the engine appears in the list.
3. **Workers AI** (no key at all): Settings → Bindings → Add → Workers AI → variable name `AI` → Deploy.
4. OpenRouter engines only: at openrouter.ai/settings/privacy switch ON both free-endpoint options (may train on request data, may publish prompts); with them off, free OpenRouter requests fail with a 404.
5. `PROXY_ENDPOINT` in `form-scanner-engine.js` (`FS_CONFIG`) must match the Worker's `*.workers.dev` URL.
6. GitHub repo root: add/replace `form-scanner.html`, `form-scanner.js`, `form-scanner-engine.js` (three files). Hard-refresh the page (Ctrl+F5).
7. Nav: `form-scanner.html` reads `nav-config.js` (see `NAV_RETROFIT_HOWTO.md`). Its label there is currently "Form Creator", not "Form Scanner": flagged, not changed.

### Engines (checked against the providers' own docs and a maintained free-API list on 2026-10-10)

| Engine id | Shown as | Secret / binding | Where | Cost | Notes |
|---|---|---|---|---|---|
| `gemini` | Gemini | `GEMINI_API_KEY` | aistudio.google.com | free tier | Reads PDFs directly. Sometimes refused with "User location is not supported" (see Troubleshooting) |
| `groq` | Qwen3.8-27B · Groq | `GROQ_API_KEY` | console.groq.com → API Keys | free plan: 30 requests/min, 1,000/day, **8K tokens/min** | The same Qwen model as before, vision-capable, labelled Preview by Groq. 8K tokens/min means about one scan a minute and about 3.4K tokens for the answer (the Worker shrinks the cap to fit); a dense form can run out of room |
| `qwen` | Qwen3.8-27B · OpenRouter free | `OPENROUTER_API_KEY` | openrouter.ai | OpenRouter says "no longer free" (2026-10-10) | Kept in case the free listing returns |
| `orfree` | OpenRouter free (auto-pick) | `OPENROUTER_API_KEY` | same key | free, limited (about 20 requests/min, 50/day per model) | OpenRouter's own router picks a free model that can read images, so it survives the free list rotating; the log shows which model it picked |
| `mistral` | Mistral Small | `MISTRAL_API_KEY` | console.mistral.ai | free mode (prompts may be used for training unless you opt out) | Good at documents; also the first wording fallback |
| `cfscout` | Llama 4 Scout · Workers AI | binding `AI` | Cloudflare dashboard | 10,000 free "neurons" a day, shared with anything else on Workers AI | Runs inside Cloudflare: no key, no location problem. Meta models may ask you to accept a license once (Workers AI → Playground) |
| `nvllama` | Llama 3.2 90B Vision · NVIDIA | `NVIDIA_API_KEY` | build.nvidia.com (developer account, phone verification) | free, **trial use: do not send personal data** | One NVIDIA key switches on this row and the next |
| `kimi` | Kimi K2.6 · NVIDIA | `NVIDIA_API_KEY` | same | free (via NVIDIA) | Reasoning model, can be slow |
| `deepseek` | DeepSeek V4 Flash Vision | `DEEPSEEK_API_KEY` | platform.deepseek.com | **paid** (a fraction of a cent a scan) | Experimental vision model; off until a key is added |
| `claude` | Claude Haiku 5.5 | `ANTHROPIC_API_KEY` | the Claude Console (docs.claude.com) | **paid**: Anthropic's billing page says API use runs on prepaid credits bought before use; no ongoing free tier | Off until a key is added. One third-party guide mentions a one-time starter credit on new Console accounts; Anthropic's own billing pages do not, so do not count on it |

Model ids are one line each in the Worker's `PROVIDERS`. Free models rotate: a log row saying "model id not found" means update that one id.

## Settings reference

All page/engine tunables live in `FS_CONFIG` at the top of `form-scanner-engine.js`.

| Setting | Value | What it does |
|---|---|---|
| `PROXY_ENDPOINT` | `https://form-scanner-proxy.reysourcez-ent.workers.dev` | Worker URL: confirm it matches yours |
| `MAX_IMAGE_EDGE` / `MIN_IMAGE_EDGE` | `2000` / `1600` px | Longest edge: bigger photos are reduced, smaller screenshots enlarged before sending |
| `JPEG_QUALITY` | `0.9` | Quality of the picture sent |
| `MAX_FILE_MB` | `15` | Bigger uploads rejected in the browser |
| `MAX_SCANS_PER_DAY` | `20` per browser | Soft cap (localStorage) |
| `PRECISE_COST` / `TEXT_COST` | `2` / `0.5` | Cap cost of a Gemini "thorough" scan / of the wording read. One engine counts 1; Auto counts 1.5 |
| `COMPARE_COST_EACH` | `0.5` | Cap cost of each engine that answers in Compare all |
| `AUTO_ORDER` | `['groq','qwen','gemini']` | Auto's structure engines, best first: the first that is set up **and** answers wins. Change it after Compare all shows who is best |
| `WORDING_ORDER` | `['gemini','mistral','cfscout']` | Who reads the printed words in Auto; the next one is tried if the first is refused |
| `SMALL_IMAGE_KB` | `150` | An engine that says "picture too big" gets one retry with a copy this small |
| `ENGINES_FALLBACK` | Qwen (OpenRouter), Gemini | Shown only if the Worker cannot be asked for its engine list |
| `FIELD_TINT` | pale blue-grey | Only used when "Shade fillable fields" is ticked |
| `MIN_FONT_SCALE` | `0.55` | How far text may shrink to fit one page |
| `MAX_FIELDS` | `1500` | Safety cap on fillable fields |
| Worker `PROVIDERS` | see Engines | Registry: one entry per engine (label, url, secret name, model id, flags) |
| Worker `MODELS` | `fast` `gemini-flash-lite-latest`, `precise` `gemini-3.8-flash` | Gemini models |
| Worker `UPSTREAM_TIMEOUT_MS` | `55000` | Per-call timeout |

## Worker contract (for the next AI session)

`POST <PROXY_ENDPOINT>`, JSON body. CORS only for `https://reysourcez.com` and `https://www.reysourcez.com`.

| Request | Reply |
|---|---|
| `{ mode: "engines" }` (no image) | `{ worker, engines: [{ id, label, ready, needs, free }] }`. `ready` = its secret/binding exists. The page builds its Engine list from this |
| `{ image (base64), mime_type, provider?, note?, tier? }` | A layout spec `{ recognized, title, reference_code, page, requested, frames, bands }` + `_meta { provider, model, label, tier, ms, fallback, colo }`. `provider` defaults to `gemini`. `tier` ("fast" / "precise") applies to Gemini only |
| `{ image, mime_type, provider?, mode: "text" }` | `{ lines: [...], _meta }`: a flat list of every printed text item (the wording read). Any engine can do it |
| Any failure | `{ error, code }`: one plain sentence plus the provider's own words (up to 300 characters). Codes: `not_ready`, `unknown_engine`, `pdf_unsupported`, `location`, `retired_free`, `rate_limited`, `image_too_large`, `auth`, `credit`, `policy`, `no_provider`, `not_found`, `bad_request`, `timeout`, `network`, `no_answer`, `bad_json`, `too_long`, `license` |

Only Gemini accepts a PDF directly; every other engine takes a page image (the page renders PDF page 1 with pdf.js first; a PDF sent to another engine gets 415 `pdf_unsupported`). `_meta.colo` is the Cloudflare data center (airport code) that handled the request.

## How the page is laid out

Controls card (file, note, engine, shade, thorough, scan) → status line → **Source | Output** (same-size boxes, shared shape) → download bar and warnings → **Comparison log** (open by default) → **Edit wording** (open) → **What was read** (closed). On phones everything stacks. The **Engine** list is filled in from the Worker: Auto, Compare all (when two or more engines are ready), the ready engines, then the engines that still need a key (greyed out, saying which secret).

## Glossary

- **Layout spec** — the JSON the Worker returns and the engine draws from: `{ title, reference_code, page, requested, frames, bands }`.
- **Band** — one full-width horizontal slice of the form. A **cells** band is side-by-side columns of coded items; a **table** band is a ruled grid.
- **Coded item** — a short string such as `F[box,rl] NAMA :` (`T` text, `F` field, `C` tick boxes, `HR` rule, `SP` spacer + flags). See the Worker's prompt.
- **Engine** — one way of reading the form: a model at a provider (Groq, Gemini, Mistral, …). Defined by one entry in the Worker's `PROVIDERS`; it exists on the page only while its key (or binding) is present.
- **Auto** — the structure engines in `AUTO_ORDER` that are set up, tried in order until one answers, while the wording reader (`WORDING_ORDER`) reads the printed words at the same time; the page merges the two. If every non-Gemini engine fails, Gemini alone makes the layout (usually rougher: 1-2 sections where Qwen finds 5).
- **Compare all** — every ready engine reads the same file at the same time; raw reads, no wording merge, so each is judged on its own. The first answer is shown, the rest sit in the log (Show / PDF). Sends the file to **every** engine that is set up.
- **Wording merge** (`mergeWording`) — matches each label to the closest line the wording reader found and corrects it only when convincing. Labels with no support are **unconfirmed**: shown amber in Edit wording, never silently changed. Title and Ref. code (band 0) are never printed, so never flagged.
- **Source / Output panes** — left = the picture that was scanned (PDF: page 1 rendered); right = the generated PDF in the browser's own viewer. Both boxes share one shape so they line up.
- **Comparison log** — every scan this visit, grouped by source file (thumbnail + name spans the group). Show puts a run next to its own source; PDF downloads it. In memory only.
- **Edit wording** — every printed label as an editable box; the preview follows. Only printed wording is editable (structure is not).
- **Tooltip (`.fs-tip`)** — "?" button with a `data-tip` text; one popover element, fixed-position and clamped to the screen; hover, keyboard focus and tap. Page-scoped on purpose (the shared `.tooltip-icon` is hover-only and hidden under 600px). Candidate to promote to `styles.css`.
- **AcroForm field** — a real interactive PDF box, not text drawn on the page.
- **colo** — the three-letter code of the Cloudflare data center that handled a request (SIN Singapore, KUL Kuala Lumpur, HKG Hong Kong…). Shown in `_meta` and in the "location is not supported" message.

### The two tints people see (confirmed 2026-10-04)

1. **"Shade fillable fields" (checkbox).** Off by default. When off, the PDF's fields carry **no background at all**.
2. **Chrome's and Edge's own PDF viewer** highlights every fillable field on screen by default. It is a viewer setting, not part of the file: it does not show when printed (confirmed: prints colourless) or in Acrobat with highlighting off.

## Troubleshooting: a failed row in the comparison log

The log shows the whole error (hover for the full text): our plain sentence, then the provider's own words.

| What the log says | What it means | What to do |
|---|---|---|
| Gemini: "location is not supported" (names a Cloudflare city code) | Google judges the request by where the **Worker** ran (the Cloudflare data center that handled it), not where you are. Intermittent: some requests land in a data center Google serves, some do not | Try again; use another engine (Auto already hands the wording read to the next engine). Optional, low odds: Worker → Settings → General → Placement → Smart. Exact-region placement is a config-file feature, not in the dashboard (see change notes KIV) |
| Qwen · OpenRouter free: "no longer free" | OpenRouter ended the free listing (seen 2026-10-10); it points at the paid id | Use **Qwen3.8-27B · Groq** (same model, free) or **OpenRouter free (auto-pick)** |
| OpenRouter: "no provider … right now" | A free model has no live provider for a while (the Worker retried once) | Wait a few minutes, or use another engine |
| OpenRouter: "blocking free models for this account" | Privacy settings block free models | openrouter.ai/settings/privacy: switch ON both free-endpoint options |
| "is rate-limited right now" | A free plan's per-minute or per-day cap (Groq free: 30 requests, about 8K tokens a minute) | Wait the time it says (usually a minute), or use another engine |
| "ran out of room" / `too_long` | The answer did not fit. On Groq free about 3.4K tokens are left for it | Dense forms: use another engine |
| "the picture is too big" (after the automatic smaller retry) | The engine refuses even a 150 KB copy | Use a smaller or clearer file, or another engine |
| "model id … was not found" | The provider renamed or retired that model | Update that one id in `PROVIDERS` |
| "rejected the key" | Secret wrong or revoked | Re-add the named secret in the Worker |
| "not set up on the server yet" | No key / binding for that engine | Add the secret (Deploy steps) |
| Workers AI: "daily … allowance … used up" | The 10,000 free neurons are gone | Resets 00:00 UTC |
| Workers AI: "accept this model's license" | One-time Meta license | Workers AI → Playground → pick the model → send any message → accept |
| 402, "credit or free-usage limit" | Out of credit or allowance | Add credit, or use a free engine |

## Known limitations / KIV

- Non-Gemini engines need a picture: PDFs are rendered to a page image in the browser first. If that render fails, only Gemini can read that PDF.
- Only page 1 of a PDF is read. One file in, one form out.
- Free engines are rate-limited and may keep what you send (Gemini free, OpenRouter free, Mistral free mode, NVIDIA trial): test with blank or sample forms. **Compare all sends the file to every engine that is set up.**
- The Worker is public: anyone who finds the URL can spend the shared free quotas (the per-browser daily cap is only a courtesy). A Cloudflare rate-limiting rule or Turnstile is queued.
- Small or blurry sources cause most misread words; use the PDF itself or a large, sharp image.
- Structure is read-only; proportions can be off on some blocks (a box wider than the source).
- Ideas queued in the change notes: choose the default Auto order from Compare all results, PDF-to-picture output preview, overlay compare, bounding boxes, a "wording engine" picker.
