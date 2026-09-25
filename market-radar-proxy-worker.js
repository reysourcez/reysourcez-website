// Market Radar proxy Worker — v1.6.0 (2026-09-24). What changed: this file — added gapInsightPrompt() and a snapshot.kind==='gap' branch in handleInsight(), for the new Market Gap checklist mode's plain-English read. No change to the main analysis request/response contract — the pharmacy/petrol categories and the checklist itself are entirely client-driven (market-radar.js), reusing the existing categories/anchors machinery unchanged. How it fits together: MARKET_RADAR_HANDOFF.md.
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
        trusting one — the original single-endpoint version of this
        file hit a real, widely-reported reliability problem with
        overpass-api.de specifically (intermittent 406s affecting
        unrelated users too, not a bug in this Worker — see
        github.com/drolbr/Overpass-API/issues/791 and the OSM
        community forum thread on the same error) within days of
        this tool going live for real testing. If every mirror fails
        (a real, separate problem — see the 2026-09-16 note below),
        falls back to Geoapify's Places API, a key-authenticated
        (not IP-rate-limited) commercial POI source.
     2. Ask OpenRouteService (now under the HeiGIT domain, see
        ORS_ISOCHRONE_ENDPOINT) for a real walk/drive-time isochrone
        shape around that same point — or return null if that
        fails or ORS_API_KEY isn't set yet, so the browser can fall
        back to drawing a plain circle instead of breaking.
     3. Look up population and household income for one district
        from data.gov.my's open API.
     4. On a separate { mode: 'insight' } request, ask Gemini to
        narrate a snapshot the browser already computed — Gemini
        never sees raw Overpass/ORS/DOSM data directly and never
        invents a number; it only describes what's already there,
        the same restrained role it plays in crypto-radar-worker.js.

   Every external call above is cached with the Cloudflare Cache API
   (see CACHE NOTES below) — this matters more here than on this
   site's other proxies, because these sources have real shared
   limits: OpenRouteService's free tier is 500 isochrones a day
   across however many people use this key, data.gov.my allows only
   4 requests a MINUTE per API without a token (Data Catalogue and
   OpenDOSM are counted separately — developer.data.gov.my/rate-limit,
   checked 2026-09-20), and Geoapify's
   free tier is 3,000 credits/day. Caching isn't an optimization
   here, it's what keeps the tool working at all once more than a
   couple of people use it the same day.

   Contract with the browser (market-radar.js) — v1.5.1 (contract unchanged from v1.5.0 — this
   round's fix is entirely internal to how population is sourced; the response shape is identical):
     Request  -> { lat, lng, radiusM, categories: { key: { label, tags: [[k,v],...] } },
                   selectedCategories: [key,...], anchors: {...},
                   isochrone: { profile, seconds }, district }
                 or { mode: 'insight', snapshot: {...} }
     Response -> { pois: [{ name, lat, lng, category, rating?, reviewCount? }], poisError,
                   anchors: [...], isochrone: GeoJSON|null,
                   demographics: { population, medianIncome, notes: [] },
                   wholesaleRetailTrends: { categoryKey: { growthYoy, asOf, ... } },
                   meta: { workerVersion, poiSource } }
                 or { text, via: 'Gemini'|'Workers AI' } / { error: "..." }

   DEPLOY STEPS (Cloudflare dashboard, no local tooling needed):
     1. dash.cloudflare.com -> Workers & Pages -> Create -> Create Worker.
     2. Name it (e.g. market-radar-proxy) -> Deploy the default
        template first, then Edit code and replace everything with
        this file's contents.
     3. Update ALLOWED_ORIGINS below to your real domain(s).
     4. Settings -> Variables and Secrets -> Add, as Secret (not
        plain text):
          GEMINI_API_KEY    — same key your other Workers use
          ORS_API_KEY       — free at account.heigit.org (openrouteservice
                              moved its whole account system there;
                              the key shown as "Basic Key" on that
                              dashboard is what goes here) — 500
                              isochrones total, 20/minute, no card
                              required. openrouteservice.org's OLD
                              signup path still exists but funnels
                              through the same account.heigit.org
                              system now, so either route ends up
                              the same place.
          GEOAPIFY_API_KEY  — free at myprojects.geoapify.com, no
                              card, 3,000 credits/day. Only ever
                              called when every OVERPASS_MIRRORS
                              entry has already failed — see the
                              2026-09-16 note below for why this
                              turned out to matter in practice, not
                              just in theory.
          GOOGLE_PLACES_API_KEY — optional, and genuinely different
                              from the three above: this ISN'T free.
                              Needs a Google Cloud project with
                              billing enabled and a key restricted to
                              "Places API (New)". Confirmed against
                              Google's own current pricing
                              (2026-09-16): 1,000 Nearby Search
                              "Enterprise"-tier calls/month free (the
                              tier that includes rating +
                              userRatingCount — Google's old $200/mo
                              platform-wide credit ended 28 Feb 2025
                              and was never replaced), then $35 per
                              1,000 calls. One call covers a whole
                              analysis (see fetchGooglePopularity
                              below), so that's 1,000 free ANALYSES a
                              month, not 1,000 lookups. Leave unset
                              and every feature on this page keeps
                              working exactly as before — this only
                              adds an optional "how strong are these
                              competitors, really" signal on top.
          AI (a BINDING, not a secret) — optional, free backstop for the
                              plain-English read. Gemini refuses requests when
                              Cloudflare happens to run this Worker in a region
                              Google blocks (Hong Kong is the one reported on
                              Cloudflare's community forum —
                              "User location is not supported for the API
                              use"), and that changes from request to request.
                              With this binding the Worker falls back to
                              Cloudflare's own Workers AI instead. Add it under
                              Worker > Settings > Bindings > Add > Workers AI,
                              variable name exactly AI. Free: 10,000 neurons a
                              day, about 10 per read.
        The first three are optional in the sense that the Worker
        won't crash without them — no ORS key just means every
        catchment falls back to a plain circle; no Gemini key just
        means the "Get a plain-English read" button returns an error
        while every number on the page keeps working fine; no
        Geoapify key just means a total Overpass outage shows as an
        honest "competitor data unavailable" instead of quietly
        recovering. GOOGLE_PLACES_API_KEY is optional in a stronger
        sense: it's the one integration on this page that costs real
        money past a real limit, so it's designed to be something you
        deliberately turn on, not something you'd add "just in case."
     5. Deploy. Copy the *.workers.dev URL Cloudflare gives you.
     6. Paste that URL into WORKER_ENDPOINT in market-radar.js.

   FIXED, 2026-09-16 (this round — see MARKET_RADAR_SETUP_AND_GLOSSARY.md
   for the fuller writeup):
   Re-reading this exact file turned up that three fixes described
   elsewhere as already shipped had NOT actually made it into this
   file's own code — flagging that plainly here so a future session
   trusts what this file actually does over what any doc claims it
   does. All three are genuinely implemented as of this version:

   (a) Bubble tea / "drinks" category was invisible. Root cause: OSM's
       own documented convention tags a bubble tea stall as
       amenity=cafe (or amenity=fast_food) PLUS cuisine=bubble_tea —
       there's no dedicated shop=bubble_tea tag; one was proposed and
       the OSM community rejected it for exactly this reason (see
       wiki.openstreetmap.org/wiki/Tag:cuisine=bubble_tea). categorize()
       below only ever checked primary amenity / shop tags, and
       checked categories in the order CATEGORY_TAGS lists them —
       "cafe" comes before "drinks", so any bubble tea stall tagged
       amenity=cafe (the common case) matched "cafe" first and never
       got a chance to be recognised as "drinks" at all. Fixed by
       giving cuisine=* tag pairs priority over every other tag,
       regardless of category order — see categorize() below. The
       matching fix on the tag-definition side (adding
       ['cuisine','bubble_tea'] to "drinks") lives in market-radar.js's
       CATEGORY_TAGS, plus a name-based fallback (NAME_HINTS) there
       too, for the real-world cases where a stall is tagged
       amenity=cafe with no cuisine sub-tag at all.
   (b) Geoapify backstop — MARKET_RADAR_SETUP_AND_GLOSSARY.md described
       this as built; it wasn't in this file. Implemented for real
       below (GEOAPIFY_CATEGORY_MAP, fetchGeoapifyPOIs,
       categorizeGeoapify), only ever called after every
       OVERPASS_MIRRORS entry has failed.
   (c) EXTERNAL_CALL_TIMEOUT_MS / a timeout wrapper — same situation,
       described as built, wasn't. Every external fetch in this file
       (Overpass, Geoapify, ORS, data.gov.my, Gemini) now goes through
       fetchWithTimeout() below instead of a bare, unbounded fetch().
   (d) [CORRECTED 2026-09-20 — the paragraph that stood here claimed a
       "confirmed working query shape". It was NOT working.] Real root
       cause, found 2026-09-20: population_district is served by the
       OpenDOSM API (api.data.gov.my/opendosm). The Data Catalogue
       endpoint this file used answers [] for it — even for the dataset
       page's own unfiltered sample query — so no filter change could
       ever have helped. Fixed in v1.5.0, see fetchPopulation(). Facts
       that still hold: one row per district x sex x age band x
       ethnicity; the district total is the both/overall/overall row;
       the figure is published in THOUSANDS.
       [CORRECTED AGAIN, 2026-09-22 — the v1.5.0 "fix" above was itself
       an unverified guess, and it doesn't work either: opendosm returns
       a flat HTTP 400 ("invalid column value, valid columns: []") for
       population_district on EVERY request, filtered or not — live-
       tested both ways this round. data-catalogue still answers []
       for it too, even though that's what this dataset's own page
       documents as correct. Both endpoints are still tried below (now
       in that documented order) so this self-heals for free if DOSM
       ever fixes either backend. Since this tool only ever needs
       population for the four fixed districts in TOWNS
       (market-radar.js), and the figure moves by low single digits
       per cent a year, the real fix is a small pinned fallback table —
       see DISTRICT_POPULATION_FALLBACK_2023 near fetchPopulation()
       below — sourced directly from DOSM this round, rather than
       parsing DOSM's ~300k-row population_district.csv at runtime,
       which risked exceeding Cloudflare Workers' 10ms-per-request CPU
       limit on the free plan (developers.cloudflare.com/workers/platform/limits,
       checked 2026-09-22) for a number that only needs updating about
       once a year.]

   FEATURE, 2026-09-16 (not a fix — new): competitor strength via
   Google Places. Answers the "does a quiet cafe and a packed,
   beloved cafe really deserve the same competitor count" question —
   see computeCompetitorStrengthFactor() in market-radar.js for the
   scoring side. This file's half: fetchGooglePopularity() makes ONE
   Nearby Search (New) call per analysis (only when
   GOOGLE_PLACES_API_KEY is set), and attachGooglePopularity() matches
   each result to an already-found, already-classified Overpass/
   Geoapify competitor by proximity (within 75m) so the rating/review
   count rides along on the SAME pois array this file already
   returned — no new field in the response contract, no change for
   anyone who doesn't set the key. Ratings are never used to decide
   WHAT a place is, only how strong a competitor it is once Overpass/
   Geoapify + this file's own categorize() has already decided that.

   CORRECTED, 2026-09-17: two small but real fixes, one of them
   prompted by comparing this file against an older draft that turned
   out to be broken (worth recording exactly what was wrong with it,
   since that draft otherwise looks plausible on a skim):
   (a) Overpass calls had NO User-Agent header at all — added
       APP_USER_AGENT below. A missing/generic User-Agent is exactly
       what abuse detection on a shared free resource is suspicious
       of, so this is a plausible contributor to Overpass failing more
       than it should, on top of the shared-IP problem Geoapify below
       exists for.
   (b) fetchPopulation()/fetchIncome() now use sort=-date&limit=1
       instead of limit=5 + client-side sort — confirmed
       sort=<column>/-<column> is a real, documented parameter at
       developer.data.gov.my/request-query (missed on the first pass
       through those docs). One fewer thing downloaded, same result.
       [Still true for income. SUPERSEDED for population in v1.5.0:
       it now fetches the district's rows and picks the total row
       itself — see fetchPopulation().]
   Neither of these is what was actually broken in the older draft,
   for the record: that draft's fetchGeoapifyPOIs() pointed
   GEOAPIFY_ENDPOINT at Geoapify's GEOCODING endpoint
   (/v1/geocode/search) with a hardcoded London address and a
   demo/placeholder API key copy-pasted straight from Geoapify's own
   docs example, THEN appended a SECOND "?" onto that already-complete
   URL to add categories/filter/limit/the real key — a URL can only
   have one "?"; everything after the first is query-string content,
   so that second "?" and everything after it, including the real
   apiKey value, just became part of the (already wrong) demo key's
   literal value. That request could only ever fail. The version in
   this file has always used the correct endpoint
   (api.geoapify.com/v2/places) with the actual lat/lng/radius
   interpolated in — confirmed against
   apidocs.geoapify.com/docs/places on 2026-09-16 — so it isn't
   affected by that specific bug. If Geoapify still doesn't seem to be
   catching Overpass failures after deploying THIS file, the fastest
   way to find out why is the poisError message market-radar.js
   already surfaces on-page after a failed analysis — it names the
   exact HTTP status or error each mirror returned, and says plainly
   whether GEOAPIFY_API_KEY is even configured.

   FIXED, 2026-09-13 (day-one live testing turned this up immediately):
   Overpass calls were failing with a 406 on the very first real
   "Analyze" click. Traced to overpass-api.de itself, not this file —
   see the note in item 1 above. Two changes: (a) fetchOverpassPOIs
   now tries OVERPASS_MIRRORS in order instead of one hardcoded
   endpoint, and sends an explicit Accept: application/json header,
   which several of the same public bug reports suggested helps; (b)
   Overpass failing now returns an honest { pois: [], error: "..." }
   instead of throwing — previously, if Overpass alone failed, the
   whole Promise.all rejected and isochrone + demographics results
   were thrown away too, even on requests where THEY had already
   succeeded. Also moved ORS_ISOCHRONE_ENDPOINT to the api.heigit.org
   domain per openrouteservice's own migration notice (api.openrouteservice.org
   still works today but has had its quota deliberately reduced since
   28 April 2026 to push this migration, and will presumably be
   switched off eventually) — the request/response shape and
   Authorization header are unchanged per that same notice, only the
   domain moved.
   ============================================================ */

const ALLOWED_ORIGINS = ['https://reysourcez.com', 'https://www.reysourcez.com'];

// Tried in order; first one that answers wins. All three run the
// identical Overpass QL language, so nothing about how the query is
// BUILT changes based on which one responds — see the 2026-09-13
// fix note above for why this is a list now instead of one endpoint.
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
// CORRECTED, 2026-09-17: this file was sending Overpass requests with
// no identifying User-Agent at all — a real omission, not a style
// choice. A generic/missing User-Agent is exactly what abuse
// detection on a shared free resource is designed to be suspicious
// of, and is a plausible SEPARATE contributor to Overpass failing
// more often than it should from this Worker specifically, on top of
// the shared-IP rate-limiting problem the Geoapify backstop below
// exists for. Update the URL in this string if this page ever moves.
const APP_USER_AGENT = 'ReysourcezMarketRadar/1.0 (+https://reysourcez.com/market-radar.html)';
// Moved from api.openrouteservice.org per openrouteservice's own
// migration notice — same request shape, same Authorization header,
// just a different domain. If isochrones ever start failing again
// after this, check ask.openrouteservice.org's Announcements category
// first; this is clearly still a service in the middle of a move.
const ORS_ISOCHRONE_ENDPOINT = 'https://api.heigit.org/openrouteservice/v2/isochrones/';
const DATA_GOV_MY_ENDPOINT = 'https://api.data.gov.my/data-catalogue';
const OPENDOSM_ENDPOINT = 'https://api.data.gov.my/opendosm';
// Which portal serves which dataset — CORRECTED 2026-09-22: population_district works on NEITHER
// endpoint right now (opendosm 400s on every request; data-catalogue answers [] even for its own
// documented sample query) — confirmed live, not assumed; the v1.5.0 note this replaces guessed
// opendosm was the fix, and it wasn't. Both are still tried, in the order DOSM's own page documents,
// so this self-heals for free if DOSM fixes either backend; see DISTRICT_POPULATION_FALLBACK_2023
// near fetchPopulation() for what actually supplies the number today.
//   population_district -> tries DATA_GOV_MY_ENDPOINT then OPENDOSM_ENDPOINT (both currently broken;
//                           falls back to a small pinned table for the 4 districts this tool uses)
//   hh_income_district  -> DATA_GOV_MY_ENDPOINT (working)
const WORKER_VERSION = '1.6.0'; // shown on the page next to the OSM source — bump on every deploy
// Free-tier backstop for the plain-English read. Cloudflare retires models now and then; if this one
// stops answering, pick a current text model from developers.cloudflare.com/workers-ai/platform/pricing
const WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8-fast';
const GEMINI_MODEL = 'gemini-flash-lite-latest';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

// How long any single external call (one Overpass mirror, Geoapify,
// ORS, data.gov.my, Gemini) is allowed to hang before this Worker
// gives up on it and moves on — see market-radar.js's own
// 2026-09-16 comment in analyzeSpot for the user-facing side of
// this. Without this, one slow/hung free-tier service could make
// "Analyze" spin forever with no way to tell a slow success apart
// from a stuck request.
const EXTERNAL_CALL_TIMEOUT_MS = 10000;

// Maps this tool's own category keys (CATEGORY_TAGS in market-radar.js)
// to Geoapify's own category taxonomy (apidocs.geoapify.com/docs/places,
// confirmed 2026-09-16) — only consulted when every Overpass mirror
// has failed. Geoapify's data is itself OSM-sourced, so this is a
// second attempt at the same underlying data through a different,
// key-authenticated door, not a genuinely independent source.
// Deliberately has its OWN dedicated bubble-tea category
// (catering.cafe.bubble_tea) — unlike raw OSM/Overpass, Geoapify
// doesn't need the cuisine-tag workaround this file uses elsewhere.
// "printing" has no real Geoapify equivalent as of this writing, so
// that one category simply gets no backstop coverage — flagged
// rather than forcing a bad fit.
const GEOAPIFY_CATEGORY_MAP = {
  cafe: ['catering.cafe'],
  restaurant: ['catering.restaurant'],
  fastfood: ['catering.fast_food'],
  bakery: ['commercial.food_and_drink.bakery', 'commercial.food_and_drink.confectionery'],
  drinks: ['catering.cafe.bubble_tea', 'catering.cafe.tea', 'commercial.food_and_drink.coffee_and_tea', 'commercial.food_and_drink.drinks'],
  minimart: ['commercial.convenience', 'commercial.supermarket'],
  fashion: ['commercial.clothing'],
  hardware: ['commercial.houseware_and_hardware.hardware_and_tools', 'commercial.houseware_and_hardware.doityourself'],
  laundry: ['service.cleaning.laundry'],
  salon: ['service.beauty.hairdresser', 'service.beauty'],
  printing: [],
};

// Maps the same category keys to Google's Table A place types
// (developers.google.com/maps/documentation/places/web-service/place-types,
// confirmed current 2026-09-16) — used only by the optional
// fetchGooglePopularity() below. Google's own taxonomy has NO
// dedicated bubble-tea type (confirmed against the current full
// Table A list) — that's fine here, since this map is only ever used
// to fetch a RATING for a place already found and already correctly
// classified elsewhere in this file; it never decides what a place
// is. "printing" has no Google equivalent either, same gap as
// GEOAPIFY_CATEGORY_MAP above.
const GOOGLE_PLACE_TYPES = {
  cafe: ['cafe'],
  restaurant: ['restaurant'],
  fastfood: ['fast_food_restaurant'],
  bakery: ['bakery', 'pastry_shop', 'dessert_shop', 'confectionery'],
  drinks: ['cafe', 'tea_house', 'juice_shop'],
  minimart: ['convenience_store'],
  fashion: ['clothing_store', 'shoe_store'],
  hardware: ['hardware_store', 'home_improvement_store'],
  laundry: ['laundry'],
  salon: ['hair_salon', 'beauty_salon', 'barber_shop'],
  printing: [],
};

/* ================= CORS / RESPONSE HELPERS ================= */

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return { 'Access-Control-Allow-Origin': allow, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status: status || 200, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } });
}
// Small, fast, non-cryptographic hash — only used to turn a long
// Overpass query string (or Geoapify category list) into a short,
// cache-key-safe string. Doesn't need to be collision-proof, just
// good enough that two DIFFERENT queries essentially never land on
// the same cache entry.
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(36);
}
// FIXED, 2026-09-16: every external fetch() in this file now goes
// through this wrapper instead of being called bare — see
// EXTERNAL_CALL_TIMEOUT_MS above for why.
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || EXTERNAL_CALL_TIMEOUT_MS);
  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ================= INPUT GUARDS + CACHE HELPERS (v1.5.0) ================= */
