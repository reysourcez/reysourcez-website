/* ============================================================
   Form Scanner — Gemini proxy (Cloudflare Worker)
   ------------------------------------------------------------
   Same job as every other *-proxy-worker.js on this site (see
   food-worth-proxy-worker.js, menu-calculator-proxy-worker.js):
   this file does NOT go in the reysourcez GitHub Pages repo's
   deployed site — it deploys separately, to Cloudflare Workers,
   and its only job is holding the real Gemini API key server-side
   (an encrypted Worker secret, set in the Cloudflare dashboard,
   never written in this file) so form-scanner.js and every visitor
   never see it.

   2026-09-22 rebuild — what changed and why (full reasoning in
   FORM_SCANNER_CHANGE_NOTES.md):
     - Endpoint/model verified against current Gemini docs this
       round (ai.google.dev, fetched 2026-09-22). generateContent
       is explicitly still Google's own recommended path for
       production ("remains fully supported... we will continue
       to actively develop and maintain it") even though the newer
       Interactions API is GA — so this file deliberately stays on
       generateContent, same as every sibling worker on this site.
       gemini-flash-lite-latest is confirmed as a real, current,
       auto-updating "-latest" alias (Google's own docs give
       gemini-flash-latest as the worked example of this exact
       naming pattern), so it's kept as-is rather than hardcoding
       a dated model string that Google's own deprecation schedule
       (e.g. gemini-2.5-flash-lite shutting down Oct 16 2026) would
       eventually break.
     - This replaces a separate "v4.3 default best" worker a
       different AI (Gemini) produced. That version worked for
       structure-reading, but regressed a few things vs. this
       site's established pattern because it didn't have this
       site's docs in context: CORS fell back to '*' instead of
       the safer first-allowed-origin; thinkingConfig was dropped
       (the exact fix that was needed once already, see the
       food-worth-proxy-worker.js 2026-09-08 note below); and the
       "recognized" flag was trusted at face value instead of
       being re-derived from whether anything was actually
       extracted. All three are restored here.

   WHAT THIS ENDPOINT DOES: takes one photo OR one page of a PDF of
   a printed/typed form and asks Gemini to describe its BLANK
   TEMPLATE structure — title, header fields (with column position
   and optional checkbox-style choices), every table (columns,
   optional two-row grouped headers, estimated relative column
   widths, blank row count), any pre-filled reference/lookup table,
   signature/sign-off blocks (with column position), footnotes, and
   a best-effort page orientation/size guess — as structured JSON.
   It does not transcribe handwriting or any values already filled
   in; the goal is a reusable blank template, not a copy of one
   filled-in instance. It also reads the note the person typed (if
   any) for an explicit request to change the OUTPUT page size,
   orientation, font, or text scale, and returns that separately as
   render_directives so form-scanner.js can apply it on top of
   whatever size/orientation it already detected from the source
   file itself. form-scanner.js then builds an actual fillable PDF
   from that JSON entirely in the visitor's browser (via pdf-lib) —
   this Worker never sees or stores the resulting PDF, and the
   source photo/PDF page is never written to disk anywhere.

   Contract with the browser:
     Browser sends  -> { image: "<base64>", mime_type: "image/jpeg"
                          | "application/pdf", note?: "optional
                          short text — structure guidance AND/OR an
                          explicit ask like 'make this A5 landscape,
                          bigger font'" }
     Worker returns -> { recognized, orientation, page_size_guess,
                          title, subtitles, reference_code,
                          header_fields: [{label, column, multiline,
                          options}], tables: [{section_title,
                          column_groups, columns, columns_width_pct,
                          blank_row_count}], reference_tables:
                          [{title, columns, rows}], signature_blocks:
                          [{heading, column, fields}], footnotes,
                          amount_in_words_label, render_directives:
                          {page_size, orientation, font_family,
                          font_scale_pct} }
                        or  { error: "..." }

   Real Gemini request/response shape below (endpoint
   v1beta/models/{model}:generateContent, model in the URL path,
   body { contents:[{parts:[...]}], generationConfig:{...} },
   response candidates[0].content.parts[0].text) — copied from
   food-worth-proxy-worker.js's own 2026-09-08 fix, not the earlier
   fabricated /v1beta/interactions shape that fix replaced. If this
   ever starts failing with a "missing request type"-style error
   again, that fabricated shape is the first thing to rule out —
   confirmed again this round (2026-09-22) against Google's current
   docs, see the note above.

   DEPLOY STEPS (Cloudflare dashboard, no local tooling needed):
     1. dash.cloudflare.com -> Workers & Pages -> your EXISTING
        form-scanner-proxy Worker (same one already deployed — this
        file replaces what's pasted into its "Edit code" view, the
        *.workers.dev URL and PROXY_ENDPOINT in form-scanner.js do
        NOT change).
     2. Edit code -> select all -> paste this file's contents ->
        Deploy.
     3. Settings -> Variables and Secrets -> confirm GEMINI_API_KEY
        is still set (Type: Secret). No change needed if it's
        already there from the previous deploy.
     4. Confirm ALLOWED_ORIGINS below still matches your domain(s).
   ============================================================ */

