/**
 * pm-assist-worker.js — Cloudflare Worker
 * ============================================================
 * Optional. project-plan-architect.html works completely without
 * this — every category is a fill-in template. This only powers
 * the three ✨ buttons (Business case, Success criteria, Suggest
 * starter risks) — rewritten now that I can see your real
 * food-worth-proxy-worker.js and menu-calculator-proxy-worker.js:
 * every AI-touched tool on this site runs on Gemini through its
 * OWN Worker with its OWN secret (menu-calculator-proxy-worker.js's
 * own header explains why kept separate rather than shared), so
 * this follows that same shape instead of the Claude-API version
 * from earlier — that was a placeholder default, this is the real
 * pattern-match.
 *
 * ---- Deploy steps ----
 * 1. dash.cloudflare.com -> Workers & Pages -> Create -> Create
 *    Worker -> deploy the default template, then Edit code and
 *    paste this file's contents in. Deploy.
 * 2. Settings -> Variables and Secrets -> Add -> Secret ->
 *    name GEMINI_API_KEY, value from aistudio.google.com/apikey
 *    (a fresh key or the same one your other tools use both work —
 *    each Worker's secrets are independent of every other Worker's).
 * 3. Copy the *.workers.dev URL this prints and paste it into
 *    RZ_PM_CONFIG.aiAssistEndpoint near the top of
 *    project-plan-architect.html.
 * ============================================================
 */

const ALLOWED_ORIGINS = ['https://reysourcez.com', 'https://www.reysourcez.com'];
const GEMINI_MODEL = 'gemini-flash-lite-latest'; // "-latest" alias — same reasoning as menu-calculator-proxy-worker.js: one less thing to update if Google renames a specific version
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function corsHeaders(origin) {
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

// Structured output via responseSchema — same mechanism
// menu-calculator-proxy-worker.js already uses for its ingredient
// breakdown, so the response is guaranteed-shape JSON rather than
// free text this Worker has to regex apart.
const SUGGESTION_SCHEMA = { type: 'object', properties: { suggestion: { type: 'string' } }, required: ['suggestion'] };
const RISKS_SCHEMA = {
  type: 'object',
  properties: { risks: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 } },
  required: ['risks'],
};

const PROMPTS = {
  'business-case': (p) => 'Write a concise 2-3 sentence business case for a project called "' + (p.projectName || 'this project')
    + '", delivered using a ' + (p.approach || 'Predictive') + ' approach. Plain, professional language, no headers.'
    + (p.current ? ' Revise and improve this draft rather than starting over: "' + p.current + '"' : ''),
  'success-criteria': (p) => 'Suggest 3-4 measurable success criteria for a project called "' + (p.projectName || 'this project')
    + '" as one string with each criterion on its own line, no numbering.'
    + (p.current ? ' Build on this draft: "' + p.current + '"' : ''),
  'suggest-risks': (p) => 'List exactly 3 realistic project risks for a project called "' + (p.projectName || 'this project')
    + '", delivered using a ' + (p.approach || 'Predictive') + ' approach. Short, plain-language risk statements, no explanations.',
};

// Same defensive shape as food-worth-proxy-worker.js's extractGeminiText —
// an empty candidates array (e.g. a safety block) degrades to '' rather
// than throwing.
function extractGeminiText(data) {
  const candidate = Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [];
  const textPart = parts.find((p) => typeof p.text === 'string');
  return textPart ? textPart.text : '';
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: 'Invalid request body' }, 400, origin); }

    const buildPrompt = PROMPTS[body.kind];
    if (!buildPrompt) return json({ error: 'Unknown kind: ' + body.kind }, 400, origin);
    if (!env.GEMINI_API_KEY) return json({ error: 'Worker is missing GEMINI_API_KEY — see this file\u2019s own deploy steps' }, 500, origin);

    const isRisks = body.kind === 'suggest-risks';

    let geminiResp;
    try {
      geminiResp = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(body) }] }],
          generationConfig: {
            temperature: 0.5,
            responseMimeType: 'application/json',
            responseSchema: isRisks ? RISKS_SCHEMA : SUGGESTION_SCHEMA,
          },
        }),
      });
    } catch (e) {
      return json({ error: 'Could not reach Gemini. Try again.' }, 502, origin);
    }

    if (!geminiResp.ok) {
      let detail = '';
      try { detail = (await geminiResp.text()).slice(0, 500); } catch (e) {}
      return json({ error: 'Gemini error ' + geminiResp.status + (detail ? ': ' + detail : '') }, geminiResp.status, origin);
    }

    const data = await geminiResp.json();
    const raw = extractGeminiText(data).trim();
    try {
      const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, ''));
      return json(parsed, 200, origin);
    } catch (e) {
      return json({ error: 'Got an unreadable response from Gemini. Try again.' }, 502, origin);
    }
  },
};
