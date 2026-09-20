/* ============================================================
   Form Scanner Frontend Engine
   Version: v4.4-autoscale (Based on v4.3 Default Best)
   ============================================================ */

console.info('[Form Scanner] Engine initialized: v4.4-autoscale');

const MAX_IMAGE_EDGE = 1280;
const PROXY_ENDPOINT = 'https://form-scanner-proxy.reysourcez-ent.workers.dev';

let currentFileBase64 = null;
let currentMimeType = 'image/jpeg';
let currentOriginalSize = 'Unknown';
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
      img.onerror = () => reject(new Error('File could not be parsed as an image. Ensure it is a valid photo.'));
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
      currentOriginalSize = 'A4'; // default fallback

      // Physics Engine: Extract actual page dimensions natively
      try {
        const binaryString = window.atob(base64Data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
        
        const pdfDocUpload = await PDFLib.PDFDocument.load(bytes);
        const firstPage = pdfDocUpload.getPages()[0];
        const { width, height } = firstPage.getSize();
        
        // A5 long edge is ~595pts. A4 long edge is ~842pts.
        if (Math.max(width, height) < 700) {
          currentOriginalSize = 'A5';
        } else {
          currentOriginalSize = 'A4';
        }
      } catch (err) {
        console.warn('Could not determine original PDF dimensions, defaulting to AI guess.');
      }

      const img = document.getElementById('fs-preview-img');
      img.hidden = true;
      const pdfPreview = document.getElementById('fs-pdf-preview');
      if (pdfPreview) {
        pdfPreview.style.display = 'block';
        document.getElementById('fs-pdf-filename').textContent = file.name;
      }
      document.getElementById('fs-upload-prompt').hidden = true;
      document.getElementById('fs-scan-btn').disabled = false;
      setStatus(`PDF document ready. Auto-detected size: ${currentOriginalSize}.`);
    } else {
      const { base64, previewUrl } = await resizeImageToBase64(file);
      currentFileBase64 = base64;
      currentMimeType = fileType || 'image/jpeg';
      currentOriginalSize = 'Unknown (Analyze layout: typically A5 for Malaysian payment vouchers, otherwise A4)';

      const pdfPreview = document.getElementById('fs-pdf-preview');
      if (pdfPreview) pdfPreview.style.display = 'none';

      const img = document.getElementById('fs-preview-img');
      img.src = previewUrl;
      img.hidden = false;
      document.getElementById('fs-upload-prompt').hidden = true;
      document.getElementById('fs-scan-btn').disabled = false;
      setStatus('Image ready for analysis.');
    }
  } catch (err) {
    document.getElementById('fs-scan-btn').disabled = true;
    setStatus(err.message || 'File processing failed.', true);
  }
}

async function scanForm(fileBase64, mimeType, note, originalSize) {
  let response;
  try {
    response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: fileBase64, mime_type: mimeType, note: note, original_size: originalSize }),
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
  const sizeBadge = result.page_size === 'A5' ? ' [A5 Format]' : ' [A4 Format]';
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
    const result = await scanForm(currentFileBase64, currentMimeType, note, currentOriginalSize);
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

/* ================= EXACT STRUCTURAL PDF BUILDER ================= */

