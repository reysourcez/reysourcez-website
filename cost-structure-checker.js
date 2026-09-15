/* ============================================================
   Cost Structure Checker
   Vanilla JS, no dependencies, nothing saved anywhere — same rule
   as every other tool on this site (see AI_BUILD_BRIEF.md).
   ------------------------------------------------------------
   WHAT THIS TOOL DOES: picks a venue type (for the right guide
   ratio, same GUIDE_RATIOS table Interactive Costing Analysis /
   Margin Analysis / Rental Calculator already use) -> lets the
   person optionally enter their real Ingredients/Overhead/
   Manpower/Margin % -> shows four category cards, auto-flagging
   any category running on the wrong side of the guide band ->
   for whichever categories they flag (auto-suggested or picked
   by hand — flagging never requires entering numbers at all),
   shows the full cost-creep CAUSE_LIBRARY for that category as a
   tick-list -> every ticked cause expands into concrete, standard
   F&B/menu-engineering guidance, right there on the page ->
   builds a consolidated, impact-sorted Action Plan from whatever
   was ticked -> optionally sends that same selection to a Gemini
   proxy Worker for a short prioritized narrative on top of it.

   The deterministic guidance (CAUSE_LIBRARY, in the sibling
   cost-structure-checker-content.js) is the tool's real backbone
   and works completely with zero setup, zero cost, and zero
   Worker configured — same "AI enhances, never gates" shape as
   every other AI-touched tool on this site (Market Radar's own
   insight button, Food Worth's recipe breakdown, Crypto Radar's
   AI read): the Worker only ever narrates/prioritizes causes the
   person already selected, it never invents a new diagnosis or a
   number that wasn't already on the page. See the Worker's own
   PROMPT for the exact hard rules given to it.

   NUMBER ENTRY IS OPTIONAL BY DESIGN: the core interaction this
   tool exists for is "pick a cost area, tick what's going wrong"
   — typing in real percentages is a bonus diagnostic aid, not a
   gate in front of that. A person who just has a gut feeling
   their food cost "feels high" can go straight to ticking causes
   without ever touching the % inputs.

   ID PREFIX: every element this file queries by id is prefixed
   csc- (Cost Structure Checker), even where a shared id like
   "guide-venue-select" is already used safely elsewhere on this
   site. Deliberate, not cautious-for-no-reason — see
   MARGIN_AUDIT_CHANGE_NOTES.md's 2026-09-09 entry for the exact,
   already-documented bug this avoids (two tools' unscoped queries
   finding and hiding each other's elements when one gets embedded
   in the other's tool dock). This page doesn't currently embed or
   get embedded by anything, but there's no cost to being safe by
   construction rather than by luck.
   ============================================================ */

console.info('[Cost Structure Checker] script build: 2026-09-13-v1');

/* ================= CONFIG =================
   Everything a layperson might want to retune without reading
   the rest of this file lives here, or in the sibling content
   file (cost-structure-checker-content.js) for anything that's
   pure wording/content rather than a number or a behaviour. */

// How many percentage points a category can sit away from its
// guide number before it counts as "High"/"Low" rather than
// "Within range". 5 points either side is generous enough that
// normal month-to-month noise doesn't falsely flag a category —
// see the Methodology section on the page itself for the same
// note in plain language.
const BAND_TOLERANCE_PTS = 5;

// Wastage & Par-Level Tracker starting assumptions — all three
// are also editable live on the page itself; these only set what
// a fresh session starts at.
const DEFAULT_PERIOD_DAYS = 7;
const DEFAULT_LEAD_TIME_DAYS = 2;
const DEFAULT_SAFETY_BUFFER_DAYS = 1;

// Soft usage cap for the AI panel, same pattern/reasoning as
// food-worth-calculator.js and market-radar.js: protects the
// shared Gemini quota on the free tier from one browser using it
// all up, nothing more sinister than that.
const MAX_ANALYSES_PER_DAY = 20;
const USAGE_STORAGE_KEY = 'csc-usage';

// Paste your deployed Worker's URL here — see
// cost-structure-checker-proxy-worker.js's own header for deploy
// steps. Tool works completely without this; only the "Get your
// AI action plan" button needs it.
const WORKER_ENDPOINT = 'https://cost-structure-checker-proxy-worker.reysourcez-ent.workers.dev/';

