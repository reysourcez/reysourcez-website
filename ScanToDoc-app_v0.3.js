/* ============================================================
   Scan to Document - page logic (v0.3, 2026-11-12)
   Loads the scan(s), cleans each page, reads it, rebuilds paragraphs, lets the owner edit / add text, exports Word or text.
   Everything runs in the browser; nothing is uploaded or stored. Modules: config, clean, layout, docx, ocr (see their headers).
   ============================================================ */
(function () {
'use strict';

const C = window.ScanToDocConfig, Clean = window.ScanToDocClean, Layout = window.ScanToDocLayout, Docx = window.ScanToDocDocx, Ocr = window.ScanToDocOcr;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const S = { sources: [], pages: [], doc: [], nextId: 1, view: 0, sel: null, running: false, cancel: false, undo: [], logLines: [], landscape: false, hfLines: 0, baseName: 'scanned-document' };

/* ---------------- log + status ---------------- */
function log(level, msg) {
  S.logLines.push(new Date().toLocaleTimeString() + ' ' + String(level).toUpperCase() + ' ' + msg);
  if (S.logLines.length > 400) S.logLines.shift();
  const el = $('sd-log');
  if (el) { el.textContent = S.logLines.join('\n'); el.scrollTop = el.scrollHeight; }
  if (level === 'error') console.error('[Scan to Document]', msg);
}
function setStatus(text, level) {
  const el = $('sd-status');
  el.textContent = text || '';
  el.classList.toggle('is-error', level === 'error');
  el.classList.toggle('is-warn', level === 'warn');
}
window.addEventListener('error', (e) => log('error', 'Script error: ' + (e.message || e)));
window.addEventListener('unhandledrejection', (e) => log('error', 'Unhandled: ' + (e.reason && e.reason.message ? e.reason.message : e.reason)));

/* ---------------- tooltips (tap, hover, keyboard) ---------------- */
function initTips() {
  const pop = document.createElement('div');
  pop.id = 'sd-tip-pop'; pop.setAttribute('role', 'tooltip'); pop.hidden = true;
  document.body.appendChild(pop);
  let owner = null, pinned = false;
  const tipOf = (n) => (n && n.closest ? n.closest('.sd-tip') : null);
  const hide = () => { if (owner) owner.removeAttribute('aria-describedby'); pop.hidden = true; owner = null; pinned = false; };
  function show(el, pin) {
    if (owner && owner !== el) owner.removeAttribute('aria-describedby');
    owner = el; pinned = !!pin;
    pop.textContent = el.getAttribute('data-tip') || '';
    pop.style.left = '0px'; pop.style.top = '0px'; pop.hidden = false;
    el.setAttribute('aria-describedby', 'sd-tip-pop');
    const r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight, vw = document.documentElement.clientWidth;
    pop.style.left = Math.max(8, Math.min(r.left + r.width / 2 - pw / 2, vw - pw - 8)) + 'px';
    pop.style.top = (r.top - ph - 10 >= 8 ? r.top - ph - 10 : r.bottom + 10) + 'px';
  }
  if (window.matchMedia && window.matchMedia('(hover: hover)').matches) {
    document.addEventListener('mouseover', (e) => { const t = tipOf(e.target); if (t && !pinned) show(t, false); });
    document.addEventListener('mouseout', (e) => { const t = tipOf(e.target); if (t && !pinned && !t.contains(e.relatedTarget)) hide(); });
  }
  document.addEventListener('focusin', (e) => { const t = tipOf(e.target); if (t && !pinned) show(t, false); });
  document.addEventListener('focusout', (e) => { const t = tipOf(e.target); if (t && !pinned) hide(); });
  document.addEventListener('click', (e) => { const t = tipOf(e.target); if (!t) { if (owner) hide(); return; } e.preventDefault(); if (owner === t && pinned) hide(); else show(t, true); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
}

/* ---------------- pdf.js (same pinned loader as Form Scanner) ---------------- */
let pdfjsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsPromise) pdfjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = C.ASSETS.pdfJsBase + 'pdf.min.js';
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = C.ASSETS.pdfJsBase + 'pdf.worker.min.js'; resolve(window.pdfjsLib); };
    s.onerror = () => { pdfjsPromise = null; reject(new Error('Could not load the PDF page renderer.')); };
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}

/* ---------------- sources -> grey pictures ---------------- */
const natural = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
async function buildSources(files) {
  const pdfs = files.filter((f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name));
  if (pdfs.length && files.length > 1) throw new Error('Choose either one PDF, or one or more picture files, not a mix.');
  if (pdfs.length) {
    const lib = await loadPdfJs(), pdf = await lib.getDocument({ data: new Uint8Array(await pdfs[0].arrayBuffer()) }).promise;
    const n = Math.min(pdf.numPages, C.MAX_PAGES);
    if (pdf.numPages > n) log('warn', 'The PDF has ' + pdf.numPages + ' pages; only the first ' + n + ' are read (MAX_PAGES in the settings file).');
    return Array.from({ length: n }, (_, i) => ({ kind: 'pdf', pdf, n: i + 1 }));
  }
  return files.slice().sort(natural).slice(0, C.MAX_PAGES).map((file) => ({ kind: 'img', file }));
}

function canvasToGray(cv) {
  const id = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, cv.width, cv.height);
  return Clean.toGray(id.data, cv.width, cv.height);
}
async function sourceToGray(src) {
  if (src.kind === 'pdf') {
    const pg = await src.pdf.getPage(src.n), v1 = pg.getViewport({ scale: 1 });
    let scale = C.RENDER_DPI / 72;
    if (v1.width * v1.height * scale * scale > 40e6) scale = Math.sqrt(40e6 / (v1.width * v1.height));
    const vp = pg.getViewport({ scale }), cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    return { gray: canvasToGray(cv), w: cv.width, h: cv.height, dpi: Math.round(scale * 72) };
  }
  const file = src.file;
  if (file.size > C.MAX_FILE_MB * 1024 * 1024) throw new Error(file.name + ' is over ' + C.MAX_FILE_MB + ' MB.');
  if (!/^image\//.test(file.type)) throw new Error(file.name + " does not look like a picture or a PDF.");
  const bmp = await createImageBitmap(file);
  const long = Math.max(bmp.width, bmp.height);
  const k = long < C.MIN_EDGE_PX ? C.MIN_EDGE_PX / long : (long > C.MAX_EDGE_PX ? C.MAX_EDGE_PX / long : 1);
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k), cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, w, h);
  return { gray: canvasToGray(cv), w, h, dpi: Math.round(Math.max(w, h) / 11.69) };      // photos: assume an A4 page
}

