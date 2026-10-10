/* Crypto Radar Backtest v1.6 (suite v2.7) — loads AFTER crypto-radar.js and reuses its computeAll()/sma()/rsi(), so it tests exactly what the live page computes.
   Rules: closed candles only; signal at a candle's close, entry at the NEXT open (no look-ahead); stop is checked before target inside a candle (pessimistic).
   Every rule below was fixed in advance and is NOT tuned on the data. Output describes the past. It is not a forecast.
   v1.3: covers ALL coins (scoring starts at candle 80, so new listings count); each rule is compared with random entry over the SAME eligible days; cost = fees + each coin's live bid-ask gap; rate-limit errors are retried; median hold return added.
   v1.4: Stage A = alt-breadth gate from the loaded Luno coins; Stage B = optional macro CSVs (USDT.D, BTC.D, DXY, gold), every value lagged one day; 20-rule family so the bar rises to z = 2.81; tight-spread cut.
   v1.5: dollar index and gold from the Worker's free feeds (ECB rates via Frankfurter, Binance PAXGUSDT); a Luno-basket "market rising" stand-in for falling USDT dominance; 22-rule family (z = 2.84).
   v1.6: when the Worker's gold feed fails (Binance answers 403/451 to Cloudflare), gold comes from Luno's own PAX Gold market (PAXGMYR, gold priced in ringgit; history only since its listing) instead of being dropped; a failed feed is now reported as "skipped", not "ignored". */
