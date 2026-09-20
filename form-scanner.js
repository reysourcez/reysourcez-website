/* ============================================================
   Form Scanner Frontend Engine
   Version: v4.1-pdf-input - 2026-09-20
   ============================================================ */
console.info('[Form Scanner] Engine initialized: v4.1-pdf-input');

const MAX_IMAGE_EDGE = 1280;
const PROXY_ENDPOINT = '[https://form-scanner-proxy.reysourcez-ent.workers.dev](https://form-scanner-proxy.reysourcez-ent.workers.dev)';
const PAGE_W = 595.28; // Standard A4 Width
const PAGE_H = 841.89; // Standard A4 Height
const MARGIN = 36;
const CONTENT_W = PAGE_W - (MARGIN * 2);

let currentImageBase64 = null;
let currentMimeType = 'image/jpeg';
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

function processImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed reading file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed loading image stream.'));
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
        resolve({ base64: dataUrl.split(',')[1], previewUrl: dataUrl, mimeType: 'image/jpeg' });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function processPdfFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed reading PDF file.'));
    reader.onload = async () => {
      try {
        const typedArray = new Uint8Array(reader.result);
        const loadingTask = pdfjsLib.getDocument({ data: typedArray });
        const pdfDoc = await loadingTask.promise;
        const page = await pdfDoc.getPage(1); // Render first page for analysis

        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;

        let width = canvas.width;
        let height = canvas.height;
        if (width > MAX_IMAGE_EDGE || height > MAX_IMAGE_EDGE) {
          const scale = MAX_IMAGE_EDGE / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);

          const resizeCanvas = document.createElement('canvas');
          resizeCanvas.width = width;
          resizeCanvas.height = height;
          resizeCanvas.getContext('2d').drawImage(canvas, 0, 0, width, height);
          const dataUrl = resizeCanvas.toDataURL('image/jpeg', 0.9);
          resolve({ base64: dataUrl.split(',')[1], previewUrl: dataUrl, mimeType: 'image/jpeg' });
        } else {
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
          resolve({ base64: dataUrl.split(',')[1], previewUrl: dataUrl, mimeType: 'image/jpeg' });
        }
      } catch (err) {
        reject(new Error('PDF parsing failed: ' + (err.message || 'Unknown error')));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  setStatus('Processing uploaded document\u2026');
  try {
    let result;
    if (file.type === 'application/pdf') {
      result = await processPdfFile(file);
    } else if (file.type.startsWith('image/')) {
      result = await processImageFile(file);
    } else {
      throw new Error('Selected file format is not supported. Please upload an image or PDF.');
    }

    currentImageBase64 = result.base64;
    currentMimeType = result.mimeType;

    const img = document.getElementById('fs-preview-img');
    img.src = result.previewUrl;
    img.hidden = false;
    document.getElementById('fs-upload-prompt').hidden = true;
    document.getElementById('fs-scan-btn').disabled = false;
    setStatus('Document ready for analysis.');
  } catch (err) {
    setStatus(err.message || 'File processing failed.', true);
  }
}

async function scanForm(imageBase64, mimeType, note) {
  let response;
  try {
    response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, mime_type: mimeType, note }),
    });
  } catch (e) {
    throw new Error('Network error: Unable to reach worker service.');
  }

  const rawText = await response.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (e) {
    console.error("Non-JSON Server Output:", rawText.slice(0, 300));
    throw new Error(`Cloudflare/Worker Error (${response.status}): Worker output returned HTML instead of JSON. Ensure route deployment is active.`);
  }

  if (!response.ok) throw new Error(data.error || `Scan failed with status ${response.status}.`);
  return data;
}

function renderPreview(result) {
  document.getElementById('fs-preview-title').textContent = result.title || 'Scanned Form Structure';
  document.getElementById('fs-preview-ref').textContent = result.reference_code || '';

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
  if (!currentImageBase64) return setStatus('Select a document or image file first.', true);

  const btn = document.getElementById('fs-scan-btn');
  btn.disabled = true;
  setStatus('Analyzing layout & mapping fields via AI proxy\u2026');

  try {
    const note = document.getElementById('fs-note').value.trim();
    const result = await scanForm(currentImageBase64, currentMimeType, note);
    if (!result.recognized) return setStatus('Form format unrecognized. Try uploading a clearer scan or document.', true);

    lastResult = result;
    renderPreview(result);
    setStatus('Form structure mapped successfully!');
  } catch (err) {
    setStatus(err.message || 'Error occurred during scan.', true);
  } finally {
    btn.disabled = false;
  }
}