function makePreview(cv) {                                      // small copy for the Scan pane (keeps memory low on long documents)
  const k = Math.min(1, 1100 / cv.width), o = document.createElement('canvas');
  o.width = Math.max(1, Math.round(cv.width * k)); o.height = Math.max(1, Math.round(cv.height * k));
  const g = o.getContext('2d'); g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, o.width, o.height); g.drawImage(cv, 0, 0, o.width, o.height);
  return o.toDataURL('image/png');
}

/* ---------------- settings UI ---------------- */
function getLangs() {
  const on = Array.from(document.querySelectorAll('#sd-langs input:checked')).map((i) => i.value);
  return C.LANGUAGES.filter((l) => on.indexOf(l.code) >= 0);
}
function buildControls() {
  $('sd-version').textContent = C.VERSION.split(' ')[0]; $('sd-version').title = C.VERSION;
  const fs = $('sd-langs');
  C.LANGUAGES.forEach((l) => {
    const d = document.createElement('div'); d.className = 'sd-check';
    d.innerHTML = '<label><input type="checkbox" value="' + esc(l.code) + '"' + (l.on ? ' checked' : '') + '> ' + esc(l.label) + '</label>';
    fs.appendChild(d);
  });
  $('sd-pagemode').innerHTML = C.PAGE_MODES.map((m) => '<option value="' + esc(m.value) + '"' + (m.value === C.PAGE_MODE_DEFAULT ? ' selected' : '') + '>' + esc(m.label) + '</option>').join('');
  $('sd-font').innerHTML = C.DOC.FONTS.map((f) => '<option' + (f === C.DOC.FONT_DEFAULT ? ' selected' : '') + '>' + esc(f) + '</option>').join('');
}

/* ---------------- running a scan ---------------- */
function resetResults() {
  S.pages = []; S.doc = []; S.nextId = 1; S.view = 0; S.sel = null; S.undo = []; S.hfLines = 0;
  renderDoc(); showPage(-1); $('sd-hfnote').hidden = true; updateButtons();
}
function updateButtons() {
  const has = S.doc.length > 0;
  ['sd-dl-docx', 'sd-dl-txt', 'sd-add'].forEach((id) => { $(id).disabled = !has || S.running; });
  $('sd-undo').disabled = !S.undo.length || S.running;
  $('sd-start').disabled = S.running || !S.sources.length;
  $('sd-stop').hidden = !S.running;
  $('sd-count').textContent = has ? S.doc.length + ' paragraph' + (S.doc.length === 1 ? '' : 's') + ', ' + S.pages.length + ' page' + (S.pages.length === 1 ? '' : 's') : '';
  const n = S.pages.length;
  $('sd-prev').disabled = !n || S.view <= 0; $('sd-next').disabled = !n || S.view >= n - 1;
}

