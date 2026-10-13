/* ============================================================
   Form Scanner — page wiring
   Version: v6.8 (2026-10-13) — Compare all skips retired engines (COMPARE_SKIP) and counts only the engines it will really call (on top of v6.7: log rows show tokens / neurons / tries, slow engines get an "allow minutes" message; v6.6: engines come from the Worker (any engine with a key shows up), Auto tries them best-first, Compare all runs every ready engine, the wording read falls back across engines (on top of v6.5: full engine errors in the log; v6.4: source/output side by side, log by source, tooltips)
   Vanilla JS, loaded after form-scanner-engine.js (the layout/PDF-building
   logic, see that file) and pdf-lib (CDN script tag in form-scanner.html).
   This file only does DOM + the Worker calls: file selection, calling
   the Worker proxy, rendering the detected-structure preview, and wiring
   the download button to FormScannerEngine.buildFillablePdf(). Nothing
   about the photo/PDF or the finished PDF is ever sent anywhere except
   those Worker calls: same "nothing saved on our side" rule as every
   other tool here.
   ============================================================ */

console.info('[Form Scanner] page build: v6.8 (2026-10-13)');

const E = window.FormScannerEngine;
const CFG = E.FS_CONFIG;

/* ---- page state ---- */
let lastSpec = null, lastPage = null;   // the result shown on the right
let pvUrl = null, pvSeq = 0;            // live PDF preview (blob URL, build counter)
let selId = 0;                          // guards async file reads
let current = null;                     // the file ready to scan: { kind, base64, mimeType, src, raster }
const sources = new Map();              // every file chosen this visit: id -> { id, name, meta, previewUrl, thumb, ar }
let srcSeq = 0, activeSrc = null, viewSrcId = 0;
let scanSeq = 0, scanning = false;      // guards a running scan against a newer file
const runs = [];                        // comparison log (this visit only, nothing saved)
let runSeq = 0;

