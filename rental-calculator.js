/* ============================================================
   Rental Calculator
   Vanilla JS, no dependencies, nothing saved anywhere.
   ------------------------------------------------------------
   2026-09-12 REVISION -- real feedback from testing this against an
   actual quote round-trip. Five real problems fixed, not just
   polish:

   1. FIELD ALIGNMENT: fixed entirely in the HTML's own <style> block
      (.rc-field-grid label now bottom-anchors its input) -- nothing
      in this file changes for that one.

   2. THE ABSURD PRICE: root-caused to a single data-entry point, not
      a formula bug. Wear & tear used to be one bare "RM/hour" field
      -- entering a lump-sum figure there (thinking of it the way
      Scheduled Maintenance's "cost per service" works) silently
      became the PER-HOUR rate, and at 8 hours/day that error
      multiplies fast. Wear & tear is now entered exactly like
      Scheduled Maintenance -- a cost and the interval it covers --
      so there's no unit to get wrong by hand any more. A guardrail
      insight also now flags a wear&tear-or-maintenance rate that's
      wildly out of line with fuel cost, which is exactly the shape
      of the mistake that happened.

   3. OPERATOR COST: no longer a second, rougher wage/statutory
      estimate living on this page. It's a pure summary now, pulled
      from the SAME shared manpower pool that "Pull from Overhead &
      Manpower Calculator" already fills correctly -- see
      handleSyncPayload. This is also the actual fix for the reported
      "shared overhead isn't picking up manpower" bug: that field was
      real, it just wasn't wired to feed anything before. It is now.

   4. DRY vs WET, and HOURLY / DAILY / MONTHLY: real market quotes
      specify both of these independently ("RM700/day with operator",
      "RM1,050/day without"), and a provider's monthly rate is
      genuinely a different, lower number per day than their daily
      rate -- not the same rate expressed differently. computeEquipment
      below produces both cost bases (dry excludes fuel & operator)
      and all three tiers, and market-rate rows now carry their own
      period + service-level tags so comparison matches like for like
      instead of flattening everything into one number.

   5. TABS: Rental Calculation's four tabs are mutually exclusive now
      (showCalcTabOnly) rather than an independent accordion -- a
      deliberate difference from Margin Analysis's own tabs, per
      direct instruction for this tool specifically.

   COST MODEL, restated: Ownership (fixed, time-based: depreciation +
   financing interest + insurance + registration) and Maintenance &
   wear (variable, usage-based: scheduled service + wear & tear,
   buffered) are shared by dry and wet. Wet additionally adds Fuel and
   Operator. Overhead share is one shared pool split equally across
   every equipment tab. This is the same "Ownership & Operating" split
   used by real equipment-costing methodology (the US Army Corps of
   Engineers' EP 1110-1-8 model, among others) -- nothing invented for
   this tool specifically.
   ============================================================ */

console.info('[Rental Calculator] script build: 2026-09-12-v2-tiered-pricing');

/* ================= CONFIG ================= */

const MARKET_RATE_HOURS_PER_DAY = 8; // fixed reference for normalizing an hourly market rate to a daily one
const MARKET_RATE_DAYS_PER_MONTH = 26; // Malaysia's own standard working-day convention

// Rough, editable rule-of-thumb cost structure per equipment category --
// comparison only, never feeds the actual price. "ingredients" here means
// "equipment costs" (ownership + maintenance&wear + fuel + mobilization
// combined) -- reusing the same four-segment shape the rest of this
// site's structure pies already use.
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

