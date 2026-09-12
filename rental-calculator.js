/* ============================================================
   Rental Calculator
   Vanilla JS, no dependencies, nothing saved anywhere — same rule as
   every other tool on this site (see AI_BUILD_BRIEF.md).
   ------------------------------------------------------------
   PURPOSE: for a business that rents out equipment (JCB backhoe
   loaders, excavators, and similar), work out what a machine
   genuinely costs per day, price it to beat the local market without
   losing money, and see what's left after revenue-share partners,
   SST, and member pricing.

   COST MODEL (see the in-page "How every number here is calculated"
   for the same thing in formula form):
     Ownership cost  — fixed, time-based: depreciation + financing
       interest + insurance + registration/permits. Recovered
       regardless of how much the machine actually worked this month.
     Operating cost  — variable, usage-based: fuel + scheduled
       maintenance + WEAR & TEAR RESERVE + an unscheduled-repair
       buffer. Wear & tear is the category the old Excel reference
       didn't have — undercarriage, hoses, bucket teeth, tires wear
       out faster than the machine's whole useful life and need their
       own per-hour set-aside, separate from routine servicing.
     Operator cost   — wet hire only; a quick EPF/SOCSO/EIS estimate,
       not the exact PERKESO/KWSP banded tables (see
       ESTIMATED_STATUTORY_MULTIPLIER below for why, and the "Pull
       from Overhead & Manpower Calculator" note for the precise
       route).
     Overhead share  — one shared fixed-overhead pool (rent, admin,
       business insurance/licenses — NOT equipment- or operator-
       specific), split equally across every equipment tab.
     Mobilization    — a one-off transport/setup fee, spread over
       however many rental days it should cover.

   PRICING: true cost -> target price (gross up for target margin) ->
   standard/non-member price (gross up further for SST + every
   revenue-share partner's %) -> member discount applied per whichever
   mode is chosen (see MEMBER PRICING below). Same "divide by
   (1 - rate)" gross-up shape already used for delivery-commission and
   SST on the Menu Calculator — the cut comes out of the quoted price,
   never off your own target.

   MEMBER PRICING: two modes, chosen in Margin & Member Pricing.
   "protect_standard" (default) makes the standard/member price hit
   target margin and the non-member price pay a premium on top — this
   matches how the reference Excel this was built from already worked
   (grossing up a non-member price from a margin-protected base,
   rather than discounting a list price down). "discount_list" is the
   more familiar direction (list price hits target, member gets a
   straight discount off it) but margin at the member price will
   usually land below target — Results shows the gap either way.

   EQUIPMENT: repeatable blocks, same tab-queue pattern as every other
   multi-item tool on this site (Menu Calculator's .menu-block, Food
   Worth's dish panels, Margin Analysis's dish panels) — but its own
   class, .rc-equipment-panel, deliberately NOT .menu-block. See
   MARGIN_AUDIT_CHANGE_NOTES.md's 2026-09-09 entry: sharing a class
   name between this page and whatever the tool dock injects is a
   real, already-documented collision bug on this site, not a
   theoretical risk. collectEquipment() below reads every panel via
   querySelectorAll regardless of which tab is currently showing,
   matching Margin Analysis's collectDishes() — hidden only affects
   display, never what gets calculated.

   SHARED vs PER-EQUIPMENT: Shared Overhead, Revenue-Share partners,
   SST, and Member Pricing policy are business-wide (one setting,
   applied to every machine). Ownership, Operating, Operator,
   Utilization, Mobilization, Target Margin, and Market Rates are all
   per-equipment, since they genuinely vary machine to machine.

   TOOL DOCK: fetch-inject-execute, same mechanism as Costing Analysis
   and Margin Analysis (see either file's own long comment for the
   full explanation) — pulls ONLY Overhead & Manpower Calculator, and
   only into the SHARED Fixed Overhead field. Deliberately does NOT
   try to map that tool's "manpower" total onto any one equipment's
   operator cost — that tool broadcasts one combined total for
   however many staff are entered there, which doesn't correspond to
   "this one operator" on a specific machine. See handleSyncPayload.
   ============================================================ */

console.info('[Rental Calculator] script build: 2026-09-11-v1');

/* ================= CONFIG =================
   Everything a layperson might reasonably need to change lives here.
   See RENTAL_CALCULATOR_NOTES.md's Settings Reference for the same
   table with more context, and the companion .xlsx for a version
   that doesn't require opening this file at all. */

// A rough combined EPF+SOCSO+EIS employer cost as a multiplier on
// basic wage — NOT the exact PERKESO Third Schedule / SOCSO wage-band
// tables (those are already built, precisely, in
// overhead-manpower-calculator.js; re-deriving ~150 lines of banded
// tables a second time here would just be a second place for them to
// drift out of sync). This is the fast, "good enough to price a job"
// estimate; the exact figure is one click away via "Pull from
// Overhead & Manpower Calculator" — build just this one operator
// there, then type their real Employer Cost figure into this
// equipment's own wage field instead of the basic wage.
// 1.155 reflects the commonly-cited ~15-16% combined employer
// statutory load for a Malaysian/PR employee under 60 (EPF 12-13% +
// SOCSO ~1.75% + EIS 0.2%). Verified current as of Sept 2026.
const ESTIMATED_STATUTORY_MULTIPLIER_CITIZEN = 1.155;
// Foreign workers: EPF employer-only 2% (mandatory since Oct 2025 —
// previously voluntary), SOCSO Employment Injury still applies
// (foreign workers were brought into the Invalidity Scheme too, from
// July 2024), EIS does not apply to foreign workers at all. ~2% EPF +
// ~1.75% SOCSO rounds to about 4%.
const ESTIMATED_STATUTORY_MULTIPLIER_FOREIGN = 1.04;

const MARKET_RATE_HOURS_PER_DAY = 8; // fixed reference for normalizing an hourly market rate to a daily one — a standard working day, independent of any one machine's own hours-per-day setting
const MARKET_RATE_DAYS_PER_MONTH = 26; // Malaysia's own standard working-day convention for monthly->daily conversion (matches the same 26-day basis used for the national minimum wage's own daily-rate figure)

