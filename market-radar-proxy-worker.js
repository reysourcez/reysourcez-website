// Market Radar proxy Worker v1.7.0 (2026-10-15). Modes: context | pois | insight. History and rationale: MARKET_RADAR_HANDOFF.md / SETUP doc.
// v1.7.0: Overpass is passed through UNPARSED (no CPU-limit risk), `remark` timeouts are failures and never cached, query is by catchment bbox.
const WORKER_VERSION = '1.7.0';
const ALLOWED_ORIGINS = ['https://reysourcez.com', 'https://www.reysourcez.com'];
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const APP_USER_AGENT = 'ReysourcezMarketRadar/1.7 (+https://reysourcez.com/market-radar.html)';
const ORS_ISOCHRONE_ENDPOINT = 'https://api.heigit.org/openrouteservice/v2/isochrones/';
const DATA_GOV_MY_ENDPOINT = 'https://api.data.gov.my/data-catalogue';
const OPENDOSM_ENDPOINT = 'https://api.data.gov.my/opendosm';
const WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';
const GEMINI_MODEL = 'gemini-flash-lite-latest';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';
const EXTERNAL_CALL_TIMEOUT_MS = 10000;
const TAG_TOKEN = /^[A-Za-z0-9_:\-]{1,40}$/;
const MAX_TAG_PAIRS = 220;
const MAX_SPAN_DEG = 0.6;
const ORS_PROFILES = ['foot-walking', 'driving-car'];
const REMARK_BAD = /runtime error|timed out|out of memory|too many requests|rate.?limit/i;

/* ---------- helpers ---------- */
function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Expose-Headers': 'X-MR-Source, X-MR-Cache' };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
}
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
async function fetchWithTimeout(url, options, timeoutMs) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), timeoutMs || EXTERNAL_CALL_TIMEOUT_MS);
  try { return await fetch(url, { ...(options || {}), signal: c.signal }); } finally { clearTimeout(t); }
}
const clip = (v, n) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, n);
const cleanDistrict = (v) => (typeof v === 'string' ? v.replace(/[^A-Za-z .'\-]/g, '').trim().slice(0, 60) : '');
async function cacheGet(key) {
  try { const hit = await caches.default.match(key); return hit ? await hit.json() : null; } catch (e) { return null; }
}
async function cachePut(key, obj, maxAge) {
  try { await caches.default.put(key, new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + maxAge } })); } catch (e) { /* optional */ }
}
function cleanTags(tags) {
  if (!Array.isArray(tags) || !tags.length || tags.length > MAX_TAG_PAIRS) return null;
  const out = [];
  for (const p of tags) {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || !TAG_TOKEN.test(p[0]) || !TAG_TOKEN.test(p[1])) return null;
    out.push([p[0], p[1]]);
  }
  return out;
}
function cleanBbox(b) {
  if (!Array.isArray(b) || b.length !== 4 || b.some((x) => typeof x !== 'number' || !isFinite(x))) return null;
  const [s, w, n, e] = b;
  if (s >= n || w >= e || s < -90 || n > 90 || w < -180 || e > 180 || n - s > MAX_SPAN_DEG || e - w > MAX_SPAN_DEG) return null;
  return b;
}
// Must stay identical to MarketRadarEngine.buildOverpassQuery (a test asserts parity).
function buildOverpassQuery(bbox, tags, timeoutS) {
  const by = {};
  tags.forEach(([k, v]) => { (by[k] = by[k] || new Set()).add(v); });
  const bb = bbox.map((x) => Number(x).toFixed(6)).join(',');
  const body = Object.keys(by).sort().map((k) => {
    const vals = Array.from(by[k]).sort();
    return 'nwr["' + k + '"' + (vals.length === 1 ? '="' + vals[0] + '"' : '~"^(' + vals.join('|') + ')$"') + '](' + bb + ');';
  }).join('');
  return '[out:json][timeout:' + (timeoutS || 30) + '];(' + body + ');out center tags;';
}
// Overpass reports timeouts / out-of-memory as HTTP 200 with a "remark" — read only the ends of the body, never parse it.
function remarkProblem(bytes) {
  const td = new TextDecoder();
  const edge = td.decode(bytes.subarray(0, 800)) + ' ' + td.decode(bytes.subarray(Math.max(0, bytes.length - 1600)));
  const m = edge.match(/"remark"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  return m && REMARK_BAD.test(m[1]) ? m[1] : '';
}

/* ================= 2. OPENROUTESERVICE (real catchment shape) ================= */

async function fetchIsochrone(env, lat, lng, profile, seconds) {
  if (!env.ORS_API_KEY || !profile || !seconds) return null;

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/isochrone/${profile}/${seconds}/${lat.toFixed(3)}/${lng.toFixed(3)}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  try {
    const resp = await fetchWithTimeout(ORS_ISOCHRONE_ENDPOINT + profile, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: env.ORS_API_KEY },
      body: JSON.stringify({ locations: [[lng, lat]], range: [seconds], range_type: 'time' }), // ORS wants [lng, lat] — the one place in this file that ISN'T [lat, lng]
    });
    if (!resp.ok) return null;
    const geojson = await resp.json();
    const response = new Response(JSON.stringify(geojson), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=2592000' } });
    await cache.put(cacheKey, response.clone());
    return geojson;
  } catch (e) {
    return null;
  }
}

