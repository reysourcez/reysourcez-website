/* ============================================================
   Food Worth Calculator — Gemini proxy (Cloudflare Worker)
   ------------------------------------------------------------
   This file does NOT go in the reysourcez GitHub Pages repo — it
   deploys separately, to Cloudflare Workers. Its only job: hold the
   real Gemini API key server-side (as an encrypted Worker secret,
   set in the Cloudflare dashboard — never written in this file) and
   forward analysis requests to Gemini on the browser's behalf. The
   key never reaches food-worth-calculator.js or any visitor.

   Contract with the browser:
     Browser sends  -> { image: "<base64>", mime_type: "image/jpeg" }
                        optionally with mode: "recipe" for the
                        ingredient-cost breakdown instead of the
                        standard analysis (see RECIPE_SCHEMA below)
     Worker returns -> { items: [...], micronutrients: {...},
                          typical_price_myr: { low, high } }
                        or, in recipe mode:
                        { recognized: bool, recipe_name, ingredients: [...],
                          total_ingredient_cost_myr }
                        or  { error: "..." }
   The browser doesn't need to know anything about Gemini's request
   shape or model name anymore — all of that lives here now, so
   changing the prompt or swapping models later means editing only
   this file, not redeploying the site.

   DEPLOY STEPS (Cloudflare dashboard, no local tooling needed):
     1. dash.cloudflare.com -> Workers & Pages -> Create -> Create Worker.
     2. Name it (e.g. food-worth-proxy) -> Deploy the default template
        first (creates the Worker), then Edit code and replace
        everything with this file's contents.
     3. Update ALLOWED_ORIGINS below to your real domain(s).
     4. Settings -> Variables and Secrets -> Add -> Type: Secret,
        Name: GEMINI_API_KEY, Value: your real key -> Save and deploy.
        (The value is encrypted and won't be visible again afterward
        — that's expected, that's the point.)
     5. Deploy. Copy the *.workers.dev URL Cloudflare gives you.
     6. Paste that URL into PROXY_ENDPOINT in food-worth-calculator.js.
   ============================================================ */

// Add every origin that'll actually call this — your live domain,
// and a github.io URL too if you test there before a custom domain
// is wired up. Requests from anywhere else get refused by the
// browser (CORS), which is a real, meaningful barrier for casual
// reuse even though it doesn't stop a determined non-browser client.
const ALLOWED_ORIGINS = ['https://reysourcez.com', 'https://www.reysourcez.com'];

const GEMINI_MODEL = 'gemini-3.5-flash-lite'; // swapped from gemini-3.7-flash for latency — see thinking_level note below
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Common name of the food item' },
          weight_g: { type: 'number', description: 'Estimated weight in grams' },
          calories: { type: 'number', description: 'Estimated calories for that weight' },
          protein_g: { type: 'number' },
          carbs_g: { type: 'number', description: 'Total carbohydrate, including fiber' },
          fat_g: { type: 'number' },
          fiber_g: { type: 'number' },
          note: { type: 'string', description: 'One short nutritional benefit or consideration' },
        },
        required: ['name', 'weight_g', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g'],
      },
    },
    // Deliberately dish-level, not per item — one rougher estimate
    // covering everything in the photo combined, rather than 10
    // micronutrient numbers per item compounding error across
    // however many items got identified. Deliberately a standard,
    // commonly-labeled set (matches the US Nutrition Facts panel
    // core + a few widely-tracked extras) rather than an exhaustive
    // one — these are the nutrients most likely to be well-
    // represented in training data, which is the actual limiting
    // factor for a general-purpose model estimating micronutrients
    // at all (it's a knowledge gap, not a vision one).
    micronutrients: {
      type: 'object',
      description: 'Rough total micronutrient estimate for everything in the photo combined, not per item',
      properties: {
        vitamin_a_mcg: { type: 'number' },
        vitamin_c_mg: { type: 'number' },
        vitamin_d_mcg: { type: 'number' },
        vitamin_b12_mcg: { type: 'number' },
        calcium_mg: { type: 'number' },
        iron_mg: { type: 'number' },
        potassium_mg: { type: 'number' },
        sodium_mg: { type: 'number' },
        magnesium_mg: { type: 'number' },
        zinc_mg: { type: 'number' },
      },
      required: ['vitamin_a_mcg', 'vitamin_c_mg', 'vitamin_d_mcg', 'vitamin_b12_mcg', 'calcium_mg', 'iron_mg', 'potassium_mg', 'sodium_mg', 'magnesium_mg', 'zinc_mg'],
    },
    // A dish-level ballpark, not a live price lookup — Gemini is
    // estimating what a similar portion of this generally goes for,
    // the way a local would eyeball it. Low/high rather than one
    // figure for the same reason as everything else on this schema:
    // a range is a more honest shape for a guess than a single
    // invented number.
    typical_price_myr: {
      type: 'object',
      description: 'Typical price range, in Malaysian Ringgit, for a similar portion of everything on the plate combined at an ordinary Malaysian hawker stall, kopitiam, or casual eatery',
      properties: {
        low: { type: 'number', description: 'Lower end of the typical price range, in RM' },
        high: { type: 'number', description: 'Upper end of the typical price range, in RM' },
      },
      required: ['low', 'high'],
    },
  },
  required: ['items', 'micronutrients', 'typical_price_myr'],
};