async function runScan() {
  if (S.running) return;
  const files = Array.from($('sd-file').files);
  if (!files.length) { setStatus('Choose a scan first.', 'error'); return; }
  const langs = getLangs();
  if (!langs.length) { setStatus('Tick at least one language.', 'error'); return; }
  S.running = true; S.cancel = false; resetResults(); updateButtons();
  S.baseName = (files[0].name || 'scanned-document').replace(/\.[^.]+$/, '') || 'scanned-document';
  const prog = $('sd-progress'); prog.hidden = false; prog.value = 0;
  let engine = null;
  try {
    setStatus('Preparing…');
    const sources = await buildSources(files), N = sources.length;
    log('info', N + ' page(s) to read; languages: ' + langs.map((l) => l.code).join('+'));
    let lastProg = 0;
    engine = await Ocr.createEngine({
      langs: langs.map((l) => l.code), pageMode: $('sd-pagemode').value, dpi: C.RENDER_DPI, assets: C.ASSETS, log,
      onProgress: (m) => { if (m.status && m.progress != null && Date.now() - lastProg > 400) { lastProg = Date.now(); setStatus('Reading the engine / page: ' + m.status + ' ' + Math.round(m.progress * 100) + '%'); } },
    });
    for (let i = 0; i < N; i++) {
      if (S.cancel) { setStatus('Stopped after ' + i + ' page(s).', 'warn'); break; }
      const base = (i / N) * 100, tag = 'Page ' + (i + 1) + ' of ' + N + ': ';
      setStatus(tag + 'loading'); prog.value = base;
      const info = await sourceToGray(sources[i]);
      if (i === 0) S.landscape = info.w > info.h * 1.1;
      setStatus(tag + 'cleaning the scan'); await new Promise((r) => setTimeout(r, 0));
      const cl = Clean.cleanScan(info.gray, info.w, info.h, { MODE: $('sd-clean').checked ? 'full' : 'light' });
      log('info', tag + 'clean-up ' + cl.ms + ' ms, tilt ' + cl.skewDeg.toFixed(2) + ' deg, ' + cl.removed + ' specks removed' + (cl.paperFound ? '' : ', no dark scanner edge found'));
      const cv = document.createElement('canvas'); cv.width = cl.w; cv.height = cl.h;
      cv.getContext('2d').putImageData(new ImageData(Clean.inkToRGBA(cl.ink, cl.w, cl.h), cl.w, cl.h), 0, 0);
      const preview = makePreview(cv);
      prog.value = base + 100 / N * 0.35; setStatus(tag + 'reading the text');
      const t0 = Date.now(), res = await engine.recognize(cv, i);
      const lines = Layout.linesFromBlocks(res.blocks, C.DROP_CONF_BELOW);
      log('info', tag + 'read ' + lines.length + ' text lines in ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
      const out = Layout.infer(lines, cl.ink, cl.w, cl.h, langs);
      const model = Layout.toDocModel(out, langs, info.dpi, C.DOC);
      if (!model.length) log('warn', tag + 'no paragraphs found. Try another Layout setting, or a clearer scan.');
      model.forEach((p) => { p.id = S.nextId++; p.page = i; S.doc.push(p); });
      S.pages.push({ preview, w: cl.w, h: cl.h });
      S.hfLines += out.headerFooter ? out.headerFooter.length : 0;
      renderDoc(); if (i === 0) showPage(0); updateButtons();
      prog.value = base + 100 / N;
    }
    if (!S.cancel) {
      const low = S.doc.reduce((a, p) => a + (p.tokens || []).filter((t) => t.c < C.LOW_CONF_BELOW).length, 0);
      setStatus('Read ' + S.pages.length + ' page(s): ' + S.doc.length + ' paragraphs, ' + low + ' doubtful word(s) in yellow. Check them against the scan, add or fix text, then download.', low ? 'warn' : undefined);
    }
    if (S.hfLines) { $('sd-hfnote').textContent = S.hfLines + ' line(s) in the running header/footer strips were left out of the document (page numbers, document codes). Add them as paragraphs if you need them.'; $('sd-hfnote').hidden = false; }
  } catch (e) {
    log('error', (e && e.stack) || String(e));
    setStatus((e && e.message) || 'Something went wrong. Open Diagnostics for details.', 'error');
  } finally {
    if (engine) await engine.terminate();
    S.running = false; prog.hidden = true; updateButtons();
  }
}

/* ---------------- scan pane ---------------- */
function showPage(i) {
  S.view = i;
  const has = i >= 0 && S.pages[i];
  $('sd-img').hidden = !has; $('sd-empty').hidden = !!has; $('sd-hl').hidden = true;
  if (has) { $('sd-img').src = S.pages[i].preview; $('sd-pageinfo').textContent = 'Page ' + (i + 1) + ' of ' + S.pages.length; } else $('sd-pageinfo').textContent = '';
  updateButtons();
}
function highlight(p) {
  const hl = $('sd-hl');
  if (!p || !p.box || p.page == null || !S.pages[p.page]) { hl.hidden = true; return; }
  if (S.view !== p.page) showPage(p.page);
  const pg = S.pages[p.page], b = p.box;
  hl.style.left = (b.l / pg.w * 100) + '%'; hl.style.top = (b.t / pg.h * 100) + '%';
  hl.style.width = ((b.r - b.l) / pg.w * 100) + '%'; hl.style.height = ((b.b - b.t) / pg.h * 100) + '%';
  hl.hidden = false;
  if (hl.scrollIntoView) hl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ---------------- review list ---------------- */
const find = (id) => S.doc.findIndex((p) => p.id === id);
function textHtml(p) {
  if (p.tokens && !p.edited) return p.tokens.map((t) => (t.c < C.LOW_CONF_BELOW ? '<span class="low">' + esc(t.t) + '</span>' : esc(t.t))).join(' ');
  return esc(p.text);
}
function cardHtml(p) {
  const opt = (v, cur, label) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + label + '</option>';
  return '<div class="sd-para' + (p.id === S.sel ? ' is-sel' : '') + '" data-id="' + p.id + '" data-origin="' + p.origin + '">' +
    '<div class="sd-para-bar">' +
    '<select class="sd-select sd-type" aria-label="Paragraph type">' + opt('heading', p.type, 'Heading') + opt('body', p.type, 'Text') + opt('list', p.type, 'List item') + opt('note', p.type, 'Note') + '</select>' +
    '<select class="sd-select sd-align" aria-label="Alignment">' + opt('left', p.align, 'Left') + opt('center', p.align, 'Centre') + opt('right', p.align, 'Right') + opt('justify', p.align, 'Justified') + '</select>' +
    (p.origin === 'user' ? '<span class="sd-badge">added by you</span>' : '') + '<span>page ' + ((p.page || 0) + 1) + '</span>' +
    '<span class="sd-btns"><button type="button" data-act="up" title="Move up" aria-label="Move up">&uarr;</button><button type="button" data-act="down" title="Move down" aria-label="Move down">&darr;</button>' +
    '<button type="button" data-act="add" title="Add a paragraph below" aria-label="Add a paragraph below">+</button><button type="button" data-act="merge" title="Join with the next paragraph" aria-label="Join with the next paragraph">&#10549;</button>' +
    '<button type="button" data-act="del" title="Delete this paragraph" aria-label="Delete this paragraph">&times;</button></span></div>' +
    '<div class="sd-text" contenteditable="true" spellcheck="false" data-type="' + p.type + '" data-align="' + p.align + '" role="textbox" aria-multiline="true" aria-label="Paragraph text">' + textHtml(p) + '</div></div>';
}
function renderDoc(focusId) {
  const box = $('sd-doc');
  box.innerHTML = S.doc.length ? S.doc.map(cardHtml).join('') : '<div class="sd-empty">Your paragraphs will appear here after you read a scan.</div>';
  if (focusId != null) { const t = box.querySelector('.sd-para[data-id="' + focusId + '"] .sd-text'); if (t) { t.focus(); } }
  updateButtons();
}
function pushUndo() { S.undo.push(JSON.stringify(S.doc)); if (S.undo.length > 40) S.undo.shift(); updateButtons(); }
function undo() { if (!S.undo.length) return; S.doc = JSON.parse(S.undo.pop()); renderDoc(); }
function newPara(after) {
  return { id: S.nextId++, origin: 'user', type: 'body', align: 'left', text: '', sizePt: C.DOC.SIZE_BODY, bold: false, indentMm: 0, firstLineMm: 0, tokens: null, edited: true, page: after ? after.page : (S.view || 0), box: null, conf: 100 };
}
function sizeFor(p) { return p.type === 'heading' ? (p.align === 'center' ? C.DOC.SIZE_TITLE : C.DOC.SIZE_HEAD) : (p.type === 'note' ? C.DOC.SIZE_NOTE : C.DOC.SIZE_BODY); }
function caretOffset(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return el.textContent.length;
  const r = sel.getRangeAt(0), pre = r.cloneRange();
  pre.selectNodeContents(el); pre.setEnd(r.startContainer, r.startOffset);
  return pre.toString().length;
}

function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const card = b.closest('.sd-para'), id = +card.dataset.id, i = find(id), act = b.dataset.act;
  if (i < 0) return;
  pushUndo();
  if (act === 'up' && i > 0) { const t = S.doc[i - 1]; S.doc[i - 1] = S.doc[i]; S.doc[i] = t; renderDoc(id); }
  else if (act === 'down' && i < S.doc.length - 1) { const t = S.doc[i + 1]; S.doc[i + 1] = S.doc[i]; S.doc[i] = t; renderDoc(id); }
  else if (act === 'add') { const n = newPara(S.doc[i]); S.doc.splice(i + 1, 0, n); renderDoc(n.id); }
  else if (act === 'merge' && i < S.doc.length - 1) {
    const a = S.doc[i], c2 = S.doc[i + 1];
    a.text = (a.text + ' ' + c2.text).trim(); a.tokens = null; a.edited = true;
    if (a.box && c2.box && a.page === c2.page) a.box = { l: Math.min(a.box.l, c2.box.l), t: Math.min(a.box.t, c2.box.t), r: Math.max(a.box.r, c2.box.r), b: Math.max(a.box.b, c2.box.b) };
    S.doc.splice(i + 1, 1); renderDoc(id);
  }
  else if (act === 'del') { S.doc.splice(i, 1); renderDoc(); }
  else S.undo.pop();                                            // nothing changed (e.g. merge on the last paragraph)
  updateButtons();
}
function onChange(e) {
  const card = e.target.closest('.sd-para');
  if (!card) return;
  const p = S.doc[find(+card.dataset.id)], txt = card.querySelector('.sd-text');
  if (!p) return;
  pushUndo();
  if (e.target.classList.contains('sd-type')) { p.type = e.target.value; p.bold = p.type === 'heading'; p.sizePt = sizeFor(p); txt.dataset.type = p.type; }
  else if (e.target.classList.contains('sd-align')) { p.align = e.target.value; p.sizePt = sizeFor(p); txt.dataset.align = p.align; }
  p.edited = true;
}
function onInput(e) {
  const txt = e.target.closest('.sd-text');
  if (!txt) return;
  const p = S.doc[find(+txt.closest('.sd-para').dataset.id)];
  if (!p) return;
  if (!p.edited) pushUndo();
  p.text = txt.textContent; p.edited = true;
  const sel = window.getSelection();
  if (sel && sel.anchorNode) { const sp = sel.anchorNode.parentElement; if (sp && sp.classList && sp.classList.contains('low')) sp.classList.remove('low'); }   // touched = checked
}
function onKeydown(e) {
  const txt = e.target.closest && e.target.closest('.sd-text');
  if (!txt) return;
  if (e.key === 'Enter') {                                      // Enter splits the paragraph at the cursor
    e.preventDefault();
    const card = txt.closest('.sd-para'), i = find(+card.dataset.id), p = S.doc[i];
    if (!p) return;
    pushUndo();
    const cur = txt.textContent, off = caretOffset(txt), n = newPara(p);
    p.text = cur.slice(0, off).trimEnd(); p.tokens = null; p.edited = true;
    n.text = cur.slice(off).trimStart(); n.type = p.type === 'heading' ? 'body' : p.type; n.align = p.align; n.sizePt = sizeFor(n);
    n.origin = p.origin; n.box = p.box; n.indentMm = p.indentMm; n.firstLineMm = p.firstLineMm;
    S.doc.splice(i + 1, 0, n); renderDoc(n.id);
    const t = $('sd-doc').querySelector('.sd-para[data-id="' + n.id + '"] .sd-text');
    if (t) { const r = document.createRange(); r.selectNodeContents(t); r.collapse(true); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  }
}
function onPaste(e) {
  const txt = e.target.closest && e.target.closest('.sd-text');
  if (!txt) return;
  e.preventDefault();
  const t = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s*\n\s*/g, ' ');
  document.execCommand('insertText', false, t);
}
function onFocusIn(e) {
  const card = e.target.closest && e.target.closest('.sd-para');
  if (!card) return;
  const id = +card.dataset.id;
  if (S.sel === id) return;
  S.sel = id;
  document.querySelectorAll('.sd-para.is-sel').forEach((c) => c.classList.remove('is-sel'));
  card.classList.add('is-sel');
  highlight(S.doc[find(id)]);
}

/* ---------------- export ---------------- */
function docModel() {
  const k = +$('sd-scale').value || 1, pg = S.landscape ? { widthMm: C.DOC.PAGE.heightMm, heightMm: C.DOC.PAGE.widthMm } : C.DOC.PAGE;
  return {
    title: S.baseName, font: $('sd-font').value, headingFont: C.DOC.FONT_HEADING, sizeBody: C.DOC.SIZE_BODY * k, page: pg, margins: C.DOC.MARGINS_MM,
    paragraphs: S.doc.map((p) => ({ type: p.type, align: p.align, text: p.text, sizePt: Math.round(p.sizePt * k * 2) / 2, bold: p.type === 'heading', indentMm: p.indentMm, firstLineMm: p.firstLineMm })),
  };
}
function download(bytes, name, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime })), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function exportDocx() {
  try { download(Docx.buildDocx(docModel()), S.baseName + '.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'); setStatus('Word file downloaded. Open it in Word to check fonts and spacing.'); log('info', 'Exported .docx with ' + S.doc.length + ' paragraphs'); }
  catch (e) { log('error', String(e && e.stack || e)); setStatus('Could not build the Word file: ' + e.message, 'error'); }
}
function exportTxt() { download(Docx.buildTxt(docModel()), S.baseName + '.txt', 'text/plain;charset=utf-8'); setStatus('Text file downloaded.'); }

