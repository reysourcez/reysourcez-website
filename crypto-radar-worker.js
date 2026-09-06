/*
 * Crypto Radar Worker — deploy this to Cloudflare Workers.
 * See SETUP_AND_GLOSSARY.md for step-by-step deployment instructions.
 *
 * WHY THIS EXISTS (read this before changing anything):
 * Luno's candle/history endpoint requires an authenticated API key+secret,
 * and Gemini needs its own key — neither can ever be pasted into
 * crypto-radar.html or crypto-radar.js, because anything in those files is
 * visible to every visitor's browser (view-source, devtools, anyone).
 * This Worker is the only place those secrets live, as Cloudflare
 * environment variables (set via `wrangler secret put`, never committed to
 * the repo). Same pattern as Food Worth's Gemini proxy elsewhere on this
 * site — this file is that pattern's crypto-radar sibling, not a new idea.
 *
 * Required secrets (set with `wrangler secret put NAME`):
 *   LUNO_KEY_ID        - Luno API key ID (read-only permission is enough)
 *   LUNO_KEY_SECRET    - Luno API key secret
 *   GEMINI_API_KEY     - Google AI Studio key (free tier: aistudio.google.com/apikey)
 * Optional (set with `wrangler secret put NAME` or as a plain var in wrangler.toml):
 *   ALLOWED_ORIGIN     - your site's origin, e.g. https://reysourcez.com
 *                        (defaults to "*" so this works before you've deployed
 *                        the page anywhere — tighten this once you have a domain)
 *   GEMINI_MODEL       - defaults to "gemini-flash-lite-latest" (free tier).
 *                        If Google renames/retires it, check ai.google.dev
 *                        and update this one line — nothing else changes.
 */

const DEFAULT_GEMINI_MODEL = 'gemini-flash-lite-latest';

// Whitelists — every value the browser can pass in is checked against one
// of these before it touches an upstream call. This is the main defence
// against someone using this Worker's URL to hit arbitrary endpoints or
// blow through your Luno/Gemini quota with junk requests.
const VALID_DURATIONS = new Set([60, 300, 900, 1800, 3600, 10800, 14400, 86400, 259200, 604800]);
const PAIR_RE = /^[A-Z0-9]{2,8}MYR$/;

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, env, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

function lunoAuthHeader(env) {
  return 'Basic ' + btoa(`${env.LUNO_KEY_ID}:${env.LUNO_KEY_SECRET}`);
}

// Every upstream call goes through here so one flaky source (a slow RSS
// feed, Luno hiccuping) can't hang or crash the whole response — errors are
// caught, logged server-side only, and surfaced to the browser as a plain
// {error: "..."} the UI already knows how to show inline instead of crashing.
async function safeFetch(url, options, label) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      console.log(`[${label}] upstream ${res.status}`);
      return { ok: false, error: `${label} returned ${res.status}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err) {
    console.log(`[${label}] fetch failed:`, err.message);
    return { ok: false, error: `${label} unreachable` };
  }
}

// ---- Route handlers ----------------------------------------------------

// Public Luno data — no auth needed on Luno's side, but still proxied
// (rather than called directly from the browser) so responses can be
// cached at the edge and combined into one call instead of several.
async function handleMarkets(env) {
  const cache = caches.default;
  const cacheKey = new Request('https://cache.internal/markets');
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const result = await safeFetch('https://api.luno.com/api/1/tickers', {}, 'Luno tickers');
  if (!result.ok) return json({ error: result.error }, env, 502);

  const myrPairs = (result.data.tickers || []).filter(t => PAIR_RE.test(t.pair));
  const payload = { updatedAt: Date.now(), markets: myrPairs };
  const response = json(payload, env);
  response.headers.set('Cache-Control', 'public, max-age=15');
  await cache.put(cacheKey, response.clone());
  return response;
}

async function handleOrderbook(env, pair) {
  if (!PAIR_RE.test(pair)) return json({ error: 'Unrecognised pair' }, env, 400);
  const result = await safeFetch(`https://api.luno.com/api/1/orderbook_top?pair=${pair}`, {}, 'Luno order book');
  if (!result.ok) return json({ error: result.error }, env, 502);
  return json(result.data, env);
}

// Authenticated candle data — the whole reason this Worker has to exist.
async function handleCandles(env, pair, duration, since) {
  if (!PAIR_RE.test(pair)) return json({ error: 'Unrecognised pair' }, env, 400);
  if (!VALID_DURATIONS.has(duration)) return json({ error: 'Unsupported timeframe' }, env, 400);
  if (!env.LUNO_KEY_ID || !env.LUNO_KEY_SECRET) {
    return json({ error: 'Worker is missing LUNO_KEY_ID / LUNO_KEY_SECRET — see SETUP_AND_GLOSSARY.md' }, env, 500);
  }
  const cacheKey = new Request(`https://cache.internal/candles/${pair}/${duration}/${since}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const url = `https://api.luno.com/api/exchange/1/candles?pair=${pair}&duration=${duration}&since=${since}`;
  const result = await safeFetch(url, { headers: { Authorization: lunoAuthHeader(env) } }, 'Luno candles');
  if (!result.ok) return json({ error: result.error }, env, 502);

  const response = json(result.data, env);
  // Shorter timeframes go stale faster — cache proportionally so a 1m chart
  // still feels live while a 1w chart isn't re-fetched every few seconds.
  const ttl = Math.max(10, Math.min(300, Math.floor(duration / 12)));
  response.headers.set('Cache-Control', `public, max-age=${ttl}`);
  await cache.put(cacheKey, response.clone());
  return response;
}

async function handleFearGreed(env) {
  const cache = caches.default;
  const cacheKey = new Request('https://cache.internal/feargreed');
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const result = await safeFetch('https://api.alternative.me/fng/?limit=1', {}, 'Fear & Greed');
  if (!result.ok) return json({ error: result.error }, env, 502);

  const latest = result.data.data && result.data.data[0];
  const payload = latest
    ? { value: Number(latest.value), classification: latest.value_classification, updatedAt: Number(latest.timestamp) * 1000 }
    : { error: 'No data returned' };
  const response = json(payload, env);
  response.headers.set('Cache-Control', 'public, max-age=1800');
  await cache.put(cacheKey, response.clone());
  return response;
}

// Very small hand-rolled RSS reader — good enough for standard <item> feeds,
// not a general XML parser. If a feed changes its structure this quietly
// returns fewer items rather than throwing, so one bad feed can't break news
// for everyone (see the Promise.allSettled below).
function parseRss(xml, sourceName, limit = 8) {
  const items = [];
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  const grab = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (!m) return '';
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').replace(/<[^>]+>/g, '').trim();
  };
  const matches = xml.match(itemRe) || [];
  for (const block of matches.slice(0, limit)) {
    const title = grab(block, 'title');
    const link = grab(block, 'link');
    const pubDate = grab(block, 'pubDate');
    if (title && link) items.push({ title, link, pubDate, source: sourceName });
  }
  return items;
}

