/* ============================================================
   Scan to Document - reading engine (v0.4, 2026-11-17)
   Wraps Tesseract.js v7 (runs in the browser; the picture is never uploaded). API as documented at
   github.com/naptha/tesseract.js (docs/api.md): createWorker(langs, oem, options), worker.setParameters(), worker.recognize(image, options, output).
   Also holds a mock engine that the automated tests use instead of the real library.
   ============================================================ */
(function (root) {
'use strict';

const VERSION = 'v0.4 (2026-11-17)';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load ' + src + ' (check the internet connection, or the path in ScanToDoc-config_v0.4.js).'));
    document.head.appendChild(s);
  });
}

async function ensureTesseract(assets, log) {
  if (root.Tesseract && root.Tesseract.createWorker) return;
  log && log('info', 'Loading Tesseract.js from ' + assets.tesseractScript);
  await loadScript(assets.tesseractScript);
  if (!root.Tesseract || !root.Tesseract.createWorker) throw new Error('Tesseract.js loaded but did not provide createWorker.');
}

/* opts: { langs: ['eng','msa'], pageMode: '4', dpi: 300, assets, onProgress(msg), log(level, msg) } */
async function createTesseractEngine(opts) {
  await ensureTesseract(opts.assets, opts.log);
  const o = { logger: (m) => { if (opts.onProgress && m) opts.onProgress(m); }, errorHandler: (e) => { opts.log && opts.log('error', 'Tesseract: ' + (e && e.message ? e.message : String(e))); } };
  ['workerPath', 'corePath', 'langPath'].forEach((k) => { if (opts.assets[k]) o[k] = opts.assets[k]; });
  const t0 = Date.now();
  const worker = await root.Tesseract.createWorker(opts.langs.length === 1 ? opts.langs[0] : opts.langs, 1, o);   // 1 = LSTM engine only
  opts.log && opts.log('info', 'Engine ready for ' + opts.langs.join('+') + ' in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
  try {
    await worker.setParameters({ tessedit_pageseg_mode: String(opts.pageMode || '4'), user_defined_dpi: String(opts.dpi || 300), preserve_interword_spaces: '1' });
  } catch (e) {                                                  // an engine version may refuse an extra setting: keep going with the page mode only
    opts.log && opts.log('warn', 'Some engine settings were refused (' + (e && e.message ? e.message : e) + '); using the page mode only.');
    try { await worker.setParameters({ tessedit_pageseg_mode: String(opts.pageMode || '4') }); } catch (e2) { opts.log && opts.log('warn', 'Page mode could not be set either: ' + (e2 && e2.message ? e2.message : e2)); }
  }
  return {
    name: 'Tesseract.js',
    async recognize(image) {
      const res = await worker.recognize(image, {}, { blocks: true });      // since v6 only text is returned unless blocks are asked for
      const d = (res && res.data) || {};
      return { blocks: d.blocks || [], text: d.text || '', confidence: d.confidence };
    },
    async terminate() { try { await worker.terminate(); } catch (e) { /* already gone */ } },
  };
}

/* Mock engine for tests: fixture = { pages: [ { blocks: [...] } ] } in the Tesseract.js blocks shape. Without a fixture it only captures the picture it was given. */
function createMockEngine(mock) {
  return {
    name: 'mock',
    async recognize(image, pageIndex) {
      root.__sdCaptured = root.__sdCaptured || [];
      if (image && image.toDataURL) root.__sdCaptured[pageIndex || 0] = image.toDataURL('image/png');
      const pg = mock && mock.fixture && mock.fixture.pages && mock.fixture.pages[pageIndex || 0];
      return { blocks: pg ? pg.blocks : [], text: '', confidence: 0 };
    },
    async terminate() { /* nothing to free */ },
  };
}

async function createEngine(opts) {
  if (root.__ScanToDocMock) return createMockEngine(root.__ScanToDocMock);   // set only by the automated tests
  return createTesseractEngine(opts);
}

/* self-test: draw a line of text, read it back. Tells the owner which part is missing when something is wrong. */
async function selfTest(opts) {
  const steps = [];
  const step = (ok, msg) => { steps.push({ ok, msg }); opts.log && opts.log(ok ? 'info' : 'error', 'Self-test: ' + msg); };
  let engine = null;
  try {
    const c = document.createElement('canvas');
    c.width = 900; c.height = 160;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000'; g.font = '64px Arial, Helvetica, sans-serif'; g.fillText('Scan test 2026', 30, 100);
    step(true, 'test picture drawn');
    engine = await createEngine({ langs: ['eng'], pageMode: '7', dpi: 300, assets: opts.assets, onProgress: opts.onProgress, log: opts.log });
    step(true, 'engine started (' + engine.name + ')');
    const r = await engine.recognize(c, 0);
    const words = [];
    (r.blocks || []).forEach((b) => (b.paragraphs || []).forEach((p) => (p.lines || []).forEach((l) => (l.words || []).forEach((w) => words.push(w.text)))));
    const joined = words.join(' ');
    step(/2026/.test(joined), 'read back: "' + joined + '"' + (r.blocks && r.blocks.length ? '' : ' (no blocks returned: check the Tesseract.js version)'));
  } catch (e) {
    step(false, String(e && e.message ? e.message : e));
  } finally {
    if (engine) await engine.terminate();
  }
  return steps;
}

const API = { VERSION, createEngine, createTesseractEngine, createMockEngine, selfTest };
root.ScanToDocOcr = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