/* ================= LOAN AMORTIZATION (pure function) ================= */
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
      <h4>Maintenance &amp; wear (excludes fuel)</h4>
      <div class="rc-field-grid">
        <label>Fuel <span class="rc-hint">RM/hour -- wet hire only</span> <input type="number" class="rc-eq-fuel-per-hour" min="0" step="0.5" value="25"></label>
        <label>Scheduled service cost (RM) <input type="number" class="rc-eq-maint-cost" min="0" step="10" value="600"></label>
        <label>Service interval (hours) <input type="number" class="rc-eq-maint-interval-hours" min="1" step="10" value="250"></label>
        <label>Wear &amp; tear cost (RM) <span class="rc-hint">undercarriage, hoses, teeth, tires</span> <input type="number" class="rc-eq-wear-tear-cost" min="0" step="100" value="20000"></label>
        <label>Wear &amp; tear covers <span class="rc-hint">hours -- same idea as service interval above</span> <input type="number" class="rc-eq-wear-tear-interval-hours" min="1" step="100" value="4000"></label>
        <label>Unscheduled repair buffer % <input type="number" class="rc-eq-repair-buffer-pct" min="0" step="1" value="10"></label>
        <label>Operating hours per rental day <input type="number" class="rc-eq-hours-per-day" min="0" step="0.5" value="8"></label>
      </div>
      <p class="rc-live-note rc-eq-operating-note">\u2014</p>
    </div>

    <div class="rc-eq-subsection">
      <h4>Operator</h4>
      <label class="rc-toggle-row"><input type="checkbox" class="rc-eq-wet-hire-toggle" checked> Wet hire (operator included)</label>
      <p class="rc-live-note rc-eq-operator-estimate-note">\u2014</p>
    </div>

    <div class="rc-eq-subsection">
      <h4>Utilization, mobilization &amp; tiers</h4>
      <div class="rc-field-grid">
        <label>Available days / month <input type="number" class="rc-eq-available-days" min="1" max="31" step="1" value="26"></label>
        <label>Expected rental (utilized) days / month <input type="number" class="rc-eq-expected-days" min="0" max="31" step="1" value="18"></label>
        <label>Mobilization fee (RM) <span class="rc-hint">transport + site-visit travel</span> <input type="number" class="rc-eq-mobilization-fee" min="0" step="10" value="400"></label>
        <label>Typical short-job length <span class="rc-hint">days -- spreads mobilization for the Daily tier</span> <input type="number" class="rc-eq-short-job-days" min="1" step="1" value="3"></label>
        <label>Typical monthly-job length <span class="rc-hint">days -- spreads mobilization for the Monthly tier</span> <input type="number" class="rc-eq-monthly-job-days" min="1" step="1" value="26"></label>
        <label>Hourly premium % <span class="rc-hint">on top of daily-rate/hours</span> <input type="number" class="rc-eq-hourly-premium-pct" min="0" step="1" value="25"></label>
        <label>Extra monthly discount % <span class="rc-hint">on top of the mobilization saving</span> <input type="number" class="rc-eq-monthly-discount-pct" min="0" max="90" step="1" value="12"></label>
        <label>Target margin % <span class="rc-hint">this machine only</span> <input type="number" class="rc-eq-target-margin" min="0" max="99" step="1" value="25"></label>
      </div>
      <p class="rc-live-note rc-eq-utilization-note">\u2014</p>
    </div>

    <div class="rc-eq-subsection">
      <h4>Local market rates you've found for this machine</h4>
      <p class="structure-note" style="margin-bottom:10px;">Tag each rate with its period and whether it includes driver &amp; fuel -- comparison in Results matches like for like instead of averaging everything into one number.</p>
      <div class="rc-row-list rc-eq-market-rows"></div>
      <div class="calc-actions no-print"><button type="button" class="btn btn-secondary rc-eq-add-market">+ Add market rate</button></div>
    </div>
  `;
  document.getElementById('rc-equipment-panels').appendChild(panel);

  panel.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('input', recalculateAll);
    el.addEventListener('change', recalculateAll);
  });
  panel.querySelector('.rc-eq-name').addEventListener('input', () => { renderEquipmentTabs(); recalculateAll(); });
  panel.querySelector('.rc-eq-financed-toggle').addEventListener('change', (e) => {
    panel.querySelector('.rc-eq-financing-fields').hidden = !e.target.checked;
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

  createMarketRow(panel);
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

/* ================= MARKET RATE ROWS (per equipment) =================
   Each row now carries BOTH a period (hour/day/month) AND a service
   level (dry/wet) -- a market quote of "RM700/day with driver" and one
   of "RM1,050/day without" are genuinely different numbers, not the
   same rate stated two ways, so they're kept as separate buckets
   rather than being flattened into a single blended average. */

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
    <select class="rc-market-service">
      <option value="wet" selected>with driver &amp; fuel</option>
      <option value="dry">without (dry)</option>
    </select>
    <button type="button" class="delete-row rc-remove-market" aria-label="Remove this market rate">&times;</button>
  `;
  container.appendChild(row);
  row.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', recalculateAll));
  row.querySelectorAll('select').forEach((el) => el.addEventListener('change', recalculateAll));
  row.querySelector('.rc-remove-market').addEventListener('click', () => { row.remove(); recalculateAll(); });
}