// Rough, editable rule-of-thumb cost structure per equipment category
// — comparison only, never feeds the actual price. ingredients here
// means "equipment costs" (ownership+operating+mobilization combined)
// — reusing the same four-segment shape (ingredients/overhead/
// manpower/margin) the rest of this site's structure pies already
// use, just relabelled for rental in the HTML's own legend.
const GUIDE_RATIOS = {
  mini_excavator: { ingredients: 55, overhead: 15, manpower: 12, margin: 18 },
  excavator:      { ingredients: 50, overhead: 17, manpower: 13, margin: 20 },
  backhoe:        { ingredients: 48, overhead: 17, manpower: 15, margin: 20 },
  crane:          { ingredients: 45, overhead: 18, manpower: 17, margin: 20 },
  forklift:       { ingredients: 55, overhead: 15, manpower: 10, margin: 20 },
  other:          { ingredients: 50, overhead: 17, manpower: 13, margin: 20 },
};

/* ================= SHARED UTILITIES ================= */

function formatRM(value) {
  if (!isFinite(value)) return 'RM0.00';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs > 0 && abs < 0.01) return sign + '< RM0.01';
  return sign + 'RM' + abs.toFixed(2);
}
function formatDays(value) {
  if (!isFinite(value)) return 'Not reachable';
  return Math.ceil(Math.max(0, value)).toLocaleString() + ' days';
}
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
function numOrZero(v) { return isFinite(v) ? v : 0; }

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

/* ================= LOAN AMORTIZATION (pure function) =================
   Standard formula, not an approximation: M = P*r(1+r)^n / ((1+r)^n-1).
   r=0 guarded separately (straight-line principal/n) since the formula
   divides by zero otherwise. Returns the AVERAGE monthly interest
   across the whole tenure (total interest / n), not a declining
   month-by-month schedule — accurate for a total-interest figure,
   just evenly spread rather than front-loaded the way a real
   reducing-balance schedule would be. Fine for pricing a rental day;
   not a substitute for an actual loan amortization schedule. */
function computeLoanAmortization(principal, annualRatePct, tenureYears) {
  const n = Math.round(tenureYears * 12);
  if (!(principal > 0) || n <= 0) return { monthlyInstallment: 0, totalInterest: 0, avgMonthlyInterest: 0 };
  const r = (annualRatePct / 100) / 12;
  let monthlyInstallment;
  if (r === 0) {
    monthlyInstallment = principal / n;
  } else {
    monthlyInstallment = principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  }
  const totalInterest = Math.max(0, monthlyInstallment * n - principal);
  return { monthlyInstallment, totalInterest, avgMonthlyInterest: totalInterest / n };
}

/* ================= EQUIPMENT PANELS (tab-queue pattern) ================= */

let eqIdCounter = 0;

function createEquipmentPanel() {
  eqIdCounter++;
  const id = 'rc-eq-' + eqIdCounter;
  const panel = document.createElement('div');
  panel.className = 'rc-equipment-panel';
  panel.dataset.eqId = id;
  panel.innerHTML = `
    <div class="rc-eq-header">
      <div class="rc-eq-name-row">
        <input type="text" class="rc-eq-name" value="Equipment ${eqIdCounter}" aria-label="Equipment name">
        <select class="rc-eq-category" aria-label="Equipment category">
          <option value="mini_excavator">Mini excavator</option>
          <option value="excavator" selected>Excavator</option>
          <option value="backhoe">Backhoe loader</option>
          <option value="crane">Crane</option>
          <option value="forklift">Forklift</option>
          <option value="other">Other</option>
        </select>
      </div>
      <button type="button" class="remove-block-btn rc-remove-eq no-print" aria-label="Remove this equipment" hidden>Remove equipment</button>
    </div>

    <div class="rc-eq-subsection">
      <h4>Ownership</h4>
      <div class="rc-field-grid">
        <label>Purchase price (RM) <input type="number" class="rc-eq-purchase-price" min="0" step="100" value="350000"></label>
        <label>Residual value at end of life (RM) <input type="number" class="rc-eq-residual-value" min="0" step="100" value="70000"></label>
        <label>Useful life (years) <input type="number" class="rc-eq-useful-life-years" min="1" step="1" value="8"></label>
        <label>Insurance <span class="rc-hint">RM/year</span> <input type="number" class="rc-eq-insurance-annual" min="0" step="10" value="3500"></label>
        <label>Registration &amp; permits <span class="rc-hint">RM/year, road tax/CIDB if applicable</span> <input type="number" class="rc-eq-registration-annual" min="0" step="10" value="800"></label>
      </div>
      <label class="rc-toggle-row" style="margin-top:14px;"><input type="checkbox" class="rc-eq-financed-toggle"> Financed (loan / hire purchase)</label>
      <div class="rc-conditional-fields rc-eq-financing-fields" hidden>
        <div class="rc-field-grid">
          <label>Loan principal (RM) <input type="number" class="rc-eq-loan-principal" min="0" step="100" value="0"></label>
          <label>Annual interest rate % <input type="number" class="rc-eq-loan-rate" min="0" step="0.1" value="4.5"></label>
          <label>Tenure (years) <input type="number" class="rc-eq-loan-tenure" min="1" step="1" value="5"></label>
        </div>
        <p class="rc-live-note rc-eq-financing-note">Enter loan details to see estimated monthly interest.</p>
      </div>
    </div>

    <div class="rc-eq-subsection">
      <h4>Operating — includes wear &amp; tear</h4>
      <div class="rc-field-grid">
        <label>Fuel <span class="rc-hint">RM/hour</span> <input type="number" class="rc-eq-fuel-per-hour" min="0" step="0.5" value="25"></label>
        <label>Scheduled service cost (RM) <input type="number" class="rc-eq-maint-cost" min="0" step="10" value="600"></label>
        <label>Service interval (hours) <input type="number" class="rc-eq-maint-interval-hours" min="1" step="10" value="250"></label>
        <label>Wear &amp; tear reserve <span class="rc-hint">RM/hour — undercarriage, hoses, teeth, tires</span> <input type="number" class="rc-eq-wear-tear-per-hour" min="0" step="0.5" value="8"></label>
        <label>Unscheduled repair buffer % <input type="number" class="rc-eq-repair-buffer-pct" min="0" step="1" value="10"></label>
        <label>Operating hours per rental day <input type="number" class="rc-eq-hours-per-day" min="0" step="0.5" value="8"></label>
      </div>
    </div>

    <div class="rc-eq-subsection">
      <h4>Operator</h4>
      <label class="rc-toggle-row"><input type="checkbox" class="rc-eq-wet-hire-toggle" checked> Wet hire (operator included)</label>
      <div class="rc-conditional-fields rc-eq-operator-fields">
        <div class="rc-field-grid">
          <label>Basic monthly wage (RM) <span class="rc-hint">national minimum is RM1,700</span> <input type="number" class="rc-eq-operator-wage" min="0" step="10" value="2200"></label>
        </div>
        <label class="rc-toggle-row" style="margin-top:10px;"><input type="checkbox" class="rc-eq-foreign-worker"> Foreign worker <span class="tooltip-icon" data-tooltip="Changes the statutory estimate: EPF 2% employer only (mandatory since Oct 2025), SOCSO still applies, no EIS.">?</span></label>
        <p class="rc-live-note rc-eq-operator-estimate-note">\u2014</p>
      </div>
    </div>

    <div class="rc-eq-subsection">
      <h4>Utilization &amp; mobilization</h4>
      <div class="rc-field-grid">
        <label>Available days / month <input type="number" class="rc-eq-available-days" min="1" max="31" step="1" value="26"></label>
        <label>Expected rental (utilized) days / month <input type="number" class="rc-eq-expected-days" min="0" max="31" step="1" value="18"></label>
        <label>Mobilization fee (RM) <span class="rc-hint">transport + site-visit travel</span> <input type="number" class="rc-eq-mobilization-fee" min="0" step="10" value="400"></label>
        <label>Spread mobilization over <span class="rc-hint">rental days</span> <input type="number" class="rc-eq-mobilization-days" min="1" step="1" value="3"></label>
        <label>Target margin % <span class="rc-hint">this machine only</span> <input type="number" class="rc-eq-target-margin" min="0" max="99" step="1" value="25"></label>
      </div>
      <p class="rc-live-note rc-eq-utilization-note">\u2014</p>
    </div>

    <div class="rc-eq-subsection">
      <h4>Local market rates you've found for this machine</h4>
      <p class="structure-note" style="margin-bottom:10px;">Competitor quotes, marketplace listings, past jobs — whatever you've actually seen. Not looked up automatically; figures here are only as good as what you enter.</p>
      <div class="rc-row-list rc-eq-market-rows"></div>
      <div class="calc-actions no-print"><button type="button" class="btn btn-secondary rc-eq-add-market">+ Add market rate</button></div>
    </div>
  `;
  document.getElementById('rc-equipment-panels').appendChild(panel);

  // Every input in this panel just recalculates everything — cheap
  // enough at this scale, and avoids a second bookkeeping system for
  // "which exact figure changed."
  panel.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('input', recalculateAll);
    el.addEventListener('change', recalculateAll);
  });
  panel.querySelector('.rc-eq-name').addEventListener('input', () => { renderEquipmentTabs(); recalculateAll(); });
  panel.querySelector('.rc-eq-financed-toggle').addEventListener('change', (e) => {
    panel.querySelector('.rc-eq-financing-fields').hidden = !e.target.checked;
    recalculateAll();
  });
  panel.querySelector('.rc-eq-wet-hire-toggle').addEventListener('change', (e) => {
    panel.querySelector('.rc-eq-operator-fields').hidden = !e.target.checked;
    recalculateAll();
  });
  panel.querySelector('.rc-eq-add-market').addEventListener('click', () => { createMarketRow(panel); recalculateAll(); });

  panel.querySelector('.rc-remove-eq').addEventListener('click', () => {
    const wasActive = !panel.hidden;
    panel.remove();
    if (wasActive) {
      const remaining = document.querySelector('.rc-equipment-panel');
      if (remaining) switchToEquipment(remaining.dataset.eqId);
      else renderEquipmentTabs();
    } else {
      renderEquipmentTabs();
    }
    recalculateAll();
  });

  createMarketRow(panel); // start with one blank row, same "always at least one" convention as ingredient/overhead rows elsewhere on this site
  switchToEquipment(id);
  return panel;
}