async function handleNews(env) {
  const cache = caches.default;
  const cacheKey = new Request('https://cache.internal/news');
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const feeds = [
    { url: 'https://cointelegraph.com/rss', name: 'Cointelegraph' },
    { url: 'https://www.theblock.co/rss.xml', name: 'The Block' },
  ];
  const results = await Promise.allSettled(feeds.map(async f => {
    const res = await fetch(f.url, { headers: { 'User-Agent': 'CryptoRadar/1.0 (+reysourcez.com)' } });
    if (!res.ok) throw new Error(`${f.name} ${res.status}`);
    return parseRss(await res.text(), f.name);
  }));

  let items = [];
  const failedSources = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items = items.concat(r.value);
    else failedSources.push(feeds[i].name);
  });
  items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const payload = { updatedAt: Date.now(), items: items.slice(0, 15), failedSources };
  const response = json(payload, env);
  response.headers.set('Cache-Control', 'public, max-age=600');
  await cache.put(cacheKey, response.clone());
  return response;
}

// AI insight — takes the indicator snapshot the browser already computed
// (this Worker never recomputes indicators or sees raw account data) and
// asks Gemini to phrase it in plain language. The prompt explicitly forbids
// price predictions and specific buy/sell instructions — the goal is a
// clearer read of the confluence score that's already on screen, not a
// second, competing source of "advice".
async function handleInsight(env, body) {
  if (!env.GEMINI_API_KEY) {
    return json({ error: 'Worker is missing GEMINI_API_KEY — see SETUP_AND_GLOSSARY.md' }, env, 500);
  }
  const { pair, snapshot, headlines } = body || {};
  if (!pair || typeof snapshot !== 'object') return json({ error: 'Missing pair or snapshot' }, env, 400);

  const prompt = `You are a neutral market-data narrator for a personal crypto dashboard (Luno Malaysia, ${pair}, prices in MYR).
Given this indicator snapshot: ${JSON.stringify(snapshot)}
And these recent headlines (may be unrelated to this specific coin): ${JSON.stringify((headlines || []).slice(0, 5))}

Write 3-4 short sentences in plain English:
1. What the indicators collectively suggest right now (trend, momentum, overbought/oversold) — describe what IS, don't predict what's next.
2. One thing worth watching (e.g. proximity to a support/resistance level, low liquidity, conflicting signals).
3. If any headline is clearly relevant to this coin, mention it in one clause.
Hard rules: never state a price target, never say "buy" or "sell", never claim certainty about future price direction. This is a read of current data, not advice.`;

  const model = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
  const result = await safeFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 220 },
    }),
  }, 'Gemini');
  if (!result.ok) return json({ error: result.error }, env, 502);

  const text = result.data?.candidates?.[0]?.content?.parts?.[0]?.text
    || 'Gemini did not return a summary this time — the indicator scorecard above is still fully computed without it.';
  return json({ pair, text, model }, env);
}

// ---- Router --------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    try {
      if (url.pathname === '/api/markets') return await handleMarkets(env);

      if (url.pathname === '/api/orderbook') {
        return await handleOrderbook(env, (url.searchParams.get('pair') || '').toUpperCase());
      }

      if (url.pathname === '/api/candles') {
        const pair = (url.searchParams.get('pair') || '').toUpperCase();
        const duration = parseInt(url.searchParams.get('duration') || '0', 10);
        const since = parseInt(url.searchParams.get('since') || '0', 10) || (Date.now() - 90 * 86400000);
        return await handleCandles(env, pair, duration, since);
      }

      if (url.pathname === '/api/feargreed') return await handleFearGreed(env);
      if (url.pathname === '/api/news') return await handleNews(env);

      if (url.pathname === '/api/insight' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        return await handleInsight(env, body);
      }

      if (url.pathname === '/api/health') {
        return json({
          ok: true,
          hasLunoKeys: Boolean(env.LUNO_KEY_ID && env.LUNO_KEY_SECRET),
          hasGeminiKey: Boolean(env.GEMINI_API_KEY),
        }, env);
      }

      return json({ error: 'Unknown endpoint. See SETUP_AND_GLOSSARY.md for the route list.' }, env, 404);
    } catch (err) {
      // Last-resort catch: never let a raw error (which could include
      // stack traces or, in principle, internal details) reach the browser.
      console.log('Unhandled Worker error:', err.message);
      return json({ error: 'Something went wrong on the Worker side.' }, env, 500);
    }
  },
};
