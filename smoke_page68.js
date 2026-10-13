const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const WORKER = 'https://form-scanner-proxy.reysourcez-ent.workers.dev';
const FILES = { '/form-scanner.html': '/home/claude/v68/form-scanner.html', '/form-scanner.js': '/home/claude/v68/form-scanner.js', '/form-scanner-engine.js': '/home/claude/v68/form-scanner-engine.js',
  '/nav-config.js': '/mnt/project/nav-config.js', '/site-config.js': '/mnt/project/site-config.js', '/styles.css': '/mnt/project/styles.css' };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const u = req.url.split('?')[0], f = FILES[u];
  if (u === '/nav-dropdown.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end('/* stub: not part of the uploaded project files */'); }
  if (!f) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); fs.createReadStream(f).pipe(res);
});
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL:', name, extra !== undefined ? String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400) : ''); } };

const SPEC1 = { recognized: true, title: 'BAUCAR BAYARAN', reference_code: 'Lampiran 8', page: { size: 'A4', orientation: 'portrait', font: 'sans', margin_pct: 5, fill_pct: 95 }, frames: [{ from_band: 1, to_band: 3 }],
  bands: [
    { kind: 'cells', height_pct: 20, col_widths_pct: [100], cells: [{ col: 1, height_pct: 100, items: ['T[b,xl,center] BAUCAR BAYARAN', 'T[sm,center] Surau Darul Rahman RPR Batu-6 Miri. 98000'] }] },
    { kind: 'cells', height_pct: 30, col_widths_pct: [55, 45], cells: [{ col: 1, height_pct: 100, items: ['F[box] BAYAR KEPADA', 'F[box] NO. AKUN', 'F[box] NAMA BANK'] }, { col: 2, height_pct: 100, items: ['F[box,w30] NO. BAUCAR', 'C[stack] KAEDAH PEMBAYARAN :: TUNAI ; CEK _ ; E-BANKING'] }] },
    { kind: 'table', height_pct: 30, cells: [], table: { columns: [{ header: 'NO', width_pct: 8, align: 'center' }, { header: 'DUTIRAN BAYARAN', width_pct: 62 }, { header: 'AMOUNT (RM)', width_pct: 30 }], header_fill: '#D9D9D9', blank_rows: 4, numbered: true, total_label: 'JUMLAH (RM)', total_span: 2 } },
  ] };
const LINES = ['BAUCAR BAYARAN', 'Surau Darul Rahman RPR Batu-6 Miri. 98000', 'BAYAR KEPADA', 'NO. AKAUN', 'NAMA BANK', 'NO. BAUCAR', 'KAEDAH PEMBAYARAN', 'TUNAI', 'CEK', 'E-BANKING', 'NO', 'BUTIRAN BAYARAN', 'AMAUN (RM)', 'JUMLAH (RM)'];
const ENGINES = [
  { id: 'gemini', label: 'Gemini', ready: true, needs: 'GEMINI_API_KEY', free: true },
  { id: 'cfqwen', label: 'Qwen3.8-27B · Cloudflare', ready: true, needs: 'a Workers AI binding named AI', free: true },
  { id: 'groq', label: 'Qwen3.8-27B · Groq', ready: true, needs: 'GROQ_API_KEY', free: true },
  { id: 'dots', label: 'Dots3-Note Preview · OpenRouter free', ready: true, needs: 'OPENROUTER_API_KEY', free: true },
  { id: 'qwen', label: 'Qwen3.8-27B · OpenRouter free', ready: false, needs: 'OPENROUTER_API_KEY', free: true },
  { id: 'orfree', label: 'OpenRouter free (auto-pick)', ready: true, needs: 'OPENROUTER_API_KEY', free: true },
  { id: 'mistral', label: 'Mistral Small', ready: false, needs: 'MISTRAL_API_KEY', free: true },
];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(browser, handlers, calls, enginesOverride) {
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) page.errors.push('console: ' + m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.route('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync('/home/claude/.npm-global/lib/node_modules/pdf-lib/dist/pdf-lib.min.js') }));
  await page.route(WORKER + '/**', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = JSON.parse(req.postData() || '{}');
    if (body.mode === 'engines') return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify({ worker: 'v6.8 (mock)', engines: enginesOverride || ENGINES }) });
    calls.push({ provider: body.provider || 'gemini', mode: body.mode || 'structure', imgLen: (body.image || '').length, note: body.note });
    const h = handlers[(body.provider || 'gemini') + (body.mode === 'text' ? ':text' : '')];
    const r = h ? await h(body) : { status: 500, json: { error: 'no mock for ' + body.provider } };
    return route.fulfill({ status: r.status || 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(r.json) });
  });
  return page;
}
const textOf = (page, sel) => page.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel);
async function load(page, file) {
  await page.goto('http://localhost:8123/form-scanner.html');
  await page.waitForFunction(() => document.querySelectorAll('#fs-provider option').length > 2, null, { timeout: 10000 });
  await page.setInputFiles('#fs-photo-input', file);
  await page.waitForFunction(() => !document.getElementById('fs-scan-btn').disabled, null, { timeout: 15000 });
}
const done = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.getElementById('fs-status').textContent), re, { timeout: 30000 });

