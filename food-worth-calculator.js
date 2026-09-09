/* ============================================================
   Food Worth Calculator
   Vanilla JS, no dependencies. The photo and/or description goes to
   the Cloudflare Worker proxy (food-worth-proxy-worker.js) — never
   straight to Gemini, and never with a key visible in this file.
   ------------------------------------------------------------
   DATA MODEL (v5, 2026-09-07): a session is one or more "dishes"
   (the word covers drinks too — see below). Each dish is its own
   self-contained unit — own input, own upload zone, own editable
   item table, own subtotal — exactly the same repeatable-block
   pattern menu-calculator.js already uses for .menu-block (create*,
   scope every lookup to that instance via panel.querySelector(),
   never a page-wide id). A dish panel is just a .menu-block wearing
   a different hat.

   INPUT MODES: each dish panel has two mutually exclusive tabs —
   "Photo analyze" (a chosen photo, plus an optional short note for
   anything the photo alone might not show — size, less ice, an
   off-menu substitution) and "Text analyze" (just a typed
   description, no photo at all, for someone who'd rather describe
   what they had than take a picture). switchInputMode() toggles
   which is active; gatherAnalysisInput() reads whichever one is
   active into { image, description } when Analyze is clicked — both
   fields are independently optional at the Worker level (mirroring
   the "either, or both" contract Margin Audit's own proxy already
   uses), but in practice exactly one side is populated per mode.
   Drinks are a first-class case here, not an afterthought — the
   Worker's own PROMPT explicitly covers food AND drinks, estimating
   a liquid's weight_g from typical serving volume rather than
   assuming everything in frame is solid food on a plate.

   Single food item mode: exactly one dish, tabs never appear.
   Meal mode: "+ Add another dish" is offered once the active dish
   has results; 2+ dishes render as tabs automatically. This tab
   layer (dish tabs) is unrelated to the input-mode tabs above —
   don't conflate switchToDish (which dish) with switchInputMode
   (photo vs. text for the CURRENT dish).

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

   Recipe breakdown (analyzeRecipe(), called from inside runAnalysis)
   is a genuinely separate Gemini call — not folded into the main
   analyzePhoto() schema, because it's a different kind of task
   (general recipe/pricing knowledge, not photo-precision estimation)
   with its own prompt and schema. It used to be opt-in per dish via
   its own button; as of 2026-09-07 it auto-runs alongside the main
   analysis on every Analyze click instead (see runAnalysis), since
   most people never found the separate button — it's still a
   distinct API call under the hood, just no longer a distinct user
   action. This does mean every Analyze click now costs two Gemini
   calls instead of one; see MAX_ANALYSES_PER_DAY's own comment for
   how the daily cap was adjusted to compensate. Its ingredient rows
   are editable (quantity, price) in the rendered panel, so the cost
   is read live from those inputs via getRecipeCost() — same "never
   cache what's editable" rule as getDishTotals() reading the item
   table — rather than a stored WeakMap total that would go stale the
   moment a price is corrected; panel.dataset.recipeRecognized is the
   one thing still tracked outside the DOM, since it's what an
   empty/never-run panel needs to be told apart from a genuinely
   zero-cost one. computeImpliedFairPrice() grosses that sum up via
   the F&B industry's ~30% ingredient-cost-structure benchmark
   — cost \u00f7 target, not cost \u00d7 markup — deliberately never
   merged into computeValueRating()'s own rating; paid price, typical
   market price, and the ingredient-cost fair price are three
   independent reference points, not one combined score.

   Worth it? (computeWorthiness()) combines the one genuinely
   subjective input on this page — a 1-5 star taste rating, meal-
   level, in-memory only via the tasteRating variable — with the
   value rating above into a single verdict. Simple average of two
   normalized scores; verified against the full 5x3 matrix before
   shipping, same spirit as computeReferencePrice not weighting one
   signal over another without a principled reason to.

   Section names as of 2026-09-03: "Price & value" (was "What did it
   cost"), "Macros" (was "Nutritional balance" — now also carries the
   merged total weight/calories line, since that used to be its own
   box with data repeating what the donut chart already shows),
   "Micros" (was "Vitamins, minerals & fiber"), "Calorie needs & BMI"
   (was "How this fits your day"). "Worth it?" and "Price & value"
   are <details> elements that default OPEN (they hold primary
   inputs — taste stars, price paid); Calorie needs & BMI, Macros,
   and Micros default closed, since the summary strip at the top
   already carries their headline numbers. See the .fw-collapsible
   CSS comment in the HTML for why print gets its own override.

   2026-09-05 UI polish round: the recipe breakdown panel
   (.fw-recipe-panel) moved out of .fw-dish-results and into its own
   .fw-recipe-col, sitting beside the photo in a new .fw-dish-top-grid
   two-column layout instead of appearing full-width under the item
   table. Superseded 2026-09-07 (see below) once a dish could just as
   easily have no photo at all — the panel is full-width again now,
   but for a different reason than the original pre-09-05 layout:
   this time because it has to work for both input tabs, not because
   nothing better was tried yet. computeWorthiness() now
   returns {label, score} instead of a bare string, since the new
   gold-bordered "Worth it" banner above the summary strip
   (renderWorthBanner / #fw-worth-banner) needs the raw 0-1 score to
   color its verdict text continuously (colorForScore) rather than
   just picking from the 5 discrete labels. A floating quick-nav
   cluster (#fw-quick-nav) joins the existing back-to-top button,
   jumping to each results section and auto-opening any closed
   <details> found there.

   DONE, 2026-09-07 (were KIV above as of 2026-09-05):
     - Vitamin C/D's Malaysian NRV cross-referenced against RNI 2017
       (see the comment above MICRONUTRIENT_FIELDS for sourcing and
       confidence level — one step removed from the gazetted Fifth A
       Schedule text itself, which still isn't freely published
       anywhere this could confirm word-for-word). Potassium and
       Sodium are unaffected — still flat mg claim thresholds, not a
       %NRV table, per Malaysia's own regulations.
     - Editable recipe ingredients: recipePanel's rendered list now
       has real inputs for quantity and price, recomputed on edit via
       getRecipeCost()/recalcRecipeSummary() the same way getDishTotals()
       already does for the main item table.
     - Recipe breakdown no longer needs its own button — it auto-runs
       alongside the main analysis on every Analyze click instead
       (see the big comment above and runAnalysis further down).
     - Photo analyze / text analyze input tabs (switchInputMode(),
       gatherAnalysisInput()) — a dish no longer requires a photo;
       describing it in text works the whole way through, and a photo
       can now carry an optional note alongside it for anything the
       picture alone might not show.
     - Drinks are explicitly covered now, not just "a plate of food"
       — see PROMPT/RECIPE_PROMPT in food-worth-proxy-worker.js for
       the liquid-weight-estimation guidance this needed on the
       Worker side; nothing structural changed in this file for it,
       since weight_g already worked fine as the one universal unit.

   FUTURE (KIV, architected for but not built):
     - Live market pricing (an actual price dataset/API) instead of
       Gemini's own estimate, for either typical price or ingredient
       costs, if the estimates prove too rough in practice —
       dishTypicalPrice is already its own WeakMap and ingredient
       cost is already read live off the DOM, so swapping the source
       only touches runAnalysis()/analyzeRecipe() either way.
   ============================================================ */