/* ================= SHARED UTILITIES ================= */

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function num(el, fallback) {
  if (!el) return fallback !== undefined ? fallback : 0;
  const v = parseFloat(el.value);
  return isFinite(v) ? v : (fallback !== undefined ? fallback : 0);
}
function formatPct(v, decimals) {
  if (!isFinite(v)) return '\u2014';
  return v.toFixed(decimals !== undefined ? decimals : 1) + '%';
}

/* ================= SOFT USAGE CAP (same pattern as food-worth-calculator.js / market-radar.js) ================= */

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

/* ================= WIZARD (venue type only — one step) ================= */

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
  document.getElementById('csc-analysis').hidden = false;
  document.getElementById('csc-guide-venue-select').value = wizardAnswers.venue;
  renderTip();
  renderCategoryCards();
  renderStructureComparison();
  recalcWastageTracker();
}
function editAnswers() {
  document.getElementById('csc-analysis').hidden = true;
  document.getElementById('wizard').hidden = false;
  wizardStepIndex = 0;
  renderWizardStep();
}

function renderTip() {
  const g = GUIDE_RATIOS[wizardAnswers.venue];
  document.getElementById('csc-tip').textContent =
    `For a ${VENUE_LABELS[wizardAnswers.venue].toLowerCase()} setup, the classic benchmark scales to roughly ` +
    `${g.ingredients}% ingredients / ${g.overhead}% overhead / ${g.manpower}% manpower / ${g.margin}% margin. ` +
    `Enter your real numbers below if you know them, or just pick a cost area you suspect is a problem and start ticking causes — you don't need the numbers to do that.`;
}

/* ================= "YOUR NUMBERS" — % inputs + status ================= */

function getEnteredPct(cat) {
  const el = document.getElementById('csc-pct-' + cat);
  const raw = el.value;
  if (raw === '') return null;
  const v = parseFloat(raw);
  return isFinite(v) ? v : null;
}

// The one function every status badge, card colour, and auto-flag
// decision in this file goes through. `badDirection` (from
// CATEGORY_META) is what lets Margin be treated as a problem when
// LOW rather than HIGH, without a single if/else naming "margin"
// anywhere else in this file.
function computeStatus(cat, pct) {
  if (pct == null) return 'unset';
  const guide = GUIDE_RATIOS[wizardAnswers.venue][CATEGORY_META[cat].guideKey];
  const diff = pct - guide;
  if (Math.abs(diff) <= BAND_TOLERANCE_PTS) return 'within';
  return diff > 0 ? 'high' : 'low';
}
function isProblemStatus(cat, status) {
  if (status === 'unset' || status === 'within') return false;
  return status === CATEGORY_META[cat].badDirection;
}

function updatePctTotal() {
  const vals = CATEGORY_ORDER.map((c) => getEnteredPct(c));
  const enteredCount = vals.filter((v) => v != null).length;
  const sum = vals.reduce((s, v) => s + (v || 0), 0);
  const el = document.getElementById('csc-pct-total');
  if (enteredCount === 0) {
    el.textContent = 'Enter your numbers above, or skip straight to picking a cost area below.';
    el.classList.remove('is-off');
  } else {
    el.textContent = `Total entered: ${sum.toFixed(1)}%` + (enteredCount < 4 ? ' (still missing ' + (4 - enteredCount) + ' \u2014 fine to leave blank)' : (Math.abs(sum - 100) > 2 ? ' \u2014 doesn\u2019t quite add up to 100%, worth double-checking' : ''));
    el.classList.toggle('is-off', enteredCount === 4 && Math.abs(sum - 100) > 2);
  }
}

