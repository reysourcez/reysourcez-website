# Crypto Radar — Setup & Reference

Three files, one job each:

| File | Runs where | What it does |
|---|---|---|
| `crypto-radar.html` | Visitor's browser | The page itself — structure + styling |
| `crypto-radar.js` | Visitor's browser | All page logic: indicator math, charts, rendering |
| `crypto-radar-worker.js` | Cloudflare (your account) | The only thing allowed to hold API keys |

Drop the first two into the same folder as `index.html`, `styles.css`, `nav-dropdown.js` etc. on your site. The Worker is deployed separately, to Cloudflare — see below.

## Works right now, no setup

Open `crypto-radar.html` as-is (locally or once uploaded) and it runs immediately on **demo data** — a small set of representative coins with synthetic but realistic-looking price history, clearly labelled "Demo data" in the status pill at the top. Every chart, indicator, the confluence score, glossary, and layout are fully functional in this mode. This is so you (or anyone reviewing the page) can see the whole thing working before doing any deployment.

## What needs the Worker

Three things need a real backend, because they either require a secret key or would otherwise hit CORS/rate-limit walls if called straight from a browser:

1. **Real Luno prices & candle history** (instead of demo numbers)
2. **Live news headlines**
3. **AI insight** (Gemini-generated plain-English read of a coin)

Without the Worker connected, the page still works — it just says so honestly instead of pretending.

## Deploying the Worker (no command line needed)