const PROMPT = 'You are analyzing a photo of a plate of food for an F&B costing tool used in Malaysia. '
  + 'Identify every distinct food item visible. Count a sauce or garnish as its own item only if '
  + "it's substantial enough to matter nutritionally, not a token sprinkle. For each item, estimate "
  + 'from typical serving sizes and the visible portion: its common name, weight in grams, calories '
  + 'for that weight, protein/carbs/fat/fiber in grams, and one short nutritional note. Separately, '
  + 'give one combined estimate \u2014 not per item \u2014 of the total vitamin A, vitamin C, vitamin D, '
  + 'vitamin B12, calcium, iron, potassium, sodium, magnesium, and zinc across everything in the photo. '
  + 'Also give one combined estimate of what a similar portion of everything on the plate would '
  + 'typically cost in Malaysian Ringgit at an ordinary Malaysian hawker stall, kopitiam, or casual '
  + "eatery \u2014 a realistic low and high bound reflecting genuine price variation, not a single "
  + 'invented figure. '
  + "Treat a mixed dish that can't be usefully split apart (a curry, a fried rice) as one item rather "
  + 'than guessing at sub-ingredients. If nothing that looks like food is visible, return an empty '
  + 'items array, zeros for micronutrients, and zeros for the price range rather than guessing.';

// Recipe mode is a deliberately separate call, not folded into the
// schema/prompt above: it's a different kind of task (general recipe
// knowledge -- what does a standard portion of this dish usually
// contain and cost -- rather than precision-estimating this specific
// photo), it doesn't apply to every dish, and running it on every
// analysis would cost every visitor extra latency/tokens for a
// feature most won't use. The browser only sends mode: "recipe" when
// someone explicitly opts in from an already-analyzed dish.
const RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    recognized: {
      type: 'boolean',
      description: 'True only if this photo clearly matches a common, well-known dish with a fairly standard set of ingredients (e.g. Chicken Rice, Nasi Lemak, Char Kway Teow). False for a one-off, mixed, buffet-style, or otherwise unclear plate -- do not force a match.',
    },
    recipe_name: { type: 'string', description: 'Common name of the matched dish. Empty string if not recognized.' },
    ingredients: {
      type: 'array',
      description: 'The STANDARD ingredient list and quantities for ONE PORTION of this dish as it is typically made -- general recipe knowledge, not a re-measurement of this specific photo. Empty if not recognized.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'string', description: 'Amount for one portion in a natural unit, e.g. "150g", "2 cloves", "1 tbsp"' },
          price_myr: { type: 'number', description: 'Estimated cost of that quantity at average Malaysian wet-market/grocery prices, in RM' },
        },
        required: ['name', 'quantity', 'price_myr'],
      },
    },
    total_ingredient_cost_myr: { type: 'number', description: 'Sum of every ingredient\u2019s price_myr. Zero if not recognized.' },
  },
  required: ['recognized', 'recipe_name', 'ingredients', 'total_ingredient_cost_myr'],
};

