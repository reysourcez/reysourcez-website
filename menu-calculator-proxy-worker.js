/* ============================================================
   Menu Calculator — dish cost estimate proxy (Cloudflare Worker)
   ------------------------------------------------------------
   This file does NOT go in the reysourcez GitHub Pages repo's
   deployed site — it deploys separately, to Cloudflare Workers,
   the same way food-worth-proxy-worker.js and Margin Audit's own
   proxy do. Its only job: hold the real Gemini API key server-side
   (an encrypted Worker secret, set in the Cloudflare dashboard,
   never written in this file) and forward a dish-cost-estimate
   request to Gemini on the browser's behalf. The key never reaches
   menu-calculator.js or any visitor.

   This is a separate Worker from Food Worth's and Margin Audit's,
   even though the underlying idea — photo or text in, Gemini call,
   structured JSON out — is the same shape all three share. Kept
   separate on purpose, not because the logic differs much, but so
   each tool's own session can maintain its own Worker (and its own
   secret, its own quota) without touching a file owned by a
   different tool.

   Contract with the browser (see menu-calculator.js's
   estimateMenuBlockCost):
     Request  -> { description?: "free text", image?: "<base64>",
                   mime_type?: "image/jpeg" }
                 (at least one of description/image required)
     Response -> { ingredients: [{ name, quantity, price_myr }],
                   total_ingredient_cost_myr }
                 or { error: "..." }

   Unlike Food Worth's recipe mode, this does NOT require the dish
   to be a recognized, famous standard dish — a vendor's own custom
   or house-special item is the normal case here, not the exception,
   so Gemini is asked to give its best-effort ingredient breakdown
   for whatever is described or shown, standard or not. If nothing
   describable comes through, it returns an empty ingredients array
   rather than force a guess.

   DEPLOY STEPS (Cloudflare dashboard, no local tooling needed):
     1. dash.cloudflare.com -> Workers & Pages -> Create -> Create Worker.
     2. Name it (e.g. menu-calculator-proxy) -> Deploy the default
        template first (this creates the Worker), then Edit code and
        replace everything with this file's contents.
     3. Update ALLOWED_ORIGINS below to your real domain(s) if they
        ever differ from the two already listed.
     4. Settings -> Variables and Secrets -> Add -> Type: Secret,
        Name: GEMINI_API_KEY, Value: your real Gemini key -> Save.
     5. Deploy. Copy the *.workers.dev URL Cloudflare gives you.
     6. Paste that URL into MENU_AI_PROXY_ENDPOINT near the top of
        menu-calculator.js.
   ============================================================ */

const ALLOWED_ORIGINS = ['https://reysourcez.com', 'https://www.reysourcez.com'];

const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

const INGREDIENT_SCHEMA = {
  type: 'object',
  properties: {
    ingredients: {
      type: 'array',
      description: 'Best-effort ingredient breakdown for ONE PORTION of the described or photographed dish. Standard or custom, does not need to be a famous or common dish.',
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
  },
  required: ['ingredients'],
};

const PROMPT_PREFIX = 'You are estimating the ingredient-level cost of ONE PORTION of a dish for an F&B costing tool used in Malaysia. '
  + 'The dish may be a well-known standard dish or a vendor\u2019s own custom or house-special creation \u2014 give your best-effort '
  + 'breakdown either way, rather than only answering for famous dishes. Break the dish down into its main ingredients with a '
  + 'realistic quantity for one portion and an estimated cost for that quantity at average Malaysian wet-market or grocery '
  + 'prices, in Ringgit. Keep the ingredient list to what actually matters for cost (skip token garnishes). If nothing that '
  + 'looks like a describable dish is provided, return an empty ingredients array rather than guessing.';

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

function sanitizeIngredients(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i) => i && typeof i.name === 'string' && i.name.trim())
    .map((i) => {
      const price = Number(i.price_myr);
      return {
        name: i.name.trim().slice(0, 120),
        quantity: typeof i.quantity === 'string' ? i.quantity.trim().slice(0, 60) : '',
        price_myr: isFinite(price) && price >= 0 ? price : 0,
      };
    })
    .slice(0, 40);
}

function extractIngredients(data) {
  const outputStep = (data.steps || []).find((s) => s.type === 'model_output');
  const textBlock = outputStep && (outputStep.content || []).find((c) => c.type === 'text');
  if (!textBlock) return [];
  let raw = textBlock.text.trim();
  raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
  try {
    const parsed = JSON.parse(raw);
    return sanitizeIngredients(parsed.ingredients);
  } catch (e) {
    return [];
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
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: 'Invalid request body' }, 400, origin);
    }

    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 2000) : '';
    const hasImage = typeof body.image === 'string' && body.image.length > 0;
    if (!description && !hasImage) {
      return json({ error: 'Describe the dish or attach a photo first.' }, 400, origin);
    }

    if (!env.GEMINI_API_KEY) {
      return json({ error: 'Server is missing its Gemini key \u2014 add the GEMINI_API_KEY secret in this Worker\u2019s Settings.' }, 500, origin);
    }

    const input = [{ type: 'text', text: PROMPT_PREFIX + (description ? ' Description: ' + description : '') }];
    if (hasImage) {
      input.push({
        type: 'image',
        data: body.image,
        mime_type: typeof body.mime_type === 'string' ? body.mime_type : 'image/jpeg',
      });
    }

    let geminiResp;
    try {
      geminiResp = await fetch(GEMINI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          input,
          generation_config: { thinking_level: 'low' },
          response_format: { type: 'text', mime_type: 'application/json', schema: INGREDIENT_SCHEMA },
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
      } catch (e) { /* leave detail empty */ }
      detail = detail.slice(0, 500);
      console.error('[Menu Calculator Proxy] Gemini error', geminiResp.status, detail);
      return json({ error: 'Gemini error ' + geminiResp.status + (detail ? ': ' + detail : '') }, geminiResp.status, origin);
    }

    const data = await geminiResp.json();
    const ingredients = extractIngredients(data);
    const total = ingredients.reduce((sum, i) => sum + i.price_myr, 0);
    return json({ ingredients, total_ingredient_cost_myr: total }, 200, origin);
  },
};