/* ================= STRUCTURE PIE (ported \u2014 generic pie math, reused
   as-is from interactive-costing-analysis.js / margin-audit-calculator.js /
   rental-calculator.js; see those files' own comments for why this is
   copied per-page rather than shared at runtime) ================= */

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
    const startAngle = cumAngle, endAngle = cumAngle + sweep;
    cumAngle = endAngle;
    return `<path d="${describePieSlice(CX, CY, R, startAngle, endAngle)}" class="pie-seg seg-${s.key}"><title>${s.name} ${Math.round(s.pct)}%</title></path>`;
  }).join('');
  const ariaSummary = segs.map((s) => `${Math.round(s.pct)}% ${s.name}`).join(', ');
  const valueRows = segs.map((s) => {
    const negativeCls = s.pct < 0 ? ' class="is-negative"' : '';
    return `<li><i class="legend-swatch seg-${s.key}"></i>${s.name}<strong${negativeCls}>${Math.round(s.pct)}%</strong></li>`;
  }).join('');
  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" class="structure-pie" role="img" aria-label="${ariaTitle}: ${ariaSummary}">${slices}</svg>
    <ul class="structure-pie-legend">${valueRows}</ul>`;
}

// "Yours" only renders once all four % fields are filled \u2014 a
// pie built from a partial set would just be misleading. A flat
// grey ring stands in otherwise, same "waiting for data, not
// broken" placeholder food-worth-calculator.js's macro donut uses.
function renderStructureComparison() {
  const pcts = { ingredients: getEnteredPct('ingredients'), overhead: getEnteredPct('overhead'), manpower: getEnteredPct('manpower'), margin: getEnteredPct('margin') };
  const allEntered = CATEGORY_ORDER.every((c) => pcts[c] != null);
  const yoursEl = document.getElementById('csc-structure-pie-yours');
  if (allEntered) {
    yoursEl.innerHTML = renderStructurePie('Your numbers', pcts);
  } else {
    yoursEl.innerHTML = `<svg viewBox="0 0 120 120" class="structure-pie" role="img" aria-label="Waiting for your numbers"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--line)" stroke-width="18"/></svg>
      <p class="structure-note" style="margin:0;">Fill in all four fields above to see this.</p>`;
  }
  const guideVenue = document.getElementById('csc-guide-venue-select').value || wizardAnswers.venue;
  const guide = GUIDE_RATIOS[guideVenue];
  const guideSelect = document.getElementById('csc-guide-venue-select');
  const guideLabel = guideSelect.options[guideSelect.selectedIndex].textContent;
  document.getElementById('csc-structure-pie-guide').innerHTML = renderStructurePie('Guide, ' + guideLabel, guide);
}

/* ================= CATEGORY DIAGNOSTIC CARDS ================= */

// null = no manual override yet (follow the auto-suggested flag
// from the entered %); true/false = the person explicitly toggled
// this category open or closed themselves, which always wins over
// whatever the numbers suggest.
const categoryState = {
  ingredients: { manualFlag: null, expanded: false, selectedCauses: new Set() },
  overhead: { manualFlag: null, expanded: false, selectedCauses: new Set() },
  manpower: { manualFlag: null, expanded: false, selectedCauses: new Set() },
  margin: { manualFlag: null, expanded: false, selectedCauses: new Set() },
};

function statusLabel(cat, status) {
  if (status === 'unset') return 'Not entered';
  if (status === 'within') return 'Within range';
  const meta = CATEGORY_META[cat];
  const word = status === 'high' ? 'Running high' : 'Running low';
  return word + (isProblemStatus(cat, status) ? '' : ' \u2014 not necessarily a problem');
}

function renderCategoryCards() {
  const container = document.getElementById('csc-category-grid');
  container.innerHTML = CATEGORY_ORDER.map((cat) => {
    const meta = CATEGORY_META[cat];
    const guide = GUIDE_RATIOS[wizardAnswers.venue][meta.guideKey];
    const pct = getEnteredPct(cat);
    const status = computeStatus(cat, pct);
    const problem = isProblemStatus(cat, status);
    const state = categoryState[cat];
    const flagged = state.manualFlag !== null ? state.manualFlag : problem;
    const statusCls = status === 'unset' ? 'is-unset' : (problem ? 'is-problem' : (status === 'within' ? 'is-ok' : 'is-neutral'));
    return `
      <div class="csc-category-card seg-${cat} ${flagged ? 'is-flagged' : ''}" data-category="${cat}">
        <div class="csc-category-card-head">
          <span class="csc-category-swatch seg-${cat}"></span>
          <div>
            <h3>${meta.label}</h3>
            <p class="csc-category-hint">${meta.shortHint}</p>
          </div>
        </div>
        <div class="csc-category-numbers">
          <span>Guide: <strong>~${guide}%</strong></span>
          <span>Yours: <strong>${pct != null ? formatPct(pct) : '\u2014'}</strong></span>
          <span class="csc-status-badge ${statusCls}">${statusLabel(cat, status)}${problem ? ' \u2014 suggested' : ''}</span>
        </div>
        <button type="button" class="btn btn-secondary csc-category-toggle" data-category="${cat}" aria-expanded="${flagged}">
          ${flagged ? 'Hide causes' : "I'm having a problem here \u2014 show causes"}
        </button>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.csc-category-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.category;
      const state = categoryState[cat];
      const currentlyFlagged = state.manualFlag !== null ? state.manualFlag : isProblemStatus(cat, computeStatus(cat, getEnteredPct(cat)));
      state.manualFlag = !currentlyFlagged;
      if (state.manualFlag) activeCauseTab = cat; // just flagged \u2014 show its causes immediately, not whatever tab happened to be open
      renderCategoryCards();
      renderCauseSections();
      renderActionPlan();
    });
  });

  renderCauseSections();
}

