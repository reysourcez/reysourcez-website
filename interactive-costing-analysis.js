/* ============================================================
   Interactive Costing Analysis
   Vanilla JS, no dependencies, nothing saved anywhere.
   Reuses the same formatRM/number-parsing patterns as
   menu-calculator.js (copied here rather than shared at
   runtime, so each page stays independent and simple to host
   on its own with no build step).
   ------------------------------------------------------------
   Flow: a short wizard sets context (venue type, permits,
   manpower, utilities) -> that context picks a guide ratio and
   some sensible defaults -> the analysis panel is a live
   break-even calculator (chart + cost-structure comparison)
   that recalculates on every input change.

   TO EXTEND: add a new field to the analysis panel's HTML, add
   it to getInputs(), fold it into computeResults() wherever it
   belongs (variable cost, fixed cost, or its own category).

   Ingredients & packaging can also be filled two other ways besides
   typing a number directly: the "Quick ingredient costing" panel
   below (native to this page, see QUICK INGREDIENT COSTING section)
   or the "Pull from" connector buttons (another tool, in a tab, via
   costing-sync.js). All three just end up setting #ing-cost's value
   and calling recalculate() — nothing downstream needs to know which
   one was used.
   ============================================================ */

console.info('[Interactive Costing Analysis] script build: 2026-09-01-tool-dock');

function formatRM(value) {
  if (!isFinite(value) || value < 0) return 'RM0.00';
  if (value > 0 && value < 0.01) return '< RM0.01';
  return 'RM' + value.toFixed(2);
}

function num(el, fallback) {
  const v = parseFloat(el.value);
  return isFinite(v) ? v : (fallback !== undefined ? fallback : 0);
}

/* ================= WIZARD ================= */

const WIZARD_STEPS = [
  {
    key: 'newSeller',
    question: "Are you new to running an F&B business?",
    options: [
      { value: 'new', label: 'Yes, just starting out' },
      { value: 'experienced', label: "No, I've done this before" },
    ],
  },
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

// Ingredients / Overhead / Manpower / Margin — always in this order,
// always summing to 100. Starting points grounded in general F&B
// benchmarks (food cost ~28-35%, labor ~25-35%, overhead ~20-30% of
// revenue for a full-service format), scaled down for leaner formats.
// Not fixed facts — every one of these is editable in the tool itself.
const GUIDE_RATIOS = {
  home:  { ingredients: 55, overhead: 15, manpower: 15, margin: 15 },
  stall: { ingredients: 50, overhead: 20, manpower: 15, margin: 15 },
  truck: { ingredients: 42, overhead: 20, manpower: 23, margin: 15 },
  store: { ingredients: 35, overhead: 20, manpower: 30, margin: 15 },
};

let wizardStepIndex = 0;
const wizardAnswers = {};

function renderWizardStep() {
  if (wizardStepIndex >= WIZARD_STEPS.length) {
    finishWizard();
    return;
  }
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
      if (wizardStepIndex < WIZARD_STEPS.length) {
        renderWizardStep();
      } else {
        finishWizard();
      }
    });
  });
  document.getElementById('wizard-back').hidden = wizardStepIndex === 0;
}

function goBack() {
  if (wizardStepIndex > 0) {
    wizardStepIndex--;
    renderWizardStep();
  }
}

function finishWizard() {
  document.getElementById('wizard').hidden = true;
  document.getElementById('ica-analysis').hidden = false;
  applyWizardDefaults();
  renderTip();
  recalculate();
}

function editAnswers() {
  document.getElementById('ica-analysis').hidden = true;
  document.getElementById('wizard').hidden = false;
  wizardStepIndex = 0;
  renderWizardStep();
}

