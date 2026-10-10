/* Crypto Radar tests v2.7 (verification tooling, not part of the site). Run: node crypto-radar-tests.js   (Node 22; no packages needed)
   Folder layout it expects (or set NEWDIR / OLDDIR): this file next to crypto-radar.js (v2.0), crypto-radar-backtest.html/.js, crypto-radar-bigmovers.js, crypto-radar-worker.js (the NEW release),
   and a subfolder v15/ holding the PREVIOUS release's crypto-radar-backtest.html/.js, crypto-radar-bigmovers.js and crypto-radar-worker.js.
   It loads the real shipped files into a vm sandbox, builds the page's DOM stub from the page's own element ids, stubs the Worker's /api/markets, /api/candles and /api/macro with seeded synthetic data,
   and checks: A files/versions, B regression against the previous release, C gold fallback (14 cases), D gold regime (planted effect, control, lag, independent re-implementation), E big-mover direction verdict, F scale (51 coins).
   Mutation check used in v2.7: break the shipped code on purpose in 7 ways (see the handoff, section 19) and confirm each is caught. Not covered: a real browser, the live network. */
'use strict';
/* Test suite for backtest v1.6 / big movers v1.2 (suite v2.7).
   Loads the REAL shipped files into a vm sandbox with a stubbed DOM (built from the page's own HTML ids)
   and a stubbed Worker network. Compares against the delivered v1.5 / v1.1 originals saved in ./v15 . */
const vm = require('vm'), fs = require('fs'), crypto = require('crypto');
const HERE = __dirname + '/', OLD = process.env.OLDDIR || HERE + 'v15/', NEW = process.env.NEWDIR || HERE;   // NEW = folder with the shipped files + crypto-radar.js v2.0; OLD = folder with the previous release (for the regression checks)
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
  for (const f of [NEW + 'crypto-radar.js', dir + 'crypto-radar-backtest.js', dir + 'crypto-radar-bigmovers.js']) new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
  vm.runInContext('btInit(); bgInit();', ctx);
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

