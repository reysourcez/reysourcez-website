/* ============================================================
   SOP Creator — Gemini proxy (Cloudflare Worker)
   ------------------------------------------------------------
   Same split as every other tool on this site (see
   food-worth-proxy-worker.js / menu-calculator-proxy-worker.js):
   this file does NOT go in the reysourcez GitHub Pages repo's
   deployed site \u2014 it deploys separately, to Cloudflare Workers.
   Its only job: hold the real Gemini API key server-side (an
   encrypted Worker secret, set in the Cloudflare dashboard, never
   written in this file) and forward SOP-drafting / translation
   requests to Gemini on the browser's behalf. The key never
   reaches sop-creator.js or any visitor \u2014 nothing in this whole
   feature can be inspected or extracted from the page source.

   A dedicated Worker, not a shared one \u2014 same reasoning as every
   other tool here: each tool keeps its own Worker (its own secret,
   its own quota) so one tool's usage or an outage can't touch
   another's.

   Contract with the browser (see sop-creator.js's callWorker()):

     Request  (draft mode, default) ->
       { industry, processName, department,
         standards: ["ISO 9001:2015", ...],
         flowSummary: "free text describing the process" }
     Response (draft mode) ->
       { purpose, scope,
         definitions: [{ term, meaning }],
         responsibilities: [{ role, duty }],
         procedure: [{ step }],
         records: [string, ...],
         suggestedStandards: [{ name, note }] }
       or { error: "..." }

     Request  (translate mode) ->
       { mode: "translate", text: "assembled SOP text", targetLanguage: "Bahasa Malaysia" }
     Response (translate mode) -> { text: "translated document" } or { error: "..." }

   Uses the real, confirmed-correct Gemini generateContent endpoint
   and request/response shape (model in the URL path; body is
   { contents: [{ parts }], generationConfig: {...} }) \u2014 see
   food-worth-proxy-worker.js's own 2026-09-08 change notes for the
   fabricated-endpoint bug ( /v1beta/interactions ) this deliberately
   starts clear of, rather than repeating it.

   DEPLOY STEPS (Cloudflare dashboard, no local tooling needed):
     1. dash.cloudflare.com -> Workers & Pages -> Create -> Create Worker.
     2. Name it (e.g. sop-creator-proxy) -> Deploy the default
        template first, then Edit code and replace everything with
        this file's contents. Deploy.
     3. Update ALLOWED_ORIGINS below to your real domain(s).
     4. Settings -> Variables and Secrets -> Add -> Type: Secret,
        Name: GEMINI_API_KEY, Value: your Gemini key -> Save and deploy.
        (The same key your other tools already use works fine here
        too \u2014 Google doesn't limit a key to one Worker. A separate
        key is only worth it if you want separate usage tracking.)
     5. Copy the *.workers.dev URL Cloudflare shows you.
     6. Paste that URL into PROXY_ENDPOINT near the top of
        sop-creator.js, replacing the placeholder there.
   ============================================================ */

const ALLOWED_ORIGINS = ['https://reysourcez.com', 'https://www.reysourcez.com'];

// "-latest" alias, same convention as menu-calculator-proxy-worker.js
// and market-radar-proxy-worker.js \u2014 one less thing to manually
// update if Google renames a specific dated version.
const GEMINI_MODEL = 'gemini-flash-lite-latest';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SOP_SCHEMA = {
  type: 'object',
  properties: {
    purpose: { type: 'string', description: 'One to two sentences: why this SOP exists.' },
    scope: { type: 'string', description: 'One to two sentences: who and what this covers, and what it excludes if that matters.' },
    definitions: {
      type: 'array',
      description: 'Only terms/abbreviations an ordinary new staff member in this role might not already know. Empty array if none are needed \u2014 do not pad this out.',
      items: {
        type: 'object',
        properties: { term: { type: 'string' }, meaning: { type: 'string' } },
        required: ['term', 'meaning'],
      },
    },
    responsibilities: {
      type: 'array',
      description: 'By ROLE (e.g. "Shift Supervisor", "Line Cook"), never by a named individual.',
      items: {
        type: 'object',
        properties: { role: { type: 'string' }, duty: { type: 'string' } },
        required: ['role', 'duty'],
      },
    },
    procedure: {
      type: 'array',
      description: 'The actual steps, in the order they happen, one clear action per step, imperative voice ("Check the...", not "The... is checked"). If a step fills a gap the business did not actually state, end that step\u2019s text with " [assumed]" so it stays easy to spot, confirm, or remove.',
      items: {
        type: 'object',
        properties: { step: { type: 'string' } },
        required: ['step'],
      },
    },
    records: {
      type: 'array',
      description: 'What logs, forms, checklists, or documents this process should produce or reference \u2014 plain names, e.g. "Daily temperature log".',
      items: { type: 'string' },
    },
    suggestedStandards: {
      type: 'array',
      description: 'The standard(s) most relevant to this specific process, given the industry and any standards already picked. One plain sentence per entry on why it\u2019s relevant. Never invent a standard name or number you are not reasonably confident is real \u2014 naming one in general terms beats fabricating a precise citation.',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, note: { type: 'string' } },
        required: ['name', 'note'],
      },
    },
  },
  required: ['purpose', 'scope', 'definitions', 'responsibilities', 'procedure', 'records', 'suggestedStandards'],
};

