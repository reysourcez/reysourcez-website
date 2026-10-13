/* ============================================================
   Form Scanner — multi-engine proxy (Cloudflare Worker)
   Version: v6.8 (2026-10-13) — engine registry (PROVIDERS below). v6.8: the prompt now keeps grey sample / placeholder text as printed text (Qwen on Cloudflare was dropping it). v6.7: Qwen3.8-27B on Workers AI (cfqwen), pinned Dots3-Note (dots), per-engine timeout, token/neuron usage + tries in _meta, Groq "Request too large" no longer reported as a rate limit. Returns a LAYOUT SPEC (bands > columns > cells > items)
   Deploys to Cloudflare Workers (NOT to GitHub Pages). All API keys live ONLY here, as encrypted secrets; an engine whose
   key is missing simply stays off and the page does not offer it. Steps + glossary: FORM_SCANNER_SETUP_AND_GLOSSARY.md
   Request : { image: "<base64>", mime_type, note?, tier?: "fast" | "precise", provider?: <engine id>, mode?: "text" }
             { mode: "engines" }   (no image: asks which engines have a key; the page builds its Engine list from this)
   Response: the spec (see FORM_SCHEMA) + _meta | { lines, _meta } (mode text) | { engines, worker } | { error, code? }
   TO ADD AN ENGINE: one entry in PROVIDERS (kind "openai" fits most), add its secret in Cloudflare, Deploy. Nothing else.
   ============================================================ */

const VERSION = 'v6.8 (2026-10-13)';
const ALLOWED_ORIGINS = ['https://reysourcez.com', 'https://www.reysourcez.com'];

// Gemini model per tier. Aliases hot-swap to newer releases; pin a version here if results ever drift.
const MODELS = {
  fast: 'gemini-flash-lite-latest',   // default, cheapest
  precise: 'gemini-3.8-flash',        // "Thorough reading" tick box (GA; supports thinking levels low/medium/high)
};
const THINKING_LEVEL = 'low';         // layout reading gains little from deep thinking
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_BASE64_CHARS = 20 * 1024 * 1024;      // ~15 MB file
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const UPSTREAM_TIMEOUT_MS = 55000;

/* ---------------- engine registry ----------------
   kind     'gemini' (own code below) | 'openai' (any OpenAI-style /chat/completions) | 'anthropic' | 'cfai' (Workers AI binding)
   keyEnv   name of the Cloudflare secret that switches the engine on   |   binding: name of the Workers AI binding (kind cfai)
   json     send response_format json_object      reasoning  'openrouter' | 'groq' = ask for little/no thinking (dropped automatically if rejected)
   imageStyle 'string' for Mistral (its documented form), default is the OpenAI form { url }
   maxTokens / maxField   answer size cap and the name of that parameter
   tokenBudget + imageTokens   only for plans with a tokens-per-minute cap (Groq free): the answer cap is shrunk so prompt + image + answer fit
   free     false = the provider charges (shown in the page's list; stays off until you add a key)
   Model ids were checked against the providers' own docs on 2026-10-10; free models rotate, so a "model not found" log row
   means: update that one id here. */
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

const PROVIDERS = {
  gemini: { kind: 'gemini', label: 'Gemini', keyEnv: 'GEMINI_API_KEY', free: true },   // Google AI Studio free tier; reads PDFs directly
  // v6.7: the same Qwen3.8-27B that gave ~95% structure through OpenRouter free, now hosted by Cloudflare itself (Workers AI: vision + reasoning). Same binding as the Llama engine below: no key, no location problem.
  // Free = the 10,000 neurons a day Workers AI allows (40,909 neurons per M input tokens, 290,909 per M output tokens; Cloudflare pricing page, updated 2026-10-09): a scan costs roughly 1,000-2,500 neurons, so about 4-8 scans a day.
  // Cloudflare's default reasoning level is "xhigh" (very token-hungry): reasoning_effort "low" is also what the OpenRouter route used. max_completion_tokens 12000 caps one scan at about 3,500 neurons. timeoutMs: it thinks first, so allow minutes.
  cfqwen: { kind: 'cfai', label: 'Qwen3.8-27B · Cloudflare', binding: 'AI', model: '@cf/qwen/qwen3.8-27b', free: true, maxTokens: 12000, maxField: 'max_completion_tokens',
    cf: { reasoning_effort: 'low' }, neurons: [40909, 290909], timeoutMs: 175000 },
  // Same Qwen model as the old free OpenRouter route, hosted by Groq. Free plan: 30 requests/min, 1,000/day, 8K tokens/min (so ~1 scan a minute). Preview model.
  groq: { kind: 'openai', label: 'Qwen3.8-27B · Groq', url: 'https://api.groq.com/openai/v1/chat/completions', keyEnv: 'GROQ_API_KEY', model: 'qwen/qwen3.8-27b', free: true,
    json: true, reasoning: 'groq', maxField: 'max_completion_tokens', maxTokens: 16384, tokenBudget: 7600, imageTokens: 2048 },
  // v6.7: pinned instead of the random router pick. 2026-10-12 comparison: Dots3-Note Preview (Dots Studio / Xiaohongshu, 280B MoE with 16B active, vision + reasoning, free on OpenRouter since 2026-08-14) gave the best STRUCTURE of every engine tried but weak words; Auto pairs it with Gemini's wording read.
  dots: { kind: 'openai', label: 'Dots3-Note Preview · OpenRouter free', url: OPENROUTER_URL, keyEnv: 'OPENROUTER_API_KEY', model: 'dots-studio/dots-3-note-preview:free', free: true,
    json: true, reasoning: 'openrouter', maxTokens: 16384, timeoutMs: 175000, headers: { 'X-Title': 'Reysourcez Form Scanner' } },
  // The old route. OpenRouter now answers "This model is unavailable for free" (2026-10-10); kept listed in case the free version returns.
  qwen: { kind: 'openai', label: 'Qwen3.8-27B · OpenRouter free', url: OPENROUTER_URL, keyEnv: 'OPENROUTER_API_KEY', model: 'qwen/qwen3.8-27b:free', free: true,
    json: true, reasoning: 'openrouter', maxTokens: 16384, headers: { 'X-Title': 'Reysourcez Form Scanner' } },
  // OpenRouter's own router: picks a free model that can read images, so it survives the free list rotating. The label shows which model it picked.
  orfree: { kind: 'openai', label: 'OpenRouter free (auto-pick)', url: OPENROUTER_URL, keyEnv: 'OPENROUTER_API_KEY', model: 'openrouter/free', free: true,
    json: true, reasoning: 'openrouter', maxTokens: 16384, headers: { 'X-Title': 'Reysourcez Form Scanner' } },
  mistral: { kind: 'openai', label: 'Mistral Small', url: 'https://api.mistral.ai/v1/chat/completions', keyEnv: 'MISTRAL_API_KEY', model: 'mistral-small-latest', free: true,
    json: true, imageStyle: 'string', maxTokens: 16384 },
  // Runs inside Cloudflare (no key, no location problem): add a Workers AI binding named AI. 10,000 free "neurons" a day, shared by everything on Workers AI.
  cfscout: { kind: 'cfai', label: 'Llama 4 Scout · Workers AI', binding: 'AI', model: '@cf/meta/llama-4-scout-17b-16e-instruct', free: true, maxTokens: 8192 },
  // NVIDIA's hosted catalog (free with an NVIDIA Developer account; "trial use": do not send personal data). One key, several models.
  nvllama: { kind: 'openai', label: 'Llama 3.2 90B Vision · NVIDIA', url: NVIDIA_URL, keyEnv: 'NVIDIA_API_KEY', model: 'meta/llama-3.2-90b-vision-instruct', free: true,
    maxTokens: 4096 },
  kimi: { kind: 'openai', label: 'Kimi K2.6 · NVIDIA', url: NVIDIA_URL, keyEnv: 'NVIDIA_API_KEY', model: 'moonshotai/kimi-k2.6', free: true, maxTokens: 16384 },
  // Paid (a fraction of a cent per scan) and experimental: stays off until you add DEEPSEEK_API_KEY.
  deepseek: { kind: 'openai', label: 'DeepSeek V4 Flash Vision', url: 'https://api.deepseek.com/chat/completions', keyEnv: 'DEEPSEEK_API_KEY', model: 'deepseek-v4-flash-vision-exp', free: false,
    json: true, maxTokens: 16384 },
  // Paid API (no ongoing free tier). Stays off until you add ANTHROPIC_API_KEY.
  claude: { kind: 'anthropic', label: 'Claude Haiku 5.5', url: 'https://api.anthropic.com/v1/messages', keyEnv: 'ANTHROPIC_API_KEY', model: 'claude-haiku-5-5', free: false, maxTokens: 16384 },
};