1. Create a free account at **[dash.cloudflare.com](https://dash.cloudflare.com)** if you don't have one.
2. In the dashboard: **Workers & Pages → Create → Create Worker**. Give it any name (e.g. `crypto-radar-worker`) and deploy the default "Hello World" template first.
3. Click **Edit code**, delete everything in the editor, and paste in the entire contents of `crypto-radar-worker.js`. Click **Deploy**.
4. Go to the Worker's **Settings → Variables and Secrets**. Add these as **Secret** (not plain text) variables:
   - `LUNO_KEY_ID` and `LUNO_KEY_SECRET` — see below for how to get these
   - `GEMINI_API_KEY` — see below
   - Optionally `ALLOWED_ORIGIN` (e.g. `https://reysourcez.com`) once the page is live on your real domain — until then it defaults to allowing any origin, which is fine for testing but worth tightening later
5. Copy the Worker's URL (shown at the top of its dashboard page, looks like `https://crypto-radar-worker.yourname.workers.dev`).
6. Open `crypto-radar.html`, paste that URL into the **Cloudflare Worker URL** field at the top of the page, click **Save & connect**. The status pill should switch from "Demo data" to "Live — Luno API".

*(Prefer the command line? `wrangler deploy crypto-radar-worker.js` then `wrangler secret put LUNO_KEY_ID` etc. does the same thing.)*

### Getting a Luno API key

1. Log into your Luno account → **Settings → API Keys**.
2. Create a new key. **Give it read-only permission only** — this dashboard never needs to place trades or move funds, so there is no reason for the key to be able to. If Luno ever asks which permissions to grant, decline anything beyond "Perm_R_Balance" / read-only market data equivalents.
3. Copy the Key ID and Secret immediately — Luno shows the secret once.

### Getting a Gemini API key (free)

1. Go to **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)**, sign in with a Google account, click **Create API key**. No card required for the free tier.
2. The Worker defaults to a free-tier Flash model. Google renames these occasionally — if `/api/insight` starts failing, check **[ai.google.dev](https://ai.google.dev)** for the current free-tier model name and update the single `GEMINI_MODEL` line in the Worker (or set it as a plain variable in the dashboard, no redeploy needed).

## Settings you can change without touching code

The Worker URL is entered on the page itself (Settings bar at the top) — everything else lives in the `CONFIG` block at the very top of `crypto-radar.js`:

| Setting | Current value | What to change it to |
|---|---|---|
| `SITE_NAME` | `Crypto Radar` | Any text — shown in the browser tab |
| `DEFAULT_REFRESH_SECONDS` | `30` | Any number of seconds, or `0` for no auto-refresh |
| `DEFAULT_TIMEFRAME` | `86400` (1 day) | One of: 60, 300, 900, 1800, 3600, 10800, 14400, 86400, 259200, 604800 |
| `SUPPORT_RESISTANCE_SENSITIVITY` | `3` | Lower = more (noisier) levels found; higher = fewer, stronger ones |
| `ORDER_BLOCK_SWING_LOOKBACK` | `10` | Candles checked each side to confirm a genuine swing high/low for demand/supply zones |
| `ORDER_BLOCK_IMPULSE_MULT` | `1.5` | How much bigger than average the breakout candle must be to count as a real zone |
| `REGIME_ADX_THRESHOLD` | `25` | ADX needed for the Trend Regime badge to say "Strong" rather than plain Bull/Bear |
| `CANDLE_LOOKBACK_COUNT` | `220` | Candles fetched per timeframe. Keep at 200+ — SMA 200 can't compute below that |
| `NEWS_HEADLINE_COUNT` | `15` | Any number |
| `INDICATOR_WEIGHTS` | see file | Any indicator's contribution to the confluence score — all visible and editable, none hidden |

## Honest limitations (please read before trusting a number on this page)

- **Not financial advice, and not a prediction tool.** Every indicator here describes *past* price action. The confluence score, entry zone, and TP zone are a structured way of reading the chart faster — nobody, including this dashboard, can reliably call a market bottom or top in advance.
- **Thin coins give noisier signals.** A handful of MYR pairs on Luno trade at very low volume — the page flags these as "Thin" liquidity, and indicator readings there deserve less confidence than the same reading on Bitcoin or Ethereum.
- **Fear & Greed is market-wide, not per-coin.** There's no standard per-altcoin equivalent — it's shown as overall crypto sentiment context, not a signal about the specific coin you're viewing.
- **Candle history depth varies by pair.** Newer or smaller listings may not have as much history as Bitcoin/Ethereum, especially at longer timeframes — the page will tell you if there isn't enough history yet to trust every indicator.
- **News matching is by keyword, not guaranteed relevance.** Headlines are general crypto news, not filtered per-coin — the AI insight does its best to flag genuinely relevant ones but can miss or over-attribute.
- **The RSS reader is intentionally simple.** It reads standard `<item>` blocks; if a feed changes its format, that one source just quietly contributes fewer headlines rather than breaking the News panel.

## Jargon dictionary

*(Same wording as the Glossary section on the page itself — kept here too so it's available offline or if you want to hand this file to someone else.)*

- **RSI (Relative Strength Index)** — 0–100 gauge of how fast/far price has moved recently. Below 30 = oversold, above 70 = overbought; a strong trend can stay "overbought" a long time, so treat it as a caution flag, not a timer.
- **MACD** — Compares a fast and slow moving average to gauge momentum. Line crossing above its signal = momentum turning up; below = turning down.
- **SMA / EMA** — Simple / Exponential Moving Average. Smoothed average price; EMA reacts faster to recent candles.
- **Bollinger Bands** — A moving average with bands two standard deviations above/below it. Price near the lower band suggests weakness (or a bounce setup); near the upper, strength (or overextension).
- **Fibonacci Retracement** — Horizontal lines at standard ratios between a recent swing high and low, watched by many traders as pullback zones.
- **Stochastic Oscillator** — Compares today's close to the recent high-low range, 0–100. Below 20 oversold, above 80 overbought.
- **OBV (On-Balance Volume)** — Running total that adds volume on up-closes, subtracts on down-closes. Disagreement with price (divergence) is often read as a warning.
- **Ichimoku Cloud** — Five lines built from recent highs/lows sketching trend, momentum, and support/resistance together.
- **ADX** — Trend *strength* (not direction). Below 20 = little real trend; above 25 = a trend worth respecting. Paired with +DI/-DI for direction.
- **Parabolic SAR** — Dots that flip sides on trend reversal; a visual trailing-stop reference.
- **VWAP** — Volume-weighted average price; a fair-value reference for the session.
- **ATR** — Typical price movement per candle, in price units — useful for sizing stops/targets to how much a coin actually moves.
- **CMF (Chaikin Money Flow)** — Estimates buying vs selling pressure from where each candle closes in its range. Above 0 = accumulation, below 0 = distribution.
- **Fear & Greed Index** — Daily 0–100 sentiment reading for the crypto market overall (not per-coin), from alternative.me.
- **Support / Resistance** — Price levels where the chart has previously turned, found by clustering past swing highs/lows.
- **Confluence score** — This dashboard's own summary: a transparent, weighted vote across every indicator above, −100 to +100. A read of *now*, not a forecast.
- **Liquidity** — How much genuine buying/selling is happening. Thin liquidity = price can sit still even as indicators update — trust signals less here.
- **Order book (bid/ask)** — Live buy orders (bids) and sell orders (asks) waiting to fill.
- **HTF Pivot** — Classic pivot point ((prior day's high+low+close)÷3), used as a bias line no matter which timeframe tab is open.
- **EMA Cross (21/55)** — % gap between the 21- and 55-period EMA; widening suggests an accelerating trend, near-zero suggests convergence.
- **MA ribbon (21/50/55/89/144/200)** — Several moving averages shown together; price stacked cleanly above all of them (shortest to longest) reads as a healthy uptrend, a tangled ribbon reads as choppy.
- **Trend Regime** — A second, simpler summary next to the Confluence score: a plain vote count across 10 MA/trend checks (bullish/bearish/neutral) plus a label. Deliberately kept separate — when it disagrees with the Confluence score, that's worth noticing, not a bug.
- **Order zones (demand/supply)** — This dashboard's own reading of the ICT/Smart-Money-Concepts "order block" idea: the last candle opposite in colour to a move that breaks a recent swing high/low. No single official formula exists for this; independent sources suggest ~60–75% reaction rates with added confluence, close to a coin flip alone — treat marketed "80%+" claims with skepticism.

## Proposed next additions (not built yet — flagging for your call)

These were left out of this version on purpose, to keep the first build reviewable rather than guessing at scope you didn't ask for:

- **Price alerts** — browser notification when a coin crosses a support/resistance level or confluence threshold
- **Backtesting** — running the confluence score against historical data to see how it would have performed, so its usefulness is measured rather than assumed
- **Candlestick-style charts** — the current price chart is a line chart; true OHLC candles are a visual upgrade, not a functional one
- **Portfolio view** — if you connect a Luno key with balance-read permission, showing your actual holdings alongside the analysis (bigger security surface, so flagging rather than assuming)
- **CoinMarketCal integration** — a dedicated crypto events calendar (product launches, unlocks, listings) exists as a free-tier API; left out for now since the AI insight already surfaces relevant news, but a dedicated events feed would be more structured
