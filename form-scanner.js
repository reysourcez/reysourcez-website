/* ============================================================
   Form Scanner
   Vanilla JS, no dependencies except pdf-lib (loaded via CDN
   script tag in form-scanner.html \u2014 not an npm/build-step
   dependency, just another <script src> like this site's other
   CDN exceptions). The photo/PDF goes to the Cloudflare Worker
   proxy (form-scanner-proxy-worker.js) \u2014 never straight to
   Gemini, and never with a key visible in this file.
   ------------------------------------------------------------
   FLOW: choose a photo or PDF -> the browser itself works out the
   source's orientation (and, for a real PDF, its exact page size)
   -> optional note (structure guidance and/or an explicit request
   to change the OUTPUT size/orientation/font/scale) -> Scan (calls
   the Worker, which returns a structured description of the form
   PLUS any explicit render_directives it read out of the note) ->
   that JSON is shown back as a plain-English preview, including
   what size/orientation the download will use, so a misread column
   header or an unwanted size guess is obvious immediately -> Download
   fillable PDF walks the SAME JSON a second time, this pass building
   an actual PDF with real AcroForm fields (and real checkboxes for
   any tick-box choices) via pdf-lib, entirely client-side, at the
   resolved page size with proportionally scaled fonts/margins.
   Nothing about the source file or the finished PDF is ever sent
   anywhere except that one Worker call \u2014 same "nothing saved on
   our side" rule as every other tool here.

   2026-09-22 rebuild \u2014 see FORM_SCANNER_CHANGE_NOTES.md for the
   full reasoning. In short: this replaces a separate "v4.3 default
   best" build a different AI (Gemini) produced, which worked for
   basic image+PDF scanning but had its own inline theme (no site
   nav/styles.css/AI_BUILD_BRIEF) and always output a locked A4 (or,
   at best, a hardcoded A4/A5 guess) regardless of the source file's
   real size and orientation. This version restores the site's own
   design system, restores the per-browser usage cap Gemini's build
   dropped, and adds real orientation/size detection plus a richer,
   still-optional-everywhere structure schema.

   V1 SCOPE, CARRIED FORWARD (see FORM_SCANNER_SETUP_AND_GLOSSARY.md
   for the fuller KIV list): rebuilds the BLANK template \u2014 labels,
   table headers, row counts, sign-off blocks \u2014 not any handwriting
   already on the page. The preview is read-only; if Gemini misreads
   something, the fix is a clearer retake/rescan or a note, not an
   inline edit, yet. A multi-page PDF only has its first page scanned
   (see readUploadedPdf below) \u2014 turning the rest into more form
   pages is a KIV, not built this round.
   ============================================================ */

console.info('[Form Scanner] script build: 2026-09-22-v5');

/* ================= CONFIG ================= */

const MAX_IMAGE_EDGE = 1280; // px \u2014 resized client-side before it's ever sent
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25MB \u2014 keeps client-side pdf-lib loading responsive; Gemini's own document limit is far higher (50MB/1000 pages) but we don't need to go near it for a single scanned page
const PROXY_ENDPOINT = 'https://form-scanner-proxy.reysourcez-ent.workers.dev'; // unchanged \u2014 same deployed Worker, see FORM_SCANNER_SETUP_AND_GLOSSARY.md

// Same soft-cap pattern as food-worth-calculator.js / market-radar.js:
// one Gemini call per scan, so this caps real Worker cost per browser
// per day rather than relying on goodwill alone. Restored this round
// \u2014 the Gemini-built v4.3 version dropped it. Raise/lower freely.
const MAX_SCANS_PER_DAY = 20;
const USAGE_STORAGE_KEY = 'fs-usage';

// Reference page (A4 portrait, points) that font/margin auto-scaling
// is computed against \u2014 see computeAutoScale().
const A4_W = 595.28, A4_H = 841.89;
const BASE_MARGIN = 42; // at 1:1 (A4) scale

// Standard sizes in points, portrait orientation (w < h). Landscape
// is just w/h swapped \u2014 see resolvePageGeometry().
const STANDARD_SIZES = {
  A3: { w: 841.89, h: 1190.55 },
  A4: { w: 595.28, h: 841.89 },
  A5: { w: 419.53, h: 595.28 },
  Letter: { w: 612, h: 792 },
  Legal: { w: 612, h: 1008 },
};

// Default OFF, per the site's own colorless-fields convention \u2014
// this is a light tint matching --accent-soft from styles.css, only
// ever applied when the person explicitly checks the box.
const FIELD_TINT_RGB = [0.863, 0.918, 0.894];

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

// Standard-14 PDF fonts can't encode characters outside roughly
// Latin-1 \u2014 embedding a real Unicode font (via pdf-lib's fontkit
// plugin) would fix this for non-Latin scripts like Jawi or Chinese,
// but adds a real dependency + a multi-hundred-KB font file, so it's
// flagged in FORM_SCANNER_SETUP_AND_GLOSSARY.md's KIV list rather
// than built this round. Meanwhile: strip what the font can't draw
// rather than let pdf-lib throw and abort the whole PDF build.
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

