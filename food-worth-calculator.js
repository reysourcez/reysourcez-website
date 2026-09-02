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

   Recipe breakdown (analyzeRecipe() / runRecipeBreakdown()) is a
   genuinely separate Gemini call, opt-in per dish via its own button
   — not folded into the main analyzePhoto() schema, because it's a
   different kind of task (general recipe/pricing knowledge, not
   photo-precision estimation) that most analyses will never touch,
   so it shouldn't cost every visitor extra latency/tokens by default.
   Its result (an ingredient cost) is stored in its own WeakMap
   (dishRecipeCost) and follows the exact same dish -> sum -> render
   shape as typical price. computeImpliedFairPrice() grosses that sum
   up via the F&B industry's ~30% ingredient-cost-structure benchmark
   — cost \u00f7 target, not cost \u00d7 markup — deliberately never
   merged into computeValueRating()'s own rating; paid price, typical
   market price, and the ingredient-cost fair price are three
   independent reference points, not one combined score.

   Nutritional balance, Vitamins/minerals/fiber, and How this fits
   your day are <details> elements, not <section>s — they start
   collapsed once revealed (see runAnalysis()'s reveal block), since
   the summary strip at the top already carries the headline. Total
   food value and What did it cost stay always-expanded as the
   primary, most-wanted numbers. See the .fw-collapsible CSS comment
   in the HTML for why print gets its own override.

   FUTURE (KIV, architected for but not built):
     - Confirm current Malaysian NRV for Vitamin C/D against the
       gazetted Fifth A Schedule text directly, and for Potassium and
       Sodium if Malaysia ever publishes a distinct %NRV instead of
       flat mg thresholds for those two — dvMy is a single number per
       row, so this is a data fix, not a structural change.
     - Editable recipe ingredients (adjust a price Gemini got wrong,
       the same way item rows are already editable) — would mean
       recipePanel's rendered list needs inputs instead of plain
       text, and dishRecipeCost recomputed on edit like getDishTotals
       already does for items.
     - Live market pricing (an actual price dataset/API) instead of
       Gemini's own estimate, for either typical price or ingredient
       costs, if the estimates prove too rough in practice —
       dishTypicalPrice and dishRecipeCost are already their own
       WeakMaps, so swapping the source only touches runAnalysis()/
       runRecipeBreakdown().
   ============================================================ */

console.info('[Food Worth Calculator] script build: 2026-09-02-v9-ui-polish-donut-chart');

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
const EMPTY_RECIPE = { recognized: false, recipeName: '', ingredients: [], totalCost: 0 };

// The F&B industry's common rule-of-thumb ingredient-cost structure
// — a business targeting roughly this share of its selling price
// going to ingredients is a widely used benchmark, not something
// specific to any one dish. Used only to gross a recipe's ingredient
// cost up into an implied "fair" selling price: cost \u00f7 target,
// the same target \u00f7 (1 \u2212 rate) shape already used for SST/
// marketplace fees elsewhere on the site, simplified since there's
// just the one rate here rather than several stacked ones.
const INGREDIENT_COST_TARGET_PCT = 0.30;

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

// Same endpoint, same photo already sitting in memory — just a
// different mode flag, so the Worker runs a different prompt/schema
// against it (see food-worth-proxy-worker.js). Opt-in only: this
// never runs as part of the normal analyzePhoto() flow.
async function analyzeRecipe(base64Image) {
  let response;
  try {
    response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image, mime_type: 'image/jpeg', mode: 'recipe' }),
    });
  } catch (e) {
    throw new Error('Could not reach the analysis service \u2014 check PROXY_ENDPOINT is correct and that this page\u2019s URL is in the Worker\u2019s ALLOWED_ORIGINS.');
  }

  let data;
  try { data = await response.json(); }
  catch (e) { throw new Error('Got an unreadable response from the analysis service. Try again.'); }

  if (!response.ok) {
    throw new Error(data.error || ('Recipe breakdown failed (error ' + response.status + '). Try again.'));
  }
  return {
    recognized: !!data.recognized,
    recipeName: typeof data.recipe_name === 'string' ? data.recipe_name : '',
    ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
    totalCost: numOrZero(Number(data.total_ingredient_cost_myr)),
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
    return { costPer100kcal: 0, costPer100g: 0, label: null, ratio: 0 };
  }
  const costPer100kcal = (price / totals.calories) * 100;
  const costPer100g = totals.weight > 0 ? (price / totals.weight) * 100 : 0;
  const ratio = benchmarkPer100kcal > 0 ? costPer100kcal / benchmarkPer100kcal : 1;
  let label;
  if (ratio <= 0.85) label = 'Great value';
  else if (ratio <= 1.25) label = 'Fair value';
  else label = 'Pricey';
  return { costPer100kcal, costPer100g, label, ratio };
}