const BT = {
  PAGE: 1000, PAGES: 4,   // Luno returns at most ~1000 candles per call; 4 pages = up to ~4,000 candles (about 11 years of daily candles, where Luno has them)
  TRAIN_FRACTION: 0.6,    // first 60% of each pair's history = earlier period; last 40% = the fairer test
  START: 80,              // v1.3: first candle scored, so new listings (a few months old) are included; rules needing 100 or 200 candles only count once a coin has them
  Z_BAR: 2.84,            // v1.5: one-sided 99.77% bar (Bonferroni 0.05 / 22): up to 22 rules are compared at once, so each must clear a stricter test than a single rule would
  NOT_ALTS: ['XBTMYR', 'PAXGMYR', 'XAUTMYR'],   // Bitcoin and the gold tokens are not altcoins: left out of the alt-breadth count
  MIN_BREADTH_COINS: 10,  // alt breadth only exists on days when at least this many alts have a 90-candle return
  BREADTH_LOOKBACK: 90,   // candles
  TIGHT_SPREAD: 0.5,      // % live bid-ask gap: coins at or under this are "tight-spread" (tradable in practice)
  MACRO_INPUTS: [['usdtd', 'bt-m-usdtd'], ['btcd', 'bt-m-btcd'], ['dxy', 'bt-m-dxy'], ['gold', 'bt-m-gold']],   // [key, file input id]
  MACRO_ABOVE: { usdtd: false, btcd: false, dxy: false, gold: true },   // regime = close ABOVE (true) or BELOW (false) its own 50-bar average. Fixed in advance: falling USDT.D, falling BTC.D, weakening dollar, rising gold
  WORKER_MACRO: ['dxy', 'gold'],   // v1.5: series the Worker can supply on its own (a loaded file still wins)
  PRESETS: { swing: [8, 4, 7], big: [25, 12, 60], huge: [40, 15, 90] }, // target %, stop %, window in candles
  SIGNALS: [              // [label, test(row), eligible(row)]. Each rule is compared with random entry over the SAME eligible days; a rule with no eligible day anywhere is hidden. "Bitcoin up" = XBTMYR closed above its own 200-candle average that day
    ['Radar score 25+', r => r.score >= 25, r => r.score != null],
    ['Above 200-candle average', r => r.f.trend, r => r.n >= 200],
    ['20-candle breakout', r => r.f.brk, () => true],
    ['Pullback in uptrend (above 100-avg, RSI under 40)', r => r.f.pb, r => r.n >= 100],
    ['Bitcoin up (any coin)', r => r.btcUp, r => r.btcKnown],
    ['Radar score 25+ and Bitcoin up', r => r.score >= 25 && r.btcUp, r => r.score != null && r.btcKnown],
    ['Above 200-avg and Bitcoin up', r => r.f.trend && r.btcUp, r => r.n >= 200 && r.btcKnown],
    ['Breakout and Bitcoin up', r => r.f.brk && r.btcUp, r => r.btcKnown],
    ['Pullback and Bitcoin up', r => r.f.pb && r.btcUp, r => r.n >= 100 && r.btcKnown],
    ['Alts leading Bitcoin (90-candle breadth above 50%)', r => r.al, r => r.alKnown],                       // v1.4 Stage A
    ['Breakout and alts leading', r => r.f.brk && r.al, r => r.alKnown],
    ['Breakout, Bitcoin up and alts leading', r => r.f.brk && r.btcUp && r.al, r => r.alKnown && r.btcKnown],
    ['Market rising (Luno basket above its 50-candle average; stand-in for falling USDT dominance)', r => r.mk, r => r.mkKnown],   // v1.5
    ['Breakout and market rising', r => r.f.brk && r.mk, r => r.mkKnown],
    ['USDT dominance falling (below its 50-day average)', r => r.mx.usdtd === true, r => r.mx.usdtd !== undefined],   // v1.4 Stage B (shown only when its CSV is loaded)
    ['Breakout and USDT dominance falling', r => r.f.brk && r.mx.usdtd === true, r => r.mx.usdtd !== undefined],
    ['Bitcoin dominance falling (below its 50-day average)', r => r.mx.btcd === true, r => r.mx.btcd !== undefined],
    ['Breakout and Bitcoin dominance falling', r => r.f.brk && r.mx.btcd === true, r => r.mx.btcd !== undefined],
    ['Dollar weakening (DXY below its 50-day average)', r => r.mx.dxy === true, r => r.mx.dxy !== undefined],
    ['Breakout and dollar weakening', r => r.f.brk && r.mx.dxy === true, r => r.mx.dxy !== undefined],
    ['Gold rising (above its 50-day average)', r => r.mx.gold === true, r => r.mx.gold !== undefined],
    ['Breakout and gold rising', r => r.f.brk && r.mx.gold === true, r => r.mx.gold !== undefined],
  ],
};
const btMean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const btMedian = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function wilson(p, n, z = 1.96) { if (!n) return [0, 0]; const d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; }
const btSleep = ms => new Promise(r => setTimeout(r, ms));
const btTransient = msg => /returned (429|5\d\d)|unreachable|HTTP (429|5\d\d)|Failed to fetch|NetworkError/i.test(msg || '');   // rate limit / server hiccup: worth retrying

// Signal on closed candle i -> enter at open of i+1 -> watch candles i+1..i+H. `hold` = just hold the whole window, no stop/target.
function outcomeAt(c, i, o) {
  const e = c[i + 1].open, tp = e * (1 + o.target / 100), sl = e * (1 - o.stop / 100);
  let res = null, mfe = 0, mae = 0;
  for (let k = i + 1; k <= i + o.horizon; k++) {
    mfe = Math.max(mfe, c[k].high / e - 1); mae = Math.min(mae, c[k].low / e - 1);
    if (!res) res = c[k].low <= sl ? 'loss' : c[k].high >= tp ? 'win' : null;
  }
  res = res || 'timeout';
  const held = (c[i + o.horizon].close / e - 1) * 100;
  return { res, ret: (res === 'win' ? o.target : res === 'loss' ? -o.stop : held) - o.cost, hold: held - o.cost, mfe: mfe * 100, mae: mae * 100 };
}

