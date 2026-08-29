/* ============================================================
   Food Worth Calculator
   Vanilla JS, no dependencies. The photo goes straight from this
   browser to Google — nothing routes through Reysourcez.
   ------------------------------------------------------------
   Same shape as menu-calculator.js / interactive-costing-analysis.js:
   1. MODEL   — plain data (item rows via data-row-id, same pattern
                as the ingredient table) + pure functions that take
                values in and return computed results, no DOM access:
                computeTotals(), computeValueRating(), computeMacroMix().
   2. VIEW    — render*() functions that only write the DOM.
   3. CONTROLLER — runAnalysis() (calls Gemini), recalculate()
                (re-reads current, possibly hand-edited values and
                re-renders), init() (wires events).

   KEY HANDLING — changed again from v2: the real Gemini key no
   longer lives here at all. GitHub's push protection correctly
   flagged v2's hardcoded key as a live credential about to be
   committed, which is the same exposure it always was, just caught
   a step earlier. The key now lives only in a small Cloudflare
   Worker (food-worth-proxy-worker.js, deployed separately, NOT part
   of this repo) as an encrypted secret. This file just POSTs the
   photo to that Worker and reads back { items } — it has no idea
   what model is used, what the prompt says, or what the key is.
   You must set PROXY_ENDPOINT below to your deployed Worker's URL
   before this works.

   TO EXTEND:
     - New nutrient column: add the <td><input> in createItemRow(),
       read it in getItemRowValues(), fold it into computeTotals().
     - Swap the Gemini model or edit the prompt/schema: all in
       food-worth-proxy-worker.js now, not here — nothing in this
       file knows what model is being called.
     - Cross-tab sync into costing-sync.js: still not wired up on
       purpose — this page answers "is this plate worth its price",
       the other three answer "what does this cost me to make".
   ============================================================ */

console.info('[Food Worth Calculator] script build: 2026-08-29-v3-proxy');

/* ================= CONFIG ================= */

const MAX_IMAGE_EDGE = 1024; // px — resized client-side before it's ever sent

// PASTE YOUR DEPLOYED CLOUDFLARE WORKER URL BELOW. See
// food-worth-proxy-worker.js for what it does and how to deploy it —
// short version: it holds the real Gemini key server-side so this
// file, and every visitor's browser, never sees it.
const PROXY_ENDPOINT = 'PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE'; // e.g. https://food-worth-proxy.yoursubdomain.workers.dev

// Soft, client-side cap so this stays polite even before any
// server-side limit exists. NOT real security — anyone can clear
// their own browser storage and reset it — just friction against an
// accidental loop or casual overuse. Resets daily per browser. Raise
// this (or delete the check in runAnalysis()) if it ever gets in a
// real visitor's way. A proper enforced limit would live in the
// Worker (e.g. a Cloudflare KV counter) — worth adding if this ever
// needs real teeth, not required to get this working today.
const MAX_ANALYSES_PER_DAY = 20;
const USAGE_STORAGE_KEY = 'fw-usage';

/* ================= SHARED UTILITIES (same patterns as the other pages) ================= */

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

/* ================= SOFT USAGE CAP ================= */

function getUsageToday() {
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_STORAGE_KEY) || 'null');
    if (!raw || raw.day !== new Date().toDateString()) return 0;
    return raw.count;
  } catch (e) { return 0; } // storage unavailable — cap just won't persist, not fatal
}

function recordUsage() {
  try {
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify({
      day: new Date().toDateString(),
      count: getUsageToday() + 1,
    }));
  } catch (e) {}
}

/* ================= IMAGE HANDLING =================
   Resized on a <canvas> before encoding so requests stay fast and
   token-light. Gemini accepts JPEG/PNG/WEBP/HEIC/HEIF directly, so
   an iPhone photo needs no format conversion, only this resize. */

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

/* ================= PROXY CALL =================
   Everything Gemini-specific (endpoint, model, prompt, schema,
   response parsing) now lives in food-worth-proxy-worker.js. This
   function just hands the proxy a photo and reads back items. */

async function analyzePhoto(base64Image) {
  const response = await fetch(PROXY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64Image, mime_type: 'image/jpeg' }),
  });

  let data;
  try { data = await response.json(); }
  catch (e) { throw new Error('Got an unreadable response from the analysis service. Try again.'); }

  if (!response.ok) {
    throw new Error(data.error || ('Analysis failed (error ' + response.status + '). Try again.'));
  }
  return Array.isArray(data.items) ? data.items : [];
}

/* ================= 1. MODEL: item rows ================= */

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

function createItemRow(item) {
  itemRowIdCounter++;
  const it = item || {};
  const tbody = document.getElementById('fw-item-rows');
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

  tr.querySelectorAll('input').forEach((el) => el.addEventListener('input', recalculate));
  tr.querySelector('.delete-row').addEventListener('click', () => { tr.remove(); recalculate(); });
}

function clearItemRows() {
  document.getElementById('fw-item-rows').innerHTML = '';
}