const RECIPE_PROMPT = 'You are looking at a photo of a plate of food for an F&B costing tool used in Malaysia. '
  + 'Decide whether this photo clearly matches a common, well-known dish that has a fairly standard set '
  + 'of ingredients \u2014 for example Chicken Rice, Nasi Lemak, Char Kway Teow, Mee Goreng, a basic fried '
  + 'rice, or similar. Only say yes if you\u2019re confident \u2014 a one-off combination, a buffet-style '
  + 'plate, or anything you can\u2019t confidently name should be marked as not recognized rather than '
  + 'forcing a guess. If it is recognized, name the dish and list the STANDARD ingredients and '
  + 'quantities used to make ONE PORTION of it as typically prepared \u2014 general recipe knowledge, not '
  + 'an attempt to re-measure this specific photo. For each ingredient, estimate its cost in Malaysian '
  + 'Ringgit at average Malaysian wet-market or grocery prices for that quantity, and sum these into a '
  + 'total ingredient cost. If not recognized, return false, an empty recipe name, an empty ingredients '
  + 'array, and zero for the total.';

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  });
}

const EMPTY_MICRONUTRIENTS = {
  vitamin_a_mcg: 0, vitamin_c_mg: 0, vitamin_d_mcg: 0, vitamin_b12_mcg: 0,
  calcium_mg: 0, iron_mg: 0, potassium_mg: 0, sodium_mg: 0, magnesium_mg: 0, zinc_mg: 0,
};
const EMPTY_TYPICAL_PRICE = { low: 0, high: 0 };

// Gemini can hand back a price range with a low above the high, or
// negative/non-numeric junk — coerce and swap defensively rather
// than trusting it, same spirit as the micronutrient fallback below.
function sanitizePriceRange(raw) {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_TYPICAL_PRICE };
  let low = Number(raw.low);
  let high = Number(raw.high);
  if (!isFinite(low) || low < 0) low = 0;
  if (!isFinite(high) || high < 0) high = 0;
  if (high < low) { const t = low; low = high; high = t; } // defensive swap, in case Gemini reverses them
  return { low, high };
}

// Same nested-response walk that used to live in the browser file —
// this is just where that logic lives now. Returns a safe empty
// shape rather than throwing on anything unexpected, so the Worker
// always answers with valid JSON either way.
function extractAnalysis(data) {
  const outputStep = (data.steps || []).find((s) => s.type === 'model_output');
  const textBlock = outputStep && (outputStep.content || []).find((c) => c.type === 'text');
  if (!textBlock) return { items: [], micronutrients: EMPTY_MICRONUTRIENTS, typical_price_myr: EMPTY_TYPICAL_PRICE };
  let raw = textBlock.text.trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
  try {
    const parsed = JSON.parse(raw);
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      micronutrients: (parsed.micronutrients && typeof parsed.micronutrients === 'object')
        ? { ...EMPTY_MICRONUTRIENTS, ...parsed.micronutrients }
        : EMPTY_MICRONUTRIENTS,
      typical_price_myr: sanitizePriceRange(parsed.typical_price_myr),
    };
  } catch (e) {
    return { items: [], micronutrients: EMPTY_MICRONUTRIENTS, typical_price_myr: EMPTY_TYPICAL_PRICE };
  }
}

const EMPTY_RECIPE = { recognized: false, recipe_name: '', ingredients: [], total_ingredient_cost_myr: 0 };