/* ================= CAUSE CHECKLISTS ================= */

function isCategoryFlagged(cat) {
  const state = categoryState[cat];
  const problem = isProblemStatus(cat, computeStatus(cat, getEnteredPct(cat)));
  return state.manualFlag !== null ? state.manualFlag : problem;
}

function causeKey(cat, id) { return cat + ':' + id; }

// Which flagged category's cause list is currently the one panel
// showing. Per AI_BUILD_BRIEF.md's UI/UX standards (2026-09-08):
// "if you're building more than one independently-togglable panel,
// make opening one close the others rather than letting them
// stack" — so when two-plus categories are flagged at once, this
// renders them as mutually-exclusive tabs (reusing .menu-tabs/
// .menu-tab-btn, the exact same component Menu Calculator's dish
// tabs / Food Worth's dish tabs / Rental Calculator's equipment
// tabs already use for "only the active one's full card is shown")
// rather than stacking every flagged category's full checklist on
// the page at once. Ticked causes are unaffected by which tab is
// showing — that state lives in categoryState, not the DOM, same
// "hidden only affects display, never what's tracked" rule those
// other tab systems already follow.
let activeCauseTab = null;

function renderCauseSections() {
  const container = document.getElementById('csc-cause-sections');
  const flaggedCats = CATEGORY_ORDER.filter(isCategoryFlagged);

  if (!flaggedCats.length) {
    activeCauseTab = null;
    container.innerHTML = '<p class="structure-note">Pick a cost area above once you\u2019ve spotted (or suspect) a problem \u2014 the possible causes for that area will show up here.</p>';
    return;
  }

  // If the previously-active tab got unflagged (or nothing's been
  // picked yet), fall back to the most recently flagged category
  // rather than an arbitrary one.
  if (!activeCauseTab || flaggedCats.indexOf(activeCauseTab) === -1) {
    activeCauseTab = flaggedCats[flaggedCats.length - 1];
  }

  const tabsHTML = flaggedCats.length > 1 ? `
    <div class="menu-tabs csc-cause-tabs" role="tablist" aria-label="Flagged cost areas">
      ${flaggedCats.map((cat) => {
        const count = categoryState[cat].selectedCauses.size;
        return `<button type="button" class="btn btn-secondary menu-tab-btn${cat === activeCauseTab ? ' is-active' : ''}" data-cause-tab="${cat}">${escapeHTML(CATEGORY_META[cat].label)}${count ? ' (' + count + ')' : ''}</button>`;
      }).join('')}
    </div>
  ` : '';

  const cat = activeCauseTab;
  const meta = CATEGORY_META[cat];
  const causes = CAUSE_LIBRARY[cat].causes;
  const state = categoryState[cat];
  const rows = causes.map((c) => {
    const key = causeKey(cat, c.id);
    const checked = state.selectedCauses.has(key);
    const toolLink = c.tool ? `<p class="csc-cause-tool"><a href="#${c.tool.anchor}">${escapeHTML(c.tool.label)} \u2193</a></p>` : '';
    return `
      <li class="csc-cause-item${checked ? ' is-checked' : ''}">
        <label class="csc-cause-check-row">
          <input type="checkbox" class="csc-cause-check" data-key="${key}" ${checked ? 'checked' : ''}>
          <span>${escapeHTML(c.label)}</span>
        </label>
        <details class="csc-cause-details">
          <summary>What this looks like, and what to do</summary>
          <div class="csc-cause-body">
            <p>${escapeHTML(c.looksLike)}</p>
            <ul>${c.actions.map((a) => `<li>${escapeHTML(a)}</li>`).join('')}</ul>
            ${toolLink}
          </div>
        </details>
      </li>
    `;
  }).join('');

  container.innerHTML = tabsHTML + `
    <div class="csc-box csc-cause-category-block seg-${cat}">
      <h3><span class="csc-category-swatch seg-${cat}"></span>${meta.label} \u2014 possible causes</h3>
      <p class="structure-note">Tick anything that sounds familiar. Nothing here is exclusive \u2014 most real cost creep is 2-3 of these happening together, not just one.${flaggedCats.length > 1 ? ' Switch tabs above to work through another flagged area \u2014 your ticks here are kept either way.' : ''}</p>
      <ul class="csc-cause-list">${rows}</ul>
    </div>
  `;

  container.querySelectorAll('.csc-cause-tabs .menu-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => { activeCauseTab = btn.dataset.causeTab; renderCauseSections(); });
  });
  container.querySelectorAll('.csc-cause-check').forEach((cb) => {
    cb.addEventListener('change', () => {
      const [cbCat, id] = cb.dataset.key.split(':');
      const cbState = categoryState[cbCat];
      if (cb.checked) cbState.selectedCauses.add(cb.dataset.key);
      else cbState.selectedCauses.delete(cb.dataset.key);
      cb.closest('.csc-cause-item').classList.toggle('is-checked', cb.checked);
      renderCauseSections(); // re-render so the tab's own (N) count stays current
      renderActionPlan();
    });
  });
}

