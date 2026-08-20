/* ============================================================
   Menu Costing Calculator
   Vanilla JS, no dependencies, nothing saved anywhere.
   ------------------------------------------------------------
   Two linked tables:
   1. Ingredients (#rows)   — cost per base unit, per item you buy
   2. Menu builder (#menu-rows) — combines ingredients into one
      dish. It never stores its own copy of cost data; every
      calculation reads live from the ingredient rows via
      data-row-id / data-true-cost / data-base-unit.

   TO EXTEND (e.g. margin % / inflation % / suggested price):
     1. Add a <th> to the relevant table header in the HTML
     2. Add the matching <td> to that table's row template
     3. Add the calculation step inside its updateRow() function
   ============================================================ */

// Conversion factor from each purchase unit into its "base unit".
const UNITS = {
  kg:    { base: 'g',    factor: 1000 },
  g:     { base: 'g',    factor: 1 },
  L:     { base: 'mL',   factor: 1000 },
  mL:    { base: 'mL',   factor: 1 },
  dozen: { base: 'each', factor: 12 },
  each:  { base: 'each', factor: 1 },
};

const MENU_TYPES = ['Main', 'Side', 'Sauce', 'Dip', 'Garnish', 'Beverage', 'Other'];

let ingredientIdCounter = 0;
let menuRowIdCounter = 0;

// Formats a number as Ringgit to 2dp. Guards against a true value
// rounding down to a misleading "RM0.00".
function formatRM(value) {
  if (!isFinite(value) || value < 0) return 'RM0.00';
  if (value > 0 && value < 0.01) return '< RM0.01';
  return 'RM' + value.toFixed(2);
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ================= 1. INGREDIENT TABLE ================= */

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

  // Raw values for the Menu Portion Creator to read — never the
  // formatted/rounded text above.
  tr.dataset.trueCost = trueCost;
  tr.dataset.baseUnit = unit.base;

  refreshMenuBuilder();
}

function unitOptionsHTML() {
  return Object.keys(UNITS).map(k => `<option value="${k}">${k}</option>`).join('');
}

function createRow() {
  ingredientIdCounter++;
  const tbody = document.getElementById('rows');
  const tr = document.createElement('tr');
  tr.dataset.rowId = 'ing-' + ingredientIdCounter;
  tr.innerHTML = `
    <td><input type="text" class="f-item" placeholder="e.g. Chicken breast"></td>
    <td><input type="number" class="f-price" inputmode="decimal" min="0" step="0.01" value="0.00"></td>
    <td><input type="number" class="f-qty" inputmode="decimal" min="0.01" step="0.01" value="1"></td>
    <td><select class="f-unit">${unitOptionsHTML()}</select></td>
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
  tr.querySelector('.delete-row').addEventListener('click', () => {
    tr.remove();
    refreshMenuBuilder();
  });

  updateRow(tr);
}

/* ================= 2. MENU PORTION CREATOR ================= */

// Reads the ingredient table live — this is the only place that
// touches ingredient data, so there's one source of truth.
function getIngredients() {
  const list = [];
  document.querySelectorAll('#rows > tr').forEach((tr) => {
    const nameRaw = tr.querySelector('.f-item').value.trim();
    list.push({
      id: tr.dataset.rowId,
      name: nameRaw || 'Unnamed item',
      trueCost: parseFloat(tr.dataset.trueCost) || 0,
      baseUnit: tr.dataset.baseUnit || 'g',
    });
  });
  return list;
}

function menuTypeOptionsHTML() {
  return MENU_TYPES.map(t => `<option value="${t}">${t}</option>`).join('');
}

function menuItemOptionsHTML(selectedId) {
  const ingredients = getIngredients();
  if (ingredients.length === 0) {
    return `<option value="">Add an item above first</option>`;
  }
  let html = `<option value="">— Select an item —</option>`;
  ingredients.forEach((ing) => {
    const sel = ing.id === selectedId ? ' selected' : '';
    html += `<option value="${ing.id}"${sel}>${escapeHTML(ing.name)}</option>`;
  });
  return html;
}

function updateMenuRow(tr) {
  const select = tr.querySelector('.m-item');
  const selectedId = select.value;
  const amount = parseFloat(tr.querySelector('.m-amount').value) || 0;
  const included = tr.querySelector('.m-include').checked;

  const ing = getIngredients().find(i => i.id === selectedId);

  tr.querySelector('.m-unit-label').textContent = ing ? ing.baseUnit : '—';

  const price = ing ? amount * ing.trueCost : 0;
  tr.querySelector('.m-price').textContent = formatRM(price);
  tr.dataset.price = price;

  tr.classList.toggle('excluded', !included);

  updateMenuTotal();
}

function updateMenuTotal() {
  let total = 0;
  document.querySelectorAll('#menu-rows > tr').forEach((tr) => {
    if (tr.querySelector('.m-include').checked) {
      total += parseFloat(tr.dataset.price) || 0;
    }
  });
  const totalEl = document.getElementById('menu-total');
  if (totalEl) totalEl.textContent = formatRM(total);
}

function createMenuRow() {
  menuRowIdCounter++;
  const tbody = document.getElementById('menu-rows');
  const tr = document.createElement('tr');
  tr.dataset.menuRowId = 'menu-' + menuRowIdCounter;
  tr.innerHTML = `
    <td><input type="checkbox" class="m-include" checked aria-label="Include in total"></td>
    <td><select class="m-type">${menuTypeOptionsHTML()}</select></td>
    <td><select class="m-item">${menuItemOptionsHTML(null)}</select></td>
    <td>
      <div class="amount-cell">
        <input type="number" class="m-amount" inputmode="decimal" min="0" step="0.01" value="0">
        <span class="m-unit-label">—</span>
      </div>
    </td>
    <td class="calc m-price">RM0.00</td>
    <td class="no-print"><button type="button" class="delete-row" aria-label="Remove this menu item">&times;</button></td>
  `;
  tbody.appendChild(tr);

  tr.querySelector('.m-item').addEventListener('change', () => updateMenuRow(tr));
  tr.querySelector('.m-amount').addEventListener('input', () => updateMenuRow(tr));
  tr.querySelector('.m-include').addEventListener('change', () => updateMenuRow(tr));
  tr.querySelector('.delete-row').addEventListener('click', () => {
    tr.remove();
    updateMenuTotal();
  });

  updateMenuRow(tr);
}

// Called whenever the ingredient table changes (add/edit/delete a
// row). Rebuilds every menu row's Item dropdown from current
// ingredients, keeping the same selection if that ingredient still
// exists, and recalculates prices in case a cost changed upstream.
function refreshMenuBuilder() {
  const menuRowsEl = document.getElementById('menu-rows');
  if (!menuRowsEl) return;
  menuRowsEl.querySelectorAll('tr').forEach((tr) => {
    const select = tr.querySelector('.m-item');
    const currentValue = select.value;
    select.innerHTML = menuItemOptionsHTML(currentValue);
    updateMenuRow(tr);
  });
}

/* ================= INIT ================= */

function init() {
  document.getElementById('add-row').addEventListener('click', createRow);
  document.getElementById('save-pdf').addEventListener('click', () => window.print());
  document.getElementById('add-menu-row').addEventListener('click', createMenuRow);

  createRow();     // ingredient table starts with one row
  createMenuRow();  // menu builder starts with one row
}

document.addEventListener('DOMContentLoaded', init);