const ALLOWED_ORIGINS = ['https://reysourcez.com', 'https://www.reysourcez.com'];

const GEMINI_MODEL = 'gemini-flash-lite-latest'; // verified 2026-09-22 — see header note; matches every sibling worker on this site
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
function buildGeminiUrl(model) {
  return `${GEMINI_API_BASE}/${model}:generateContent`;
}

// Flat-ish schema on purpose, same reasoning as the original: a
// fully generic nested "blocks" tree is less reliable for the model
// to fill in correctly. This round adds a few new fields to close
// the biggest fidelity gaps (grouped table headers, relative column
// widths, more than two signature/header columns, a distinct
// "reference table" shape for pre-filled lookup grids) WITHOUT going
// fully generic — every new field is optional and the sanitizer
// below falls back cleanly when the model omits or garbles one, so
// a richer schema never becomes an all-or-nothing risk. Per project
// history, an earlier round that pushed further toward "more output
// formats" in one go stopped scanning reliably and was abandoned —
// this round deliberately stays short of that line.
const FORM_SCHEMA = {
  type: 'object',
  properties: {
    recognized: {
      type: 'boolean',
      description: 'True if the image/PDF page clearly shows a printed or typed form, register, or worksheet with fillable areas. False for a blank page, a photo unrelated to any document, or plain prose with no fields or tables.',
    },
    orientation: {
      type: 'string',
      enum: ['portrait', 'landscape'],
      description: 'The natural reading orientation of the form CONTENT itself — which way the title and body text actually run — regardless of how the photo happened to be framed or rotated.',
    },
    page_size_guess: {
      type: 'string',
      enum: ['A3', 'A4', 'A5', 'Letter', 'Legal', 'unsure'],
      description: 'Best-effort guess at the original paper size, judged from typical proportions, margin size, and how dense/compact the layout is. Only meaningful when the source is a PHOTO — if the source is a real PDF the app already knows its exact size and ignores this field. Use "unsure" rather than guessing if there is no confident signal either way.',
    },
    title: { type: 'string', description: 'The main heading printed on the document. Empty string if none.' },
    subtitles: {
      type: 'array',
      items: { type: 'string' },
      description: 'Sub-heading lines directly under the main title (e.g. an organisation name/address block). Empty array if none.',
    },
    reference_code: { type: 'string', description: 'A form/reference code printed on the document, e.g. "Lampiran 10" or "Form 27B". Empty string if none is visible.' },
    header_fields: {
      type: 'array',
      description: 'Standalone label-and-blank fields that sit above any table, in reading order (e.g. "Name:", "Date:", "Department:").',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          column: { type: 'integer', description: 'REQUIRED, do not skip this even under time pressure: which vertical column this field visually sits in, left to right starting at 1. Check every field\u2019s horizontal position against the others near it, not just its reading order. This is very common on official forms \u2014 e.g. a payment-voucher header where "BAYAR KEPADA" on the left and "NO. BAUCAR" on the right both start at roughly the same height: those are column 1 and column 2, not two fields in one stacked list. Only use 1 for every field if the header is genuinely one single stacked column with nothing beside anything.' },
          multiline: { type: 'boolean', description: 'True only if the blank space after this label is clearly taller than a single line (e.g. an address block).' },
          options: { type: 'array', items: { type: 'string' }, description: 'Fill in ONLY when this field is really a set of tick/checkboxes rather than a blank to write in, e.g. a payment-method choice — one entry per choice, exactly as printed. Empty array for an ordinary blank field.' },
        },
        required: ['label', 'column', 'multiline'],
      },
    },
    tables: {
      type: 'array',
      description: 'Every distinct table or ruled grid on the document, in reading order. A repeating "label + two or three blank columns" block counts as a table too, even without a conventional header row.',
      items: {
        type: 'object',
        properties: {
          section_title: { type: 'string', description: 'A heading printed directly above this table, if any. Empty string if the table has no heading of its own.' },
          column_groups: {
            type: 'array',
            description: 'Fill in ONLY when the table has a genuine two-row header — a top row of wider group labels sitting over two or more of the columns below (e.g. one "TUNAI" label sitting over both a "Masuk" and a "Keluar" column). Leave this an empty array for an ordinary single-row header. The spans must add up to the total number of columns.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                span: { type: 'integer', description: 'How many of the columns array entries, starting from where the previous group left off, this group label sits over.' },
              },
              required: ['label', 'span'],
            },
          },
          columns: { type: 'array', items: { type: 'string' }, description: 'Column headers, left to right, exactly as printed. For a repeating label-plus-blank-columns block with no real header row, use the row label text itself as the one column header.' },
          columns_width_pct: {
            type: 'array',
            items: { type: 'number' },
            description: 'Your best estimate of each column\u2019s width as a percentage of the table\u2019s total width, left to right, matching the source layout (so a narrow "Bil." column and a wide "Description" column come out looking like the original rather than evenly split). Should have exactly one number per column and add up to roughly 100. Leave as an empty array if you have no real signal — the app will fall back to sizing columns by header text length.',
          },
          blank_row_count: { type: 'integer', description: 'How many empty rows are ruled below the header for the user to fill in. Count only genuinely blank rows, not a header row.' },
        },
        required: ['section_title', 'columns', 'blank_row_count'],
      },
    },
    reference_tables: {
      type: 'array',
      description: 'A table that is printed REFERENCE information — already-filled lookup/threshold data the reader consults rather than a table meant to be filled in (e.g. "approval authority by amount"). Do not duplicate a table already listed above in tables. Empty array if none.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          columns: { type: 'array', items: { type: 'string' } },
          rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Each inner array is one row of already-printed cell text, in the same column order as columns.' },
        },
        required: ['title', 'columns', 'rows'],
      },
    },
    signature_blocks: {
      type: 'array',
      description: 'Sign-off areas such as "Prepared by" / "Approved by", each usually with its own Name/Position/Date-style fields.',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string', description: 'e.g. "Prepared by". Empty string if the block has no heading.' },
          column: { type: 'integer', description: 'REQUIRED, do not skip this even under time pressure: which position, left to right starting at 1, this block sits in. Check each block\u2019s actual horizontal position against the others, not just the order you read them in \u2014 e.g. if "Disediakan oleh" sits on the left of the page and "Disemak dan diluluskan oleh" sits to its right at a similar height (even if there are two or three "Disemak" blocks stacked underneath each other on that same right side), that is column 1 for the first and column 2 for all of the others, not four blocks all in column 1. Only use 1 for every block if they are genuinely one single stacked column with nothing beside anything.' },
          fields: { type: 'array', items: { type: 'string' }, description: 'e.g. ["Name", "Position", "Date"]' },
        },
        required: ['heading', 'column', 'fields'],
      },
    },
    footnotes: { type: 'array', items: { type: 'string' }, description: 'Small printed note/instruction lines near the bottom of the page (not a signature field). Empty array if none.' },
    amount_in_words_label: { type: 'string', description: 'If the form has one single emphasised line for writing an amount out in words (common on receipts/vouchers, e.g. "Ringgit Malaysia:"), its exact label. Empty string if the form has no such line.' },
    render_directives: {
      type: 'object',
      description: 'ONLY set from an explicit request in the note the person typed when scanning — never from your own judgement about what "should" look better. If the note asks for none of these, or there is no note, every field here must be "auto" (or 100 for font_scale_pct) so the app keeps the source\u2019s own size/orientation/font by default.',
      properties: {
        page_size: { type: 'string', enum: ['A3', 'A4', 'A5', 'Letter', 'Legal', 'auto'], description: '"auto" unless the note explicitly names a target size.' },
        orientation: { type: 'string', enum: ['portrait', 'landscape', 'auto'], description: '"auto" unless the note explicitly asks for the other orientation.' },
        font_family: { type: 'string', enum: ['helvetica', 'times', 'courier', 'auto'], description: '"auto" unless the note explicitly asks for a serif/typewriter/etc. look — "times" for a serif request, "courier" for a monospace/typewriter request.' },
        font_scale_pct: { type: 'integer', description: '100 means unchanged. Only set another value (e.g. 115) if the note explicitly asks for bigger/smaller text.' },
      },
      required: ['page_size', 'orientation', 'font_family', 'font_scale_pct'],
    },
  },
  required: ['recognized', 'title', 'header_fields', 'tables', 'signature_blocks', 'render_directives'],
};

