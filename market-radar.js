// Market Radar client logic — v1.6.0 (2026-09-24). What changed: this file and market-radar-proxy-worker.js — added a mode-select screen (Market Analysis vs. the new Market Gap checklist mode), two new standard categories (pharmacy, petrol station), and the Market Gap results panel. See MARKET_RADAR_SETUP_AND_GLOSSARY.md for the full writeup and research behind the checklist. How it fits together: MARKET_RADAR_HANDOFF.md.
/* ============================================================
   Market Radar
   Two deliberate exceptions to this site's usual zero-dependency
   rule: Leaflet.js and its Leaflet.heat plugin (via CDN, no build
   step, no npm — see market-radar.html's <head> comment). An actual
   interactive street map with real pan/zoom isn't something that
   can reasonably be hand-rolled in SVG the way this site's other
   charts are (interactive-costing-analysis.js's break-even chart is
   a handful of straight lines on a fixed grid; rendering real map
   tiles and coordinate projection from scratch is a different scale
   of problem entirely). Everything else in this file follows the
   same rules as the rest of the site: nothing persists except a
   small daily-usage counter (see MAX_ANALYSES_PER_DAY, identical
   pattern to food-worth-calculator.js), and every number that
   matters — the opportunity score, the density count, the diversity
   index — is computed with plain deterministic JS, auditable and
   never guessed by an AI. Gemini is used in exactly one place
   (requestInsight/renderInsight) and only to narrate numbers this
   file already computed, the same restrained role it plays in
   crypto-radar.js's own insight feature.

   ------------------------------------------------------------
   WHAT THIS TOOL DOES: pick a town, drop a pin on a candidate spot
   (or leave it at the town centre), pick what kind of business
   you're weighing, and see three things layered on one map:
     1. Your actual catchment area — a real walk/drive-time shape
        from OpenRouteService, not a naive circle. If OpenRouteService
        isn't configured yet, or the call fails, this falls back to
        a plain radius circle so the tool still works — just less
        precisely — rather than breaking outright.
     2. Every competitor of that category inside that catchment,
        pulled from OpenStreetMap's free Overpass API, as markers
        plus a density heatmap.
     3. An "opportunity score" — a plain, fully editable weighted
        formula (see SCORE_WEIGHTS) blending that competitor count
        against district population, household income, and category
        mix, sourced from Malaysia's own open data API (data.gov.my).

   Every stat on screen carries an Official / Estimated / Calculated
   tag (see PROVENANCE) so nothing implies more confidence than the
   source actually deserves.

   ------------------------------------------------------------
   DATA FLOW: this file never calls Overpass, OpenRouteService, or
   data.gov.my directly — everything goes through ONE Cloudflare
   Worker call (see WORKER_ENDPOINT), same pattern as every other
   proxy on this site. The Worker's job is fetching and caching raw
   data; every calculation below (the point-in-polygon catchment
   filter, the density count, the diversity index, the opportunity
   score) happens here, client-side, in the open — see
   market-radar-proxy-worker.js's own header for why the split is
   drawn exactly there.

   ------------------------------------------------------------
   KIV (planned, not built this round — see
   MARKET_RADAR_SETUP_AND_GLOSSARY.md for the fuller list):
     - AppSheet field-survey ingestion, as a fourth "Observed" layer.
     - Full MSIC-code category alignment — CATEGORY_TAGS below covers
       the ~11 categories likeliest to matter for a first F&B/retail
       business, not the full official taxonomy.
     - Momentum / trend tracking. Needs repeated snapshots taken
       weeks apart to mean anything; the momentum sub-score sits at
       a neutral 0.5 until that history exists (see
       computeOpportunityScore).
     - Wiring the rzBroadcast call below into Interactive Costing
       Analysis / Margin Analysis's own handleSyncPayload functions —
       those two files don't recognise a 'market-radar' source yet.
       That's a small, contained edit flagged in the setup doc rather
       than made here, since it touches files this session didn't own.

   ------------------------------------------------------------
   FIXED, 2026-09-16: "Drink stall / bubble tea" was invisible for
   real bubble tea shops. Root cause was in CATEGORY_TAGS below plus
   categorize() in market-radar-proxy-worker.js — see the comment on
   CATEGORY_TAGS.drinks and NAME_HINTS below for the fix. Short
   version: OSM tags a bubble tea stall as amenity=cafe (or
   amenity=fast_food) + cuisine=bubble_tea, not as its own shop type,
   so it needed a specific-tag-priority fix in the Worker, not just a
   tag added here.
   ============================================================ */

const MR_CLIENT_VERSION = '1.6.0';
console.info('[Market Radar] client v' + MR_CLIENT_VERSION + ' — build 2026-09-22');

/* ================= CONFIG =================
   Everything below is meant to be changed. See the Settings
   reference table in MARKET_RADAR_SETUP_AND_GLOSSARY.md for what
   each one does and where its starting number came from. */

// Town presets — lat/lng are approximate town centres, just a
// starting pin; click anywhere on the map to move it before
// analyzing. "district" must exactly match one of DOSM's 160 official
// district names (case doesn't matter — the Worker's ifilter= query
// is case-insensitive) — confirm any new town's spelling against
// open.dosm.gov.my/data-catalogue/population_district before adding it
// here. (An earlier version of this comment pointed at a Worker-side
// DISTRICT_ALIASES lookup table for this — that table was never
// actually built; corrected here rather than left pointing at
// something that doesn't exist.) NOTE (v1.5.1): if a town is ever
// added here, market-radar-proxy-worker.js's DISTRICT_POPULATION_
// FALLBACK_2023 needs that district added too, by hand — it's a
// pinned table, not a live lookup, and only covers today's four towns.
const TOWNS = {
  miri: { label: 'Miri', lat: 4.4148, lng: 113.9917, district: 'Miri' },
  kuching: { label: 'Kuching', lat: 1.5535, lng: 110.3593, district: 'Kuching' },
  sibu: { label: 'Sibu', lat: 2.2870, lng: 111.8305, district: 'Sibu' },
  bintulu: { label: 'Bintulu', lat: 3.1668, lng: 113.0413, district: 'Bintulu' },
};
const DEFAULT_TOWN = 'miri';

// Each category maps to one or more OpenStreetMap tag pairs. OSM
// tagging is crowd-sourced and genuinely inconsistent — a "drink
// stall" might be tagged amenity=cafe, shop=beverages, or nothing
// recognisable at all — so treat every count below as a reasonable
// signal, not a census. Add a category by adding one line; the
// dropdown, the Overpass query, and the diversity index all read
// from this same table, so nothing else needs to change.
// FEATURE, 2026-09-18: added `msic` to every category below — Malaysia's
// official 5-digit industrial classification code (MSIC 2008), used for
// SSM company registration, LHDN e-Invoicing, and DOSM's own economic
// statistics. Purely a REFERENCE annotation shown in the UI — it plays
// no part in the Overpass query or categorize() logic, which still run
// on OSM tags exactly as before. Sourced from Malaysia-specific
// documents (LHDN/hasil.gov.my's own New Business Codes MSIC2008 PDF,
// and data.gov.my's own MSIC lookup table structure), not the generic
// international ISIC codes, which occasionally diverge at this level of
// detail — cross-checked against at least two independent Malaysia-
// specific sources per code. This is also what makes the DOSM trend
// figure below possible: iowrt (Wholesale & Retail Trade Index) groups
// by 3-digit MSIC group, so `msic.code.slice(0, 3)` is the join key —
// see IOWRT_GROUPS in market-radar-proxy-worker.js. "printing" and
// "custom" have no group-level match in that index (confirmed — see
// fetchWholesaleRetailTrend's own comment), so they'll always show
// "not tracked" for that card, which is correct, not a bug.
const CATEGORY_TAGS = {
  cafe: { label: 'Cafe / kopitiam', tags: [['amenity', 'cafe']], msic: { code: '56302', name: 'Coffee shops' } },
  restaurant: { label: 'Restaurant', tags: [['amenity', 'restaurant']], msic: { code: '56101', name: 'Restaurants and restaurant cum night clubs' } },
  fastfood: { label: 'Fast food / food stall', tags: [['amenity', 'fast_food']], msic: { code: '56103', name: 'Fast-food restaurants' } },
  bakery: { label: 'Bakery / dessert', tags: [['shop', 'bakery'], ['shop', 'pastry'], ['shop', 'confectionery']], msic: { code: '47216', name: 'Retail sale of bakery products and sugar confectionery' } },
  // FIXED, 2026-09-16: added ['cuisine','bubble_tea'] — OSM's own
  // documented convention tags a bubble tea stall as amenity=cafe (or
  // amenity=fast_food) PLUS cuisine=bubble_tea; there's no dedicated
  // shop=bubble_tea tag (one was proposed and the OSM community
  // rejected it for exactly this reason — see
  // wiki.openstreetmap.org/wiki/Tag:cuisine=bubble_tea). The three
  // original tags here (shop=beverages/tea/coffee) are all real OSM
  // tags, just not the ones an actual walk-up bubble tea stall uses in
  // practice — shop=tea and shop=coffee in particular mean a retailer
  // of tea leaves or coffee beans/equipment, not a prepared-drink
  // stall. Left them in rather than removing them (harmless, and
  // occasionally still correct), but cuisine=bubble_tea is the tag
  // that actually matters. On its own this addition isn't enough —
  // market-radar-proxy-worker.js's categorize() also needed a priority
  // fix so cuisine=* tags get checked before "cafe" claims the POI
  // first; see that file's own 2026-09-16 note. NAME_HINTS below is
  // the second half of this fix, for stalls tagged amenity=cafe with
  // no cuisine sub-tag at all — common enough in practice that
  // cuisine=bubble_tea alone doesn't catch everything.
  drinks: { label: 'Drink stall / bubble tea', tags: [['cuisine', 'bubble_tea'], ['shop', 'beverages'], ['shop', 'tea'], ['shop', 'coffee']], msic: { code: '56303', name: 'Drink stalls/hawkers' } },
  minimart: { label: 'Convenience / minimart', tags: [['shop', 'convenience'], ['shop', 'supermarket']], msic: { code: '47113', name: 'Mini market' } },
  fashion: { label: 'Fashion / apparel', tags: [['shop', 'clothes'], ['shop', 'shoes']], msic: { code: '47711', name: 'Retail sale of articles of clothing, articles of fur, and clothing accessories' } },
  hardware: { label: 'Hardware', tags: [['shop', 'hardware'], ['shop', 'doityourself']], msic: { code: '47520', name: 'Retail sale of construction materials, hardware, paints, and glass' } },
  laundry: { label: 'Laundry', tags: [['shop', 'laundry']], msic: { code: '96011', name: 'Laundering and dry-cleaning of textile and fur products' } },
  salon: { label: 'Salon / barber', tags: [['shop', 'hairdresser'], ['shop', 'beauty']], msic: { code: '96020', name: 'Hairdressing and other beauty treatment' } },
  printing: { label: 'Printing / copy shop', tags: [['shop', 'copyshop'], ['shop', 'printing']], msic: { code: '82190', name: 'Photocopying, document preparation and other specialised office support activities' } },
  // ADDED 2026-09-24, for the Market Gap checklist (household monthly-needs research — see
  // MARKET_RADAR_SETUP_AND_GLOSSARY.md for the sources): both are also just ordinary tickable
  // types in Market Analysis mode, same as everything else in this table — no special-casing
  // needed anywhere else in the file for that. MSIC codes cross-checked against other countries'
  // ISIC-derived codes at this same 5-digit level (India's NIC-2008 for pharmacy, Sweden's SNI for
  // fuel retail) rather than a direct Malaysia SSM/DOSM lookup — flagging that distinction here the
  // same way this file already does for every other MSIC code, so it's easy to re-verify later.
  pharmacy: { label: 'Pharmacy', tags: [['amenity', 'pharmacy']], msic: { code: '47721', name: 'Retail sale of pharmaceuticals, medical and orthopaedic goods and toilet articles' } },
  petrol: { label: 'Petrol / fuel station', tags: [['amenity', 'fuel']], msic: { code: '47300', name: 'Retail sale of automotive fuel in specialised stores' } },
  custom: { label: 'Custom — type your own OSM tag', tags: [], msic: null },
};