/* ---------------- diagnostics ---------------- */
async function runSelfTest() {
  const ol = $('sd-steps'); ol.innerHTML = '<li>Running…</li>';
  $('sd-selftest').disabled = true;
  const steps = await Ocr.selfTest({ assets: C.ASSETS, log, onProgress: () => {} });
  ol.innerHTML = steps.map((s) => '<li class="' + (s.ok ? '' : 'bad') + '">' + (s.ok ? 'OK: ' : 'FAILED: ') + esc(s.msg) + '</li>').join('');
  $('sd-selftest').disabled = false;
}
function copyLog() {
  const t = S.logLines.join('\n');
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => setStatus('Log copied.'), () => setStatus('Could not copy the log; select it by hand.', 'warn'));
}

/* ---------------- init ---------------- */
function init() {
  initTips();
  buildControls();
  $('sd-file').addEventListener('change', () => {
    const files = Array.from($('sd-file').files);
    S.sources = files;
    $('sd-filename').textContent = files.length ? (files.length === 1 ? files[0].name : files.length + ' files') : '';
    setStatus(files.length ? 'Ready. Tick the languages, then press “Read the scan”.' : '');
    updateButtons();
  });
  $('sd-start').addEventListener('click', runScan);
  $('sd-stop').addEventListener('click', () => { S.cancel = true; setStatus('Stopping after this page…', 'warn'); });
  $('sd-prev').addEventListener('click', () => showPage(S.view - 1));
  $('sd-next').addEventListener('click', () => showPage(S.view + 1));
  $('sd-undo').addEventListener('click', undo);
  $('sd-add').addEventListener('click', () => { pushUndo(); const n = newPara(S.doc[S.doc.length - 1]); S.doc.push(n); renderDoc(n.id); });
  $('sd-dl-docx').addEventListener('click', exportDocx);
  $('sd-dl-txt').addEventListener('click', exportTxt);
  $('sd-selftest').addEventListener('click', runSelfTest);
  $('sd-copylog').addEventListener('click', copyLog);
  const d = $('sd-doc');
  d.addEventListener('click', onClick); d.addEventListener('change', onChange); d.addEventListener('input', onInput);
  d.addEventListener('keydown', onKeydown); d.addEventListener('paste', onPaste); d.addEventListener('focusin', onFocusIn);
  log('info', 'Scan to Document ' + C.VERSION + ' ready');
  if (window.__ScanToDocMock) window.__sd = { S };               // test hook, only when the mock engine is injected
}
document.addEventListener('DOMContentLoaded', init);
})();
