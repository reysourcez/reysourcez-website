/* Crypto Radar tests v2.8 (verification tooling, not part of the site). Run: node crypto-radar-tests.js   (Node 22; no packages needed)
   Folder layout it expects (or set NEWDIR / OLDDIR): this file next to crypto-radar.js (v2.0), crypto-radar-backtest.html/.js, crypto-radar-bigmovers.js, crypto-radar-relations.js, crypto-radar-worker.js (the NEW release),
   and a subfolder v27/ holding the PREVIOUS release (suite v2.7): crypto-radar.js, crypto-radar-backtest.html/.js, crypto-radar-bigmovers.js and crypto-radar-worker.js.
   It loads the real shipped files into a vm sandbox, builds the page's DOM stub from the page's own element ids, stubs the Worker's /api/markets, /api/candles and /api/macro with seeded synthetic data,
   and checks: A files/versions, B regression against the previous release (unchanged files must give identical output), C gold fallback (14 cases), D gold regime, E big-mover direction verdict, F scale (51 coins),
   G relationship study (planted links read the right way round, calibration with no link, independent re-implementation, the file reader, honest notes, scale).
   Run one part only with ONLY=G (comma list, for example ONLY=A,G). Mutation checks for G: see the handoff, section 22. Not covered: a real browser (see crypto-radar-browser-smoke.js), the live network. */
'use strict';
const vm = require('vm'), fs = require('fs'), crypto = require('crypto');
const HERE = __dirname + '/', OLD = process.env.OLDDIR || HERE + 'v27/', NEW = process.env.NEWDIR || HERE;   // NEW = folder with the shipped files + crypto-radar.js v2.0; OLD = folder with the previous release (for the regression checks)
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean), want = s => !ONLY.length || ONLY.includes(s);
const DAY = 86400000, lastStart = step => Math.floor(Date.now() / step) * step - step;
let pass = 0, fail = 0; const failures = [];
const check = (name, cond, detail) => { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; failures.push(name); console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + detail : '')); } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const md5 = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');

