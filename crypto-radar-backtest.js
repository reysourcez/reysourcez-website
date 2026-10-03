/* Crypto Radar Backtest v1.2 (suite v2.2) — loads AFTER crypto-radar.js and reuses its computeAll()/sma()/rsi(), so it tests exactly what the live page computes.
   Rules: closed candles only; signal at a candle's close, entry at the NEXT open (no look-ahead); stop is checked before target inside a candle (pessimistic).
   Every rule below was fixed in advance and is NOT tuned on the data. Output describes the past. It is not a forecast. */
const BT = {
  PAGE: 1000, PAGES: 4,   // Luno returns at most ~1000 candles per call; 4 pages = up to ~4,000 candles (about 11 years of daily candles, where Luno has them)
  TRAIN_FRACTION: 0.6,    // first 60% of each pair's history = earlier period; last 40% = the fairer test
  Z_BAR: 2.576,           // 99% bar: nine rules are compared at once, so each must clear a stricter test than a single rule would
  PRESETS: { swing: [8, 4, 7], big: [25, 12, 60], huge: [40, 15, 90] }, // target %, stop %, window in candles
  SIGNALS: [              // [label, test(row)]. "Bitcoin up" = XBTMYR closed above its own 200-candle average that day
    ['Radar score 25+', r => r.score >= 25],
    ['Above 200-candle average', r => r.f.trend],
    ['20-candle breakout', r => r.f.brk],
    ['Pullback in uptrend (above 100-avg, RSI under 40)', r => r.f.pb],
    ['Bitcoin up (any coin)', r => r.btcUp],
    ['Radar score 25+ and Bitcoin up', r => r.score >= 25 && r.btcUp],
    ['Above 200-avg and Bitcoin up', r => r.f.trend && r.btcUp],
    ['Breakout and Bitcoin up', r => r.f.brk && r.btcUp],
    ['Pullback and Bitcoin up', r => r.f.pb && r.btcUp],
  ],
};
const btMean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const btMedian = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function wilson(p, n, z = 1.96) { if (!n) return [0, 0]; const d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; }

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

async function backtestPair(c, o, btc, onTick) {   // c = closed candles, oldest first; btc = Map(timestamp -> Bitcoin above its 200-avg)
  const W = CONFIG.CANDLE_LOOKBACK_COUNT, rows = [], m = causal(c);
  for (let i = W - 1; i <= c.length - 1 - o.horizon; i++) {
    const score = o.useScore ? computeAll(c.slice(i - W + 1, i + 1)).score : null;   // sees candles <= i only; null = radar score skipped (much faster)
    const f = { trend: m.cl[i] > m.sma200[i], brk: m.cl[i] > Math.max(...m.cl.slice(i - 20, i)), pb: m.cl[i] > m.sma100[i] && m.rsi14[i] < 40 };
    rows.push({ i, ts: c[i].timestamp, score, f, btcUp: btc.get(c[i].timestamp) === true, ...outcomeAt(c, i, o) });
    if (onTick && rows.length % 25 === 0) await onTick(rows.length);
  }
  const cut = Math.floor(rows.length * BT.TRAIN_FRACTION);
  rows.forEach((r, k) => { r.split = k < cut ? 'in' : 'out'; });
  return rows;
}

function summarize(rows, H) {
  const n = rows.length; if (!n) return { n: 0 };
  const p = rows.filter(r => r.res === 'win').length / n, nEff = Math.max(1, n / H), [lo, hi] = wilson(p, nEff), [lo99] = wilson(p, nEff, BT.Z_BAR);   // overlap-adjusted ranges
  return { n, months: new Set(rows.map(r => Math.floor(r.ts / 2.592e9))).size, p, lo, hi, lo99, avg: btMean(rows.map(r => r.ret)), hold: btMean(rows.map(r => r.hold)), mfe: btMedian(rows.map(r => r.mfe)), mae: btMedian(rows.map(r => r.mae)) };
}
function sigStats(rows, H) {
  const base = summarize(rows, H), hasScore = rows.some(r => r.score != null);
  return [['Any day (random entry)', base, true], ...BT.SIGNALS.filter(([n]) => hasScore || !n.startsWith('Radar')).map(([n, f]) => [n, summarize(rows.filter(f), H), false])]
    .map(([label, s, isBase]) => ({ label, isBase, ...s, lift: (isBase || !s.n) ? null : (s.p - base.p) * 100, beats: !isBase && s.n > 0 && s.lo99 > base.p }));
}
function tableHtml(rows, o) {
  const f = (v, d = 1) => v.toFixed(d), sg = v => (v >= 0 ? '+' : '') + f(v, 2) + '%';
  const tr = b => b.n
    ? `<tr><td>${b.label}</td><td>${b.n} <small>(${b.months} mo)</small></td><td>${f(b.p * 100)}% <small>(${f(b.lo * 100, 0)}-${f(b.hi * 100, 0)})</small></td><td>${b.isBase ? '-' : (b.lift >= 0 ? '+' : '') + f(b.lift) + ' pts' + (b.beats ? ' \u2713' : '')}</td><td>${sg(b.avg)}</td><td>${sg(b.hold)}</td><td>+${f(b.mfe)}% / ${f(b.mae)}%</td></tr>`
    : `<tr><td>${b.label}</td><td colspan="6">no signals</td></tr>`;
  return `<table class="cr-config-table"><thead><tr><th>Rule</th><th>Count</th><th>Hit rate <small>(95% range)</small></th><th>vs random entry</th><th>Avg net return (target/stop)</th><th>Avg net return (hold, no stops)</th><th>Median best / worst point</th></tr></thead><tbody>${sigStats(rows, o.horizon).map(tr).join('')}</tbody></table>`;
}
function verdict(later, early, o) {   // a rule passes only if, in BOTH halves, it beats random entry at the 99% bar AND makes money after costs
  const L = sigStats(later, o.horizon), E = sigStats(early, o.horizon), ok = b => b.beats && b.avg > 0;
  const pass = L.filter((b, k) => !b.isBase && ok(b) && ok(E[k])).map(b => b.label), thin = L.filter(b => !b.isBase && b.n / o.horizon < 15).length;
  return pass.length ? `Passed the strict bar in BOTH halves: ${pass.join('; ')}. Promising, not proof: the next step is a forward test.`
    : `None of the ${L.length - 1} rules cleared the strict bar (beat random entry at 99% confidence and make money after costs) in both halves: no reliable edge found.` + (thin ? ` ${thin} rules had too few independent signals to judge.` : '');
}

