# Crypto Radar — Setup & Reference

**Version: suite v2.8** (this guide v2.8; Relationship study v1.0 added). Filenames stay the same on purpose, because about ten navigation links point at them: the version lives in each file's header, in the text on the page, and in the `?v=` number after the script name.

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
6. Open `crypto-radar.js`, find `WORKER_URL: ''` right at the top in the `CONFIG` block, and paste the URL in between the quotes. Save, re-upload that one file. The status pill on the page should switch from "Demo data" to "Live — Luno API" for every visitor, not just you — there's no per-visitor setup step.

*(Prefer the command line? `wrangler deploy crypto-radar-worker.js` then `wrangler secret put LUNO_KEY_ID` etc. does the same thing.)*

### Getting a Luno API key

1. Log into your Luno account → **Settings → API Keys**.
2. Create a new key. **Give it read-only permission only** — this dashboard never needs to place trades or move funds, so there is no reason for the key to be able to. If Luno ever asks which permissions to grant, decline anything beyond "Perm_R_Balance" / read-only market data equivalents.
3. Copy the Key ID and Secret immediately — Luno shows the secret once.

### Getting a Gemini API key (free)

1. Go to **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)**, sign in with a Google account, click **Create API key**. No card required for the free tier.
2. The Worker defaults to a free-tier Flash model. Google renames these occasionally — if `/api/insight` starts failing, check **[ai.google.dev](https://ai.google.dev)** for the current free-tier model name and update the single `GEMINI_MODEL` line in the Worker (or set it as a plain variable in the dashboard, no redeploy needed).

## Settings you can change without touching code

Every one of these — including the Worker URL — lives in the `CONFIG` block at the very top of `crypto-radar.js`. One edit applies to every visitor; there's no separate setup per browser or per person:

| Setting | Current value | What to change it to |
|---|---|---|
| `SITE_NAME` | `Crypto Radar` | Any text — shown in the browser tab |
| `WORKER_URL` | (empty) | Your deployed Worker's URL, e.g. `https://crypto-radar-worker.yourname.workers.dev`. Empty = demo data |
| `DEFAULT_REFRESH_SECONDS` | `30` | Any number of seconds, or `0` for no auto-refresh |
| `DEFAULT_TIMEFRAME` | `86400` (1 day) | One of: 60, 300, 900, 1800, 3600, 10800, 14400, 86400, 259200, 604800 |
| `SUPPORT_RESISTANCE_SENSITIVITY` | `3` | Lower = more (noisier) levels found; higher = fewer, stronger ones |
| `ORDER_BLOCK_SWING_LOOKBACK` | `10` | Candles checked each side to confirm a genuine swing high/low for demand/supply zones |
| `ORDER_BLOCK_IMPULSE_MULT` | `1.5` | How much bigger than average the breakout candle must be to count as a real zone |
| `REGIME_ADX_THRESHOLD` | `25` | ADX needed for the Trend Regime badge to say "Strong" rather than plain Bull/Bear |
| `CANDLE_LOOKBACK_COUNT` | `220` | Candles fetched per timeframe. Keep at 200+ — SMA 200 can't compute below that |
| `CHART_VISIBLE_CANDLES` | `90` | How many recent candlesticks the chart draws at once. Indicators still use the full history above |
| `LIQUIDITY_MULTIPLIERS` | `1.0 / 0.7 / 0.45` | How much confluence is discounted for Active/Medium/Thin coins — see "Blended score" below |
| `GOLD_STAR_COUNT` | `5` | How many coins (by blended score, across all tiers) get a gold star |
| `NEWS_HEADLINE_COUNT` | `15` | Any number |
| `INDICATOR_WEIGHTS` | see file | Any indicator's contribution to the confluence score — all visible and editable, none hidden |

## Coin icons (optional — falls back gracefully without them)

The coin grid looks for an icon at `icons/{symbol}.svg` (lowercase, no MYR suffix — e.g. `icons/btc.svg`, `icons/ankr.svg`). If that file 404s, the page shows a coloured monogram badge instead — no broken-image icon, no console spam, nothing to configure. So this step is entirely optional and safe to skip.

To add real logos:
1. Grab **[computationalcore/cryptocurrency-icons](https://github.com/computationalcore/cryptocurrency-icons)** (a continuation of the well-known `spothq` set) — **CC0-licensed**, so no attribution is required, which matters for a commercial site.
2. Copy its `svg/color/` folder into your repo as a top-level `icons/` folder (so `svg/color/btc.svg` becomes `icons/btc.svg`).
3. Deploy — nothing else to wire up, the page already looks in that exact location.

Luno lists some coins this pack won't have an icon for (new or very small listings) — those just show the monogram badge, which is expected, not a bug.

## Honest limitations (please read before trusting a number on this page)

- **Not financial advice, and not a prediction tool.** Every indicator here describes *past* price action. The confluence score, entry zone, and TP zone are a structured way of reading the chart faster — nobody, including this dashboard, can reliably call a market bottom or top in advance.
- **Thin coins give noisier signals.** A handful of MYR pairs on Luno trade at very low volume — the page flags these as "Thin" liquidity, and indicator readings there deserve less confidence than the same reading on Bitcoin or Ethereum. The blended score (below) is this dashboard's attempt to correct for that — but the exact discount factors are a judgment call, not a scientifically derived constant. They're deliberately visible and tunable in `CONFIG` rather than presented as a settled formula.
- **Fear & Greed is market-wide, not per-coin.** There's no standard per-altcoin equivalent — it's shown as overall crypto sentiment context, not a signal about the specific coin you're viewing.
- **Candle history depth varies by pair.** Newer or smaller listings may not have as much history as Bitcoin/Ethereum, especially at longer timeframes — the page will tell you if there isn't enough history yet to trust every indicator.
- **News matching is by keyword, not guaranteed relevance.** Headlines are general crypto news, not filtered per-coin — the AI insight does its best to flag genuinely relevant ones but can miss or over-attribute.
- **The RSS reader is intentionally simple.** It reads standard `<item>` blocks; if a feed changes its format, that one source just quietly contributes fewer headlines rather than breaking the News panel.

## Backtest page and the Relationship study (suite v2.8)

The backtest page (`crypto-radar-backtest.html`) tests ideas on Luno's own history. Suite v2.8 adds a **Relationship study** at the bottom of that page: *do alt coins move with or against Bitcoin, the Nasdaq and the S&P 500?* It only describes the past. It never creates a buy or sell rule, and it cannot pass or fail the strict test higher up the page.

| File | Version | Where it runs | Changed in v2.8? |
|---|---|---|---|
| `crypto-radar-backtest.html` | page v1.6 + big movers v1.2 + relationships v1.0 | your browser | **yes: upload** |
| `crypto-radar-relations.js` | Relationship study v1.0 | your browser | **new: upload** |
| `crypto-radar-backtest.js` | v1.6 | your browser | no |
| `crypto-radar-bigmovers.js` | v1.2 | your browser | no |
| `crypto-radar.js` | v2.0 | your browser | no |
| `crypto-radar-worker.js` | v2.1 | Cloudflare | no, **do not redeploy** |
| `crypto-radar-tests.js`, `crypto-radar-browser-smoke.js` | v2.8 | a developer's computer only | checking tools, not part of the site |

(The two older scripts still print "suite v2.7" in their own result boxes. They did not change, so they keep their old label on purpose.)

### Put it on your site

1. Upload `crypto-radar-backtest.html` (replace the old one) and `crypto-radar-relations.js` (new) to the same folder as your other Crypto Radar files.
2. Leave everything else alone: no Worker redeploy, and no need to re-upload the other scripts.
3. Open the backtest page. The small line at the top should say **Relationships v1.0 (suite v2.8)**. If it still says v2.7, your browser is showing an old copy: press Ctrl+F5 (Windows) or Cmd+Shift+R (Mac).

### Get the two stock files (free, about two minutes)

1. Go to **fred.stlouisfed.org** and search for **NASDAQCOM** (Nasdaq Composite, daily history from 1971). Open it, click **Download** above the chart and choose **CSV**. Save the file somewhere you can find it.
2. Do the same for **SP500** (S&P 500). FRED only carries about the last 10 years of it, which is normal.
3. FRED's own help page (checked 2026-10-15) says: click the **Download** button above the graph, then choose one of the options, which it lists as Excel, CSV, Image and PowerPoint. FRED may change the wording later; any CSV with one date column and one value column works, and so does a daily export from TradingView. If the page cannot read a file it says what it saw in it. After a run, the results show each file's first and last day: if a file covers fewer years than you expected, set the chart to its longest date range and download again.
4. Closed days (holidays) may appear as a "." or as an empty cell in FRED's file (the layout of the file itself was not checked). The page skips both by itself.

### Run it

1. Scroll to **Relationship study** on the backtest page.
2. Under **Nasdaq Composite CSV** choose the NASDAQCOM file; under **S&P 500 CSV** choose the SP500 file. Both boxes are optional: with no file, the page still compares the alts with Bitcoin.
3. Leave **Coins** on **All** (best) and click **Run relationship study**.
4. Wait. The first run takes a minute or two while it downloads each coin's daily history through your Worker. It says **Done** when finished. A second run on the same page reuses that history for 30 minutes.
5. Read the sentence at the top, then the table under it. Then copy everything in the box under the results (**Copy results for Claude**) and paste it into the chat.

### How to read the answer

- **The sentence at the top** says, for each comparison, either the link and how strong it is, or "no clear link".
- **The table has 11 rows.** A row only says "together" or "opposite" when its range of doubt stays clear of zero over the whole history **and** in both the earlier 60% and the later 40%. Otherwise it says "no clear link", "clear overall but not in both halves", or "flips sign between the halves".
- **"Bitcoin first, alts 1 day later"** is the only kind of link that could ever give advance notice. "Same day" and "same window" links only tell you the two move together, and you learn that after the fact.
- **"Does it hold over time?"** shows how often the link stays above +0.2, in between, or below -0.2 when re-measured over every 90-window stretch, so you can see a link that comes and goes.
- Lags outside the 11 judged rows are shown for reference only and are never called a finding.

### Before you believe a number

- A link between two things is not proof that one causes the other, and it is **not a forecast**. Links also change over time: the published studies found stock links near zero before 2020, about 0.36 in 2020-21, and reportedly near zero again in 2025 (see `claude/CRYPTO_RADAR_RESEARCH.md` in the Project for what was checked and what was not).
- **Thin coins** trade rarely, so their last price can lag Bitcoin's by a day through staleness alone. A next-day link on thin coins is not proof that Bitcoin leads.
- Only coins **listed on Luno today** are tested. Coins that died are missing, which flatters every result.
- Coins tend to move together, so 50 coins are not 50 separate pieces of evidence. That is why the page uses one **alt basket** (the average alt) instead of 50 separate answers.
- **Stock-index data belong to their owners** (S&P and Nasdaq; FRED shows their notices). Use the files for your own analysis only. The page reads them inside your browser and sends them nowhere. The only network calls it makes go to your own Worker.
- The stock timing assumes a Luno daily candle starts at **00:00 UTC**. Luno's documents do not confirm that, so the page checks the candles it receives and prints a warning under the results if they start at another time.

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
- **Liquidity / Active / Medium / Thin** — How much genuine buying/selling is happening, ranked by MYR-notional 24h volume (price × volume — not raw volume, which isn't comparable across coins priced wildly differently) and split into three even groups. Thin liquidity = price can sit still even as indicators update, and momentum indicators swing to extremes more easily on noise alone — trust signals less here.
- **Blended score** — Confluence score × a liquidity discount (Active ≈1.0, Medium ≈0.7, Thin ≈0.45). This is what the coin grid actually sorts and gold-stars by, not raw confluence — a thin coin needs a much more lopsided reading to rank alongside an active one with a moderate reading. Shown big on each coin card; the smaller "Bu55/100 · Active" line underneath is the *undiscounted* raw confluence plus the tier it came from.
- **Order book (bid/ask)** — Live buy orders (bids) and sell orders (asks) waiting to fill.
- **HTF Pivot** — Classic pivot point ((prior day's high+low+close)÷3), used as a bias line no matter which timeframe tab is open.
- **EMA Cross (21/55)** — % gap between the 21- and 55-period EMA; widening suggests an accelerating trend, near-zero suggests convergence.
- **MA ribbon (21/50/55/89/144/200)** — Several moving averages shown together; price stacked cleanly above all of them (shortest to longest) reads as a healthy uptrend, a tangled ribbon reads as choppy.
- **Trend Regime** — A second, simpler summary next to the Confluence score: a plain vote count across 10 MA/trend checks (bullish/bearish/neutral) plus a label. Deliberately kept separate — when it disagrees with the Confluence score, that's worth noticing, not a bug.
- **Order zones (demand/supply)** — This dashboard's own reading of the ICT/Smart-Money-Concepts "order block" idea: the last candle opposite in colour to a move that breaks a recent swing high/low. No single official formula exists for this; independent sources suggest ~60–75% reaction rates with added confluence, close to a coin flip alone — treat marketed "80%+" claims with skepticism.
- **Correlation (r)** — A number from -1 to +1 for how closely two things' daily moves line up. +1 = always the same way, 0 = no link, -1 = always opposite. Under 0.1 negligible, 0.1 to 0.3 weak, 0.3 to 0.5 moderate, above 0.5 strong. It describes a link; it is not proof of cause and not a forecast.
- **Rank correlation (Spearman)** — The same idea worked out on rank order instead of raw sizes, so one huge day cannot dominate. Shown next to r in the "every lag" tables as a cross-check.
- **Lag** — Shifting one series by whole days to ask who moves first. "Bitcoin first, alts 1 day later" is lag +1. Only a lag where the first series is read before the second could ever give advance notice.
- **Alt basket** — The equal-weighted average daily move of every Luno alt coin that traded that day (at least 10 coins needed). Bitcoin, gold tokens, stablecoins and coins with under 60 daily candles are left out.
- **Strict range (strict bar)** — The margin of doubt around r, made wider (z = 2.84 instead of 1.96) because 11 rows are judged at once. A link is only called clear if this range stays clear of zero over the whole history **and** in both halves.
- **Block bootstrap** — How that margin of doubt is worked out: the history is re-shuffled in 10-day chunks 1,000 times (with a fixed seed, so a rerun gives identical numbers). Chunks keep the calm-then-wild streaks real prices have.
- **Earlier 60% / later 40%** — The history split by date. A link has to show in both parts, otherwise it may be a one-period accident.
- **Rolling view ("Does it hold over time?")** — The correlation re-measured over every stretch of 90 windows: the share of stretches above +0.2, in between, and below -0.2.
- **Window (stock rows)** — One stock day matched with the crypto move from the previous stock day's candle close to that day's candle close. A Monday covers the weekend.
- **Stale price** — A thin coin may not trade for hours, so its last price lags the market. That can make it look like it follows Bitcoin a day later when it is just slow.
- **FRED** — The free economic-data website run by the Federal Reserve (fred.stlouisfed.org), where the Nasdaq and S&P 500 daily files come from.

## Proposed next additions (not built yet — flagging for your call)

These were left out of this version on purpose, to keep the first build reviewable rather than guessing at scope you didn't ask for:

- **Price alerts** — browser notification when a coin crosses a support/resistance level or confluence threshold
- **Backtesting** — running the confluence score against historical data to see how it would have performed, so its usefulness is measured rather than assumed *(built since: see the backtest page and the handoff)*
- **Portfolio view** — if you connect a Luno key with balance-read permission, showing your actual holdings alongside the analysis (bigger security surface, so flagging rather than assuming)
- **CoinMarketCal integration** — a dedicated crypto events calendar (product launches, unlocks, listings) exists as a free-tier API; left out for now since the AI insight already surfaces relevant news, but a dedicated events feed would be more structured
