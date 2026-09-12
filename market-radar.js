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
   ============================================================ */

console.info('[Market Radar] script build: 2026-09-12-v1');

/* ================= CONFIG =================
   Everything below is meant to be changed. See the Settings
   reference table in MARKET_RADAR_SETUP_AND_GLOSSARY.md for what
   each one does and where its starting number came from. */

// Town presets — lat/lng are approximate town centres, just a
// starting pin; click anywhere on the map to move it before
// analyzing. "district" must match how DOSM names it in the
// population_district / hh_income_district datasets — see the
// Worker's DISTRICT_ALIASES table if a lookup ever comes back empty.
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
const CATEGORY_TAGS = {
  cafe: { label: 'Cafe / kopitiam', tags: [['amenity', 'cafe']] },
  restaurant: { label: 'Restaurant', tags: [['amenity', 'restaurant']] },
  fastfood: { label: 'Fast food / food stall', tags: [['amenity', 'fast_food']] },
  bakery: { label: 'Bakery / dessert', tags: [['shop', 'bakery'], ['shop', 'pastry'], ['shop', 'confectionery']] },
  drinks: { label: 'Drink stall / bubble tea', tags: [['shop', 'beverages'], ['shop', 'tea'], ['shop', 'coffee']] },
  minimart: { label: 'Convenience / minimart', tags: [['shop', 'convenience'], ['shop', 'supermarket']] },
  fashion: { label: 'Fashion / apparel', tags: [['shop', 'clothes'], ['shop', 'shoes']] },
  hardware: { label: 'Hardware', tags: [['shop', 'hardware'], ['shop', 'doityourself']] },
  laundry: { label: 'Laundry', tags: [['shop', 'laundry']] },
  salon: { label: 'Salon / barber', tags: [['shop', 'hairdresser'], ['shop', 'beauty']] },
  printing: { label: 'Printing / copy shop', tags: [['shop', 'copyshop'], ['shop', 'printing']] },
  custom: { label: 'Custom \u2014 type your own OSM tag', tags: [] },
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
const CATCHMENT_MODES = {
  walk10: { label: '10-minute walk', profile: 'foot-walking', seconds: 600, fallbackRadiusM: 800 },
  walk15: { label: '15-minute walk', profile: 'foot-walking', seconds: 900, fallbackRadiusM: 1200 },
  drive10: { label: '10-minute drive', profile: 'driving-car', seconds: 600, fallbackRadiusM: 5000 },
  drive15: { label: '15-minute drive', profile: 'driving-car', seconds: 900, fallbackRadiusM: 8000 },
};

// Opportunity score: a plain weighted sum of five 0-1 sub-scores,
// nothing hidden or statistical about it. These five numbers are
// editable live on the page itself (#mr-weight-*) — these are only
// the starting values shown there. See computeOpportunityScore() for
// the actual formula behind each sub-score.
const SCORE_WEIGHTS_DEFAULT = { lowCompetition: 0.35, population: 0.25, income: 0.15, diversity: 0.15, momentum: 0.10 };

// How many competitors inside the catchment counts as "fully
// saturated" for whichever category is selected — a café-dense town
// centre and a hardware-store count don't saturate at the same
// number, so this is one visible, adjustable number rather than a
// per-category guess this file would otherwise have to invent.
const SATURATION_COUNT = 12;

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
  population: 'Official \u2014 DOSM (district-level)',
  income: 'Official \u2014 DOSM (district-level)',
  competitor: 'Estimated \u2014 OpenStreetMap',
  isochroneReal: 'Estimated \u2014 OpenRouteService travel-time shape',
  isochroneFallback: 'Estimated \u2014 radius fallback, not a real travel-time shape',
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
  document.getElementById('wizard-back').hidden = wizardStepIndex === 0;
}
function goBack() { if (wizardStepIndex > 0) { wizardStepIndex--; renderWizardStep(); } }

function finishWizard() {
  document.getElementById('wizard').hidden = true;
  document.getElementById('mr-analysis').hidden = false;
  const town = TOWNS[wizardAnswers.town];
  document.getElementById('mr-town-label').textContent = town.label;
  document.getElementById('mr-catchment-select').value = wizardAnswers.catchment;
  initMap(town);
}
function editAnswers() {
  document.getElementById('mr-analysis').hidden = true;
  document.getElementById('wizard').hidden = false;
  wizardStepIndex = 0;
  renderWizardStep();
}

