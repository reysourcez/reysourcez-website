/* Crypto Radar Relationship Study v1.0 (suite v2.8) — loads AFTER crypto-radar-backtest.js and reuses its btHistory()/btSleep()/btMedian()/BT, plus apiFetch()/myrVolume() from crypto-radar.js.
   Question (R, 2026-10-12): do altcoins move WITH, AGAINST or AFTER Bitcoin, the Nasdaq Composite and the S&P 500?
   DESCRIPTIVE ONLY: no entry or exit rule, no costs; nothing here can pass or fail the backtest's strict bar. Correlation is not cause and is not a forecast.
   Everything below was fixed in advance and is NOT tuned on the data: the lags, the coin basket, the 60/40 split, the bootstrap, the verdict rule and the 11 judged rows.
   Data: Luno DAILY candles through the Worker (always daily, whatever candle size the backtest above uses) and, optionally, two daily CSV files you load yourself (Nasdaq Composite, S&P 500; for example from FRED).
   Returns are log returns of closes. "Alt basket" = equal-weight average over the loaded alts (Bitcoin, gold tokens and stablecoins left out) that have both closes in the window; it needs BT.MIN_BREADTH_COINS coins.
   Timing: a Luno daily candle covers a whole UTC day; the US market closes about 20:00-21:00 UTC. A stock row dated D is paired with the crypto window from the close of the previous stock date's candle to the close of D's candle (a Monday covers the weekend).
   Lag k: the FIRST series (Bitcoin or the stock index) moves, the SECOND (alts, or Bitcoin) is read k windows later; negative k = the second one moved first.
   Intervals: block bootstrap on Fisher z. The 95% range is for reading; the strict range (z = REL.Z_BAR) decides the verdict, and must clear zero in the whole sample AND in both halves. */
const REL = {
  LAGS: [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5],
  HEADLINE: { btc: [-1, 0, 1], stock: [0, 1] },   // lags that get a verdict (fixed in advance). For stock pairs lag -1 overlaps the stock window by about 3-4 hours, so it is shown but not judged
  FAMILY: 11,                // judged rows: 3 (alts vs Bitcoin) + 4 stock pairs x 2 lags
  Z_BAR: 2.84,               // 5% over 11 two-sided tests = 0.05 / 22 per tail: the same bar as the backtest's 22 one-sided rules
  Z95: 1.96,
  BLOCK: 10,                 // block-bootstrap block length, in windows (volatility clusters, so neighbouring days are not independent)
  RESAMPLES: 1000,
  SEED: 20261013,            // fixed: the same data always gives the same ranges
  MIN_CANDLES: 60,           // a coin needs this many daily candles to join the basket
  MIN_PAIRS: 100,           // fewer paired windows than this: not judged
  MIN_HALF: 50,              // a half with fewer paired windows cannot confirm anything
  MIN_FILE_ROWS: 120,        // a stock file needs this many usable daily rows
  MAX_GAP_DAYS: 7,           // a jump of more than this many days in a stock file is a hole in the file, not a holiday: windows never span it
  ROLL: 90, ROLL_BAND: 0.2,  // rolling view: correlation over each stretch of 90 paired windows; "positive" above +0.2, "negative" below -0.2
  STABLE: /^(USDC|USDT|DAI|TUSD|BUSD|PYUSD|FDUSD|USDP|GUSD|USDG)MYR$/,   // stablecoins are not alts
  CACHE_MS: 30 * 60 * 1000,  // daily candles are kept in memory this long, so a second run (for example after loading a file) does not download again
  FILES: [['nasdaq', 'rel-nasdaq', 'Nasdaq Composite', /nasdaq|ixic/i], ['sp500', 'rel-sp500', 'S&P 500', /sp500|s&p|gspc|spx/i]],   // [key, file box id, label, filename/header hint]
  PAIRS: [   // first series moves, second series is read k windows later
    { id: 'altsBtc', label: 'Alt basket vs Bitcoin', first: 'Bitcoin', second: 'alts', mode: 'calendar', head: 'btc', file: null, y: 'alts' },
    { id: 'altsNasdaq', label: 'Alt basket vs Nasdaq Composite', first: 'Nasdaq', second: 'alts', mode: 'stock', head: 'stock', file: 'nasdaq', y: 'alts' },
    { id: 'altsSp500', label: 'Alt basket vs S&P 500', first: 'S&P 500', second: 'alts', mode: 'stock', head: 'stock', file: 'sp500', y: 'alts' },
    { id: 'btcNasdaq', label: 'Bitcoin vs Nasdaq Composite (reference)', first: 'Nasdaq', second: 'Bitcoin', mode: 'stock', head: 'stock', file: 'nasdaq', y: 'btc' },
    { id: 'btcSp500', label: 'Bitcoin vs S&P 500 (reference)', first: 'S&P 500', second: 'Bitcoin', mode: 'stock', head: 'stock', file: 'sp500', y: 'btc' },
  ],
};
const relEl = id => document.getElementById(id);
const relEsc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const relDay = ts => Math.floor(ts / 86400000) * 86400000;
const relIso = ms => new Date(ms).toISOString().slice(0, 10);
const relSg = (v, d = 2) => v == null || !Number.isFinite(v) ? '-' : (v >= 0 ? '+' : '') + v.toFixed(d);
const relStrength = r => { const a = Math.abs(r); return a < 0.1 ? 'negligible' : a < 0.3 ? 'weak' : a < 0.5 ? 'moderate' : 'strong'; };
function relRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }   // mulberry32

