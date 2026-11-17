/* ============================================================
   Scan to Document - layout rules (v0.3, 2026-11-12), no AI
   OCR lines -> paragraphs with alignment (left / centre / right / justified), headings, hanging indents.
   No DOM code: runs in the browser and under Node for tests. Port of infer() in ScanToDoc-layout-probe_v0.2.py.
   Input words: { t: text, c: confidence 0-100, l: left px, tp: top px, w: width px, h: height px }.
   ============================================================ */
(function (root) {
'use strict';

const VERSION = 'v0.3 (2026-11-12)';
const CFG = Object.assign({ BOLD: 1.4, TOL_PCT: 1.2, TOL_JUSTIFY_PCT: 0.45, HEADER_PCT: 8.5, FOOTER_PCT: 8.5 }, (root.ScanToDocConfig && root.ScanToDocConfig.LAYOUT) || {});

/* ---------------- small helpers ---------------- */
function median(a) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(a, q) {                                     // linear interpolation, same as numpy
  const s = a.slice().sort((x, y) => x - y), k = (s.length - 1) * q / 100, f = Math.floor(k), c = Math.min(s.length - 1, f + 1);
  return s[f] + (s[c] - s[f]) * (k - f);
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function numberedRegex(langs) {                                 // a new paragraph starts at a clause number, list marker, NOTE / Annex word
  const words = [];
  (langs || []).forEach((l) => { (l.noteWords || []).concat(l.annexWords || []).forEach((w) => words.push(escRe(w))); });
  if (!words.length) words.push('NOTE', 'Annex');
  return new RegExp('^(\\d+(\\.\\d+)*[\\s\\u00a0]|[A-Za-z]\\)|\\(\\w\\)|[\\u2022\\-\\u2013\\u2014]\\s|(?:' + words.join('|') + ')\\b)');
}
function noteRegex(langs) {
  const words = [];
  (langs || []).forEach((l) => (l.noteWords || []).forEach((w) => words.push(escRe(w))));
  return new RegExp('^(?:' + (words.length ? words.join('|') : 'NOTE') + ')\\b', 'i');
}

/* ---------------- OCR lines ---------------- */
function mkLine(ws) {
  let l = 1e9, r = -1e9, t = 1e9, b = -1e9, cs = 0;
  ws.forEach((w) => { l = Math.min(l, w.l); r = Math.max(r, w.l + w.w); t = Math.min(t, w.tp); b = Math.max(b, w.tp + w.h); cs += w.c; });
  return { l, r, t, b, text: ws.map((w) => w.t).join(' '), n: ws.length, conf: cs / ws.length, words: ws };
}

function mergeRows(lines) {                                     // Tesseract may split one printed line in two (a clause number far from its text)
  const out = [];
  lines.slice().sort((a, b) => (a.t + a.b) - (b.t + b.b)).forEach((ln) => {
    const cy = (ln.t + ln.b) / 2, h = ln.b - ln.t;
    for (const m of out) {
      if (Math.abs((m.t + m.b) / 2 - cy) < 0.4 * Math.min(h, m.b - m.t)) { Object.assign(m, mkLine(m.words.concat(ln.words).sort((a, b) => a.l - b.l))); return; }
    }
    out.push(ln);
  });
  return out.sort((a, b) => a.t - b.t);
}

/* Tesseract.js `blocks` -> lines. Accepts the documented shape (blocks > paragraphs > lines > words, bbox {x0,y0,x1,y1}) and tolerates a few variants. */
function linesFromBlocks(blocks, dropBelow) {
  const lines = [], drop = dropBelow == null ? 30 : dropBelow;
  (blocks || []).forEach((blk) => (blk.paragraphs || []).forEach((par) => (par.lines || []).forEach((ln) => {
    const ws = [];
    (ln.words || []).forEach((w) => {
      const bb = w.bbox || {}, x0 = bb.x0 != null ? bb.x0 : bb.left, y0 = bb.y0 != null ? bb.y0 : bb.top;
      const x1 = bb.x1 != null ? bb.x1 : (bb.left != null ? bb.left + bb.width : x0), y1 = bb.y1 != null ? bb.y1 : (bb.top != null ? bb.top + bb.height : y0);
      const t = String(w.text == null ? '' : w.text).trim(), c = w.confidence != null ? +w.confidence : 0;
      if (t && c >= drop && x1 > x0 && y1 > y0) ws.push({ t, c, l: x0, tp: y0, w: x1 - x0, h: y1 - y0 });
    });
    if (ws.length) lines.push(mkLine(ws.sort((a, b) => a.l - b.l)));
  })));
  return mergeRows(lines);
}

/* ---------------- ink measurements (the cleaned bitmap: 1 = ink) ---------------- */
function stroke(ink, W, H, ln) {                                // mean horizontal ink run (stem thickness) relative to the line height: bold scores higher
  const t = Math.max(0, Math.floor(ln.t)), b = Math.min(H, Math.ceil(ln.b)), l = Math.max(0, Math.floor(ln.l)), r = Math.min(W, Math.ceil(ln.r));
  let runs = 0, total = 0;
  for (let y = t; y < b; y++) {
    let run = 0;
    for (let x = l; x < r; x++) {
      if (ink[y * W + x]) run++;
      else if (run) { runs++; total += run; run = 0; }
    }
    if (run) { runs++; total += run; }
  }
  return runs ? (total / runs) / Math.max(1, ln.b - ln.t) : 0;
}

function refine(ink, W, H, ln) {                                // trim a line box with the ink projection so specks stuck to a line do not inflate it
  let ws = ln.words;
  while (ws.length > 1 && ws[ws.length - 1].t.length === 1 && !/[A-Za-z0-9]/.test(ws[ws.length - 1].t) && ws[ws.length - 1].l - (ws[ws.length - 2].l + ws[ws.length - 2].w) > 12) ws = ws.slice(0, -1);
  ln.r = Math.max.apply(null, ws.map((w) => w.l + w.w));
  const t0 = Math.max(Math.floor(ln.t) - 2, 0), b0 = Math.min(H, Math.ceil(ln.b) + 2), l0 = Math.max(Math.floor(ln.l) - 2, 0), r0 = Math.min(W, Math.ceil(ln.r) + 2);
  if (b0 <= t0 || r0 <= l0) return;
  const rows = new Array(b0 - t0).fill(0);
  let any = false, mx = 0;
  for (let y = t0; y < b0; y++) { let s = 0; for (let x = l0; x < r0; x++) s += ink[y * W + x]; rows[y - t0] = s; if (s > mx) mx = s; if (s) any = true; }
  if (!any) return;
  let first = -1, last = -1;
  for (let i = 0; i < rows.length; i++) if (rows[i] >= 0.04 * mx) { if (first < 0) first = i; last = i; }
  ln.t = t0 + first; ln.b = t0 + last + 1;
}

/* ---------------- lines -> paragraphs ---------------- */
function infer(lines, ink, W, H, langs, opts) {
  const o = Object.assign({}, CFG, opts || {}), NUM = numberedRegex(langs);
  lines.forEach((ln) => { refine(ink, W, H, ln); ln.hf = ln.b < o.HEADER_PCT / 100 * H || ln.t > (1 - o.FOOTER_PCT / 100) * H; ln.H = ln.b - ln.t; });
  let body = lines.filter((ln) => !ln.hf);
  const ref = body.filter((ln) => ln.n >= 5);
  if (ref.length < 4) return { paras: [], stats: {}, headerFooter: lines.filter((ln) => ln.hf) };
  const medH = median(ref.map((ln) => ln.H));
  body = body.filter((ln) => ln.H >= 0.5 * medH && ln.H <= 2.8 * medH && !(ln.conf < 45 && ln.n <= 2));
  if (body.length < 4) return { paras: [], stats: {}, headerFooter: lines.filter((ln) => ln.hf) };
  const lefts = body.filter((ln) => ln.n >= 3).map((ln) => ln.l), cnt = new Map();
  lefts.forEach((x) => { const k = Math.round(x / 6); cnt.set(k, (cnt.get(k) || 0) + 1); });
  const keep = []; cnt.forEach((c, k) => { if (c >= Math.max(3, 0.12 * lefts.length)) keep.push(k); });
  const L = keep.length ? Math.min.apply(null, keep) * 6 : percentile(lefts, 10);
  const rr = body.filter((ln) => ln.n >= 6).map((ln) => ln.r), rights = rr.length ? rr : body.map((ln) => ln.r), hist = new Map();
  rights.forEach((x) => { const k = Math.round(x / 4); hist.set(k, (hist.get(k) || 0) + 1); });
  let pk = 0, pc = -1; hist.forEach((c, k) => { if (c > pc || (c === pc && k > pk)) { pk = k; pc = c; } });
  const R = pc >= 0.2 * rights.length ? pk * 4 : percentile(rights, 92);       // justified text piles its right edges on one spot
  const TW = Math.max(R - L, 1), tol = o.TOL_PCT / 100 * W, tolJ = o.TOL_JUSTIFY_PCT / 100 * W;
  body.forEach((ln) => {
    const ind = ln.l - L, gr = R - ln.r, w = ln.r - ln.l, cen = (ln.l + ln.r) / 2 - (L + R) / 2;
    ln.sw = stroke(ink, W, H, ln);
    if (gr > 4 * tol && ind > 4 * tol && Math.abs(cen) <= 2 * tol && w < 0.75 * TW) ln.cls = 'center';
    else if (Math.abs(gr) <= 2 * tol && ind > 8 * tol && w < 0.6 * TW) ln.cls = 'right';
    else if (Math.abs(gr) <= tolJ) ln.cls = 'full';
    else ln.cls = 'short';
  });
  const swm = median(body.filter((ln) => ln.n >= 6 && ln.sw > 0).map((ln) => ln.sw)) || 1;
  body.forEach((ln) => { ln.bold = ln.n >= 2 && ln.sw >= o.BOLD * swm; });
  const gaps = [];
  for (let i = 1; i < body.length; i++) if (body[i].n >= 4 && body[i - 1].n >= 4) gaps.push(body[i].t - body[i - 1].b);
  const g0 = gaps.length ? median(gaps) : 0.3 * medH, thr = g0 + Math.max(6, 0.2 * medH);
  const endp = (x) => /[.;:,]$/.test(x.text.trim());
  const headLine = (x) => {
    const num = NUM.test(x.text) && !/^(NOTE|[A-Za-z]\))/.test(x.text) && x.n <= 8 && !endp(x) && !noteRegex(langs).test(x.text);
    const bld = x.bold && !endp(x) && (x.cls === 'short' || (x.cls === 'center' && x.H >= 1.25 * medH));
    return (num || bld) && x.n <= 14;
  };
  const paras = [];
  body.forEach((ln) => {
    let isNew = !paras.length;
    if (!isNew) {
      const cur = paras[paras.length - 1].lines, pv = cur[cur.length - 1];
      const edge = ((ln.cls === 'center' || ln.cls === 'right') !== (pv.cls === 'center' || pv.cls === 'right')) || (ln.cls === 'center' && pv.cls === 'center');
      isNew = ln.t - pv.b > thr || edge || NUM.test(ln.text) || (cur.length === 1 && headLine(pv) && !headLine(ln));
    }
    if (isNew) paras.push({ lines: [ln] }); else paras[paras.length - 1].lines.push(ln);
  });
  const tol2 = tol;
  paras.forEach((p) => {
    const ls = p.lines, cl = ls.map((x) => x.cls);
    if (cl.every((c) => c === 'center')) p.align = 'center';
    else if (cl.every((c) => c === 'right')) p.align = 'right';
    else if (ls.length >= 2 && cl.slice(0, -1).filter((c) => c === 'full').length / (ls.length - 1) >= 0.6) p.align = 'justify';
    else p.align = 'left';
    const f = ls[0];
    p.head = ls.length === 1 && headLine(f);
    const cont = ls.slice(1).map((x) => x.l), cm = cont.length ? median(cont) - L : 0;
    p.indentPx = cm > 4 * tol2 ? cm : 0;
    p.firstPx = f.l - L;
    ls.forEach((x, k) => {
      x.pstart = k === 0;
      x.pcls = (p.align === 'center' || p.align === 'right') ? p.align : (p.align === 'justify' && k < ls.length - 1 ? 'justify' : 'left');
      x.phead = p.head;
    });
  });
  return { paras, stats: { L, R, medH, g0, swm, W, H }, headerFooter: lines.filter((ln) => ln.hf) };
}

/* ---------------- paragraphs -> document model (what the review list shows and the exporters write) ---------------- */
function joinLines(texts) {                                     // join wrapped lines into one paragraph, mending end-of-line hyphens
  let out = '';
  texts.forEach((t) => {
    t = t.trim();
    if (out.endsWith('-') && /^[a-z]/.test(t)) out = out.slice(0, -1) + t;
    else out = (out + ' ' + t).trim();
  });
  return out;
}

function toDocModel(res, langs, dpi, cfgDoc) {
  const D = Object.assign({ SIZE_BODY: 10.5, SIZE_NOTE: 9, SIZE_HEAD: 12, SIZE_TITLE: 16 }, cfgDoc || {}), mm = (px) => px * 25.4 / dpi, NOTE = noteRegex(langs);
  return res.paras.map((p) => {
    const tokens = [];                                          // words with their confidence; wrapped lines joined, end-of-line hyphens mended
    p.lines.forEach((x, li) => x.words.forEach((w, wi) => {
      const prev = tokens[tokens.length - 1];
      if (li > 0 && wi === 0 && prev && /-$/.test(prev.t) && /^[a-z]/.test(w.t)) { prev.t = prev.t.slice(0, -1) + w.t; prev.c = Math.min(prev.c, w.c); }
      else tokens.push({ t: w.t, c: w.c });
    }));
    const text = tokens.map((t) => t.t).join(' '), f = p.lines[0];
    let type = 'body';
    if (p.head) type = 'heading'; else if (NOTE.test(text)) type = 'note'; else if (/^([A-Za-z]\)|\(\w\)|[\u2022\-\u2013\u2014]\s)/.test(text)) type = 'list';
    const sizePt = type === 'heading' ? (p.align === 'center' ? D.SIZE_TITLE : D.SIZE_HEAD) : type === 'note' ? D.SIZE_NOTE : D.SIZE_BODY;
    return {
      origin: 'ocr', type, align: p.align, text, sizePt, bold: type === 'heading',
      indentMm: +mm(p.indentPx).toFixed(1), firstLineMm: p.indentPx > 0 ? +(-mm(p.indentPx - Math.max(p.firstPx, 0))).toFixed(1) : 0,
      conf: tokens.length ? tokens.reduce((a2, w) => a2 + w.c, 0) / tokens.length : 0, tokens, edited: false,
      box: { l: Math.min.apply(null, p.lines.map((x) => x.l)), t: f.t, r: Math.max.apply(null, p.lines.map((x) => x.r)), b: p.lines[p.lines.length - 1].b },
    };
  });
}

const API = { VERSION, DEFAULTS: CFG, mkLine, mergeRows, linesFromBlocks, infer, toDocModel, joinLines, median, percentile };
root.ScanToDocLayout = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
