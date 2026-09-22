/* ============================================================
   Rental Calculator
   Vanilla JS, no dependencies, nothing saved anywhere.
   ------------------------------------------------------------
   2026-09-20 REVISION -- cost-accuracy audit + tab UX + more ad
   themes. Six changes, three of them affect the actual numbers on
   screen:

   1. MARGIN FORMULA WAS DIVIDING BY THE WRONG BASE. marginAt() computed
      (net revenue - true cost) / GROSS price. That answers a
      different question than the price-setting formula asks (target
      margin on what you actually keep after revenue-share/SST, not
      on the sticker price) -- so "margin achieved" was silently
      reading target% * (1 - combined share), always LOWER than what
      you typed. At this file's own defaults (25% target, 30% combined
      partner share) the card read 17.5% even though the price was
      correctly hitting 25%. Fixed by dividing by NET revenue instead
      -- verified by hand against the algebra, not just eyeballed.

   2. FUEL WAS BEING INFLATED BY THE "UNSCHEDULED REPAIR" BUFFER.
      bufferedFuelPerHour multiplied fuel/hour by (1 + repair buffer%)
      -- fuel consumption has nothing to do with unscheduled-repair
      risk, so this was quietly overstating wet operating cost. At
      this file's defaults (10% buffer) that's ~RM20/day of true cost
      and ~RM38/day of quoted standard price on a single machine, for
      no real-world reason. Decoupled: the buffer now only touches
      maintenance & wear, matching its own label.

   3. MARGIN IS NOW SHOWN PER TIER, NOT JUST DAILY. Hourly's premium
      and Monthly's extra discount are layered on AFTER the daily
      price already hits target margin -- so their real achieved
      margin was never actually equal to your target, and was
      invisible. New table in Results shows all three. At defaults,
      after fix #1: Hourly ~40% (the premium pushes it up), Daily
      exactly 25% (by construction), Monthly ~14.8% (the extra
      discount eats into margin faster than the better mobilization
      spread saves it).

   4. RENTAL CALCULATION TABS NOW TOGGLE CLOSED ON A REPEAT CLICK.
      Previously exactly one of the four tabs was always open and
      clicking the already-active one did nothing. Now clicking the
      open tab closes it (all four hidden) -- genuine click-to-open /
      click-to-close, not just mutually-exclusive. Equipment's own
      machine-switcher tabs are unchanged on purpose (always exactly
      one visible -- Results needs an active machine to show).

   5. MARKET_RATE_HOURS_PER_DAY REMOVED -- confirmed dead code. Once
      tier-aware market matching shipped (2026-09-12) it started
      comparing hourly rates to hourly rates directly and never
      actually read this constant again. Settings-reference workbook
      updated to match.

   6. THREE MORE AD THEMES: Safety Orange, Forest Green, Site Crimson
      -- same zero-dependency canvas approach as the existing three,
      picked to echo common heavy-equipment safety/brand colours
      rather than invented arbitrarily.

   Flagged but NOT changed this pass: "Save as PDF" currently prints
   the full internal cost and margin breakdown, not just
   customer-facing pricing -- a real risk if that exact PDF goes to a
   client. That needs a decision on intended behaviour first, not a
   guess -- see RENTAL_CALCULATOR_NOTES.md.
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

console.info('[Rental Calculator] script build: 2026-09-22-v5-photo-print-summary');

/* ================= CONFIG ================= */

const MARKET_RATE_DAYS_PER_MONTH = 26; // Malaysia's own standard working-day convention
// (MARKET_RATE_HOURS_PER_DAY removed 2026-09-20 -- confirmed unused. Tier-aware
// market matching already compares hourly-to-hourly directly; nothing ever read it.)

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
    adPhotoByEqId.delete(panel.dataset.eqId); // no orphaned photo left behind for a deleted machine
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
  updateAdPhotoStatus();
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