function collectMarketRates(panel) {
  return Array.from(panel.querySelectorAll('.rc-eq-market-rows .rc-row-item')).map((row) => ({
    source: row.querySelector('.rc-market-source').value.trim(),
    rate: num(row.querySelector('.rc-market-rate')),
    period: row.querySelector('.rc-market-period').value, // hour | day | month
    serviceLevel: row.querySelector('.rc-market-service').value, // dry | wet
  })).filter((r) => r.rate > 0);
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

function seedDefaultPartners() {
  createPartnerRow('Partner 1', 5);
  createPartnerRow('Partner 2', 10);
  createPartnerRow('Partner 3', 15);
}

/* ================= PIE CHART (ported -- generic pie math) ================= */

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

/* ================= MATH ENGINE (pure function, no DOM writes) =================
   sharedCtx = { overheadPerMachine, operatorPerMachine, combinedShare,
   memberDiscountPct, memberMode }. overheadPerMachine and
   operatorPerMachine are both computed once, at the collection level
   (see collectEquipment below), since both depend on how many
   equipment panels -- and how many of those are wet-hire -- exist
   right now, not on any single panel's own fields. */

function computeEquipment(fields, sharedCtx) {
  const monthlyDepreciation = fields.usefulLifeYears > 0
    ? (fields.purchasePrice - fields.residualValue) / (fields.usefulLifeYears * 12)
    : 0;
  const avgMonthlyInterest = fields.financed
    ? computeLoanAmortization(fields.loanPrincipal, fields.loanRate, fields.loanTenure).avgMonthlyInterest
    : 0;
  const ownershipMonthlyOnly = monthlyDepreciation + avgMonthlyInterest + (fields.insuranceAnnual / 12) + (fields.registrationAnnual / 12);
  const ownershipPerDay = fields.expectedDays > 0 ? ownershipMonthlyOnly / fields.expectedDays : 0;
  const overheadPerDay = fields.expectedDays > 0 ? sharedCtx.overheadPerMachine / fields.expectedDays : 0;

  const maintPerHour = fields.maintIntervalHours > 0 ? fields.maintCost / fields.maintIntervalHours : 0;
  const wearTearPerHour = fields.wearTearIntervalHours > 0 ? fields.wearTearCost / fields.wearTearIntervalHours : 0;
  const nonFuelPerHourRaw = maintPerHour + wearTearPerHour;
  const bufferedNonFuelPerHour = nonFuelPerHourRaw * (1 + fields.repairBufferPct / 100);
  const bufferedFuelPerHour = fields.fuelPerHour * (1 + fields.repairBufferPct / 100);
  const maintWearPerDay = bufferedNonFuelPerHour * fields.hoursPerDay;
  const fuelPerDay = bufferedFuelPerHour * fields.hoursPerDay;

  const operatorPerDay = (fields.wetHire && fields.expectedDays > 0) ? sharedCtx.operatorPerMachine / fields.expectedDays : 0;

  const dryCostBase = ownershipPerDay + maintWearPerDay + overheadPerDay;
  const wetCostBase = dryCostBase + fuelPerDay + operatorPerDay;

  const mobShortPerDay = fields.shortJobDays > 0 ? fields.mobilizationFee / fields.shortJobDays : 0;
  const mobMonthlyPerDay = fields.monthlyJobDays > 0 ? fields.mobilizationFee / fields.monthlyJobDays : 0;

  const trueCostDailyDry = dryCostBase + mobShortPerDay;
  const trueCostDailyWet = wetCostBase + mobShortPerDay;
  const trueCostMonthlyDry = dryCostBase + mobMonthlyPerDay;
  const trueCostMonthlyWet = wetCostBase + mobMonthlyPerDay;

  const priceFrom = (trueCost) => {
    const target = fields.targetMarginPct < 100 ? trueCost / (1 - fields.targetMarginPct / 100) : Infinity;
    const shareOk = sharedCtx.combinedShare < 1;
    let standard, nonMember;
    if (sharedCtx.memberMode === 'discount_list') {
      nonMember = shareOk ? target / (1 - sharedCtx.combinedShare) : Infinity;
      standard = isFinite(nonMember) ? nonMember * (1 - sharedCtx.memberDiscountPct / 100) : Infinity;
    } else {
      standard = shareOk ? target / (1 - sharedCtx.combinedShare) : Infinity;
      nonMember = (isFinite(standard) && sharedCtx.memberDiscountPct < 100) ? standard / (1 - sharedCtx.memberDiscountPct / 100) : Infinity;
    }
    return { standard, nonMember };
  };

  const dailyDry = priceFrom(trueCostDailyDry);
  const dailyWet = priceFrom(trueCostDailyWet);
  const monthlyDryRaw = priceFrom(trueCostMonthlyDry);
  const monthlyWetRaw = priceFrom(trueCostMonthlyWet);

  const monthlyDiscFactor = 1 - fields.monthlyDiscountPct / 100;
  const monthlyDry = { standard: monthlyDryRaw.standard * monthlyDiscFactor, nonMember: monthlyDryRaw.nonMember * monthlyDiscFactor };
  const monthlyWet = { standard: monthlyWetRaw.standard * monthlyDiscFactor, nonMember: monthlyWetRaw.nonMember * monthlyDiscFactor };

  const hourlyPremiumFactor = 1 + fields.hourlyPremiumPct / 100;
  const toHourly = (daily) => fields.hoursPerDay > 0
    ? { standard: (daily.standard / fields.hoursPerDay) * hourlyPremiumFactor, nonMember: (daily.nonMember / fields.hoursPerDay) * hourlyPremiumFactor }
    : { standard: Infinity, nonMember: Infinity };
  const hourlyDry = toHourly(dailyDry);
  const hourlyWet = toHourly(dailyWet);

  const marginAt = (price, trueCost) => {
    if (!isFinite(price) || price <= 0) return 0;
    const net = price * (1 - sharedCtx.combinedShare);
    return ((net - trueCost) / price) * 100;
  };
  const marginStandard = marginAt(dailyWet.standard, trueCostDailyWet);
  const marginNonMember = marginAt(dailyWet.nonMember, trueCostDailyWet);

  const fixedMonthlyCost = ownershipMonthlyOnly + sharedCtx.overheadPerMachine + (fields.wetHire ? sharedCtx.operatorPerMachine : 0);
  const contributionMarginPerDay = isFinite(dailyWet.standard) ? dailyWet.standard - maintWearPerDay - fuelPerDay - mobShortPerDay : -Infinity;
  const breakevenDays = (isFinite(dailyWet.standard) && contributionMarginPerDay > 0) ? fixedMonthlyCost / contributionMarginPerDay : Infinity;

  const monthlyRevenueAtExpected = isFinite(dailyWet.standard) ? dailyWet.standard * fields.expectedDays : 0;

  return {
    name: fields.name, category: fields.category,
    ownershipPerDay, maintWearPerDay, fuelPerDay, operatorPerDay, overheadPerDay,
    trueCostDailyDry, trueCostDailyWet,
    hourlyDry, hourlyWet, dailyDry, dailyWet, monthlyDry, monthlyWet,
    marginStandard, marginNonMember, breakevenDays, monthlyRevenueAtExpected,
    expectedDays: fields.expectedDays, availableDays: fields.availableDays,
    targetMarginPct: fields.targetMarginPct, marketRates: fields.marketRates,
    maintPerHour, wearTearPerHour, fuelPerHour: fields.fuelPerHour, wetHire: fields.wetHire,
  };
}

function structureMix(eq) {
  const price = eq.dailyWet.standard > 0 && isFinite(eq.dailyWet.standard) ? eq.dailyWet.standard : 1;
  const equipmentCosts = (eq.trueCostDailyWet - eq.overheadPerDay - eq.operatorPerDay); // ownership + maint&wear + fuel + mobilization
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
    wearTearCost: num(panel.querySelector('.rc-eq-wear-tear-cost')),
    wearTearIntervalHours: num(panel.querySelector('.rc-eq-wear-tear-interval-hours'), 1),
    repairBufferPct: num(panel.querySelector('.rc-eq-repair-buffer-pct')),
    hoursPerDay: num(panel.querySelector('.rc-eq-hours-per-day')),
    wetHire: panel.querySelector('.rc-eq-wet-hire-toggle').checked,
    availableDays: num(panel.querySelector('.rc-eq-available-days'), 26),
    expectedDays: num(panel.querySelector('.rc-eq-expected-days')),
    mobilizationFee: num(panel.querySelector('.rc-eq-mobilization-fee')),
    shortJobDays: num(panel.querySelector('.rc-eq-short-job-days'), 1),
    monthlyJobDays: num(panel.querySelector('.rc-eq-monthly-job-days'), 26),
    hourlyPremiumPct: num(panel.querySelector('.rc-eq-hourly-premium-pct')),
    monthlyDiscountPct: num(panel.querySelector('.rc-eq-monthly-discount-pct')),
    targetMarginPct: num(panel.querySelector('.rc-eq-target-margin'), 25),
    marketRates: collectMarketRates(panel),
  };
}