/* ---------------- response schema (kept small: strings carry the item codes) ---------------- */
const S = (description) => ({ type: 'string', description });
const N = (description) => ({ type: 'number', description });
const I = (description) => ({ type: 'integer', description });
const B = (description) => ({ type: 'boolean', description });

const CELL = {
  type: 'object',
  properties: {
    col: I('1-based number of the column this cell belongs to'),
    height_pct: N('share of that column height; the cells of one column add up to 100'),
    boxed: B('a border is drawn around this cell'),
    fill: S('"none", or #RRGGBB when the cell has a coloured background'),
    items: { type: 'array', items: { type: 'string' }, description: 'coded items, top to bottom (see item codes in the instructions)' },
  },
  required: ['col', 'height_pct', 'items'],
};

const TABLE = {
  type: 'object',
  properties: {
    width_pct: N('table width as % of the band width (100 = full width)'),
    columns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          header: S('printed column heading, exactly as printed'),
          width_pct: N('share of the table width; columns add up to 100'),
          align: S('left, center or right (text alignment of the cells)'),
          fill: S('heading background #RRGGBB, or none'),
        },
        required: ['header', 'width_pct'],
      },
    },
    header_groups: {
      type: 'array',
      description: 'headings that span several columns, drawn above the column headings',
      items: {
        type: 'object',
        properties: { text: S('printed text'), from_column: I('first column, 1-based'), span: I('number of columns'), fill: S('#RRGGBB or none') },
        required: ['text', 'from_column', 'span'],
      },
    },
    header_fill: S('default heading background #RRGGBB, e.g. #D9D9D9, or none'),
    static_rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'rows that are already printed: one string per column, "" for an empty cell' },
    blank_rows: I('number of empty rows to fill in'),
    numbered: B('first column is pre-numbered 1. 2. 3.'),
    total_label: S('printed label of a total row, e.g. JUMLAH (RM); empty if no total row'),
    total_span: I('how many columns the total label spans, from the left'),
    fillable: B('false for reference tables that are only to be read'),
  },
  required: ['columns'],
};

const BAND = {
  type: 'object',
  properties: {
    kind: S('"cells" for normal bands, "table" for a ruled grid table'),
    height_pct: N('share of the total height of all bands; all bands add up to 100'),
    gap: S('whitespace above the band: none, small, medium or large'),
    boxed: B('a rectangle outline is drawn around the whole band'),
    col_widths_pct: { type: 'array', items: { type: 'number' }, description: 'kind cells: widths of the side-by-side columns, left to right, adding up to 100' },
    cells: { type: 'array', items: CELL, description: 'kind cells: the cells, column 1 first (top to bottom), then column 2, ...' },
    table: TABLE,
  },
  required: ['kind', 'height_pct', 'cells'],   // v6.3: 'cells' required (empty [] for tables) - Gemini used to skip it and every non-table band vanished
};

const FORM_SCHEMA = {
  type: 'object',
  properties: {
    recognized: B('true when the image or PDF shows a printed or typed form, register or worksheet; false for anything else'),
    title: S('main heading printed on the form (empty if none)'),
    reference_code: S('form or annex code printed in a corner, e.g. Lampiran 6 [Ruj. 52 (a)] (empty if none)'),
    page: {
      type: 'object',
      properties: {
        size: S('paper size the form is printed on: A3, A4, A5, A6, Letter or Legal (A4 when unsure)'),
        orientation: S('portrait or landscape'),
        font: S('typeface family of the printed text: sans, serif or mono'),
        margin_pct: N('left/right paper margin as % of the page width (2-12)'),
        fill_pct: N('how much of the page height the bands occupy (40-100)'),
      },
      required: ['size', 'orientation', 'font'],
    },
    requested: {
      type: 'object',
      description: 'ONLY what the scanning person explicitly asked for in their note; otherwise none / 0',
      properties: {
        size: S('none, or A3, A4, A5, A6, Letter, Legal'),
        orientation: S('none, portrait or landscape'),
        font: S('none, sans, serif or mono'),
        text_scale_pct: N('0 = not requested; 100 = normal size; 120 = bigger; 80 = smaller'),
      },
    },
    frames: {
      type: 'array',
      description: 'big rectangles that enclose several consecutive bands',
      items: { type: 'object', properties: { from_band: I('first band number, 1-based'), to_band: I('last band number, 1-based') }, required: ['from_band', 'to_band'] },
    },
    bands: { type: 'array', items: BAND },
  },
  required: ['recognized', 'title', 'page', 'bands'],
};