function switchToEquipment(eqId) {
  document.querySelectorAll('.rc-equipment-panel').forEach((p) => { p.hidden = (p.dataset.eqId !== eqId); });
  renderEquipmentTabs();
  recalculateAll();
}

function renderEquipmentTabs() {
  const panels = Array.from(document.querySelectorAll('.rc-equipment-panel'));
  const tabsContainer = document.getElementById('rc-equipment-tabs');
  panels.forEach((p) => {
    const btn = p.querySelector('.rc-remove-eq');
    if (btn) btn.hidden = panels.length <= 1;
  });
  if (panels.length <= 1) {
    tabsContainer.innerHTML = '';
    if (panels.length === 1) panels[0].hidden = false;
    return;
  }
  tabsContainer.innerHTML = panels.map((p) => {
    const name = p.querySelector('.rc-eq-name').value.trim() || 'Untitled equipment';
    const isActive = !p.hidden;
    return `<button type="button" class="btn btn-secondary menu-tab-btn${isActive ? ' is-active' : ''}" data-eq-id="${p.dataset.eqId}">${escapeHTML(name)}</button>`;
  }).join('');
  tabsContainer.querySelectorAll('.menu-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchToEquipment(btn.dataset.eqId));
  });
}

function getActiveEquipmentPanel() {
  return document.querySelector('.rc-equipment-panel:not([hidden])') || document.querySelector('.rc-equipment-panel');
}

/* ================= MARKET RATE ROWS (per equipment) ================= */

function createMarketRow(panel) {
  const container = panel.querySelector('.rc-eq-market-rows');
  const row = document.createElement('div');
  row.className = 'rc-row-item';
  row.innerHTML = `
    <input type="text" class="rc-market-source" placeholder="e.g. Competitor quote, marketplace listing">
    <input type="number" class="rc-market-rate" min="0" step="1" value="0" placeholder="Rate (RM)">
    <select class="rc-market-period">
      <option value="day" selected>per day</option>
      <option value="hour">per hour</option>
      <option value="month">per month</option>
    </select>
    <button type="button" class="delete-row rc-remove-market" aria-label="Remove this market rate">&times;</button>
  `;
  container.appendChild(row);
  row.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', recalculateAll));
  row.querySelector('select').addEventListener('change', recalculateAll);
  row.querySelector('.rc-remove-market').addEventListener('click', () => { row.remove(); recalculateAll(); });
}

function toDailyRate(rate, period) {
  if (period === 'hour') return rate * MARKET_RATE_HOURS_PER_DAY;
  if (period === 'month') return rate / MARKET_RATE_DAYS_PER_MONTH;
  return rate;
}

