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

const MENU_TYPES = ['Main', 'Side', 'Sauce', 'Dip', 'Garnish', 'Beverage', 'Packaging', 'Other'];

let menuBlockIdCounter = 0;
let menuRowIdCounter = 0;

// Separate Worker from Food Worth's and Margin Audit's proxies, even
// though all three share the same photo/description -> Gemini ->
// structured JSON shape — see menu-calculator-proxy-worker.js's own
// header comment for why they're kept apart rather than shared.
const MENU_AI_PROXY_ENDPOINT = 'PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE';
const MENU_AI_MAX_IMAGE_EDGE = 1024;

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
    case 'targetprice': return parseFloat(tr.dataset.targetPrice) || 0;
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

  const block = tr.closest('.menu-block');
  const targetFoodCostPct = block ? parsePercent(block.querySelector('.target-food-cost'), 30, 0.1) : 30;
  const targetPrice = price / (targetFoodCostPct / 100);
  tr.querySelector('.m-target-price').textContent = formatRM(targetPrice);
  tr.dataset.targetPrice = targetPrice;

  tr.classList.toggle('excluded', !included);

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
    <td class="calc m-target-price">RM0.00</td>
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

// Cost, for whichever of the three methods (detailed/simple/ai) is
// currently active on this block — see setCostTab/setManualSub below.
// Detailed sums the checked ingredient rows, same as always. Simple
// and AI both resolve to one number a different way, but from here on
// out (target price, delivery/SST, sync) it's all just "total" again,
// same math regardless of source.
function computeAiRowsTotal(block) {
  let sum = 0;
  block.querySelectorAll('.menu-ai-rows > tr').forEach((tr) => {
    if (tr.querySelector('.m-include').checked) {
      sum += parseFloat(tr.querySelector('.ai-price').value) || 0;
    }
  });
  return sum;
}

function computeBlockCost(block) {
  const mode = block.dataset.costMode || 'detailed';
  if (mode === 'simple') {
    return parseFloat(block.querySelector('.menu-simple-cost').value) || 0;
  }
  if (mode === 'ai') {
    return computeAiRowsTotal(block);
  }
  let total = 0;
  block.querySelectorAll('.menu-rows > tr').forEach((tr) => {
    if (tr.querySelector('.m-include').checked) total += parseFloat(tr.dataset.price) || 0;
  });
  return total;
}

