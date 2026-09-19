/* ============================================================
   Margin Analysis
   (page renamed from "Margin Audit" 2026-09-06, per
   NAV_ORDER_STANDARD.md — the file itself keeps the old filename
   on purpose, only the visitor-facing title/heading/nav label
   changed. Comments below still say "Margin Audit" here and there
   where it reads more naturally as a description of the tool's
   JOB rather than its current display name — that's intentional,
   not a missed rename.)

   Vanilla JS, no dependencies, nothing saved anywhere except a
   file the vendor explicitly downloads themselves (see EXPORT /
   IMPORT section — that file never touches our server).
   ------------------------------------------------------------
   PURPOSE: reverse the direction of Interactive Costing Analysis.
   That tool asks "what SHOULD I charge?" This one asks "given
   what I DO charge, what's actually happening?" — a vendor enters
   their current menu prices, and everything else (true cost,
   utility cost, whether the margin is healthy) is worked out for
   them.

   HARD RULE, same discipline as every other calculator on this
   site: nothing in this file ever calculates a margin, a ratio, or
   a break-even with AI — all of that is deterministic JS, same as
   the EPF/SOCSO tables in overhead-manpower-calculator.js,
   auditable, never guessed. As of 2026-09-08 this file makes NO
   Gemini/Worker calls of its own at all (see COST MODEL below) —
   previously it had its own AI-estimate/manual dish-costing UI
   calling margin-audit-proxy-worker.js directly; that's gone.

   ------------------------------------------------------------
   COST MODEL (2026-09-08 change — see MARGIN_AUDIT_HANDOFF.md and
   MULTI_MENU_SYNC_PLAN.md for the full brief this implements):

   Menu Calculator now has its own Detailed / Simple / AI-estimate
   modes built into every menu block, and — the actual fix this
   required — every block broadcasts ITS OWN updates over the sync
   channel now, tagged with a stable blockId, instead of only ever
   the first block on the page. That makes Margin Audit's own,
   separate AI-estimate/manual cost-entry UI pure duplication: two
   disconnected ways to arrive at a cost for what might be the same
   dish. So it's removed. A dish panel here now asks for exactly
   two things only Margin Audit needs — Current price (RM) and
   Sold / day — and gets its ingredient cost from ONE place only:
   syncing with the matching item in Menu Calculator, either by
   pulling it in through the tool dock (see below) or automatically,
   live, if Menu Calculator happens to be open in another tab.

   De-duping synced dishes: every dish panel that came from a sync
   carries panel.dataset.syncedBlockId, set once when it's first
   created. A later payload for the SAME blockId updates that exact
   panel's cost (and its stated price, and its name) in place
   instead of creating a duplicate — see handleSyncPayload() and
   findDishPanelByBlockId(). A dish added manually via "+ Add menu
   item" has no syncedBlockId and just sits at "not yet synced"
   (ingredient cost reads as RM0.00 in every calculation below)
   until something matches it, if ever — deliberately not required,
   since MARGIN_AUDIT_HANDOFF.md left "should an unsynced dish even
   be allowed to exist" as an open question rather than answering
   it; allowing it seemed like the safer, more reversible default.

   ------------------------------------------------------------
   PAGE STRUCTURE (2026-09-05 rewrite, unaffected by the cost-model
   change above): the page is two clearly separate sections instead
   of one long stack of boxes:

     RESULTS (#ma-analysis, top; labeled "Results" on the page
     itself, NOT "Margin Analysis" — that label is reserved for the
     page's own name now, so the section eyebrow doesn't just echo
     the H1 back at the visitor) — read-only output. True cost
     breakdown, earnings summary, per-item breakdown, the quadrant
     chart, cost-structure pies, insights. Nothing here is a cost
     input; "Your target margin %" and the guide-venue dropdown only
     change how results are COMPARED or labeled.

     MARGIN CALCULATION (#ma-calculation, near the footer) — every
     actual cost input, including the dish list that used to be a
     separate box up top called "Your menu, at today's prices".
     Split into four tabs — Menu / Fixed Overhead / Variable
     Overhead / Manpower. 2026-09-17: now a single-open panel-
     toggle.js group (see initCalcTabs, PANEL_TOGGLE_STANDARD.md) —
     opening one closes whatever else was open, clicking the same
     one again closes it back to nothing. Was an independent
     show/hide toggle per tab before that (several open at once,
     same idea as a native <details> element); this page was named
     directly in the standard as still stacking, so that's gone.
     Closing a tab never clears what was typed into it — every input
     keeps its value and listeners regardless of visibility, that
     part's unchanged. Reset All is the one control here that
     actually clears data, and needs a confirm() first.

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
   (switch between dishes, always exactly one shown, out of
   panel-toggle.js's scope by its own "mandatory selection" carve-
   out), and now so are the outer calc-tabs (single-open, but
   CAN close to nothing — that's what puts them in scope for
   panel-toggle.js where the dish tabs aren't). Don't confuse
   initCalcTabs (outer, registers with panel-toggle.js) with
   switchToDish (inner, dish-level, its own fixed switcher).

   Pulling a dish in from Menu Calculator goes through the "Pull
   from Menu Portion Creator" button inside the Menu tab (see TOOL
   DOCK section below). Printing Calculator is intentionally NOT
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
   lives inside Margin Calculation — "pull from" buttons are
   embedded directly in the tab whose data they fill.

   STRUCTURE COMPARISON: pie-chart based, ported from
   interactive-costing-analysis.js's renderStructurePie/
   describePieSlice/polarPoint — generic pie math, not page-
   specific, so it's reused as-is rather than reinvented as bars.
   ============================================================ */