const PROMPT = 'You are looking at either a photo or one PDF page of a printed or typed form, register, or worksheet \u2014 it may be photographed at a slight angle or with some skew; ignore that entirely and focus only on the printed content and layout structure. '
  + 'Your job is to describe the BLANK TEMPLATE structure of this document so it can be rebuilt as a clean, straight, fillable digital form \u2014 not to transcribe any handwriting or values someone has already filled in, and not to correct or rephrase anything printed. '
  + 'First decide whether this genuinely is a fillable form, worksheet, or register (recognized: true) or something else \u2014 a blank page, a photo unrelated to any document, or a passage of ordinary prose with no fields or tables (recognized: false). '
  + 'If recognized, also read the page\u2019s own natural orientation (orientation) and, only if this is a photo rather than a real PDF page, your best guess at its original paper size (page_size_guess). '
  + 'Identify: the main title; any subtitle/address lines under it; any form or reference code; every standalone header field in reading order, noting which column it sits in if the header genuinely has more than one and whether it is really a set of tick-box choices rather than a blank; every distinct table or ruled grid \u2014 including a repeating "label + two or three blank columns" block, which counts as a table even without a conventional header row \u2014 together with its column headers exactly as printed, a two-row grouped header if one genuinely exists, your best estimate of each column\u2019s relative width, and how many blank rows it has; any table that is already-printed reference/lookup information rather than something to fill in, as a separate reference table with its literal row text; any signature or sign-off blocks together with the field labels inside each one and which column position they sit in if more than one is arranged side by side; any small footnote lines near the bottom; and a single emphasised "amount in words" line if the form has one. '
  + 'For every header field and every signature block, actively check its horizontal position against the others near it before deciding on column \u2014 this is not optional and defaulting everything to column 1 is a common mistake to avoid. Official forms very often place two or three things side by side: a payment-voucher header with one block of fields on the left and another block (often including tick-box choices like a payment method) on the right at the same height; two, three, or more separate sign-off blocks such as "Disediakan oleh" and one or more "Disemak dan diluluskan oleh" blocks arranged in columns rather than one long stacked list. Look at where each piece of text actually sits on the page, not just the order it would be read aloud in. '
  + 'Read every label exactly as printed, in its original language. If a printed section heading sits directly above a table, attach it to that table as section_title rather than listing it separately. Keep strictly to what is visibly printed \u2014 do not invent fields, do not guess at values, and do not call a genuinely blank template unrecognized just because nothing has been filled in yet. '
  + 'Finally, look at any note the person scanning this form added (it may be about the form\u2019s content, or it may be a request about the OUTPUT \u2014 a different paper size, a different orientation, a different font, or bigger/smaller text). Populate render_directives from that request ONLY if it explicitly asks for one of those things; otherwise leave every render_directives field at its default ("auto", or 100 for font_scale_pct) so the output matches the source by default.';

