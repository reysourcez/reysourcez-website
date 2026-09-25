/* ============================================================
   Form Scanner — Gemini proxy (Cloudflare Worker)
   Version: v6.0 (2026-09-24) — returns a LAYOUT SPEC (bands > columns > cells > items)
   Deploys to Cloudflare Workers (NOT to GitHub Pages). Holds the Gemini key as the
   encrypted secret GEMINI_API_KEY. Steps + glossary: FORM_SCANNER_SETUP_AND_GLOSSARY.md
   Request : { image: "<base64>", mime_type, note?, tier?: "fast" | "precise" }
   Response: the spec (see FORM_SCHEMA) + _meta, or { error }
   ============================================================ */

const ALLOWED_ORIGINS = ['https://reysourcez.com', 'https://www.reysourcez.com'];

// Model per tier. Aliases hot-swap to newer releases; pin a version here if results ever drift.
const MODELS = {
  fast: 'gemini-flash-lite-latest',   // default, cheapest
  precise: 'gemini-3.8-flash',        // "High-accuracy scan" tick box (GA; supports thinking levels low/medium/high)
};
const THINKING_LEVEL = 'low';         // layout reading gains little from deep thinking
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_BASE64_CHARS = 20 * 1024 * 1024;      // ~15 MB file
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const UPSTREAM_TIMEOUT_MS = 55000;

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
  required: ['kind', 'height_pct'],
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

TEXT: copy every printed word exactly as printed (same language, spelling, capitals and punctuation such as " :"). Keep pre-printed text such as letterhead and organisation names. Leave out handwriting, stamps, signatures, scanner shadows and the photo background. If the copy is already filled in, describe the blank template. Lines drawn with dots or underscores after a label are blanks: use F, never transcribe the dots.

STRUCTURE, top to bottom
1. bands: cut the form into full-width horizontal bands in reading order. Give a band to every distinct block: a top-corner reference label, the title block, each group of fields, each table, each one-line row, the signature area, footnotes, each reference table.
   height_pct = the band's share of the total height of all bands (adds up to 100). gap = whitespace above it (none/small/medium/large). boxed = true when a rectangle outline is drawn around the band. frames = one big rectangle around several consecutive bands, as {from_band,to_band} (1-based band numbers).