/* ================= MAP ================= */

let map, pinMarker, catchmentLayer, heatLayer;
let poiMarkers = [];

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
// Shoelace-formula polygon area, converted from degrees to km\u00b2
// using a flat-earth approximation local to one small area \u2014
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
// 0-1 no matter how extreme the inputs get \u2014 a spot with zero
// competitors gets a full 1.0 on that one component, not an infinite
// score, the same "clamp, don't crash" instinct as everywhere else
// on this site.
function computeOpportunityScore(inputs, weights) {
  const lowCompetition = clamp01(1 - inputs.competitorCount / SATURATION_COUNT);
  const population = clamp01(inputs.districtPopulation / POPULATION_NORMALIZER);
  const income = clamp01(inputs.districtIncome / INCOME_NORMALIZER);
  const diversity = clamp01(inputs.diversityIndex);
  const momentum = 0.5; // neutral placeholder \u2014 see the KIV note at the top of this file

  const weightSum = weights.lowCompetition + weights.population + weights.income + weights.diversity + weights.momentum || 1;
  const total = (weights.lowCompetition * lowCompetition + weights.population * population
    + weights.income * income + weights.diversity * diversity + weights.momentum * momentum) / weightSum;
  // Dividing by weightSum means an off-target total (weights not
  // summing to exactly 1.00) still produces a sane 0-1 score instead
  // of silently over- or under-counting \u2014 the on-page warning
  // when weights don't sum to 1.00 is about transparency, not about
  // preventing a broken calculation.
  return { total: clamp01(total), parts: { lowCompetition, population, income, diversity, momentum } };
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
  return 'Crowded \u2014 hard to stand out here';
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
    throw new Error('Could not reach the analysis service \u2014 check WORKER_ENDPOINT is correct and this page\u2019s URL is in the Worker\u2019s ALLOWED_ORIGINS.');
  }
  let data;
  try { data = await response.json(); }
  catch (e) { throw new Error('Got an unreadable response from the analysis service. Try again.'); }
  if (!response.ok) throw new Error(data.error || ('Analysis failed (error ' + response.status + '). Try again.'));
  return data;
}

/* ================= ANALYZE FLOW ================= */

let lastAnalysis = null; // holds everything recomputeScore() and requestInsight() need without re-fetching

function currentWeights() {
  return {
    lowCompetition: parseFloat(document.getElementById('mr-weight-lowCompetition').value) || 0,
    population: parseFloat(document.getElementById('mr-weight-population').value) || 0,
    income: parseFloat(document.getElementById('mr-weight-income').value) || 0,
    diversity: parseFloat(document.getElementById('mr-weight-diversity').value) || 0,
    momentum: parseFloat(document.getElementById('mr-weight-momentum').value) || 0,
  };
}

function updateWeightTotalDisplay() {
  const w = currentWeights();
  const sum = w.lowCompetition + w.population + w.income + w.diversity + w.momentum;
  const el = document.getElementById('mr-weight-total');
  el.textContent = sum.toFixed(2);
  el.classList.toggle('is-off', Math.abs(sum - 1) > 0.01);
}

function renderScore() {
  if (!lastAnalysis) return;
  const result = computeOpportunityScore(lastAnalysis, currentWeights());
  document.getElementById('mr-score-banner').hidden = false;
  document.getElementById('mr-score-number').textContent = Math.round(result.total * 100);
  document.getElementById('mr-score-verdict').textContent = lastAnalysis.poisAvailable
    ? scoreVerdict(result.total)
    : scoreVerdict(result.total) + ' \u2014 based on partial data, competitor count unavailable';
}

