/* ============================================================
   Overhead & Manpower Calculator
   Vanilla JS, no dependencies, nothing saved anywhere.
   ------------------------------------------------------------
   Two independent add-a-row tables, same pattern as
   menu-calculator.js: Overhead (rent, utilities, licenses, food-
   handler compliance costs) and Manpower (permanent staff with
   EPF/SOCSO/EIS, or freelance staff paid a flat sum).

   Statutory rates below are Malaysia-wide federal rates (EPF/
   SOCSO/EIS apply the same in Sarawak as anywhere else — these
   aren't state-specific). They're the STANDARD percentage rates,
   not the official EPF Third Schedule lookup table, so treat
   results as a close working estimate for menu pricing, not a
   payroll-filing figure. No income tax (PCB/MTD) is modelled.
   Verify exact figures with KWSP/PERKESO before relying on them
   for actual payroll.

   TO EXTEND: add a <th>/<td> to the relevant row template, add
   the calc step in that row's update function.
   ============================================================ */

console.info('[Overhead & Manpower Calculator] script build: 2026-08-24-cross-tab-sync');

function formatRM(value) {
  if (!isFinite(value) || value < 0) return 'RM0.00';
  if (value > 0 && value < 0.01) return '< RM0.01';
  return 'RM' + value.toFixed(2);
}

function parseNum(el, fallback) {
  const v = parseFloat(el.value);
  return isFinite(v) ? v : (fallback !== undefined ? fallback : 0);
}

/* ================= 1. OVERHEAD ================= */

const OVERHEAD_CATEGORIES = [
  'Rent', 'Electricity', 'Water', 'Gas (LPG Cylinder)', 'Internet / Phone',
  'Trade License', 'Business License', 'Health / Food Premise License',
  'Food Handling Course', 'Typhoid Vaccination',
  'Halal Certification', 'HACCP', 'GMP', 'GAP', 'ISO 9001',
  'Logistics / Delivery', 'Insurance', 'Other',
];

// Months each frequency represents, for converting to a monthly
// figure. "onetime" has no fixed period — the user sets how many
// months to spread it over (e.g. RM50 food handling course, spread
// over 12 months while budgeting for the year it was paid in).
const FREQUENCY_MONTHS = { monthly: 1, yearly: 12, triennial: 36 };

let overheadIdCounter = 0;

function overheadCategoryOptionsHTML() {
  return OVERHEAD_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('');
}

function updateOverheadRow(tr) {
  const cost = parseNum(tr.querySelector('.oh-cost'));
  const freq = tr.querySelector('.oh-frequency').value;
  const isOnetime = freq === 'onetime';
  tr.querySelector('.oh-amortize-fields').hidden = !isOnetime;
  tr.querySelector('.oh-amortize-empty').hidden = isOnetime;

  let monthlyEquivalent;
  if (isOnetime) {
    const months = Math.max(1, parseNum(tr.querySelector('.oh-amortize'), 12));
    monthlyEquivalent = cost / months;
  } else {
    monthlyEquivalent = cost / FREQUENCY_MONTHS[freq];
  }

  tr.querySelector('.oh-monthly').textContent = formatRM(monthlyEquivalent);
  tr.dataset.monthly = monthlyEquivalent;

  updateOverheadTotal();
}

function createOverheadRow() {
  overheadIdCounter++;
  const tbody = document.getElementById('overhead-rows');
  const tr = document.createElement('tr');
  tr.dataset.rowId = 'oh-' + overheadIdCounter;
  tr.innerHTML = `
    <td><input type="text" class="oh-item" name="item" placeholder="e.g. Shop rent"></td>
    <td><select class="oh-category" name="category">${overheadCategoryOptionsHTML()}</select></td>
    <td><input type="number" class="oh-cost" name="cost" inputmode="decimal" min="0" step="0.01" value="0"></td>
    <td>
      <select class="oh-frequency" name="frequency">
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
        <option value="triennial">Every 3 years</option>
        <option value="onetime">One-time</option>
      </select>
    </td>
    <td class="oh-amortize-cell">
      <span class="oh-amortize-fields" hidden>Over <input type="number" class="oh-amortize" name="amortize-months" min="1" step="1" value="12"> months</span>
      <span class="oh-amortize-empty">&mdash;</span>
    </td>
    <td class="calc oh-monthly">RM0.00</td>
    <td class="no-print"><button type="button" class="delete-row" aria-label="Remove this overhead item">&times;</button></td>
  `;
  tbody.appendChild(tr);

  tr.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('input', () => updateOverheadRow(tr));
  });
  tr.querySelector('.delete-row').addEventListener('click', () => {
    tr.remove();
    updateOverheadTotal();
  });

  updateOverheadRow(tr);
}

