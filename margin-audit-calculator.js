/* ============================================================
   Margin Audit
   Vanilla JS, no dependencies, nothing saved anywhere except a
   file the vendor explicitly downloads themselves (see EXPORT /
   IMPORT section — that file never touches our server).
   ------------------------------------------------------------
   PURPOSE: reverse the direction of Interactive Costing Analysis.
   That tool asks "what SHOULD I charge?" This one asks "given
   what I DO charge, what's actually happening?" — a vendor enters
   their current menu prices, and everything else (cost estimate,
   utility cost, whether the margin is healthy) is worked out for
   them, with AI doing the estimation, never the arithmetic.

   HARD RULE, same discipline as every other calculator on this
   site: Gemini (via the Cloudflare Worker) only ever does two
   things — turn unstructured input (a photo, a loose description)
   into a structured cost estimate, and turn already-computed
   numbers into a plain-language sentence. It never calculates a
   margin, a ratio, or a break-even. All of that is deterministic
   JS below, same as the EPF/SOCSO tables in
   overhead-manpower-calculator.js — auditable, never guessed.

   DATA MODEL: one or more "dishes" (same repeatable-block pattern
   as food-worth-calculator.js's dish panels / menu-calculator.js's
   .menu-block — createDishPanel(), scope every lookup to that
   instance via panel.querySelector(), never a page-wide id). Each
   dish has a cost SOURCE: sync (pulled live from Menu Calculator —
   see the note on costingSync below), ai (Gemini estimates from a
   description and/or photo), or manual (vendor just types a
   number). All three ultimately resolve to one number per dish;
   everything downstream (true margin, structure %, quadrant) reads
   that number the same way regardless of where it came from.

   SYNC LIMITATION, inherited and worth stating plainly: Menu
   Calculator currently only broadcasts its FIRST menu block (see
   the comment in menu-calculator.js's updateMenuBlockSummary — Cost
   Analysis has the same limitation). So "Sync" here reflects
   whichever ONE dish is currently broadcasting, not a whole menu.
   If more than one dish is set to Sync, they'll all show that same
   single value — not wrong, just a visible reminder of a real
   limitation rather than a silent one. Fixing this for real is the
   same multi-menu protocol redesign already KIV'd in
   ROADMAP_SONNET5MAX.md, not something to solve from this file.
   ============================================================ */

console.info('[Margin Audit] script build: 2026-09-02-v1');

/* ================= CONFIG =================
   Everything a layperson might reasonably need to change lives
   here, with the current value on the left and nothing else in
   this file needing to change to update it — same spirit as the
   settings reference table in FOOD_WORTH_CHANGE_NOTES.md. */

const PROXY_ENDPOINT = 'PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE';

// Popularity/CM quadrant thresholds and the four venue-type guide
// ratios are copied from interactive-costing-analysis.js rather than
// shared at runtime, matching this site's one-file-per-page,
// no-build-step approach — each page stays independently hostable.
const GUIDE_RATIOS = {
  home:  { ingredients: 55, overhead: 15, manpower: 15, margin: 15 },
  stall: { ingredients: 50, overhead: 20, manpower: 15, margin: 15 },
  truck: { ingredients: 42, overhead: 20, manpower: 23, margin: 15 },
  store: { ingredients: 35, overhead: 20, manpower: 30, margin: 15 },
};

// Reasonable starting wattages for common F&B equipment — NOT a
// hard fact, a starting point the vendor edits per row. General
// appliance-engineering ballparks, not sourced to a specific meter.
const ELECTRICITY_DEFAULTS = [
  { name: 'Rice cooker', watts: 800, hours: 3 },
  { name: 'Exhaust fan', watts: 200, hours: 8 },
  { name: 'Fridge', watts: 250, hours: 24 },
  { name: 'Lighting', watts: 100, hours: 10 },
];
// Sarawak Energy states this as its current average across all
// account types; the real commercial (C1) schedule is tiered, so
// treat this as a starting rate to confirm against Sarawak Energy's
// live tariff page, same spirit as the EPF/SOCSO tables being
// sourced from the real gov schedule rather than approximated.
const ELECTRICITY_RATE_DEFAULT = 0.28; // RM/kWh

// Sarawak's water utilities (Kuching/Sibu/LAKU) classify restaurants,
// coffee-shops, and similar premises under a specific "W3 Commercial
// Rate" category. Figures below are LAKU's current published Miri/
// Limbang schedule — worth re-checking if serving a different area,
// since the three utilities have historically shared one structure
// but that's not guaranteed to stay true forever.
const WATER_TARIFF = { minimum: 22.00, tier1Limit: 25000, tier1Rate: 0.97, tier2Rate: 1.06 }; // RM, liters, RM/1000L

// Gas: Malaysia moved F&B businesses toward commercial-grade (purple)
// cylinders in 2025, at roughly triple the household price — though
// later guidance kept the subsidised rate available to micro/small
// F&B traders up to 42kg (three 14kg cylinders) at a time without a
// permit. This is a genuinely live, still-settling policy area —
// treat the toggle below as the honest way to handle that, not a
// bug. Re-verify both prices and the threshold periodically.
const GAS_CYLINDER_KG = 14;
const GAS_SUBSIDISED_THRESHOLD_KG = 42;
const GAS_PRICE_HOUSEHOLD_DEFAULT = 26.60;
const GAS_PRICE_COMMERCIAL_DEFAULT = 70.00;

/* ================= SHARED UTILITIES ================= */

function formatRM(value) {
  if (!isFinite(value)) return 'RM0.00';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.01) return sign + '< RM0.01';
  return sign + 'RM' + abs.toFixed(2);
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function num(el, fallback) {
  if (!el) return fallback !== undefined ? fallback : 0;
  const v = parseFloat(el.value);
  return isFinite(v) ? v : (fallback !== undefined ? fallback : 0);
}

