/* ============================================================
   Market Radar — proxy + cache (Cloudflare Worker)
   ------------------------------------------------------------
   This file does NOT go in the reysourcez GitHub Pages repo's
   deployed site — it deploys separately, to Cloudflare Workers,
   the same way every other *-proxy-worker.js on this site does.
   Its jobs, all in one place so the browser only ever makes ONE
   call per analysis:

     1. Query OpenStreetMap's free Overpass API for every business
        matching whichever categories the browser asked about,
        within a generous radius of one point. Tries a short list of
        public mirrors in order (see OVERPASS_MIRRORS) rather than
        trusting one \u2014 the original single-endpoint version of this
        file hit a real, widely-reported reliability problem with
        overpass-api.de specifically (intermittent 406s affecting
        unrelated users too, not a bug in this Worker \u2014 see
        github.com/drolbr/Overpass-API/issues/791 and the OSM
        community forum thread on the same error) within days of
        this tool going live for real testing.
     2. Ask OpenRouteService (now under the HeiGIT domain, see
        ORS_ISOCHRONE_ENDPOINT) for a real walk/drive-time isochrone
        shape around that same point \u2014 or return null if that
        fails or ORS_API_KEY isn't set yet, so the browser can fall
        back to drawing a plain circle instead of breaking.
     3. Look up population and household income for one district
        from data.gov.my's open API.
     4. On a separate { mode: 'insight' } request, ask Gemini to
        narrate a snapshot the browser already computed \u2014 Gemini
        never sees raw Overpass/ORS/DOSM data directly and never
        invents a number; it only describes what's already there,
        the same restrained role it plays in crypto-radar-worker.js.

   Every external call above is cached with the Cloudflare Cache API
   (see CACHE NOTES below) \u2014 this matters more here than on this
   site's other proxies, because two of these three sources have
   real shared limits: OpenRouteService's free tier is 500 isochrones
   a day across however many people use this key, and data.gov.my
   allows only 4\u201310 requests a MINUTE without/with an API key.
   Caching isn't an optimization here, it's what keeps the tool
   working at all once more than a couple of people use it the same
   day.

   Contract with the browser (market-radar.js):
     Request  -> { lat, lng, radiusM, categories: { key: { label, tags: [[k,v],...] } },
                   selectedCategory, isochrone: { profile, seconds }, district }
                 or { mode: 'insight', snapshot: {...} }
     Response -> { pois: [{ name, lat, lng, category }], isochrone: GeoJSON|null,
                   demographics: { population, medianIncome } }
                 or { text: "..." } / { error: "..." }

   DEPLOY STEPS (Cloudflare dashboard, no local tooling needed):
     1. dash.cloudflare.com -> Workers & Pages -> Create -> Create Worker.
     2. Name it (e.g. market-radar-proxy) -> Deploy the default
        template first, then Edit code and replace everything with
        this file's contents.
     3. Update ALLOWED_ORIGINS below to your real domain(s).
     4. Settings -> Variables and Secrets -> Add, as Secret (not
        plain text):
          GEMINI_API_KEY  \u2014 same key your other Workers use
          ORS_API_KEY     \u2014 free at account.heigit.org (openrouteservice
                              moved its whole account system there;
                              the key shown as "Basic Key" on that
                              dashboard is what goes here) \u2014 500
                              isochrones total, 20/minute, no card
                              required. openrouteservice.org's OLD
                              signup path still exists but funnels
                              through the same account.heigit.org
                              system now, so either route ends up
                              the same place.
        Both are optional in the sense that the Worker won't crash
        without them \u2014 no ORS key just means every catchment falls
        back to a plain circle; no Gemini key just means the "Get a
        plain-English read" button returns an error while every
        number on the page keeps working fine.
     5. Deploy. Copy the *.workers.dev URL Cloudflare gives you.
     6. Paste that URL into WORKER_ENDPOINT in market-radar.js.

   FIELD-NAME CAVEAT, worth checking once after first deploy: the
   exact column names data.gov.my returns for hh_income_district
   (income_median vs. income_mean vs. something else) are a
   best-effort guess below, not confirmed against a live response \u2014
   see parseIncomeRow(). If district income keeps coming back as
   "Not available" on the page even though population works fine,
   this is the first place to look: fetch
   https://api.data.gov.my/data-catalogue?id=hh_income_district&limit=3
   directly in a browser and match the real field name.

   FIXED, 2026-09-13 (day-one live testing turned this up immediately):
   Overpass calls were failing with a 406 on the very first real
   "Analyze" click. Traced to overpass-api.de itself, not this file \u2014
   see the note in item 1 above. Two changes: (a) fetchOverpassPOIs
   now tries OVERPASS_MIRRORS in order instead of one hardcoded
   endpoint, and sends an explicit Accept: application/json header,
   which several of the same public bug reports suggested helps; (b)
   Overpass failing now returns an honest { pois: [], error: "..." }
   instead of throwing \u2014 previously, if Overpass alone failed, the
   whole Promise.all rejected and isochrone + demographics results
   were thrown away too, even on requests where THEY had already
   succeeded. Also moved ORS_ISOCHRONE_ENDPOINT to the api.heigit.org
   domain per openrouteservice's own migration notice (api.openrouteservice.org
   still works today but has had its quota deliberately reduced since
   28 April 2026 to push this migration, and will presumably be
   switched off eventually) \u2014 the request/response shape and
   Authorization header are unchanged per that same notice, only the
   domain moved.
   ============================================================ */