// Same rows as collectPartnerSharePct, but keeping each partner's own
// name and % separate rather than summed -- needed to show what each
// individual partner actually receives, not just the combined total.
function collectPartners() {
  return Array.from(document.querySelectorAll('#rc-partner-rows .rc-row-item')).map((row) => ({
    name: row.querySelector('.rc-partner-name').value.trim() || 'Partner',
    pct: numOrZero(num(row.querySelector('.rc-partner-pct'))),
  }));
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
  const maintWearPerDay = bufferedNonFuelPerHour * fields.hoursPerDay;
  // 2026-09-20 fix: fuel is no longer run through the "unscheduled repair"
  // buffer -- fuel use doesn't carry repair risk, so buffering it here was
  // quietly overstating wet operating cost for no real-world reason. The
  // buffer still applies to maintenance & wear above, which is what it's for.
  const fuelPerDay = fields.fuelPerHour * fields.hoursPerDay;

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

  // 2026-09-20 fix: margin is now (net - trueCost) / NET, not / gross price.
  // The price-setting formula above targets a margin on what you actually
  // keep after revenue-share/SST come out -- dividing by the gross quoted
  // price instead was answering a different question, and made "margin
  // achieved" silently read targetMargin% * (1 - combinedShare): always
  // lower than what you typed, with no real cost or pricing change behind
  // the drop. At target=25%/share=30% that showed 17.5% instead of 25.0%.
  const marginAt = (price, trueCost) => {
    if (!isFinite(price) || price <= 0) return 0;
    const net = price * (1 - sharedCtx.combinedShare);
    if (!(net > 0)) return 0;
    return ((net - trueCost) / net) * 100;
  };
  const marginStandard = marginAt(dailyWet.standard, trueCostDailyWet);
  const marginNonMember = marginAt(dailyWet.nonMember, trueCostDailyWet);

  // Margin by tier (2026-09-20, new): Daily's margin is tautological -- it's
  // exactly how the price was built, so it will always equal targetMarginPct.
  // Hourly and Monthly are NOT independently target-margin-priced -- Hourly
  // takes the daily price and layers a premium on top; Monthly takes it and
  // layers an extra discount on top -- so their real achieved margin can (and
  // typically does) drift away from target in opposite directions. Using the
  // matching per-tier true-cost basis (daily true cost / hours for Hourly,
  // since that's how the Hourly PRICE itself was derived) keeps price and
  // cost on the same footing for each tier.
  const hourlyCostBasisWet = fields.hoursPerDay > 0 ? trueCostDailyWet / fields.hoursPerDay : 0;
  const marginHourlyStandard = marginAt(hourlyWet.standard, hourlyCostBasisWet);
  const marginHourlyNonMember = marginAt(hourlyWet.nonMember, hourlyCostBasisWet);
  const marginMonthlyStandard = marginAt(monthlyWet.standard, trueCostMonthlyWet);
  const marginMonthlyNonMember = marginAt(monthlyWet.nonMember, trueCostMonthlyWet);

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
    marginHourlyStandard, marginHourlyNonMember, marginMonthlyStandard, marginMonthlyNonMember,
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
  // Margin by tier (2026-09-20, new): Daily's margin is always exactly the
  // target you typed, by construction -- Hourly and Monthly aren't, because
  // the premium/discount are layered on afterward. Showing all three is the
  // point; hiding Hourly/Monthly drift was the actual accuracy gap.
  const marginCell = (pct) => `<td${pct < 0 ? ' class="is-loss"' : ''}>${isFinite(pct) ? pct.toFixed(1) + '%' : '\u2014'}</td>`;
  document.getElementById('rc-margin-tier-rows').innerHTML = `
    <tr><td>Standard (member)</td>${marginCell(eq.marginHourlyStandard)}${marginCell(eq.marginStandard)}${marginCell(eq.marginMonthlyStandard)}</tr>
    <tr><td>Non-member</td>${marginCell(eq.marginHourlyNonMember)}${marginCell(eq.marginNonMember)}${marginCell(eq.marginMonthlyNonMember)}</tr>
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

/* ================= PARTNER PAYOUT TABLE =================
   "How much does each partner actually get, per rental, at each
   tier" -- a direct RM breakdown rather than just the % each partner
   is set to. Built off the wet price only (revenue-share is a cut of
   whatever's charged, and wet is this page's reference price
   everywhere else) -- dry pricing splits the identical percentages,
   just off a smaller base, so it isn't repeated as a third pair of
   tables. */

function renderPartnerPayoutSection(eq, partners, sstOn, sstPct) {
  const buildTierList = (priceKey) => ([
    { label: 'Hourly', price: eq.hourlyWet[priceKey] },
    { label: 'Daily', price: eq.dailyWet[priceKey] },
    { label: 'Monthly', price: eq.monthlyWet[priceKey] },
  ]);

  const buildRows = (priceKey) => {
    const tierList = buildTierList(priceKey);
    let rows = '';
    partners.forEach((p) => {
      rows += `<tr><td>${escapeHTML(p.name)} <span class="toggle-hint">(${p.pct}%)</span></td>`;
      tierList.forEach((t) => {
        const amt = isFinite(t.price) ? t.price * (p.pct / 100) : NaN;
        rows += `<td>${isFinite(amt) ? formatRM(amt) : '\u2014'}</td>`;
      });
      rows += `</tr>`;
    });
    if (sstOn) {
      rows += `<tr><td>SST <span class="toggle-hint">(${sstPct}%)</span></td>`;
      tierList.forEach((t) => {
        const amt = isFinite(t.price) ? t.price * (sstPct / 100) : NaN;
        rows += `<td>${isFinite(amt) ? formatRM(amt) : '\u2014'}</td>`;
      });
      rows += `</tr>`;
    }
    const totalSharePct = partners.reduce((s, p) => s + p.pct, 0) + (sstOn ? sstPct : 0);
    rows += `<tr style="font-weight:700; border-top:1px solid var(--line);"><td>You keep</td>`;
    tierList.forEach((t) => {
      const net = isFinite(t.price) ? t.price * (1 - totalSharePct / 100) : NaN;
      rows += `<td>${isFinite(net) ? formatRM(net) : '\u2014'}</td>`;
    });
    rows += `</tr>`;
    rows += `<tr style="border-top:2px solid var(--ink); font-weight:700;"><td>Total (quoted price)</td>`;
    tierList.forEach((t) => { rows += `<td>${isFinite(t.price) ? formatRM(t.price) : 'Not reachable'}</td>`; });
    rows += `</tr>`;
    return rows;
  };

  document.getElementById('rc-partner-payout-standard').innerHTML = buildRows('standard');
  document.getElementById('rc-partner-payout-nonmember').innerHTML = buildRows('nonMember');
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

  if (isFinite(eq.marginMonthlyStandard) && eq.marginMonthlyStandard < eq.targetMarginPct - 5) {
    insights.push({ level: 'warn', text: `${eq.name}'s Monthly tier is running at ${eq.marginMonthlyStandard.toFixed(1)}% margin, ${(eq.targetMarginPct - eq.marginMonthlyStandard).toFixed(1)} points under its ${eq.targetMarginPct}% target -- the extra monthly discount is eating into margin faster than the longer mobilization spread is saving it. See "Margin achieved by tier" above.` });
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

// showCalcTabOnly FORCES a specific tab open -- used by init, Reset all, and
// the cross-tool sync handler, none of which should ever accidentally close
// everything. toggleCalcTab (2026-09-20, new) is what the tab BUTTONS
// themselves call: clicking the tab that's already open now closes it (all
// four hidden), matching genuine click-to-open/click-to-close rather than
// "always exactly one open, and clicking the open one does nothing."
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

function closeAllCalcTabs() {
  document.querySelectorAll('.rc-calc-tab[data-calc-tab]').forEach((btn) => {
    btn.classList.remove('is-active');
    btn.setAttribute('aria-expanded', 'false');
  });
  document.querySelectorAll('.rc-calc-panel[data-calc-panel]').forEach((panel) => { panel.hidden = true; });
}

function toggleCalcTab(key) {
  const btn = document.querySelector(`.rc-calc-tab[data-calc-tab="${key}"]`);
  const isCurrentlyOpen = !!(btn && btn.classList.contains('is-active'));
  if (isCurrentlyOpen) closeAllCalcTabs();
  else showCalcTabOnly(key);
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

/* ================= AD CREATOR =================
   Draws a shareable 1080x1350 (4:5) image straight from the ACTIVE
   equipment's own computed pricing -- nothing here is typed
   separately, so the ad can never drift out of sync with the
   calculator above it. Canvas 2D, zero dependencies, matching this
   site's existing "hand-rolled, no charting/design library" rule
   (see the SVG pie charts and break-even chart elsewhere on this
   site for the same philosophy).

   Deliberately no equipment photography: there's no legitimate photo
   of this specific machine to draw from, and a stock image would be
   the wrong call. Leans into bold, high-contrast typography and
   color-blocking instead -- which current flyer/poster design has
   genuinely moved toward anyway (oversized scannable type, purposeful
   elements only, contrast over raw brightness), not just a
   workaround for the missing photo.

   LAYOUT: fixed header/footer zones (460px / 150px) with the pricing
   cards and terms chips laid out inside whatever's left between them,
   sized by division rather than open-ended addition -- this is what
   keeps the whole thing inside the fixed 1350px canvas regardless of
   theme, business-name length, or whether non-member pricing is
   toggled on (which changes each card's internal layout, never the
   canvas's overall proportions). */

const AD_THEMES = {
  teal:     { bg: '#16261F', accent: '#1F6F5C', accentSoft: '#DCEAE4', chipBg: '#F3F3F0', text: '#16261F', muted: '#5C6D64' },
  amber:    { bg: '#1A1410', accent: '#C77F13', accentSoft: '#FBF0DC', chipBg: '#F6F1E8', text: '#1A1410', muted: '#8A7454' },
  graphite: { bg: '#12181F', accent: '#2E5FA3', accentSoft: '#E1EAF5', chipBg: '#F0F3F7', text: '#12181F', muted: '#5C6B7A' },
  // Added 2026-09-20 -- same dark-bg / bright-accent shape as the three
  // above, picked to echo common heavy-equipment safety and brand colours
  // rather than being invented arbitrarily.
  orange:   { bg: '#1F1712', accent: '#D8571F', accentSoft: '#FCE4D6', chipBg: '#F7F1EA', text: '#1F1712', muted: '#8A6B54' },
  green:    { bg: '#101B12', accent: '#3F7D32', accentSoft: '#DCEEDC', chipBg: '#F1F3EE', text: '#101B12', muted: '#5E7259' },
  crimson:  { bg: '#1D1013', accent: '#A83246', accentSoft: '#F6DCE1', chipBg: '#F7EFF1', text: '#1D1013', muted: '#8A5C64' },
};
const CATEGORY_AD_LABEL = {
  mini_excavator: 'MINI EXCAVATOR', excavator: 'EXCAVATOR', backhoe: 'BACKHOE LOADER',
  crane: 'CRANE', forklift: 'FORKLIFT', other: 'EQUIPMENT FOR RENT',
};

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Shrinks font size until the text fits maxWidth, rather than a fixed
// guess -- a short equipment name (e.g. "CRANE") and a long one
// (e.g. "BACKHOE LOADER") both need to read as one confident,
// deliberately oversized headline, not an arbitrary point size that
// happens to overflow on the longer word.
function fitFontSize(ctx, text, maxWidth, startSize, minSize, fontSpec) {
  let size = startSize;
  ctx.font = fontSpec(size);
  while (ctx.measureText(text).width > maxWidth && size > minSize) {
    size -= 2;
    ctx.font = fontSpec(size);
  }
  return size;
}

function adPriceText(v) {
  return isFinite(v) ? 'RM' + Math.round(v).toLocaleString() : 'N/A';
}

// Machine photo, per equipment (2026-09-22, new). Keyed by eqId so switching
// between machine tabs keeps each one's own photo, exactly like every other
// per-equipment field on this page -- and like everything else here, it's
// in-memory only for this session, never uploaded or saved anywhere.
const adPhotoByEqId = new Map();

function updateAdPhotoStatus() {
  const statusEl = document.getElementById('rc-ad-photo-status');
  const removeBtn = document.getElementById('rc-ad-photo-remove');
  const fileInput = document.getElementById('rc-ad-photo-input');
  if (!statusEl) return;
  const activePanel = getActiveEquipmentPanel();
  const eqId = activePanel ? activePanel.dataset.eqId : null;
  const photo = eqId ? adPhotoByEqId.get(eqId) : null;
  if (photo) {
    statusEl.classList.remove('is-empty');
    statusEl.innerHTML = `Photo loaded: <strong>${escapeHTML(photo.rcFileName || 'image')}</strong> -- shown for this machine only.`;
    if (removeBtn) removeBtn.hidden = false;
  } else {
    statusEl.classList.add('is-empty');
    statusEl.textContent = 'No photo for this machine yet -- using the text-only layout.';
    if (removeBtn) removeBtn.hidden = true;
  }
  if (fileInput) fileInput.value = ''; // always let the same file be re-picked, and never shows a stale filename for a different machine
}

function handleAdPhotoFile(file) {
  const activePanel = getActiveEquipmentPanel();
  const eqId = activePanel ? activePanel.dataset.eqId : null;
  if (!file || !eqId) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      img.rcFileName = file.name;
      adPhotoByEqId.set(eqId, img);
      updateAdPhotoStatus();
      recalculateAll();
    };
    img.onerror = () => {
      const statusEl = document.getElementById('rc-ad-photo-status');
      if (statusEl) { statusEl.classList.add('is-empty'); statusEl.textContent = 'Couldn\u2019t read that image -- try a PNG, JPG, or WEBP file.'; }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function removeAdPhotoForActiveEquipment() {
  const activePanel = getActiveEquipmentPanel();
  const eqId = activePanel ? activePanel.dataset.eqId : null;
  if (eqId) adPhotoByEqId.delete(eqId);
  updateAdPhotoStatus();
  recalculateAll();
}

function drawAdCanvas(eq) {
  const canvas = document.getElementById('rc-ad-canvas');
  if (!canvas || !eq) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height; // 1080 x 1350, fixed regardless of CSS display size

  const theme = AD_THEMES[document.getElementById('rc-ad-theme').value] || AD_THEMES.teal;
  const business = document.getElementById('rc-ad-business').value.trim() || 'Reysourcez Enterprise';
  const tagline = document.getElementById('rc-ad-tagline').value.trim() || 'Heavy Machinery Rental';
  const phone = document.getElementById('rc-ad-phone').value.trim();
  const contact = document.getElementById('rc-ad-contact').value.trim();
  const showNonMember = document.getElementById('rc-ad-show-nonmember').checked;
  const categoryLabel = CATEGORY_AD_LABEL[eq.category] || 'EQUIPMENT FOR RENT';
  const memberDiscountPct = num(document.getElementById('rc-member-discount'), 0);

  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'left';

  /* ---- Fixed zones ---- */
  const HEADER_H = 460;
  const FOOTER_H = 150;
  const MID_TOP = HEADER_H;
  const MID_BOTTOM = H - FOOTER_H;

  /* ---- Header (bold color block, no imagery) ---- */
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, HEADER_H);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, HEADER_H);
  ctx.lineTo(W, HEADER_H - 100);
  ctx.lineTo(W, HEADER_H);
  ctx.closePath();
  ctx.fillStyle = theme.accent;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  const businessMaxWidth = memberDiscountPct > 0 ? W - 360 : W - 120;
  const businessFont = (size) => `600 ${size}px "IBM Plex Sans", sans-serif`;
  const businessSize = fitFontSize(ctx, business.toUpperCase(), businessMaxWidth, 28, 16, businessFont);
  ctx.font = businessFont(businessSize);
  ctx.fillText(business.toUpperCase(), 60, 84);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '400 25px "IBM Plex Sans", sans-serif';
  ctx.fillText(tagline, 60, 120);

  const activePanelForPhoto = getActiveEquipmentPanel();
  const activeEqId = activePanelForPhoto ? activePanelForPhoto.dataset.eqId : null;
  const photoImg = activeEqId ? adPhotoByEqId.get(activeEqId) : null;
  const hasPhoto = !!(photoImg && photoImg.complete && photoImg.naturalWidth > 0);
  const eqNameTrim = (eq.name || '').trim();

  if (hasPhoto) {
    // Photo-led header (2026-09-22, new): business name/tagline stay exactly
    // where they were -- the big typography-only headline is replaced by the
    // photo itself (contain-fit, never cropped or stretched), with a small
    // caption strip reserved below it so the machine's name/category is
    // still readable. This is why the box height is fixed at HEADER_H - 55 -
    // photoBoxY rather than however tall the photo happens to be: a portrait
    // photo and a landscape one both still fit inside the same header zone.
    const photoBoxX = 50, photoBoxY = 135, photoBoxW = W - 100, photoBoxH = (HEADER_H - 55) - photoBoxY;
    const scale = Math.min(photoBoxW / photoImg.naturalWidth, photoBoxH / photoImg.naturalHeight);
    const drawW = photoImg.naturalWidth * scale, drawH = photoImg.naturalHeight * scale;
    const drawX = photoBoxX + (photoBoxW - drawW) / 2, drawY = photoBoxY + (photoBoxH - drawH) / 2;
    ctx.drawImage(photoImg, drawX, drawY, drawW, drawH);

    const captionParts = [categoryLabel, (eqNameTrim && eqNameTrim.toLowerCase() !== categoryLabel.toLowerCase()) ? eqNameTrim : null].filter(Boolean);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    const captionFont = (size) => `700 ${size}px "IBM Plex Sans", sans-serif`;
    const captionSize = fitFontSize(ctx, captionParts.join(' \u00b7 '), W - 120, 30, 18, captionFont);
    ctx.font = captionFont(captionSize);
    ctx.fillText(captionParts.join(' \u00b7 '), 58, HEADER_H - 22);
  } else {
    const headlineFont = (size) => `900 ${size}px Fraunces, Georgia, serif`;
    const headlineMaxWidth = memberDiscountPct > 0 ? W - 360 : W - 120;
    const headlineSize = fitFontSize(ctx, categoryLabel, headlineMaxWidth, 108, 46, headlineFont);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = headlineFont(headlineSize);
    ctx.fillText(categoryLabel, 58, 250);

    if (eqNameTrim && eqNameTrim.toLowerCase() !== categoryLabel.toLowerCase()) {
      ctx.font = '600 32px "IBM Plex Sans", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fillText(eqNameTrim, 60, 300);
    }
  }

  if (memberDiscountPct > 0) {
    const badgeW = 230, badgeH = 100, badgeX = W - badgeW - 50, badgeY = 45;
    ctx.fillStyle = '#FFFFFF';
    roundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, 18);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.bg;
    ctx.font = '800 26px "IBM Plex Sans", sans-serif';
    ctx.fillText('MEMBERS SAVE', badgeX + badgeW / 2, badgeY + 38);
    ctx.fillStyle = theme.accent;
    ctx.font = '900 46px "IBM Plex Sans", sans-serif';
    ctx.fillText(Math.round(memberDiscountPct) + '%', badgeX + badgeW / 2, badgeY + 84);
    ctx.textAlign = 'left';
  }

  /* ---- Pricing zone -- divided, not accumulated, so it always fits ---- */
  ctx.fillStyle = theme.text;
  ctx.font = '700 28px "IBM Plex Sans", sans-serif';
  ctx.fillText('PRICING', 60, MID_TOP + 48);

  const CHIPS_ZONE_H = 90;
  const cardsTop = MID_TOP + 76;
  const cardsBottom = MID_BOTTOM - CHIPS_ZONE_H;
  const slotH = (cardsBottom - cardsTop) / 3;
  const cardH = slotH - 18;
  const cardX = 60, cardW = W - 120;

  const tiers = [
    { label: 'HOURLY', standard: eq.hourlyWet.standard, nonMember: eq.hourlyWet.nonMember },
    { label: 'DAILY', standard: eq.dailyWet.standard, nonMember: eq.dailyWet.nonMember },
    { label: 'MONTHLY', standard: eq.monthlyWet.standard, nonMember: eq.monthlyWet.nonMember },
  ];

  tiers.forEach((t, i) => {
    const y = cardsTop + i * slotH;
    ctx.fillStyle = theme.accentSoft;
    roundRectPath(ctx, cardX, y, cardW, cardH, 18);
    ctx.fill();

    ctx.fillStyle = theme.muted;
    ctx.font = '700 22px "IBM Plex Sans", sans-serif';
    ctx.fillText(t.label, cardX + 30, y + 38);

    if (showNonMember) {
      ctx.font = '600 19px "IBM Plex Sans", sans-serif';
      ctx.fillStyle = theme.muted;
      ctx.fillText('NORMAL', cardX + 30, y + cardH - 46);
      ctx.font = '700 34px "IBM Plex Mono", monospace';
      ctx.fillStyle = theme.text;
      ctx.fillText(adPriceText(t.nonMember), cardX + 30, y + cardH - 14);

      ctx.textAlign = 'right';
      ctx.font = '600 19px "IBM Plex Sans", sans-serif';
      ctx.fillStyle = theme.accent;
      ctx.fillText('MEMBER', cardX + cardW - 30, y + cardH - 46);
      ctx.font = '900 42px "IBM Plex Mono", monospace';
      ctx.fillText(adPriceText(t.standard), cardX + cardW - 30, y + cardH - 12);
      ctx.textAlign = 'left';
    } else {
      ctx.textAlign = 'right';
      ctx.fillStyle = theme.accent;
      ctx.font = '900 46px "IBM Plex Mono", monospace';
      ctx.fillText(adPriceText(t.standard), cardX + cardW - 30, y + cardH / 2 + 18);
      ctx.textAlign = 'left';
    }
  });

  /* ---- Terms chips -- single line for any normal-length business
     name/contact; wraps only if it genuinely runs out of room. ---- */
  const shortDaysEl = document.querySelector('.rc-equipment-panel:not([hidden]) .rc-eq-short-job-days');
  const shortDays = shortDaysEl ? num(shortDaysEl, 3) : 3;
  const depositPct = num(document.getElementById('rc-deposit-member-pct'), 20);
  const chips = [
    eq.wetHire ? 'Operator & fuel included' : 'Dry hire \u2014 machine only',
    `Min. booking: ${shortDays} day${shortDays === 1 ? '' : 's'}`,
    `Deposit: ${depositPct}%`,
  ];
  let chipX = 60, chipY = cardsBottom + 22;
  ctx.font = '600 21px "IBM Plex Sans", sans-serif';
  chips.forEach((chip) => {
    const chipW = ctx.measureText(chip).width + 38;
    if (chipX + chipW > W - 60) { chipX = 60; chipY += 54; }
    ctx.fillStyle = theme.chipBg;
    roundRectPath(ctx, chipX, chipY, chipW, 44, 22);
    ctx.fill();
    ctx.fillStyle = theme.text;
    ctx.fillText(chip, chipX + 19, chipY + 29);
    chipX += chipW + 12;
  });

  /* ---- Footer (fixed height, anchored to the bottom) ---- */
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, H - FOOTER_H, W, FOOTER_H);
  ctx.fillStyle = '#FFFFFF';
  const footerBoldFont = (size) => `700 ${size}px "IBM Plex Sans", sans-serif`;
  const footerNameSize = fitFontSize(ctx, business, W - 120, 30, 18, footerBoldFont);
  ctx.font = footerBoldFont(footerNameSize);
  ctx.fillText(business, 60, H - FOOTER_H + 58);
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  const contactLine = [phone, contact].filter(Boolean).join('   \u00b7   ') || 'Contact us for a quote';
  const footerRegularFont = (size) => `400 ${size}px "IBM Plex Sans", sans-serif`;
  const contactSize = fitFontSize(ctx, contactLine, W - 120, 24, 15, footerRegularFont);
  ctx.font = footerRegularFont(contactSize);
  ctx.fillText(contactLine, 60, H - FOOTER_H + 100);
}