function collectMarketRates(panel) {
  return Array.from(panel.querySelectorAll('.rc-eq-market-rows .rc-row-item')).map((row) => ({
    source: row.querySelector('.rc-market-source').value.trim(),
    dailyRate: toDailyRate(num(row.querySelector('.rc-market-rate')), row.querySelector('.rc-market-period').value),
  })).filter((r) => r.dailyRate > 0);
}

/* ================= PARTNER ROWS (shared) ================= */

function createPartnerRow(name, pct) {
  const container = document.getElementById('rc-partner-rows');
  const row = document.createElement('div');
  row.className = 'rc-row-item rc-row-item-3col';
  row.innerHTML = `
    <input type="text" class="rc-partner-name" value="${escapeHTML(name)}" aria-label="Partner name">
    <input type="number" class="rc-partner-pct" min="0" max="100" step="0.5" value="${pct}" aria-label="Partner percentage">
    <button type="button" class="delete-row rc-remove-partner" aria-label="Remove this partner">&times;</button>
  `;
  container.appendChild(row);
  row.querySelectorAll('input').forEach((el) => el.addEventListener('input', recalculateAll));
  row.querySelector('.rc-remove-partner').addEventListener('click', () => { row.remove(); recalculateAll(); });
}

function collectPartnerSharePct() {
  return Array.from(document.querySelectorAll('#rc-partner-rows .rc-row-item')).reduce((sum, row) => sum + numOrZero(num(row.querySelector('.rc-partner-pct'))), 0);
}

/* ================= PIE CHART (ported — generic pie math, reused as-is
   from margin-audit-calculator.js / interactive-costing-analysis.js) ================= */

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
    { key: 'ingredients', name: 'Equipment costs', pct: mix.ingredients },
    { key: 'overhead', name: 'Overhead', pct: mix.overhead },
    { key: 'manpower', name: 'Operator', pct: mix.manpower },
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

/* ================= MATH ENGINE (pure function, no DOM writes) ================= */

// sharedCtx = { overheadPerMachine, combinedShare, memberDiscountPct, memberMode }
function computeEquipment(fields, sharedCtx) {
  const monthlyDepreciation = fields.usefulLifeYears > 0
    ? (fields.purchasePrice - fields.residualValue) / (fields.usefulLifeYears * 12)
    : 0;

  let avgMonthlyInterest = 0;
  if (fields.financed) {
    avgMonthlyInterest = computeLoanAmortization(fields.loanPrincipal, fields.loanRate, fields.loanTenure).avgMonthlyInterest;
  }

  const ownershipMonthlyOnly = monthlyDepreciation + avgMonthlyInterest + (fields.insuranceAnnual / 12) + (fields.registrationAnnual / 12);
  const ownershipPerDay = fields.expectedDays > 0 ? ownershipMonthlyOnly / fields.expectedDays : 0;
  const overheadPerDay = fields.expectedDays > 0 ? sharedCtx.overheadPerMachine / fields.expectedDays : 0;

  const rawOperatingPerHour = fields.fuelPerHour
    + (fields.maintIntervalHours > 0 ? fields.maintCost / fields.maintIntervalHours : 0)
    + fields.wearTearPerHour;
  const bufferedOperatingPerHour = rawOperatingPerHour * (1 + fields.repairBufferPct / 100);
  const operatingPerDay = bufferedOperatingPerHour * fields.hoursPerDay;

  const statutoryMultiplier = fields.foreignWorker ? ESTIMATED_STATUTORY_MULTIPLIER_FOREIGN : ESTIMATED_STATUTORY_MULTIPLIER_CITIZEN;
  const operatorMonthlyCost = fields.wetHire ? fields.operatorWage * statutoryMultiplier : 0;
  const operatorPerDay = (fields.wetHire && fields.expectedDays > 0) ? operatorMonthlyCost / fields.expectedDays : 0;

  const mobilizationPerDay = fields.mobilizationDays > 0 ? fields.mobilizationFee / fields.mobilizationDays : 0;

  const trueCostPerDay = ownershipPerDay + operatingPerDay + operatorPerDay + overheadPerDay + mobilizationPerDay;

  const targetPricePerDay = fields.targetMarginPct < 100 ? trueCostPerDay / (1 - fields.targetMarginPct / 100) : Infinity;

  const shareOk = sharedCtx.combinedShare < 1;
  let standardPerDay, nonMemberPerDay;
  if (sharedCtx.memberMode === 'discount_list') {
    nonMemberPerDay = shareOk ? targetPricePerDay / (1 - sharedCtx.combinedShare) : Infinity;
    standardPerDay = isFinite(nonMemberPerDay) ? nonMemberPerDay * (1 - sharedCtx.memberDiscountPct / 100) : Infinity;
  } else {
    standardPerDay = shareOk ? targetPricePerDay / (1 - sharedCtx.combinedShare) : Infinity;
    nonMemberPerDay = (isFinite(standardPerDay) && sharedCtx.memberDiscountPct < 100)
      ? standardPerDay / (1 - sharedCtx.memberDiscountPct / 100) : Infinity;
  }

  const marginAt = (price) => {
    if (!isFinite(price) || price <= 0) return 0;
    const net = price * (1 - sharedCtx.combinedShare);
    return ((net - trueCostPerDay) / price) * 100;
  };
  const marginStandard = marginAt(standardPerDay);
  const marginNonMember = marginAt(nonMemberPerDay);

  const fixedMonthlyCost = ownershipMonthlyOnly + sharedCtx.overheadPerMachine + (fields.wetHire ? operatorMonthlyCost : 0);
  const contributionMarginPerDay = isFinite(standardPerDay) ? standardPerDay - operatingPerDay - mobilizationPerDay : -Infinity;
  const breakevenDays = (isFinite(standardPerDay) && contributionMarginPerDay > 0) ? fixedMonthlyCost / contributionMarginPerDay : Infinity;

  const monthlyRevenueAtExpected = isFinite(standardPerDay) ? standardPerDay * fields.expectedDays : 0;

  return {
    name: fields.name, category: fields.category,
    ownershipPerDay, operatingPerDay, operatorPerDay, overheadPerDay, mobilizationPerDay, trueCostPerDay,
    targetPricePerDay, standardPerDay, nonMemberPerDay, marginStandard, marginNonMember,
    breakevenDays, monthlyRevenueAtExpected, expectedDays: fields.expectedDays, availableDays: fields.availableDays,
    targetMarginPct: fields.targetMarginPct, marketRates: fields.marketRates,
  };
}

