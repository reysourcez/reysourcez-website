/* ============================================================
   Food Worth Calculator
   Vanilla JS, no dependencies. The photo goes to the Cloudflare
   Worker proxy (food-worth-proxy-worker.js) — never straight to
   Gemini, and never with a key visible in this file.
   ------------------------------------------------------------
   DATA MODEL (v4): a session is one or more "dishes". Each dish is
   its own self-contained unit — own photo, own upload zone, own
   editable item table, own subtotal — exactly the same repeatable-
   block pattern menu-calculator.js already uses for .menu-block
   (create*, scope every lookup to that instance via
   panel.querySelector(), never a page-wide id). A dish panel is
   just a .menu-block wearing a different hat.

   Single food item mode: exactly one dish, tabs never appear.
   Meal mode: "+ Add another dish" is offered once the active dish
   has results; 2+ dishes render as tabs automatically. The mode
   dropdown doesn't change how any one photo is analyzed — Gemini
   already returns multiple items from one photo just fine, e.g. a
   full plate. It only gates whether you can add MORE photos.

   Meal totals = sum of every INCLUDED item across every dish. Price,
   benchmark, rating, and the macro bar are meal-level, not per-dish
   — computeTotals / computeValueRating / computeMacroMix are the
   same pure functions as before, just fed a summed-across-dishes
   totals object instead of one dish's.

   FUTURE (KIV, architected for but not built):
     - Micro-nutrients (vitamins, minerals): add fields to the item
       schema in food-worth-proxy-worker.js + new columns here. The
       dish -> meal summation loop just needs those keys added to
       its accumulator; nothing about the dish/tab structure changes.
     - Guideline comparison (US/Malaysian, % of RDA): a new module
       that reads mealTotals (once it carries micro-nutrients) and a
       chosen guideline dataset — doesn't touch the dish model at all.
     - Rating v2: computeValueRating() already isolates the rating
       formula in one pure function; folding in guideline-adherence
       later is an extension of that function's inputs, not a rewrite.
   ============================================================ */

console.info('[Food Worth Calculator] script build: 2026-08-29-v4-meal-mode');

/* ================= CONFIG ================= */

const MAX_IMAGE_EDGE = 1024; // px — resized client-side before it's ever sent
const PROXY_ENDPOINT = 'https://food-worth-proxy.reysourcez-ent.workers.dev';

const MAX_ANALYSES_PER_DAY = 20;
const USAGE_STORAGE_KEY = 'fw-usage';

// Same set the Worker's schema asks Gemini for — dish-level, not
// per-item (see food-worth-proxy-worker.js for why). Label + unit
// live here once, used for both the fallback shape and rendering,
// so adding a nutrient later is a one-line change in this list.
const MICRONUTRIENT_FIELDS = [
  { key: 'vitamin_a_mcg', label: 'Vitamin A', unit: 'mcg' },
  { key: 'vitamin_c_mg', label: 'Vitamin C', unit: 'mg' },
  { key: 'vitamin_d_mcg', label: 'Vitamin D', unit: 'mcg' },
  { key: 'vitamin_b12_mcg', label: 'Vitamin B12', unit: 'mcg' },
  { key: 'calcium_mg', label: 'Calcium', unit: 'mg' },
  { key: 'iron_mg', label: 'Iron', unit: 'mg' },
  { key: 'potassium_mg', label: 'Potassium', unit: 'mg' },
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg' },
  { key: 'magnesium_mg', label: 'Magnesium', unit: 'mg' },
  { key: 'zinc_mg', label: 'Zinc', unit: 'mg' },
];
const EMPTY_MICRONUTRIENTS = Object.fromEntries(MICRONUTRIENT_FIELDS.map((f) => [f.key, 0]));

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

function num(el, fallback) {
  const v = parseFloat(el.value);
  return isFinite(v) ? v : (fallback !== undefined ? fallback : 0);
}

function numOrZero(v) {
  return isFinite(v) ? v : 0;
}

function setStatus(el, text, isError) {
  el.textContent = text;
  el.classList.toggle('is-error', !!isError);
}