/* ================= WASTAGE & PAR-LEVEL TRACKER ================= */

let wastageRowIdCounter = 0;

function createWastageRow() {
  wastageRowIdCounter++;
  const tbody = document.getElementById('csc-wastage-rows');
  const tr = document.createElement('tr');
  tr.dataset.rowId = 'wr-' + wastageRowIdCounter;
  tr.innerHTML = `
    <td><input type="text" class="csc-wr-name" placeholder="e.g. Chicken thigh"></td>
    <td><input type="text" class="csc-wr-unit" placeholder="kg" style="width:64px;"></td>
    <td><input type="number" class="csc-wr-opening" min="0" step="0.1" value="0"></td>
    <td><input type="number" class="csc-wr-purchased" min="0" step="0.1" value="0"></td>
    <td><input type="number" class="csc-wr-closing" min="0" step="0.1" value="0"></td>
    <td><input type="number" class="csc-wr-expected" min="0" step="0.1" placeholder="optional"></td>
    <td class="calc csc-wr-consumed">\u2014</td>
    <td class="calc csc-wr-wastage">\u2014</td>
    <td class="calc csc-wr-wastage-pct">\u2014</td>
    <td class="calc csc-wr-avg">\u2014</td>
    <td class="calc csc-wr-par">\u2014</td>
    <td class="no-print"><button type="button" class="delete-row" aria-label="Remove this ingredient">&times;</button></td>
  `;
  tbody.appendChild(tr);
  tr.querySelectorAll('input').forEach((el) => el.addEventListener('input', recalcWastageTracker));
  tr.querySelector('.delete-row').addEventListener('click', () => { tr.remove(); recalcWastageTracker(); });
}

