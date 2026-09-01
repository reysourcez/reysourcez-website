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

   Micronutrients and typical market price follow the same dish ->
   WeakMap -> meal-sum shape as everything else (dishMicronutrients,
   dishTypicalPrice), but neither is rendered as a bare number:
   micronutrients become "good source of" / "higher in" / "could use
   more" tags via a Daily Value / NRV threshold (computeNutrientCoverage()),
   and typical price renders as a low-high RM range (formatPriceRange())
   instead of one invented figure. Gemini's absolute estimate isn't
   precise enough to show at face value, but it's good enough to
   clear a threshold or bound a range.

   Two reference standards (USA / Malaysia) are switchable via
   activeStandard, affecting both the micronutrient thresholds
   (MICRONUTRIENT_FIELDS' dvUsa/dvMy) and the BMI bands (BMI_STANDARDS)
   — see the big comment above MICRONUTRIENT_FIELDS for why the two
   standards disagree and where each number came from. Nothing about
   which standard is picked is saved between visits.

   "How this fits your day" (getDailyNeed() / renderCalorieFit()) is
   deliberately independent of the standard toggle: BMR/TDEE (Mifflin-
   St Jeor) is a physiological formula, not a policy figure, so it
   doesn't change by country the way the nutrient/BMI bands do.

   FUTURE (KIV, architected for but not built):
     - Confirm current Malaysian NRV for Vitamin C/D against the
       gazetted Fifth A Schedule text directly, and for Potassium and
       Sodium if Malaysia ever publishes a distinct %NRV instead of
       flat mg thresholds for those two — dvMy is a single number per
       row, so this is a data fix, not a structural change.
     - Rating v2: computeValueRating() already isolates the rating
       formula in one pure function; folding in the typical-market-
       price range as a second signal is an extension of that
       function's inputs, not a rewrite.
     - Live market pricing (an actual price dataset/API) instead of
       Gemini's own estimate, if the estimate proves too rough in
       practice — dishTypicalPrice is already its own WeakMap, so
       swapping the source only touches runAnalysis().
   ============================================================ */

console.info('[Food Worth Calculator] script build: 2026-09-01-v7-pdf-summary-strip');

/* ================= CONFIG ================= */

const MAX_IMAGE_EDGE = 1024; // px — resized client-side before it's ever sent
const PROXY_ENDPOINT = 'https://food-worth-proxy.reysourcez-ent.workers.dev';

const MAX_ANALYSES_PER_DAY = 20;
const USAGE_STORAGE_KEY = 'fw-usage';

// Two parallel reference standards, switchable in the UI (see
// activeStandard below): the US FDA's Daily Values (21 CFR 101.9,
// 2016 update) and Malaysia's Nutrient Reference Values (Food
// Regulations 1985, Fifth A Schedule, as amended — effective 1 Jan
// 2024). Where Malaysia's gazetted NRV doesn't set a distinct %NRV
// figure for a nutrient (potassium and sodium are handled there as
// flat mg claim thresholds, not a %NRV table), dvMy falls back to
// the same internationally-common figure used for dvUsa. Vitamin
// C/D's dvMy are the last-confirmed pre-2024-amendment values —
// Malaysia's own amendment notice lists both as having increased
// but doesn't publish the replacement number anywhere this could
// verify, so it's worth checking against the current gazetted text
// if exact precision matters to you (see the settings table in
// FOOD_WORTH_CHANGE_NOTES.md for exactly which line to edit).
// `caution` flags sodium as a heads-up nutrient rather than a
// selling point; `lowHint`/`highHint` are the food-suggestion text
// for computeNutrientCoverage() — see further down.
const MICRONUTRIENT_FIELDS = [
  { key: 'vitamin_a_mcg', label: 'Vitamin A', unit: 'mcg', dvUsa: 900, dvMy: 800, lowHint: 'leafy greens, carrots, or orange sweet potato' },
  { key: 'vitamin_c_mg', label: 'Vitamin C', unit: 'mg', dvUsa: 90, dvMy: 60, lowHint: 'citrus fruit, guava, or bell pepper' },
  { key: 'vitamin_d_mcg', label: 'Vitamin D', unit: 'mcg', dvUsa: 20, dvMy: 5, lowHint: 'fatty fish, eggs, or a bit of sunlight' },
  { key: 'vitamin_b12_mcg', label: 'Vitamin B12', unit: 'mcg', dvUsa: 2.4, dvMy: 2.4, lowHint: 'fish, eggs, or dairy' },
  { key: 'calcium_mg', label: 'Calcium', unit: 'mg', dvUsa: 1300, dvMy: 1000, lowHint: 'dairy, tofu, or leafy greens' },
  { key: 'iron_mg', label: 'Iron', unit: 'mg', dvUsa: 18, dvMy: 14, lowHint: 'red meat, spinach, or lentils' },
  { key: 'potassium_mg', label: 'Potassium', unit: 'mg', dvUsa: 4700, dvMy: 4700, lowHint: 'bananas, potatoes, or leafy greens' },
  { key: 'sodium_mg', label: 'Sodium', unit: 'mg', dvUsa: 2300, dvMy: 2300, caution: true, highHint: 'ask for less salt, sauce, or seasoning next time' },
  { key: 'magnesium_mg', label: 'Magnesium', unit: 'mg', dvUsa: 420, dvMy: 300, lowHint: 'nuts, seeds, or whole grains' },
  { key: 'zinc_mg', label: 'Zinc', unit: 'mg', dvUsa: 11, dvMy: 15, lowHint: 'meat, shellfish, or legumes' },
];
const EMPTY_MICRONUTRIENTS = Object.fromEntries(MICRONUTRIENT_FIELDS.map((f) => [f.key, 0]));
const EMPTY_TYPICAL_PRICE = { low: 0, high: 0 };

// Fiber isn't part of the Worker's micronutrients object (it's
// already tracked per-item as fiber_g and summed into mealTotals.fiber
// — see computeTotals), but it's evaluated the same "coverage" way as
// everything above. Same figure under both standards: no distinct
// Malaysian %NRV for fiber was found, and 28g is itself a widely-used
// international reference point, not a US-only figure.
const FIBER_DV = 28;
const FIBER_LOW_HINT = 'vegetables, fruit, or whole grains';

const NUTRIENT_STANDARDS = {
  malaysia: { label: 'Malaysia (NRV)', shortLabel: 'Malaysia' },
  usa: { label: 'USA (FDA DV)', shortLabel: 'USA' },
};
// In-memory only, resets on reload — matches the site's "nothing
// persists" rule. Defaults to Malaysia since that's this site's
// actual audience; USA is one click away for anyone who wants it.
let activeStandard = 'malaysia';

// Standard TDEE activity multipliers against Mifflin-St Jeor BMR —
// the same multiplier set used by essentially every calorie
// calculator, not something that varies by country.
const ACTIVITY_LEVELS = [
  { value: 'sedentary', label: 'Sedentary \u2014 little or no exercise', multiplier: 1.2 },
  { value: 'light', label: 'Lightly active \u2014 1\u20133 days/week', multiplier: 1.375 },
  { value: 'active', label: 'Active \u2014 3\u20135 days/week', multiplier: 1.55 },
  { value: 'very-active', label: 'Very active \u2014 6\u20137 days/week', multiplier: 1.725 },
];

// Same "switchable standard" idea as the nutrient table above: the
// WHO's global BMI bands under-flag cardiometabolic risk in Asian
// populations at the same BMI, so Malaysia's MOH (and Singapore's)
// clinical obesity guidelines use lower overweight/obese cutoffs.
// Both standards agree below 18.5.
const BMI_STANDARDS = {
  malaysia: [
    { max: 18.5, label: 'Underweight' },
    { max: 23, label: 'Normal range' },
    { max: 27.5, label: 'Overweight / at risk' },
    { max: Infinity, label: 'Obese range' },
  ],
  usa: [
    { max: 18.5, label: 'Underweight' },
    { max: 25, label: 'Normal range' },
    { max: 30, label: 'Overweight' },
    { max: Infinity, label: 'Obese range' },
  ],
};

/* ================= SHARED UTILITIES ================= */

function formatRM(value) {
  if (!isFinite(value) || value < 0) return 'RM0.00';
  if (value > 0 && value < 0.01) return '< RM0.01';
  return 'RM' + value.toFixed(2);
}

// Renders a dish/meal's typical-price estimate as a range rather
// than a single figure — Gemini is estimating from one photo, so a
// low-high band is a more honest shape for that guess than a single
// invented number. Returns '' when there's nothing worth showing yet
// (no dish analyzed, or Gemini returned zeros).
function formatPriceRange(price) {
  if (!price || !(price.high > 0)) return '';
  if (price.low > 0 && price.low !== price.high) {
    return formatRM(price.low) + '\u2013' + formatRM(price.high);
  }
  return formatRM(price.high);
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
  const rawPrice = (data.typical_price_myr && typeof data.typical_price_myr === 'object') ? data.typical_price_myr : null;
  return {
    items: Array.isArray(data.items) ? data.items : [],
    micronutrients: (data.micronutrients && typeof data.micronutrients === 'object') ? data.micronutrients : EMPTY_MICRONUTRIENTS,
    typicalPrice: rawPrice ? { low: numOrZero(Number(rawPrice.low)), high: numOrZero(Number(rawPrice.high)) } : { ...EMPTY_TYPICAL_PRICE },
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

// Turns a %DV/%NRV figure into "did this clear a meaningful bar"
// rather than the raw estimate itself — Gemini's absolute mcg/mg
// guess for one photo is shaky, but whether that guess is in the
// same ballpark as a whole day's target is a coarser, more
// defensible claim. Mirrors the FDA's own nutrient-content-claim
// thresholds (21 CFR 101.54): >=10% for "good source", >=20% for
// "excellent"/"high in". <5% is treated as a genuine gap ("could use
// more"); 5\u20139.9% is a quiet middle ground, flagged neither way,
// since most single meals aren't expected to clear every nutrient.
function levelFromPct(pct) {
  if (pct >= 20) return 'high';
  if (pct >= 10) return 'some';
  if (pct < 5) return 'low';
  return 'mid';
}

function dvFor(field) {
  return activeStandard === 'usa' ? field.dvUsa : field.dvMy;
}

// The "what's this meal missing, and what would round it out"
// analysis: every non-caution nutrient below its DV/NRV reference
// gets bucketed as good/some/lacking; sodium (the one caution
// nutrient) only ever contributes to cautionFlags, never lackingFlags
// — a restaurant meal running low on sodium isn't a realistic thing
// to flag. Lacking nutrients are capped at the 3 most notably low
// (sorted by %DV ascending) so a normal meal doesn't get buried under
// every nutrient it didn't happen to cover.
function computeNutrientCoverage(mealMicros, mealTotals) {
  const goodSources = [];
  const cautionFlags = [];
  const lackingFlags = [];

  const evaluate = (label, value, dv, caution, lowHint, highHint) => {
    if (!(dv > 0)) return;
    const pct = (numOrZero(value) / dv) * 100;
    const level = levelFromPct(pct);
    if (caution) {
      if (level === 'high' || level === 'some') cautionFlags.push({ label, isHigh: level === 'high', hint: highHint });
      return;
    }
    if (level === 'high' || level === 'some') goodSources.push({ label, isHigh: level === 'high' });
    else if (level === 'low') lackingFlags.push({ label, hint: lowHint, pct });
  };

  MICRONUTRIENT_FIELDS.forEach((f) => evaluate(f.label, mealMicros[f.key], dvFor(f), f.caution, f.lowHint, f.highHint));
  evaluate('Fiber', mealTotals.fiber, FIBER_DV, false, FIBER_LOW_HINT);

  lackingFlags.sort((a, b) => a.pct - b.pct);
  return { goodSources, cautionFlags, lackingFlags: lackingFlags.slice(0, 3) };
}

// Mifflin-St Jeor — the modern standard BMR equation, generally
// considered more accurate across body types than the older
// Harris-Benedict formula it replaced. This formula itself doesn't
// vary by country, unlike the nutrient/BMI reference bands above.
function computeBMR(sex, weightKg, heightCm, age) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'female' ? base - 161 : base + 5;
}
function computeTDEE(bmr, multiplier) {
  return bmr * multiplier;
}
function computeBMI(weightKg, heightCm) {
  const heightM = heightCm / 100;
  return heightM > 0 ? weightKg / (heightM * heightM) : 0;
}
function bmiCategory(bmi) {
  const bands = BMI_STANDARDS[activeStandard] || BMI_STANDARDS.malaysia;
  return (bands.find((b) => bmi < b.max) || bands[bands.length - 1]).label;
}

// Deliberately plain, non-alarmist framing — a single meal being a
// big share of a day's calories is just a fact worth knowing, not a
// verdict. No streak-tracking, no "calories burned" exercise-offset
// math; this is one data point, not a running score.
function calorieShareLabel(pct) {
  if (pct < 30) return 'a light portion of your day';
  if (pct < 60) return 'a solid portion of your day';
  if (pct <= 100) return 'a big portion of your day';
  return 'more than a full day\u2019s calories';
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

function renderMarketPrice(price) {
  const el = document.getElementById('fw-market-price');
  el.textContent = formatPriceRange(price) || 'Analyze a dish to see this';
}

// Reads whichever calorie-need mode is active. Manual mode is just
// the typed figure; calculate mode runs Mifflin-St Jeor + a TDEE
// multiplier and also returns a BMI (0 when inputs are incomplete,
// which every caller treats as "nothing to show yet"). Called once
// per recalculateMeal() and the result shared with renderCalorieFit
// and renderSummaryStrip, rather than each reading the form itself.
function getDailyNeed() {
  const manualMode = document.querySelector('.fw-calorie-tab[data-mode="manual"]').classList.contains('is-active');
  if (manualMode) {
    const target = num(document.getElementById('fw-cal-manual-target'));
    return { dailyNeed: target > 0 ? target : 0, bmi: 0 };
  }
  const sex = document.getElementById('fw-cal-sex').value;
  const age = num(document.getElementById('fw-cal-age'));
  const height = num(document.getElementById('fw-cal-height'));
  const weight = num(document.getElementById('fw-cal-weight'));
  const activity = ACTIVITY_LEVELS.find((a) => a.value === document.getElementById('fw-cal-activity').value) || ACTIVITY_LEVELS[2];
  if (!(age > 0) || !(height > 0) || !(weight > 0)) return { dailyNeed: 0, bmi: 0 };
  const dailyNeed = computeTDEE(computeBMR(sex, weight, height, age), activity.multiplier);
  return { dailyNeed, bmi: computeBMI(weight, height) };
}

function renderCalorieFit(mealCalories, need) {
  const { dailyNeed, bmi } = need;
  const needEl = document.getElementById('fw-daily-need');
  const badge = document.getElementById('fw-calorie-share-badge');
  const card = document.getElementById('fw-calorie-share-card');
  const bmiNote = document.getElementById('fw-bmi-note');

  if (bmiNote) {
    bmiNote.textContent = bmi > 0
      ? `BMI ${bmi.toFixed(1)} (${NUTRIENT_STANDARDS[activeStandard].shortLabel} bands) \u2014 ${bmiCategory(bmi)}. A general screening figure, not a diagnosis; it doesn't account for muscle mass or individual differences.`
      : '';
  }

  if (!(dailyNeed > 0)) {
    needEl.textContent = '\u2014';
    badge.textContent = 'Fill in the fields above';
    card.classList.remove('is-loss');
    return;
  }
  needEl.textContent = Math.round(dailyNeed).toLocaleString() + ' kcal';
  if (!(mealCalories > 0)) {
    badge.textContent = 'Analyze a dish to compare';
    card.classList.remove('is-loss');
    return;
  }
  const pct = (mealCalories / dailyNeed) * 100;
  badge.textContent = `${Math.round(pct)}% of your day \u2014 ${calorieShareLabel(pct)}`;
  card.classList.toggle('is-loss', pct > 100);
}

// The "read this in five seconds" strip at the top of the results —
// value rating, calorie share, and the single most useful nutrient
// note (whichever's more actionable: the top gap if there is one,
// otherwise the top thing this meal already does well). Reuses the
// same rating/coverage/need objects recalculateMeal already computed
// once for the detailed sections below, rather than recomputing.
function renderSummaryStrip(rating, mealCalories, dailyNeed, coverage) {
  const el = document.getElementById('fw-summary-strip');
  if (!el) return;

  const calorieText = (dailyNeed > 0 && mealCalories > 0) ? Math.round((mealCalories / dailyNeed) * 100) + '%' : '\u2014';
  let noteLabel = 'nutrients';
  let noteText = '\u2014';
  if (coverage.lackingFlags.length) {
    noteText = coverage.lackingFlags[0].label;
    noteLabel = 'could use more';
  } else if (coverage.goodSources.length) {
    noteText = coverage.goodSources[0].label;
    noteLabel = 'good source of';
  }

  el.innerHTML = `
    <span class="fw-summary-item"><strong>${escapeHTML(rating.label || '\u2014')}</strong><small>value</small></span>
    <span class="fw-summary-item"><strong>${escapeHTML(calorieText)}</strong><small>of your day</small></span>
    <span class="fw-summary-item"><strong>${escapeHTML(noteText)}</strong><small>${escapeHTML(noteLabel)}</small></span>
  `;
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

function renderMicronutrients(coverage) {
  const el = document.getElementById('fw-micronutrients');
  const { goodSources, cautionFlags, lackingFlags } = coverage;

  const tagHTML = (item, extraClass) =>
    `<span class="fw-micro-tag${item.isHigh ? ' is-high' : ''}${extraClass ? ' ' + extraClass : ''}">${escapeHTML(item.label)}</span>`;
  const suggestionHTML = (item) =>
    `<li><strong>${escapeHTML(item.label)}</strong> \u2014 ${escapeHTML(item.hint)}</li>`;
  // Small sparkle mark for the "could use more" card — a plain geometric
  // shape (not an organic illustration) so it stays legible at 14px and
  // matches the site's otherwise-typographic visual language.
  const sparkleSVG = '<svg class="fw-micro-care-icon" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1L9.2 6.2 14 8 9.2 9.8 8 15 6.8 9.8 2 8 6.8 6.2Z"/></svg>';

  let html = '';
  if (goodSources.length) {
    html += `<div class="fw-micro-group"><span class="fw-micro-group-label">Good source of</span>`
      + `<div class="fw-micro-tags">${goodSources.map((i) => tagHTML(i)).join('')}</div></div>`;
  }
  if (cautionFlags.length) {
    html += `<div class="fw-micro-group"><span class="fw-micro-group-label">Higher in</span>`
      + `<div class="fw-micro-tags">${cautionFlags.map((i) => tagHTML(i, 'is-caution')).join('')}</div>`
      + `<ul class="fw-micro-suggestions">${cautionFlags.map(suggestionHTML).join('')}</ul></div>`;
  }
  if (lackingFlags.length) {
    html += `<div class="fw-micro-group fw-micro-care">`
      + `<span class="fw-micro-group-label">${sparkleSVG}Could use more</span>`
      + `<div class="fw-micro-tags">${lackingFlags.map((i) => tagHTML(i, 'is-care')).join('')}</div>`
      + `<ul class="fw-micro-suggestions">${lackingFlags.map(suggestionHTML).join('')}</ul></div>`;
  }
  el.innerHTML = html || '<p class="fw-micro-empty">Nothing stood out either way for this meal.</p>';
}

/* ================= CONTROLLER: per-dish ================= */

function recalculateDish(panel) {
  const rows = Array.from(panel.querySelectorAll('.fw-item-rows > tr')).map(getItemRowValues);
  const totals = computeTotals(rows);
  const subtotalEl = panel.querySelector('.fw-dish-subtotal');
  if (subtotalEl) {
    if (!rows.length) {
      subtotalEl.textContent = '';
    } else {
      const priceRange = formatPriceRange(dishTypicalPrice.get(panel));
      const priceText = priceRange ? ` \u00b7 Typical price ${priceRange}` : '';
      subtotalEl.textContent = `Dish total: ${Math.round(totals.weight).toLocaleString()} g, ${Math.round(totals.calories).toLocaleString()} kcal${priceText}`;
    }
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
    dishTypicalPrice.set(panel, result.typicalPrice);
    panel.querySelector('.fw-item-rows').innerHTML = '';
    if (result.items.length === 0) {
      setStatus(statusEl, 'Didn\u2019t spot any food in that photo \u2014 try a clearer, closer shot.', true);
    } else {
      result.items.forEach((it) => createItemRow(panel, it));
      panel.querySelector('.fw-dish-results').hidden = false;
      document.getElementById('fw-meal-section').hidden = false;
      document.getElementById('fw-calorie-section').hidden = false;
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
  const mealPrice = { low: 0, high: 0 };
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

    const dishPrice = dishTypicalPrice.get(panel) || EMPTY_TYPICAL_PRICE;
    mealPrice.low += numOrZero(dishPrice.low);
    mealPrice.high += numOrZero(dishPrice.high);
  });

  const price = num(document.getElementById('fw-price'));
  const benchmark = num(document.getElementById('fw-benchmark'), 1);
  const rating = computeValueRating(mealTotals, price, benchmark);
  const mix = computeMacroMix(mealTotals);
  const coverage = computeNutrientCoverage(mealMicros, mealTotals);
  const need = getDailyNeed();

  renderTotals(mealTotals);
  renderRating(rating);
  renderMarketPrice(mealPrice);
  renderMacroBar(mix);
  renderMacroFiberNote(mealTotals);
  renderMicronutrients(coverage);
  renderCalorieFit(mealTotals.calories, need);
  renderSummaryStrip(rating, mealTotals.calories, need.dailyNeed, coverage);
}

/* ================= CONTROLLER: dish panels, tabs, mode ================= */

// Base64 image data per dish, keyed by panel element rather than a
// dataset string — WeakMap so a removed dish's image data is
// garbage-collected instead of leaking.
const dishImageData = new WeakMap();
const dishMicronutrients = new WeakMap();
const dishTypicalPrice = new WeakMap();

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
      <div class="fw-upload-row no-print">
        <label class="btn btn-secondary" style="cursor:pointer;">Choose or take a photo<input type="file" accept="image/*" class="sr-only fw-photo-input"></label>
        <button type="button" class="btn btn-primary fw-analyze-btn" disabled>Analyze photo</button>
      </div>
    </div>
    <p class="fw-status no-print" role="status" aria-live="polite"></p>

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
    document.getElementById('fw-save-pdf').addEventListener('click', () => window.print());

    document.querySelectorAll('.fw-standard-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fw-standard-tab').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        activeStandard = btn.dataset.standard;
        recalculateMeal();
      });
    });

    document.querySelectorAll('.fw-calorie-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.fw-calorie-tab').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        document.getElementById('fw-calorie-calculate').hidden = btn.dataset.mode !== 'calculate';
        document.getElementById('fw-calorie-manual').hidden = btn.dataset.mode !== 'manual';
        recalculateMeal();
      });
    });

    ['fw-cal-sex', 'fw-cal-age', 'fw-cal-height', 'fw-cal-weight', 'fw-cal-activity', 'fw-cal-manual-target'].forEach((id) => {
      const el = document.getElementById(id);
      el.addEventListener('input', recalculateMeal);
      el.addEventListener('change', recalculateMeal);
    });

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