function collectEquipment(sharedCtx) {
  const panels = Array.from(document.querySelectorAll('.rc-equipment-panel'));
  const overheadPerMachine = panels.length > 0 ? sharedCtx.sharedOverheadTotal / panels.length : 0;
  const wetHireCount = panels.filter((p) => p.querySelector('.rc-eq-wet-hire-toggle').checked).length;
  const operatorPerMachine = wetHireCount > 0 ? sharedCtx.sharedManpowerTotal / wetHireCount : 0;
  return panels.map((panel) => {
    const fields = readEquipmentFields(panel);
    const eq = computeEquipment(fields, { ...sharedCtx, overheadPerMachine, operatorPerMachine });
    return { panel, fields, eq };
  });
}

/* ================= RENDER: live per-panel notes ================= */

function renderPanelLiveNotes(panel, overheadPerMachine, operatorPerMachine) {
  const fields = readEquipmentFields(panel);

  const financeNote = panel.querySelector('.rc-eq-financing-note');
  if (financeNote) {
    if (fields.financed && fields.loanPrincipal > 0) {
      const { monthlyInstallment, avgMonthlyInterest } = computeLoanAmortization(fields.loanPrincipal, fields.loanRate, fields.loanTenure);
      financeNote.innerHTML = `Estimated installment: <strong>${formatRM(monthlyInstallment)}</strong>/month, of which <strong>${formatRM(avgMonthlyInterest)}</strong>/month is interest -- only the interest counts as a cost here, since the principal is already captured by depreciation above.`;
    } else {
      financeNote.textContent = 'Enter loan details to see estimated monthly interest.';
    }
  }

  const opNote = panel.querySelector('.rc-eq-operating-note');
  if (opNote) {
    const maintPerHour = fields.maintIntervalHours > 0 ? fields.maintCost / fields.maintIntervalHours : 0;
    const wearPerHour = fields.wearTearIntervalHours > 0 ? fields.wearTearCost / fields.wearTearIntervalHours : 0;
    opNote.innerHTML = `Works out to <strong>${formatRM(maintPerHour)}</strong>/hour maintenance and <strong>${formatRM(wearPerHour)}</strong>/hour wear &amp; tear.`;
    if (fields.fuelPerHour > 0 && (maintPerHour + wearPerHour) > fields.fuelPerHour * 8) {
      opNote.innerHTML += ` <strong style="color:#C0392B;">That combined rate is unusually high next to fuel (RM${fields.fuelPerHour}/hour) -- double-check the cost and interval you entered.</strong>`;
    }
  }

  const operatorNote = panel.querySelector('.rc-eq-operator-estimate-note');
  if (operatorNote) {
    if (fields.wetHire) {
      if (operatorPerMachine > 0) {
        operatorNote.classList.remove('is-empty');
        operatorNote.innerHTML = `This machine's share: <strong>${formatRM(operatorPerMachine)}</strong>/month, from the shared manpower pool (set in the "Shared Overhead &amp; Manpower" tab).`;
      } else {
        operatorNote.classList.add('is-empty');
        operatorNote.textContent = 'Shared manpower pool is RM0 right now -- set it in the "Shared Overhead & Manpower" tab, or pull it from Overhead & Manpower Calculator, to see this machine\u2019s operator cost.';
      }
    } else {
      operatorNote.classList.add('is-empty');
      operatorNote.textContent = 'Dry hire -- no operator cost applied.';
    }
  }

  const utilNote = panel.querySelector('.rc-eq-utilization-note');
  if (utilNote) {
    const pct = fields.availableDays > 0 ? (fields.expectedDays / fields.availableDays) * 100 : 0;
    utilNote.innerHTML = `Utilization: <strong>${Math.round(pct)}%</strong> of available days (${fields.expectedDays} of ${fields.availableDays}). Overhead share: <strong>${formatRM(overheadPerMachine)}</strong>/month for this machine.`;
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
    return `<tr style="${isActive ? 'background:var(--accent-soft);' : ''}">
      <td>${escapeHTML(eq.name)}</td>
      <td>${formatRM(eq.trueCostDailyWet)}</td>
      <td>${isFinite(eq.dailyWet.standard) ? formatRM(eq.dailyWet.standard) : 'Not reachable'}</td>
      <td>${isFinite(eq.dailyWet.nonMember) ? formatRM(eq.dailyWet.nonMember) : 'Not reachable'}</td>
      <td class="${eq.marginStandard < 0 ? 'is-loss' : ''}">${eq.marginStandard.toFixed(1)}%</td>
    </tr>`;
  }).join('');
}

