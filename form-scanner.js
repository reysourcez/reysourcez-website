/* ============================================================
   Form Scanner Frontend Engine
   Filename: form-scanner.js
   Version: v4.6
   ============================================================ */

const PROXY_ENDPOINT = 'https://form-scanner-proxy.reysourcez-ent.workers.dev';
const MAX_IMAGE_EDGE = 1280;

let currentFileBase64 = null;
let currentMimeType = 'image/jpeg';
let currentOriginalSize = 'A4';
let currentOriginalOrientation = 'portrait';
let lastResult = null;

// Exact Dimensions in Points (72 pt/inch)
const PAPER_SIZES = {
  'A3': [841.89, 1190.55],
  'A4': [595.28, 841.89],
  'A5': [419.53, 595.28],
  'A6': [297.64, 419.53],
  'B5': [498.90, 708.66],
  'LETTER': [612.00, 792.00],
  'LEGAL': [612.00, 1008.00]
};

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
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resizeImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed reading image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('File is not a valid image.'));
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

  setStatus('Processing file...');
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
        if (maxEdge > 1000) currentOriginalSize = 'A3';
        else if (maxEdge > 750) currentOriginalSize = 'A4';
        else if (maxEdge > 500) currentOriginalSize = 'A5';
        else currentOriginalSize = 'A6';
      } catch (err) {
        currentOriginalSize = 'A4';
        currentOriginalOrientation = 'portrait';
      }

      const img = document.getElementById('fs-preview-img');
      if (img) img.hidden = true;
      const pdfPreview = document.getElementById('fs-pdf-preview');
      if (pdfPreview) {
        pdfPreview.style.display = 'block';
        document.getElementById('fs-pdf-filename').textContent = file.name;
        document.getElementById('fs-pdf-meta').textContent = `PDF Detected: ${currentOriginalSize} (${currentOriginalOrientation})`;
      }
    } else {
      const { base64, previewUrl, isLandscape } = await resizeImageToBase64(file);
      currentFileBase64 = base64;
      currentMimeType = fileType || 'image/jpeg';
      currentOriginalSize = 'A5';
      currentOriginalOrientation = isLandscape ? 'landscape' : 'portrait';

      const pdfPreview = document.getElementById('fs-pdf-preview');
      if (pdfPreview) pdfPreview.style.display = 'none';

      const img = document.getElementById('fs-preview-img');
      if (img) { img.src = previewUrl; img.hidden = false; }
    }

    const dropdown = document.getElementById('fs-paper-size');
    if (dropdown) dropdown.value = currentOriginalSize;

    document.getElementById('fs-scan-btn').disabled = false;
    setStatus(`File ready. Target: ${currentOriginalSize} (${currentOriginalOrientation}).`);
  } catch (err) {
    document.getElementById('fs-scan-btn').disabled = true;
    setStatus(err.message || 'File loading failed.', true);
  }
}