// This endpoint is public — CORS only stops other WEBSITES, not curl — so every client-supplied value
// that ends up inside an Overpass query, a URL or a prompt is checked here before use.
const TAG_TOKEN = /^[A-Za-z0-9_:\-]{1,40}$/;   // an OSM key or value: letters, digits, _ : -
const MAX_CATEGORY_TAG_PAIRS = 40;
const MAX_ANCHOR_TAG_PAIRS = 30;
const MAX_RADIUS_M = 12000;
const ORS_PROFILES = ['foot-walking', 'driving-car'];

function clip(v, n) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').slice(0, n); }
function cleanDistrict(v) { return typeof v === 'string' ? v.replace(/[^A-Za-z .'\-]/g, '').trim().slice(0, 60) : ''; }

function cleanTagSet(set, maxPairs) {
  const out = {};
  let pairs = 0;
  if (!set || typeof set !== 'object') return out;
  for (const [key, cat] of Object.entries(set)) {
    if (!/^[A-Za-z0-9_\-]{1,30}$/.test(key) || key === '__proto__' || !cat || typeof cat !== 'object') continue;
    const tags = [];
    for (const pair of (Array.isArray(cat.tags) ? cat.tags : [])) {
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const [k, v] = pair;
      if (typeof k !== 'string' || typeof v !== 'string' || !TAG_TOKEN.test(k) || !TAG_TOKEN.test(v)) continue;
      if (++pairs > maxPairs) break;
      tags.push([k, v]);
    }
    out[key] = { label: clip(cat.label || key, 80), tags };
  }
  return out;
}

// Cache helpers that can never throw — a misbehaving Cache API must not take the analysis down.
async function cacheGet(key) {
  try { const hit = await caches.default.match(key); return hit ? await hit.json() : null; } catch (e) { return null; }
}
async function cachePut(key, obj, maxAgeSeconds) {
  try {
    await caches.default.put(key, new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + maxAgeSeconds } }));
  } catch (e) { /* caching is an optimisation, never a requirement */ }
}

