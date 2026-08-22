/* ============================================================
   Menu Costing Calculator
   Vanilla JS, no dependencies, nothing saved anywhere.
   ------------------------------------------------------------
   Two linked parts:
   1. Ingredient Costing (#rows) — true cost per base unit for
      each thing you buy.
   2. Menu Portion Creator (#menu-blocks) — one or more dishes,
      each built from ingredients above. Every menu block reads
      ingredient data live via data-row-id / data-true-cost /
      data-base-unit — there's one source of truth, never a
      second copy of cost data.

   TO EXTEND:
     - New ingredient column: add <th>/<td> to the row template
       in createIngredientRow(), add the calc step in
       updateIngredientRow().
     - New menu-row column: same pattern in createMenuRow() /
       updateMenuRow().
     - New per-menu summary figure (like Target Selling Price):
       add markup in createMenuBlock()'s pricing-panel, compute
       it in updateMenuBlockSummary().
   ============================================================ */

/* ================= SHARED UTILITIES ================= */

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

// Reads a percentage-style input: falls back to a sensible default
// if blank/invalid, and never goes below `min` (e.g. can't divide
// by a zero yield).
function parsePercent(inputEl, fallback, min) {
  const raw = parseFloat(inputEl.value);
  if (!isFinite(raw)) return fallback;
  return Math.max(min, raw);
}

// Generic click-to-sort for any table. getSortValue(tr, key) must
// return a number or string for the given data-sort key. Reorders
// actual <tr> elements, so it's safe with the data-row-id linkage
// used elsewhere (nothing is keyed by row position).
function makeSortable(theadEl, tbodyEl, getSortValue, onSorted) {
  const state = { key: null, dir: 1 };
  theadEl.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      state.dir = state.key === key ? state.dir * -1 : 1;
      state.key = key;

      theadEl.querySelectorAll('.sort-indicator').forEach((s) => { s.textContent = ''; });
      const indicator = th.querySelector('.sort-indicator');
      if (indicator) indicator.textContent = state.dir === 1 ? '\u25B2' : '\u25BC';

      const rows = Array.from(tbodyEl.children);
      rows.sort((a, b) => {
        const va = getSortValue(a, key);
        const vb = getSortValue(b, key);
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * state.dir;
        return String(va).localeCompare(String(vb)) * state.dir;
      });
      rows.forEach((r) => tbodyEl.appendChild(r));
      if (onSorted) onSorted();
    });
  });
}

/* ================= 1. INGREDIENT COSTING ================= */

// factor = how many base units are in one purchase unit.
// portion/piece are for pre-divided purchases (see createIngredientRow
// comment below) — factor 1 because the base unit IS the purchase unit.
const UNITS = {
  kg:      { base: 'g',       factor: 1000 },
  g:       { base: 'g',       factor: 1 },
  L:       { base: 'mL',      factor: 1000 },
  mL:      { base: 'mL',      factor: 1 },
  lb:      { base: 'g',       factor: 453.592 },
  oz:      { base: 'g',       factor: 28.3495 },
  dozen:   { base: 'each',    factor: 12 },
  each:    { base: 'each',    factor: 1 },
  portion: { base: 'portion', factor: 1 },
  piece:   { base: 'piece',   factor: 1 },
};

let ingredientIdCounter = 0;

function unitOptionsHTML() {
  return Object.keys(UNITS).map((k) => `<option value="${k}">${k}</option>`).join('');
}

function ingredientSortValue(tr, key) {
  switch (key) {
    case 'item': return tr.querySelector('.f-item').value.trim().toLowerCase();
    case 'price': return parseFloat(tr.querySelector('.f-price').value) || 0;
    case 'qty': return parseFloat(tr.querySelector('.f-qty').value) || 0;
    case 'priceperunit': return parseFloat(tr.dataset.pricePerUnit) || 0;
    case 'yield': return parseFloat(tr.querySelector('.f-yield').value) || 0;
    case 'wastage': return parseFloat(tr.querySelector('.f-wastage').value) || 0;
    case 'truecost': return parseFloat(tr.dataset.trueCost) || 0;
    default: return '';
  }
}