// Indicator arrays computed once per pair; every value at index i uses candles <= i only, so indexing them at i cannot look ahead.
const causal = c => { const cl = c.map(x => x.close); return { cl, sma200: sma(cl, 200), sma100: sma(cl, 100), rsi14: rsi(cl, 14) }; };
function btcMap(c) { const m = causal(c), out = new Map(); c.forEach((x, i) => { if (m.sma200[i] != null) out.set(x.timestamp, x.close > m.sma200[i]); }); return out; }

async function backtestPair(c, o, btc, onTick, extra) {   // c = closed candles, oldest first; btc = Map(timestamp -> Bitcoin above its 200-avg); extra (optional) = { breadth: Map(ts -> share of alts beating Bitcoin), macro: { key -> Map(UTC day -> regime) } }
  const W = CONFIG.CANDLE_LOOKBACK_COUNT, rows = [], m = causal(c);
  for (let i = BT.START - 1; i <= c.length - 1 - o.horizon; i++) {
    const score = (o.useScore && i >= W - 1) ? computeAll(c.slice(i - W + 1, i + 1)).score : null;   // sees candles <= i only; null = not scored (switched off, or under 220 candles so far)
    const f = { trend: m.sma200[i] != null && m.cl[i] > m.sma200[i], brk: m.cl[i] > Math.max(...m.cl.slice(i - 20, i)), pb: m.sma100[i] != null && m.rsi14[i] != null && m.cl[i] > m.sma100[i] && m.rsi14[i] < 40 };
    const br = extra && extra.breadth ? extra.breadth.get(c[i].timestamp) : undefined, mk = extra && extra.market ? extra.market.get(c[i].timestamp) : undefined, day = Math.floor(c[i].timestamp / 86400000) * 86400000, mx = {};
    if (extra && extra.macro) for (const k in extra.macro) mx[k] = extra.macro[k].get(day);   // undefined = no macro value for that day (never guessed)
    rows.push({ i, n: i + 1, ts: c[i].timestamp, score, f, btcKnown: btc.has(c[i].timestamp), btcUp: btc.get(c[i].timestamp) === true, alKnown: br !== undefined, al: br > 0.5, mkKnown: mk !== undefined, mk: mk === true, mx, ...outcomeAt(c, i, o) });
    if (onTick && rows.length % 25 === 0) await onTick(rows.length);
  }
  const cut = Math.floor(rows.length * BT.TRAIN_FRACTION);
  rows.forEach((r, k) => { r.split = k < cut ? 'in' : 'out'; });
  return rows;
}

