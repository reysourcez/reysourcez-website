# SOP Creator — Setup & Reference

Three files, same split as every other AI-powered tool on this site:

| File | Runs where | What it does |
|---|---|---|
| `sop-creator.html` | Visitor's browser | The page itself — wizard, editable document, translate panel |
| `sop-creator.js` | Visitor's browser | All page logic: rows, assembling the document, calling the Worker |
| `sop-creator-proxy-worker.js` | Cloudflare (your account) | The only thing allowed to hold the Gemini key |

Drop the first two into the same folder as every other page on the site. The Worker deploys separately, to Cloudflare — see below.

## What this tool does, in one paragraph

A business describes a process in their own words (out of order, informal — that's fine). Gemini organizes it into a proper SOP — Purpose, Scope, Definitions, Responsibilities, numbered Procedure, Records, and a Revision History — and suggests which recognized standard(s) it looks like it should align with (ISO 9001, HACCP, ISO 27001, and so on, not limited to food & beverage). Every field it fills in is a normal, editable input — nothing is locked, and anything Gemini filled in as a reasonable guess rather than something the business actually said gets tagged **[assumed]** so it's never quietly indistinguishable from a real statement. The finished document translates into other languages on request. Nothing is saved anywhere; download or print (Save as PDF) to keep a copy, same as every other tool here.

## Deploying the Worker

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages → Create → Create Worker**. Name it (e.g. `sop-creator-proxy`), deploy the default template, then **Edit code**, replace everything with `sop-creator-proxy-worker.js`'s contents, **Deploy**.
2. **Settings → Variables and Secrets → Add**, as **Secret**: `GEMINI_API_KEY`. The same key every other tool's Worker already uses is fine here too — Google doesn't limit a key to one Worker; a separate key is only worth it if you specifically want this tool's usage tracked apart from the others.
3. Update `ALLOWED_ORIGINS` in the Worker to your real domain(s) if they ever differ from `reysourcez.com` / `www.reysourcez.com`.
4. Copy the Worker's `*.workers.dev` URL and paste it into `PROXY_ENDPOINT` near the top of `sop-creator.js` (it currently holds a guessed placeholder in the same naming style as every other Worker on this site — replace it with your real one).

No other setup needed — this tool makes no other external calls.

## Settings reference

Everything below lives inside `sop-creator.js`'s own `CONFIG` section — there's no separate settings file yet for this tool (matching the honest state of every other tool here; a real "edit without touching code" config file would be a genuinely separate, bigger change, not something folded in silently here). This table is the literal "current value / where to change it" sheet:

| Setting | Current value | Where to change it |
|---|---|---|
| Industries offered in the wizard, and each one's starting standards | 13 categories — see the list below | `INDUSTRIES`, `sop-creator.js` |
| Standards autocomplete list | Union of every industry's defaults + ISO 31000, ISO 22301, GMP, HACCP | `STANDARDS_LIBRARY`, `sop-creator.js` (built automatically from `INDUSTRIES`, plus the few extras listed directly in the code) |
| Languages offered for translation | 17 — Malaysian languages first, then a broader spread; see the list below | `LANGUAGES`, `sop-creator.js` |
| Daily drafting limit per browser (draft + translate calls combined) | 15 | `MAX_ANALYSES_PER_DAY`, `sop-creator.js` |
| Cloudflare Worker URL the browser calls | Placeholder — must be replaced after deploy | `PROXY_ENDPOINT`, `sop-creator.js` |
| Websites allowed to call the Worker (CORS) | `reysourcez.com`, `www.reysourcez.com` | `ALLOWED_ORIGINS`, `sop-creator-proxy-worker.js` |
| Gemini model used | `gemini-flash-lite-latest` | `GEMINI_MODEL`, `sop-creator-proxy-worker.js` |
| Instructions Gemini follows when drafting | See `DRAFT_PROMPT_PREFIX` | `sop-creator-proxy-worker.js` |
| Instructions Gemini follows when translating | See `TRANSLATE_PROMPT_PREFIX` | `sop-creator-proxy-worker.js` |

**Industries and their starting standards, as shipped:** Food & Beverage (ISO 22000, HACCP, Halal MS 1500) · Manufacturing/Production (ISO 9001, ISO 45001, GMP) · Construction/Trades (ISO 45001, ISO 9001) · Healthcare/Clinics (ISO 9001, ISO 13485) · IT/Software (ISO/IEC 27001, ISO/IEC 20000-1) · Retail/E-commerce (ISO 9001) · Logistics/Warehousing (ISO 9001, ISO 28000) · Professional Services/Finance/Admin (ISO 9001, ISO/IEC 27001) · Education/Training (ISO 21001) · Agriculture/Farming (GAP, ISO 22000) · Events/Hospitality (ISO 9001) · Environmental/Sustainability (ISO 14001) · Other/General (ISO 9001).

**Languages, as shipped:** Bahasa Malaysia, Simplified Chinese, Traditional Chinese, Tamil, English, Indonesian, Tagalog (Filipino), Thai, Vietnamese, Arabic, Hindi, Spanish, French, Portuguese, German, Japanese, Korean.

## A deliberate limit worth knowing: nothing persists

Matching this whole site's own non-negotiable ("nothing is saved" — see `AI_BUILD_BRIEF.md`), this tool does **not** save, list, or manage multiple SOPs across visits. Close the tab and an unsaved draft is gone; downloading (.txt) or Save as PDF is the only way to keep one, exactly like every calculator on this site. This is a real limitation for an SOP tool specifically — most businesses will want to build up a library of SOPs and revise them over months, not draft one per sitting. Doing that properly needs actual accounts and a real database (which is also the point at which the Cloudflare-Worker-as-a-privacy-boundary idea earns its keep even more — a backend that can enforce who can read/write which company's documents, not just hide an API key). That's a genuinely separate, bigger build, not something to bolt on quietly here — flagging it rather than deciding it.

