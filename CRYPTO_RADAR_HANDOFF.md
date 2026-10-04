# Crypto Radar — technical handoff

Written 2026-09-11 by the session that built Crypto Radar end-to-end, for whichever
session/person picks it up next. This assumes **no prior context** — everything
needed to understand, extend, or debug this tool is below. Give it to the next AI
alongside `styles.css`, `AI_BUILD_BRIEF.md`, and `NAV_ORDER_STANDARD.md` (the
site-wide conventions) — this doc doesn't repeat those, only what's specific to
this tool.

If anything below turns out to be stale by the time you read it, trust the actual
code over this document — this is a snapshot of intent and reasoning, not a
live source of truth.

---

## 1. Original intention (what R actually asked for)

R runs **Reysourcez Enterprise**, a Sarawak-based F&B business-tools site, and
wanted a personal crypto analysis dashboard for **Luno Malaysia** coins, to
support R's own day-trading and long-term holding decisions. The original ask,
numbered as given:

1. Live news and planned events for all coins available on Luno
2. Scan every coin for: RSI, MACD, SMA, EMA, Bollinger Bands, Fibonacci
   Retracement, Stochastic Oscillator, OBV, Ichimoku Cloud, ADX, Parabolic SAR,
   VWAP, ATR, CMF, and the Crypto Fear & Greed Index
3. Every timeframe, 1 minute to all-time
4. Volume and bid/ask order book depth
5. Support/resistance lines on the chart, for both day trading and long-term
6. Summarize everything, blend indicator signals, surface which coins are worth
   day-trading vs. holding long-term, expressed as a bullish-percentage-style
   read — R explicitly said they only profit in a rally, so the tool needs to
   help find bottoms to enter and highs to exit, not bearish calls
7. A best-guess lowest entry point and next take-profit level
8. Scoped specifically to Luno **Malaysia** listings, not Luno globally
9. Flag coins where 24h volume is so low that price barely moves even though
   the coin shows as "active" in a trading view
10. Surface which coins generally see the most genuine buyer/seller activity
11. Cloudflare Workers and the Gemini API were explicitly pre-approved for use
12. A manual "update" button
13. Clean, boxed visual design for whatever categories the build settled on
14. Freedom to add anything else judged necessary — but proposed and confirmed
    with R first, not silently built in ("KIV" — keep in view)

**Standing behavioral preferences from R** (still active, apply to any future
work on this tool too):
- Act with genuine subject-matter competence, not just surface-level output
- Favor free/low-cost tooling, maintainable architecture, and code a layperson
  could eventually hand off or adjust
- Every meaningful addition should come with a diagram, plain-English
  glossary entries, inline "why" commentary, and an easy-to-find config
  section — **not** buried in logic
- When genuinely ambiguous, ask and confirm rather than guess — R has said
  explicitly they'd rather be asked to clarify a term than have it assumed
- Security matters: no API keys ever reach the browser, no data leaves the
  page except to R's own Worker, nothing executes trades or touches funds
- R does not want to be shown a single confident "right answer" on financial
  questions — every indicator, score, and zone on this dashboard is
  explicitly framed as decision support, never certainty. **This is not
  optional flavor text — do not let future work quietly walk this back.**

---

## 2. Where things stand right now

Fully built and — as of this handoff — passing every test that can be run
without an actual browser (see §8). **Never yet rendered in a real browser by
any AI session**, including this one; there is no browser tool in this
environment. Everything below marked "verified" means verified through node
unit/integration tests against the real shipped code and static structural
checks, not visual confirmation. Say so plainly if a future session also lacks
browser access — don't imply a stronger guarantee than that.

**Works immediately, zero setup**: open `crypto-radar.html` and it runs
entirely on demo data (8 seed coins, synthetic-but-plausible price history),
clearly labelled "Demo data" in the status pill. Every chart, indicator, the
confluence score, tiers, glossary — all fully functional in this mode.