/* ---------------- prompt ---------------- */
const PROMPT = `You turn a photo or PDF of a printed form into a compact LAYOUT SPEC (JSON). An app redraws the form from it as a clean, straight, fillable PDF, so copy the form's real STRUCTURE exactly: the same rows, columns, cells, boxes, lines, labels and order. Never simplify, reorder, merge, regroup or invent anything.

TEXT: copy every printed word exactly as printed (same language, spelling, capitals and punctuation such as " :"). Keep pre-printed text such as letterhead and organisation names. Leave out handwriting, stamps, signatures, scanner shadows and the photo background. If the copy is already filled in, describe the blank template. Grey or italic sample text inside an entry cell that tells the reader what to write (for example "Isi nama...", "Cth: 15/08/2026", "e.g. John Smith", "DD/MM/YYYY") is PRINTED text, not an answer: keep it, as the label of that entry's blank (F[line] Isi nama...). Only real handwriting or typed-in answers are left out. Lines drawn with dots or underscores after a label are blanks: use F, never transcribe the dots.

STRUCTURE, top to bottom
1. bands: cut the form into full-width horizontal bands in reading order. Give a band to every distinct block: a top-corner reference label, the title block, each group of fields, each table, each one-line row, the signature area, footnotes, each reference table.
   height_pct = the band's share of the total height of all bands (adds up to 100). gap = whitespace above it (none/small/medium/large). boxed = true when a rectangle outline is drawn around the band. frames = one big rectangle around several consecutive bands, as {from_band,to_band} (1-based band numbers). Most printed forms have an outer border: when one rectangle encloses the whole form (or a block of consecutive bands, e.g. the title plus the fields), you MUST output a frame for it.
2. kind "cells" (default): col_widths_pct lists the columns that sit side by side (adds up to 100; [100] for one full-width column; use an empty spacer column for blank margins). Each cell has col (its 1-based column), height_pct (its share of that column's height; the cells of one column add up to 100), boxed (a border around the cell) and fill ("none", or #RRGGBB for a coloured background). List the cells of column 1 first (top to bottom), then column 2, and so on. Content that sits left and right of each other MUST be in different columns; never put a left group and a right group in the same column. Use an empty cell (items []) for blank space above or below a box.
3. Each cell has items, top to bottom, every item a short coded string  CODE[flags] text
   T[..] text      printed text (not fillable)
   F[..] label     a label followed by a blank to fill in (label may be empty for a bare line or box)
   C[..] label :: option ; option _ ; option      tick boxes; "_" after an option = write-in line after it
   HR[..]          decorative horizontal rule (not fillable)
   SP[n]           empty stretchy space, n = 1 (small) to 5 (large); use it to leave room for signatures
   flags, comma separated, all optional: b bold; i italic; xs sm md lg xl text size (md is normal);
   left center right alignment; ul underline;
   F only: line (default) | box | none = how the blank looks; wNN = blank width as % of the cell, MEASURED from the picture: a short box or line is w15-w40, only a blank that really runs the full width of the cell has no wNN; tall = multi-line blank that stretches; rl = right-align the label so labels line up with the blanks; ind = indent a label-less blank to line up with the other blanks;
   C only: stack = options one under another (default is one row).
   Signature block: T[b] heading, SP[3], F[line,w70] (signature line), then F[none] rows for Name / Position / Date.
4. kind "table": a ruled grid with a heading row. table.columns = printed headings + width_pct (+ align, fill); header_groups = headings spanning several columns (from_column, span; 1-based); static_rows = rows that are already printed (one string per column, "" = empty cell); blank_rows = empty rows to fill in; total_label + total_span = a total row whose label spans the first N columns; numbered = first column is pre-numbered; fillable=false for reference tables that are only read; width_pct when the table is narrower than the band; header_fill / fill for coloured headings.

PAGE: page.size and page.orientation = the paper the form is printed on (A4 portrait unless it clearly is not); page.font = sans, serif or mono; margin_pct and fill_pct as described in the schema (a form that fills its page has fill_pct 90-100; never copy the numbers of the example below).
NOTE: the person may add a note. Only when it explicitly asks for a different paper size, orientation, font or text size, fill requested.*; otherwise leave requested as none / 0. Follow any other structural guidance in the note (for example "ignore the letterhead").
If the image is not a form, return recognized=false, empty title, page A4 portrait sans and bands [].

Tiny example of the SHAPE ONLY (never copy its content):
{"recognized":true,"title":"LEAVE REQUEST","reference_code":"Form HR-2","page":{"size":"A4","orientation":"portrait","font":"sans","margin_pct":5,"fill_pct":95},"requested":{"size":"none","orientation":"none","font":"none","text_scale_pct":0},"frames":[{"from_band":1,"to_band":3}],"bands":[{"kind":"cells","height_pct":12,"boxed":false,"col_widths_pct":[100],"cells":[{"col":1,"height_pct":100,"items":["T[b,xl,center] LEAVE REQUEST","T[i,xs,center] (Company name)"]}]},{"kind":"cells","height_pct":30,"boxed":false,"col_widths_pct":[55,45],"cells":[{"col":1,"height_pct":100,"items":["F[box] Name","F[box] Department","F[box] Position"]},{"col":2,"height_pct":100,"items":["F[box,w30] Date","C[stack] Type :: Annual ; Sick ; Other _"]}]},{"kind":"table","height_pct":30,"table":{"columns":[{"header":"No","width_pct":8,"align":"center"},{"header":"Date","width_pct":30},{"header":"Reason","width_pct":62}],"header_fill":"#D9D9D9","blank_rows":4,"numbered":true}},{"kind":"cells","height_pct":28,"boxed":true,"col_widths_pct":[50,50],"cells":[{"col":1,"height_pct":100,"boxed":true,"items":["T[b,sm] Requested by","SP[3]","F[line,w70]","F[none,sm] Name :","F[none,sm] Date :"]},{"col":2,"height_pct":100,"boxed":true,"items":["T[b,sm] Approved by","SP[3]","F[line,w70]","F[none,sm] Name :","F[none,sm] Date :"]}]}]}`;

