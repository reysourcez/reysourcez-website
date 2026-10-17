/* Crypto Radar browser smoke test v2.8 (verification tooling, not part of the site). Run: node crypto-radar-browser-smoke.js   (Node 22 + the playwright package + a Chromium it can find; no other packages)
   Serves the SHIPPED files (crypto-radar-backtest.html/.js, crypto-radar-bigmovers.js, crypto-radar-relations.js, crypto-radar.js v2.0) from this folder (or NEWDIR) on a local port, stubs ONLY the Worker's /api/markets, /api/candles and /api/macro
   with seeded synthetic data (the gold feed answers 502 "Binance returned 403" on purpose), opens the backtest page in headless Chromium, clicks Run on the backtest and the big-mover study, and checks versions, the Luno PAXGMYR gold fallback,
   the footer, the verdict line and that nothing throws. v2.8: then loads two FRED-style stock files through the page's REAL file boxes, runs the Relationship study (headline table, verdict, JSON, the 00:00 UTC candle check) and runs it a second time with a broken Nasdaq file. Missing site assets (styles.css, nav-dropdown.js) and the Google Fonts stylesheet are expected to fail in a sandbox and are ignored. Not covered: real Luno data, the live Worker. */
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
const COINS = ['XBTMYR', 'ETHMYR', 'XRPMYR', 'SOLMYR', 'ADAMYR', 'LINKMYR', 'DOTMYR', 'LTCMYR', 'AVAXMYR', 'PAXGMYR', 'DOGEMYR', 'POLMYR', 'UNIMYR', 'ATOMMYR'];   // v2.8: 12 alts (the relationship study needs at least 10 coins priced on the same day); the new ones are appended so the older coins keep their seeds
const cache = new Map();
const seriesOf = pair => { if (!cache.has(pair)) cache.set(pair, pair === 'PAXGMYR' ? goldSeries(700) : genSeries(COINS.indexOf(pair) + 1, 900, DAY, { edge: 0.03 })); return cache.get(pair); };
const dxy = (() => { const r = rng(5), b = []; let v = 100; for (let d = Date.UTC(2014, 11, 31); d <= lastStart(DAY); d += DAY) { v *= 1 + (r() - 0.5) * 0.006; b.push([d, +v.toFixed(4)]); } return b; })();
// v2.8: a FRED-style daily index file. Weekdays only, "." on about 3% of them (closed days), values partly follow Bitcoin so there is something to find.
// dateHeader 'observation_date' is the current FRED header, 'DATE' the older one: the page must read both.
function stockCsv(seed, series, dateHeader) {
  const r = rng(seed), cl = new Map(seriesOf('XBTMYR').map(c => [Math.floor(c.timestamp / DAY) * DAY, c.close])), end = lastStart(DAY), lines = [dateHeader + ',' + series]; let v = 5000;
  for (let d = end - 800 * DAY; d <= end; d += DAY) {
    const dow = new Date(d).getUTCDay(); if (dow === 0 || dow === 6) continue;
    const c1 = cl.get(d), c0 = cl.get(d - DAY), br = c1 > 0 && c0 > 0 ? Math.log(c1 / c0) : 0;
    v *= Math.exp(0.3 * br + (r() - 0.5) * 0.02);
    lines.push(new Date(d).toISOString().slice(0, 10) + ',' + (r() < 0.03 ? '.' : v.toFixed(2)));
  }
  return lines.join('\n') + '\n';
}
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
  t('title carries v1.6 + v1.2 + Relationships v1.0', (await page.title()).includes('Backtest v1.6 + Big Movers v1.2 + Relationships v1.0'), await page.title());
  t('eyebrow shows suite v2.8', (await page.textContent('.eyebrow')).includes('suite v2.8'), await page.textContent('.eyebrow'));
  t('disclaimer box now has its real class', await page.locator('div.cr-disclaimer').count() === 1);
  await page.uncheck('#bt-score');
  const t0 = Date.now(); await page.click('#bt-run');
  await page.waitForFunction(() => /^(Done|Backtest failed)/.test(document.getElementById('bt-status').textContent), null, { timeout: 240000 });
  const st = await page.textContent('#bt-status'); console.log('  backtest status:', st, `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  t('backtest finished with Done', st.startsWith('Done'), st);
  const bj = JSON.parse(await page.inputValue('#bt-json'));
  t('backtest JSON says suite v2.7 / backtest v1.6 (that script is unchanged in suite v2.8)', bj.suite === 'v2.7' && bj.backtest === 'v1.6');
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
  const gj = JSON.parse(await page.inputValue('#bg-json')); t('big-mover JSON says suite v2.7 / v1.2 (that script is unchanged in suite v2.8)', gj.suite === 'v2.7' && gj.bigMovers === 'v1.2');
  console.log('  big-mover verdict:', (await page.textContent('#bg-verdict')).slice(0, 400));
  // ---- v2.8: Relationship study, through the page's real file boxes and the browser's real File API
  t('relationship section is on the page: two file boxes, a coin selector and a Run button', await page.locator('#rel-nasdaq').count() === 1 && await page.locator('#rel-sp500').count() === 1 && await page.locator('#rel-pairs').count() === 1 && await page.locator('#rel-run').count() === 1);
  await page.setInputFiles('#rel-nasdaq', { name: 'NASDAQCOM.csv', mimeType: 'text/csv', buffer: Buffer.from(stockCsv(11, 'NASDAQCOM', 'observation_date')) });
  await page.setInputFiles('#rel-sp500', { name: 'SP500.csv', mimeType: 'text/csv', buffer: Buffer.from(stockCsv(12, 'SP500', 'DATE')) });
  const r0 = Date.now(); await page.click('#rel-run');
  await page.waitForFunction(() => /^(Done|Study failed|Needs a live Worker)/.test(document.getElementById('rel-status').textContent), null, { timeout: 240000 });
  const rs = await page.textContent('#rel-status'); console.log('  relationship status:', rs, `(${((Date.now() - r0) / 1000).toFixed(1)} s)`);
  t('relationship study finished: Done, 5 of 5 comparisons', /^Done: 5 of 5 comparisons/.test(rs), rs);
  const rj = JSON.parse(await page.inputValue('#rel-json'));
  t('relationship JSON says suite v2.8 / relations v1.0 and holds five comparisons', rj.suite === 'v2.8' && rj.relations === 'v1.0' && Array.isArray(rj.pairs) && rj.pairs.length === 5, JSON.stringify([rj.suite, rj.relations, (rj.pairs || []).length]));
  t('both stock files were read through the real file boxes (name and day count in the JSON)', !!(rj.files && rj.files.nasdaq && rj.files.sp500) && rj.files.nasdaq.name === 'NASDAQCOM.csv' && rj.files.sp500.name === 'SP500.csv' && rj.files.nasdaq.rows > 400 && rj.files.sp500.rows > 400, JSON.stringify(rj.files));
  t('the alt basket used all 12 alts; Bitcoin and the gold token were left out', rj.altsUsed === 12 && (rj.leftOut || []).some(x => /PAXGMYR/.test(x)), JSON.stringify([rj.altsUsed, rj.leftOut]));
  t('Luno daily candles start at 00:00 UTC in this data: the page says so and prints no timing warning', !!rj.candleStart && rj.candleStart.utc === '00:00' && rj.candleStart.share === 1 && !/Warning/.test(await page.textContent('#rel-verdict')) && !(rj.notes || []).some(n => /do not all start/.test(n)), JSON.stringify(rj.candleStart));
  t('the headline table has 11 judged rows', await page.locator('#rel-out > table').first().locator('tbody tr').count() === 11, String(await page.locator('#rel-out > table').first().locator('tbody tr').count()));
  const hrows = (await page.locator('#rel-out > table').first().locator('tbody tr').allInnerTexts()).map(x => x.replace(/\s+/g, ' ').trim());
  t('the planted Bitcoin-to-stock link is found for both indexes, same window: "together", clear in both halves', ['Nasdaq Composite', 'S&P 500'].every(ix => hrows.some(x => x.startsWith('Bitcoin vs ' + ix) && / same window /.test(x) && /together \((moderate|strong)\), clear in both halves$/.test(x))), JSON.stringify(hrows.filter(x => /^Bitcoin vs/.test(x))));
  t('the independent alt coins show no clear link in any of the 7 alt rows (nothing was planted there)', hrows.filter(x => /^Alt basket/.test(x)).length === 7 && hrows.filter(x => /^Alt basket/.test(x)).every(x => /no clear link$/.test(x)), JSON.stringify(hrows.filter(x => /^Alt basket/.test(x))));
  t('each comparison has an every-lag table and the rolling table is shown', await page.locator('#rel-out details').count() === 5 && /Does it hold over time/.test(await page.textContent('#rel-out')));
  const rv = await page.textContent('#rel-verdict'); console.log('  relationship verdict:', rv);
  t('the verdict names Bitcoin, the Nasdaq and the S&P 500 and says it is not a forecast', /Bitcoin/.test(rv) && /Nasdaq/.test(rv) && /S&P 500/.test(rv) && /not a forecast/.test(rv), rv);
  t('no "undefined" or "NaN" anywhere in the results or the verdict', !/undefined|NaN/.test((await page.textContent('#rel-out')) + ' ' + rv));
  // second run: a file that is not a price file in the Nasdaq box -> an honest note, the Nasdaq rows skipped, the S&P 500 and Bitcoin rows still run
  await page.setInputFiles('#rel-nasdaq', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('this is not a price file\nsecond line of nothing\n') });
  await page.click('#rel-run');   // the click handler clears #rel-out before its first await, so waiting for the file name to show up below cannot read the first run's text
  await page.waitForFunction(() => /^(Done|Study failed)/.test(document.getElementById('rel-status').textContent) && /notes\.txt/.test(document.getElementById('rel-out').textContent), null, { timeout: 240000 });
  const rs2 = await page.textContent('#rel-status'), out2 = await page.textContent('#rel-out');
  t('a broken Nasdaq file is named in the notes and its rows are skipped', /notes\.txt: .*rows were skipped/.test(out2), out2.slice(-400));
  t('the S&P 500 and Bitcoin comparisons still ran: Done, 3 of 5', /^Done: 3 of 5 comparisons/.test(rs2), rs2);
  const expected = e => /styles\.css|nav-dropdown\.js|favicon|status of 404|status of 502|ERR_TUNNEL_CONNECTION_FAILED/.test(e);   // 404 = site assets not in this folder; 502 = the stub's deliberate gold 403; TUNNEL = sandbox proxy refusing an outside font host
  const unexpected = errs.filter(e => !expected(e)); t('no page errors or unexpected console errors', unexpected.length === 0, JSON.stringify(unexpected));
  console.log('  externally failed requests:', JSON.stringify(failed.filter(u => !u.includes('127.0.0.1'))));
  console.log('  (expected noise ignored:', errs.length - unexpected.length, '; failed requests:', failed.filter(u => !u.includes('127.0.0.1')).length, ')');
  console.log('  Worker calls seen:', calls.length, '| macro calls:', calls.filter(c => c.startsWith('/api/macro')).join(', '));
  await browser.close(); server.close();
  console.log(`\n${ok} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error('SMOKE TEST CRASHED:', e); process.exit(2); });