function applyWizardDefaults() {
  document.getElementById('guide-venue-select').value = wizardAnswers.venue;

  document.querySelector('#manpower-cost-label .label-text').textContent = wizardAnswers.manpower === 'solo'
    ? "Manpower (include your own wage, even if it's just you)"
    : 'Manpower';

  document.querySelector('#overhead-cost-label .label-text').textContent = wizardAnswers.venue === 'home'
    ? "Overhead (0 if there's no dedicated cost)"
    : 'Overhead';

  // New sellers start on the conservative preset; experienced sellers
  // start optimistic. Either is just a starting point on the slider.
  applyPreset(wizardAnswers.newSeller === 'new' ? 'pessimistic' : 'optimistic');
}

function renderTip() {
  const ratio = GUIDE_RATIOS[wizardAnswers.venue] || GUIDE_RATIOS.stall;
  document.getElementById('ica-tip').textContent =
    `For a ${wizardAnswers.venue}-type setup, a common starting ratio is roughly ` +
    `${ratio.ingredients}% ingredients / ${ratio.overhead}% overhead / ${ratio.manpower}% manpower / ${ratio.margin}% margin. ` +
    `Enter your real numbers below, see how you compare, then come back and adjust next month once you have real sales data.`;
}

/* ================= VOLUME PRESETS ================= */

function applyPreset(kind) {
  const value = kind === 'pessimistic' ? 50 : 300;
  document.getElementById('daily-volume').value = value;
  document.getElementById('daily-volume-num').value = value;
  recalculate();
}

/* ================= CORE CALCULATION ================= */

function getInputs() {
  return {
    ingredient: num(document.getElementById('ing-cost')), // ingredients + packaging combined
    sellingPrice: num(document.getElementById('sell-price')),
    overhead: num(document.getElementById('overhead-cost')),
    manpower: num(document.getElementById('manpower-cost')),
    // Number boxes are authoritative (typing is more precise than a
    // slider); the sliders are just a quick-adjust convenience that
    // stays in sync with them — see wireSliderPair().
    operatingDays: num(document.getElementById('operating-days-num'), 26),
    dailyVolume: num(document.getElementById('daily-volume-num'), 0),
  };
}

// Standard break-even model: Contribution Margin = Price - Variable
// Cost/portion; Break-even Portions = Fixed Costs / Contribution
// Margin. Everything else (per-portion overhead/manpower allocation,
// net profit at the current slider volume) follows from that.
function computeResults(inputs) {
  const variableCost = inputs.ingredient;
  const totalFixed = inputs.overhead + inputs.manpower;
  const monthlyVolume = inputs.dailyVolume * inputs.operatingDays;
  const contributionMargin = inputs.sellingPrice - variableCost;
  const beMonth = contributionMargin > 0 ? totalFixed / contributionMargin : Infinity;
  const beDay = inputs.operatingDays > 0 ? beMonth / inputs.operatingDays : Infinity;
  const monthlyRevenue = inputs.sellingPrice * monthlyVolume;
  const monthlyCost = totalFixed + variableCost * monthlyVolume;
  const netProfit = monthlyRevenue - monthlyCost;

  const overheadPerPortion = monthlyVolume > 0 ? inputs.overhead / monthlyVolume : 0;
  const manpowerPerPortion = monthlyVolume > 0 ? inputs.manpower / monthlyVolume : 0;
  const ingredientsPerPortion = variableCost;
  const marginPerPortion = inputs.sellingPrice - ingredientsPerPortion - overheadPerPortion - manpowerPerPortion;

  return {
    variableCost, totalFixed, monthlyVolume, contributionMargin, beMonth, beDay,
    monthlyRevenue, monthlyCost, netProfit,
    ingredientsPerPortion, overheadPerPortion, manpowerPerPortion, marginPerPortion,
  };
}