// Total Target Selling Price used to be summed from each row's own
// dataset.targetPrice, which only ever existed for detailed rows. One
// division does the same job for all three modes: every row shares
// the same Target Food Cost %, so total/pct% is identical to summing
// each row's own price/pct% would have been.
// Delivery commission/SST mark UP the target price rather than being
// deducted from it — these fees are the platform's and the tax
// authority's cut on top of what you list, not something that should
// come out of your own target. Gross up the listed price so that
// after fees are taken out, you still net your full target.
function updateMenuBlockSummary(block) {
  const total = computeBlockCost(block);
  const targetFoodCostPct = parsePercent(block.querySelector('.target-food-cost'), 30, 0.1);
  const totalTargetPrice = total / (targetFoodCostPct / 100);
  block.querySelector('.menu-total').textContent = formatRM(total);
  block.querySelector('.menu-total-target-price').textContent = formatRM(totalTargetPrice);
  // The AI table's own footer total stays live regardless of whether
  // AI is the active mode right now, same as Detailed's .menu-total
  // above already does — flip back to AI and the number's still right.
  const aiTotalEl = block.querySelector('.menu-ai-total');
  if (aiTotalEl) aiTotalEl.textContent = formatRM(computeAiRowsTotal(block));

  const useDelivery = block.querySelector('.use-delivery-toggle').checked;
  const useSST = block.querySelector('.use-sst-toggle').checked;
  const commissionPct = parsePercent(block.querySelector('.commission-pct'), 30, 0);
  const commissionTaxPct = parsePercent(block.querySelector('.commission-tax-pct'), 8, 0);
  const sstPct = parsePercent(block.querySelector('.sst-pct'), 6, 0);

  // Commission is charged on the LISTED price, and its own tax is
  // charged on the commission amount — so as a share of the listed
  // price, the commission side alone costs commissionPct * (1 + tax).
  const commissionShare = useDelivery ? (commissionPct / 100) * (1 + commissionTaxPct / 100) : 0;
  const sstShare = useSST ? sstPct / 100 : 0;
  const combinedShare = commissionShare + sstShare;

  const warningEl = block.querySelector('.fee-warning');
  let listedPrice;
  if (combinedShare >= 1) {
    // Fees alone would consume the entire listed price (or more) —
    // there's no price that recovers the target, so don't pretend
    // there is one.
    listedPrice = NaN;
    warningEl.hidden = false;
  } else {
    listedPrice = totalTargetPrice / (1 - combinedShare);
    warningEl.hidden = true;
  }

  const commissionAmount = useDelivery && isFinite(listedPrice) ? listedPrice * (commissionPct / 100) : 0;
  const commissionTaxAmount = useDelivery && isFinite(listedPrice) ? commissionAmount * (commissionTaxPct / 100) : 0;
  const sstAmount = useSST && isFinite(listedPrice) ? listedPrice * (sstPct / 100) : 0;
  const netAmount = isFinite(listedPrice) ? listedPrice - commissionAmount - commissionTaxAmount - sstAmount : 0;

  block.querySelector('.listed-price').textContent = isFinite(listedPrice) ? formatRM(listedPrice) : '\u2014';
  block.querySelector('.commission-amount').textContent = formatRM(commissionAmount);
  block.querySelector('.commission-tax-amount').textContent = formatRM(commissionTaxAmount);
  block.querySelector('.sst-amount').textContent = formatRM(sstAmount);
  block.querySelector('.net-amount').textContent = formatRM(netAmount);

  // Sync to whoever's listening (Cost Analysis, Margin Audit) — every
  // block broadcasts its own updates now, tagged with its own stable
  // blockId, so a receiver can tell "this dish changed again" apart
  // from "this is a new dish" instead of only ever hearing about one
  // menu item. See MULTI_MENU_SYNC_PLAN.md for the receiving side.
  if (typeof rzBroadcast === 'function') {
    const name = block.querySelector('.menu-name-input').value.trim() || 'Untitled Menu Item';
    rzBroadcast({ blockId: block.dataset.blockId, costPerPortion: total, sellingPrice: isFinite(listedPrice) ? listedPrice : undefined, dishName: name });
  }
}

/* ================= COST-MODE TABS =================
   Two levels: the outer Manual/AI estimate tabs, and — only while
   Manual is active — the inner Detailed/Simple sub-tabs. block.dataset
   .costMode is the one thing computeBlockCost actually reads; these
   two functions exist to keep that value and the visible panels in
   sync with each other and with which buttons look pressed. */