function recalcWastageTracker() {
  const periodDays = num(document.getElementById('csc-wastage-period-days'), DEFAULT_PERIOD_DAYS) || DEFAULT_PERIOD_DAYS;
  const leadTime = num(document.getElementById('csc-wastage-lead-time'), DEFAULT_LEAD_TIME_DAYS);
  const safety = num(document.getElementById('csc-wastage-safety-buffer'), DEFAULT_SAFETY_BUFFER_DAYS);

  document.querySelectorAll('#csc-wastage-rows > tr').forEach((tr) => {
    const opening = num(tr.querySelector('.csc-wr-opening'));
    const purchased = num(tr.querySelector('.csc-wr-purchased'));
    const closing = num(tr.querySelector('.csc-wr-closing'));
    const expectedInput = tr.querySelector('.csc-wr-expected');
    const hasExpected = expectedInput.value !== '' && isFinite(parseFloat(expectedInput.value)) && parseFloat(expectedInput.value) >= 0;
    const expected = hasExpected ? parseFloat(expectedInput.value) : 0;

    // Clamped at 0 \u2014 a negative "consumed" only ever means a
    // counting mistake (closing stock entered higher than opening
    // + purchased), not a real negative quantity, so this is
    // defensive the same way food-worth-proxy-worker.js's price
    // range sanitizer is: coerce rather than trust the raw input.
    const consumed = Math.max(0, opening + purchased - closing);
    const wastageQty = hasExpected ? Math.max(0, consumed - expected) : null;
    const wastagePct = (hasExpected && consumed > 0) ? (wastageQty / consumed) * 100 : null;
    const avgDaily = periodDays > 0 ? consumed / periodDays : 0;
    const suggestedPar = avgDaily * (leadTime + safety);

    const unit = tr.querySelector('.csc-wr-unit').value.trim() || 'units';
    tr.querySelector('.csc-wr-consumed').textContent = consumed.toFixed(1) + ' ' + unit;
    tr.querySelector('.csc-wr-wastage').textContent = wastageQty != null ? wastageQty.toFixed(1) + ' ' + unit : '\u2014';
    tr.querySelector('.csc-wr-wastage-pct').textContent = wastagePct != null ? formatPct(wastagePct) : '\u2014';
    const wastageCell = tr.querySelector('.csc-wr-wastage-pct');
    wastageCell.classList.toggle('is-loss', wastagePct != null && wastagePct >= 10);
    tr.querySelector('.csc-wr-avg').textContent = avgDaily.toFixed(2) + ' ' + unit + '/day';
    tr.querySelector('.csc-wr-par').textContent = suggestedPar.toFixed(1) + ' ' + unit;
  });
}

function resetWastageTracker() {
  const ok = confirm('Clear every ingredient row in the Wastage & Par-Level Tracker? This can\u2019t be undone.');
  if (!ok) return;
  document.getElementById('csc-wastage-rows').innerHTML = '';
  wastageRowIdCounter = 0;
  createWastageRow();
  recalcWastageTracker();
}

/* ================= ACTION PLAN (deterministic) ================= */

// Sorted by how far the category's entered % sits from its guide
// number, worst first \u2014 a real, entered deviation always beats
// -1 in a descending sort, so a category with no number entered
// naturally settles to the bottom without needing its own branch.
function renderActionPlan() {
  const section = document.getElementById('csc-action-plan');
  const entries = CATEGORY_ORDER.map((cat) => {
    const state = categoryState[cat];
    const keys = Array.from(state.selectedCauses);
    if (!keys.length) return null;
    const pct = getEnteredPct(cat);
    const guide = GUIDE_RATIOS[wizardAnswers.venue][CATEGORY_META[cat].guideKey];
    const deviation = pct != null ? Math.abs(pct - guide) : -1;
    return { cat, deviation, keys };
  }).filter(Boolean);

  document.getElementById('csc-get-ai-plan').disabled = entries.length === 0;

  if (!entries.length) {
    section.innerHTML = '<p class="structure-note">Tick a few causes above and your plan will build itself here.</p>';
    return;
  }

  entries.sort((a, b) => b.deviation - a.deviation);

  section.innerHTML = entries.map((entry, i) => {
    const meta = CATEGORY_META[entry.cat];
    const causeLabels = entry.keys.map((key) => {
      const id = key.split(':')[1];
      const c = CAUSE_LIBRARY[entry.cat].causes.find((x) => x.id === id);
      return c ? c.label : id;
    });
    return `
      <div class="csc-plan-card seg-${entry.cat}">
        <span class="csc-plan-rank">#${i + 1}</span>
        <div>
          <h4>${meta.label}</h4>
          <p>${causeLabels.map(escapeHTML).join(' \u00b7 ')}</p>
        </div>
      </div>
    `;
  }).join('');
}

function gatherAiPayload() {
  const yourNumbers = {};
  let anyEntered = false;
  CATEGORY_ORDER.forEach((c) => { const v = getEnteredPct(c); if (v != null) { yourNumbers[c] = v; anyEntered = true; } });
  const flaggedCategories = CATEGORY_ORDER.filter(isCategoryFlagged);
  const selectedCauses = [];
  CATEGORY_ORDER.forEach((cat) => {
    categoryState[cat].selectedCauses.forEach((key) => {
      const id = key.split(':')[1];
      const c = CAUSE_LIBRARY[cat].causes.find((x) => x.id === id);
      if (c) selectedCauses.push({ category: cat, id, label: c.label });
    });
  });
  return {
    venue: wizardAnswers.venue,
    guideRatios: GUIDE_RATIOS[wizardAnswers.venue],
    yourNumbers: anyEntered ? yourNumbers : null,
    flaggedCategories,
    selectedCauses,
    notes: document.getElementById('csc-ai-notes').value.trim() || undefined,
  };
}