function renderDetail(eq) {
  document.getElementById('rc-detail-name').textContent = eq.name;
  document.getElementById('rc-tc-ownership').textContent = formatRM(eq.ownershipPerDay);
  document.getElementById('rc-tc-maint').textContent = formatRM(eq.maintWearPerDay);
  document.getElementById('rc-tc-overhead').textContent = formatRM(eq.overheadPerDay);
  document.getElementById('rc-tc-dry').textContent = formatRM(eq.trueCostDailyDry);
  document.getElementById('rc-tc-fuel').textContent = formatRM(eq.fuelPerDay);
  document.getElementById('rc-tc-operator').textContent = formatRM(eq.operatorPerDay);
  document.getElementById('rc-tc-wet').textContent = formatRM(eq.trueCostDailyWet);

  const priceCell = (p) => isFinite(p) ? formatRM(p) : 'Not reachable';
  document.getElementById('rc-pricing-rows').innerHTML = `
    <tr><td>Dry -- Standard</td><td>${priceCell(eq.hourlyDry.standard)}</td><td>${priceCell(eq.dailyDry.standard)}</td><td>${priceCell(eq.monthlyDry.standard)}</td></tr>
    <tr><td>Dry -- Non-member</td><td>${priceCell(eq.hourlyDry.nonMember)}</td><td>${priceCell(eq.dailyDry.nonMember)}</td><td>${priceCell(eq.monthlyDry.nonMember)}</td></tr>
    <tr><td>Wet -- Standard</td><td>${priceCell(eq.hourlyWet.standard)}</td><td>${priceCell(eq.dailyWet.standard)}</td><td>${priceCell(eq.monthlyWet.standard)}</td></tr>
    <tr><td>Wet -- Non-member</td><td>${priceCell(eq.hourlyWet.nonMember)}</td><td>${priceCell(eq.dailyWet.nonMember)}</td><td>${priceCell(eq.monthlyWet.nonMember)}</td></tr>
  `;
  // Package total uses the ACTIVE panel's own monthly-job-days input
  // directly, rather than re-deriving it from eq (which only carries
  // per-day figures) -- simplest single source for the one extra
  // number this note needs.
  const pkgNote = document.getElementById('rc-monthly-package-note');
  const activeMonthlyDaysEl = document.querySelector('.rc-equipment-panel:not([hidden]) .rc-eq-monthly-job-days');
  const monthlyJobDays = activeMonthlyDaysEl ? num(activeMonthlyDaysEl, 26) : 26;
  pkgNote.textContent = isFinite(eq.monthlyWet.standard)
    ? `Monthly package (wet, standard), assuming a ${monthlyJobDays}-day booking: ${formatRM(eq.monthlyWet.standard * monthlyJobDays)} total.`
    : '';

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
    insightEl.textContent = `At the wet daily standard price, this machine breaks even after about ${formatDays(eq.breakevenDays)} -- the remaining ~${Math.floor(extra)} of your planned ${eq.expectedDays} rental days are largely pure profit.`;
  } else if (isFinite(eq.breakevenDays)) {
    insightEl.textContent = `This machine needs about ${formatDays(eq.breakevenDays)} a month to break even -- more than the ${eq.expectedDays} days you've planned for.`;
  } else {
    insightEl.textContent = 'At the current price, this machine can\u2019t reach break-even.';
  }

  const depositMemberPct = num(document.getElementById('rc-deposit-member-pct'), 20);
  const depositNonMemberPct = num(document.getElementById('rc-deposit-nonmember-pct'), 30);
  document.getElementById('rc-res-deposit-member').textContent = isFinite(eq.dailyWet.standard) ? formatRM(eq.dailyWet.standard * depositMemberPct / 100) : '\u2014';
  document.getElementById('rc-res-deposit-nonmember').textContent = isFinite(eq.dailyWet.nonMember) ? formatRM(eq.dailyWet.nonMember * depositNonMemberPct / 100) : '\u2014';
}