// ---------- statistics ----------
function relPearson(x, y) {
  const n = x.length; if (n < 3) return null;
  let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += x[i]; sy += y[i]; }
  const mx = sx / n, my = sy / n; let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxx += a * a; syy += b * b; sxy += a * b; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}
function relRanks(a) {   // average ranks (ties share the mean rank)
  const n = a.length, idx = a.map((v, i) => i).sort((i, j) => a[i] - a[j]), r = new Array(n);
  for (let s = 0; s < n;) { let e = s; while (e + 1 < n && a[idx[e + 1]] === a[idx[s]]) e++; const avg = (s + e) / 2 + 1; for (let k = s; k <= e; k++) r[idx[k]] = avg; s = e + 1; }
  return r;
}
const relSpearman = (x, y) => relPearson(relRanks(x), relRanks(y));
function relBootSd(x, y, seed) {   // circular block bootstrap of the paired series; returns the standard deviation of Fisher z = atanh(r) over RESAMPLES resamples
  const n = x.length, L = Math.max(1, Math.min(REL.BLOCK, n)), m = n + L, P = [0, 1, 2, 3, 4].map(() => new Float64Array(m + 1));
  for (let j = 0; j < m; j++) { const a = x[j % n], b = y[j % n]; P[0][j + 1] = P[0][j] + a; P[1][j + 1] = P[1][j] + b; P[2][j + 1] = P[2][j] + a * a; P[3][j + 1] = P[3][j] + b * b; P[4][j + 1] = P[4][j] + a * b; }
  const nb = Math.ceil(n / L), N = nb * L, rnd = relRng(seed), zs = new Float64Array(REL.RESAMPLES);
  for (let b = 0; b < REL.RESAMPLES; b++) {
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let k = 0; k < nb; k++) { const s = Math.floor(rnd() * n); sx += P[0][s + L] - P[0][s]; sy += P[1][s + L] - P[1][s]; sxx += P[2][s + L] - P[2][s]; syy += P[3][s + L] - P[3][s]; sxy += P[4][s + L] - P[4][s]; }
    const vx = sxx / N - (sx / N) ** 2, vy = syy / N - (sy / N) ** 2, r = vx > 0 && vy > 0 ? (sxy / N - (sx / N) * (sy / N)) / Math.sqrt(vx * vy) : 0;
    zs[b] = Math.atanh(Math.max(-0.999999, Math.min(0.999999, r)));
  }
  let mean = 0; for (const v of zs) mean += v; mean /= zs.length;
  let ss = 0; for (const v of zs) ss += (v - mean) ** 2;
  return Math.sqrt(ss / (zs.length - 1));
}
function relInterval(r, sd, z) { const zr = Math.atanh(Math.max(-0.999999, Math.min(0.999999, r))); return [Math.tanh(zr - z * sd), Math.tanh(zr + z * sd)]; }
function relRolling(p, win) {   // Pearson r over each stretch of `win` consecutive paired windows
  const out = []; if (p.x.length < win) return out;
  for (let e = win; e <= p.x.length; e++) { const r = relPearson(p.x.slice(e - win, e), p.y.slice(e - win, e)); if (r !== null) out.push(r); }
  return out;
}
function relRollSummary(a, band) {
  if (!a.length) return null;
  const s = [...a].sort((u, v) => u - v), pos = a.filter(v => v > band).length, neg = a.filter(v => v < -band).length;
  return { n: a.length, pos: pos / a.length, mid: (a.length - pos - neg) / a.length, neg: neg / a.length, latest: a[a.length - 1], min: s[0], max: s[s.length - 1], median: btMedian(a) };
}