async function analyzeSpot() {
  const town = TOWNS[wizardAnswers.town];
  const catchmentModeKey = document.getElementById('mr-catchment-select').value;
  const catchmentMode = CATCHMENT_MODES[catchmentModeKey];
  const categoryKey = document.getElementById('mr-category-select').value;
  const pin = pinMarker.getLatLng();

  let categoriesForRequest = CATEGORY_TAGS;
  if (categoryKey === 'custom') {
    const key = document.getElementById('mr-custom-key').value.trim();
    const value = document.getElementById('mr-custom-value').value.trim();
    if (!key || !value) { setStatus('Type both an OSM key and value for a custom category first.', true); return; }
    categoriesForRequest = { custom: { label: `${key}=${value}`, tags: [[key, value]] } };
  }
  if (!WORKER_ENDPOINT || WORKER_ENDPOINT.indexOf('PASTE_YOUR') === 0) {
    setStatus('This tool needs its proxy URL set \u2014 see WORKER_ENDPOINT near the top of market-radar.js.', true);
    return;
  }
  if (getUsageToday() + 1 > MAX_ANALYSES_PER_DAY) {
    setStatus('This browser has hit today\u2019s analysis limit. Try again tomorrow.', true);
    return;
  }

  const btn = document.getElementById('mr-analyze-btn');
  btn.disabled = true;
  setStatus('Fetching competitors, catchment shape, and district data\u2026');
  clearResultLayers();

  try {
    const data = await fetchAnalysis({
      lat: pin.lat, lng: pin.lng,
      radiusM: Math.round(catchmentMode.fallbackRadiusM * 1.3),
      categories: categoriesForRequest,
      selectedCategory: categoryKey,
      isochrone: { profile: catchmentMode.profile, seconds: catchmentMode.seconds },
      district: town.district,
    });
    recordUsage();

    const catchment = drawCatchment(data.isochrone, pin.lat, pin.lng, catchmentModeKey);

    const withinCatchment = (data.pois || []).filter((p) => catchment.containsPoint(p.lat, p.lng));
    const competitors = withinCatchment.filter((p) => p.category === categoryKey || categoryKey === 'custom');
    const categoryCounts = {};
    withinCatchment.forEach((p) => { categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1; });

    poiMarkers = competitors.map((p) => L.circleMarker([p.lat, p.lng], { radius: 6, color: '#C0392B', fillColor: '#C0392B', fillOpacity: 0.7, weight: 1 }).bindTooltip(escapeHTML(p.name || 'Unnamed')).addTo(map));
    if (competitors.length > 0 && typeof L.heatLayer === 'function') {
      heatLayer = L.heatLayer(competitors.map((p) => [p.lat, p.lng, 0.6]), { radius: 30, blur: 20 }).addTo(map);
    }
    if (catchment.layer) map.fitBounds(catchment.layer.getBounds(), { padding: [20, 20] });

    lastAnalysis = {
      competitorCount: competitors.length,
      diversityIndex: computeDiversityIndex(categoryCounts),
      districtPopulation: data.demographics ? data.demographics.population : 0,
      districtIncome: data.demographics ? data.demographics.medianIncome : 0,
      catchmentAreaKm2: catchment.areaKm2,
      catchmentIsReal: catchment.isReal,
      districtLabel: town.district,
      categoryLabel: categoryKey === 'custom' ? categoriesForRequest.custom.label : CATEGORY_TAGS[categoryKey].label,
      // False when the Worker's Overpass call failed entirely (see
      // market-radar-proxy-worker.js's poisError). "0 competitors"
      // and "we couldn't check" must never look the same on screen —
      // the first is a real, useful finding; the second is a data
      // outage that would otherwise read as a suspiciously perfect
      // opportunity score.
      poisAvailable: !data.poisError,
    };

    if (lastAnalysis.poisAvailable) {
      document.getElementById('mr-competitor-count').innerHTML = `${lastAnalysis.competitorCount}${provenanceHTML(catchment.isReal ? PROVENANCE.isochroneReal : PROVENANCE.isochroneFallback)}`;
      document.getElementById('mr-diversity-value').textContent = Math.round(lastAnalysis.diversityIndex * 100) + '% mixed';
    } else {
      document.getElementById('mr-competitor-count').innerHTML = `Unavailable${provenanceHTML('Overpass error \u2014 see status message below')}`;
      document.getElementById('mr-diversity-value').innerHTML = `Unavailable${provenanceHTML('Overpass error \u2014 see status message below')}`;
    }
    document.getElementById('mr-population-value').textContent = lastAnalysis.districtPopulation ? lastAnalysis.districtPopulation.toLocaleString() : 'Not available';
    document.getElementById('mr-income-value').textContent = lastAnalysis.districtIncome ? ('RM' + Math.round(lastAnalysis.districtIncome).toLocaleString() + '/mo') : 'Not available';
    document.getElementById('mr-result-cards').hidden = false;
    document.getElementById('mr-weights-panel').hidden = false;
    updateWeightTotalDisplay();
    renderScore();

    document.getElementById('mr-ai-insight').textContent = 'Click "Get a plain-English read" below for a summary of what these numbers suggest.';
    document.getElementById('mr-ai-insight').classList.add('is-empty');

    if (data.poisError) {
      setStatus(data.poisError, true);
    } else {
      setStatus(`Found ${lastAnalysis.competitorCount} matching ${lastAnalysis.categoryLabel} competitor${lastAnalysis.competitorCount === 1 ? '' : 's'} in this catchment.`);
    }

    // Broadcasts if costing-sync.js is loaded and a listener exists —
    // see this file's own KIV note: Interactive Costing Analysis and
    // Margin Analysis don't read a 'market-radar' source yet, so this
    // currently reaches no one, but the shape is ready the moment
    // that small receiving-side edit is made.
    if (typeof rzBroadcast === 'function') {
      rzBroadcast({ source: 'market-radar', category: lastAnalysis.categoryLabel, district: lastAnalysis.districtLabel, competitorCount: lastAnalysis.competitorCount, opportunityScore: computeOpportunityScore(lastAnalysis, currentWeights()).total });
    }
  } catch (err) {
    setStatus(err.message || 'Something went wrong. Try again.', true);
  } finally {
    btn.disabled = false;
  }
}
function provenanceHTML(text) { return `<span class="mr-provenance">${escapeHTML(text)}</span>`; }

