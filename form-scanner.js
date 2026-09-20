/* ============================================================
   Form Scanner
   Vanilla JS with exact structural PDF rendering (pdf-lib)
   ============================================================ */

console.info('[Form Scanner] script build: 2026-09-20-v3-structure-match');

const MAX_IMAGE_EDGE = 1280;
const PROXY_ENDPOINT = '[https://form-scanner-proxy.reysourcez-ent.workers.dev](https://form-scanner-proxy.reysourcez-ent.workers.dev)';
const MAX_SCANS_PER_DAY = 20;
const USAGE_STORAGE_KEY = 'fs-usage';

const PAGE_W = 595.28; // A4 points
const PAGE_H = 841.89;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2;

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

function resizeImageToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error("That file isn't an image."));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not open image.'));
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
    setStatus('Photo ready \u2014 click Scan.');
  } catch (err) {
    setStatus(err.message || 'Could not read photo.', true);
  }
}

async function scanForm(imageBase64, note) {
  let response;
  try {
    response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, mime_type: 'image/jpeg', note }),
    });
  } catch (e) {
    throw new Error('Could not reach scanning service.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Scan failed.');
  return data;
}

let lastResult = null;

function renderPreview(result) {
  document.getElementById('fs-preview-title').textContent = result.title || 'Scanned Form';
  document.getElementById('fs-preview-ref').textContent = result.reference_code || '';

  const hfGroup = document.getElementById('fs-header-fields-group');
  const hfEl = document.getElementById('fs-header-fields');
  const allHeaderLabels = [...result.header_left, ...result.header_right].map((f) => f.label);
  if (allHeaderLabels.length) {
    hfGroup.hidden = false;
    hfEl.innerHTML = allHeaderLabels.map((lbl) => `<span class="fs-field-tag">${lbl}</span>`).join('');
  } else {
    hfGroup.hidden = true;
  }

  const tblGroup = document.getElementById('fs-tables-group');
  const tblEl = document.getElementById('fs-tables');
  if (result.main_table) {
    tblGroup.hidden = false;
    tblEl.innerHTML = `
      <div class="fs-table-card">
        <p class="fs-table-card-title">Main Table Structure</p>
        <p class="fs-table-cols">${result.main_table.columns.join(' &middot; ')}</p>
        <p class="fs-table-rows">${result.main_table.blank_row_count} blank rows ${result.main_table.has_total_row ? ' + Total Row' : ''}</p>
      </div>
    `;
  } else {
    tblGroup.hidden = true;
  }

  const sigGroup = document.getElementById('fs-signatures-group');
  const sigEl = document.getElementById('fs-signatures');
  const totalSigs = result.left_signatures.length + result.right_signatures.length;
  if (totalSigs > 0) {
    sigGroup.hidden = false;
    sigEl.innerHTML = [...result.left_signatures, ...result.right_signatures].map((s) => `
      <div class="fs-sig-card">
        <span class="fs-sig-card-title">${s.heading || 'Sign-off'}</span>
        <span class="fs-sig-card-fields">${s.fields.join(' &middot; ')}</span>
      </div>
    `).join('');
  } else {
    sigGroup.hidden = true;
  }

  document.getElementById('fs-results-section').hidden = false;
  document.getElementById('fs-results-section').scrollIntoView({ behavior: 'smooth' });
}

async function runScan() {
  if (!currentImageBase64) return setStatus('Choose a photo first.', true);
  if (getUsageToday() >= MAX_SCANS_PER_DAY) return setStatus('Daily scan limit reached.', true);

  const btn = document.getElementById('fs-scan-btn');
  btn.disabled = true;
  setStatus('Analyzing form structure\u2026');

  try {
    const note = document.getElementById('fs-note').value.trim();
    const result = await scanForm(currentImageBase64, note);
    recordUsage();
    if (!result.recognized) return setStatus('Form layout not recognized in photo.', true);

    lastResult = result;
    renderPreview(result);
    setStatus('Form successfully analyzed! Ready to build PDF.');
  } catch (err) {
    setStatus(err.message || 'Error scanning form.', true);
  } finally {
    btn.disabled = false;
  }
}

/* ================= PDF STRUCTURAL BUILDER ================= */