function downloadAdImage() {
  const canvas = document.getElementById('rc-ad-canvas');
  if (!canvas) return;
  const link = document.createElement('a');
  const active = getActiveEquipmentPanel();
  const nameSlug = active ? active.querySelector('.rc-eq-name').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : 'equipment';
  link.download = `rental-ad-${nameSlug || 'equipment'}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

/* ================= PRINT SUMMARY (2026-09-22, new) =================
   A second, separate export path alongside the existing "Save as PDF"
   button, which this deliberately does not touch or change in any way.
   "Save as PDF" always prints the full page exactly as it already did.
   This one prints only the Results sections the person checks in a
   short list -- meant for handing a customer a clean price sheet
   without also handing them your own true-cost and margin breakdown.

   Mechanism: temporarily add the existing .no-print class (already
   used everywhere else on this page for print-only hiding) to whatever
   is unchecked, call window.print(), then remove it again once the
   print dialog closes. Nothing about the on-screen page changes at
   any point -- .no-print only takes effect inside @media print. */

const RC_PRINT_ALWAYS_EXCLUDE = ['#rc-ad-creator-box'];

function togglePrintSummaryPanel(show) {
  const panel = document.getElementById('rc-print-summary-panel');
  if (panel) panel.hidden = !show;
}

function runPrintSummary() {
  const checks = document.querySelectorAll('.rc-print-check');
  const addedNoPrint = [];
  checks.forEach((cb) => {
    if (cb.checked) return;
    document.querySelectorAll(`[data-print-section="${cb.dataset.section}"]`).forEach((el) => {
      if (!el.classList.contains('no-print')) { el.classList.add('no-print'); addedNoPrint.push(el); }
    });
  });
  RC_PRINT_ALWAYS_EXCLUDE.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      if (!el.classList.contains('no-print')) { el.classList.add('no-print'); addedNoPrint.push(el); }
    });
  });

  const cleanup = () => {
    addedNoPrint.forEach((el) => el.classList.remove('no-print'));
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Safari doesn't reliably fire afterprint from a print-preview cancel --
  // this fallback guarantees the temporary classes never outlive the dialog.
  setTimeout(cleanup, 4000);

  togglePrintSummaryPanel(false);
  window.print();
}

function initPrintSummary() {
  document.getElementById('rc-print-summary-btn').addEventListener('click', () => togglePrintSummaryPanel(true));
  document.getElementById('rc-print-summary-cancel').addEventListener('click', () => togglePrintSummaryPanel(false));
  document.getElementById('rc-print-summary-go').addEventListener('click', runPrintSummary);
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
    const partners = collectPartners();

    computed.forEach(({ panel }) => renderPanelLiveNotes(panel, overheadPerMachine, operatorPerMachine));

    renderCompareTable(computed);

    const activePanel = getActiveEquipmentPanel();
    const active = computed.find((c) => c.panel === activePanel) || computed[0];
    if (active) {
      renderDetail(active.eq);
      renderPartnerPayoutSection(active.eq, partners, sstOn, sstPct);
      renderStructureSection(active.eq);
      renderMarketSection(active.eq);
      renderInsights(active.eq, computed);
      drawAdCanvas(active.eq);
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
    btn.addEventListener('click', () => toggleCalcTab(btn.dataset.calcTab));
  });
  document.getElementById('rc-reset-all').addEventListener('click', resetAllCalculationData);
  showCalcTabOnly('equipment');

  document.querySelectorAll('[data-open-tool]').forEach((btn) => {
    btn.addEventListener('click', () => rzLoadToolIntoDock(btn.dataset.openTool));
  });
  document.getElementById('tool-dock-close').addEventListener('click', () => setDockVisible(false));

  document.getElementById('rc-save-pdf').addEventListener('click', () => window.print());
  initPrintSummary();

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

  // Ad Creator controls -- every one just triggers a full recalculate,
  // same as every other input on this page, since drawAdCanvas is
  // cheap enough to re-run alongside everything else rather than
  // needing its own separate debounced path.
  ['rc-ad-business', 'rc-ad-tagline', 'rc-ad-phone', 'rc-ad-contact'].forEach((id) => {
    document.getElementById(id).addEventListener('input', recalculateAll);
  });
  document.getElementById('rc-ad-theme').addEventListener('change', recalculateAll);
  document.getElementById('rc-ad-show-nonmember').addEventListener('change', recalculateAll);
  document.getElementById('rc-ad-download').addEventListener('click', downloadAdImage);
  document.getElementById('rc-ad-photo-input').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) handleAdPhotoFile(e.target.files[0]);
  });
  document.getElementById('rc-ad-photo-remove').addEventListener('click', removeAdPhotoForActiveEquipment);
  updateAdPhotoStatus();

  initSync();
  recalculateAll();

  // Canvas text can render with a fallback font if this runs before
  // Fraunces/IBM Plex finish downloading -- redrawing once
  // document.fonts.ready resolves (a no-op if they were already
  // loaded) makes sure the ad always ends up using the real typefaces,
  // not just the first paint's best guess.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => recalculateAll());
  }
}

document.addEventListener('DOMContentLoaded', init);
