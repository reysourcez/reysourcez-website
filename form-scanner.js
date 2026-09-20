/* ============================================================
   Form Scanner Frontend Engine
   Version: v4.5-dynamic-auto
   ============================================================ */

console.info('[Form Scanner] Engine initialized: v4.5-dynamic-auto');

const MAX_IMAGE_EDGE = 1280;
const PROXY_ENDPOINT = '[https://form-scanner-proxy.reysourcez-ent.workers.dev](https://form-scanner-proxy.reysourcez-ent.workers.dev)';

let currentFileBase64 = null;
let currentMimeType = 'image/jpeg';
let currentOriginalSize = 'A4';
let currentOriginalOrientation = 'portrait';
let lastResult = null;

function setStatus(text, isError) {
  const el = document.getElementById('fs-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'status-box active' + (isError ? ' is-error' : '');
}

function cleanPdfText(str) {
  if (str == null) return '';
  return String(str)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resizeImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed reading file stream.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('File could not be parsed as an image.'));
      img.onload = () => {
        let { width, height } = img;
        const isLandscape = width > height;
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
        resolve({ base64: dataUrl.split(',')[1], previewUrl: dataUrl, isLandscape });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const fileName = (file.name || '').toLowerCase();
  const fileType = (file.type || '').toLowerCase();
  const isPdf = fileType.includes('pdf') || fileName.endsWith('.pdf');

  setStatus('Processing uploaded file\u2026');
  try {
    if (isPdf) {
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Failed reading PDF file.'));
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(file);
      });

      currentFileBase64 = base64Data;
      currentMimeType = 'application/pdf';

      // Measure exact physical points of page 1
      try {
        const binaryString = window.atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
        
        const pdfDocUpload = await PDFLib.PDFDocument.load(bytes);
        const firstPage = pdfDocUpload.getPages()[0];
        const w = firstPage.getWidth();
        const h = firstPage.getHeight();

        currentOriginalOrientation = w > h ? 'landscape' : 'portrait';
        const maxEdge = Math.max(w, h);
        currentOriginalSize = maxEdge < 720 ? 'A5' : 'A4';
      } catch (err) {
        currentOriginalSize = 'A4';
        currentOriginalOrientation = 'portrait';
      }

      const img = document.getElementById('fs-preview-img');
      img.hidden = true;
      const pdfPreview = document.getElementById('fs-pdf-preview');
      if (pdfPreview) {
        pdfPreview.style.display = 'block';
        document.getElementById('fs-pdf-filename').textContent = file.name;
        document.getElementById('fs-pdf-meta').textContent = `PDF Detected: ${currentOriginalSize} ${currentOriginalOrientation.toUpperCase()}`;
      }
      document.getElementById('fs-upload-prompt').hidden = true;
      document.getElementById('fs-scan-btn').disabled = false;
      setStatus(`PDF ready. Detected paper size: ${currentOriginalSize} (${currentOriginalOrientation}).`);
    } else {
      const { base64, previewUrl, isLandscape } = await resizeImageToBase64(file);
      currentFileBase64 = base64;
      currentMimeType = fileType || 'image/jpeg';
      currentOriginalSize = 'A5'; // Default receipts/vouchers to A5
      currentOriginalOrientation = isLandscape ? 'landscape' : 'portrait';

      const pdfPreview = document.getElementById('fs-pdf-preview');
      if (pdfPreview) pdfPreview.style.display = 'none';

      const img = document.getElementById('fs-preview-img');
      img.src = previewUrl;
      img.hidden = false;
      document.getElementById('fs-upload-prompt').hidden = true;
      document.getElementById('fs-scan-btn').disabled = false;
      setStatus(`Image ready. Target paper size: ${currentOriginalSize} (${currentOriginalOrientation}).`);
    }
  } catch (err) {
    document.getElementById('fs-scan-btn').disabled = true;
    setStatus(err.message || 'File processing failed.', true);
  }
}