function updateOverheadTotal() {
  let total = 0;
  document.querySelectorAll('#overhead-rows > tr').forEach((tr) => {
    total += parseFloat(tr.dataset.monthly) || 0;
  });
  document.getElementById('overhead-total').textContent = formatRM(total);
  updateGrandTotal();
}

/* ================= 2. MANPOWER ================= */

// EPF: covers Malaysian/PR employees under 60. For wages up to
// RM20,000, the Third Schedule fixes contributions per exact-ringgit
// rounding — the documented rule (confirmed across KWSP guidance and
// payroll references) is: take the percentage, then round UP to the
// next whole ringgit. That rule is applied here directly rather than
// approximated, since it IS the official mechanism, not a guess.
// Above RM20,000, KWSP applies the plain percentage. EPF has no wage
// ceiling — contributions apply to the full wage either way.
const EPF_EMPLOYEE_RATE = 0.11;
const EPF_EMPLOYER_RATE_LOW = 0.13;   // wage <= RM5,000
const EPF_EMPLOYER_RATE_HIGH = 0.12;  // wage > RM5,000
const EPF_EMPLOYER_BAND = 5000;

// SOCSO Category 1 (under 60) and EIS — real PERKESO Third Schedule
// (Act 4 / Act 800) wage-band tables, not a percentage approximation.
// Amounts are fixed per band regardless of exact wage within it; the
// last band covers the RM6,000 wage ceiling and everything above it.
// EIS employer/employee amounts are always identical, so one table
// covers both sides.
const SOCSO_TABLE = [
  { max: 30.00, employer: 0.40, employee: 0.10 }, { max: 50.00, employer: 0.70, employee: 0.20 },
  { max: 70.00, employer: 1.10, employee: 0.30 }, { max: 100.00, employer: 1.50, employee: 0.40 },
  { max: 140.00, employer: 2.10, employee: 0.60 }, { max: 200.00, employer: 2.95, employee: 0.85 },
  { max: 300.00, employer: 4.35, employee: 1.25 }, { max: 400.00, employer: 6.15, employee: 1.75 },
  { max: 500.00, employer: 7.85, employee: 2.25 }, { max: 600.00, employer: 9.65, employee: 2.75 },
  { max: 700.00, employer: 11.35, employee: 3.25 }, { max: 800.00, employer: 13.15, employee: 3.75 },
  { max: 900.00, employer: 14.85, employee: 4.25 }, { max: 1000.00, employer: 16.65, employee: 4.75 },
  { max: 1100.00, employer: 18.35, employee: 5.25 }, { max: 1200.00, employer: 20.15, employee: 5.75 },
  { max: 1300.00, employer: 21.85, employee: 6.25 }, { max: 1400.00, employer: 23.65, employee: 6.75 },
  { max: 1500.00, employer: 25.35, employee: 7.25 }, { max: 1600.00, employer: 27.15, employee: 7.75 },
  { max: 1700.00, employer: 28.85, employee: 8.25 }, { max: 1800.00, employer: 30.65, employee: 8.75 },
  { max: 1900.00, employer: 32.35, employee: 9.25 }, { max: 2000.00, employer: 34.15, employee: 9.75 },
  { max: 2100.00, employer: 35.85, employee: 10.25 }, { max: 2200.00, employer: 37.65, employee: 10.75 },
  { max: 2300.00, employer: 39.35, employee: 11.25 }, { max: 2400.00, employer: 41.15, employee: 11.75 },
  { max: 2500.00, employer: 42.85, employee: 12.25 }, { max: 2600.00, employer: 44.65, employee: 12.75 },
  { max: 2700.00, employer: 46.35, employee: 13.25 }, { max: 2800.00, employer: 48.15, employee: 13.75 },
  { max: 2900.00, employer: 49.85, employee: 14.25 }, { max: 3000.00, employer: 51.65, employee: 14.75 },
  { max: 3100.00, employer: 53.35, employee: 15.25 }, { max: 3200.00, employer: 55.15, employee: 15.75 },
  { max: 3300.00, employer: 56.85, employee: 16.25 }, { max: 3400.00, employer: 58.65, employee: 16.75 },
  { max: 3500.00, employer: 60.35, employee: 17.25 }, { max: 3600.00, employer: 62.15, employee: 17.75 },
  { max: 3700.00, employer: 63.85, employee: 18.25 }, { max: 3800.00, employer: 65.65, employee: 18.75 },
  { max: 3900.00, employer: 67.35, employee: 19.25 }, { max: 4000.00, employer: 69.15, employee: 19.75 },
  { max: 4100.00, employer: 70.85, employee: 20.25 }, { max: 4200.00, employer: 72.65, employee: 20.75 },
  { max: 4300.00, employer: 74.35, employee: 21.25 }, { max: 4400.00, employer: 76.15, employee: 21.75 },
  { max: 4500.00, employer: 77.85, employee: 22.25 }, { max: 4600.00, employer: 79.65, employee: 22.75 },
  { max: 4700.00, employer: 81.35, employee: 23.25 }, { max: 4800.00, employer: 83.15, employee: 23.75 },
  { max: 4900.00, employer: 84.85, employee: 24.25 }, { max: 5000.00, employer: 86.65, employee: 24.75 },
  { max: 5100.00, employer: 88.35, employee: 25.25 }, { max: 5200.00, employer: 90.15, employee: 25.75 },
  { max: 5300.00, employer: 91.85, employee: 26.25 }, { max: 5400.00, employer: 93.65, employee: 26.75 },
  { max: 5500.00, employer: 95.35, employee: 27.25 }, { max: 5600.00, employer: 97.15, employee: 27.75 },
  { max: 5700.00, employer: 98.85, employee: 28.25 }, { max: 5800.00, employer: 100.65, employee: 28.75 },
  { max: 5900.00, employer: 102.35, employee: 29.25 }, { max: Infinity, employer: 104.65, employee: 29.90 },
];