// ---------- reading a stock file ----------
function relDateMs(t) {   // one date cell -> UTC-midnight ms, or NaN. Accepts 2026-10-09, 2026-10-09T..., 2026-10-09 14:30:00 and unix seconds or milliseconds
  if (/^\d{9,}(\.\d+)?$/.test(t)) return relDay(+t > 1e11 ? +t : +t * 1000);
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return Date.parse(t.slice(0, 10) + 'T00:00:00Z');
  return NaN;
}
function relParseCsv(text) {   // FRED (observation_date or DATE, then one value column; missing days are "." or empty), TradingView / Yahoo style (date or time plus a close column) or any 2-column date,value file -> sorted daily rows
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
  if (lines.length < 2) throw new Error('no data rows found');
  const count = (s, ch) => s.split(ch).length - 1, delim = count(lines[0], '\t') > count(lines[0], ',') ? '\t' : count(lines[0], ';') > count(lines[0], ',') ? ';' : ',';
  const cell = x => (x || '').trim().replace(/^"|"$/g, '').trim(), split = l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === delim && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(cell); };   // quote-aware: a comma inside quotes, as in "5,432.10", stays inside its cell
  const first = split(lines[0]), headed = !Number.isFinite(relDateMs(first[0])), head = first.map(h => h.toLowerCase());
  let di = 0, vi = -1;
  if (headed) {
    const d = head.findIndex(h => ['observation_date', 'date', 'datetime', 'time', 'timestamp'].includes(h)); if (d >= 0) di = d;
    vi = head.findIndex(h => ['close', 'adj close', 'adj_close', 'price', 'value'].includes(h));
    if (vi < 0) vi = head.findIndex((h, k) => k !== di);   // FRED: the other column, named after the series id
  } else vi = first.length > 1 ? 1 : -1;
  if (vi < 0) throw new Error(`could not find a value column (first line: "${lines[0].slice(0, 80)}")`);
  const byDay = new Map(); let missing = 0, bad = 0, sample = null;
  for (const line of lines.slice(headed ? 1 : 0)) {
    const cs = split(line), ms = relDateMs(cs[di] || ''), raw = cs[vi] === undefined ? '' : cs[vi];
    if (!Number.isFinite(ms)) { bad++; sample = sample || line.slice(0, 80); continue; }
    if (raw === '' || raw === '.' || /^(na|n\/a|nan|null|none)$/i.test(raw)) { missing++; continue; }   // a market holiday: not an error
    const v = +raw.replace(/,/g, ''); if (!(v > 0)) { bad++; sample = sample || line.slice(0, 80); continue; }
    byDay.set(ms, v);
  }
  const series = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([d, close]) => ({ d, close }));
  if (series.length < REL.MIN_FILE_ROWS) throw new Error(`only ${series.length} usable daily rows (needs ${REL.MIN_FILE_ROWS}+; header "${lines[0].slice(0, 60)}"${sample ? ', first unreadable line "' + sample + '"' : ''})`);
  return { series, from: series[0].d, to: series[series.length - 1].d, rows: series.length, missing, bad, header: headed ? lines[0].slice(0, 60) : '(none)' };
}