/* ================= small DOM helpers ================= */
function $(id) { return document.getElementById(id); }
function setStatus(text, level) {
  const el = $('fs-status');
  el.textContent = text || '';
  el.classList.toggle('is-error', level === 'error');
  el.classList.toggle('is-warn', level === 'warn');
}
// v6.4: escapes quotes too, because labels are written into value="..." and title="..." attributes
function escapeHTML(str) {
  return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const shortEngine = (s) => String(s || '').replace(/(^|\s)[a-z0-9-]+\//gi, '$1').replace(/:free\b/g, ' (free)').trim();

/* ================= tooltips (tap, hover, keyboard) =================
   Page-scoped on purpose: the shared .tooltip-icon is hover-only and hidden under 600px, so phones would lose every
   description, and its bubble can run off the screen edge. This one is fixed-position and clamped to the viewport.
   FLAG for central review (AI_BUILD_BRIEF.md says reuse shared classes): candidate to promote to styles.css + a shared script. */
function initTips() {
  const pop = document.createElement('div');
  pop.id = 'fs-tip-pop'; pop.setAttribute('role', 'tooltip'); pop.hidden = true;
  document.body.appendChild(pop);
  let owner = null, pinned = false;
  const tipOf = (n) => (n && n.closest ? n.closest('.fs-tip') : null);
  function hide() {
    if (owner) owner.removeAttribute('aria-describedby');
    pop.hidden = true; owner = null; pinned = false;
  }
  function show(el, pin) {
    if (owner && owner !== el) owner.removeAttribute('aria-describedby');
    owner = el; pinned = !!pin;
    pop.textContent = el.getAttribute('data-tip') || '';
    pop.style.left = '0px'; pop.style.top = '0px';           // measure at a neutral spot so the old position can't squeeze the width
    pop.hidden = false;
    el.setAttribute('aria-describedby', 'fs-tip-pop');
    const r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    const vw = document.documentElement.clientWidth;
    pop.style.left = Math.max(8, Math.min(r.left + r.width / 2 - pw / 2, vw - pw - 8)) + 'px';
    pop.style.top = (r.top - ph - 10 >= 8 ? r.top - ph - 10 : r.bottom + 10) + 'px';
  }
  if (window.matchMedia && window.matchMedia('(hover: hover)').matches) {
    document.addEventListener('mouseover', (e) => { const t = tipOf(e.target); if (t && !pinned) show(t, false); });
    document.addEventListener('mouseout', (e) => { const t = tipOf(e.target); if (t && !pinned && !t.contains(e.relatedTarget)) hide(); });
  }
  document.addEventListener('focusin', (e) => { const t = tipOf(e.target); if (t && !pinned) show(t, false); });
  document.addEventListener('focusout', (e) => { const t = tipOf(e.target); if (t && !pinned) hide(); });
  document.addEventListener('click', (e) => {
    const t = tipOf(e.target);
    if (!t) { if (owner) hide(); return; }
    e.preventDefault();                                       // a tip inside <summary> must not toggle the panel
    if (owner === t && pinned) hide(); else show(t, true);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
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
  catch (e) { /* private browsing etc.: soft cap only, fine to skip */ }
}

/* ================= engines (v6.6): the Worker says which engines it has keys for ================= */
let engines = [], enginesPromise = null;
const eng = (id) => engines.find((e) => e.id === id) || null;
const engLabel = (id) => (eng(id) ? eng(id).label : id);
const shortName = (label) => String(label || '').split(' \u00b7 ')[0];     // "Mistral Small", "Gemini": how to name an engine inside a sentence

async function loadEngines() {
  let list = null;
  try {
    const r = await fetch(CFG.PROXY_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'engines' }) });
    const d = await r.json();
    if (r.ok && d && Array.isArray(d.engines) && d.engines.length) list = d.engines;
  } catch (e) { /* offline, or an older Worker that does not know this request: use the built-in list */ }
  engines = list || CFG.ENGINES_FALLBACK.map((x) => Object.assign({ needs: '', free: true }, x));
  fillEngineSelect();
  if (!list) setStatus('Could not ask the server which engines are set up, so the basic list is shown. If this stays, redeploy the Worker (setup doc).', 'warn');
}

function fillEngineSelect() {
  const sel = $('fs-provider'), keep = sel.value;
  const ready = engines.filter((e) => e.ready), off = engines.filter((e) => !e.ready);
  const opt = (v, t, dis) => `<option value="${escapeHTML(v)}"${dis ? ' disabled' : ''}>${escapeHTML(t)}</option>`;
  let html = opt('auto', 'Auto: best available (recommended)');
  const nAll = E.planAll(engines, CFG.AUTO_ORDER, CFG.COMPARE_SKIP).length;
  if (nAll > 1) html += opt('all', `Compare all ready engines (${nAll})`);
  if (ready.length) html += `<optgroup label="One engine">${ready.map((e) => opt(e.id, e.label + (e.free === false ? ' (paid)' : ''))).join('')}</optgroup>`;
  if (off.length) html += `<optgroup label="Not set up yet (see the setup doc)">${off.map((e) => opt(e.id, `${e.label}: needs ${e.needs}`, true)).join('')}</optgroup>`;
  sel.innerHTML = html;
  sel.value = Array.from(sel.options).some((o) => o.value === keep && !o.disabled) ? keep : 'auto';
}

/* ================= source pane (left) and output pane (right) ================= */
function setAspect(ar) {
  if (ar > 0.2 && ar < 5) $('fs-compare').style.setProperty('--fs-ar', ar.toFixed(4));   // both boxes share one shape so they line up
}
function setSourceHead(s) {
  const el = $('fs-src-sub');
  const text = s ? s.name + (s.meta ? ', ' + s.meta : '') : '';
  el.textContent = text; el.title = text;
}
function paintSource(s) {                                     // show a file in the left pane
  viewSrcId = s.id;
  $('fs-src-empty').hidden = true;
  const img = $('fs-preview-img');
  if (s.previewUrl) {
    $('fs-pdf-card').hidden = true;
    img.src = s.previewUrl; img.hidden = false;
  } else {
    img.hidden = true; img.removeAttribute('src');
    $('fs-pdf-card-name').textContent = s.name;
    $('fs-pdf-card-meta').textContent = s.meta;
    $('fs-pdf-card').hidden = false;
  }
  setSourceHead(s);
  if (s.ar) setAspect(s.ar);
}
function setOutState(kind, text) {                            // idle | busy | error message inside the right pane
  const el = $('fs-out-state');
  el.hidden = false;
  el.className = 'fs-overlay fs-out-state is-' + kind;
  $('fs-out-state-text').textContent = text || (kind === 'busy' ? 'Reading the form…' : 'Your result will appear here after you scan.');
}
function clearOutput(kind, text) {                            // wipe the right side so it never shows a previous file's result
  pvSeq++;                                                    // cancels any preview still being built
  if (pvUrl) { URL.revokeObjectURL(pvUrl); pvUrl = null; }
  const fr = $('fs-pdf-frame');
  fr.hidden = true; fr.src = 'about:blank';
  lastSpec = null; lastPage = null;
  ['fs-result-bar', 'fs-wording-wrap', 'fs-bands-wrap', 'fs-warn-list'].forEach((id) => { $(id).hidden = true; });
  $('fs-out-sub').textContent = ''; $('fs-out-sub').title = '';
  setOutState(kind || 'idle', text);
  renderRunLog();
}
function invalidateScan() { scanSeq++; scanning = false; }    // a scan still running now belongs to the previous file
function updateScanBtn() { $('fs-scan-btn').disabled = scanning || !current; }

/* ================= file reading ================= */
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
      const ow = width, oh = height, longEdge = Math.max(width, height);
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
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', CFG.JPEG_QUALITY), width, height, ow, oh, content: E.measureContent(ctx.getImageData(0, 0, width, height).data, width, height) });
    };
    img.src = dataUrl;
  });
}