async function buildFillablePdf(result) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(cleanPdfText(result.title) || 'Scanned Voucher');
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const form = pdfDoc.getForm();

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = MARGIN;
  let fieldCounter = 0;
  const toPdfY = (yTop) => PAGE_H - yTop;

  function text(str, x, yTop, opts = {}) {
    const cleanStr = cleanPdfText(str);
    if (!cleanStr) return;
    const size = opts.size || 8.5;
    const useFont = opts.bold ? fontBold : font;
    let drawX = x;
    if (opts.align === 'center') drawX = x - useFont.widthOfTextAtSize(cleanStr, size) / 2;
    else if (opts.align === 'right') drawX = x - useFont.widthOfTextAtSize(cleanStr, size);
    page.drawText(cleanStr, { x: drawX, y: toPdfY(yTop), size, font: useFont, color: rgb(0, 0, 0) });
  }

  function line(x1, yTop1, x2, yTop2, w) {
    page.drawLine({
      start: { x: x1, y: toPdfY(yTop1) },
      end: { x: x2, y: toPdfY(yTop2) },
      thickness: w || 0.8,
      color: rgb(0, 0, 0),
    });
  }

  function rect(x, yTop, w, h, opts = {}) {
    page.drawRectangle({
      x, y: toPdfY(yTop + h), width: w, height: h,
      borderColor: rgb(0, 0, 0), borderWidth: opts.borderWidth ?? 0.8,
      color: opts.fill,
    });
  }

  function field(x, yTop, w, h) {
    fieldCounter++;
    const tf = form.createTextField('field_' + fieldCounter);
    try { tf.setFontSize(8); } catch (e) {}
    tf.addToPage(page, { x, y: toPdfY(yTop + h), width: w, height: h, borderWidth: 0 });
    return tf;
  }

  // ---- 1. Top Reference Code ----
  if (result.reference_code) {
    text(result.reference_code, PAGE_W - MARGIN, y + 8, { size: 8, bold: true, align: 'right' });
    y += 12;
  }

  // ---- Outer Document Border Box ----
  const formStartY = y;

  // ---- 2. Header / Titles ----
  y += 10;
  text(result.title || 'BAUCAR BAYARAN', PAGE_W / 2, y, { size: 13, bold: true, align: 'center' });
  y += 14;

  result.subtitles.forEach((sub) => {
    text(sub, PAGE_W / 2, y, { size: 9, bold: true, align: 'center' });
    y += 12;
  });
  y += 6;

  // ---- 3. 2-Column Header Section ----
  const headerBoxTop = y;
  const leftColW = CONTENT_W * 0.58;
  const rightColW = CONTENT_W - leftColW;
  const colDividerX = MARGIN + leftColW;

  let leftY = y + 8;
  result.header_left.forEach((f) => {
    text(f.label + ' :', MARGIN + 6, leftY + 10, { size: 8, bold: true });
    const lblW = fontBold.widthOfTextAtSize(f.label + ' :', 8) + 8;
    const boxX = MARGIN + 6 + lblW;
    const boxW = leftColW - lblW - 14;
    rect(boxX, leftY, boxW, 14);
    field(boxX + 1, leftY + 1, boxW - 2, 12);
    leftY += 18;
  });

  let rightY = y + 8;
  result.header_right.forEach((f) => {
    text(f.label + ' :', colDividerX + 6, rightY + 10, { size: 8, bold: true });
    const lblW = fontBold.widthOfTextAtSize(f.label + ' :', 8) + 8;
    const boxX = colDividerX + 6 + lblW;
    const boxW = rightColW - lblW - 12;

    if (f.options && f.options.length) {
      rect(boxX, rightY, boxW, f.options.length * 13 + 4);
      f.options.forEach((opt, idx) => {
        text(`[  ] ${opt}`, boxX + 6, rightY + 10 + idx * 12, { size: 7.5 });
      });
      rightY += f.options.length * 13 + 8;
    } else {
      rect(boxX, rightY, boxW, 14);
      field(boxX + 1, rightY + 1, boxW - 2, 12);
      rightY += 18;
    }
  });

  const headerBoxH = Math.max(leftY, rightY) - headerBoxTop + 6;
  rect(MARGIN, headerBoxTop, CONTENT_W, headerBoxH);
  line(colDividerX, headerBoxTop, colDividerX, headerBoxTop + headerBoxH);
  y = headerBoxTop + headerBoxH + 10;

  // ---- 4. Main Item Table ----
  if (result.main_table && result.main_table.columns.length) {
    const cols = result.main_table.columns;
    const colWidths = cols.map((c, i) => {
      if (i === 0) return 30; // NO column
      if (i === cols.length - 1) return 90; // AMAUN column
      return CONTENT_W - 120; // BUTIRAN
    });

    const colX = [MARGIN];
    colWidths.forEach((w) => colX.push(colX[colX.length - 1] + w));

    const tableTop = y;
    const headerH = 18;
    rect(MARGIN, y, CONTENT_W, headerH, { fill: rgb(0.92, 0.92, 0.92) });

    cols.forEach((c, i) => {
      text(c, colX[i] + colWidths[i] / 2, y + 12, { size: 8, bold: true, align: 'center' });
    });
    y += headerH;

    const rowH = 16;
    const rowCount = result.main_table.blank_row_count || 4;
    for (let r = 0; r < rowCount; r++) {
      cols.forEach((c, i) => {
        field(colX[i] + 2, y + 1, colWidths[i] - 4, rowH - 2);
      });
      y += rowH;
      line(MARGIN, y, MARGIN + CONTENT_W, y);
    }

    if (result.main_table.has_total_row) {
      const totalLblW = colWidths.reduce((s, w, i) => i < cols.length - 1 ? s + w : s, 0);
      rect(MARGIN, y, totalLblW, rowH, { fill: rgb(0.95, 0.95, 0.95) });
      text('JUMLAH (RM)', MARGIN + totalLblW - 8, y + 11, { size: 8, bold: true, align: 'right' });
      field(colX[cols.length - 1] + 2, y + 1, colWidths[cols.length - 1] - 4, rowH - 2);
      y += rowH;
    }

    rect(MARGIN, tableTop, CONTENT_W, y - tableTop);
    colX.slice(1, -1).forEach((x) => line(x, tableTop, x, y));
    y += 10;
  }

  // ---- 5. Amount in Words Section ----
  if (result.amount_in_words_label) {
    rect(MARGIN, y, CONTENT_W, 18);
    text(result.amount_in_words_label, MARGIN + 6, y + 12, { size: 8, bold: true });
    const lblW = fontBold.widthOfTextAtSize(result.amount_in_words_label, 8) + 12;
    field(MARGIN + lblW, y + 2, CONTENT_W - lblW - 6, 14);
    y += 26;
  }

  // ---- 6. Asymmetric 2-Column Signature Area ----
  const sigBoxTop = y;
  const sigColW = CONTENT_W / 2;
  const sigMidX = MARGIN + sigColW;

  let leftSigY = y + 8;
  result.left_signatures.forEach((block) => {
    if (block.heading) {
      text(block.heading, MARGIN + 6, leftSigY + 9, { size: 8.5, bold: true });
      leftSigY += 16;
    }
    block.fields.forEach((fl) => {
      text(fl + ' :', MARGIN + 6, leftSigY + 9, { size: 8, bold: true });
      const lw = fontBold.widthOfTextAtSize(fl + ' :', 8) + 6;
      line(MARGIN + 6 + lw, leftSigY + 10, MARGIN + sigColW - 12, leftSigY + 10);
      field(MARGIN + 6 + lw, leftSigY, sigColW - lw - 18, 11);
      leftSigY += 15;
    });
    leftSigY += 8;
  });

  let rightSigY = y + 8;
  result.right_signatures.forEach((block) => {
    if (block.heading) {
      text(block.heading, sigMidX + 6, rightSigY + 9, { size: 8.5, bold: true });
      rightSigY += 16;
    }
    block.fields.forEach((fl) => {
      text(fl + ' :', sigMidX + 6, rightSigY + 9, { size: 8, bold: true });
      const lw = fontBold.widthOfTextAtSize(fl + ' :', 8) + 6;
      line(sigMidX + 6 + lw, rightSigY + 10, MARGIN + CONTENT_W - 12, rightSigY + 10);
      field(sigMidX + 6 + lw, rightSigY, sigColW - lw - 18, 11);
      rightSigY += 15;
    });
    rightSigY += 8;
  });

  const sigBoxH = Math.max(leftSigY, rightSigY) - sigBoxTop + 4;
  rect(MARGIN, sigBoxTop, CONTENT_W, sigBoxH);
  line(sigMidX, sigBoxTop, sigMidX, sigBoxTop + sigBoxH);
  y = sigBoxTop + sigBoxH + 12;

  // Complete top outer box wrapper around document
  rect(MARGIN - 6, formStartY - 6, CONTENT_W + 12, y - formStartY + 6, { borderWidth: 1.2 });

  // ---- 7. Footnotes ----
  if (result.footnotes.length) {
    y += 6;
    result.footnotes.forEach((fn) => {
      text(fn, MARGIN, y + 8, { size: 7 });
      y += 10;
    });
    y += 6;
  }

  // ---- 8. Bottom Reference Table (e.g. Kuasa Melulus) ----
  if (result.bottom_table && result.bottom_table.columns.length) {
    const bt = result.bottom_table;
    const bColW = CONTENT_W / bt.columns.length;
    const btTop = y;

    rect(MARGIN, y, CONTENT_W, 14, { fill: rgb(0.88, 0.88, 0.88) });
    bt.columns.forEach((col, idx) => {
      text(col, MARGIN + idx * bColW + bColW / 2, y + 10, { size: 7.5, bold: true, align: 'center' });
    });
    y += 14;

    bt.rows.forEach((row) => {
      row.forEach((cell, idx) => {
        text(cell, MARGIN + idx * bColW + bColW / 2, y + 9, { size: 7, align: 'center' });
      });
      y += 12;
      line(MARGIN, y, MARGIN + CONTENT_W, y, 0.5);
    });

    rect(MARGIN, btTop, CONTENT_W, y - btTop);
    for (let c = 1; c < bt.columns.length; c++) {
      line(MARGIN + c * bColW, btTop, MARGIN + c * bColW, y);
    }
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
    const safeName = (cleanPdfText(lastResult.title) || 'scanned-voucher').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    a.href = url;
    a.download = (safeName || 'scanned-voucher') + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    setStatus('Error building PDF (' + (err.message || 'unknown error') + ').', true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function init() {
  document.getElementById('fs-photo-input').addEventListener('change', handleFileSelect);
  document.getElementById('fs-scan-btn').addEventListener('click', runScan);
  document.getElementById('fs-download-btn').addEventListener('click', downloadPdf);
}

document.addEventListener('DOMContentLoaded', init);