function sanitizeIngredients(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i) => i && typeof i.name === 'string' && i.name.trim())
    .map((i) => {
      const price = Number(i.price_myr);
      return {
        name: i.name.trim(),
        quantity: typeof i.quantity === 'string' ? i.quantity.trim() : '',
        price_myr: isFinite(price) && price >= 0 ? price : 0,
      };
    });
}

// Same nested-response walk as extractAnalysis, for recipe mode.
// Recomputes the total from the ingredient list rather than trusting
// Gemini's stated total at face value \u2014 cheap to verify, and
// keeps the number on screen always consistent with the list above it.
function extractRecipe(data) {
  const outputStep = (data.steps || []).find((s) => s.type === 'model_output');
  const textBlock = outputStep && (outputStep.content || []).find((c) => c.type === 'text');
  if (!textBlock) return { ...EMPTY_RECIPE };
  let raw = textBlock.text.trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
  try {
    const parsed = JSON.parse(raw);
    const ingredients = sanitizeIngredients(parsed.ingredients);
    const recognized = !!parsed.recognized && ingredients.length > 0;
    if (!recognized) return { ...EMPTY_RECIPE };
    return {
      recognized: true,
      recipe_name: typeof parsed.recipe_name === 'string' && parsed.recipe_name.trim() ? parsed.recipe_name.trim() : 'This dish',
      ingredients,
      total_ingredient_cost_myr: ingredients.reduce((sum, i) => sum + i.price_myr, 0),
    };
  } catch (e) {
    return { ...EMPTY_RECIPE };
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    let body;
    try { body = await request.json(); }
    catch (e) { return json({ error: 'Invalid request body' }, 400, origin); }

    if (!body || typeof body.image !== 'string' || !body.image) {
      return json({ error: 'Missing image data' }, 400, origin);
    }
    const mimeType = typeof body.mime_type === 'string' ? body.mime_type : 'image/jpeg';
    const isRecipeMode = body.mode === 'recipe';

    if (!env.GEMINI_API_KEY) {
      return json({ error: 'Server is missing its Gemini key \u2014 add the GEMINI_API_KEY secret in this Worker\u2019s Settings.' }, 500, origin);
    }

    let geminiResp;
    try {
      geminiResp = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          input: [
            { type: 'text', text: isRecipeMode ? RECIPE_PROMPT : PROMPT },
            { type: 'image', data: body.image, mime_type: mimeType },
          ],
          // Gemini 3-series models default to thinking_level "high" if this
          // is left unset — meaning extended internal reasoning before
          // producing any output. Fine for hard problems, unnecessary for
          // "name what's on this plate and estimate some numbers", and very
          // likely the actual cause of the 524s: the model was probably
          // taking well over a minute to even start responding.
          generation_config: { thinking_level: 'low' },
          response_format: { type: 'text', mime_type: 'application/json', schema: isRecipeMode ? RECIPE_SCHEMA : ITEM_SCHEMA },
        }),
      });
    } catch (e) {
      return json({ error: 'Could not reach Gemini. Try again.' }, 502, origin);
    }

    if (!geminiResp.ok) {
      let detail = '';
      try {
        const errBody = await geminiResp.text();
        try {
          const errJson = JSON.parse(errBody);
          detail = (errJson.error && errJson.error.message) || errBody;
        } catch (e2) {
          detail = errBody;
        }
      } catch (e) {}
      detail = detail.slice(0, 500);
      console.error('[Food Worth Proxy] Gemini error', geminiResp.status, detail);
      return json({ error: 'Gemini error ' + geminiResp.status + (detail ? ': ' + detail : '') }, geminiResp.status, origin);
    }

    const data = await geminiResp.json();
    if (isRecipeMode) {
      return json(extractRecipe(data), 200, origin);
    }
    const analysis = extractAnalysis(data);
    return json({ items: analysis.items, micronutrients: analysis.micronutrients, typical_price_myr: analysis.typical_price_myr }, 200, origin);
  },
};