function makeThumb(dataUrl) {                                 // tiny picture for the comparison log
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve('');
    img.onload = () => {
      const s = 140 / Math.max(img.width, img.height);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.7));
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
   Lets Qwen (images only) read PDFs, and gives the source pane a real page picture. Gemini still gets the original PDF. */
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

/* ================= file selection =================
   selId guards late-resolving async reads; invalidateScan() + clearOutput() make sure a new file never sits beside
   the previous file's result (v6.4), and the source pane switches to the new file at once. */
async function handleFileSelect(e) {
  const file = e.target.files[0];
  e.target.value = '';                                        // choosing the same file again must still fire "change"
  if (!file) return;
  const mySel = ++selId;
  invalidateScan();
  clearOutput('idle');
  current = null; updateScanBtn();
  const entry = { id: ++srcSeq, name: file.name || 'source', meta: 'reading…', previewUrl: '', thumb: '', ar: 0 };
  sources.set(entry.id, entry); activeSrc = entry;
  paintSource(entry);
  setStatus('Reading file…');
  try {
    if (file.size > CFG.MAX_FILE_MB * 1024 * 1024) throw new Error(`That file is over ${CFG.MAX_FILE_MB} MB. Try a smaller one.`);
    const isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name || '');
    const dataUrl = await fileToDataURL(file);
    if (mySel !== selId) return;                              // a newer file was chosen while this was reading

    if (isPdf) {
      const base64 = dataUrl.split(',')[1];
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      let meta = null, metaErr = '';
      try { meta = await readPdfMeta(bytes); } catch (err) { metaErr = 'Could not read this PDF\u2019s page size. It may be scanned, encrypted, or damaged.'; }
      if (mySel !== selId) return;
      if (!meta || meta.pages === 0) throw new Error(metaErr || 'That PDF has no pages to scan.');
      const wide = meta.width > meta.height;
      entry.meta = `${meta.pages} page${meta.pages === 1 ? '' : 's'}, ${fmtMM(Math.min(meta.width, meta.height))} \u00d7 ${fmtMM(Math.max(meta.width, meta.height))} mm ${wide ? 'landscape' : 'portrait'}`;
      entry.ar = meta.width / meta.height;
      paintSource(entry);
      current = { kind: 'pdf', base64, mimeType: 'application/pdf', src: { kind: 'pdf', width: meta.width, height: meta.height }, raster: null };
      setStatus(meta.pages > 1 ? 'Only page 1 is read. Add a note if a different page matters, then scan.' : 'PDF ready. Add a note if it helps, then scan.', meta.pages > 1 ? 'warn' : null);
      rasterisePdfPage1(bytes).then(({ dataUrl: du, content }) => {
        if (mySel !== selId || !current) return;
        current.raster = du.split(',')[1];
        current.src.content = content;
        entry.previewUrl = du;
        if (viewSrcId === entry.id) paintSource(entry);
        makeThumb(du).then((t) => { entry.thumb = t; renderRunLog(); });
      }).catch(() => { if (mySel === selId) setStatus('PDF ready, but its page could not be rendered as a picture, so only Gemini can read this one.', 'warn'); });
    } else {
      if (!/^image\//.test(file.type)) throw new Error("That file doesn't look like an image or a PDF.");
      const { dataUrl: resized, width, height, ow, oh, content } = await resizeImage(dataUrl);
      if (mySel !== selId) return;
      entry.previewUrl = resized; entry.ar = width / height;
      entry.meta = `${ow} \u00d7 ${oh} px${width > ow ? ', enlarged for reading' : width < ow ? ', reduced for reading' : ''}`;
      paintSource(entry);
      makeThumb(resized).then((t) => { entry.thumb = t; renderRunLog(); });
      current = { kind: 'image', base64: resized.split(',')[1], mimeType: 'image/jpeg', src: { kind: 'image', width, height, content } };
      setStatus('Photo ready. Add a note if it helps, then scan.');
    }
    updateScanBtn();
  } catch (err) {
    if (mySel !== selId) return;
    entry.meta = 'could not be read'; entry.previewUrl = '';
    paintSource(entry);
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
    throw new Error('Could not reach the scanning service. Check your connection and try again.');
  }
  let data;
  try { data = await response.json(); }
  catch (e) { throw new Error('Got an unreadable response from the scanning service. Try again.'); }
  if (!response.ok) { const err = new Error(data.error || ('Scan failed (error ' + response.status + '). Try again.')); err.code = data.code || ''; throw err; }
  return data;
}