// ---------- building the paired series ----------
function relBasketRet(maps, alts, d0, d1) {   // equal-weight average log return of the alts that have BOTH closes (null when fewer than BT.MIN_BREADTH_COINS)
  let s = 0, n = 0;
  for (const p of alts) { const m = maps[p], a = m.get(d0), b = m.get(d1); if (a > 0 && b > 0) { s += Math.log(b / a); n++; } }
  return n >= BT.MIN_BREADTH_COINS ? { r: s / n, n } : null;
}
function relPairUp(X, Y, k, run) {   // pair X[i] with Y[i+k]; both must exist, and (stock files) lie in the same unbroken stretch of the file
  const x = [], y = [], idx = [];
  for (let i = 0; i < X.length; i++) { const j = i + k; if (j < 0 || j >= Y.length || X[i] === undefined || Y[j] === undefined) continue; if (run && run[i] !== run[j]) continue; x.push(X[i]); y.push(Y[j]); idx.push(i); }
  return { x, y, i: idx };
}
function relCell(p, cut, lag, seed, headline) {
  const n = p.x.length, r = n >= REL.MIN_PAIRS ? relPearson(p.x, p.y) : null;
  if (r === null) return { lag, n, headline, tooFew: true };
  const sd = relBootSd(p.x, p.y, seed), [lo95, hi95] = relInterval(r, sd, REL.Z95), [loS, hiS] = relInterval(r, sd, REL.Z_BAR);
  const half = (sel, s) => {
    const x = [], y = []; p.i.forEach((i, k) => { if (sel(i)) { x.push(p.x[k]); y.push(p.y[k]); } });
    const rr = x.length >= REL.MIN_HALF ? relPearson(x, y) : null; if (rr === null) return { n: x.length, r: null };
    if (!headline) return { n: x.length, r: rr };
    const [lo, hi] = relInterval(rr, relBootSd(x, y, s), REL.Z_BAR); return { n: x.length, r: rr, lo, hi };
  };
  return { lag, n, headline, r, rho: relSpearman(p.x, p.y), lo95, hi95, loS, hiS, earlier: half(i => i < cut, seed + 1), later: half(i => i >= cut, seed + 2) };
}
function relReading(c) {   // the verdict for a judged row: the strict range must clear zero in the whole sample AND in both halves, in the same direction
  if (!c || c.tooFew) return 'too few windows to judge';
  const sg = (lo, hi) => lo > 0 ? 1 : hi < 0 ? -1 : 0, a = sg(c.loS, c.hiS), E = c.earlier, L = c.later;
  const e = E && E.lo != null ? sg(E.lo, E.hi) : null, l = L && L.lo != null ? sg(L.lo, L.hi) : null, word = s => s > 0 ? 'together' : 'opposite', st = relStrength(c.r);
  if (a !== 0) {
    if (e === null || l === null) return `${word(a)} overall (${st}), but a half has too few windows to confirm`;
    return e === a && l === a ? `${word(a)} (${st}), clear in both halves` : `${word(a)} overall (${st}) but NOT clear in both halves`;
  }
  if (e !== null && l !== null && e !== 0 && l !== 0 && e !== l) return 'flips sign between the halves';
  if ((e || 0) !== 0 || (l || 0) !== 0) return 'no clear link overall (clear in one half only)';
  return 'no clear link';
}
function relAnalyse(hist, files) {   // pure and synchronous: hist = { pair -> daily candles, oldest first }, files = { nasdaq / sp500 -> parsed file }
  const DAY = 86400000, notes = [], maps = {}, leftOut = [], alts = [], res = { alts, leftOut, pairs: [], notes, basket: null, files: {}, candleStart: null };
  Object.keys(hist).forEach(p => { const m = new Map(); hist[p].forEach(x => m.set(relDay(x.timestamp), x.close)); maps[p] = m; });
  const offs = new Map(); let nC = 0;   // the stock timing assumes a daily candle starts at 00:00 UTC; Luno's documents do not say, so the page checks the candles it actually received
  Object.keys(hist).forEach(p => hist[p].forEach(x => { const o = ((x.timestamp % DAY) + DAY) % DAY; offs.set(o, (offs.get(o) || 0) + 1); nC++; }));
  const topOff = [...offs.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topOff) {
    const at = new Date(topOff[0]).toISOString().slice(11, 16), share = topOff[1] / nC;
    res.candleStart = { utc: at, share: +share.toFixed(3) };
    if (topOff[0] !== 0 || share < 0.99) notes.push(`Luno's daily candles do not all start at 00:00 UTC (${Math.round(share * 100)}% start at ${at} UTC). The stock rows assume midnight, so each stock day may be matched with the wrong crypto window, by up to a day: do not rely on the Nasdaq and S&P 500 rows until the assistant has checked this. The alt-versus-Bitcoin rows do not depend on it`);
  }
  Object.keys(hist).forEach(p => {
    if (p === 'XBTMYR') return;
    if (BT.NOT_ALTS.includes(p)) leftOut.push(p + ' (gold token)');
    else if (REL.STABLE.test(p)) leftOut.push(p + ' (stablecoin)');
    else if (hist[p].length < REL.MIN_CANDLES) leftOut.push(p + ' (under ' + REL.MIN_CANDLES + ' daily candles)');
    else alts.push(p);
  });
  if (!alts.length) { notes.push('no alt coin has enough history'); return res; }
  const btc = maps.XBTMYR; if (!btc) notes.push('Bitcoin (XBTMYR) history is missing, so the Bitcoin comparisons were skipped');
  let day0 = Infinity, day1 = -Infinity;
  Object.keys(hist).forEach(p => { const c = hist[p]; if (c.length) { day0 = Math.min(day0, relDay(c[0].timestamp)); day1 = Math.max(day1, relDay(c[c.length - 1].timestamp)); } });
  const nDays = Math.round((day1 - day0) / DAY) + 1, CX = new Array(nDays), CY = new Array(nDays); let bDays = 0, bCoins = 0, bFrom = null, bTo = null;
  for (let di = 1; di < nDays; di++) {   // calendar windows: the previous day's close to this day's close
    const d1 = day0 + di * DAY, d0 = d1 - DAY, a = btc && btc.get(d0), b = btc && btc.get(d1), k = relBasketRet(maps, alts, d0, d1);
    if (a > 0 && b > 0) CX[di] = Math.log(b / a);
    if (k) { CY[di] = k.r; bDays++; bCoins += k.n; bFrom = bFrom === null ? d1 : bFrom; bTo = d1; }
  }
  res.basket = bDays ? { coins: alts.length, days: bDays, avgCoinsPerDay: +(bCoins / bDays).toFixed(1), from: relIso(bFrom), to: relIso(bTo) } : null;
  if (!bDays) notes.push(`the alt basket never reached ${BT.MIN_BREADTH_COINS} coins on the same day, so every alt comparison was skipped`);
  const stock = {};
  for (const [key] of REL.FILES) {
    const f = files && files[key]; if (!f) continue;
    res.files[key] = { name: f.name, rows: f.rows, from: relIso(f.from), to: relIso(f.to), missingDays: f.missing, unreadableRows: f.bad };
    const rows = f.series, m = rows.length, SX = new Array(m), YA = new Array(m), YB = new Array(m), run = new Array(m); let id = 0;
    for (let r = 0; r < m; r++) {
      if (r === 0) { run[r] = id; continue; }
      const gap = (rows[r].d - rows[r - 1].d) / DAY; if (gap > REL.MAX_GAP_DAYS) id++;
      run[r] = id; if (gap > REL.MAX_GAP_DAYS) continue;   // the window would span a hole in the file
      SX[r] = Math.log(rows[r].close / rows[r - 1].close);
      const d0 = rows[r - 1].d, d1 = rows[r].d, a = btc && btc.get(d0), b = btc && btc.get(d1), k = relBasketRet(maps, alts, d0, d1);
      if (a > 0 && b > 0) YB[r] = Math.log(b / a);
      if (k) YA[r] = k.r;
    }
    stock[key] = { SX, YA, YB, run, dateOf: i => rows[i].d };
  }
  REL.PAIRS.forEach((def, pi) => {
    const pr = { id: def.id, label: def.label, first: def.first, second: def.second, mode: def.mode, cells: [] }; res.pairs.push(pr);
    let X, Y, run = null, dateOf;
    if (def.mode === 'calendar') { if (!btc) { pr.skipped = 'Bitcoin history missing'; return; } X = CX; Y = CY; dateOf = i => day0 + i * DAY; }
    else { const s = stock[def.file]; if (!s) { pr.skipped = 'no file loaded'; return; } if (def.y === 'btc' && !btc) { pr.skipped = 'Bitcoin history missing'; return; } X = s.SX; Y = def.y === 'alts' ? s.YA : s.YB; run = s.run; dateOf = s.dateOf; }
    const p0 = relPairUp(X, Y, 0, run); pr.n0 = p0.x.length;
    if (pr.n0 < REL.MIN_PAIRS) { pr.skipped = `only ${pr.n0} overlapping windows (needs ${REL.MIN_PAIRS}+)`; return; }
    const cut = p0.i[Math.floor(p0.i.length * BT.TRAIN_FRACTION)], head = REL.HEADLINE[def.head], at = {};
    pr.from = relIso(dateOf(p0.i[0])); pr.to = relIso(dateOf(p0.i[p0.i.length - 1])); pr.split = relIso(dateOf(cut));
    REL.LAGS.forEach(k => { const p = k === 0 ? p0 : relPairUp(X, Y, k, run); at[k] = p; pr.cells.push(relCell(p, cut, k, REL.SEED + pi * 1000 + (k + 5) * 10, head.includes(k))); });
    pr.rolling = { 0: relRollSummary(relRolling(at[0], REL.ROLL), REL.ROLL_BAND), 1: relRollSummary(relRolling(at[1], REL.ROLL), REL.ROLL_BAND) };
  });
  return res;
}