function summarize(rows, H) {
  const n = rows.length; if (!n) return { n: 0 };
  const p = rows.filter(r => r.res === 'win').length / n, nEff = Math.max(1, n / H), [lo, hi] = wilson(p, nEff), [lo99] = wilson(p, nEff, BT.Z_BAR);   // overlap-adjusted ranges
  return { n, months: new Set(rows.map(r => Math.floor(r.ts / 2.592e9))).size, p, lo, hi, lo99, avg: btMean(rows.map(r => r.ret)), hold: btMean(rows.map(r => r.hold)), holdMed: btMedian(rows.map(r => r.hold)), mfe: btMedian(rows.map(r => r.mfe)), mae: btMedian(rows.map(r => r.mae)) };
}
function sigStats(rows, H) {
  const base = summarize(rows, H);
  const sig = BT.SIGNALS.filter(([, , elig]) => rows.some(elig)).map(([label, test, elig]) => {
    const pool = rows.filter(elig), mb = summarize(pool, H), s = summarize(pool.filter(test), H);   // the baseline is random entry over the SAME eligible days
    return { label, isBase: false, ...s, baseP: mb.n ? mb.p : null, lift: (s.n && mb.n) ? (s.p - mb.p) * 100 : null, beats: s.n > 0 && mb.n > 0 && s.lo99 > mb.p };
  });
  return [{ label: 'Any day (random entry)', isBase: true, ...base, baseP: base.n ? base.p : null, lift: null, beats: false }, ...sig];
}
function tableHtml(rows, o) {
  const f = (v, d = 1) => v.toFixed(d), sg = v => (v >= 0 ? '+' : '') + f(v, 2) + '%';
  const tr = b => b.n
    ? `<tr><td>${b.label}</td><td>${b.n} <small>(${b.months} mo)</small></td><td>${f(b.p * 100)}% <small>(${f(b.lo * 100, 0)}-${f(b.hi * 100, 0)})</small></td><td>${b.isBase ? '-' : (b.lift >= 0 ? '+' : '') + f(b.lift) + ' pts' + (b.beats ? ' \u2713' : '') + ' <small>(vs ' + f(b.baseP * 100) + '%)</small>'}</td><td>${sg(b.avg)}</td><td>${sg(b.hold)} / ${sg(b.holdMed)}</td><td>+${f(b.mfe)}% / ${f(b.mae)}%</td></tr>`
    : `<tr><td>${b.label}</td><td colspan="6">no signals</td></tr>`;
  return `<table class="cr-config-table"><thead><tr><th>Rule</th><th>Count</th><th>Hit rate <small>(95% range)</small></th><th>vs random entry <small>(same days)</small></th><th>Avg net return (target/stop)</th><th>Net return, hold with no stops <small>(average / median)</small></th><th>Median best / worst point</th></tr></thead><tbody>${sigStats(rows, o.horizon).map(tr).join('')}</tbody></table>`;
}
function verdict(later, early, o) {   // a rule passes only if, in BOTH halves, it beats random entry at the strict bar AND makes money after costs. Halves are matched by rule name (a macro rule can exist in one half only)
  const L = sigStats(later, o.horizon), E = new Map(sigStats(early, o.horizon).map(b => [b.label, b])), ok = b => b && b.beats && b.avg > 0;
  const pass = L.filter(b => !b.isBase && ok(b) && ok(E.get(b.label))).map(b => b.label), thin = L.filter(b => !b.isBase && b.n / o.horizon < 15).length;
  const edge = L.filter(b => !b.isBase && b.beats && E.get(b.label) && E.get(b.label).beats && !(ok(b) && ok(E.get(b.label)))).map(b => b.label);
  return (pass.length ? `Passed the strict bar in BOTH halves: ${pass.join('; ')}. Promising, not proof: the next step is a forward test.`
    : `None of the ${L.length - 1} rules cleared the strict bar (beat random entry at the strict 99.77% level and make money after costs) in both halves: no reliable edge found.`)
    + (edge.length ? ` Beat random entry in both halves but did not make money after costs: ${edge.join('; ')}.` : '') + (thin ? ` ${thin} rules had too few independent signals to judge.` : '');
}