console.info('[Food Worth Calculator] script build: 2026-09-07-v14-photo-text-tabs-auto-recipe-drinks');

/* ================= CONFIG ================= */

const MAX_IMAGE_EDGE = 1024; // px — resized client-side before it's ever sent
const PROXY_ENDPOINT = 'https://food-worth-proxy.reysourcez-ent.workers.dev';

// Counts individual Gemini calls, not Analyze clicks — since
// 2026-09-07, every click fires two calls (main breakdown + recipe
// breakdown, run together, see runAnalysis), where it used to fire
// one. Doubled from 20 to 40 here for that reason, so the ORIGINAL
// intent (roughly 20 dishes analyzed per browser per day) still
// holds rather than silently halving to 10 the moment recipe
// breakdown stopped being opt-in.
const MAX_ANALYSES_PER_DAY = 40;
const USAGE_STORAGE_KEY = 'fw-usage';

// Two parallel reference standards, switchable in the UI (see
// activeStandard below): the US FDA's Daily Values (21 CFR 101.9,
// 2016 update) and Malaysia's Nutrient Reference Values (Food
// Regulations 1985, Fifth A Schedule, as amended — effective 1 Jan
// 2024). Where Malaysia's gazetted NRV doesn't set a distinct %NRV
// figure for a nutrient (potassium and sodium are handled there as
// flat mg claim thresholds, not a %NRV table), dvMy falls back to
// the same internationally-common figure used for dvUsa. Vitamin
// C/D's dvMy were 60mg/5mcg (the pre-2024 values) until 2026-09-07,
// when they were updated to 70mg/15mcg — cross-referenced against
// Malaysia's RNI 2017 report (National Coordinating Committee on
// Food and Nutrition, the direct input the food-labelling NRV
// amendment drew from) rather than the gazetted Fifth A Schedule
// table itself, which still isn't freely published anywhere this
// could confirm word-for-word. Confidence is reasonably good —
// 15mcg for vitamin D matches RNI 2017 exactly (a direct increase
// from the RNI 2005 figure of 5mcg, per a peer-reviewed citation),
// and 70mg for vitamin C sits inside RNI 2017's cited adult range
// (45–90mg, with 70mg the commonly-quoted single figure) — but
// this is still one step removed from the actual gazette text, so
// worth a final check against that directly if exact regulatory
// precision ever matters more than it does for a rough meal-worth
// signal (see the settings table in FOOD_WORTH_CHANGE_NOTES.md for
// exactly which line to edit if a correction is needed).
// `caution` flags sodium as a heads-up nutrient rather than a
// selling point; `lowHint`/`highHint` are the food-suggestion text
// for computeNutrientCoverage() — see further down.
const MICRONUTRIENT_FIELDS = [
  { key: 'vitamin_a_mcg', label: 'Vitamin A', unit: 'mcg', dvUsa: 900, dvMy: 800, lowHint: 'leafy greens, carrots, or orange sweet potato' },
  { key: 'vitamin_c_mg', label: 'Vitamin C', unit: 'mg', dvUsa: 90, dvMy: 70, lowHint: 'citrus fruit, guava, or bell pepper' },
  { key: 'vitamin_d_mcg', label: 'Vitamin D', unit: 'mcg', dvUsa: 20, dvMy: 15, lowHint: 'fatty fish, eggs, or a bit of sunlight' },
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

// Meal-level (not per-dish) — one taste rating for the eating
// experience as a whole, same as price paid. In-memory only, resets
// on reload same as everything else. 0 = not yet rated.
let tasteRating = 0;

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

// input is { image, description } — either may be undefined, but not
// both (gatherAnalysisInput()/runAnalysis() already guarantee at
// least one is present before this is ever called). Same "either, or
// both" contract as Margin Audit's proxy already uses for its own
// dish_cost_estimate call, extended here to the main item breakdown.
async function analyzePhoto(input) {
  let response;
  try {
    response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: input.image || undefined,
        mime_type: input.image ? 'image/jpeg' : undefined,
        description: input.description || undefined,
      }),
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

// Same endpoint, same input already gathered — just a different mode
// flag, so the Worker runs a different prompt/schema against it (see
// food-worth-proxy-worker.js). As of 2026-09-07 this auto-runs
// alongside analyzePhoto() on every Analyze click (see runAnalysis)
// rather than needing its own button — a description-only dish gets
// exactly the same treatment as a photo one, since recipe knowledge
// doesn't require a picture any more than the main breakdown does.
async function analyzeRecipe(input) {
  let response;
  try {
    response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: input.image || undefined,
        mime_type: input.image ? 'image/jpeg' : undefined,
        description: input.description || undefined,
        mode: 'recipe',
      }),
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

// Still computed for the (currently hidden) per-100-unit cards —
// useful normalized figures on their own, independent of any
// reference/rating logic.
function computeUnitCosts(totals, price) {
  if (!(price > 0) || !(totals.calories > 0)) return { costPer100kcal: 0, costPer100g: 0 };
  return {
    costPer100kcal: (price / totals.calories) * 100,
    costPer100g: totals.weight > 0 ? (price / totals.weight) * 100 : 0,
  };
}

// The rating used to compare cost-per-100kcal against "Your
// benchmark" — a user-adjustable RM/100kcal rate. Once that field
// was hidden (2026-09-02), the rating kept working off its stuck
// default value, silently comparing price against a number nobody
// could see or set anymore. This replaces that with something
// visible: the average of typical market price (demand-side — what
// people usually pay) and the ingredient-cost fair price (supply-
// side — what a healthy cost structure implies), whichever of the
// two are actually available. Simple average, not a weighted one —
// there's no principled reason to trust one signal over the other,
// so this doesn't try to.
function computeReferencePrice(typicalPrice, ingredientFairPrice) {
  const hasTypical = typicalPrice && typicalPrice.high > 0;
  const hasIngredient = ingredientFairPrice > 0;
  const typicalMid = hasTypical ? (typicalPrice.low + typicalPrice.high) / 2 : 0;
  if (hasTypical && hasIngredient) return (typicalMid + ingredientFairPrice) / 2;
  if (hasTypical) return typicalMid;
  if (hasIngredient) return ingredientFairPrice;
  return 0;
}

function computeValueRating(price, referencePrice) {
  if (!(price > 0) || !(referencePrice > 0)) return { label: null, ratio: 0 };
  const ratio = price / referencePrice;
  let label;
  if (ratio <= 0.85) label = 'Great value';
  else if (ratio <= 1.25) label = 'Fair value';
  else label = 'Pricey';
  return { label, ratio };
}

// Combines the one genuinely subjective input on this whole page
// (taste, 1-5 stars) with the objective value rating above into a
// single "worth it?" verdict. 5 stars + Great value = best possible
// combination; 1 star + Pricey = worst — matches the reference points
// this was specified against exactly (verified against the full 5x3
// matrix before this went into the page). Simple average of two
// normalized scores, not a weighted formula — no more principled
// reason to weight taste over price or vice versa than there was to
// weight typical-price over ingredient-cost in computeReferencePrice.
// Returns {label, score} rather than just the label, as of 2026-09-05
// — the new gold "Worth it" banner (renderWorthBanner) needs the raw
// 0-1 score to color its verdict text on a continuum, not just which
// of the 5 buckets it landed in.
function computeWorthiness(stars, ratingLabel) {
  if (!(stars > 0) || !ratingLabel) return null;
  const tasteNorm = stars / 5;
  const priceNorm = ratingLabel === 'Great value' ? 1.0 : ratingLabel === 'Fair value' ? 0.55 : 0.15;
  const score = (tasteNorm + priceNorm) / 2;
  let label;
  if (score >= 0.85) label = 'Excellent worth';
  else if (score >= 0.65) label = 'Good worth';
  else if (score >= 0.45) label = 'Fair worth';
  else if (score >= 0.25) label = 'Poor worth';
  else label = 'Not worth it';
  return { label, score };
}

// Interpolates red -> gold as the worthiness score runs 0 -> 1, so the
// "Worth it" banner's verdict text reads as a smooth extension of the
// same scale computeWorthiness() buckets into 5 discrete labels above
// — reuses the site's existing error red (#C0392B, already on
// .fw-status.is-error) and accent gold (#D4A017, already on the taste
// stars and the fat macro segment) rather than introducing new colors.
function colorForScore(score) {
  const t = Math.max(0, Math.min(1, score));
  const from = { r: 0xC0, g: 0x39, b: 0x2B };
  const to = { r: 0xD4, g: 0xA0, b: 0x17 };
  const r = Math.round(from.r + (to.r - from.r) * t);
  const g = Math.round(from.g + (to.g - from.g) * t);
  const b = Math.round(from.b + (to.b - from.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}


// Grosses an ingredient cost up into an implied "fair" selling price
// at the standard 30% ingredient-cost structure — a supply-side
// estimate (what a healthily-run stall would need to charge). As of
// 2026-09-03 this DOES feed the rating (via computeReferencePrice,
// below) alongside Gemini's typical-market-price estimate — the two
// are still shown as their own independent cards, not merged into a
// single number on screen, but the rating now draws on both rather
// than an unrelated third figure.
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

// Total food value used to be its own box with two result-cards;
// merged into Macros (2026-09-03, repeating data — the donut chart
// already carries total calories, this just adds weight alongside
// it in one compact line rather than a whole separate section).
function renderTotals(totals) {
  const el = document.getElementById('fw-meal-totals-line');
  if (!el) return;
  el.textContent = (totals.weight > 0 || totals.calories > 0)
    ? `Meal total: ${Math.round(totals.weight).toLocaleString()} g, ${Math.round(totals.calories).toLocaleString()} kcal`
    : '';
}

function renderUnitCosts(unitCosts) {
  document.getElementById('fw-cost-per-kcal').textContent = formatRM(unitCosts.costPer100kcal);
  document.getElementById('fw-cost-per-100g').textContent = formatRM(unitCosts.costPer100g);
}

function renderRating(rating) {
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

function renderTasteStars() {
  document.querySelectorAll('.fw-star').forEach((btn) => {
    btn.classList.toggle('is-filled', Number(btn.dataset.star) <= tasteRating);
  });
}

function renderWorthiness(stars, rating) {
  const badge = document.getElementById('fw-worthiness-badge');
  if (!badge) return;
  if (!(stars > 0)) {
    badge.textContent = 'Rate the taste above';
  } else if (!rating.label) {
    badge.textContent = 'Add a price above';
  } else {
    badge.textContent = computeWorthiness(stars, rating.label).label;
  }
}

// The gold-bordered "Worth it" banner above the summary strip — same
// verdict as renderWorthiness() above (they share computeWorthiness's
// result), but bigger/bolder: a big read-only star display mirroring
// tasteRating, and the verdict text colored on the red->gold scale
// from colorForScore rather than plain text, so the single most
// "read this in one glance" number on the page gets a spot to match.
function renderWorthBanner(stars, rating) {
  const verdictEl = document.getElementById('fw-worth-banner-verdict');
  if (!verdictEl) return;
  document.querySelectorAll('.fw-worth-star').forEach((el) => {
    el.classList.toggle('is-filled', Number(el.dataset.star) <= stars);
  });
  if (!(stars > 0)) {
    verdictEl.textContent = 'Rate the taste above';
    verdictEl.style.color = '';
  } else if (!rating.label) {
    verdictEl.textContent = 'Add a price above';
    verdictEl.style.color = '';
  } else {
    const worthiness = computeWorthiness(stars, rating.label);
    verdictEl.textContent = worthiness.label;
    verdictEl.style.color = colorForScore(worthiness.score);
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
//
// 2026-09-07: ingredient rows are now genuinely editable (quantity
// and price), not read-only text \u2014 same reasoning as every other
// AI estimate on this page: Gemini's guess is a starting point, and
// the vendor may simply know their own supplier price better. Name
// stays a plain label \u2014 editing what an ingredient IS feels like a
// different action (add/remove) than correcting a number Gemini
// estimated for it, and isn't what was asked for. The two summary
// figures get stable classes (.fw-recipe-cost-value /
// .fw-recipe-fair-value) so recalcRecipeSummary() can update just
// those two numbers per keystroke without rebuilding this whole
// innerHTML \u2014 doing a full rebuild on every keystroke would blow
// away focus and cursor position mid-edit.
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
      <input type="text" class="fw-recipe-ing-qty-input" value="${escapeHTML(ing.quantity || '')}" aria-label="Quantity of ${escapeHTML(ing.name)}">
      <input type="number" class="fw-recipe-ing-price-input" min="0" step="0.01" value="${numOrZero(Number(ing.price_myr)).toFixed(2)}" aria-label="Estimated cost of ${escapeHTML(ing.name)} in RM">
    </li>`).join('');
  const fairPrice = computeImpliedFairPrice(result.totalCost);
  el.innerHTML = `
    <h3 class="fw-recipe-title">${escapeHTML(result.recipeName || 'This dish')} \u2014 standard recipe</h3>
    <p class="fw-recipe-disclaimer">A rough breakdown based on how this dish is typically made (or its closest generic equivalent, for a branded item) and average Malaysian ingredient prices \u2014 not this specific plate's actual recipe or sourcing, so treat these as a ballpark for comparison. Know a price better? Edit it below \u2014 the totals update as you go.</p>
    <ul class="fw-recipe-ingredients">${rows}</ul>
    <p class="fw-recipe-total">Ingredient cost: <strong class="fw-recipe-cost-value">${formatRM(result.totalCost)}</strong> \u00b7 Implied fair price at a ${Math.round(INGREDIENT_COST_TARGET_PCT * 100)}% ingredient-cost structure: <strong class="fw-recipe-fair-value">${formatRM(fairPrice)}</strong></p>
  `;
  const dishPanel = el.closest('.fw-dish-panel');
  el.querySelectorAll('.fw-recipe-ing-price-input').forEach((input) => {
    input.addEventListener('input', () => recalcRecipeSummary(dishPanel));
  });
}

// Mirrors getDishTotals()'s "always read live from the DOM, never
// trust a cached number" approach \u2014 now that ingredient rows are
// editable, the recipe cost has to be summed the same way, not
// pulled from a number that would go stale the moment someone
// corrects a price. panel.dataset.recipeRecognized (set in
// runAnalysis, where the recipe call now lives) is what tells
// "recipe never run" / "came back unrecognized" apart from an
// actually-priced dish \u2014 both those cases render no ingredient rows
// to sum, so this would already return 0 by construction, but the
// flag makes that explicit rather than relying on an empty NodeList
// meaning the same thing by luck.
function getRecipeCost(panel) {
  if (panel.dataset.recipeRecognized !== 'true') return 0;
  let sum = 0;
  panel.querySelectorAll('.fw-recipe-ing-price-input').forEach((input) => { sum += num(input); });
  return sum;
}

// Called on every ingredient-price edit. Updates only the summary
// line's two numbers in place, deliberately not re-running
// renderRecipePanel()'s full innerHTML rebuild for the same reason
// recalculateDish() never touches the item table's own <input>
// elements, only reads them.
function recalcRecipeSummary(panel) {
  const cost = getRecipeCost(panel);
  const costEl = panel.querySelector('.fw-recipe-cost-value');
  const fairEl = panel.querySelector('.fw-recipe-fair-value');
  if (costEl) costEl.textContent = formatRM(cost);
  if (fairEl) fairEl.textContent = formatRM(computeImpliedFairPrice(cost));
  recalculateMeal();
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
  const bmiCard = document.getElementById('fw-bmi-card');
  const bmiValueEl = document.getElementById('fw-bmi-value');

  if (bmiCard && bmiValueEl) {
    if (bmi > 0) {
      bmiCard.hidden = false;
      bmiValueEl.textContent = `${bmi.toFixed(1)} \u2014 ${bmiCategory(bmi)}`;
    } else {
      bmiCard.hidden = true;
    }
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

// The "read this in five seconds" panel at the top of the results —
// four small cards: value rating (with its percentage), calorie
// share, the single most useful "could use more" note, and its
// counterpart "could use less" for anything flagged as a caution
// (currently just sodium). Reuses the same rating/coverage/need
// objects recalculateMeal already computed once for the detailed
// sections below, rather than recomputing.
function renderSummaryStrip(rating, mealCalories, dailyNeed, coverage) {
  const el = document.getElementById('fw-summary-strip');
  if (!el) return;

  const valueText = rating.label
    ? `${escapeHTML(rating.label)} <span class="fw-summary-pct">${Math.round(rating.ratio * 100)}%</span>`
    : 'Add price paid';
  const calorieText = (dailyNeed > 0 && mealCalories > 0)
    ? Math.round((mealCalories / dailyNeed) * 100) + '%'
    : 'Fill in your info';

  let moreLabel = 'nutrients';
  let moreText = '\u2014';
  if (coverage.lackingFlags.length) {
    moreText = coverage.lackingFlags[0].label;
    moreLabel = 'could use more';
  } else if (coverage.goodSources.length) {
    moreText = coverage.goodSources[0].label;
    moreLabel = 'good source of';
  }

  const lessText = coverage.cautionFlags.length ? escapeHTML(coverage.cautionFlags[0].label) : '\u2014';

  el.innerHTML = `
    <div class="fw-summary-item"><strong>${valueText}</strong><small>value</small></div>
    <div class="fw-summary-item"><strong>${escapeHTML(calorieText)}</strong><small>kcal of your day</small></div>
    <div class="fw-summary-item"><strong>${escapeHTML(moreText)}</strong><small>${escapeHTML(moreLabel)}</small></div>
    <div class="fw-summary-item"><strong>${lessText}</strong><small>could use less</small></div>
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
  // Mirrors sparkleSVG's geometry (same viewBox/weight) but a plain
  // minus bar, for "Could use less" — same treatment, opposite direction.
  const minusSVG = '<svg class="fw-micro-caution-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M3 8H13"/></svg>';

  let html = '';
  if (goodSources.length) {
    html += `<div class="fw-micro-group"><span class="fw-micro-group-label">Good source of</span>`
      + `<div class="fw-micro-tags">${goodSources.map((i) => tagHTML(i)).join('')}</div></div>`;
  }
  if (cautionFlags.length) {
    html += `<div class="fw-micro-group fw-micro-caution-card">`
      + `<span class="fw-micro-group-label">${minusSVG}Could use less</span>`
      + `<div class="fw-micro-tags">${cautionFlags.map((i) => tagHTML(i, 'is-caution-strong')).join('')}</div>`
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
    updateAnalyzeButtonState(panel);
    setStatus(statusEl, 'Photo ready \u2014 click Analyze when you\u2019re set.');
  } catch (err) {
    setStatus(statusEl, err.message || 'Could not read that photo.', true);
  }
}

// Photo analyze / text analyze are mutually exclusive input modes,
// same pattern as Margin Audit's AI-estimate/manual source tabs \u2014
// switching doesn't clear either side's data, just changes which one
// gatherAnalysisInput() reads when Analyze is clicked. The Analyze
// button's own label switches with it, so it never reads "Analyze
// photo" while about to send a typed description, or vice versa.
function switchInputMode(panel, mode) {
  panel.dataset.inputMode = mode;
  panel.querySelectorAll('.fw-input-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.inputMode === mode));
  panel.querySelectorAll('.fw-input-panel').forEach((p) => { p.hidden = p.dataset.inputPanel !== mode; });
  panel.querySelector('.fw-analyze-btn').textContent = mode === 'text' ? 'Analyze description' : 'Analyze photo';
  updateAnalyzeButtonState(panel);
}

// Enabled once the ACTIVE mode has something to send \u2014 a chosen
// photo for photo mode (the optional note never gates it on its
// own), or actual typed text for text mode. Called on tab switch and
// on every keystroke in the text-mode textarea.
function updateAnalyzeButtonState(panel) {
  const btn = panel.querySelector('.fw-analyze-btn');
  if (panel.dataset.inputMode === 'text') {
    btn.disabled = !panel.querySelector('.fw-text-desc').value.trim();
  } else {
    btn.disabled = !dishImageData.get(panel);
  }
}

// Reads whichever mode is active into the shape both analyzePhoto()
// and analyzeRecipe() take \u2014 image and description are each
// independently optional at the Worker level (same "either, or both"
// contract Margin Audit's proxy already uses), but exactly one side
// is actually populated here per mode: photo mode sends the chosen
// photo plus its optional note (context the photo alone might not
// show \u2014 size, less ice, an off-menu substitution); text mode
// sends only the typed description, no image at all.
function gatherAnalysisInput(panel) {
  if (panel.dataset.inputMode === 'text') {
    return { image: undefined, description: panel.querySelector('.fw-text-desc').value.trim() };
  }
  const note = panel.querySelector('.fw-photo-note').value.trim();
  return { image: dishImageData.get(panel), description: note || undefined };
}

// Runs the main item breakdown AND the recipe/ingredient-cost
// breakdown together, in parallel \u2014 recipe breakdown used to be a
// separate opt-in button; as of 2026-09-07 it auto-runs on every
// Analyze instead, since most people never found the second button.
// The two calls are independent (both just need the same input,
// neither depends on the other's result), so Promise.all fires them
// together rather than waiting on one before starting the next. The
// recipe call is individually wrapped so ITS failure never fails the
// whole analysis \u2014 a dish that doesn't match a standard recipe, or
// a recipe call that times out, shouldn't take the main item
// breakdown down with it. Each Analyze click now costs TWO Gemini
// calls instead of one \u2014 see MAX_ANALYSES_PER_DAY's own comment for
// how the daily cap was adjusted to match.
async function runAnalysis(panel) {
  const statusEl = panel.querySelector('.fw-status');
  const mode = panel.dataset.inputMode;

  if (!PROXY_ENDPOINT || PROXY_ENDPOINT === 'PASTE_YOUR_CLOUDFLARE_WORKER_URL_HERE') {
    setStatus(statusEl, 'This tool needs its proxy URL set \u2014 see PROXY_ENDPOINT near the top of food-worth-calculator.js.', true);
    return;
  }
  const input = gatherAnalysisInput(panel);
  if (!input.image && !input.description) {
    setStatus(statusEl, mode === 'text' ? 'Type a description first.' : 'Add a photo first.', true);
    return;
  }
  if (getUsageToday() + 2 > MAX_ANALYSES_PER_DAY) {
    setStatus(statusEl, 'This browser has hit today\u2019s analysis limit. Try again tomorrow.', true);
    return;
  }

  const btn = panel.querySelector('.fw-analyze-btn');
  btn.disabled = true;
  setStatus(statusEl, mode === 'text' ? 'Reading your description\u2026' : 'Looking at your photo\u2026');
  const recipePanel = panel.querySelector('.fw-recipe-panel');
  recipePanel.hidden = false;
  recipePanel.innerHTML = '<p class="fw-status">Checking if this matches a common recipe\u2026</p>';

  try {
    const [result, recipeOutcome] = await Promise.all([
      analyzePhoto(input),
      analyzeRecipe(input).then((r) => ({ ok: true, value: r })).catch((e) => ({ ok: false, error: e })),
    ]);
    recordUsage(); // main analysis call
    recordUsage(); // recipe-breakdown call \u2014 fired alongside it every time now
    dishMicronutrients.set(panel, result.micronutrients);
    dishTypicalPrice.set(panel, result.typicalPrice);
    panel.querySelector('.fw-item-rows').innerHTML = '';
    if (result.items.length === 0) {
      setStatus(statusEl, mode === 'text'
        ? 'Couldn\u2019t identify a food or drink from that description \u2014 try adding what it is and roughly how much.'
        : 'Didn\u2019t spot any food or drink in that photo \u2014 try a clearer, closer shot, or add a note describing it.', true);
      recipePanel.hidden = true;
      panel.dataset.recipeRecognized = 'false';
    } else {
      result.items.forEach((it) => createItemRow(panel, it));
      panel.querySelector('.fw-dish-results').hidden = false;
      document.getElementById('fw-meal-section').hidden = false;
      document.getElementById('fw-detail-section').hidden = false;
      document.getElementById('fw-quick-nav').hidden = false;

      if (recipeOutcome.ok) {
        const recipe = recipeOutcome.value;
        panel.dataset.recipeRecognized = (recipe.recognized && Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0) ? 'true' : 'false';
        renderRecipePanel(recipePanel, recipe);
      } else {
        panel.dataset.recipeRecognized = 'false';
        renderRecipePanel(recipePanel, null, 'Couldn\u2019t check for a standard recipe this time \u2014 the item breakdown below is still accurate.');
      }

      recalculateDish(panel);
      recalculateMeal();
      updateAddDishVisibility();
      setStatus(statusEl, `Found ${result.items.length} item${result.items.length === 1 ? '' : 's'}. Edit anything you know better below.`);
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } catch (err) {
    setStatus(statusEl, err.message || 'Something went wrong. Try again.', true);
    recipePanel.hidden = true;
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

    mealIngredientCost += getRecipeCost(panel);
  });

  const price = num(document.getElementById('fw-price'));
  const unitCosts = computeUnitCosts(mealTotals, price);
  const ingredientFairPrice = computeImpliedFairPrice(mealIngredientCost);
  const referencePrice = computeReferencePrice(mealPrice, ingredientFairPrice);
  const rating = computeValueRating(price, referencePrice);
  const mix = computeMacroMix(mealTotals);
  const coverage = computeNutrientCoverage(mealMicros, mealTotals);
  const need = getDailyNeed();

  renderTotals(mealTotals);
  renderUnitCosts(unitCosts);
  renderRating(rating);
  renderTasteStars();
  renderWorthiness(tasteRating, rating);
  renderWorthBanner(tasteRating, rating);
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

let dishIdCounter = 0;

function createDishPanel() {
  dishIdCounter++;
  const id = 'dish-' + dishIdCounter;
  const label = 'Dish ' + dishIdCounter;

  const panel = document.createElement('div');
  panel.className = 'fw-dish-panel menu-block';
  panel.dataset.dishId = id;
  panel.dataset.inputMode = 'photo';
  panel.innerHTML = `
    <div class="menu-block-header">
      <input type="text" class="menu-name-input fw-dish-name" value="${escapeHTML(label)}" aria-label="Dish name">
      <button type="button" class="remove-block-btn fw-remove-dish no-print" aria-label="Remove this dish" hidden>Remove dish</button>
    </div>

    <div class="fw-upload-zone">
      <div class="fw-input-tabs no-print" role="tablist">
        <button type="button" class="fw-input-tab is-active" data-input-mode="photo">Photo analyze</button>
        <button type="button" class="fw-input-tab" data-input-mode="text">Text analyze</button>
      </div>

      <div class="fw-input-panel" data-input-panel="photo">
        <img class="fw-preview-img" alt="" hidden>
        <div class="fw-upload-row no-print">
          <label class="btn btn-secondary" style="cursor:pointer;">Choose or take a photo<input type="file" accept="image/*" class="sr-only fw-photo-input"></label>
        </div>
        <textarea class="fw-photo-note" placeholder="Optional \u2014 anything the photo might not show: size, less ice, off-menu item, brand"></textarea>
      </div>

      <div class="fw-input-panel" data-input-panel="text" hidden>
        <textarea class="fw-text-desc" placeholder="Describe the food or drink \u2014 e.g. &quot;1 plate chicken rice, extra chili&quot; or &quot;large iced Milo, less sweet&quot;"></textarea>
      </div>

      <div class="calc-actions no-print">
        <button type="button" class="btn btn-primary fw-analyze-btn" disabled>Analyze photo</button>
      </div>
      <p class="fw-status no-print" role="status" aria-live="polite"></p>
      <div class="fw-recipe-panel" hidden></div>
    </div>

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

  panel.querySelectorAll('.fw-input-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchInputMode(panel, tab.dataset.inputMode));
  });
  panel.querySelector('.fw-text-desc').addEventListener('input', () => updateAnalyzeButtonState(panel));
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

    document.querySelectorAll('.fw-star').forEach((btn) => {
      btn.addEventListener('click', () => {
        tasteRating = Number(btn.dataset.star);
        const live = document.getElementById('fw-taste-live');
        if (live) live.textContent = `Rated ${tasteRating} out of 5 stars`;
        recalculateMeal();
      });
    });

    // Floating quick-nav: jump straight to a results section, auto-
    // opening any closed <details> there so landing on a collapsed
    // summary heading doesn't look like nothing happened.
    document.querySelectorAll('.fw-quick-nav-btn[data-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (!target) return;
        if (target.tagName === 'DETAILS') target.open = true;
        target.querySelectorAll('details:not([open])').forEach((d) => { d.open = true; });
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    // Same idea as interactive-costing-analysis.html's back-to-top
    // button, keyed off scroll position here since this page has no
    // tool-dock open/close event to hook into instead.
    const backToTop = document.getElementById('fw-back-to-top');
    if (backToTop) {
      window.addEventListener('scroll', () => {
        backToTop.hidden = window.scrollY < window.innerHeight * 0.75;
      }, { passive: true });
      backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }

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