async function buildFillablePdf(result) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(cleanPdfText(result.title) || 'Voucher Form');
  
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const form = pdfDoc.getForm();

  const isA5 = result.page_size === 'A5';
  const scaleFactor = isA5 ? 0.707 : 1.0; 
  const PAGE_W = 595.28 * scaleFactor;
  const PAGE_H = 841.89 * scaleFactor;
  const MARGIN = 36 * scaleFactor;
  const CONTENT_W = PAGE_W - (MARGIN * 2);

  const s = (val) => val * scaleFactor;

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = MARGIN;
  let fieldCounter = 0;
  const toPdfY = (yTop) => PAGE_H - yTop;

  function text(str, x, yTop, opts = {}) {
    const cleanStr = cleanPdfText(str);
    if (!cleanStr) return;
    const size = s(opts.size || 8.5);
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
      thickness: s(w || 0.8),
      color: rgb(0, 0, 0),
    });
  }

  function rect(x, yTop, w, h, opts = {}) {
    page.drawRectangle({
      x, y: toPdfY(yTop + h), width: w, height: h,
      borderColor: rgb(0, 0, 0), borderWidth: s(opts.borderWidth ?? 0.8),
      color: opts.fill,
    });
  }

  function createField(x, yTop, w, h) {
    fieldCounter++;
    const tf = form.createTextField(`field_${fieldCounter}`);
    try { tf.setFontSize(s(8)); } catch (e) {}
    tf.addToPage(page, { x, y: toPdfY(yTop + h), width: w, height: h, borderWidth: 0 });
    return tf;
  }

  if (result.reference_code) {
    text(result.reference_code, PAGE_W - MARGIN, y + s(8), { size: 8, bold: true, align: 'right' });
    y += s(12);
  }

  const formStartY = y;

  y += s(8);
  text(result.title || 'BAUCAR BAYARAN', PAGE_W / 2, y, { size: 12, bold: true, align: 'center' });
  y += s(14);

  (result.subtitles || []).forEach((sub) => {
    text(sub, PAGE_W / 2, y, { size: 8.5, bold: true, align: 'center' });
    y += s(12);
  });
  y += s(4);

  const headerBoxTop = y;
  const leftColW = CONTENT_W * 0.58;
  const rightColW = CONTENT_W - leftColW;
  const colDividerX = MARGIN + leftColW;

  let leftY = y + s(8);
  (result.header_left || []).forEach((f) => {
    text(f.label + ' :', MARGIN + s(6), leftY + s(9), { size: 8, bold: true });
    const lblW = fontBold.widthOfTextAtSize(f.label + ' :', s(8)) + s(6);
    const boxX = MARGIN + s(6) + lblW;
    const boxW = leftColW - lblW - s(12);
    rect(boxX, leftY, boxW, s(13));
    createField(boxX + s(1), leftY + s(1), boxW - s(2), s(11));
    leftY += s(17);
  });

  let rightY = y + s(8);
  (result.header_right || []).forEach((f) => {
    text(f.label + ' :', colDividerX + s(6), rightY + s(9), { size: 8, bold: true });
    const lblW = fontBold.widthOfTextAtSize(f.label + ' :', s(8)) + s(6);
    const boxX = colDividerX + s(6) + lblW;
    const boxW = rightColW - lblW - s(12);

    if (f.options && f.options.length) {
      rect(boxX, rightY, boxW, f.options.length * s(12) + s(4));
      f.options.forEach((opt, idx) => {
        text(`[  ] ${opt}`, boxX + s(4), rightY + s(9) + idx * s(11), { size: 7.5 });
      });
      rightY += f.options.length * s(12) + s(6);
    } else {
      rect(boxX, rightY, boxW, s(13));
      createField(boxX + s(1), rightY + s(1), boxW - s(2), s(11));
      rightY += s(17);
    }
  });

  const headerBoxH = Math.max(leftY, rightY) - headerBoxTop + s(4);
  rect(MARGIN, headerBoxTop, CONTENT_W, headerBoxH);
  line(colDividerX, headerBoxTop, colDividerX, headerBoxTop + headerBoxH);
  y = headerBoxTop + headerBoxH + s(10);

  if (result.main_table && result.main_table.columns && result.main_table.columns.length) {
    const cols = result.main_table.columns;
    const colWidths = cols.map((c, i) => {
      if (i === 0) return s(30);
      if (i === cols.length - 1) return s(90);
      return CONTENT_W - s(120);
    });

    const colX = [MARGIN];
    colWidths.forEach((w) => colX.push(colX[colX.length - 1] + w));

    const tableTop = y;
    const headerH = s(16);
    rect(MARGIN, y, CONTENT_W, headerH, { fill: rgb(0.92, 0.92, 0.92) });

    cols.forEach((c, i) => {
      text(c, colX[i] + colWidths[i] / 2, y + s(11), { size: 8, bold: true, align: 'center' });
    });
    y += headerH;

    const rowH = s(15);
    const rowCount = result.main_table.blank_row_count || 4;
    for (let r = 0; r < rowCount; r++) {
      cols.forEach((c, i) => {
        createField(colX[i] + s(2), y + s(1), colWidths[i] - s(4), rowH - s(2));
      });
      y += rowH;
      line(MARGIN, y, MARGIN + CONTENT_W, y);
    }

    if (result.main_table.has_total_row) {
      const totalLblW = colWidths.reduce((sum, w, i) => i < cols.length - 1 ? sum + w : sum, 0);
      rect(MARGIN, y, totalLblW, rowH, { fill: rgb(0.95, 0.95, 0.95) });
      text('JUMLAH (RM)', MARGIN + totalLblW - s(8), y + s(10), { size: 8, bold: true, align: 'right' });
      createField(colX[cols.length - 1] + s(2), y + s(1), colWidths[cols.length - 1] - s(4), rowH - s(2));
      y += rowH;
    }

    rect(MARGIN, tableTop, CONTENT_W, y - tableTop);
    colX.slice(1, -1).forEach((x) => line(x, tableTop, x, y));
    y += s(10);
  }

  if (result.amount_in_words_label) {
    rect(MARGIN, y, CONTENT_W, s(16));
    text(result.amount_in_words_label, MARGIN + s(6), y + s(11), { size: 8, bold: true });
    const lblW = fontBold.widthOfTextAtSize(result.amount_in_words_label, s(8)) + s(10);
    createField(MARGIN + lblW, y + s(2), CONTENT_W - lblW - s(6), s(12));
    y += s(22);
  }

  const sigBoxTop = y;
  const sigColW = CONTENT_W / 2;
  const sigMidX = MARGIN + sigColW;

  let leftSigY = y + s(8);
  (result.left_signatures || []).forEach((block) => {
    if (block.heading) {
      text(block.heading, MARGIN + s(6), leftSigY + s(9), { size: 8, bold: true });
      leftSigY += s(15);
    }
    (block.fields || []).forEach((fl) => {
      text(fl + ' :', MARGIN + s(6), leftSigY + s(9), { size: 7.5, bold: true });
      const lw = fontBold.widthOfTextAtSize(fl + ' :', s(7.5)) + s(6);
      line(MARGIN + s(6) + lw, leftSigY + s(10), MARGIN + sigColW - s(10), leftSigY + s(10));
      createField(MARGIN + s(6) + lw, leftSigY, sigColW - lw - s(16), s(10));
      leftSigY += s(14);
    });
    leftSigY += s(6);
  });

  let rightSigY = y + s(8);
  (result.right_signatures || []).forEach((block) => {
    if (block.heading) {
      text(block.heading, sigMidX + s(6), rightSigY + s(9), { size: 8, bold: true });
      rightSigY += s(15);
    }
    (block.fields || []).forEach((fl) => {
      text(fl + ' :', sigMidX + s(6), rightSigY + s(9), { size: 7.5, bold: true });
      const lw = fontBold.widthOfTextAtSize(fl + ' :', s(7.5)) + s(6);
      line(sigMidX + s(6) + lw, rightSigY + s(10), MARGIN + CONTENT_W - s(10), rightSigY + s(10));
      createField(sigMidX + s(6) + lw, rightSigY, sigColW - lw - s(16), s(10));
      rightSigY += s(14);
    });
    rightSigY += s(6);
  });

  const sigBoxH = Math.max(leftSigY, rightSigY) - sigBoxTop + s(4);
  rect(MARGIN, sigBoxTop, CONTENT_W, sigBoxH);
  line(sigMidX, sigBoxTop, sigMidX, sigBoxTop + sigBoxH);
  y = sigBoxTop + sigBoxH + s(10);

  rect(MARGIN - s(4), formStartY - s(4), CONTENT_W + s(8), y - formStartY + s(4), { borderWidth: s(1) });

  if (result.footnotes && result.footnotes.length) {
    y += s(4);
    result.footnotes.forEach((fn) => {
      text(fn, MARGIN, y + s(8), { size: 6.5 });
      y += s(9);
    });
    y += s(4);
  }

  if (result.bottom_table && result.bottom_table.columns && result.bottom_table.columns.length) {
    const bt = result.bottom_table;
    const bColW = CONTENT_W / bt.columns.length;
    const btTop = y;

    rect(MARGIN, y, CONTENT_W, s(13), { fill: rgb(0.88, 0.88, 0.88) });
    bt.columns.forEach((col, idx) => {
      text(col, MARGIN + idx * bColW + bColW / 2, y + s(9), { size: 7, bold: true, align: 'center' });
    });
    y += s(13);

    (bt.rows || []).forEach((row) => {
      row.forEach((cell, idx) => {
        text(cell, MARGIN + idx * bColW + bColW / 2, y + s(8), { size: 6.5, align: 'center' });
      });
      y += s(11);
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