const EIS_TABLE = [
  { max: 30.00, amount: 0.05 }, { max: 50.00, amount: 0.10 }, { max: 100.00, amount: 0.20 },
  { max: 200.00, amount: 0.30 }, { max: 300.00, amount: 0.50 }, { max: 400.00, amount: 0.70 },
  { max: 500.00, amount: 0.90 }, { max: 600.00, amount: 1.10 }, { max: 700.00, amount: 1.30 },
  { max: 800.00, amount: 1.50 }, { max: 900.00, amount: 1.70 }, { max: 1000.00, amount: 1.90 },
  { max: 1100.00, amount: 2.10 }, { max: 1200.00, amount: 2.30 }, { max: 1300.00, amount: 2.50 },
  { max: 1400.00, amount: 2.70 }, { max: 1500.00, amount: 2.90 }, { max: 1600.00, amount: 3.10 },
  { max: 1700.00, amount: 3.30 }, { max: 1800.00, amount: 3.50 }, { max: 1900.00, amount: 3.70 },
  { max: 2000.00, amount: 3.90 }, { max: 2100.00, amount: 4.10 }, { max: 2200.00, amount: 4.30 },
  { max: 2300.00, amount: 4.50 }, { max: 2400.00, amount: 4.70 }, { max: 2500.00, amount: 4.90 },
  { max: 2600.00, amount: 5.10 }, { max: 2700.00, amount: 5.30 }, { max: 2800.00, amount: 5.50 },
  { max: 2900.00, amount: 5.70 }, { max: 3000.00, amount: 5.90 }, { max: 3100.00, amount: 6.10 },
  { max: 3200.00, amount: 6.30 }, { max: 3300.00, amount: 6.50 }, { max: 3400.00, amount: 6.70 },
  { max: 3500.00, amount: 6.90 }, { max: 3600.00, amount: 7.10 }, { max: 3700.00, amount: 7.30 },
  { max: 3800.00, amount: 7.50 }, { max: 3900.00, amount: 7.70 }, { max: 4000.00, amount: 7.90 },
  { max: 4100.00, amount: 8.10 }, { max: 4200.00, amount: 8.30 }, { max: 4300.00, amount: 8.50 },
  { max: 4400.00, amount: 8.70 }, { max: 4500.00, amount: 8.90 }, { max: 4600.00, amount: 9.10 },
  { max: 4700.00, amount: 9.30 }, { max: 4800.00, amount: 9.50 }, { max: 4900.00, amount: 9.70 },
  { max: 5000.00, amount: 9.90 }, { max: 5200.00, amount: 10.30 }, { max: 5400.00, amount: 10.70 },
  { max: 5600.00, amount: 11.10 }, { max: 5800.00, amount: 11.50 }, { max: 6000.00, amount: 11.90 },
  { max: Infinity, amount: 11.90 },
];

const MIN_WAGE = 1700; // national minimum wage, applies to Sarawak private-sector employees

let manpowerIdCounter = 0;

function lookupBand(table, wage) {
  for (const band of table) {
    if (wage <= band.max) return band;
  }
  return table[table.length - 1];
}

function computeStatutory(salary) {
  const epfEmployerRate = salary <= EPF_EMPLOYER_BAND ? EPF_EMPLOYER_RATE_LOW : EPF_EMPLOYER_RATE_HIGH;
  const epfEmployer = Math.ceil(salary * epfEmployerRate);
  const epfEmployee = Math.ceil(salary * EPF_EMPLOYEE_RATE);

  const socsoBand = lookupBand(SOCSO_TABLE, salary);
  const socsoEmployer = socsoBand.employer;
  const socsoEmployee = socsoBand.employee;

  const eisBand = lookupBand(EIS_TABLE, salary);
  const eisEmployer = eisBand.amount;
  const eisEmployee = eisBand.amount;

  return {
    epfEmployer, epfEmployee, socsoEmployer, socsoEmployee, eisEmployer, eisEmployee,
    employerCost: salary + epfEmployer + socsoEmployer + eisEmployer,
    employeeNet: salary - epfEmployee - socsoEmployee - eisEmployee,
  };
}