console.info('[Margin Analysis] script build: 2026-09-17-v9-panel-toggle-cross-tool-export');

/* ================= CONFIG =================
   Everything a layperson might reasonably need to change lives
   here, with the current value on the left and nothing else in
   this file needing to change to update it. No PROXY_ENDPOINT here
   anymore — this file makes no Worker/Gemini calls of its own as of
   2026-09-08 (see the COST MODEL note at the top of this file).
   margin-audit-proxy-worker.js is still deployed and still holds a
   real key, just with no caller left in this file; see the change
   notes for the "what to do with it now" flag. */

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
  // No default dish anymore - Menu Analyzer starts blank on purpose
  // (see 2026-09-09 change notes). renderDishTabs() sets the correct
  // empty-state/pull-button visibility either way, whether this is a
  // brand-new session (zero dishes) or importData() already
  // populated some before calling finishWizard().
  renderDishTabs();
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
   2026-09-17: retrofitted onto panel-toggle.js per
   PANEL_TOGGLE_STANDARD.md — this page was named directly in that
   doc as one of the pages "still stacking." Previously these four
   (Menu / Fixed Overhead / Variable Overhead / Manpower) were
   independent toggles that could all be open together, same idea as
   a native <details> element. Under the new site-wide standard,
   "closed to nothing" being a real state for this group (nothing
   forces one to always stay open) means it's a genuinely-optional
   panel set, not a mandatory tab strip — so it now follows the same
   rule as every other retrofitted panel on the site: click a tab
   open, click that SAME tab again to close it, opening a DIFFERENT
   tab always closes whatever was open first. Never two open
   together. See initCalcTabs() in INIT for the registration; nothing
   about what's INSIDE each panel changed — every input keeps its
   value and listeners regardless of visibility, same as before.
   Deliberately a separate panel-toggle GROUP from the tool dock
   below ('ma-tool-dock') — a "Pull from" button lives inside a calc
   panel and opens the dock underneath it, and closing the calc panel
   just because its own dock opened would hide the very field the
   dock is about to fill.
   This remains a DIFFERENT mechanism from the dish tabs inside the
   Menu panel (switchToDish, further down), which are a fixed,
   always-exactly-one-shown switcher, not a closable panel set — out
   of scope for panel-toggle.js by the standard's own "mandatory
   selection" carve-out, same as Menu Calculator's own cost-mode
   tabs. */

function initCalcTabs() {
  document.querySelectorAll('.ma-calc-tab[data-calc-tab]').forEach((btn) => {
    const key = btn.dataset.calcTab;
    const panel = document.querySelector(`.ma-calc-panel[data-calc-panel="${key}"]`);
    if (!panel) return;
    rzRegisterPanel('ma-calc-tabs', key, {
      triggerEl: btn,
      panelEl: panel,
      // aria-expanded isn't part of what panel-toggle.js manages
      // itself (only visibility + the active class), so it's kept in
      // sync here via the same onOpen/onClose hooks the tool dock
      // uses for its own fetch-on-open work.
      onOpen: () => btn.setAttribute('aria-expanded', 'true'),
      onClose: () => btn.setAttribute('aria-expanded', 'false'),
    });
  });
  // Menu Analyzer starts open (matches every prior version of this
  // page) — done through the real toggle function, not by hand-
  // setting .hidden/is-active in the HTML, so panel-toggle.js's own
  // openKey bookkeeping is correct from the first click onward rather
  // than starting out-of-sync with what's visually already showing.
  rzTogglePanel('ma-calc-tabs', 'menu');
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
  renderDishTabs(); // shows the empty state again, no orphan dish recreated

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

  // Back to "only Menu Analyzer open" regardless of which tab (if
  // any) was open when Reset was clicked — rzCloseAllPanels first so
  // the rzTogglePanel call below is guaranteed to OPEN 'menu' rather
  // than close it if it happened to already be the open one.
  rzCloseAllPanels('ma-calc-tabs');
  rzTogglePanel('ma-calc-tabs', 'menu');

  const feedback = document.getElementById('ma-dock-feedback');
  if (feedback) feedback.textContent = '\u2713 Cleared \u2014 Margin Calculation is back to its starting defaults.';

  recalculateAll();
}

/* ================= DISH PANELS (tab-queue pattern) ================= */

// panel -> ingredient cost number, set ONLY by a matching sync
// payload from Menu Calculator (see handleSyncPayload). No entry in
// this map means "not yet synced" — getDishCost() below reads that
// as 0, same as any other empty numeric field on this site, rather
// than needing a separate "is this synced" flag threaded everywhere.
const dishSyncedCost = new WeakMap();
// Informational only (2026-09-17, see COST_BUFFER_STANDARD.md) — the
// % of Menu Calculator's Cost Buffer already folded into the number
// above, purely for renderDishSyncStatus() to show where a dish's
// cost comes from. Never read by any calculation: dishSyncedCost is
// already the final, true-cost-ready figure either way.
const dishSyncedBufferPct = new WeakMap();
let dishIdCounter = 0;

// Snapshot of recalculateAll()'s own numbers, refreshed every time it
// runs. Exists so printCostSummary() can build its report from the
// EXACT figures already on screen, rather than recomputing everything
// a second time in a separate function that could quietly drift out
// of sync with the live page over time. null until the first
// recalculateAll() call (i.e. before the wizard finishes).
let lastComputedResults = null;