/* ================= SOFT USAGE CAP ================= */

function getUsageToday() {
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_STORAGE_KEY) || 'null');
    if (!raw || raw.day !== new Date().toDateString()) return 0;
    return raw.count;
  } catch (e) { return 0; }
}

function recordUsage() {
  try {
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify({
      day: new Date().toDateString(),
      count: getUsageToday() + 1,
    }));
  } catch (e) {}
}

/* ================= IMAGE HANDLING ================= */

function resizeImageToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error("That file doesn't look like an image."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't open that image. Try a different file."));
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) {
          const scale = MAX_IMAGE_EDGE / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        resolve({ base64: dataUrl.split(',')[1], previewUrl: dataUrl });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ================= PROXY CALL ================= */

async function analyzePhoto(base64Image) {
  let response;
  try {
    response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image, mime_type: 'image/jpeg' }),
    });
  } catch (e) {
    throw new Error('Could not reach the analysis service \u2014 check PROXY_ENDPOINT is correct and that this page\u2019s URL is in the Worker\u2019s ALLOWED_ORIGINS.');
  }

  let data;
  try { data = await response.json(); }
  catch (e) { throw new Error('Got an unreadable response from the analysis service. Try again.'); }

  if (!response.ok) {
    throw new Error(data.error || ('Analysis failed (error ' + response.status + '). Try again.'));
  }
  return {
    items: Array.isArray(data.items) ? data.items : [],
    micronutrients: (data.micronutrients && typeof data.micronutrients === 'object') ? data.micronutrients : EMPTY_MICRONUTRIENTS,
  };
}

/* ================= MODEL: item rows (scoped to one dish panel) ================= */

let itemRowIdCounter = 0;

function getItemRowValues(tr) {
  return {
    included: tr.querySelector('.fw-include').checked,
    name: tr.querySelector('.fw-name').value.trim() || 'Unnamed item',
    weight: num(tr.querySelector('.fw-weight')),
    calories: num(tr.querySelector('.fw-calories')),
    protein: num(tr.querySelector('.fw-protein')),
    carbs: num(tr.querySelector('.fw-carbs')),
    fat: num(tr.querySelector('.fw-fat')),
    fiber: num(tr.querySelector('.fw-fiber')),
  };
}

function createItemRow(panel, item) {
  itemRowIdCounter++;
  const it = item || {};
  const tbody = panel.querySelector('.fw-item-rows');
  const tr = document.createElement('tr');
  tr.dataset.rowId = 'fw-item-' + itemRowIdCounter;
  tr.innerHTML = `
    <td><input type="checkbox" class="fw-include" checked aria-label="Include in total"></td>
    <td><input type="text" class="fw-name" value="${escapeHTML(it.name || '')}"></td>
    <td><input type="number" class="fw-weight" min="0" step="1" value="${numOrZero(it.weight_g)}"></td>
    <td><input type="number" class="fw-calories" min="0" step="1" value="${numOrZero(it.calories)}"></td>
    <td><input type="number" class="fw-protein" min="0" step="0.1" value="${numOrZero(it.protein_g)}"></td>
    <td><input type="number" class="fw-carbs" min="0" step="0.1" value="${numOrZero(it.carbs_g)}"></td>
    <td><input type="number" class="fw-fat" min="0" step="0.1" value="${numOrZero(it.fat_g)}"></td>
    <td><input type="number" class="fw-fiber" min="0" step="0.1" value="${numOrZero(it.fiber_g)}"></td>
    <td class="fw-note-cell"><input type="text" class="fw-note" value="${escapeHTML(it.note || '')}"></td>
    <td class="no-print"><button type="button" class="delete-row" aria-label="Remove this item">&times;</button></td>
  `;
  tbody.appendChild(tr);

  tr.querySelectorAll('input').forEach((el) => el.addEventListener('input', () => {
    recalculateDish(panel);
    recalculateMeal();
  }));
  tr.querySelector('.delete-row').addEventListener('click', () => {
    tr.remove();
    recalculateDish(panel);
    recalculateMeal();
  });
}