/* Wording read (v6.3): Gemini transcribes every printed text item as a flat list; the page merges it into Qwen's structure. */
const TEXT_SCHEMA = { type: 'object', properties: { lines: { type: 'array', items: { type: 'string' }, description: 'every printed text item, one entry each, reading order' } }, required: ['lines'] };
const TEXT_PROMPT = 'Transcribe ALL printed text on this form exactly as printed, as a JSON list in reading order (top to bottom, left to right). One entry per separate text item: a heading, a label, a column heading, a table cell, a note line. Never merge text from different columns, boxes or cells into one entry. Keep the original language, spelling, capitals and punctuation (including " :"). Skip handwriting, stamps, signatures, scanner noise and the photo background. Reply as {"lines":[...]}.';
/* Structural clean-up only (sizes, types). The browser does the semantic normalising. */
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const numOrUndef = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : undefined));
const list = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);

function sanitizeCell(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    col: numOrUndef(c.col), height_pct: numOrUndef(c.height_pct), boxed: !!c.boxed, fill: str(c.fill, 12),
    items: list(c.items, 60).filter((x) => typeof x === 'string').map((x) => x.slice(0, 500)),
  };
}
function sanitizeTable(t) {
  if (!t || typeof t !== 'object') return undefined;
  return {
    width_pct: numOrUndef(t.width_pct),
    columns: list(t.columns, 24).map((c) => ({ header: str(c && c.header, 120), width_pct: numOrUndef(c && c.width_pct), align: str(c && c.align, 10), fill: str(c && c.fill, 12) })),
    header_groups: list(t.header_groups, 12).map((g) => ({ text: str(g && g.text, 100), from_column: numOrUndef(g && g.from_column), span: numOrUndef(g && g.span), fill: str(g && g.fill, 12) })),
    header_fill: str(t.header_fill, 12),
    static_rows: list(t.static_rows, 60).map((r) => list(r, 24).map((x) => str(x, 200))),
    blank_rows: numOrUndef(t.blank_rows), numbered: !!t.numbered, total_label: str(t.total_label, 100),
    total_span: numOrUndef(t.total_span), fillable: t.fillable === undefined ? true : !!t.fillable,
  };
}
function sanitizeSpec(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const pg = r.page && typeof r.page === 'object' ? r.page : {};
  const rq = r.requested && typeof r.requested === 'object' ? r.requested : {};
  return {
    recognized: !!r.recognized,
    title: str(r.title, 200), reference_code: str(r.reference_code, 100),
    page: { size: str(pg.size, 10), orientation: str(pg.orientation, 12), font: str(pg.font, 8), margin_pct: numOrUndef(pg.margin_pct), fill_pct: numOrUndef(pg.fill_pct) },
    requested: { size: str(rq.size, 10), orientation: str(rq.orientation, 12), font: str(rq.font, 8), text_scale_pct: numOrUndef(rq.text_scale_pct) },
    frames: list(r.frames, 6).map((f) => ({ from_band: numOrUndef(f && f.from_band), to_band: numOrUndef(f && f.to_band) })),
    bands: list(r.bands, 40).map((b) => {
      if (!b || typeof b !== 'object') return null;
      return {
        kind: str(b.kind, 8), height_pct: numOrUndef(b.height_pct), gap: str(b.gap, 8), boxed: !!b.boxed,
        col_widths_pct: list(b.col_widths_pct, 12).map(numOrUndef).filter((x) => x !== undefined),
        cells: list(b.cells, 40).map(sanitizeCell).filter(Boolean),
        table: sanitizeTable(b.table),
      };
    }).filter(Boolean),
  };
}

function extractText(data) {
  const cand = Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  const p = parts.find((x) => typeof x.text === 'string');
  return { text: p ? p.text : '', finish: cand && cand.finishReason, blocked: data.promptFeedback && data.promptFeedback.blockReason };
}

async function callGemini(env, model, parts, useSchema, useThinking) {
  const generationConfig = { responseMimeType: 'application/json', maxOutputTokens: 16384 };
  if (useSchema) generationConfig.responseSchema = FORM_SCHEMA;
  if (useThinking) generationConfig.thinkingConfig = { thinkingLevel: THINKING_LEVEL };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts }], generationConfig }),
      signal: ctl.signal,
    });
  } finally { clearTimeout(timer); }
}

/* ---------------- helpers ---------------- */
function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}
// rc = per-request context { origin, colo }: colo is the Cloudflare data center (airport code) that handled this request
function jsonResponse(body, status, rc) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { ...corsHeaders(rc && rc.origin), 'Content-Type': 'application/json' } });
}

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isReady = (env, d) => (d.kind === 'cfai' ? !!(env && env[d.binding] && typeof env[d.binding].run === 'function') : !!(env && env[d.keyEnv]));
const needsOf = (d) => (d.kind === 'cfai' ? 'a Workers AI binding named ' + d.binding : d.keyEnv);
const NOTE_PREFIX = 'Note from the person scanning this form (follow it as described above): ';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function enginesInfo(env) {
  return {
    worker: VERSION,
    engines: Object.keys(PROVIDERS).map((id) => {
      const d = PROVIDERS[id];
      return { id, label: d.label, ready: isReady(env, d), needs: needsOf(d), free: d.free !== false };
    }),
  };
}

// How many answer tokens an engine may use. Plans with a tokens-per-minute cap (Groq free) count prompt + image + answer together.
function outputBudget(def, promptChars, mode) {
  const cap = mode === 'text' ? Math.min(def.maxTokens || 8192, 4096) : (def.maxTokens || 8192);
  if (!def.tokenBudget) return cap;
  const est = Math.ceil(promptChars / 3) + (def.imageTokens || 0);
  return Math.max(1500, Math.min(cap, def.tokenBudget - est));
}