const DRAFT_PROMPT_PREFIX = 'You are an operations consultant helping a small or medium business turn a real, '
  + 'possibly messy description of how they already do something into a clear, standards-aware Standard '
  + 'Operating Procedure (SOP). The business may describe steps out of order, skip obvious ones, or use their '
  + 'own shorthand \u2014 organize it into clean, sequential, actionable instructions a new staff member could '
  + 'follow without asking questions, rather than inventing an unrelated process. Where you fill a reasonable '
  + 'gap the business did not actually state, mark that step " [assumed]" so it stays easy to spot and confirm '
  + 'or remove. Write responsibilities by role, never by a named person. Never invent a standard name, number, '
  + 'or clause you are not reasonably confident is real \u2014 naming a standard in general terms is better than '
  + 'fabricating a precise citation.';

const TRANSLATE_PROMPT_PREFIX = 'You are translating a Standard Operating Procedure (SOP) for internal staff '
  + 'use. Preserve the document\u2019s structure, section headings, and numbering exactly \u2014 translate the '
  + 'words, not the shape. Keep square-bracket placeholders like [Insert Department] as placeholders, '
  + 'translating only the descriptive text inside the brackets. Use plain, professional language a frontline '
  + 'staff member in that language would find natural to follow, not an overly literal or academic '
  + 'translation. Output only the translated document text \u2014 no preamble, no notes, no commentary before or '
  + 'after it.';

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
}

// Real generateContent response shape: candidates[0].content.parts[0].text
// \u2014 same walk as every other Worker on this site, defensive at every
// level since an empty candidates array (e.g. a safety block) is a real,
// non-exceptional possibility, not a bug to crash on.
function extractText(data) {
  const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const textPart = parts.find((p) => typeof p.text === 'string');
  return textPart ? textPart.text : '';
}

const EMPTY_DRAFT = { purpose: '', scope: '', definitions: [], responsibilities: [], procedure: [], records: [], suggestedStandards: [] };

// Coerces whatever Gemini hands back into a shape the browser can trust
// blindly \u2014 same defensive spirit as every other *-proxy-worker.js's
// own sanitize step (e.g. food-worth's sanitizePriceRange).
function sanitizeDraft(parsed) {
  const str = (v) => (typeof v === 'string' ? v : '');
  const arr = (v) => (Array.isArray(v) ? v : []);
  return {
    purpose: str(parsed.purpose),
    scope: str(parsed.scope),
    definitions: arr(parsed.definitions).filter((d) => d && d.term).map((d) => ({ term: str(d.term), meaning: str(d.meaning) })),
    responsibilities: arr(parsed.responsibilities).filter((r) => r && r.role).map((r) => ({ role: str(r.role), duty: str(r.duty) })),
    procedure: arr(parsed.procedure).filter((p) => p && p.step).map((p) => ({ step: str(p.step) })),
    records: arr(parsed.records).filter((r) => typeof r === 'string' && r.trim()),
    suggestedStandards: arr(parsed.suggestedStandards).filter((s) => s && s.name).map((s) => ({ name: str(s.name), note: str(s.note) })),
  };
}