function numOrZero(v) {
  return isFinite(v) ? v : 0;
}

/* ================= WIZARD (same 3-step pattern as
   interactive-costing-analysis.js, reused verbatim for
   consistency — cuisine is captured later, near where it's
   actually used, rather than as a fourth wizard step) ================= */

const WIZARD_STEPS = [
  {
    key: 'venue',
    question: 'Where do you operate?',
    options: [
      { value: 'home', label: 'Home-based' },
      { value: 'stall', label: 'Stall / hawker' },
      { value: 'truck', label: 'Food truck' },
      { value: 'store', label: 'Store / restaurant' },
    ],
  },
  {
    key: 'manpower',
    question: "What's your manpower situation?",
    options: [
      { value: 'solo', label: 'Just me' },
      { value: 'staff', label: 'Me plus staff' },
    ],
  },
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
      ${step.options.map((o) => `<button type="button" class="wizard-option" data-value="${o.value}">${o.label}</button>`).join('')}
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

function goBack() {
  if (wizardStepIndex > 0) { wizardStepIndex--; renderWizardStep(); }
}

function finishWizard() {
  document.getElementById('wizard').hidden = true;
  document.getElementById('ma-analysis').hidden = false;
  document.querySelector('#ma-manpower-label .label-text').textContent = wizardAnswers.manpower === 'solo'
    ? "Manpower (include your own wage, even if it's just you)"
    : 'Manpower';
  if (!document.querySelector('.ma-dish-panel')) createDishPanel();
  recalculateAll();
}

function editAnswers() {
  document.getElementById('ma-analysis').hidden = true;
  document.getElementById('wizard').hidden = false;
  wizardStepIndex = 0;
  renderWizardStep();
}

/* ================= DISH PANELS ================= */

const dishAiCost = new WeakMap();   // panel -> {low, high} from Gemini
const dishAiImage = new WeakMap();  // panel -> base64 (for the estimate request only, never stored)
let lastSyncedPayload = null;       // shared single-slot sync value — see file-header note on the sync limitation
let dishIdCounter = 0;

function createDishPanel() {
  dishIdCounter++;
  const id = 'ma-dish-' + dishIdCounter;
  const panel = document.createElement('div');
  panel.className = 'ma-dish-panel menu-block';
  panel.dataset.dishId = id;
  panel.innerHTML = `
    <div class="menu-block-header">
      <input type="text" class="menu-name-input ma-dish-name" value="Dish ${dishIdCounter}" aria-label="Dish name">
      <button type="button" class="remove-block-btn ma-remove-dish no-print" aria-label="Remove this item">Remove item</button>
    </div>
    <div class="ma-dish-grid">
      <label>Item name <input type="text" class="ma-dish-name-mirror" placeholder="e.g. Nasi Lemak Ayam"></label>
      <label>Current price (RM) <input type="number" class="ma-dish-price" inputmode="decimal" min="0" step="0.01" value="0.00"></label>
      <label>Sold / day <input type="number" class="ma-dish-volume" inputmode="decimal" min="0" step="1" value="0"></label>
    </div>

    <div class="ma-source-tabs" role="tablist">
      <button type="button" class="ma-source-tab is-active" data-source="sync">Sync from Menu Calculator</button>
      <button type="button" class="ma-source-tab" data-source="ai">AI estimate</button>
      <button type="button" class="ma-source-tab" data-source="manual">I'll enter it myself</button>
    </div>

    <div class="ma-source-panel ma-source-sync" data-source-panel="sync">
      <p class="ma-sync-status ma-sync-cost-status">No Menu Calculator data received yet — open it in another tab and cost a dish there, or pick a different source.</p>
    </div>

    <div class="ma-source-panel ma-source-ai" data-source-panel="ai" hidden>
      <div class="ma-ai-row">
        <textarea class="ma-ai-desc" placeholder="Describe the dish — main ingredients and rough portions (e.g. 200g rice, fried chicken thigh, sambal, egg, cucumber)"></textarea>
        <label class="btn btn-secondary ma-ai-photo-btn" style="cursor:pointer;">Or snap a photo<input type="file" accept="image/*" class="sr-only ma-ai-photo-input"></label>
      </div>
      <img class="ma-ai-preview" alt="" hidden>
      <div class="calc-actions no-print" style="padding-top:10px;">
        <button type="button" class="btn btn-primary ma-ai-estimate-btn">Estimate cost</button>
      </div>
      <p class="ma-sync-status ma-ai-status"></p>
      <span class="ma-cost-range" hidden></span>
    </div>

    <div class="ma-source-panel ma-source-manual" data-source-panel="manual" hidden>
      <div class="ma-manual-row">
        <label>Ingredient cost (RM) <input type="number" class="ma-manual-cost" inputmode="decimal" min="0" step="0.01" value="0.00"></label>
      </div>
    </div>
  `;
  document.getElementById('ma-dish-panels').appendChild(panel);
  panel.dataset.costSource = 'sync'; // matches the tab marked is-active in the template above

  // Keep the visible header name and the grid's name field mirrored —
  // two inputs, one value, same trick menu-calculator.js doesn't need
  // but food-worth-calculator.js's dish tabs do (see its renderDishTabs).
  const headerName = panel.querySelector('.ma-dish-name');
  const mirrorName = panel.querySelector('.ma-dish-name-mirror');
  headerName.addEventListener('input', () => { mirrorName.value = headerName.value; recalculateAll(); });
  mirrorName.addEventListener('input', () => { headerName.value = mirrorName.value; recalculateAll(); });

  panel.querySelectorAll('.ma-dish-price, .ma-dish-volume, .ma-manual-cost').forEach((el) => {
    el.addEventListener('input', recalculateAll);
  });

  panel.querySelectorAll('.ma-source-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchDishSource(panel, tab.dataset.source));
  });

  panel.querySelector('.ma-ai-photo-input').addEventListener('change', (e) => handleDishPhoto(e, panel));
  panel.querySelector('.ma-ai-estimate-btn').addEventListener('click', () => estimateDishCost(panel));
  panel.querySelector('.ma-remove-dish').addEventListener('click', () => { panel.remove(); recalculateAll(); });

  applySyncedCostIfWaiting(panel);
  return panel;
}