function setCostTab(block, tab) {
  block.querySelectorAll('.cost-mode-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.costTab === tab));
  block.querySelectorAll('[data-cost-panel]').forEach((p) => { p.hidden = p.dataset.costPanel !== tab; });
  if (tab === 'ai') {
    block.dataset.costMode = 'ai';
  } else {
    const activeSub = block.querySelector('.manual-sub-tab.is-active');
    block.dataset.costMode = activeSub ? activeSub.dataset.manualSub : 'detailed';
  }
  updateMenuBlockSummary(block);
}

function setManualSub(block, sub) {
  block.querySelectorAll('.manual-sub-tab').forEach((b) => b.classList.toggle('is-active', b.dataset.manualSub === sub));
  block.querySelectorAll('[data-manual-panel]').forEach((p) => { p.hidden = p.dataset.manualPanel !== sub; });
  block.dataset.costMode = sub;
  updateMenuBlockSummary(block);
}

/* ================= AI ESTIMATE =================
   Describe the dish and/or attach a photo, send it to a Cloudflare
   Worker holding the real Gemini key (see menu-calculator-proxy-
   worker.js), and render whatever ingredient breakdown comes back as
   fully editable rows — same checkbox-to-include, editable name/
   amount/price, and delete button as the Detailed table, feeding the
   same computeBlockCost('ai') path as any other mode. Review, correct,
   or drop a line Gemini got wrong before it counts toward your price.
   Deliberately does NOT touch the shared Ingredient Costing table up
   top: these are Gemini's best guess for this one dish, not verified
   purchase prices, so they stay local to this block rather than
   quietly becoming "real" ingredient data other menu items could pull
   into their own Detailed breakdown. */

function resizeImageToBase64(file, maxEdge) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not read that image'));
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleMenuAiPhoto(block, file) {
  if (!file) return;
  const nameEl = block.querySelector('.menu-ai-photo-name');
  try {
    const base64 = await resizeImageToBase64(file, MENU_AI_MAX_IMAGE_EDGE);
    block.dataset.aiPhotoBase64 = base64;
    nameEl.hidden = false;
    nameEl.textContent = '\u2713 Photo attached: ' + file.name;
  } catch (e) {
    nameEl.hidden = false;
    nameEl.textContent = 'Could not read that photo \u2014 try a different file.';
  }
}

function createMenuAiRow(block, ingredient) {
  const tbody = block.querySelector('.menu-ai-rows');
  const tr = document.createElement('tr');

  const includeTd = document.createElement('td');
  const includeInput = document.createElement('input');
  includeInput.type = 'checkbox';
  includeInput.className = 'm-include';
  includeInput.checked = true;
  includeInput.setAttribute('aria-label', 'Include in total');
  includeTd.appendChild(includeInput);

  const nameTd = document.createElement('td');
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'ai-name';
  nameInput.value = ingredient.name || '';
  nameTd.appendChild(nameInput);

  const qtyTd = document.createElement('td');
  const qtyInput = document.createElement('input');
  qtyInput.type = 'text';
  qtyInput.className = 'ai-quantity';
  qtyInput.value = ingredient.quantity || '';
  qtyTd.appendChild(qtyInput);

  const priceTd = document.createElement('td');
  priceTd.className = 'auto-col';
  const priceInput = document.createElement('input');
  priceInput.type = 'number';
  priceInput.className = 'ai-price';
  priceInput.inputMode = 'decimal';
  priceInput.min = '0';
  priceInput.step = '0.01';
  priceInput.value = (Number(ingredient.price_myr) || 0).toFixed(2);
  priceTd.appendChild(priceInput);

  const removeTd = document.createElement('td');
  removeTd.className = 'no-print';
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'delete-row';
  removeBtn.setAttribute('aria-label', 'Remove this ingredient');
  removeBtn.innerHTML = '&times;';
  removeTd.appendChild(removeBtn);

  tr.append(includeTd, nameTd, qtyTd, priceTd, removeTd);
  tbody.appendChild(tr);

  const recalc = () => updateMenuBlockSummary(block);
  includeInput.addEventListener('change', () => {
    tr.classList.toggle('excluded', !includeInput.checked);
    recalc();
  });
  priceInput.addEventListener('input', recalc);
  removeBtn.addEventListener('click', () => { tr.remove(); recalc(); });
}

// AI estimate rows come back editable, not read-only — after Gemini's
// first guess you may want to fix an amount, correct a misidentified
// ingredient, drop a line that doesn't apply, or just adjust a price
// you know better than it does. Every row shares the Detailed table's
// own .m-include checkbox and .menu-table styling rather than a
// parallel style system, so "exclude this line" behaves identically
// (including the dimmed-row treatment) in both tables.
function renderMenuAiRows(block, ingredients) {
  const tbody = block.querySelector('.menu-ai-rows');
  tbody.innerHTML = '';
  ingredients.forEach((ing) => createMenuAiRow(block, ing));
  block.querySelector('.menu-ai-table').hidden = ingredients.length === 0;
  updateMenuBlockSummary(block);
}

async function estimateMenuBlockCost(block) {
  const statusEl = block.querySelector('.menu-ai-status');
  const description = block.querySelector('.menu-ai-description').value.trim();
  const photoBase64 = block.dataset.aiPhotoBase64;

  const showStatus = (text, isError) => {
    statusEl.hidden = false;
    statusEl.textContent = text;
    statusEl.classList.toggle('is-error', !!isError);
  };

  if (!description && !photoBase64) {
    showStatus('Describe the dish or attach a photo first.', true);
    return;
  }
  if (MENU_AI_PROXY_ENDPOINT.indexOf('PASTE_YOUR') === 0) {
    showStatus('AI estimate isn\u2019t connected yet \u2014 this needs a Cloudflare Worker URL pasted into MENU_AI_PROXY_ENDPOINT.', true);
    return;
  }

  showStatus('Estimating\u2026', false);
  const body = {};
  if (description) body.description = description;
  if (photoBase64) { body.image = photoBase64; body.mime_type = 'image/jpeg'; }

  try {
    const resp = await fetch(MENU_AI_PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    if (!resp.ok || data.error) {
      showStatus(data.error || 'Could not estimate right now. Try again.', true);
      return;
    }
    const ingredients = Array.isArray(data.ingredients) ? data.ingredients : [];
    renderMenuAiRows(block, ingredients);
    if (ingredients.length) {
      showStatus('\u2713 Estimated \u2014 review the amounts below before it feeds your price.', false);
    } else {
      showStatus('Could not identify ingredients from that \u2014 try adding more detail.', true);
    }
    updateMenuBlockSummary(block);
  } catch (e) {
    showStatus('Could not reach the estimator \u2014 check your connection and try again.', true);
  }
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

// Target Food Cost % feeds every row's Target Selling Price column,
// so a change there has to re-run every row, not just the totals.
function refreshMenuBlockRows(block) {
  block.querySelectorAll('.menu-rows > tr').forEach((tr) => updateMenuRow(tr));
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
  block.dataset.costMode = 'detailed';
  block.innerHTML = `
    <div class="menu-block-header">
      <input type="text" class="menu-name-input" name="menu-name" value="Untitled Menu Item" aria-label="Menu item name">
      <button type="button" class="remove-block-btn no-print" aria-label="Remove this menu">Remove menu</button>
    </div>

    <div class="cost-mode-tabs no-print" role="tablist" aria-label="How to work out this item's cost">
      <button type="button" class="btn btn-secondary cost-mode-tab is-active" data-cost-tab="manual">Manual</button>
      <button type="button" class="btn btn-secondary cost-mode-tab" data-cost-tab="ai">AI estimate</button>
    </div>

    <div class="cost-mode-panel" data-cost-panel="manual">
      <div class="manual-mode-box">
        <div class="manual-mode-label">Manual</div>
        <div class="manual-sub-tabs no-print">
          <button type="button" class="btn btn-secondary manual-sub-tab is-active" data-manual-sub="detailed">Detailed</button>
          <button type="button" class="btn btn-secondary manual-sub-tab" data-manual-sub="simple">Simple</button>
        </div>

        <div class="manual-sub-panel" data-manual-panel="detailed">
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
                  <th scope="col" class="sortable auto-col" data-sort="targetprice">Target Selling Price <span class="sort-indicator"></span></th>
                  <th scope="col" class="no-print"><span class="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody class="menu-rows"></tbody>
              <tfoot>
                <tr class="menu-total-row">
                  <td colspan="4"><strong>Total</strong> <span class="toggle-hint">(cost)</span></td>
                  <td class="calc menu-total">RM0.00</td>
                  <td class="calc menu-total-target-price" colspan="2"><strong>Total Target Selling Price</strong><br>RM0.00</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div class="calc-actions no-print">
            <button type="button" class="add-menu-row-btn btn btn-primary">+ Add item to menu</button>
          </div>
        </div>

        <div class="manual-sub-panel" data-manual-panel="simple" hidden>
          <label for="simple-cost-${n}">Cost per portion (RM)<span class="tooltip-icon" data-tooltip="For when you already worked out the cost elsewhere \u2014 type it in directly, no ingredient breakdown needed">?</span></label>
          <input type="number" id="simple-cost-${n}" class="menu-simple-cost" inputmode="decimal" min="0" step="0.01" value="0.00">
        </div>
      </div>
    </div>

    <div class="cost-mode-panel" data-cost-panel="ai" hidden>
      <label for="ai-desc-${n}">Describe the dish \u2014 main ingredients and rough portions</label>
      <textarea id="ai-desc-${n}" class="menu-ai-description" rows="3" placeholder="e.g. 200g rice, fried chicken thigh, sambal, egg, cucumber"></textarea>
      <div class="ai-actions no-print">
        <button type="button" class="menu-ai-photo-btn btn btn-secondary">Or snap a photo</button>
        <input type="file" accept="image/*" class="menu-ai-photo-input" hidden>
        <button type="button" class="menu-ai-estimate-btn btn btn-primary">Estimate cost</button>
      </div>
      <p class="menu-ai-photo-name" hidden></p>
      <p class="menu-ai-status" hidden></p>
      <div class="table-scroll">
        <table class="menu-table menu-ai-table" hidden>
          <thead>
            <tr>
              <th scope="col"><span class="sr-only">Include in total</span></th>
              <th scope="col">Ingredient</th>
              <th scope="col">Amount</th>
              <th scope="col" class="auto-col">Cost</th>
              <th scope="col" class="no-print"><span class="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody class="menu-ai-rows"></tbody>
          <tfoot>
            <tr class="menu-total-row">
              <td colspan="3"><strong>Total</strong></td>
              <td class="calc menu-ai-total">RM0.00</td>
              <td class="no-print"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <div class="pricing-panel">
      <div class="pricing-row">
        <label for="tfc-${n}">Target Food Cost %<span class="tooltip-icon" data-tooltip="As % of selling price — lower % means higher margin">?</span></label>
        <input type="number" id="tfc-${n}" class="target-food-cost" name="target-food-cost" inputmode="decimal" min="1" max="100" step="0.1" value="30">
        <span class="toggle-hint">drives the Target Selling Price column above</span>
      </div>

      <div class="platform-panel">
        <label class="toggle-row">
          <input type="checkbox" class="use-delivery-toggle" name="use-delivery">
          Sold via delivery app <span class="tooltip-icon" data-tooltip="Platform takes commission; you also pay tax on that commission">?</span>
        </label>
        <div class="platform-fields" hidden>
          <label>Commission % <input type="number" class="commission-pct" name="commission-pct" inputmode="decimal" min="0" max="100" step="0.1" value="30"></label>
          <label>Tax on commission % <input type="number" class="commission-tax-pct" name="commission-tax-pct" inputmode="decimal" min="0" max="100" step="0.1" value="8"></label>
        </div>

        <label class="toggle-row">
          <input type="checkbox" class="use-sst-toggle" name="use-sst">
          SST registered <span class="tooltip-icon" data-tooltip="Sales & Service Tax on the selling price">?</span>
        </label>
        <div class="sst-fields" hidden>
          <label>SST on food % <input type="number" class="sst-pct" name="sst-pct" inputmode="decimal" min="0" max="100" step="0.1" value="6"></label>
        </div>

        <p class="fee-warning" hidden>These rates add up to 100% or more of the listed price — there's no price that recovers your target. Lower the commission, tax, or SST rate.</p>

        <div class="net-summary">
          <div>Price to list <span class="listed-price">RM0.00</span></div>
          <div>&minus; Commission <span class="commission-amount">RM0.00</span></div>
          <div>&minus; Tax on commission <span class="commission-tax-amount">RM0.00</span></div>
          <div>&minus; SST <span class="sst-amount">RM0.00</span></div>
          <div class="net-received">= You keep <strong class="net-amount">RM0.00</strong></div>
        </div>
      </div>
    </div>
  `;
  container.appendChild(block);

  block.querySelectorAll('.cost-mode-tab').forEach((btn) => {
    btn.addEventListener('click', () => setCostTab(block, btn.dataset.costTab));
  });
  block.querySelectorAll('.manual-sub-tab').forEach((btn) => {
    btn.addEventListener('click', () => setManualSub(block, btn.dataset.manualSub));
  });
  block.querySelector('.menu-simple-cost').addEventListener('input', () => updateMenuBlockSummary(block));
  block.querySelector('.menu-ai-photo-btn').addEventListener('click', () => block.querySelector('.menu-ai-photo-input').click());
  block.querySelector('.menu-ai-photo-input').addEventListener('change', (e) => handleMenuAiPhoto(block, e.target.files[0]));
  block.querySelector('.menu-ai-estimate-btn').addEventListener('click', () => estimateMenuBlockCost(block));

  block.querySelector('.add-menu-row-btn').addEventListener('click', () => createMenuRow(block));
  block.querySelector('.remove-block-btn').addEventListener('click', () => {
    const wasActive = !block.hidden;
    block.remove();
    if (wasActive) {
      const remaining = document.querySelector('.menu-block');
      if (remaining) switchToMenuBlock(remaining.dataset.blockId);
    } else {
      renderMenuTabs();
    }
  });
  block.querySelector('.target-food-cost').addEventListener('input', () => refreshMenuBlockRows(block));
  block.querySelector('.menu-name-input').addEventListener('input', () => {
    updateMenuBlockSummary(block);
    renderMenuTabs();
  });
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
    block.querySelector('.menu-table thead'),
    block.querySelector('.menu-rows'),
    menuSortValue,
    () => updateMenuBlockSummary(block)
  );

  createMenuRow(block);
  updateMenuBlockSummary(block);
  switchToMenuBlock(block.dataset.blockId);
}

// Only the active menu's full card is shown at a time; the tab row
// beside "+ Add Menu" (see .menu-tabs, styled in styles.css) lets you
// switch which one that is. Same "hide siblings, show one" pattern as
// Food Worth's dish tabs and Printing Calculator's job tabs, just
// styled as buttons here rather than an underlined tab strip.
function switchToMenuBlock(blockId) {
  document.querySelectorAll('.menu-block').forEach((b) => {
    b.hidden = (b.dataset.blockId !== blockId);
  });
  renderMenuTabs();
}

// Tabs only appear once there's something to switch between — a
// single menu just shows its card directly, no tab row overhead.
function renderMenuTabs() {
  const blocks = Array.from(document.querySelectorAll('.menu-block'));
  const tabsContainer = document.getElementById('menu-tabs');
  if (!tabsContainer) return;

  if (blocks.length <= 1) {
    tabsContainer.innerHTML = '';
    if (blocks.length === 1) blocks[0].hidden = false;
    return;
  }

  tabsContainer.innerHTML = blocks.map((b) => {
    const name = b.querySelector('.menu-name-input').value.trim() || 'Untitled Menu Item';
    const isActive = !b.hidden;
    return `<button type="button" class="btn btn-secondary menu-tab-btn${isActive ? ' is-active' : ''}" data-block-id="${b.dataset.blockId}">${escapeHTML(name)}</button>`;
  }).join('');

  tabsContainer.querySelectorAll('.menu-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchToMenuBlock(btn.dataset.blockId));
  });
}

/* ================= INIT ================= */

// Bump this string whenever this file changes — if something looks
// broken, checking this in the browser console (F12) instantly
// confirms whether the deployed JS actually matches the deployed
// HTML, rather than guessing from symptoms.
console.info('[Menu Calculator] script build: 2026-09-06-ai-rows-editable');

let rzInitialized = false;

function init() {
  if (rzInitialized) return;
  rzInitialized = true;
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