/* ================= 1. OVERPASS (business POIs), Geoapify backstop ================= */

// FEATURE, 2026-09-18: anchors is optional and additive — its tags get
// folded into the SAME combined query as categories (one Overpass call
// still covers everything, same batching principle as before), but
// anchors are never business categories and never touch categorize()
// below; see categorizeAnchor() further down for how they're told apart
// on the way back out.
function buildOverpassQuery(lat, lng, radiusM, categories, anchors) {
  const clauses = [];
  const tagSets = anchors ? [categories, anchors] : [categories];
  tagSets.forEach((tagSet) => {
    Object.values(tagSet).forEach((cat) => {
      (cat.tags || []).forEach(([k, v]) => {
        clauses.push(`node["${k}"="${v}"](around:${radiusM},${lat},${lng});way["${k}"="${v}"](around:${radiusM},${lat},${lng});`);
      });
    });
  });
  if (!clauses.length) return null; // e.g. an empty custom-category request
  return `[out:json][timeout:25];(${clauses.join('')});out center tags;`;
}

// FIXED, 2026-09-16: cuisine=* tag pairs are now checked FIRST, across
// every requested category, before any amenity=*/shop=* tag pair —
// regardless of which category happens to be listed first in
// CATEGORY_TAGS. Reason: a bubble tea stall is tagged amenity=cafe +
// cuisine=bubble_tea (OSM's own documented convention — see the
// 2026-09-16 header note above). Checking amenity first meant "cafe"
// (listed before "drinks" in CATEGORY_TAGS) always won before "drinks"
// ever got a chance to look at the cuisine tag, so a bubble tea shop
// searched for under "Drink stall / bubble tea" silently vanished into
// "Cafe / kopitiam" instead. This generalises: any FUTURE category
// that disambiguates itself with a cuisine=* tag (e.g. a hypothetical
// "Ice cream" category using cuisine=ice_cream) gets the same
// specific-beats-generic priority automatically, with no need to
// reorder CATEGORY_TAGS to make it work.
//
// Within each pass, first tag pair that matches still wins — a POI
// carrying tags from two of the requested categories (rare, but OSM
// tagging overlaps sometimes) gets bucketed into whichever category
// was defined first. Good enough for a density/diversity signal; not
// trying to be a perfect one-POI-one-truth classifier.
function categorize(tags, categories) {
  for (const [key, cat] of Object.entries(categories)) {
    for (const [k, v] of cat.tags || []) {
      if (k === 'cuisine' && tags[k] === v) return key;
    }
  }
  for (const [key, cat] of Object.entries(categories)) {
    for (const [k, v] of cat.tags || []) {
      if (k !== 'cuisine' && tags[k] === v) return key;
    }
  }
  return null;
}

