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

console.info('[Cost Structure Checker] script build: 2026-09-25-v1.6');

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
const WORKER_ENDPOINT = 'https://cost-structure-checker-proxy.reysourcez-ent.workers.dev/';

// Payload tag for the Wastage & Par-Level Tracker's own broadcast/export —
// see WASTAGE_SYNC_STANDARD.md and WASTAGE_SYNC_STANDARD_REPLY.md. Specific
// rather than the plain page slug ('cost-structure-checker') since this only
// ever carries the Tracker's rows, not the diagnostic/causes side of the
// page — a second, different export from this page later (a saved Action
// Plan, say) shouldn't have to collide with or rename around this one.
const WASTAGE_EXPORT_TYPE = 'cost-structure-checker-wastage';

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

/* ================= CROSS-TOOL SYNC \u2014 live broadcast + file import
   (2026-09-22 v1.4 file-import; 2026-09-24 v1.5 adds live costing-sync.js,
   per Treasurer: CSC should be able to pick up what it needs from either
   path) =================
   ONE function applies a payload regardless of where it came from \u2014
   handleSyncPayload() below \u2014 matching CROSS_TOOL_IMPORT_STANDARD.md's
   own rule (re-confirmed directly against that file this session, not
   just recalled) that a file importer must hand off to the exact
   function a page's live sync already uses, never a second parallel set
   of field-mapping. importDataFile() (file) and initSync()/rzListen()
   (live) both just get a payload to handleSyncPayload() one way or
   another.

   Menu Calculator is the only source actually wired to something so
   far: payloads carry {source: 'menu-calculator', blockId,
   costPerPortion, costBufferPct, sellingPrice, dishName} \u2014 re-confirmed
   this session directly against CROSS_TOOL_IMPORT_STANDARD.md's own
   worked example (its exact `handleSyncPayload({ source:
   'menu-calculator', blockId: b.blockId, ... })` line). The session
   building Menu Calculator's own export/broadcast confirmed (via
   Treasurer) that it's participating. If that shape ever changes,
   handleSyncPayload() below is the one function that needs updating to
   match.

   NOT re-verified this session \u2014 menu-calculator.js, costing-sync.js,
   interactive-costing-analysis.js, margin-audit-calculator.js and
   styles.css weren't available to check directly here: the exact
   name/behaviour of rzListen() in costing-sync.js, and whether other
   pages' own live-sync code really does use a Map keyed by blockId the
   same way this does. Both are built to the pattern
   CROSS_TOOL_IMPORT_STANDARD.md itself describes, and initSync() below
   fails safe (silently does nothing) if rzListen isn't actually a
   function by that name \u2014 a naming mismatch means live sync just
   doesn't activate, not a broken page. Worth a real check against those
   files' current content next time they're available.

   Every dish this page has ever heard about (live or from a file) is
   kept in syncedMenuBlocks, keyed by blockId, so a later update for the
   same dish overwrites rather than duplicates. Ingredients % is then
   recomputed from the FULL current set on every update: the plain
   (UNWEIGHTED) average of (costPerPortion \u00f7 sellingPrice) \u00d7 100 across
   every known dish with both a cost and a price. Unweighted because
   nothing in this shape carries a sales-volume field to weight by \u2014
   same known limitation as v1.4, now just applied across live + file
   sources together rather than one file at a time. Treat the result as
   a reasonable starting point, not a precise blended food cost % \u2014 the
   field stays a normal editable input throughout, a markSynced() badge
   on its label says where the number came from, and a real blended
   number can always overwrite it by hand. costBufferPct is still read
   but deliberately NOT folded into the calculation, for the same reason
   as v1.4: it's Menu Calculator's own pricing-side buffer, not confirmed
   to mean the same thing as a true cost inflator.

   Edge case worth knowing about, not specially solved here: if Menu
   Calculator's blockId counter restarts in a fresh session, a stale
   imported file's IDs could collide with a new live session's IDs for a
   *different* dish. The field staying editable is the escape hatch.

   Overhead & Manpower's own export/broadcast (source ===
   'overhead-manpower-calculator', {overheadMonthly, manpowerMonthly}) \u2014
   also re-confirmed this session against CROSS_TOOL_IMPORT_STANDARD.md's
   worked example \u2014 is recognised by importDataFile() below but
   deliberately NOT actioned: RM/month figures, no revenue number on
   this page to convert with. A file import says so explicitly; a live
   payload for it is silently no-op'd (no user click to attach a status
   message to). See the KIV list for what unlocking this would need. */

