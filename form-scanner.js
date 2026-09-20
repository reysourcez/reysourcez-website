/* ============================================================
   Form Scanner
   Vanilla JS, no dependencies except pdf-lib (loaded via CDN
   script tag in form-scanner.html). The photo goes to the Cloudflare
   Worker proxy (form-scanner-proxy-worker.js).
   ============================================================ */

console.info('[Form Scanner] script build: 2026-09-20-v2-encoding-fix');

/* ================= CONFIG ================= */

const MAX_IMAGE_EDGE = 1280; // px — resized client-side before sending
const PROXY_ENDPOINT = 'https://form-scanner-proxy.reysourcez-ent.workers.dev';

const MAX_SCANS_PER_DAY = 20;
const USAGE_STORAGE_KEY = 'fs-usage';

const PAGE_W = 595.28; // A4, points
const PAGE_H = 841.89;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;

const FIELD_BACKGROUND_COLOR = null;

/* ================= SHARED UTILITIES ================= */

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function setStatus(text, isError) {
  const el = document.getElementById('fs-status');
  el.textContent = text;
  el.classList.toggle('is-error', !!isError);
}

function cleanPdfText(str) {
  if (str == null) return '';
  let cleaned = String(str)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ');

  let result = '';
  for (let i = 0; i < cleaned.length; i++) {
    const code = cleaned.charCodeAt(i);
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) {
      result += cleaned[i];
    } else {
      result += ' ';
    }
  }
  return result.replace(/\s+/g, ' ').trim();
}

/* ================= SOFT USAGE CAP ================= */

function getUsageToday() {
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_STORAGE_KEY) || 'null');
    if (!raw || raw.day !== new Date().toDateString()) return 0;
    return raw.count;
  } catch (e) { return 0; }
}
function recordUsage() {
  try { localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify({ day: new Date().toDateString(), count: getUsageToday() + 1 })); }
  catch (e) {}
}

/* ================= IMAGE HANDLING ================= */

function resizeImageToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error("That file doesn't look like an image."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't open that image. Try a different file."));
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) {
          const scale = MAX_IMAGE_EDGE / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        resolve({ base64: dataUrl.split(',')[1], previewUrl: dataUrl });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

let currentImageBase64 = null;

async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  setStatus('Preparing photo\u2026');
  try {
    const { base64, previewUrl } = await resizeImageToBase64(file);
    currentImageBase64 = base64;
    const img = document.getElementById('fs-preview-img');
    img.src = previewUrl;
    img.hidden = false;
    document.getElementById('fs-upload-zone').classList.add('has-image');
    document.getElementById('fs-scan-btn').disabled = false;
    setStatus('Photo ready \u2014 add a note if it helps, then Scan.');
  } catch (err) {
    setStatus(err.message || 'Could not read that photo.', true);
  }
}

/* ================= PROXY CALL ================= */

async function scanForm(imageBase64, note) {
  let response;
  try {
    response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, mime_type: 'image/jpeg', note: note || undefined }),
    });
  } catch (e) {
    throw new Error('Could not reach the scanning service \u2014 check PROXY_ENDPOINT is correct and this page\u2019s URL is in the Worker\u2019s ALLOWED_ORIGINS.');
  }
  let data;
  try { data = await response.json(); }
  catch (e) { throw new Error('Got an unreadable response from the scanning service. Try again.'); }
  if (!response.ok) throw new Error(data.error || ('Scan failed (error ' + response.status + '). Try again.'));
  return data;
}

/* ================= RESULT PREVIEW ================= */

let lastResult = null;