function createDishPanel() {
  dishIdCounter++;
  const id = 'ma-dish-' + dishIdCounter;
  const panel = document.createElement('div');
  panel.className = 'ma-dish-panel';
  panel.dataset.dishId = id;
  panel.innerHTML = `
    <div class="menu-block-header">
      <input type="text" class="menu-name-input ma-dish-name" value="Dish ${dishIdCounter}" aria-label="Dish name">
      <button type="button" class="remove-block-btn ma-remove-dish no-print" aria-label="Remove this item">Remove item</button>
    </div>
    <div class="ma-dish-grid">
      <label>Current price (RM) <input type="number" class="ma-dish-price" inputmode="decimal" min="0" step="0.01" value="0.00"></label>
      <label>Sold / day <input type="number" class="ma-dish-volume" inputmode="decimal" min="0" step="1" value="0"></label>
    </div>
    <p class="ma-sync-line" data-state="unsynced"></p>
  `;
  document.getElementById('ma-dish-panels').appendChild(panel);

  panel.querySelector('.ma-dish-name').addEventListener('input', () => { renderDishTabs(); recalculateAll(); });
  panel.querySelectorAll('.ma-dish-price, .ma-dish-volume').forEach((el) => {
    el.addEventListener('input', recalculateAll);
  });

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

  renderDishSyncStatus(panel);
  switchToDish(id);
  return panel;
}

// Finds the dish panel already tagged with this Menu Calculator
// blockId, if any — the whole de-dupe mechanism in one place. Plain
// array search rather than a CSS attribute-selector string, so an
// unusual blockId never needs escaping to be queried safely.
function findDishPanelByBlockId(blockId) {
  return Array.from(document.querySelectorAll('.ma-dish-panel'))
    .find((p) => p.dataset.syncedBlockId === blockId) || null;
}

// The one place that renders whether a dish's ingredient cost has
// ever been synced from Menu Calculator, and what it is if so. Called
// right after a panel is created (starts unsynced) and again every
// time a matching sync payload updates it.
function renderDishSyncStatus(panel) {
  const line = panel.querySelector('.ma-sync-line');
  if (!line) return;
  const cost = dishSyncedCost.get(panel);
  if (typeof cost === 'number') {
    const bufferPct = dishSyncedBufferPct.get(panel);
    const bufferNote = bufferPct > 0 ? ` (incl. ${bufferPct}% cost buffer)` : '';
    line.dataset.state = 'synced';
    line.innerHTML = `Ingredient cost: <strong>${formatRM(cost)}</strong>${bufferNote}<span class="ma-sync-source">\u2190 synced from Menu Calculator</span>`;
  } else {
    line.dataset.state = 'unsynced';
    line.textContent = 'Ingredient cost not yet synced \u2014 pull it in below, or edit the matching item in Menu Calculator (this tab or another) and it\u2019ll sync here on its own.';
  }
}

// Only the active dish's full card is shown at a time; the tab row
// beside "+ Add menu item" lets you switch which one that is. Same
// "hide siblings, show one" pattern already used by Menu Calculator's
// menu blocks, Food Worth's dish tabs, and Printing Calculator's job
// tabs — ported here rather than reinvented as vertical stacking.
// This is dish-level switching, separate from the outer Menu/Fixed/
// Variable/Manpower calc-tabs (see initCalcTabs above), which are
// independent toggles, not a switcher.
function switchToDish(dishId) {
  document.querySelectorAll('.ma-dish-panel').forEach((p) => {
    p.hidden = (p.dataset.dishId !== dishId);
  });
  renderDishTabs();
}

// Menu Analyzer starts with zero dishes and stays that way until
// something syncs in from Menu Calculator - there's no manual
// "+ Add" anymore (see 2026-09-09 change notes: a manually-created
// dish had no blockId, so it could never connect to anything, which
// read as "broken" rather than "empty"). This just toggles the
// empty-state message; the "Open Menu Calculator" button itself is
// always visible regardless. 2026-09-10: it used to live partly
// inside this same toggle, alongside a second "pull in another item"
// button that only showed once dishes existed - the two hidden
// states could both end up false at once, showing both buttons
// together. Now there's only one button, permanently visible, so
// that particular failure mode is gone structurally, not just fixed
// for this one case.
function updateDishEmptyState() {
  const hasAnyDish = !!document.querySelector('.ma-dish-panel');
  const emptyState = document.getElementById('ma-dish-empty-state');
  if (emptyState) emptyState.hidden = hasAnyDish;
}