const syncedMenuBlocks = new Map();

// Small "synced from X" badge next to a field's label, so a number that
// arrived live or from an import doesn't look like a manual guess. Uses
// its own page-scoped .csc-synced-badge class (defined in this page's
// own <style> block) rather than assuming a shared component exists
// elsewhere on the site \u2014 styles.css wasn't available to check against
// this session, so this doesn't guess at its class names. Doesn't lock
// the field \u2014 manual edits still work after.
function markSynced(labelSelector, sourceLabel) {
  const label = document.querySelector(labelSelector);
  if (!label) return;
  let badge = label.querySelector('.csc-synced-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'csc-synced-badge';
    label.appendChild(badge);
  }
  badge.textContent = '\u2190 ' + sourceLabel;
}

function recomputeIngredientsFromSyncedMenu() {
  const rates = [];
  syncedMenuBlocks.forEach((b) => {
    if (isFinite(b.costPerPortion) && isFinite(b.sellingPrice) && b.sellingPrice > 0) {
      rates.push((b.costPerPortion / b.sellingPrice) * 100);
    }
  });
  if (!rates.length) return;
  const avg = rates.reduce((sum, r) => sum + r, 0) / rates.length;
  document.getElementById('csc-pct-ingredients').value = avg.toFixed(1);
  updatePctTotal();
  renderCategoryCards();
  renderStructureComparison();
  renderActionPlan();
  const dishWord = rates.length === 1 ? 'dish' : 'dishes';
  markSynced('#csc-pct-ingredients-label', `Menu Calculator (${rates.length} ${dishWord}, avg. food cost %)`);
}

// The one function both live sync (via rzListen, see initSync()) and
// file import (via importDataFile()) call \u2014 per CROSS_TOOL_IMPORT_
// STANDARD.md, field-mapping lives here exactly once.
function handleSyncPayload(data) {
  if (!data) return;
  if (data.source === 'menu-calculator' && typeof data.costPerPortion === 'number') {
    const blockId = (typeof data.blockId === 'string' && data.blockId) ? data.blockId : ('menu-calculator-unkeyed-' + (syncedMenuBlocks.size + 1));
    syncedMenuBlocks.set(blockId, {
      costPerPortion: data.costPerPortion,
      sellingPrice: typeof data.sellingPrice === 'number' ? data.sellingPrice : null,
      dishName: data.dishName || 'Untitled Menu Item',
      costBufferPct: typeof data.costBufferPct === 'number' ? data.costBufferPct : 0,
    });
    recomputeIngredientsFromSyncedMenu();
  }
  // data.source === 'overhead-manpower-calculator': recognised, not
  // actionable yet (see file header comment) \u2014 silently ignored for a
  // live payload; importDataFile() below gives the file-import path its
  // own honest explanation instead, since that path has a status line
  // to write to and a user action that triggered it.
}

function initSync() {
  if (typeof rzListen !== 'function') return; // costing-sync.js missing/reshaped \u2014 everything else on this page still works without it
  rzListen(handleSyncPayload);
}