function switchDishSource(panel, source) {
  panel.dataset.costSource = source;
  panel.querySelectorAll('.ma-source-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.source === source));
  panel.querySelectorAll('.ma-source-panel').forEach((p) => { p.hidden = p.dataset.sourcePanel !== source; });
  recalculateAll();
}

/* ---- AI estimate (Gemini via Cloudflare Worker) ----
   Same resize-then-base64 approach as food-worth-calculator.js's
   resizeImageToBase64 — copied rather than imported, since this site
   has no build step and each page stays independently hostable. */
function resizeImageToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error("That file doesn't look like an image.")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't open that image. Try a different file."));
      img.onload = () => {
        const MAX_EDGE = 1024;
        let { width, height } = img;
        if (width > MAX_EDGE || height > MAX_EDGE) {
          const scale = MAX_EDGE / Math.max(width, height);
          width = Math.round(width * scale); height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        resolve({ base64: dataUrl.split(',')[1], previewUrl: dataUrl });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleDishPhoto(e, panel) {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = panel.querySelector('.ma-ai-status');
  statusEl.textContent = 'Preparing photo\u2026';
  try {
    const { base64, previewUrl } = await resizeImageToBase64(file);
    dishAiImage.set(panel, base64);
    const img = panel.querySelector('.ma-ai-preview');
    img.src = previewUrl; img.hidden = false;
    statusEl.textContent = 'Photo ready \u2014 add a short description too if you can, then click Estimate cost.';
  } catch (err) {
    statusEl.textContent = err.message || 'Could not read that photo.';
  }
}

// Request/response contract this expects from the Worker, for
// whenever it's built: POST { type: 'dish_cost_estimate',
// description, image?, mime_type?, venue_context } -> JSON
// { cost_low_myr, cost_high_myr }. A RANGE, deliberately, not one
// confident figure — same honesty food-worth-calculator.js already
// applies to its own price estimate rather than pretending
// precision Gemini doesn't actually have for a single photo/description.
async function estimateDishCost(panel) {
  const statusEl = panel.querySelector('.ma-ai-status');
  const rangeEl = panel.querySelector('.ma-cost-range');
  const description = panel.querySelector('.ma-ai-desc').value.trim();
  const image = dishAiImage.get(panel);

  if (!description && !image) {
    statusEl.textContent = 'Add a short description or a photo first.';
    return;
  }
  if (!PROXY_ENDPOINT || PROXY_ENDPOINT === 'PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE') {
    statusEl.textContent = 'This tool needs its proxy URL set \u2014 see PROXY_ENDPOINT near the top of margin-audit-calculator.js. Use manual entry or sync for now.';
    return;
  }

  const btn = panel.querySelector('.ma-ai-estimate-btn');
  btn.disabled = true;
  statusEl.textContent = 'Estimating\u2026';

  try {
    const response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'dish_cost_estimate',
        description,
        image: image || undefined,
        mime_type: image ? 'image/jpeg' : undefined,
        venue_context: wizardAnswers.venue || 'stall',
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || ('Estimate failed (error ' + response.status + ').'));
    const low = numOrZero(Number(data.cost_low_myr));
    const high = numOrZero(Number(data.cost_high_myr));
    dishAiCost.set(panel, { low, high });
    rangeEl.hidden = false;
    rangeEl.textContent = low && high && low !== high
      ? `Estimated: ${formatRM(low)}\u2013${formatRM(high)} \u2014 using the midpoint for calculations, refine if you know better`
      : `Estimated: ${formatRM(high)} \u2014 refine if you know better`;
    statusEl.textContent = '';
    recalculateAll();
  } catch (err) {
    statusEl.textContent = err.message || 'Could not reach the estimate service. Try manual entry instead.';
  } finally {
    btn.disabled = false;
  }
}

/* ---- Cross-tool sync (listen only — this tool is an analysis
   endpoint like Costing Analysis, not a broadcaster) ---- */
function applySyncedCostIfWaiting(panel) {
  if (lastSyncedPayload && panel.dataset.costSource === 'sync') {
    const statusEl = panel.querySelector('.ma-sync-cost-status');
    statusEl.textContent = `Synced: ${formatRM(lastSyncedPayload.cost)}/portion from ${lastSyncedPayload.label}`;
    statusEl.classList.add('is-synced');
  }
}

function initSync() {
  if (typeof rzListen !== 'function') return; // costing-sync.js not present or an old version — everything else still works
  rzListen((data) => {
    if (data.source === 'menu-calculator' && typeof data.costPerPortion === 'number') {
      lastSyncedPayload = { cost: data.costPerPortion, label: 'Menu Portion Creator' + (data.dishName ? ' (' + data.dishName + ')' : '') };
      document.querySelectorAll('.ma-dish-panel').forEach((p) => {
        if (p.dataset.costSource === 'sync') applySyncedCostIfWaiting(p);
      });
      recalculateAll();
    }
    if (data.source === 'overhead-manpower-calculator') {
      const statusEl = document.getElementById('ma-overhead-sync-status');
      let parts = [];
      if (typeof data.overheadMonthly === 'number') {
        document.getElementById('ma-rent').value = data.overheadMonthly.toFixed(2);
        parts.push('overhead');
      }
      if (typeof data.manpowerMonthly === 'number') {
        document.getElementById('ma-manpower').value = data.manpowerMonthly.toFixed(2);
        parts.push('manpower');
      }
      if (parts.length) {
        statusEl.hidden = false;
        statusEl.textContent = `Synced ${parts.join(' & ')} from Overhead & Manpower Calculator. Utilities below are still estimated separately.`;
        statusEl.classList.add('is-synced');
      }
      recalculateAll();
    }
  });
}

/* ================= UTILITY ESTIMATOR ================= */

let elecRowIdCounter = 0;

function createElecRow(preset) {
  elecRowIdCounter++;
  const tbody = document.getElementById('ma-elec-rows');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="ma-elec-name" value="${escapeHTML(preset ? preset.name : '')}" placeholder="e.g. Deep fryer"></td>
    <td><input type="number" class="ma-elec-watts" min="0" step="10" value="${preset ? preset.watts : 0}"></td>
    <td><input type="number" class="ma-elec-hours" min="0" step="0.5" value="${preset ? preset.hours : 0}"></td>
    <td class="no-print"><button type="button" class="delete-row" aria-label="Remove this equipment">&times;</button></td>
  `;
  tbody.appendChild(tr);
  tr.querySelectorAll('input').forEach((el) => el.addEventListener('input', recalculateAll));
  tr.querySelector('.delete-row').addEventListener('click', () => { tr.remove(); recalculateAll(); });
}

function computeElectricityCost() {
  const rate = num(document.getElementById('ma-elec-rate'), ELECTRICITY_RATE_DEFAULT);
  document.getElementById('ma-elec-rate-display').textContent = rate.toFixed(2);
  const days = num(document.getElementById('ma-operating-days'), 26);
  let dailyKwh = 0;
  document.querySelectorAll('#ma-elec-rows > tr').forEach((tr) => {
    const watts = num(tr.querySelector('.ma-elec-watts'));
    const hours = num(tr.querySelector('.ma-elec-hours'));
    dailyKwh += (watts * hours) / 1000;
  });
  return dailyKwh * days * rate;
}

function computeWaterCost() {
  const actual = document.getElementById('ma-water-actual').value;
  if (actual !== '' && isFinite(parseFloat(actual))) return parseFloat(actual);
  const days = num(document.getElementById('ma-operating-days'), 26);
  const liters = num(document.getElementById('ma-water-liters'), 0) * days;
  const usageCharge = (liters / 1000) * (liters <= WATER_TARIFF.tier1Limit ? WATER_TARIFF.tier1Rate : WATER_TARIFF.tier2Rate);
  return Math.max(WATER_TARIFF.minimum, usageCharge);
}

function computeGasCost() {
  const days = num(document.getElementById('ma-operating-days'), 26);
  const burners = num(document.getElementById('ma-gas-burners'), 0);
  const hours = num(document.getElementById('ma-gas-hours'), 0);
  const rate = num(document.getElementById('ma-gas-rate'), 0.4);
  const kgPerMonth = burners * hours * rate * days;
  const cylinders = kgPerMonth / GAS_CYLINDER_KG;
  const tier = document.querySelector('[name="ma-gas-tier"]:checked').value;
  const price = tier === 'household'
    ? num(document.getElementById('ma-gas-price-household'), GAS_PRICE_HOUSEHOLD_DEFAULT)
    : num(document.getElementById('ma-gas-price-commercial'), GAS_PRICE_COMMERCIAL_DEFAULT);

  const flagEl = document.getElementById('ma-gas-threshold-flag');
  if (tier === 'household' && kgPerMonth > GAS_SUBSIDISED_THRESHOLD_KG) {
    flagEl.innerHTML = ' <span class="loss-flag">OVER the ~42kg subsidised threshold \u2014 you may need a permit or commercial pricing</span>';
  } else if (tier === 'household' && kgPerMonth > GAS_SUBSIDISED_THRESHOLD_KG * 0.85) {
    flagEl.innerHTML = ' <span class="loss-flag" style="color:#9C7A12;">Close to the ~42kg subsidised threshold</span>';
  } else {
    flagEl.textContent = '';
  }
  return { cost: cylinders * price, kgPerMonth };
}

/* ================= MATH ENGINE (pure functions, no DOM) ================= */

function getDishCost(panel) {
  const source = panel.dataset.costSource || 'sync';
  if (source === 'manual') return num(panel.querySelector('.ma-manual-cost'));
  if (source === 'ai') {
    const est = dishAiCost.get(panel);
    if (!est) return 0;
    return est.low && est.high ? (est.low + est.high) / 2 : (est.high || est.low || 0);
  }
  return lastSyncedPayload ? lastSyncedPayload.cost : 0;
}

function collectDishes() {
  return Array.from(document.querySelectorAll('.ma-dish-panel')).map((panel) => {
    const price = num(panel.querySelector('.ma-dish-price'));
    const volumeDay = num(panel.querySelector('.ma-dish-volume'));
    const ingredientCost = getDishCost(panel);
    return {
      panel,
      name: panel.querySelector('.ma-dish-name').value.trim() || 'Untitled item',
      price, volumeDay, ingredientCost,
      cmPerPortion: price - ingredientCost, // standard contribution margin, pre-overhead
    };
  }).filter((d) => d.price > 0 || d.volumeDay > 0);
}

function computeQuadrant(dishes, totalVolumeDay) {
  if (!dishes.length || !totalVolumeDay) return dishes.map((d) => ({ ...d, quadrant: null }));
  const fairShare = (1 / dishes.length) * 100;
  const popThreshold = fairShare * 0.70;
  // Volume-weighted average CM per portion. Deliberately computed from
  // daily figures on both sides (not monthly) so operating-days cancels
  // out cleanly regardless of what the vendor sets that field to.
  const avgCm = dishes.reduce((sum, d) => sum + d.cmPerPortion * d.volumeDay, 0) / totalVolumeDay;
  return dishes.map((d) => {
    const popPct = (d.volumeDay / totalVolumeDay) * 100;
    const highPop = popPct >= popThreshold;
    const highCm = d.cmPerPortion >= avgCm;
    let quadrant;
    if (highPop && highCm) quadrant = 'star';
    else if (highPop && !highCm) quadrant = 'plowhorse';
    else if (!highPop && highCm) quadrant = 'puzzle';
    else quadrant = 'dog';
    return { ...d, popPct, quadrant, avgCm, popThreshold };
  });
}

// Same shape as interactive-costing-analysis.js's structureMix() —
// ingredients/overhead/manpower never negative, margin can go
// negative, all four always sum to exactly 100% of price by
// construction, which is what lets "yours" and "guide" compare on
// the same scale.
function structureMixFromTotals(ingredientTotal, overheadTotal, manpowerTotal, revenueTotal) {
  const rev = revenueTotal > 0 ? revenueTotal : 1;
  const margin = revenueTotal - ingredientTotal - overheadTotal - manpowerTotal;
  return {
    ingredients: (ingredientTotal / rev) * 100,
    overhead: (overheadTotal / rev) * 100,
    manpower: (manpowerTotal / rev) * 100,
    margin: (margin / rev) * 100,
  };
}

/* ================= RENDER ================= */

function renderDishResults(dishes, fixedPerPortion) {
  const container = document.getElementById('ma-dish-results');
  if (!dishes.length) { container.innerHTML = '<p class="structure-note">Add an item above to see its breakdown here.</p>'; return; }
  container.innerHTML = dishes.map((d) => {
    const trueCost = d.ingredientCost + fixedPerPortion;
    const trueMargin = d.price - trueCost;
    const marginPct = d.price > 0 ? (trueMargin / d.price) * 100 : 0;
    const isLoss = trueMargin < 0;
    return `
      <div class="result-card" style="margin-bottom:12px; ${isLoss ? 'background:#f7e6e2;' : ''}">
        <span class="result-label">${escapeHTML(d.name)}${d.quadrant ? ' \u2014 ' + d.quadrant.toUpperCase() : ''}</span>
        <span class="result-value" style="${isLoss ? 'color:var(--accent);' : ''}">
          ${formatRM(d.price)} charged \u2212 ${formatRM(trueCost)} true cost = ${formatRM(trueMargin)} (${marginPct.toFixed(1)}%)
        </span>
      </div>
    `;
  }).join('');
}

function renderQuadrantChart(dishes) {
  const svg = document.getElementById('ma-quadrant-chart');
  const W = 640, H = 420, M = { top: 20, right: 24, bottom: 44, left: 60 };
  const plotW = W - M.left - M.right, plotH = H - M.top - M.bottom;
  if (!dishes.length || !dishes[0].popThreshold) { svg.innerHTML = ''; return; }

  const maxPop = Math.max(...dishes.map((d) => d.popPct), dishes[0].popThreshold * 2) * 1.15;
  const maxCm = Math.max(...dishes.map((d) => d.cmPerPortion), dishes[0].avgCm, 0.01) * 1.25;
  const x = (p) => M.left + (p / maxPop) * plotW;
  const y = (c) => M.top + plotH - (Math.max(0, c) / maxCm) * plotH;
  const popThreshold = dishes[0].popThreshold;
  const avgCm = dishes[0].avgCm;

  const quadColor = { star: 'var(--accent)', plowhorse: '#2E5FA3', puzzle: '#D4A017', dog: '#C0392B' };

  let points = dishes.map((d) => `
    <circle cx="${x(d.popPct).toFixed(1)}" cy="${y(d.cmPerPortion).toFixed(1)}" r="7" fill="${quadColor[d.quadrant]}" stroke="#fff" stroke-width="2"/>
    <text x="${x(d.popPct).toFixed(1)}" y="${(y(d.cmPerPortion) - 12).toFixed(1)}" text-anchor="middle" class="chart-point-label">${escapeHTML(d.name)}</text>
  `).join('');

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${H - M.bottom}" class="chart-axis-line"/>
    <line x1="${M.left}" y1="${H - M.bottom}" x2="${W - M.right}" y2="${H - M.bottom}" class="chart-axis-line"/>
    <line x1="${x(popThreshold).toFixed(1)}" y1="${M.top}" x2="${x(popThreshold).toFixed(1)}" y2="${H - M.bottom}" class="chart-be-line"/>
    <line x1="${M.left}" y1="${y(avgCm).toFixed(1)}" x2="${W - M.right}" y2="${y(avgCm).toFixed(1)}" class="chart-be-line"/>
    ${points}
    <text x="${(W / 2).toFixed(1)}" y="${H - 4}" class="chart-axis-title" text-anchor="middle">Popularity (% of your volume)</text>
    <text x="14" y="${(M.top + plotH / 2).toFixed(1)}" class="chart-axis-title" text-anchor="middle" transform="rotate(-90 14 ${(M.top + plotH / 2).toFixed(1)})">Contribution margin (RM/portion)</text>
  `;
}

function renderStructureComparison(mix, guideVenue) {
  const guide = GUIDE_RATIOS[guideVenue] || GUIDE_RATIOS.stall;
  const bar = (label, m, isLosing) => {
    const segs = [
      { key: 'ingredients', name: 'Ingredients', pct: m.ingredients },
      { key: 'overhead', name: 'Overhead', pct: m.overhead },
      { key: 'manpower', name: 'Manpower', pct: m.manpower },
      { key: 'margin', name: 'Margin', pct: Math.max(0, m.margin) },
    ];
    const html = segs.map((s) => {
      let inner = '';
      if (s.pct >= 15) inner = `${Math.round(s.pct)}% ${s.name}`;
      else if (s.pct >= 6) inner = `${Math.round(s.pct)}%`;
      return `<span class="seg seg-${s.key}" style="width:${Math.max(0, s.pct)}%" title="${s.name} ${s.pct.toFixed(0)}%">${inner ? `<span class="seg-label">${inner}</span>` : ''}</span>`;
    }).join('');
    return `<div class="structure-row"><span class="structure-label">${label}${isLosing ? ' <span class="loss-flag">LOSING MONEY</span>' : ''}</span><div class="structure-bar">${html}</div></div>`;
  };
  document.getElementById('ma-structure-bars').innerHTML =
    bar('Your numbers', mix, mix.margin < 0) +
    bar(`Guide: ${guideVenue}`, guide, false);
}

function renderInsights(dishes, mix, guideVenue, gasKgPerMonth, targetMarginPct, overallMarginPct) {
  const guide = GUIDE_RATIOS[guideVenue] || GUIDE_RATIOS.stall;
  const insights = [];

  dishes.forEach((d) => {
    const trueMargin = d.price - d.ingredientCost;
    if (trueMargin < 0) {
      insights.push({ level: 'alert', text: `${d.name} is priced below its ingredient cost alone \u2014 every portion sold loses money before overhead is even counted.` });
    } else if (d.quadrant === 'dog') {
      insights.push({ level: 'warn', text: `${d.name} is a Dog \u2014 low popularity and low contribution. Worth reconsidering: reprice, rework, or drop it.` });
    }
  });

  const bestCm = dishes.slice().sort((a, b) => b.cmPerPortion - a.cmPerPortion)[0];
  const highestMarginPctDish = dishes.slice().sort((a, b) => {
    const am = a.price > 0 ? (a.price - a.ingredientCost) / a.price : 0;
    const bm = b.price > 0 ? (b.price - b.ingredientCost) / b.price : 0;
    return bm - am;
  })[0];
  if (bestCm && highestMarginPctDish && bestCm.name !== highestMarginPctDish.name) {
    insights.push({ level: 'info', text: `${highestMarginPctDish.name} has your best margin percentage, but ${bestCm.name} earns more RM per portion \u2014 percentage and dollar value aren't the same thing when deciding what to push.` });
  }

  if (mix.overhead + mix.manpower < (guide.overhead + guide.manpower) - 15) {
    insights.push({ level: 'warn', text: `Overhead and manpower together are running well below the typical guide for your setup. Worth double-checking nothing's missing \u2014 the most common gap is a solo owner's own labor not being counted as a cost at all.` });
  } else if (mix.ingredients > guide.ingredients + 10) {
    insights.push({ level: 'warn', text: `Ingredient cost is running noticeably above the typical guide for your setup \u2014 worth checking portion sizes, supplier pricing, or wastage.` });
  }

  if (gasKgPerMonth > GAS_SUBSIDISED_THRESHOLD_KG * 0.85) {
    insights.push({ level: gasKgPerMonth > GAS_SUBSIDISED_THRESHOLD_KG ? 'alert' : 'warn', text: `Gas usage is ${gasKgPerMonth > GAS_SUBSIDISED_THRESHOLD_KG ? 'over' : 'approaching'} the ~42kg subsidised threshold \u2014 worth confirming your current eligibility rather than assuming last month's price still applies.` });
  }

  if (isFinite(targetMarginPct) && targetMarginPct > 0) {
    const gap = overallMarginPct - targetMarginPct;
    insights.push({
      level: gap < 0 ? 'alert' : 'info',
      text: gap < 0
        ? `You're ${Math.abs(gap).toFixed(1)} points below your ${targetMarginPct}% target margin overall \u2014 closing that gap likely means raising prices on your Dogs and Plowhorses, not your Stars.`
        : `You're ${gap.toFixed(1)} points above your ${targetMarginPct}% target \u2014 currently ahead of where you said you wanted to be.`,
    });
  }

  if (!insights.length) insights.push({ level: 'info', text: 'Nothing stands out yet \u2014 add items and costs above to see where your margin actually sits.' });

  const iconFor = { alert: '\u26A0\uFE0F', warn: '\uD83D\uDD0D', info: '\uD83D\uDCA1' };
  document.getElementById('ma-insights').innerHTML = insights.map((i) => `
    <div class="ma-insight-card ${i.level === 'alert' ? 'is-alert' : i.level === 'warn' ? 'is-warn' : ''}">
      <span class="ma-insight-icon">${iconFor[i.level]}</span>
      <span>${i.text}</span>
    </div>
  `).join('');
}

/* ================= CONTROLLER ================= */

function recalculateAll() {
  const dishes = collectDishes();
  const totalVolumeDay = dishes.reduce((s, d) => s + d.volumeDay, 0);
  const days = num(document.getElementById('ma-operating-days'), 26);
  const totalVolumeMonth = totalVolumeDay * days;

  const elecCost = computeElectricityCost();
  const waterCost = computeWaterCost();
  const gasResult = computeGasCost();
  const rent = num(document.getElementById('ma-rent'));
  const manpower = num(document.getElementById('ma-manpower'));
  const utilitiesTotal = elecCost + waterCost + gasResult.cost;
  const overheadTotal = rent + utilitiesTotal;

  document.getElementById('ma-elec-cost').textContent = formatRM(elecCost);
  document.getElementById('ma-water-cost').textContent = formatRM(waterCost);
  document.getElementById('ma-gas-cost').textContent = formatRM(gasResult.cost);
  document.getElementById('ma-total-overhead').textContent = formatRM(overheadTotal);
  document.getElementById('ma-total-manpower').textContent = formatRM(manpower);

  const overheadPerPortion = totalVolumeMonth > 0 ? overheadTotal / totalVolumeMonth : 0;
  const manpowerPerPortion = totalVolumeMonth > 0 ? manpower / totalVolumeMonth : 0;
  const fixedPerPortion = overheadPerPortion + manpowerPerPortion;

  const classified = computeQuadrant(dishes, totalVolumeDay);

  const revenueTotal = dishes.reduce((s, d) => s + d.price * d.volumeDay * days, 0);
  const ingredientTotal = dishes.reduce((s, d) => s + d.ingredientCost * d.volumeDay * days, 0);
  const netProfit = revenueTotal - ingredientTotal - overheadTotal - manpower;
  const overallMarginPct = revenueTotal > 0 ? (netProfit / revenueTotal) * 100 : 0;

  document.getElementById('ma-total-revenue').textContent = formatRM(revenueTotal);
  document.getElementById('ma-net-profit').textContent = formatRM(netProfit);
  document.getElementById('ma-overall-margin').textContent = overallMarginPct.toFixed(1) + '%';

  const targetInput = document.getElementById('ma-target-margin');
  const targetPct = parseFloat(targetInput.value);
  const gapEl = document.getElementById('ma-target-gap');
  if (isFinite(targetPct) && targetPct > 0) {
    const gap = overallMarginPct - targetPct;
    gapEl.textContent = (gap >= 0 ? '+' : '') + gap.toFixed(1) + ' pts';
    gapEl.closest('.result-card').classList.toggle('is-loss', gap < 0);
  } else {
    gapEl.textContent = 'Set a target below';
    gapEl.closest('.result-card').classList.remove('is-loss');
  }

  renderDishResults(classified, fixedPerPortion);
  renderQuadrantChart(classified);

  const guideVenue = wizardAnswers.venue || 'stall';
  const mix = structureMixFromTotals(ingredientTotal, overheadTotal, manpower, revenueTotal);
  renderStructureComparison(mix, guideVenue);
  renderInsights(classified, mix, guideVenue, gasResult.kgPerMonth, targetPct, overallMarginPct);
}

/* ================= EXPORT / IMPORT (client-side only — see
   file header; nothing here ever reaches a server) ================= */

function gatherExportData() {
  return {
    savedAt: new Date().toISOString(),
    tool: 'margin-audit-calculator',
    wizardAnswers,
    operatingDays: num(document.getElementById('ma-operating-days'), 26),
    rent: num(document.getElementById('ma-rent')),
    manpower: num(document.getElementById('ma-manpower')),
    electricity: Array.from(document.querySelectorAll('#ma-elec-rows > tr')).map((tr) => ({
      name: tr.querySelector('.ma-elec-name').value, watts: num(tr.querySelector('.ma-elec-watts')), hours: num(tr.querySelector('.ma-elec-hours')),
    })),
    electricityRate: num(document.getElementById('ma-elec-rate'), ELECTRICITY_RATE_DEFAULT),
    waterLitersPerDay: num(document.getElementById('ma-water-liters')),
    gas: {
      burners: num(document.getElementById('ma-gas-burners')), hours: num(document.getElementById('ma-gas-hours')), rate: num(document.getElementById('ma-gas-rate')),
      tier: document.querySelector('[name="ma-gas-tier"]:checked').value,
    },
    targetMargin: document.getElementById('ma-target-margin').value,
    dishes: Array.from(document.querySelectorAll('.ma-dish-panel')).map((p) => ({
      name: p.querySelector('.ma-dish-name').value, price: num(p.querySelector('.ma-dish-price')), volumeDay: num(p.querySelector('.ma-dish-volume')),
      costSource: p.dataset.costSource || 'sync', manualCost: num(p.querySelector('.ma-manual-cost')),
    })),
    resultSummary: {
      revenueMonth: document.getElementById('ma-total-revenue').textContent,
      netProfitMonth: document.getElementById('ma-net-profit').textContent,
      overallMarginPct: document.getElementById('ma-overall-margin').textContent,
    },
  };
}

function exportData() {
  const data = gatherExportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 7); // YYYY-MM
  a.href = url; a.download = `margin-audit-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) {
      alert("Couldn't read that file \u2014 make sure it's a data file saved from this tool, not something else.");
      return;
    }
    if (!data || data.tool !== 'margin-audit-calculator') {
      alert('That file doesn\u2019t look like it was saved from this tool.');
      return;
    }
    const previousMarginText = data.resultSummary ? data.resultSummary.overallMarginPct : null;

    Object.assign(wizardAnswers, data.wizardAnswers || {});
    document.getElementById('ma-operating-days').value = data.operatingDays || 26;
    document.getElementById('ma-rent').value = data.rent || 0;
    document.getElementById('ma-manpower').value = data.manpower || 0;
    document.getElementById('ma-elec-rows').innerHTML = '';
    (data.electricity || []).forEach((row) => createElecRow(row));
    document.getElementById('ma-elec-rate').value = data.electricityRate || ELECTRICITY_RATE_DEFAULT;
    document.getElementById('ma-water-liters').value = data.waterLitersPerDay || 0;
    document.getElementById('ma-water-liters-num').value = data.waterLitersPerDay || 0;
    if (data.gas) {
      document.getElementById('ma-gas-burners').value = data.gas.burners || 0;
      document.getElementById('ma-gas-hours').value = data.gas.hours || 0;
      document.getElementById('ma-gas-rate').value = data.gas.rate || 0.4;
      const radio = document.querySelector(`[name="ma-gas-tier"][value="${data.gas.tier}"]`);
      if (radio) radio.checked = true;
    }
    document.getElementById('ma-target-margin').value = data.targetMargin || '';

    document.getElementById('ma-dish-panels').innerHTML = '';
    (data.dishes || []).forEach((d) => {
      const panel = createDishPanel();
      panel.querySelector('.ma-dish-name').value = d.name || '';
      panel.querySelector('.ma-dish-name-mirror').value = d.name || '';
      panel.querySelector('.ma-dish-price').value = d.price || 0;
      panel.querySelector('.ma-dish-volume').value = d.volumeDay || 0;
      panel.querySelector('.ma-manual-cost').value = d.manualCost || 0;
      switchDishSource(panel, d.costSource || 'sync');
    });

    finishWizard();
    recalculateAll();

    if (previousMarginText) {
      const note = document.getElementById('ma-compare-note');
      note.hidden = false;
      note.classList.add('is-synced');
      note.textContent = `Loaded data saved ${new Date(data.savedAt).toLocaleDateString()} \u2014 that month's overall margin was ${previousMarginText}, currently ${document.getElementById('ma-overall-margin').textContent}.`;
    }
  };
  reader.readAsText(file);
}