// Plain first-match, no cuisine-priority pass needed — schools,
// hospitals, malls etc. don't share a primary tag the way "cafe" and
// "bubble tea" do, so there's no analogous ambiguity to resolve here.
function categorizeAnchor(tags, anchors) {
  for (const [key, a] of Object.entries(anchors || {})) {
    for (const [k, v] of a.tags || []) {
      if (tags[k] === v) return key;
    }
  }
  return null;
}

// Cached for 24 hours per (query text) — business listings don't
// meaningfully change hour to hour, and this respects Overpass's own
// shared fair-use policy across everyone using this Worker, not just
// whoever's visiting right now.
//
// Returns { pois, error } rather than a bare array, and NEVER throws
// on a data-source failure — every mirror AND Geoapify failing is a
// real, honest possibility, and the router below still has an
// isochrone and demographics result worth returning even when this
// one comes back empty. Throwing here used to take all three down
// together over one flaky dependency.
async function fetchOverpassPOIs(env, lat, lng, radiusM, categories, anchors) {
  const query = buildOverpassQuery(lat, lng, radiusM, categories, anchors);
  if (!query) return { pois: [], anchors: [], error: null };

  const cache = caches.default;
  const cacheKey = new Request('https://cache.internal/overpass/' + hashString(query));
  const cached = await cache.match(cacheKey);
  if (cached) { const c = await cached.json(); return { ...c, fromCache: true }; }

  let lastError = 'no mirrors configured';
  for (const endpoint of OVERPASS_MIRRORS) {
    try {
      const resp = await fetchWithTimeout(endpoint, {
        method: 'POST',
        // Accept: application/json is deliberate, not decorative —
        // several independent reports of the same 406 this tool hit
        // point at a missing/mismatched Accept header as one likely
        // trigger. User-Agent is likewise deliberate, not decorative
        // (see APP_USER_AGENT above) — cheap to send, correct either way.
        headers: { 'Content-Type': 'text/plain', Accept: 'application/json', 'User-Agent': APP_USER_AGENT },
        body: query,
      });
      if (!resp.ok) { lastError = endpoint + ' returned ' + resp.status; continue; }
      const data = await resp.json();

      const pois = [];
      const anchorPois = [];
      (data.elements || []).forEach((el) => {
        const lat2 = el.lat != null ? el.lat : (el.center && el.center.lat);
        const lng2 = el.lon != null ? el.lon : (el.center && el.center.lon);
        if (lat2 == null || lng2 == null) return;
        const tags = el.tags || {};
        const name = (tags.name || tags['name:en']) || 'Unnamed';
        const category = categorize(tags, categories);
        if (category) { pois.push({ name, lat: lat2, lng: lng2, category }); return; }
        const anchorType = categorizeAnchor(tags, anchors);
        if (anchorType) anchorPois.push({ name, lat: lat2, lng: lng2, anchorType });
      });

      const result = { pois, anchors: anchorPois, error: null, source: 'Overpass (' + new URL(endpoint).hostname + ')' };
      const response = new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } });
      await cache.put(cacheKey, response.clone());
      return result;
    } catch (e) {
      lastError = endpoint + ': ' + e.message;
    }
  }

  // Every mirror failed. FIXED, 2026-09-16: try the Geoapify backstop
  // here before giving up — this is the fallback
  // MARKET_RADAR_SETUP_AND_GLOSSARY.md already described, now actually
  // wired in. Only reachable once every mirror above has failed, so
  // this never adds latency or spends Geoapify's daily credit on the
  // common path. Still not cached at the "all failed" level — a
  // genuine outage shouldn't be remembered for 24 hours; the next
  // Analyze click should try everything again for real.
  //
  // Geoapify has no anchor-institution categories mapped (see
  // GEOAPIFY_CATEGORY_MAP) — anchors simply comes back empty on this
  // path rather than guessing at a mapping. Competitor data and the
  // opportunity score are unaffected either way; the anchor overlay is
  // the one thing that goes quiet during a total Overpass outage.
  const geoapifyResult = await fetchGeoapifyPOIs(env, lat, lng, radiusM, categories);
  if (geoapifyResult.pois.length > 0) return { pois: geoapifyResult.pois, anchors: [], error: null, source: 'Geoapify (Overpass fallback)' };

  const geoapifyNote = !env.GEOAPIFY_API_KEY
    ? ' No Geoapify backstop is configured (see GEOAPIFY_API_KEY in this file\u2019s header).'
    : geoapifyResult.error
      ? ' The Geoapify backstop also failed (' + geoapifyResult.error + ').'
      : ' The Geoapify backstop found nothing here either.';
  return { pois: [], anchors: [], error: 'Every Overpass mirror failed (' + lastError + ').' + geoapifyNote + ' The catchment shape and district numbers below are unaffected.' };
}