// Grosses an ingredient cost up into an implied "fair" selling price
// at the standard 30% ingredient-cost structure — a supply-side
// estimate (what a healthily-run stall would need to charge),
// deliberately kept separate from computeValueRating's own rating
// (which is demand-side, benchmarked against the user's own sense of
// fair value) and from Gemini's typical-market-price estimate
// (also demand-side, benchmarked against what people actually pay).
// All three are shown as independent reference points, not merged
// into one score.
function computeImpliedFairPrice(ingredientCost) {
  return ingredientCost > 0 ? ingredientCost / INGREDIENT_COST_TARGET_PCT : 0;
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
    const pct = Math.round(rating.ratio * 100);
    badge.innerHTML = `${escapeHTML(rating.label)}<span class="fw-rating-pct">${pct}%</span>`;
    card.classList.toggle('is-loss', rating.label === 'Pricey');
  }
}


function renderMarketPrice(price) {
  const el = document.getElementById('fw-market-price');
  el.textContent = formatPriceRange(price) || 'Analyze a dish to see this';
}

// The meal-level ingredient-cost-structure card — only appears once
// at least one dish has an ingredient cost to show (i.e. someone has
// opted into "Break down as a recipe" on at least one dish and it
// came back recognized). Stays hidden otherwise rather than showing
// an empty placeholder, since this is an opt-in feature most
// analyses won't have touched.
function renderIngredientFairPrice(ingredientCost) {
  const card = document.getElementById('fw-ingredient-cost-card');
  const el = document.getElementById('fw-ingredient-fair-price');
  if (!card || !el) return;
  if (!(ingredientCost > 0)) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  el.textContent = formatRM(computeImpliedFairPrice(ingredientCost));
}