function structureMix(eq) {
  const price = eq.standardPerDay > 0 && isFinite(eq.standardPerDay) ? eq.standardPerDay : 1;
  const equipmentCosts = eq.ownershipPerDay + eq.operatingPerDay + eq.mobilizationPerDay;
  const margin = price - equipmentCosts - eq.overheadPerDay - eq.operatorPerDay;
  return {
    ingredients: (equipmentCosts / price) * 100,
    overhead: (eq.overheadPerDay / price) * 100,
    manpower: (eq.operatorPerDay / price) * 100,
    margin: (margin / price) * 100,
  };
}

/* ================= READ ONE PANEL'S FIELDS ================= */

function readEquipmentFields(panel) {
  return {
    name: panel.querySelector('.rc-eq-name').value.trim() || 'Untitled equipment',
    category: panel.querySelector('.rc-eq-category').value,
    purchasePrice: num(panel.querySelector('.rc-eq-purchase-price')),
    residualValue: num(panel.querySelector('.rc-eq-residual-value')),
    usefulLifeYears: num(panel.querySelector('.rc-eq-useful-life-years'), 1),
    insuranceAnnual: num(panel.querySelector('.rc-eq-insurance-annual')),
    registrationAnnual: num(panel.querySelector('.rc-eq-registration-annual')),
    financed: panel.querySelector('.rc-eq-financed-toggle').checked,
    loanPrincipal: num(panel.querySelector('.rc-eq-loan-principal')),
    loanRate: num(panel.querySelector('.rc-eq-loan-rate')),
    loanTenure: num(panel.querySelector('.rc-eq-loan-tenure'), 1),
    fuelPerHour: num(panel.querySelector('.rc-eq-fuel-per-hour')),
    maintCost: num(panel.querySelector('.rc-eq-maint-cost')),
    maintIntervalHours: num(panel.querySelector('.rc-eq-maint-interval-hours'), 1),
    wearTearPerHour: num(panel.querySelector('.rc-eq-wear-tear-per-hour')),
    repairBufferPct: num(panel.querySelector('.rc-eq-repair-buffer-pct')),
    hoursPerDay: num(panel.querySelector('.rc-eq-hours-per-day')),
    wetHire: panel.querySelector('.rc-eq-wet-hire-toggle').checked,
    operatorWage: num(panel.querySelector('.rc-eq-operator-wage')),
    foreignWorker: panel.querySelector('.rc-eq-foreign-worker').checked,
    availableDays: num(panel.querySelector('.rc-eq-available-days'), 26),
    expectedDays: num(panel.querySelector('.rc-eq-expected-days')),
    mobilizationFee: num(panel.querySelector('.rc-eq-mobilization-fee')),
    mobilizationDays: num(panel.querySelector('.rc-eq-mobilization-days'), 1),
    targetMarginPct: num(panel.querySelector('.rc-eq-target-margin'), 25),
    marketRates: collectMarketRates(panel),
  };
}

function collectEquipment(sharedCtx) {
  const panels = Array.from(document.querySelectorAll('.rc-equipment-panel'));
  const overheadPerMachine = panels.length > 0 ? sharedCtx.sharedOverheadTotal / panels.length : 0;
  return panels.map((panel) => {
    const fields = readEquipmentFields(panel);
    const eq = computeEquipment(fields, { ...sharedCtx, overheadPerMachine });
    return { panel, fields, eq };
  });
}

/* ================= RENDER: live per-panel notes ================= */

function renderPanelLiveNotes(panel, overheadPerMachine) {
  const fields = readEquipmentFields(panel);

  const financeNote = panel.querySelector('.rc-eq-financing-note');
  if (financeNote) {
    if (fields.financed && fields.loanPrincipal > 0) {
      const { monthlyInstallment, avgMonthlyInterest } = computeLoanAmortization(fields.loanPrincipal, fields.loanRate, fields.loanTenure);
      financeNote.innerHTML = `Estimated installment: <strong>${formatRM(monthlyInstallment)}</strong>/month, of which <strong>${formatRM(avgMonthlyInterest)}</strong>/month is interest (averaged across the tenure) — only the interest portion counts as a cost here, since the principal is already captured by depreciation above.`;
    } else {
      financeNote.textContent = 'Enter loan details to see estimated monthly interest.';
    }
  }

  const operatorNote = panel.querySelector('.rc-eq-operator-estimate-note');
  if (operatorNote) {
    if (fields.wetHire && fields.operatorWage > 0) {
      const mult = fields.foreignWorker ? ESTIMATED_STATUTORY_MULTIPLIER_FOREIGN : ESTIMATED_STATUTORY_MULTIPLIER_CITIZEN;
      const est = fields.operatorWage * mult;
      operatorNote.innerHTML = `Estimated employer cost incl. statutory: <strong>${formatRM(est)}</strong>/month (\u00d7${mult.toFixed(3)}, quick estimate — pull the exact figure from Overhead &amp; Manpower Calculator for one operator if precision matters).`;
      if (fields.operatorWage < 1700 && !fields.foreignWorker) {
        operatorNote.innerHTML += ' <strong style="color:#C0392B;">Below the RM1,700 national minimum wage.</strong>';
      }
    } else {
      operatorNote.textContent = '\u2014';
    }
  }

  const utilNote = panel.querySelector('.rc-eq-utilization-note');
  if (utilNote) {
    const pct = fields.availableDays > 0 ? (fields.expectedDays / fields.availableDays) * 100 : 0;
    utilNote.innerHTML = `Utilization: <strong>${Math.round(pct)}%</strong> of available days (${fields.expectedDays} of ${fields.availableDays}). Overhead share for this machine: <strong>${formatRM(overheadPerMachine)}</strong>/month.`;
  }
}

/* ================= RENDER: Results ================= */

function renderCompareTable(computed) {
  const tbody = document.getElementById('rc-compare-rows');
  if (!computed.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted); font-family:var(--font-body);">Add equipment in Rental Calculation to see it here.</td></tr>';
    return;
  }
  tbody.innerHTML = computed.map(({ panel, eq }) => {
    const isActive = !panel.hidden;
    const lossCls = eq.marginStandard < 0 ? ' is-loss' : '';
    return `<tr style="${isActive ? 'background:var(--accent-soft);' : ''}">
      <td>${escapeHTML(eq.name)}</td>
      <td>${formatRM(eq.trueCostPerDay)}</td>
      <td>${isFinite(eq.standardPerDay) ? formatRM(eq.standardPerDay) : 'Not reachable'}</td>
      <td>${isFinite(eq.nonMemberPerDay) ? formatRM(eq.nonMemberPerDay) : 'Not reachable'}</td>
      <td class="${eq.marginStandard < 0 ? 'is-loss' : ''}">${eq.marginStandard.toFixed(1)}%</td>
    </tr>`;
  }).join('');
}