function corsHeaders(origin) {
  // Falls back to the first allowed origin, not '*' \u2014 an
  // unrecognised Origin should never get an open CORS grant.
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

const EMPTY_RESULT = {
  recognized: false, orientation: 'portrait', page_size_guess: 'unsure',
  title: '', subtitles: [], reference_code: '',
  header_fields: [], tables: [], reference_tables: [], signature_blocks: [],
  footnotes: [], amount_in_words_label: '',
  render_directives: { page_size: 'auto', orientation: 'auto', font_family: 'auto', font_scale_pct: 100 },
};

function cleanStr(str, maxLen) {
  if (typeof str !== 'string') return '';
  return str.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen || 200);
}
function clampInt(val, min, max, fallback) {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}
function sanitizeEnum(val, allowed, fallback) {
  return allowed.includes(val) ? val : fallback;
}

// Defensive cleanup, same spirit as food-worth-proxy-worker.js's own
// sanitizers \u2014 never trust field types/lengths/enums at face
// value, and always return a shape the browser can render and build
// a PDF from without any extra checks of its own. Every NEW field
// this round has a safe fallback so a model response that gets one
// of them wrong or omits it degrades gracefully rather than breaking
// the whole scan.
function sanitizeResult(raw) {
  if (!raw || typeof raw !== 'object' || !raw.recognized) return { ...EMPTY_RESULT };

  const headerFields = Array.isArray(raw.header_fields) ? raw.header_fields
    .filter((f) => f && typeof f.label === 'string' && f.label.trim())
    .map((f) => ({
      label: cleanStr(f.label, 120),
      column: clampInt(f.column, 1, 3, 1),
      multiline: !!f.multiline,
      options: Array.isArray(f.options) ? f.options.filter((o) => typeof o === 'string' && o.trim()).map((o) => cleanStr(o, 40)).slice(0, 8) : [],
    }))
    .slice(0, 24) : [];

  const tables = Array.isArray(raw.tables) ? raw.tables
    .filter((t) => t && Array.isArray(t.columns) && t.columns.length > 0)
    .map((t) => {
      const columns = t.columns.filter((c) => typeof c === 'string' && c.trim()).map((c) => cleanStr(c, 60)).slice(0, 15);
      // columns_width_pct only kept if it genuinely matches the
      // column count and roughly sums to 100 \u2014 otherwise the
      // builder falls back to its own header-length heuristic, so a
      // slightly-off model estimate can never distort the table.
      let widths = Array.isArray(t.columns_width_pct) ? t.columns_width_pct.map((w) => Number(w)).filter((w) => Number.isFinite(w) && w > 0) : [];
      if (widths.length !== columns.length) widths = [];
      else {
        const sum = widths.reduce((s, w) => s + w, 0);
        if (sum < 60 || sum > 140) widths = [];
      }
      // column_groups only kept if every span is a positive integer
      // and the spans add up to exactly the column count \u2014
      // otherwise dropped so the table still renders with a normal
      // single-row header instead of a broken/mismatched one.
      let groups = Array.isArray(t.column_groups) ? t.column_groups
        .filter((g) => g && typeof g.label === 'string' && g.label.trim())
        .map((g) => ({ label: cleanStr(g.label, 60), span: clampInt(g.span, 1, 15, 1) }))
        .slice(0, 8) : [];
      if (groups.length) {
        const spanSum = groups.reduce((s, g) => s + g.span, 0);
        if (spanSum !== columns.length) groups = [];
      }
      return {
        section_title: cleanStr(t.section_title, 120),
        column_groups: groups,
        columns,
        columns_width_pct: widths,
        blank_row_count: clampInt(t.blank_row_count, 1, 60, 1),
      };
    })
    .filter((t) => t.columns.length > 0)
    .slice(0, 10) : [];

  const referenceTables = Array.isArray(raw.reference_tables) ? raw.reference_tables
    .filter((rt) => rt && Array.isArray(rt.columns) && rt.columns.length > 0 && Array.isArray(rt.rows))
    .map((rt) => ({
      title: cleanStr(rt.title, 100),
      columns: rt.columns.filter((c) => typeof c === 'string' && c.trim()).map((c) => cleanStr(c, 60)).slice(0, 10),
      rows: rt.rows
        .filter((r) => Array.isArray(r))
        .map((r) => r.map((cell) => cleanStr(cell, 80)).slice(0, 10))
        .slice(0, 20),
    }))
    .filter((rt) => rt.columns.length > 0 && rt.rows.length > 0)
    .slice(0, 3) : [];

  const signatureBlocks = Array.isArray(raw.signature_blocks) ? raw.signature_blocks
    .filter((s) => s && Array.isArray(s.fields) && s.fields.length > 0)
    .map((s) => ({
      heading: cleanStr(s.heading, 80),
      column: clampInt(s.column, 1, 4, 1),
      fields: s.fields.filter((f) => typeof f === 'string' && f.trim()).map((f) => cleanStr(f, 40)).slice(0, 8),
    }))
    .filter((s) => s.fields.length > 0)
    .slice(0, 8) : [];

  const subtitles = Array.isArray(raw.subtitles) ? raw.subtitles.filter((s) => typeof s === 'string' && s.trim()).map((s) => cleanStr(s, 160)).slice(0, 5) : [];
  const footnotes = Array.isArray(raw.footnotes) ? raw.footnotes.filter((f) => typeof f === 'string' && f.trim()).map((f) => cleanStr(f, 220)).slice(0, 10) : [];

  // Belt-and-suspenders, same as the original: re-derive "did we
  // actually get anything" from what was actually extracted, rather
  // than trusting raw.recognized at face value.
  const recognized = headerFields.length > 0 || tables.length > 0 || referenceTables.length > 0 || signatureBlocks.length > 0;
  if (!recognized) return { ...EMPTY_RESULT };

  const rd = raw.render_directives && typeof raw.render_directives === 'object' ? raw.render_directives : {};

  return {
    recognized: true,
    orientation: sanitizeEnum(raw.orientation, ['portrait', 'landscape'], 'portrait'),
    page_size_guess: sanitizeEnum(raw.page_size_guess, ['A3', 'A4', 'A5', 'Letter', 'Legal', 'unsure'], 'unsure'),
    title: cleanStr(raw.title, 160),
    subtitles,
    reference_code: cleanStr(raw.reference_code, 60),
    header_fields: headerFields,
    tables,
    reference_tables: referenceTables,
    signature_blocks: signatureBlocks,
    footnotes,
    amount_in_words_label: cleanStr(raw.amount_in_words_label, 120),
    render_directives: {
      page_size: sanitizeEnum(rd.page_size, ['A3', 'A4', 'A5', 'Letter', 'Legal', 'auto'], 'auto'),
      orientation: sanitizeEnum(rd.orientation, ['portrait', 'landscape', 'auto'], 'auto'),
      font_family: sanitizeEnum(rd.font_family, ['helvetica', 'times', 'courier', 'auto'], 'auto'),
      font_scale_pct: clampInt(rd.font_scale_pct, 70, 160, 100),
    },
  };
}