// Second half of the 2026-09-16 bubble tea fix (see CATEGORY_TAGS.drinks
// above): a real-world stall tagged plain amenity=cafe with NO
// cuisine sub-tag at all is common enough that the tag fix alone
// doesn't catch everything. A specific brand-name or generic-word
// match in the POI's own name is a strong enough signal to override
// whatever tag-based category the Worker assigned — false positives
// here are essentially impossible for a curated list like this one.
// Only "drinks" has entries for now; add another category's array
// here the same way if the same kind of mis-bucketing shows up for
// it (this is exactly the mechanism to reach for if a search ever
// "finds all F&B, then breaks down by type" runs into the same
// generic-primary-tag problem for some other category).
const NAME_HINTS = {
  drinks: [
    'bubble tea', 'boba', 'pearl milk tea',
    'chatime', 'tealive', 'gong cha', 'koi thé', 'koi the',
    'xing fu tang', 'tiger sugar', 'sharetea', 'share tea',
    'comebuy', 'come buy', 'daboba', 'the alley', 'liho', 'yifang',
    'each a cup',
  ],
};

// FEATURE, 2026-09-18: institutions that generate foot traffic without
// being a competitor to anything — the "would a food business want to
// be near this" list. Deliberately separate from CATEGORY_TAGS above:
// these are never counted as competitors, never affect the opportunity
// score, and use a plain tag match (no cuisine-tag-style priority logic
// needed — there's no ambiguity here the way "cafe vs bubble tea" had).
// Left out: large private employers/offices — OSM has no reliable tag
// for "this specific company has 200 staff", so a generic office/
// industrial-land tag would be more noise than signal. If that matters
// for a specific spot, the vacant-unit-style notepad pattern (a plain
// manual note) is the honest way to capture it, not a query this fuzzy.
const ANCHOR_TAGS = {
  school: { label: 'School', tags: [['amenity', 'school']] },
  college: { label: 'University / college', tags: [['amenity', 'university'], ['amenity', 'college']] },
  health: { label: 'Hospital / clinic', tags: [['amenity', 'hospital'], ['amenity', 'clinic']] },
  mall: { label: 'Mall / hypermarket / department store', tags: [['shop', 'mall'], ['shop', 'department_store']] },
  govt: { label: 'Government office', tags: [['office', 'government'], ['amenity', 'townhall']] },
  worship: { label: 'Place of worship', tags: [['amenity', 'place_of_worship']] },
  transport: { label: 'Bus / transport terminal', tags: [['amenity', 'bus_station'], ['aeroway', 'terminal']] },
};

// Catchment modes drive both the OpenRouteService isochrone request
// (profile + seconds) and the circle drawn instead if that call
// fails or isn't configured yet — see drawCatchment(). fallbackRadiusM
// is a rough eyeball of how far each travel mode covers in that time
// on an ordinary Malaysian town street grid, not a precise conversion,
// and radiusM sent to the Worker is 1.3x this — a deliberate
// over-fetch, since the real isochrone shape is rarely a perfect
// circle and the extra margin gets trimmed off client-side anyway
// (see pointInPolygon).
// v1.5.0: added walk5 / drive5 — same pace ratios as the 10-minute rows (walk 80 m per minute, drive ~500 m per minute).
const CATCHMENT_MODES = {
  walk5: { label: '5-minute walk', profile: 'foot-walking', seconds: 300, fallbackRadiusM: 400 },
  walk10: { label: '10-minute walk', profile: 'foot-walking', seconds: 600, fallbackRadiusM: 800 },
  walk15: { label: '15-minute walk', profile: 'foot-walking', seconds: 900, fallbackRadiusM: 1200 },
  drive5: { label: '5-minute drive', profile: 'driving-car', seconds: 300, fallbackRadiusM: 2500 },
  drive10: { label: '10-minute drive', profile: 'driving-car', seconds: 600, fallbackRadiusM: 5000 },
  drive15: { label: '15-minute drive', profile: 'driving-car', seconds: 900, fallbackRadiusM: 8000 },
};

// Opportunity score: a plain weighted sum of five 0-1 sub-scores,
// nothing hidden or statistical about it. These five numbers are
// editable live on the page itself (#mr-weight-*) — these are only
// the starting values shown there. See computeOpportunityScore() for
// the actual formula behind each sub-score.
const SCORE_WEIGHTS_DEFAULT = { lowCompetition: 0.35, population: 0.25, income: 0.15, diversity: 0.15, momentum: 0.10, competitorStrength: 0 };

// Competitors that count as "fully saturated" PER BUSINESS TYPE ticked. With several types
// ticked the real threshold is this number x how many are ticked (see computeOpportunityScore),
// so ticking four food types isn't punished four times over. One visible, adjustable number
// rather than a per-category guess this file would otherwise have to invent.
const SATURATION_COUNT = 12;

// v1.5.0 — business-type picker (checkboxes instead of a dropdown).
const MAX_CATEGORIES = 4;                 // most types that can be ticked at once
const DEFAULT_CATEGORIES = ['cafe'];      // ticked when the page opens
const ON_SITE_AUTO_WEIGHT = 0.10;         // weight "Competitor strength" gets the moment an on-site read is picked
const CUSTOM_TAG_PATTERN = /^[A-Za-z0-9_:\-]{1,40}$/;  // same rule the Worker enforces on custom OSM tags

// District population/income are shown as district-level context
// (that's the finest grain DOSM's open data actually publishes —
// there's no official mesh-block-level figure to fall back to), then
// scaled into a 0-1 sub-score against these two reference points.
// A district at or above these numbers maxes out that sub-score.
const POPULATION_NORMALIZER = 120000;
const INCOME_NORMALIZER = 7000; // RM/month

const MAX_ANALYSES_PER_DAY = 15; // soft cap, same reasoning as food-worth-calculator.js: protects OpenRouteService's shared 500/day free allowance and data.gov.my's 4-10 req/min limit from one browser using them all up
const USAGE_STORAGE_KEY = 'mr-usage';

// Paste your deployed Worker's URL here — see
// market-radar-proxy-worker.js's own header for deploy steps.
const WORKER_ENDPOINT = 'https://market-radar-proxy.reysourcez-ent.workers.dev/';