function importDataFile(file) {
  const status = document.getElementById('csc-import-status');
  status.textContent = 'Reading file\u2026';
  status.classList.remove('is-error');
  const reader = new FileReader();
  reader.onerror = () => {
    status.textContent = 'Couldn\u2019t read that file.';
    status.classList.add('is-error');
  };
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); }
    catch (e) {
      status.textContent = 'Couldn\u2019t read that file \u2014 is it a JSON export from another tool on this site?';
      status.classList.add('is-error');
      return;
    }

    if (data && data.rzExportType === 'menu-calculator' && Array.isArray(data.blocks)) {
      data.blocks.forEach((b) => {
        handleSyncPayload({ source: 'menu-calculator', blockId: b.blockId, costPerPortion: b.costPerPortion, costBufferPct: b.costBufferPct, sellingPrice: b.sellingPrice, dishName: b.dishName });
      });
      const usable = Array.from(syncedMenuBlocks.values()).filter((b) => isFinite(b.costPerPortion) && isFinite(b.sellingPrice) && b.sellingPrice > 0).length;
      status.textContent = usable
        ? `Ingredients % updated from ${usable} dish${usable === 1 ? '' : 'es'} now known (unweighted average food cost %, no sales-volume data to weight by \u2014 adjust by hand if you know your real blended number).`
        : 'That file doesn\u2019t have any dishes with both a cost and a selling price to work out a food cost % from.';
      status.classList.toggle('is-error', !usable);
    } else if (data && data.rzExportType === 'overhead-manpower-calculator') {
      status.textContent = 'That\u2019s a valid Overhead & Manpower export, but this page can\u2019t use it yet \u2014 it\u2019s RM/month figures, not a % of revenue, and there\u2019s no revenue number here to convert with. Enter Overhead %/Manpower % by hand for now.';
      status.classList.add('is-error');
    } else {
      status.textContent = 'Unrecognised file \u2014 right now this only reads a Menu Calculator export (the "Export data" button on that page).';
      status.classList.add('is-error');
    }
  };
  reader.readAsText(file);
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

/* ================= DAILY WASTAGE LOG =================
   An event log, not a reconciliation \u2014 modeled directly on a
   real operational SOP form a user shared (see REASON_CODES's own
   comment in cost-structure-checker-content.js). Every row is one
   wastage event logged as it happens: what, roughly how much, an
   estimated RM cost, and a reason code. Sums to a daily total, the
   same "JUMLAH KESELURUHAN HARIAN" (daily grand total) the source
   form computes by hand at the bottom of the page. */

let logRowIdCounter = 0;

function reasonCodeOptions() {
  return REASON_CODES.map((r) => `<option value="${r.code}">${r.code} \u2014 ${escapeHTML(r.label)}</option>`).join('');
}
function categoryOptions() {
  return WASTAGE_LOG_CATEGORIES.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join('');
}

function createLogRow() {
  logRowIdCounter++;
  const tbody = document.getElementById('csc-wl-rows');
  const tr = document.createElement('tr');
  tr.dataset.rowId = 'wl-' + logRowIdCounter;
  tr.innerHTML = `
    <td><input type="time" class="csc-wl-time"></td>
    <td><input type="text" class="csc-wl-item" placeholder="e.g. Chicken thigh"></td>
    <td><select class="csc-wl-category">${categoryOptions()}</select></td>
    <td><input type="text" class="csc-wl-qty" placeholder="e.g. 1.2kg"></td>
    <td><input type="number" class="csc-wl-cost" min="0" step="0.01" value="0"></td>
    <td><select class="csc-wl-reason">${reasonCodeOptions()}</select></td>
    <td><input type="text" class="csc-wl-notes" placeholder="What was done about it"></td>
    <td class="no-print"><button type="button" class="delete-row" aria-label="Remove this entry">&times;</button></td>
  `;
  tbody.appendChild(tr);
  tr.querySelector('.csc-wl-cost').addEventListener('input', recalcWastageLog);
  tr.querySelector('.delete-row').addEventListener('click', () => { tr.remove(); recalcWastageLog(); });
}

function recalcWastageLog() {
  let total = 0;
  document.querySelectorAll('#csc-wl-rows > tr').forEach((tr) => { total += num(tr.querySelector('.csc-wl-cost')); });
  document.getElementById('csc-wl-total').textContent = 'RM ' + total.toFixed(2);
}

function resetWastageLog() {
  const ok = confirm('Clear every entry in the Daily Wastage Log? This can\u2019t be undone.');
  if (!ok) return;
  document.getElementById('csc-wl-rows').innerHTML = '';
  logRowIdCounter = 0;
  createLogRow(); createLogRow(); createLogRow();
  recalcWastageLog();
}

function renderReasonLegend() {
  document.getElementById('csc-wl-legend').innerHTML = REASON_CODES.map((r) => `<span><strong>${r.code}</strong> \u2014 ${escapeHTML(r.label)}</span>`).join('');
}