function renderDetail(eq) {
  document.getElementById('rc-detail-name').textContent = eq.name;
  document.getElementById('rc-tc-ownership').textContent = formatRM(eq.ownershipPerDay);
  document.getElementById('rc-tc-operating').textContent = formatRM(eq.operatingPerDay);
  document.getElementById('rc-tc-operator').textContent = formatRM(eq.operatorPerDay);
  document.getElementById('rc-tc-overhead').textContent = formatRM(eq.overheadPerDay);
  document.getElementById('rc-tc-mobilization').textContent = formatRM(eq.mobilizationPerDay);
  document.getElementById('rc-tc-total').textContent = formatRM(eq.trueCostPerDay);

  document.getElementById('rc-res-target').textContent = isFinite(eq.targetPricePerDay) ? formatRM(eq.targetPricePerDay) : 'Not reachable';
  document.getElementById('rc-res-standard').textContent = isFinite(eq.standardPerDay) ? formatRM(eq.standardPerDay) : 'Not reachable';
  document.getElementById('rc-res-nonmember').textContent = isFinite(eq.nonMemberPerDay) ? formatRM(eq.nonMemberPerDay) : 'Not reachable';

  const marginStdEl = document.getElementById('rc-res-margin-standard');
  marginStdEl.textContent = eq.marginStandard.toFixed(1) + '%';
  marginStdEl.closest('.result-card').classList.toggle('is-loss', eq.marginStandard < 0);
  const marginNmEl = document.getElementById('rc-res-margin-nonmember');
  marginNmEl.textContent = eq.marginNonMember.toFixed(1) + '%';
  marginNmEl.closest('.result-card').classList.toggle('is-loss', eq.marginNonMember < 0);

  document.getElementById('rc-res-breakeven').textContent = formatDays(eq.breakevenDays);
  document.getElementById('rc-res-breakeven').closest('.result-card').classList.toggle('is-loss', !isFinite(eq.breakevenDays));
  document.getElementById('rc-res-monthly-revenue').textContent = formatRM(eq.monthlyRevenueAtExpected);

  const insightEl = document.getElementById('rc-utilization-insight');
  if (isFinite(eq.breakevenDays) && eq.expectedDays > eq.breakevenDays) {
    const extra = eq.expectedDays - eq.breakevenDays;
    insightEl.textContent = `At the standard price, this machine breaks even after about ${formatDays(eq.breakevenDays)} — the remaining ~${Math.floor(extra)} of your planned ${eq.expectedDays} rental days are largely pure profit, since fixed costs are already covered by then.`;
  } else if (isFinite(eq.breakevenDays)) {
    insightEl.textContent = `This machine needs about ${formatDays(eq.breakevenDays)} a month to break even — more than the ${eq.expectedDays} days you've planned for. Raise utilization, raise price, or trim fixed costs.`;
  } else {
    insightEl.textContent = 'At the current price, this machine can\u2019t reach break-even — operating costs alone exceed what the standard price recovers per day.';
  }

  const depositMemberPct = num(document.getElementById('rc-deposit-member-pct'), 20);
  const depositNonMemberPct = num(document.getElementById('rc-deposit-nonmember-pct'), 30);
  document.getElementById('rc-res-deposit-member').textContent = isFinite(eq.standardPerDay) ? formatRM(eq.standardPerDay * depositMemberPct / 100) : '\u2014';
  document.getElementById('rc-res-deposit-nonmember').textContent = isFinite(eq.nonMemberPerDay) ? formatRM(eq.nonMemberPerDay * depositNonMemberPct / 100) : '\u2014';
}

function renderStructureSection(eq) {
  const guideCategory = document.getElementById('rc-guide-category-select').value;
  const guide = GUIDE_RATIOS[guideCategory] || GUIDE_RATIOS.other;
  const mix = structureMix(eq);
  const isLosing = mix.margin < 0;
  document.getElementById('rc-structure-loss-flag').hidden = !isLosing;

  const guideSelect = document.getElementById('rc-guide-category-select');
  const guideLabel = guideSelect.options[guideSelect.selectedIndex].textContent;

  document.getElementById('rc-structure-pie-yours').innerHTML =
    renderStructurePie('This machine' + (isLosing ? ' (losing money)' : ''), mix);
  document.getElementById('rc-structure-pie-guide').innerHTML =
    renderStructurePie('Guide, ' + guideLabel, guide);
}

function renderMarketSection(eq) {
  const el = document.getElementById('rc-market-summary');
  if (!eq.marketRates.length) {
    el.textContent = 'Add a market rate below to compare.';
    return;
  }
  const rates = eq.marketRates.map((r) => r.dailyRate);
  const min = Math.min(...rates), max = Math.max(...rates), avg = rates.reduce((a, b) => a + b, 0) / rates.length;
  const vsStandard = isFinite(eq.standardPerDay) && avg > 0 ? ((eq.standardPerDay - avg) / avg) * 100 : null;
  let posText = '';
  if (vsStandard !== null) {
    posText = vsStandard > 0
      ? ` Your standard price is ${Math.abs(vsStandard).toFixed(0)}% above that average.`
      : ` Your standard price is ${Math.abs(vsStandard).toFixed(0)}% below that average.`;
  }
  el.innerHTML = `${eq.marketRates.length} rate${eq.marketRates.length === 1 ? '' : 's'} entered, normalized to a daily equivalent: <strong>${formatRM(min)}\u2013${formatRM(max)}</strong>, average <strong>${formatRM(avg)}</strong>.${posText}`;
}