// Inflation is a single blanket rate (set once, above the table),
// not a per-item value — unlike Yield/Wastage, which genuinely vary
// item by item, inflation is a macro assumption that should apply
// uniformly everywhere.
function getGlobalInflation() {
  const el = document.getElementById('global-inflation');
  return el ? parsePercent(el, 0, 0) : 0;
}

function refreshAllIngredientRows() {
  document.querySelectorAll('#rows > tr').forEach((tr) => updateIngredientRow(tr));
}

function updateIngredientRow(tr) {
  const price = parseFloat(tr.querySelector('.f-price').value) || 0;
  const qty = parseFloat(tr.querySelector('.f-qty').value) || 0;
  const unitKey = tr.querySelector('.f-unit').value;

  // Yield: the KNOWN, measurable usable proportion — under 100%
  // for trim/prep loss, OVER 100% for foods that gain weight when
  // cooked (dry noodles/rice absorbing water). Not capped at 100.
  const yieldPct = parsePercent(tr.querySelector('.f-yield'), 100, 0.01);
  // Wastage: an unaccountable buffer layered on top — shrinkage,
  // moisture loss, things you can't measure in advance.
  const wastagePct = parsePercent(tr.querySelector('.f-wastage'), 0, 0);
  // Inflation: one blanket forward-looking buffer, read from the
  // single control above the table — see getGlobalInflation().
  const inflationPct = getGlobalInflation();

  const unit = UNITS[unitKey];
  const totalBaseQty = qty * unit.factor;
  const pricePerUnit = totalBaseQty > 0 ? price / totalBaseQty : 0;

  const costAfterYield = pricePerUnit / (yieldPct / 100);
  const costAfterBuffer = costAfterYield * (1 + wastagePct / 100);
  const trueCost = costAfterBuffer * (1 + inflationPct / 100);

  tr.querySelector('.r-price-per-unit').textContent = `${formatRM(pricePerUnit)}/${unit.base}`;
  tr.querySelector('.r-true-cost').textContent = `${formatRM(trueCost)}/${unit.base}`;

  // Raw values for the Menu Portion Creator to read — never the
  // formatted/rounded text above.
  tr.dataset.pricePerUnit = pricePerUnit;
  tr.dataset.trueCost = trueCost;
  tr.dataset.baseUnit = unit.base;

  refreshAllMenuBlocks();
}

// Purchase Unit guide:
// - kg/g/L/mL/lb/oz: weight or volume you measure at purchase.
// - each/dozen: whole countable items.
// - portion/piece: for something bought as ONE whole thing but used
//   in defined pieces — a pack of noodles that makes 8 portions, or
//   a whole chicken cut into 8 pieces. Set Qty to the portion/piece
//   COUNT (e.g. 8), not a weight, and Price to what you paid for the
//   whole thing — Price/Base Unit then comes out as cost per portion.
function createIngredientRow() {
  ingredientIdCounter++;
  const tbody = document.getElementById('rows');
  const tr = document.createElement('tr');
  tr.dataset.rowId = 'ing-' + ingredientIdCounter;
  tr.innerHTML = `
    <td><input type="text" class="f-item" name="item" placeholder="e.g. Chicken breast"></td>
    <td><input type="number" class="f-price" name="price" inputmode="decimal" min="0" step="0.01" value="0.00"></td>
    <td><input type="number" class="f-qty" name="qty" inputmode="decimal" min="0.01" step="0.01" value="1"></td>
    <td><select class="f-unit" name="unit">${unitOptionsHTML()}</select></td>
    <td class="calc r-price-per-unit">RM0.00/g</td>
    <td><input type="number" class="f-yield" name="yield" inputmode="decimal" min="0.01" step="0.1" value="100"></td>
    <td><input type="number" class="f-wastage" name="wastage" inputmode="decimal" min="0" step="0.1" value="0"></td>
    <td class="calc r-true-cost">RM0.00/g</td>
    <td class="no-print"><button type="button" class="delete-row" aria-label="Remove this item">&times;</button></td>
  `;
  tbody.appendChild(tr);

  tr.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('input', () => updateIngredientRow(tr));
  });
  tr.querySelector('.delete-row').addEventListener('click', () => {
    tr.remove();
    refreshAllMenuBlocks();
  });

  updateIngredientRow(tr);
}