function updateManpowerRow(tr) {
  const type = tr.querySelector('.mp-type').value;
  const salary = parseNum(tr.querySelector('.mp-salary'));
  const statutoryFields = tr.querySelector('.mp-statutory-fields');
  const statutoryEmpty = tr.querySelector('.mp-statutory-empty');
  const warningEl = tr.querySelector('.mp-wage-warning');

  let employerCost;
  if (type === 'permanent') {
    statutoryFields.hidden = false;
    statutoryEmpty.hidden = true;
    const s = computeStatutory(salary);
    tr.querySelector('.mp-epf').textContent = formatRM(s.epfEmployer);
    tr.querySelector('.mp-socso').textContent = formatRM(s.socsoEmployer);
    tr.querySelector('.mp-eis').textContent = formatRM(s.eisEmployer);
    employerCost = s.employerCost;
    warningEl.hidden = salary >= MIN_WAGE || salary === 0;
  } else {
    statutoryFields.hidden = true;
    statutoryEmpty.hidden = false;
    employerCost = salary; // freelance/casual: paid in bulk, no statutory contributions
    warningEl.hidden = true;
  }

  tr.querySelector('.mp-cost').textContent = formatRM(employerCost);
  tr.dataset.employerCost = employerCost;

  updateManpowerTotal();
}

function createManpowerRow() {
  manpowerIdCounter++;
  const tbody = document.getElementById('manpower-rows');
  const tr = document.createElement('tr');
  tr.dataset.rowId = 'mp-' + manpowerIdCounter;
  tr.innerHTML = `
    <td><input type="text" class="mp-role" name="role" placeholder="e.g. Kitchen helper"></td>
    <td>
      <select class="mp-type" name="staff-type">
        <option value="permanent">Permanent</option>
        <option value="freelance">Freelance / casual</option>
      </select>
    </td>
    <td>
      <input type="number" class="mp-salary" name="salary" inputmode="decimal" min="0" step="10" value="1700">
      <div class="mp-wage-warning" hidden>Below RM1,700 national minimum wage</div>
    </td>
    <td class="mp-statutory-cells calc">
      <div class="mp-statutory-fields" hidden>
        <div>EPF <span class="mp-epf">RM0.00</span></div>
        <div>SOCSO <span class="mp-socso">RM0.00</span></div>
        <div>EIS <span class="mp-eis">RM0.00</span></div>
      </div>
      <span class="mp-statutory-empty">&mdash; not applicable &mdash;</span>
    </td>
    <td class="calc mp-cost">RM0.00</td>
    <td class="no-print"><button type="button" class="delete-row" aria-label="Remove this staff member">&times;</button></td>
  `;
  tbody.appendChild(tr);

  tr.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('input', () => updateManpowerRow(tr));
  });
  tr.querySelector('.delete-row').addEventListener('click', () => {
    tr.remove();
    updateManpowerTotal();
  });

  updateManpowerRow(tr);
}

function updateManpowerTotal() {
  let total = 0;
  document.querySelectorAll('#manpower-rows > tr').forEach((tr) => {
    total += parseFloat(tr.dataset.employerCost) || 0;
  });
  document.getElementById('manpower-total').textContent = formatRM(total);
  updateGrandTotal();
}

/* ================= GRAND TOTAL + INIT ================= */

function updateGrandTotal() {
  const overheadText = document.getElementById('overhead-total').textContent;
  const manpowerText = document.getElementById('manpower-total').textContent;
  const overhead = parseFloat(overheadText.replace(/[^0-9.]/g, '')) || 0;
  const manpower = parseFloat(manpowerText.replace(/[^0-9.]/g, '')) || 0;
  document.getElementById('grand-total').textContent = formatRM(overhead + manpower);

  if (typeof rzBroadcast === 'function') {
    rzBroadcast({ overheadMonthly: overhead, manpowerMonthly: manpower });
  }
}

let rzInitialized = false;

function init() {
  if (rzInitialized) return;
  rzInitialized = true;
  document.getElementById('add-overhead-row').addEventListener('click', createOverheadRow);
  document.getElementById('add-manpower-row').addEventListener('click', createManpowerRow);
  document.getElementById('save-pdf-om').addEventListener('click', () => window.print());

  createOverheadRow();
  createManpowerRow();
}

document.addEventListener('DOMContentLoaded', init);