function renderPreview(result) {
  document.getElementById('fs-preview-title').textContent = result.title || 'Untitled form';
  document.getElementById('fs-preview-ref').textContent = result.reference_code || '';

  const hfGroup = document.getElementById('fs-header-fields-group');
  const hfEl = document.getElementById('fs-header-fields');
  if (result.header_fields.length) {
    hfGroup.hidden = false;
    hfEl.innerHTML = result.header_fields.map((f) =>
      `<span class="fs-field-tag${f.multiline ? ' is-multiline' : ''}">${escapeHTML(f.label)}</span>`
    ).join('');
  } else {
    hfGroup.hidden = true;
  }

  const tblGroup = document.getElementById('fs-tables-group');
  const tblEl = document.getElementById('fs-tables');
  if (result.tables.length) {
    tblGroup.hidden = false;
    tblEl.innerHTML = result.tables.map((t) => `
      <div class="fs-table-card">
        <p class="fs-table-card-title">${escapeHTML(t.section_title || 'Table')}</p>
        <p class="fs-table-cols">${t.columns.map(escapeHTML).join(' &middot; ')}</p>
        <p class="fs-table-rows">${t.blank_row_count} blank row${t.blank_row_count === 1 ? '' : 's'}</p>
      </div>
    `).join('');
  } else {
    tblGroup.hidden = true;
  }

  const sigGroup = document.getElementById('fs-signatures-group');
  const sigEl = document.getElementById('fs-signatures');
  if (result.signature_blocks.length) {
    sigGroup.hidden = false;
    sigEl.innerHTML = result.signature_blocks.map((s) => `
      <div class="fs-sig-card">
        <span class="fs-sig-card-title">${escapeHTML(s.heading || 'Signature')}</span>
        <span class="fs-sig-card-fields">${s.fields.map(escapeHTML).join(' &middot; ')}</span>
      </div>
    `).join('');
  } else {
    sigGroup.hidden = true;
  }

  document.getElementById('fs-results-section').hidden = false;
  document.getElementById('fs-results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ================= ANALYZE FLOW ================= */

async function runScan() {
  if (!currentImageBase64) { setStatus('Choose a photo first.', true); return; }
  if (getUsageToday() + 1 > MAX_SCANS_PER_DAY) {
    setStatus('This browser has hit today\u2019s scan limit. Try again tomorrow.', true);
    return;
  }
  const btn = document.getElementById('fs-scan-btn');
  btn.disabled = true;
  setStatus('Reading the form\u2026 this can take a few seconds.');

  try {
    const note = document.getElementById('fs-note').value.trim();
    const result = await scanForm(currentImageBase64, note);
    recordUsage();
    if (!result.recognized) {
      setStatus('Couldn\u2019t make out a form in that photo \u2014 try a straighter, closer, better-lit shot.', true);
      return;
    }
    lastResult = result;
    renderPreview(result);
    setStatus(`Found ${result.header_fields.length} field${result.header_fields.length === 1 ? '' : 's'}, ${result.tables.length} table${result.tables.length === 1 ? '' : 's'}, ${result.signature_blocks.length} sign-off block${result.signature_blocks.length === 1 ? '' : 's'}.`);
  } catch (err) {
    setStatus(err.message || 'Something went wrong. Try again.', true);
  } finally {
    btn.disabled = false;
  }
}

/* ================= PDF BUILDER (pdf-lib) ================= */

function wrapToWidth(font, text, size, maxWidth) {
  const clean = cleanPdfText(text);
  const words = clean.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  words.forEach((w) => {
    const trial = line ? line + ' ' + w : w;
    if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = trial;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

async function buildFillablePdf(result) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(cleanPdfText(result.title) || 'Scanned form');
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const form = pdfDoc.getForm();

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = MARGIN;
  let fieldCounter = 0;
  const GRAY = rgb(0.78, 0.78, 0.78);

  const toPdfY = (yTop) => PAGE_H - yTop;

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = MARGIN;
  }
  function ensureSpace(h) {
    if (y + h > PAGE_H - MARGIN) { newPage(); return true; }
    return false;
  }
  function text(str, x, yTop, opts = {}) {
    const cleanStr = cleanPdfText(str);
    if (!cleanStr) return;
    const size = opts.size || 9;
    const useFont = opts.bold ? fontBold : font;
    let drawX = x;
    if (opts.align === 'center') drawX = x - useFont.widthOfTextAtSize(cleanStr, size) / 2;
    else if (opts.align === 'right') drawX = x - useFont.widthOfTextAtSize(cleanStr, size);
    page.drawText(cleanStr, { x: drawX, y: toPdfY(yTop), size, font: useFont, color: rgb(0, 0, 0) });
  }
  function line(x1, yTop, x2, w) {
    page.drawLine({ start: { x: x1, y: toPdfY(yTop) }, end: { x: x2, y: toPdfY(yTop) }, thickness: w || 0.75, color: rgb(0, 0, 0) });
  }
  function vline(x, yTop1, yTop2, w) {
    page.drawLine({ start: { x, y: toPdfY(yTop1) }, end: { x, y: toPdfY(yTop2) }, thickness: w || 0.75, color: rgb(0, 0, 0) });
  }
  function rect(x, yTop, w, h, opts = {}) {
    page.drawRectangle({ x, y: toPdfY(yTop + h), width: w, height: h, borderColor: rgb(0, 0, 0), borderWidth: opts.borderWidth ?? 0.9, color: opts.fill });
  }
  function field(x, yTop, w, h, opts = {}) {
    fieldCounter++;
    const tf = form.createTextField('field_' + fieldCounter);
    if (opts.multiline) tf.enableMultiline();
    try { tf.setFontSize(8); } catch (e) {}
    const addOpts = { x, y: toPdfY(yTop + h), width: w, height: h, borderWidth: 0 };
    if (FIELD_BACKGROUND_COLOR) addOpts.backgroundColor = FIELD_BACKGROUND_COLOR;
    tf.addToPage(page, addOpts);
    return tf;
  }

  // ---- Title ----
  text(result.title || 'Scanned form', PAGE_W / 2, y + 16, { size: 15, bold: true, align: 'center' });
  y += 22;
  if (result.reference_code) {
    text(result.reference_code, PAGE_W - MARGIN, y, { size: 9, align: 'right' });
  }
  y += 20;

  // ---- Header fields ----
  result.header_fields.forEach((f) => {
    const h = f.multiline ? 30 : 16;
    ensureSpace(h + 4);
    const labelText = cleanPdfText(f.label) + ' :';
    text(labelText, MARGIN, y + 10, { size: 9, bold: true });
    const labelW = fontBold.widthOfTextAtSize(labelText, 9) + 10;
    const fx = MARGIN + labelW;
    field(fx, y, PAGE_W - MARGIN - fx, h, { multiline: f.multiline });
    line(fx, y + h, PAGE_W - MARGIN, 0.75);
    y += h + 10;
  });
  if (result.header_fields.length) y += 6;

  // ---- Tables ----
  result.tables.forEach((t) => {
    ensureSpace(40);
    if (t.section_title) {
      rect(MARGIN, y, CONTENT_W, 16, { fill: GRAY });
      text(t.section_title, PAGE_W / 2, y + 11, { size: 9.5, bold: true, align: 'center' });
      y += 16;
    }

    const weights = t.columns.map((c) => Math.max(3, cleanPdfText(c).length));
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const colWidths = weights.map((w) => (w / totalWeight) * CONTENT_W);
    const colX = [MARGIN];
    colWidths.forEach((w) => colX.push(colX[colX.length - 1] + w));

    const drawHeaderRow = () => {
      rect(MARGIN, y, CONTENT_W, 22, { fill: rgb(0.88, 0.88, 0.88) });
      t.columns.forEach((c, i) => {
        const lines = wrapToWidth(fontBold, c, 7, colWidths[i] - 6);
        const startY = y + (lines.length === 1 ? 14 : 9);
        lines.slice(0, 2).forEach((ln, li) => {
          text(ln, colX[i] + colWidths[i] / 2, startY + li * 9, { size: 7, bold: true, align: 'center' });
        });
      });
      colX.forEach((x) => vline(x, y, y + 22 + t.blank_row_count * 18));
      line(MARGIN, y, MARGIN + CONTENT_W, 0.9);
      y += 22;
      line(MARGIN, y, MARGIN + CONTENT_W, 0.75);
    };
    drawHeaderRow();

    for (let r = 0; r < t.blank_row_count; r++) {
      const paginated = ensureSpace(18);
      if (paginated) { drawHeaderRow(); }
      t.columns.forEach((c, i) => {
        field(colX[i] + 3, y + 2, colWidths[i] - 6, 14);
      });
      y += 18;
      line(MARGIN, y, MARGIN + CONTENT_W, 0.75);
    }
    rect(MARGIN, y - (22 + t.blank_row_count * 18), CONTENT_W, 22 + t.blank_row_count * 18, { borderWidth: 0.9 });
    y += 14;
  });

  // ---- Signature blocks ----
  const sigs = result.signature_blocks;
  if (sigs.length === 2) {
    ensureSpace(20 + sigs[0].fields.length * 20);
    const colW = (CONTENT_W - 30) / 2;
    [0, 1].forEach((i) => {
      const x = MARGIN + i * (colW + 30);
      text(sigs[i].heading || 'Signature', x, y + 10, { size: 9.5, bold: true });
      sigs[i].fields.forEach((fl, fi) => {
        const fy = y + 24 + fi * 20;
        const fieldLabelText = cleanPdfText(fl) + ' :';
        text(fieldLabelText, x, fy + 10, { size: 8.5, bold: true });
        const lw = fontBold.widthOfTextAtSize(fieldLabelText, 8.5) + 8;
        field(x + lw, fy, colW - lw, 14);
        line(x + lw, fy + 14, x + colW, 0.75);
      });
    });
    y += 24 + Math.max(sigs[0].fields.length, sigs[1].fields.length) * 20 + 10;
  } else {
    sigs.forEach((s) => {
      ensureSpace(20 + s.fields.length * 20);
      text(s.heading || 'Signature', MARGIN, y + 10, { size: 9.5, bold: true });
      y += 22;
      s.fields.forEach((fl) => {
        const fieldLabelText = cleanPdfText(fl) + ' :';
        text(fieldLabelText, MARGIN, y + 10, { size: 8.5, bold: true });
        const lw = fontBold.widthOfTextAtSize(fieldLabelText, 8.5) + 8;
        field(MARGIN + lw, y, 240, 14);
        line(MARGIN + lw, y + 14, MARGIN + lw + 240, 0.75);
        y += 20;
      });
      y += 8;
    });
  }

  return pdfDoc.save();
}

async function downloadPdf() {
  if (!lastResult) return;
  const btn = document.getElementById('fs-download-btn');
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Building PDF\u2026';
  try {
    const pdfBytes = await buildFillablePdf(lastResult);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (cleanPdfText(lastResult.title) || 'scanned-form').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    a.href = url;
    a.download = (safeName || 'scanned-form') + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    setStatus('Could not build the PDF (' + (err.message || 'unknown error') + '). Try scanning again.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

/* ================= INIT ================= */

let rzInitialized = false;

function init() {
  if (rzInitialized) return;
  rzInitialized = true;

  document.getElementById('fs-photo-input').addEventListener('change', handleFileSelect);
  document.getElementById('fs-scan-btn').addEventListener('click', runScan);
  document.getElementById('fs-download-btn').addEventListener('click', downloadPdf);
}

document.addEventListener('DOMContentLoaded', init);