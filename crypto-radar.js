/*
 * Crypto Radar — page logic for crypto-radar.html
 * Vanilla JS, no build step, no dependencies — same rule as every other
 * tool on this site. Charts are hand-drawn SVG (see renderPriceChart etc.)
 * rather than a charting library, matching interactive-costing-analysis.js
 * and food-worth-calculator.js's own hand-rolled charts.
 *
 * File map (search for these headers):
 *   CONFIG        — the only section most people should ever need to edit
 *   GLOSSARY      — wording for every tooltip + the Glossary section
 *   DEMO DATA     — synthetic prices shown before a Worker is connected
 *   INDICATORS    — pure math, unit-tested separately before this was written
 *   DATA LAYER    — talks to the Worker (or falls back to demo data)
 *   CHARTS        — builds the SVG markup for the four charts
 *   RENDER        — turns state into what's on screen
 *   EVENTS + INIT — wiring, at the bottom
 */

// ======================= CONFIG =======================
// Change values here, not the logic below. See "Settings reference" on the
// page itself for a plain-English table of what each of these does.
const CONFIG = {
  SITE_NAME: 'Crypto Radar',
  DEFAULT_REFRESH_SECONDS: 30,
  DEFAULT_TIMEFRAME: 86400, // 1 day, in seconds — must be one of TIMEFRAMES below
  SUPPORT_RESISTANCE_SENSITIVITY: 3,
  NEWS_HEADLINE_COUNT: 15,
  CANDLE_LOOKBACK_COUNT: 220, // bumped from 180 so SMA200 (needs 200 candles) can actually compute
  ORDER_BLOCK_SWING_LOOKBACK: 10, // candles on each side used to define a "swing" high/low
  ORDER_BLOCK_IMPULSE_MULT: 1.5, // how much bigger than the average candle the breakout move must be
  REGIME_ADX_THRESHOLD: 25, // ADX at/above this = "trending" enough to call a regime "Strong"
  INDICATOR_WEIGHTS: {
    rsi: 1, macd: 1.5, trend: 1, bollinger: 1, stochastic: 1,
    adx: 1, cmf: 1, obv: 1, supportResistance: 1.5,
  },
  TIMEFRAMES: [
    { label: '1m', duration: 60 }, { label: '5m', duration: 300 },
    { label: '15m', duration: 900 }, { label: '30m', duration: 1800 },
    { label: '1h', duration: 3600 }, { label: '3h', duration: 10800 },
    { label: '4h', duration: 14400 }, { label: '1d', duration: 86400 },
    { label: '3d', duration: 259200 }, { label: 'All (1w candles)', duration: 604800 },
  ],
};

// ======================= GLOSSARY =======================
// Single source of truth for plain-English definitions. The page's inline
// tooltip-icons carry their own short data-tooltip text (kept next to the
// thing they explain, in crypto-radar.html); this longer list drives the
// Glossary section so both stay in sync from one place.
const GLOSSARY = [
  { term: 'RSI (Relative Strength Index)', def: 'A 0-100 gauge of how fast and how far price has moved recently. Below 30 is usually read as oversold, above 70 as overbought — but a strong trend can stay "overbought" for a long time, so it is a caution flag, not a timer.' },
  { term: 'MACD', def: 'Compares a fast and slow moving average to gauge momentum. When the MACD line crosses above its signal line, momentum is turning up; below, turning down. The histogram is just the gap between the two, so it grows as momentum builds and shrinks as it fades.' },
  { term: 'SMA (Simple Moving Average)', def: 'The plain average closing price over the last N candles. Smooths out noise so you can see the underlying direction.' },
  { term: 'EMA (Exponential Moving Average)', def: 'Like an SMA but weighted toward recent candles, so it reacts faster to new price action.' },
  { term: 'Bollinger Bands', def: 'A moving average with bands drawn two standard deviations above and below it. Price hugging the upper band suggests strength (or overextension); touching the lower band suggests weakness (or a bounce setup). The bands widen when volatility rises and narrow when it falls.' },
  { term: 'Fibonacci Retracement', def: 'Horizontal lines at standard ratios (23.6%, 38.2%, 50%, 61.8%, 78.6%) between a recent swing high and low. Many traders watch these levels for pullbacks to end, which can make them mildly self-fulfilling — not because of any underlying mathematical law.' },
  { term: 'Stochastic Oscillator', def: "Compares today's close to the recent high-low range, scaled 0-100. Similar spirit to RSI: below 20 is oversold, above 80 is overbought." },
  { term: 'OBV (On-Balance Volume)', def: "A running total that adds a candle's volume when price closes up and subtracts it when price closes down. Rising OBV alongside rising price supports the trend; if they disagree (price up, OBV down), that's called divergence and is often treated as a warning sign." },
  { term: 'Ichimoku Cloud', def: 'A set of five lines built from recent highs and lows that together sketch out trend direction, momentum, and support/resistance in one view. Price above the "cloud" (the shaded band between two of the lines) is generally read as bullish, below as bearish.' },
  { term: 'ADX (Average Directional Index)', def: "Measures how strong a trend is (not which direction). Below 20 usually means no real trend — indicator signals in general are less reliable here. Above 25 suggests a trend worth respecting. The paired +DI/-DI lines show which direction it's leaning." },
  { term: 'Parabolic SAR', def: 'Dots plotted above or below price that flip sides when a trend reverses. Useful as a visual trailing-stop reference, not a standalone signal.' },
  { term: 'VWAP (Volume Weighted Average Price)', def: 'The average price paid, weighted by how much volume traded at each price. Institutional traders often use it as a fair-value reference point for the session.' },
  { term: 'ATR (Average True Range)', def: "A volatility gauge in price units — how much a coin typically moves per candle. Useful for sizing how wide a stop-loss or target should be, scaled to how much this specific coin actually moves." },
  { term: 'CMF (Chaikin Money Flow)', def: "Estimates whether volume is flowing into or out of a coin by looking at where each candle closes within its own range. Above zero suggests accumulation (buying pressure), below zero suggests distribution (selling pressure)." },
  { term: 'Fear & Greed Index', def: "A daily 0-100 sentiment reading for the crypto market as a whole (sourced from alternative.me), not for any single coin. Extreme fear has historically coincided with market bottoms and extreme greed with tops — but 'historically' is doing a lot of work in that sentence." },
  { term: 'Support / Resistance', def: 'Price levels where a chart has previously turned, found here by clustering recent swing highs and lows. More past touches on a level = more traders likely watching it — not a guarantee it holds again.' },
  { term: 'Confluence score', def: "This dashboard's own summary metric: a transparent, weighted vote across the indicators above, from -100 (everything leaning bearish) to +100 (everything leaning bullish). It describes what the indicators say right now — it is not a forecast, and the weights are visible and editable in CONFIG.INDICATOR_WEIGHTS." },
  { term: 'Liquidity', def: "How much genuine buying and selling is happening in a coin. On a thin market, price can sit still for long stretches even while indicators technically update — so a signal on a low-liquidity coin deserves less trust than the same signal on a high-volume one." },
  { term: 'Order book (bid/ask)', def: "The live list of buy orders (bids) and sell orders (asks) waiting to be filled. A thick book close to the current price means it's easy to trade near that price; a thin one means your own order could move the price." },
  { term: 'HTF Pivot (higher-timeframe pivot)', def: "A classic pivot point — (prior day's high + low + close) ÷ 3 — used as a bias line regardless of which timeframe tab you're viewing. Price above it leans bullish for the day, below leans bearish. It's a reference level, not a signal on its own." },
  { term: 'EMA Cross (21/55)', def: "The percentage gap between the 21-period and 55-period EMA. Positive and widening suggests the trend is accelerating; near zero suggests the two are converging (often right before a change in direction, though not reliably)." },
  { term: 'MA ribbon (21/50/55/89/144/200)', def: "Several moving averages of different lengths shown together — when price sits above all of them in order (shortest to longest), that's often read as a clean, healthy uptrend; a tangled ribbon suggests a choppy, directionless market. The specific periods here (21, 55, 89, 144) are Fibonacci numbers, a common (if debated) convention." },
  { term: 'Trend Regime', def: "A second, deliberately simpler summary alongside the Confluence score above: a plain count of how many of 10 moving-average/trend checks currently agree, shown as bullish/bearish/neutral votes plus a label (e.g. 'Strong Bull' needs both a lopsided vote count and ADX ≥ 25). It won't always agree with the weighted Confluence score — when the two disagree, that disagreement is itself worth noticing." },
  { term: 'Order zones (demand / supply)', def: "This dashboard's own reading of a concept popularised by ICT/Smart-Money-Concepts trading education: the last candle opposite in colour to a strong move that breaks a recent swing high or low. There's no single official formula for this — independent write-ups on the concept suggest these zones react meaningfully more often when combined with other confluence, but are close to a coin flip in isolation. Treat the zones as 'worth a second look,' not as a signal." },
];