const PROVENANCE = {
  population: 'Official — DOSM (district-level)',
  income: 'Official — DOSM (district-level)',
  competitor: 'Estimated — OpenStreetMap',
  isochroneReal: 'Estimated — OpenRouteService travel-time shape',
  isochroneFallback: 'Estimated — radius fallback, not a real travel-time shape',
};

/* ================= SHARED UTILITIES ================= */

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
function clamp01(v) { return Math.max(0, Math.min(1, isFinite(v) ? v : 0)); }
function setStatus(text, isError) {
  const el = document.getElementById('mr-status');
  el.textContent = text;
  el.classList.toggle('is-error', !!isError);
}

/* ================= SOFT USAGE CAP (same pattern as food-worth-calculator.js) ================= */

function getUsageToday() {
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_STORAGE_KEY) || 'null');
    if (!raw || raw.day !== new Date().toDateString()) return 0;
    return raw.count;
  } catch (e) { return 0; }
}
function recordUsage() {
  try { localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify({ day: new Date().toDateString(), count: getUsageToday() + 1 })); }
  catch (e) {}
}

/* ================= MODE SELECT (added 2026-09-24 — Market Analysis vs. Market Gap) ================= */
// currentMode gates which of the two result panels renders and which categories get checked —
// see applyModeVisibility() and getActiveCategories(). Chosen once, before the wizard, and only
// changed by explicitly going back to this screen (see backToModeSelect()) — never inferred.
let currentMode = null; // 'analysis' | 'gap'

function chooseMode(mode) {
  currentMode = mode;
  document.getElementById('mr-mode-select').hidden = true;
  document.getElementById('wizard').hidden = false;
  wizardStepIndex = 0;
  renderWizardStep();
}

// Reached by going "back" from the wizard's first step (town) — see goBack() below. Resets
// everything the same way switching towns does, PLUS clears which mode was active, so nothing
// from one mode's analysis can bleed into the other after switching.
function backToModeSelect() {
  resetAnalysisState();
  currentMode = null;
  document.getElementById('wizard').hidden = true;
  document.getElementById('mr-mode-select').hidden = false;
}

/* ================= WIZARD ================= */

const WIZARD_STEPS = [
  { key: 'town', question: 'Which town are you scouting?', options: Object.entries(TOWNS).map(([value, t]) => ({ value, label: t.label })) },
  { key: 'catchment', question: 'How should we measure the area around a spot?', options: Object.entries(CATCHMENT_MODES).map(([value, m]) => ({ value, label: m.label })) },
];

let wizardStepIndex = 0;
const wizardAnswers = {};

function renderWizardStep() {
  if (wizardStepIndex >= WIZARD_STEPS.length) { finishWizard(); return; }
  const step = WIZARD_STEPS[wizardStepIndex];
  const container = document.getElementById('wizard-question');
  container.innerHTML = `
    <p class="wizard-progress">Step ${wizardStepIndex + 1} of ${WIZARD_STEPS.length}</p>
    <h3>${step.question}</h3>
    <div class="wizard-options">
      ${step.options.map((o) => `<button type="button" class="wizard-option" data-value="${o.value}">${escapeHTML(o.label)}</button>`).join('')}
    </div>
  `;
  container.querySelectorAll('.wizard-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      wizardAnswers[step.key] = btn.dataset.value;
      wizardStepIndex++;
      renderWizardStep();
    });
  });
  // ADDED 2026-09-24: the back button is never hidden anymore — at step 0 it now leads all the way
  // back to mode-select (there's a step "-1" to go back to now), so it stays visible and relabels
  // itself instead of disappearing the way it did when the wizard was the first thing on the page.
  const backBtn = document.getElementById('wizard-back');
  backBtn.hidden = false;
  backBtn.textContent = wizardStepIndex === 0 ? '← Choose a different analysis' : 'Back';
}
function goBack() {
  if (wizardStepIndex > 0) { wizardStepIndex--; renderWizardStep(); return; }
  backToModeSelect();
}

function finishWizard() {
  document.getElementById('wizard').hidden = true;
  document.getElementById('mr-analysis').hidden = false;
  const town = TOWNS[wizardAnswers.town];
  document.getElementById('mr-town-label').textContent = town.label;
  document.getElementById('mr-catchment-select').value = wizardAnswers.catchment;
  initMap(town);
  applyModeVisibility();
}

// ADDED 2026-09-24: toggles which INPUT area shows inside the shared analysis screen — the
// category-ticking fieldset for Market Analysis, or the checklist intro/custom-add row for Market
// Gap. Output-side visibility (which results panel renders) is handled separately in
// resetAnalysisState() and renderScore()/renderGapResults(), since those only matter after a real
// analysis — this only concerns the pre-Analyze input state.
function applyModeVisibility() {
  const isGap = currentMode === 'gap';
  document.getElementById('mr-category-group').hidden = isGap;
  document.getElementById('mr-gap-intro').hidden = !isGap;
}

// FIXED, 2026-09-23: editAnswers() used to only swap which section was visible — it never reset
// the previous spot's results, so the analysis screen could keep showing a stale competitor
// count/score/AI read (and even a stale on-site busyness reading silently feeding the NEW spot's
// score) right up until the next "Analyze this spot" click. The map alone self-corrected
// (initMap() below always rebuilds the whole Leaflet instance), which is exactly why this was easy
// to miss on a quick look — the map looked right immediately; only the cards/score/insight around
// it didn't. Concretely, getInsight() builds its snapshot from TOWNS[wizardAnswers.town].label (the
// NEW town, already updated by the wizard) alongside lastAnalysis's numbers (the OLD town's) — so a
// plain-English read requested right after switching towns, before re-analyzing, would describe the
// new town's name over the old town's data.
// EXTENDED 2026-09-24 for the two-mode split: the same staleness risk applies to whichever mode's
// results are on screen, so this resets BOTH the Market Analysis panel and the Market Gap panel
// unconditionally, regardless of which one is currently visible — cheaper and safer than tracking
// which one needs it, and hiding an already-hidden element is a no-op.
function resetAnalysisState() {
  lastAnalysis = null;

  // The on-site read is the sneaky part: left alone, a "Busy" read from the OLD spot would keep
  // affecting the NEXT spot's score under an "Observed" tag that implies a fresh, current read.
  // Clear it and undo whatever auto-weight shift it applied — same restore onObservedChange()
  // already does when a read is cleared by hand. Other, manually-edited weights are left alone:
  // those are a standing preference across spots, not something tied to one location.
  const observedEl = document.getElementById('mr-observed-busyness');
  if (observedEl) observedEl.value = '';
  if (strengthAutoApplied) {
    const lc = parseFloat(document.getElementById('mr-weight-lowCompetition').value) || 0;
    setWeightInput('lowCompetition', lc + strengthAutoMoved);
    setWeightInput('competitorStrength', 0);
    strengthAutoApplied = false;
    strengthAutoMoved = 0;
  }
  document.getElementById('mr-observed-notice').hidden = true;
  updateWeightTotalDisplay();

  // Back to exactly how these looked before the very first "Analyze this spot" click. vacantUnits
  // (the notepad) and gapCustomItems (the checklist additions) are deliberately left alone — both
  // are documented as running, session-long lists, not per-spot results tied to whichever pin or
  // mode happens to be active right now.
  document.getElementById('mr-score-banner').hidden = true;
  document.getElementById('mr-result-cards').hidden = true;
  document.getElementById('mr-field-note-panel').hidden = true;
  document.getElementById('mr-vacancy-panel').hidden = true;
  document.getElementById('mr-weights-panel').hidden = true;
  document.getElementById('mr-gap-results').hidden = true;

  document.getElementById('mr-ai-insight').textContent = 'Click "Get a plain-English read" below once you\'ve analyzed a spot.';
  document.getElementById('mr-ai-insight').classList.add('is-empty');
  setStatus('');

  // Map layers need no explicit clearing here: finishWizard() (called right after the wizard
  // finishes again) always runs initMap(), which calls map.remove() and builds a brand-new Leaflet
  // map — that alone wipes every marker/heat/catchment layer the old analysis drew.
}

function editAnswers() {
  resetAnalysisState();
  document.getElementById('mr-analysis').hidden = true;
  document.getElementById('wizard').hidden = false;
  wizardStepIndex = 0;
  renderWizardStep();
}

/* ================= BUSINESS-TYPE PICKER (v1.5.0 — tick up to MAX_CATEGORIES) ================= */