// Same extractGeminiText() walk as food-worth-proxy-worker.js:
// candidates[0].content.parts[0].text, defensive at every level since
// any of these can legitimately be missing (e.g. an empty candidates
// array on a safety block) \u2014 this returns '' rather than throwing
// either way.
function extractGeminiText(data) {
  const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const textPart = parts.find((p) => typeof p.text === 'string');
  return textPart ? textPart.text : '';
}

function extractResult(data) {
  const raw = extractGeminiText(data).trim();
  if (!raw) return { ...EMPTY_RESULT };
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
  try {
    return sanitizeResult(JSON.parse(cleaned));
  } catch (e) {
    return { ...EMPTY_RESULT };
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Top-level catch-all \u2014 a genuine improvement worth keeping
    // from the Gemini-built v4.3 round: any unexpected throw still
    // comes back as a clean JSON error instead of a bare 500 with no
    // body the browser can't parse.
    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders(origin) });
      }
      if (request.method !== 'POST') {
        return json({ error: 'Method not allowed' }, 405, origin);
      }

      let body;
      try { body = await request.json(); }
      catch (e) { return json({ error: 'Invalid request body' }, 400, origin); }

      const hasImage = typeof body.image === 'string' && body.image.length > 0;
      if (!hasImage) {
        return json({ error: 'Attach a photo or PDF page of the form first.' }, 400, origin);
      }
      const mimeType = typeof body.mime_type === 'string' ? body.mime_type : 'image/jpeg';
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 400) : '';

      if (!env.GEMINI_API_KEY) {
        return json({ error: 'Server is missing its Gemini key \u2014 add the GEMINI_API_KEY secret in this Worker\u2019s Settings.' }, 500, origin);
      }

      const geminiParts = [{ text: PROMPT }];
      if (note) geminiParts.push({ text: 'Note from the person scanning this: ' + note });
      geminiParts.push({ inlineData: { mimeType, data: body.image } });

      let geminiResp;
      try {
        geminiResp = await fetch(buildGeminiUrl(GEMINI_MODEL), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
          body: JSON.stringify({
            contents: [{ parts: geminiParts }],
            generationConfig: {
              // Restored from the original build \u2014 the Gemini
              // v4.3 rebuild dropped this, which is the exact
              // condition that already caused a slow/timed-out
              // response once before (see food-worth-proxy-worker.js's
              // 2026-09-08 fix). 3-series models default to thinking
              // level "high" if this is left unset, which is
              // unnecessary for a single structured-extraction call.
              thinkingConfig: { thinkingLevel: 'low' },
              responseMimeType: 'application/json',
              responseSchema: FORM_SCHEMA,
            },
          }),
        });
      } catch (e) {
        return json({ error: 'Could not reach Gemini. Try again.' }, 502, origin);
      }

      if (!geminiResp.ok) {
        let detail = '';
        try {
          const errBody = await geminiResp.text();
          try {
            const errJson = JSON.parse(errBody);
            detail = (errJson.error && errJson.error.message) || errBody;
          } catch (e2) { detail = errBody; }
        } catch (e) {}
        detail = detail.slice(0, 500);
        console.error('[Form Scanner Proxy] Gemini error', geminiResp.status, detail);
        return json({ error: 'Gemini error ' + geminiResp.status + (detail ? ': ' + detail : '') }, geminiResp.status, origin);
      }

      const data = await geminiResp.json();
      return json(extractResult(data), 200, origin);
    } catch (err) {
      console.error('[Form Scanner Proxy] Unhandled error', err && err.message);
      return json({ error: 'Unexpected server error. Try again.' }, 500, origin);
    }
  },
};