(async () => {
  await new Promise((r) => server.listen(8123, r));
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const PNG = '/mnt/user-data/uploads/baucar_pic.png';

  // ---------- S1: Auto = Qwen on Cloudflare (structure) + Gemini wording ----------
  {
    const calls = [];
    const page = await newPage(browser, {
      cfqwen: async () => { await sleep(900); return { json: { ...SPEC1, _meta: { provider: 'cfqwen', label: 'Qwen3.8-27B · Cloudflare', model: '@cf/qwen/qwen3.8-27b', ms: 900, usage: { in: 4500, out: 3200, neurons: 1115 }, tries: 1, fallback: '' } } }; },
      'gemini:text': async () => ({ json: { lines: LINES, _meta: { provider: 'gemini', label: 'Gemini · flash-lite-latest', mode: 'text' } } }),
    }, calls);
    await load(page, PNG);
    const opts = await page.$$eval('#fs-provider option', (os) => os.map((o) => o.textContent + (o.disabled ? ' [off]' : '')));
    ok(opts[0].startsWith('Auto') && opts[1].startsWith('Compare all ready engines (5)'), 'S1 select head', opts.slice(0, 3));
    ok(opts.some((o) => o.startsWith('Dots3-Note Preview')) && opts.some((o) => /Qwen3\.8-27B · OpenRouter free: needs OPENROUTER_API_KEY \[off\]/.test(o)), 'S1 select entries', opts);
    ok(/v6\.8/.test(await textOf(page, '.fs-version-badge')), 'S1 badge v6.8');
    ok(/Qwen on Cloudflare first, then Dots3 and Groq, Gemini last/.test(await page.getAttribute('.fs-engine .fs-tip', 'data-tip')), 'S1 engine tooltip updated');
    await page.click('#fs-scan-btn');
    await sleep(350);
    const midStatus = await textOf(page, '#fs-status');
    ok(/Qwen3\.8-27B · Cloudflare/.test(midStatus) && /allow 1 to 3 minutes/.test(midStatus) && /wording is read at the same time/.test(midStatus), 'S1 slow-engine message while running', midStatus);
    await done(page, '^Found ');
    const st = await textOf(page, '#fs-status');
    ok(/Found 3 sections on a A4 portrait page/.test(st) && /3 labels corrected/.test(st), 'S1 final status', st);
    const rows = await page.$$eval('#fs-runlog tr', (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
    ok(rows.length === 3, 'S1 three log rows (wording, structure, merged)', rows);
    ok(rows.some((r) => /about 1,115 neurons \(11% of the free 10,000 a day\)/.test(r) && /4,500 in \/ 3,200 out tokens/.test(r)), 'S1 usage detail under the structure row', rows);
    ok(rows.some((r) => /Qwen3\.8-27B · Cloudflare \+ Gemini wording/.test(r)), 'S1 merged row label', rows);
    const words = await page.$$eval('#fs-wording input', (is) => is.map((i) => i.value));
    ok(words.includes('NO. AKAUN') && words.includes('BUTIRAN BAYARAN') && words.includes('AMAUN (RM)') && !words.includes('NO. AKUN'), 'S1 wording merged into the editor', words);
    ok(calls.filter((c) => c.provider === 'cfqwen').length === 1 && calls.filter((c) => c.provider === 'gemini' && c.mode === 'text').length === 1 && calls.length === 2, 'S1 exactly two Worker calls', calls);
    ok(await page.$eval('#fs-pdf-frame', (f) => !f.hidden && /^blob:/.test(f.src)), 'S1 live PDF preview shown');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#fs-download-btn')]);
    const bytes = fs.readFileSync(await dl.path());
    ok(bytes.slice(0, 5).toString() === '%PDF-', 'S1 download is a PDF');
    fs.writeFileSync('/home/claude/smoke_s1.pdf', bytes);
    let q = ''; try { q = execSync('qpdf --check /home/claude/smoke_s1.pdf 2>&1').toString(); } catch (e) { q = String(e.stdout || e); }
    ok(/No syntax or stream encoding errors found/.test(q), 'S1 qpdf --check clean', q.slice(0, 200));
    ok(page.errors.length === 0, 'S1 no page errors', page.errors);
    await page.context().close();
  }

  // ---------- S2: Qwen/Cloudflare allowance used up -> Auto falls to Dots3 ----------
  {
    const calls = [];
    const page = await newPage(browser, {
      cfqwen: async () => ({ status: 429, json: { error: 'Qwen3.8-27B · Cloudflare: the free daily Workers AI allowance (10,000 neurons) is used up. It resets at 00:00 UTC. Cloudflare said: 4006', code: 'rate_limited' } }),
      dots: async () => { await sleep(300); return { json: { ...SPEC1, _meta: { provider: 'dots', label: 'Dots3-Note Preview · OpenRouter free', model: 'dots-studio/dots-3-note-preview:free', ms: 300, usage: { in: 5100, out: 7400 }, tries: 2, fallback: 'no-reasoning ' } } }; },
      'gemini:text': async () => ({ json: { lines: LINES, _meta: { provider: 'gemini', label: 'Gemini', mode: 'text' } } }),
    }, calls);
    await load(page, PNG);
    await page.click('#fs-scan-btn');
    await done(page, '^Found ');
    const st = await textOf(page, '#fs-status');
    ok(/Qwen3\.8-27B · Cloudflare failed, so Dots3-Note Preview · OpenRouter free made this layout/.test(st), 'S2 fallback sentence', st);
    ok(await page.$eval('#fs-status', (el) => el.classList.contains('is-warn')), 'S2 status is amber');
    const rows = await page.$$eval('#fs-runlog tr', (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
    ok(rows.some((r) => /Failed: Qwen3\.8-27B · Cloudflare: the free daily Workers AI allowance/.test(r)), 'S2 failed Cloudflare row explains why', rows);
    ok(rows.some((r) => /5,100 in \/ 7,400 out tokens · 2 tries · no-reasoning/.test(r)), 'S2 tries + fallback detail for Dots3', rows);
    ok(calls.map((c) => c.provider + ':' + c.mode).join() === 'cfqwen:structure,gemini:text,dots:structure' || calls.map((c) => c.provider + ':' + c.mode).sort().join() === 'cfqwen:structure,dots:structure,gemini:text', 'S2 call sequence', calls.map((c) => c.provider + ':' + c.mode));
    ok(page.errors.length === 0, 'S2 no page errors', page.errors);
    await page.context().close();
  }

  // ---------- S3: Compare all ----------
  {
    const calls = [];
    const meta = (id, label, extra) => ({ provider: id, label, ms: 100, ...extra });
    const page = await newPage(browser, {
      gemini: async () => { await sleep(500); return { json: { ...SPEC1, _meta: meta('gemini', 'Gemini · flash-lite-latest') } }; },
      cfqwen: async () => { await sleep(500); return { json: { ...SPEC1, _meta: meta('cfqwen', 'Qwen3.8-27B · Cloudflare', { usage: { in: 4000, out: 2500, neurons: 892 }, tries: 1 }) } }; },
      groq: async () => { await sleep(500); return { json: { ...SPEC1, _meta: meta('groq', 'Qwen3.8-27B · Groq', { usage: { in: 4400, out: 2900 }, tries: 1 }) } }; },
      dots: async () => { await sleep(700); return { json: { ...SPEC1, _meta: meta('dots', 'Dots3-Note Preview · OpenRouter free', { tries: 1 }) } }; },
      orfree: async () => { await sleep(500); return { status: 502, json: { error: 'OpenRouter has no provider for OpenRouter free (auto-pick) right now.', code: 'no_provider' } }; },
      qwen: async () => ({ status: 404, json: { error: 'Qwen3.8-27B · OpenRouter free: OpenRouter says this model is no longer free', code: 'retired_free' } }),
    }, calls, ENGINES.map((e) => (e.id === 'qwen' ? { ...e, ready: true } : e)));
    await load(page, PNG);
    const opts3 = await page.$$eval('#fs-provider option', (os) => os.map((o) => o.textContent));
    ok(opts3.some((o) => o === 'Compare all ready engines (5)'), 'S3 select counts only the engines Compare all will call (5, not 6)', opts3.slice(0, 3));
    ok(opts3.some((o) => o === 'Qwen3.8-27B · OpenRouter free'), 'S3 retired Qwen is still selectable one at a time', opts3);
    await page.selectOption('#fs-provider', 'all');
    await page.click('#fs-scan-btn');
    await sleep(200);
    ok(/The thinking engines can take 1 to 3 minutes/.test(await textOf(page, '#fs-status')), 'S3 compare-all message', await textOf(page, '#fs-status'));
    await done(page, '^Compared 5 engines');
    const st = await textOf(page, '#fs-status');
    ok(/4 answered, 1 failed/.test(st), 'S3 summary', st);
    ok(calls.length === 5 && new Set(calls.map((c) => c.provider)).size === 5 && calls.every((c) => c.mode === 'structure') && !calls.some((c) => c.provider === 'qwen'), 'S3 one structure call per engine, retired qwen NOT called, no wording merge', calls);
    const rows = await page.$$eval('#fs-runlog tr', (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ').trim()));
    ok(rows.length === 5 && rows.filter((r) => /Failed:/.test(r)).length === 1, 'S3 five rows, one failed', rows);
    ok(rows.some((r) => /about 892 neurons \(9% of the free 10,000 a day\)/.test(r)), 'S3 neuron detail on Cloudflare row', rows);
    const usage = await page.evaluate(() => JSON.parse(localStorage.getItem('fs-usage')).count);
    ok(usage === 2, 'S3 daily cap: 0.5 per ANSWERING engine (4 answered, the failed one is free)', usage);
    ok(page.errors.length === 0, 'S3 no page errors', page.errors);
    await page.context().close();
  }

  // ---------- S4: Groq says "Request too large" -> the page retries once with a smaller picture ----------
  {
    const calls = [];
    let n = 0;
    const page = await newPage(browser, {
      groq: async (b) => (++n === 1
        ? { status: 413, json: { error: 'Qwen3.8-27B · Groq: this request is bigger than the free per-minute allowance (picture + instructions + answer together), so waiting will not help. Qwen3.8-27B · Groq said: Request too large for model `qwen/qwen3.8-27b` on tokens per minute (TPM): Limit 8000, Requested 8412', code: 'image_too_large' } }
        : { json: { ...SPEC1, _meta: { provider: 'groq', label: 'Qwen3.8-27B · Groq', ms: 50, usage: { in: 3000, out: 2000 }, tries: 1 } } }),
    }, calls);
    await load(page, PNG);
    await page.selectOption('#fs-provider', 'groq');
    await page.click('#fs-scan-btn');
    await done(page, '^Found ');
    ok(calls.length === 2 && calls[1].imgLen < calls[0].imgLen * 0.9, 'S4 second call carries a smaller picture', calls.map((c) => c.imgLen));
    ok(!/Failed/.test((await page.$$eval('#fs-runlog tr', (t) => t.map((x) => x.innerText))).join(' ')), 'S4 no failed row (retry hidden inside one attempt)');
    ok(page.errors.length === 0, 'S4 no page errors', page.errors);
    await page.context().close();
  }

  // ---------- S5: the retired Qwen picked on purpose: its explanation still shows ----------
  {
    const calls = [];
    const page = await newPage(browser, { qwen: async () => ({ status: 404, json: { error: 'Qwen3.8-27B · OpenRouter free: OpenRouter says this model is no longer free (it offers the paid id qwen/qwen3.8-27b). Use another engine.', code: 'retired_free' } }) }, calls, ENGINES.map((e) => (e.id === 'qwen' ? { ...e, ready: true } : e)));
    await load(page, PNG);
    await page.selectOption('#fs-provider', 'qwen');
    await page.click('#fs-scan-btn');
    await done(page, 'no longer free');
    ok(calls.length === 1 && calls[0].provider === 'qwen', 'S5 one call to the retired engine', calls);
    ok(await page.$eval('#fs-status', (el) => el.classList.contains('is-error')), 'S5 status is an error');
    ok(page.errors.length === 0, 'S5 no page errors', page.errors);
    await page.context().close();
  }

  await browser.close(); server.close();
  console.log(`\nPAGE SMOKE TESTS (real Chromium, real pdf-lib, Worker mocked): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(2); });