## What's built vs. what's KIV

**Built:** one-step industry wizard, editable document (Purpose/Scope/Definitions/Responsibilities/numbered Procedure with reorder controls/Standards tags/Records/Revision history), Gemini-drafted first pass with an explicit "[assumed]" tag on anything it filled in rather than was told, translation into 17 languages with its own editable output and download, Save as PDF, download as .txt, soft daily usage cap.

**KIV, not built this round:**
- **No persistence / SOP library** — see above; needs real accounts + a database, a separate project.
- **Save as PDF for the *translated* version** — right now only the English/source document prints cleanly via the browser; the translated pane has its own text download instead. Making the translated text swap into the same printable `.sop-doc` panel is a contained follow-up, not started.
- **Clause-level citation checking** — the tool deliberately never claims a specific clause number is verified; a KIV worth considering is a small, hand-maintained lookup table of a few clause numbers the business owner has already confirmed for standards they use often, so repeat SOPs for the same standard don't need re-verifying each time.
- **Pulling a process description from another tool** (e.g. a dish's steps already described in Menu Calculator) — not wired up; this tool doesn't use `costing-sync.js` at all right now, since an SOP isn't a cost figure the way every other tool's sync payload is.

## Nav reconciliation (found while building this, not caused by it)

While adding this tool's own nav dropdown, two pre-existing inconsistencies turned up on disk, worth knowing about regardless of this tool:

1. **`rental-calculator.html` and `market-radar.html` were each built without knowing about the other** — `rental-calculator.html`'s own dropdown stops at itself (7 items), and separately `market-radar.html`'s own dropdown also stops at itself (8 items, but missing Rental Calculator entirely). Neither page currently lists the other.
2. **`NAV_ORDER_STANDARD.md` on disk was last updated before Market Radar shipped** — it still describes Market Radar as "reserved, not built yet," even though `market-radar.html`, `market-radar.js`, and its own setup doc are all present and dated after that.

This SOP Creator tool is added at the true next position (**10th**, after Rental Calculator and Market Radar, in that order by build date) and `NAV_ORDER_STANDARD.md` is corrected to match in this same delivery. Per this project's own established convention (see `AI_BUILD_BRIEF.md`'s "reconciled centrally, every time" note, and the identical flag left by the Market Radar and Rental Calculator sessions before this one), **the other pages' own dropdowns are not patched here** — happy to run that full sync pass (10+ pages, one line each, mechanical) if wanted; just say so.

## Jargon index

| Term | Plain-English meaning |
|---|---|
| SOP | Standard Operating Procedure — a written, step-by-step description of how a task is meant to be done, so it's performed the same way regardless of who's doing it. |
| ISO | International Organization for Standardization — publishes widely-recognized standards (ISO 9001, ISO 22000, and so on) that describe good practice for a given area, often used as a basis for certification. |
| ISO 9001 | The general-purpose Quality Management System standard — the most broadly applicable one, used as this tool's fallback for any industry without a more specific fit. |
| HACCP | Hazard Analysis and Critical Control Points — a food-safety methodology focused on identifying and controlling specific risk points in a food process. |
| GMP | Good Manufacturing Practice — a general standard for consistent, quality-controlled production, common in manufacturing and food. |
| GAP | Good Agricultural Practice — the farming-sector equivalent of GMP. |
| ISO/IEC 27001 | The standard for information security management systems. |
| Document control block | The header on a formal SOP (document number, version, effective date, owner) that identifies exactly which version of a document is in front of you — standard practice on any controlled document, not specific to any one standard. |
| [assumed] | This tool's own tag, not an ISO term — appended to any procedure step Gemini filled in as a reasonable guess rather than something the business actually described, so a guess is never silently mistaken for a fact. |
| Worker | The Cloudflare Worker (`sop-creator-proxy-worker.js`) — holds the Gemini key server-side and is the only thing that ever talks to Gemini directly. |