function recalculate() {
  const inputs = getInputs();
  const r = computeResults(inputs);

  const marginEl = document.getElementById('res-margin');
  const marginNegative = r.contributionMargin < 0;
  marginEl.textContent = formatRM(Math.abs(r.contributionMargin)) + '/portion' + (marginNegative ? ' (loss)' : '');
  marginEl.closest('.result-card').classList.toggle('is-loss', marginNegative);

  const beMonthEl = document.getElementById('res-be-month');
  beMonthEl.textContent = isFinite(r.beMonth)
    ? Math.ceil(r.beMonth).toLocaleString() + ' portions'
    : 'Not reachable at this price';
  beMonthEl.closest('.result-card').classList.toggle('is-loss', !isFinite(r.beMonth));
  document.getElementById('res-be-day').textContent = isFinite(r.beDay)
    ? Math.ceil(r.beDay).toLocaleString() + ' portions'
    : '\u2014';
  document.getElementById('res-profit').textContent =
    formatRM(Math.abs(r.netProfit)) + (r.netProfit < 0 ? ' loss' : ' profit');
  document.getElementById('res-profit-card').classList.toggle('is-loss', r.netProfit < 0);

  renderChart(inputs, r);
  renderStructure(inputs, r);
}

/* ================= CHART (hand-rolled SVG, no library) ================= */