// The only place that reads ingredient data — one source of truth
// for every menu block below.
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

/* ================= 2. MENU PORTION CREATOR ================= */

const MENU_TYPES = ['Main', 'Side', 'Sauce', 'Dip', 'Garnish', 'Beverage', 'Other'];

let menuBlockIdCounter = 0;
let menuRowIdCounter = 0;

function menuTypeOptionsHTML() {
  return MENU_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('');
}

function menuItemOptionsHTML(selectedId) {
  const ingredients = getIngredients();
  if (ingredients.length === 0) {
    return `<option value="">Add an item above first</option>`;
  }
  let html = `<option value="">\u2014 Select an item \u2014</option>`;
  ingredients.forEach((ing) => {
    const sel = ing.id === selectedId ? ' selected' : '';
    html += `<option value="${ing.id}"${sel}>${escapeHTML(ing.name)}</option>`;
  });
  return html;
}

function menuSortValue(tr, key) {
  switch (key) {
    case 'type': return tr.querySelector('.m-type').value.toLowerCase();
    case 'item': {
      const sel = tr.querySelector('.m-item');
      const opt = sel.options[sel.selectedIndex];
      return (opt ? opt.textContent : '').toLowerCase();
    }
    case 'amount': return parseFloat(tr.querySelector('.m-amount').value) || 0;
    case 'price': return parseFloat(tr.dataset.price) || 0;
    default: return '';
  }
}

function updateMenuRow(tr) {
  const select = tr.querySelector('.m-item');
  const selectedId = select.value;
  const amount = parseFloat(tr.querySelector('.m-amount').value) || 0;
  const included = tr.querySelector('.m-include').checked;

  const ing = getIngredients().find((i) => i.id === selectedId);

  tr.querySelector('.m-unit-label').textContent = ing ? ing.baseUnit : '\u2014';

  const price = ing ? amount * ing.trueCost : 0;
  tr.querySelector('.m-price').textContent = formatRM(price);
  tr.dataset.price = price;

  tr.classList.toggle('excluded', !included);

  const block = tr.closest('.menu-block');
  if (block) updateMenuBlockSummary(block);
}