async function scanForm(fileBase64, mimeType, note, originalSize, originalOrientation) {
  let response;
  try {
    response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: fileBase64,
        mime_type: mimeType,
        note: note,
        original_size: originalSize,
        original_orientation: originalOrientation,
      }),
    });
  } catch (e) {
    throw new Error('Network error: Unable to reach worker service.');
  }

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    throw new Error(`Worker Error (${response.status}): Worker output returned non-JSON data.`);
  }

  if (!response.ok) throw new Error(data.error || `Scan failed with status ${response.status}.`);
  return data;
}

function renderPreview(result) {
  document.getElementById('fs-preview-title').textContent = result.title || 'Scanned Form Structure';
  const sizeBadge = ` [${result.page_size} ${result.orientation.toUpperCase()}]`;
  document.getElementById('fs-preview-ref').textContent = (result.reference_code || '') + sizeBadge;

  const hfGroup = document.getElementById('fs-header-fields-group');
  const hfEl = document.getElementById('fs-header-fields');
  const allHeaderLabels = [...(result.header_left || []), ...(result.header_right || [])].map((f) => f.label);
  if (allHeaderLabels.length) {
    hfGroup.hidden = false;
    hfEl.innerHTML = allHeaderLabels.map((lbl) => `<span class="field-tag">${lbl}</span>`).join('');
  } else {
    hfGroup.hidden = true;
  }

  const tblGroup = document.getElementById('fs-tables-group');
  const tblEl = document.getElementById('fs-tables');
  if (result.main_table && result.main_table.columns) {
    tblGroup.hidden = false;
    tblEl.innerHTML = `<p style="font-size:0.85rem;">Columns: <strong>${result.main_table.columns.join(' | ')}</strong> (${result.main_table.blank_row_count} rows)</p>`;
  } else {
    tblGroup.hidden = true;
  }

  const sigGroup = document.getElementById('fs-signatures-group');
  const sigEl = document.getElementById('fs-signatures');
  const totalSigs = (result.left_signatures || []).length + (result.right_signatures || []).length;
  if (totalSigs > 0) {
    sigGroup.hidden = false;
    sigEl.innerHTML = [...(result.left_signatures || []), ...(result.right_signatures || [])].map((s) => `
      <div style="font-size:0.8rem; margin-top:0.2rem;">
        <strong>${s.heading || 'Block'}:</strong> ${s.fields.join(', ')}
      </div>
    `).join('');
  } else {
    sigGroup.hidden = true;
  }

  document.getElementById('fs-results-section').hidden = false;
  document.getElementById('fs-results-section').scrollIntoView({ behavior: 'smooth' });
}

async function runScan() {
  if (!currentFileBase64) return setStatus('Select an image or PDF file first.', true);

  const btn = document.getElementById('fs-scan-btn');
  btn.disabled = true;
  setStatus('Analyzing layout & mapping fields via AI proxy\u2026');

  try {
    const note = document.getElementById('fs-note').value.trim();
    const result = await scanForm(currentFileBase64, currentMimeType, note, currentOriginalSize, currentOriginalOrientation);
    if (!result.recognized) return setStatus('Form format unrecognized. Try providing a clearer document or photo.', true);

    lastResult = result;
    renderPreview(result);
    setStatus('Form structure mapped successfully!');
  } catch (err) {
    setStatus(err.message || 'Error occurred during scan.', true);
  } finally {
    btn.disabled = false;
  }
}

/* ================= EXACT PDF BUILDER ================= */

