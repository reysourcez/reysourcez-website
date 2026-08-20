/* ============================================================
   Menu Costing Calculator
   Vanilla JS, no dependencies, nothing saved anywhere.
   ------------------------------------------------------------
   TO EXTEND (e.g. adding margin % / inflation % / suggested
   selling price later):
     1. Add a <th> to the table header in menu-calculator.html
     2. Add the matching <td> to the row template in createRow()
     3. Add the calculation step inside updateRow()
   That's the whole pattern — every column follows it.
   ============================================================ */

// Conversion factor from each purchase unit into its "base unit".
// Base units are the smallest common denominator: gram, millilitre, each.
const UNITS = {
  kg:    { base: 'g',    factor: 1000 },
  g:     { base: 'g',    factor: 1 },
  L:     { base: 'mL',   factor: 1000 },
  mL:    { base: 'mL',   factor: 1 },
  dozen: { base: 'each', factor: 12 },
  each:  { base: 'each', factor: 1 },
};

// Formats a number as Ringgit to 2dp. Guards against a true value
// rounding down to a misleading "RM0.00".
function formatRM(value) {
  if (!isFinite(value) || value < 0) return 'RM0.00';
  if (value > 0 && value < 0.01) return '< RM0.01';
  return 'RM' + value.toFixed(2);
}

function updateRow(tr) {
  const price = parseFloat(tr.querySelector('.f-price').value) || 0;
  const qty = parseFloat(tr.querySelector('.f-qty').value) || 0;
  const unitKey = tr.querySelector('.f-unit').value;
  const wastageRaw = parseFloat(tr.querySelector('.f-wastage').value) || 0;
  const wastage = Math.min(100, Math.max(0, wastageRaw));

  const unit = UNITS[unitKey];
  const totalBaseQty = qty * unit.factor;
  const pricePerUnit = totalBaseQty > 0 ? price / totalBaseQty : 0;
  const yieldPct = 100 - wastage;
  const trueCost = yieldPct > 0 ? pricePerUnit / (yieldPct / 100) : 0;

  tr.querySelector('.r-price-per-unit').textContent = `${formatRM(pricePerUnit)}/${unit.base}`;
  tr.querySelector('.r-yield').textContent = `${yieldPct.toFixed(1)}%`;
  tr.querySelector('.r-true-cost').textContent = `${formatRM(trueCost)}/${unit.base}`;
}

function unitOptionsHTML() {
  return Object.keys(UNITS).map(k => `<option value="${k}">${k}</option>`).join('');
}

function createRow() {
  const tbody = document.getElementById('rows');
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td><input type="text" class="f-item" placeholder="e.g. Chicken breast"></td>
    <td><input type="number" class="f-price" inputmode="decimal" min="0" step="0.01" value="0.00"></td>
    <td><input type="number" class="f-qty" inputmode="decimal" min="0.01" step="0.01" value="1"></td>
    <td>
      <select class="f-unit">${unitOptionsHTML()}</select>
    </td>
    <td class="calc r-price-per-unit">RM0.00/g</td>
    <td><input type="number" class="f-wastage" inputmode="decimal" min="0" max="100" step="0.1" value="0"></td>
    <td class="calc r-yield">100.0%</td>
    <td class="calc r-true-cost">RM0.00/g</td>
    <td class="no-print"><button type="button" class="delete-row" aria-label="Remove this item">&times;</button></td>
  `;
  tbody.appendChild(tr);

  tr.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('input', () => updateRow(tr));
  });
  tr.querySelector('.delete-row').addEventListener('click', () => tr.remove());

  updateRow(tr);
}

function init() {
  document.getElementById('add-row').addEventListener('click', createRow);
  document.getElementById('save-pdf').addEventListener('click', () => window.print());
  createRow(); // start with one row so the table isn't empty
}

document.addEventListener('DOMContentLoaded', init);