// ======================= DEMO DATA =======================
// Shown until a Worker URL is connected, so the whole page is explorable
// immediately. Clearly labelled "Demo data" in the status pill at all times
// — see updateConnectionStatus().
const DEMO_MARKETS_SEED = [
  { pair: 'XBTMYR', name: 'Bitcoin', price: 462000, vol24h: 38.4 },
  { pair: 'ETHMYR', name: 'Ethereum', price: 15400, vol24h: 260 },
  { pair: 'XRPMYR', name: 'Ripple', price: 9.85, vol24h: 145000 },
  { pair: 'SOLMYR', name: 'Solana', price: 715, vol24h: 3100 },
  { pair: 'ADAMYR', name: 'Cardano', price: 3.12, vol24h: 210000 },
  { pair: 'LTCMYR', name: 'Litecoin', price: 420, vol24h: 890 },
  { pair: 'DOGEMYR', name: 'Dogecoin', price: 0.62, vol24h: 980000 },
  { pair: 'MATICMYR', name: 'Polygon', price: 1.85, vol24h: 42 }, // deliberately thin, to demo the low-liquidity flag
];

function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

function makeDemoCandles(basePrice, count, seedOffset) {
  const rand = seededRandom(1000 + seedOffset);
  let price = basePrice;
  const candles = [];
  const now = Date.now();
  for (let i = count - 1; i >= 0; i--) {
    const drift = Math.sin((count - i) / 25) * basePrice * 0.01;
    const chg = (rand() - 0.5) * basePrice * 0.02 + drift * 0.1;
    const open = price;
    const close = Math.max(basePrice * 0.4, price + chg);
    const high = Math.max(open, close) * (1 + rand() * 0.006);
    const low = Math.min(open, close) * (1 - rand() * 0.006);
    const volume = basePrice > 1000 ? 5 + rand() * 40 : (500 + rand() * 4000);
    candles.push({ timestamp: now - i * 3600000, open, high, low, close, volume });
    price = close;
  }
  return candles;
}

// ======================= STATE =======================
const state = {
  workerUrl: '',
  mode: 'demo', // 'demo' | 'live' | 'error'
  refreshSeconds: CONFIG.DEFAULT_REFRESH_SECONDS,
  refreshTimer: null,
  markets: [],
  feargreed: null,
  news: [],
  selectedPair: null,
  timeframe: CONFIG.DEFAULT_TIMEFRAME,
  candleCache: {}, // key: `${pair}:${duration}` -> candle array
};

// ======================= INDICATORS =======================
// Identical logic to indicators.js / test-indicators.js used to verify it —
// copied in rather than imported, since this site loads plain <script> tags
// with no module bundler (see AI_BUILD_BRIEF.md: no build step).

function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}
function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) continue;
    if (i === period - 1) {
      let seed = 0;
      for (let j = 0; j <= i; j++) seed += values[j];
      out[i] = seed / period;
    } else {
      out[i] = values[i] * k + out[i - 1] * (1 - k);
    }
  }
  return out;
}
function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const chg = closes[i] - closes[i - 1];
    if (chg >= 0) gainSum += chg; else lossSum -= chg;
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const chg = closes[i] - closes[i - 1];
    const gain = chg > 0 ? chg : 0;
    const loss = chg < 0 ? -chg : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
