import fs from 'node:fs';
const worker = (await import('file:///home/claude/v68/worker.mjs')).default;
const workerT = (await import('file:///home/claude/v68/worker_t.mjs')).default;
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const SPEC = JSON.stringify({ recognized: true, title: 'T', page: { size: 'A4', orientation: 'portrait', font: 'sans' }, bands: [{ kind: 'cells', height_pct: 100, col_widths_pct: [100], cells: [{ col: 1, height_pct: 100, items: ['T[b] HELLO'] }] }] });
const LINES = JSON.stringify({ lines: ['BAUCAR BAYARAN', 'NAMA :'] });
const IMG = { image: 'QUJD', mime_type: 'image/jpeg' };
const origFetch = globalThis.fetch;
async function call(w, body, env, fetchMock) {
  globalThis.fetch = fetchMock || (async () => { throw new Error('unexpected network call'); });
  const req = new Request('https://w.example/', { method: 'POST', headers: { Origin: 'https://reysourcez.com', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const res = await w.fetch(req, env);
  const json = await res.json();
  globalThis.fetch = origFetch;
  return { status: res.status, json };
}
const jr = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const aiOK = (content, usage) => ({ run: async (model, input) => { aiOK.last = { model, input }; aiOK.calls = (aiOK.calls || 0) + 1; return { choices: [{ message: { content }, finish_reason: 'stop' }], usage }; } });

// ---- T1 engine list + readiness + order
{
  const env = { AI: { run() {} }, OPENROUTER_API_KEY: 'k', GEMINI_API_KEY: 'g', GROQ_API_KEY: 'q' };
  const r = await call(worker, { mode: 'engines' }, env);
  const byId = Object.fromEntries(r.json.engines.map((e) => [e.id, e]));
  ok(r.json.worker === 'v6.8 (2026-10-13)', 'T1 version', r.json.worker);
  ok(r.json.engines.map((e) => e.id).join() === 'gemini,cfqwen,groq,dots,qwen,orfree,mistral,cfscout,nvllama,kimi,deepseek,claude', 'T1 order', r.json.engines.map((e) => e.id).join());
  ok(byId.cfqwen.ready && byId.dots.ready && byId.cfscout.ready && byId.groq.ready && byId.gemini.ready, 'T1 ready set');
  ok(!byId.mistral.ready && !byId.claude.ready, 'T1 unkeyed stay off');
  ok(byId.cfqwen.needs === 'a Workers AI binding named AI' && byId.dots.needs === 'OPENROUTER_API_KEY', 'T1 needs text', [byId.cfqwen.needs, byId.dots.needs]);
  const r2 = await call(worker, { mode: 'engines' }, { GEMINI_API_KEY: 'g' });
  const b2 = Object.fromEntries(r2.json.engines.map((e) => [e.id, e]));
  ok(!b2.cfqwen.ready && !b2.dots.ready && !b2.cfscout.ready && b2.gemini.ready, 'T1b nothing but Gemini');
}
// ---- T2 cfqwen happy path
{
  const ai = aiOK(SPEC, { prompt_tokens: 4500, completion_tokens: 3200 });
  const r = await call(worker, { ...IMG, provider: 'cfqwen' }, { AI: ai });
  const m = r.json._meta || {};
  ok(r.status === 200 && r.json.recognized === true, 'T2 status/spec', r);
  ok(m.provider === 'cfqwen' && m.label === 'Qwen3.8-27B · Cloudflare' && m.model === '@cf/qwen/qwen3.8-27b', 'T2 meta', m);
  ok(m.usage && m.usage.in === 4500 && m.usage.out === 3200 && m.usage.neurons === 1115, 'T2 usage+neurons', m.usage);
  ok(m.tries === 1 && m.fallback === '', 'T2 tries/fallback', m);
  const inp = aiOK.last.input;
  ok(aiOK.last.model === '@cf/qwen/qwen3.8-27b', 'T2 model id');
  ok(inp.reasoning_effort === 'low' && inp.max_completion_tokens === 12000 && inp.max_tokens === undefined && inp.temperature === 0, 'T2 params', inp);
  ok(inp.messages[0].content[1].type === 'image_url' && inp.messages[0].content[1].image_url.url === 'data:image/jpeg;base64,QUJD', 'T2 image part');
  ok(inp.messages[0].content[0].text.length > 5000 && inp.messages[0].content[0].text.includes('LAYOUT SPEC'), 'T2 prompt present');
  const ptxt = inp.messages[0].content[0].text;
  ok(/Grey or italic sample text inside an entry cell/.test(ptxt) && /is PRINTED text, not an answer: keep it, as the label of that entry's blank/.test(ptxt) && /Only real handwriting or typed-in answers are left out/.test(ptxt), 'T2 v6.8 sample-text rule is in the prompt');
  ok(/Leave out handwriting, stamps, signatures/.test(ptxt) && /describe the blank template/.test(ptxt), 'T2 older rules still there (handwriting left out, blank template)');
}
// ---- T2b note is passed
{
  const ai = aiOK(SPEC, null);
  const r = await call(worker, { ...IMG, provider: 'cfqwen', note: 'make it A5' }, { AI: ai });
  ok(r.status === 200 && r.json._meta.usage === null, 'T2b no usage -> null', r.json._meta);
  ok(aiOK.last.input.messages[0].content[0].text.includes('make it A5'), 'T2b note in prompt');
}
// ---- T3 text mode caps the answer
{
  const ai = aiOK(LINES, { prompt_tokens: 900, completion_tokens: 200 });
  const r = await call(worker, { ...IMG, provider: 'cfqwen', mode: 'text' }, { AI: ai });
  ok(r.status === 200 && r.json.lines.length === 2 && r.json._meta.mode === 'text', 'T3 text lines', r);
  ok(aiOK.last.input.max_completion_tokens === 4096, 'T3 cap 4096', aiOK.last.input.max_completion_tokens);
}
// ---- T4 reasoning option rejected -> one retry without it
{
  let n = 0; const inputs = [];
  const ai = { run: async (m, input) => { inputs.push(input); if (++n === 1) throw new Error('InferenceUpstreamError: unknown field reasoning_effort'); return { choices: [{ message: { content: SPEC }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } }; } };
  const r = await call(worker, { ...IMG, provider: 'cfqwen' }, { AI: ai });
  ok(r.status === 200 && r.json._meta.tries === 2 && r.json._meta.fallback === 'no-reasoning-option', 'T4 retry meta', r.json._meta);
  ok(inputs.length === 2 && inputs[0].reasoning_effort === 'low' && inputs[1].reasoning_effort === undefined, 'T4 second call without option');
}
// ---- T5/T6/T7 Cloudflare errors
{
  const mk = (msg) => ({ run: async () => { throw new Error(msg); } });
  let r = await call(worker, { ...IMG, provider: 'cfqwen' }, { AI: mk('4006: you have used up your daily free allocation of 10,000 neurons') });
  ok(r.status === 429 && r.json.code === 'rate_limited' && /used up/.test(r.json.error), 'T5 allowance', r);
  r = await call(worker, { ...IMG, provider: 'cfqwen' }, { AI: mk('Please agree to the license terms of this model') });
  ok(r.status === 403 && r.json.code === 'license', 'T6 license', r);
  r = await call(worker, { ...IMG, provider: 'cfqwen' }, { AI: mk('InferenceUpstreamError: something else broke') });
  ok(r.status === 502 && /Cloudflare said: InferenceUpstreamError/.test(r.json.error), 'T7 other error', r);
}
// ---- T8 per-engine timeout is really used (test copy has timeoutMs 40; normal copy 175000)
{
  const slow = (ms) => ({ run: () => new Promise((res) => setTimeout(() => res({ choices: [{ message: { content: SPEC }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), ms)) });
  let r = await call(workerT, { ...IMG, provider: 'cfqwen' }, { AI: slow(250) });
  ok(r.status === 502 && r.json.code === 'timeout' && /over 0\.04 s/.test(r.json.error), 'T8 short timeout fires', r);
  r = await call(worker, { ...IMG, provider: 'cfqwen' }, { AI: slow(250) });
  ok(r.status === 200, 'T8 normal copy waits', r);
  const src = fs.readFileSync('/home/claude/v68/form-scanner-proxy-worker.js', 'utf8');
  ok(/dots: \{[^}]*timeoutMs: 175000/.test(src.replace(/\n/g, ' ')), 'T8 dots has long timeout');
}
// ---- T9 dots via OpenRouter (pinned id)
{
  let seen;
  const f = async (url, init) => { seen = { url, init, body: JSON.parse(init.body) }; return jr({ model: 'dots-studio/dots-3-note-preview:free', choices: [{ message: { content: SPEC }, finish_reason: 'stop' }], usage: { prompt_tokens: 5100, completion_tokens: 7400 } }); };
  const r = await call(worker, { ...IMG, provider: 'dots' }, { OPENROUTER_API_KEY: 'k' }, f);
  const m = r.json._meta || {};
  ok(r.status === 200 && m.label === 'Dots3-Note Preview · OpenRouter free' && m.provider === 'dots', 'T9 meta', m);
  ok(seen.url === 'https://openrouter.ai/api/v1/chat/completions' && seen.init.headers.Authorization === 'Bearer k' && seen.init.headers['X-Title'], 'T9 url/headers');
  ok(seen.body.model === 'dots-studio/dots-3-note-preview:free' && seen.body.reasoning.effort === 'low' && seen.body.response_format.type === 'json_object' && seen.body.max_tokens === 16384, 'T9 payload', seen.body);
  ok(m.usage.in === 5100 && m.usage.out === 7400 && m.usage.neurons === undefined && m.tries === 1, 'T9 usage', m);
}
// ---- T10 ladder counts tries
{
  let n = 0;
  const f = async () => (++n === 1 ? jr({ error: { message: 'bad param' } }, 400) : jr({ model: 'dots-studio/dots-3-note-preview:free', choices: [{ message: { content: SPEC }, finish_reason: 'stop' }] }));
  const r = await call(worker, { ...IMG, provider: 'dots' }, { OPENROUTER_API_KEY: 'k' }, f);
  ok(r.status === 200 && r.json._meta.tries === 2 && r.json._meta.fallback === 'no-reasoning', 'T10 tries 2', r.json._meta);
}
// ---- T11 Groq "Request too large"
{
  let n = 0;
  const msg = 'Request too large for model `qwen/qwen3.8-27b` in organization `org_01m4p2ym0gewnbhkb5164e7mdb` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 8412, please reduce your message size and try again. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing';
  const f = async () => { n++; return jr({ error: { message: msg, type: 'tokens', code: 'rate_limit_exceeded' } }, 413); };
  const r = await call(worker, { ...IMG, provider: 'groq' }, { GROQ_API_KEY: 'q' }, f);
  ok(r.status === 413 && r.json.code === 'image_too_large', 'T11 code', r);
  ok(/Limit 8000, Requested 8412/.test(r.json.error) && !/org_01m4/.test(r.json.error), 'T11 numbers kept, org id gone', r.json.error);
  ok(n === 1 && !/Wait a minute/.test(r.json.error), 'T11 not retried, no "wait" advice', n);
}
// ---- T12 Groq real rate limit stays a rate limit
{
  const msg = 'Rate limit reached for model `qwen/qwen3.8-27b` in organization `org_x` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7000, Requested 3000. Please try again in 20s.';
  const f = async () => jr({ error: { message: msg } }, 429, { 'retry-after': '20' });
  const r = await call(worker, { ...IMG, provider: 'groq' }, { GROQ_API_KEY: 'q' }, f);
  ok(r.status === 429 && r.json.code === 'rate_limited' && /about 20 s/.test(r.json.error), 'T12 rate limit', r);
}
// ---- T13 Groq success keeps working (+ usage, tries)
{
  let body;
  const f = async (u, init) => { body = JSON.parse(init.body); return jr({ model: 'qwen/qwen3.8-27b', choices: [{ message: { content: '```json\n' + SPEC + '\n```' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4400, completion_tokens: 2900, total_tokens: 7300 } }); };
  const r = await call(worker, { ...IMG, provider: 'groq' }, { GROQ_API_KEY: 'q' }, f);
  ok(r.status === 200 && r.json._meta.usage.in === 4400 && r.json._meta.usage.out === 2900 && r.json._meta.tries === 1, 'T13 groq ok', r.json._meta);
  ok(body.reasoning_effort === 'none' && body.response_format.type === 'json_object' && body.max_completion_tokens >= 1500 && body.max_completion_tokens < 4000, 'T13 groq payload', [body.reasoning_effort, body.max_completion_tokens]);
}
// ---- T14 guards unchanged
{
  let r = await call(worker, { ...IMG, provider: 'nope' }, { GEMINI_API_KEY: 'g' });
  ok(r.status === 400 && r.json.code === 'unknown_engine', 'T14 unknown engine');
  r = await call(worker, { ...IMG, provider: '__proto__' }, { GEMINI_API_KEY: 'g' });
  ok(r.status === 400 && r.json.code === 'unknown_engine', 'T14 __proto__');
  r = await call(worker, { image: 'QUJD', mime_type: 'application/pdf', provider: 'cfqwen' }, { AI: aiOK(SPEC) });
  ok(r.status === 415 && r.json.code === 'pdf_unsupported', 'T14 pdf to image-only engine', r);
  r = await call(worker, { ...IMG, provider: 'cfqwen' }, { GEMINI_API_KEY: 'g' });
  ok(r.status === 503 && r.json.code === 'not_ready', 'T14 not ready without binding', r);
  r = await call(worker, { provider: 'cfqwen' }, { AI: aiOK(SPEC) });
  ok(r.status === 400, 'T14 no image', r);
}
// ---- T15 Gemini untouched
{
  const f = async () => jr({ candidates: [{ content: { parts: [{ text: SPEC }] }, finishReason: 'STOP' }] });
  let r = await call(worker, { ...IMG }, { GEMINI_API_KEY: 'g' }, f);
  ok(r.status === 200 && r.json._meta.provider === 'gemini' && r.json.recognized === true, 'T15 gemini ok', r.json._meta);
  const loc = async () => jr({ error: { code: 400, status: 'FAILED_PRECONDITION', message: 'User location is not supported for the API use.' } }, 400);
  r = await call(worker, { ...IMG }, { GEMINI_API_KEY: 'g' }, loc);
  ok(r.json.code === 'location', 'T15 gemini location', r);
  const t = async () => jr({ candidates: [{ content: { parts: [{ text: LINES }] }, finishReason: 'STOP' }] });
  r = await call(worker, { ...IMG, mode: 'text' }, { GEMINI_API_KEY: 'g' }, t);
  ok(r.status === 200 && r.json.lines.length === 2, 'T15 gemini text mode', r);
}
// ---- T16 retired-free still explained; T17 orfree label; T18 Anthropic usage
{
  let r = await call(worker, { ...IMG, provider: 'qwen' }, { OPENROUTER_API_KEY: 'k' }, async () => jr({ error: { message: 'This model is unavailable for free. The paid version is available now - use this slug instead: qwen/qwen3.8-27b' } }, 404));
  ok(r.json.code === 'retired_free' && /qwen\/qwen3\.8-27b/.test(r.json.error), 'T16 retired free', r);
  r = await call(worker, { ...IMG, provider: 'orfree' }, { OPENROUTER_API_KEY: 'k' }, async () => jr({ model: 'dots-studio/dots-3-note-preview:free', choices: [{ message: { content: SPEC }, finish_reason: 'stop' }] }));
  ok(r.json._meta.label === 'OpenRouter free (auto-pick) · dots-studio/dots-3-note-preview:free', 'T17 orfree label', r.json._meta);
  r = await call(worker, { ...IMG, provider: 'claude' }, { ANTHROPIC_API_KEY: 'a' }, async () => jr({ content: [{ type: 'text', text: SPEC }], model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 5000, output_tokens: 3000 } }));
  ok(r.status === 200 && r.json._meta.usage.in === 5000 && r.json._meta.usage.out === 3000, 'T18 anthropic usage', r.json._meta);
}
// ---- T19 llama engine still sends the old params (no behaviour change for cfscout)
{
  const ai = aiOK(SPEC, { prompt_tokens: 100, completion_tokens: 50 });
  const r = await call(worker, { ...IMG, provider: 'cfscout' }, { AI: ai });
  ok(r.status === 200 && aiOK.last.input.max_tokens === 8192 && aiOK.last.input.reasoning_effort === undefined && aiOK.last.input.max_completion_tokens === undefined, 'T19 scout params unchanged', aiOK.last.input);
  ok(r.json._meta.usage.neurons === undefined, 'T19 no neuron maths for scout (no rates in registry)');
}
console.log(`\nWORKER TESTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