/* ================= "what was read" list (mirrors the exact spec the PDF is built from) ================= */
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

/* meta = the run being shown ({ label, secs }), so the Output header says which engine made it */
function renderPreview(spec, page, meta) {
  const originText = page.origin === 'your note' ? 'set from your note' : page.origin === 'your PDF' ? 'read from your PDF' : 'estimated from the photo';
  const head = (meta && meta.label ? shortEngine(meta.label) + (meta.secs != null ? ', ' + meta.secs.toFixed(1) + ' s' : '') + ', ' : '') + page.label;
  $('fs-out-sub').textContent = head;
  $('fs-out-sub').title = head + ' (page size ' + originText + ')';

  $('fs-bands').innerHTML = spec.bands.map((b) => `<div class="fs-band">${b.kind === 'table' ? renderTableBand(b) : renderCellsBand(b)}</div>`).join('');

  const warnEl = $('fs-warn-list');
  if (spec.warnings.length) {
    warnEl.innerHTML = spec.warnings.map((w) => `<li>${escapeHTML(w)}</li>`).join('');
    warnEl.hidden = false;
  } else warnEl.hidden = true;

  renderWordingEditor(spec);
  ['fs-result-bar', 'fs-wording-wrap', 'fs-bands-wrap'].forEach((id) => { $(id).hidden = false; });
  setAspect(page.W / page.H);
  refreshPdfPreview(spec, page);
  renderRunLog();
  if (window.matchMedia && !window.matchMedia('(min-width: 801px)').matches) {
    $('fs-compare').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

/* ================= wording editor: every printed label, editable; the PDF preview follows ================= */
let wordingSlots = [], editTimer = null;
function renderWordingEditor(spec) {
  wordingSlots = E.textSlots(spec);
  const unc = new Map((spec.unconfirmed || []).map((u) => [E.normTxt(u.text), u]));
  let unsure = 0;
  $('fs-wording').innerHTML = wordingSlots.map((s, i) => {
    const val = String(s.obj[s.key]), u = s.band ? unc.get(E.normTxt(val.replace(/\s*:\s*$/, ''))) : null;   // title / ref. code (band 0) are never printed, so never flagged
    if (u) unsure++;
    const field = val.includes('\n') ? `<textarea rows="2" data-slot="${i}">${escapeHTML(val)}</textarea>` : `<input type="text" data-slot="${i}" value="${escapeHTML(val)}">`;
    const sug = u && u.suggest ? `<button type="button" class="fs-mini" data-use="${i}" data-val="${escapeHTML(u.suggest)}">use \u201c${escapeHTML(u.suggest)}\u201d</button>` : '';
    return `<div class="fs-wrow${u ? ' is-unsure' : ''}"><span class="fs-wband">${s.band ? 'Section ' + s.band : (s.key === 'referenceCode' ? 'Ref. code' : 'Title')}</span>${field}${sug}</div>`;
  }).join('');
  $('fs-wording-count').textContent = unsure ? ` (${unsure} to check)` : '';
}
function updateUnsureCount() {
  const n = document.querySelectorAll('#fs-wording .is-unsure').length;
  $('fs-wording-count').textContent = n ? ` (${n} to check)` : '';
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
async function refreshPdfPreview(spec, page) {
  const my = ++pvSeq;
  if ($('fs-pdf-frame').hidden) setOutState('busy', 'Building the preview…');
  try {
    const res = await E.buildFillablePdf(PDFLib, spec, page, { shade: $('fs-shade').checked });
    if (my !== pvSeq) return;
    if (pvUrl) URL.revokeObjectURL(pvUrl);
    pvUrl = URL.createObjectURL(new Blob([res.bytes], { type: 'application/pdf' }));
    const fr = $('fs-pdf-frame');
    fr.src = pvUrl + '#toolbar=0&navpanes=0&view=Fit';
    fr.hidden = false;
    $('fs-out-state').hidden = true;
  } catch (err) {
    if (my !== pvSeq) return;
    $('fs-pdf-frame').hidden = true;
    setOutState('error', 'The preview could not be built. Try Download.');
  }
}

/* ================= scan flow ================= */
const countItems = (spec) => spec.bands.reduce((a, b) => a + (b.kind === 'table' ? 1 : b.cells.reduce((n, c) => n + c.items.filter((it) => it.kind === 'F' || it.kind === 'C').length, 0)), 0);

// Which picture an engine gets: Gemini reads the original PDF; every other engine needs a page image
function imageFor(engine, cur) {
  if (engine === 'gemini' || cur.kind !== 'pdf') return { image: cur.base64, mime: cur.mimeType };
  return cur.raster ? { image: cur.raster, mime: 'image/jpeg' } : null;
}

// An engine that says "picture too big" gets one retry with a small copy of the same picture
function loadImage(src) {
  return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('Could not shrink the picture.')); i.src = src; });
}
async function smallVariant(b64, kb) {
  const img = await loadImage('data:image/jpeg;base64,' + b64);
  let edge = 1400, q = 0.65, out = '';
  for (let i = 0; i < 5; i++) {
    const s = Math.min(1, edge / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    out = c.toDataURL('image/jpeg', q).split(',')[1];
    if (out.length * 0.75 <= kb * 1024) break;
    edge = Math.round(edge * 0.85); q = Math.max(0.4, q - 0.08);
  }
  return out;
}
async function smallCopy(img, cur) {
  cur.small = cur.small || {};
  const key = img.image === cur.raster ? 'raster' : 'photo';
  if (!cur.small[key]) cur.small[key] = await smallVariant(img.image, CFG.SMALL_IMAGE_KB);
  return { image: cur.small[key], mime: 'image/jpeg' };
}

// Wording read: one engine transcribes every printed text item (cheap, fast). Tries WORDING_ORDER until one answers; every attempt is logged.
// Never throws: returns { lines, secs, by } or { error, secs }.
async function wordingRead(precise, entry, cur) {
  const t0 = performance.now();
  let lastErr = 'no engine for the wording read is set up';
  for (const id of E.planWording(CFG.WORDING_ORDER, engines)) {
    const img = imageFor(id, cur);
    if (!img) continue;
    if (getUsageToday() + CFG.TEXT_COST > CFG.MAX_SCANS_PER_DAY) return { error: 'daily limit reached', secs: 0 };
    const t1 = performance.now();
    try {
      const data = await scanForm({ image: img.image, mime_type: img.mime, mode: 'text', tier: precise && id === 'gemini' ? 'precise' : 'fast', provider: id });
      recordUsage(CFG.TEXT_COST);
      const lines = data.lines || [];
      logRun({ label: ((data._meta && (data._meta.label || data._meta.model)) || engLabel(id)) + ' (wording)', secs: (performance.now() - t1) / 1000, info: `${lines.length} text lines read`, srcId: entry.id });
      if (!lines.length) { lastErr = 'no text lines came back'; continue; }
      return { lines, secs: (performance.now() - t0) / 1000, by: shortName(engLabel(id)) };
    } catch (err) {
      lastErr = err.message || 'Error';
      logRun({ label: engLabel(id) + ' (wording)', secs: (performance.now() - t1) / 1000, error: lastErr, srcId: entry.id });
    }
  }
  return { error: lastErr, secs: (performance.now() - t0) / 1000 };
}

// Structure engine + wording reader: work on a copy so the plain engine row in the log stays available for comparison.
function applyWording(r, tp, entry) {
  if (!tp || tp.error || !tp.lines || !tp.lines.length) return Object.assign({}, r, { note: ' Wording check unavailable.' });
  const spec = structuredClone(r.spec);
  const m = E.mergeWording(spec, tp.lines);
  spec.unconfirmed = m.unconfirmed;
  if (m.unconfirmed.length) spec.warnings.push(`${m.unconfirmed.length} label${m.unconfirmed.length === 1 ? '' : 's'} not confirmed by the second reading. Compare with the original: ${m.unconfirmed.slice(0, 6).map((u) => '\u201c' + u.text + '\u201d').join(', ')}${m.unconfirmed.length > 6 ? '\u2026' : ''}`);
  const label = r.label + ' + ' + (tp.by || 'second') + ' wording', secs = Math.max(r.secs, tp.secs);
  logRun({ label, secs, spec, page: r.page, items: countItems(spec), srcId: entry.id });
  return { spec, page: r.page, label, secs, note: m.fixed ? ` ${m.fixed} label${m.fixed === 1 ? '' : 's'} corrected.` : ' Wording confirmed.' };
}

// One engine, one attempt: returns the result or throws. Every attempt (good or failed) lands in the comparison log.
async function tryEngine(engine, note, precise, entry, cur, cost) {
  const name = engLabel(engine);
  const img = imageFor(engine, cur);
  if (!img) {
    const msg = name + ' needs a page image and this PDF could not be rendered';
    logRun({ label: name, secs: 0, error: msg, srcId: entry.id });
    throw new Error(msg);
  }
  const thorough = engine === 'gemini' && precise;
  const price = thorough ? CFG.PRECISE_COST : cost;
  if (getUsageToday() + price > CFG.MAX_SCANS_PER_DAY) throw new Error('This browser has hit today\u2019s scan limit. Try again tomorrow.');
  const t0 = performance.now();
  try {
    const send = (im) => scanForm({ image: im.image, mime_type: im.mime, note: note || undefined, tier: thorough ? 'precise' : 'fast', provider: engine });
    let raw;
    try { raw = await send(img); }
    catch (err) {
      if (err.code !== 'image_too_large') throw err;
      raw = await send(await smallCopy(img, cur));
    }
    recordUsage(price);
    const secs = (performance.now() - t0) / 1000, label = (raw._meta && (raw._meta.label || raw._meta.model)) || name;
    if (!raw.recognized) throw Object.assign(new Error('Model did not recognise a form'), { secs, label });
    const spec = E.normalizeSpec(raw);
    if (!spec.bands.length) throw Object.assign(new Error('No fields or tables found'), { secs, label });
    const page = E.resolvePage(spec, cur.src);
    logRun({ label, secs, spec, page, items: countItems(spec), srcId: entry.id, detail: E.runDetail(raw._meta) });
    return { spec, page, label, secs };
  } catch (err) {
    logRun({ label: err.label || name, secs: err.secs != null ? err.secs : (performance.now() - t0) / 1000, error: err.message || 'Error', srcId: entry.id });
    throw err;
  }
}

function finalError(err, auto) {
  const m = err && err.message ? err.message : '';
  const msg = /recognise|No fields/.test(m) ? 'Couldn\u2019t make out a form in that file. Try a straighter, closer, better-lit photo, or a clearer PDF.' : ((m || 'Something went wrong. Try again.') + (auto ? ' You can pick another engine from the list, or Compare all.' : ''));
  setStatus(msg, 'error');
  setOutState('error', 'No result. See the message above.');
}

// Auto and single-engine scans: engines in order, the next one only if the previous failed. In Auto the wording is read at the same time as the first structure engine.
async function runInOrder(ids, auto, ctx) {
  const { entry, cur, note, precise, live, progress } = ctx;
  let lastErr = null, wording = null;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (auto && id !== 'gemini' && !wording && E.planWording(CFG.WORDING_ORDER, engines).length) wording = wordingRead(precise, entry, cur);
    progress(`Reading the form with ${engLabel(id)}${wording && id !== 'gemini' ? ' (the wording is read at the same time)' : ''}\u2026 ${(CFG.SLOW_ENGINES || []).includes(id) ? 'this one thinks first: allow 1 to 3 minutes.' : id === 'gemini' && precise ? 'this can take up to half a minute.' : 'this can take a few seconds.'}`);
    try {
      let r = await tryEngine(id, note, precise, entry, cur, 1);
      if (wording && id !== 'gemini') {
        if (live()) progress('Checking the wording\u2026');
        r = applyWording(r, await wording, entry);
      }
      if (!live()) return;                                    // another file was chosen meanwhile: runs are logged, nothing is painted
      lastSpec = r.spec; lastPage = r.page;
      paintSource(entry);
      renderPreview(r.spec, r.page, r);
      const first = engLabel(ids[0]);                          // full labels: two engines can share a short name (Qwen on Groq / on OpenRouter)
      const fb = i > 0 ? ` ${first} failed, so ${engLabel(id)} made this layout.${id === 'gemini' ? ' Gemini is usually rougher.' : ''} The log says why; trying again later may bring ${first} back.` : '';
      setStatus(`Found ${r.spec.bands.length} section${r.spec.bands.length === 1 ? '' : 's'} on a ${r.page.label} page. Check it against the source, then download. (${shortEngine(r.label)}, ${r.secs.toFixed(1)} s).${r.note || ''}${fb}`, fb ? 'warn' : undefined);
      return;
    } catch (err) {
      lastErr = err;
      if (!live()) return;                                    // never start the next engine for a scan nobody is waiting for
      if (i < ids.length - 1) progress(`${engLabel(id)} failed (${String(err.message || '').slice(0, 140)}). Trying ${engLabel(ids[i + 1])}\u2026`, 'warn');
    }
  }
  finalError(lastErr, auto);
}