// First {...} in the reply (models sometimes add fences, a sentence, or a <think> block); a bare [...] list counts as wording lines
function readJson(text) {
  const s = String(text == null ? '' : text).replace(/<think>[\s\S]*?<\/think>/gi, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* try the list form */ } }
  const c = s.indexOf('['), d = s.lastIndexOf(']');
  if (c >= 0 && d > c) { try { const v = JSON.parse(s.slice(c, d + 1)); if (Array.isArray(v)) return { lines: v }; } catch (e) { /* give up */ } }
  return null;
}

async function post(url, init, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms || UPSTREAM_TIMEOUT_MS);
  try { return await fetch(url, Object.assign({}, init, { signal: ctl.signal })); }
  finally { clearTimeout(timer); }
}
const isAbort = (e) => !!e && e.name === 'AbortError';
const fail = (status, error, code) => ({ ok: false, status, error, code: code || '' });
const tooSlow = (def) => def.label + ' took too long (over ' + (def.timeoutMs || UPSTREAM_TIMEOUT_MS) / 1000 + ' s). Try again.';
// v6.7: token counts as the provider reports them (OpenAI-style "usage"); neurons only for Workers AI engines, from the published per-million rates in the registry
function usageOf(def, u) {
  if (!u || typeof u !== 'object') return null;
  const tin = Number(u.prompt_tokens != null ? u.prompt_tokens : u.input_tokens), tout = Number(u.completion_tokens != null ? u.completion_tokens : u.output_tokens);
  const out = { in: Number.isFinite(tin) ? tin : 0, out: Number.isFinite(tout) ? tout : 0 };
  if (!out.in && !out.out) return null;
  if (def.neurons) out.neurons = Math.round(out.in * def.neurons[0] / 1e6 + out.out * def.neurons[1] / 1e6);
  return out;
}

/* Turns a provider's error into one plain sentence + a short code, and appends the provider's own words (up to 300 characters)
   so the comparison log always shows the real reason. */