/* ================= PRINT ================= */

function saveDataSnapshot() {
  const data = gatherExportData();
  let view = document.getElementById('ma-print-data-view');
  if (!view) {
    view = document.createElement('div');
    view.id = 'ma-print-data-view';
    document.body.appendChild(view);
  }
  const lines = [
    'REYSOURCEZ MARGIN AUDIT \u2014 DATA SNAPSHOT',
    'Saved: ' + new Date().toLocaleString(),
    '',
    'Venue: ' + (wizardAnswers.venue || '\u2014') + ' | Manpower: ' + (wizardAnswers.manpower || '\u2014'),
    'Operating days/month: ' + data.operatingDays,
    '',
    'DISHES',
    ...data.dishes.map((d) => `  ${d.name} | price RM${d.price.toFixed(2)} | ${d.volumeDay}/day | source: ${d.costSource}${d.costSource === 'manual' ? ' | RM' + d.manualCost.toFixed(2) : ''}`),
    '',
    'OVERHEAD & UTILITIES',
    '  Rent/misc: RM' + data.rent.toFixed(2),
    '  Manpower: RM' + data.manpower.toFixed(2),
    '  Electricity rate: RM' + data.electricityRate + '/kWh',
    ...data.electricity.map((e) => `    ${e.name}: ${e.watts}W x ${e.hours}h/day`),
    '  Water: ' + data.waterLitersPerDay + 'L/day',
    '  Gas: ' + data.gas.burners + ' burner(s), ' + data.gas.hours + 'h/day, ' + data.gas.rate + 'kg/h, ' + data.gas.tier + ' rate',
    '',
    'RESULT SUMMARY',
    '  Revenue/month: ' + data.resultSummary.revenueMonth,
    '  Net profit/month: ' + data.resultSummary.netProfitMonth,
    '  Overall margin: ' + data.resultSummary.overallMarginPct,
    '',
    'This is a raw data snapshot for re-importing next month, not a client report \u2014 use "Save as PDF" for that.',
  ];
  view.textContent = lines.join('\n');

  document.body.classList.add('ma-printing-data');
  window.print();
}
window.addEventListener('afterprint', () => document.body.classList.remove('ma-printing-data'));