function macd(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(closes, fast), emaSlow = ema(closes, slow);
  const line = closes.map((_, i) => (emaFast[i] != null && emaSlow[i] != null) ? emaFast[i] - emaSlow[i] : null);
  const signal = new Array(line.length).fill(null);
  const firstValid = line.findIndex(v => v != null);
  if (firstValid !== -1 && line.length - firstValid >= signalPeriod) {
    const k = 2 / (signalPeriod + 1);
    let seed = 0;
    for (let j = 0; j < signalPeriod; j++) seed += line[firstValid + j];
    const seedIdx = firstValid + signalPeriod - 1;
    signal[seedIdx] = seed / signalPeriod;
    for (let i = seedIdx + 1; i < line.length; i++) signal[i] = line[i] * k + signal[i - 1] * (1 - k);
  }
  const histogram = line.map((v, i) => (v != null && signal[i] != null) ? v - signal[i] : null);
  return { line, signal, histogram };
}
function bollinger(closes, period = 20, mult = 2) {
  const mid = sma(closes, period);
  const upper = new Array(closes.length).fill(null), lower = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = mid[i];
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    upper[i] = mean + mult * sd; lower[i] = mean - mult * sd;
  }
  return { mid, upper, lower };
}
function stochastic(highs, lows, closes, period = 14, dPeriod = 3) {
  const k = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    k[i] = hh === ll ? 50 : 100 * (closes[i] - ll) / (hh - ll);
  }
  const dRaw = sma(k.map(v => v == null ? 0 : v), dPeriod);
  const d = dRaw.map((v, i) => (k[i] == null) ? null : v);
  return { k, d };
}
function obv(closes, volumes) {
  const out = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) out.push(out[i - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) out.push(out[i - 1] - volumes[i]);
    else out.push(out[i - 1]);
  }
  return out;
}
function trueRange(highs, lows, closes) {
  const tr = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  return tr;
}
function atr(highs, lows, closes, period = 14) {
  const tr = trueRange(highs, lows, closes);
  const out = new Array(tr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  out[period - 1] = sum / period;
  for (let i = period; i < tr.length; i++) out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  return out;
}
function adx(highs, lows, closes, period = 14) {
  const n = closes.length;
  const plusDM = [0], minusDM = [0];
  for (let i = 1; i < n; i++) {
    const up = highs[i] - highs[i - 1], down = lows[i - 1] - lows[i];
    plusDM.push((up > down && up > 0) ? up : 0);
    minusDM.push((down > up && down > 0) ? down : 0);
  }
  const tr = trueRange(highs, lows, closes);
  const wilder = (arr) => {
    const out = new Array(arr.length).fill(null);
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += arr[i] || 0;
    out[period] = sum;
    for (let i = period + 1; i < arr.length; i++) out[i] = out[i - 1] - out[i - 1] / period + arr[i];
    return out;
  };
  const smTR = wilder(tr), smPlusDM = wilder(plusDM), smMinusDM = wilder(minusDM);
  const plusDI = smTR.map((v, i) => (v ? 100 * smPlusDM[i] / v : null));
  const minusDI = smTR.map((v, i) => (v ? 100 * smMinusDM[i] / v : null));
  const dx = plusDI.map((v, i) => (v != null && minusDI[i] != null && (v + minusDI[i]) !== 0) ? 100 * Math.abs(v - minusDI[i]) / (v + minusDI[i]) : null);
  const adxOut = new Array(n).fill(null);
  const validDX = dx.map((v, i) => ({ v, i })).filter(o => o.v != null);
  if (validDX.length >= period) {
    let sum = 0;
    for (let k = 0; k < period; k++) sum += validDX[k].v;
    let prev = sum / period;
    adxOut[validDX[period - 1].i] = prev;
    for (let k = period; k < validDX.length; k++) { prev = (prev * (period - 1) + validDX[k].v) / period; adxOut[validDX[k].i] = prev; }
  }
  return { plusDI, minusDI, adx: adxOut };
}
function parabolicSar(highs, lows, step = 0.02, maxStep = 0.2) {
  const n = highs.length;
  const out = new Array(n).fill(null);
  if (n < 2) return out;
  let up = highs[1] >= highs[0], af = step, ep = up ? highs[0] : lows[0];
  out[0] = up ? lows[0] : highs[0];
  for (let i = 1; i < n; i++) {
    let next = out[i - 1] + af * (ep - out[i - 1]);
    if (up) {
      next = Math.min(next, lows[i - 1], i >= 2 ? lows[i - 2] : lows[i - 1]);
      if (lows[i] < next) { up = false; next = ep; ep = lows[i]; af = step; }
      else if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + step, maxStep); }
    } else {
      next = Math.max(next, highs[i - 1], i >= 2 ? highs[i - 2] : highs[i - 1]);
      if (highs[i] > next) { up = true; next = ep; ep = highs[i]; af = step; }
      else if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + step, maxStep); }
    }
    out[i] = next;
  }
  return out;
}
function vwap(highs, lows, closes, volumes) {
  const out = [];
  let cumPV = 0, cumV = 0;
  for (let i = 0; i < closes.length; i++) {
    const typical = (highs[i] + lows[i] + closes[i]) / 3;
    cumPV += typical * volumes[i]; cumV += volumes[i];
    out.push(cumV === 0 ? null : cumPV / cumV);
  }
  return out;
}
function cmf(highs, lows, closes, volumes, period = 20) {
  const mfv = closes.map((c, i) => {
    const range = highs[i] - lows[i];
    const mfm = range === 0 ? 0 : ((c - lows[i]) - (highs[i] - c)) / range;
    return mfm * volumes[i];
  });
  const out = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i++) {
    const mfvSum = mfv.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const volSum = volumes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    out[i] = volSum === 0 ? 0 : mfvSum / volSum;
  }
  return out;
}
function ichimoku(highs, lows) {
  const mid = (period, i) => (i < period - 1) ? null : (Math.max(...highs.slice(i - period + 1, i + 1)) + Math.min(...lows.slice(i - period + 1, i + 1))) / 2;
  const n = highs.length;
  const tenkan = [], kijun = [], spanB = [];
  for (let i = 0; i < n; i++) { tenkan.push(mid(9, i)); kijun.push(mid(26, i)); spanB.push(mid(52, i)); }
  const spanA = tenkan.map((t, i) => (t != null && kijun[i] != null) ? (t + kijun[i]) / 2 : null);
  return { tenkan, kijun, spanA, spanB };
}
function fibonacci(highs, lows, lookback = 100) {
  const h = highs.slice(-lookback), l = lows.slice(-lookback);
  const swingHigh = Math.max(...h), swingLow = Math.min(...l), diff = swingHigh - swingLow;
  const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map(r => ({ ratio: r, price: swingHigh - diff * r }));
  return { swingHigh, swingLow, levels };
}
function supportResistance(highs, lows, sensitivity = 3, tolerancePct = 0.006, maxLevels = 4) {
  const pivots = [];
  for (let i = sensitivity; i < highs.length - sensitivity; i++) {
    const wH = highs.slice(i - sensitivity, i + sensitivity + 1), wL = lows.slice(i - sensitivity, i + sensitivity + 1);
    if (highs[i] === Math.max(...wH)) pivots.push({ type: 'resistance', price: highs[i] });
    if (lows[i] === Math.min(...wL)) pivots.push({ type: 'support', price: lows[i] });
  }
  const cluster = (type) => {
    const pts = pivots.filter(p => p.type === type).map(p => p.price).sort((a, b) => a - b);
    const groups = [];
    for (const p of pts) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(p - last.avg) / last.avg <= tolerancePct) { last.sum += p; last.count += 1; last.avg = last.sum / last.count; }
      else groups.push({ sum: p, count: 1, avg: p });
    }
    return groups.sort((a, b) => b.count - a.count).slice(0, maxLevels).map(g => ({ price: g.avg, touches: g.count }));
  };
  return { support: cluster('support'), resistance: cluster('resistance') };
}
function confluenceScore(latest, weights) {
  const votes = [];
  if (latest.rsi != null) votes.push({ w: weights.rsi, v: latest.rsi < 30 ? 1 : latest.rsi > 70 ? -1 : 0 });
  if (latest.macdHist != null) votes.push({ w: weights.macd, v: latest.macdHist > 0 ? 1 : latest.macdHist < 0 ? -1 : 0 });
  if (latest.priceVsEma != null) votes.push({ w: weights.trend, v: latest.priceVsEma > 0 ? 1 : -1 });
  if (latest.bbPercent != null) votes.push({ w: weights.bollinger, v: latest.bbPercent < 0.1 ? 1 : latest.bbPercent > 0.9 ? -1 : 0 });
  if (latest.stochK != null) votes.push({ w: weights.stochastic, v: latest.stochK < 20 ? 1 : latest.stochK > 80 ? -1 : 0 });
  if (latest.adx != null && latest.plusDI != null && latest.minusDI != null) votes.push({ w: weights.adx, v: latest.adx < 20 ? 0 : (latest.plusDI > latest.minusDI ? 1 : -1) });
  if (latest.cmf != null) votes.push({ w: weights.cmf, v: latest.cmf > 0.05 ? 1 : latest.cmf < -0.05 ? -1 : 0 });
  if (latest.obvSlope != null) votes.push({ w: weights.obv, v: latest.obvSlope > 0 ? 1 : latest.obvSlope < 0 ? -1 : 0 });
  if (latest.priceVsSupport != null) votes.push({ w: weights.supportResistance, v: latest.priceVsSupport });
  const totalWeight = votes.reduce((s, x) => s + x.w, 0) || 1;
  return Math.round((votes.reduce((s, x) => s + x.w * x.v, 0) / totalWeight) * 100);
}

// Classic pivot point from the prior period's H/L/C — the standard formula
// used everywhere from floor-trading to modern platforms, not tied to any
// one product. "HTF" (higher-timeframe) just means: even when you're
// looking at a 1h chart, this is computed from the prior *daily* candle,
// giving a bias reference point above/below which the picture looks
// different than the timeframe currently on screen.
function pivotPoint(prevHigh, prevLow, prevClose) {
  const pp = (prevHigh + prevLow + prevClose) / 3;
  return { pp, r1: 2 * pp - prevLow, s1: 2 * pp - prevHigh };
}

// Order blocks: the last candle opposite in colour to a strong "displacement"
// move that breaks the recent swing high/low. This exact definition (last
// opposing candle before a break of structure) is the one used consistently
// across independent ICT/Smart-Money-Concepts trading education — it isn't
// owned by any single tool, and there's no universally-agreed precise
// formula, so treat this as one reasonable reading rather than a ground
// truth. Independent write-ups on the concept report these zones reacting
// meaningfully more often *with* added confluence (roughly 60-75%) but
// close to a coin flip without it — the marketed "80%+" figures floating
// around are generally considered cherry-picked. See the glossary.
function findOrderBlocks(candles, swingLookback, impulseMult, maxZones = 2) {
  const n = candles.length;
  const recentRanges = candles.slice(-60).map(c => c.high - c.low);
  const avgRange = recentRanges.reduce((a, b) => a + b, 0) / (recentRanges.length || 1);
  const bullish = [], bearish = [];
  for (let i = swingLookback; i < n - 1; i++) {
    const swingHigh = Math.max(...candles.slice(i - swingLookback, i).map(c => c.high));
    const swingLow = Math.min(...candles.slice(i - swingLookback, i).map(c => c.low));
    const cur = candles[i], next = candles[i + 1];
    const nextBody = Math.abs(next.close - next.open);
    if (cur.close < cur.open && next.close > swingHigh && nextBody > avgRange * impulseMult) {
      bullish.push({ top: cur.open, bottom: cur.low, index: i });
    }
    if (cur.close > cur.open && next.close < swingLow && nextBody > avgRange * impulseMult) {
      bearish.push({ top: cur.high, bottom: cur.open, index: i });
    }
  }
  return { bullish: bullish.slice(-maxZones), bearish: bearish.slice(-maxZones) };
}