/* ================= 3. DATA.GOV.MY / OPENDOSM (district population & income) ================= */

function latestRow(rows) {
  if (!rows.length) return null;
  return rows.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0];
}

async function fetchDosmRows(datasetId, query, bases) {
  const trail = [];
  for (const base of bases) {
    const label = base === OPENDOSM_ENDPOINT ? 'OpenDOSM API' : 'Data Catalogue API';
    try {
      const resp = await fetchWithTimeout(`${base}?id=${datasetId}&${query}`, { headers: { Accept: 'application/json', 'User-Agent': APP_USER_AGENT } }, 8000);
      if (!resp.ok) { trail.push(`${label} HTTP ${resp.status}${resp.status === 429 ? ' (rate-limited, retry in a minute)' : ''}`); continue; }
      const body = await resp.json();
      const rows = Array.isArray(body) ? body : ((body && body.data) || []);
      if (rows.length) return { rows, trail };
      trail.push(`${label} returned no rows`);
    } catch (e) {
      trail.push(`${label} ${e && e.name === 'AbortError' ? 'timed out' : 'failed'}`);
    }
  }
  return { rows: [], trail };
}

const DISTRICT_POPULATION_FALLBACK_2023 = {
  miri: 255100,
  kuching: 621700,
  sibu: 254000,
  bintulu: 186600,
};

async function fetchPopulation(district) {
  const q = `ifilter=${encodeURIComponent(district)}@district&sort=-date&limit=1000`;
  const { rows, trail } = await fetchDosmRows('population_district', q, [DATA_GOV_MY_ENDPOINT, OPENDOSM_ENDPOINT]);
  const totals = rows.filter((r) => r && String(r.sex).toLowerCase() === 'both' && String(r.age).toLowerCase() === 'overall'
    && String(r.ethnicity).toLowerCase() === 'overall' && r.population != null);
  const row = latestRow(totals);
  const value = row ? (Math.round(Number(row.population) * 1000) || 0) : 0;
  if (value) return { value, note: '' };

  const fallback = DISTRICT_POPULATION_FALLBACK_2023[district.toLowerCase()];
  if (fallback) {
    return { value: fallback, note: 'Population: DOSM\u2019s live API is down for this dataset right now \u2014 showing DOSM\u2019s 2023 district estimate instead (see this Worker\u2019s source comments).' };
  }

  const apiTrail = trail.length ? trail.join('; ') : `${rows.length} rows came back for "${district}" but none was the both/overall/overall total`;
  return { value: 0, note: 'Population: ' + apiTrail };
}

async function fetchIncome(district) {
  const q = `ifilter=${encodeURIComponent(district)}@district&sort=-date&limit=1`;
  const { rows, trail } = await fetchDosmRows('hh_income_district', q, [DATA_GOV_MY_ENDPOINT, OPENDOSM_ENDPOINT]);
  const row = latestRow(rows);
  const value = row ? (Number(row.income_median) || 0) : 0;
  if (value) return { value, note: '' };
  return { value: 0, note: 'Income: ' + (trail.length ? trail.join('; ') : 'the row had no income_median figure') };
}

async function fetchDemographics(district) {
  const key = new Request('https://cache.internal/demographics-v2/' + encodeURIComponent(district.toLowerCase()));
  const stored = await cacheGet(key);
  const out = {
    population: stored && stored.population > 0 ? stored.population : 0,
    medianIncome: stored && stored.medianIncome > 0 ? stored.medianIncome : 0,
    notes: [],
  };
  const jobs = [];
  if (!out.population) {
    jobs.push(fetchPopulation(district).then((r) => { out.population = r.value; if (r.note) out.notes.push(r.note); })
      .catch((e) => out.notes.push('Population: ' + (e && e.message))));
  }
  if (!out.medianIncome) {
    jobs.push(fetchIncome(district).then((r) => { out.medianIncome = r.value; if (r.note) out.notes.push(r.note); })
      .catch((e) => out.notes.push('Income: ' + (e && e.message))));
  }
  await Promise.all(jobs);
  if (out.population > 0 || out.medianIncome > 0) await cachePut(key, { population: out.population, medianIncome: out.medianIncome }, 604800);
  return out;
}