// ---------- reading it out ----------
function relTiming(pr, k) {
  const u = pr.mode === 'calendar' ? 'day' : 'window', n = Math.abs(k), s = n === 1 ? '' : 's';
  if (k === 0) return `same ${u}`;
  return k > 0 ? `${pr.first} first, ${pr.second} ${n} ${u}${s} later` : `${pr.second} first, ${pr.first} ${n} ${u}${s} later` + (pr.mode === 'stock' && k === -1 ? ' (overlaps by about 3 to 4 hours)' : '');
}
function relVerdictText(res) {
  const main = res.pairs.filter(p => ['altsBtc', 'altsNasdaq', 'altsSp500'].includes(p.id)), out = [];
  for (const pr of main) {
    if (pr.skipped) { out.push(`${pr.label}: not tested (${pr.skipped}).`); continue; }
    const c0 = pr.cells.find(c => c.lag === 0), c1 = pr.cells.find(c => c.lag === 1), u = pr.mode === 'calendar' ? 'day' : 'window', rr = c => c && c.r != null ? ` (r ${relSg(c.r)})` : '';
    out.push(`${pr.label}, same ${u}: ${relReading(c0)}${rr(c0)}; ${pr.first} first, ${pr.second} the next ${u}: ${relReading(c1)}${rr(c1)}.`);
  }
  const cs = res.candleStart, odd = cs && (cs.utc !== '00:00' || cs.share < 0.99);
  return (out.length ? out.join(' ') + ' ' : 'Nothing could be tested. ') + (odd ? "Warning: Luno's daily candles do not start at midnight UTC, so the Nasdaq and S&P 500 sentences above may be mismatched in time (see the note under the table). " : '') + 'This describes the past on the coins listed today; it is not a forecast, and a link is not proof of cause.';
}
function relHeadlineTable(res) {
  const rows = [];
  res.pairs.filter(p => !p.skipped).forEach(pr => pr.cells.filter(c => c.headline).forEach(c => {
    const E = c.earlier, L = c.later;
    rows.push(c.tooFew ? `<tr><td>${relEsc(pr.label)}</td><td>${relEsc(relTiming(pr, c.lag))}</td><td>${c.n}</td><td colspan="4">too few windows to judge</td></tr>`
      : `<tr><td>${relEsc(pr.label)}</td><td>${relEsc(relTiming(pr, c.lag))}</td><td>${c.n}</td><td>${relSg(c.r)} <small>(${relSg(c.loS)} to ${relSg(c.hiS)})</small></td><td>${relSg(E && E.r)}</td><td>${relSg(L && L.r)}</td><td>${relEsc(relReading(c))}</td></tr>`);
  }));
  return rows.length ? `<table class="cr-config-table"><thead><tr><th>Comparison</th><th>Timing</th><th>Windows</th><th>r <small>(strict range)</small></th><th>Earlier 60% r</th><th>Later 40% r</th><th>Reading</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '';
}
function relDetailTable(pr) {
  const rows = pr.cells.map(c => {
    const t = `<td>${c.lag > 0 ? '+' : ''}${c.lag}</td><td>${relEsc(relTiming(pr, c.lag))}</td><td>${c.n}</td>`;
    if (c.tooFew) return `<tr>${t}<td colspan="5">too few windows</td></tr>`;
    return `<tr>${t}<td>${relSg(c.r)} <small>(${relSg(c.lo95)} to ${relSg(c.hi95)})</small></td><td>${relSg(c.earlier && c.earlier.r)}</td><td>${relSg(c.later && c.later.r)}</td><td>${relSg(c.rho)}</td><td>${c.headline ? relEsc(relReading(c)) : '<small>shown, not judged</small>'}</td></tr>`;
  });
  return `<details class="cr-collapsible"><summary class="cr-collapsible-summary"><h3>${relEsc(pr.label)}: every lag <small>(${pr.n0} same-window pairs, ${pr.from} to ${pr.to}; earlier 60% ends ${pr.split})</small></h3></summary><div class="cr-collapsible-body"><table class="cr-config-table"><thead><tr><th>Lag</th><th>Who moves first</th><th>Windows</th><th>r <small>(95% range)</small></th><th>Earlier 60%</th><th>Later 40%</th><th>Rank r</th><th>Reading</th></tr></thead><tbody>${rows.join('')}</tbody></table></div></details>`;
}
function relRollingTable(res) {
  const rows = [];
  res.pairs.filter(p => !p.skipped && p.rolling).forEach(pr => [0, 1].forEach(k => {
    const s = pr.rolling[k], pc = v => (v * 100).toFixed(0) + '%';
    rows.push(s ? `<tr><td>${relEsc(pr.label)}</td><td>${relEsc(relTiming(pr, k))}</td><td>${pc(s.pos)}</td><td>${pc(s.mid)}</td><td>${pc(s.neg)}</td><td>${relSg(s.latest)}</td><td>${relSg(s.min)} to ${relSg(s.max)}</td></tr>` : `<tr><td>${relEsc(pr.label)}</td><td>${relEsc(relTiming(pr, k))}</td><td colspan="5">too few windows</td></tr>`);
  }));
  return rows.length ? `<h3>Does it hold over time? <small>(correlation re-measured over every stretch of ${REL.ROLL} windows)</small></h3><table class="cr-config-table"><thead><tr><th>Comparison</th><th>Timing</th><th>Stretches above +${REL.ROLL_BAND}</th><th>Between</th><th>Below -${REL.ROLL_BAND}</th><th>Latest</th><th>Lowest to highest</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '';
}
function relHtml(res) {
  const cov = [];
  if (res.basket) cov.push(`Alt basket: ${res.alts.length} coins, on average ${res.basket.avgCoinsPerDay} per day, ${res.basket.from} to ${res.basket.to} (${res.basket.days} days)`);
  Object.entries(res.files).forEach(([k, f]) => cov.push(`${relEsc(f.name)}: ${f.rows} days, ${f.from} to ${f.to}`));
  if (res.leftOut.length) cov.push(`left out of the basket: ${relEsc(res.leftOut.join(', '))}`);
  const skipped = res.pairs.filter(p => p.skipped).map(p => `${relEsc(p.label)} (${relEsc(p.skipped)})`);
  return `<p class="cr-source-note">${cov.join(' &middot; ')}${skipped.length ? '. Not tested: ' + skipped.join(', ') : ''}.</p>`
    + relHeadlineTable(res) + res.pairs.filter(p => !p.skipped).map(relDetailTable).join('') + relRollingTable(res)
    + (res.notes.length ? `<p class="cr-source-note">${res.notes.map(relEsc).join(' &middot; ')}</p>` : '');
}
function relJson(res, o) {
  const cellJ = c => c.tooFew ? { lag: c.lag, n: c.n, tooFew: true } : { lag: c.lag, headline: c.headline || undefined, n: c.n, r: c.r, rank: c.rho, range95: [c.lo95, c.hi95], strict: c.headline ? [c.loS, c.hiS] : undefined,
    earlier: c.earlier ? { n: c.earlier.n, r: c.earlier.r, strict: c.earlier.lo != null ? [c.earlier.lo, c.earlier.hi] : undefined } : undefined, later: c.later ? { n: c.later.n, r: c.later.r, strict: c.later.lo != null ? [c.later.lo, c.later.hi] : undefined } : undefined, reading: c.headline ? relReading(c) : undefined };
  return { suite: 'v2.8', relations: 'v1.0', params: o, altsUsed: res.alts.length, leftOut: res.leftOut, basket: res.basket, files: res.files, candleStart: res.candleStart,
    pairs: res.pairs.map(pr => ({ id: pr.id, label: pr.label, skipped: pr.skipped, windows: pr.n0, from: pr.from, to: pr.to, split: pr.split, cells: pr.cells.map(cellJ), rolling: pr.rolling })), notes: res.notes };
}