function classify(def, status, rawMsg, rc, retryAfter) {
  const m = String(rawMsg == null ? '' : rawMsg).replace(/\s+/g, ' ').replace(/ in organization `[^`]*`/i, '').replace(/ service tier `[^`]*`/i, '').trim();   // v6.7: the organisation id is noise (and private); dropping it keeps Groq's \"Limit N, Requested M\" inside the 300 characters
  const said = m ? ' ' + def.label + ' said: ' + m.slice(0, 300) : '';
  if (/location is not supported|not available in your (country|region)|not supported in your (country|region)|unsupported (country|region|territory)/i.test(m)) {
    return { code: 'location', status: 502, text: def.label + ' refused this request ("location is not supported"). That check looks at where the Worker ran' + (rc && rc.colo ? ' (Cloudflare ' + rc.colo + ')' : '') + ', not where you are. It comes and goes: try again, or use another engine.' + said };
  }
  if (/unavailable for free|no longer free|use this slug instead/i.test(m)) {
    const slug = (m.match(/slug instead:?\s*([^\s"',]+)/i) || [])[1] || '';
    return { code: 'retired_free', text: def.label + ': OpenRouter says this model is no longer free' + (slug ? ' (it offers the paid id ' + slug + ')' : '') + '. Use another engine; this one stays listed in case the free version returns.' + said };
  }
  if (/request too large/i.test(m)) {   // v6.7: Groq 413 "Limit N, Requested M": this ONE request is bigger than the free per-minute allowance, so waiting never helps; the page retries once with a smaller picture
    return { code: 'image_too_large', status: 413, text: def.label + ': this request is bigger than the free per-minute allowance (picture + instructions + answer together), so waiting will not help. The page retries once with a smaller picture; if that fails, use another engine.' + said };
  }
  if (status === 429 || /tokens per minute|\bTPM\b|rate.?limit|too many requests|resource.?exhausted/i.test(m)) {
    const wait = retryAfter > 0 ? ' Try again in about ' + Math.ceil(retryAfter) + ' s.' : ' Wait a minute and try again.';
    const plan = def.keyEnv === 'GROQ_API_KEY' ? ' Groq\u2019s free plan allows 30 requests and about 8,000 tokens a minute for this model, so roughly one scan a minute.' : ' Free plans only allow so many requests per minute and per day.';
    return { code: 'rate_limited', text: def.label + ' is rate-limited right now.' + plan + wait + said };
  }
  if (status === 413 || (/image/i.test(m) && /(too large|too big|size|exceed|limit|\bKB\b|\bMB\b)/i.test(m))) {
    return { code: 'image_too_large', text: def.label + ' says the picture is too big for it.' + said };
  }
  if (status === 401 || status === 403) return { code: 'auth', text: def.label + ' rejected the key. Re-add the secret ' + (def.keyEnv || 'for this engine') + ' in the Worker (Settings > Variables and Secrets).' + said };
  if (status === 402) return { code: 'credit', text: def.label + ' says the credit or free-usage limit was reached.' + said };
  if (status === 404) {
    if (def.keyEnv === 'OPENROUTER_API_KEY') {
      if (/data policy|guardrail|privacy/i.test(m)) return { code: 'policy', text: 'OpenRouter is blocking free models for this account. At openrouter.ai/settings/privacy switch ON both free-endpoint options (the one that may train on request data and the one that may publish prompts), then try again.' + said };
      return { code: 'no_provider', text: 'OpenRouter has no provider for ' + def.label + ' right now. This usually clears within minutes; if it never does, the model id in this Worker\u2019s PROVIDERS list may be retired.' + said };
    }
    return { code: 'not_found', text: def.label + ': the model id "' + def.model + '" was not found. The provider may have renamed or retired it; update that id in PROVIDERS.' + said };
  }
  if (status === 400) return { code: 'bad_request', text: def.label + ' rejected the request.' + said };
  return { code: '', text: def.label + ' error ' + status + '.' + said };
}

/* ---------------- adapter: OpenAI-style /chat/completions (Groq, OpenRouter, Mistral, NVIDIA, DeepSeek) ---------------- */
async function callOpenAI(env, def, a, rc) {
  const dataUrl = 'data:' + a.mime + ';base64,' + a.image;
  const content = [
    { type: 'image_url', image_url: def.imageStyle === 'string' ? dataUrl : { url: dataUrl } },
    { type: 'text', text: a.prompt },
  ];
  if (a.note) content.push({ type: 'text', text: NOTE_PREFIX + a.note });
  const headers = Object.assign({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + env[def.keyEnv] }, def.headers || {});
  let useReasoning = !!def.reasoning, useJson = !!def.json, fallback = '', retried404 = false, resp = null, tries = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    tries++;
    const payload = { model: def.model, messages: [{ role: 'user', content }], temperature: 0 };
    payload[def.maxField || 'max_tokens'] = a.maxOut;
    if (useJson) payload.response_format = { type: 'json_object' };
    if (useReasoning && def.reasoning === 'openrouter') payload.reasoning = { effort: 'low' };
    if (useReasoning && def.reasoning === 'groq') payload.reasoning_effort = 'none';
    try { resp = await post(def.url, { method: 'POST', headers, body: JSON.stringify(payload) }, def.timeoutMs); }
    catch (e) { return isAbort(e) ? fail(502, tooSlow(def), 'timeout') : fail(502, 'Could not reach ' + def.label + '. Try again.', 'network'); }
    if (resp.ok) break;
    const errText = await resp.text();
    console.error('[Form Scanner]', def.label, resp.status, errText.slice(0, 400));
    let msg = errText;
    try { const j = JSON.parse(errText); const e = j.error !== undefined ? j.error : j; msg = typeof e === 'string' ? e : (e && e.message) || j.message || errText; } catch (e) { /* keep raw */ }
    const retryAfter = parseFloat(resp.headers.get('retry-after'));
    const cls = classify(def, resp.status, msg, rc, retryAfter);
    const plain400 = resp.status === 400 && (cls.code === 'bad_request' || cls.code === '');
    if (plain400 && useReasoning && def.reasoning) { useReasoning = false; fallback += 'no-reasoning '; continue; }
    if (plain400 && useJson) { useJson = false; fallback += 'no-json-mode '; continue; }
    const transient = resp.status === 502 || resp.status === 503 || resp.status === 529 || (resp.status === 429 && !(retryAfter > 5));
    if (transient && attempt < 3) { await sleep(retryAfter > 0 ? Math.min(retryAfter, 5) * 1000 : 1500); continue; }
    if (cls.code === 'no_provider' && !retried404) { retried404 = true; await sleep(1500); continue; }   // a short free-pool blip often clears
    return fail(cls.status || resp.status, cls.text, cls.code);
  }
  if (!resp || !resp.ok) return fail(502, def.label + ' did not answer. Please try again.', 'no_answer');
  let data;
  try { data = await resp.json(); } catch (e) { return fail(502, def.label + ' returned an unreadable answer. Scan again.', 'bad_json'); }
  const choice = data && data.choices && data.choices[0];
  if (!choice) {
    const em = data && data.error ? (data.error.message || JSON.stringify(data.error)) : '';
    if (em) { const cls = classify(def, Number(data.error.code) || 502, em, rc, 0); return fail(cls.status || 502, cls.text, cls.code); }
    return fail(502, def.label + ' returned no answer. Scan again.', 'no_answer');
  }
  const m = choice.message || {};
  const text = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? m.content.map((p) => (p && p.text) || '').join('') : '');
  return { ok: true, text, model: typeof data.model === 'string' ? data.model : def.model, finish: choice.finish_reason || '', fallback: fallback.trim(), usage: usageOf(def, data.usage), tries };
}

/* ---------------- adapter: Anthropic Messages API ---------------- */
async function callAnthropic(env, def, a, rc) {
  const headers = { 'Content-Type': 'application/json', 'x-api-key': env[def.keyEnv], 'anthropic-version': '2023-06-01' };
  const content = [{ type: 'image', source: { type: 'base64', media_type: a.mime, data: a.image } }, { type: 'text', text: a.prompt }];
  if (a.note) content.push({ type: 'text', text: NOTE_PREFIX + a.note });
  let resp = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { resp = await post(def.url, { method: 'POST', headers, body: JSON.stringify({ model: def.model, max_tokens: a.maxOut, temperature: 0, messages: [{ role: 'user', content }] }) }); }
    catch (e) { return isAbort(e) ? fail(502, tooSlow(def), 'timeout') : fail(502, 'Could not reach ' + def.label + '. Try again.', 'network'); }
    if (resp.ok) break;
    const errText = await resp.text();
    console.error('[Form Scanner]', def.label, resp.status, errText.slice(0, 400));
    let msg = errText;
    try { const j = JSON.parse(errText); msg = (j.error && j.error.message) || j.message || errText; } catch (e) { /* keep raw */ }
    const retryAfter = parseFloat(resp.headers.get('retry-after'));
    const cls = classify(def, resp.status, msg, rc, retryAfter);
    const transient = resp.status === 502 || resp.status === 503 || resp.status === 529 || (resp.status === 429 && !(retryAfter > 5));
    if (transient && attempt < 2) { await sleep(retryAfter > 0 ? Math.min(retryAfter, 5) * 1000 : 1500); continue; }
    return fail(cls.status || resp.status, cls.text, cls.code);
  }
  if (!resp || !resp.ok) return fail(502, def.label + ' did not answer. Please try again.', 'no_answer');
  let data;
  try { data = await resp.json(); } catch (e) { return fail(502, def.label + ' returned an unreadable answer. Scan again.', 'bad_json'); }
  const text = (Array.isArray(data.content) ? data.content : []).filter((b) => b && b.type === 'text').map((b) => b.text || '').join('');
  return { ok: true, text, model: typeof data.model === 'string' ? data.model : def.model, finish: data.stop_reason === 'max_tokens' ? 'length' : (data.stop_reason || ''), fallback: '', usage: usageOf(def, data.usage) };
}

/* ---------------- adapter: Workers AI (binding named AI; no key, runs inside Cloudflare) ---------------- */
async function callCfai(env, def, a) {
  const dataUrl = 'data:' + a.mime + ';base64,' + a.image;
  const content = [{ type: 'text', text: a.prompt + (a.note ? '\n\n' + NOTE_PREFIX + a.note : '') }, { type: 'image_url', image_url: { url: dataUrl } }];
  const ms = def.timeoutMs || UPSTREAM_TIMEOUT_MS;
  let extras = Object.assign({}, def.cf || {}), fallback = '', tries = 0, out = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    tries++;
    const input = Object.assign({ messages: [{ role: 'user', content }], temperature: 0 }, extras);
    input[def.maxField || 'max_tokens'] = a.maxOut;
    let timer;
    try {
      out = await Promise.race([
        env[def.binding].run(def.model, input),
        new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('__timeout__')), ms); }),
      ]);
      break;
    } catch (e) {
      const m = String((e && e.message) || e || '');
      console.error('[Form Scanner]', def.label, m.slice(0, 400));
      if (m === '__timeout__') return fail(502, tooSlow(def), 'timeout');
      if (attempt === 0 && Object.keys(extras).length && /reasoning_effort|chat_template|unknown (field|param)|unexpected (field|param)/i.test(m)) { extras = {}; fallback += 'no-reasoning-option '; continue; }   // v6.7: one retry without the extra options if the model rejects them
      if (/daily free allocation|neurons|\b4006\b/i.test(m)) return fail(429, def.label + ': the free daily Workers AI allowance (10,000 neurons) is used up. It resets at 00:00 UTC.' + ' Cloudflare said: ' + m.slice(0, 200), 'rate_limited');
      if (/agree|license|licence|terms/i.test(m)) return fail(403, def.label + ': Cloudflare asks you to accept this model\u2019s license once. In the dashboard open Workers AI > Playground, pick the model, send any message and accept. Cloudflare said: ' + m.slice(0, 200), 'license');
      return fail(502, def.label + ' error. Cloudflare said: ' + m.slice(0, 300), '');
    } finally { clearTimeout(timer); }
  }
  let text = '';
  if (out && typeof out.response === 'string') text = out.response;
  else if (out && out.response && typeof out.response === 'object') text = JSON.stringify(out.response);
  else if (out && out.choices && out.choices[0] && out.choices[0].message) {
    const c = out.choices[0].message.content;
    text = typeof c === 'string' ? c : (Array.isArray(c) ? c.map((p) => (p && p.text) || '').join('') : '');
  } else if (out && out.result && typeof out.result.response === 'string') text = out.result.response;
  const fin = out && out.choices && out.choices[0] ? out.choices[0].finish_reason : '';
  return { ok: true, text, model: def.model, finish: fin || '', fallback: fallback.trim(), usage: usageOf(def, out && out.usage), tries };
}