function basketRegime(hist, duration) {   // v1.5: stand-in for a FALLING USDT dominance (USDT.D mirrors the whole market): an equal-weight index of the loaded coins (gold tokens left out) above its own 50-candle average. Uses only each candle's own close, so it is known at signal time
  const step = duration * 1000, acc = new Map(), out = new Map();
  Object.keys(hist).forEach(p => {
    if (p !== 'XBTMYR' && BT.NOT_ALTS.includes(p)) return;
    const c = hist[p];
    for (let i = 1; i < c.length; i++) { if (c[i].timestamp - c[i - 1].timestamp !== step) continue; const a = acc.get(c[i].timestamp) || [0, 0]; a[0] += Math.log(c[i].close / c[i - 1].close); a[1]++; acc.set(c[i].timestamp, a); }
  });
  const ts = [...acc.keys()].filter(t => acc.get(t)[1] >= BT.MIN_BREADTH_COINS).sort((a, b) => a - b);
  let lvl = 0; const P = ts.map(t => Math.exp(lvl += acc.get(t)[0] / acc.get(t)[1])), ma = sma(P, 50);
  ts.forEach((t, k) => { if (ma[k] != null) out.set(t, P[k] > ma[k]); });
  return out;
}
async function workerMacro(key) {   // v1.5: dollar index / gold from the Worker (/api/macro), in the same shape as a parsed CSV
  const d = await apiFetch(`/api/macro?series=${key}`);
  const series = (d.bars || []).map(b => ({ d: Math.floor(b[0] / 86400000) * 86400000, close: +b[1] })).filter(x => x.close > 0);
  if (series.length < 60) throw new Error(`only ${series.length} days came back`);
  return { series, source: d.source || key };
}
function parseMacroCsv(text) {   // v1.4 Stage B: a TradingView export (or any CSV) with a time/date column and a close column -> [{d: UTC-midnight ms, close}], oldest first, one value per UTC day
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('no data rows found');
  const cell = x => x.trim().replace(/^"|"$/g, ''), head = lines[0].split(',').map(h => cell(h).toLowerCase());
  const ti = head.findIndex(h => h === 'time' || h === 'date' || h === 'datetime'), ci = head.findIndex(h => h === 'close' || h === 'price');
  if (ti < 0 || ci < 0) throw new Error('needs a header row with a time (or date) column and a close column');
  const byDay = new Map(); let bad = 0;
  for (const line of lines.slice(1)) {
    const cs = line.split(','), t = cell(cs[ti] || ''), v = +cell(cs[ci] || '');
    const ms = /^\d{9,}(\.\d+)?$/.test(t) ? (+t > 1e11 ? +t : +t * 1000) : /^\d{4}-\d{2}-\d{2}/.test(t) ? Date.parse(t.length === 10 ? t + 'T00:00:00Z' : t) : NaN;
    if (!Number.isFinite(ms) || !(v > 0)) { bad++; continue; }
    byDay.set(Math.floor(ms / 86400000) * 86400000, v);
  }
  const out = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([d, close]) => ({ d, close }));
  if (out.length < 60) throw new Error(`only ${out.length} usable daily rows (needs 60+)${bad ? ', ' + bad + ' rows skipped' : ''}`);
  return out;
}
function macroRegime(series, above) {   // v1.4: regime = close above (or below) its own 50-bar average. Every value is LAGGED one day (the regime of the last bar dated before the day in question), so it cannot look ahead; weekends carry forward
  const DAY = 86400000, n = series.length, closes = series.map(x => x.close), ma = sma(closes, 50), out = new Map();
  for (let i = 49; i < n; i++) {
    const on = above ? closes[i] > ma[i] : closes[i] < ma[i], last = i + 1 < n ? series[i + 1].d : series[i].d + DAY;
    for (let t = series[i].d + DAY; t <= last; t += DAY) out.set(t, on);
  }
  return out;
}
function breadthMap(hist, duration) {   // v1.4 Stage A: share of alt coins whose 90-candle return beats Bitcoin's, per day, from the coins already loaded; only days with at least BT.MIN_BREADTH_COINS alts
  const L = BT.BREADTH_LOOKBACK * duration * 1000, out = new Map(), close = {};
  Object.keys(hist).forEach(p => { const mp = new Map(); hist[p].forEach(x => mp.set(x.timestamp, x.close)); close[p] = mp; });
  const b = close['XBTMYR']; if (!b) return out;
  const alts = Object.keys(hist).filter(p => !BT.NOT_ALTS.includes(p));
  for (const ts of b.keys()) {
    const b0 = b.get(ts - L); if (!b0) continue;
    const rb = b.get(ts) / b0 - 1; let n = 0, w = 0;
    for (const p of alts) { const c1 = close[p].get(ts), c0 = close[p].get(ts - L); if (c1 && c0) { n++; if (c1 / c0 - 1 > rb) w++; } }
    if (n >= BT.MIN_BREADTH_COINS) out.set(ts, w / n);
  }
  return out;
}