// A second, deliberately different lens from confluenceScore() above: a
// plain unweighted vote count across price-vs-moving-average + HTF pivot +
// MACD + RSI direction, reported as "X bullish / Y bearish / Z neutral"
// plus a regime label. confluenceScore() is the dashboard's primary,
// weighted read; this is a simpler, MA-heavy cross-check — the two won't
// always agree, and that disagreement is itself useful information.
function trendRegime(votes, adx) {
  const bull = votes.filter(v => v === 1).length;
  const bear = votes.filter(v => v === -1).length;
  const neutral = votes.length - bull - bear;
  const score = votes.length ? Math.round(((bull - bear) / votes.length) * 100) : 0;
  const strongTrend = adx != null && adx >= CONFIG.REGIME_ADX_THRESHOLD;
  let label;
  if (score >= 70 && strongTrend) label = 'Strong Bull';
  else if (score >= 30) label = 'Bull';
  else if (score <= -70 && strongTrend) label = 'Strong Bear';
  else if (score <= -30) label = 'Bear';
  else label = 'Neutral / Choppy';
  return { bull, bear, neutral, total: votes.length, score, label };
}

// Runs the whole indicator suite once per candle set — called every time a
// coin/timeframe is opened, so all of it lives in one place.
function computeAll(candles) {
  const o = candles.map(c => c.open), h = candles.map(c => c.high), l = candles.map(c => c.low),
        c = candles.map(c => c.close), v = candles.map(c => c.volume);
  const i = candles.length - 1;
  const rsiArr = rsi(c, 14);
  const macdRes = macd(c);
  const bb = bollinger(c, 20, 2);
  const stoch = stochastic(h, l, c, 14, 3);
  const obvArr = obv(c, v);
  const atrArr = atr(h, l, c, 14);
  const adxRes = adx(h, l, c, 14);
  const psar = parabolicSar(h, l);
  const vwapArr = vwap(h, l, c, v);
  const cmfArr = cmf(h, l, c, v, 20);
  const ich = ichimoku(h, l);
  const fib = fibonacci(h, l, Math.min(100, h.length));
  const sr = supportResistance(h, l, CONFIG.SUPPORT_RESISTANCE_SENSITIVITY);
  const ema50 = ema(c, Math.min(50, Math.max(5, Math.floor(c.length / 2))));
  const sma20 = sma(c, 20);

  // Fibonacci-period ribbon (21/50/55/89/144/200) — a common "MA ribbon"
  // reading, not tied to any single indicator brand.
  const ribbon = {
    ema21: ema(c, 21), sma50: sma(c, 50), ema55: ema(c, 55),
    ema89: ema(c, 89), ema144: ema(c, 144), sma200: sma(c, 200),
  };
  const orderBlocks = findOrderBlocks(candles, CONFIG.ORDER_BLOCK_SWING_LOOKBACK, CONFIG.ORDER_BLOCK_IMPULSE_MULT);

  const latest = {
    price: c[i], rsi: rsiArr[i], macdHist: macdRes.histogram[i],
    priceVsEma: ema50[i] != null ? c[i] - ema50[i] : null,
    bbPercent: (bb.upper[i] != null && bb.lower[i] != null && bb.upper[i] !== bb.lower[i]) ? (c[i] - bb.lower[i]) / (bb.upper[i] - bb.lower[i]) : null,
    stochK: stoch.k[i], adx: adxRes.adx[i], plusDI: adxRes.plusDI[i], minusDI: adxRes.minusDI[i],
    cmf: cmfArr[i], obvSlope: (i >= 5 && obvArr[i] != null && obvArr[i - 5] != null) ? obvArr[i] - obvArr[i - 5] : null,
    psar: psar[i], vwap: vwapArr[i], atr: atrArr[i],
    tenkan: ich.tenkan[i], kijun: ich.kijun[i],
    ema21: ribbon.ema21[i], sma50: ribbon.sma50[i], ema55: ribbon.ema55[i],
    ema89: ribbon.ema89[i], ema144: ribbon.ema144[i], sma200: ribbon.sma200[i],
    emaCrossPct: (ribbon.ema21[i] != null && ribbon.ema55[i] != null && ribbon.ema55[i] !== 0)
      ? ((ribbon.ema21[i] - ribbon.ema55[i]) / ribbon.ema55[i]) * 100 : null,
  };
  const nearestSupport = sr.support.filter(s => s.price < c[i]).sort((a, b) => b.price - a.price)[0];
  const nearestResistance = sr.resistance.filter(r => r.price > c[i]).sort((a, b) => a.price - b.price)[0];
  latest.priceVsSupport = nearestSupport ? (c[i] - nearestSupport.price) / c[i] < 0.01 ? 1 : 0 : 0;

  const score = confluenceScore(latest, CONFIG.INDICATOR_WEIGHTS);

  return { o, h, l, c, v, rsiArr, macdRes, bb, stoch, obvArr, atrArr, adxRes, psar, vwapArr, cmfArr, ich, fib, sr, ema50, sma20, ribbon, orderBlocks, latest, score, nearestSupport, nearestResistance };
}

// ======================= DATA LAYER =======================
async function apiFetch(path, options) {
  if (!state.workerUrl) throw new Error('no-worker');
  const res = await fetch(state.workerUrl.replace(/\/$/, '') + path, options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function loadMarkets() {
  if (!state.workerUrl) {
    state.markets = DEMO_MARKETS_SEED.map(m => ({ pair: m.pair, name: m.name, last_trade: String(m.price), rolling_24_hour_volume: String(m.vol24h), ask: String(m.price * 1.001), bid: String(m.price * 0.999) }));
    state.mode = 'demo';
    return;
  }
  try {
    const data = await apiFetch('/api/markets');
    state.markets = data.markets || [];
    state.mode = 'live';
  } catch (err) {
    console.warn('Falling back to demo markets:', err.message);
    state.markets = DEMO_MARKETS_SEED.map(m => ({ pair: m.pair, name: m.name, last_trade: String(m.price), rolling_24_hour_volume: String(m.vol24h), ask: String(m.price * 1.001), bid: String(m.price * 0.999) }));
    state.mode = 'error';
  }
}

async function loadCandles(pair, duration) {
  const key = `${pair}:${duration}`;
  if (state.mode !== 'live') {
    const seed = DEMO_MARKETS_SEED.find(m => m.pair === pair) || DEMO_MARKETS_SEED[0];
    const candles = makeDemoCandles(seed.price, CONFIG.CANDLE_LOOKBACK_COUNT, pair.charCodeAt(0) + duration);
    state.candleCache[key] = candles;
    return candles;
  }
  try {
    const since = Date.now() - duration * 1000 * CONFIG.CANDLE_LOOKBACK_COUNT;
    const data = await apiFetch(`/api/candles?pair=${pair}&duration=${duration}&since=${since}`);
    const candles = (data.candles || []).map(c => ({ timestamp: c.timestamp, open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close), volume: Number(c.volume) }));
    state.candleCache[key] = candles;
    return candles;
  } catch (err) {
    console.warn('Candle fetch failed, using demo candles for this pair:', err.message);
    const seed = DEMO_MARKETS_SEED.find(m => m.pair === pair) || { price: 1000 };
    const candles = makeDemoCandles(seed.price, CONFIG.CANDLE_LOOKBACK_COUNT, pair.charCodeAt(0) + duration);
    state.candleCache[key] = candles;
    return candles;
  }
}

async function loadFearGreed() {
  if (state.mode !== 'live') { state.feargreed = { value: 54, classification: 'Neutral (demo)' }; return; }
  try { state.feargreed = await apiFetch('/api/feargreed'); }
  catch (err) { state.feargreed = null; }
}

async function loadOrderbook(pair) {
  if (state.mode !== 'live') {
    const seed = DEMO_MARKETS_SEED.find(m => m.pair === pair) || DEMO_MARKETS_SEED[0];
    const bids = Array.from({ length: 6 }, (_, i) => ({ price: seed.price * (1 - 0.0005 * (i + 1)), volume: (0.2 + Math.random() * 2).toFixed(3) }));
    const asks = Array.from({ length: 6 }, (_, i) => ({ price: seed.price * (1 + 0.0005 * (i + 1)), volume: (0.2 + Math.random() * 2).toFixed(3) }));
    return { bids, asks };
  }
  try {
    const data = await apiFetch(`/api/orderbook?pair=${pair}`);
    return { bids: (data.bids || []).slice(0, 6), asks: (data.asks || []).slice(0, 6) };
  } catch (err) { return { bids: [], asks: [] }; }
}

async function loadNews() {
  if (state.mode !== 'live') {
    state.news = [
      { title: 'Connect a Worker to load live headlines here', link: '#', pubDate: '', source: 'Demo' },
    ];
    return;
  }
  try {
    const data = await apiFetch('/api/news');
    state.news = (data.items || []).slice(0, CONFIG.NEWS_HEADLINE_COUNT);
  } catch (err) { state.news = []; }
}

async function requestInsight(pair, snapshot, headlines) {
  return apiFetch('/api/insight', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pair, snapshot, headlines: headlines.map(h => h.title) }),
  });
}