/* ================= narration backends ================= */
async function narrateWithGemini(env, prompt) {
  const resp = await fetchWithTimeout(`${GEMINI_ENDPOINT}${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 220 } }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error('Gemini error ' + resp.status + (detail ? ': ' + detail.slice(0, 300) : ''));
  }
  const data = await resp.json();
  const text = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  return text ? String(text).trim() : '';
}

async function narrateWithWorkersAI(env, system, data) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), EXTERNAL_CALL_TIMEOUT_MS + 5000); });
  try {
    const out = await Promise.race([
      env.AI.run(WORKERS_AI_MODEL, { messages: [{ role: 'system', content: system }, { role: 'user', content: data }], max_tokens: 260, temperature: 0.4 }),
      timeout,
    ]);
    const text = typeof out === 'string' ? out
      : (out && (out.response || (out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content) || (out.result && out.result.response))) || '';
    return String(text).trim();
  } finally {
    clearTimeout(timer);
  }
}

/* ================= POIs (Overpass passthrough, Geoapify backstop) ================= */
async function geoapifyFallback(env, g) {
  if (!env.GEOAPIFY_API_KEY || !g || typeof g.lat !== 'number' || typeof g.lng !== 'number' || !Array.isArray(g.categories)) return { features: null, note: 'no Geoapify backstop configured' };
  const cats = g.categories.filter((c) => typeof c === 'string' && /^[a-z_.]{3,80}$/.test(c)).slice(0, 40);
  const r = Math.min(Math.max(Number(g.radiusM) || 1000, 100), 12000);
  if (!cats.length) return { features: null, note: 'no Geoapify categories mapped' };
  try {
    const resp = await fetchWithTimeout('https://api.geoapify.com/v2/places?categories=' + cats.join(',') + '&filter=circle:' + g.lng + ',' + g.lat + ',' + r + '&limit=500&apiKey=' + env.GEOAPIFY_API_KEY);
    if (!resp.ok) return { features: null, note: 'Geoapify returned ' + resp.status };
    const data = await resp.json();
    return { features: data.features || [], note: '' };
  } catch (e) { return { features: null, note: 'Geoapify: ' + e.message }; }
}
async function handlePois(env, body, origin) {
  const tags = cleanTags(body.osmTags), bbox = cleanBbox(body.bbox);
  if (!tags || !bbox) return json({ error: 'pois needs a valid bbox [s,w,n,e] (max ' + MAX_SPAN_DEG + '° wide) and osmTags [[key,value],…].' }, 400, origin);
  const timeoutS = Math.min(Math.max(Number(body.timeoutS) || 30, 10), 60);
  const q = buildOverpassQuery(bbox, tags, timeoutS);
  const cacheKey = new Request('https://cache.internal/overpass-v2/' + hashString(q));
  try {
    const hit = await caches.default.match(cacheKey);
    if (hit) return new Response(await hit.arrayBuffer(), { headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'X-MR-Source': hit.headers.get('X-MR-Source') || 'Overpass', 'X-MR-Cache': 'hit' } });
  } catch (e) { /* cache optional */ }
  const trail = [];
  for (const endpoint of OVERPASS_MIRRORS) {
    const host = new URL(endpoint).hostname;
    try {
      const resp = await fetchWithTimeout(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain', Accept: 'application/json', 'User-Agent': APP_USER_AGENT }, body: q }, (timeoutS + 8) * 1000);
      if (!resp.ok) { trail.push(host + ' HTTP ' + resp.status); continue; }
      const buf = await resp.arrayBuffer();
      if (buf.byteLength < 20) { trail.push(host + ' empty body'); continue; }
      const bad = remarkProblem(new Uint8Array(buf));
      if (bad) { trail.push(host + ': ' + bad.slice(0, 120)); continue; }
      const source = 'Overpass (' + host + ')';
      try { await caches.default.put(cacheKey, new Response(buf.slice(0), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400', 'X-MR-Source': source } })); } catch (e) { /* optional */ }
      return new Response(buf, { headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'X-MR-Source': source, 'X-MR-Cache': 'miss' } });
    } catch (e) { trail.push(host + ': ' + (e && e.name === 'AbortError' ? 'timed out' : (e && e.message) || 'failed')); }
  }
  const geo = await geoapifyFallback(env, body.geoapify);
  if (geo.features && geo.features.length) return json({ mr_source: 'Geoapify (Overpass fallback)', features: geo.features, trail }, 200, origin);
  return json({ error: 'Every Overpass mirror failed (' + trail.join('; ') + '). ' + (geo.note || 'Geoapify found nothing.') }, 502, origin);
}

/* ================= DOSM retail-trade index, by 3-digit MSIC group ================= */
async function fetchTrendsByGroup(groups) {
  const out = {};
  const want = Array.from(new Set((groups || []).filter((g) => /^\d{3}$/.test(g)))).slice(0, 12);
  const missing = [];
  for (const g of want) {
    const hit = await cacheGet(new Request('https://cache.internal/iowrt/' + g));
    if (hit && Number.isFinite(hit.growthYoy)) out[g] = hit; else missing.push(g);
  }
  if (!missing.length) return out;
  try {
    const resp = await fetchWithTimeout('https://storage.dosm.gov.my/iowrt/iowrt_3d.csv', {}, 15000);
    if (!resp.ok) return out;
    const lines = (await resp.text()).split('\n').filter((l) => l.trim().length);
    if (lines.length < 2) return out;
    const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    const di = header.indexOf('date'), si = header.indexOf('series_type'), gi = header.indexOf('group');
    if (di < 0 || si < 0 || gi < 0) return out;
    const cand = header.map((_, i) => i).filter((i) => i !== di && i !== si && i !== gi);
    const ordered = [...cand.filter((i) => /sales|value/i.test(header[i])), ...cand.filter((i) => !/sales|value|volume|vol_index|quantity/i.test(header[i])), ...cand.filter((i) => /volume|vol_index|quantity/i.test(header[i]))];
    const best = {}, wanted = new Set(missing);
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(','), g = String(c[gi]).trim();
      if (!wanted.has(g) || String(c[si]).trim() !== 'growth_yoy') continue;
      const date = String(c[di]).trim();
      if (best[g] && date <= best[g].date) continue;
      for (const idx of ordered) {
        const cell = c[idx] == null ? '' : String(c[idx]).trim();
        if (cell !== '' && Number.isFinite(Number(cell))) { best[g] = { date, value: Number(cell) }; break; }
      }
    }
    for (const g of missing) {
      if (!best[g]) continue;
      out[g] = { group: g, growthYoy: best[g].value, asOf: best[g].date };
      await cachePut(new Request('https://cache.internal/iowrt/' + g), out[g], 2592000);
    }
  } catch (e) { /* fail honest: untracked groups simply don't appear */ }
  return out;
}

async function handleContext(env, body, origin) {
  const { lat, lng } = body;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return json({ error: 'context needs lat and lng.' }, 400, origin);
  const iso = body.isochrone && ORS_PROFILES.includes(body.isochrone.profile) && Number.isInteger(body.isochrone.seconds) && body.isochrone.seconds >= 60 && body.isochrone.seconds <= 3600 ? body.isochrone : null;
  const district = cleanDistrict(body.district);
  const [isochrone, demographics, trends] = await Promise.all([
    iso ? fetchIsochrone(env, lat, lng, iso.profile, iso.seconds) : Promise.resolve(null),
    district ? fetchDemographics(district) : Promise.resolve({ population: 0, medianIncome: 0, notes: [] }),
    fetchTrendsByGroup(Array.isArray(body.iowrtGroups) ? body.iowrtGroups : []),
  ]);
  return json({ isochrone, demographics, trends, meta: { workerVersion: WORKER_VERSION } }, 200, origin);
}

/* ================= narration ================= */
const NARRATOR_RULES = 'Hard rules: never state revenue or profit, never tell the person to open or not open anything — describe what the data shows. Never invent a number, business or category not given below. Treat crowding thresholds and category relationships as assumptions, and say so once. Mention data confidence once.';
function sharedFacts(s) {
  return 'Candidate spot in ' + (clip(s.town, 40) || 'the area') + ', catchment ' + clip(s.catchment, 40) + ' (~' + (Number(s.areaKm2) || 0).toFixed(1) + ' km²). Data confidence: ' + clip(s.confidence, 12) + ' (' + clip(s.confidenceNote, 220) + '). '
    + 'District population ' + (Number(s.districtPopulation) || 'unknown') + ', median household income RM' + (Number(s.districtIncome) || 'unknown') + '/month.'
    + (s.catchmentIsReal ? '' : ' The catchment is an estimated radius, not a real travel-time shape — mention this reduces precision.');
}
function lines(arr, n) {
  return (Array.isArray(arr) ? arr : []).slice(0, n).map((r, i) => (i + 1) + '. ' + clip(r && r.label, 40) + ' — ' + clip(r && r.archetype, 40) + ', score ' + (Number(r && r.score) || 0) + '/100. ' + (Array.isArray(r && r.evidence) ? r.evidence.slice(0, 3).map((e) => clip(e, 200)).join(' ') : '')).join('\n');
}
function insightPrompt(s) {
  const base = 'You are a neutral market-data narrator for a small-business site-selection tool used in Sarawak, Malaysia. ';
  if (s.kind === 'opportunity') {
    return { system: base + 'The snapshot ranks business types by opportunity for a founder. Write 4-5 short plain-English sentences: which 2-3 types stand out and what KIND of opportunity each is (use the labels given), one caution about data confidence, and one thing to verify on the ground. ' + NARRATOR_RULES, data: sharedFacts(s) + '\nTop-ranked types:\n' + lines(s.top, 5) };
  }
  if (s.kind === 'complement') {
    return { system: base + 'The snapshot ranks business types by how well they would COMPLEMENT what already exists nearby. Write 4-5 short plain-English sentences: which 2-3 types would add the most value, which existing businesses benefit, and one caution about data confidence. ' + NARRATOR_RULES, data: sharedFacts(s) + '\nBest complements:\n' + lines(s.top, 5) + '\nGaps in core needs: ' + (Array.isArray(s.gaps) ? s.gaps.slice(0, 8).map((g) => clip(g, 40)).join(', ') : 'none listed') };
  }
  const bd = Array.isArray(s.breakdown) && s.breakdown.length > 1 ? ' Counts by type: ' + s.breakdown.slice(0, 4).map((b) => clip(b && b.label, 40) + ' ' + (Number(b && b.count) || 0)).join(', ') + '.' : '';
  const obs = Number.isInteger(s.observedBusyness) && s.observedBusyness >= 1 && s.observedBusyness <= 5 ? ' The person\'s own on-site read of competitor busyness is ' + s.observedBusyness + ' on a 1-5 scale.' : '';
  return { system: base + 'Write 3-4 short sentences: what these numbers together suggest, one thing worth checking in person, and how much confidence the data supports. ' + NARRATOR_RULES, data: sharedFacts(s) + ' Types evaluated: "' + clip(s.category, 200) + '", ' + (Number(s.competitorCount) || 0) + ' found.' + bd + ' Market score ' + (Number.isFinite(Number(s.opportunityScore)) ? Number(s.opportunityScore) : 'unknown') + '/100.' + obs };
}
async function handleInsight(env, body) {
  const { system, data } = insightPrompt((body && body.snapshot) || {});
  const problems = [];
  if (env.GEMINI_API_KEY) {
    try { const text = await narrateWithGemini(env, system + '\n\n' + data); if (text) return { text, via: 'Gemini' }; problems.push('Gemini returned no text'); }
    catch (e) { problems.push(e && e.name === 'AbortError' ? 'Gemini timed out' : (e && e.message) || 'Gemini failed'); }
  } else problems.push('GEMINI_API_KEY is not set on this Worker');
  if (env.AI && typeof env.AI.run === 'function') {
    try { const text = await narrateWithWorkersAI(env, system, data); if (text) return { text, via: 'Workers AI' }; problems.push('Workers AI returned no text'); }
    catch (e) { problems.push('Workers AI: ' + ((e && e.message) || 'failed')); }
  } else problems.push('no Workers AI binding named AI is attached to this Worker');
  const blocked = problems.some((p) => /location is not supported/i.test(p));
  return { error: (blocked ? 'Google refused the request because Cloudflare ran this Worker in a region Gemini does not serve; add the free Workers AI binding named AI. ' : '') + 'Details: ' + problems.join(' | ') };
}

/* ================= router ================= */
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'Invalid request body' }, 400, origin); }
    if (!body || typeof body !== 'object') return json({ error: 'Invalid request body' }, 400, origin);
    try {
      if (body.mode === 'insight') { const r = await handleInsight(env, body); return json(r, r.error ? 500 : 200, origin); }
      if (body.mode === 'context') return await handleContext(env, body, origin);
      if (body.mode === 'pois') return await handlePois(env, body, origin);
      return json({ error: 'This Worker (v' + WORKER_VERSION + ') expects mode: context | pois | insight. If you just updated the Worker, hard-refresh the page (Ctrl+F5) so the browser loads the matching market-radar.js.' }, 400, origin);
    } catch (err) { return json({ error: 'Analysis failed: ' + ((err && err.message) || 'unknown error') }, 502, origin); }
  },
};