async function btHistory(pair, duration, notes) {   // pages forward from the oldest requested date; older pages may legitimately be empty, the newest must work. v1.3: rate-limit and server errors are retried (not silently dropped) and unusable candles are filtered out
  const step = duration * 1000, base = Math.floor((Date.now() - step * BT.PAGE * BT.PAGES) / step) * step, got = new Map();
  for (let k = 0; k < BT.PAGES; k++) {
    let err = null;
    for (let a = 0; a < 3; a++) {
      try {
        const d = await apiFetch(`/api/candles?pair=${pair}&duration=${duration}&since=${base + k * BT.PAGE * step}`);
        (d.candles || []).forEach(x => { const op = +x.open, hi = +x.high, lo = +x.low, cl = +x.close; if (op > 0 && hi > 0 && lo > 0 && cl > 0) got.set(x.timestamp, { timestamp: x.timestamp, open: op, high: hi, low: lo, close: cl, volume: +x.volume }); });
        err = null; break;
      } catch (e) { err = e; if (!btTransient(e.message)) break; if (a < 2) await btSleep(700 * (a + 1)); }
    }
    if (err) { if (k === BT.PAGES - 1) throw err; if (btTransient(err.message) && notes) notes.push(`${pair}: older history page ${k + 1} kept failing (${err.message}), so its history may be shorter than it should be`); }
    await btSleep(60);
  }
  return [...got.values()].sort((a, b) => a.timestamp - b.timestamp).filter(x => x.timestamp + step <= Date.now());   // drop the still-forming candle
}

const btEl = id => document.getElementById(id), btVal = id => btEl(id).value;
const btStatus = t => { btEl('bt-status').textContent = t; };