function renderInsights(eq, computed) {
  const insights = [];

  if (eq.marginStandard < 0) {
    insights.push({ level: 'alert', text: `${eq.name} is priced below true cost at the standard rate \u2014 every rental day loses money before revenue-share partners are even paid.` });
  } else if (eq.marginStandard < eq.targetMarginPct - 5) {
    insights.push({ level: 'warn', text: `${eq.name}'s achieved margin (${eq.marginStandard.toFixed(1)}%) is running below its ${eq.targetMarginPct}% target \u2014 check the member-pricing mode in the Margin &amp; Member Pricing tab if this is unexpected.` });
  }

  if (isFinite(eq.breakevenDays) && eq.expectedDays > eq.breakevenDays) {
    insights.push({ level: 'good', text: `${eq.name} clears break-even with room to spare \u2014 about ${formatDays(eq.breakevenDays)} needed against ${eq.expectedDays} planned.` });
  } else if (!isFinite(eq.breakevenDays)) {
    insights.push({ level: 'alert', text: `${eq.name} can't reach break-even at the current price \u2014 operating cost alone exceeds what's recovered per day.` });
  } else {
    insights.push({ level: 'warn', text: `${eq.name} needs more rental days than currently planned to break even this month \u2014 utilization is the fastest lever here, more than price.` });
  }

  if (eq.marketRates.length) {
    const rates = eq.marketRates.map((r) => r.dailyRate);
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    if (isFinite(eq.standardPerDay) && avg > 0) {
      const diff = ((eq.standardPerDay - avg) / avg) * 100;
      if (diff > 15) insights.push({ level: 'warn', text: `${eq.name}'s standard price is well above the market rates you've entered (+${diff.toFixed(0)}%) \u2014 worth checking you're not pricing yourself out, unless your service genuinely justifies the premium.` });
      else if (diff < -15) insights.push({ level: 'good', text: `${eq.name}'s standard price undercuts the market rates you've entered (${diff.toFixed(0)}%) while still hitting your target margin \u2014 real room to raise price before you'd need to worry about being uncompetitive.` });
    }
  }

  const lossCount = computed.filter((c) => c.eq.marginStandard < 0).length;
  if (computed.length > 1 && lossCount > 0) {
    insights.push({ level: 'alert', text: `${lossCount} of ${computed.length} machines are priced below true cost at their standard rate \u2014 see the comparison table above for which ones.` });
  }

  if (!insights.length) insights.push({ level: 'good', text: 'Nothing stands out \u2014 this machine is pricing above cost and on track for its target margin.' });

  const iconFor = { alert: '\u26A0\uFE0F', warn: '\uD83D\uDD0D', good: '\u2705' };
  document.getElementById('rc-insights').innerHTML = insights.map((i) => `
    <div class="rc-insight-card ${i.level === 'alert' ? 'is-alert' : i.level === 'warn' ? 'is-warn' : 'is-good'}">
      <span class="rc-insight-icon">${iconFor[i.level]}</span><span>${i.text}</span>
    </div>`).join('');
}

/* ================= SHARED-SETTINGS TABS (accordion, same mechanism as
   Margin Analysis's ma-calc-tab) ================= */

function setCalcTabOpen(key, open) {
  const btn = document.querySelector(`.rc-calc-tab[data-calc-tab="${key}"]`);
  const panel = document.querySelector(`.rc-calc-panel[data-calc-panel="${key}"]`);
  if (!btn || !panel) return;
  panel.hidden = !open;
  btn.classList.toggle('is-active', open);
  btn.setAttribute('aria-expanded', String(open));
}
function toggleCalcTab(key) {
  const panel = document.querySelector(`.rc-calc-panel[data-calc-panel="${key}"]`);
  if (!panel) return;
  setCalcTabOpen(key, panel.hidden);
}

function resetAllCalculationData() {
  const ok = confirm('Clear every equipment tab, and reset shared overhead, revenue-share partners, SST, and pricing policy back to their starting defaults? This can\u2019t be undone.');
  if (!ok) return;

  document.getElementById('rc-equipment-panels').innerHTML = '';
  eqIdCounter = 0;
  createEquipmentPanel();
  renderEquipmentTabs();

  document.getElementById('rc-shared-overhead').value = 0;
  document.getElementById('rc-partner-rows').innerHTML = '';
  seedDefaultPartners();
  document.getElementById('rc-sst-toggle').checked = false;
  document.getElementById('rc-sst-fields').hidden = true;
  document.getElementById('rc-sst-pct').value = 6;
  document.getElementById('rc-member-discount').value = 20;
  document.getElementById('rc-mode-protect').checked = true;
  document.getElementById('rc-deposit-member-pct').value = 20;
  document.getElementById('rc-deposit-nonmember-pct').value = 30;

  setCalcTabOpen('equipment', true);
  setCalcTabOpen('overhead', false);
  setCalcTabOpen('partners', false);
  setCalcTabOpen('pricing', false);

  const feedback = document.getElementById('rc-dock-feedback');
  if (feedback) feedback.textContent = '\u2713 Cleared \u2014 Rental Calculation is back to its starting defaults.';

  recalculateAll();
}

function seedDefaultPartners() {
  // Three-way split as a starting point, not a guess — this is the
  // shape a real reference sheet for this kind of business used
  // (5% / 10% / 15%), generalized here to any number of rows so it's
  // no longer hard-coded to exactly two or three.
  createPartnerRow('Partner 1', 5);
  createPartnerRow('Partner 2', 10);
  createPartnerRow('Partner 3', 15);
}

/* ================= CROSS-TOOL SYNC (Overhead & Manpower only) ================= */

function handleSyncPayload(data) {
  if (data.source === 'overhead-manpower-calculator') {
    if (typeof data.overheadMonthly === 'number') {
      document.getElementById('rc-shared-overhead').value = data.overheadMonthly.toFixed(2);
      markSynced('#rc-shared-overhead-label', 'Overhead & Manpower'); // no-op if that label id doesn't exist; harmless
      setCalcTabOpen('overhead', true);
      const feedback = document.getElementById('rc-dock-feedback');
      if (feedback) feedback.textContent = `\u2713 Synced shared overhead (${formatRM(data.overheadMonthly)}/month) from Overhead & Manpower Calculator.`;
    }
    // Deliberately NOT auto-applying manpowerMonthly to any equipment's
    // operator field — that figure is a combined total for however many
    // staff exist in that tool, not one specific operator's cost. Shown
    // as an informational note instead so nothing gets silently
    // mis-assigned to the wrong machine. See the file-header comment.
    if (typeof data.manpowerMonthly === 'number') {
      const note = document.getElementById('rc-manpower-pull-note');
      if (note) {
        note.hidden = false;
        note.textContent = `That tool also totalled RM${data.manpowerMonthly.toFixed(2)}/month in manpower across however many staff you entered there \u2014 if one of them is an operator for a specific machine here, divide out their share and type it into that equipment's own "Basic monthly wage" field.`;
      }
    }
    recalculateAll();
  }
}
function initSync() {
  if (typeof rzListen !== 'function') return;
  rzListen(handleSyncPayload);
}