function renderChart(inputs, r) {
  const svg = document.getElementById('ica-chart');
  const W = 640, H = 380, M = { top: 20, right: 24, bottom: 44, left: 66 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const maxVolumeCandidate = Math.max(
    isFinite(r.beMonth) ? r.beMonth * 1.6 : 0,
    r.monthlyVolume * 1.4,
    100
  );
  const maxVolume = Math.max(100, Math.ceil(maxVolumeCandidate / 100) * 100);
  const maxAmountCandidate = Math.max(
    inputs.sellingPrice * maxVolume,
    r.totalFixed + r.variableCost * maxVolume,
    1
  );
  const maxAmount = maxAmountCandidate * 1.08;

  const x = (vol) => M.left + (vol / maxVolume) * plotW;
  const y = (amt) => M.top + plotH - (Math.max(0, Math.min(amt, maxAmount)) / maxAmount) * plotH;

  const revenueLine = `M ${x(0)} ${y(0)} L ${x(maxVolume)} ${y(inputs.sellingPrice * maxVolume)}`;
  const costLine = `M ${x(0)} ${y(r.totalFixed)} L ${x(maxVolume)} ${y(r.totalFixed + r.variableCost * maxVolume)}`;
  const fixedLine = `M ${x(0)} ${y(r.totalFixed)} L ${x(maxVolume)} ${y(r.totalFixed)}`;

  const beValid = isFinite(r.beMonth) && r.beMonth <= maxVolume;
  const beX = beValid ? x(r.beMonth) : null;
  const beY = beValid ? y(inputs.sellingPrice * r.beMonth) : null;

  const curX = x(r.monthlyVolume);
  const curRevenueY = y(inputs.sellingPrice * r.monthlyVolume);
  const curCostY = y(r.totalFixed + r.variableCost * r.monthlyVolume);

  let gridlines = '';
  for (let i = 0; i <= 5; i++) {
    const gy = M.top + (plotH / 5) * i;
    const amt = maxAmount - (maxAmount / 5) * i;
    gridlines += `<line x1="${M.left}" y1="${gy.toFixed(1)}" x2="${W - M.right}" y2="${gy.toFixed(1)}" class="chart-grid"/>`;
    gridlines += `<text x="${M.left - 8}" y="${(gy + 4).toFixed(1)}" class="chart-axis-label" text-anchor="end">${(amt / 1000).toFixed(1)}k</text>`;
  }
  for (let i = 0; i <= 4; i++) {
    const gx = M.left + (plotW / 4) * i;
    const vol = (maxVolume / 4) * i;
    gridlines += `<text x="${gx.toFixed(1)}" y="${H - M.bottom + 20}" class="chart-axis-label" text-anchor="middle">${Math.round(vol).toLocaleString()}</text>`;
  }

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    ${gridlines}
    <line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${H - M.bottom}" class="chart-axis-line"/>
    <line x1="${M.left}" y1="${H - M.bottom}" x2="${W - M.right}" y2="${H - M.bottom}" class="chart-axis-line"/>
    <path d="${fixedLine}" class="chart-line chart-line-fixed"/>
    <path d="${costLine}" class="chart-line chart-line-cost"/>
    <path d="${revenueLine}" class="chart-line chart-line-revenue"/>
    ${beX !== null ? `
      <line x1="${beX.toFixed(1)}" y1="${M.top}" x2="${beX.toFixed(1)}" y2="${H - M.bottom}" class="chart-be-line"/>
      <circle cx="${beX.toFixed(1)}" cy="${beY.toFixed(1)}" r="5" class="chart-point chart-point-be"/>
      <text x="${beX.toFixed(1)}" y="${(beY - 12).toFixed(1)}" class="chart-point-label" text-anchor="middle">Break-even</text>
    ` : ''}
    <line x1="${curX.toFixed(1)}" y1="${M.top}" x2="${curX.toFixed(1)}" y2="${H - M.bottom}" class="chart-current-line"/>
    <circle cx="${curX.toFixed(1)}" cy="${curRevenueY.toFixed(1)}" r="4" class="chart-point chart-point-current"/>
    <circle cx="${curX.toFixed(1)}" cy="${curCostY.toFixed(1)}" r="4" class="chart-point chart-point-current"/>
    <text x="${(W / 2).toFixed(1)}" y="${H - 4}" class="chart-axis-title" text-anchor="middle">Sales Volume (portions / month)</text>
    <text x="16" y="${(M.top + plotH / 2).toFixed(1)}" class="chart-axis-title" text-anchor="middle" transform="rotate(-90 16 ${(M.top + plotH / 2).toFixed(1)})">Amount (RM)</text>
  `;
}

/* ================= COST STRUCTURE COMPARISON ================= */

// Ingredients/Overhead/Manpower are never negative; Margin is
// selling price minus those three, so it CAN go negative — and by
// construction these four always sum to exactly 100%, which is what
// lets "your numbers" and the guide compare on the same scale.
function structureMix(ingredientsPerPortion, overheadPerPortion, manpowerPerPortion, marginPerPortion, sellingPrice) {
  const sp = sellingPrice > 0 ? sellingPrice : 1;
  return {
    ingredients: (ingredientsPerPortion / sp) * 100,
    overhead: (overheadPerPortion / sp) * 100,
    manpower: (manpowerPerPortion / sp) * 100,
    margin: (marginPerPortion / sp) * 100,
  };
}

function renderStructure(inputs, r) {
  const guideVenue = document.getElementById('guide-venue-select').value;
  const guide = GUIDE_RATIOS[guideVenue] || GUIDE_RATIOS.stall;
  const yours = structureMix(r.ingredientsPerPortion, r.overheadPerPortion, r.manpowerPerPortion, r.marginPerPortion, inputs.sellingPrice);

  const container = document.getElementById('structure-bars');
  container.innerHTML =
    renderStructureBar('Your numbers', yours, yours.margin < 0) +
    renderStructureBar(`Guide: ${guideVenue}`, { ingredients: guide.ingredients, overhead: guide.overhead, manpower: guide.manpower, margin: guide.margin }, false);
}

// Bar segment widths use the TRUE percentages (ingredients/overhead/
// manpower are always >=0; margin is clamped to 0 only for drawing,
// since a negative width isn't renderable). If margin is deeply
// negative, the other three segments legitimately sum past 100% and
// the bar's overflow:hidden clips them — that visual overflow IS the
// signal that costs no longer fit inside the selling price.
function renderStructureBar(label, mix, isLosing) {
  const segs = [
    { key: 'ingredients', name: 'Ingredients', pct: mix.ingredients },
    { key: 'overhead', name: 'Overhead', pct: mix.overhead },
    { key: 'manpower', name: 'Manpower', pct: mix.manpower },
    { key: 'margin', name: 'Margin', pct: Math.max(0, mix.margin) },
  ];
  const segmentsHTML = segs.map((s) => {
    let inner = '';
    if (s.pct >= 15) inner = `${Math.round(s.pct)}% ${s.name}`;
    else if (s.pct >= 6) inner = `${Math.round(s.pct)}%`;
    return `<span class="seg seg-${s.key}" style="width:${Math.max(0, s.pct)}%" title="${s.name} ${s.pct.toFixed(0)}%">${inner ? `<span class="seg-label">${inner}</span>` : ''}</span>`;
  }).join('');

  return `
    <div class="structure-row">
      <span class="structure-label">${label}${isLosing ? ' <span class="loss-flag">LOSING MONEY</span>' : ''}</span>
      <div class="structure-bar">${segmentsHTML}</div>
    </div>
  `;
}

/* ================= INIT ================= */

// Keeps a <input type="range"> and its paired <input type="number">
// in sync either direction. The number box is authoritative for
// calculations (see getInputs()) — the slider just follows it,
// clamped to its own min/max, since a slider can't represent a value
// outside its own range but the number box can.
function wireSliderPair(rangeId, numberId) {
  const range = document.getElementById(rangeId);
  const numberInput = document.getElementById(numberId);

  range.addEventListener('input', () => {
    numberInput.value = range.value;
    recalculate();
  });
  numberInput.addEventListener('input', () => {
    const v = parseFloat(numberInput.value);
    if (isFinite(v)) {
      range.value = Math.max(parseFloat(range.min), Math.min(parseFloat(range.max), v));
    }
    recalculate();
  });
}

// Shows a small "synced from X" badge next to a field label so it's
// clear a number came from another tool, not a manual guess. Manual
// editing still works afterward — this is a starting value, not a lock.
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

// Same payload shape either way a number reaches this page: over
// BroadcastChannel from a separate tab (initSync below), or handed
// directly from a tool running inside the tool dock (see
// rzRunIsolated further down) — this is the one place that actually
// knows what to do with that payload, so both paths share it rather
// than duplicating the field-mapping twice.
function handleSyncPayload(data) {
  if (data.source === 'menu-calculator' && typeof data.costPerPortion === 'number') {
    document.getElementById('ing-cost').value = data.costPerPortion.toFixed(2);
    markSynced('#ing-cost-label', 'Menu Portion Creator' + (data.dishName ? ' (' + data.dishName + ')' : ''));
    if (typeof data.sellingPrice === 'number' && data.sellingPrice > 0) {
      document.getElementById('sell-price').value = data.sellingPrice.toFixed(2);
      markSynced('#sell-price-label', 'Menu Portion Creator' + (data.dishName ? ' (' + data.dishName + ')' : ''));
    }
    recalculate();
  }
  if (data.source === 'printing-calculator' && typeof data.costPerPortion === 'number') {
    document.getElementById('ing-cost').value = data.costPerPortion.toFixed(2);
    markSynced('#ing-cost-label', 'Printing Calculator' + (data.dishName ? ' (' + data.dishName + ')' : ''));
    if (typeof data.sellingPrice === 'number' && data.sellingPrice > 0) {
      document.getElementById('sell-price').value = data.sellingPrice.toFixed(2);
      markSynced('#sell-price-label', 'Printing Calculator' + (data.dishName ? ' (' + data.dishName + ')' : ''));
    }
    recalculate();
  }
  if (data.source === 'overhead-manpower-calculator') {
    if (typeof data.overheadMonthly === 'number') {
      document.getElementById('overhead-cost').value = data.overheadMonthly.toFixed(2);
      markSynced('#overhead-cost-label', 'Overhead & Manpower');
    }
    if (typeof data.manpowerMonthly === 'number') {
      document.getElementById('manpower-cost').value = data.manpowerMonthly.toFixed(2);
      markSynced('#manpower-cost-label', 'Overhead & Manpower');
    }
    recalculate();
  }
}

function initSync() {
  if (typeof rzListen !== 'function') return;
  rzListen(handleSyncPayload);
}

/* ================= TOOL DOCK (fetch-inject-execute) =================
   Loads another tool's actual page — its real markup AND its real
   script — into a dock near the bottom of this page, instead of
   opening it in a new tab. Two real problems had to be solved for
   this to actually work:

   1. Every tool page independently declares things like
      `let rzInitialized`, `function init()`, `function formatRM()`
      at the top level (confirmed by checking all four files
      directly). Paste another tool's script onto this page as-is
      and the second declaration throws — "already declared" — and
      NONE of that tool's code runs, buttons just sit there dead.
      Fixed by wrapping the fetched script in its own IIFE (its own
      private bubble) before running it, so nothing it declares can
      collide with anything already on this page.

   2. Cross-tab sync runs over BroadcastChannel, which by design
      never delivers a message back to the channel it came from —
      and an injected tool shares this page's ONE channel with this
      page's own listener (see rzGetChannel in costing-sync.js,
      which caches one channel on window). So an injected tool's
      normal rzBroadcast() calls would just vanish, silently. Fixed
      by shadowing `rzBroadcast` INSIDE that same IIFE bubble, so
      the call still happens exactly like the tool's own code
      expects, but lands directly on handleSyncPayload above instead
      of going out over a channel that can't hear itself.

   Only one tool lives in the dock at a time — opening a different
   one discards the old DOM (and its listeners, via normal garbage
   collection) and loads the new one fresh. Re-clicking the tool
   that's ALREADY open just scrolls back down to it, rather than
   reloading and losing whatever's been typed in there.

   Needs an actual server — this page fetching its own sibling pages
   is blocked by the browser if you just double-click the HTML file
   open (file://). Test this specific feature on a real local server
   or the deployed site, not by opening the file directly.
   ============================================================ */

const TOOL_DOCK_CONFIG = {
  'menu-calculator': { scriptUrl: 'menu-calculator.js', theme: 'theme-menu' },
  'overhead-manpower-calculator': { scriptUrl: 'overhead-manpower-calculator.js', theme: 'theme-overhead' },
  'printing-calculator': { inlineScript: true, theme: 'theme-printing' },
};

// Printing Calculator keeps its logic inline in the page rather than
// its own .js file, so its script has to be pulled out of the
// fetched HTML instead of fetched separately. The OTHER script tags
// on that page (costing-sync.js, nav-dropdown.js, both with a src
// attribute) are deliberately skipped — this page already has its
// own copies of those loaded.
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

// Shows or hides the whole dock (and everything that only makes
// sense while it's visible: the back-to-top button, the top "Hide"
// button, and which connector button reads as active) WITHOUT
// touching #tool-dock-body's contents. That's the whole point —
// hiding is not the same as closing. The tool's actual DOM, its
// running script's closures, and whatever's been typed into it all
// stay exactly as they were; showing it again just makes that same
// state visible, same as re-clicking its own connector button does.
function setDockVisible(visible) {
  document.getElementById('tool-dock').hidden = !visible;
  document.getElementById('rz-back-to-top').hidden = !visible;
  document.getElementById('tool-dock-hide-btn').hidden = !visible;
  if (!visible) updateConnectorActiveState(null);
}

// Highlights whichever connector button matches the tool currently
// SHOWING in the dock — .is-active + the per-tool accent color
// already existed in styles.css for this, just wasn't wired up to
// anything yet.
function updateConnectorActiveState(activeKey) {
  document.querySelectorAll('[data-open-tool]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.openTool === activeKey);
  });
}

async function rzLoadToolIntoDock(key) {
  if (typeof RZ_TOOLS === 'undefined' || !RZ_TOOLS[key]) return;
  const dockConfig = TOOL_DOCK_CONFIG[key];
  const tool = RZ_TOOLS[key];
  const dock = document.getElementById('tool-dock');
  const body = document.getElementById('tool-dock-body');
  const titleEl = document.getElementById('tool-dock-title');

  // Already loaded — whether currently showing or hidden via the
  // Hide/close button — just reveal it and scroll down, don't
  // refetch and lose whatever's been typed in there. Loading a
  // DIFFERENT tool below still does a full fresh reload, which is
  // the natural way to reset one (see chat re: a dedicated reset
  // button — this covers the same need without one).
  if (dock.dataset.openTool === key) {
    setDockVisible(true);
    updateConnectorActiveState(key);
    dock.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  dock.className = 'tool-dock ' + dockConfig.theme;
  dock.dataset.openTool = key;
  titleEl.textContent = tool.label;
  body.innerHTML = '<p class="tool-dock-status">Loading\u2026</p>';
  setDockVisible(true);
  updateConnectorActiveState(key);
  dock.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const html = await fetch(tool.url).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const main = doc.querySelector('main');
    if (!main) throw new Error('couldn\u2019t find that page\u2019s content');

    // Drop the marketing intro + "how it's calculated" footer note —
    // already flagged rz-embed-hide in the source HTML from an
    // earlier, different attempt at this, reused here. HIDDEN rather
    // than removed on purpose: the intro section also holds each
    // tool's #save-pdf button, and that tool's own init() looks it
    // up unconditionally (document.getElementById('save-pdf')
    // .addEventListener(...)) — remove the element outright and that
    // line throws on a null reference, which silently kills every
    // line after it in init(), including wiring up "+ Add Menu" /
    // "+ Add Job". Hiding keeps the element queryable without
    // showing it.
    main.querySelectorAll('.rz-embed-hide').forEach((el) => { el.hidden = true; });
    main.querySelectorAll('#rz-switcher').forEach((el) => el.remove()); // safe to fully remove — nothing looks this one up anymore

    const scriptText = dockConfig.inlineScript
      ? rzExtractInlineScript(doc)
      : await fetch(dockConfig.scriptUrl).then((r) => r.text());

    body.innerHTML = '';
    Array.from(main.children).forEach((section) => {
      // Unwrap this section's own .wrap div — it exists to center
      // and pad content on that tool's OWN full page, which would
      // just double up inside .tool-dock-body's own padding here.
      // Keep the <section> itself: its class (.calc-panel /
      // .menu-builder) carries real spacing/divider styling, not
      // just centering.
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

let rzInitialized = false;

function init() {
  if (rzInitialized) return;
  rzInitialized = true;
  renderWizardStep();
  document.getElementById('wizard-back').addEventListener('click', goBack);
  document.getElementById('ica-edit-answers').addEventListener('click', editAnswers);
  document.getElementById('save-pdf-ica').addEventListener('click', () => window.print());
  document.getElementById('guide-venue-select').addEventListener('change', recalculate);

  ['ing-cost', 'sell-price', 'overhead-cost', 'manpower-cost'].forEach((id) => {
    document.getElementById(id).addEventListener('input', recalculate);
  });
  wireSliderPair('operating-days', 'operating-days-num');
  wireSliderPair('daily-volume', 'daily-volume-num');
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
  });

  document.querySelectorAll('[data-open-tool]').forEach((btn) => {
    btn.addEventListener('click', () => rzLoadToolIntoDock(btn.dataset.openTool));
  });

  document.getElementById('tool-dock-close').addEventListener('click', () => setDockVisible(false));
  document.getElementById('tool-dock-hide-btn').addEventListener('click', () => setDockVisible(false));

  document.getElementById('rz-back-to-top').addEventListener('click', () => {
    document.getElementById('ica-analysis').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  initSync();
}

document.addEventListener('DOMContentLoaded', init);