function renderStructureSection(eq) {
  const guideCategory = document.getElementById('rc-guide-category-select').value;
  const guide = GUIDE_RATIOS[guideCategory] || GUIDE_RATIOS.other;
  const mix = structureMix(eq);
  const isLosing = mix.margin < 0;
  document.getElementById('rc-structure-loss-flag').hidden = !isLosing;
  const guideSelect = document.getElementById('rc-guide-category-select');
  const guideLabel = guideSelect.options[guideSelect.selectedIndex].textContent;
  document.getElementById('rc-structure-pie-yours').innerHTML = renderStructurePie('This machine' + (isLosing ? ' (losing money)' : ''), mix);
  document.getElementById('rc-structure-pie-guide').innerHTML = renderStructurePie('Guide, ' + guideLabel, guide);
}

/* ================= MARKET COMPARISON (tier-aware) =================
   Groups every entered rate by (period, serviceLevel) and compares
   its average against the matching computed price for that exact
   combination -- an hourly dry rate is only ever compared against
   this machine's own hourly dry price, never blended with a daily
   or wet figure. */

function renderMarketSection(eq) {
  const tbody = document.getElementById('rc-market-rows-summary');
  const emptyNote = document.getElementById('rc-market-empty-note');
  if (!eq.marketRates.length) {
    tbody.innerHTML = '';
    emptyNote.hidden = false;
    return;
  }
  emptyNote.hidden = true;

  const priceFor = { hour: { dry: eq.hourlyDry, wet: eq.hourlyWet }, day: { dry: eq.dailyDry, wet: eq.dailyWet }, month: { dry: eq.monthlyDry, wet: eq.monthlyWet } };
  const periodLabel = { hour: 'Hourly', day: 'Daily', month: 'Monthly (per day)' };
  const groups = {};
  eq.marketRates.forEach((r) => {
    const key = r.period + '_' + r.serviceLevel;
    if (!groups[key]) groups[key] = { period: r.period, serviceLevel: r.serviceLevel, rates: [] };
    // Month-period market rates are entered as a monthly TOTAL, not a
    // per-day figure -- normalize to a daily equivalent the same way
    // this page's own monthly tier is expressed, so both sides of the
    // comparison mean the same thing.
    const dailyEquivalent = r.period === 'month' ? r.rate / MARKET_RATE_DAYS_PER_MONTH : r.rate;
    groups[key].rates.push(dailyEquivalent);
  });

  const rowsHTML = Object.values(groups).map((g) => {
    const avg = g.rates.reduce((a, b) => a + b, 0) / g.rates.length;
    const mine = priceFor[g.period][g.serviceLevel].standard;
    const diffPct = (isFinite(mine) && avg > 0) ? ((mine - avg) / avg) * 100 : null;
    const diffText = diffPct === null ? '\u2014' : (diffPct >= 0 ? '+' : '') + diffPct.toFixed(0) + '%';
    const tierLabel = periodLabel[g.period] + ', ' + (g.serviceLevel === 'wet' ? 'wet' : 'dry');
    return `<tr><td>${tierLabel}</td><td>${formatRM(avg)}</td><td>${isFinite(mine) ? formatRM(mine) : 'Not reachable'}</td><td class="${diffPct !== null && diffPct > 15 ? 'is-loss' : ''}">${diffText}</td></tr>`;
  }).join('');
  tbody.innerHTML = rowsHTML;
}