// ======================= FORMATTING =======================
function formatMYR(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const decimals = v >= 100 ? 2 : v >= 1 ? 4 : 6;
  return 'RM' + Number(v).toLocaleString('en-MY', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function badgeHtml(signal) {
  const cls = signal > 0 ? 'is-bullish' : signal < 0 ? 'is-bearish' : 'is-neutral';
  const label = signal > 0 ? 'Bullish' : signal < 0 ? 'Bearish' : 'Neutral';
  return `<span class="cr-badge ${cls}">${label}</span>`;
}
function liquidityTier(pair) {
  const sorted = [...state.markets].sort((a, b) => Number(b.rolling_24_hour_volume) - Number(a.rolling_24_hour_volume));
  const rank = sorted.findIndex(m => m.pair === pair);
  const n = sorted.length || 1;
  if (rank < n / 3) return 'high';
  if (rank < (2 * n) / 3) return 'medium';
  return 'low';
}

// ======================= CHARTS (hand-rolled SVG) =======================
function scaleFns(values, x0, x1, y0, y1) {
  const clean = values.filter(v => v != null && !Number.isNaN(v));
  const min = Math.min(...clean), max = Math.max(...clean);
  const pad = (max - min) * 0.08 || max * 0.02 || 1;
  const yMin = min - pad, yMax = max + pad;
  const n = values.length;
  return {
    x: (i) => x0 + (n <= 1 ? 0 : (i / (n - 1)) * (x1 - x0)),
    y: (v) => y1 - ((v - yMin) / (yMax - yMin || 1)) * (y1 - y0),
    yMin, yMax,
  };
}
function pathFor(values, xFn, yFn) {
  let d = '';
  values.forEach((v, i) => {
    if (v == null || Number.isNaN(v)) return;
    d += (d === '' ? 'M' : 'L') + xFn(i).toFixed(1) + ',' + yFn(v).toFixed(1) + ' ';
  });
  return d.trim();
}

function renderPriceChart(computed) {
  const svg = document.getElementById('cr-price-chart');
  const legend = document.getElementById('cr-price-legend');
  const W = 640, H = 320, x0 = 54, x1 = 630, y0 = 14, y1 = 280;
  const { c, bb, ribbon, sr, orderBlocks } = computed;
  const allForScale = [...c, ...bb.upper, ...bb.lower];
  const { x, y, yMin, yMax } = scaleFns(allForScale, x0, x1, y0, y1);

  let svgContent = '';
  // gridlines + y-axis labels (4 rows)
  for (let g = 0; g <= 4; g++) {
    const gy = y0 + (g / 4) * (y1 - y0);
    const price = yMax - (g / 4) * (yMax - yMin);
    svgContent += `<line x1="${x0}" y1="${gy.toFixed(1)}" x2="${x1}" y2="${gy.toFixed(1)}" stroke="var(--line)" stroke-width="0.5"/>`;
    svgContent += `<text x="4" y="${gy.toFixed(1)}" dominant-baseline="middle" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${formatMYR(price)}</text>`;
  }
  // Order-block zones drawn first so everything else layers on top. Extended
  // from where they formed out to the right edge, same visual idea as a
  // supply/demand zone box — see findOrderBlocks() for the exact rule used.
  ['bullish', 'bearish'].forEach(type => {
    const color = type === 'bullish' ? '#0F6E56' : '#C0392B';
    const label = type === 'bullish' ? 'Demand' : 'Supply';
    (orderBlocks[type] || []).forEach(z => {
      const zx = x(z.index), top = y(z.top), bottom = y(z.bottom);
      svgContent += `<rect x="${zx.toFixed(1)}" y="${Math.min(top, bottom).toFixed(1)}" width="${(x1 - zx).toFixed(1)}" height="${Math.max(2, Math.abs(bottom - top)).toFixed(1)}" fill="${color}" fill-opacity="0.1" stroke="${color}" stroke-opacity="0.4" stroke-width="0.5" stroke-dasharray="2 2"/>`;
      svgContent += `<text x="${(zx + 4).toFixed(1)}" y="${(Math.min(top, bottom) - 3).toFixed(1)}" font-size="9" fill="${color}">${label}</text>`;
    });
  });
  // Bollinger band shaded area
  const upperPath = pathFor(bb.upper, x, y);
  const lowerXs = bb.lower.map((_, i) => bb.lower.length - 1 - i);
  let bandArea = upperPath;
  lowerXs.forEach((origIdx) => { const v = bb.lower[origIdx]; if (v != null) bandArea += ` L${x(origIdx).toFixed(1)},${y(v).toFixed(1)}`; });
  bandArea += ' Z';
  svgContent += `<path d="${bandArea}" fill="var(--accent)" fill-opacity="0.06" stroke="none"/>`;
  svgContent += `<path d="${pathFor(bb.upper, x, y)}" fill="none" stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>`;
  svgContent += `<path d="${pathFor(bb.lower, x, y)}" fill="none" stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>`;
  // support / resistance
  sr.support.forEach(s => { svgContent += `<line x1="${x0}" y1="${y(s.price).toFixed(1)}" x2="${x1}" y2="${y(s.price).toFixed(1)}" stroke="#0F6E56" stroke-width="1" stroke-dasharray="5 3"/>`; });
  sr.resistance.forEach(r => { svgContent += `<line x1="${x0}" y1="${y(r.price).toFixed(1)}" x2="${x1}" y2="${y(r.price).toFixed(1)}" stroke="#C0392B" stroke-width="1" stroke-dasharray="5 3"/>`; });
  // Fibonacci-period MA ribbon — 3 of the 6 ribbon lines shown here (21/55/200)
  // to keep the chart readable; all 6 values are in the scorecard below.
  svgContent += `<path d="${pathFor(ribbon.ema21, x, y)}" fill="none" stroke="#2E5FA3" stroke-width="1.3"/>`;
  svgContent += `<path d="${pathFor(ribbon.ema55, x, y)}" fill="none" stroke="#D4A017" stroke-width="1.3"/>`;
  svgContent += `<path d="${pathFor(ribbon.sma200, x, y)}" fill="none" stroke="#7F77DD" stroke-width="1.3"/>`;
  // Close price line (drawn last = on top)
  svgContent += `<path d="${pathFor(c, x, y)}" fill="none" stroke="var(--text)" stroke-width="1.8"/>`;

  svg.innerHTML = svgContent;
  legend.innerHTML = [
    ['var(--text)', 'Price'], ['#2E5FA3', 'EMA 21'], ['#D4A017', 'EMA 55'], ['#7F77DD', 'SMA 200'],
    ['var(--accent)', 'Bollinger Bands'], ['#0F6E56', 'Support / Demand zone'], ['#C0392B', 'Resistance / Supply zone'],
  ].map(([color, label]) => `<span><i class="cr-legend-swatch" style="background:${color}"></i>${label}</span>`).join('');
}

function renderVolumeChart(computed) {
  const svg = document.getElementById('cr-volume-chart');
  const W = 640, H = 80, x0 = 54, x1 = 630, y0 = 4, y1 = 74;
  const { v, o, c } = computed;
  const maxV = Math.max(...v.filter(x => x != null)) || 1;
  const barW = (x1 - x0) / v.length;
  let content = '';
  v.forEach((vol, i) => {
    const h = (vol / maxV) * (y1 - y0);
    const up = c[i] >= o[i];
    content += `<rect x="${(x0 + i * barW).toFixed(1)}" y="${(y1 - h).toFixed(1)}" width="${Math.max(1, barW - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${up ? '#0F6E56' : '#C0392B'}" fill-opacity="0.55"/>`;
  });
  svg.innerHTML = content;
}

function renderRsiChart(computed) {
  const svg = document.getElementById('cr-rsi-chart');
  const x0 = 54, x1 = 630, y0 = 10, y1 = 100;
  const x = (i) => x0 + (i / (computed.rsiArr.length - 1)) * (x1 - x0);
  const y = (v) => y1 - (v / 100) * (y1 - y0);
  let content = '';
  content += `<rect x="${x0}" y="${y(70).toFixed(1)}" width="${x1 - x0}" height="${(y(30) - y(70)).toFixed(1)}" fill="var(--accent)" fill-opacity="0.05"/>`;
  [30, 50, 70].forEach(level => {
    content += `<line x1="${x0}" y1="${y(level).toFixed(1)}" x2="${x1}" y2="${y(level).toFixed(1)}" stroke="var(--line)" stroke-width="0.5" stroke-dasharray="${level === 50 ? '2 2' : '0'}"/>`;
    content += `<text x="4" y="${y(level).toFixed(1)}" dominant-baseline="middle" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${level}</text>`;
  });
  content += `<path d="${pathFor(computed.rsiArr, x, y)}" fill="none" stroke="#7F77DD" stroke-width="1.6"/>`;
  content += `<text x="${x0}" y="8" font-size="10" fill="var(--muted)">RSI (14)</text>`;
  svg.innerHTML = content;
}

function renderMacdChart(computed) {
  const svg = document.getElementById('cr-macd-chart');
  const x0 = 54, x1 = 630, y0 = 10, y1 = 100;
  const { line, signal, histogram } = computed.macdRes;
  const allVals = [...line, ...signal, ...histogram];
  const { x, y } = scaleFns(allVals, x0, x1, y0, y1);
  const zeroY = y(0);
  let content = `<line x1="${x0}" y1="${zeroY.toFixed(1)}" x2="${x1}" y2="${zeroY.toFixed(1)}" stroke="var(--line)" stroke-width="0.5"/>`;
  const barW = (x1 - x0) / histogram.length;
  histogram.forEach((val, i) => {
    if (val == null) return;
    const hy = y(val);
    const top = Math.min(hy, zeroY), h = Math.abs(hy - zeroY);
    content += `<rect x="${(x0 + i * barW).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, barW - 1).toFixed(1)}" height="${Math.max(0.5, h).toFixed(1)}" fill="${val >= 0 ? '#0F6E56' : '#C0392B'}" fill-opacity="0.5"/>`;
  });
  content += `<path d="${pathFor(line, x, y)}" fill="none" stroke="#2E5FA3" stroke-width="1.4"/>`;
  content += `<path d="${pathFor(signal, x, y)}" fill="none" stroke="#D4A017" stroke-width="1.4"/>`;
  content += `<text x="${x0}" y="8" font-size="10" fill="var(--muted)">MACD (12, 26, 9)</text>`;
  svg.innerHTML = content;
}

// ======================= RENDER =======================
function updateConnectionStatus() {
  const el = document.getElementById('cr-status');
  const text = document.getElementById('cr-status-text');
  el.classList.remove('is-live', 'is-demo', 'is-error');
  if (state.mode === 'live') { el.classList.add('is-live'); text.textContent = 'Live — Luno API'; }
  else if (state.mode === 'error') { el.classList.add('is-error'); text.textContent = 'Worker unreachable — showing demo data'; }
  else { el.classList.add('is-demo'); text.textContent = 'Demo data'; }
  document.getElementById('cr-last-updated').textContent = 'Last updated ' + new Date().toLocaleTimeString('en-MY');
}

function renderFearGreedCard() {
  document.getElementById('cr-feargreed-value').textContent = state.feargreed ? `${state.feargreed.value} · ${state.feargreed.classification}` : '—';
  document.getElementById('cr-coin-count').textContent = state.markets.length;
  const sorted = [...state.markets].sort((a, b) => Number(b.rolling_24_hour_volume) - Number(a.rolling_24_hour_volume));
  document.getElementById('cr-most-active').textContent = sorted[0] ? sorted[0].pair : '—';
  document.getElementById('cr-least-active').textContent = sorted.length ? sorted[sorted.length - 1].pair : '—';
}

function renderMarketGrid() {
  const grid = document.getElementById('cr-market-grid');
  const sorted = [...state.markets].sort((a, b) => Number(b.rolling_24_hour_volume) - Number(a.rolling_24_hour_volume));
  grid.innerHTML = sorted.map(m => {
    const price = Number(m.last_trade);
    const tier = liquidityTier(m.pair);
    const tierLabel = tier === 'high' ? 'Active' : tier === 'medium' ? 'Moderate' : 'Thin';
    return `<button type="button" class="cr-coin-card${state.selectedPair === m.pair ? ' is-selected' : ''}" data-pair="${m.pair}">
      <div class="cr-coin-top"><span class="cr-coin-name">${m.pair.replace('MYR', '')}</span><span class="cr-liquidity-tag is-${tier}">${tierLabel}</span></div>
      <span class="cr-coin-price">${formatMYR(price)}</span>
      <div class="cr-coin-meta"><span>Vol 24h: ${Number(m.rolling_24_hour_volume).toLocaleString('en-MY', { maximumFractionDigits: 2 })}</span></div>
    </button>`;
  }).join('');
  grid.querySelectorAll('.cr-coin-card').forEach(btn => btn.addEventListener('click', () => selectCoin(btn.dataset.pair)));
}

function renderTimeframeTabs() {
  const wrap = document.getElementById('cr-timeframe-tabs');
  wrap.innerHTML = CONFIG.TIMEFRAMES.map(tf => `<button type="button" role="tab" class="cr-tab${tf.duration === state.timeframe ? ' is-active' : ''}" data-duration="${tf.duration}">${tf.label}</button>`).join('');
  wrap.querySelectorAll('.cr-tab').forEach(btn => btn.addEventListener('click', async () => {
    state.timeframe = Number(btn.dataset.duration);
    await renderDetail();
  }));
}

function renderScorecard(computed) {
  const l = computed.latest;
  const cards = [
    { label: 'Stochastic %K', value: l.stochK != null ? l.stochK.toFixed(1) : '—', signal: l.stochK == null ? 0 : l.stochK < 20 ? 1 : l.stochK > 80 ? -1 : 0, note: 'Below 20 oversold, above 80 overbought' },
    { label: 'OBV trend (5)', value: l.obvSlope != null ? (l.obvSlope > 0 ? 'Rising' : l.obvSlope < 0 ? 'Falling' : 'Flat') : '—', signal: l.obvSlope > 0 ? 1 : l.obvSlope < 0 ? -1 : 0, note: 'Volume flow direction' },
    { label: 'Ichimoku', value: (l.tenkan != null && l.kijun != null) ? (l.tenkan > l.kijun ? 'Tenkan > Kijun' : 'Tenkan < Kijun') : '—', signal: (l.tenkan != null && l.kijun != null) ? (l.tenkan > l.kijun ? 1 : -1) : 0, note: 'Short vs long baseline' },
    { label: 'ADX', value: l.adx != null ? l.adx.toFixed(1) : '—', signal: (l.adx != null && l.adx >= 20) ? (l.plusDI > l.minusDI ? 1 : -1) : 0, note: l.adx != null && l.adx < 20 ? 'Weak/no trend' : 'Trend strength' },
    { label: 'Parabolic SAR', value: l.psar != null ? formatMYR(l.psar) : '—', signal: (l.psar != null && l.price != null) ? (l.price > l.psar ? 1 : -1) : 0, note: 'Dot below price = up-trend' },
    { label: 'VWAP', value: l.vwap != null ? formatMYR(l.vwap) : '—', signal: (l.vwap != null && l.price != null) ? (l.price > l.vwap ? 1 : -1) : 0, note: 'Price vs session average' },
    { label: 'ATR (volatility)', value: l.atr != null ? formatMYR(l.atr) : '—', signal: 0, note: 'Typical move per candle' },
    { label: 'CMF', value: l.cmf != null ? l.cmf.toFixed(3) : '—', signal: l.cmf > 0.05 ? 1 : l.cmf < -0.05 ? -1 : 0, note: 'Above 0 = buying pressure' },
    { label: 'RSI (14)', value: l.rsi != null ? l.rsi.toFixed(1) : '—', signal: l.rsi == null ? 0 : l.rsi < 30 ? 1 : l.rsi > 70 ? -1 : 0, note: 'Below 30 oversold, above 70 overbought' },
    { label: 'MACD histogram', value: l.macdHist != null ? l.macdHist.toFixed(2) : '—', signal: l.macdHist > 0 ? 1 : l.macdHist < 0 ? -1 : 0, note: 'Above 0 = bullish momentum' },
    { label: 'HTF Pivot (daily)', value: computed.htf ? formatMYR(computed.htf.pp) : '—', signal: computed.htf ? computed.htf.bias : 0, note: 'Price vs prior-day pivot point' },
    { label: 'EMA Cross (21/55)', value: l.emaCrossPct != null ? `${l.emaCrossPct >= 0 ? '+' : ''}${l.emaCrossPct.toFixed(2)}%` : '—', signal: l.emaCrossPct > 0 ? 1 : l.emaCrossPct < 0 ? -1 : 0, note: 'Gap between EMA21 and EMA55' },
    { label: 'EMA 21', value: l.ema21 != null ? formatMYR(l.ema21) : '—', signal: (l.price != null && l.ema21 != null) ? (l.price > l.ema21 ? 1 : -1) : 0, note: 'Price vs 21-period EMA' },
    { label: 'SMA 50', value: l.sma50 != null ? formatMYR(l.sma50) : '—', signal: (l.price != null && l.sma50 != null) ? (l.price > l.sma50 ? 1 : -1) : 0, note: 'Price vs 50-period SMA' },
    { label: 'EMA 55', value: l.ema55 != null ? formatMYR(l.ema55) : '—', signal: (l.price != null && l.ema55 != null) ? (l.price > l.ema55 ? 1 : -1) : 0, note: 'Price vs 55-period EMA' },
    { label: 'EMA 89', value: l.ema89 != null ? formatMYR(l.ema89) : '—', signal: (l.price != null && l.ema89 != null) ? (l.price > l.ema89 ? 1 : -1) : 0, note: 'Price vs 89-period EMA' },
    { label: 'EMA 144', value: l.ema144 != null ? formatMYR(l.ema144) : '—', signal: (l.price != null && l.ema144 != null) ? (l.price > l.ema144 ? 1 : -1) : 0, note: 'Price vs 144-period EMA' },
    { label: 'SMA 200', value: l.sma200 != null ? formatMYR(l.sma200) : (candles200Warning(computed) ? 'Needs more history' : '—'), signal: (l.price != null && l.sma200 != null) ? (l.price > l.sma200 ? 1 : -1) : 0, note: 'Price vs 200-period SMA' },
  ];
  document.getElementById('cr-scorecard-grid').innerHTML = cards.map(c => `
    <div class="cr-scorecard">
      <span class="cr-scorecard-label">${c.label}</span>
      <span class="cr-scorecard-value">${c.value}</span>
      ${badgeHtml(c.signal)}
      <div class="cr-scorecard-note">${c.note}</div>
    </div>`).join('');

  // Trend Regime — a second, unweighted vote-count summary (see
  // trendRegime() for why this is deliberately kept separate from the
  // primary confluence score above rather than merged into one number).
  const r = computed.regime;
  document.getElementById('cr-regime-label').textContent = r.label;
  document.getElementById('cr-regime-label').className = 'cr-badge ' + (r.score > 0 ? 'is-bullish' : r.score < 0 ? 'is-bearish' : 'is-neutral');
  document.getElementById('cr-regime-votes').textContent = `${r.bull} bullish / ${r.bear} bearish / ${r.neutral} neutral (of ${r.total} MA + trend checks)`;
  document.getElementById('cr-regime-score').textContent = `${r.score >= 0 ? '+' : ''}${r.score}`;
}
function candles200Warning(computed) { return computed.c.length < 200; }

function renderConfluence(computed) {
  const score = computed.score;
  const needle = document.getElementById('cr-confluence-needle');
  needle.style.left = `${50 + score / 2}%`;
  const summaryEl = document.getElementById('cr-confluence-summary');
  const lean = score > 25 ? 'leaning bullish' : score < -25 ? 'leaning bearish' : 'roughly balanced';
  summaryEl.textContent = `Confluence score: ${score} / 100 — indicators are currently ${lean}. This reflects the snapshot above, not a prediction of what happens next.`;

  const price = computed.latest.price;
  const s = computed.nearestSupport, r = computed.nearestResistance;
  const bbLow = computed.bb.lower[computed.bb.lower.length - 1], bbHigh = computed.bb.upper[computed.bb.upper.length - 1];
  const entryLow = Math.min(...[s?.price, bbLow].filter(v => v != null));
  const entryHigh = Math.max(...[s?.price, bbLow].filter(v => v != null));
  const tpLow = Math.min(...[r?.price, bbHigh].filter(v => v != null));
  const tpHigh = Math.max(...[r?.price, bbHigh].filter(v => v != null));
  document.getElementById('cr-entry-zone').textContent = (Number.isFinite(entryLow) && Number.isFinite(entryHigh)) ? `${formatMYR(entryLow)} – ${formatMYR(entryHigh)}` : 'Not enough data';
  document.getElementById('cr-tp-zone').textContent = (Number.isFinite(tpLow) && Number.isFinite(tpHigh)) ? `${formatMYR(tpLow)} – ${formatMYR(tpHigh)}` : 'Not enough data';
}

function renderOrderbookUI(book) {
  document.getElementById('cr-bids').innerHTML = book.bids.map(b => `<div class="cr-orderbook-row"><span>${formatMYR(Number(b.price))}</span><span>${Number(b.volume).toFixed(4)}</span></div>`).join('') || '<span class="cr-source-note">No data</span>';
  document.getElementById('cr-asks').innerHTML = book.asks.map(a => `<div class="cr-orderbook-row"><span>${formatMYR(Number(a.price))}</span><span>${Number(a.volume).toFixed(4)}</span></div>`).join('') || '<span class="cr-source-note">No data</span>';
}

function renderNewsUI() {
  const list = document.getElementById('cr-news-list');
  if (!state.news.length) { list.innerHTML = '<li class="cr-news-meta">No headlines yet.</li>'; return; }
  list.innerHTML = state.news.map(n => `<li class="cr-news-item"><a href="${n.link}" target="_blank" rel="noopener">${n.title}</a><div class="cr-news-meta">${n.source}${n.pubDate ? ' · ' + new Date(n.pubDate).toLocaleDateString('en-MY') : ''}</div></li>`).join('');
}

function renderGlossary() {
  document.getElementById('cr-glossary').innerHTML = GLOSSARY.map((g, i) => `
    <details class="cr-collapsible"${i === 0 ? '' : ''}>
      <summary class="cr-collapsible-summary"><h3>${g.term}</h3></summary>
      <div class="cr-collapsible-body">${g.def}</div>
    </details>`).join('');
}

async function renderDetail() {
  const pair = state.selectedPair;
  if (!pair) return;
  document.getElementById('cr-detail-title').textContent = `${pair.replace('MYR', '')} / MYR detail`;
  renderTimeframeTabs();
  const [candles, book] = await Promise.all([loadCandles(pair, state.timeframe), loadOrderbook(pair)]);

  // Luno's ticker has no built-in "24h change" field (confirmed against its
  // actual response shape: pair/bid/ask/last_trade/rolling_24_hour_volume/
  // timestamp/status, nothing else) — computing one for every overview card
  // would mean an extra authenticated candle call per coin just for a
  // cosmetic number. Instead this is shown only here, once a coin is open,
  // using candles already being fetched for the chart: first close vs last
  // close across whatever timeframe is currently selected. Honest label
  // ("this view") rather than calling it "24h" when it might be a 1h or
  // all-time window.
  const changeEl = document.getElementById('cr-detail-change');
  if (candles.length >= 2) {
    const first = candles[0].close, last = candles[candles.length - 1].close;
    const pct = ((last - first) / first) * 100;
    const tfLabel = (CONFIG.TIMEFRAMES.find(t => t.duration === state.timeframe) || {}).label || 'this view';
    changeEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% over ${tfLabel}`;
    changeEl.classList.toggle('is-up', pct >= 0);
    changeEl.classList.toggle('is-down', pct < 0);
  } else {
    changeEl.textContent = '';
  }
  if (candles.length < 60) {
    document.getElementById('cr-confluence-summary').textContent = 'Not enough candle history at this timeframe yet to compute every indicator reliably — try a shorter timeframe or wait for more data.';
  }
  const computed = computeAll(candles);

  // HTF (higher-timeframe) pivot bias: always referenced against the prior
  // *daily* candle regardless of which timeframe tab is open, since that's
  // the conventional meaning of "HTF" here — reuses loadCandles (and its
  // Worker-side cache) rather than a special-case fetch, just requesting
  // duration=86400 instead of whatever's currently selected.
  const dailyCandles = state.timeframe === 86400 ? candles : await loadCandles(pair, 86400);
  let htf = null;
  if (dailyCandles.length >= 2) {
    const prevDay = dailyCandles[dailyCandles.length - 2];
    const { pp, r1, s1 } = pivotPoint(prevDay.high, prevDay.low, prevDay.close);
    htf = { pp, r1, s1, bias: computed.latest.price > pp ? 1 : -1 };
  }
  computed.htf = htf;

  const l = computed.latest;
  const regimeVotes = [
    htf ? htf.bias : 0,
    l.macdHist > 0 ? 1 : l.macdHist < 0 ? -1 : 0,
    l.emaCrossPct > 0 ? 1 : l.emaCrossPct < 0 ? -1 : 0,
    l.rsi > 50 ? 1 : l.rsi < 50 ? -1 : 0,
    (l.price != null && l.ema21 != null) ? (l.price > l.ema21 ? 1 : -1) : 0,
    (l.price != null && l.sma50 != null) ? (l.price > l.sma50 ? 1 : -1) : 0,
    (l.price != null && l.ema55 != null) ? (l.price > l.ema55 ? 1 : -1) : 0,
    (l.price != null && l.ema89 != null) ? (l.price > l.ema89 ? 1 : -1) : 0,
    (l.price != null && l.ema144 != null) ? (l.price > l.ema144 ? 1 : -1) : 0,
    (l.price != null && l.sma200 != null) ? (l.price > l.sma200 ? 1 : -1) : 0,
  ];
  computed.regime = trendRegime(regimeVotes, l.adx);

  renderPriceChart(computed);
  renderVolumeChart(computed);
  renderRsiChart(computed);
  renderMacdChart(computed);
  renderScorecard(computed);
  renderConfluence(computed);
  renderOrderbookUI(book);
  state.lastComputed = computed;
}

async function selectCoin(pair) {
  state.selectedPair = pair;
  document.getElementById('cr-detail-section').hidden = false;
  document.getElementById('cr-ai-insight').textContent = 'Connect a Worker with a Gemini key to see an AI-generated read of this coin (Settings above). Optional — the scorecard above works fully without it.';
  document.getElementById('cr-ai-insight').classList.add('is-empty');
  renderMarketGrid();
  await renderDetail();
  document.getElementById('cr-detail-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ======================= EVENTS + INIT =======================
async function refreshAll() {
  await Promise.all([loadMarkets(), loadFearGreed(), loadNews()]);
  updateConnectionStatus();
  renderFearGreedCard();
  renderMarketGrid();
  renderNewsUI();
  if (state.selectedPair) await renderDetail();
}

function startAutoRefresh() {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  if (state.refreshSeconds > 0) state.refreshTimer = setInterval(refreshAll, state.refreshSeconds * 1000);
}

function wireEvents() {
  document.getElementById('cr-save-settings').addEventListener('click', async () => {
    const url = document.getElementById('cr-worker-url').value.trim();
    state.workerUrl = url;
    const params = new URLSearchParams(window.location.search);
    if (url) params.set('worker', url); else params.delete('worker');
    history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
    await refreshAll();
  });
  document.getElementById('cr-update-now').addEventListener('click', refreshAll);
  document.getElementById('cr-refresh-interval').addEventListener('change', (e) => {
    state.refreshSeconds = Number(e.target.value);
    startAutoRefresh();
  });
  document.getElementById('cr-get-insight').addEventListener('click', async () => {
    if (!state.selectedPair || !state.lastComputed) return;
    const box = document.getElementById('cr-ai-insight');
    if (state.mode !== 'live') { box.textContent = 'AI insight needs a connected Worker with a Gemini key — see Settings above.'; box.classList.add('is-empty'); return; }
    box.textContent = 'Asking Gemini for a read on this coin…';
    try {
      const l = state.lastComputed.latest;
      const snapshot = { pair: state.selectedPair, price: l.price, rsi: l.rsi, macdHistogram: l.macdHist, adx: l.adx, cmf: l.cmf, confluenceScore: state.lastComputed.score, nearestSupport: state.lastComputed.nearestSupport, nearestResistance: state.lastComputed.nearestResistance };
      const result = await requestInsight(state.selectedPair, snapshot, state.news);
      box.textContent = result.text;
      box.classList.remove('is-empty');
    } catch (err) {
      box.textContent = 'Could not reach Gemini right now (' + err.message + '). The scorecard above is unaffected.';
      box.classList.add('is-empty');
    }
  });
  const backToTop = document.getElementById('cr-back-to-top');
  backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  window.addEventListener('scroll', () => { backToTop.hidden = window.scrollY < window.innerHeight * 0.6; });
}

let rzInitialized = false;
async function init() {
  if (rzInitialized) return;
  rzInitialized = true;
  document.title = `Reysourcez Enterprise — ${CONFIG.SITE_NAME} (Luno Malaysia)`;
  const params = new URLSearchParams(window.location.search);
  const workerFromUrl = params.get('worker') || '';
  document.getElementById('cr-worker-url').value = workerFromUrl;
  state.workerUrl = workerFromUrl;
  state.refreshSeconds = CONFIG.DEFAULT_REFRESH_SECONDS;
  wireEvents();
  renderGlossary();
  await refreshAll();
  startAutoRefresh();
}
document.addEventListener('DOMContentLoaded', init);