// Compare all: every ready engine reads the same file at the same time (raw reads, no wording merge, so each engine is judged on its own).
// The first answer is shown at once; the log collects the rest. Show / PDF on any row to look at it.
async function runCompare(ids, ctx) {
  const { entry, cur, note, precise, live, progress } = ctx;
  let done = 0, okCount = 0, shownLabel = '', firstErr = null;
  const total = ids.length;
  progress(`Reading the form with ${total} engines at the same time\u2026 the first answer appears here, the log collects the rest. The thinking engines can take 1 to 3 minutes.`);
  await Promise.allSettled(ids.map((id) => tryEngine(id, note, precise, entry, cur, CFG.COMPARE_COST_EACH).then((r) => {
    done++; okCount++;
    if (!live()) return;
    if (!shownLabel) { shownLabel = r.label; lastSpec = r.spec; lastPage = r.page; paintSource(entry); renderPreview(r.spec, r.page, r); }
    setStatus(`${done} of ${total} engines finished. Showing ${shortEngine(shownLabel)}, the first to answer.`);
  }, (err) => {
    done++; firstErr = firstErr || err;
    if (live()) setStatus(`${done} of ${total} engines finished.${shownLabel ? ' Showing ' + shortEngine(shownLabel) + ', the first to answer.' : ''}`);
  })));
  if (!live()) return;
  if (!okCount) { finalError(firstErr, false); return; }
  setStatus(`Compared ${total} engines: ${okCount} answered${total - okCount ? ', ' + (total - okCount) + ' failed' : ''}. Showing ${shortEngine(shownLabel)}, the first to answer. Use Show in the log to look at the others, and PDF to download one.`, total - okCount ? 'warn' : undefined);
}