/* ---------------- one handler for every non-Gemini engine ---------------- */
async function handleCompat(env, pid, def, mode, image, mime, note, rc) {
  if (mime === 'application/pdf') return jsonResponse({ error: def.label + ' reads page images only. The page converts PDFs to an image first, so if you see this the PDF page could not be rendered: use Gemini for this file.', code: 'pdf_unsupported' }, 415, rc);
  const prompt = mode === 'text' ? TEXT_PROMPT : PROMPT + '\n\nReply with ONLY the JSON object. No markdown fences, no commentary.';
  const noteText = mode === 'structure' ? note : '';
  const args = { image, mime, prompt, note: noteText, maxOut: outputBudget(def, prompt.length + noteText.length, mode) };
  const t0 = Date.now();
  const r = def.kind === 'anthropic' ? await callAnthropic(env, def, args, rc) : def.kind === 'cfai' ? await callCfai(env, def, args) : await callOpenAI(env, def, args, rc);
  if (!r.ok) return jsonResponse({ error: r.error, code: r.code }, r.status || 502, rc);
  const parsed = readJson(r.text);
  if (!parsed) {
    const why = r.finish === 'length'
      ? 'The model ran out of room before finishing' + (def.tokenBudget ? ' (this plan leaves about ' + args.maxOut + ' tokens for the answer, so a dense form may not fit)' : ' (it may have spent it thinking)') + '. Scan again, or try another engine.'
      : 'The model returned no usable answer. Scan again.';
    return jsonResponse({ error: def.label + ': ' + why, code: r.finish === 'length' ? 'too_long' : 'bad_json' }, 502, rc);
  }
  const model = r.model || def.model;
  const meta = { provider: pid, model, label: pid === 'orfree' && model !== def.model ? def.label + ' · ' + model : def.label, tier: 'n/a', ms: Date.now() - t0, fallback: r.fallback || '', colo: (rc && rc.colo) || '', usage: r.usage || null, tries: r.tries || 1 };
  if (mode === 'text') {
    const lines = list(parsed.lines, 600).filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, 300)).filter(Boolean);
    return jsonResponse({ lines, _meta: Object.assign(meta, { mode: 'text' }) }, 200, rc);
  }
  const spec = sanitizeSpec(parsed);
  spec._meta = meta;
  return jsonResponse(spec, 200, rc);
}

