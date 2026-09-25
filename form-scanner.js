/* ============================================================
   Form Scanner — page wiring
   Version: v6.0 (2026-09-24)
   Vanilla JS, loaded after form-scanner-engine.js (the layout/PDF-building
   logic, see that file) and pdf-lib (CDN script tag in form-scanner.html).
   This file only does DOM + the one Worker call: file selection, calling
   the Worker proxy, rendering the detected-structure preview, and wiring
   the download button to FormScannerEngine.buildFillablePdf(). Nothing
   about the photo/PDF or the finished PDF is ever sent anywhere except
   that one Worker call — same "nothing saved on our side" rule as every
   other tool here.
   ============================================================ */

console.info('[Form Scanner] page build: v6.0 (2026-09-24)');

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
      if (width > CFG.MAX_IMAGE_EDGE || height > CFG.MAX_IMAGE_EDGE) {
        const scale = CFG.MAX_IMAGE_EDGE / Math.max(width, height);
        width = Math.round(width * scale); height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', CFG.JPEG_QUALITY), width, height });
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
      current = { kind: 'pdf', base64, mimeType: 'application/pdf', src: { kind: 'pdf', width: meta.width, height: meta.height } };
      setStatus(meta.pages > 1 ? 'This tool reads page 1 only \u2014 add a note above if a different page matters, then scan.' : 'PDF ready \u2014 add a note if it helps, then scan.', meta.pages > 1 ? 'warn' : null);
    } else {
      if (!/^image\//.test(file.type)) throw new Error("That file doesn't look like an image or a PDF.");
      const { dataUrl: resized, width, height } = await resizeImage(dataUrl);
      if (mySel !== selId) return;
      showImageCard(resized);
      current = { kind: 'image', base64: resized.split(',')[1], mimeType: 'image/jpeg', src: { kind: 'image', width, height } };
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

  $('fs-results-placeholder').hidden = true;
  $('fs-results-section').hidden = false;
  if (window.matchMedia && !window.matchMedia('(min-width: 801px)').matches) {
    $('fs-results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/* ================= scan flow ================= */
async function runScan() {
  if (!current) { setStatus('Choose a photo or PDF first.', 'error'); return; }
  const precise = $('fs-precise').checked;
  const cost = precise ? CFG.PRECISE_COST : 1;
  if (getUsageToday() + cost > CFG.MAX_SCANS_PER_DAY) {
    setStatus('This browser has hit today\u2019s scan limit. Try again tomorrow.', 'error');
    return;
  }
  const btn = $('fs-scan-btn');
  btn.disabled = true;
  setStatus(precise ? 'Reading the form thoroughly\u2026 this can take up to half a minute.' : 'Reading the form\u2026 this can take a few seconds.');
  try {
    const note = $('fs-note').value.trim();
    const raw = await scanForm({ image: current.base64, mime_type: current.mimeType, note: note || undefined, tier: precise ? 'precise' : 'fast' });
    recordUsage(cost);
    if (!raw.recognized) {
      setStatus('Couldn\u2019t make out a form in that file \u2014 try a straighter, closer, better-lit photo, or a clearer PDF.', 'error');
      return;
    }
    const spec = E.normalizeSpec(raw);
    if (!spec.bands.length) {
      setStatus('Recognised a form, but couldn\u2019t make out any fields or tables on it. Try a clearer file.', 'error');
      return;
    }
    const page = E.resolvePage(spec, current.src);
    lastSpec = spec; lastPage = page;
    renderPreview(spec, page);
    const nFields = spec.bands.reduce((a, b) => a + (b.kind === 'table' ? 1 : b.cells.reduce((n, c) => n + c.items.filter((it) => it.kind === 'F' || it.kind === 'C').length, 0)), 0);
    setStatus(`Found ${spec.bands.length} section${spec.bands.length === 1 ? '' : 's'} on a ${page.label} page. Check it below, then download.`);
  } catch (err) {
    setStatus(err.message || 'Something went wrong. Try again.', 'error');
  } finally {
    btn.disabled = false;
  }
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
}
document.addEventListener('DOMContentLoaded', init);