// Same "most specific wins" principle as categorize() above, adapted
// for Geoapify's own category strings: a bubble tea shop comes back
// carrying BOTH the generic catering.cafe and the specific
// catering.cafe.bubble_tea, so whichever mapped category has the
// more specific (more dot-separated) match wins, regardless of which
// order GEOAPIFY_CATEGORY_MAP's own entries happen to be in.
function categorizeGeoapify(placeCategories, categories) {
  let bestKey = null;
  let bestSpecificity = -1;
  for (const key of Object.keys(categories)) {
    for (const gc of GEOAPIFY_CATEGORY_MAP[key] || []) {
      if (placeCategories.includes(gc)) {
        const specificity = gc.split('.').length;
        if (specificity > bestSpecificity) { bestSpecificity = specificity; bestKey = key; }
      }
    }
  }
  return bestKey;
}

// Only ever called after every OVERPASS_MIRRORS entry has failed —
// see fetchOverpassPOIs above. Cached for 24 hours, same reasoning
// as the Overpass cache. Returns { pois: [], error: '...' } rather
// than throwing, same defensive pattern as the rest of this file.
async function fetchGeoapifyPOIs(env, lat, lng, radiusM, categories) {
  if (!env.GEOAPIFY_API_KEY) return { pois: [], error: 'no Geoapify key configured' };

  const geoapifyCategories = new Set();
  Object.keys(categories).forEach((key) => {
    (GEOAPIFY_CATEGORY_MAP[key] || []).forEach((c) => geoapifyCategories.add(c));
  });
  // e.g. a "custom" OSM-tag request, or "printing" alone — Geoapify
  // has no mapped category to even ask for.
  if (!geoapifyCategories.size) return { pois: [], error: null };

  const categoryList = [...geoapifyCategories].sort();
  const cache = caches.default;
  const cacheKeyStr = categoryList.join(',') + '|' + lat.toFixed(3) + '|' + lng.toFixed(3) + '|' + radiusM;
  const cacheKey = new Request('https://cache.internal/geoapify/' + hashString(cacheKeyStr));
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  // Geoapify's circle filter wants lon,lat order — like ORS below,
  // this is the one place in this function that ISN'T [lat, lng].
  const url = `https://api.geoapify.com/v2/places?categories=${categoryList.join(',')}&filter=circle:${lng},${lat},${radiusM}&limit=500&apiKey=${env.GEOAPIFY_API_KEY}`;
  try {
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return { pois: [], error: 'Geoapify returned ' + resp.status };
    const geojson = await resp.json();

    const pois = (geojson.features || []).map((f) => {
      const props = f.properties || {};
      const coords = f.geometry && f.geometry.coordinates;
      if (!coords) return null;
      const category = categorizeGeoapify(props.categories || [], categories);
      if (!category) return null;
      return { name: props.name || props.address_line1 || 'Unnamed', lat: coords[1], lng: coords[0], category };
    }).filter(Boolean);

    const result = { pois, error: null };
    const response = new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } });
    await cache.put(cacheKey, response.clone());
    return result;
  } catch (e) {
    return { pois: [], error: 'Geoapify: ' + e.message };
  }
}

/* ================= 1B. GOOGLE PLACES (optional competitor-strength) ================= */
// See the GOOGLE_PLACES_API_KEY note in this file's header — this
// entire section is skipped in under a millisecond if that env var
// isn't set, so it adds no latency or risk for anyone not using it.

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Confirmed against developers.google.com/maps/documentation/places/
// web-service/nearby-search on 2026-09-16: endpoint, request shape,
// and field-mask tiers (displayName/location are Pro-tier fields;
// rating/userRatingCount are Enterprise-tier — mixing them bills the
// whole call at Enterprise, $35/1,000 after 1,000 free/month — see
// this file's header). rankPreference DISTANCE, not the POPULARITY
// default, because these results only matter here if they plausibly
// ARE the competitors this file already found nearby — a popular
// place across town is noise, not signal, for this purpose.
async function fetchGooglePopularity(env, lat, lng, radiusM, categories) {
  if (!env.GOOGLE_PLACES_API_KEY) return [];

  const types = new Set();
  Object.keys(categories).forEach((key) => {
    (GOOGLE_PLACE_TYPES[key] || []).forEach((t) => types.add(t));
  });
  if (!types.size) return []; // e.g. a "custom" OSM-tag request, or "printing" alone

  const typeList = [...types].sort();
  const cache = caches.default;
  const cacheKeyStr = typeList.join(',') + '|' + lat.toFixed(3) + '|' + lng.toFixed(3) + '|' + radiusM;
  const cacheKey = new Request('https://cache.internal/google-popularity/' + hashString(cacheKeyStr));
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  try {
    const resp = await fetchWithTimeout('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.location,places.rating,places.userRatingCount',
      },
      body: JSON.stringify({
        includedTypes: typeList.slice(0, 50), // Google's own per-request cap; we're nowhere near it
        maxResultCount: 20, // Google's own per-request cap (1-20)
        rankPreference: 'DISTANCE',
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radiusM, 50000) } },
      }),
    });
    if (!resp.ok) return []; // fails open — this signal is optional by design, never worth breaking the rest of the analysis over
    const data = await resp.json();
    const places = (data.places || []).map((p) => {
      if (!p.location || p.rating == null) return null;
      return { name: (p.displayName && p.displayName.text) || 'Unnamed', lat: p.location.latitude, lng: p.location.longitude, rating: p.rating, reviewCount: p.userRatingCount || 0 };
    }).filter(Boolean);

    // Cached 24h, same as the other POI sources — ratings and review
    // counts drift slowly, and this conserves the free monthly cap.
    const response = new Response(JSON.stringify(places), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' } });
    await cache.put(cacheKey, response.clone());
    return places;
  } catch (e) {
    return [];
  }
}