/* ---------------- Gemini: structure read (own code: response schema + attempt ladder schema/thinking -> schema -> plain JSON) ---------------- */
async function handleGeminiStructure(env, image, mime, tier, note, rc) {
  const t0 = Date.now();
  const model = MODELS[tier];
  // file first, instructions after it (Google's recommended order for a single image/PDF)
  const parts = [{ inlineData: { mimeType: mime, data: image } }, { text: PROMPT }];
  if (note) parts.push({ text: NOTE_PREFIX + note });
  let useSchema = true, useThinking = true, resp = null, fallback = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    try { resp = await callGemini(env, model, parts, useSchema, useThinking); }
    catch (e) { return jsonResponse({ error: e && e.name === 'AbortError' ? 'The scan took too long. Try again, or use a smaller/clearer file.' : 'Could not reach Gemini. Try again.' }, 502, rc); }
    if (resp.ok) break;
    const errText = await resp.text();
    console.error('[Form Scanner] Gemini', resp.status, model, errText.slice(0, 400));
    if (resp.status === 400 && /location is not supported/i.test(errText)) {   // v6.6: not our request's fault; say so plainly (a retry from this same data center cannot help)
      const c = classify(PROVIDERS.gemini, 400, errText, rc, 0);
      return jsonResponse({ error: c.text, code: c.code }, 502, rc);
    }
    if (resp.status === 400 && useThinking && /thinking/i.test(errText)) { useThinking = false; fallback += 'no-thinking '; continue; }
    if (resp.status === 400 && useSchema && /schema|constraint|states|nesting|depth|too complex/i.test(errText)) { useSchema = false; fallback += 'no-schema '; continue; }
    if ((resp.status === 429 || resp.status === 503) && attempt < 2) { await sleep(1200); continue; }
    let msg = errText;
    try { msg = (JSON.parse(errText).error || {}).message || errText; } catch (e) { /* keep raw */ }
    const friendly = resp.status === 429 || resp.status === 503 ? 'Gemini is busy right now. Please try again in a moment.' : `Gemini error ${resp.status}: ${String(msg).slice(0, 300)}`;
    return jsonResponse({ error: friendly }, resp.status, rc);
  }
  if (!resp || !resp.ok) return jsonResponse({ error: 'Gemini did not answer. Please try again.' }, 502, rc);

  const data = await resp.json();
  const { text, finish, blocked } = extractText(data);
  if (blocked) return jsonResponse({ error: 'Gemini declined to read this file (' + blocked + '). Try a different photo.' }, 422, rc);
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (e) {
    const why = finish === 'MAX_TOKENS' ? 'The form was too detailed to describe in one go. Try a closer photo of a simpler area, or scan again.' : 'Gemini returned an unreadable answer. Please scan again.';
    return jsonResponse({ error: why }, 502, rc);
  }
  const spec = sanitizeSpec(parsed);
  spec._meta = { provider: 'gemini', model, label: 'Gemini · ' + model.replace(/^gemini-/, ''), tier, ms: Date.now() - t0, fallback: fallback.trim(), colo: (rc && rc.colo) || '' };
  return jsonResponse(spec, 200, rc);
}

/* ---------------- Gemini: wording read (flat list of every printed text item; the page merges it into another engine's structure) ---------------- */
async function handleGeminiText(env, image, mime, tier, rc) {
  const model = MODELS[tier], t0 = Date.now();
  let useThinking = true, resp = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const generationConfig = { responseMimeType: 'application/json', responseSchema: TEXT_SCHEMA, maxOutputTokens: 8192 };
    if (useThinking) generationConfig.thinkingConfig = { thinkingLevel: THINKING_LEVEL };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      resp = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: mime, data: image } }, { text: TEXT_PROMPT }] }], generationConfig }), signal: ctl.signal,
      });
    } catch (e) { return jsonResponse({ error: e && e.name === 'AbortError' ? 'The wording read took too long.' : 'Could not reach Gemini.' }, 502, rc); }
    finally { clearTimeout(timer); }
    if (resp.ok) break;
    const errText = await resp.text();
    if (resp.status === 400 && /location is not supported/i.test(errText)) {
      const c = classify(PROVIDERS.gemini, 400, errText, rc, 0);
      return jsonResponse({ error: c.text, code: c.code }, 502, rc);
    }
    if (resp.status === 400 && useThinking && /thinking/i.test(errText)) { useThinking = false; continue; }
    if ((resp.status === 429 || resp.status === 503) && attempt < 2) { await sleep(1200); continue; }
    return jsonResponse({ error: 'Gemini error ' + resp.status + ': ' + errText.slice(0, 200) }, resp.status, rc);
  }
  if (!resp || !resp.ok) return jsonResponse({ error: 'Gemini did not answer.' }, 502, rc);
  const { text } = extractText(await resp.json());
  let parsed;
  try { parsed = JSON.parse(text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '')); }
  catch (e) { return jsonResponse({ error: 'Gemini returned an unreadable wording list.' }, 502, rc); }
  const lines = list(parsed && parsed.lines, 600).filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, 300)).filter(Boolean);
  return jsonResponse({ lines, _meta: { provider: 'gemini', model, label: 'Gemini · ' + model.replace(/^gemini-/, ''), mode: 'text', ms: Date.now() - t0, colo: (rc && rc.colo) || '' } }, 200, rc);
}

/* ---------------- request entry ---------------- */
export default {
  async fetch(request, env) {
    const rc = { origin: request.headers.get('Origin') || '', colo: (request.cf && request.cf.colo) || '' };
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(rc.origin) });
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, rc);
    try {
      let body;
      try { body = await request.json(); } catch (e) { return jsonResponse({ error: 'Invalid request body.' }, 400, rc); }
      if (!body || typeof body !== 'object') return jsonResponse({ error: 'Invalid request body.' }, 400, rc);
      if (body.mode === 'engines') return jsonResponse(enginesInfo(env), 200, rc);   // no image needed: which engines have a key
      if (typeof body.image !== 'string' || !body.image) return jsonResponse({ error: 'Attach a photo or PDF of the form first.' }, 400, rc);
      if (body.image.length > MAX_BASE64_CHARS) return jsonResponse({ error: 'That file is too large. Try one under 15 MB.' }, 413, rc);
      const mime = typeof body.mime_type === 'string' ? body.mime_type : 'image/jpeg';
      if (!ALLOWED_MIME.includes(mime)) return jsonResponse({ error: 'Unsupported file type. Use a JPG, PNG, WebP or PDF.' }, 415, rc);

      const pid = body.provider === undefined || body.provider === null || body.provider === '' ? 'gemini' : String(body.provider);
      if (!hasOwn(PROVIDERS, pid)) return jsonResponse({ error: 'Unknown engine "' + pid.slice(0, 30) + '".', code: 'unknown_engine' }, 400, rc);
      const def = PROVIDERS[pid];
      if (!isReady(env, def)) return jsonResponse({ error: def.label + ' is not set up on the server yet (it needs ' + needsOf(def) + ').', code: 'not_ready' }, 503, rc);

      const mode = body.mode === 'text' ? 'text' : 'structure';
      const tier = body.tier === 'precise' ? 'precise' : 'fast';
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
      if (def.kind === 'gemini') return mode === 'text' ? await handleGeminiText(env, body.image, mime, tier, rc) : await handleGeminiStructure(env, body.image, mime, tier, note, rc);
      return await handleCompat(env, pid, def, mode, body.image, mime, note, rc);
    } catch (err) {
      return jsonResponse({ error: 'Unexpected server error: ' + (err && err.message ? err.message : 'unknown') }, 500, rc);
    }
  },
};