function renderInsights(eq, computed) {
  const insights = [];

  if (eq.wearTearPerHour > 0 && eq.fuelPerHour > 0 && (eq.maintPerHour + eq.wearTearPerHour) > eq.fuelPerHour * 8) {
    insights.push({ level: 'alert', text: `${eq.name}'s maintenance + wear &amp; tear rate (RM${(eq.maintPerHour + eq.wearTearPerHour).toFixed(2)}/hour) is far above fuel cost (RM${eq.fuelPerHour}/hour) -- this is almost always a data-entry issue. Check the wear &amp; tear cost and interval you entered.` });
  }

  if (eq.marginStandard < 0) {
    insights.push({ level: 'alert', text: `${eq.name} is priced below true cost at the wet standard rate -- every rental day loses money before revenue-share partners are even paid.` });
  } else if (eq.marginStandard < eq.targetMarginPct - 5) {
    insights.push({ level: 'warn', text: `${eq.name}'s achieved margin (${eq.marginStandard.toFixed(1)}%) is running below its ${eq.targetMarginPct}% target.` });
  }

  if (isFinite(eq.breakevenDays) && eq.expectedDays > eq.breakevenDays) {
    insights.push({ level: 'good', text: `${eq.name} clears break-even with room to spare -- about ${formatDays(eq.breakevenDays)} needed against ${eq.expectedDays} planned.` });
  } else if (!isFinite(eq.breakevenDays)) {
    insights.push({ level: 'alert', text: `${eq.name} can't reach break-even at the current price.` });
  } else {
    insights.push({ level: 'warn', text: `${eq.name} needs more rental days than currently planned to break even this month.` });
  }

  if (eq.wetHire && eq.operatorPerDay === 0) {
    insights.push({ level: 'warn', text: `${eq.name} is wet hire but the shared manpower pool is RM0 -- operator cost isn't being counted yet. Set it in the "Shared Overhead & Manpower" tab.` });
  }

  const lossCount = computed.filter((c) => c.eq.marginStandard < 0).length;
  if (computed.length > 1 && lossCount > 0) {
    insights.push({ level: 'alert', text: `${lossCount} of ${computed.length} machines are priced below true cost at their standard rate.` });
  }

  if (!insights.length) insights.push({ level: 'good', text: 'Nothing stands out -- this machine is pricing above cost and on track for its target margin.' });

  const iconFor = { alert: '\u26A0\uFE0F', warn: '\uD83D\uDD0D', good: '\u2705' };
  document.getElementById('rc-insights').innerHTML = insights.map((i) => `
    <div class="rc-insight-card ${i.level === 'alert' ? 'is-alert' : i.level === 'warn' ? 'is-warn' : 'is-good'}">
      <span class="rc-insight-icon">${iconFor[i.level]}</span><span>${i.text}</span>
    </div>`).join('');
}

/* ================= SHARED-SETTINGS TABS (single-select, not an accordion) =================
   2026-09-12: changed from Margin Analysis's independent-toggle
   pattern to a mutually-exclusive tab switch, per direct instruction
   for this tool specifically -- opening one tab now always closes
   whichever other one was open. Nothing typed into a closed tab is
   lost; hidden is a display toggle only, same as before. */

function showCalcTabOnly(key) {
  document.querySelectorAll('.rc-calc-tab[data-calc-tab]').forEach((btn) => {
    const isTarget = btn.dataset.calcTab === key;
    btn.classList.toggle('is-active', isTarget);
    btn.setAttribute('aria-expanded', String(isTarget));
  });
  document.querySelectorAll('.rc-calc-panel[data-calc-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.calcPanel !== key;
  });
}