/* ================= INIT ================= */

let rzInitialized = false;

function init() {
  if (rzInitialized) return;
  rzInitialized = true;

  renderWizardStep();
  document.getElementById('wizard-back').addEventListener('click', goBack);
  document.getElementById('ma-edit-answers').addEventListener('click', editAnswers);
  document.getElementById('ma-save-pdf').addEventListener('click', () => window.print());
  document.getElementById('ma-save-data').addEventListener('click', saveDataSnapshot);
  document.getElementById('ma-import-input').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
  });

  document.getElementById('ma-add-dish').addEventListener('click', () => { createDishPanel(); recalculateAll(); });

  ['ma-rent', 'ma-manpower', 'ma-operating-days', 'ma-elec-rate', 'ma-water-actual',
   'ma-gas-burners', 'ma-gas-hours', 'ma-gas-rate', 'ma-gas-price-household', 'ma-gas-price-commercial',
   'ma-target-margin'].forEach((id) => document.getElementById(id).addEventListener('input', recalculateAll));
  document.querySelectorAll('[name="ma-gas-tier"]').forEach((r) => r.addEventListener('change', recalculateAll));

  const waterRange = document.getElementById('ma-water-liters');
  const waterNum = document.getElementById('ma-water-liters-num');
  waterRange.addEventListener('input', () => { waterNum.value = waterRange.value; recalculateAll(); });
  waterNum.addEventListener('input', () => { waterRange.value = waterNum.value; recalculateAll(); });

  document.getElementById('ma-add-elec-row').addEventListener('click', () => createElecRow());
  ELECTRICITY_DEFAULTS.forEach((preset) => createElecRow(preset));

  initSync();
  recalculateAll();
}

document.addEventListener('DOMContentLoaded', init);