// Tabs only appear once there's something to switch between — a
// single item just shows its card directly, no tab row overhead.
function renderDishTabs() {
  updateDishEmptyState();
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

/* ================= CROSS-TOOL SYNC (dishes: created via tool
   dock pulls; overhead/manpower: filled directly) ================= */

function handleSyncPayload(data) {
  if (data.source === 'menu-calculator' && typeof data.costPerPortion === 'number') {
    // Every menu block in Menu Calculator now broadcasts its OWN
    // updates, tagged with a stable blockId (e.g. "menublock-3") —
    // previously only the first block on that page ever broadcast
    // anything, so every synced dish here used to collapse onto one.
    // A payload with no blockId at all (an older/unexpected shape)
    // falls back to always creating a fresh dish, same as before —
    // there's nothing to de-dupe against without one.
    const blockId = typeof data.blockId === 'string' && data.blockId ? data.blockId : null;
    let panel = blockId ? findDishPanelByBlockId(blockId) : null;
    const isNewDish = !panel;
    if (!panel) {
      panel = createDishPanel();
      if (blockId) panel.dataset.syncedBlockId = blockId;
    }

    if (data.dishName) panel.querySelector('.ma-dish-name').value = data.dishName;
    // costPerPortion already includes Menu Calculator's own Cost
    // Buffer % (2026-09-16, see COST_BUFFER_STANDARD.md) whenever
    // that toggle was on for the source dish — nothing here needs to
    // know that or re-derive anything, the true-cost math downstream
    // just keeps using whatever number arrives, same as always.
    // costBufferPct itself rides along purely for the sync-status
    // line below to show its provenance, same "cheap now, useful
    // later" spirit as the standard's own field.
    dishSyncedCost.set(panel, data.costPerPortion);
    dishSyncedBufferPct.set(panel, typeof data.costBufferPct === 'number' ? data.costBufferPct : 0);
    if (typeof data.sellingPrice === 'number' && data.sellingPrice > 0) {
      panel.querySelector('.ma-dish-price').value = data.sellingPrice.toFixed(2);
    }
    renderDishSyncStatus(panel);
    renderDishTabs();
    // 2026-09-17: no longer force-opens the Menu Analyzer tab here —
    // under panel-toggle.js's single-open rule that would mean a
    // background sync (e.g. Menu Calculator open live in another
    // browser tab) could yank away whatever tab the person is
    // currently looking at. The feedback line below already confirms
    // success without touching what's on screen; in the common case
    // (using the tool dock's own "Open Menu Calculator" button) Menu
    // Analyzer is already the open tab anyway, since that's where the
    // button lives.

    const feedback = document.getElementById('ma-dock-feedback');
    if (feedback) {
      const label = panel.querySelector('.ma-dish-name').value;
      feedback.textContent = isNewDish
        ? `\u2713 Added "${label}" to your menu from Menu Calculator \u2014 ${formatRM(data.costPerPortion)}/portion.`
        : `\u2713 Updated "${label}" from Menu Calculator \u2014 ${formatRM(data.costPerPortion)}/portion.`;
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
      // the one external tool). 2026-09-17: used to force BOTH tabs
      // open here, which is exactly the stacking panel-toggle.js now
      // forbids — under the single-open rule there's no single tab
      // that's "correct" to force to when two different fields
      // updated at once, so this no longer touches tab visibility at
      // all and leans on the feedback line below (which already
      // names both) instead.
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
   rather than a single shared connector row.

   2026-09-17: retrofitted onto panel-toggle.js per
   PANEL_TOGGLE_STANDARD.md, same standard and same reference
   implementation (interactive-costing-analysis.js's
   initToolDockConnectors/rzFillToolDock) as the calc-tabs above —
   this page was the other surface that doc named directly as
   stacking. The old rzLoadToolIntoDock() both toggled visibility AND
   did the fetch/inject; that's now split in two, matching the
   reference: panel-toggle.js's rzTogglePanel() owns opening/closing/
   scrolling the shared dock element, and rzFillToolDock() below is
   purely its onOpen hook — the fetch-inject-execute work, nothing
   about visibility.

   One wrinkle the reference didn't have: Fixed Overhead's and
   Manpower's own "Pull from Overhead & Manpower Calculator" buttons
   both load the SAME underlying tool. They're registered as two
   DISTINCT panel-toggle keys anyway (own trigger button each, so
   each button's own active-state highlight stays correct — a shared
   key would only remember the last-registered trigger), but both
   keys' onOpen calls rzFillToolDock with the same real tool key
   ('overhead-manpower-calculator'). rzFillToolDock's own
   already-loaded check (dock.dataset.openTool === toolKey) still
   works correctly switching between those two triggers: closing one
   and opening the other hides then immediately re-shows the same
   dock element within one synchronous call, so there's no visible
   flicker, and the content is recognised as already-loaded and left
   alone rather than refetched. ============================================================ */

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

// Registers all three "Pull from" buttons into one panel-toggle
// group sharing the single #tool-dock element as their panelEl —
// exactly what panel-toggle.js's shared-panelEl-across-keys support
// is for (see its own header comment). Click a tool's own button
// while it's showing and the dock now closes, matching every other
// retrofitted panel on the site, instead of the old re-show-and-
// scroll no-op.
function initToolDockConnectors() {
  const dock = document.getElementById('tool-dock');

  rzRegisterPanel('ma-tool-dock', 'menu-calculator', {
    triggerEl: document.getElementById('ma-pull-menu'),
    panelEl: dock,
    onOpen: () => rzFillToolDock('menu-calculator'),
  });
  rzRegisterPanel('ma-tool-dock', 'overhead-fixed', {
    triggerEl: document.getElementById('ma-pull-overhead-fixed'),
    panelEl: dock,
    onOpen: () => rzFillToolDock('overhead-manpower-calculator'),
  });
  rzRegisterPanel('ma-tool-dock', 'overhead-manpower', {
    triggerEl: document.getElementById('ma-pull-overhead-manpower'),
    panelEl: dock,
    onOpen: () => rzFillToolDock('overhead-manpower-calculator'),
  });

  document.getElementById('tool-dock-close').addEventListener('click', () => rzCloseAllPanels('ma-tool-dock'));
}

// Purely the fetch-inject-execute work now — panel-toggle.js has
// already made the dock visible and is about to (or has just)
// scrolled it into place by the time this runs. Takes the REAL tool
// key ('menu-calculator' / 'overhead-manpower-calculator'), not the
// panel-toggle key, since two different panel-toggle keys above both
// resolve to the same tool here.
async function rzFillToolDock(toolKey) {
  if (typeof RZ_TOOLS === 'undefined' || !RZ_TOOLS[toolKey]) return;
  const dockConfig = TOOL_DOCK_CONFIG[toolKey];
  if (!dockConfig) return; // e.g. printing-calculator — not offered from this page
  const tool = RZ_TOOLS[toolKey];
  const dock = document.getElementById('tool-dock');
  const body = document.getElementById('tool-dock-body');
  const titleEl = document.getElementById('tool-dock-title');
  const feedback = document.getElementById('ma-dock-feedback');
  if (feedback) feedback.textContent = '';

  dock.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Already this exact tool sitting in the dock (we were just
  // hidden, or the OTHER trigger for this same tool was clicked) —
  // nothing to refetch, and refetching would lose whatever's been
  // typed in there. Switching to the genuinely different tool below
  // still does a full fresh reload, the natural way to reset one.
  if (dock.dataset.openTool === toolKey) return;

  dock.className = 'tool-dock ' + dockConfig.theme;
  dock.dataset.openTool = toolKey;
  titleEl.textContent = tool.label;
  body.innerHTML = '<p class="tool-dock-status">Loading\u2026</p>';

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

    rzRunIsolated(scriptText, toolKey);
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

// Ingredient cost comes from exactly one place now: whatever Menu
// Calculator last broadcast for this dish (see dishSyncedCost /
// handleSyncPayload). A dish with no entry in that map hasn't synced
// yet and reads as 0 here — the true-cost math downstream already
// handles a 0 ingredient cost fine, so nothing needs a separate
// "is this synced" branch beyond the sync-status line itself.
function getDishCost(panel) {
  const cost = dishSyncedCost.get(panel);
  return typeof cost === 'number' ? cost : 0;
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

// Multi-product break-even, not the single-product version ICA uses.
// ICA's is exact: fixed costs ÷ ONE contribution margin, because it's
// one product. A whole menu has no single CM, so every dish's CM gets
// weighted by its actual share of monthly volume into one blended
// CM/portion first, then fixed costs ÷ that. Correct for the CURRENT
// sales mix; if that mix shifts a lot as volume changes, the real
// break-even shifts with it — said explicitly in the box copy rather
// than left as a silent assumption.
function renderBreakEven(dishes, days, totalVolumeMonth, revenueTotal, totalFixedMonthly) {
  const monthEl = document.getElementById('ma-be-month');
  const dayEl = document.getElementById('ma-be-day');
  const revEl = document.getElementById('ma-be-revenue');
  const noteEl = document.getElementById('ma-be-note');

  const totalCmMonth = dishes.reduce((s, d) => s + d.cmPerPortion * d.volumeDay * days, 0);
  const avgCmPerPortion = totalVolumeMonth > 0 ? totalCmMonth / totalVolumeMonth : 0;
  const avgPricePerPortion = totalVolumeMonth > 0 ? revenueTotal / totalVolumeMonth : 0;
  const avgCostPerPortion = avgPricePerPortion - avgCmPerPortion;
  const cmrPct = avgPricePerPortion > 0 ? (avgCmPerPortion / avgPricePerPortion) * 100 : 0;

  if (!dishes.length || avgCmPerPortion <= 0) {
    monthEl.textContent = 'Not reachable';
    dayEl.textContent = 'Not reachable';
    revEl.textContent = 'Not reachable';
    noteEl.textContent = dishes.length
      ? 'Your blended margin per portion is zero or negative at today\u2019s prices \u2014 more volume alone won\u2019t reach break-even; something in price or cost needs to change first.'
      : 'Add items in Menu Analyzer to see this.';
    return { avgPricePerPortion, avgCostPerPortion, avgCmPerPortion, cmrPct, beMonth: null, beDay: null, beRevenue: null, totalFixedMonthly };
  }

  const beMonth = totalFixedMonthly / avgCmPerPortion;
  const beDay = beMonth / days;
  const beRevenue = beMonth * avgPricePerPortion;

  monthEl.textContent = Math.ceil(beMonth).toLocaleString() + ' portions';
  dayEl.textContent = Math.ceil(beDay).toLocaleString() + ' portions';
  revEl.textContent = formatRM(beRevenue);

  const vsActual = totalVolumeMonth - beMonth;
  noteEl.textContent = vsActual >= 0
    ? `At today's sales mix, you're clearing break-even by about ${Math.round(vsActual).toLocaleString()} portions/month.`
    : `At today's sales mix, you're about ${Math.round(Math.abs(vsActual)).toLocaleString()} portions/month short of break-even.`;

  return { avgPricePerPortion, avgCostPerPortion, avgCmPerPortion, cmrPct, beMonth, beDay, beRevenue, totalFixedMonthly };
}

function renderDishResults(dishes, fixedPerPortion) {
  const container = document.getElementById('ma-dish-results');
  if (!dishes.length) { container.innerHTML = '<p class="structure-note">Nothing here yet \u2014 price a dish in Menu Calculator and it\u2019ll show up in Menu Analyzer, then here.</p>'; return; }
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
    rowsEl.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted); font-family:var(--font-body);">Nothing here yet \u2014 price a dish in Menu Calculator and it\u2019ll show up in Menu Analyzer, then here.</td></tr>';
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

    // GPM = revenue minus ingredient cost only, before overhead/manpower
    // are even counted — matches the standard textbook definition, and
    // is deliberately a different number from NPM (overallMarginPct)
    // above, which is what's left after literally everything.
    const grossProfit = revenueTotal - ingredientTotal;
    const gpmPct = revenueTotal > 0 ? (grossProfit / revenueTotal) * 100 : 0;

    document.getElementById('ma-total-revenue').textContent = formatRM(revenueTotal);
    document.getElementById('ma-gross-margin').textContent = gpmPct.toFixed(1) + '%';
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

    const beResult = renderBreakEven(dishes, days, totalVolumeMonth, revenueTotal, overheadTotal + manpower);
    renderDishResults(classified, fixedPerPortion);
    renderTrueCostSection(classified, overheadPerPortion, manpowerPerPortion);
    renderQuadrantChart(classified);

    const guideVenue = document.getElementById('guide-venue-select').value || wizardAnswers.venue || 'stall';
    const mix = structureMixFromTotals(ingredientTotal, overheadTotal, manpower, revenueTotal);
    renderStructureComparison(mix, guideVenue);
    renderInsights(classified, mix, guideVenue, gasResult.kgPerMonth, targetPct, overallMarginPct);

    lastComputedResults = {
      days, rent, manpower, elecCost, waterCost, gasCost: gasResult.cost, utilitiesTotal,
      revenueTotal, ingredientTotal, overheadTotal, totalVolumeMonth,
      gpmPct, overallMarginPct, netProfit,
      breakEven: beResult,
      mix, guideVenue,
      dishes: classified,
    };
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
      name: p.querySelector('.ma-dish-name').value,
      price: num(p.querySelector('.ma-dish-price')),
      volumeDay: num(p.querySelector('.ma-dish-volume')),
      syncedBlockId: p.dataset.syncedBlockId || null,
      syncedCost: numOrZero(dishSyncedCost.get(p)),
    })),
    resultSummary: {
      revenueMonth: document.getElementById('ma-total-revenue').textContent,
      netProfitMonth: document.getElementById('ma-net-profit').textContent,
      overallMarginPct: document.getElementById('ma-overall-margin').textContent,
    },
  };
}

// Shared Blob-and-anchor download, same shape EXPORT_IMPORT_FORMAT.md
// documents and every other tool's own exportXxxData() already uses —
// copied here rather than imported, same "each page stays independent,
// no build step" reasoning as the formatRM/num duplication elsewhere.
function downloadJSONFile(filename, dataObj) {
  const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 2026-09-17: the ONE new piece EXPORT_IMPORT_FORMAT.md actually asked
// this page to build — Costing Analysis's importer has read the
// receiving half of this shape since 2026-09-08 (importedQuadrants,
// matched by blockId then name) but nothing here ever produced a file
// in it. Deliberately a SEPARATE, much smaller file than
// gatherExportData()'s own private save format below: this one exists
// purely for another TOOL to read (just enough to answer "what
// quadrant is this dish"), not to reload this page's own state, so it
// carries none of the rent/manpower/gas/wizard-answer fields that
// round-trip is built around.
function gatherCrossToolExportData() {
  const dishes = (lastComputedResults ? lastComputedResults.dishes : [])
    .filter((d) => d.quadrant) // no quadrant (e.g. zero total volume) -> nothing useful to hand off
    .map((d) => ({
      blockId: d.panel && d.panel.dataset.syncedBlockId ? d.panel.dataset.syncedBlockId : undefined,
      name: d.name,
      // Title-cased to match the doc's own worked example ("Star", not
      // "star") — computeQuadrant()'s internal lowercase is fine
      // either way per that doc's own wording, this is just tidier
      // for whatever reads it back and displays it verbatim.
      quadrant: d.quadrant.charAt(0).toUpperCase() + d.quadrant.slice(1),
      price: d.price,
      volumeDay: d.volumeDay,
      cost: d.ingredientCost,
      contributionMargin: d.cmPerPortion,
    }));
  return {
    rzExportType: 'margin-audit-calculator',
    rzExportVersion: 1,
    exportedAt: new Date().toISOString(),
    dishes,
  };
}

function exportCrossToolData() {
  downloadJSONFile('margin-analysis-export.json', gatherCrossToolExportData());
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
      // Files saved before 2026-09-08 carry costSource/manualCost
      // instead — those fields are simply absent here and the dish
      // just comes back in as "not yet synced" rather than failing to
      // import; re-pulling from Menu Calculator picks it back up.
      if (d.syncedBlockId) panel.dataset.syncedBlockId = d.syncedBlockId;
      if (d.syncedCost > 0) dishSyncedCost.set(panel, d.syncedCost);
      renderDishSyncStatus(panel);
    });
    renderDishTabs();

    finishWizard();
    recalculateAll();

    // 2026-09-17: used to force all four calc-tabs open here so
    // everything reloaded was visible at a glance — impossible now
    // that calc-tabs are single-open (panel-toggle.js,
    // PANEL_TOGGLE_STANDARD.md). Not a lost confirmation though:
    // Results (finishWizard/recalculateAll above) already reflects
    // every reloaded number the moment this runs, and Results —
    // not the input tabs — is this page's own designed primary
    // confirmation surface (see the page intro copy). initCalcTabs()
    // already leaves Menu Analyzer as the one open tab by default,
    // which is left as-is here rather than second-guessed.

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

  // 2026-09-17 bug fix: this button (and the printed copy's own text,
  // two lines down) always CLAIMED to produce something re-importable
  // next month, but only ever called window.print() — no file was
  // ever written, so "Load previous month's data" (importData(), which
  // reads data.tool === 'margin-audit-calculator' JSON) had nothing
  // valid to load. gatherExportData() already builds exactly the
  // shape importData() expects; the only thing missing was actually
  // downloading it. Doing that FIRST, before the print dialog opens,
  // so a slow/cancelled print never gets in the way of the file
  // itself landing in Downloads.
  const stamp = new Date().toISOString().slice(0, 10);
  downloadJSONFile(`margin-audit-${stamp}.json`, data);

  let view = document.getElementById('ma-print-data-view');
  if (!view) {
    view = document.createElement('div');
    view.id = 'ma-print-data-view';
    document.body.appendChild(view);
  }
  const lines = [
    'REYSOURCEZ MARGIN ANALYSIS \u2014 DATA SNAPSHOT',
    'Saved: ' + new Date().toLocaleString(),
    '',
    'Venue: ' + (wizardAnswers.venue || '\u2014') + ' | Manpower: ' + (wizardAnswers.manpower || '\u2014'),
    'Operating days/month: ' + data.operatingDays,
    '',
    'DISHES',
    ...data.dishes.map((d) => `  ${d.name} | price RM${d.price.toFixed(2)} | ${d.volumeDay}/day | ingredient cost: ${d.syncedCost > 0 ? 'RM' + d.syncedCost.toFixed(2) + ' (synced from Menu Calculator)' : 'not yet synced'}`),
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

/* ---- Cost summary printout ----
   A second, separate print flow from Save as PDF (which prints the
   whole Margin Analysis section) and Save data for next month (a raw
   JSON snapshot for re-import). This one is a compact, single-purpose
   report: seven fixed sections, each showing the formula AND that
   formula worked through with today's actual numbers, not just the
   result. Built from lastComputedResults — the exact snapshot
   recalculateAll() already produced for the numbers on screen right
   now, not a second independent computation that could drift from
   what the page is actually showing.

   Section 7 ("What can be improved") reuses this page's existing
   #ma-insights content verbatim rather than calling Gemini. That's a
   deliberate choice, not a placeholder: this file makes no AI/Worker
   calls at all as of the 2026-09-08 sync-only cost model (see the
   COST MODEL note at the top of this file), and standing up a fresh
   live call for a print flow specifically would add a network
   dependency, latency, and a failure mode this page doesn't currently
   have anywhere else. If a genuinely AI-narrated version of this
   section is wanted later, margin-audit-proxy-worker.js needs the
   same generateContent endpoint fix menu-calculator-proxy-worker.js
   and food-worth-proxy-worker.js already got (it's flagged with the
   identical bug, per those sessions' own notes), and this function
   would need a fetch call added — narrating these already-computed
   numbers into prose, same as every other AI use on this site, never
   computing new ones itself. */

function buildPrintSummaryHTML() {
  const r = lastComputedResults;
  if (!r || !r.dishes.length) {
    return '<p>Add at least one item in Menu Analyzer, and fill in overhead/manpower, before printing a cost summary \u2014 there\u2019s nothing to summarize yet.</p>';
  }

  const fixedCost = r.rent + r.manpower;
  const be = r.breakEven;
  const beReachable = be && be.beMonth !== null;

  const dishRows = r.dishes.map((d) => `
    <tr>
      <td>${escapeHTML(d.name)}</td>
      <td>${d.popPct !== undefined ? d.popPct.toFixed(1) + '%' : '\u2014'}</td>
      <td>${formatRM(d.cmPerPortion)}</td>
      <td>${d.quadrant ? d.quadrant.toUpperCase() : '\u2014'}</td>
    </tr>`).join('');

  return `
    <h1>Reysourcez Margin Analysis \u2014 Cost Summary</h1>
    <p class="ps-meta">Printed ${new Date().toLocaleString()} &middot; Venue: ${escapeHTML(wizardAnswers.venue || '\u2014')} &middot; Operating days/month: ${r.days}</p>

    <h2>1. Fixed Cost</h2>
    <div class="ma-formula">
      <div>Fixed cost = Rent, licenses &amp; misc. + Manpower</div>
      <div class="ps-worked">= ${formatRM(r.rent)} + ${formatRM(r.manpower)} = <strong>${formatRM(fixedCost)}</strong></div>
    </div>

    <h2>2. Variable Costs</h2>
    <div class="ma-formula">
      <div>Variable costs = Electricity + Water + Gas</div>
      <div class="ps-worked">= ${formatRM(r.elecCost)} + ${formatRM(r.waterCost)} + ${formatRM(r.gasCost)} = <strong>${formatRM(r.utilitiesTotal)}</strong></div>
    </div>

    <h2>3. Contribution Margin Ratio (CMR)</h2>
    <div class="ma-formula">
      <div>CMR = (Avg. price/portion \u2212 Avg. ingredient cost/portion) \u00f7 Avg. price/portion \u00d7 100</div>
      <div class="ps-worked">Avg. price/portion = ${formatRM(r.revenueTotal)} \u00f7 ${Math.round(r.totalVolumeMonth).toLocaleString()} portions = ${formatRM(be.avgPricePerPortion)}</div>
      <div class="ps-worked">Avg. ingredient cost/portion = ${formatRM(r.ingredientTotal)} \u00f7 ${Math.round(r.totalVolumeMonth).toLocaleString()} portions = ${formatRM(be.avgCostPerPortion)}</div>
      <div class="ps-worked">CMR = (${formatRM(be.avgPricePerPortion)} \u2212 ${formatRM(be.avgCostPerPortion)}) \u00f7 ${formatRM(be.avgPricePerPortion)} \u00d7 100 = <strong>${be.cmrPct.toFixed(1)}%</strong></div>
    </div>

    <h2>4. Break-Even Point (BEP)</h2>
    <div class="ma-formula">
      <div>BEP (portions/month) = Total fixed costs \u00f7 Avg. contribution margin per portion</div>
      <div>Total fixed costs = Fixed cost + Variable costs</div>
      <div class="ps-worked">Total fixed costs = ${formatRM(fixedCost)} + ${formatRM(r.utilitiesTotal)} = ${formatRM(be.totalFixedMonthly)}</div>
      ${beReachable ? `
      <div class="ps-worked">Avg. CM/portion = ${formatRM(be.avgPricePerPortion)} \u2212 ${formatRM(be.avgCostPerPortion)} = ${formatRM(be.avgCmPerPortion)}</div>
      <div class="ps-worked">BEP = ${formatRM(be.totalFixedMonthly)} \u00f7 ${formatRM(be.avgCmPerPortion)} = <strong>${Math.ceil(be.beMonth).toLocaleString()} portions/month</strong> (\u2248 ${Math.ceil(be.beDay).toLocaleString()}/day)</div>
      <div class="ps-worked">BEP revenue/month = ${Math.ceil(be.beMonth).toLocaleString()} portions \u00d7 ${formatRM(be.avgPricePerPortion)} = <strong>${formatRM(be.beRevenue)}</strong></div>
      ` : `
      <div class="ps-worked"><strong>Not reachable</strong> at today's prices \u2014 blended contribution margin per portion is zero or negative, so added volume alone cannot cover fixed costs.</div>
      `}
      <p class="ps-note">Assumes today's sales mix (which dishes sell relative to each other) holds roughly steady as volume changes.</p>
    </div>

    <h2>5. Cost Structure</h2>
    <div class="ma-formula">
      <div>Category % = Category total \u00f7 Total revenue \u00d7 100</div>
      <div class="ps-worked">Ingredients (Food Cost %) = ${formatRM(r.ingredientTotal)} \u00f7 ${formatRM(r.revenueTotal)} \u00d7 100 = <strong>${r.mix.ingredients.toFixed(1)}%</strong></div>
      <div class="ps-worked">Overhead = ${formatRM(r.overheadTotal)} \u00f7 ${formatRM(r.revenueTotal)} \u00d7 100 = <strong>${r.mix.overhead.toFixed(1)}%</strong></div>
      <div class="ps-worked">Manpower = ${formatRM(r.manpower)} \u00f7 ${formatRM(r.revenueTotal)} \u00d7 100 = <strong>${r.mix.manpower.toFixed(1)}%</strong></div>
      <div class="ps-worked">Margin (Net Profit Margin) = 100% \u2212 above three = <strong>${r.mix.margin.toFixed(1)}%</strong></div>
    </div>

    <h2>6. Menu Category (Stars / Plowhorses / Puzzles / Dogs)</h2>
    <p class="ps-note">Star = popular (\u226570% of a fair volume share) and above-average contribution margin. Plowhorse = popular, below-average margin. Puzzle = below the popularity threshold, above-average margin. Dog = neither.</p>
    <table class="ps-table">
      <thead><tr><th>Dish</th><th>Popularity</th><th>CM / portion</th><th>Category</th></tr></thead>
      <tbody>${dishRows}</tbody>
    </table>

    <h2>7. What Can Be Improved</h2>
    <div class="ma-insight-list">${document.getElementById('ma-insights').innerHTML}</div>
  `;
}

function printCostSummary() {
  recalculateAll(); // make sure lastComputedResults reflects anything just typed
  let view = document.getElementById('ma-print-summary-view');
  if (!view) {
    view = document.createElement('div');
    view.id = 'ma-print-summary-view';
    document.body.appendChild(view);
  }
  view.innerHTML = buildPrintSummaryHTML();
  document.body.classList.add('ma-printing-summary');
  window.print();
}
window.addEventListener('afterprint', () => document.body.classList.remove('ma-printing-summary'));

/* ================= INIT ================= */

let rzInitialized = false;

function init() {
  if (rzInitialized) return;
  rzInitialized = true;

  renderWizardStep();
  document.getElementById('wizard-back').addEventListener('click', goBack);
  document.getElementById('ma-edit-answers').addEventListener('click', editAnswers);
  document.getElementById('ma-save-pdf').addEventListener('click', () => window.print());
  document.getElementById('ma-print-summary').addEventListener('click', printCostSummary);
  document.getElementById('ma-export-data').addEventListener('click', exportCrossToolData);
  document.getElementById('ma-save-data').addEventListener('click', saveDataSnapshot);
  document.getElementById('ma-import-input').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
  });

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

  // Margin Calculation's four calc-tabs (single-open, panel-toggle.js)
  // + the tool dock's three "Pull from" triggers (a separate
  // panel-toggle group) + Reset All. See initCalcTabs() and
  // initToolDockConnectors() above for why these are two different
  // groups rather than one.
  initCalcTabs();
  document.getElementById('ma-reset-all').addEventListener('click', resetAllCalculationData);
  initToolDockConnectors();

  document.getElementById('rz-back-to-results').addEventListener('click', () => {
    document.getElementById('ma-analysis').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.getElementById('rz-back-to-calc').addEventListener('click', () => {
    document.getElementById('ma-calculation').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  initSync();
  recalculateAll();
}

document.addEventListener('DOMContentLoaded', init);