// ---------- synthetic data ----------
function rng(seed) { let s = (Math.imul(seed + 7, 2654435761) >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function genSeries(seed, n, step, o = {}) {   // random walk; o.edge = planted 3-candle surge after a fresh 20-candle breakout; o.drift(ts) = extra daily drift
  const r = rng(seed), out = [], cl = [], end = lastStart(step); let price = o.start || 100, surge = 0, cool = 0;
  for (let i = 0; i < n; i++) {
    const ts = end - (n - 1 - i) * step;
    let ret = (r() - 0.5) * 2 * (o.vol || 0.03);
    if (o.drift) ret += o.drift(ts);
    if (o.edge) {
      if (surge === 0 && cool === 0 && i >= 22 && cl[i - 1] > Math.max(...cl.slice(i - 21, i - 1)) && r() < 0.6) { surge = 3; cool = 25; }
      if (surge > 0) { ret += o.edge; surge--; } else if (cool > 0) cool--;
    }
    const open = price, close = Math.max(0.01, open * (1 + ret)), high = Math.max(open, close) * (1 + r() * 0.01), low = Math.min(open, close) * (1 - r() * 0.01);
    out.push({ timestamp: ts, open, high, low, close, volume: 100 + r() * 100 }); cl.push(close); price = close;
  }
  return out;
}
function goldSeries(n, step = DAY) {   // slow cycle + noise so the 50-day regime flips a few times
  const r = rng(99), out = [], end = lastStart(step); let prev = 2000;
  for (let i = 0; i < n; i++) {
    const close = 2000 * (1 + 0.25 * Math.sin(2 * Math.PI * i / 180)) + (r() - 0.5) * 30, open = prev;
    out.push({ timestamp: end - (n - 1 - i) * step, open, high: Math.max(open, close) * 1.003, low: Math.min(open, close) * 0.997, close, volume: 50 }); prev = close;
  }
  return out;
}
function indepRegime(series) {   // independent re-implementation of "close above its own 50-day average, lagged one day" for gap-free daily data
  const m = new Map();
  for (let i = 49; i < series.length; i++) {
    let s = 0; for (let k = i - 49; k <= i; k++) s += series[k].close;
    m.set(Math.floor(series[i].timestamp / DAY) * DAY + DAY, series[i].close > s / 50);
  }
  return m;
}

// ---------- stub network (the Worker) ----------
function makeNet(cfg) {
  const calls = [];
  const dxyBars = (() => { const r = rng(5), b = []; let v = 100; for (let d = Date.UTC(2014, 11, 31); d <= lastStart(DAY); d += DAY) { v *= 1 + (r() - 0.5) * 0.006; b.push([d, +v.toFixed(4)]); } return b; })();
  const handler = url => {
    const u = new URL(url), p = u.pathname, q = Object.fromEntries(u.searchParams); calls.push(p + '?' + u.searchParams.toString());
    if (p === '/api/markets') return { status: 200, body: { markets: cfg.coins.map(c => { const s = cfg.series(c.pair, 86400), last = s ? s[s.length - 1].close : 1; return { pair: c.pair, bid: String(last * (1 - c.spread / 200)), ask: String(last * (1 + c.spread / 200)), last_trade: String(last), rolling_24_hour_volume: String(c.vol), status: 'ACTIVE' }; }) } };
    if (p === '/api/candles') {
      const s = cfg.series(q.pair, +q.duration); if (!s) return { status: 404, body: { error: 'Unknown pair' } };
      return { status: 200, body: { candles: s.filter(x => x.timestamp >= +q.since).slice(0, 1000).map(x => ({ timestamp: x.timestamp, open: String(x.open), high: String(x.high), low: String(x.low), close: String(x.close), volume: String(x.volume) })) } };
    }
    if (p === '/api/macro') {
      if (q.series === 'dxy') return { status: 200, body: { series: 'dxy', source: 'stub dollar index', from: dxyBars[0][0], to: dxyBars[dxyBars.length - 1][0], days: dxyBars.length, bars: dxyBars } };
      if (q.series === 'gold') {
        if (cfg.gold === 'ok') { const g = goldSeries(700); return { status: 200, body: { series: 'gold', source: 'stub gold feed', days: g.length, bars: g.map(x => [Math.floor(x.timestamp / DAY) * DAY, x.close]) } }; }
        return { status: 502, body: { error: 'gold: Binance returned 403' } };
      }
    }
    return { status: 404, body: { error: 'Unknown endpoint' } };
  };
  return { handler, calls };
}

// ---------- stub page (DOM built from the page's own ids, so a missing id fails the run) ----------
function makeEnv(dir, cfg) {
  const html = fs.readFileSync(dir + 'crypto-radar-backtest.html', 'utf8'), els = new Map(), docL = {};
  const stub = (id, tag, attrs) => ({ id, tag, value: attrs.value, checked: attrs.checked, files: null, textContent: '', innerHTML: '', disabled: false, hidden: false, style: {}, dataset: {}, listeners: {}, classList: { add() { }, remove() { }, toggle() { }, contains() { return false; } }, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, querySelectorAll() { return []; }, querySelector() { return null; }, select() { }, scrollIntoView() { }, focus() { } });
  for (const m of html.matchAll(/<([a-zA-Z0-9]+)\b[^>]*?\sid="([^"]+)"[^>]*>/g)) {
    const tag = m[1].toLowerCase(), id = m[2], full = m[0], val = (full.match(/\svalue="([^"]*)"/) || [])[1], type = (full.match(/\stype="([^"]*)"/) || [])[1];
    let value = val !== undefined ? val : '';
    if (tag === 'select') { const blk = html.match(new RegExp('<select[^>]*\\sid="' + id + '"[^>]*>([\\s\\S]*?)</select>')); const opts = [...(blk ? blk[1] : '').matchAll(/<option\b([^>]*)>/g)].map(o => ({ v: (o[1].match(/value="([^"]*)"/) || [])[1], sel: /\bselected\b/.test(o[1]) })); value = (opts.find(o => o.sel) || opts[0] || {}).v || ''; }
    els.set(id, stub(id, tag, { value, checked: type === 'checkbox' ? /\schecked\b/.test(full) : false }));
  }
  const net = makeNet(cfg);
  const sandbox = {
    document: { getElementById: id => els.get(id) || null, addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); }, title: '', querySelectorAll: () => [] },
    window: { addEventListener() { }, scrollTo() { }, scrollY: 0, innerHeight: 800 }, console: { log() { }, warn() { }, error() { } },
    setTimeout: (f, ms, ...a) => setTimeout(f, 0, ...a), clearTimeout, setInterval: () => 0, clearInterval() { },
    fetch: async url => { const r = net.handler(url); return { ok: r.status < 400, status: r.status, json: async () => r.body }; },
  };
  const ctx = vm.createContext(sandbox);
  for (const f of [NEW + 'crypto-radar.js', dir + 'crypto-radar-backtest.js', dir + 'crypto-radar-bigmovers.js', dir + 'crypto-radar-relations.js'].filter(f => fs.existsSync(f))) new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
  vm.runInContext('btInit(); bgInit(); if (typeof relInit === "function") relInit();', ctx);
  return { ctx, el: id => els.get(id), net, els, ids: new Set(els.keys()) };
}
async function runBT(env, setup) {
  if (setup) setup(env.el);
  await vm.runInContext('runBacktest()', env.ctx);
  const j = env.el('bt-json').value;
  return { json: j ? JSON.parse(j) : null, status: env.el('bt-status').textContent, verdict: env.el('bt-verdict').textContent, out: env.el('bt-out').innerHTML };
}
async function runBG(env) {
  await vm.runInContext('runBigMovers()', env.ctx);
  const j = env.el('bg-json').value;
  return { json: j ? JSON.parse(j) : null, status: env.el('bg-status').textContent, verdict: env.el('bg-verdict').textContent, out: env.el('bg-out').innerHTML };
}

// ---------- standard data set ----------
const ALTS = ['ETHMYR', 'XRPMYR', 'SOLMYR', 'ADAMYR', 'LINKMYR', 'DOTMYR', 'LTCMYR', 'AVAXMYR'];
function stdCfg(o = {}) {
  const n = o.n || 900, gold = goldSeries(o.goldN || n), reg = indepRegime(gold), coins = [{ pair: 'XBTMYR', vol: 50, spread: 0.1, seed: 1 }, ...ALTS.map((p, i) => ({ pair: p, vol: 900 - i * 80, spread: 0.2 + i * 0.1, seed: 10 + i }))];
  if (o.paxgInList !== false) coins.push({ pair: 'PAXGMYR', vol: 5, spread: 0.6, seed: 99 });
  const cache = new Map();
  const series = (pair, dur) => {   // dur = candle length in SECONDS, exactly as the Worker's /api/candles takes it
    const step = dur * 1000, key = pair + ':' + dur; if (cache.has(key)) return cache.get(key);
    let s = null;
    if (pair === 'PAXGMYR') { if (o.paxgAvailable !== false) s = goldSeries(o.paxgN || n, step); }
    else { const c = coins.find(x => x.pair === pair); if (c) s = genSeries(c.seed, step === DAY ? n : 1200, step, { edge: o.edge === undefined ? 0.03 : o.edge, drift: o.plant ? ts => { const g = reg.get(Math.floor(ts / DAY) * DAY); return g === true ? 0.012 : g === false ? -0.002 : 0; } : null }); }
    cache.set(key, s); return s;
  };
  return { coins, series, gold: o.gold || 'fail403', reg, goldCandles: gold };
}
const setScore = (v) => el => { el('bt-score').checked = v; };
const strip = j => { const c = JSON.parse(JSON.stringify(j)); delete c.suite; delete c.backtest; delete c.bigMovers; return c; };
const goldRule = 'Gold rising (above its 50-day average)';


// ---------- relationship-study test helpers (v2.8) ----------
const gauss = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
function candlesFromRet(rets, start) {   // rets[k] = log return of day k (k = 0 oldest); daily candles that end yesterday (UTC). Only closes matter to the study
  const n = rets.length, end = lastStart(DAY), out = []; let price = start || 100;
  for (let k = 0; k < n; k++) { const open = price, close = price * Math.exp(rets[k]); out.push({ timestamp: end - (n - 1 - k) * DAY, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 100 }); price = close; }
  return out;
}
function relScenario(o = {}) {   // synthetic world: Bitcoin b, a common alt factor F, 12 alts = F + noise, and two stock indexes with weekday rows, ~3% holidays and an optional 15-day hole. Planted links are put on exact days
  const n = o.n || 1500, r = rng(o.seed || 1), end = lastStart(DAY), t0 = end - (n - 1) * DAY, tsOf = k => t0 + k * DAY, nAlts = o.alts === undefined ? 12 : o.alts, sB = 0.03, sE = 0.02, sEta = 0.03, sS = 0.01;
  const hole = o.hole ? [Math.floor(n * 0.5), Math.floor(n * 0.5) + 15] : null, rowK = [];
  for (let k = 0; k < n; k++) { const wd = new Date(tsOf(k)).getUTCDay(); if (wd === 0 || wd === 6 || r() < 0.03 || (hole && k >= hole[0] && k < hole[1])) continue; rowK.push(k); }
  const s = rowK.map((k, i) => i === 0 ? 0 : sS * gauss(r)), b = Array.from({ length: n }, () => sB * gauss(r)), F = Array.from({ length: n }, () => sEta * gauss(r));
  for (let i = 1; i < rowK.length; i++) b[rowK[i]] += (o.btcSt || 0) * s[i];   // Bitcoin follows the stock index on the same date
  const on = k => !o.onlyAfter || k >= o.onlyAfter * n;
  for (let k = 1; k < n; k++) if (on(k)) F[k] += (o.btcLead || 0) * b[k - 1] + (o.btcSim || 0) * b[k];
  for (let i = 1; i < rowK.length; i++) {
    const k = rowK[i]; F[k] += (o.stSim || 0) * s[i];
    if (k + 1 < n) F[k + 1] += (o.stLead || 0) * s[i];   // the day AFTER the stock date: inside the next window
    if (i >= 2) F[rowK[i - 2]] += (o.stBack || 0) * s[i];   // two windows BEFORE the stock move: the alts moved first
  }
  const candles = { XBTMYR: candlesFromRet(b, 500) };
  for (let c = 0; c < nAlts; c++) candles['ALT' + c + 'MYR'] = candlesFromRet(F.map(f => f + sE * gauss(r)), 10 + c);
  if (o.extras) {
    candles.USDCMYR = candlesFromRet(b.map(() => 0.0005 * gauss(r)), 4.5); candles.PAXGMYR = candlesFromRet(b.map(() => 0.01 * gauss(r)), 8000);
    candles.XAUTMYR = candlesFromRet(b.map(() => 0.01 * gauss(r)), 8100); candles.NEWMYR = candlesFromRet(Array.from({ length: 30 }, () => 0.05 * gauss(r)), 1);
  }
  if (o.gaps) Object.keys(candles).forEach(p => { if (p !== 'NEWMYR') candles[p] = candles[p].filter((x, i, a) => i === a.length - 1 || r() >= o.gaps); });   // no trades, no candle
  if (o.shiftH) Object.keys(candles).forEach(p => { candles[p] = candles[p].map(x => ({ ...x, timestamp: x.timestamp + o.shiftH * 3600000 })); });   // candles that start at another hour than 00:00 UTC
  const stock = {}, texts = {}, rowSet = new Set(rowK), ids = { nasdaq: 'NASDAQCOM', sp500: 'SP500' }, lvl = { nasdaq: 5000, sp500: 1500 };
  for (const key of ['nasdaq', 'sp500']) {
    let v = lvl[key]; stock[key] = rowK.map((k, i) => { if (i > 0) v *= Math.exp(s[i]); return { d: tsOf(k), v }; });
    const lines = ['observation_date,' + ids[key]], byK = new Map(rowK.map((k, i) => [k, stock[key][i].v]));
    for (let k = 0; k < n; k++) { const wd = new Date(tsOf(k)).getUTCDay(); if (wd === 0 || wd === 6) continue; lines.push(new Date(tsOf(k)).toISOString().slice(0, 10) + ',' + (rowSet.has(k) ? byK.get(k).toFixed(4) : '.')); }   // FRED style: closed weekdays are "."
    texts[key] = lines.join('\n') + '\n';
  }
  const cfg = { coins: Object.keys(candles).map((pair, i) => ({ pair, vol: 1000 - i, spread: 0.2 })), series: (pair, dur) => dur === 86400 ? (candles[pair] || null) : null, gold: 'fail403' };
  return { cfg, candles, stock, texts, rowK, tsOf, n };
}
async function runREL(sc, o = {}) {
  const env = o.env || makeEnv(NEW, sc.cfg), el = env.el;
  if (!o.noFiles) { el('rel-nasdaq').files = [{ name: 'NASDAQCOM.csv', text: async () => sc.texts.nasdaq }]; el('rel-sp500').files = [{ name: 'SP500.csv', text: async () => sc.texts.sp500 }]; }
  if (o.setup) o.setup(el);
  await vm.runInContext('runRelations()', env.ctx);
  const j = el('rel-json').value;
  return { env, json: j ? JSON.parse(j) : null, raw: j, status: el('rel-status').textContent, verdict: el('rel-verdict').textContent, out: el('rel-out').innerHTML };
}
const cellOf = (json, id, lag) => { const p = json.pairs.find(x => x.id === id); return p && p.cells && p.cells.find(c => c.lag === lag); };
const readingOf = (json, id, lag) => { const c = cellOf(json, id, lag); return c ? (c.reading || (c.tooFew ? 'too few' : 'not judged')) : 'missing'; };
const HEAD = [['altsBtc', -1], ['altsBtc', 0], ['altsBtc', 1], ...['altsNasdaq', 'altsSp500', 'btcNasdaq', 'btcSp500'].flatMap(id => [[id, 0], [id, 1]])];
const linked = json => HEAD.filter(([id, k]) => { const c = cellOf(json, id, k); return c && c.reading && !/^no clear link$/.test(c.reading); });
// independent re-implementations (different structure from the shipped code: rows are cut into unbroken chains, pairs are formed inside a chain)
function refPearson(x, y) { const n = x.length; let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; } mx /= n; my /= n; let c = 0, vx = 0, vy = 0; for (let i = 0; i < n; i++) { c += (x[i] - mx) * (y[i] - my); vx += (x[i] - mx) ** 2; vy += (y[i] - my) ** 2; } return c / Math.sqrt(vx * vy); }
function refMaps(sc) { const m = {}; Object.keys(sc.candles).forEach(p => { m[p] = new Map(sc.candles[p].map(c => [Math.floor(c.timestamp / DAY) * DAY, c.close])); }); return m; }
function refBasket(m, alts, d0, d1) { const v = []; for (const p of alts) { const a = m[p].get(d0), c = m[p].get(d1); if (a > 0 && c > 0) v.push(Math.log(c / a)); } return v.length >= 10 ? v.reduce((u, w) => u + w, 0) / v.length : null; }
function refStock(sc, key, which, lag) {
  const rows = sc.stock[key], m = refMaps(sc), alts = Object.keys(sc.candles).filter(p => /^ALT\d+MYR$/.test(p)), chains = []; let cur = [rows[0]];
  for (let i = 1; i < rows.length; i++) { if ((rows[i].d - rows[i - 1].d) / DAY > 7) { chains.push(cur); cur = []; } cur.push(rows[i]); }
  chains.push(cur);
  const xs = [], ys = [], dates = [];
  for (const ch of chains) {
    const win = ch.map((row, j) => {
      if (j === 0) return null;
      const x = Math.log(row.v / ch[j - 1].v); let y = null;
      if (which === 'btc') { const a = m.XBTMYR.get(ch[j - 1].d), c = m.XBTMYR.get(row.d); if (a > 0 && c > 0) y = Math.log(c / a); } else y = refBasket(m, alts, ch[j - 1].d, row.d);
      return { x, y };
    });
    for (let j = 0; j < ch.length; j++) { const q = j + lag; if (q < 0 || q >= ch.length || !win[j] || !win[q] || win[q].y === null) continue; xs.push(win[j].x); ys.push(win[q].y); dates.push(ch[j].d); }
  }
  return { n: xs.length, r: xs.length >= 3 ? refPearson(xs, ys) : null, dates };
}
function refCal(sc, lag) {
  const m = refMaps(sc), alts = Object.keys(sc.candles).filter(p => /^ALT\d+MYR$/.test(p)), days = sc.candles.XBTMYR.map(c => Math.floor(c.timestamp / DAY) * DAY), t0 = Math.min(...Object.values(sc.candles).map(c => c[0].timestamp)), t1 = days[days.length - 1];
  const X = new Map(), Y = new Map();
  for (let d = Math.floor(t0 / DAY) * DAY + DAY; d <= t1; d += DAY) { const a = m.XBTMYR.get(d - DAY), c = m.XBTMYR.get(d); if (a > 0 && c > 0) X.set(d, Math.log(c / a)); const y = refBasket(m, alts, d - DAY, d); if (y !== null) Y.set(d, y); }
  const xs = [], ys = [], dates = [];
  for (const [d, x] of [...X.entries()].sort((a, b) => a[0] - b[0])) { const y = Y.get(d + lag * DAY); if (y !== undefined) { xs.push(x); ys.push(y); dates.push(d); } }
  return { n: xs.length, r: xs.length >= 3 ? refPearson(xs, ys) : null, dates };
}
const normTail = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z >= 0 ? p : 1 - p; };   // P(Z > z), Abramowitz-Stegun 26.2.17 (error < 8e-8)

(async () => {
  if (want('A')) {
  console.log('== A. files and versions (suite v2.8)');
  check('Worker, core page script, backtest script and big-mover script are byte-identical to v2.7 (only the new script and the page change)', ['crypto-radar-worker.js', 'crypto-radar.js', 'crypto-radar-backtest.js', 'crypto-radar-bigmovers.js'].every(f => md5(NEW + f) === md5(OLD + f)));
  const bt = fs.readFileSync(NEW + 'crypto-radar-backtest.js', 'utf8'), bg = fs.readFileSync(NEW + 'crypto-radar-bigmovers.js', 'utf8'), rl = fs.readFileSync(NEW + 'crypto-radar-relations.js', 'utf8'), html = fs.readFileSync(NEW + 'crypto-radar-backtest.html', 'utf8'), htmlOld = fs.readFileSync(OLD + 'crypto-radar-backtest.html', 'utf8');
  check('backtest and big-mover headers still say suite v2.7 (files unchanged) and their JSON says the same', /Backtest v1\.6 \(suite v2\.7\)/.test(bt) && /suite: 'v2\.7', backtest: 'v1\.6'/.test(bt) && /Big-Mover Study v1\.2 \(suite v2\.7\)/.test(bg) && /suite: 'v2\.7', bigMovers: 'v1\.2'/.test(bg));
  check('relationship script header and JSON say v1.0 (suite v2.8)', /Relationship Study v1\.0 \(suite v2\.8\)/.test(rl) && /suite: 'v2\.8', relations: 'v1\.0'/.test(rl));
  check('page title, eyebrow and top comment carry v1.6 / v1.2 / v1.0 and suite v2.8', /<title>[^<]*Backtest v1\.6 \+ Big Movers v1\.2 \+ Relationships v1\.0<\/title>/.test(html) && /Relationships v1\.0 \(suite v2\.8\)/.test(html) && /<!-- Crypto Radar Backtest page v1\.6 \+ Big Movers v1\.2 \+ Relationship study v1\.0 \(suite v2\.8\)/.test(html));
  check('no stale suite v2.7 / v2.6 / v2.5 or v1.5 / v1.1 text left on the page', !/suite v2\.[567]\b|v1\.5\b|v1\.1\b/.test(html));
  check('cache-busters: relations ?v=1 (new), backtest ?v=7, big movers ?v=3, core ?v=10 (unchanged)', /crypto-radar-relations\.js\?v=1"/.test(html) && /crypto-radar-backtest\.js\?v=7"/.test(html) && /crypto-radar-bigmovers\.js\?v=3"/.test(html) && /crypto-radar\.js\?v=10"/.test(html));
  check('the relations script is loaded AFTER the backtest script it depends on', html.indexOf('crypto-radar-relations.js') > html.indexOf('crypto-radar-backtest.js'));
  check('old "so that macro series was ignored" wording gone', !/macro series was ignored/.test(bt));
  check('stray backslash in the disclaimer box fixed', !/cr-disclaimer\\"/.test(html) && /class="cr-disclaimer" role="note"/.test(html));
  const REL_RE = /<!-- REL v1\.0 START -->[^]*?<!-- REL v1\.0 END -->\n/, block = (html.match(REL_RE) || [''])[0], htmlRest = html.replace(REL_RE, '');
  check('the new section sits between its START / END markers and nowhere else', block.length > 1500 && /id="rel-run"/.test(block) && !/id="rel-run"/.test(htmlRest));
  const cnt = (s, re) => (s.match(re) || []).length, tags = ['details', 'summary', 'section', 'div', 'table', 'select', 'main', 'header', 'nav', 'ul', 'li', 'p', 'h2', 'h3', 'textarea', 'input', 'button', 'label'];
  check('HTML outside the new section has exactly the v2.7 tag counts (nothing else added or lost)', tags.every(t => cnt(htmlRest, new RegExp('<' + t + '\\b', 'g')) === cnt(htmlOld, new RegExp('<' + t + '\\b', 'g')) && cnt(htmlRest, new RegExp('</' + t + '>', 'g')) === cnt(htmlOld, new RegExp('</' + t + '>', 'g'))));
  check('the new section is balanced on its own (every opened tag closed)', ['details', 'summary', 'section', 'div', 'select', 'p', 'h2', 'h3', 'textarea', 'button', 'label'].every(t => cnt(block, new RegExp('<' + t + '\\b', 'g')) === cnt(block, new RegExp('</' + t + '>', 'g'))));
  const idsHtml = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])), idsJs = new Set([...(bt + bg).matchAll(/(?:btEl|g|getElementById)\('([a-z0-9-]+)'\)/g)].map(m => m[1]).concat([...rl.matchAll(/relEl\('([a-z0-9-]+)'\)/g)].map(m => m[1]), [...rl.matchAll(/'(rel-[a-z0-9-]+)'/g)].map(m => m[1])));
  check('every element id the scripts use exists in the page (including the new rel- ids)', [...idsJs].every(i => idsHtml.has(i)) && idsJs.has('rel-run') && idsJs.has('rel-nasdaq') && idsJs.has('rel-sp500'), [...idsJs].filter(i => !idsHtml.has(i)).join(','));
  check('no duplicate ids in the page', (html.match(/\sid="[^"]+"/g) || []).length === idsHtml.size);
  const decl = s => new Set([...s.matchAll(/^(?:async\s+)?(?:function\s+|const\s+|let\s+)([A-Za-z_$][\w$]*)/gm)].map(m => m[1])), dRel = decl(rl), dOthers = decl(fs.readFileSync(NEW + 'crypto-radar.js', 'utf8') + '\n' + bt + '\n' + bg);
  check('the new script declares no name that the other scripts already use (no clash)', dRel.size > 20 && [...dRel].every(n => !dOthers.has(n)), [...dRel].filter(n => dOthers.has(n)).join(','));
  }

  if (want('B')) {
  console.log('== B. regression: the v2.7 page and the v2.8 page give identical backtest and big-mover output on identical data');
  {
    const cfg = stdCfg(), o = makeEnv(OLD, cfg), n = makeEnv(NEW, cfg);
    const a = await runBT(o, setScore(false)), b = await runBT(n, setScore(false));
    check('B1 default run (gold from Luno after the Worker feed fails): both finish, score rows, identical JSON, verdict and page text', a.json && b.json && a.json.signalsScored > 3000 && same(a.json, b.json) && a.verdict === b.verdict && a.out === b.out && a.out.length > 3000, a.json && b.json && a.json.signalsScored + '/' + b.json.signalsScored);
    const x = await runBG(makeEnv(OLD, cfg)), y = await runBG(makeEnv(NEW, cfg));
    check('B2 big-mover study: identical numbers, verdict and tables', x.json && same(x.json, y.json) && x.out === y.out && x.verdict === y.verdict, x.json && x.json.daysScored);
  }
  {
    const cfg = stdCfg(), o = makeEnv(OLD, cfg), n = makeEnv(NEW, cfg), off = el => { el('bt-score').checked = false; el('bt-m-auto').checked = false; };
    const a = await runBT(o, off), b = await runBT(n, off);
    check('B3 automatic feeds switched off: identical, no notes, no /api/macro call, PAXGMYR fetched only as a coin (4 pages)', same(a.json, b.json) && a.json.notes.length === 0 && !n.net.calls.some(c => c.startsWith('/api/macro')) && n.net.calls.filter(c => c.includes('pair=PAXGMYR')).length === 4, n.net.calls.filter(c => c.includes('pair=PAXGMYR')).length + ' PAXGMYR calls');
  }
  {   // regression with the radar score switched ON, small data set
    const cfg = stdCfg({ n: 330 }), o = makeEnv(OLD, cfg), n = makeEnv(NEW, cfg), on = el => { el('bt-score').checked = true; el('bt-m-auto').checked = false; el('bt-pairs').value = '5'; };
    const a = await runBT(o, on), b = await runBT(n, on);
    check('B4 radar score on: identical', same(a.json, b.json) && a.json.later40.some(r => r.label === 'Radar score 25+' && r.n > 0));
  }
  }

  if (want('C')) {
  console.log('== C. gold fallback (Luno PAXGMYR)');
  {
    const cfg = stdCfg(), env = makeEnv(NEW, cfg), r = await runBT(env, setScore(false)), mu = r.json.macroUsed;
    const g = cfg.goldCandles, first = new Date(Math.floor(g[0].timestamp / DAY) * DAY).toISOString().slice(0, 10), last = new Date(Math.floor(g[g.length - 1].timestamp / DAY) * DAY).toISOString().slice(0, 10);
    check('C1 Worker gold 403 + PAXGMYR on Luno: gold comes from Luno, source named', mu.gold && /^Luno PAXGMYR/.test(mu.gold.source), JSON.stringify(mu.gold));
    check('C2 range and day count match the PAXGMYR candles exactly', mu.gold && mu.gold.from === first && mu.gold.to === last && mu.gold.days === g.length, JSON.stringify(mu.gold) + ' vs ' + first + '..' + last + ' ' + g.length);
    check('C3 the dollar feed still loads from the Worker', mu.dxy && /^Worker:/.test(mu.dxy.source));
    check('C4 gold rules now appear (both rules, both halves)', [r.json.later40, r.json.earlier60].every(h => [goldRule, 'Breakout and gold rising'].every(l => h.some(x => x.label === l && x.n > 0))));
    check('C5 the failed Worker feed is still reported, wording "skipped"', r.json.notes.some(x => x === 'gold Worker feed: gold: Binance returned 403, so that source was skipped'), JSON.stringify(r.json.notes));
    check('C6 the footer names the gold source and dates', new RegExp('gold ' + first + ' to ' + last + ' \\(' + g.length + ' days; Luno PAXGMYR').test(r.out));
    check('C7 PAXGMYR already loaded as a coin is reused: exactly 4 candle calls for it', env.net.calls.filter(c => c.includes('pair=PAXGMYR')).length === 4, env.net.calls.filter(c => c.includes('pair=PAXGMYR')).length);
  }
  {   // PAXGMYR exists on Luno but is not among the coins being tested -> fetched separately
    const cfg = stdCfg(), env = makeEnv(NEW, cfg), r = await runBT(env, el => { el('bt-score').checked = false; el('bt-pairs').value = '5'; });
    check('C8 coins limited to the top 5: PAXGMYR is fetched separately for gold (4 pages) and gold still loads', env.net.calls.filter(c => c.includes('pair=PAXGMYR')).length === 4 && r.json.macroUsed.gold && /^Luno PAXGMYR/.test(r.json.macroUsed.gold.source), env.net.calls.filter(c => c.includes('pair=PAXGMYR')).length);
  }
  {   // hourly candles: gold must still be fetched as DAILY candles
    const cfg = stdCfg(), env = makeEnv(NEW, cfg), r = await runBT(env, el => { el('bt-score').checked = false; el('bt-duration').value = '3600'; el('bt-pairs').value = '5'; });
    const pc = env.net.calls.filter(c => c.includes('pair=PAXGMYR'));
    check('C9 hourly run: gold fetched with duration=86400, and gold rules still load', pc.length === 4 && pc.every(c => c.includes('duration=86400')) && r.json.macroUsed.gold && r.json.macroUsed.gold.days === 900, pc.join(' | ') + ' ' + JSON.stringify(r.json.macroUsed));
  }
  {   // too short a history
    const cfg = stdCfg({ paxgN: 40 }), env = makeEnv(NEW, cfg), r = await runBT(env, setScore(false));
    check('C10 PAXGMYR with only 40 candles: no gold rules, honest note, run completes', !r.json.macroUsed.gold && r.json.notes.some(x => /gold: Luno PAXGMYR has only 40 daily candles, so the gold rules are not shown/.test(x)) && !r.json.later40.some(x => x.label === goldRule), JSON.stringify(r.json.notes));
  }
  {   // a Worker feed that works wins; the fallback is never touched
    const cfg = stdCfg({ gold: 'ok', paxgInList: false }), env = makeEnv(NEW, cfg), r = await runBT(env, setScore(false));
    check('C11 working Worker gold feed is used, Luno PAXGMYR never fetched', r.json.macroUsed.gold && /^Worker: stub gold feed/.test(r.json.macroUsed.gold.source) && env.net.calls.filter(c => c.includes('pair=PAXGMYR')).length === 0);
  }
  {   // a loaded file wins, and a broken file is NOT silently replaced
    const csv = ['date,close'].concat(goldSeries(300).map(x => new Date(x.timestamp).toISOString().slice(0, 10) + ',' + x.close.toFixed(2))).join('\n');
    const cfg = stdCfg({ paxgInList: false }), env = makeEnv(NEW, cfg), r = await runBT(env, el => { el('bt-score').checked = false; el('bt-m-gold').files = [{ name: 'gold.csv', text: async () => csv }]; });
    check('C12 a gold CSV you load wins over everything (no Worker gold call, no PAXGMYR call)', r.json.macroUsed.gold && r.json.macroUsed.gold.source === 'file gold.csv' && !env.net.calls.some(c => c.includes('series=gold')) && !env.net.calls.some(c => c.includes('pair=PAXGMYR')), JSON.stringify(r.json.macroUsed.gold));
    const cfg2 = stdCfg({ paxgInList: false }), env2 = makeEnv(NEW, cfg2), r2 = await runBT(env2, el => { el('bt-score').checked = false; el('bt-m-gold').files = [{ name: 'bad.csv', text: async () => 'foo,bar\n1,2' }]; });
    check('C13 a broken gold CSV is reported and gold stays off (no silent substitution)', !r2.json.macroUsed.gold && r2.json.notes.some(x => /^bad\.csv: .*so that source was skipped$/.test(x)) && !env2.net.calls.some(c => c.includes('pair=PAXGMYR')), JSON.stringify(r2.json.notes));
  }
  {   // PAXGMYR missing on Luno
    const cfg = stdCfg({ paxgAvailable: false, paxgInList: false }), env = makeEnv(NEW, cfg), r = await runBT(env, setScore(false));
    check('C14 PAXGMYR unknown to Luno: note says so, run completes with the other rules', !r.json.macroUsed.gold && r.json.notes.some(x => /^gold: Luno PAXGMYR unavailable \(Unknown pair\)/.test(x)) && r.json.signalsScored > 3000);
  }
  }

  if (want('D')) {
  console.log('== D. the gold regime itself');
  {
    const cfg = stdCfg({ plant: true }), env = makeEnv(NEW, cfg), r = await runBT(env, setScore(false));
    const L = r.json.later40.find(x => x.label === goldRule), E = r.json.earlier60.find(x => x.label === goldRule);
    check('D1 planted effect (coins rise only while PAXGMYR is above its 50-day average): "Gold rising" shows a big lift in BOTH halves', L && E && L.lift > 10 && E.lift > 10, L && E && L.lift.toFixed(1) + ' / ' + E.lift.toFixed(1));
    check('D2 ... and clears the strict bar in the later half (direction wired the right way round)', L && L.beats === true);
    const cfg0 = stdCfg(), env0 = makeEnv(NEW, cfg0), r0 = await runBT(env0, setScore(false)), L0 = r0.json.later40.find(x => x.label === goldRule);
    check('D3 control (no planted effect): "Gold rising" does not show a big lift', L0 && Math.abs(L0.lift) < 10, L0 && L0.lift.toFixed(1));
    // regime semantics: spike on day 60 must only be visible from day 61 (lagged), through the real function
    const t0 = Date.UTC(2024, 0, 1), sr = Array.from({ length: 70 }, (_, i) => ({ d: t0 + i * DAY, close: i === 60 ? 110 : 100 }));
    const m = vm.runInContext('(sr => { const m = macroRegime(sr, true); return Array.from(m.entries()); })', env.ctx)(sr).map(([k, v]) => [k, v]);
    const mm = new Map(m), at = i => mm.get(t0 + i * DAY);
    check('D4 regime is lagged one day: a close above the average on day 60 shows up on day 61, not day 60', at(61) === true && at(60) !== true && at(62) === false, [at(60), at(61), at(62)].join());
    const ind = indepRegime(cfg.goldCandles), viaCtx = new Map(vm.runInContext('(sr => Array.from(macroRegime(sr, true).entries()))', env.ctx)(cfg.goldCandles.map(x => ({ d: Math.floor(x.timestamp / DAY) * DAY, close: x.close }))));
    let agree = 0, tot = 0; for (const [k, v] of ind) { tot++; if (viaCtx.get(k) === v) agree++; }
    check('D5 the shipped regime function agrees with an independent re-implementation on every day', tot > 800 && agree === tot, agree + '/' + tot);
  }
  }

  if (want('E')) {
  console.log('== E. big-mover direction verdict (v1.2)');
  {
    const env = makeEnv(NEW, stdCfg());
    const mk = (seed, N, pA, pB, split) => { const r = rng(seed), rows = []; for (let i = 0; i < N; i++) { const u = r(); const g = u < 0.2 ? 'A' : u < 0.4 ? 'B' : 'N', pb = g === 'A' ? pA.big : g === 'B' ? pB.big : 0.02, pd = g === 'A' ? pA.drop : g === 'B' ? pB.drop : 0.03, fw = ((r() + r() + r()) / 3 - 0.5) * 8 + (g === 'A' ? 1 : g === 'B' ? -1 : 0); rows.push({ ts: Date.UTC(2023, 0, 1) + i * DAY, pair: 'X' + (i % 7), big: r() < pb, drop: r() < pd, fwd: fw, f: { brk: g === 'A', vol: false, sqz: false, ran: g === 'B' }, split }); } return rows; };
    const A = { big: 0.16, drop: 0.05 }, B = { big: 0.16, drop: 0.16 }, evalIn = (e, fn, ...a) => vm.runInContext(fn, e.ctx)(...a);
    const later = mk(1, 6000, A, B, 'out'), early = mk(2, 6000, A, B, 'in');
    const st = vm.runInContext('(l, e, H) => [bgStats(l, H), bgStats(e, H)]', env.ctx)(later, early, 7);
    check('E0 setup: both rules pass stage 1 in both halves; A is directional, B is not', st[0].rules[0].beats && st[1].rules[0].beats && st[0].rules[4].beats && st[1].rules[4].beats && st[0].rules[0].dirRatio >= 1.5 && st[1].rules[0].dirRatio >= 1.5 && st[0].rules[4].dirRatio < 1.5 && st[1].rules[4].dirRatio < 1.5, st[0].rules.map(r => [r.beats, r.dirRatio && +r.dirRatio.toFixed(2)].join(':')).join(' '));
    const vNew = evalIn(env, '(l, e, H) => bgDirVerdict(l, e, H)', later, early, 7);
    check('E1 v1.2 names the rule that passed AND the rule that did not', /Direction check passed in BOTH halves: 20-candle breakout\./.test(vNew) && /NOT shown to be bullish[^]*Already up 10%\+ in the last 3 candles: rally lift \/ drop lift = [0-9.]+ \(later\) and [0-9.]+ \(earlier\); median 7-candle return/.test(vNew), vNew);
    check('E2 the passing rule is not listed as failing, and the failing rule is not listed as passing', !/NOT shown[^]*20-candle breakout/.test(vNew) && !/passed in BOTH halves:[^.]*Already up/.test(vNew));
    // E3 (v1.1 hid the failing rule) retired in v2.8: the big-mover file is byte-identical to v2.7, checked in A; E1 and E2 keep testing the behaviour
    // only the failing rule: both rules directionless
    const laterB = mk(3, 6000, B, B, 'out'), earlyB = mk(4, 6000, B, B, 'in'), vBoth = evalIn(env, '(l, e, H) => bgDirVerdict(l, e, H)', laterB, earlyB, 7);
    check('E4 no rule directional: only the NOT-bullish sentence, naming every rule that passed stage 1', !/passed in BOTH halves/.test(vBoth) && /NOT shown to be bullish/.test(vBoth) && /20-candle breakout/.test(vBoth) && /Already up 10%/.test(vBoth), vBoth);
    // nothing passes stage 1
    const rN = (seed, split) => { const r = rng(seed), rows = []; for (let i = 0; i < 4000; i++) rows.push({ ts: Date.UTC(2023, 0, 1) + i * DAY, pair: 'Y', big: r() < 0.04, drop: r() < 0.03, fwd: (r() - 0.5) * 6, f: { brk: r() < 0.2, vol: false, sqz: false, ran: false }, split }); return rows; };
    check('E5 nothing passes stage 1: direction verdict is empty', evalIn(env, '(l, e, H) => bgDirVerdict(l, e, H)', rN(5, 'out'), rN(6, 'in'), 7) === '');
    // sentence is joined into the page verdict by runBigMovers
    const cfg = stdCfg({ edge: 0.06 }), env2 = makeEnv(NEW, cfg), g = await runBG(env2);
    check('E6 runBigMovers still completes and the verdict line renders', g.json && g.json.daysScored > 3000 && g.verdict.length > 0 && /Done: \d+ days scored across \d+ coins/.test(g.status), g.status);
  }
  }

  if (want('F')) {
  console.log('== F. scale (51 coins, 4 macro inputs, score off)');
  {
    const cfg = stdCfg({ n: 1500 }); const extra = []; for (let i = 0; i < 41; i++) extra.push({ pair: 'C' + i + 'MYR', vol: 10 + i, spread: 0.3 + (i % 9) * 0.2, seed: 200 + i });
    cfg.coins.push(...extra); const base = cfg.series; cfg.series = (p, dur) => { const c = extra.find(x => x.pair === p); if (c) { cfg._c = cfg._c || new Map(); const k = p + ':' + dur; if (!cfg._c.has(k)) cfg._c.set(k, genSeries(c.seed, dur === 86400 ? 1500 : 1200, dur * 1000, { edge: 0.03 })); return cfg._c.get(k); } return base(p, dur); };
    const env = makeEnv(NEW, cfg), t0 = Date.now(), r = await runBT(env, setScore(false)), dt = Date.now() - t0;
    check('F1 51 coins x 1,500 days completes with gold from Luno, in a reasonable time', r.json && r.json.coinsTested === 51 && r.json.macroUsed.gold && dt < 60000, 'coins=' + (r.json && r.json.coinsTested) + ' rows=' + (r.json && r.json.signalsScored) + ' ' + dt + 'ms');
    check('F2 the JSON stays small enough to paste', r.json && env.el('bt-json').value.length < 60000, env.el('bt-json').value.length + ' chars');
    console.log('       (rows ' + r.json.signalsScored + ', ' + dt + ' ms, JSON ' + env.el('bt-json').value.length + ' chars, notes ' + r.json.notes.length + ')');
  }
  }

  if (want('G')) {
  console.log('== G. relationship study (v1.0)');
  {   // G0: the maths, on data with known answers
    const env = makeEnv(NEW, stdCfg()), fn = n => vm.runInContext(n, env.ctx), P = fn('relPearson'), S = fn('relSpearman'), IV = fn('relInterval'), RNG = fn('relRng'), Z = vm.runInContext('REL.Z_BAR', env.ctx);
    check('G0a Pearson r is exact on known data (6 / sqrt(60), -1) and null on a constant series', Math.abs(P([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]) - 6 / Math.sqrt(60)) < 1e-12 && Math.abs(P([1, 2, 3], [3, 2, 1]) + 1) < 1e-12 && P([1, 1, 1], [1, 2, 3]) === null);
    check('G0b Spearman rank r is exact with ties (8 / sqrt(95))', Math.abs(S([1, 2, 3, 4, 5], [5, 6, 7, 8, 7]) - 8 / Math.sqrt(95)) < 1e-12);
    const iv = IV(0.5, 0.1, 1.96), iv0 = IV(0, 0.1, 1.96);
    check('G0c Fisher-z interval contains r, stays inside (-1, 1), is symmetric at r = 0 and equals tanh(atanh(r) -/+ z sd)', iv[0] < 0.5 && iv[1] > 0.5 && iv[0] > -1 && iv[1] < 1 && Math.abs(iv0[0] + iv0[1]) < 1e-12 && Math.abs(iv[0] - Math.tanh(Math.atanh(0.5) - 0.196)) < 1e-12);
    const a = RNG(5), b = RNG(5), c = RNG(6), A = [a(), a(), a()], B = [b(), b(), b()], C = [c(), c(), c()];
    check('G0d seeded random numbers repeat for the same seed, differ for another seed, and stay in [0, 1)', same(A, B) && !same(A, C) && A.every(v => v >= 0 && v < 1));
    check('G0e the strict bar z = 2.84 is at least as strict as 0.05 / 22 per tail (11 two-sided rows); 0.01 less would not be', normTail(Z) <= 0.05 / 22 + 1e-7 && normTail(Z - 0.01) > 0.05 / 22, normTail(Z).toFixed(6) + ' vs ' + (0.05 / 22).toFixed(6));
    const BS = fn('relBootSd'), gz = u => () => Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()), ar1 = (seed, phi, n) => { const g = gz(RNG(seed)), o = []; let v = g() / Math.sqrt(1 - phi * phi); for (let i = 0; i < n; i++) { v = phi * v + g(); o.push(v); } return o; };
    const nn = 2000, sdIid = BS(ar1(1000, 0, nn), ar1(1001, 0, nn), 5) * Math.sqrt(nn), sdSticky = BS(ar1(1000, 0.8, nn), ar1(1001, 0.8, nn), 5) * Math.sqrt(nn);
    check('G0f the bootstrap resamples BLOCKS of days: on unrelated noise its spread is about 1 / sqrt(n); on two unrelated but "sticky" series (each day 80% like the day before; true spread about 2.1 / sqrt(n)) it is clearly wider, about 1.8, where a day-by-day bootstrap stays near 1.0 and would call chance links "clear"', sdIid > 0.85 && sdIid < 1.15 && sdSticky > 1.5 && sdSticky < 2.3, 'noise ' + sdIid.toFixed(3) + ' / sticky ' + sdSticky.toFixed(3) + ' (times sqrt n)');
  }
  {   // G1: planted links between Bitcoin and the alt basket; each variant must be read the right way round
    const lead = await runREL(relScenario({ seed: 11, btcLead: 0.4 }), { noFiles: true }), j = lead.json, c1 = cellOf(j, 'altsBtc', 1), c0 = cellOf(j, 'altsBtc', 0), cm1 = cellOf(j, 'altsBtc', -1);
    check('G1a Bitcoin leads alts by one day (planted): lag +1 is "together", clear in both halves, r near the planted 0.37', /^together .*clear in both halves/.test(c1.reading) && c1.r > 0.28 && c1.r < 0.45, c1.reading + ' r=' + c1.r);
    check('G1b ... while lag 0 and lag -1 show no clear link', c0.reading === 'no clear link' && cm1.reading === 'no clear link', c0.reading + ' / ' + cm1.reading);
    check('G1c ... the verdict sentence says the same, and the stock comparisons are "not tested (no file loaded)"', /Alt basket vs Bitcoin, same day: no clear link/.test(lead.verdict) && /Bitcoin first, alts the next day: together/.test(lead.verdict) && /Alt basket vs Nasdaq Composite: not tested \(no file loaded\)/.test(lead.verdict), lead.verdict);
    const sim = await runREL(relScenario({ seed: 12, btcSim: 0.8 }), { noFiles: true }), s0 = cellOf(sim.json, 'altsBtc', 0);
    check('G1d simultaneous link (planted 0.8): lag 0 is "together", strong, r near 0.62; lags -1 and +1 show nothing', /^together \(strong\), clear in both halves/.test(s0.reading) && s0.r > 0.55 && s0.r < 0.68 && cellOf(sim.json, 'altsBtc', 1).reading === 'no clear link' && cellOf(sim.json, 'altsBtc', -1).reading === 'no clear link', s0.reading + ' r=' + s0.r);
    const opp = await runREL(relScenario({ seed: 13, btcSim: -0.5 }), { noFiles: true }), o0 = cellOf(opp.json, 'altsBtc', 0);
    check('G1e opposite link (planted -0.5): lag 0 is "opposite", moderate, r near -0.45 (sign handled)', /^opposite \(moderate\), clear in both halves/.test(o0.reading) && o0.r < -0.38 && o0.r > -0.52, o0.reading + ' r=' + o0.r);
    const half = await runREL(relScenario({ seed: 14, btcLead: 0.6, onlyAfter: 0.7 }), { noFiles: true }), h1 = cellOf(half.json, 'altsBtc', 1);
    check('G1f a link that exists only in the last 30% of the history is NOT called clear in both halves', /NOT clear in both halves/.test(h1.reading) && Math.abs(h1.earlier.r) < 0.12 && h1.later.r > 0.3, h1.reading + ' earlier ' + h1.earlier.r + ' later ' + h1.later.r);
    const rollRow = (out, label, timing) => { const m = new RegExp('<tr><td>' + label + '</td><td>' + timing + '</td><td>(\\d+)%</td><td>(\\d+)%</td><td>(\\d+)%</td>').exec(out); return m ? m.slice(1).map(Number) : null; };
    const rs = sim.json.pairs.find(p => p.id === 'altsBtc').rolling[0], ro = opp.json.pairs.find(p => p.id === 'altsBtc').rolling[0], hs = rollRow(sim.out, 'Alt basket vs Bitcoin', 'same day'), ho = rollRow(opp.out, 'Alt basket vs Bitcoin', 'same day');
    check('G1g rolling view, positive link (planted +0.8): almost every 90-window stretch is above +0.2 and none below -0.2, in the JSON and in the first column of the page table', rs.pos > 0.95 && rs.neg < 0.02 && rs.median > 0.4 && !!hs && hs[0] >= 95 && hs[2] <= 2, JSON.stringify(rs) + ' | ' + hs);
    check('G1h rolling view, opposite link (planted -0.5): almost every stretch is below -0.2 and none above +0.2, in the JSON and in the third column of the page table', ro.neg > 0.9 && ro.pos < 0.02 && ro.median < -0.3 && !!ho && ho[2] >= 90 && ho[0] <= 2, JSON.stringify(ro) + ' | ' + ho);
  }
  let fpA = null, fpB = null;
  {   // G2: nothing planted
    const nulls = [];
    for (const seed of [21, 22, 23]) { const r = await runREL(relScenario({ seed })); nulls.push(linked(r.json).length); }
    check('G2a no planted link, three independent worlds, both stock files loaded: at most 1 of the 11 judged rows shows a link in each', nulls.every(k => k <= 1), nulls.join(','));
    const full = await runREL(relScenario({ seed: 21 }));
    check('G2b with both files: five comparisons ran (none skipped), each with 11 lags, all 11 judged rows carry a reading', full.json.pairs.length === 5 && full.json.pairs.every(p => !p.skipped && p.cells.length === 11) && HEAD.every(([id, k]) => cellOf(full.json, id, k).reading) && /Done: 5 of 5 comparisons/.test(full.status), full.status);
    check('G2c the headline table has 11 rows, each comparison has an "every lag" table, the rolling table is shown', ((full.out.match(/<tbody>([^]*?)<\/tbody>/) || [, ''])[1].match(/<tr>/g) || []).length === 11 && (full.out.match(/every lag/g) || []).length === 5 && /Does it hold over time/.test(full.out));
    const env = makeEnv(NEW, stdCfg()), cellF = vm.runInContext('relCell', env.ctx), r = rng(777);
    const sim = (gen, trials) => { let fp = 0; for (let t = 0; t < trials; t++) { const n = 800, x = [], y = [], idx = []; gen(n, x, y); for (let i = 0; i < n; i++) idx.push(i); const c = cellF({ x, y, i: idx }, Math.floor(n * 0.6), 0, 5000 + t, true); if (c.loS > 0 || c.hiS < 0) fp++; } return fp; };
    const iid = (n, x, y) => { for (let i = 0; i < n; i++) { x.push(gauss(r)); y.push(gauss(r)); } };
    const clustered = (n, x, y) => { let h = 0; for (let i = 0; i < n; i++) { h = 0.97 * h + 0.25 * gauss(r); const s = Math.exp(0.5 * h); x.push(s * gauss(r)); y.push(s * gauss(r)); } };   // both series share a slowly changing volatility but are uncorrelated
    fpA = sim(iid, 600); fpB = sim(clustered, 600);
    check(`G2d calibration: with no real link the strict range clears zero in ${fpA} of 600 plain trials and ${fpB} of 600 volatility-clustered trials (limit 9 = 1.5%; luck alone gives about 3)`, fpA <= 9 && fpB <= 9, fpA + ' / ' + fpB);
  }
  {   // G3: stock links planted on exact days; the pairing must read the direction and the lag the right way round
    const sim = await runREL(relScenario({ seed: 31, stSim: 1.5 })), ln = cellOf(sim.json, 'altsNasdaq', 0), ls = cellOf(sim.json, 'altsSp500', 0);
    check('G3a alts move with the stock index in the same window (planted): lag 0 "together" for the Nasdaq and the S&P 500, r between 0.2 and 0.55; lag +1 shows nothing', [ln, ls].every(c => /^together .*clear in both halves/.test(c.reading) && c.r > 0.2 && c.r < 0.55) && readingOf(sim.json, 'altsNasdaq', 1) === 'no clear link' && readingOf(sim.json, 'altsSp500', 1) === 'no clear link', [ln.reading, ln.r, ls.r, readingOf(sim.json, 'altsNasdaq', 1)].join(' | '));
    const lead = await runREL(relScenario({ seed: 32, stLead: 1.5 })), l1 = cellOf(lead.json, 'altsNasdaq', 1);
    check('G3b alts follow the stock index by one window (planted on the day AFTER the stock date): lag +1 "together", lag 0 shows nothing', /^together .*clear in both halves/.test(l1.reading) && l1.r > 0.2 && readingOf(lead.json, 'altsNasdaq', 0) === 'no clear link', l1.reading + ' ' + l1.r + ' | ' + readingOf(lead.json, 'altsNasdaq', 0));
    const back = await runREL(relScenario({ seed: 33, stBack: 1.5 })), b2 = cellOf(back.json, 'altsNasdaq', -2);
    check('G3c alts move two windows BEFORE the stock index (planted): the -2 row shows r between 0.2 and 0.55 (shown, not judged); the judged rows (0, +1) show nothing', b2.r > 0.2 && b2.r < 0.55 && b2.reading === undefined && readingOf(back.json, 'altsNasdaq', 0) === 'no clear link' && readingOf(back.json, 'altsNasdaq', 1) === 'no clear link', JSON.stringify(b2));
    const opp = await runREL(relScenario({ seed: 34, stSim: -1.5 })), o0 = cellOf(opp.json, 'altsSp500', 0);
    check('G3d opposite stock link (planted -1.5): "opposite", clear in both halves', /^opposite .*clear in both halves/.test(o0.reading) && o0.r < -0.2, o0.reading + ' ' + o0.r);
    const ref = await runREL(relScenario({ seed: 35, btcSt: 1.5 }));
    check('G3e Bitcoin follows the stock index (planted on Bitcoin only): "Bitcoin vs Nasdaq" and "Bitcoin vs S&P 500" lag 0 are "together", the alt basket is not linked', /^together/.test(readingOf(ref.json, 'btcNasdaq', 0)) && /^together/.test(readingOf(ref.json, 'btcSp500', 0)) && readingOf(ref.json, 'altsNasdaq', 0) === 'no clear link', readingOf(ref.json, 'btcNasdaq', 0) + ' | ' + readingOf(ref.json, 'altsNasdaq', 0));
  }
  {   // G4: the shipped pairing agrees with an independent re-implementation to the last digit, on awkward data: holidays, a 15-day hole in the stock files, 3% of candles missing
    const sc = relScenario({ seed: 41, hole: true, gaps: 0.03, stSim: 0.8, btcLead: 0.3 }), run = await runREL(sc), bad = []; let tot = 0;
    for (const lag of [-3, -2, -1, 0, 1, 2, 3]) {
      for (const [id, key, which] of [['altsNasdaq', 'nasdaq', 'alts'], ['altsSp500', 'sp500', 'alts'], ['btcNasdaq', 'nasdaq', 'btc'], ['btcSp500', 'sp500', 'btc']]) { const ref = refStock(sc, key, which, lag), c = cellOf(run.json, id, lag); tot++; if (!(c && c.n === ref.n && Math.abs(c.r - ref.r) < 1e-4)) bad.push(id + '@' + lag + ' ' + (c && c.n) + '/' + ref.n + ' ' + (c && c.r) + '/' + ref.r); }
      const ref = refCal(sc, lag), c = cellOf(run.json, 'altsBtc', lag); tot++; if (!(c && c.n === ref.n && Math.abs(c.r - ref.r) < 1e-4)) bad.push('altsBtc@' + lag + ' ' + (c && c.n) + '/' + ref.n + ' ' + (c && c.r) + '/' + ref.r);
    }
    check(`G4a ${tot} cells (5 comparisons x 7 lags): pair counts and correlations equal the independent re-implementation`, bad.length === 0 && tot === 35, bad.slice(0, 3).join(' ; '));
    const splits = [['altsNasdaq', refStock(sc, 'nasdaq', 'alts', 0)], ['btcSp500', refStock(sc, 'sp500', 'btc', 0)], ['altsBtc', refCal(sc, 0)]].map(([id, ref]) => [run.json.pairs.find(p => p.id === id).split, new Date(ref.dates[Math.floor(ref.dates.length * 0.6)]).toISOString().slice(0, 10)]);
    check('G4b the earlier-60% / later-40% split date is the date of the window at 60% of the paired windows', splits.every(([a, b]) => a === b), JSON.stringify(splits));
    check('G4c the test data really contains a stock-file hole of more than 7 days and missing candles', sc.stock.nasdaq.some((r, i, a) => i > 0 && (r.d - a[i - 1].d) / DAY > 7) && sc.candles.ALT0MYR.length < sc.n - 20, sc.candles.ALT0MYR.length + ' of ' + sc.n + ' candles');
  }
  {   // G5: who is in the alt basket
    const sc = relScenario({ seed: 51, extras: true }), run = await runREL(sc, { noFiles: true }), j = run.json;
    check('G5a gold tokens, stablecoins and a coin with under 60 candles are left out of the basket and named; Bitcoin is not an alt either', j.altsUsed === 12 && ['PAXGMYR (gold token)', 'XAUTMYR (gold token)', 'USDCMYR (stablecoin)', 'NEWMYR (under 60 daily candles)'].every(x => j.leftOut.includes(x)) && !j.leftOut.some(x => /^XBTMYR/.test(x)), JSON.stringify(j.leftOut) + ' used ' + j.altsUsed);
    const few = await runREL(relScenario({ seed: 52, alts: 9 }), { noFiles: true });
    check('G5b only 9 alts (fewer than 10): no basket, every alt comparison skipped with an honest note, the run still finishes', few.json.basket === null && few.json.notes.some(x => /never reached 10 coins/.test(x)) && !!few.json.pairs.find(p => p.id === 'altsBtc').skipped && /^Done/.test(few.status), few.status + ' ' + JSON.stringify(few.json.notes));
    const sc3 = relScenario({ seed: 53 }); delete sc3.candles.XBTMYR; const nb = await runREL(sc3);
    check('G5c Bitcoin history missing: Bitcoin comparisons skipped with the reason, the alt-versus-stock comparisons still run', nb.json.pairs.find(p => p.id === 'altsBtc').skipped === 'Bitcoin history missing' && nb.json.pairs.find(p => p.id === 'btcNasdaq').skipped === 'Bitcoin history missing' && !nb.json.pairs.find(p => p.id === 'altsNasdaq').skipped && nb.json.notes.some(x => /XBTMYR: no data/.test(x)) && nb.json.notes.some(x => /Bitcoin \(XBTMYR\) history is missing/.test(x)), JSON.stringify(nb.json.notes));
    const top = await runREL(relScenario({ seed: 54 }), { noFiles: true, setup: el => { el('rel-pairs').value = '10'; } }), calls = top.env.net.calls.filter(c => c.startsWith('/api/candles')), pairsCalled = new Set(calls.map(c => new URLSearchParams(c.split('?')[1]).get('pair')));
    check('G5d "Top 10" fetches ten coins and always adds Bitcoin when it is not among them', pairsCalled.size >= 10 && pairsCalled.size <= 11 && pairsCalled.has('XBTMYR'), [...pairsCalled].join(','));
  }
  {   // G6: reading stock files
    const env = makeEnv(NEW, stdCfg()), parse = vm.runInContext('relParseCsv', env.ctx), mk = (head, rows) => [head, ...rows].join('\n');
    const days = Array.from({ length: 200 }, (_, i) => new Date(Date.UTC(2024, 0, 1) + i * DAY).toISOString().slice(0, 10));
    const a = parse(mk('observation_date,SP500', days.map((d, i) => d + ',' + (i % 10 === 5 ? '.' : (4000 + i).toFixed(2)))));
    check('G6a FRED layout (observation_date,SP500; "." on closed days): holidays skipped without error, dates and values right', a.rows === 180 && a.missing === 20 && a.bad === 0 && a.series[0].d === Date.UTC(2024, 0, 1) && a.series[0].close === 4000 && a.header === 'observation_date,SP500', JSON.stringify([a.rows, a.missing, a.bad]));
    const b = parse('﻿' + mk('DATE,NASDAQCOM', days.map((d, i) => d + ',' + (i % 7 === 3 ? '' : (9000 + i).toFixed(2)))).replace(/\n/g, '\r\n'));
    check('G6b older FRED layout (DATE,NASDAQCOM), empty cells for closed days, Windows line endings and a byte-order mark (which must not leak into the header text that the page and the JSON report)', b.rows === 171 && b.bad === 0 && b.missing === 29 && b.series[0].close === 9000 && b.header === 'DATE,NASDAQCOM', JSON.stringify([b.rows, b.missing, b.bad, b.header]));
    const c = parse(mk('time,open,high,low,close,Volume', days.map((d, i) => Math.floor(Date.parse(d + 'T14:30:00Z') / 1000) + ',1,2,0.5,' + (100 + i) + ',9')));
    check('G6c TradingView-style layout (unix-seconds "time" and a "close" column among others) reads the CLOSE and floors to the UTC day', c.rows === 200 && c.series[0].d === Date.UTC(2024, 0, 1) && c.series[0].close === 100 && c.series[199].close === 299, JSON.stringify([c.rows, c.series[0], c.series[199]]));
    const d1 = parse(mk('Date,Open,High,Low,Close,Adj Close,Volume', days.map((d, i) => d + ',1,2,0.5,' + (100 + i) + ',77,9')));
    check('G6d Yahoo/Stooq-style layout (Date,...,Close,Adj Close): the Close column is used, not Adj Close', d1.series[3].close === 103, JSON.stringify(d1.series[3]));
    const e = parse(mk('Date,Close', [...days].reverse().map((d, i) => d + ',' + (100 + 199 - i))));
    check('G6e a newest-first file is sorted oldest-first; a repeated day keeps the last value', e.series[0].close === 100 && e.series[199].close === 299 && parse(mk('Date,Close', [...days.map((d, i) => d + ',' + (100 + i)), days[199] + ',555'])).series[199].close === 555);
    const f = parse(days.map((d, i) => d + ',' + (100 + i)).join('\n')), g = parse(mk('date;price', days.map((d, i) => d + ';' + (100 + i))));
    check('G6f a file with no header (date,value) and a semicolon-separated file both read', f.rows === 200 && f.header === '(none)' && g.rows === 200 && g.series[7].close === 107, JSON.stringify([f.rows, f.header, g.rows]));
    const err = fn => { try { fn(); return ''; } catch (x) { return x.message; } };
    const e1 = err(() => parse('foo,bar\n1,2')), e2 = err(() => parse(mk('Date,Close', days.slice(0, 50).map((d, i) => d + ',' + (100 + i))))), e3 = err(() => parse('only one line'));
    check('G6g unusable files fail loudly and name what was seen: wrong columns, too few rows, no rows', /only 0 usable daily rows[^]*header "foo,bar"[^]*first unreadable line "1,2"/.test(e1) && /only 50 usable daily rows \(needs 120\+/.test(e2) && /no data rows found/.test(e3), [e1, e2, e3].join(' | '));
    const th = v => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), q1 = parse(mk('date,close', days.map((d, i) => d + ',"' + th(5432.1 + i * 7) + '"'))), q2 = parse(mk('"date","close"', days.map((d, i) => '"' + d + '","' + th(5432.1 + i * 7) + '"'))), q3 = parse(mk('date;close', days.map((d, i) => d + ';"' + th(5432.1 + i * 7) + '"')));
    check('G6h numbers written with a thousands separator inside quotes ("5,432.10") are read whole, in a comma file (dates quoted or not) and in a semicolon file; a comma inside quotes is never taken as a column break', [q1, q2, q3].every(f => f.rows === 200 && f.bad === 0 && Math.abs(f.series[0].close - 5432.1) < 1e-9 && Math.abs(f.series[199].close - 6825.1) < 1e-9), JSON.stringify([q1, q2, q3].map(f => [f.rows, f.bad, f.series[0].close, f.series[199].close])));
  }
  {   // G7: honest handling of what R loads
    const sc = relScenario({ seed: 71 });
    const wrong = await runREL(sc, { setup: el => { el('rel-nasdaq').files = [{ name: 'SP500.csv', text: async () => sc.texts.sp500 }]; } });
    check('G7a an S&P 500 file in the Nasdaq box is flagged ("looks like a S&P 500 file") but still used', wrong.json.notes.some(x => /^SP500\.csv looks like a S&P 500 file but is in the Nasdaq Composite box/.test(x)) && !wrong.json.pairs.find(p => p.id === 'altsNasdaq').skipped, JSON.stringify(wrong.json.notes));
    const bad = await runREL(sc, { setup: el => { el('rel-nasdaq').files = [{ name: 'bad.csv', text: async () => 'foo,bar\n1,2' }]; } });
    check('G7b a broken Nasdaq file is reported and only the Nasdaq rows are skipped (S&P 500 and Bitcoin rows still run)', bad.json.notes.some(x => /^bad\.csv: only 0 usable daily rows.*so the Nasdaq Composite rows were skipped$/.test(x)) && bad.json.pairs.find(p => p.id === 'altsNasdaq').skipped === 'no file loaded' && !bad.json.pairs.find(p => p.id === 'altsSp500').skipped && !bad.json.pairs.find(p => p.id === 'altsBtc').skipped, JSON.stringify(bad.json.notes));
    const none = await runREL(sc, { noFiles: true });
    check('G7c no files at all: the Bitcoin comparison runs, the four stock comparisons say "no file loaded", the run is Done', !none.json.pairs.find(p => p.id === 'altsBtc').skipped && none.json.pairs.filter(p => p.skipped === 'no file loaded').length === 4 && /^Done: 1 of 5/.test(none.status), none.status);
    const short = relScenario({ seed: 72, n: 1500 }), cut = short.texts.nasdaq.split('\n'); const tiny = [cut[0], ...cut.slice(-180)].join('\n');
    const sh = await runREL(short, { setup: el => { el('rel-nasdaq').files = [{ name: 'NASDAQCOM.csv', text: async () => tiny }]; } });
    check('G7d a stock file with only a few months of rows still runs, and says how few windows it has', !sh.json.pairs.find(p => p.id === 'altsNasdaq').skipped ? sh.json.pairs.find(p => p.id === 'altsNasdaq').windows < 200 : /overlapping windows|usable daily rows/.test(JSON.stringify(sh.json.notes) + sh.json.pairs.find(p => p.id === 'altsNasdaq').skipped), sh.json.pairs.find(p => p.id === 'altsNasdaq').windows + ' windows');
    const thin = relScenario({ seed: 73, n: 400 }); Object.keys(thin.candles).forEach(p => { thin.candles[p] = thin.candles[p].slice(-120); });   // two years of stock rows, but only the last 120 days of crypto
    const th = await runREL(thin), pairOf = id => th.json.pairs.find(p => p.id === id);
    check('G7e the stock files and the crypto history overlap by fewer than 100 windows: the four stock comparisons are NOT judged and say how few windows there are, while the Bitcoin comparison (about 119 windows) still runs', ['altsNasdaq', 'altsSp500', 'btcNasdaq', 'btcSp500'].every(id => /^only \d+ overlapping windows \(needs 100\+\)$/.test(pairOf(id).skipped || '')) && !pairOf('altsBtc').skipped && pairOf('altsBtc').windows >= 100 && /Alt basket vs Nasdaq Composite: not tested \(only \d+ overlapping windows/.test(th.verdict), JSON.stringify(th.json.pairs.map(p => [p.id, p.skipped, p.windows])));
  }
  {   // G8: repeatable, polite to Luno, always daily
    const sc = relScenario({ seed: 81 }), a = await runREL(sc, { setup: el => { el('bt-duration').value = '3600'; } });
    const calls1 = a.env.net.calls.filter(c => c.startsWith('/api/candles')), r2 = await runREL(sc, { env: a.env }), calls2 = a.env.net.calls.filter(c => c.startsWith('/api/candles'));
    const b = await runREL(sc);
    check('G8a candles are always daily, even when the backtest box says 1 hour (13 coins x 4 pages)', calls1.length === 13 * 4 && calls1.every(c => c.includes('duration=86400')), calls1.length + ' calls');
    check('G8b a second run on the same page downloads nothing again and gives the identical result', calls2.length === calls1.length && r2.raw === a.raw, calls2.length + ' vs ' + calls1.length);
    check('G8c a fresh page on the same data gives byte-identical JSON (the bootstrap is seeded)', b.raw === a.raw);
  }
  {   // G9: what R reads
    const sc = relScenario({ seed: 101, btcLead: 0.4, stSim: 1.5 }), r = await runREL(sc);
    check('G9a verdict names all three alt comparisons, closes with the not-a-forecast sentence, and no undefined / NaN leaks into the page or JSON', /Alt basket vs Bitcoin/.test(r.verdict) && /Alt basket vs Nasdaq Composite/.test(r.verdict) && /Alt basket vs S&P 500/.test(r.verdict) && /not a forecast, and a link is not proof of cause\.$/.test(r.verdict) && !/undefined|NaN/.test(r.verdict + r.out + r.raw), r.verdict.slice(0, 200));
    check('G9b JSON: version fields, parameters, coverage, five comparisons with rolling summaries, judged rows carry a reading and other lags do not', r.json.suite === 'v2.8' && r.json.relations === 'v1.0' && r.json.params.judgedRows === 11 && r.json.params.strictZ === 2.84 && r.json.basket.coins === 12 && r.json.files.nasdaq.rows > 900 && r.json.pairs.every(p => p.rolling && p.rolling[0] && p.rolling[1]) && !!cellOf(r.json, 'altsBtc', 1).reading && cellOf(r.json, 'altsBtc', 3).reading === undefined, JSON.stringify(r.json.params));
    check('G9c the status line reports Done with a time', /^Done: 5 of 5 comparisons at /.test(r.status));
    check('G9d the "overlaps by about 3 to 4 hours" warning appears on stock rows only', /alts first, Nasdaq 1 window later \(overlaps by about 3 to 4 hours\)/.test(r.out) && !/alts first, Bitcoin 1 day later \(overlaps/.test(r.out));
    check('G9e rolling table: shares add up to 100% and the latest value is a real correlation', r.json.pairs.every(p => [0, 1].every(k => { const s = p.rolling[k]; return Math.abs(s.pos + s.mid + s.neg - 1) < 1e-3 && Math.abs(s.latest) <= 1 && s.min <= s.max; })));
    {   // G9f / G9g: the timing words in the tables say who moves first and match the lag number
      const un = s => s.replace(/&amp;/g, '&'), LAB = { altsBtc: 'Alt basket vs Bitcoin', altsNasdaq: 'Alt basket vs Nasdaq Composite', altsSp500: 'Alt basket vs S&P 500', btcNasdaq: 'Bitcoin vs Nasdaq Composite (reference)', btcSp500: 'Bitcoin vs S&P 500 (reference)' };
      const WHO = { altsBtc: ['Bitcoin', 'alts', 'day'], altsNasdaq: ['Nasdaq', 'alts', 'window'], altsSp500: ['S&P 500', 'alts', 'window'], btcNasdaq: ['Nasdaq', 'Bitcoin', 'window'], btcSp500: ['S&P 500', 'Bitcoin', 'window'] };
      const want = (id, k) => { const [a, b, u] = WHO[id], n = Math.abs(k), s = n === 1 ? '' : 's'; return k === 0 ? 'same ' + u : k > 0 ? `${a} first, ${b} ${n} ${u}${s} later` : `${b} first, ${a} ${n} ${u}${s} later` + (id !== 'altsBtc' && k === -1 ? ' (overlaps by about 3 to 4 hours)' : ''); };
      const head = un(r.out.slice(r.out.indexOf('<table'), r.out.indexOf('</table>')));
      const rows = [...head.matchAll(/<tr><td>([^<]*)<\/td><td>([^<]*)<\/td><td>(\d+)<\/td><td>([+-]\d\.\d\d) /g)].map(m => ({ label: m[1], timing: m[2], n: +m[3], r: +m[4] }));
      const missing = HEAD.filter(([id, k]) => { const c = cellOf(r.json, id, k); return !rows.some(w => w.label === LAB[id] && w.timing === want(id, k) && w.n === c.n && Math.abs(w.r - c.r) < 0.0051); });
      check('G9f headline table: each of the 11 judged rows carries the right timing words for its lag (who moves first, how many days or windows later) next to its own window count and r', rows.length === 11 && missing.length === 0, 'rows ' + rows.length + '; wrong or missing: ' + JSON.stringify(missing));
      const all = un(r.out);
      check('G9g "every lag" tables: lags +2 and -3 are worded the same way (plural, right order) for Bitcoin and for both indexes', ['<td>+2</td><td>Bitcoin first, alts 2 days later</td>', '<td>-3</td><td>alts first, Bitcoin 3 days later</td>', '<td>+2</td><td>Nasdaq first, alts 2 windows later</td>', '<td>-3</td><td>alts first, S&P 500 3 windows later</td>'].every(s => all.includes(s)));
    }
  }
  {   // G10: scale
    const sc = relScenario({ seed: 91, n: 1500, alts: 50 }), t0 = Date.now(), r = await runREL(sc), dt = Date.now() - t0;
    check('G10a 51 coins x 1,500 days and two stock files finish in a reasonable time', r.json && /^Done: 5 of 5/.test(r.status) && dt < 60000, r.status + ' ' + dt + ' ms');
    check('G10b the JSON stays small enough to paste', r.raw.length < 60000, r.raw.length + ' chars');
    console.log('       (relationship study at scale: ' + dt + ' ms, JSON ' + r.raw.length + ' chars; null calibration ' + fpA + ' / ' + fpB + ' false clears in 600 + 600 trials)');
  }
  {   // G11: when does a Luno daily candle start? The stock timing assumes 00:00 UTC (not confirmed from Luno's documents), so the page checks the candles it receives and says so
    const ok = await runREL(relScenario({ seed: 41 })), cs0 = ok.json.candleStart;
    check('G11a candles starting at 00:00 UTC (the default): the JSON says so, there is no timing note and no warning in the verdict', cs0 && cs0.utc === '00:00' && cs0.share === 1 && !ok.json.notes.some(n => /do not all start/.test(n)) && !/Warning/.test(ok.verdict) && !/do not all start/.test(ok.out), JSON.stringify(cs0));
    const sh = await runREL(relScenario({ seed: 41, shiftH: 22 })), cs1 = sh.json.candleStart;
    check('G11b candles starting at 22:00 UTC: the JSON, a note under the table and the verdict all say so, and the run still finishes', cs1 && cs1.utc === '22:00' && cs1.share >= 0.99 && sh.json.notes.some(n => /start at 22:00 UTC/.test(n)) && /do not all start at 00:00 UTC \(100% start at 22:00 UTC\)/.test(sh.out) && /Warning: Luno's daily candles do not start at midnight UTC/.test(sh.verdict) && /^Done/.test(sh.status), JSON.stringify(cs1) + ' ' + sh.status);
    const mix = relScenario({ seed: 42 }); ['ALT0MYR', 'ALT1MYR', 'ALT2MYR', 'ALT3MYR'].forEach(p => { mix.candles[p] = mix.candles[p].map(x => ({ ...x, timestamp: x.timestamp + 5 * 3600000 })); });
    const mx = await runREL(mix), cs2 = mx.json.candleStart;
    check('G11c a mixed set (4 of 13 coins start 5 hours later): the usual start is reported with its share, and the note and warning appear', cs2 && cs2.utc === '00:00' && cs2.share > 0.6 && cs2.share < 0.8 && mx.json.notes.some(n => /do not all start at 00:00 UTC \(\d+% start at 00:00 UTC\)/.test(n)) && /Warning/.test(mx.verdict), JSON.stringify(cs2));
    const nf = await runREL(relScenario({ seed: 43 }), { noFiles: true });
    check('G11d the check also runs when no stock file is loaded (it describes the candles, not the files)', nf.json.candleStart && nf.json.candleStart.utc === '00:00' && nf.json.candleStart.share === 1);
  }
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('FAILED: ' + failures.join(' | ')); process.exit(1); }
})().catch(e => { console.log('HARNESS ERROR', e && e.stack || e); process.exit(2); });
