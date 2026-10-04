/* Crypto Radar Big-Mover Study v1.0 (suite v2.3) — loads AFTER crypto-radar-backtest.js and reuses its btHistory()/wilson()/BT.
   Question: of the days followed by a big rally, what did simple fixed rules show on the day before, and how many false alarms came with each catch?
   Rules are fixed in advance and NOT tuned. Signal at a candle's close; the move is measured from the NEXT open, on CLOSES (a one-trade spike on a thin book does not count).
   Short-history coins are included (first signal at candle 80). Output describes the past. It is not a forecast. */
const BG = {
  MIN_CANDLES: 80,
  RULES: [   // [label, test(row)]
    ['20-candle breakout', r => r.f.brk],
    ['Volume surge (3x the 20-candle average)', r => r.f.vol],
    ['Breakout with volume surge', r => r.f.brk && r.f.vol],
    ['Volatility squeeze (narrowest 10% of the last 60 candles)', r => r.f.sqz],
    ['Already up 10%+ in the last 3 candles', r => r.f.ran],
  ],
};

function bgRows(c, o) {   // c = closed candles, oldest first; every flag at index i uses candles <= i only
  const cl = c.map(x => x.close), bb = bollinger(cl, 20, 2), w = bb.mid.map((m, i) => bb.upper[i] != null ? (bb.upper[i] - bb.lower[i]) / m : null), rows = [];
  for (let i = BG.MIN_CANDLES - 1; i <= c.length - 1 - o.horizon; i++) {
    const vAvg = btMean(c.slice(i - 20, i).map(x => x.volume)), win = w.slice(i - 59, i + 1), e = c[i + 1].open;
    let best = 0; for (let k = i + 1; k <= i + o.horizon; k++) best = Math.max(best, c[k].close / e - 1);
    rows.push({ ts: c[i].timestamp, big: best * 100 >= o.big, f: {
      brk: cl[i] > Math.max(...cl.slice(i - 20, i)), vol: vAvg > 0 && c[i].volume >= 3 * vAvg,
      sqz: win.every(x => x != null) && win.filter(x => x <= w[i]).length <= 6, ran: cl[i] / cl[i - 3] - 1 >= 0.10 } });
  }
  const cut = Math.floor(rows.length * BT.TRAIN_FRACTION); rows.forEach((r, k) => { r.split = k < cut ? 'in' : 'out'; });
  return rows;
}

function bgStats(rows, H) {
  const N = rows.length, ev = rows.filter(r => r.big).length, base = N ? ev / N : 0;
  return { N, ev, base, rules: BG.RULES.map(([label, f]) => {
    const fired = rows.filter(f), n = fired.length, hits = fired.filter(r => r.big).length, p = n ? hits / n : 0, nEff = Math.max(1, n / H);
    const [lo, hi] = wilson(p, nEff), [lo99] = wilson(p, nEff, BT.Z_BAR);   // overlap-adjusted ranges
    return { label, n, months: new Set(fired.map(r => Math.floor(r.ts / 2.592e9))).size, hits, p, lo, hi, lift: base ? p / base : null, catchRate: ev ? hits / ev : null, falsePerCatch: hits ? (n - hits) / hits : null, beats: n > 0 && lo99 > base };
  }) };
}
function bgTable(rows, H) {
  const s = bgStats(rows, H), f = (v, d = 1) => v.toFixed(d);
  const tr = b => b.n
    ? `<tr><td>${b.label}</td><td>${b.n} <small>(${b.months} mo)</small></td><td>${b.hits}</td><td>${f(b.p * 100)}% <small>(${f(b.lo * 100, 0)}-${f(b.hi * 100, 0)})</small>${b.beats ? ' \u2713' : ''}</td><td>${b.lift == null ? '-' : f(b.lift) + 'x'}</td><td>${b.catchRate == null ? '-' : f(b.catchRate * 100, 0) + '%'}</td><td>${b.falsePerCatch == null ? 'no catches' : f(b.falsePerCatch, 0)}</td></tr>`
    : `<tr><td>${b.label}</td><td colspan="6">no signals</td></tr>`;
  return `<p class="cr-source-note">${s.N} days scored, ${s.ev} followed by a big rally: a random day has a ${f(s.base * 100)}% chance.</p><table class="cr-config-table"><thead><tr><th>Rule</th><th>Fired</th><th>Big rallies caught</th><th>Followed by a big rally <small>(95% range)</small></th><th>vs random day</th><th>Share of all big rallies caught</th><th>False alarms per catch</th></tr></thead><tbody>${s.rules.map(tr).join('')}</tbody></table>`;
}
function bgVerdict(later, early, H) {   // a rule passes only if it beats a random day at the 99% bar in BOTH halves
  const L = bgStats(later, H), E = bgStats(early, H), pass = L.rules.filter((b, k) => b.beats && E.rules[k].beats).map(b => b.label);
  return pass.length ? `Beat a random day at the strict (99%) bar in BOTH halves: ${pass.join('; ')}. Promising, not proof: the next step is a forward test.`
    : `None of the ${BG.RULES.length} rules beat a random day at the strict (99%) bar in both halves: no reliable early warning found.` + (L.ev < 20 ? ` Only ${L.ev} big rallies in the later 40%: too few to judge much.` : '');
}