const ALLOWED_ORIGINS = ['https://reysourcez.com', 'https://www.reysourcez.com'];

// Tried in order; first one that answers wins. All three run the
// identical Overpass QL language, so nothing about how the query is
// BUILT changes based on which one responds \u2014 see the 2026-09-13
// fix note above for why this is a list now instead of one endpoint.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
// Moved from api.openrouteservice.org per openrouteservice's own
// migration notice \u2014 same request shape, same Authorization header,
// just a different domain. If isochrones ever start failing again
// after this, check ask.openrouteservice.org's Announcements category
// first; this is clearly still a service in the middle of a move.
const ORS_ISOCHRONE_ENDPOINT = 'https://api.heigit.org/openrouteservice/v2/isochrones/';
const DATA_GOV_MY_ENDPOINT = 'https://api.data.gov.my/data-catalogue';
const GEMINI_MODEL = 'gemini-flash-lite-latest';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

/* ================= CORS / RESPONSE HELPERS ================= */

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
}
// Small, fast, non-cryptographic hash \u2014 only used to turn a long
// Overpass query string into a short, cache-key-safe string. Doesn't
// need to be collision-proof, just good enough that two DIFFERENT
// queries essentially never land on the same cache entry.
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
}

/* ================= 1. OVERPASS (business POIs) ================= */

function buildOverpassQuery(lat, lng, radiusM, categories) {
  const clauses = [];
  Object.values(categories).forEach((cat) => {
    (cat.tags || []).forEach(([k, v]) => {
      clauses.push(`node["${k}"="${v}"](around:${radiusM},${lat},${lng});way["${k}"="${v}"](around:${radiusM},${lat},${lng});`);
    });
  });
  if (!clauses.length) return null; // e.g. an empty custom-category request
  return `[out:json][timeout:25];(${clauses.join('')});out center tags;`;
}

// First tag pair that matches wins \u2014 a POI carrying tags from two
// of the requested categories (rare, but OSM tagging overlaps
// sometimes) just gets bucketed into whichever category was defined
// first in the request. Good enough for a density/diversity signal;
// not trying to be a perfect one-POI-one-truth classifier.
function categorize(tags, categories) {
  for (const [key, cat] of Object.entries(categories)) {
    for (const [k, v] of cat.tags || []) {
      if (tags[k] === v) return key;
    }
  }
  return null;
}

