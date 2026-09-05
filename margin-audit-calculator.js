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

   ------------------------------------------------------------
   PAGE STRUCTURE (2026-09-05 rewrite):
   The page is now two clearly separate sections instead of one
   long stack of boxes:

     MARGIN ANALYSIS (#ma-analysis, top) — read-only output. True
     cost breakdown, earnings summary, per-item breakdown, the
     quadrant chart, cost-structure pies, insights. Nothing here
     is a cost input; "Your target margin %" and the guide-venue
     dropdown only change how results are COMPARED or labeled.

     MARGIN CALCULATION (#ma-calculation, near the footer) — every
     actual cost input, including the dish list that used to be a
     separate box up top called "Your menu, at today's prices".
     Split into four tabs — Menu / Fixed Overhead / Variable
     Overhead / Manpower — each an INDEPENDENT show/hide toggle
     (see toggleCalcTab), not a mutually-exclusive switcher: opening
     one does not close another, and closing one never clears what
     was typed into it, same idea as a native <details> element,
     just styled as pill buttons. Reset All is the one control here
     that actually clears data, and needs a confirm() first.

   This replaces the previous design, where "Your menu, at today's
   prices" lived in its own always-visible box up top AND a
   separate "Pull from Menu Portion Creator" button near the footer
   could ALSO create dishes into that same box — two different
   places to manage the same list. Now there's exactly one: the
   Menu tab in Margin Calculation, which both the native AI-
   estimate/manual entry form AND the "pull from" button feed into.

   DATA MODEL: one or more "dishes", same repeatable-block pattern
   as menu-calculator.js's .menu-block, INCLUDING its tab-queue
   behavior — only the active dish's card is visible at a time,
   switched via .ma-dish-tabs, exactly matching switchToMenuBlock/
   renderMenuTabs there (and Food Worth's dish tabs, and Printing
   Calculator's job tabs). createDishPanel()/switchToDish()/
   renderDishTabs() below are that pattern ported, not reinvented.
   collectDishes() and every render function still reads ALL dish
   panels via querySelectorAll regardless of which tab is showing —
   hidden only affects display, never what gets calculated. This is
   a DIFFERENT toggle mechanism from the outer Menu/Fixed/Variable/
   Manpower tabs above it — dish tabs are mutually exclusive
   (switch between dishes), the outer calc-tabs are independent
   (accordion-style, several can be open at once). Don't confuse
   toggleCalcTab (outer) with switchToDish (inner, dish-level).

   Each dish has a cost SOURCE: ai (Gemini estimates from a
   description and/or photo) or manual (vendor just types a
   number). Pulling a dish in from Menu Calculator now goes through
   the "Pull from Menu Portion Creator" button inside the Menu tab
   (see TOOL DOCK section) — it CREATES a new dish panel pre-filled
   as a manual entry. Printing Calculator is intentionally NOT
   offered as a pull source on this page (see TOOL_DOCK_CONFIG
   below) — printing isn't a food cost, so it doesn't belong in a
   food margin tool; revisit if/when a services-margin sibling tool
   is built (see KIV list in the change notes). Overhead & Manpower
   Calculator is reachable from both the Fixed Overhead tab AND the
   Manpower tab, since that one external tool computes both figures
   together and broadcasts them together — see handleSyncPayload().

   TOOL DOCK: fetch-inject-execute — load another tool's real page
   and real script into a dock on this page, shadowing rzBroadcast
   inside an IIFE so its calls land directly on handleSyncPayload
   here instead of going out over a BroadcastChannel this page's own
   listener can't hear itself on (see rzRunIsolated). Relies on
   RZ_TOOLS from costing-sync.js for each tool's real URL/label; if
   that's ever missing or reshaped, every touch point already guards
   for it (typeof RZ_TOOLS === 'undefined' etc.) and simply no-ops
   rather than breaking anything else on the page. The dock itself
   now lives inside Margin Calculation (it used to sit under a
   separate connector-panel row) — "pull from" buttons are embedded
   directly in the tab whose data they fill instead.

   STRUCTURE COMPARISON: pie-chart based, ported from
   interactive-costing-analysis.js's renderStructurePie/
   describePieSlice/polarPoint — generic pie math, not page-
   specific, so it's reused as-is rather than reinvented as bars.
   ============================================================ */

console.info('[Margin Audit] script build: 2026-09-05-v3-analysis-calc-split');

/* ================= CONFIG =================
   Everything a layperson might reasonably need to change lives
   here, with the current value on the left and nothing else in
   this file needing to change to update it. */

const PROXY_ENDPOINT = 'PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE';

const GUIDE_RATIOS = {
  home:  { ingredients: 55, overhead: 15, manpower: 15, margin: 15 },
  stall: { ingredients: 50, overhead: 20, manpower: 15, margin: 15 },
  truck: { ingredients: 42, overhead: 20, manpower: 23, margin: 15 },
  store: { ingredients: 35, overhead: 20, manpower: 30, margin: 15 },
};

const ELECTRICITY_DEFAULTS = [
  { name: 'Rice cooker', watts: 800, hours: 3 },
  { name: 'Exhaust fan', watts: 200, hours: 8 },
  { name: 'Fridge', watts: 250, hours: 24 },
  { name: 'Lighting', watts: 100, hours: 10 },
];
const ELECTRICITY_RATE_DEFAULT = 0.28; // RM/kWh, Sarawak Energy's current stated average — verify against their live tariff page for exact tiered bands

const WATER_TARIFF = { minimum: 22.00, tier1Limit: 25000, tier1Rate: 0.97, tier2Rate: 1.06 }; // RM, liters, RM/1000L — Sarawak W3 Commercial Rate
const WATER_LITERS_DEFAULT = 500;

const GAS_CYLINDER_KG = 14;
const GAS_SUBSIDISED_THRESHOLD_KG = 42;
const GAS_PRICE_HOUSEHOLD_DEFAULT = 26.60;
const GAS_PRICE_COMMERCIAL_DEFAULT = 70.00;
const GAS_BURNERS_DEFAULT = 1;
const GAS_HOURS_DEFAULT = 4;
const GAS_RATE_DEFAULT = 0.4;

const RENT_DEFAULT = 900;
const MANPOWER_DEFAULT = 1200;
const OPERATING_DAYS_DEFAULT = 26;

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

// Shows a small "synced from X" badge next to a field label — used
// for overhead/manpower (their labels are real <label> wrappers,
// matching what this expects); dish syncing shows its own
// confirmation instead via #ma-dock-feedback, since a dish name
// input isn't wrapped in a label the same way.
function markSynced(labelSelector, sourceLabel) {
  const label = document.querySelector(labelSelector);
  if (!label) return;
  let badge = label.querySelector('.synced-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'synced-badge';
    label.appendChild(badge);
  }
  badge.textContent = '\u2190 ' + sourceLabel;
}

/* ================= WIZARD ================= */

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

// Unhides BOTH halves of the page now (Margin Analysis and Margin
// Calculation used to be one section) and reveals the floating nav,
// which only makes sense once there's somewhere for it to jump to.
function finishWizard() {
  document.getElementById('wizard').hidden = true;
  document.getElementById('ma-analysis').hidden = false;
  document.getElementById('ma-calculation').hidden = false;
  document.getElementById('rz-float-nav').hidden = false;
  document.querySelector('#ma-manpower-label .label-text').textContent = wizardAnswers.manpower === 'solo'
    ? "Manpower (include your own wage, even if it's just you)"
    : 'Manpower';
  const guideSelect = document.getElementById('guide-venue-select');
  if (guideSelect && wizardAnswers.venue) guideSelect.value = wizardAnswers.venue;
  if (!document.querySelector('.ma-dish-panel')) createDishPanel();
  recalculateAll();
}

function editAnswers() {
  document.getElementById('ma-analysis').hidden = true;
  document.getElementById('ma-calculation').hidden = true;
  document.getElementById('rz-float-nav').hidden = true;
  document.getElementById('wizard').hidden = false;
  wizardStepIndex = 0;
  renderWizardStep();
}

/* ================= MARGIN CALCULATION TABS =================
   Four independent show/hide toggles (Menu / Fixed Overhead /
   Variable Overhead / Manpower) — NOT a mutually-exclusive
   switcher. Clicking a tab a second time closes just that tab;
   clicking a different one does not close whatever's already open.
   Nothing in a closed panel is ever cleared or rebuilt — it's a
   plain `hidden` toggle on a DOM node that already exists, so every
   input inside keeps its value and its event listeners the whole
   time, identical in spirit to a native <details> element (see
   Food Worth's collapsible sections for the same idea elsewhere on
   this site). This is deliberately a DIFFERENT mechanism from the
   dish tabs inside the Menu panel (switchToDish, further down),
   which ARE mutually exclusive — don't conflate the two. */

function setCalcTabOpen(key, open) {
  const btn = document.querySelector(`.ma-calc-tab[data-calc-tab="${key}"]`);
  const panel = document.querySelector(`.ma-calc-panel[data-calc-panel="${key}"]`);
  if (!btn || !panel) return;
  panel.hidden = !open;
  btn.classList.toggle('is-active', open);
  btn.setAttribute('aria-expanded', String(open));
}

function toggleCalcTab(key) {
  const panel = document.querySelector(`.ma-calc-panel[data-calc-panel="${key}"]`);
  if (!panel) return;
  setCalcTabOpen(key, panel.hidden);
}

// The only control in Margin Calculation that actually clears data
// (every calc-tab toggle above only shows/hides, never resets).
// Confirms first since this can't be undone — same instinct as any
// destructive action elsewhere (e.g. removing a dish already asks
// nothing, but this affects everything at once, so it gets an
// explicit guard the individual remove buttons don't need).
function resetAllCalculationData() {
  const ok = confirm('Clear every menu item, and reset overhead, utilities, and manpower back to their starting defaults? This can\u2019t be undone.');
  if (!ok) return;

  document.getElementById('ma-dish-panels').innerHTML = '';
  dishIdCounter = 0;
  createDishPanel();
  renderDishTabs();

  document.getElementById('ma-rent').value = RENT_DEFAULT;
  document.getElementById('ma-manpower').value = MANPOWER_DEFAULT;
  document.getElementById('ma-operating-days').value = OPERATING_DAYS_DEFAULT;

  document.getElementById('ma-elec-rows').innerHTML = '';
  ELECTRICITY_DEFAULTS.forEach((preset) => createElecRow(preset));
  document.getElementById('ma-elec-rate').value = ELECTRICITY_RATE_DEFAULT;

  document.getElementById('ma-water-liters').value = WATER_LITERS_DEFAULT;
  document.getElementById('ma-water-liters-num').value = WATER_LITERS_DEFAULT;
  document.getElementById('ma-water-actual').value = '';

  document.getElementById('ma-gas-burners').value = GAS_BURNERS_DEFAULT;
  document.getElementById('ma-gas-hours').value = GAS_HOURS_DEFAULT;
  document.getElementById('ma-gas-rate').value = GAS_RATE_DEFAULT;
  const householdRadio = document.querySelector('[name="ma-gas-tier"][value="household"]');
  if (householdRadio) householdRadio.checked = true;
  document.getElementById('ma-gas-price-household').value = GAS_PRICE_HOUSEHOLD_DEFAULT;
  document.getElementById('ma-gas-price-commercial').value = GAS_PRICE_COMMERCIAL_DEFAULT;

  setCalcTabOpen('menu', true);
  setCalcTabOpen('fixed', false);
  setCalcTabOpen('variable', false);
  setCalcTabOpen('manpower', false);

  const feedback = document.getElementById('ma-dock-feedback');
  if (feedback) feedback.textContent = '\u2713 Cleared \u2014 Margin Calculation is back to its starting defaults.';

  recalculateAll();
}

/* ================= DISH PANELS (tab-queue pattern) ================= */

const dishAiCost = new WeakMap();   // panel -> {low, high} from Gemini
const dishAiImage = new WeakMap();  // panel -> base64 (for the estimate request only, never stored)
let dishIdCounter = 0;

function createDishPanel() {
  dishIdCounter++;
  const id = 'ma-dish-' + dishIdCounter;
  const panel = document.createElement('div');
  panel.className = 'ma-dish-panel menu-block';
  panel.dataset.dishId = id;
  panel.dataset.costSource = 'ai';
  panel.innerHTML = `
    <div class="menu-block-header">
      <input type="text" class="menu-name-input ma-dish-name" value="Dish ${dishIdCounter}" aria-label="Dish name">
      <button type="button" class="remove-block-btn ma-remove-dish no-print" aria-label="Remove this item">Remove item</button>
    </div>
    <div class="ma-dish-grid">
      <label>Current price (RM) <input type="number" class="ma-dish-price" inputmode="decimal" min="0" step="0.01" value="0.00"></label>
      <label>Sold / day <input type="number" class="ma-dish-volume" inputmode="decimal" min="0" step="1" value="0"></label>
    </div>

    <div class="ma-source-tabs" role="tablist">
      <button type="button" class="ma-source-tab is-active" data-source="ai">AI estimate</button>
      <button type="button" class="ma-source-tab" data-source="manual">I'll enter it myself</button>
    </div>

    <div class="ma-source-panel ma-source-ai" data-source-panel="ai">
      <div class="ma-ai-row">
        <textarea class="ma-ai-desc" placeholder="Describe the dish — main ingredients and rough portions (e.g. 200g rice, fried chicken thigh, sambal, egg, cucumber)"></textarea>
        <label class="btn btn-secondary ma-ai-photo-btn" style="cursor:pointer;">Or snap a photo<input type="file" accept="image/*" class="sr-only ma-ai-photo-input"></label>
      </div>
      <img class="ma-ai-preview" alt="" hidden>
      <div class="calc-actions no-print" style="padding-top:10px;">
        <button type="button" class="btn btn-primary ma-ai-estimate-btn">Estimate cost</button>
      </div>
      <p class="ma-ai-status"></p>
      <span class="ma-cost-range" hidden></span>
    </div>

    <div class="ma-source-panel ma-source-manual" data-source-panel="manual" hidden>
      <div class="ma-manual-row">
        <label>Ingredient cost (RM) <input type="number" class="ma-manual-cost" inputmode="decimal" min="0" step="0.01" value="0.00"></label>
      </div>
    </div>
  `;
  document.getElementById('ma-dish-panels').appendChild(panel);

  panel.querySelector('.ma-dish-name').addEventListener('input', () => { renderDishTabs(); recalculateAll(); });
  panel.querySelectorAll('.ma-dish-price, .ma-dish-volume, .ma-manual-cost').forEach((el) => {
    el.addEventListener('input', recalculateAll);
  });

  panel.querySelectorAll('.ma-source-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchDishSource(panel, tab.dataset.source));
  });

  panel.querySelector('.ma-ai-photo-input').addEventListener('change', (e) => handleDishPhoto(e, panel));
  panel.querySelector('.ma-ai-estimate-btn').addEventListener('click', () => estimateDishCost(panel));

  panel.querySelector('.ma-remove-dish').addEventListener('click', () => {
    const wasActive = !panel.hidden;
    panel.remove();
    if (wasActive) {
      const remaining = document.querySelector('.ma-dish-panel');
      if (remaining) switchToDish(remaining.dataset.dishId);
      else renderDishTabs();
    } else {
      renderDishTabs();
    }
    recalculateAll();
  });

  switchToDish(id);
  return panel;
}

// Only the active dish's full card is shown at a time; the tab row
// beside "+ Add menu item" lets you switch which one that is. Same
// "hide siblings, show one" pattern already used by Menu Calculator's
// menu blocks, Food Worth's dish tabs, and Printing Calculator's job
// tabs — ported here rather than reinvented as vertical stacking.
// This is dish-level switching, separate from the outer Menu/Fixed/
// Variable/Manpower calc-tabs (see toggleCalcTab above), which are
// independent toggles, not a switcher.
function switchToDish(dishId) {
  document.querySelectorAll('.ma-dish-panel').forEach((p) => {
    p.hidden = (p.dataset.dishId !== dishId);
  });
  renderDishTabs();
}

// Tabs only appear once there's something to switch between — a
// single item just shows its card directly, no tab row overhead.
function renderDishTabs() {
  const panels = Array.from(document.querySelectorAll('.ma-dish-panel'));
  const tabsContainer = document.getElementById('ma-dish-tabs');
  if (!tabsContainer) return;

  if (panels.length <= 1) {
    tabsContainer.innerHTML = '';
    if (panels.length === 1) panels[0].hidden = false;
    return;
  }

  tabsContainer.innerHTML = panels.map((p) => {
    const name = p.querySelector('.ma-dish-name').value.trim() || 'Untitled item';
    const isActive = !p.hidden;
    return `<button type="button" class="btn btn-secondary menu-tab-btn${isActive ? ' is-active' : ''}" data-dish-id="${p.dataset.dishId}">${escapeHTML(name)}</button>`;
  }).join('');

  tabsContainer.querySelectorAll('.menu-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchToDish(btn.dataset.dishId));
  });
}

function switchDishSource(panel, source) {
  panel.dataset.costSource = source;
  panel.querySelectorAll('.ma-source-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.source === source));
  panel.querySelectorAll('.ma-source-panel').forEach((p) => { p.hidden = p.dataset.sourcePanel !== source; });
  recalculateAll();
}

/* ---- AI estimate (Gemini via Cloudflare Worker) ---- */

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
    statusEl.textContent = 'This tool needs its proxy URL set \u2014 see PROXY_ENDPOINT near the top of margin-audit-calculator.js. Use manual entry for now.';
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

/* ================= CROSS-TOOL SYNC (dishes: created via tool
   dock pulls; overhead/manpower: filled directly) ================= */

function handleSyncPayload(data) {
  if (data.source === 'menu-calculator' && typeof data.costPerPortion === 'number') {
    const panel = createDishPanel();
    panel.querySelector('.ma-dish-name').value = data.dishName || 'Synced item';
    if (typeof data.sellingPrice === 'number' && data.sellingPrice > 0) {
      panel.querySelector('.ma-dish-price').value = data.sellingPrice.toFixed(2);
    }
    switchDishSource(panel, 'manual');
    panel.querySelector('.ma-manual-cost').value = data.costPerPortion.toFixed(2);
    renderDishTabs();
    setCalcTabOpen('menu', true);
    const feedback = document.getElementById('ma-dock-feedback');
    if (feedback) {
      feedback.textContent = `\u2713 Added "${panel.querySelector('.ma-dish-name').value}" to your menu from Menu Portion Creator \u2014 ${formatRM(data.costPerPortion)}/portion.`;
    }
    recalculateAll();
  }
  if (data.source === 'overhead-manpower-calculator') {
    const parts = [];
    if (typeof data.overheadMonthly === 'number') {
      document.getElementById('ma-rent').value = data.overheadMonthly.toFixed(2);
      markSynced('#ma-rent-label', 'Overhead & Manpower');
      parts.push('fixed overhead');
    }
    if (typeof data.manpowerMonthly === 'number') {
      document.getElementById('ma-manpower').value = data.manpowerMonthly.toFixed(2);
      markSynced('#ma-manpower-label', 'Overhead & Manpower');
      parts.push('manpower');
    }
    if (parts.length) {
      // Fills both fields at once regardless of which tab's "Pull
      // from" button triggered it (Fixed Overhead and Manpower share
      // the one external tool) — open both so nothing that just got
      // filled in is sitting behind a closed tab.
      setCalcTabOpen('fixed', true);
      setCalcTabOpen('manpower', true);
      const feedback = document.getElementById('ma-dock-feedback');
      if (feedback) feedback.textContent = `\u2713 Synced ${parts.join(' & ')} from Overhead & Manpower Calculator.`;
    }
    recalculateAll();
  }
}

function initSync() {
  if (typeof rzListen !== 'function') return; // costing-sync.js missing/reshaped — everything else still works
  rzListen(handleSyncPayload);
}

/* ================= TOOL DOCK (fetch-inject-execute) =================
   Same fetch-inject-execute approach used by interactive-costing-
   analysis.js — see that file's own long comment for the full
   explanation of the two real problems this solves (duplicate
   top-level declarations across pages if a tool's script were
   pasted in raw, and BroadcastChannel never delivering a message
   back to its own sender). Nothing about the mechanism changes
   here, only WHICH tools are offered and where their trigger
   buttons live: printing-calculator has no entry below (see the
   note at the top of this file for why), and each "Pull from"
   button now sits inside the specific calc-tab whose data it fills,
   rather than a single shared connector row. ============================================================ */

const TOOL_DOCK_CONFIG = {
  'menu-calculator': { scriptUrl: 'menu-calculator.js', theme: 'theme-menu' },
  'overhead-manpower-calculator': { scriptUrl: 'overhead-manpower-calculator.js', theme: 'theme-overhead' },
  // Printing Calculator intentionally excluded: printing isn't a
  // food cost, so it has no place in a FOOD margin tool. The page
  // itself (printing-calculator.html) is untouched and still fully
  // reachable directly, and from Interactive Costing Analysis. If a
  // services-margin sibling tool gets built later (see KIV list),
  // it can add this entry back for itself.
};

function rzExtractInlineScript(doc) {
  const found = Array.from(doc.querySelectorAll('script')).find((s) => !s.src);
  return found ? found.textContent : '';
}

function rzRunIsolated(scriptText, sourceKey) {
  const scriptEl = document.createElement('script');
  scriptEl.textContent =
    '(function() {\n' +
    '  const rzBroadcast = function(payload) { handleSyncPayload(Object.assign({ source: "' + sourceKey + '" }, payload)); };\n' +
    scriptText + '\n' +
    '  if (typeof init === "function") init();\n' +
    '})();';
  document.getElementById('tool-dock-body').appendChild(scriptEl);
}

function setDockVisible(visible) {
  document.getElementById('tool-dock').hidden = !visible;
}

async function rzLoadToolIntoDock(key) {
  if (typeof RZ_TOOLS === 'undefined' || !RZ_TOOLS[key]) return;
  const dockConfig = TOOL_DOCK_CONFIG[key];
  if (!dockConfig) return; // e.g. printing-calculator — not offered from this page
  const tool = RZ_TOOLS[key];
  const dock = document.getElementById('tool-dock');
  const body = document.getElementById('tool-dock-body');
  const titleEl = document.getElementById('tool-dock-title');
  const feedback = document.getElementById('ma-dock-feedback');
  if (feedback) feedback.textContent = '';

  if (dock.dataset.openTool === key) {
    setDockVisible(true);
    dock.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  dock.className = 'tool-dock ' + dockConfig.theme;
  dock.dataset.openTool = key;
  titleEl.textContent = tool.label;
  body.innerHTML = '<p class="tool-dock-status">Loading\u2026</p>';
  setDockVisible(true);
  dock.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const html = await fetch(tool.url).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const main = doc.querySelector('main');
    if (!main) throw new Error('couldn\u2019t find that page\u2019s content');

    main.querySelectorAll('.rz-embed-hide').forEach((el) => { el.hidden = true; });
    main.querySelectorAll('#rz-switcher').forEach((el) => el.remove());

    const scriptText = dockConfig.inlineScript
      ? rzExtractInlineScript(doc)
      : await fetch(dockConfig.scriptUrl).then((r) => r.text());

    body.innerHTML = '';
    Array.from(main.children).forEach((section) => {
      const wrap = section.querySelector(':scope > .wrap');
      if (wrap) {
        while (wrap.firstChild) section.insertBefore(wrap.firstChild, wrap);
        wrap.remove();
      }
      body.appendChild(section);
    });

    rzRunIsolated(scriptText, key);
  } catch (err) {
    body.innerHTML = '<p class="tool-dock-status is-error">Couldn\u2019t load this here (' + err.message + '). <a href="' + tool.url + '" target="_blank" rel="noopener">Open ' + tool.label + ' in a new tab instead</a>.</p>';
  }
}

/* ================= UTILITY ESTIMATOR ================= */

function createElecRow(preset) {
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
  const days = num(document.getElementById('ma-operating-days'), OPERATING_DAYS_DEFAULT);
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
  const days = num(document.getElementById('ma-operating-days'), OPERATING_DAYS_DEFAULT);
  const liters = num(document.getElementById('ma-water-liters'), 0) * days;
  const usageCharge = (liters / 1000) * (liters <= WATER_TARIFF.tier1Limit ? WATER_TARIFF.tier1Rate : WATER_TARIFF.tier2Rate);
  return Math.max(WATER_TARIFF.minimum, usageCharge);
}

function computeGasCost() {
  const days = num(document.getElementById('ma-operating-days'), OPERATING_DAYS_DEFAULT);
  const burners = num(document.getElementById('ma-gas-burners'), 0);
  const hours = num(document.getElementById('ma-gas-hours'), 0);
  const rate = num(document.getElementById('ma-gas-rate'), GAS_RATE_DEFAULT);
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
  const source = panel.dataset.costSource || 'manual';
  if (source === 'ai') {
    const est = dishAiCost.get(panel);
    if (!est) return 0;
    return est.low && est.high ? (est.low + est.high) / 2 : (est.high || est.low || 0);
  }
  return num(panel.querySelector('.ma-manual-cost'));
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
      cmPerPortion: price - ingredientCost,
    };
  }).filter((d) => d.price > 0 || d.volumeDay > 0);
}