async function runScan() {
  if (!current || scanning) { if (!current) setStatus('Choose a photo or PDF first.', 'error'); return; }
  await enginesPromise;                                       // the engine list from the Worker (a moment after the page loads)
  const entry = activeSrc, cur = current;
  const myScan = ++scanSeq;
  const live = () => myScan === scanSeq;                      // false once another file has been chosen
  const choice = $('fs-provider').value;                      // auto | all | an engine id
  const precise = $('fs-precise').checked;
  const note = $('fs-note').value.trim();
  const ids = choice === 'auto' ? E.planAuto(CFG.AUTO_ORDER, engines) : choice === 'all' ? E.planAll(engines, CFG.AUTO_ORDER, CFG.COMPARE_SKIP) : (eng(choice) && eng(choice).ready ? [choice] : []);
  if (!ids.length) { setStatus('No engine is set up on the server yet. Add a key to the Worker (see the setup doc), then reload this page.', 'error'); return; }
  scanning = true; updateScanBtn();
  paintSource(entry);                                         // the left pane may be showing an older run's source
  clearOutput('busy', 'Reading the form…');
  const progress = (msg, level) => { setStatus(msg, level); setOutState('busy', msg); };
  try {
    const ctx = { entry, cur, note, precise, live, progress };
    if (choice === 'all') await runCompare(ids, ctx); else await runInOrder(ids, choice === 'auto', ctx);
  } finally {
    if (live()) { scanning = false; updateScanBtn(); }
  }
}

