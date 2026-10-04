/* ============================================================
   Form Scanner — page wiring
   Version: v6.3 (2026-10-03) — Qwen structure + Gemini wording, measured page geometry, small images enlarged
   Vanilla JS, loaded after form-scanner-engine.js (the layout/PDF-building
   logic, see that file) and pdf-lib (CDN script tag in form-scanner.html).
   This file only does DOM + the one Worker call: file selection, calling
   the Worker proxy, rendering the detected-structure preview, and wiring
   the download button to FormScannerEngine.buildFillablePdf(). Nothing
   about the photo/PDF or the finished PDF is ever sent anywhere except
   that one Worker call — same "nothing saved on our side" rule as every
   other tool here.
   ============================================================ */

console.info('[Form Scanner] page build: v6.3 (2026-10-03)');

const E = window.FormScannerEngine;
const CFG = E.FS_CONFIG;

/* ================= small DOM helpers ================= */
function $(id) { return document.getElementById(id); }
function setStatus(text, level) {
  const el = $('fs-status');
  el.textContent = text || '';
  el.classList.toggle('is-error', level === 'error');
  el.classList.toggle('is-warn', level === 'warn');
}
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

/* ================= soft usage cap (localStorage, same pattern as this site's other AI tools) ================= */
function getUsageToday() {
  try {
    const raw = JSON.parse(localStorage.getItem(CFG.USAGE_KEY) || 'null');
    if (!raw || raw.day !== new Date().toDateString()) return 0;
    return raw.count;
  } catch (e) { return 0; }
}
function recordUsage(cost) {
  try { localStorage.setItem(CFG.USAGE_KEY, JSON.stringify({ day: new Date().toDateString(), count: getUsageToday() + cost })); }
  catch (e) { /* private browsing etc. — soft cap only, fine to skip */ }
}

/* ================= file selection (single source of truth) =================
   selId guards against a late-resolving async read (PDF metadata, image
   resize) touching the DOM after a *different* file has since been chosen
   — the old bug this replaces (per FORM_SCANNER_HANDOFF.md) was leaving
   the previous file's name/description showing after switching sources. */
let selId = 0;
let current = null; // { kind: 'image'|'pdf', base64, mimeType, src: {kind,width,height} }

function resetFileCard() {
  $('fs-preview-img').hidden = true;
  $('fs-pdf-card').hidden = true;
  $('fs-upload-zone').classList.remove('has-file');
}

function showImageCard(dataUrl) {
  resetFileCard();
  const img = $('fs-preview-img');
  img.src = dataUrl;
  img.hidden = false;
  $('fs-upload-zone').classList.add('has-file');
}

function showPdfCard(name, metaText) {
  resetFileCard();
  $('fs-pdf-card-name').textContent = name;
  $('fs-pdf-card-meta').textContent = metaText;
  $('fs-pdf-card').hidden = false;
  $('fs-upload-zone').classList.add('has-file');
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.onload = () => resolve(r.result);
    r.readAsDataURL(file);
  });
}

function resizeImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error("Couldn't open that image. Try a different file."));
    img.onload = () => {
      let { width, height } = img;
      const longEdge = Math.max(width, height);
      if (longEdge > CFG.MAX_IMAGE_EDGE || longEdge < CFG.MIN_IMAGE_EDGE) {   // shrink big photos, enlarge small screenshots: text-reading models need pixels
        const scale = (longEdge > CFG.MAX_IMAGE_EDGE ? CFG.MAX_IMAGE_EDGE : CFG.MIN_IMAGE_EDGE) / longEdge;
        width = Math.round(width * scale); height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);   // transparent PNGs would turn black as JPEG
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, width, height);
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', CFG.JPEG_QUALITY), width, height, content: E.measureContent(ctx.getImageData(0, 0, width, height).data, width, height) });
    };
    img.src = dataUrl;
  });
}

const MM = 72 / 25.4;
function fmtMM(pt) { return Math.round(pt / MM); }

async function readPdfMeta(bytes) {
  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const n = doc.getPageCount();
  const first = n > 0 ? doc.getPage(0) : null;
  const size = first ? first.getSize() : null;
  return { pages: n, width: size ? size.width : 0, height: size ? size.height : 0 };
}