function resetAllCalculationData() {
  const ok = confirm('Clear every equipment tab, and reset shared overhead, shared manpower, revenue-share partners, SST, and pricing policy back to their starting defaults? This can\u2019t be undone.');
  if (!ok) return;

  document.getElementById('rc-equipment-panels').innerHTML = '';
  eqIdCounter = 0;
  createEquipmentPanel();
  renderEquipmentTabs();

  document.getElementById('rc-shared-overhead').value = 0;
  document.getElementById('rc-shared-manpower').value = 0;
  document.getElementById('rc-partner-rows').innerHTML = '';
  seedDefaultPartners();
  document.getElementById('rc-sst-toggle').checked = false;
  document.getElementById('rc-sst-fields').hidden = true;
  document.getElementById('rc-sst-pct').value = 6;
  document.getElementById('rc-member-discount').value = 20;
  document.getElementById('rc-mode-protect').checked = true;
  document.getElementById('rc-deposit-member-pct').value = 20;
  document.getElementById('rc-deposit-nonmember-pct').value = 30;

  showCalcTabOnly('equipment');

  const feedback = document.getElementById('rc-dock-feedback');
  if (feedback) feedback.textContent = '\u2713 Cleared \u2014 Rental Calculation is back to its starting defaults.';

  recalculateAll();
}

/* ================= CROSS-TOOL SYNC (Overhead & Manpower only) =================
   2026-09-12 fix: manpowerMonthly is now actually applied to the
   shared manpower pool, not just shown as an inert note. That inert
   note was the reported "shared overhead isn't picking up manpower"
   bug -- the field existed, it just wasn't wired to feed anything. */

function handleSyncPayload(data) {
  if (data.source === 'overhead-manpower-calculator') {
    let parts = [];
    if (typeof data.overheadMonthly === 'number') {
      document.getElementById('rc-shared-overhead').value = data.overheadMonthly.toFixed(2);
      parts.push('overhead');
    }
    if (typeof data.manpowerMonthly === 'number') {
      document.getElementById('rc-shared-manpower').value = data.manpowerMonthly.toFixed(2);
      parts.push('manpower');
    }
    if (parts.length) {
      showCalcTabOnly('overhead');
      const feedback = document.getElementById('rc-dock-feedback');
      if (feedback) feedback.textContent = `\u2713 Synced ${parts.join(' & ')} from Overhead & Manpower Calculator.`;
    }
    recalculateAll();
  }
}
function initSync() {
  if (typeof rzListen !== 'function') return;
  rzListen(handleSyncPayload);
}

/* ================= TOOL DOCK (fetch-inject-execute) ================= */

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
    const sharedManpowerTotal = num(document.getElementById('rc-shared-manpower'));
    const sstOn = document.getElementById('rc-sst-toggle').checked;
    const sstPct = sstOn ? num(document.getElementById('rc-sst-pct'), 6) : 0;
    const partnerSharePct = collectPartnerSharePct();
    const combinedShare = (sstPct + partnerSharePct) / 100;
    const memberDiscountPct = num(document.getElementById('rc-member-discount'), 20);
    const memberModeEl = document.querySelector('input[name="rc-member-mode"]:checked');
    const memberMode = memberModeEl ? memberModeEl.value : 'protect_standard';

    document.getElementById('rc-fee-warning').hidden = combinedShare < 1;

    const panels = Array.from(document.querySelectorAll('.rc-equipment-panel'));
    const overheadPerMachine = panels.length > 0 ? sharedOverheadTotal / panels.length : 0;
    const wetHireCount = panels.filter((p) => p.querySelector('.rc-eq-wet-hire-toggle').checked).length;
    const operatorPerMachine = wetHireCount > 0 ? sharedManpowerTotal / wetHireCount : 0;

    document.getElementById('rc-overhead-split-note').innerHTML = panels.length > 0
      ? `Split across ${panels.length} equipment tab${panels.length === 1 ? '' : 's'}: <strong>${formatRM(overheadPerMachine)}</strong> each, per month.`
      : 'Add equipment above to see this split per machine.';
    document.getElementById('rc-manpower-split-note').innerHTML = wetHireCount > 0
      ? `Split across ${wetHireCount} wet-hire machine${wetHireCount === 1 ? '' : 's'}: <strong>${formatRM(operatorPerMachine)}</strong> each, per month.`
      : 'Add a wet-hire machine above to see this split per machine.';

    const sharedCtx = { sharedOverheadTotal, sharedManpowerTotal, combinedShare, memberDiscountPct, memberMode };
    const computed = collectEquipment(sharedCtx);

    computed.forEach(({ panel }) => renderPanelLiveNotes(panel, overheadPerMachine, operatorPerMachine));

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
  document.getElementById('rc-shared-manpower').addEventListener('input', recalculateAll);
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
    btn.addEventListener('click', () => showCalcTabOnly(btn.dataset.calcTab));
  });
  document.getElementById('rc-reset-all').addEventListener('click', resetAllCalculationData);
  showCalcTabOnly('equipment');

  document.querySelectorAll('[data-open-tool]').forEach((btn) => {
    btn.addEventListener('click', () => rzLoadToolIntoDock(btn.dataset.openTool));
  });
  document.getElementById('tool-dock-close').addEventListener('click', () => setDockVisible(false));

  document.getElementById('rc-save-pdf').addEventListener('click', () => window.print());

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