/* ================= comparison log (this visit only, nothing saved) =================
   One group per source file: the Source cell spans all of that file's runs, so every engine's reading of the same
   file sits together. The run currently on the right is highlighted. */
function logRun(r) { r.n = ++runSeq; runs.push(r); renderRunLog(); }
function renderRunLog() {
  $('fs-runlog-wrap').hidden = !runs.length;
  $('fs-runlog-count').textContent = runs.length ? ` (${runs.length})` : '';
  let html = '';
  for (let i = 0; i < runs.length;) {
    const sid = runs[i].srcId;
    let j = i;
    while (j < runs.length && runs[j].srcId === sid) j++;
    const s = sources.get(sid) || {};
    for (let k = i; k < j; k++) {
      const r = runs[k], shown = !!r.spec && r.spec === lastSpec;
      html += `<tr class="${k === i ? 'fs-grp-start' : ''}${shown ? ' is-shown' : ''}">`;
      if (k === i) html += `<td class="fs-src-cell" rowspan="${j - i}">${s.thumb ? `<img class="fs-src-thumb" src="${s.thumb}" alt="">` : ''}<span class="fs-src-name" title="${escapeHTML(s.name || '')}">${escapeHTML(s.name || 'source')}</span></td>`;
      html += `<td>${r.n}</td><td title="${escapeHTML(r.label)}">${escapeHTML(shortEngine(r.label))}</td><td>${r.secs.toFixed(1)} s</td>`;
      html += r.error ? `<td colspan="2" class="fs-runlog-err" title="${escapeHTML(String(r.error))}">Failed: ${escapeHTML(String(r.error).slice(0, 320))}</td>`
        : r.info ? `<td colspan="2">${escapeHTML(r.info)}</td>`
        : `<td>${r.spec.bands.length} sections, ${r.items} items${r.detail ? `<div class="fs-runlog-note">${escapeHTML(r.detail)}</div>` : ''}</td><td class="fs-act">${shown ? '<button type="button" class="fs-mini" disabled>Showing</button>' : `<button type="button" class="fs-mini" data-show="${k}">Show</button>`} <button type="button" class="fs-mini" data-pdf="${k}">PDF</button></td>`;
      html += '</tr>';
    }
    i = j;
  }
  $('fs-runlog').innerHTML = html;
}
function showRun(i) {                                         // put a past result back next to ITS source
  const r = runs[i];
  if (!r || !r.spec) return;
  const s = sources.get(r.srcId);
  if (s) paintSource(s);
  lastSpec = r.spec; lastPage = r.page;
  renderPreview(r.spec, r.page, r);
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
  initTips();
  enginesPromise = loadEngines();
  $('fs-scan-tip').setAttribute('data-tip', `Reads the chosen file and builds the fillable PDF. Each browser can run about ${CFG.MAX_SCANS_PER_DAY} scans a day: one engine counts 1, Auto adds ${CFG.TEXT_COST} for the wording read, Compare all counts ${CFG.COMPARE_COST_EACH} per engine, and Gemini thorough reading counts ${CFG.PRECISE_COST}.`);
  $('fs-photo-input').addEventListener('change', handleFileSelect);
  $('fs-scan-btn').addEventListener('click', runScan);
  $('fs-download-btn').addEventListener('click', downloadPdf);
  $('fs-shade').addEventListener('change', () => { if (lastSpec) refreshPdfPreview(lastSpec, lastPage); });
  $('fs-wording').addEventListener('input', onWordingEdit);
  $('fs-wording').addEventListener('click', onWordingClick);
  $('fs-runlog').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.show) showRun(+b.dataset.show);
    else if (b.dataset.pdf) downloadRun(runs[+b.dataset.pdf]);
  });
}
document.addEventListener('DOMContentLoaded', init);