2. kind "cells" (default): col_widths_pct lists the columns that sit side by side (adds up to 100; [100] for one full-width column; use an empty spacer column for blank margins). Each cell has col (its 1-based column), height_pct (its share of that column's height; the cells of one column add up to 100), boxed (a border around the cell) and fill ("none", or #RRGGBB for a coloured background). List the cells of column 1 first (top to bottom), then column 2, and so on. Content that sits left and right of each other MUST be in different columns; never put a left group and a right group in the same column. Use an empty cell (items []) for blank space above or below a box.
3. Each cell has items, top to bottom, every item a short coded string  CODE[flags] text
   T[..] text      printed text (not fillable)
   F[..] label     a label followed by a blank to fill in (label may be empty for a bare line or box)
   C[..] label :: option ; option _ ; option      tick boxes; "_" after an option = write-in line after it
   HR[..]          decorative horizontal rule (not fillable)
   SP[n]           empty stretchy space, n = 1 (small) to 5 (large); use it to leave room for signatures
   flags, comma separated, all optional: b bold; i italic; xs sm md lg xl text size (md is normal);
   left center right alignment; ul underline;
   F only: line (default) | box | none = how the blank looks; wNN = blank width as % of the cell (w40); tall = multi-line blank that stretches; rl = right-align the label so labels line up with the blanks; ind = indent a label-less blank to line up with the other blanks;
   C only: stack = options one under another (default is one row).
   Signature block: T[b] heading, SP[3], F[line,w70] (signature line), then F[none] rows for Name / Position / Date.
4. kind "table": a ruled grid with a heading row. table.columns = printed headings + width_pct (+ align, fill); header_groups = headings spanning several columns (from_column, span; 1-based); static_rows = rows that are already printed (one string per column, "" = empty cell); blank_rows = empty rows to fill in; total_label + total_span = a total row whose label spans the first N columns; numbered = first column is pre-numbered; fillable=false for reference tables that are only read; width_pct when the table is narrower than the band; header_fill / fill for coloured headings.

PAGE: page.size and page.orientation = the paper the form is printed on (A4 portrait unless it clearly is not); page.font = sans, serif or mono; margin_pct and fill_pct as described in the schema.
NOTE: the person may add a note. Only when it explicitly asks for a different paper size, orientation, font or text size, fill requested.*; otherwise leave requested as none / 0. Follow any other structural guidance in the note (for example "ignore the letterhead").
If the image is not a form, return recognized=false, empty title, page A4 portrait sans and bands [].

Tiny example of the SHAPE ONLY (never copy its content):
{"recognized":true,"title":"LEAVE REQUEST","reference_code":"Form HR-2","page":{"size":"A4","orientation":"portrait","font":"sans","margin_pct":5,"fill_pct":60},"requested":{"size":"none","orientation":"none","font":"none","text_scale_pct":0},"frames":[{"from_band":1,"to_band":3}],"bands":[{"kind":"cells","height_pct":12,"boxed":false,"col_widths_pct":[100],"cells":[{"col":1,"height_pct":100,"items":["T[b,xl,center] LEAVE REQUEST","T[i,xs,center] (Company name)"]}]},{"kind":"cells","height_pct":30,"boxed":false,"col_widths_pct":[55,45],"cells":[{"col":1,"height_pct":100,"items":["F[box] Name","F[box] Department","F[box] Position"]},{"col":2,"height_pct":100,"items":["F[box] Date","C[stack] Type :: Annual ; Sick ; Other _"]}]},{"kind":"table","height_pct":30,"table":{"columns":[{"header":"No","width_pct":8,"align":"center"},{"header":"Date","width_pct":30},{"header":"Reason","width_pct":62}],"header_fill":"#D9D9D9","blank_rows":4,"numbered":true}},{"kind":"cells","height_pct":28,"boxed":true,"col_widths_pct":[50,50],"cells":[{"col":1,"height_pct":100,"boxed":true,"items":["T[b,sm] Requested by","SP[3]","F[line,w70]","F[none,sm] Name :","F[none,sm] Date :"]},{"col":2,"height_pct":100,"boxed":true,"items":["T[b,sm] Approved by","SP[3]","F[line,w70]","F[none,sm] Name :","F[none,sm] Date :"]}]}]}`;

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
function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
}

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

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, origin);
    try {
      let body;
      try { body = await request.json(); } catch (e) { return jsonResponse({ error: 'Invalid request body.' }, 400, origin); }
      if (typeof body.image !== 'string' || !body.image) return jsonResponse({ error: 'Attach a photo or PDF of the form first.' }, 400, origin);
      if (body.image.length > MAX_BASE64_CHARS) return jsonResponse({ error: 'That file is too large. Try one under 15 MB.' }, 413, origin);
      const mime = typeof body.mime_type === 'string' ? body.mime_type : 'image/jpeg';
      if (!ALLOWED_MIME.includes(mime)) return jsonResponse({ error: 'Unsupported file type. Use a JPG, PNG, WebP or PDF.' }, 415, origin);
      if (!env.GEMINI_API_KEY) return jsonResponse({ error: 'The server is missing its GEMINI_API_KEY secret (Worker Settings > Variables and Secrets).' }, 500, origin);

      const tier = body.tier === 'precise' ? 'precise' : 'fast';
      const model = MODELS[tier];
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
      // file first, instructions after it (Google's recommended order for a single image/PDF)
      const parts = [{ inlineData: { mimeType: mime, data: body.image } }, { text: PROMPT }];
      if (note) parts.push({ text: 'Note from the person scanning this form (follow it as described above): ' + note });

      // attempt ladder: schema+thinking -> schema only -> plain JSON mode
      let useSchema = true, useThinking = true, resp = null, fallback = '';
      for (let attempt = 0; attempt < 4; attempt++) {
        try { resp = await callGemini(env, model, parts, useSchema, useThinking); }
        catch (e) { return jsonResponse({ error: e && e.name === 'AbortError' ? 'The scan took too long. Try again, or use a smaller/clearer file.' : 'Could not reach Gemini. Try again.' }, 502, origin); }
        if (resp.ok) break;
        const errText = await resp.text();
        console.error('[Form Scanner] Gemini', resp.status, model, errText.slice(0, 400));
        if (resp.status === 400 && useThinking && /thinking/i.test(errText)) { useThinking = false; fallback += 'no-thinking '; continue; }
        if (resp.status === 400 && useSchema && /schema|constraint|states|nesting|depth|too complex/i.test(errText)) { useSchema = false; fallback += 'no-schema '; continue; }
        if ((resp.status === 429 || resp.status === 503) && attempt < 2) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        let msg = errText;
        try { msg = (JSON.parse(errText).error || {}).message || errText; } catch (e) { /* keep raw */ }
        const friendly = resp.status === 429 || resp.status === 503 ? 'Gemini is busy right now. Please try again in a moment.' : `Gemini error ${resp.status}: ${String(msg).slice(0, 300)}`;
        return jsonResponse({ error: friendly }, resp.status, origin);
      }
      if (!resp || !resp.ok) return jsonResponse({ error: 'Gemini did not answer. Please try again.' }, 502, origin);

      const data = await resp.json();
      const { text, finish, blocked } = extractText(data);
      if (blocked) return jsonResponse({ error: 'Gemini declined to read this file (' + blocked + '). Try a different photo.' }, 422, origin);
      const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
      let parsed;
      try { parsed = JSON.parse(cleaned); }
      catch (e) {
        const why = finish === 'MAX_TOKENS' ? 'The form was too detailed to describe in one go. Try a closer photo of a simpler area, or scan again.' : 'Gemini returned an unreadable answer. Please scan again.';
        return jsonResponse({ error: why }, 502, origin);
      }
      const spec = sanitizeSpec(parsed);
      spec._meta = { model, tier, fallback: fallback.trim() };
      return jsonResponse(spec, 200, origin);
    } catch (err) {
      return jsonResponse({ error: 'Unexpected server error: ' + (err && err.message ? err.message : 'unknown') }, 500, origin);
    }
  },
};