/* ================= 1. MODEL: pure calculations ================= */

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

// Ratio-based, not a hardcoded pass/fail: "benchmark" is whatever the
// person typed into "Your benchmark" above, so this compares against
// their own sense of fair value, not an assumed universal truth.
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

// Protein/carbs/fat only — fiber is already counted inside carbs_g
// (standard nutrition-label convention), so a fourth segment would
// double-count calories carbs already claimed. Fiber is surfaced
// separately as a reference figure instead (see renderMacroFiberNote).
// Percentages are normalized against their own sum rather than the
// item's stated "calories" field, since AI estimates aren't always
// perfectly self-consistent — this keeps the three segments always
// summing to exactly 100% of the bar.
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

/* ================= 2. VIEW: render functions ================= */

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

// Same segmented-bar markup as .structure-bar on the Costing Analysis
// page (title attr for a native hover tooltip, seg-label text once a
// segment is wide enough to hold it) — reused rather than reinvented.
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

function setStatus(text, isError) {
  const el = document.getElementById('fw-status');
  el.textContent = text;
  el.classList.toggle('is-error', !!isError);
}

/* ================= 3. CONTROLLER ================= */

function recalculate() {
  const rows = Array.from(document.querySelectorAll('#fw-item-rows > tr')).map(getItemRowValues);
  const totals = computeTotals(rows);
  const price = num(document.getElementById('fw-price'));
  const benchmark = num(document.getElementById('fw-benchmark'), 1);
  const rating = computeValueRating(totals, price, benchmark);
  const mix = computeMacroMix(totals);

  renderTotals(totals);
  renderRating(rating);
  renderMacroBar(mix);
  renderMacroFiberNote(totals);
}

let currentImageBase64 = null;

async function handleFileSelect(e) {
  console.log('[Food Worth] photo input changed, file count:', e.target.files.length);
  const file = e.target.files[0];
  if (!file) return;
  setStatus('Preparing photo\u2026');
  try {
    const { base64, previewUrl } = await resizeImageToBase64(file);
    currentImageBase64 = base64;
    const img = document.getElementById('fw-preview-img');
    img.src = previewUrl;
    img.hidden = false;
    document.getElementById('fw-upload-zone').classList.add('has-image');
    document.getElementById('fw-analyze-btn').disabled = false;
    setStatus('Photo ready \u2014 click Analyze photo when you\u2019re set.');
  } catch (err) {
    setStatus(err.message || 'Could not read that photo.', true);
  }
}

async function runAnalysis() {
  if (!PROXY_ENDPOINT || PROXY_ENDPOINT === 'PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE') {
    setStatus('This tool needs its proxy URL set \u2014 see PROXY_ENDPOINT near the top of food-worth-calculator.js.', true);
    return;
  }
  if (!currentImageBase64) {
    setStatus('Add a photo first.', true);
    return;
  }
  if (getUsageToday() >= MAX_ANALYSES_PER_DAY) {
    setStatus('This browser has hit today\u2019s analysis limit. Try again tomorrow.', true);
    return;
  }

  const btn = document.getElementById('fw-analyze-btn');
  btn.disabled = true;
  setStatus('Looking at your photo\u2026');

  try {
    const items = await analyzePhoto(currentImageBase64);
    recordUsage();
    clearItemRows();
    if (items.length === 0) {
      setStatus('Didn\u2019t spot any food in that photo \u2014 try a clearer, closer shot.', true);
    } else {
      items.forEach((it) => createItemRow(it));
      document.getElementById('fw-results').hidden = false;
      recalculate();
      setStatus(`Found ${items.length} item${items.length === 1 ? '' : 's'}. Edit anything you know better below.`);
      document.getElementById('fw-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    setStatus(err.message || 'Something went wrong. Try again.', true);
  } finally {
    btn.disabled = false;
  }
}

let rzInitialized = false;

function init() {
  if (rzInitialized) return;
  rzInitialized = true;

  // Wrapped deliberately: if any element below is missing (a typo, a
  // future HTML edit that renames something), this catches it and
  // says so on the page instead of every button silently doing
  // nothing with no clue why — that failure mode is exactly what a
  // "nothing works, no error shown" report usually turns out to be.
  try {
    document.getElementById('fw-photo-input').addEventListener('change', handleFileSelect);
    document.getElementById('fw-analyze-btn').addEventListener('click', runAnalysis);
    document.getElementById('fw-add-item').addEventListener('click', () => {
      createItemRow({});
      document.getElementById('fw-results').hidden = false;
      recalculate();
    });
    document.getElementById('fw-price').addEventListener('input', recalculate);
    document.getElementById('fw-benchmark').addEventListener('input', recalculate);
    console.log('[Food Worth] init complete, all listeners attached');
  } catch (err) {
    console.error('[Food Worth Calculator] setup failed:', err);
    const status = document.getElementById('fw-status');
    if (status) {
      status.textContent = 'This page failed to set up correctly (' + err.message + '). Open the browser console (F12) for details.';
      status.classList.add('is-error');
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