// Renders one dish's recipe breakdown into its own panel. errorMessage
// takes priority (a failed call); otherwise recognized=false gets a
// plain "didn't match" message rather than an empty ingredient list,
// so it reads as an explanation, not a bug.
function renderRecipePanel(el, result, errorMessage) {
  if (errorMessage) {
    el.innerHTML = `<p class="fw-status is-error">${escapeHTML(errorMessage)}</p>`;
    return;
  }
  if (!result || !result.recognized || !result.ingredients.length) {
    el.innerHTML = '<p class="fw-recipe-empty">This didn\u2019t match a common recipe closely enough to break down \u2014 works best on a single standard dish, like chicken rice or nasi lemak.</p>';
    return;
  }
  const rows = result.ingredients.map((ing) => `<li>
      <span class="fw-recipe-ing-name">${escapeHTML(ing.name)}</span>
      <span class="fw-recipe-ing-qty">${escapeHTML(ing.quantity || '')}</span>
      <span class="fw-recipe-ing-price">${formatRM(numOrZero(Number(ing.price_myr)))}</span>
    </li>`).join('');
  const fairPrice = computeImpliedFairPrice(result.totalCost);
  el.innerHTML = `
    <h3 class="fw-recipe-title">${escapeHTML(result.recipeName || 'This dish')} \u2014 standard recipe</h3>
    <p class="fw-recipe-disclaimer">A rough breakdown based on how this dish is typically made and average Malaysian ingredient prices \u2014 not this specific plate's actual recipe or sourcing, so treat these as a ballpark for comparison, not an exact figure.</p>
    <ul class="fw-recipe-ingredients">${rows}</ul>
    <p class="fw-recipe-total">Ingredient cost: <strong>${formatRM(result.totalCost)}</strong> \u00b7 Implied fair price at a ${Math.round(INGREDIENT_COST_TARGET_PCT * 100)}% ingredient-cost structure: <strong>${formatRM(fairPrice)}</strong></p>
  `;
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

// Donut chart replacing the old horizontal bar so Nutritional
// balance can sit in a half-width column next to Vitamins/minerals/
// fiber. Math verified separately: segment lengths always sum to
// exactly the circle's circumference (no gaps/overlaps), and a 0%
// segment degrades to a zero-length arc rather than a rendering
// glitch. Legend is rendered separately into #fw-macro-legend so it
// can sit beside the chart with percentages, not just color keys.
function renderMacroChart(mix, totalCalories) {
  const chartEl = document.getElementById('fw-macro-chart');
  const legendEl = document.getElementById('fw-macro-legend');
  if (!chartEl || !legendEl) return;

  const segs = [
    { key: 'protein', name: 'Protein', pct: mix.protein },
    { key: 'carbs', name: 'Carbs', pct: mix.carbs },
    { key: 'fat', name: 'Fat', pct: mix.fat },
  ];
  const hasData = segs.some((s) => s.pct > 0);
  const r = 70;
  const cx = 90;
  const cy = 90;
  const strokeWidth = 28;
  const circumference = 2 * Math.PI * r;

  let arcsSVG;
  if (!hasData) {
    // Nothing analyzed yet — a flat gray ring rather than a blank
    // square, so the chart's presence still reads as "waiting for
    // data" instead of looking broken.
    arcsSVG = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${strokeWidth}" />`;
  } else {
    let offsetSoFar = 0;
    arcsSVG = segs.map((s) => {
      const len = (Math.max(0, s.pct) / 100) * circumference;
      const dasharray = `${len.toFixed(2)} ${(circumference - len).toFixed(2)}`;
      const dashoffset = (-offsetSoFar).toFixed(2);
      offsetSoFar += len;
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" class="fw-seg-${s.key}-stroke"
        stroke-width="${strokeWidth}" stroke-dasharray="${dasharray}" stroke-dashoffset="${dashoffset}" />`;
    }).join('');
  }

  const centerLabel = totalCalories > 0
    ? `<text x="${cx}" y="${cy - 6}" text-anchor="middle" font-family="var(--font-display)" font-weight="700" font-size="22" fill="var(--text)">${Math.round(totalCalories).toLocaleString()}</text>
       <text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="var(--muted)">kcal</text>`
    : '';

  chartEl.innerHTML = `<svg viewBox="0 0 180 180" width="160" height="160" role="img" aria-label="Macronutrient breakdown: ${Math.round(mix.protein)}% protein, ${Math.round(mix.carbs)}% carbs, ${Math.round(mix.fat)}% fat">
    <g transform="rotate(-90 ${cx} ${cy})">${arcsSVG}</g>
    ${centerLabel}
  </svg>`;

  legendEl.innerHTML = hasData
    ? segs.map((s) => `<span><i class="legend-swatch fw-seg-${s.key}"></i>${s.name} ${Math.round(s.pct)}%</span>`).join('')
    : segs.map((s) => `<span><i class="legend-swatch fw-seg-${s.key}"></i>${s.name}</span>`).join('');
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
      document.getElementById('fw-detail-section').hidden = false;
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

async function runRecipeBreakdown(panel) {
  const base64 = dishImageData.get(panel);
  const recipePanel = panel.querySelector('.fw-recipe-panel');
  if (!base64 || !recipePanel) return; // shouldn't happen — button only shows after a successful photo analysis

  if (getUsageToday() >= MAX_ANALYSES_PER_DAY) {
    recipePanel.hidden = false;
    renderRecipePanel(recipePanel, null, 'This browser has hit today\u2019s analysis limit. Try again tomorrow.');
    return;
  }

  const btn = panel.querySelector('.fw-recipe-btn');
  btn.disabled = true;
  btn.textContent = 'Breaking down\u2026';
  recipePanel.hidden = false;
  recipePanel.innerHTML = '<p class="fw-status">Checking if this matches a common recipe\u2026</p>';

  try {
    const result = await analyzeRecipe(base64);
    recordUsage();
    dishRecipeCost.set(panel, result.recognized ? result.totalCost : 0);
    renderRecipePanel(recipePanel, result);
    recalculateMeal();
  } catch (err) {
    renderRecipePanel(recipePanel, null, err.message || 'Something went wrong. Try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Break down as a recipe';
  }
}

function recalculateMeal() {
  const panels = Array.from(document.querySelectorAll('.fw-dish-panel'));
  const mealTotals = { weight: 0, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const mealMicros = { ...EMPTY_MICRONUTRIENTS };
  const mealPrice = { low: 0, high: 0 };
  let mealIngredientCost = 0;
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

    mealIngredientCost += numOrZero(dishRecipeCost.get(panel));
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
  renderIngredientFairPrice(mealIngredientCost);
  renderMacroChart(mix, mealTotals.calories);
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
const dishRecipeCost = new WeakMap();

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
        <button type="button" class="btn btn-secondary fw-recipe-btn">Break down as a recipe</button>
      </div>
      <p class="fw-dish-subtotal"></p>
      <div class="fw-recipe-panel" hidden></div>
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
  panel.querySelector('.fw-recipe-btn').addEventListener('click', () => runRecipeBreakdown(panel));
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