async function runBigMovers() {
  const g = id => document.getElementById(id), st = t => { g('bg-status').textContent = t; };
  const o = { big: +g('bg-big').value, horizon: Math.round(+g('bg-horizon').value), duration: +g('bg-duration').value };
  if (!(o.big > 0 && o.horizon >= 1)) return st('Check the numbers: the big rally % and the window must be positive.');
  if (!state.workerUrl) return st('Needs a live Worker: set WORKER_URL in crypto-radar.js.');
  const btn = g('bg-run'); btn.disabled = true; g('bg-out').innerHTML = ''; g('bg-verdict').textContent = '';
  try {
    st('Loading the pair list...');
    const markets = ((await apiFetch('/api/markets')).markets || []).sort((a, b) => myrVolume(b) - myrVolume(a));
    const pairs = markets.slice(0, g('bg-pairs').value === 'all' ? markets.length : +g('bg-pairs').value).map(m => m.pair);
    const rows = [], notes = []; let tested = 0;
    for (let p = 0; p < pairs.length; p++) {
      st(`Coin ${p + 1} of ${pairs.length}: ${pairs[p]} - fetching history...`);
      let c; try { c = await btHistory(pairs[p], o.duration); } catch (e) { notes.push(`${pairs[p]}: no data (${e.message})`); continue; }
      if (c.length < BG.MIN_CANDLES + o.horizon + 10) { notes.push(`${pairs[p]}: only ${c.length} closed candles, skipped`); continue; }
      bgRows(c, o).forEach(r => { r.pair = pairs[p]; rows.push(r); }); tested++;
      await new Promise(r => setTimeout(r, 120));   // stay well under Luno's 300 calls per minute
    }
    const later = rows.filter(r => r.split === 'out'), early = rows.filter(r => r.split === 'in');
    g('bg-verdict').textContent = rows.length ? bgVerdict(later, early, o.horizon) : 'No coin had enough history.';
    g('bg-out').innerHTML = rows.length ? `<h3>Later 40% of each coin's history: the fairer test</h3>${bgTable(later, o.horizon)}<h3>Earlier 60%</h3>${bgTable(early, o.horizon)}` + (notes.length ? `<p class="cr-source-note">${notes.join(' &middot; ')}</p>` : '') : '';
    g('bg-json').value = JSON.stringify({ suite: 'v2.3', bigMovers: 'v1.0', params: o, coinsTested: tested, daysScored: rows.length, later40: bgStats(later, o.horizon), earlier60: bgStats(early, o.horizon), notes }, null, 1);
    st(`Done: ${rows.length} days scored across ${tested} coins at ${new Date().toLocaleTimeString('en-MY')}.`);
  } catch (e) { st('Study failed: ' + e.message); }
  finally { btn.disabled = false; }
}

let bgInitialized = false;
function bgInit() {
  const b = document.getElementById('bg-run'); if (bgInitialized || !b) return; bgInitialized = true;
  state.workerUrl = CONFIG.WORKER_URL;
  b.addEventListener('click', runBigMovers);
  document.getElementById('bg-json').addEventListener('focus', e => e.target.select());
}
document.addEventListener('DOMContentLoaded', bgInit);