// Attaches rating/reviewCount onto whichever already-classified
// Overpass/Geoapify pois sit within 75m of a Google result — never
// adds a NEW competitor Google found that Overpass/Geoapify missed,
// and never changes a POI's category. Google only ever answers "how
// well-known is this specific place", nothing else, here.
function attachGooglePopularity(pois, googlePlaces) {
  if (!googlePlaces.length) return pois;
  const MAX_MATCH_DISTANCE_M = 75;
  return pois.map((p) => {
    let best = null;
    let bestDist = MAX_MATCH_DISTANCE_M;
    for (const g of googlePlaces) {
      const d = haversineMeters(p.lat, p.lng, g.lat, g.lng);
      if (d <= bestDist) { bestDist = d; best = g; }
    }
    return best ? { ...p, rating: best.rating, reviewCount: best.reviewCount } : p;
  });
}

/* ================= 2. OPENROUTESERVICE (real catchment shape) ================= */

// Returns null on ANY failure — missing key, rate limit, network
// error, timeout — by design. market-radar.js already knows how to
// draw a plain circle instead when this comes back null, so a
// Worker-side throw here would take down the whole analysis over
// what should be a graceful, minor degradation.
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
    // Cached for 30 days — a town's road network and typical travel
    // speeds don't meaningfully change month to month, and this
    // conserves the shared 500/day free allowance.
    const response = new Response(JSON.stringify(geojson), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=2592000' } });
    await cache.put(cacheKey, response.clone());
    return geojson;
  } catch (e) {
    return null;
  }
}

/* ================= 3. DATA.GOV.MY / OPENDOSM (district population & income) ================= */
// v1.5.0 — REWRITTEN. Root cause of "district population: Not available" (found 2026-09-20):
// population_district is served by the OpenDOSM API (api.data.gov.my/opendosm). The Data Catalogue
// endpoint (api.data.gov.my/data-catalogue) answers [] for it — even for the dataset page's own
// unfiltered sample query (?id=population_district&limit=3) — so no filter wording could ever have
// worked; the three earlier "filter syntax" fixes were chasing the wrong problem.
// hh_income_district (income) IS served by the Data Catalogue endpoint. Each dataset tries its home
// endpoint first and the other second, so DOSM re-homing a dataset later doesn't silently break it.
// Query rules (developer.data.gov.my/request-query): ifilter takes ONE case-insensitive value@column;
// the comma-separated multi-column form is documented only for filter. So population asks for the
// district's rows (newest year first) and this file picks the both/overall/overall total row itself.
// The population figure is published in THOUSANDS. Limit: 4 requests/minute PER API without a token
// (developer.data.gov.my/rate-limit) — one call per API per analysis, and a 429 is reported, not hidden.
//
// v1.5.1 — the paragraph above was itself wrong, confirmed live 2026-09-22: opendosm 400s on
// population_district regardless of filter, and data-catalogue still answers [] for it too. Both
// endpoints are still tried below (self-healing, in case DOSM fixes either later), but the number
// that actually shows on the page today comes from DISTRICT_POPULATION_FALLBACK_2023 near
// fetchPopulation() — a small table of the 4 districts this tool supports, sourced directly from
// DOSM this round rather than parsing the ~300k-row population_district.csv at runtime. That file is
// roughly 100x bigger than any other CSV this Worker parses, and Cloudflare's free plan caps CPU
// time at 10ms/request (waiting on a fetch() response doesn't count against that; parsing the result
// does) — a full parse risked failing outright for a number that only needs updating about once a
// year for four fixed towns. If this tool ever needs population for districts beyond the four in
// TOWNS, revisit that trade-off rather than growing this table by hand indefinitely.

function latestRow(rows) {
  if (!rows.length) return null;
  return rows.slice().sort((a, b) => new Date(b.date) - new Date(a.date))[0];
}

// Tries each base endpoint in order. Returns the first non-empty row list, plus a plain-English trail
// of what went wrong on the ones that didn't work (shown on the page when a figure is missing).
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

// Sourced 2026-09-22 directly from DOSM (cross-checked between DOSM's own Kawasanku dashboard,
// open.dosm.gov.my/dashboard/kawasanku, and citypopulation.de's Malaysia tables, which cite DOSM
// directly — Miri and Kuching matched exactly between the two, 248,877 and 609,205 for the 2020
// census, giving good confidence in the same sources' 2023 estimates used here): DOSM's 2023 mid-
// year intercensal population estimate per district — the cohort-component method DOSM itself uses
// to publish every non-census year, so this is the same KIND of number the live dataset's newest row
// would show, just pinned instead of live-queried. Only read when both OpenAPI attempts above have
// failed (currently always — see the note above). NEEDS A MANUAL REFRESH: (a) about once a year, when
// DOSM publishes new district estimates (check open.dosm.gov.my/data-catalogue/population_district or
// the Kawasanku dashboard per district); (b) immediately if a new town is ever added to TOWNS in
// market-radar.js — this table does not grow on its own.
const DISTRICT_POPULATION_FALLBACK_2023 = {
  miri: 255100,
  kuching: 621700,
  sibu: 254000,
  bintulu: 186600,
};