// Same WS-YYYYMMDD scheme as the source SOP's own "NO. RUJUKAN BORANG"
// field \u2014 purely a display convenience, nothing is stored or submitted
// anywhere, so there's no real uniqueness to guarantee here.
function updateFormRef() {
  const raw = document.getElementById('csc-wl-date').value; // yyyy-mm-dd from <input type="date">
  const out = document.getElementById('csc-wl-form-ref');
  out.textContent = raw ? 'WS-' + raw.replace(/-/g, '') : 'WS\u2014';
}

/* ================= WASTAGE & PAR-LEVEL TRACKER ================= */

let wastageRowIdCounter = 0;

// Cache of the current, on-screen wastage rows worth sharing with another
// tool (name + a real computed wastagePct) — refreshed on every
// recalcWastageTracker() pass, read by both broadcastWastageRows() and the
// "Export data" button so neither has to re-derive the table a second time.
let lastWastageRows = [];

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

  // Rows worth sharing with Menu Calculator this pass — name plus a real
  // computed wastagePct only (per WASTAGE_SYNC_STANDARD_REPLY.md: a row
  // with no expected usage entered has nothing to broadcast yet). Cached
  // into lastWastageRows so "Export data" reads exactly what's on screen
  // without re-deriving this loop a second time.
  const broadcastRows = [];

  document.querySelectorAll('#csc-wastage-rows > tr').forEach((tr) => {
    const opening = num(tr.querySelector('.csc-wr-opening'));
    const purchased = num(tr.querySelector('.csc-wr-purchased'));
    const closing = num(tr.querySelector('.csc-wr-closing'));
    const expectedInput = tr.querySelector('.csc-wr-expected');
    const hasExpected = expectedInput.value !== '' && isFinite(parseFloat(expectedInput.value)) && parseFloat(expectedInput.value) >= 0;
    const expected = hasExpected ? parseFloat(expectedInput.value) : 0;

    // Formula moved to wastage-calc.js (rzComputeWastage) in v1.6 —
    // required, not guarded, since CSC ships and load-orders this file
    // itself (same as cost-structure-checker-content.js already is),
    // unlike costing-sync.js, which is a genuine cross-tool optional
    // dependency. See wastage-calc.js's own header for that reasoning.
    const { consumed, wastageQty, wastagePct, avgDaily, suggestedPar } = rzComputeWastage({
      opening, purchased, closing,
      expected: hasExpected ? expected : undefined,
      periodDays, leadTimeDays: leadTime, safetyBufferDays: safety,
    });

    const unit = tr.querySelector('.csc-wr-unit').value.trim() || 'units';
    tr.querySelector('.csc-wr-consumed').textContent = consumed.toFixed(1) + ' ' + unit;
    tr.querySelector('.csc-wr-wastage').textContent = wastageQty != null ? wastageQty.toFixed(1) + ' ' + unit : '\u2014';
    tr.querySelector('.csc-wr-wastage-pct').textContent = wastagePct != null ? formatPct(wastagePct) : '\u2014';
    const wastageCell = tr.querySelector('.csc-wr-wastage-pct');
    wastageCell.classList.toggle('is-loss', wastagePct != null && wastagePct >= 10);
    tr.querySelector('.csc-wr-avg').textContent = avgDaily.toFixed(2) + ' ' + unit + '/day';
    tr.querySelector('.csc-wr-par').textContent = suggestedPar.toFixed(1) + ' ' + unit;

    const ingredientName = tr.querySelector('.csc-wr-name').value.trim();
    if (ingredientName && wastagePct != null) {
      broadcastRows.push({
        ingredientName, unit,
        wastagePct: Math.round(wastagePct * 10) / 10,
        suggestedPar: Math.round(suggestedPar * 10) / 10,
      });
    }
  });

  lastWastageRows = broadcastRows;
  broadcastWastageRows(broadcastRows);
}

// Fires on every recalcWastageTracker() pass, per WASTAGE_SYNC_STANDARD_REPLY.md.
// rzBroadcast()'s exact name/shape in costing-sync.js isn't independently
// confirmed on this side — same caveat as rzListen() in initSync() below —
// so this is guarded the same way: a naming mismatch means CSC silently
// doesn't broadcast rather than breaking the page.
function broadcastWastageRows(rows) {
  if (typeof rzBroadcast !== 'function') return;
  rzBroadcast({ source: 'cost-structure-checker', wastageRows: rows });
}