/* ================= MODEL: pure calculations (dish-agnostic, unchanged shape) ================= */

function computeTotals(rows) {
  const t = { weight: 0, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  rows.forEach((r) => {
    if (!r.included) return;
    t.weight += r.weight;
    t.calories += r.calories;
    t.protein += r.protein;
    t.carbs += r.carbs;
    t.fat += r.fat;
    t.fiber += r.fiber;
  });
  return t;
}

function computeValueRating(totals, price, benchmarkPer100kcal) {
  if (!(price > 0) || !(totals.calories > 0)) {
    return { costPer100kcal: 0, costPer100g: 0, label: null };
  }
  const costPer100kcal = (price / totals.calories) * 100;
  const costPer100g = totals.weight > 0 ? (price / totals.weight) * 100 : 0;
  const ratio = benchmarkPer100kcal > 0 ? costPer100kcal / benchmarkPer100kcal : 1;
  let label;
  if (ratio <= 0.85) label = 'Great value';
  else if (ratio <= 1.25) label = 'Fair value';
  else label = 'Pricey';
  return { costPer100kcal, costPer100g, label };
}

function computeMacroMix(totals) {
  const proteinKcal = totals.protein * 4;
  const carbsKcal = totals.carbs * 4;
  const fatKcal = totals.fat * 9;
  const sum = proteinKcal + carbsKcal + fatKcal;
  if (sum <= 0) return { protein: 0, carbs: 0, fat: 0 };
  return {
    protein: (proteinKcal / sum) * 100,
    carbs: (carbsKcal / sum) * 100,
    fat: (fatKcal / sum) * 100,
  };
}

/* ================= VIEW: meal-level render functions ================= */

function renderTotals(totals) {
  document.getElementById('fw-total-weight').textContent = Math.round(totals.weight).toLocaleString() + ' g';
  document.getElementById('fw-total-calories').textContent = Math.round(totals.calories).toLocaleString() + ' kcal';
}

function renderRating(rating) {
  document.getElementById('fw-cost-per-kcal').textContent = formatRM(rating.costPer100kcal);
  document.getElementById('fw-cost-per-100g').textContent = formatRM(rating.costPer100g);
  const badge = document.getElementById('fw-rating-badge');
  const card = document.getElementById('fw-rating-card');
  if (!rating.label) {
    badge.textContent = 'Add a price above';
    card.classList.remove('is-loss');
  } else {
    badge.textContent = rating.label;
    card.classList.toggle('is-loss', rating.label === 'Pricey');
  }
}

function renderMacroBar(mix) {
  const segs = [
    { key: 'protein', name: 'Protein', pct: mix.protein },
    { key: 'carbs', name: 'Carbs', pct: mix.carbs },
    { key: 'fat', name: 'Fat', pct: mix.fat },
  ];
  const html = segs.map((s) => {
    let inner = '';
    if (s.pct >= 15) inner = `${Math.round(s.pct)}% ${s.name}`;
    else if (s.pct >= 6) inner = `${Math.round(s.pct)}%`;
    return `<span class="seg fw-seg-${s.key}" style="width:${Math.max(0, s.pct)}%" title="${s.name} ${s.pct.toFixed(0)}%">${inner ? `<span class="seg-label">${inner}</span>` : ''}</span>`;
  }).join('');
  document.getElementById('fw-macro-bar').innerHTML = html;
}

function renderMacroFiberNote(totals) {
  const el = document.getElementById('fw-macro-fiber-note');
  el.textContent = totals.fiber > 0
    ? `Includes ${totals.fiber.toFixed(1)} g fiber (already counted within carbs above).`
    : '';
}

function formatMicroValue(v) {
  if (!isFinite(v) || v <= 0) return '0';
  return v >= 100 ? Math.round(v).toLocaleString() : v.toFixed(1);
}

function renderMicronutrients(mealMicros) {
  const el = document.getElementById('fw-micronutrients');
  el.innerHTML = MICRONUTRIENT_FIELDS.map((f) =>
    `<div><span>${f.label}</span><span>${formatMicroValue(mealMicros[f.key])} ${f.unit}</span></div>`
  ).join('');
}

/* ================= CONTROLLER: per-dish ================= */

function recalculateDish(panel) {
  const rows = Array.from(panel.querySelectorAll('.fw-item-rows > tr')).map(getItemRowValues);
  const totals = computeTotals(rows);
  const subtotalEl = panel.querySelector('.fw-dish-subtotal');
  if (subtotalEl) {
    subtotalEl.textContent = rows.length
      ? `Dish total: ${Math.round(totals.weight).toLocaleString()} g, ${Math.round(totals.calories).toLocaleString()} kcal`
      : '';
  }
}

function getDishTotals(panel) {
  const rows = Array.from(panel.querySelectorAll('.fw-item-rows > tr')).map(getItemRowValues);
  return computeTotals(rows);
}

async function handleFileSelect(e, panel) {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = panel.querySelector('.fw-status');
  setStatus(statusEl, 'Preparing photo\u2026');
  try {
    const { base64, previewUrl } = await resizeImageToBase64(file);
    dishImageData.set(panel, base64);
    const img = panel.querySelector('.fw-preview-img');
    img.src = previewUrl;
    img.hidden = false;
    panel.querySelector('.fw-upload-zone').classList.add('has-image');
    panel.querySelector('.fw-analyze-btn').disabled = false;
    setStatus(statusEl, 'Photo ready \u2014 click Analyze photo when you\u2019re set.');
  } catch (err) {
    setStatus(statusEl, err.message || 'Could not read that photo.', true);
  }
}

async function runAnalysis(panel) {
  const statusEl = panel.querySelector('.fw-status');

  if (!PROXY_ENDPOINT || PROXY_ENDPOINT === 'PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE') {
    setStatus(statusEl, 'This tool needs its proxy URL set \u2014 see PROXY_ENDPOINT near the top of food-worth-calculator.js.', true);
    return;
  }
  const base64 = dishImageData.get(panel);
  if (!base64) {
    setStatus(statusEl, 'Add a photo first.', true);
    return;
  }
  if (getUsageToday() >= MAX_ANALYSES_PER_DAY) {
    setStatus(statusEl, 'This browser has hit today\u2019s analysis limit. Try again tomorrow.', true);
    return;
  }

  const btn = panel.querySelector('.fw-analyze-btn');
  btn.disabled = true;
  setStatus(statusEl, 'Looking at your photo\u2026');

  try {
    const result = await analyzePhoto(base64);
    recordUsage();
    dishMicronutrients.set(panel, result.micronutrients);
    panel.querySelector('.fw-item-rows').innerHTML = '';
    if (result.items.length === 0) {
      setStatus(statusEl, 'Didn\u2019t spot any food in that photo \u2014 try a clearer, closer shot.', true);
    } else {
      result.items.forEach((it) => createItemRow(panel, it));
      panel.querySelector('.fw-dish-results').hidden = false;
      document.getElementById('fw-meal-section').hidden = false;
      recalculateDish(panel);
      recalculateMeal();
      updateAddDishVisibility();
      setStatus(statusEl, `Found ${result.items.length} item${result.items.length === 1 ? '' : 's'}. Edit anything you know better below.`);
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    setStatus(statusEl, err.message || 'Something went wrong. Try again.', true);
  } finally {
    btn.disabled = false;
  }
}

/* ================= CONTROLLER: meal-level (sums every dish) ================= */

function recalculateMeal() {
  const panels = Array.from(document.querySelectorAll('.fw-dish-panel'));
  const mealTotals = { weight: 0, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const mealMicros = { ...EMPTY_MICRONUTRIENTS };
  panels.forEach((panel) => {
    if (panel.dataset.included === 'false') return; // excluded via its tab checkbox
    const dishTotals = getDishTotals(panel);
    mealTotals.weight += dishTotals.weight;
    mealTotals.calories += dishTotals.calories;
    mealTotals.protein += dishTotals.protein;
    mealTotals.carbs += dishTotals.carbs;
    mealTotals.fat += dishTotals.fat;
    mealTotals.fiber += dishTotals.fiber;

    const micros = dishMicronutrients.get(panel) || EMPTY_MICRONUTRIENTS;
    MICRONUTRIENT_FIELDS.forEach((f) => { mealMicros[f.key] += numOrZero(micros[f.key]); });
  });

  const price = num(document.getElementById('fw-price'));
  const benchmark = num(document.getElementById('fw-benchmark'), 1);
  const rating = computeValueRating(mealTotals, price, benchmark);
  const mix = computeMacroMix(mealTotals);

  renderTotals(mealTotals);
  renderRating(rating);
  renderMacroBar(mix);
  renderMacroFiberNote(mealTotals);
  renderMicronutrients(mealMicros);
}

/* ================= CONTROLLER: dish panels, tabs, mode ================= */

// Base64 image data per dish, keyed by panel element rather than a
// dataset string — WeakMap so a removed dish's image data is
// garbage-collected instead of leaking.
const dishImageData = new WeakMap();
const dishMicronutrients = new WeakMap();

let dishIdCounter = 0;

function createDishPanel() {
  dishIdCounter++;
  const id = 'dish-' + dishIdCounter;
  const label = 'Dish ' + dishIdCounter;

  const panel = document.createElement('div');
  panel.className = 'fw-dish-panel menu-block';
  panel.dataset.dishId = id;
  panel.innerHTML = `
    <div class="menu-block-header">
      <input type="text" class="menu-name-input fw-dish-name" value="${escapeHTML(label)}" aria-label="Dish name">
      <button type="button" class="remove-block-btn fw-remove-dish no-print" aria-label="Remove this dish" hidden>Remove dish</button>
    </div>

    <div class="fw-upload-zone">
      <img class="fw-preview-img" alt="" hidden>
      <div class="fw-upload-row">
        <label class="btn btn-secondary" style="cursor:pointer;">Choose or take a photo<input type="file" accept="image/*" class="sr-only fw-photo-input"></label>
        <button type="button" class="btn btn-primary fw-analyze-btn" disabled>Analyze photo</button>
      </div>
    </div>
    <p class="fw-status" role="status" aria-live="polite"></p>

    <div class="fw-dish-results" hidden>
      <div class="table-scroll">
        <table class="menu-table fw-items-table">
          <caption class="sr-only">Detected food items with estimated weight, calories, and nutrition per item</caption>
          <thead>
            <tr>
              <th scope="col"><span class="sr-only">Include in total</span></th>
              <th scope="col">Item</th>
              <th scope="col">Weight (g)</th>
              <th scope="col">Calories</th>
              <th scope="col">Protein (g)</th>
              <th scope="col">Carbs (g)</th>
              <th scope="col">Fat (g)</th>
              <th scope="col">Fiber (g)</th>
              <th scope="col">Note</th>
              <th scope="col" class="no-print"><span class="sr-only">Remove row</span></th>
            </tr>
          </thead>
          <tbody class="fw-item-rows"></tbody>
        </table>
      </div>
      <div class="calc-actions no-print">
        <button type="button" class="btn btn-secondary fw-add-item">+ Add item</button>
      </div>
      <p class="fw-dish-subtotal"></p>
    </div>
  `;
  document.getElementById('fw-dish-panels').appendChild(panel);
  panel.dataset.included = 'true';

  panel.querySelector('.fw-photo-input').addEventListener('change', (e) => handleFileSelect(e, panel));
  panel.querySelector('.fw-analyze-btn').addEventListener('click', () => runAnalysis(panel));
  panel.querySelector('.fw-add-item').addEventListener('click', () => {
    createItemRow(panel, {});
    recalculateDish(panel);
    recalculateMeal();
  });
  panel.querySelector('.fw-dish-name').addEventListener('input', renderDishTabs);
  panel.querySelector('.fw-remove-dish').addEventListener('click', () => {
    const wasActive = !panel.hidden;
    panel.remove();
    recalculateMeal();
    if (wasActive) {
      const remaining = document.querySelector('.fw-dish-panel');
      if (remaining) switchToDish(remaining.dataset.dishId);
    } else {
      renderDishTabs();
    }
    updateAddDishVisibility();
  });

  switchToDish(id);
  return panel;
}

function switchToDish(id) {
  document.querySelectorAll('.fw-dish-panel').forEach((p) => {
    p.hidden = (p.dataset.dishId !== id);
  });
  renderDishTabs();
  updateAddDishVisibility();
}

// Tabs only appear once there's something to switch between — a
// single dish just shows its panel directly, no tab bar overhead.
// Each tab also carries its own include checkbox so a whole dish can
// be dropped from the meal total without hunting through its items.
// The checked state is stored on the PANEL (panel.dataset.included),
// not the tab button — the tab bar's innerHTML gets fully rebuilt
// every render, so anything living only in that markup would reset
// itself the next time you switched dishes or renamed one.
function renderDishTabs() {
  const panels = Array.from(document.querySelectorAll('.fw-dish-panel'));
  const tabsContainer = document.getElementById('fw-dish-tabs');

  panels.forEach((p) => {
    const removeBtn = p.querySelector('.fw-remove-dish');
    if (removeBtn) removeBtn.hidden = panels.length <= 1;
  });

  if (panels.length <= 1) {
    tabsContainer.hidden = true;
    tabsContainer.innerHTML = '';
    if (panels.length === 1) panels[0].hidden = false;
    return;
  }

  tabsContainer.hidden = false;
  tabsContainer.innerHTML = panels.map((p) => {
    const name = p.querySelector('.fw-dish-name').value.trim() || 'Dish';
    const isActive = !p.hidden;
    const isIncluded = p.dataset.included !== 'false';
    return `<span class="fw-tab-item${isIncluded ? '' : ' is-excluded'}">
      <input type="checkbox" class="fw-dish-include" data-dish-id="${p.dataset.dishId}" ${isIncluded ? 'checked' : ''} aria-label="Include ${escapeHTML(name)} in total">
      <button type="button" class="fw-tab-btn${isActive ? ' is-active' : ''}" data-dish-id="${p.dataset.dishId}">${escapeHTML(name)}</button>
    </span>`;
  }).join('');

  tabsContainer.querySelectorAll('.fw-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchToDish(btn.dataset.dishId));
  });
  tabsContainer.querySelectorAll('.fw-dish-include').forEach((cb) => {
    cb.addEventListener('change', () => {
      const panel = document.querySelector(`.fw-dish-panel[data-dish-id="${cb.dataset.dishId}"]`);
      if (panel) panel.dataset.included = cb.checked ? 'true' : 'false';
      renderDishTabs();
      recalculateMeal();
    });
  });
}

// "+ Add another dish" only makes sense once the currently active
// dish actually has results — otherwise you'd be offering to add a
// second empty, unanalyzed dish next to the first one.
function updateAddDishVisibility() {
  const activePanel = document.querySelector('.fw-dish-panel:not([hidden])');
  const activeHasResults = !!(activePanel && !activePanel.querySelector('.fw-dish-results').hidden);
  document.getElementById('fw-add-dish').hidden = !activeHasResults;
}

/* ================= INIT ================= */

let rzInitialized = false;

function init() {
  if (rzInitialized) return;
  rzInitialized = true;

  try {
    document.getElementById('fw-add-dish').addEventListener('click', () => createDishPanel());
    document.getElementById('fw-price').addEventListener('input', recalculateMeal);
    document.getElementById('fw-benchmark').addEventListener('input', recalculateMeal);
    createDishPanel(); // every session starts with one dish, single or meal mode alike
    console.log('[Food Worth] init complete, all listeners attached');
  } catch (err) {
    console.error('[Food Worth Calculator] setup failed:', err);
    const status = document.querySelector('.fw-status');
    if (status) {
      status.textContent = 'This page failed to set up correctly (' + err.message + '). Open the browser console (F12) for details.';
      status.classList.add('is-error');
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