// ---------- running it ----------
const relCache = new Map();   // pair -> { at, candles }
async function relCandles(pair, notes) {
  const hit = relCache.get(pair); if (hit && Date.now() - hit.at < REL.CACHE_MS) return hit.candles;
  const candles = await btHistory(pair, 86400, notes); relCache.set(pair, { at: Date.now(), candles });
  await btSleep(120);   // stay well under Luno's 300 calls per minute
  return candles;
}
async function runRelations() {
  const st = t => { relEl('rel-status').textContent = t; };
  if (!state.workerUrl) return st('Needs a live Worker: set WORKER_URL in crypto-radar.js.');
  const btn = relEl('rel-run'); btn.disabled = true; relEl('rel-out').innerHTML = ''; relEl('rel-verdict').textContent = '';
  try {
    const notes = [], files = {};
    for (const [key, id, label, hint] of REL.FILES) {   // files first, so a bad file is reported before the long download
      const fl = relEl(id).files && relEl(id).files[0]; if (!fl) continue;
      try {
        const f = await relParseCsv(await fl.text()); files[key] = { ...f, name: fl.name };
        const other = REL.FILES.find(x => x[0] !== key), tag = fl.name + ' ' + f.header;
        if (other[3].test(tag) && !hint.test(tag)) notes.push(`${fl.name} looks like a ${other[2]} file but is in the ${label} box: check you picked the right one`);
      } catch (e) { notes.push(`${fl.name}: ${e.message}, so the ${label} rows were skipped`); }
    }
    st('Loading the pair list...');
    const markets = ((await apiFetch('/api/markets')).markets || []).sort((a, b) => myrVolume(b) - myrVolume(a)), want = relEl('rel-pairs').value;
    const pairs = markets.slice(0, want === 'all' ? markets.length : +want).map(m => m.pair);
    if (!pairs.includes('XBTMYR') && markets.some(m => m.pair === 'XBTMYR')) pairs.push('XBTMYR');
    const hist = {};
    for (let p = 0; p < pairs.length; p++) {
      st(`Coin ${p + 1} of ${pairs.length}: ${pairs[p]} - fetching daily history...`);
      try { hist[pairs[p]] = await relCandles(pairs[p], notes); } catch (e) { notes.push(`${pairs[p]}: no data (${e.message})`); }
    }
    st('Working out the relationships...'); await btSleep(20);
    const res = relAnalyse(hist, files); res.notes.unshift(...notes);
    const o = { coins: want, lags: [REL.LAGS[0], REL.LAGS[REL.LAGS.length - 1]], judgedRows: REL.FAMILY, strictZ: REL.Z_BAR, blockBootstrap: { block: REL.BLOCK, resamples: REL.RESAMPLES }, rollingWindow: REL.ROLL, rollingBand: REL.ROLL_BAND };
    relEl('rel-verdict').textContent = relVerdictText(res);
    relEl('rel-out').innerHTML = relHtml(res);
    relEl('rel-json').value = JSON.stringify(relJson(res, o), (k, v) => typeof v === 'number' ? +v.toFixed(4) : v, 1);
    st(`Done: ${res.pairs.filter(p => !p.skipped).length} of ${res.pairs.length} comparisons at ${new Date().toLocaleTimeString('en-MY')}.`);
  } catch (e) { st('Study failed: ' + e.message); }
  finally { btn.disabled = false; }
}

let relInitialized = false;
function relInit() {
  const b = relEl('rel-run'); if (relInitialized || !b) return; relInitialized = true;
  state.workerUrl = CONFIG.WORKER_URL;
  b.addEventListener('click', runRelations);
  relEl('rel-json').addEventListener('focus', e => e.target.select());
}
document.addEventListener('DOMContentLoaded', relInit);