// Cached for 24 hours per (query text) \u2014 business listings don't
// meaningfully change hour to hour, and this respects Overpass's own
// shared fair-use policy across everyone using this Worker, not just
// whoever's visiting right now.
//
// Returns { pois, error } rather than a bare array, and NEVER throws
// on a data-source failure \u2014 every mirror failing is a real, honest
// possibility (see the 2026-09-13 fix note at the top of this file),
// and the router below still has an isochrone and demographics result
// worth returning even when this one comes back empty. Throwing here
// used to take all three down together over one flaky dependency.
async function fetchOverpassPOIs(lat, lng, radiusM, categories) {
  const query = buildOverpassQuery(lat, lng, radiusM, categories);
  if (!query) return { pois: [], error: null };

  const cache = caches.default;
  const cacheKey = new Request('https://cache.internal/overpass/' + hashString(query));
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  let lastError = 'no mirrors configured';
  for (const endpoint of OVERPASS_MIRRORS) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        // Accept: application/json is deliberate, not decorative \u2014
        // several independent reports of the same 406 this tool hit
        // point at a missing/mismatched Accept header as one likely
        // trigger. Cheap to send, and correct regardless.
        headers: { 'Content-Type': 'text/plain', Accept: 'application/json' },
        body: query,
      });
      if (!resp.ok) { lastError = endpoint + ' returned ' + resp.status; continue; }
      const data = await resp.json();

      const pois = (data.elements || []).map((el) => {
        const lat2 = el.lat != null ? el.lat : (el.center && el.center.lat);
        const lng2 = el.lon != null ? el.lon : (el.center && el.center.lon);
        if (lat2 == null || lng2 == null) return null;
        const category = categorize(el.tags || {}, categories);
        if (!category) return null;
        const name = (el.tags && (el.tags.name || el.tags['name:en'])) || 'Unnamed';
        return { name, lat: lat2, lng: lng2, category };
      }).filter(Boolean);

      const result = { pois, error: null };
      const response = new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } });
      await cache.put(cacheKey, response.clone());
      return result;
    } catch (e) {
      lastError = endpoint + ': ' + e.message;
    }
  }
  // Every mirror failed. Not cached \u2014 a genuine outage shouldn't be
  // remembered for 24 hours; the next Analyze click should try again
  // for real rather than replaying this same failure from cache.
  return { pois: [], error: 'Every Overpass mirror failed (' + lastError + '). Competitor data is unavailable right now \u2014 the catchment shape and district numbers below are unaffected.' };
}

/* ================= 2. OPENROUTESERVICE (real catchment shape) ================= */

