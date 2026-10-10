/* Crypto Radar browser smoke test v2.7 (verification tooling, not part of the site). Run: node crypto-radar-browser-smoke.js   (Node 22 + the playwright package + a Chromium it can find; no other packages)
   Serves the SHIPPED files (crypto-radar-backtest.html/.js, crypto-radar-bigmovers.js, crypto-radar.js v2.0) from this folder (or NEWDIR) on a local port, stubs ONLY the Worker's /api/markets, /api/candles and /api/macro
   with seeded synthetic data (the gold feed answers 502 "Binance returned 403" on purpose), opens the backtest page in headless Chromium, clicks Run on the backtest and the big-mover study, and checks versions, the Luno PAXGMYR gold fallback,
   the footer, the verdict line and that nothing throws. Missing site assets (styles.css, nav-dropdown.js) and the Google Fonts stylesheet are expected to fail in a sandbox and are ignored. Not covered: real Luno data, the live Worker. */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); }
const { chromium } = pw;
const ROOT = (process.env.NEWDIR || __dirname + '/').replace(/\/?$/, '/'), DAY = 86400000, W = 'https://crypto-radar-worker.reysourcez-ent.workers.dev';
const lastStart = step => Math.floor(Date.now() / step) * step - step;
function rng(seed) { let s = (Math.imul(seed + 7, 2654435761) >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function genSeries(seed, n, step, o = {}) {
  const r = rng(seed), out = [], cl = [], end = lastStart(step); let price = 100, surge = 0, cool = 0;
  for (let i = 0; i < n; i++) {
    const ts = end - (n - 1 - i) * step; let ret = (r() - 0.5) * 2 * 0.03;
    if (o.edge) { if (surge === 0 && cool === 0 && i >= 22 && cl[i - 1] > Math.max(...cl.slice(i - 21, i - 1)) && r() < 0.6) { surge = 3; cool = 25; } if (surge > 0) { ret += o.edge; surge--; } else if (cool > 0) cool--; }
    const open = price, close = Math.max(0.01, open * (1 + ret)), high = Math.max(open, close) * (1 + r() * 0.01), low = Math.min(open, close) * (1 - r() * 0.01);
    out.push({ timestamp: ts, open, high, low, close, volume: 100 + r() * 100 }); cl.push(close); price = close;
  }
  return out;
}
function goldSeries(n) { const r = rng(99), out = [], end = lastStart(DAY); let prev = 2000; for (let i = 0; i < n; i++) { const close = 2000 * (1 + 0.25 * Math.sin(2 * Math.PI * i / 180)) + (r() - 0.5) * 30, open = prev; out.push({ timestamp: end - (n - 1 - i) * DAY, open, high: Math.max(open, close) * 1.003, low: Math.min(open, close) * 0.997, close, volume: 50 }); prev = close; } return out; }
const COINS = ['XBTMYR', 'ETHMYR', 'XRPMYR', 'SOLMYR', 'ADAMYR', 'LINKMYR', 'DOTMYR', 'LTCMYR', 'AVAXMYR', 'PAXGMYR'];
const cache = new Map();
const seriesOf = pair => { if (!cache.has(pair)) cache.set(pair, pair === 'PAXGMYR' ? goldSeries(700) : genSeries(COINS.indexOf(pair) + 1, 900, DAY, { edge: 0.03 })); return cache.get(pair); };
const dxy = (() => { const r = rng(5), b = []; let v = 100; for (let d = Date.UTC(2014, 11, 31); d <= lastStart(DAY); d += DAY) { v *= 1 + (r() - 0.5) * 0.006; b.push([d, +v.toFixed(4)]); } return b; })();
const calls = [];
function stub(url) {
  const u = new URL(url), p = u.pathname, q = Object.fromEntries(u.searchParams); calls.push(p + '?' + u.searchParams.toString());
  if (p === '/api/markets') return [200, { markets: COINS.map((c, i) => { const s = seriesOf(c), last = s[s.length - 1].close; return { pair: c, bid: String(last * 0.999), ask: String(last * 1.001), last_trade: String(last), rolling_24_hour_volume: String(900 - i * 50), status: 'ACTIVE' }; }) }];
  if (p === '/api/candles') { const s = seriesOf(q.pair); return [200, { candles: s.filter(x => x.timestamp >= +q.since).slice(0, 1000).map(x => ({ timestamp: x.timestamp, open: String(x.open), high: String(x.high), low: String(x.low), close: String(x.close), volume: String(x.volume) })) }]; }
  if (p === '/api/macro') return q.series === 'dxy' ? [200, { series: 'dxy', source: 'stub dollar index', bars: dxy }] : [502, { error: 'gold: Binance returned 403' }];
  return [404, { error: 'Unknown endpoint' }];
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css' };
const server = http.createServer((req, res) => { const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '')); if (f.startsWith(ROOT) && fs.existsSync(f) && fs.statSync(f).isFile()) { res.writeHead(200, { 'content-type': mime[path.extname(f)] || 'text/plain' }); res.end(fs.readFileSync(f)); } else { res.writeHead(404); res.end('nope'); } });
let ok = 0, bad = 0; const t = (name, cond, d) => { if (cond) { ok++; console.log('  ok   ' + name); } else { bad++; console.log('  FAIL ' + name + (d !== undefined ? '  -> ' + d : '')); } };
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
  const browser = await chromium.launch(); const page = await browser.newPage();
  const errs = [], failed = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  page.on('requestfailed', r => failed.push(r.url()));
  await page.route(W + '/**', async route => { const [status, body] = stub(route.request().url()); await route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) }); });
  await page.goto(`http://127.0.0.1:${port}/crypto-radar-backtest.html`, { waitUntil: 'load' });
  t('title carries v1.6 + v1.2', (await page.title()).includes('Backtest v1.6 + Big Movers v1.2'), await page.title());
  t('eyebrow shows suite v2.7', (await page.textContent('.eyebrow')).includes('suite v2.7'));
  t('disclaimer box now has its real class', await page.locator('div.cr-disclaimer').count() === 1);
  await page.uncheck('#bt-score');
  const t0 = Date.now(); await page.click('#bt-run');
  await page.waitForFunction(() => /^(Done|Backtest failed)/.test(document.getElementById('bt-status').textContent), null, { timeout: 240000 });
  const st = await page.textContent('#bt-status'); console.log('  backtest status:', st, `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  t('backtest finished with Done', st.startsWith('Done'), st);
  const bj = JSON.parse(await page.inputValue('#bt-json'));
  t('backtest JSON says suite v2.7 / backtest v1.6', bj.suite === 'v2.7' && bj.backtest === 'v1.6');
  t('dollar index read from the (stub) Worker', bj.macroUsed && bj.macroUsed.dxy && /Worker/.test(bj.macroUsed.dxy.source));
  t('gold came from Luno PAXGMYR after the Worker said 403', bj.macroUsed && bj.macroUsed.gold && /Luno PAXGMYR/.test(bj.macroUsed.gold.source), JSON.stringify(bj.macroUsed));
  t('the failed Worker gold feed is reported as skipped', (bj.notes || []).some(n => /gold Worker feed: .*so that source was skipped/.test(n)), JSON.stringify(bj.notes));
  t('gold rules appear in the later-40% table', (bj.later40 || []).some(r => /^Gold rising/.test(r.label)));
  const foot = await page.textContent('#bt-out'); t('page footer lists the macro series read, gold from Luno', /Macro series read:.*gold .*Luno PAXGMYR/.test(foot));
  t('a verdict sentence is shown', (await page.textContent('#bt-verdict')).length > 20, await page.textContent('#bt-verdict'));
  await page.click('#bg-run');
  await page.waitForFunction(() => /^(Done|Big-mover study failed|Failed)/.test(document.getElementById('bg-status').textContent) || /fail/i.test(document.getElementById('bg-status').textContent), null, { timeout: 240000 });
  const gs = await page.textContent('#bg-status'); console.log('  big-mover status:', gs);
  t('big-mover study finished with Done', gs.startsWith('Done'), gs);
  const gj = JSON.parse(await page.inputValue('#bg-json')); t('big-mover JSON says suite v2.7 / v1.2', gj.suite === 'v2.7' && gj.bigMovers === 'v1.2');
  console.log('  big-mover verdict:', (await page.textContent('#bg-verdict')).slice(0, 400));
  const expected = e => /styles\.css|nav-dropdown\.js|favicon|status of 404|status of 502|ERR_TUNNEL_CONNECTION_FAILED/.test(e);   // 404 = site assets not in this folder; 502 = the stub's deliberate gold 403; TUNNEL = sandbox proxy refusing an outside font host
  const unexpected = errs.filter(e => !expected(e)); t('no page errors or unexpected console errors', unexpected.length === 0, JSON.stringify(unexpected));
  console.log('  externally failed requests:', JSON.stringify(failed.filter(u => !u.includes('127.0.0.1'))));
  console.log('  (expected noise ignored:', errs.length - unexpected.length, '; failed requests:', failed.filter(u => !u.includes('127.0.0.1')).length, ')');
  console.log('  Worker calls seen:', calls.length, '| macro calls:', calls.filter(c => c.startsWith('/api/macro')).join(', '));
  await browser.close(); server.close();
  console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error('SMOKE TEST CRASHED:', e); process.exit(2); });
