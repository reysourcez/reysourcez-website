/* Crypto Radar Backtest v1.0 (suite v2.0) — loads AFTER crypto-radar.js and reuses its computeAll()/CONFIG, so it tests exactly what the live page scores.
   Rules: closed candles only; signal at a candle's close, entry at the NEXT open (no look-ahead); stop is checked before target inside a candle (pessimistic).
   Output describes the past. It is not a forecast. */
const BT = {
  HISTORY_CANDLES: 990,   // Luno returns at most ~1000 candles per call
  TRAIN_FRACTION: 0.6,    // first 60% of each pair's history = earlier period; last 40% = the fairer test
  BUCKETS: [['Score 50+', s => s >= 50], ['Score 25 to 49', s => s >= 25 && s < 50], ['Score 0 to 24', s => s >= 0 && s < 25], ['Score below 0', s => s < 0]],
  PRESETS: { swing: [8, 4, 7], big: [25, 12, 60], huge: [40, 15, 90] }, // target %, stop %, window in candles
};
const btMean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const btMedian = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
function wilson(p, n, z = 1.96) { if (!n) return [0, 0]; const d = 1 + z * z / n, c = p + z * z / (2 * n), m = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)); return [(c - m) / d, (c + m) / d]; }

// Signal on closed candle i -> enter at open of i+1 -> watch candles i+1..i+H.
function outcomeAt(c, i, o) {
  const e = c[i + 1].open, tp = e * (1 + o.target / 100), sl = e * (1 - o.stop / 100);
  let res = null, mfe = 0, mae = 0;
  for (let k = i + 1; k <= i + o.horizon; k++) {
    mfe = Math.max(mfe, c[k].high / e - 1); mae = Math.min(mae, c[k].low / e - 1);
    if (!res) res = c[k].low <= sl ? 'loss' : c[k].high >= tp ? 'win' : null;
  }
  res = res || 'timeout';
  const gross = res === 'win' ? o.target : res === 'loss' ? -o.stop : (c[i + o.horizon].close / e - 1) * 100;
  return { res, ret: gross - o.cost, mfe: mfe * 100, mae: mae * 100 };
}

async function backtestPair(c, o, onTick) {   // c = closed candles, oldest first
  const W = CONFIG.CANDLE_LOOKBACK_COUNT, rows = [];
  for (let i = W - 1; i <= c.length - 1 - o.horizon; i++) {
    const score = computeAll(c.slice(i - W + 1, i + 1)).score;   // sees candles <= i only
    rows.push({ i, ts: c[i].timestamp, score, ...outcomeAt(c, i, o) });
    if (onTick && rows.length % 25 === 0) await onTick(rows.length);
  }
  const cut = Math.floor(rows.length * BT.TRAIN_FRACTION);
  rows.forEach((r, k) => { r.split = k < cut ? 'in' : 'out'; });
  return rows;
}

function summarize(rows, H) {
  const n = rows.length; if (!n) return { n: 0 };
  const p = rows.filter(r => r.res === 'win').length / n, nEff = Math.max(1, n / H), [lo, hi] = wilson(p, nEff);   // overlap-adjusted range
  return { n, p, lo, hi, timeout: rows.filter(r => r.res === 'timeout').length / n, avg: btMean(rows.map(r => r.ret)), mfe: btMedian(rows.map(r => r.mfe)), mae: btMedian(rows.map(r => r.mae)) };
}
function bucketStats(rows, H) {
  const base = summarize(rows, H);
  return [['Any day (random entry)', base, true], ...BT.BUCKETS.map(([n, f]) => [n, summarize(rows.filter(r => f(r.score)), H), false])]
    .map(([label, s, isBase]) => ({ label, isBase, ...s, lift: (isBase || !s.n) ? null : (s.p - base.p) * 100, beats: !isBase && s.n > 0 && s.lo > base.p }));
}
function tableHtml(rows, o) {
  const f = (v, d = 1) => v.toFixed(d);
  const tr = b => b.n
    ? `<tr><td>${b.label}</td><td>${b.n}</td><td>${f(b.p * 100)}% <small>(${f(b.lo * 100, 0)}-${f(b.hi * 100, 0)})</small></td><td>${b.isBase ? '-' : (b.lift >= 0 ? '+' : '') + f(b.lift) + ' pts' + (b.beats ? ' \u2713' : '')}</td><td>${f(b.timeout * 100, 0)}%</td><td>${f(b.avg, 2)}%</td><td>+${f(b.mfe)}% / ${f(b.mae)}%</td></tr>`
    : `<tr><td>${b.label}</td><td colspan="6">no signals</td></tr>`;
  return `<table class="cr-config-table"><thead><tr><th>Signal</th><th>Count</th><th>Hit rate <small>(95% range)</small></th><th>vs random entry</th><th>Timed out</th><th>Avg net return</th><th>Median best / worst point</th></tr></thead><tbody>${bucketStats(rows, o.horizon).map(tr).join('')}</tbody></table>`;
}
function verdict(rows, o) {
  const base = summarize(rows, o.horizon), top = summarize(rows.filter(r => r.score >= 25), o.horizon);
  if (!top.n || top.n / o.horizon < 15) return 'Too few independent strong signals in the later 40% to judge.';
  if (top.lo > base.p) return 'Strong scores beat random entry in the later 40%: a promising sign, not proof.';
  if (top.hi < base.p) return 'Strong scores did WORSE than random entry in the later 40%.';
  return 'No reliable edge detected: strong scores were not distinguishable from random entry in the later 40%.';
}