function computeQuadrant(dishes, totalVolumeDay) {
  if (!dishes.length || !totalVolumeDay) return dishes.map((d) => ({ ...d, quadrant: null }));
  const fairShare = (1 / dishes.length) * 100;
  const popThreshold = fairShare * 0.70;
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

/* ================= PIE CHART (ported from
   interactive-costing-analysis.js — generic pie math, reused as-is) ================= */

function polarPoint(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describePieSlice(cx, cy, r, startAngle, endAngle) {
  const cappedEnd = Math.min(endAngle, startAngle + 359.98);
  const startPt = polarPoint(cx, cy, r, startAngle);
  const endPt = polarPoint(cx, cy, r, cappedEnd);
  const largeArcFlag = (cappedEnd - startAngle) > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${startPt.x.toFixed(2)} ${startPt.y.toFixed(2)} `
       + `A ${r} ${r} 0 ${largeArcFlag} 1 ${endPt.x.toFixed(2)} ${endPt.y.toFixed(2)} Z`;
}

const PIE_SETTINGS = { viewBoxSize: 120, radius: 52 };

function renderStructurePie(ariaTitle, mix) {
  const segs = [
    { key: 'ingredients', name: 'Ingredients', pct: mix.ingredients },
    { key: 'overhead', name: 'Overhead', pct: mix.overhead },
    { key: 'manpower', name: 'Manpower', pct: mix.manpower },
    { key: 'margin', name: 'Margin', pct: mix.margin },
  ];
  const { viewBoxSize: SIZE, radius: R } = PIE_SETTINGS;
  const CX = SIZE / 2, CY = SIZE / 2;
  const drawTotal = segs.reduce((sum, s) => sum + Math.max(0, s.pct), 0) || 1;

  let cumAngle = 0;
  const slices = segs.map((s) => {
    const sweep = (Math.max(0, s.pct) / drawTotal) * 360;
    if (sweep <= 0) return '';
    const startAngle = cumAngle;
    const endAngle = cumAngle + sweep;
    cumAngle = endAngle;
    return `<path d="${describePieSlice(CX, CY, R, startAngle, endAngle)}" class="pie-seg seg-${s.key}"><title>${s.name} ${Math.round(s.pct)}%</title></path>`;
  }).join('');

  const ariaSummary = segs.map((s) => `${Math.round(s.pct)}% ${s.name}`).join(', ');
  const valueRows = segs.map((s) => {
    const negativeCls = s.pct < 0 ? ' class="is-negative"' : '';
    return `<li><i class="legend-swatch seg-${s.key}"></i>${s.name}<strong${negativeCls}>${Math.round(s.pct)}%</strong></li>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${SIZE} ${SIZE}" class="structure-pie" role="img" aria-label="${ariaTitle}: ${ariaSummary}">${slices}</svg>
    <ul class="structure-pie-legend">${valueRows}</ul>
  `;
}

function renderStructureComparison(mix, guideVenue) {
  const guide = GUIDE_RATIOS[guideVenue] || GUIDE_RATIOS.stall;
  const isLosing = mix.margin < 0;
  document.getElementById('structure-loss-flag').hidden = !isLosing;

  const guideSelect = document.getElementById('guide-venue-select');
  const guideLabel = guideSelect.options[guideSelect.selectedIndex].textContent;

  document.getElementById('structure-pie-yours').innerHTML =
    renderStructurePie('Your numbers' + (isLosing ? ' (losing money)' : ''), mix);
  document.getElementById('structure-pie-guide').innerHTML =
    renderStructurePie('Guide, ' + guideLabel, {
      ingredients: guide.ingredients, overhead: guide.overhead, manpower: guide.manpower, margin: guide.margin,
    });
}

/* ================= RENDER ================= */

function renderDishResults(dishes, fixedPerPortion) {
  const container = document.getElementById('ma-dish-results');
  if (!dishes.length) { container.innerHTML = '<p class="structure-note">Add an item in Margin Calculation to see its breakdown here.</p>'; return; }
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

// The "how true cost is calculated" section — the live per-portion
// figures plus a full per-dish breakdown table, so the formula is
// never just a claim in chat, it's always visible on the page itself.
function renderTrueCostSection(dishes, overheadPerPortion, manpowerPerPortion) {
  const fixedPerPortion = overheadPerPortion + manpowerPerPortion;
  document.getElementById('ma-tc-overhead-portion').textContent = formatRM(overheadPerPortion);
  document.getElementById('ma-tc-manpower-portion').textContent = formatRM(manpowerPerPortion);
  document.getElementById('ma-tc-fixed-portion').textContent = formatRM(fixedPerPortion);

  const rowsEl = document.getElementById('ma-true-cost-rows');
  if (!dishes.length) {
    rowsEl.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted); font-family:var(--font-body);">Add an item in Margin Calculation to see its breakdown here.</td></tr>';
    return;
  }
  rowsEl.innerHTML = dishes.map((d) => {
    const trueCost = d.ingredientCost + fixedPerPortion;
    return `<tr>
      <td>${escapeHTML(d.name)}</td>
      <td>${formatRM(d.ingredientCost)}</td>
      <td>${formatRM(overheadPerPortion)}</td>
      <td>${formatRM(manpowerPerPortion)}</td>
      <td class="ma-tc-total">${formatRM(trueCost)}</td>
    </tr>`;
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

  const points = dishes.map((d) => `
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

  if (!insights.length) insights.push({ level: 'info', text: 'Nothing stands out yet \u2014 add items and costs in Margin Calculation to see where your margin actually sits.' });

  const iconFor = { alert: '\u26A0\uFE0F', warn: '\uD83D\uDD0D', info: '\uD83D\uDCA1' };
  document.getElementById('ma-insights').innerHTML = insights.map((i) => `
    <div class="ma-insight-card ${i.level === 'alert' ? 'is-alert' : i.level === 'warn' ? 'is-warn' : ''}">
      <span class="ma-insight-icon">${iconFor[i.level]}</span>
      <span>${i.text}</span>
    </div>
  `).join('');
}

/* ================= CONTROLLER ================= */

// Wrapped in try/catch, phase by phase — if one computation ever
// throws on some edge-case input, the rest of the page still updates
// instead of silently freezing (which is what "I changed a value and
// nothing happened" almost always actually is: not the target field
// itself failing, but something else upstream in the same function
// throwing before execution ever reached it).
function recalculateAll() {
  try {
    const dishes = collectDishes();
    const totalVolumeDay = dishes.reduce((s, d) => s + d.volumeDay, 0);
    const days = num(document.getElementById('ma-operating-days'), OPERATING_DAYS_DEFAULT);
    const totalVolumeMonth = totalVolumeDay * days;

    const elecCost = computeElectricityCost();
    const waterCost = computeWaterCost();
    const gasResult = computeGasCost();
    const rent = num(document.getElementById('ma-rent'));
    const manpower = num(document.getElementById('ma-manpower'));
    const utilitiesTotal = elecCost + waterCost + gasResult.cost;
    const overheadTotal = rent + utilitiesTotal; // fixed overhead + utilities combined, used internally for per-portion allocation and the structure pies

    document.getElementById('ma-elec-cost').textContent = formatRM(elecCost);
    document.getElementById('ma-water-cost').textContent = formatRM(waterCost);
    document.getElementById('ma-gas-cost').textContent = formatRM(gasResult.cost);
    // Displayed as three separate live figures now (Fixed Overhead,
    // Utilities, Manpower — matching the three-way tab split) rather
    // than one combined "overhead" total, even though overheadTotal
    // above still combines rent+utilities for the actual math.
    document.getElementById('ma-total-fixed').textContent = formatRM(rent);
    document.getElementById('ma-total-utilities').textContent = formatRM(utilitiesTotal);
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
    renderTrueCostSection(classified, overheadPerPortion, manpowerPerPortion);
    renderQuadrantChart(classified);

    const guideVenue = document.getElementById('guide-venue-select').value || wizardAnswers.venue || 'stall';
    const mix = structureMixFromTotals(ingredientTotal, overheadTotal, manpower, revenueTotal);
    renderStructureComparison(mix, guideVenue);
    renderInsights(classified, mix, guideVenue, gasResult.kgPerMonth, targetPct, overallMarginPct);
  } catch (err) {
    console.error('[Margin Audit] recalculateAll failed partway through:', err);
  }
}

/* ================= EXPORT / IMPORT ================= */

function gatherExportData() {
  return {
    savedAt: new Date().toISOString(),
    tool: 'margin-audit-calculator',
    wizardAnswers,
    operatingDays: num(document.getElementById('ma-operating-days'), OPERATING_DAYS_DEFAULT),
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
    guideVenue: document.getElementById('guide-venue-select').value,
    dishes: Array.from(document.querySelectorAll('.ma-dish-panel')).map((p) => ({
      name: p.querySelector('.ma-dish-name').value, price: num(p.querySelector('.ma-dish-price')), volumeDay: num(p.querySelector('.ma-dish-volume')),
      costSource: p.dataset.costSource || 'manual', manualCost: num(p.querySelector('.ma-manual-cost')),
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
  const stamp = new Date().toISOString().slice(0, 7);
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
    document.getElementById('ma-operating-days').value = data.operatingDays || OPERATING_DAYS_DEFAULT;
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
      document.getElementById('ma-gas-rate').value = data.gas.rate || GAS_RATE_DEFAULT;
      const radio = document.querySelector(`[name="ma-gas-tier"][value="${data.gas.tier}"]`);
      if (radio) radio.checked = true;
    }
    document.getElementById('ma-target-margin').value = data.targetMargin || '';
    if (data.guideVenue) document.getElementById('guide-venue-select').value = data.guideVenue;

    document.getElementById('ma-dish-panels').innerHTML = '';
    (data.dishes || []).forEach((d) => {
      const panel = createDishPanel();
      panel.querySelector('.ma-dish-name').value = d.name || '';
      panel.querySelector('.ma-dish-price').value = d.price || 0;
      panel.querySelector('.ma-dish-volume').value = d.volumeDay || 0;
      panel.querySelector('.ma-manual-cost').value = d.manualCost || 0;
      switchDishSource(panel, d.costSource === 'ai' ? 'ai' : 'manual');
    });
    renderDishTabs();

    finishWizard();
    recalculateAll();

    // Loaded data touches every tab in Margin Calculation, so open
    // all four to confirm at a glance that everything came in —
    // easier to close ones you don't need than to go hunting for
    // silently-updated fields behind a closed tab.
    setCalcTabOpen('menu', true);
    setCalcTabOpen('fixed', true);
    setCalcTabOpen('variable', true);
    setCalcTabOpen('manpower', true);

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

  document.getElementById('ma-add-dish').addEventListener('click', () => createDishPanel());
  document.getElementById('guide-venue-select').addEventListener('change', recalculateAll);

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

  // Margin Calculation's four independent tab toggles + Reset All —
  // see setCalcTabOpen/toggleCalcTab/resetAllCalculationData above.
  document.querySelectorAll('.ma-calc-tab[data-calc-tab]').forEach((btn) => {
    btn.addEventListener('click', () => toggleCalcTab(btn.dataset.calcTab));
  });
  document.getElementById('ma-reset-all').addEventListener('click', resetAllCalculationData);
  setCalcTabOpen('menu', true);
  setCalcTabOpen('fixed', false);
  setCalcTabOpen('variable', false);
  setCalcTabOpen('manpower', false);

  // "Pull from" buttons now live inside their relevant tab instead
  // of a shared connector row, but they all still just carry
  // data-open-tool and feed the same rzLoadToolIntoDock — no per-
  // button special-casing needed.
  document.querySelectorAll('[data-open-tool]').forEach((btn) => {
    btn.addEventListener('click', () => rzLoadToolIntoDock(btn.dataset.openTool));
  });
  document.getElementById('tool-dock-close').addEventListener('click', () => setDockVisible(false));

  document.getElementById('rz-back-to-analysis').addEventListener('click', () => {
    document.getElementById('ma-analysis').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('rz-back-to-calc').addEventListener('click', () => {
    document.getElementById('ma-calculation').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  initSync();
  recalculateAll();
}

document.addEventListener('DOMContentLoaded', init);
