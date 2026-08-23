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

console.info('[Overhead & Manpower Calculator] script build: 2026-08-23-column-fix');

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
  'Rent', 'Electricity', 'Water', 'Internet / Phone',
  'Trade License', 'Business License', 'Health / Food Premise License',
  'Food Handling Course', 'Typhoid Vaccination',
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

// Standard federal rates (Malaysia-wide, including Sarawak — EPF/
// SOCSO/EIS aren't state-specific). EPF uses the flat percentage
// rather than the official Third Schedule table (small rounding
// differences vs. an exact payslip). SOCSO/EIS apply only up to the
// RM6,000 wage ceiling; EPF has no ceiling.
const EPF_EMPLOYEE_RATE = 0.11;
const EPF_EMPLOYER_RATE_LOW = 0.13;   // wage <= RM5,000
const EPF_EMPLOYER_RATE_HIGH = 0.12;  // wage > RM5,000
const EPF_EMPLOYER_BAND = 5000;
const SOCSO_EMPLOYER_RATE = 0.0175;
const SOCSO_EMPLOYEE_RATE = 0.005;
const EIS_RATE = 0.002; // each side
const SOCSO_EIS_CEILING = 6000;
const MIN_WAGE = 1700; // national minimum wage, applies to Sarawak private-sector employees

let manpowerIdCounter = 0;

function computeStatutory(salary) {
  const epfEmployerRate = salary <= EPF_EMPLOYER_BAND ? EPF_EMPLOYER_RATE_LOW : EPF_EMPLOYER_RATE_HIGH;
  const epfEmployer = salary * epfEmployerRate;
  const epfEmployee = salary * EPF_EMPLOYEE_RATE;

  const socsoEisBase = Math.min(salary, SOCSO_EIS_CEILING);
  const socsoEmployer = socsoEisBase * SOCSO_EMPLOYER_RATE;
  const socsoEmployee = socsoEisBase * SOCSO_EMPLOYEE_RATE;
  const eisEmployer = socsoEisBase * EIS_RATE;
  const eisEmployee = socsoEisBase * EIS_RATE;

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
}

function init() {
  document.getElementById('add-overhead-row').addEventListener('click', createOverheadRow);
  document.getElementById('add-manpower-row').addEventListener('click', createManpowerRow);
  document.getElementById('save-pdf-om').addEventListener('click', () => window.print());

  createOverheadRow();
  createManpowerRow();
}

document.addEventListener('DOMContentLoaded', init);