async function btHistory(pair, duration) {
  const step = duration * 1000, since = Math.floor((Date.now() - step * BT.HISTORY_CANDLES) / step) * step;
  const d = await apiFetch(`/api/candles?pair=${pair}&duration=${duration}&since=${since}`);
  const c = (d.candles || []).map(x => ({ timestamp: x.timestamp, open: +x.open, high: +x.high, low: +x.low, close: +x.close, volume: +x.volume }));
  return c.filter(x => x.timestamp + step <= Date.now());   // drop the still-forming candle
}

const btEl = id => document.getElementById(id), btVal = id => btEl(id).value;
const btStatus = t => { btEl('bt-status').textContent = t; };

async function runBacktest() {
  const o = { target: +btVal('bt-target'), stop: +btVal('bt-stop'), horizon: Math.round(+btVal('bt-horizon')), cost: +btVal('bt-cost'), duration: +btVal('bt-duration') };
  if (!(o.target > 0 && o.stop > 0 && o.stop < 100 && o.horizon >= 1 && o.cost >= 0)) return btStatus('Check the numbers: target, stop and window must be positive, and stop under 100.');
  if (!state.workerUrl) return btStatus('Needs a live Worker: set WORKER_URL in crypto-radar.js.');
  const btn = btEl('bt-run'); btn.disabled = true; btEl('bt-out').innerHTML = ''; btEl('bt-verdict').textContent = '';
  try {
    btStatus('Loading the pair list...');
    const markets = ((await apiFetch('/api/markets')).markets || []).sort((a, b) => myrVolume(b) - myrVolume(a));
    const pairs = markets.slice(0, btVal('bt-pairs') === 'all' ? markets.length : +btVal('bt-pairs')).map(m => m.pair);
    const rows = [], notes = [], gappy = []; let tested = 0;
    for (let p = 0; p < pairs.length; p++) {
      const pair = pairs[p];
      btStatus(`Coin ${p + 1} of ${pairs.length}: ${pair} - fetching history...`);
      let c;
      try { c = await btHistory(pair, o.duration); } catch (e) { notes.push(`${pair}: no data (${e.message})`); continue; }
      const need = CONFIG.CANDLE_LOOKBACK_COUNT + o.horizon + 30;
      if (c.length < need) { notes.push(`${pair}: only ${c.length} closed candles (needs ${need}), skipped`); continue; }
      const gaps = c.slice(1).filter((x, k) => x.timestamp - c[k].timestamp !== o.duration * 1000).length / (c.length - 1);
      if (gaps > 0.02) gappy.push(`${pair} ${(gaps * 100).toFixed(0)}%`);
      const part = await backtestPair(c, o, n => { btStatus(`Coin ${p + 1} of ${pairs.length}: ${pair} - scored ${n} points...`); return new Promise(r => setTimeout(r, 0)); });
      part.forEach(r => { r.pair = pair; rows.push(r); }); tested++;
    }
    const later = rows.filter(r => r.split === 'out'), earlier = rows.filter(r => r.split === 'in');
    btEl('bt-verdict').textContent = rows.length ? verdict(later, o) : 'No coin had enough history.';
    btEl('bt-out').innerHTML = rows.length ? `<h3>Later 40% of each coin's history: the fairer test</h3>${tableHtml(later, o)}<h3>Earlier 60%</h3>${tableHtml(earlier, o)}` : '';
    if (gappy.length) btEl('bt-out').innerHTML += `<p class="cr-source-note">Coins with missing candles (periods with no trades appear to be skipped, so indicators run on uneven spacing): ${gappy.join(', ')}.</p>`;
    if (notes.length) btEl('bt-out').innerHTML += `<p class="cr-source-note">${notes.join(' &middot; ')}</p>`;
    btEl('bt-json').value = JSON.stringify({ suite: 'v2.0', backtest: 'v1.0', params: o, coinsTested: tested, signalsScored: rows.length, later40: bucketStats(later, o.horizon), earlier60: bucketStats(earlier, o.horizon), gappyCoins: gappy, notes }, null, 1);
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