function escapeAttr(str) { return escapeHTML(String(str)).replace(/"/g, '&quot;'); }

function renderCategoryOptions() {
  const box = document.getElementById('mr-category-options');
  box.innerHTML = Object.entries(CATEGORY_TAGS).map(([key, c]) => {
    const tip = c.msic ? 'MSIC ' + c.msic.code + ' — ' + c.msic.name : 'Type your own OpenStreetMap key and value';
    const checked = DEFAULT_CATEGORIES.includes(key) ? ' checked' : '';
    return `<label class="mr-cat-option" title="${escapeAttr(tip)}"><input type="checkbox" name="mr-category" value="${escapeAttr(key)}"${checked}><span>${escapeHTML(c.label)}</span></label>`;
  }).join('');
  box.querySelectorAll('input[type="checkbox"]').forEach((cb) => cb.addEventListener('change', syncCategoryUI));
  syncCategoryUI();
}

function getSelectedCategories() {
  return Array.from(document.querySelectorAll('#mr-category-options input[type="checkbox"]:checked')).map((cb) => cb.value);
}

// At the cap every UNticked box is disabled; ticked ones stay clickable so the person can swap.
function syncCategoryUI() {
  const selected = getSelectedCategories();
  const atMax = selected.length >= MAX_CATEGORIES;
  document.querySelectorAll('#mr-category-options .mr-cat-option').forEach((label) => {
    const cb = label.querySelector('input');
    cb.disabled = atMax && !cb.checked;
    label.classList.toggle('is-checked', cb.checked);
    label.classList.toggle('is-disabled', cb.disabled);
  });
  document.getElementById('mr-category-count').textContent = selected.length + ' of ' + MAX_CATEGORIES + ' selected'
    + (atMax ? ' — untick one to swap' : (selected.length === 0 ? ' — tick at least one' : ''));
  document.getElementById('mr-custom-tag-row').classList.toggle('is-visible', selected.includes('custom'));
}

/* ================= MARKET GAP CHECKLIST (added 2026-09-24) ================= */
// Gap mode checks EVERY standard category at once (no ticking — see applyModeVisibility()) plus
// whatever the person adds here. This is the multi-item equivalent of Market Analysis's single
// "custom" slot above: same validation pattern (CUSTOM_TAG_PATTERN), but a running list instead of
// one slot, since auditing a whole checklist is the point of this mode.
const MAX_GAP_CUSTOM_ITEMS = 8; // sanity cap, not a hard technical limit — keeps the table and the Overpass query reasonable
let gapCustomItems = []; // {key, tagKey, tagValue, label}
let gapCustomCounter = 0;

function renderGapCustomList() {
  const list = document.getElementById('mr-gap-custom-list');
  list.innerHTML = gapCustomItems.map((c, i) =>
    `<li><span>${escapeHTML(c.label)}</span><button type="button" data-idx="${i}" aria-label="Remove">✕</button></li>`
  ).join('');
  list.querySelectorAll('button[data-idx]').forEach((btn) => {
    btn.addEventListener('click', () => { gapCustomItems.splice(Number(btn.dataset.idx), 1); renderGapCustomList(); });
  });
}

function addGapCustomItem() {
  const keyEl = document.getElementById('mr-gap-custom-key');
  const valueEl = document.getElementById('mr-gap-custom-value');
  const key = keyEl.value.trim();
  const value = valueEl.value.trim();
  if (!key || !value) { setStatus('Type both an OSM key and value to add a checklist item.', true); return; }
  if (!CUSTOM_TAG_PATTERN.test(key) || !CUSTOM_TAG_PATTERN.test(value)) {
    setStatus('Custom OSM tags can only use letters, numbers, _ : and - (up to 40 characters).', true);
    return;
  }
  if (gapCustomItems.length >= MAX_GAP_CUSTOM_ITEMS) {
    setStatus('Up to ' + MAX_GAP_CUSTOM_ITEMS + ' custom checklist items at a time — remove one to add another.', true);
    return;
  }
  gapCustomCounter += 1;
  gapCustomItems.push({ key: 'gapcustom' + gapCustomCounter, tagKey: key, tagValue: value, label: key + '=' + value });
  keyEl.value = '';
  valueEl.value = '';
  renderGapCustomList();
}

// Covers both the 13 standard types and any gap-mode custom additions — analysis mode's single
// "custom" slot has its own locally-scoped label logic inside analyzeSpot() and doesn't go through
// this helper.
function labelForCategory(key) {
  if (CATEGORY_TAGS[key]) return CATEGORY_TAGS[key].label;
  const custom = gapCustomItems.find((c) => c.key === key);
  return custom ? custom.label : key;
}

// What "Analyze this spot" actually checks: the ticked types in Market Analysis mode, or the whole
// checklist (everything but 'custom' plus whatever's been added) in Market Gap mode. Kept separate
// from getSelectedCategories() itself rather than folding a mode-check into it, since the checkbox
// list it reads doesn't exist/apply in gap mode at all.
function getActiveCategories() {
  if (currentMode !== 'gap') return getSelectedCategories();
  return Object.keys(CATEGORY_TAGS).filter((k) => k !== 'custom').concat(gapCustomItems.map((c) => c.key));
}

// Herfindahl-style diversity (computeDiversityIndex) answers "how mixed is it"; this answers "which
// SPECIFIC types are thin or piled up" — a judgement call the same way SATURATION_COUNT is:
// relative to the OTHER checklist categories found in this same catchment, not against an outside
// "should have" number nobody here has good data for. Zero is always a plain gap, no threshold
// needed; everything else is ranked against this catchment's own average non-zero count.
function computeGapReads(categoryCounts, checklistKeys, districtPopulation) {
  const rows = checklistKeys.map((key) => ({ key, label: labelForCategory(key), count: categoryCounts[key] || 0 }));
  const nonZero = rows.map((r) => r.count).filter((n) => n > 0);
  const avg = nonZero.length ? nonZero.reduce((a, b) => a + b, 0) / nonZero.length : 0;
  return rows.map((r) => {
    let read;
    if (r.count === 0) read = 'gap';
    else if (avg > 0 && r.count >= avg * 2) read = 'oversupplied';
    else if (avg > 0 && r.count <= avg * 0.4) read = 'thin';
    else read = 'adequate';
    const perShop = (districtPopulation && r.count > 0) ? Math.round(districtPopulation / r.count) : null;
    return { ...r, read, perShop };
  }).sort((a, b) => a.count - b.count); // gaps and thin ones surface first
}



let map, pinMarker, catchmentLayer, heatLayer;
let poiMarkers = [];
let anchorMarkers = [];

function initMap(town) {
  if (map) map.remove();
  map = L.map('mr-map').setView([town.lat, town.lng], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  placePin(town.lat, town.lng);
  map.on('click', (e) => placePin(e.latlng.lat, e.latlng.lng));
}

// Click anywhere on the map to move the pin there — that's the
// whole point of the tool: test one exact shoplot, not just "near
// the town centre".
function placePin(lat, lng) {
  if (pinMarker) {
    pinMarker.setLatLng([lat, lng]);
  } else {
    pinMarker = L.marker([lat, lng], { draggable: true }).addTo(map);
    pinMarker.on('dragend', () => { const p = pinMarker.getLatLng(); placePin(p.lat, p.lng); });
  }
  document.getElementById('mr-pin-coords').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function clearResultLayers() {
  if (catchmentLayer) { map.removeLayer(catchmentLayer); catchmentLayer = null; }
  if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
  poiMarkers.forEach((m) => map.removeLayer(m));
  poiMarkers = [];
  anchorMarkers.forEach((m) => map.removeLayer(m));
  anchorMarkers = [];
}

// Draws whatever catchment shape came back — a real isochrone
// polygon from OpenRouteService, or a plain circle (matching the
// same mode's fallbackRadiusM) if that call failed or wasn't
// configured. Either branch returns the SAME shape (a Leaflet layer
// plus a containsPoint test), so nothing downstream needs to know
// which case it was — see the "isReal" flag only for the legend/
// provenance label.
function drawCatchment(isochroneGeoJSON, centerLat, centerLng, mode) {
  if (isochroneGeoJSON && isochroneGeoJSON.features && isochroneGeoJSON.features[0]) {
    catchmentLayer = L.geoJSON(isochroneGeoJSON, { style: { color: '#1F6F5C', weight: 2, fillOpacity: 0.08 } }).addTo(map);
    // GeoJSON coordinates are [lng, lat]; Leaflet and every other
    // coordinate pair in this file are [lat, lng]. Flipping this is
    // the single easiest bug to introduce when touching this
    // function — the swap below is deliberate, not a typo.
    const ring = isochroneGeoJSON.features[0].geometry.coordinates[0];
    const latLngRing = ring.map(([lng, lat]) => [lat, lng]);
    return { layer: catchmentLayer, containsPoint: (lat, lng) => pointInPolygon(lat, lng, latLngRing), areaKm2: ringAreaKm2(latLngRing, centerLat), isReal: true };
  }
  const radiusM = CATCHMENT_MODES[mode].fallbackRadiusM;
  catchmentLayer = L.circle([centerLat, centerLng], { radius: radiusM, color: '#5C6D64', weight: 2, dashArray: '5 4', fillOpacity: 0.05 }).addTo(map);
  return {
    layer: catchmentLayer,
    containsPoint: (lat, lng) => haversineMeters(centerLat, centerLng, lat, lng) <= radiusM,
    areaKm2: Math.PI * (radiusM / 1000) ** 2,
    isReal: false,
  };
}

// Standard ray-casting point-in-polygon test. Needed because Overpass
// only knows how to fetch "everything within a circle" (see the
// Worker) — the actual catchment is whatever shape OpenRouteService
// returned, so every fetched point still has to be tested against
// the real polygon, not just trusted because it came back at all.
function pointInPolygon(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i], [latJ, lngJ] = ring[j];
    const intersect = ((lngI > lng) !== (lngJ > lng)) && (lat < (latJ - latI) * (lng - lngI) / (lngJ - lngI) + latI);
    if (intersect) inside = !inside;
  }
  return inside;
}
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// Shoelace-formula polygon area, converted from degrees to km²
// using a flat-earth approximation local to one small area —
// genuinely wrong at continent scale, entirely fine for a
// 10-minute catchment inside one town.
function ringAreaKm2(ring, centerLat) {
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos(centerLat * Math.PI / 180);
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lngI] = ring[i], [latJ, lngJ] = ring[j];
    area += (lngJ * kmPerDegLng) * (latI * kmPerDegLat) - (lngI * kmPerDegLng) * (latJ * kmPerDegLat);
  }
  return Math.abs(area / 2);
}