// Returns null on ANY failure \u2014 missing key, rate limit, network
// error \u2014 by design. market-radar.js already knows how to draw a
// plain circle instead when this comes back null, so a Worker-side
// throw here would take down the whole analysis over what should be
// a graceful, minor degradation.
async function fetchIsochrone(env, lat, lng, profile, seconds) {
  if (!env.ORS_API_KEY || !profile || !seconds) return null;

  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/isochrone/${profile}/${seconds}/${lat.toFixed(3)}/${lng.toFixed(3)}`);
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  try {
    const resp = await fetch(ORS_ISOCHRONE_ENDPOINT + profile, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: env.ORS_API_KEY },
      body: JSON.stringify({ locations: [[lng, lat]], range: [seconds], range_type: 'time' }), // ORS wants [lng, lat] \u2014 the one place in this file that ISN'T [lat, lng]
    });
    if (!resp.ok) return null;
    const geojson = await resp.json();
    // Cached for 30 days \u2014 a town's road network and typical travel
    // speeds don't meaningfully change month to month, and this
    // conserves the shared 500/day free allowance.
    const response = new Response(JSON.stringify(geojson), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=2592000' } });
    await cache.put(cacheKey, response.clone());
    return geojson;
  } catch (e) {
    return null;
  }
}

/* ================= 3. DATA.GOV.MY (district population & income) ================= */

function matchesDistrict(row, district) {
  const name = (row.district || row.daerah || '').toString().trim().toLowerCase();
  return name === district.trim().toLowerCase();
}
function latestRow(rows) {
  if (!rows.length) return null;
  return rows.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0];
}
// See this file's own header caveat \u2014 the exact field name DOSM
// uses for median household income isn't confirmed, so this tries
// the likeliest candidates in order rather than assuming one.
function parseIncomeRow(row) {
  if (!row) return 0;
  const value = row.income_median ?? row.median ?? row.income_mean ?? row.mean;
  return Number(value) || 0;
}

// Fetches a bulk page of each dataset and filters for the matching
// district IN THIS WORKER, rather than relying on the API's own
// filter= query parameter \u2014 that parameter's exact syntax isn't
// confirmed from documentation available at the time this was
// written, so filtering the response directly is slower per call but
// correct regardless of that syntax. Cached for 7 days per district:
// this is annual survey data, and the live endpoint allows only
// 4\u201310 requests a MINUTE total, shared across every visitor.
async function fetchDemographics(district) {
  const cache = caches.default;
  const cacheKey = new Request('https://cache.internal/demographics/' + encodeURIComponent(district));
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  const result = { population: 0, medianIncome: 0 };

  try {
    const resp = await fetch(`${DATA_GOV_MY_ENDPOINT}?id=population_district&limit=3000`);
    if (resp.ok) {
      const body = await resp.json();
      const rows = (Array.isArray(body) ? body : body.data || []).filter((r) => matchesDistrict(r, district));
      const latest = latestRow(rows);
      if (latest) result.population = Number(latest.population) || 0;
    }
  } catch (e) { /* leave population at 0 \u2014 the page shows "Not available" rather than a stale guess */ }

  try {
    const resp = await fetch(`${DATA_GOV_MY_ENDPOINT}?id=hh_income_district&limit=3000`);
    if (resp.ok) {
      const body = await resp.json();
      const rows = (Array.isArray(body) ? body : body.data || []).filter((r) => matchesDistrict(r, district));
      result.medianIncome = parseIncomeRow(latestRow(rows));
    }
  } catch (e) { /* leave medianIncome at 0 */ }

  const response = new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=604800' } });
  await cache.put(cacheKey, response.clone());
  return result;
}

/* ================= 4. GEMINI (narration only) ================= */
// Same calling convention as crypto-radar-worker.js's own handleInsight
// \u2014 plain generateContent, not the structured response_format/schema
// shape food-worth-proxy-worker.js uses, since this is free-text
// narration of numbers already computed, not data extraction.

async function handleInsight(env, body) {
  if (!env.GEMINI_API_KEY) return { error: 'Worker is missing GEMINI_API_KEY \u2014 add it in this Worker\u2019s Settings.' };
  const s = (body && body.snapshot) || {};

  const prompt = `You are a neutral market-data narrator for a small-business site-selection tool used in Sarawak, Malaysia.
Snapshot for a candidate spot in ${s.town || 'the area'}: category "${s.category}", ${s.competitorCount} competitors found inside the catchment, category mix ${Math.round((s.diversityIndex || 0) * 100)}% diverse (100% = evenly mixed, 0% = one category dominates), district population ${s.districtPopulation || 'unknown'}, district median household income RM${s.districtIncome || 'unknown'}/month, opportunity score ${s.opportunityScore ?? 'unknown'}/100.${s.catchmentIsReal ? '' : ' Note: the catchment shape used here is an estimated radius, not a real travel-time isochrone \u2014 mention this reduces precision.'}
Write 3-4 short sentences in plain English: what these numbers together suggest, one thing worth checking in person before relying on this, and how much confidence the data sources above actually support. Hard rules: never state a specific revenue or profit figure, never tell them to open or not open here \u2014 this describes the data, it does not recommend a decision. Never invent a number not given above.`;

  let resp;
  try {
    resp = await fetch(`${GEMINI_ENDPOINT}${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 220 } }),
    });
  } catch (e) {
    return { error: 'Could not reach Gemini. Try again.' };
  }
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    return { error: 'Gemini error ' + resp.status + (detail ? ': ' + detail.slice(0, 300) : '') };
  }
  const data = await resp.json();
  const text = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  return { text: text || 'Gemini did not return a usable summary this time \u2014 the numbers already on the page are unaffected.' };
}

/* ================= ROUTER ================= */

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin);

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: 'Invalid request body' }, 400, origin); }

    if (body.mode === 'insight') {
      const result = await handleInsight(env, body);
      return json(result, result.error ? 500 : 200, origin);
    }

    const { lat, lng, categories, district } = body;
    const radiusM = Number(body.radiusM) || 1000;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !categories || typeof categories !== 'object') {
      return json({ error: 'Request needs at least lat, lng, and categories.' }, 400, origin);
    }

    try {
      const [overpassResult, isochrone, demographics] = await Promise.all([
        fetchOverpassPOIs(lat, lng, radiusM, categories),
        body.isochrone ? fetchIsochrone(env, lat, lng, body.isochrone.profile, body.isochrone.seconds) : Promise.resolve(null),
        district ? fetchDemographics(district) : Promise.resolve({ population: 0, medianIncome: 0 }),
      ]);
      // 200, not an error status, even when overpassResult.error is
      // set \u2014 this IS a successful response, it just carries a
      // partial-data flag inside it. market-radar.js checks
      // data.poisError itself and shows the catchment/demographics
      // results it DID get rather than a blank failure screen.
      return json({ pois: overpassResult.pois, poisError: overpassResult.error, isochrone, demographics }, 200, origin);
    } catch (err) {
      return json({ error: 'Analysis failed: ' + (err.message || 'unknown error') }, 502, origin);
    }
  },
};