async function runBacktest() {
  const o = { target: +btVal('bt-target'), stop: +btVal('bt-stop'), horizon: Math.round(+btVal('bt-horizon')), cost: +btVal('bt-cost'), duration: +btVal('bt-duration'), useScore: btEl('bt-score').checked, useSpread: btEl('bt-spread').checked };
  if (!(o.target > 0 && o.stop > 0 && o.stop < 100 && o.horizon >= 1 && o.cost >= 0)) return btStatus('Check the numbers: target, stop and window must be positive, and stop under 100.');
  if (!state.workerUrl) return btStatus('Needs a live Worker: set WORKER_URL in crypto-radar.js.');
  const btn = btEl('bt-run'); btn.disabled = true; btEl('bt-out').innerHTML = ''; btEl('bt-verdict').textContent = '';
  try {
    btStatus('Loading the pair list and Bitcoin history...');
    const markets = ((await apiFetch('/api/markets')).markets || []).sort((a, b) => myrVolume(b) - myrVolume(a));
    const pairs = markets.slice(0, btVal('bt-pairs') === 'all' ? markets.length : +btVal('bt-pairs')).map(m => m.pair);
    const rows = [], notes = [], gappy = [], costs = {}, macro = {}, macroUsed = {}, hist = {}; let tested = 0, btc = new Map();
    const spreads = markets.map(m => { const a = +m.ask, b = +m.bid; return (a > 0 && b > 0) ? (a - b) / ((a + b) / 2) * 100 : null; }), known = spreads.filter(v => v != null).sort((x, y) => x - y), fallbackSpread = known.length ? known[Math.floor(known.length * 0.9)] : 0;   // no live bid/ask => assume a wide gap (90th percentile), never zero
    const spreadOf = pair => { const k = markets.findIndex(m => m.pair === pair); return (k >= 0 && spreads[k] != null) ? spreads[k] : fallbackSpread; };
    for (const [key, id] of BT.MACRO_INPUTS) {   // Stage B: a file you loaded wins; otherwise the dollar index and gold come from the Worker's free feeds
      const fl = btEl(id).files && btEl(id).files[0];
      try {
        let sr, source;
        if (fl) { sr = parseMacroCsv(await fl.text()); source = 'file ' + fl.name; }
        else if (btEl('bt-m-auto').checked && BT.WORKER_MACRO.includes(key)) { const wm = await workerMacro(key); sr = wm.series; source = 'Worker: ' + wm.source; }
        else continue;
        macro[key] = macroRegime(sr, BT.MACRO_ABOVE[key]); macroUsed[key] = { source, days: sr.length, from: new Date(sr[0].d).toISOString().slice(0, 10), to: new Date(sr[sr.length - 1].d).toISOString().slice(0, 10) };
      } catch (e) { notes.push(`${fl ? fl.name : key + ' Worker feed'}: ${e.message}, so that source was skipped`); }
    }
    try { btc = btcMap(await btHistory('XBTMYR', o.duration, notes)); } catch (e) { notes.push(`Bitcoin regime unavailable (${e.message}): rules marked "Bitcoin up" will show no signals`); }
    for (let p = 0; p < pairs.length; p++) {   // phase 1: fetch every coin (the alt-breadth gate needs them all before scoring starts)
      const pair = pairs[p];
      btStatus(`Fetching coin ${p + 1} of ${pairs.length}: ${pair}...`);
      let c;
      try { c = await btHistory(pair, o.duration, notes); } catch (e) { notes.push(`${pair}: no data (${e.message})`); continue; }
      const need = BT.START + o.horizon + 5;
      if (c.length < need) { notes.push(`${pair}: only ${c.length} closed candles (needs ${need}), skipped`); continue; }
      const gaps = c.slice(1).filter((x, k) => x.timestamp - c[k].timestamp !== o.duration * 1000).length / (c.length - 1);
      if (gaps > 0.02) gappy.push(`${pair} ${(gaps * 100).toFixed(0)}%`);
      hist[pair] = c;
    }
    if (macro.gold === undefined && btEl('bt-m-auto').checked && !(btEl('bt-m-gold').files && btEl('bt-m-gold').files[0])) {   // v1.6: Binance answers 403/451 to Cloudflare Workers, so gold falls back to Luno's own PAX Gold market (gold priced in ringgit; history only since its listing). A gold file you loaded, or a working Worker feed, always wins
      try {
        const pg = (o.duration === 86400 && hist.PAXGMYR) || await btHistory('PAXGMYR', 86400, notes);   // always daily candles, whatever candle size the run uses
        if (pg.length >= 60) {
          const sr = pg.map(x => ({ d: Math.floor(x.timestamp / 86400000) * 86400000, close: x.close }));
          macro.gold = macroRegime(sr, BT.MACRO_ABOVE.gold);
          macroUsed.gold = { source: 'Luno PAXGMYR (PAX Gold priced in ringgit)', days: sr.length, from: new Date(sr[0].d).toISOString().slice(0, 10), to: new Date(sr[sr.length - 1].d).toISOString().slice(0, 10) };
        } else notes.push(`gold: Luno PAXGMYR has only ${pg.length} daily candles, so the gold rules are not shown`);
      } catch (e) { notes.push(`gold: Luno PAXGMYR unavailable (${e.message}), so the gold rules are not shown`); }
    }
    const have = Object.keys(hist), breadth = breadthMap(hist, o.duration), market = basketRegime(hist, o.duration);
    for (let p = 0; p < have.length; p++) {   // phase 2: score every coin
      const pair = have[p], oc = { ...o, cost: o.cost + (o.useSpread ? spreadOf(pair) : 0) }; costs[pair] = +oc.cost.toFixed(3);   // fees + this coin's live bid-ask gap
      const part = await backtestPair(hist[pair], oc, btc, n => { btStatus(`Scoring coin ${p + 1} of ${have.length}: ${pair} - ${n} points...`); return new Promise(r => setTimeout(r, 0)); }, { breadth, macro, market });
      part.forEach(r => { r.pair = pair; rows.push(r); }); tested++;
    }
    const later = rows.filter(r => r.split === 'out'), earlier = rows.filter(r => r.split === 'in');
    const tight = rows.filter(r => spreadOf(r.pair) <= BT.TIGHT_SPREAD), tightCoins = new Set(tight.map(r => r.pair)).size, tL = tight.filter(r => r.split === 'out'), tE = tight.filter(r => r.split === 'in');
    btEl('bt-verdict').textContent = rows.length ? verdict(later, earlier, o) : 'No coin had enough history.';
    btEl('bt-out').innerHTML = rows.length ? `<h3>Later 40% of each coin's history: the fairer test</h3>${tableHtml(later, o)}<h3>Earlier 60%</h3>${tableHtml(earlier, o)}` : '';
    if (tight.length) btEl('bt-out').innerHTML += `<details class="cr-collapsible" open><summary class="cr-collapsible-summary"><h3>Tight-spread coins only (${tightCoins} coins, live gap ${BT.TIGHT_SPREAD}% or less): can the edge be traded?</h3></summary><div class="cr-collapsible-body"><h4>Later 40%</h4>${tableHtml(tL, o)}<h4>Earlier 60%</h4>${tableHtml(tE, o)}</div></details>`;
    if (gappy.length) btEl('bt-out').innerHTML += `<p class="cr-source-note">Coins with missing candles (periods with no trades appear to be skipped, so indicators run on uneven spacing): ${gappy.join(', ')}.</p>`;
    if (notes.length) btEl('bt-out').innerHTML += `<p class="cr-source-note">${notes.join(' &middot; ')}</p>`;
    if (rows.length) { const cv = Object.entries(costs).sort((a, b) => b[1] - a[1]); btEl('bt-out').innerHTML += `<p class="cr-source-note">Cost per round trip used: fees ${o.cost}%${o.useSpread ? ' + each coin live bid-ask gap (median total ' + cv[Math.floor(cv.length / 2)][1].toFixed(2) + '%, widest ' + cv[0][0] + ' ' + cv[0][1].toFixed(2) + '%)' : ' flat'}. Alt breadth available on ${breadth.size} days${Object.keys(macroUsed).length ? '. Macro series read: ' + Object.entries(macroUsed).map(([k, v]) => `${k} ${v.from} to ${v.to} (${v.days} days; ${v.source})`).join(', ') : ''}.</p>`; }
    const slim = a => a.map(b => ({ label: b.label, n: b.n, p: b.p, baseP: b.baseP, lift: b.lift, beats: b.beats, avg: b.avg, hold: b.hold, holdMed: b.holdMed }));
    btEl('bt-json').value = JSON.stringify({ suite: 'v2.7', backtest: 'v1.6', params: o, costsUsed: costs, macroUsed, breadthDays: breadth.size, coinsTested: tested, signalsScored: rows.length, later40: sigStats(later, o.horizon), earlier60: sigStats(earlier, o.horizon), tightSpread: { coins: tightCoins, later40: slim(sigStats(tL, o.horizon)), earlier60: slim(sigStats(tE, o.horizon)) }, gappyCoins: gappy, notes }, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v, 1);
    btStatus(`Done: ${rows.length} signals scored across ${tested} coins at ${new Date().toLocaleTimeString('en-MY')}.`);
  } catch (e) { btStatus('Backtest failed: ' + e.message); }
  finally { btn.disabled = false; }
}

let btInitialized = false;
function btInit() {
  if (btInitialized || !btEl('bt-run')) return; btInitialized = true;
  state.workerUrl = CONFIG.WORKER_URL;   // crypto-radar.js skips its own init() on this page
  btEl('bt-preset').addEventListener('change', e => { const p = BT.PRESETS[e.target.value]; if (p) { btEl('bt-target').value = p[0]; btEl('bt-stop').value = p[1]; btEl('bt-horizon').value = p[2]; } });
  btEl('bt-run').addEventListener('click', runBacktest);
  btEl('bt-json').addEventListener('focus', e => e.target.select());
}
document.addEventListener('DOMContentLoaded', btInit);