// Chunked to avoid a call-stack blowout from String.fromCharCode.apply
// on a large single-page PDF's raw bytes.
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/* ================= SOFT USAGE CAP (same pattern as food-worth-calculator.js) ================= */

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

/* ================= GEOMETRY: detecting + resolving page size/orientation =================
   Two very different sources of truth, on purpose:
   - A real uploaded PDF has an exact page size baked in \u2014 pdf-lib
     reads it directly, no guessing needed. This is the fix for the
     bug already seen on this project (an A5-landscape source PDF
     coming back out as A4 portrait): read the source, don't assume.
   - A photo has no true physical page size, only pixel dimensions,
     so we can only reliably detect ORIENTATION from it client-side;
     the size itself is either Gemini's best-effort guess from the
     page's visible proportions, or a plain A4 default, unless the
     person's note asks for something specific. */

function matchStandardSizeLabel(w, h) {
  const tol = 3; // points \u2014 forgiving of the odd rounded-mm-to-pt source
  const pw = Math.min(w, h), ph = Math.max(w, h);
  for (const name of Object.keys(STANDARD_SIZES)) {
    const size = STANDARD_SIZES[name];
    if (Math.abs(pw - size.w) <= tol && Math.abs(ph - size.h) <= tol) return name;
  }
  return null;
}

function describeGeometry(g) {
  if (g.source === 'pdf') {
    const label = matchStandardSizeLabel(g.width, g.height) || 'a custom size';
    return `${label} ${g.orientation} (${Math.round(g.width)}\u00d7${Math.round(g.height)}pt)`;
  }
  return `${g.orientation} framing`;
}

// Combines what the browser detected from the source file with any
// explicit override the person asked for (via the note, interpreted
// by Gemini into render_directives) and, for a photo only, Gemini's
// own best-effort size guess. A real PDF's own exact dimensions
// always win unless the note explicitly names a different size.
function resolvePageGeometry(result, detected) {
  const rd = (result && result.render_directives) || {};
  const orientation = (rd.orientation && rd.orientation !== 'auto') ? rd.orientation
    : (detected.orientation || (result && result.orientation) || 'portrait');

  let w, h, sizeLabel;
  const sizeOverridden = rd.page_size && rd.page_size !== 'auto';

  if (detected.source === 'pdf' && !sizeOverridden) {
    w = detected.width; h = detected.height;
    const detectedIsLandscape = w > h;
    const wantLandscape = orientation === 'landscape';
    if (detectedIsLandscape !== wantLandscape) { const t = w; w = h; h = t; }
    sizeLabel = matchStandardSizeLabel(detected.width, detected.height) || 'custom';
  } else {
    const guess = result && result.page_size_guess;
    const sizeName = sizeOverridden ? rd.page_size
      : (detected.source === 'image' && guess && guess !== 'unsure' ? guess : 'A4');
    const base = STANDARD_SIZES[sizeName] || STANDARD_SIZES.A4;
    w = orientation === 'landscape' ? Math.max(base.w, base.h) : Math.min(base.w, base.h);
    h = orientation === 'landscape' ? Math.min(base.w, base.h) : Math.max(base.w, base.h);
    sizeLabel = sizeName;
  }
  return { w, h, orientation, sizeLabel };
}

// Font/margin/row-height scale relative to A4 \u2014 area-based (not a
// hardcoded A4-vs-A5 binary) so it generalises to any target size:
// same area as A4 (e.g. A4 landscape) scales 1:1, half the area
// (A5, either orientation) scales to ~0.71\u00d7 \u2014 matching the 0.707
// constant an earlier build used specifically for A5 \u2014 and anything
// BIGGER than A4 (e.g. A3) is capped at 1\u00d7 rather than scaled up,
// since more paper should mean more breathing room, not bigger text.
function computeAutoScale(pageW, pageH) {
  const areaRatio = (pageW * pageH) / (A4_W * A4_H);
  return Math.min(1, Math.sqrt(areaRatio));
}

/* ================= FILE HANDLING (image or PDF) ================= */

function resizeImageToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error("That file doesn't look like a photo or a PDF."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Couldn't open that image. Try a different file."));
      img.onload = () => {
        const naturalWidth = img.width, naturalHeight = img.height;
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
        resolve({ base64: dataUrl.split(',')[1], previewUrl: dataUrl, naturalWidth, naturalHeight });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Reads a real PDF's exact page-1 size (ground truth, no guessing)
// and hands back a single-page copy \u2014 both so the Gemini call stays
// scoped to one form even if the source has several pages (see the
// multi-page KIV in the file header), and so a large multi-page
// source doesn't need to be re-uploaded in full for the structure
// read itself.
async function readUploadedPdf(file) {
  if (file.size > MAX_PDF_BYTES) {
    throw new Error('That PDF is quite large for a browser-side scan \u2014 try a smaller file, or export just the one page you need first.');
  }
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let srcDoc;
  try {
    srcDoc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch (e) {
    throw new Error("Couldn't open that PDF \u2014 it may be corrupted or password-protected.");
  }
  const pageCount = srcDoc.getPageCount();
  if (pageCount < 1) throw new Error('That PDF has no pages.');
  const first = srcDoc.getPage(0);
  const { width, height } = first.getSize();

  const singlePageDoc = await PDFLib.PDFDocument.create();
  const [copiedPage] = await singlePageDoc.copyPages(srcDoc, [0]);
  singlePageDoc.addPage(copiedPage);
  const singlePageBytes = await singlePageDoc.save();

  return { pageCount, width, height, base64: bytesToBase64(singlePageBytes) };
}

let currentImageBase64 = null;
let currentMimeType = 'image/jpeg';
let detectedGeometry = { source: 'image', orientation: 'portrait' };

function showImagePreview(url) {
  const img = document.getElementById('fs-preview-img');
  img.src = url;
  img.hidden = false;
  document.getElementById('fs-pdf-preview').hidden = true;
  document.getElementById('fs-upload-zone').classList.add('has-image');
}
function showPdfPreview(name) {
  document.getElementById('fs-preview-img').hidden = true;
  const pdfPreview = document.getElementById('fs-pdf-preview');
  pdfPreview.hidden = false;
  document.getElementById('fs-pdf-filename').textContent = name;
  document.getElementById('fs-upload-zone').classList.add('has-image');
}

async function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
  document.getElementById('fs-scan-btn').disabled = true;
  setStatus(isPdf ? 'Reading PDF\u2026' : 'Preparing photo\u2026');
  try {
    if (isPdf) {
      const info = await readUploadedPdf(file);
      currentImageBase64 = info.base64;
      currentMimeType = 'application/pdf';
      detectedGeometry = { source: 'pdf', width: info.width, height: info.height, orientation: info.width > info.height ? 'landscape' : 'portrait' };
      showPdfPreview(file.name);
      document.getElementById('fs-scan-btn').disabled = false;
      let msg = `PDF ready \u2014 detected ${describeGeometry(detectedGeometry)}.`;
      if (info.pageCount > 1) msg += ` This file has ${info.pageCount} pages \u2014 only page 1 will be scanned.`;
      setStatus(msg + ' Add a note if it helps, then Scan.');
    } else {
      const { base64, previewUrl, naturalWidth, naturalHeight } = await resizeImageToBase64(file);
      currentImageBase64 = base64;
      currentMimeType = 'image/jpeg';
      detectedGeometry = { source: 'image', orientation: naturalWidth > naturalHeight ? 'landscape' : 'portrait' };
      showImagePreview(previewUrl);
      document.getElementById('fs-scan-btn').disabled = false;
      setStatus(`Photo ready \u2014 detected ${describeGeometry(detectedGeometry)}. Add a note if it helps, then Scan.`);
    }
  } catch (err) {
    currentImageBase64 = null;
    setStatus(err.message || 'Could not read that file.', true);
  }
}

/* ================= PROXY CALL ================= */

async function scanForm(imageBase64, mimeType, note) {
  let response;
  try {
    response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, mime_type: mimeType, note: note || undefined }),
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

/* ================= RESULT PREVIEW (read-only, see file header) ================= */

let lastResult = null;

function renderPreview(result) {
  document.getElementById('fs-preview-title').textContent = result.title || 'Untitled form';

  const subtitleEl = document.getElementById('fs-preview-subtitle');
  if (result.subtitles && result.subtitles.length) {
    subtitleEl.textContent = result.subtitles.join(' \u00b7 ');
    subtitleEl.hidden = false;
  } else {
    subtitleEl.hidden = true;
  }

  document.getElementById('fs-preview-ref').textContent = result.reference_code || '';

  const geometry = resolvePageGeometry(result, detectedGeometry);
  const rd = result.render_directives || {};
  const overridden = (rd.page_size && rd.page_size !== 'auto') || (rd.orientation && rd.orientation !== 'auto');
  const sourceNote = overridden ? 'from your note' : (detectedGeometry.source === 'pdf' ? 'matches source PDF' : 'detected from photo');
  document.getElementById('fs-preview-geometry').textContent = `Output will be ${geometry.sizeLabel} ${geometry.orientation} (${sourceNote})`;

  const hfGroup = document.getElementById('fs-header-fields-group');
  const hfEl = document.getElementById('fs-header-fields');
  if (result.header_fields.length) {
    hfGroup.hidden = false;
    hfEl.innerHTML = result.header_fields.map((f) => {
      const optSuffix = f.options && f.options.length ? ` (${f.options.join(' / ')})` : '';
      return `<span class="fs-field-tag${f.multiline ? ' is-multiline' : ''}">${escapeHTML(f.label + optSuffix)}</span>`;
    }).join('');
  } else {
    hfGroup.hidden = true;
  }

  const tblGroup = document.getElementById('fs-tables-group');
  const tblEl = document.getElementById('fs-tables');
  if (result.tables.length) {
    tblGroup.hidden = false;
    tblEl.innerHTML = result.tables.map((t) => {
      const groupLine = (t.column_groups && t.column_groups.length)
        ? `<p class="fs-table-groups">Grouped header: ${t.column_groups.map((g) => escapeHTML(g.label)).join(' &middot; ')}</p>` : '';
      return `
      <div class="fs-table-card">
        <p class="fs-table-card-title">${escapeHTML(t.section_title || 'Table')}</p>
        ${groupLine}
        <p class="fs-table-cols">${t.columns.map(escapeHTML).join(' &middot; ')}</p>
        <p class="fs-table-rows">${t.blank_row_count} blank row${t.blank_row_count === 1 ? '' : 's'}</p>
      </div>`;
    }).join('');
  } else {
    tblGroup.hidden = true;
  }

  const refGroup = document.getElementById('fs-reference-tables-group');
  const refEl = document.getElementById('fs-reference-tables');
  if (result.reference_tables && result.reference_tables.length) {
    refGroup.hidden = false;
    refEl.innerHTML = result.reference_tables.map((rt) => `
      <div class="fs-table-card">
        <p class="fs-table-card-title">${escapeHTML(rt.title || 'Reference table')}</p>
        <p class="fs-table-cols">${rt.columns.map(escapeHTML).join(' &middot; ')}</p>
        <p class="fs-table-rows">${rt.rows.length} printed row${rt.rows.length === 1 ? '' : 's'} \u2014 shown as printed, not fillable</p>
      </div>`).join('');
  } else {
    refGroup.hidden = true;
  }

  const sigGroup = document.getElementById('fs-signatures-group');
  const sigEl = document.getElementById('fs-signatures');
  if (result.signature_blocks.length) {
    sigGroup.hidden = false;
    sigEl.innerHTML = result.signature_blocks.map((s) => `
      <div class="fs-sig-card">
        <span class="fs-sig-card-title">${escapeHTML(s.heading || 'Signature')}</span>
        <span class="fs-sig-card-fields">${s.fields.map(escapeHTML).join(' &middot; ')}</span>
      </div>`).join('');
  } else {
    sigGroup.hidden = true;
  }

  const fnGroup = document.getElementById('fs-footnotes-group');
  const fnEl = document.getElementById('fs-footnotes');
  if (result.footnotes && result.footnotes.length) {
    fnGroup.hidden = false;
    fnEl.innerHTML = result.footnotes.map((f) => `<li>${escapeHTML(f)}</li>`).join('');
  } else {
    fnGroup.hidden = true;
  }

  document.getElementById('fs-results-section').hidden = false;
  document.getElementById('fs-results-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ================= ANALYZE FLOW ================= */

async function runScan() {
  if (!currentImageBase64) { setStatus('Choose a photo or PDF first.', true); return; }
  if (getUsageToday() + 1 > MAX_SCANS_PER_DAY) {
    setStatus('This browser has hit today\u2019s scan limit. Try again tomorrow.', true);
    return;
  }
  const btn = document.getElementById('fs-scan-btn');
  btn.disabled = true;
  setStatus('Reading the form\u2026 this can take a few seconds.');

  try {
    const note = document.getElementById('fs-note').value.trim();
    const result = await scanForm(currentImageBase64, currentMimeType, note);
    recordUsage();
    if (!result.recognized) {
      setStatus('Couldn\u2019t make out a form in that file \u2014 try a straighter, closer, better-lit photo, or a clearer PDF page.', true);
      return;
    }
    lastResult = result;
    renderPreview(result);
    const geometry = resolvePageGeometry(result, detectedGeometry);
    setStatus(`Found ${result.header_fields.length} field${result.header_fields.length === 1 ? '' : 's'}, ${result.tables.length} table${result.tables.length === 1 ? '' : 's'}, ${result.signature_blocks.length} sign-off block${result.signature_blocks.length === 1 ? '' : 's'}. Output will be ${geometry.sizeLabel} ${geometry.orientation}.`);
  } catch (err) {
    setStatus(err.message || 'Something went wrong. Try again.', true);
  } finally {
    btn.disabled = false;
  }
}

/* ================= PDF BUILDER (pdf-lib, all client-side) =================
   Walks the exact same JSON the preview above renders \u2014 nothing here
   re-derives anything from the source file, so the PDF always matches
   what was already shown on screen. Coordinates use "distance from
   top of page" throughout (y grows downward) via toPdfY(), same
   convention this project's one-off reportlab scripts use, kept
   identical here so the two are easy to compare.

   Every static AND interactive element goes through the same small
   set of helpers (text/line/vline/rect/field/checkboxField), and
   every one of them runs its raw pixel values through s() first \u2014
   one scale factor, applied everywhere, computed once from the
   resolved page size (see computeAutoScale). Table/signature/header
   borders are drawn incrementally, row by row, rather than as one
   precomputed outer rectangle \u2014 that way a table that happens to
   split across a page break still gets a correctly-scoped border on
   both pages instead of one box drawn at the wrong height (a real
   bug inherited from \u2014 and fixed relative to \u2014 both earlier
   builds; see FORM_SCANNER_CHANGE_NOTES.md). */

function wrapToWidth(font, text, size, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
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

function pickFonts(family) {
  const { StandardFonts } = PDFLib;
  if (family === 'times') return { reg: StandardFonts.TimesRoman, bold: StandardFonts.TimesRomanBold };
  if (family === 'courier') return { reg: StandardFonts.Courier, bold: StandardFonts.CourierBold };
  return { reg: StandardFonts.Helvetica, bold: StandardFonts.HelveticaBold };
}

async function buildFillablePdf(result, options) {
  const { PDFDocument, rgb } = PDFLib;
  const shadeFields = !!(options && options.shadeFields);

  const geometry = resolvePageGeometry(result, detectedGeometry);
  const rd = result.render_directives || {};
  const autoScale = computeAutoScale(geometry.w, geometry.h);
  const userScale = (rd.font_scale_pct || 100) / 100;
  const SCALE = autoScale * userScale;
  const s = (v) => v * SCALE;

  const PAGE_W = geometry.w, PAGE_H = geometry.h;
  const MARGIN = s(BASE_MARGIN);
  const CONTENT_W = PAGE_W - MARGIN * 2;

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(cleanPdfText(result.title) || 'Scanned form');
  const fontNames = pickFonts(rd.font_family);
  const font = await pdfDoc.embedFont(fontNames.reg);
  const fontBold = await pdfDoc.embedFont(fontNames.bold);
  const form = pdfDoc.getForm();
  const FIELD_TINT = rgb(FIELD_TINT_RGB[0], FIELD_TINT_RGB[1], FIELD_TINT_RGB[2]);
  const GRAY = rgb(0.78, 0.78, 0.78);

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = MARGIN;
  let fieldCounter = 0;
  let overflowWarned = false;

  const toPdfY = (yTop) => PAGE_H - yTop;

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = MARGIN;
  }
  function ensureSpace(h) {
    if (y + h > PAGE_H - MARGIN) { newPage(); return true; }
    return false;
  }
  function flagIfOverflowing(label) {
    // Multi-column header/signature blocks (below) don't paginate
    // mid-block \u2014 see their own comments. This is the safety net:
    // no silent broken PDF, just a clear console warning naming
    // which block to check if the download ever looks cut off.
    if (!overflowWarned && y > PAGE_H - MARGIN) {
      overflowWarned = true;
      console.warn(`[Form Scanner] "${label}" may have overflowed the page \u2014 if the downloaded PDF looks cut off, try a note asking for a larger page size.`);
    }
  }
  function text(str, x, yTop, opts) {
    opts = opts || {};
    const cleaned = cleanPdfText(str);
    if (!cleaned) return;
    const size = s(opts.size || 9);
    const useFont = opts.bold ? fontBold : font;
    let drawX = x;
    if (opts.align === 'center') drawX = x - useFont.widthOfTextAtSize(cleaned, size) / 2;
    else if (opts.align === 'right') drawX = x - useFont.widthOfTextAtSize(cleaned, size);
    try {
      page.drawText(cleaned, { x: drawX, y: toPdfY(yTop), size, font: useFont, color: rgb(0, 0, 0) });
    } catch (e) {
      console.warn('[Form Scanner] could not draw a label, skipped:', cleaned);
    }
  }
  function line(x1, yTop, x2, w) {
    page.drawLine({ start: { x: x1, y: toPdfY(yTop) }, end: { x: x2, y: toPdfY(yTop) }, thickness: s(w || 0.75), color: rgb(0, 0, 0) });
  }
  function vline(x, yTop1, yTop2, w) {
    if (yTop2 <= yTop1) return;
    page.drawLine({ start: { x, y: toPdfY(yTop1) }, end: { x, y: toPdfY(yTop2) }, thickness: s(w || 0.6), color: rgb(0, 0, 0) });
  }
  function rect(x, yTop, w, h, opts) {
    opts = opts || {};
    page.drawRectangle({ x, y: toPdfY(yTop + h), width: w, height: h, borderColor: rgb(0, 0, 0), borderWidth: s(opts.borderWidth != null ? opts.borderWidth : 0.9), color: opts.fill });
  }
  function field(x, yTop, w, h, opts) {
    opts = opts || {};
    fieldCounter++;
    const tf = form.createTextField('field_' + fieldCounter);
    if (opts.multiline) tf.enableMultiline();
    try { tf.setFontSize(s(8)); } catch (e) {}
    const addOpts = { x, y: toPdfY(yTop + h), width: w, height: Math.max(h, 2), borderWidth: 0 };
    if (shadeFields) addOpts.backgroundColor = FIELD_TINT;
    tf.addToPage(page, addOpts);
    return tf;
  }
  function checkboxField(x, yTop, size) {
    fieldCounter++;
    const cb = form.createCheckBox('field_' + fieldCounter);
    const addOpts = { x, y: toPdfY(yTop + size), width: size, height: size, borderWidth: s(0.8) };
    if (shadeFields) addOpts.backgroundColor = FIELD_TINT;
    cb.addToPage(page, addOpts);
    return cb;
  }
  // Full-width checkbox-choice row: "Label : [ ] opt1  [ ] opt2 ..."
  // with real interactive checkboxes, not just bracket characters.
  // Always full width regardless of the field's assigned column \u2014
  // see FORM_SCANNER_SETUP_AND_GLOSSARY.md for why this is a
  // deliberate simplification, not an oversight.
  function renderOptionsRow(f, x, yTop, maxW) {
    const size = 9, cbSize = s(8);
    text(f.label + ' :', x, yTop + s(10), { size, bold: true });
    let cx = x + fontBold.widthOfTextAtSize(cleanPdfText(f.label + ' :'), s(size)) + s(8);
    let rowTop = yTop, rows = 1;
    f.options.forEach((opt) => {
      const optW = font.widthOfTextAtSize(cleanPdfText(opt), s(8)) + cbSize + s(14);
      if (cx + optW > x + maxW && cx > x) {
        cx = x;
        yTop += s(14);
        rows++;
      }
      checkboxField(cx, yTop + s(2), cbSize);
      text(opt, cx + cbSize + s(4), yTop + s(10), { size: 8 });
      cx += optW;
    });
    return rows * s(14) + s(10);
  }

  // ---- Title / subtitles / reference code ----
  text(result.title || 'Scanned form', PAGE_W / 2, y + s(16), { size: 15, bold: true, align: 'center' });
  y += s(22);
  if (result.reference_code) {
    text(result.reference_code, PAGE_W - MARGIN, y, { size: 9, align: 'right' });
  }
  (result.subtitles || []).forEach((sub) => {
    text(sub, PAGE_W / 2, y + s(9), { size: 9.5, bold: true, align: 'center' });
    y += s(13);
  });
  y += s(14);

  // ---- Header fields: rendered per-column (or one stacked column if
  // the source genuinely only has one), with plain fields and
  // checkbox-choice rows interleaved in their real order within each
  // column \u2014 2026-09-23 fix: a field like a payment-method choice
  // used to always render full-width in a separate pass after every
  // plain field, regardless of which column it actually belonged in.
  // renderField() below picks the right drawing path per field so
  // both kinds share one column-aware loop instead of two passes. ----
  const renderField = (f, x, yTop, w) => {
    if (f.options && f.options.length) return renderOptionsRow(f, x, yTop, w);
    const h = f.multiline ? s(28) : s(15);
    text(f.label + ' :', x, yTop + s(10), { size: 8.5, bold: true });
    const labelW = fontBold.widthOfTextAtSize(cleanPdfText(f.label + ' :'), s(8.5)) + s(8);
    const fx = x + labelW;
    const fw = Math.max(x + w - fx, s(24));
    field(fx, yTop, fw, h, { multiline: f.multiline });
    line(fx, yTop + h, x + w, 0.75);
    return h + s(9);
  };

  if (result.header_fields.length) {
    const columnsUsed = Array.from(new Set(result.header_fields.map((f) => f.column || 1))).sort((a, b) => a - b);
    if (columnsUsed.length <= 1) {
      result.header_fields.forEach((f) => {
        ensureSpace(s(30));
        y += renderField(f, MARGIN, y, CONTENT_W);
      });
    } else {
      // Side-by-side columns don't paginate mid-block \u2014 see
      // flagIfOverflowing(). A rough pre-estimate at least starts the
      // block on a fresh page when it clearly won't fit what's left.
      const numCols = Math.min(columnsUsed.length, 3);
      const colW = CONTENT_W / numCols;
      const maxFieldsInCol = Math.max.apply(null, columnsUsed.slice(0, numCols).map((cn) => result.header_fields.filter((f) => (f.column || 1) === cn).length));
      ensureSpace(maxFieldsInCol * s(25) + s(10));
      const blockTop = y;
      let maxBottom = y;
      columnsUsed.slice(0, numCols).forEach((cn, idx) => {
        const colX = MARGIN + idx * colW;
        let cy = y;
        result.header_fields.filter((f) => (f.column || 1) === cn).forEach((f) => {
          cy += renderField(f, colX + s(4), cy, colW - s(10));
        });
        maxBottom = Math.max(maxBottom, cy);
      });
      for (let i = 1; i < numCols; i++) vline(MARGIN + i * colW, blockTop, maxBottom - s(4), 0.5);
      y = maxBottom;
      flagIfOverflowing('multi-column header fields');
    }
    y += s(6);
  }

  // ---- Tables ----
  result.tables.forEach((t) => {
    ensureSpace(s(40));
    if (t.section_title) {
      rect(MARGIN, y, CONTENT_W, s(16), { fill: GRAY });
      text(t.section_title, PAGE_W / 2, y + s(11), { size: 9.5, bold: true, align: 'center' });
      y += s(16);
    }

    let colWidths;
    if (t.columns_width_pct && t.columns_width_pct.length === t.columns.length) {
      const totalPct = t.columns_width_pct.reduce((a, b) => a + b, 0);
      colWidths = t.columns_width_pct.map((pct) => (pct / totalPct) * CONTENT_W);
    } else {
      const weights = t.columns.map((c) => Math.max(3, c.length));
      const totalWeight = weights.reduce((a, w) => a + w, 0);
      colWidths = weights.map((w) => (w / totalWeight) * CONTENT_W);
    }
    const colX = [MARGIN];
    colWidths.forEach((w) => colX.push(colX[colX.length - 1] + w));

    const hasGroups = t.column_groups && t.column_groups.length > 0;
    const groupRowH = s(14);
    const headerRowH = s(22);

    // Draws one header block (group row + column row) and its own
    // borders, scoped only to itself \u2014 called again on each new
    // page a long table spills onto, so the grid never spans a page
    // break incorrectly (see the file-header comment on this fix).
    const drawHeaderRow = () => {
      const headerTop = y;
      if (hasGroups) {
        rect(MARGIN, y, CONTENT_W, groupRowH, { fill: rgb(0.82, 0.82, 0.82) });
        let ci = 0;
        t.column_groups.forEach((g) => {
          const gx1 = colX[ci];
          const spanEnd = Math.min(ci + g.span, t.columns.length);
          const gx2 = colX[spanEnd];
          text(g.label, (gx1 + gx2) / 2, y + s(10), { size: 7.5, bold: true, align: 'center' });
          ci = spanEnd;
        });
        y += groupRowH;
      }
      rect(MARGIN, y, CONTENT_W, headerRowH, { fill: rgb(0.88, 0.88, 0.88) });
      t.columns.forEach((c, i) => {
        const lines = wrapToWidth(fontBold, cleanPdfText(c), s(7), colWidths[i] - s(6));
        const startY = y + (lines.length === 1 ? s(14) : s(9));
        lines.slice(0, 2).forEach((ln, li) => {
          text(ln, colX[i] + colWidths[i] / 2, startY + li * s(9), { size: 7, bold: true, align: 'center' });
        });
      });
      line(MARGIN, y, MARGIN + CONTENT_W, 0.9);
      y += headerRowH;
      line(MARGIN, y, MARGIN + CONTENT_W, 0.75);
      colX.forEach((x) => vline(x, headerTop, y, 0.75));
      if (hasGroups) {
        let ci2 = 0;
        t.column_groups.slice(0, -1).forEach((g) => { ci2 += g.span; vline(colX[ci2], headerTop, headerTop + groupRowH, 0.75); });
      }
    };
    drawHeaderRow();

    for (let r = 0; r < t.blank_row_count; r++) {
      const paginated = ensureSpace(s(18));
      if (paginated) drawHeaderRow();
      const rowTop = y;
      t.columns.forEach((c, i) => {
        field(colX[i] + s(3), y + s(2), Math.max(colWidths[i] - s(6), s(10)), s(14));
      });
      y += s(18);
      line(MARGIN, y, MARGIN + CONTENT_W, 0.75);
      colX.forEach((x) => vline(x, rowTop, y, 0.6));
    }
    y += s(14);
  });

  // ---- Reference tables: printed lookup data, no fields ----
  (result.reference_tables || []).forEach((rt) => {
    ensureSpace(s(30));
    if (rt.title) {
      text(rt.title, MARGIN, y + s(10), { size: 9, bold: true });
      y += s(16);
    }
    const weights = rt.columns.map((c) => Math.max(3, c.length));
    const totalWeight = weights.reduce((a, w) => a + w, 0);
    const colWidths = weights.map((w) => (w / totalWeight) * CONTENT_W);
    const colX = [MARGIN];
    colWidths.forEach((w) => colX.push(colX[colX.length - 1] + w));

    const headerTop = y;
    rect(MARGIN, y, CONTENT_W, s(13), { fill: rgb(0.88, 0.88, 0.88) });
    rt.columns.forEach((c, i) => text(c, colX[i] + colWidths[i] / 2, y + s(9), { size: 7, bold: true, align: 'center' }));
    y += s(13);
    line(MARGIN, y, MARGIN + CONTENT_W, 0.75);
    colX.forEach((x) => vline(x, headerTop, y, 0.6));

    rt.rows.forEach((row) => {
      ensureSpace(s(12));
      const rowTop = y;
      row.forEach((cell, i) => {
        if (i >= colWidths.length) return;
        text(cell, colX[i] + colWidths[i] / 2, y + s(8), { size: 7, align: 'center' });
      });
      y += s(12);
      line(MARGIN, y, MARGIN + CONTENT_W, 0.5);
      colX.forEach((x) => vline(x, rowTop, y, 0.5));
    });
    y += s(12);
  });

  // ---- Amount in words (single emphasised line, e.g. receipts) ----
  if (result.amount_in_words_label) {
    ensureSpace(s(22));
    rect(MARGIN, y, CONTENT_W, s(16));
    text(result.amount_in_words_label, MARGIN + s(6), y + s(11), { size: 8, bold: true });
    const lblW = fontBold.widthOfTextAtSize(cleanPdfText(result.amount_in_words_label), s(8)) + s(10);
    field(MARGIN + lblW, y + s(2), Math.max(CONTENT_W - lblW - s(6), s(30)), s(12));
    y += s(22);
  }

  // ---- Signature blocks: side by side (2\u20134 columns) or stacked ----
  const sigs = result.signature_blocks;
  if (sigs.length) {
    const columnsUsed = Array.from(new Set(sigs.map((sb) => sb.column || 1))).sort((a, b) => a - b);
    if (columnsUsed.length <= 1) {
      sigs.forEach((sBlock) => {
        ensureSpace(s(20) + sBlock.fields.length * s(20));
        text(sBlock.heading || 'Signature', MARGIN, y + s(10), { size: 9.5, bold: true });
        y += s(22);
        sBlock.fields.forEach((fl) => {
          text(fl + ' :', MARGIN, y + s(10), { size: 8.5, bold: true });
          const lw = fontBold.widthOfTextAtSize(cleanPdfText(fl + ' :'), s(8.5)) + s(8);
          field(MARGIN + lw, y, s(240), s(14));
          line(MARGIN + lw, y + s(14), MARGIN + lw + s(240), 0.75);
          y += s(20);
        });
        y += s(8);
      });
    } else {
      const numCols = Math.min(columnsUsed.length, 4);
      const colW = CONTENT_W / numCols;
      const estimate = Math.max.apply(null, columnsUsed.slice(0, numCols).map((cn) =>
        sigs.filter((sb) => (sb.column || 1) === cn).reduce((sum, b) => sum + 1 + b.fields.length, 0)));
      ensureSpace(estimate * s(15) + s(10));
      let maxBottom = y;
      columnsUsed.slice(0, numCols).forEach((cn, idx) => {
        const x = MARGIN + idx * colW;
        let cy = y;
        sigs.filter((sb) => (sb.column || 1) === cn).forEach((sBlock) => {
          text(sBlock.heading || 'Signature', x + s(4), cy + s(9), { size: 9, bold: true });
          cy += s(15);
          sBlock.fields.forEach((fl) => {
            text(fl + ' :', x + s(4), cy + s(9), { size: 8, bold: true });
            const lw = fontBold.widthOfTextAtSize(cleanPdfText(fl + ' :'), s(8)) + s(6);
            const fw = Math.max(colW - s(20) - lw, s(20));
            field(x + s(4) + lw, cy, fw, s(11));
            line(x + s(4) + lw, cy + s(11), x + s(4) + lw + fw, 0.75);
            cy += s(14);
          });
          cy += s(6);
        });
        maxBottom = Math.max(maxBottom, cy);
      });
      y = maxBottom;
      flagIfOverflowing('multi-column signature blocks');
    }
  }

  // ---- Footnotes ----
  if (result.footnotes && result.footnotes.length) {
    y += s(4);
    result.footnotes.forEach((fn) => {
      ensureSpace(s(10));
      text(fn, MARGIN, y + s(7), { size: 6.5 });
      y += s(9);
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
    const shadeFields = document.getElementById('fs-color-toggle').checked;
    const pdfBytes = await buildFillablePdf(lastResult, { shadeFields });
    const blob = new Blob([pdfBytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (lastResult.title || 'scanned-form').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    a.href = url;
    a.download = (safeName || 'scanned-form') + '.pdf';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    setStatus('Could not build the PDF (' + (err.message || 'unknown error') + '). Try scanning again.', true);
    console.error('[Form Scanner] PDF build failed:', err);
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