function resetWastageTracker() {
  const ok = confirm('Clear every ingredient row in the Wastage & Par-Level Tracker? This can\u2019t be undone.');
  if (!ok) return;
  document.getElementById('csc-wastage-rows').innerHTML = '';
  wastageRowIdCounter = 0;
  createWastageRow();
  recalcWastageTracker();
}

// "Export data" — same rzExportType-tagged .json shape as every other
// tool's own export button on this site (see WASTAGE_SYNC_STANDARD_REPLY.md).
// Reads lastWastageRows rather than re-deriving the table, since
// recalcWastageTracker() already refreshes it on every keystroke.
function exportWastageData() {
  const payload = { rzExportType: WASTAGE_EXPORT_TYPE, wastageRows: lastWastageRows };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'cost-structure-checker-wastage-export.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

/* ================= WASTAGE TOOLS: tabs + scoped print =================
   Daily Wastage Log and Wastage & Par-Level Tracker share one collapsible
   box and switch via two tab buttons (2026-09-21) \u2014 see the HTML comment
   above #csc-wastage-tools for why. Switching tabs only ever toggles the
   `hidden` attribute on a .csc-wastage-panel; neither panel's rows or
   typed values are ever destroyed by switching tabs, collapsing the box,
   or printing \u2014 only each panel's own Reset button clears its data. */

function setWastageTab(tab) {
  document.getElementById('csc-wastage-log').hidden = tab !== 'log';
  document.getElementById('csc-wastage-tracker').hidden = tab !== 'tracker';
  document.querySelectorAll('.csc-wastage-tabs .menu-tab-btn').forEach((btn) => {
    const active = btn.dataset.wastageTab === tab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

// Shared by the quick-nav buttons AND any in-page <a href="#..."> tool link
// (the cause checklist's own "Open the Daily Wastage Log \u2193" /
// "Open the Wastage & Par-Level Tracker \u2193"): makes sure whatever's being
// jumped to is actually visible before the jump lands \u2014 opens any closed
// <details> ancestor or descendant, and switches to the right wastage tab
// if the target is one of its two panels. Returns the target (or null) so
// callers that need to scrollIntoView themselves still can.
function revealSection(id) {
  const target = document.getElementById(id);
  if (!target) return null;
  if (id === 'csc-wastage-log' || id === 'csc-wastage-tracker') setWastageTab(id === 'csc-wastage-log' ? 'log' : 'tracker');
  const ancestorDetails = target.closest('details:not([open])');
  if (ancestorDetails) ancestorDetails.open = true;
  target.querySelectorAll('details:not([open])').forEach((d) => { d.open = true; });
  return target;
}

// "Save this log/tracker as PDF": adds a scope class to <body> so the print
// CSS (see cost-structure-checker.html) hides everything except the one
// panel being saved, prints, then removes the class right after so the
// page-wide "Save as PDF" button up top isn't left stuck in a scoped state.
function printSection(scopeClass) {
  document.body.classList.add(scopeClass);
  window.print();
  document.body.classList.remove(scopeClass);
}

/* ================= INIT =================
   Each section below is wrapped in safeInit() (2026-09-21). This is a
   direct response to a real incident, not generic defensiveness: an
   outdated content.js on a live deploy (missing REASON_CODES /
   WASTAGE_LOG_CATEGORIES) threw inside renderReasonLegend(), which is
   called partway through this function \u2014 and because the whole function
   used to run as one block, that single uncaught error silently killed
   every init step after it: no wastage rows, no quick-nav, no AI-plan
   button, nothing, with zero indication why beyond "buttons don't work".
   safeInit() catches and logs each section on its own, so a problem in
   one (a missing global, a renamed id) can't take down unrelated
   sections \u2014 and still shows up clearly in the console instead of
   failing silently, exactly the trail that made this one diagnosable
   at all. */

let rzInitialized = false;

function safeInit(label, fn) {
  try { fn(); }
  catch (e) { console.error('[Cost Structure Checker] init step failed: ' + label, e); }
}

function init() {
  if (rzInitialized) return;
  rzInitialized = true;

  safeInit('wizard', () => {
    renderWizardStep();
    document.getElementById('wizard-back').addEventListener('click', goBack);
    document.getElementById('csc-edit-answers').addEventListener('click', editAnswers);
    document.getElementById('csc-save-pdf').addEventListener('click', () => window.print());
  });

  safeInit('% inputs', () => {
    ['ingredients', 'overhead', 'manpower', 'margin'].forEach((cat) => {
      document.getElementById('csc-pct-' + cat).addEventListener('input', () => {
        updatePctTotal();
        renderCategoryCards();
        renderStructureComparison();
        renderActionPlan();
      });
    });
    document.getElementById('csc-guide-venue-select').addEventListener('change', renderStructureComparison);
  });

  safeInit('cross-tool import', () => {
    document.getElementById('csc-import-btn').addEventListener('click', () => document.getElementById('csc-import-file').click());
    document.getElementById('csc-import-file').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) importDataFile(e.target.files[0]);
      e.target.value = ''; // clear so importing the same filename twice in a row still fires 'change'
    });
  });

  safeInit('cross-tool live sync', () => {
    initSync();
  });

  safeInit('wastage tabs', () => {
    document.querySelectorAll('.csc-wastage-tabs .menu-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => setWastageTab(btn.dataset.wastageTab));
    });
  });

  safeInit('daily wastage log', () => {
    document.getElementById('csc-wl-add-row').addEventListener('click', () => { createLogRow(); recalcWastageLog(); });
    document.getElementById('csc-wl-reset').addEventListener('click', resetWastageLog);
    document.getElementById('csc-wl-print').addEventListener('click', () => printSection('csc-print-scope-log'));
    document.getElementById('csc-wl-date').addEventListener('input', updateFormRef);
    updateFormRef(); // establish the WS— placeholder correctly on load, same "wire the listener, then render once" pattern as recalcWastageLog()/recalcWastageTracker() below
    renderReasonLegend();
    createLogRow();
    createLogRow();
    createLogRow();
    recalcWastageLog();
  });

  safeInit('wastage & par-level tracker', () => {
    document.getElementById('csc-add-wastage-row').addEventListener('click', () => { createWastageRow(); recalcWastageTracker(); });
    document.getElementById('csc-reset-wastage').addEventListener('click', resetWastageTracker);
    document.getElementById('csc-wastage-export').addEventListener('click', exportWastageData);
    document.getElementById('csc-wt-print').addEventListener('click', () => printSection('csc-print-scope-tracker'));
    ['csc-wastage-period-days', 'csc-wastage-lead-time', 'csc-wastage-safety-buffer'].forEach((id) => {
      document.getElementById(id).addEventListener('input', recalcWastageTracker);
    });
    createWastageRow();
    createWastageRow();
  });

  safeInit('AI plan button', () => {
    document.getElementById('csc-get-ai-plan').addEventListener('click', requestAiPlan);
  });

  safeInit('jargon + pct total', () => {
    renderJargon();
    updatePctTotal();
  });

  safeInit('quick-nav', () => {
    // Floating quick-nav, same pattern as every other tool's on this
    // site (fw-quick-nav / rc-quick-nav / cr-quick-nav).
    const quickNav = document.getElementById('csc-quick-nav');
    document.querySelectorAll('.csc-quick-nav-btn[data-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = revealSection(btn.dataset.target);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    window.addEventListener('scroll', () => { quickNav.hidden = window.scrollY < window.innerHeight * 0.4; }, { passive: true });
    document.getElementById('csc-back-to-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  });

  safeInit('anchor-link details opener', () => {
    // A plain <a href="#csc-wastage-log">/<a href="#csc-wastage-tracker">
    // tool link from a ticked cause does a native browser anchor-jump, NOT
    // the quick-nav click handler above \u2014 generalized to any in-page hash
    // link via revealSection() so this doesn't need revisiting if more
    // collapsibles or tabs get anchor-linked later.
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      revealSection(a.getAttribute('href').slice(1));
    });
  });
}

document.addEventListener('DOMContentLoaded', init);