/* ================= EXACT STRUCTURAL PDF BUILDER ================= */
async function buildFillablePdf(result) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(cleanPdfText(result.title) || 'Voucher Form');
  
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

  function createField(x, yTop, w, h) {
    fieldCounter++;
    const tf = form.createTextField(`field_${fieldCounter}`);
    try { tf.setFontSize(8); } catch (e) {}
    tf.addToPage(page, { x, y: toPdfY(yTop + h), width: w, height: h, borderWidth: 0 });
    return tf;
  }

  // 1. Top Corner Reference Code
  if (result.reference_code) {
    text(result.reference_code, PAGE_W - MARGIN, y + 8, { size: 8, bold: true, align: 'right' });
    y += 12;
  }

  const formStartY = y;

  // 2. Titles
  y += 8;
  text(result.title || 'BAUCAR BAYARAN', PAGE_W / 2, y, { size: 12, bold: true, align: 'center' });
  y += 14;

  (result.subtitles || []).forEach((sub) => {
    text(sub, PAGE_W / 2, y, { size: 8.5, bold: true, align: 'center' });
    y += 12;
  });
  y += 4;

  // 3. Header Grid (2 Columns)
  const headerBoxTop = y;
  const leftColW = CONTENT_W * 0.58;
  const rightColW = CONTENT_W - leftColW;
  const colDividerX = MARGIN + leftColW;

  let leftY = y + 8;
  (result.header_left || []).forEach((f) => {
    text(f.label + ' :', MARGIN + 6, leftY + 9, { size: 8, bold: true });
    const lblW = fontBold.widthOfTextAtSize(f.label + ' :', 8) + 6;
    const boxX = MARGIN + 6 + lblW;
    const boxW = leftColW - lblW - 12;
    rect(boxX, leftY, boxW, 13);
    createField(boxX + 1, leftY + 1, boxW - 2, 11);
    leftY += 17;
  });

  let rightY = y + 8;
  (result.header_right || []).forEach((f) => {
    text(f.label + ' :', colDividerX + 6, rightY + 9, { size: 8, bold: true });
    const lblW = fontBold.widthOfTextAtSize(f.label + ' :', 8) + 6;
    const boxX = colDividerX + 6 + lblW;
    const boxW = rightColW - lblW - 12;

    if (f.options && f.options.length) {
      rect(boxX, rightY, boxW, f.options.length * 12 + 4);
      f.options.forEach((opt, idx) => {
        text(`[  ] ${opt}`, boxX + 4, rightY + 9 + idx * 11, { size: 7.5 });
      });
      rightY += f.options.length * 12 + 6;
    } else {
      rect(boxX, rightY, boxW, 13);
      createField(boxX + 1, rightY + 1, boxW - 2, 11);
      rightY += 17;
    }
  });

  const headerBoxH = Math.max(leftY, rightY) - headerBoxTop + 4;
  rect(MARGIN, headerBoxTop, CONTENT_W, headerBoxH);
  line(colDividerX, headerBoxTop, colDividerX, headerBoxTop + headerBoxH);
  y = headerBoxTop + headerBoxH + 10;

  // 4. Main Item Table
  if (result.main_table && result.main_table.columns && result.main_table.columns.length) {
    const cols = result.main_table.columns;
    const colWidths = cols.map((c, i) => {
      if (i === 0) return 30;
      if (i === cols.length - 1) return 90;
      return CONTENT_W - 120;
    });

    const colX = [MARGIN];
    colWidths.forEach((w) => colX.push(colX[colX.length - 1] + w));

    const tableTop = y;
    const headerH = 16;
    rect(MARGIN, y, CONTENT_W, headerH, { fill: rgb(0.92, 0.92, 0.92) });

    cols.forEach((c, i) => {
      text(c, colX[i] + colWidths[i] / 2, y + 11, { size: 8, bold: true, align: 'center' });
    });
    y += headerH;

    const rowH = 15;
    const rowCount = result.main_table.blank_row_count || 4;
    for (let r = 0; r < rowCount; r++) {
      cols.forEach((c, i) => {
        createField(colX[i] + 2, y + 1, colWidths[i] - 4, rowH - 2);
      });
      y += rowH;
      line(MARGIN, y, MARGIN + CONTENT_W, y);
    }

    if (result.main_table.has_total_row) {
      const totalLblW = colWidths.reduce((s, w, i) => i < cols.length - 1 ? s + w : s, 0);
      rect(MARGIN, y, totalLblW, rowH, { fill: rgb(0.95, 0.95, 0.95) });
      text('JUMLAH (RM)', MARGIN + totalLblW - 8, y + 10, { size: 8, bold: true, align: 'right' });
      createField(colX[cols.length - 1] + 2, y + 1, colWidths[cols.length - 1] - 4, rowH - 2);
      y += rowH;
    }

    rect(MARGIN, tableTop, CONTENT_W, y - tableTop);
    colX.slice(1, -1).forEach((x) => line(x, tableTop, x, y));
    y += 10;
  }

  // 5. Amount in Words
  if (result.amount_in_words_label) {
    rect(MARGIN, y, CONTENT_W, 16);
    text(result.amount_in_words_label, MARGIN + 6, y + 11, { size: 8, bold: true });
    const lblW = fontBold.widthOfTextAtSize(result.amount_in_words_label, 8) + 10;
    createField(MARGIN + lblW, y + 2, CONTENT_W - lblW - 6, 12);
    y += 22;
  }

  // 6. Asymmetric Signature Area
  const sigBoxTop = y;
  const sigColW = CONTENT_W / 2;
  const sigMidX = MARGIN + sigColW;

  let leftSigY = y + 8;
  (result.left_signatures || []).forEach((block) => {
    if (block.heading) {
      text(block.heading, MARGIN + 6, leftSigY + 9, { size: 8, bold: true });
      leftSigY += 15;
    }
    (block.fields || []).forEach((fl) => {
      text(fl + ' :', MARGIN + 6, leftSigY + 9, { size: 7.5, bold: true });
      const lw = fontBold.widthOfTextAtSize(fl + ' :', 7.5) + 6;
      line(MARGIN + 6 + lw, leftSigY + 10, MARGIN + sigColW - 10, leftSigY + 10);
      createField(MARGIN + 6 + lw, leftSigY, sigColW - lw - 16, 10);
      leftSigY += 14;
    });
    leftSigY += 6;
  });

  let rightSigY = y + 8;
  (result.right_signatures || []).forEach((block) => {
    if (block.heading) {
      text(block.heading, sigMidX + 6, rightSigY + 9, { size: 8, bold: true });
      rightSigY += 15;
    }
    (block.fields || []).forEach((fl) => {
      text(fl + ' :', sigMidX + 6, rightSigY + 9, { size: 7.5, bold: true });
      const lw = fontBold.widthOfTextAtSize(fl + ' :', 7.5) + 6;
      line(sigMidX + 6 + lw, rightSigY + 10, MARGIN + CONTENT_W - 10, rightSigY + 10);
      createField(sigMidX + 6 + lw, rightSigY, sigColW - lw - 16, 10);
      rightSigY += 14;
    });
    rightSigY += 6;
  });

  const sigBoxH = Math.max(leftSigY, rightSigY) - sigBoxTop + 4;
  rect(MARGIN, sigBoxTop, CONTENT_W, sigBoxH);
  line(sigMidX, sigBoxTop, sigMidX, sigBoxTop + sigBoxH);
  y = sigBoxTop + sigBoxH + 10;

  // Outer Box Border
  rect(MARGIN - 4, formStartY - 4, CONTENT_W + 8, y - formStartY + 4, { borderWidth: 1 });

  // 7. Footnotes
  if (result.footnotes && result.footnotes.length) {
    y += 4;
    result.footnotes.forEach((fn) => {
      text(fn, MARGIN, y + 8, { size: 6.5 });
      y += 9;
    });
    y += 4;
  }

  // 8. Secondary Threshold Table
  if (result.bottom_table && result.bottom_table.columns && result.bottom_table.columns.length) {
    const bt = result.bottom_table;
    const bColW = CONTENT_W / bt.columns.length;
    const btTop = y;

    rect(MARGIN, y, CONTENT_W, 13, { fill: rgb(0.88, 0.88, 0.88) });
    bt.columns.forEach((col, idx) => {
      text(col, MARGIN + idx * bColW + bColW / 2, y + 9, { size: 7, bold: true, align: 'center' });
    });
    y += 13;

    (bt.rows || []).forEach((row) => {
      row.forEach((cell, idx) => {
        text(cell, MARGIN + idx * bColW + bColW / 2, y + 8, { size: 6.5, align: 'center' });
      });
      y += 11;
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