async function fetchPopulation(district) {
  const q = `ifilter=${encodeURIComponent(district)}@district&sort=-date&limit=1000`;
  // Order matches what population_district's own dataset page documents as correct — tried first
  // purely so this self-heals for free if DOSM ever fixes it; both are broken today regardless,
  // confirmed live 2026-09-22, not assumed.
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

// hh_income_district has no sex/age/ethnicity breakdown — one row per district per year; income_median
// is already in RM (no unit conversion).
async function fetchIncome(district) {
  const q = `ifilter=${encodeURIComponent(district)}@district&sort=-date&limit=1`;
  const { rows, trail } = await fetchDosmRows('hh_income_district', q, [DATA_GOV_MY_ENDPOINT, OPENDOSM_ENDPOINT]);
  const row = latestRow(rows);
  const value = row ? (Number(row.income_median) || 0) : 0;
  if (value) return { value, note: '' };
  return { value: 0, note: 'Income: ' + (trail.length ? trail.join('; ') : 'the row had no income_median figure') };
}

// Cached 7 days per district — SUCCESSES ONLY. The old version cached a failed lookup (population 0)
// for a week, so even after the query was fixed the page would have kept showing "Not available".
// The key is versioned (demographics-v2) so any bad entry cached by the old code is bypassed. Each
// figure is cached and re-fetched independently: one dataset failing never re-downloads the other.
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

/* ================= 3B. DOSM WHOLESALE & RETAIL TRADE (national context) ================= */
// Answers "is this kind of business growing or shrinking, nationally" —
// requested 2026-09-18. Two things make this different from every other
// data source in this file, both worth being upfront about in the UI,
// not just here:
//   (1) It's Malaysia-WIDE. DOSM doesn't publish this broken down by
//       state or district at all, so this is national context sitting
//       alongside hyper-local numbers, not a local figure itself.
//   (2) It only covers MSIC Section G (wholesale & retail trade) — so
//       only "minimart", "bakery", "hardware", and "fashion" below have
//       any match at all. The F&B categories (cafe, restaurant, drinks,
//       etc.) sit in Section I, a completely different part of the
//       classification this index doesn't touch, and laundry/salon/
//       printing are services sections it doesn't touch either. That's
//       not a gap to route around — the index genuinely doesn't cover
//       those business types, so "not tracked" is the honest answer
//       for 7 of the 11 categories, not a failure of this function.
//
// The dataset ID for this (iowrt_3d) is explicitly marked "not
// available through OpenAPI" on its own data.gov.my page — unlike
// population_district/hh_income_district above, there's no ?id=
// endpoint for this one. But the CSV DOSM publishes for direct download
// is CC BY 4.0 licensed specifically for reuse like this, so this
// fetches that file directly and parses it, rather than treating
// "not on the filterable API" as "not accessible at all". Confirmed
// working file, confirmed column meanings, both as of 2026-09-18:
// storage.dosm.gov.my/iowrt/iowrt_3d.csv — columns include date,
// series_type ('abs'/'growth_yoy'/'growth_mom'), group (3-digit MSIC,
// matches the first 3 digits of the msic.code on each CATEGORY_TAGS
// entry), and one value column. Column order isn't hardcoded below —
// the header row is read first — specifically so a future column
// reshuffle on DOSM's end doesn't silently misread the wrong field.
// This file is small (a monthly index across ~30 groups), unlike
// population_district.csv above — the parse below is cheap enough not
// to need the same CPU-budget caution.
//
// Cached for 30 days: this dataset updates monthly, so daily-cache
// churn would just be wasted bandwidth on both ends. If DOSM ever
// restructures this file and the parse below can't find what it
// expects, this returns null — same "fail honest, don't fake a number"
// rule as everywhere else in this file — and the card on the page
// shows "not available" rather than a stale or invented figure.
const IOWRT_GROUPS = {
  minimart: { group: '471', label: 'Retail sale in non-specialised stores' },
  bakery: { group: '472', label: 'Retail sale of food, beverages & tobacco (specialised stores)' },
  hardware: { group: '475', label: 'Retail sale of household/construction goods (specialised stores)' },
  fashion: { group: '477', label: 'Retail sale of other goods incl. clothing (specialised stores)' },
};

async function fetchWholesaleRetailTrends(categoryKeys) {
  const out = {};
  const wanted = Array.from(new Set(categoryKeys || [])).filter((k) => IOWRT_GROUPS[k]); // most categories genuinely aren't in this index
  if (!wanted.length) return out;

  // Per-group cache entries keep the same key/shape as before, so entries cached by v1.4 are still valid.
  const missing = [];
  for (const k of wanted) {
    const hit = await cacheGet(new Request('https://cache.internal/iowrt/' + IOWRT_GROUPS[k].group));
    if (hit && Number.isFinite(hit.growthYoy)) out[k] = hit; else missing.push(k);
  }
  if (!missing.length) return out;

  try {
    // ONE download serves every category still missing, however many were ticked.
    const resp = await fetchWithTimeout('https://storage.dosm.gov.my/iowrt/iowrt_3d.csv', {}, 15000);
    if (!resp.ok) return out;
    const text = await resp.text();
    const lines = text.split('\n').filter((l) => l.trim().length);
    if (lines.length < 2) return out;

    const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
    const dateIdx = header.indexOf('date');
    const seriesIdx = header.indexOf('series_type');
    const groupIdx = header.indexOf('group');
    if (dateIdx < 0 || seriesIdx < 0 || groupIdx < 0) return out;
    // The value column's exact name isn't confirmed the way date/series_type/group are, so try
    // candidates in order (sales/value-looking name, then unlabelled, then volume-looking) and only
    // accept a cell that is genuinely a number — a wrong name guess falls through to the next candidate.
    const candidateIdxs = header.map((_, i) => i).filter((i) => i !== dateIdx && i !== seriesIdx && i !== groupIdx);
    if (!candidateIdxs.length) return out;
    const ordered = [
      ...candidateIdxs.filter((i) => /sales|value/i.test(header[i])),
      ...candidateIdxs.filter((i) => !/sales|value|volume|vol_index|quantity/i.test(header[i])),
      ...candidateIdxs.filter((i) => /volume|vol_index|quantity/i.test(header[i])),
    ];

    const groupsWanted = new Set(missing.map((k) => IOWRT_GROUPS[k].group));
    const bestByGroup = {}; // group -> { date, value }
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const g = String(cols[groupIdx]).trim();
      if (!groupsWanted.has(g) || String(cols[seriesIdx]).trim() !== 'growth_yoy') continue;
      const date = String(cols[dateIdx]).trim();
      const best = bestByGroup[g];
      if (best && date <= best.date) continue; // ISO dates (YYYY-MM-DD) sort correctly as plain strings
      let value = NaN;
      for (const idx of ordered) {
        const cell = cols[idx] == null ? '' : String(cols[idx]).trim();
        if (cell !== '' && Number.isFinite(Number(cell))) { value = Number(cell); break; } // an empty cell must not read as 0
      }
      if (Number.isFinite(value)) bestByGroup[g] = { date, value };
    }
    for (const k of missing) {
      const info = IOWRT_GROUPS[k];
      const best = bestByGroup[info.group];
      if (!best) continue;
      const result = { group: info.group, label: info.label, growthYoy: best.value, asOf: best.date };
      out[k] = result;
      await cachePut(new Request('https://cache.internal/iowrt/' + info.group), result, 2592000); // 30 days — the index updates monthly
    }
  } catch (e) { /* fail honest: whatever couldn't be read simply isn't shown */ }
  return out;
}

/* ================= 4. NARRATION (Gemini first, Workers AI backstop) ================= */
// Same calling convention as crypto-radar-worker.js's own handleInsight
// — plain generateContent, not the structured response_format/schema
// shape food-worth-proxy-worker.js uses, since this is free-text
// narration of numbers already computed, not data extraction.

function insightPrompt(s) {
  const bd = Array.isArray(s.breakdown) && s.breakdown.length > 1
    ? ` The competitor count combines ${Math.min(s.breakdown.length, 4)} business types the person ticked (${s.breakdown.slice(0, 4).map((b) => `${clip(b && b.label, 40)}: ${Number(b && b.count) || 0}`).join(', ')}).`
    : '';
  const obs = Number.isInteger(s.observedBusyness) && s.observedBusyness >= 1 && s.observedBusyness <= 5
    ? ` The person's own on-site read of how busy the competition looks is ${s.observedBusyness} on a 1-5 scale (1 = very quiet, 5 = packed).`
    : '';
  const system = 'You are a neutral market-data narrator for a small-business site-selection tool used in Sarawak, Malaysia. '
    + 'Write 3-4 short sentences in plain English: what these numbers together suggest, one thing worth checking in person before relying on this, and how much confidence the data sources actually support. '
    + 'Hard rules: never state a specific revenue or profit figure, never tell them to open or not open here — this describes the data, it does not recommend a decision. Never invent a number not given below.';
  const score = Number(s.opportunityScore);
  const data = `Snapshot for a candidate spot in ${clip(s.town, 40) || 'the area'}: business type(s) "${clip(s.category, 200)}", ${Number(s.competitorCount) || 0} competitors found inside the catchment.${bd}`
    + ` Category mix ${Math.round((Number(s.diversityIndex) || 0) * 100)}% diverse (100% = evenly mixed, 0% = one category dominates), district population ${Number(s.districtPopulation) || 'unknown'}, district median household income RM${Number(s.districtIncome) || 'unknown'}/month, opportunity score ${Number.isFinite(score) ? score : 'unknown'}/100.${obs}`
    + (s.catchmentIsReal ? '' : ' Note: the catchment shape used here is an estimated radius, not a real travel-time isochrone — mention this reduces precision.');
  return { system, data };
}