/* ================= OPPORTUNITY SCORE (pure functions, no DOM) ================= */

// Every sub-score is clamped 0-1 so the weighted sum always lands
// 0-1 no matter how extreme the inputs get — a spot with zero
// competitors gets a full 1.0 on that one component, not an infinite
// score, the same "clamp, don't crash" instinct as everywhere else
// on this site.
function computeOpportunityScore(inputs, weights) {
  // v1.5.0: saturation scales with how many business types are ticked (SATURATION_COUNT per type)
  const saturation = SATURATION_COUNT * Math.max(1, inputs.categoryCount || 1);
  const lowCompetition = clamp01(1 - inputs.competitorCount / saturation);
  const population = clamp01(inputs.districtPopulation / POPULATION_NORMALIZER);
  const income = clamp01(inputs.districtIncome / INCOME_NORMALIZER);
  const diversity = clamp01(inputs.diversityIndex);
  const momentum = 0.5; // neutral placeholder — see the KIV note at the top of this file
  const competitorStrength = computeCompetitorStrengthFactor(inputs);

  const weightSum = weights.lowCompetition + weights.population + weights.income + weights.diversity + weights.momentum + weights.competitorStrength || 1;
  const total = (weights.lowCompetition * lowCompetition + weights.population * population
    + weights.income * income + weights.diversity * diversity + weights.momentum * momentum
    + weights.competitorStrength * competitorStrength) / weightSum;
  // Dividing by weightSum means an off-target total (weights not
  // summing to exactly 1.00) still produces a sane 0-1 score instead
  // of silently over- or under-counting — the on-page warning
  // when weights don't sum to 1.00 is about transparency, not about
  // preventing a broken calculation.
  return { total: clamp01(total), parts: { lowCompetition, population, income, diversity, momentum, competitorStrength } };
}

// Per-competitor "how proven a threat is this, really" read from
// Google's rating + review count, 0 (unproven/thin) to 1 (an
// established, well-loved incumbent). Needs BOTH a strong rating AND
// a meaningful review count — a 5.0 with 2 reviews isn't a real
// signal yet; log10 keeps one enormously-reviewed chain from
// dominating the average on its own. This exact formula is a
// judgement call, not a fact — reasonable people could weight
// rating vs. volume differently; it's isolated here specifically so
// it's easy to find and change.
function competitorPoiStrength(rating, reviewCount) {
  const ratingPart = clamp01((rating || 0) / 5);
  const volumePart = clamp01(Math.log10((reviewCount || 0) + 1) / 3); // ~1,000 reviews maxes this out
  return clamp01(ratingPart * volumePart);
}

// FEATURE, 2026-09-16: the "competitor strength" signal — off
// (weight 0) by default in SCORE_WEIGHTS_DEFAULT, so this has zero
// effect on anyone who doesn't deliberately raise the weight in the
// panel below. When it IS turned on, priority order: a fresh,
// in-person "observed" read (mr-observed-busyness on the page) beats
// an aggregate Google rating, which beats the neutral 0.5 used when
// neither is available — same "unused signal changes nothing"
// pattern as the momentum placeholder above. Deliberately a
// SEPARATE weight from lowCompetition rather than folded into it:
// "3 quiet competitors" and "3 competitors with a queue out the
// door" are genuinely different situations, and collapsing them into
// one number would hide that distinction instead of surfacing it.
function computeCompetitorStrengthFactor(inputs) {
  if (inputs.observedBusyness != null) {
    // 1 (very quiet) -> 1.0 (favorable, weak competition)
    // 5 (packed)     -> 0.0 (unfavorable, strong competition)
    return clamp01(1 - (inputs.observedBusyness - 1) / 4);
  }
  const sample = inputs.competitorRatingSample || [];
  if (sample.length) {
    const avgStrength = sample.reduce((s, c) => s + competitorPoiStrength(c.rating, c.reviewCount), 0) / sample.length;
    return clamp01(1 - avgStrength);
  }
  return 0.5;
}

// Herfindahl-style concentration across every category found nearby
// (not just the one selected), inverted so 1.0 = healthily mixed and
// 0.0 = one category totally dominates the area.
function computeDiversityIndex(categoryCounts) {
  const total = Object.values(categoryCounts).reduce((s, n) => s + n, 0);
  if (total === 0) return 1;
  const hhi = Object.values(categoryCounts).reduce((s, n) => s + (n / total) ** 2, 0);
  return clamp01(1 - hhi);
}

function scoreVerdict(score) {
  if (score >= 0.75) return 'Strong opportunity';
  if (score >= 0.55) return 'Worth a closer look';
  if (score >= 0.35) return 'Competitive, proceed carefully';
  return 'Crowded — hard to stand out here';
}

/* ================= WORKER CALL ================= */