/* ================= PDF page -> image (pdf.js 3.11.174 UMD from cdnjs, loaded only when a PDF is chosen) =================
   Lets Qwen (images only) read PDFs, and gives the upload card a real page thumbnail. Gemini still gets the original PDF. */
const PDFJS_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
let pdfjsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsPromise) pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDFJS_BASE + 'pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.js'; resolve(window.pdfjsLib); };
    s.onerror = () => { pdfjsPromise = null; reject(new Error('Could not load the PDF page renderer.')); };
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}
async function rasterisePdfPage1(bytes) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: bytes.slice(0) }).promise;
  const pg = await pdf.getPage(1);
  const v1 = pg.getViewport({ scale: 1 });
  const vp = pg.getViewport({ scale: CFG.MAX_IMAGE_EDGE / Math.max(v1.width, v1.height) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  const dataUrl = canvas.toDataURL('image/jpeg', CFG.JPEG_QUALITY);
  const content = E.measureContent(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
  pdf.destroy();
  return { dataUrl, content };
}

async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  const mySel = ++selId;
  setStatus('Reading file\u2026');
  $('fs-scan-btn').disabled = true;
  current = null;
  try {
    if (file.size > CFG.MAX_FILE_MB * 1024 * 1024) throw new Error(`That file is over ${CFG.MAX_FILE_MB} MB. Try a smaller one.`);
    const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name || '');
    const dataUrl = await fileToDataURL(file);
    if (mySel !== selId) return; // a newer file was chosen while this was reading

    if (isPdf) {
      const base64 = dataUrl.split(',')[1];
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      let meta = null, metaErr = '';
      try { meta = await readPdfMeta(bytes); } catch (err) { metaErr = 'Could not read this PDF\u2019s page size \u2014 it may be scanned, encrypted, or damaged.'; }
      if (mySel !== selId) return;
      if (!meta || meta.pages === 0) throw new Error(metaErr || 'That PDF has no pages to scan.');
      const wide = meta.width > meta.height;
      const label = `${meta.pages} page${meta.pages === 1 ? '' : 's'} \u00b7 ${fmtMM(Math.min(meta.width, meta.height))} \u00d7 ${fmtMM(Math.max(meta.width, meta.height))} mm ${wide ? 'landscape' : 'portrait'}`;
      showPdfCard(file.name, label);
      current = { kind: 'pdf', base64, mimeType: 'application/pdf', src: { kind: 'pdf', width: meta.width, height: meta.height }, raster: null };
      rasterisePdfPage1(bytes).then(({ dataUrl: du, content }) => {
        if (mySel !== selId || !current) return;
        current.raster = du.split(',')[1];
        current.src.content = content;
        showImageCard(du);
        setStatus(`PDF ready (${label}) \u2014 page 1 rendered, so Qwen and Gemini can both read it.${meta.pages > 1 ? ' Only page 1 is read.' : ''} Add a note if it helps, then scan.`);
      }).catch(() => { if (mySel === selId) setStatus(`PDF ready (${label}) \u2014 its page could not be rendered as an image, so only Gemini can read this one.`, 'warn'); });
      setStatus(meta.pages > 1 ? 'This tool reads page 1 only \u2014 add a note above if a different page matters, then scan.' : 'PDF ready \u2014 add a note if it helps, then scan.', meta.pages > 1 ? 'warn' : null);
    } else {
      if (!/^image\//.test(file.type)) throw new Error("That file doesn't look like an image or a PDF.");
      const { dataUrl: resized, width, height, content } = await resizeImage(dataUrl);
      if (mySel !== selId) return;
      showImageCard(resized);
      current = { kind: 'image', base64: resized.split(',')[1], mimeType: 'image/jpeg', src: { kind: 'image', width, height, content } };
      setStatus('Photo ready \u2014 add a note if it helps, then scan.');
    }
    $('fs-scan-btn').disabled = false;
  } catch (err) {
    if (mySel !== selId) return;
    resetFileCard();
    setStatus(err.message || 'Could not read that file.', 'error');
  }
}

/* ================= Worker call ================= */
async function scanForm(payload) {
  let response;
  try {
    response = await fetch(CFG.PROXY_ENDPOINT, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error('Could not reach the scanning service \u2014 check your connection and try again.');
  }
  let data;
  try { data = await response.json(); }
  catch (e) { throw new Error('Got an unreadable response from the scanning service. Try again.'); }
  if (!response.ok) throw new Error(data.error || ('Scan failed (error ' + response.status + '). Try again.'));
  return data;
}

/* ================= results preview (mirrors the exact spec the PDF is built from) ================= */
let lastSpec = null, lastPage = null;

function describeItem(it) {
  if (it.kind === 'SP' || it.kind === 'HR') return it.kind === 'HR' ? '<div class="fs-item is-hr"></div>' : '';
  if (it.kind === 'T') return `<div class="fs-item is-t">${escapeHTML(it.text)}</div>`;
  if (it.kind === 'F') {
    const label = it.text ? escapeHTML(it.text) + ' ' : '';
    const blank = it.blank === 'box' ? '[ \u00a0\u00a0\u00a0\u00a0 ]' : it.blank === 'none' ? '' : '_______';
    return `<div class="fs-item">${label}<span class="fs-item-blank">${blank}${it.tall ? ' (multi-line)' : ''}</span></div>`;
  }
  if (it.kind === 'C') {
    const label = it.text ? escapeHTML(it.text) + ':\u00a0 ' : '';
    const opts = it.options.map((o) => `\u2610 ${escapeHTML(o.label)}${o.blank ? ' ___' : ''}`).join('\u00a0\u00a0');
    return `<div class="fs-item">${label}${opts}</div>`;
  }
  return '';
}

function renderCellsBand(band) {
  const cols = band.colWidths.map(() => []);
  band.cells.forEach((cell) => cols[cell.col].push(cell));
  const colHtml = cols.map((cells) => {
    const items = [];
    cells.forEach((cell, i) => {
      if (i > 0 && cell.items.length) items.push('<div class="fs-item is-hr"></div>');
      cell.items.forEach((it) => { const h = describeItem(it); if (h) items.push(h); });
    });
    return `<div class="fs-band-col-items">${items.join('') || '<div class="fs-item is-t">(blank space)</div>'}</div>`;
  });
  const cols_css = band.colWidths.map((f) => Math.max(f, 0.06) + 'fr').join(' ');
  return `<div class="fs-band-cols" style="grid-template-columns:${cols_css}">${colHtml.join('')}</div>`;
}

function renderTableBand(band) {
  const t = band.table;
  const cols = t.columns.map((c) => escapeHTML(c.header)).join(' \u00b7 ');
  const rowNote = t.blankRows ? `${t.blankRows} blank row${t.blankRows === 1 ? '' : 's'}` : (t.rows.length ? `${t.rows.length} printed row${t.rows.length === 1 ? '' : 's'}` : 'reference table');
  return `<div class="fs-table-meta"><strong>${cols}</strong><br><span class="fs-table-rowcount">${rowNote}</span>${t.totalLabel ? ' \u00b7 ' + escapeHTML(t.totalLabel) + ' row' : ''}</div>`;
}

function renderPreview(spec, page) {
  $('fs-preview-title').textContent = spec.title || 'Untitled form';
  $('fs-preview-ref').textContent = spec.referenceCode || '';
  const originText = page.origin === 'your note' ? 'set from your note' : page.origin === 'your PDF' ? 'read from your PDF' : 'estimated from the photo';
  $('fs-preview-page').textContent = `${page.label} \u2014 ${originText}`;

  $('fs-bands').innerHTML = spec.bands.map((b) => `<div class="fs-band">${b.kind === 'table' ? renderTableBand(b) : renderCellsBand(b)}</div>`).join('');

  const warnEl = $('fs-warn-list');
  if (spec.warnings.length) {
    warnEl.innerHTML = spec.warnings.map((w) => `<li>${escapeHTML(w)}</li>`).join('');
    warnEl.hidden = false;
  } else warnEl.hidden = true;

  renderWordingEditor(spec);
  refreshPdfPreview(spec, page);
  $('fs-results-placeholder').hidden = true;
  $('fs-results-section').hidden = false;
  if (window.matchMedia && !window.matchMedia('(min-width: 801px)').matches) {
    $('fs-results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/* ================= wording editor: every printed label, editable; the PDF preview follows ================= */
let wordingSlots = [], editTimer = null;
function renderWordingEditor(spec) {
  wordingSlots = E.textSlots(spec);
  const unc = new Map((spec.unconfirmed || []).map((u) => [E.normTxt(u.text), u]));
  let unsure = 0;
  $('fs-wording').innerHTML = wordingSlots.map((s, i) => {
    const val = String(s.obj[s.key]), u = unc.get(E.normTxt(val.replace(/\s*:\s*$/, '')));
    if (u) unsure++;
    const field = val.includes('\n') ? `<textarea rows="2" data-slot="${i}">${escapeHTML(val)}</textarea>` : `<input type="text" data-slot="${i}" value="${escapeHTML(val)}">`;
    const sug = u && u.suggest ? `<button type="button" class="fs-runlog-btn" data-use="${i}" data-val="${escapeHTML(u.suggest)}">use \u201c${escapeHTML(u.suggest)}\u201d</button>` : '';
    return `<div class="fs-wrow${u ? ' is-unsure' : ''}"><span class="fs-wband">${s.band ? 'Section ' + s.band : (s.key === 'referenceCode' ? 'Ref. code' : 'Title')}</span>${field}${sug}</div>`;
  }).join('');
  $('fs-wording-count').textContent = unsure ? ` \u2014 ${unsure} to check` : '';
}
function updateUnsureCount() {
  const n = document.querySelectorAll('#fs-wording .is-unsure').length;
  $('fs-wording-count').textContent = n ? ` \u2014 ${n} to check` : '';
}
function queuePreviewRefresh() { clearTimeout(editTimer); editTimer = setTimeout(() => { if (lastSpec) refreshPdfPreview(lastSpec, lastPage); }, 400); }
function onWordingEdit(e) {
  const t = e.target.closest('[data-slot]');
  const s = t && wordingSlots[+t.dataset.slot];
  if (!s) return;
  s.obj[s.key] = E.cleanText(t.value, 400);      // same cleaner as scanned text: standard PDF fonts are Latin-only
  t.closest('.fs-wrow').classList.remove('is-unsure'); updateUnsureCount();
  queuePreviewRefresh();
}
function onWordingClick(e) {
  const b = e.target.closest('[data-use]');
  const s = b && wordingSlots[+b.dataset.use];
  if (!s) return;
  const val = b.dataset.val + ((String(s.obj[s.key]).match(/\s*:\s*$/) || [''])[0]);
  s.obj[s.key] = val;
  const inp = document.querySelector(`[data-slot="${b.dataset.use}"]`);
  if (inp) { inp.value = val; inp.closest('.fs-wrow').classList.remove('is-unsure'); }
  b.remove(); updateUnsureCount();
  queuePreviewRefresh();
}

/* ================= live PDF preview (the browser's own PDF viewer, so placement problems are visible at once) ================= */
let pvUrl = null, pvSeq = 0;
async function refreshPdfPreview(spec, page) {
  const my = ++pvSeq;
  try {
    const res = await E.buildFillablePdf(PDFLib, spec, page, { shade: $('fs-shade').checked });
    if (my !== pvSeq) return;
    if (pvUrl) URL.revokeObjectURL(pvUrl);
    pvUrl = URL.createObjectURL(new Blob([res.bytes], { type: 'application/pdf' }));
    const fr = $('fs-pdf-frame');
    fr.src = pvUrl + '#toolbar=0&navpanes=0&view=Fit';
    fr.hidden = false;
  } catch (err) { $('fs-pdf-frame').hidden = true; }
}

/* ================= scan flow ================= */
const ENGINE_LABEL = { qwen: 'Qwen', gemini: 'Gemini' };
const countItems = (spec) => spec.bands.reduce((a, b) => a + (b.kind === 'table' ? 1 : b.cells.reduce((n, c) => n + c.items.filter((it) => it.kind === 'F' || it.kind === 'C').length, 0)), 0);

// Wording read: Gemini transcribes every printed text item (cheap, fast). Never throws: returns { lines } or { error }.
async function wordingRead(precise) {
  const t0 = performance.now();
  if (getUsageToday() + CFG.TEXT_COST > CFG.MAX_SCANS_PER_DAY) return { error: 'daily limit reached', secs: 0 };
  try {
    const data = await scanForm({ image: current.base64, mime_type: current.mimeType, mode: 'text', tier: precise ? 'precise' : 'fast', provider: 'gemini' });
    recordUsage(CFG.TEXT_COST);
    const secs = (performance.now() - t0) / 1000, lines = data.lines || [];
    logRun({ label: ((data._meta && data._meta.model) || 'gemini') + ' (wording)', secs, info: `${lines.length} text lines read` });
    return { lines, secs };
  } catch (err) {
    const secs = (performance.now() - t0) / 1000;
    logRun({ label: 'Gemini (wording)', secs, error: err.message || 'Error' });
    return { error: err.message || 'Error', secs };
  }
}

// Qwen structure + Gemini wording: work on a copy so the plain Qwen row in the log stays available for comparison.
function applyWording(r, tp) {
  if (!tp || tp.error || !tp.lines || !tp.lines.length) return Object.assign({}, r, { note: ' Wording check unavailable.' });
  const spec = structuredClone(r.spec);
  const m = E.mergeWording(spec, tp.lines);
  spec.unconfirmed = m.unconfirmed;
  if (m.unconfirmed.length) spec.warnings.push(`${m.unconfirmed.length} label${m.unconfirmed.length === 1 ? '' : 's'} not confirmed by the second reading \u2014 compare with the original: ${m.unconfirmed.slice(0, 6).map((u) => '\u201c' + u.text + '\u201d').join(', ')}${m.unconfirmed.length > 6 ? '\u2026' : ''}`);
  const label = r.label + ' + Gemini wording', secs = Math.max(r.secs, tp.secs);
  logRun({ label, secs, spec, page: r.page, items: countItems(spec) });
  return { spec, page: r.page, label, secs, note: m.fixed ? ` ${m.fixed} label${m.fixed === 1 ? '' : 's'} corrected.` : ' Wording confirmed.' };
}

// One engine, one attempt: returns the result or throws. Every attempt (good or failed) lands in the comparison log.
async function tryEngine(engine, note, precise) {
  let image = current.base64, mime = current.mimeType;
  if (engine === 'qwen' && current.kind === 'pdf') {
    if (!current.raster) throw new Error('Qwen needs a page image and this PDF could not be rendered');
    image = current.raster; mime = 'image/jpeg';
  }
  const thorough = engine === 'gemini' && precise;
  const cost = thorough ? CFG.PRECISE_COST : 1;
  if (getUsageToday() + cost > CFG.MAX_SCANS_PER_DAY) throw new Error('This browser has hit today\u2019s scan limit. Try again tomorrow.');
  const t0 = performance.now();
  try {
    const raw = await scanForm({ image, mime_type: mime, note: note || undefined, tier: thorough ? 'precise' : 'fast', provider: engine });
    recordUsage(cost);
    const secs = (performance.now() - t0) / 1000, label = (raw._meta && raw._meta.model) || engine;
    if (!raw.recognized) throw Object.assign(new Error('Model did not recognise a form'), { secs, label });
    const spec = E.normalizeSpec(raw);
    if (!spec.bands.length) throw Object.assign(new Error('No fields or tables found'), { secs, label });
    const page = E.resolvePage(spec, current.src);
    logRun({ label, secs, spec, page, items: countItems(spec) });
    return { spec, page, label, secs };
  } catch (err) {
    logRun({ label: err.label || ENGINE_LABEL[engine], secs: err.secs != null ? err.secs : (performance.now() - t0) / 1000, error: err.message || 'Error' });
    throw err;
  }
}

async function runScan() {
  if (!current) { setStatus('Choose a photo or PDF first.', 'error'); return; }
  const choice = $('fs-provider').value; // auto | qwen | gemini
  const precise = $('fs-precise').checked;
  const engines = choice === 'auto' ? ['qwen', 'gemini'] : [choice];
  const btn = $('fs-scan-btn');
  btn.disabled = true;
  const note = $('fs-note').value.trim();
  let lastErr = null;
  try {
    for (let i = 0; i < engines.length; i++) {
      const eng = engines[i];
      const wording = choice === 'auto' && eng === 'qwen' ? wordingRead(precise) : null;   // runs at the same time as Qwen
      setStatus(`Reading the form with ${ENGINE_LABEL[eng]}${wording ? ' (Gemini reads the wording at the same time)' : ''}\u2026 ${eng === 'gemini' && precise ? 'this can take up to half a minute.' : 'this can take a few seconds.'}`);
      try {
        let r = await tryEngine(eng, note, precise);
        if (wording) { setStatus('Checking the wording\u2026'); r = applyWording(r, await wording); }
        lastSpec = r.spec; lastPage = r.page;
        renderPreview(r.spec, r.page);
        setStatus(`Found ${r.spec.bands.length} section${r.spec.bands.length === 1 ? '' : 's'} on a ${r.page.label} page. Check it below, then download. (${r.label}, ${r.secs.toFixed(1)} s${i > 0 ? ', fallback engine' : ''}).${r.note || ''}`);
        return;
      } catch (err) {
        lastErr = err;
        if (i < engines.length - 1) setStatus(`${ENGINE_LABEL[eng]} failed (${err.message}) \u2014 trying ${ENGINE_LABEL[engines[i + 1]]}\u2026`, 'warn');
      }
    }
    const m = lastErr && lastErr.message ? lastErr.message : '';
    setStatus(/recognise|No fields/.test(m) ? 'Couldn\u2019t make out a form in that file \u2014 try a straighter, closer, better-lit photo, or a clearer PDF.' : (m || 'Something went wrong. Try again.'), 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ================= comparison log (this visit only, nothing saved) ================= */
const runs = [];
function logRun(r) { runs.push(r); renderRunLog(); }
function renderRunLog() {
  $('fs-runlog-wrap').hidden = !runs.length;
  $('fs-runlog').innerHTML = runs.map((r, i) => `<tr><td>${i + 1}</td><td>${escapeHTML(r.label)}</td><td>${r.secs.toFixed(1)} s</td>` + (r.error
    ? `<td colspan="2" class="fs-runlog-err">Failed: ${escapeHTML(String(r.error).slice(0, 90))}</td>`
    : r.info ? `<td colspan="2">${escapeHTML(r.info)}</td>`
    : `<td>${r.spec.bands.length} sections / ${r.items} items</td><td><button type="button" class="fs-runlog-btn" data-show="${i}">Show</button> <button type="button" class="fs-runlog-btn" data-pdf="${i}">PDF</button></td>`) + '</tr>').join('');
}
async function downloadRun(r) {
  try {
    const res = await E.buildFillablePdf(PDFLib, r.spec, r.page, { shade: $('fs-shade').checked });
    const url = URL.createObjectURL(new Blob([res.bytes], { type: 'application/pdf' }));
    const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const a = document.createElement('a');
    a.href = url; a.download = (slug(r.spec.title || 'scanned-form') || 'scanned-form') + '-' + slug(r.label) + '.pdf';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch (err) { setStatus('Could not build the PDF (' + (err.message || 'unknown error') + ').', 'error'); }
}

/* ================= download ================= */
async function downloadPdf() {
  if (!lastSpec) return;
  const btn = $('fs-download-btn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Building PDF\u2026';
  try {
    const res = await E.buildFillablePdf(PDFLib, lastSpec, lastPage, { shade: $('fs-shade').checked });
    const blob = new Blob([res.bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (lastSpec.title || 'scanned-form').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    a.href = url; a.download = (safeName || 'scanned-form') + '.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    if (res.warnings.length) setStatus(res.warnings.join(' '), 'warn');
    else setStatus('Downloaded.');
  } catch (err) {
    setStatus('Could not build the PDF (' + (err.message || 'unknown error') + '). Try scanning again.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

/* ================= init ================= */
let rzInitialized = false;
function init() {
  if (rzInitialized) return;
  rzInitialized = true;
  $('fs-photo-input').addEventListener('change', handleFileSelect);
  $('fs-scan-btn').addEventListener('click', runScan);
  $('fs-download-btn').addEventListener('click', downloadPdf);
  $('fs-shade').addEventListener('change', () => { if (lastSpec) refreshPdfPreview(lastSpec, lastPage); });
  $('fs-wording').addEventListener('input', onWordingEdit);
  $('fs-wording').addEventListener('click', onWordingClick);
  $('fs-runlog').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.show) { const r = runs[+b.dataset.show]; lastSpec = r.spec; lastPage = r.page; renderPreview(r.spec, r.page); }
    else if (b.dataset.pdf) downloadRun(runs[+b.dataset.pdf]);
  });
}
document.addEventListener('DOMContentLoaded', init);