function extractDraft(data) {
  const raw = extractText(data).trim();
  if (!raw) return { ...EMPTY_DRAFT };
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
  try { return sanitizeDraft(JSON.parse(cleaned)); }
  catch (e) { return { ...EMPTY_DRAFT }; }
}

async function callGemini(env, parts, generationConfig) {
  return fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ parts }], generationConfig }),
  });
}

async function geminiErrorDetail(resp) {
  try {
    const errBody = await resp.text();
    try { const j = JSON.parse(errBody); return ((j.error && j.error.message) || errBody).slice(0, 500); }
    catch (e2) { return errBody.slice(0, 500); }
  } catch (e) { return ''; }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: 'Invalid request body' }, 400, origin); }

    if (!env.GEMINI_API_KEY) {
      return json({ error: 'Server is missing its Gemini key \u2014 add the GEMINI_API_KEY secret in this Worker\u2019s Settings.' }, 500, origin);
    }

    const isTranslate = body.mode === 'translate';

    if (isTranslate) {
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      const targetLanguage = typeof body.targetLanguage === 'string' ? body.targetLanguage.trim() : '';
      if (!text || !targetLanguage) return json({ error: 'Provide both the SOP text and a target language.' }, 400, origin);

      let resp;
      try {
        resp = await callGemini(env, [
          { text: TRANSLATE_PROMPT_PREFIX + ' Target language: ' + targetLanguage + '.' },
          { text: 'DOCUMENT:\n' + text },
        ], { temperature: 0.3, maxOutputTokens: 3000 });
      } catch (e) { return json({ error: 'Could not reach Gemini. Try again.' }, 502, origin); }

      if (!resp.ok) {
        const detail = await geminiErrorDetail(resp);
        console.error('[SOP Creator Proxy] Gemini error (translate)', resp.status, detail);
        return json({ error: 'Gemini error ' + resp.status + (detail ? ': ' + detail : '') }, resp.status, origin);
      }
      const data = await resp.json();
      const translated = extractText(data).trim();
      if (!translated) return json({ error: 'Gemini did not return a translation that time. Try again.' }, 502, origin);
      return json({ text: translated }, 200, origin);
    }

    // Draft mode (default)
    const industry = typeof body.industry === 'string' ? body.industry.trim() : '';
    const processName = typeof body.processName === 'string' ? body.processName.trim() : '';
    const department = typeof body.department === 'string' ? body.department.trim() : '';
    const standards = Array.isArray(body.standards) ? body.standards.filter((s) => typeof s === 'string' && s.trim()) : [];
    const flowSummary = typeof body.flowSummary === 'string' ? body.flowSummary.trim() : '';

    if (!flowSummary) return json({ error: 'Describe the process first.' }, 400, origin);

    const contextLines = [
      'Industry: ' + (industry || 'Not specified'),
      processName ? 'Process name: ' + processName : '',
      department ? 'Department/Owner: ' + department : '',
      'Standards already selected by the business: ' + (standards.length ? standards.join(', ') : 'None picked yet \u2014 suggest the most relevant one(s) yourself.'),
    ].filter(Boolean).join('\n');

    let resp;
    try {
      resp = await callGemini(env, [
        { text: DRAFT_PROMPT_PREFIX },
        { text: contextLines },
        { text: 'PROCESS, IN THE BUSINESS\u2019S OWN WORDS:\n' + flowSummary },
      ], {
        temperature: 0.4,
        // "Organize and label what's already described" doesn't need
        // deep reasoning \u2014 same low-thinking call food-worth-proxy-
        // worker.js makes for its own per-photo analysis, for the same
        // latency reason.
        thinkingConfig: { thinkingLevel: 'low' },
        responseMimeType: 'application/json',
        responseSchema: SOP_SCHEMA,
      });
    } catch (e) { return json({ error: 'Could not reach Gemini. Try again.' }, 502, origin); }

    if (!resp.ok) {
      const detail = await geminiErrorDetail(resp);
      console.error('[SOP Creator Proxy] Gemini error (draft)', resp.status, detail);
      return json({ error: 'Gemini error ' + resp.status + (detail ? ': ' + detail : '') }, resp.status, origin);
    }
    const data = await resp.json();
    return json(extractDraft(data), 200, origin);
  },
};