async function requestAiPlan() {
  const box = document.getElementById('csc-ai-box');
  const btn = document.getElementById('csc-get-ai-plan');

  if (!WORKER_ENDPOINT || WORKER_ENDPOINT.indexOf('PASTE_YOUR') === 0) {
    box.textContent = 'This needs its proxy URL set \u2014 see WORKER_ENDPOINT near the top of cost-structure-checker.js.';
    box.classList.add('is-empty');
    return;
  }
  const payload = gatherAiPayload();
  if (!payload.selectedCauses.length) return;
  if (getUsageToday() + 1 > MAX_ANALYSES_PER_DAY) {
    box.textContent = 'This browser has hit today\u2019s AI-plan limit. The deterministic plan above still works \u2014 try the AI plan again tomorrow.';
    box.classList.remove('is-empty');
    return;
  }

  btn.disabled = true;
  box.textContent = 'Asking for a prioritized read on what you\u2019ve ticked\u2026';
  box.classList.remove('is-empty');

  try {
    const response = await fetch(WORKER_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data;
    try { data = await response.json(); }
    catch (e) { throw new Error('Got an unreadable response. Try again.'); }
    if (!response.ok || data.error) throw new Error(data.error || ('Request failed (error ' + response.status + ').'));
    recordUsage();
    box.textContent = data.text || 'Didn\u2019t get anything usable back that time \u2014 the plan above is unaffected.';
    box.classList.remove('is-empty');
  } catch (err) {
    box.textContent = 'Couldn\u2019t reach the AI service right now (' + (err.message || 'unknown error') + '). The deterministic plan above is unaffected.';
    box.classList.remove('is-empty');
  } finally {
    btn.disabled = false;
  }
}

/* ================= JARGON INDEX ================= */

function renderJargon() {
  document.getElementById('csc-jargon').innerHTML = JARGON.map((g) => `
    <details class="csc-collapsible">
      <summary class="csc-collapsible-summary"><h3>${escapeHTML(g.term)}</h3></summary>
      <div class="csc-collapsible-body">${escapeHTML(g.def)}</div>
    </details>
  `).join('');
}

/* ================= INIT ================= */

let rzInitialized = false;

function init() {
  if (rzInitialized) return;
  rzInitialized = true;

  renderWizardStep();
  document.getElementById('wizard-back').addEventListener('click', goBack);
  document.getElementById('csc-edit-answers').addEventListener('click', editAnswers);
  document.getElementById('csc-save-pdf').addEventListener('click', () => window.print());

  ['ingredients', 'overhead', 'manpower', 'margin'].forEach((cat) => {
    document.getElementById('csc-pct-' + cat).addEventListener('input', () => {
      updatePctTotal();
      renderCategoryCards();
      renderStructureComparison();
      renderActionPlan();
    });
  });
  document.getElementById('csc-guide-venue-select').addEventListener('change', renderStructureComparison);

  document.getElementById('csc-add-wastage-row').addEventListener('click', () => { createWastageRow(); recalcWastageTracker(); });
  document.getElementById('csc-reset-wastage').addEventListener('click', resetWastageTracker);
  ['csc-wastage-period-days', 'csc-wastage-lead-time', 'csc-wastage-safety-buffer'].forEach((id) => {
    document.getElementById(id).addEventListener('input', recalcWastageTracker);
  });
  createWastageRow();
  createWastageRow();

  document.getElementById('csc-get-ai-plan').addEventListener('click', requestAiPlan);

  renderJargon();
  updatePctTotal();

  // Floating quick-nav, same pattern as every other tool's on this
  // site (fw-quick-nav / rc-quick-nav / cr-quick-nav).
  const quickNav = document.getElementById('csc-quick-nav');
  document.querySelectorAll('.csc-quick-nav-btn[data-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      target.querySelectorAll('details:not([open])').forEach((d) => { d.open = true; });
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  window.addEventListener('scroll', () => { quickNav.hidden = window.scrollY < window.innerHeight * 0.4; }, { passive: true });
  document.getElementById('csc-back-to-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

document.addEventListener('DOMContentLoaded', init);