(async () => {
  console.log('== A. files and versions');
  check('Worker file unchanged (v2.1, no redeploy)', md5(NEW + 'crypto-radar-worker.js') === md5(OLD + 'crypto-radar-worker.js'));
  const bt = fs.readFileSync(NEW + 'crypto-radar-backtest.js', 'utf8'), bg = fs.readFileSync(NEW + 'crypto-radar-bigmovers.js', 'utf8'), html = fs.readFileSync(NEW + 'crypto-radar-backtest.html', 'utf8'), htmlOld = fs.readFileSync(OLD + 'crypto-radar-backtest.html', 'utf8');
  check('backtest header says v1.6 (suite v2.7) and JSON says the same', /Backtest v1\.6 \(suite v2\.7\)/.test(bt) && /suite: 'v2\.7', backtest: 'v1\.6'/.test(bt));
  check('big-mover header says v1.2 (suite v2.7) and JSON says the same', /Big-Mover Study v1\.2 \(suite v2\.7\)/.test(bg) && /suite: 'v2\.7', bigMovers: 'v1\.2'/.test(bg));
  check('page title, eyebrow and top comment carry v1.6 / v1.2 / suite v2.7', /<title>[^<]*Backtest v1\.6 \+ Big Movers v1\.2<\/title>/.test(html) && /Backtest v1\.6 &middot; Big movers v1\.2 \(suite v2\.7\)/.test(html) && /<!-- Crypto Radar Backtest page v1\.6 \+ Big Movers v1\.2 \(suite v2\.7\)/.test(html));
  check('no stale v1.5 / v1.1 / v2.6 / v2.5 version text left on the page or in the scripts', !/v1\.5|v1\.1\b|suite v2\.6|suite v2\.5/.test(html) && !/Backtest v1\.5|Study v1\.1|suite: 'v2\.[56]'/.test(bt + bg));
  check('cache-busters bumped (backtest ?v=7, big movers ?v=3, core unchanged ?v=10)', /crypto-radar-backtest\.js\?v=7"/.test(html) && /crypto-radar-bigmovers\.js\?v=3"/.test(html) && /crypto-radar\.js\?v=10"/.test(html));
  check('old "so that macro series was ignored" wording gone', !/macro series was ignored/.test(bt));
  check('stray backslash in the disclaimer box fixed', !/cr-disclaimer\\"/.test(html) && /class="cr-disclaimer" role="note"/.test(html));
  const cnt = (s, re) => (s.match(re) || []).length, tags = ['details', 'summary', 'section', 'div', 'table', 'select', 'main', 'header', 'nav', 'ul', 'li', 'p', 'h2', 'h3'];
  check('HTML tag balance matches the delivered v1.5 page (no tag added or lost)', tags.every(t => cnt(html, new RegExp('<' + t + '\\b', 'g')) === cnt(htmlOld, new RegExp('<' + t + '\\b', 'g')) && cnt(html, new RegExp('</' + t + '>', 'g')) === cnt(htmlOld, new RegExp('</' + t + '>', 'g'))));
  const idsHtml = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1])), idsJs = new Set([...(bt + bg).matchAll(/(?:btEl|g|getElementById)\('([a-z0-9-]+)'\)/g)].map(m => m[1]));
  check('every element id the scripts use exists in the page', [...idsJs].every(i => idsHtml.has(i)), [...idsJs].filter(i => !idsHtml.has(i)).join(','));
  check('no duplicate ids in the page', (html.match(/\sid="[^"]+"/g) || []).length === idsHtml.size);

  console.log('== B. regression against the delivered v1.5 / v1.1 (same data, same network)');
  {
    const cfg = stdCfg({ paxgAvailable: false, paxgInList: false });   // Luno has no PAXGMYR here, Worker gold fails
    const o = makeEnv(OLD, cfg), n = makeEnv(NEW, cfg);
    const a = await runBT(o, setScore(false)), b = await runBT(n, setScore(false));
    check('B1 both runs finish and score rows', a.json && b.json && a.json.signalsScored > 3000 && a.json.signalsScored === b.json.signalsScored, a.json && b.json && a.json.signalsScored + '/' + b.json.signalsScored);
    const na = strip(a.json), nb = strip(b.json);
    na.notes = na.notes.map(x => x.replace('so that macro series was ignored', 'so that source was skipped'));
    const extra = nb.notes.filter(x => /^gold: Luno PAXGMYR unavailable \(Unknown pair\), so the gold rules are not shown$/.test(x)); nb.notes = nb.notes.filter(x => !extra.includes(x));
    check('B2 gold feed down + no PAXGMYR on Luno: identical to v1.5 apart from the one new honest note', same(na, nb) && extra.length === 1, extra.length + ' extra notes');
    const norm = h => h.replace(/<p class="cr-source-note">gold Worker[^]*?<\/p>/, '').replace(/<p class="cr-source-note">gold: Luno[^]*?<\/p>/, '');
    check('B3 the page text (tables, footer) is identical too, apart from the gold notes', norm(a.out) === norm(b.out) && norm(a.out).length > 3000, norm(a.out).length + ' vs ' + norm(b.out).length);
  }
  {
    const cfg = stdCfg(), o = makeEnv(OLD, cfg), n = makeEnv(NEW, cfg), off = el => { el('bt-score').checked = false; el('bt-m-auto').checked = false; };
    const a = await runBT(o, off), b = await runBT(n, off);
    check('B4 automatic feeds switched off: v1.6 output identical to v1.5 (only version fields differ)', same(strip(a.json), strip(b.json)) && a.json.notes.length === 0);
    check('B5 automatic feeds switched off: no /api/macro call and no extra PAXGMYR fetch', !n.net.calls.some(c => c.startsWith('/api/macro')) && n.net.calls.filter(c => c.includes('pair=PAXGMYR')).length === 4, n.net.calls.filter(c => c.includes('pair=PAXGMYR')).length + ' PAXGMYR calls');
    const old2 = makeEnv(OLD, cfg), new2 = makeEnv(NEW, cfg);
    const x = await runBG(old2), y = await runBG(new2);
    check('B6 big-mover study: identical numbers and tables to v1.1 (only version fields differ)', x.json && same(strip(x.json), strip(y.json)) && x.out === y.out, x.json && x.json.daysScored);
  }
  {   // regression with the radar score switched ON, small data set
    const cfg = stdCfg({ n: 330 }), o = makeEnv(OLD, cfg), n = makeEnv(NEW, cfg), on = el => { el('bt-score').checked = true; el('bt-m-auto').checked = false; el('bt-pairs').value = '5'; };
    const a = await runBT(o, on), b = await runBT(n, on);
    check('B7 radar score on: identical to v1.5', same(strip(a.json), strip(b.json)) && a.json.later40.some(r => r.label === 'Radar score 25+' && r.n > 0));
  }

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

  console.log('== E. big-mover direction verdict (v1.2)');
  {
    const env = makeEnv(NEW, stdCfg()), envOld = makeEnv(OLD, stdCfg());
    const mk = (seed, N, pA, pB, split) => { const r = rng(seed), rows = []; for (let i = 0; i < N; i++) { const u = r(); const g = u < 0.2 ? 'A' : u < 0.4 ? 'B' : 'N', pb = g === 'A' ? pA.big : g === 'B' ? pB.big : 0.02, pd = g === 'A' ? pA.drop : g === 'B' ? pB.drop : 0.03, fw = ((r() + r() + r()) / 3 - 0.5) * 8 + (g === 'A' ? 1 : g === 'B' ? -1 : 0); rows.push({ ts: Date.UTC(2023, 0, 1) + i * DAY, pair: 'X' + (i % 7), big: r() < pb, drop: r() < pd, fwd: fw, f: { brk: g === 'A', vol: false, sqz: false, ran: g === 'B' }, split }); } return rows; };
    const A = { big: 0.16, drop: 0.05 }, B = { big: 0.16, drop: 0.16 }, evalIn = (e, fn, ...a) => vm.runInContext(fn, e.ctx)(...a);
    const later = mk(1, 6000, A, B, 'out'), early = mk(2, 6000, A, B, 'in');
    const st = vm.runInContext('(l, e, H) => [bgStats(l, H), bgStats(e, H)]', env.ctx)(later, early, 7);
    check('E0 setup: both rules pass stage 1 in both halves; A is directional, B is not', st[0].rules[0].beats && st[1].rules[0].beats && st[0].rules[4].beats && st[1].rules[4].beats && st[0].rules[0].dirRatio >= 1.5 && st[1].rules[0].dirRatio >= 1.5 && st[0].rules[4].dirRatio < 1.5 && st[1].rules[4].dirRatio < 1.5, st[0].rules.map(r => [r.beats, r.dirRatio && +r.dirRatio.toFixed(2)].join(':')).join(' '));
    const vNew = evalIn(env, '(l, e, H) => bgDirVerdict(l, e, H)', later, early, 7), vOld = evalIn(envOld, '(l, e, H) => bgDirVerdict(l, e, H)', later, early, 7);
    check('E1 v1.2 names the rule that passed AND the rule that did not', /Direction check passed in BOTH halves: 20-candle breakout\./.test(vNew) && /NOT shown to be bullish[^]*Already up 10%\+ in the last 3 candles: rally lift \/ drop lift = [0-9.]+ \(later\) and [0-9.]+ \(earlier\); median 7-candle return/.test(vNew), vNew);
    check('E2 the passing rule is not listed as failing, and the failing rule is not listed as passing', !/NOT shown[^]*20-candle breakout/.test(vNew) && !/passed in BOTH halves:[^.]*Already up/.test(vNew));
    check('E3 (the bug being fixed) v1.1 printed only the passing rule and hid the failing one', /passed in BOTH halves: 20-candle breakout\./.test(vOld) && !/Already up 10%/.test(vOld), vOld);
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

  console.log('== F. scale (51 coins, 4 macro inputs, score off)');
  {
    const cfg = stdCfg({ n: 1500 }); const extra = []; for (let i = 0; i < 41; i++) extra.push({ pair: 'C' + i + 'MYR', vol: 10 + i, spread: 0.3 + (i % 9) * 0.2, seed: 200 + i });
    cfg.coins.push(...extra); const base = cfg.series; cfg.series = (p, dur) => { const c = extra.find(x => x.pair === p); if (c) { cfg._c = cfg._c || new Map(); const k = p + ':' + dur; if (!cfg._c.has(k)) cfg._c.set(k, genSeries(c.seed, dur === 86400 ? 1500 : 1200, dur * 1000, { edge: 0.03 })); return cfg._c.get(k); } return base(p, dur); };
    const env = makeEnv(NEW, cfg), t0 = Date.now(), r = await runBT(env, setScore(false)), dt = Date.now() - t0;
    check('F1 51 coins x 1,500 days completes with gold from Luno, in a reasonable time', r.json && r.json.coinsTested === 51 && r.json.macroUsed.gold && dt < 60000, 'coins=' + (r.json && r.json.coinsTested) + ' rows=' + (r.json && r.json.signalsScored) + ' ' + dt + 'ms');
    check('F2 the JSON stays small enough to paste', r.json && env.el('bt-json').value.length < 60000, env.el('bt-json').value.length + ' chars');
    console.log('       (rows ' + r.json.signalsScored + ', ' + dt + ' ms, JSON ' + env.el('bt-json').value.length + ' chars, notes ' + r.json.notes.length + ')');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('FAILED: ' + failures.join(' | ')); process.exit(1); }
})().catch(e => { console.log('HARNESS ERROR', e && e.stack || e); process.exit(2); });