async function buildFillablePdf(result) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(cleanPdfText(result.title) || 'Voucher Form');
  
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const form = pdfDoc.getForm();

  const isA5 = (result.page_size || '').toUpperCase() === 'A5';
  const isLandscape = (result.orientation || '').toLowerCase() === 'landscape';

  // Point dimensions: A4 = 595.28 x 841.89 pt | A5 = 419.53 x 595.28 pt
  let PAGE_W, PAGE_H;
  if (isA5) {
    PAGE_W = isLandscape ? 595.28 : 419.53;
    PAGE_H = isLandscape ? 419.53 : 595.28;
  } else {
    PAGE_W = isLandscape ? 841.89 : 595.28;
    PAGE_H = isLandscape ? 595.28 : 841.89;
  }

  const MARGIN = isA5 ? 20 : 28;
  const CONTENT_W = PAGE_W - (MARGIN * 2);

  const titleFontSize = isA5 ? 10.5 : 12;
  const subtitleFontSize = isA5 ? 7.5 : 8.5;
  const bodyFontSize = isA5 ? 7.5 : 8.5;
  const smallFontSize = isA5 ? 6.5 : 7.5;

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = MARGIN;
  let fieldCounter = 0;
  const toPdfY = (yTop) => PAGE_H - yTop;

  function text(str, x, yTop, opts = {}) {
    const cleanStr = cleanPdfText(str);
    if (!cleanStr) return;
    const size = opts.size || bodyFontSize;
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

  function createField(x, yTop, w, h) {
    fieldCounter++;
    const tf = form.createTextField(`field_${fieldCounter}`);
    try { tf.setFontSize(bodyFontSize - 0.5); } catch (e) {}
    tf.addToPage(page, { x, y: toPdfY(yTop + h), width: w, height: h, borderWidth: 0 });
    return tf;
  }

  if (result.reference_code) {
    text(result.reference_code, PAGE_W - MARGIN, y + 8, { size: smallFontSize, bold: true, align: 'right' });
    y += 10;
  }

  const formStartY = y;

  y += 6;
  text(result.title || 'BAUCAR BAYARAN / RESIT RASMI', PAGE_W / 2, y, { size: titleFontSize, bold: true, align: 'center' });
  y += (titleFontSize + 4);

  (result.subtitles || []).forEach((sub) => {
    text(sub, PAGE_W / 2, y, { size: subtitleFontSize, bold: true, align: 'center' });
    y += (subtitleFontSize + 3);
  });
  y += 4;

  const headerBoxTop = y;
  const leftColW = CONTENT_W * (isLandscape ? 0.55 : 0.58);
  const rightColW = CONTENT_W - leftColW;
  const colDividerX = MARGIN + leftColW;
  const headerRowH = isA5 ? 13 : 16;

  let leftY = y + 6;
  (result.header_left || []).forEach((f) => {
    text(f.label + ' :', MARGIN + 4, leftY + (headerRowH * 0.65), { size: bodyFontSize, bold: true });
    const lblW = fontBold.widthOfTextAtSize(f.label + ' :', bodyFontSize) + 4;
    const boxX = MARGIN + 4 + lblW;
    const boxW = leftColW - lblW - 8;
    rect(boxX, leftY, boxW, headerRowH - 2);
    createField(boxX + 1, leftY + 1, boxW - 2, headerRowH - 4);
    leftY += headerRowH + 2;
  });

  let rightY = y + 6;
  (result.header_right || []).forEach((f) => {
    text(f.label + ' :', colDividerX + 4, rightY + (headerRowH * 0.65), { size: bodyFontSize, bold: true });
    const lblW = fontBold.widthOfTextAtSize(f.label + ' :', bodyFontSize) + 4;
    const boxX = colDividerX + 4 + lblW;
    const boxW = rightColW - lblW - 8;

    if (f.options && f.options.length) {
      const optBoxH = f.options.length * (headerRowH - 3) + 4;
      rect(boxX, rightY, boxW, optBoxH);
      f.options.forEach((opt, idx) => {
        text(`[  ] ${opt}`, boxX + 3, rightY + (headerRowH * 0.6) + idx * (headerRowH - 3), { size: smallFontSize });
      });
      rightY += optBoxH + 4;
    } else {
      rect(boxX, rightY, boxW, headerRowH - 2);
      createField(boxX + 1, rightY + 1, boxW - 2, headerRowH - 4);
      rightY += headerRowH + 2;
    }
  });

  const headerBoxH = Math.max(leftY, rightY) - headerBoxTop + 2;
  rect(MARGIN, headerBoxTop, CONTENT_W, headerBoxH);
  line(colDividerX, headerBoxTop, colDividerX, headerBoxTop + headerBoxH);
  y = headerBoxTop + headerBoxH + (isA5 ? 6 : 10);

  if (result.main_table && result.main_table.columns && result.main_table.columns.length) {
    const cols = result.main_table.columns;
    const colCount = cols.length;
    
    const colWidths = cols.map((c, i) => {
      if (i === 0) return Math.min(CONTENT_W * 0.08, 35);
      if (i === colCount - 1) return CONTENT_W * 0.20;
      return (CONTENT_W - Math.min(CONTENT_W * 0.08, 35) - (CONTENT_W * 0.20)) / (colCount - 2);
    });

    const colX = [MARGIN];
    colWidths.forEach((w) => colX.push(colX[colX.length - 1] + w));

    const tableTop = y;
    const tblHeaderH = isA5 ? 14 : 18;
    rect(MARGIN, y, CONTENT_W, tblHeaderH, { fill: rgb(0.92, 0.92, 0.92) });

    cols.forEach((c, i) => {
      text(c, colX[i] + colWidths[i] / 2, y + (tblHeaderH * 0.68), { size: bodyFontSize, bold: true, align: 'center' });
    });
    y += tblHeaderH;

    const rowCount = result.main_table.blank_row_count || 4;
    const tableRowH = isA5 ? (isLandscape ? 13 : 15) : 18;

    for (let r = 0; r < rowCount; r++) {
      cols.forEach((c, i) => {
        createField(colX[i] + 2, y + 1, colWidths[i] - 4, tableRowH - 2);
      });
      y += tableRowH;
      line(MARGIN, y, MARGIN + CONTENT_W, y);
    }

    if (result.main_table.has_total_row) {
      const totalLblW = colWidths.reduce((sum, w, i) => i < cols.length - 1 ? sum + w : sum, 0);
      rect(MARGIN, y, totalLblW, tableRowH, { fill: rgb(0.95, 0.95, 0.95) });
      text('JUMLAH (RM)', MARGIN + totalLblW - 6, y + (tableRowH * 0.68), { size: bodyFontSize, bold: true, align: 'right' });
      createField(colX[cols.length - 1] + 2, y + 1, colWidths[cols.length - 1] - 4, tableRowH - 2);
      y += tableRowH;
    }

    rect(MARGIN, tableTop, CONTENT_W, y - tableTop);
    colX.slice(1, -1).forEach((x) => line(x, tableTop, x, y));
    y += (isA5 ? 6 : 10);
  }

  if (result.amount_in_words_label) {
    const amtBoxH = isA5 ? 14 : 18;
    rect(MARGIN, y, CONTENT_W, amtBoxH);
    text(result.amount_in_words_label, MARGIN + 4, y + (amtBoxH * 0.68), { size: bodyFontSize, bold: true });
    const lblW = fontBold.widthOfTextAtSize(result.amount_in_words_label, bodyFontSize) + 8;
    createField(MARGIN + lblW, y + 1, CONTENT_W - lblW - 4, amtBoxH - 2);
    y += amtBoxH + (isA5 ? 6 : 10);
  }

  const sigBoxTop = y;
  const sigColW = CONTENT_W / 2;
  const sigMidX = MARGIN + sigColW;
  const sigLineH = isA5 ? 12 : 15;

  let leftSigY = y + 4;
  (result.left_signatures || []).forEach((block) => {
    if (block.heading) {
      text(block.heading, MARGIN + 4, leftSigY + (sigLineH * 0.65), { size: bodyFontSize, bold: true });
      leftSigY += sigLineH + 2;
    }
    (block.fields || []).forEach((fl) => {
      text(fl + ' :', MARGIN + 4, leftSigY + (sigLineH * 0.65), { size: smallFontSize, bold: true });
      const lw = fontBold.widthOfTextAtSize(fl + ' :', smallFontSize) + 4;
      line(MARGIN + 4 + lw, leftSigY + (sigLineH * 0.75), MARGIN + sigColW - 8, leftSigY + (sigLineH * 0.75));
      createField(MARGIN + 4 + lw, leftSigY, sigColW - lw - 12, sigLineH - 2);
      leftSigY += sigLineH + 2;
    });
    leftSigY += 4;
  });

  let rightSigY = y + 4;
  (result.right_signatures || []).forEach((block) => {
    if (block.heading) {
      text(block.heading, sigMidX + 4, rightSigY + (sigLineH * 0.65), { size: bodyFontSize, bold: true });
      rightSigY += sigLineH + 2;
    }
    (block.fields || []).forEach((fl) => {
      text(fl + ' :', sigMidX + 4, rightSigY + (sigLineH * 0.65), { size: smallFontSize, bold: true });
      const lw = fontBold.widthOfTextAtSize(fl + ' :', smallFontSize) + 4;
      line(sigMidX + 4 + lw, rightSigY + (sigLineH * 0.75), MARGIN + CONTENT_W - 8, rightSigY + (sigLineH * 0.75));
      createField(sigMidX + 4 + lw, rightSigY, sigColW - lw - 12, sigLineH - 2);
      rightSigY += sigLineH + 2;
    });
    rightSigY += 4;
  });

  const sigBoxH = Math.max(leftSigY, rightSigY) - sigBoxTop + 2;
  rect(MARGIN, sigBoxTop, CONTENT_W, sigBoxH);
  line(sigMidX, sigBoxTop, sigMidX, sigBoxTop + sigBoxH);
  y = sigBoxTop + sigBoxH + 6;

  rect(MARGIN - 3, formStartY - 3, CONTENT_W + 6, y - formStartY + 3, { borderWidth: 1 });

  if (result.footnotes && result.footnotes.length) {
    y += 4;
    result.footnotes.forEach((fn) => {
      text(fn, MARGIN, y + 6, { size: smallFontSize - 0.5 });
      y += smallFontSize + 2;
    });
    y += 2;
  }

  if (result.bottom_table && result.bottom_table.columns && result.bottom_table.columns.length) {
    const bt = result.bottom_table;
    const bColW = CONTENT_W / bt.columns.length;
    const btTop = y;
    const bHeaderH = isA5 ? 11 : 13;

    rect(MARGIN, y, CONTENT_W, bHeaderH, { fill: rgb(0.88, 0.88, 0.88) });
    bt.columns.forEach((col, idx) => {
      text(col, MARGIN + idx * bColW + bColW / 2, y + (bHeaderH * 0.68), { size: smallFontSize, bold: true, align: 'center' });
    });
    y += bHeaderH;

    const bRowH = isA5 ? 10 : 12;
    (bt.rows || []).forEach((row) => {
      row.forEach((cell, idx) => {
        text(cell, MARGIN + idx * bColW + bColW / 2, y + (bRowH * 0.68), { size: smallFontSize - 0.5, align: 'center' });
      });
      y += bRowH;
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
  btn.textContent = 'Generating PDF\u2026';
  try {
    const pdfBytes = await buildFillablePdf(lastResult);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const name = (cleanPdfText(lastResult.title) || 'voucher-form').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    a.href = url;
    a.download = `${name}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    setStatus('PDF construction failed: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download Fillable PDF';
  }
}

function init() {
  const photoInput = document.getElementById('fs-photo-input');
  if (photoInput) photoInput.addEventListener('change', handleFileSelect);

  const scanBtn = document.getElementById('fs-scan-btn');
  if (scanBtn) scanBtn.addEventListener('click', runScan);

  const downloadBtn = document.getElementById('fs-download-btn');
  if (downloadBtn) downloadBtn.addEventListener('click', downloadPdf);
}

document.addEventListener('DOMContentLoaded', init);