// ADDED 2026-09-24 for Market Gap mode — a distinct prompt rather than forcing the checklist into
// insightPrompt()'s single-category shape above. Same hard rules (narrate only, never invent,
// never make the open/don't-open call), with one addition: since the whole point of this checklist
// is spotting where a gap or an oversupply sits, the model is explicitly allowed to point that out
// as a pattern worth a closer look — still short of recommending a specific decision.
function gapInsightPrompt(s) {
  const rows = Array.isArray(s.rows) ? s.rows : [];
  const gaps = rows.filter((r) => r && r.read === 'gap').map((r) => clip(r && r.label, 40));
  const thin = rows.filter((r) => r && r.read === 'thin').map((r) => clip(r && r.label, 40));
  const over = rows.filter((r) => r && r.read === 'oversupplied').map((r) => clip(r && r.label, 40));
  const system = 'You are a neutral market-data narrator for a small-business site-selection tool used in Sarawak, Malaysia. '
    + 'This snapshot is a household-needs checklist, not a single business score: categories are marked missing, thin, or oversupplied RELATIVE TO EACH OTHER in this one catchment, not against any outside "should have" number — make that relative framing clear if you refer to it. '
    + 'Write 3-4 short sentences in plain English: what the pattern of gaps and oversupply suggests, and you may note that a gap or thin category could be worth a closer look, or that an oversupplied one would need real differentiation to compete in. '
    + 'Hard rules: never state a specific revenue or profit figure, never tell them to definitely open or not open any specific business — point at what the data shows, do not make the decision for them. Never invent a number, category, or business type not given below.';
  const data = `Snapshot for a candidate spot in ${clip(s.town, 40) || 'the area'}: a household-needs checklist of ${rows.length} business types was checked in the catchment.`
    + (gaps.length ? ` Gaps (none found): ${gaps.join(', ')}.` : ' No categories were completely absent.')
    + (thin.length ? ` Thin (well below the rest of the mix here): ${thin.join(', ')}.` : '')
    + (over.length ? ` Oversupplied (well above the rest of the mix here): ${over.join(', ')}.` : '')
    + ` District population ${Number(s.districtPopulation) || 'unknown'}.`
    + (s.catchmentIsReal ? '' : ' Note: the catchment shape used here is an estimated radius, not a real travel-time isochrone — mention this reduces precision.');
  return { system, data };
}

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

// Runs on Cloudflare's own network, so it has no "unsupported region" problem. Needs the AI binding.
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

async function handleInsight(env, body) {
  const s = (body && body.snapshot) || {};
  const { system, data } = s.kind === 'gap' ? gapInsightPrompt(s) : insightPrompt(s);
  const problems = [];

  if (env.GEMINI_API_KEY) {
    try {
      const text = await narrateWithGemini(env, system + '\n\n' + data);
      if (text) return { text, via: 'Gemini' };
      problems.push('Gemini returned no text');
    } catch (e) {
      problems.push(e && e.name === 'AbortError' ? 'Gemini timed out' : (e && e.message) || 'Gemini failed');
    }
  } else {
    problems.push('GEMINI_API_KEY is not set on this Worker');
  }

  if (env.AI && typeof env.AI.run === 'function') {
    try {
      const text = await narrateWithWorkersAI(env, system, data);
      if (text) return { text, via: 'Workers AI' };
      problems.push('Workers AI returned no text');
    } catch (e) {
      problems.push('Workers AI: ' + ((e && e.message) || 'failed'));
    }
  } else {
    problems.push('no Workers AI binding named AI is attached to this Worker');
  }

  const blocked = problems.some((p) => /location is not supported/i.test(p));
  return {
    error: (blocked
      ? 'Google refused the request because Cloudflare happened to run this Worker in a region Gemini doesn\u2019t serve — it isn\u2019t about your location, and it changes from request to request. Fix: add the free Workers AI binding named AI to this Worker (see the setup guide). '
      : '') + 'Details: ' + problems.join(' | '),
  };
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
    if (!body || typeof body !== 'object') return json({ error: 'Invalid request body' }, 400, origin);

    if (body.mode === 'insight') {
      const result = await handleInsight(env, body);
      return json(result, result.error ? 500 : 200, origin);
    }

    const { lat, lng } = body;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !isFinite(lat) || !isFinite(lng)
      || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !body.categories || typeof body.categories !== 'object') {
      return json({ error: 'Request needs at least lat, lng, and categories.' }, 400, origin);
    }
    // Everything below is client-supplied and gets checked before it reaches a query, URL or prompt.
    const radiusM = Math.min(Math.max(Number(body.radiusM) || 1000, 100), MAX_RADIUS_M);
    const categories = cleanTagSet(body.categories, MAX_CATEGORY_TAG_PAIRS);
    const anchors = cleanTagSet(body.anchors, MAX_ANCHOR_TAG_PAIRS);
    const district = cleanDistrict(body.district);
    const iso = body.isochrone && ORS_PROFILES.includes(body.isochrone.profile) && Number.isInteger(body.isochrone.seconds)
      && body.isochrone.seconds >= 60 && body.isochrone.seconds <= 3600 ? body.isochrone : null;
    const selected = (Array.isArray(body.selectedCategories) ? body.selectedCategories : (body.selectedCategory ? [body.selectedCategory] : []))
      .filter((k) => typeof k === 'string').slice(0, 12); // selectedCategory (singular) = what an older market-radar.js sends

    try {
      const [overpassResult, isochrone, demographics, googlePopularity, trends] = await Promise.all([
        fetchOverpassPOIs(env, lat, lng, radiusM, categories, anchors),
        iso ? fetchIsochrone(env, lat, lng, iso.profile, iso.seconds) : Promise.resolve(null),
        district ? fetchDemographics(district) : Promise.resolve({ population: 0, medianIncome: 0, notes: [] }),
        fetchGooglePopularity(env, lat, lng, radiusM, categories),
        fetchWholesaleRetailTrends(selected),
      ]);
      const pois = attachGooglePopularity(overpassResult.pois, googlePopularity);
      // 200, not an error status, even when overpassResult.error is set — this IS a successful
      // response, it just carries a partial-data flag. market-radar.js shows the catchment and
      // demographics it DID get rather than a blank failure screen.
      return json({
        pois,
        poisError: overpassResult.error,
        anchors: overpassResult.anchors,
        isochrone,
        demographics,
        wholesaleRetailTrends: trends,
        wholesaleRetailTrend: Object.values(trends)[0] || null, // single-category shape, kept so an older market-radar.js still works
        meta: { workerVersion: WORKER_VERSION, poiSource: overpassResult.source ? overpassResult.source + (overpassResult.fromCache ? ', cached' : '') : 'none' },
      }, 200, origin);
    } catch (err) {
      return json({ error: 'Analysis failed: ' + (err.message || 'unknown error') }, 502, origin);
    }
  },
};