async function fetchAnalysis(payload) {
  let response;
  try {
    response = await fetch(WORKER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error('Could not reach the analysis service — check WORKER_ENDPOINT is correct and this page’s URL is in the Worker’s ALLOWED_ORIGINS.');
  }
  let data;
  try { data = await response.json(); }
  catch (e) { throw new Error('Got an unreadable response from the analysis service. Try again.'); }
  if (!response.ok) throw new Error(data.error || ('Analysis failed (error ' + response.status + '). Try again.'));
  return data;
}

/* ================= ANALYZE FLOW ================= */

// Runs once, right after fetchAnalysis returns, before anything else
// touches the POI list — see NAME_HINTS above. A specific keyword or
// brand-name match is treated as MORE reliable than whatever tag-based
// category the Worker assigned, so it always wins when one is found;
// a POI with no name match keeps whatever category it already had.
function applyNameHints(pois) {
  return pois.map((p) => {
    const name = (p.name || '').toLowerCase();
    for (const [key, hints] of Object.entries(NAME_HINTS)) {
      if (hints.some((h) => name.includes(h))) return { ...p, category: key };
    }
    return p;
  });
}

let lastAnalysis = null; // holds everything recomputeScore() and requestInsight() need without re-fetching

// Plain notepad, not a data source — see the structure-note next to the
// panel in market-radar.html for why no live vacancy data exists to
// fetch here. Resets on reload, same as every other input on this page.
let vacantUnits = [];

function renderVacancyList() {
  const list = document.getElementById('mr-vacancy-list');
  list.innerHTML = vacantUnits.map((v, i) =>
    `<li><span>${escapeHTML(v.floor)} — ${escapeHTML(v.detail)}</span><button type="button" data-idx="${i}" aria-label="Remove">✕</button></li>`
  ).join('');
  list.querySelectorAll('button[data-idx]').forEach((btn) => {
    btn.addEventListener('click', () => { vacantUnits.splice(Number(btn.dataset.idx), 1); renderVacancyList(); });
  });
}

// FIXED, 2026-09-16: with three Overpass mirrors plus a Geoapify
// fallback now each getting their own timeout (see
// EXTERNAL_CALL_TIMEOUT_MS in market-radar-proxy-worker.js), a worst-
// case analysis can genuinely take up to about 40 seconds if every
// single data source is having a bad day. Before this, the status
// line just said "Fetching…" the entire time, which is exactly what
// "taking a long time and doesn't appear to complete" looks like from
// the outside — there was no way to tell a slow-but-working request
// apart from a genuinely stuck one. This cycles through a couple of
// honest, reassuring messages instead of one static line, and gets
// stopped in analyzeSpot's own finally block the moment a real
// answer (success or failure) comes back.
const PROGRESS_MESSAGES = [
  'Fetching competitors, catchment shape, and district data…',
  'Still working — the first data source is slow to answer, trying another…',
  'Still working — some of these are free, shared services and occasionally slow. Worst case this takes under a minute.',
];
function startProgressMessages() {
  let i = 0;
  setStatus(PROGRESS_MESSAGES[0]);
  const timer = setInterval(() => {
    i = Math.min(i + 1, PROGRESS_MESSAGES.length - 1);
    setStatus(PROGRESS_MESSAGES[i]);
  }, 7000);
  return () => clearInterval(timer);
}

function currentWeights() {
  return {
    lowCompetition: parseFloat(document.getElementById('mr-weight-lowCompetition').value) || 0,
    population: parseFloat(document.getElementById('mr-weight-population').value) || 0,
    income: parseFloat(document.getElementById('mr-weight-income').value) || 0,
    diversity: parseFloat(document.getElementById('mr-weight-diversity').value) || 0,
    momentum: parseFloat(document.getElementById('mr-weight-momentum').value) || 0,
    competitorStrength: parseFloat(document.getElementById('mr-weight-competitorStrength').value) || 0,
  };
}

function updateWeightTotalDisplay() {
  const w = currentWeights();
  const sum = w.lowCompetition + w.population + w.income + w.diversity + w.momentum + w.competitorStrength;
  const el = document.getElementById('mr-weight-total');
  el.textContent = sum.toFixed(2);
  el.classList.toggle('is-off', Math.abs(sum - 1) > 0.01);
}

// mr-observed-busyness is deliberately read fresh here rather than
// baked into lastAnalysis once at analyze-time — same reason the
// weight inputs are read fresh in currentWeights(): the person should
// be able to add or change their on-site read after the fact and see
// the score respond immediately, exactly like nudging a weight slider.
// Nothing here is saved anywhere — it resets when the tab closes,
// same as every other input on this page.
function getObservedBusyness() {
  const el = document.getElementById('mr-observed-busyness');
  const v = el ? el.value : '';
  return v ? Number(v) : null;
}

function scoreInputs() {
  return lastAnalysis ? { ...lastAnalysis, observedBusyness: getObservedBusyness() } : lastAnalysis;
}

function renderScore() {
  if (!lastAnalysis) return;
  const result = computeOpportunityScore(scoreInputs(), currentWeights());
  document.getElementById('mr-score-banner').hidden = false;
  document.getElementById('mr-score-number').textContent = Math.round(result.total * 100);
  document.getElementById('mr-score-verdict').textContent = lastAnalysis.poisAvailable
    ? scoreVerdict(result.total)
    : scoreVerdict(result.total) + ' — based on partial data, competitor count unavailable';
}

/* ---- v1.5.0: the on-site read now visibly feeds the score ----
   Picking a busyness read used to change nothing unless "Competitor strength" had already been
   raised above 0 in the weights panel (its default is 0), which read as broken. Now the FIRST
   read picked sets that weight to ON_SITE_AUTO_WEIGHT, taken out of "Low competition" so the
   total stays 1.00, and says so on screen. Clearing the read restores both weights; editing any
   weight by hand switches this automation off. */
let strengthAutoApplied = false;
let strengthAutoMoved = 0;

function setWeightInput(key, value) {
  document.getElementById('mr-weight-' + key).value = (Math.round(value * 100) / 100).toFixed(2);
}

function onObservedChange() {
  const notice = document.getElementById('mr-observed-notice');
  const read = getObservedBusyness();
  const cs = parseFloat(document.getElementById('mr-weight-competitorStrength').value) || 0;
  const lc = parseFloat(document.getElementById('mr-weight-lowCompetition').value) || 0;
  if (read != null && !strengthAutoApplied && cs === 0) {
    strengthAutoMoved = Math.min(ON_SITE_AUTO_WEIGHT, lc);
    setWeightInput('lowCompetition', lc - strengthAutoMoved);
    setWeightInput('competitorStrength', ON_SITE_AUTO_WEIGHT);
    strengthAutoApplied = true;
    notice.textContent = 'Counted in the score at ' + Math.round(ON_SITE_AUTO_WEIGHT * 100)
      + '% (taken from “Low competition”). Change or turn it off under Opportunity score weights.';
    notice.hidden = false;
  } else if (read == null && strengthAutoApplied) {
    setWeightInput('lowCompetition', lc + strengthAutoMoved);
    setWeightInput('competitorStrength', 0);
    strengthAutoApplied = false;
    strengthAutoMoved = 0;
    notice.hidden = true;
  }
  updateWeightTotalDisplay();
  renderScore();
  renderStrengthCard();
}

function onWeightEditedByHand() {
  if (strengthAutoApplied) {
    strengthAutoApplied = false;
    strengthAutoMoved = 0;
    document.getElementById('mr-observed-notice').hidden = true;
  }
  updateWeightTotalDisplay();
  renderScore();
}

// The "Competitor strength" card: the person's own on-site read wins, then Google ratings, then "none".
function renderStrengthCard() {
  if (!lastAnalysis) return;
  const valueEl = document.getElementById('mr-popularity-value');
  const provEl = document.getElementById('mr-popularity-provenance');
  const read = getObservedBusyness();
  if (read != null) {
    const sel = document.getElementById('mr-observed-busyness');
    valueEl.textContent = sel.options[sel.selectedIndex].text.split(' — ')[0];
    provEl.textContent = 'Observed — your own on-site read (overrides Google ratings)';
    return;
  }
  const sample = lastAnalysis.competitorRatingSample || [];
  if (sample.length) {
    const avg = sample.reduce((s, c) => s + c.rating, 0) / sample.length;
    valueEl.textContent = sample.length + ' of ' + lastAnalysis.competitorCount + ' matched, avg ' + avg.toFixed(1) + '★';
    provEl.textContent = 'Estimated — Google Places';
  } else {
    valueEl.textContent = 'No Google match';
    provEl.textContent = 'Not available — GOOGLE_PLACES_API_KEY unset, or no nearby Google listing matched. Pick an on-site read below to use this signal for free.';
  }
}

// DOSM trend card — one line per ticked type that the index actually tracks (4 of the 11).
function renderTrendCard(trends, selected, labelFor, town) {
  const valueEl = document.getElementById('mr-trend-value');
  const provEl = document.getElementById('mr-trend-provenance');
  const tracked = selected.filter((k) => trends[k]);
  const untracked = selected.filter((k) => !trends[k]);
  if (!tracked.length) {
    valueEl.textContent = 'Not tracked';
    provEl.textContent = (selected.length > 1 ? 'None of these types are' : labelFor(selected[0]) + ' isn’t')
      + ' part of DOSM’s wholesale & retail trade index (it only covers 4 of the 11 categories here — see the tooltip)';
    return;
  }
  const fmt = (t) => (t.growthYoy > 0 ? '+' : '') + t.growthYoy.toFixed(1) + '% YoY';
  valueEl.innerHTML = tracked.length === 1
    ? escapeHTML(fmt(trends[tracked[0]]))
    : tracked.map((k) => `<span class="mr-trend-line">${escapeHTML(labelFor(k))}: ${escapeHTML(fmt(trends[k]))}</span>`).join('');
  const asOf = Array.from(new Set(tracked.map((k) => trends[k].asOf))).join(', ');
  provEl.textContent = 'Official — DOSM, as of ' + asOf + ' · Malaysia-wide, not ' + town.label + '-specific'
    + (untracked.length ? ' · Not tracked: ' + untracked.map(labelFor).join(', ') : '');
}

async function analyzeSpot() {
  const town = TOWNS[wizardAnswers.town];
  const catchmentModeKey = document.getElementById('mr-catchment-select').value;
  const catchmentMode = CATCHMENT_MODES[catchmentModeKey];
  const selected = getActiveCategories();
  const pin = pinMarker.getLatLng();

  // MAX_CATEGORIES and "tick at least one" are Market Analysis rules — Market Gap always sends the
  // whole checklist (never empty, never capped at 4), so neither check applies to it.
  if (currentMode === 'analysis') {
    if (!selected.length) { setStatus('Tick at least one business type first.', true); return; }
    if (selected.length > MAX_CATEGORIES) { setStatus('Pick at most ' + MAX_CATEGORIES + ' business types.', true); return; }
  }

  // Every standard type is always sent (so "category mix nearby" stays meaningful whichever ones
  // are ticked); a custom OSM tag joins them as its own type when ticked (Market Analysis), and any
  // gap-mode checklist additions join the same way (Market Gap) — see gapCustomItems.
  const categoriesForRequest = {};
  Object.entries(CATEGORY_TAGS).forEach(([key, c]) => { if (key !== 'custom') categoriesForRequest[key] = { label: c.label, tags: c.tags }; });
  let customLabel = '';
  if (selected.includes('custom')) {
    const key = document.getElementById('mr-custom-key').value.trim();
    const value = document.getElementById('mr-custom-value').value.trim();
    if (!key || !value) { setStatus('Type both an OSM key and value for the custom type first.', true); return; }
    if (!CUSTOM_TAG_PATTERN.test(key) || !CUSTOM_TAG_PATTERN.test(value)) {
      setStatus('Custom OSM tags can only use letters, numbers, _ : and - (up to 40 characters).', true);
      return;
    }
    customLabel = `${key}=${value}`;
    categoriesForRequest.custom = { label: customLabel, tags: [[key, value]] };
  }
  if (currentMode === 'gap') {
    gapCustomItems.forEach((c) => { categoriesForRequest[c.key] = { label: c.label, tags: [[c.tagKey, c.tagValue]] }; });
  }
  const labelFor = (k) => (k === 'custom' ? customLabel : labelForCategory(k));

  if (!WORKER_ENDPOINT || WORKER_ENDPOINT.indexOf('PASTE_YOUR') === 0) {
    setStatus('This tool needs its proxy URL set — see WORKER_ENDPOINT near the top of market-radar.js.', true);
    return;
  }
  if (getUsageToday() + 1 > MAX_ANALYSES_PER_DAY) {
    setStatus('This browser has hit today’s analysis limit. Try again tomorrow.', true);
    return;
  }

  const btn = document.getElementById('mr-analyze-btn');
  btn.disabled = true;
  const stopProgress = startProgressMessages();
  clearResultLayers();

  try {
    const data = await fetchAnalysis({
      lat: pin.lat, lng: pin.lng,
      radiusM: Math.round(catchmentMode.fallbackRadiusM * 1.3),
      categories: categoriesForRequest,
      selectedCategories: selected,
      anchors: ANCHOR_TAGS,
      isochrone: { profile: catchmentMode.profile, seconds: catchmentMode.seconds },
      district: town.district,
    });
    recordUsage();

    const catchment = drawCatchment(data.isochrone, pin.lat, pin.lng, catchmentModeKey);

    const pois = applyNameHints(data.pois || []);
    const withinCatchment = pois.filter((p) => catchment.containsPoint(p.lat, p.lng));
    const selectedSet = new Set(selected);
    const competitors = withinCatchment.filter((p) => selectedSet.has(p.category));
    const categoryCounts = {};
    withinCatchment.forEach((p) => { categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1; });
    // Biggest first, so the card reads "12 Restaurant · 8 Cafe · 4 Bakery".
    const competitorBreakdown = selected
      .map((k) => ({ key: k, label: labelFor(k), count: competitors.filter((p) => p.category === k).length }))
      .sort((a, b) => b.count - a.count);
    // Only populated when GOOGLE_PLACES_API_KEY is set on the Worker — see attachGooglePopularity()
    // in market-radar-proxy-worker.js. Every competitor still counts toward competitorCount above
    // whether or not it has a rating; this is a separate, optional refinement, not a filter.
    const competitorRatingSample = competitors.filter((p) => p.rating != null).map((p) => ({ rating: p.rating, reviewCount: p.reviewCount || 0 }));

    // In gap mode "competitors" ends up meaning every checked category's POIs (selectedSet = the
    // whole checklist), which is exactly what should show as markers/heat for a full-area scan —
    // no special-casing needed here for that.
    poiMarkers = competitors.map((p) => L.circleMarker([p.lat, p.lng], { radius: 6, color: '#C0392B', fillColor: '#C0392B', fillOpacity: 0.7, weight: 1 })
      .bindTooltip(escapeHTML(p.name || 'Unnamed') + (selected.length > 1 ? ' — ' + escapeHTML(labelFor(p.category)) : '')).addTo(map));
    if (competitors.length > 0 && typeof L.heatLayer === 'function') {
      // max=3 treats "3 competitors overlapping in one spot" as fully saturated — calibrated for this
      // tool's scale (single digits to a few dozen points), not the thousands Leaflet.heat's default
      // assumes. See the 2026-09-18 note in MARKET_RADAR_SETUP_AND_GLOSSARY.md.
      heatLayer = L.heatLayer(competitors.map((p) => [p.lat, p.lng, 1]), {
        radius: 35,
        blur: 25,
        max: 3,
        gradient: { 0.15: '#1F6F5C', 0.5: '#E8A33D', 1: '#C0392B' },
      });
      if (document.getElementById('mr-heat-toggle').checked) heatLayer.addTo(map);
    }

    // Anchors are informational only — never counted as competitors, never touch the opportunity score.
    const anchorList = data.anchors || [];
    anchorMarkers = anchorList.map((a) => L.marker([a.lat, a.lng], {
      icon: L.divIcon({ className: 'mr-anchor-icon', html: '■', iconSize: [14, 14] }),
    }).bindTooltip(escapeHTML(a.name || 'Unnamed') + ' — ' + escapeHTML((ANCHOR_TAGS[a.anchorType] || {}).label || a.anchorType)).addTo(map));

    if (catchment.layer) map.fitBounds(catchment.layer.getBounds(), { padding: [20, 20] });

    // Older Workers sent one trend for one category; newer ones send an object keyed by category.
    const trends = data.wholesaleRetailTrends || (data.wholesaleRetailTrend ? { [selected[0]]: data.wholesaleRetailTrend } : {});
    const demo = data.demographics || {};
    const poisAvailable = !data.poisError;

    if (currentMode === 'gap') {
      // ADDED 2026-09-24 — see computeGapReads() for the gap/thin/oversupplied logic (a relative,
      // in-catchment read, not an invented external "should have" benchmark) and
      // MARKET_RADAR_SETUP_AND_GLOSSARY.md for the household-needs research behind the checklist.
      // Anchors, the DOSM trend card, and rzBroadcast are Market-Analysis-specific display/plumbing
      // that don't have an equivalent here yet — not shown in gap mode, flagged as KIV rather than
      // forced into a shape that doesn't fit.
      lastAnalysis = {
        poisAvailable,
        gapRows: poisAvailable ? computeGapReads(categoryCounts, selected, demo.population || 0) : [],
        districtPopulation: demo.population || 0,
        districtIncome: demo.medianIncome || 0,
        demographicsNotes: demo.notes || [],
        catchmentIsReal: catchment.isReal,
        districtLabel: town.district,
        categoryLabel: 'Household needs checklist',
      };
      renderGapResults(catchment, data);
      document.getElementById('mr-ai-insight').textContent = 'Click "Get a plain-English read" below for a summary of what this checklist suggests.';
      document.getElementById('mr-ai-insight').classList.add('is-empty');
      if (data.poisError) {
        setStatus(data.poisError, true);
      } else {
        const gapCount = lastAnalysis.gapRows.filter((r) => r.read === 'gap').length;
        const overCount = lastAnalysis.gapRows.filter((r) => r.read === 'oversupplied').length;
        setStatus(`Checked ${selected.length} business types in this catchment — ${gapCount} gap${gapCount === 1 ? '' : 's'}, ${overCount} oversupplied.`);
      }
      return; // gap mode's rendering is fully handled above; skip the analysis-mode block below
    }

    lastAnalysis = {
      competitorCount: competitors.length,
      competitorBreakdown,
      categoryCount: selected.length,
      selectedCategories: selected.slice(),
      diversityIndex: computeDiversityIndex(categoryCounts),
      districtPopulation: demo.population || 0,
      districtIncome: demo.medianIncome || 0,
      demographicsNotes: demo.notes || [],
      catchmentAreaKm2: catchment.areaKm2,
      catchmentIsReal: catchment.isReal,
      districtLabel: town.district,
      categoryLabel: selected.map(labelFor).join(' + '),
      competitorRatingSample,
      anchorCount: anchorList.length,
      trends,
      // False when the Worker's Overpass call failed entirely (see poisError in the Worker).
      // "0 competitors" and "we couldn't check" must never look the same on screen — the first
      // is a real, useful finding; the second is a data outage that would otherwise read as a
      // suspiciously perfect opportunity score.
      poisAvailable,
    };

    const countEl = document.getElementById('mr-competitor-count');
    const breakdownEl = document.getElementById('mr-competitor-breakdown');
    if (lastAnalysis.poisAvailable) {
      const meta = data.meta || {};
      const sourceParts = [catchment.isReal ? PROVENANCE.isochroneReal : PROVENANCE.isochroneFallback];
      if (meta.poiSource) sourceParts.push('OSM via ' + meta.poiSource);
      if (meta.workerVersion) sourceParts.push('Worker v' + meta.workerVersion);
      countEl.innerHTML = `${lastAnalysis.competitorCount}${provenanceHTML(sourceParts.join(' · '))}`;
      breakdownEl.textContent = selected.length > 1 ? competitorBreakdown.map((b) => `${b.count} ${b.label}`).join(' · ') : '';
      document.getElementById('mr-diversity-value').textContent = Math.round(lastAnalysis.diversityIndex * 100) + '% mixed';
    } else {
      countEl.innerHTML = `Unavailable${provenanceHTML('Overpass error — see status message below')}`;
      breakdownEl.textContent = '';
      document.getElementById('mr-diversity-value').innerHTML = `Unavailable${provenanceHTML('Overpass error — see status message below')}`;
    }
    // When a DOSM figure is missing, the Worker says exactly why (HTTP status, empty result, rate limit) — show it.
    const demoNote = (prefix) => lastAnalysis.demographicsNotes.filter((n) => n.indexOf(prefix) === 0).join('; ');
    // v1.5.1: the note now shows even when a number IS present, not just on "Not available" — needed
    // because a non-zero population can now come from the Worker's pinned fallback table (see
    // DISTRICT_POPULATION_FALLBACK_2023 in market-radar-proxy-worker.js) rather than a live query, and
    // that's exactly the kind of thing this page's own provenance-tag principle says should be shown,
    // not silently hidden behind a plain-looking number.
    document.getElementById('mr-population-value').innerHTML = lastAnalysis.districtPopulation
      ? escapeHTML(lastAnalysis.districtPopulation.toLocaleString()) + (demoNote('Population') ? provenanceHTML(demoNote('Population')) : '')
      : 'Not available' + (demoNote('Population') ? provenanceHTML(demoNote('Population')) : '');
    document.getElementById('mr-income-value').innerHTML = lastAnalysis.districtIncome
      ? escapeHTML('RM' + Math.round(lastAnalysis.districtIncome).toLocaleString() + '/mo')
      : 'Not available' + (demoNote('Income') ? provenanceHTML(demoNote('Income')) : '');

    renderStrengthCard();

    const anchorCounts = {};
    anchorList.forEach((a) => { anchorCounts[a.anchorType] = (anchorCounts[a.anchorType] || 0) + 1; });
    const anchorSummary = Object.entries(anchorCounts).map(([k, n]) => `${n} ${(ANCHOR_TAGS[k] || {}).label || k}`).join(', ');
    document.getElementById('mr-anchor-value').textContent = anchorList.length ? anchorList.length : 'None found';
    document.getElementById('mr-anchor-provenance').textContent = anchorList.length ? ('Official — OSM: ' + anchorSummary) : 'Official — OSM (none of the tracked types found nearby)';

    renderTrendCard(trends, selected, labelFor, town);

    document.getElementById('mr-result-cards').hidden = false;
    document.getElementById('mr-field-note-panel').hidden = false;
    document.getElementById('mr-vacancy-panel').hidden = false;
    document.getElementById('mr-weights-panel').hidden = false;
    updateWeightTotalDisplay();
    renderScore();

    document.getElementById('mr-ai-insight').textContent = 'Click "Get a plain-English read" below for a summary of what these numbers suggest.';
    document.getElementById('mr-ai-insight').classList.add('is-empty');

    if (data.poisError) {
      setStatus(data.poisError, true);
    } else {
      const n = lastAnalysis.competitorCount;
      setStatus(selected.length > 1
        ? `Found ${n} competitor${n === 1 ? '' : 's'} across ${selected.length} business types (${competitorBreakdown.map((b) => `${b.count} ${b.label}`).join(', ')}) in this catchment.`
        : `Found ${n} matching ${lastAnalysis.categoryLabel} competitor${n === 1 ? '' : 's'} in this catchment.`);
    }

    // Broadcasts if costing-sync.js is loaded and a listener exists — Interactive Costing Analysis and
    // Margin Analysis don't read a 'market-radar' source yet (see the KIV list), so this currently
    // reaches no one, but the shape is ready. `category` stays a single joined string for that reason.
    // Market Gap mode doesn't broadcast (see the early return above) — there's no single opportunity
    // score or category to send in this same shape; revisit if a receiving side is ever built for it.
    if (typeof rzBroadcast === 'function') {
      rzBroadcast({ source: 'market-radar', category: lastAnalysis.categoryLabel, categories: selected.slice(), district: lastAnalysis.districtLabel, competitorCount: lastAnalysis.competitorCount, opportunityScore: computeOpportunityScore(scoreInputs(), currentWeights()).total });
    }
  } catch (err) {
    setStatus(err.message || 'Something went wrong. Try again.', true);
  } finally {
    stopProgress();
    btn.disabled = false;
  }
}
function provenanceHTML(text) { return `<span class="mr-provenance">${escapeHTML(text)}</span>`; }

// Renders the Market Gap checklist table from lastAnalysis.gapRows (see computeGapReads()).
// catchment/data are passed in rather than re-read from lastAnalysis since the provenance line
// needs catchment.isReal and data.meta, which aren't part of the gap-mode lastAnalysis shape.
function renderGapResults(catchment, data) {
  const rows = lastAnalysis.gapRows;
  const body = document.getElementById('mr-gap-table-body');
  if (!lastAnalysis.poisAvailable) {
    body.innerHTML = '<tr><td colspan="4">Unavailable — see the status message below.</td></tr>';
  } else {
    const READ_LABELS = { gap: 'Gap', thin: 'Thin', adequate: 'Adequate', oversupplied: 'Oversupplied' };
    body.innerHTML = rows.map((r) => {
      const reach = r.perShop ? '≈' + r.perShop.toLocaleString() + ' people/shop' : '—';
      return `<tr><td>${escapeHTML(r.label)}</td><td>${r.count}</td><td>${reach}</td>`
        + `<td><span class="mr-gap-read is-${r.read}">${READ_LABELS[r.read]}</span></td></tr>`;
    }).join('');
  }
  const meta = data.meta || {};
  const sourceParts = [catchment.isReal ? PROVENANCE.isochroneReal : PROVENANCE.isochroneFallback];
  if (meta.poiSource) sourceParts.push('OSM via ' + meta.poiSource);
  if (meta.workerVersion) sourceParts.push('Worker v' + meta.workerVersion);
  document.getElementById('mr-gap-provenance').textContent = 'Estimated — ' + sourceParts.join(' · ')
    + (lastAnalysis.districtPopulation ? ' · "people/shop" uses this district\u2019s DOSM population figure' : '');
  document.getElementById('mr-gap-results').hidden = false;
}

/* ================= PLAIN-ENGLISH READ (narration only — Gemini first, Workers AI backstop on the Worker side) ================= */

async function getInsight() {
  if (!lastAnalysis) return;
  const box = document.getElementById('mr-ai-insight');
  box.textContent = 'Writing a plain-English read…';
  box.classList.remove('is-empty');
  try {
    let data;
    if (currentMode === 'gap') {
      // ADDED 2026-09-24 — a distinct snapshot shape (kind:'gap') rather than forcing the checklist
      // into the single-category shape below; see gapInsightPrompt() in
      // market-radar-proxy-worker.js for the matching narration prompt. Same hard rules apply:
      // narrate only, never invent a number, never tell the person to open or not open something.
      data = await fetchAnalysis({
        mode: 'insight',
        snapshot: {
          kind: 'gap',
          town: TOWNS[wizardAnswers.town].label,
          rows: lastAnalysis.gapRows.map((r) => ({ label: r.label, count: r.count, read: r.read })),
          districtPopulation: lastAnalysis.districtPopulation,
          catchmentIsReal: lastAnalysis.catchmentIsReal,
        },
      });
    } else {
      const score = computeOpportunityScore(scoreInputs(), currentWeights());
      data = await fetchAnalysis({
        mode: 'insight',
        snapshot: {
          town: TOWNS[wizardAnswers.town].label,
          category: lastAnalysis.categoryLabel,
          competitorCount: lastAnalysis.competitorCount,
          breakdown: lastAnalysis.competitorBreakdown.map((b) => ({ label: b.label, count: b.count })),
          diversityIndex: lastAnalysis.diversityIndex,
          districtPopulation: lastAnalysis.districtPopulation,
          districtIncome: lastAnalysis.districtIncome,
          opportunityScore: Math.round(score.total * 100),
          catchmentIsReal: lastAnalysis.catchmentIsReal,
          observedBusyness: getObservedBusyness(),
        },
      });
    }
    box.textContent = (data.text || 'No usable text came back that time — the numbers above are unaffected.')
      + (data.text && data.via && data.via !== 'Gemini' ? ' (Written by ' + data.via + ' — Gemini was unavailable.)' : '');
    box.classList.remove('is-empty');
  } catch (err) {
    box.textContent = 'Couldn’t get a written read right now (' + (err.message || 'unknown error') + '). The numbers above are unaffected.';
    box.classList.add('is-empty');
  }
}

/* ================= INIT ================= */

let rzInitialized = false;

function init() {
  if (rzInitialized) return;
  rzInitialized = true;

  renderCategoryOptions();

  // The six weight boxes are filled from SCORE_WEIGHTS_DEFAULT (the HTML value= attributes are only a fallback),
  // so the constant documented in the settings sheet is the one place to change a starting weight.
  Object.keys(SCORE_WEIGHTS_DEFAULT).forEach((key) => { if (document.getElementById('mr-weight-' + key)) setWeightInput(key, SCORE_WEIGHTS_DEFAULT[key]); });

  const catchmentSelect = document.getElementById('mr-catchment-select');
  catchmentSelect.innerHTML = Object.entries(CATCHMENT_MODES).map(([value, m]) => `<option value="${value}">${escapeHTML(m.label)}</option>`).join('');

  // ADDED 2026-09-24: the page now opens on mode-select (see market-radar.html), not the wizard —
  // chooseMode() below renders the wizard's first step itself once a mode is actually picked, so
  // there's nothing to pre-render here.
  document.getElementById('mr-mode-analysis-btn').addEventListener('click', () => chooseMode('analysis'));
  document.getElementById('mr-mode-gap-btn').addEventListener('click', () => chooseMode('gap'));
  document.getElementById('wizard-back').addEventListener('click', goBack);
  document.getElementById('mr-edit-answers').addEventListener('click', editAnswers);
  document.getElementById('mr-save-pdf').addEventListener('click', () => window.print());
  document.getElementById('mr-analyze-btn').addEventListener('click', analyzeSpot);
  document.getElementById('mr-get-insight').addEventListener('click', getInsight);
  document.getElementById('mr-gap-custom-add').addEventListener('click', addGapCustomItem);

  ['lowCompetition', 'population', 'income', 'diversity', 'momentum', 'competitorStrength'].forEach((key) => {
    document.getElementById('mr-weight-' + key).addEventListener('input', onWeightEditedByHand);
  });

  const observedEl = document.getElementById('mr-observed-busyness');
  if (observedEl) observedEl.addEventListener('change', onObservedChange);

  document.getElementById('mr-vacancy-add').addEventListener('click', () => {
    const detailEl = document.getElementById('mr-vacancy-detail');
    const detail = detailEl.value.trim();
    if (!detail) { detailEl.focus(); return; }
    vacantUnits.push({ floor: document.getElementById('mr-vacancy-floor').value, detail });
    detailEl.value = '';
    renderVacancyList();
  });

  document.getElementById('mr-heat-toggle').addEventListener('change', (e) => {
    if (!heatLayer) return;
    if (e.target.checked) { heatLayer.addTo(map); } else { map.removeLayer(heatLayer); }
  });
}

document.addEventListener('DOMContentLoaded', init);