/* ================= TOOL DOCK (fetch-inject-execute) =================
   Same mechanism as Costing Analysis / Margin Analysis — see either
   file's own long comment for the two real problems this solves
   (duplicate top-level declarations if a tool's script were pasted in
   raw, and BroadcastChannel never delivering a message back to its
   own sender). Only one tool is offered here: Overhead & Manpower
   Calculator. Menu Calculator and Printing Calculator are deliberately
   not offered — neither has anything a rental cost model needs. */

const TOOL_DOCK_CONFIG = {
  'overhead-manpower-calculator': { scriptUrl: 'overhead-manpower-calculator.js', theme: 'theme-overhead' },
};

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
function setDockVisible(visible) { document.getElementById('tool-dock').hidden = !visible; }

async function rzLoadToolIntoDock(key) {
  if (typeof RZ_TOOLS === 'undefined' || !RZ_TOOLS[key]) return;
  const dockConfig = TOOL_DOCK_CONFIG[key];
  if (!dockConfig) return;
  const tool = RZ_TOOLS[key];
  const dock = document.getElementById('tool-dock');
  const body = document.getElementById('tool-dock-body');
  const titleEl = document.getElementById('tool-dock-title');
  const feedback = document.getElementById('rc-dock-feedback');
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
    const html = await fetch(tool.url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const main = doc.querySelector('main');
    if (!main) throw new Error('couldn\u2019t find that page\u2019s content');
    main.querySelectorAll('.rz-embed-hide').forEach((el) => { el.hidden = true; });
    main.querySelectorAll('#rz-switcher').forEach((el) => el.remove());

    const scriptText = await fetch(dockConfig.scriptUrl).then((r) => r.text());

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

/* ================= CONTROLLER ================= */

function recalculateAll() {
  try {
    const sharedOverheadTotal = num(document.getElementById('rc-shared-overhead'));
    const sstOn = document.getElementById('rc-sst-toggle').checked;
    const sstPct = sstOn ? num(document.getElementById('rc-sst-pct'), 6) : 0;
    const partnerSharePct = collectPartnerSharePct();
    const combinedShare = (sstPct + partnerSharePct) / 100;
    const memberDiscountPct = num(document.getElementById('rc-member-discount'), 20);
    const memberModeEl = document.querySelector('input[name="rc-member-mode"]:checked');
    const memberMode = memberModeEl ? memberModeEl.value : 'protect_standard';

    document.getElementById('rc-fee-warning').hidden = combinedShare < 1;

    const panelCount = document.querySelectorAll('.rc-equipment-panel').length;
    const overheadPerMachine = panelCount > 0 ? sharedOverheadTotal / panelCount : 0;
    document.getElementById('rc-overhead-split-note').innerHTML = panelCount > 0
      ? `Split across ${panelCount} equipment tab${panelCount === 1 ? '' : 's'}: <strong>${formatRM(overheadPerMachine)}</strong> each, per month.`
      : 'Add equipment above to see this split per machine.';

    const sharedCtx = { sharedOverheadTotal, combinedShare, memberDiscountPct, memberMode };
    const computed = collectEquipment(sharedCtx);

    computed.forEach(({ panel }) => renderPanelLiveNotes(panel, overheadPerMachine));

    renderCompareTable(computed);

    const activePanel = getActiveEquipmentPanel();
    const active = computed.find((c) => c.panel === activePanel) || computed[0];
    if (active) {
      renderDetail(active.eq);
      renderStructureSection(active.eq);
      renderMarketSection(active.eq);
      renderInsights(active.eq, computed);
    }
  } catch (err) {
    console.error('[Rental Calculator] recalculateAll failed partway through:', err);
  }
}

/* ================= INIT ================= */

let rzInitialized = false;

function init() {
  if (rzInitialized) return;
  rzInitialized = true;

  createEquipmentPanel();
  seedDefaultPartners();

  document.getElementById('rc-add-equipment').addEventListener('click', () => createEquipmentPanel());
  document.getElementById('rc-add-partner').addEventListener('click', () => { createPartnerRow('Partner', 5); recalculateAll(); });

  document.getElementById('rc-shared-overhead').addEventListener('input', recalculateAll);
  document.getElementById('rc-sst-toggle').addEventListener('change', (e) => {
    document.getElementById('rc-sst-fields').hidden = !e.target.checked;
    recalculateAll();
  });
  document.getElementById('rc-sst-pct').addEventListener('input', recalculateAll);
  document.getElementById('rc-member-discount').addEventListener('input', recalculateAll);
  document.querySelectorAll('input[name="rc-member-mode"]').forEach((r) => r.addEventListener('change', recalculateAll));
  document.getElementById('rc-deposit-member-pct').addEventListener('input', recalculateAll);
  document.getElementById('rc-deposit-nonmember-pct').addEventListener('input', recalculateAll);
  document.getElementById('rc-guide-category-select').addEventListener('change', recalculateAll);

  document.querySelectorAll('.rc-calc-tab[data-calc-tab]').forEach((btn) => {
    btn.addEventListener('click', () => toggleCalcTab(btn.dataset.calcTab));
  });
  document.getElementById('rc-reset-all').addEventListener('click', resetAllCalculationData);
  setCalcTabOpen('equipment', true);
  setCalcTabOpen('overhead', false);
  setCalcTabOpen('partners', false);
  setCalcTabOpen('pricing', false);

  document.querySelectorAll('[data-open-tool]').forEach((btn) => {
    btn.addEventListener('click', () => rzLoadToolIntoDock(btn.dataset.openTool));
  });
  document.getElementById('tool-dock-close').addEventListener('click', () => setDockVisible(false));

  document.getElementById('rc-save-pdf').addEventListener('click', () => window.print());

  // Floating quick-nav
  const quickNav = document.getElementById('rc-quick-nav');
  document.querySelectorAll('.rc-quick-nav-btn[data-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      target.querySelectorAll('details:not([open])').forEach((d) => { d.open = true; });
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  window.addEventListener('scroll', () => {
    quickNav.hidden = window.scrollY < window.innerHeight * 0.35;
  }, { passive: true });
  document.getElementById('rc-back-to-top').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

  initSync();
  recalculateAll();
}

document.addEventListener('DOMContentLoaded', init);