**Needs R's action to go live**: deploying `crypto-radar-worker.js` to
Cloudflare Workers and setting `CONFIG.WORKER_URL` in `crypto-radar.js` (one
line, see `SETUP_AND_GLOSSARY.md`). As of the last conversation, R had done
this and hit a credentials mix-up (used Luno's random-generated Key ID string
as the Cloudflare variable *name* instead of the literal text `LUNO_KEY_ID`) —
walked through the fix; unconfirmed whether it's resolved as of this writing.

---

## 3. Files and what each one does

| File | Runs where | Role |
|---|---|---|
| `crypto-radar.html` | Visitor's browser | Structure + all page-specific CSS (page-scoped, `cr-` prefixed, matching the site's own pattern of each tool owning its own extensions rather than bloating shared `styles.css`) |
| `crypto-radar.js` | Visitor's browser | Everything else: indicator math, demo data, Worker calls, hand-rolled SVG charts, all rendering and event wiring. ~1,280 lines, one file, per `AI_BUILD_BRIEF.md`'s "no build step" rule |
| `crypto-radar-worker.js` | Cloudflare (R's account) | The only place secrets live. Proxies Luno (public + authenticated), news RSS, alternative.me, and Gemini |
| `SETUP_AND_GLOSSARY.md` | Reference doc | Deployment steps, config table, jargon dictionary, icon setup, known limitations |
| `wrangler.toml` | Optional | CLI deploy config, for anyone who prefers `wrangler` over the Cloudflare dashboard editor |

Not part of the deployed site: this handoff file itself, and various
throwaway test scripts used during development (synthetic-data indicator
tests, integration smoke tests) — none of those need to exist in the repo:
they were verification tooling, not product code.

---

## 4. Architecture, and why it's shaped this way

```
Browser (crypto-radar.html + .js)
        |
        v  (all external calls go through here — no direct calls
        |   from the browser to Luno/news/Gemini, ever)
Cloudflare Worker (crypto-radar-worker.js)
   holds: LUNO_KEY_ID, LUNO_KEY_SECRET, GEMINI_API_KEY (Cloudflare Secrets)
        |
        +--> Luno public API (tickers, order book — no auth)
        +--> Luno authenticated API (candles — needs the Luno keys)
        +--> Cointelegraph + The Block RSS (news)
        +--> alternative.me (Fear & Greed Index)
        +--> Google Gemini API (AI-generated plain-English insight)
```

**Why a Worker at all, given "nothing persists / no server" is a site rule**:
Luno's candle endpoint requires an authenticated key+secret. Any credential
placed in a file the browser downloads is visible to every visitor via
view-source — there is no way around a server-side proxy for that one
endpoint. Everything else got routed through the same Worker too, for one
consistent security model, response caching (protects R's Luno/Gemini quota),
and so the frontend has one integration point instead of several.

**Why `CONFIG.WORKER_URL` is hardcoded rather than entered by each visitor**:
originally built as a runtime-entered field (URL query param, no
localStorage, per the site's "nothing persists" rule) because no Worker
existed yet to hardcode. Once R had one, this was recognized as
over-engineered: this is R's *one* Worker serving *all* visitors identically,
not a multi-tenant setup — hardcoding it in `CONFIG` is the more correct
design, not just a shortcut. Changed on request; do not revert to a runtime
field without a real reason to support multiple Workers per visitor.

**Why indicators run over a longer history than the chart displays**:
`CONFIG.CANDLE_LOOKBACK_COUNT` (220) feeds all indicator math — SMA200
mathematically cannot compute on fewer than 200 candles. But drawing 220
candlesticks into a 640px chart is an unreadable smear, so
`CONFIG.CHART_VISIBLE_CANDLES` (90) separately controls what's actually drawn
on screen. `windowSlice()` is the function that applies this split
consistently across all four stacked charts (price/volume/RSI/MACD), which
is also why their x-axes stay aligned to the same date range.

**Why there are two different "how bullish is this" numbers**:
`confluenceScore()` is the primary, *weighted* read (RSI, MACD, Bollinger,
Stochastic, ADX, CMF, OBV, support/resistance — weights visible and editable
in `CONFIG.INDICATOR_WEIGHTS`). `trendRegime()` is a deliberately separate,
simpler *unweighted vote count* across 10 moving-average/trend checks. They
will sometimes disagree — that's treated as meaningful information (shown
side by side), not reconciled into one number. Don't "simplify" this into a
single score without checking with R first; this was a deliberate design
choice made after direct discussion, not an oversight.

**Why the coin grid sorts by "blended score," not confluence or volume
alone**: this was the single most-discussed design decision in the whole
build (see §7 for the full reasoning) — short version: raw confluence on a
thin/illiquid coin is more often volatility noise than genuine conviction,
because a few trades can swing a thin market's price sharply without
reflecting broad demand. `blended = confluence × CONFIG.LIQUIDITY_MULTIPLIERS[tier]`
(Active 1.0 / Medium 0.7 / Thin 0.45) discounts for this. The grid sorts and
gold-stars by blended score, not raw confluence, and not by volume alone.

---

## 5. Complete feature inventory (mapped to the original 14 points)

| # | Original ask | Where it lives now |
|---|---|---|
| 1 | News + events | News: live RSS via Worker (`/api/news`). Events: **not built as a dedicated feature** — see §9 |
| 2 | 14 named indicators | All implemented as pure functions in `crypto-radar.js` (`sma`, `ema`, `rsi`, `macd`, `bollinger`, `stochastic`, `obv`, `atr`, `adx`, `parabolicSar`, `vwap`, `cmf`, `ichimoku`, `fibonacci`), unit-tested against synthetic known-answer data |
| 3 | All timeframes | `CONFIG.TIMEFRAMES` — 1m through 3d, plus "All" (1-week candles). Tabs in the detail view |
| 4 | Volume + bid/ask | Volume: own chart panel + shown per-coin. Order book: `/api/orderbook`, shown as bid/ask columns in the detail view |
| 5 | Support/resistance | `supportResistance()` — fractal pivot clustering, drawn as dashed lines on the price chart |
| 6/7 | Summarize, blend, find entries/TPs | `confluenceScore()` + `trendRegime()` (the two-number system, §4) + `computeWatchZones()` (entry/TP zones — support/Bollinger/Fibonacci blend, drawn as shaded **zones**, never a single confident price) |
| 8 | Luno MY specific | Worker filters tickers to `/^[A-Z0-9]{2,8}MYR$/` — MYR pairs only |
| 9 | Flag thin/low-movement coins | Liquidity tiers (Active/Medium/Thin), ranked by **MYR-notional** volume (see the volume bug in §7 — raw volume isn't comparable across coins) |
| 10 | Volume/activity trend | "Most active" / "Thinnest liquidity" stats on the overview card; full tier breakdown below |
| 11 | Worker + Gemini | Built exactly this way — see §4 |
| 12 | Update button | "Update now" in the settings bar, plus configurable auto-refresh |
| 13 | Clean boxed design | `.cr-box` (own page-scoped class — `styles.css`'s `.calc-panel` turned out to carry zero box styling itself; see §7) |
| 14 | KIV + confirm before adding | Followed literally — every non-trivial addition (candlesticks, order zones, trend regime, the blended-score system, icons, floating nav) was proposed and confirmed with R before being built |

**Beyond the original 14**, added after later rounds of feedback (all
confirmed with R first): real OHLC candlesticks (not a line chart), adaptive
x-axis time labels, entry/TP zones drawn as translucent bands directly on the
chart (not just in text), a Fibonacci-period moving-average ribbon
(21/50/55/89/144/200), an HTF (higher-timeframe) daily pivot bias, an
EMA-cross percentage, order-block demand/supply zones (R's own reading of the
ICT/Smart-Money-Concepts concept — see §7 for why this wasn't a clone of any
paid indicator), a floating quick-nav button cluster (matched from Food
Worth's `#fw-quick-nav` pattern), collapsible glossary/settings sections, and
coin icons with a graceful monogram fallback.

---

## 6. Design system inheritance (why this looks like the rest of the site)

Built from the *real* `styles.css`, `index.html`, `AI_BUILD_BRIEF.md`, and
`food-worth-calculator.html` (the closest architectural sibling — also
proxies a third-party AI call through its own Worker) — not assumed or
guessed. Specifically reuses: Fraunces + IBM Plex Sans/Mono fonts, `--accent`
(#1F6F5C teal), `--surface`/`--paper`/`--line`/`--muted` tokens, `.btn`,
`.tooltip-icon`, `.result-card`, `.calc-intro`, `.calc-panel`, the exact
nav/footer markup, and the `rzInitialized` double-fire guard pattern. Vanilla
JS, no build step, no frameworks, nothing in localStorage — all per
`AI_BUILD_BRIEF.md`'s non-negotiables. Doesn't use `costing-sync.js` — this
tool doesn't exchange cost data with the F&B calculators, and per
`AI_BUILD_BRIEF.md`'s own instruction, a switcher that would do nothing is
worse than no switcher.

**Not yet done**: adding Crypto Radar to the `.nav-dropdown-menu` of the
other ~10 site pages (`index.html`, `about.html`, `services.html`,
`contact.html`, and the other calculator pages). This was started, then
explicitly paused by R to focus on dashboard functionality first — see §9.

---

## 7. Bugs found and fixed — read this before "cleaning up" anything below

Every one of these was a real, reproduced bug, not a style preference. Undoing
any of them without understanding why will reintroduce a real defect.

- **Race condition in `renderDetail()`**: clicking a second coin before the
  first one's fetch resolved could render one coin's title with a completely
  different coin's price/chart data — whichever request happened to resolve
  *last* won, regardless of click order. Fixed with a selection-token guard
  (`state.selectionToken`, bumped per call, checked before every DOM write).
  Verified by simulating the exact slow-first/fast-second scenario.
- **`CANDLE_LOOKBACK_COUNT` was 180, bumped to 220**: SMA200 cannot compute on
  fewer than 200 candles — it was silently `null` forever below that.
- **Volume comparisons were comparing incompatible units across coins**:
  Luno's `rolling_24_hour_volume` is denominated in the *base asset* (XBT
  amount for XBTMYR, DOGE amount for DOGEMYR) — comparing those raw numbers
  directly ranked Dogecoin as more liquid than Bitcoin. Fixed with
  `myrVolume()` (price × volume) for every cross-coin comparison; the site
  still displays each coin's own native-unit volume on its own card, just
  never uses it to *rank against a different coin*.
- **`.calc-panel` isn't a box**: assumed early on that it carried border/
  surface/radius styling. The real `styles.css` shows it's pure vertical
  padding — every real "box" on the site (`.menu-block`,
  `.structure-pie-card`) is its own page-scoped class layered *inside* a
  `.calc-panel`. `.cr-box` is that class here, matching the same recipe
  (10px radius, `1px solid var(--line)`, `var(--surface)` background).
- **`.result-card` sits on `var(--paper)` — the same colour as the page
  background.** Without a `.cr-box` (surface-coloured) wrapper, the Fear &
  Greed strip would have been invisible, not just unstyled.
- **Chart SVGs lacked explicit `width`/`height` attributes** (viewBox alone),
  a known cross-browser soft spot for `width:100%;height:auto` sizing.
  Added as a belt-and-suspenders fix — this was the working *hypothesis* for
  a reported width mismatch, not confirmed as the sole cause since it can't
  be visually verified from this environment.
- **`scaleFns()` inferred x-axis candle count from `values.length`** — fine
  when given one series, wrong when given a *concatenation* of several
  (which both the price chart and MACD chart do, purely to get a combined
  Y-range). This silently compressed every candle into roughly the first
  quarter (price chart) to third (MACD) of the chart width, with the rest
  sitting empty. Fixed by making candle count an explicit, required
  argument, decoupled from whatever array supplies the Y-range. Verified by
  parsing the actual generated SVG output and confirming the rightmost
  candle/bar lands near the right edge, not just checking the formula.
- **Fabricated fallback data on live candle-fetch failure**: `POLMYR` isn't
  in `DEMO_MARKETS_SEED` (which had the pre-rebrand `MATICMYR` — since
  renamed to `POLMYR`, see the seed list itself), so when its live candle
  fetch failed, the old code fell back to a hardcoded `{price: 1000}` seed
  and rendered a **fully-formed, real-looking chart and confluence score
  from a random walk around that fake number** — no error shown anywhere.
  This is the most important one to understand: **a live-mode, per-coin
  data failure must never silently substitute fabricated numbers that look
  real.** Fixed: `loadCandles()` returns `[]` on live failure (never demo
  data), `renderDetail()` branches to an honest "no data" state
  (`clearDetailToNoData()`) before `computeAll()` ever sees an empty array,
  and the actual failure reason (`state.lastCandleError`) is surfaced in the
  message along with a pointer to `/api/health` for self-diagnosis. Audited
  the other three data-loading functions (order book, Fear & Greed, news)
  for the same pattern — all three were already correct (honest empty/null
  on failure), so this was isolated, not systemic.
- **"Scoring…" would say that forever**, even after the overview pass had
  genuinely completed and permanently failed for a coin — misleading, since
  it implies "still in progress." Fixed with `state.overviewScoresComplete`;
  the label only switches to "No data" once a full pass has actually
  finished and still come up empty.
- **Deployment gotcha, not a code bug**: R initially set one Cloudflare
  variable named after Luno's randomly-generated Key ID string, with the API
  secret as its value — but the Worker code looks up `env.LUNO_KEY_ID` and
  `env.LUNO_KEY_SECRET` **by those exact literal names**. Needs *two*
  separate Cloudflare Secrets, named exactly `LUNO_KEY_ID` and
  `LUNO_KEY_SECRET`. `/api/health` (`hasLunoKeys` field) is the fast way to
  confirm this is set correctly — point R or a future session at it before
  assuming a code-level cause for "nothing has data."

---

## 8. Testing discipline established — please continue this pattern

Every fix above was verified with an actual test before being called done,
not just reasoned through. The pattern used throughout, worth continuing:

1. **Extract the real shipped function(s)** from the actual file (regex out
   of `crypto-radar.js`/`crypto-radar-worker.js`) rather than re-typing a
   copy — testing a re-typed version proves nothing about the real code.
2. **Synthetic data with a known correct answer**, not just "does it throw" —
   e.g. a deliberately constructed candle sequence with an order block at a
   known index, asserting the algorithm finds it at *that exact* index, not
   just "finds something."
3. **Cross-check structural integrity after every edit**: every
   `getElementById()` in the JS has a matching `id` in the HTML, no CSS
   class is defined and never used, tags balance. This catches an entire
   class of "looks right, silently broken" bugs (a renamed element ID, a
   removed field the JS still expects) that a syntax checker won't.
4. **For rendering bugs specifically, parse the actual generated SVG
   markup** (regex the `<rect>`/`<path>` coordinates back out) rather than
   trusting the formula alone — the `scaleFns` fix (§7) was verified this
   way, and it's the difference between "the math should be right" and
   "the math is provably right in the real output."
5. **No browser has been available in any session so far.** Say this
   plainly rather than imply stronger confidence than the tests support —
   the tests above are genuinely strong verification of logic and structure,
   but they are not a substitute for R actually opening the page.

---

## 9. Explicitly deferred (discussed with R, not built — R's call when/if)

- **Dedicated events calendar** — CoinMarketCal has a free-tier API for
  this; currently the general news feed + AI insight partially cover "what's
  relevant right now" instead, but it's not a structured events feature
- **Price alerts** — browser notification when a coin crosses a
  support/resistance level or confluence threshold
- **Backtesting** — running the confluence score against historical data to
  measure its actual track record, rather than assuming it's useful
- **Portfolio view** — would need a Luno key with balance-read permission;
  flagged explicitly as a bigger security surface, not assumed to be wanted

**Unfinished, paused mid-task (not just an idea)**: adding Crypto Radar to
the `.nav-dropdown-menu` of the other ~10 site pages, per
`NAV_ORDER_STANDARD.md`'s own rule ("new tool = append to the end," position
7). Was in progress — three of the ten pages' exact current nav blocks had
already been read — when R asked to pause and focus on dashboard feedback
instead. **This is genuinely incomplete, not deferred by choice.** If picking
this back up: re-fetch every page's *current* nav block fresh (don't trust
memory of what it looked like before — several of these files were edited
during the dashboard-feedback rounds too), and follow
`NAV_ORDER_STANDARD.md`'s instruction to replace the whole
`<ul class="nav-dropdown-menu">` block rather than patch individual lines.

---

## 10. What else could be done (this session's own proposals — unconfirmed)

Nothing below has been discussed with R. Propose and confirm before building
any of it, per R's standing KIV preference (§1):

- **Historical accuracy tracking for the confluence score itself** — a
  lighter, ongoing version of backtesting: snapshot the score and the
  price at the time, check back later what actually happened. Doesn't need
  a separate historical dataset, just patience and a place to store
  snapshots (the Worker could hold these in Cloudflare KV cheaply)
- **Two-coin comparison view** — side-by-side confluence/regime/price for
  two coins at once, useful for "which of these two is the better setup"
- **Export a coin's current analysis** — matches the "Save as PDF" pattern
  already used on Menu Calculator and Overhead & Manpower
- **A correlation view** — which coins tend to move together, relevant for
  R not accidentally treating three correlated altcoins as three
  independent bullish signals
- **PWA/installable** — `site.webmanifest` already exists site-wide; Crypto
  Radar could piggyback on it for an "add to home screen" experience,
  relevant given this is meant for active trading use, not just browsing
- **A lightweight accessibility pass** — reasonable ARIA labeling exists
  throughout, but a dedicated keyboard-navigation and screen-reader pass has
  never been done, same "never verified in a real environment" caveat as
  the visual rendering itself
- **Surfacing Worker request volume** — R is on Cloudflare's free tier
  (100k requests/day) and Gemini's free tier; nothing currently tells R how
  close to either limit the page is running, which matters more once this
  gets real daily use

---

## 11. Quick-reference: don't do these without a real reason

- Don't revert `scaleFns()` to inferring candle count from array length
- Don't let `loadCandles()` fall back to fabricated/demo data on a *live-mode*
  per-coin failure — return empty, let the caller show an honest gap
- Don't remove the `state.selectionToken` guard in `renderDetail()`
- Don't add `localStorage`/`sessionStorage` anywhere — site-wide rule,
  breaks in the Claude.ai artifact preview too
- Don't merge `confluenceScore()` and `trendRegime()` into one number
- Don't sort or rank coins by raw `rolling_24_hour_volume` — use
  `myrVolume()`
- Don't present entry/TP/support/resistance as a single precise price —
  they're zones on purpose
- Don't touch the site's global footer (`.footer-grid`) for anything
  related to this tool — it's `display:none` site-wide, nothing to sync


---

## 12. v2.0 changes (2026-10-02) — read with §7 and §9

**Suite versions:** crypto-radar.html v2.0 (loads crypto-radar.js?v=10), crypto-radar.js v2.0, crypto-radar-worker.js v2.0, crypto-radar-backtest.html v1.0, crypto-radar-backtest.js v1.0. Filenames kept stable on purpose (about 10 nav links point at them); version lives in file headers and visible page text.

**Deploy (no coding):** (1) Cloudflare > your Worker > Edit code > paste the new crypto-radar-worker.js > Deploy, then open YOUR-WORKER-URL/api/health and note `cacheWorks` (true/false). (2) Upload the 4 site files next to styles.css, overwriting the old two. (3) Open crypto-radar-backtest.html, press Run backtest, paste the "Copy results" box into chat.

**Review findings (verified by running the real crypto-radar.js on synthetic data; none of it is Luno evidence):** score is trend-follower-dominated (capitulation low -10, mid-uptrend +55, blow-off top +25; at synthetic true bottoms mean -20, bullish only ~9 candles later); edge sign flips by regime (corr -0.14 mean-reverting, +0.05 trending, ~0 random); |score|>=25 on ~60% of random bars; support vote is 0 ~90% of bars and never bearish; grid (60 candles, EMA30) vs detail (220, EMA50) differ by 20+ pts ~10% of the time.

**Fixed in v2.0:** Worker `since` snapped to the candle boundary (candle cache could never hit: ms-precise key); browser candleCache now read (TTL); grid scores closed candles only; "+X% over 1d" relabelled to the real 220-candle span; two tooltips no longer claim Fibonacci feeds the watch zones; `/api/health` reports `cacheWorks`.

**Backtest method:** walk-forward with the same computeAll over a rolling 220 closed candles; signal at close, entry at next open; stop checked before target within a candle; net of an assumed round-trip cost (placeholder, not Luno's fee schedule); chronological 60/40 split per pair; Wilson 95% range with n divided by the horizon. No parameter is fitted yet, so the 40% is a clean test of the CURRENT rules.

**Open / KIV:** live forward-tracking log (needs Cloudflare KV plus a daily cron); second data source for longer history; scoring redesign (trend filter plus pullback, Bitcoin regime gate) only after backtest numbers; whether Luno omits no-trade candles (backtest page now reports gap rates); Worker has no auth or rate limit and CORS is open; live detail view still scores the forming candle.


---

## 13. v2.1 (2026-10-02) — backtest extended; live dashboard UNCHANGED

**Versions:** crypto-radar-backtest.js v1.1 (loaded as ?v=2) and crypto-radar-backtest.html v1.1 are new; crypto-radar.html, crypto-radar.js and crypto-radar-worker.js stay at v2.0 (nothing changed, no need to re-upload).

**First real-data result (R's run, v2.0, top 10 coins, 1d candles, +8%/-4%/7 candles, 1% cost placeholder):** verdict "No reliable edge detected". Random entry hit 24.7% (later 40%) and 26.2% (earlier 60%); of trades that resolved, 31% and 30% were wins vs about 33% for a driftless random walk at 2:1. Gross return about 0, net about -1% per trade (essentially the cost placeholder). Score buckets flipped sign between halves (25+: +2.7 to +3.0 pts earlier, -1.5 to -1.8 later; 0-24 the reverse); every range overlapped the baseline; 50+ rests on about 10-15 independent signals. Median 7-day best/worst point for random entries: +4.9%/-4.9% (later), +5.6%/-6.7% (earlier), so a -4% stop sits inside routine noise. No candle gaps in those 10 coins (thin coins untested). Caveats: one slice; universe = top 10 by TODAY's volume (hindsight); coins move together, so ranges are still optimistic.

**v1.1 adds:** nine fixed, pre-registered rules compared with the radar score (above 200-candle average; 20-candle breakout; pullback in uptrend = above 100-avg and RSI under 40; Bitcoin above its 200-avg alone and as a gate on each) plus a no-stops "hold" return. Pass bar: in BOTH halves the rule must beat random entry at 99% (nine rules compared) AND average above zero after costs. Rules are not to be tuned on these results; any new rule is a new, separately counted test.

**KIV:** forward-tracking log (KV plus daily cron); real fee and spread numbers to replace the 1% placeholder; thin-coin gap check; exit study (take-profit and trailing stop) only for rules that pass; scoring changes only for rules that pass.


---

## 14. v2.2 (2026-10-02) — longer history; live dashboard still UNCHANGED

**Versions:** crypto-radar-backtest.js v1.2 (?v=3) and crypto-radar-backtest.html v1.2 replace v1.1; everything else stays v2.0.

**v1.1 result (R's run, 9 coins, 1d, +8/-4/7, 1% cost):** no rule cleared the pre-registered bar. Radar 25+ again unreliable (hit 19.7% later / 29.4% earlier vs random 24.2% / 26.8%). Only the breakout rules led random entry in BOTH halves: "Breakout and Bitcoin up" hit 41.8% / 38.6%, avg net +0.83% / +0.14% (random -0.96% / -1.07%), 7-day hold +6.0% / +5.6% (random -0.5% / 0.0%), but n=91 / 342 (about 13 / 49 independent), range 20-67% later. Bitcoin was above its 200-avg on only ~15% of later days vs ~69% earlier, so the sample holds roughly one bull and one bear stretch; the gate helped in the weak period (hold +6.2% vs -0.5%) and not in the strong one. The -4% stop destroys most of the edge (hold +6% vs target/stop +0.1% to +0.8%; median worst dip -3.9% to -5.0%). SANDMYR skipped (116 candles). With nine rules two or three looking good in both halves is expected by chance, so these are candidates for forward testing, not findings.

**v1.2 adds:** pages up to ~4,000 candles per coin (multiple market cycles where Luno has them), "(N mo)" months-active count, optional radar score (off = much faster). Same nine rules, same strict bar, no tuning. The earlier half of a long run covers years not examined before.

**KIV:** exit study for the breakout rules (wide or volatility-based stop, +8-10% target, trailing stop) after the long-history run; forward-tracking log (KV plus daily cron); real Luno fees and spread; scoring changes only for rules that pass.


---

## 15. v2.3 (2026-10-02) — big-mover study; live dashboard still UNCHANGED

**Versions:** NEW crypto-radar-bigmovers.js v1.0 (loaded as ?v=1, after the backtest script); crypto-radar-backtest.html v1.2 (adds the second box); crypto-radar-backtest.js stays v1.2; crypto-radar.html/js and the Worker stay v2.0. Trigger: SANDMYR rose about 40% in a day and was invisible to every test (116 candles, below the 257 the backtest needs).

**What it does:** takes every day followed by a big rally (default: a CLOSE at least +25% above the next open within 7 candles, closes not highs so one-trade spikes on thin books don't count) and measures five fixed rules on the day before (20-candle breakout; volume 3x its 20-candle average; both together; Bollinger-width squeeze = narrowest 10% of the last 60 candles; already up 10%+ in 3 candles). Reports precision (share of firings followed by a big rally, 95% range), lift vs a random day, catch rate (share of all big rallies preceded by the rule) and false alarms per catch. First signal at candle 80, so coins with a few months of history are included. Pass bar: beat a random day at 99% in BOTH chronological halves (five rules compared). Rules not tuned; a new rule is a new, counted test.

**Caveats:** overlapping windows and coins moving together make ranges optimistic; big rallies are rare, so expect few events per half; thin-book closes can still be hard to trade in size; entry price in the study is the next open, not a fillable order.

**KIV:** a "fired today" watchlist using only rules that pass; combine with the Bitcoin gate; exit study for passing rules; forward-tracking log (KV plus cron); real Luno fees and spread.