async function runScan() {
  if (!currentFileBase64) return setStatus('Please select a file first.', true);

  const btn = document.getElementById('fs-scan-btn');
  btn.disabled = true;
  setStatus('Analyzing layout structure...');

  try {
    const note = document.getElementById('fs-note') ? document.getElementById('fs-note').value : '';
    const selectedSize = document.getElementById('fs-paper-size') ? document.getElementById('fs-paper-size').value : currentOriginalSize;

    const response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: currentFileBase64,
        mime_type: currentMimeType,
        note: note,
        original_size: selectedSize,
        original_orientation: currentOriginalOrientation
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Scan request failed.');
    if (!data.recognized) throw new Error('Unrecognized form structure.');

    lastResult = data;
    if (selectedSize) lastResult.page_size = selectedSize;

    document.getElementById('fs-preview-title').textContent = data.title || 'Scanned Form';
    document.getElementById('fs-preview-ref').textContent = `[${lastResult.page_size} ${lastResult.orientation.toUpperCase()}]`;
    document.getElementById('fs-results-section').hidden = false;
    
    setStatus('Document structure mapped successfully!');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

/* ================= ZERO COLOR PDF BUILDER ================= */

async function buildFillablePdf(result) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const form = pdfDoc.getForm();

  const isLandscape = (result.orientation || '').toLowerCase() === 'landscape';
  const sizeKey = (result.page_size || 'A4').toUpperCase();
  let [PAGE_W, PAGE_H] = PAPER_SIZES[sizeKey] || PAPER_SIZES['A4'];
  if (isLandscape && PAGE_H > PAGE_W) [PAGE_W, PAGE_H] = [PAGE_H, PAGE_W];

  const MARGIN = 30;
  const CONTENT_W = PAGE_W - (MARGIN * 2);
  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = MARGIN;
  let fieldCounter = 0;
  
  const toPdfY = (yTop) => PAGE_H - yTop;

  function rect(x, yTop, w, h, borderW = 1) {
    page.drawRectangle({
      x, y: toPdfY(yTop + h), width: w, height: h,
      borderColor: rgb(0, 0, 0), borderWidth: borderW
    });
  }

  function text(str, x, yTop, opts = {}) {
    const cleanStr = cleanPdfText(str);
    if (!cleanStr) return;
    const size = opts.size || 10;
    const useFont = opts.bold ? fontBold : font;
    let drawX = x;
    if (opts.align === 'center') drawX = x - useFont.widthOfTextAtSize(cleanStr, size) / 2;
    if (opts.align === 'right') drawX = x - useFont.widthOfTextAtSize(cleanStr, size);
    page.drawText(cleanStr, { x: drawX, y: toPdfY(yTop), size, font: useFont, color: rgb(0, 0, 0) });
  }

  function line(x1, yTop1, x2, yTop2, w = 1) {
    page.drawLine({ start: { x: x1, y: toPdfY(yTop1) }, end: { x: x2, y: toPdfY(yTop2) }, thickness: w, color: rgb(0, 0, 0) });
  }

  function createField(x, yTop, w, h) {
    fieldCounter++;
    const tf = form.createTextField(`field_${fieldCounter}`);
    tf.addToPage(page, { x, y: toPdfY(yTop + h), width: w, height: h, borderWidth: 0 });
    return tf;
  }

  // Outer Border Frame
  rect(MARGIN, MARGIN, CONTENT_W, PAGE_H - (MARGIN * 2), 1.2);
  y += 15;

  // Title & Header Line
  text(result.title || 'RESIT RASMI', PAGE_W / 2, y, { size: 14, bold: true, align: 'center' });
  y += 18;
  line(MARGIN, y - 4, MARGIN + CONTENT_W, y - 4, 1.2);
  y += 12;

  (result.subtitles || []).forEach(sub => {
    text(sub, PAGE_W / 2, y, { size: 9, align: 'center', bold: true });
    y += 13;
  });
  y += 15;

  // Top Left / Right Fields
  let leftY = y, rightY = y;
  (result.top_fields_left || []).forEach(lbl => {
    text(lbl, MARGIN + 20, leftY + 12, { size: 10 });
    let lw = font.widthOfTextAtSize(lbl, 10);
    rect(MARGIN + 28 + lw, leftY + 2, 85, 16, 1);
    createField(MARGIN + 29 + lw, leftY + 3, 83, 14);
    leftY += 26;
  });

  (result.top_fields_right || []).forEach(lbl => {
    text(lbl, CONTENT_W / 2 + 40, rightY + 12, { size: 10 });
    let lw = font.widthOfTextAtSize(lbl, 10);
    line(CONTENT_W / 2 + 48 + lw, rightY + 14, MARGIN + CONTENT_W - 20, rightY + 14, 1);
    createField(CONTENT_W / 2 + 48 + lw, rightY, (MARGIN + CONTENT_W - 20) - (CONTENT_W / 2 + 48 + lw), 14);
    rightY += 26;
  });

  y = Math.max(leftY, rightY) + 10;

  // Middle Full-Width Lines
  (result.middle_full_width_fields || []).forEach(f => {
    let linesToDraw = Math.max(1, f.blank_lines || 1);
    text(f.label, MARGIN + 20, y + 12, { size: 10 });
    let lblWidth = font.widthOfTextAtSize(f.label, 10);
    let startX = MARGIN + 28 + lblWidth;

    for (let i = 0; i < linesToDraw; i++) {
      line(startX, y + 14, MARGIN + CONTENT_W - 20, y + 14, 1);
      createField(startX, y, (MARGIN + CONTENT_W - 20) - startX, 14);
      y += 24;
      startX = MARGIN + 20;
    }
    y += 4;
  });

  y += 10;

  // Grid Table (If present)
  if (result.has_grid_table && result.main_table?.columns?.length > 0) {
    const cols = result.main_table.columns;
    const colW = (CONTENT_W - 40) / cols.length;

    rect(MARGIN + 20, y, CONTENT_W - 40, 20, 1);
    cols.forEach((c, i) => {
      text(c, MARGIN + 20 + (i * colW) + colW / 2, y + 14, { size: 9, bold: true, align: 'center' });
      if (i > 0) line(MARGIN + 20 + i * colW, y, MARGIN + 20 + i * colW, y + 20, 1);
    });
    y += 20;

    for (let r = 0; r < (result.main_table.blank_row_count || 3); r++) {
      rect(MARGIN + 20, y, CONTENT_W - 40, 20, 1);
      cols.forEach((c, i) => {
        if (i > 0) line(MARGIN + 20 + i * colW, y, MARGIN + 20 + i * colW, y + 20, 1);
        createField(MARGIN + 22 + i * colW, y + 2, colW - 4, 16);
      });
      y += 20;
    }
    y += 20;
  }

  // Bottom Box vs Signatures
  let boxY = y;
  if (result.bottom_left_box && result.bottom_left_box.length > 0) {
    let boxWidth = CONTENT_W * 0.38;
    let boxHeight = result.bottom_left_box.length * 32;
    rect(MARGIN + 20, boxY, boxWidth, boxHeight, 1);

    let innerY = boxY;
    result.bottom_left_box.forEach((lbl, idx) => {
      text(lbl, MARGIN + 25, innerY + 20, { size: 10, bold: true });
      let lw = fontBold.widthOfTextAtSize(lbl, 10);
      createField(MARGIN + 28 + lw, innerY + 5, boxWidth - lw - 15, 20);
      if (idx < result.bottom_left_box.length - 1) {
        line(MARGIN + 20, innerY + 32, MARGIN + 20 + boxWidth, innerY + 32, 1);
      }
      innerY += 32;
    });
  }

  if (result.bottom_right_signatures && result.bottom_right_signatures.length > 0) {
    let sigY = boxY + 10;
    let rightColX = MARGIN + (CONTENT_W * 0.52);

    result.bottom_right_signatures.forEach(lbl => {
      text(lbl, rightColX, sigY + 12, { size: 10 });
      let lblW = font.widthOfTextAtSize(lbl, 10);
      line(rightColX + lblW + 8, sigY + 14, MARGIN + CONTENT_W - 20, sigY + 14, 1);
      createField(rightColX + lblW + 8, sigY, (MARGIN + CONTENT_W - 20) - (rightColX + lblW + 8), 14);
      sigY += 32;
    });
  }

  return pdfDoc.save();
}

async function downloadPdf() {
  if (!lastResult) return;
  const btn = document.getElementById('fs-download-btn');
  btn.disabled = true;
  btn.textContent = 'Generating PDF...';
  try {
    const pdfBytes = await buildFillablePdf(lastResult);
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fillable-form.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    setStatus('PDF download failed: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Download Fillable PDF';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const photoInput = document.getElementById('fs-photo-input');
  if (photoInput) photoInput.addEventListener('change', handleFileSelect);

  const scanBtn = document.getElementById('fs-scan-btn');
  if (scanBtn) scanBtn.addEventListener('click', runScan);

  const downloadBtn = document.getElementById('fs-download-btn');
  if (downloadBtn) downloadBtn.addEventListener('click', downloadPdf);
});