async function btHistory(pair, duration) {   // pages forward from the oldest requested date; older pages may legitimately be empty or fail, the newest must work
  const step = duration * 1000, base = Math.floor((Date.now() - step * BT.PAGE * BT.PAGES) / step) * step, got = new Map();
  for (let k = 0; k < BT.PAGES; k++) {
    try {
      const d = await apiFetch(`/api/candles?pair=${pair}&duration=${duration}&since=${base + k * BT.PAGE * step}`);
      (d.candles || []).forEach(x => got.set(x.timestamp, { timestamp: x.timestamp, open: +x.open, high: +x.high, low: +x.low, close: +x.close, volume: +x.volume }));
    } catch (e) { if (k === BT.PAGES - 1) throw e; }
  }
  return [...got.values()].sort((a, b) => a.timestamp - b.timestamp).filter(x => x.timestamp + step <= Date.now());   // drop the still-forming candle
}

const btEl = id => document.getElementById(id), btVal = id => btEl(id).value;
const btStatus = t => { btEl('bt-status').textContent = t; };

async function runBacktest() {
  const o = { target: +btVal('bt-target'), stop: +btVal('bt-stop'), horizon: Math.round(+btVal('bt-horizon')), cost: +btVal('bt-cost'), duration: +btVal('bt-duration'), useScore: btEl('bt-score').checked };
  if (!(o.target > 0 && o.stop > 0 && o.stop < 100 && o.horizon >= 1 && o.cost >= 0)) return btStatus('Check the numbers: target, stop and window must be positive, and stop under 100.');
  if (!state.workerUrl) return btStatus('Needs a live Worker: set WORKER_URL in crypto-radar.js.');
  const btn = btEl('bt-run'); btn.disabled = true; btEl('bt-out').innerHTML = ''; btEl('bt-verdict').textContent = '';
  try {
    btStatus('Loading the pair list and Bitcoin history...');
    const markets = ((await apiFetch('/api/markets')).markets || []).sort((a, b) => myrVolume(b) - myrVolume(a));
    const pairs = markets.slice(0, btVal('bt-pairs') === 'all' ? markets.length : +btVal('bt-pairs')).map(m => m.pair);
    const rows = [], notes = [], gappy = []; let tested = 0, btc = new Map();
    try { btc = btcMap(await btHistory('XBTMYR', o.duration)); } catch (e) { notes.push(`Bitcoin regime unavailable (${e.message}): rules marked "Bitcoin up" will show no signals`); }
    for (let p = 0; p < pairs.length; p++) {
      const pair = pairs[p];
      btStatus(`Coin ${p + 1} of ${pairs.length}: ${pair} - fetching history...`);
      let c;
      try { c = await btHistory(pair, o.duration); } catch (e) { notes.push(`${pair}: no data (${e.message})`); continue; }
      const need = CONFIG.CANDLE_LOOKBACK_COUNT + o.horizon + 30;
      if (c.length < need) { notes.push(`${pair}: only ${c.length} closed candles (needs ${need}), skipped`); continue; }
      const gaps = c.slice(1).filter((x, k) => x.timestamp - c[k].timestamp !== o.duration * 1000).length / (c.length - 1);
      if (gaps > 0.02) gappy.push(`${pair} ${(gaps * 100).toFixed(0)}%`);
      const part = await backtestPair(c, o, btc, n => { btStatus(`Coin ${p + 1} of ${pairs.length}: ${pair} - scored ${n} points...`); return new Promise(r => setTimeout(r, 0)); });
      part.forEach(r => { r.pair = pair; rows.push(r); }); tested++;
    }
    const later = rows.filter(r => r.split === 'out'), earlier = rows.filter(r => r.split === 'in');
    btEl('bt-verdict').textContent = rows.length ? verdict(later, earlier, o) : 'No coin had enough history.';
    btEl('bt-out').innerHTML = rows.length ? `<h3>Later 40% of each coin's history: the fairer test</h3>${tableHtml(later, o)}<h3>Earlier 60%</h3>${tableHtml(earlier, o)}` : '';
    if (gappy.length) btEl('bt-out').innerHTML += `<p class="cr-source-note">Coins with missing candles (periods with no trades appear to be skipped, so indicators run on uneven spacing): ${gappy.join(', ')}.</p>`;
    if (notes.length) btEl('bt-out').innerHTML += `<p class="cr-source-note">${notes.join(' &middot; ')}</p>`;
    btEl('bt-json').value = JSON.stringify({ suite: 'v2.2', backtest: 'v1.2', params: o, coinsTested: tested, signalsScored: rows.length, later40: sigStats(later, o.horizon), earlier60: sigStats(earlier, o.horizon), gappyCoins: gappy, notes }, null, 1);
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