/* ================= GEMINI INSIGHT (narration only \u2014 see this file's own header) ================= */

async function getInsight() {
  if (!lastAnalysis) return;
  const box = document.getElementById('mr-ai-insight');
  box.textContent = 'Asking Gemini for a plain-English read\u2026';
  box.classList.remove('is-empty');
  try {
    const score = computeOpportunityScore(lastAnalysis, currentWeights());
    const data = await fetchAnalysis({
      mode: 'insight',
      snapshot: {
        town: TOWNS[wizardAnswers.town].label,
        category: lastAnalysis.categoryLabel,
        competitorCount: lastAnalysis.competitorCount,
        diversityIndex: lastAnalysis.diversityIndex,
        districtPopulation: lastAnalysis.districtPopulation,
        districtIncome: lastAnalysis.districtIncome,
        opportunityScore: Math.round(score.total * 100),
        catchmentIsReal: lastAnalysis.catchmentIsReal,
      },
    });
    box.textContent = data.text || 'Gemini didn\u2019t return anything usable that time \u2014 the numbers above are unaffected.';
    box.classList.remove('is-empty');
  } catch (err) {
    box.textContent = 'Couldn\u2019t reach Gemini right now (' + (err.message || 'unknown error') + '). The numbers above are unaffected.';
    box.classList.add('is-empty');
  }
}

/* ================= INIT ================= */

let rzInitialized = false;

function init() {
  if (rzInitialized) return;
  rzInitialized = true;

  const categorySelect = document.getElementById('mr-category-select');
  categorySelect.innerHTML = Object.entries(CATEGORY_TAGS).map(([value, c]) => `<option value="${value}">${escapeHTML(c.label)}</option>`).join('');
  categorySelect.addEventListener('change', () => {
    document.getElementById('mr-custom-tag-row').classList.toggle('is-visible', categorySelect.value === 'custom');
  });

  const catchmentSelect = document.getElementById('mr-catchment-select');
  catchmentSelect.innerHTML = Object.entries(CATCHMENT_MODES).map(([value, m]) => `<option value="${value}">${escapeHTML(m.label)}</option>`).join('');

  renderWizardStep();
  document.getElementById('wizard-back').addEventListener('click', goBack);
  document.getElementById('mr-edit-answers').addEventListener('click', editAnswers);
  document.getElementById('mr-save-pdf').addEventListener('click', () => window.print());
  document.getElementById('mr-analyze-btn').addEventListener('click', analyzeSpot);
  document.getElementById('mr-get-insight').addEventListener('click', getInsight);

  ['lowCompetition', 'population', 'income', 'diversity', 'momentum'].forEach((key) => {
    document.getElementById('mr-weight-' + key).addEventListener('input', () => { updateWeightTotalDisplay(); renderScore(); });
  });
}

document.addEventListener('DOMContentLoaded', init);