function createMenuRow(block) {
  menuRowIdCounter++;
  const tbody = block.querySelector('.menu-rows');
  const tr = document.createElement('tr');
  tr.dataset.menuRowId = 'menurow-' + menuRowIdCounter;
  tr.innerHTML = `
    <td><input type="checkbox" class="m-include" name="include" checked aria-label="Include in total"></td>
    <td><select class="m-type" name="menu-type">${menuTypeOptionsHTML()}</select></td>
    <td><select class="m-item" name="menu-item">${menuItemOptionsHTML(null)}</select></td>
    <td>
      <div class="amount-cell">
        <input type="number" class="m-amount" name="amount" inputmode="decimal" min="0" step="0.01" value="0">
        <span class="m-unit-label">\u2014</span>
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
    updateMenuBlockSummary(block);
  });

  updateMenuRow(tr);
}

// Total -> Target Selling Price (cost-plus, from the target food-cost
// %) -> what's actually left after an optional delivery-platform cut
// and optional SST. Every rate is editable; the defaults below are
// just starting points, not fixed facts — commission varies by
// platform/tier, and SST eligibility depends on registration status.
function updateMenuBlockSummary(block) {
  let total = 0;
  block.querySelectorAll('.menu-rows > tr').forEach((tr) => {
    if (tr.querySelector('.m-include').checked) total += parseFloat(tr.dataset.price) || 0;
  });
  block.querySelector('.menu-total').textContent = formatRM(total);

  const targetFoodCostPct = parsePercent(block.querySelector('.target-food-cost'), 30, 0.1);
  const targetSellingPrice = total / (targetFoodCostPct / 100);
  block.querySelector('.target-selling-price').textContent = formatRM(targetSellingPrice);

  const useDelivery = block.querySelector('.use-delivery-toggle').checked;
  const useSST = block.querySelector('.use-sst-toggle').checked;
  const commissionPct = parsePercent(block.querySelector('.commission-pct'), 30, 0);
  const commissionTaxPct = parsePercent(block.querySelector('.commission-tax-pct'), 8, 0);
  const sstPct = parsePercent(block.querySelector('.sst-pct'), 6, 0);

  const commissionAmount = useDelivery ? targetSellingPrice * (commissionPct / 100) : 0;
  const commissionTaxAmount = useDelivery ? commissionAmount * (commissionTaxPct / 100) : 0;
  const sstAmount = useSST ? targetSellingPrice * (sstPct / 100) : 0;
  const netAmount = targetSellingPrice - commissionAmount - commissionTaxAmount - sstAmount;

  block.querySelector('.commission-amount').textContent = formatRM(commissionAmount);
  block.querySelector('.commission-tax-amount').textContent = formatRM(commissionTaxAmount);
  block.querySelector('.sst-amount').textContent = formatRM(sstAmount);
  block.querySelector('.net-amount').textContent = formatRM(netAmount);
}

// Rebuilds this block's Item dropdowns from current ingredients,
// keeping the same selection if that ingredient still exists.
function refreshMenuBlockDropdowns(block) {
  block.querySelectorAll('.menu-rows > tr').forEach((tr) => {
    const select = tr.querySelector('.m-item');
    const currentValue = select.value;
    select.innerHTML = menuItemOptionsHTML(currentValue);
    updateMenuRow(tr);
  });
}

// Called whenever the ingredient table changes (add/edit/delete/sort).
function refreshAllMenuBlocks() {
  document.querySelectorAll('.menu-block').forEach((block) => refreshMenuBlockDropdowns(block));
}

function createMenuBlock() {
  menuBlockIdCounter++;
  const n = menuBlockIdCounter;
  const container = document.getElementById('menu-blocks');
  const block = document.createElement('div');
  block.className = 'menu-block';
  block.dataset.blockId = 'menublock-' + n;
  block.innerHTML = `
    <div class="menu-block-header">
      <input type="text" class="menu-name-input" name="menu-name" value="Untitled Menu Item" aria-label="Menu item name">
      <button type="button" class="remove-block-btn no-print" aria-label="Remove this menu">Remove menu</button>
    </div>

    <div class="table-scroll">
      <table class="menu-table">
        <caption class="sr-only">Menu portion builder \u2014 combine ingredients from the table above into one dish</caption>
        <thead>
          <tr>
            <th scope="col"><span class="sr-only">Include in total</span></th>
            <th scope="col" class="sortable" data-sort="type">Type <span class="sort-indicator"></span></th>
            <th scope="col" class="sortable" data-sort="item">Item <span class="sort-indicator"></span></th>
            <th scope="col" class="sortable" data-sort="amount">Amount <span class="sort-indicator"></span></th>
            <th scope="col" class="sortable auto-col" data-sort="price">Price <span class="sort-indicator"></span></th>
            <th scope="col" class="no-print"><span class="sr-only">Remove</span></th>
          </tr>
        </thead>
        <tbody class="menu-rows"></tbody>
        <tfoot>
          <tr class="menu-total-row">
            <td colspan="4"><strong>Total</strong></td>
            <td class="calc menu-total">RM0.00</td>
            <td class="no-print"></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="calc-actions no-print">
      <button type="button" class="add-menu-row-btn btn btn-secondary">+ Add item to menu</button>
    </div>

    <div class="pricing-panel">
      <div class="pricing-row">
        <label for="tfc-${n}">Target Food Cost %</label>
        <input type="number" id="tfc-${n}" class="target-food-cost" name="target-food-cost" inputmode="decimal" min="1" max="100" step="0.1" value="30">
        <span class="pricing-result">Target Selling Price <strong class="target-selling-price">RM0.00</strong></span>
      </div>

      <div class="platform-panel">
        <label class="toggle-row">
          <input type="checkbox" class="use-delivery-toggle" name="use-delivery">
          Sold via delivery app <span class="toggle-hint">(commission + tax on commission)</span>
        </label>
        <div class="platform-fields" hidden>
          <label>Commission % <input type="number" class="commission-pct" name="commission-pct" inputmode="decimal" min="0" max="100" step="0.1" value="30"></label>
          <label>Tax on commission % <input type="number" class="commission-tax-pct" name="commission-tax-pct" inputmode="decimal" min="0" max="100" step="0.1" value="8"></label>
        </div>

        <label class="toggle-row">
          <input type="checkbox" class="use-sst-toggle" name="use-sst">
          SST registered <span class="toggle-hint">(tax on food)</span>
        </label>
        <div class="sst-fields" hidden>
          <label>SST on food % <input type="number" class="sst-pct" name="sst-pct" inputmode="decimal" min="0" max="100" step="0.1" value="6"></label>
        </div>

        <div class="net-summary">
          <div>Commission <span class="commission-amount">RM0.00</span></div>
          <div>Tax on commission <span class="commission-tax-amount">RM0.00</span></div>
          <div>SST <span class="sst-amount">RM0.00</span></div>
          <div class="net-received">Net received <strong class="net-amount">RM0.00</strong></div>
        </div>
      </div>
    </div>
  `;
  container.appendChild(block);

  block.querySelector('.add-menu-row-btn').addEventListener('click', () => createMenuRow(block));
  block.querySelector('.remove-block-btn').addEventListener('click', () => block.remove());
  block.querySelector('.target-food-cost').addEventListener('input', () => updateMenuBlockSummary(block));
  block.querySelector('.commission-pct').addEventListener('input', () => updateMenuBlockSummary(block));
  block.querySelector('.commission-tax-pct').addEventListener('input', () => updateMenuBlockSummary(block));
  block.querySelector('.sst-pct').addEventListener('input', () => updateMenuBlockSummary(block));
  block.querySelector('.use-delivery-toggle').addEventListener('change', (e) => {
    block.querySelector('.platform-fields').hidden = !e.target.checked;
    updateMenuBlockSummary(block);
  });
  block.querySelector('.use-sst-toggle').addEventListener('change', (e) => {
    block.querySelector('.sst-fields').hidden = !e.target.checked;
    updateMenuBlockSummary(block);
  });

  makeSortable(
    block.querySelector('thead'),
    block.querySelector('.menu-rows'),
    menuSortValue,
    () => updateMenuBlockSummary(block)
  );

  createMenuRow(block);
  updateMenuBlockSummary(block);
}

/* ================= INIT ================= */

// Bump this string whenever this file changes — if something looks
// broken, checking this in the browser console (F12) instantly
// confirms whether the deployed JS actually matches the deployed
// HTML, rather than guessing from symptoms.
console.info('[Menu Calculator] script build: 2026-08-21-named-fields');

function init() {
  document.getElementById('add-row').addEventListener('click', createIngredientRow);
  document.getElementById('save-pdf').addEventListener('click', () => window.print());
  document.getElementById('add-menu-block').addEventListener('click', createMenuBlock);
  document.getElementById('global-inflation').addEventListener('input', refreshAllIngredientRows);

  makeSortable(
    document.querySelector('#calc-table thead'),
    document.getElementById('rows'),
    ingredientSortValue,
    () => refreshAllMenuBlocks()
  );

  createIngredientRow();
  createMenuBlock();
}

document.addEventListener('DOMContentLoaded', init);
