/* ============================================================
   Form Scanner — browser engine
   Version: v6.0 (2026-09-24) — layout-spec rebuild on the v4.3 baseline
   Flow: photo/PDF -> Worker (Gemini) -> layout spec -> pdf-lib fillable PDF.
   All tunables live in FS_CONFIG. Full notes: FORM_SCANNER_SETUP_AND_GLOSSARY.md
   and FORM_SCANNER_HANDOFF.md. Nothing here is sent anywhere except the one
   Worker call; the finished PDF is built in the browser.
   ============================================================ */
(function (root) {
'use strict';

const VERSION = 'v6.0 (2026-09-24)';

/* ---------------- CONFIG (edit here only) ---------------- */
const FS_CONFIG = {
  PROXY_ENDPOINT: 'https://form-scanner-proxy.reysourcez-ent.workers.dev',
  MAX_IMAGE_EDGE: 2000,          // px, longest edge of a photo before upload
  JPEG_QUALITY: 0.9,
  MAX_FILE_MB: 15,               // reject bigger uploads up front
  MAX_SCANS_PER_DAY: 20,         // soft cap per browser (localStorage)
  PRECISE_COST: 2,               // a high-accuracy scan counts as this many
  USAGE_KEY: 'fs-usage',
  FIELD_TINT: [0.86, 0.91, 1],   // RGB 0-1, used ONLY when "shade fields" is ticked
  SIZES: { xs: 6.5, sm: 7.5, md: 8.5, lg: 10.5, xl: 13.5 }, // pt, before scaling
  MIN_FONT_SCALE: 0.55,          // smallest automatic shrink-to-fit
  MAX_FIELDS: 1500,              // safety cap on fillable fields per form
};

const PAGE_SIZES = {           // portrait points (w, h)
  A3: [841.89, 1190.55], A4: [595.28, 841.89], A5: [419.53, 595.28],
  A6: [297.64, 419.53], Letter: [612, 792], Legal: [612, 1008],
};
const MM = 72 / 25.4;

/* ---------------- small utils ---------------- */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d, lo, hi) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? clamp(n, lo, hi) : d;
};
const arr = (v) => (Array.isArray(v) ? v : []);
const pick = (v, list, d) => {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  const hit = list.find((x) => x.toLowerCase() === s);
  return hit !== undefined ? hit : d;
};
let droppedChars = 0;
function cleanText(s, max) {
  let out = String(s == null ? '' : s).slice(0, max || 400)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2022\u25CF\u25AA]/g, '*')
    .replace(/[\u00A0\u2007\u202F\t]/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '');
  const before = out.length;
  out = out.replace(/[^\n\x20-\x7E\xA1-\xFF]/g, '');   // standard PDF fonts = Latin only
  droppedChars += before - out.length;
  return out.replace(/ {2,}/g, ' ').replace(/ *\n */g, '\n').trim();
}
const oneLine = (s, max) => cleanText(s, max).replace(/\n/g, ' ');
const slug = (s, max) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '').slice(0, max || 30);
function parseFill(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
  if (s === 'light' || s === 'light_gray' || s === 'lightgray') return [0.93, 0.93, 0.93];
  if (s === 'gray' || s === 'grey' || s === 'medium') return [0.82, 0.82, 0.82];
  if (s === 'dark') return [0.35, 0.35, 0.35];
  return null;
}

/* ---------------- item mini-language ----------------
   CODE[flags] text   with CODE = T (text) F (field) C (tick boxes) SP (space) HR (rule) */
const ITEM_RE = /^(TEXT|FIELD|CHECKS?|SPACER?|RULE|SP|HR|T|F|C)(?:\[([^\]]*)\])?(?:\s+|$)([\s\S]*)$/i;
const CODE_MAP = { TEXT: 'T', T: 'T', FIELD: 'F', F: 'F', CHECK: 'C', CHECKS: 'C', C: 'C',
  SP: 'SP', SPACE: 'SP', SPACER: 'SP', HR: 'HR', RULE: 'HR' };

function parseFlags(s) {
  const f = { bold: false, italic: false, size: 'md', align: '', underline: false, blank: '',
    widthPct: 0, tall: false, rl: false, ind: false, layout: '', weight: 0 };
  String(s || '').split(/[,\s;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean).forEach((t) => {
    if (t === 'b' || t === 'bold') f.bold = true;
    else if (t === 'i' || t === 'it' || t === 'italic') f.italic = true;
    else if (t === 'bi' || t === 'ib') { f.bold = true; f.italic = true; }
    else if (['xs', 'sm', 'md', 'lg', 'xl'].includes(t)) f.size = t;
    else if (t === 'left' || t === 'center' || t === 'centre' || t === 'right') f.align = t === 'centre' ? 'center' : t;
    else if (t === 'ul' || t === 'underline' || t === 'underlined') f.underline = true;
    else if (t === 'line' || t === 'box' || t === 'none') f.blank = t;
    else if (/^w\d+(\.\d+)?$/.test(t)) f.widthPct = clamp(parseFloat(t.slice(1)), 0, 100);
    else if (t === 'tall' || t === 'multi' || t === 'multiline') f.tall = true;
    else if (t === 'rl' || t === 'labelright') f.rl = true;
    else if (t === 'ind' || t === 'indent') f.ind = true;
    else if (t === 'stack' || t === 'stacked' || t === 'vertical') f.layout = 'stack';
    else if (t === 'inline' || t === 'row') f.layout = 'inline';
    else if (/^\d+(\.\d+)?$/.test(t)) f.weight = clamp(parseFloat(t), 0, 20);
  });
  return f;
}

function parseItem(raw) {
  const s0 = String(raw == null ? '' : raw).replace(/\r/g, '').trim();
  if (!s0) return null;
  const m = ITEM_RE.exec(s0);
  const kind = m ? CODE_MAP[m[1].toUpperCase()] : 'T';
  const f = parseFlags(m ? m[2] : '');
  const body = m ? m[3] : s0;
  const it = { kind, bold: f.bold, italic: f.italic, size: f.size, align: f.align, underline: f.underline,
    blank: f.blank || 'line', widthPct: f.widthPct, tall: f.tall, rl: f.rl, ind: f.ind, layout: f.layout,
    weight: f.weight, text: '', options: [] };
  if (kind === 'C') {
    let label = '', opts = body;
    const at = body.indexOf('::');
    if (at >= 0) { label = body.slice(0, at); opts = body.slice(at + 2); }
    else if (body.indexOf(';') < 0) { label = ''; opts = body; }
    it.text = oneLine(label, 120);
    it.options = opts.split(';').map((o) => {
      const blank = /[_.]{2,}\s*$|\s_\s*$|_$/.test(o.trim());
      return { label: oneLine(o.replace(/[_.]{2,}|\s_\s*$|_$/g, ' '), 60), blank };
    }).filter((o) => o.label).slice(0, 12);
    if (!it.options.length) return null;
    if (!it.layout) it.layout = 'inline';
  } else if (kind === 'T') {
    it.text = cleanText(body, 400);
    if (!it.text) return null;
  } else if (kind === 'F') {
    it.text = oneLine(body, 200);
  } else if (kind === 'SP') {
    it.weight = it.weight || 1;
  }
  return it;
}

/* ---------------- spec normalisation ---------------- */
const int = (v, d, lo, hi) => Math.round(num(v, d, lo, hi));

function normCell(c) {
  if (!c || typeof c !== 'object') return null;
  return {
    col: int(c.col, 1, 1, 12) - 1,
    heightPct: num(c.height_pct, 0, 0, 100),
    boxed: !!c.boxed,
    fill: parseFill(c.fill),
    items: arr(c.items).slice(0, 60).map(parseItem).filter(Boolean),
  };
}

function normTable(t) {
  if (!t || typeof t !== 'object') return null;
  const cols = arr(t.columns).slice(0, 24).map((c) => ({
    header: oneLine(c && (c.header != null ? c.header : c), 100),
    widthPct: num(c && c.width_pct, 0, 0, 100),
    align: pick(c && c.align, ['left', 'center', 'right'], ''),
    fill: parseFill(c && c.fill),
  }));
  if (!cols.length) return null;
  const w = cols.map((c) => c.widthPct);
  if (!w.some((x) => x > 0)) cols.forEach((c) => { c.widthPct = Math.max(4, c.header.length); });
  else cols.forEach((c) => { if (!c.widthPct) c.widthPct = Math.min(...w.filter((x) => x > 0)); });
  const groups = arr(t.header_groups).slice(0, 12).map((g) => ({
    text: oneLine(g && g.text, 80), from: int(g && g.from_column, 1, 1, 24) - 1,
    span: int(g && g.span, 1, 1, 24), fill: parseFill(g && g.fill),
  })).filter((g) => g.from < cols.length).map((g) => ({ ...g, span: Math.min(g.span, cols.length - g.from) }));
  const rows = arr(t.static_rows).slice(0, 60).map((r) => {
    const cells = arr(r).slice(0, cols.length).map((x) => oneLine(x, 160));
    while (cells.length < cols.length) cells.push('');
    return cells;
  });
  const fillable = t.fillable === undefined ? true : !!t.fillable;
  let blankRows = int(t.blank_rows, 0, 0, 80);
  const totalLabel = oneLine(t.total_label, 80);
  if (!rows.length && !blankRows && !totalLabel) blankRows = 1;
  return {
    widthPct: num(t.width_pct, 100, 20, 100), columns: cols, groups,
    headerFill: parseFill(t.header_fill) || null, rows, blankRows,
    numbered: !!t.numbered, totalLabel, totalSpan: int(t.total_span, 1, 1, cols.length),
    fillable,
  };
}

function normBand(b, n) {
  if (!b || typeof b !== 'object') return null;
  const heightPct = num(b.height_pct, 0, 0, 100);
  const gap = pick(b.gap, ['none', 'small', 'medium', 'large'], 'none');
  if (String(b.kind).toLowerCase() === 'table' && b.table) {
    const table = normTable(b.table);
    return table ? { n, kind: 'table', heightPct, gap, boxed: false, table } : null;
  }
  const cells = arr(b.cells).slice(0, 40).map(normCell).filter(Boolean);
  if (!cells.length) return null;
  const maxCol = Math.max(...cells.map((c) => c.col + 1), 1);
  let colW = arr(b.col_widths_pct).slice(0, 12).map((v) => num(v, 0, 0, 100));
  const ncols = Math.max(colW.length, maxCol, 1);
  const known = colW.filter((v) => v > 0);
  const fallback = known.length ? known.reduce((a, c) => a + c, 0) / known.length : 100 / ncols;
  colW = Array.from({ length: ncols }, (_, i) => (colW[i] > 0 ? colW[i] : fallback));
  const sum = colW.reduce((a, c) => a + c, 0);
  cells.forEach((c) => { if (c.col >= ncols) c.col = ncols - 1; });
  return { n, kind: 'cells', heightPct, gap, boxed: !!b.boxed, colWidths: colW.map((v) => v / sum), cells };
}

function normalizeSpec(raw) {
  droppedChars = 0;
  const r = raw && typeof raw === 'object' ? raw : {};
  const pg = r.page && typeof r.page === 'object' ? r.page : {};
  const rq = r.requested && typeof r.requested === 'object' ? r.requested : {};
  const sizes = Object.keys(PAGE_SIZES);
  const bands = arr(r.bands).slice(0, 40).map((b, i) => normBand(b, i + 1)).filter(Boolean);
  const frames = arr(r.frames).slice(0, 6).map((f) => {
    const from = int(f && f.from_band, 0, 0, 99), to = int(f && f.to_band, 0, 0, 99);
    const a = bands.findIndex((b) => b.n >= from);
    let z = -1;
    bands.forEach((b, i) => { if (b.n <= to) z = i; });
    return a >= 0 && z >= a ? { from: a, to: z } : null;
  }).filter(Boolean);
  const spec = {
    recognized: !!r.recognized && bands.length > 0,
    title: oneLine(r.title, 160),
    referenceCode: oneLine(r.reference_code, 80),
    page: {
      size: pick(pg.size, sizes, 'A4'),
      orientation: pick(pg.orientation, ['portrait', 'landscape'], ''),
      font: pick(pg.font, ['sans', 'serif', 'mono'], 'sans'),
      marginPct: num(pg.margin_pct, 5, 2, 12),
      fillPct: num(pg.fill_pct, 100, 40, 100),
    },
    requested: {
      size: pick(rq.size, sizes, 'none'),
      orientation: pick(rq.orientation, ['portrait', 'landscape'], 'none'),
      font: pick(rq.font, ['sans', 'serif', 'mono'], 'none'),
      textScale: num(rq.text_scale_pct, 0, 0, 300) / 100,
    },
    frames, bands, warnings: [],
  };
  if (droppedChars > 0) {
    spec.warnings.push('Some characters outside the Latin alphabet cannot be drawn with the built-in PDF fonts and were left out.');
  }
  return spec;
}

/* ---------------- page resolution ----------------
   src: { kind: 'pdf', width, height } exact pts | { kind: 'image', width, height } px | null */
function labelForSize(W, H) {
  const wide = W > H, a = Math.min(W, H), b = Math.max(W, H);
  const hit = Object.keys(PAGE_SIZES).find((k) => Math.abs(PAGE_SIZES[k][0] - a) < 3 && Math.abs(PAGE_SIZES[k][1] - b) < 3);
  const dims = `${Math.round(a / MM)} x ${Math.round(b / MM)} mm`;
  return (hit ? hit : dims) + (wide ? ' landscape' : ' portrait');
}

function resolvePage(spec, src) {
  const rq = spec.requested;
  let W, H, origin, orient;
  const srcPdf = src && src.kind === 'pdf' && src.width > 0 && src.height > 0 ? src : null;
  if (rq.size !== 'none') {
    [W, H] = PAGE_SIZES[rq.size]; origin = 'your note';
    orient = rq.orientation !== 'none' ? rq.orientation
      : srcPdf ? (srcPdf.width > srcPdf.height ? 'landscape' : 'portrait')
        : (spec.page.orientation || 'portrait');
  } else if (srcPdf) {
    W = srcPdf.width; H = srcPdf.height; origin = 'your PDF';
    orient = rq.orientation !== 'none' ? rq.orientation : (W > H ? 'landscape' : 'portrait');
    if (rq.orientation !== 'none') origin = 'your note';
  } else {
    [W, H] = PAGE_SIZES[spec.page.size]; origin = 'photo';
    const aspectWide = src && src.width && src.height ? src.width > src.height : false;
    orient = rq.orientation !== 'none' ? rq.orientation
      : (spec.page.orientation || (aspectWide ? 'landscape' : 'portrait'));
    if (rq.orientation !== 'none') origin = 'your note';
  }
  const lo = Math.min(W, H), hi = Math.max(W, H);
  if (!(srcPdf && rq.size === 'none' && rq.orientation === 'none')) {
    W = orient === 'landscape' ? hi : lo; H = orient === 'landscape' ? lo : hi;
  }
  return {
    W, H, origin, label: labelForSize(W, H),
    family: rq.font !== 'none' ? rq.font : spec.page.font,
    textScale: rq.textScale > 0 ? clamp(rq.textScale, 0.6, 2) : 1,
  };
}

/* ============================================================
   LAYOUT ENGINE — pure geometry + pdf-lib calls (top-down y)
   spec -> measure at font-scale fs -> distribute heights -> draw
   ============================================================ */
const FONT_MAP = {
  sans: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  serif: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  mono: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
};

function wrapLines(font, text, size, maxW) {
  const limit = Math.max(maxW, size);
  const out = [];
  String(text).split('\n').forEach((par) => {
    const words = par.split(' ').filter(Boolean);
    if (!words.length) { out.push(''); return; }
    let line = '';
    words.forEach((w) => {
      let word = w;
      while (font.widthOfTextAtSize(word, size) > limit && word.length > 1) {
        let k = word.length - 1;
        while (k > 1 && font.widthOfTextAtSize(word.slice(0, k), size) > limit) k--;
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, k));
        word = word.slice(k);
      }
      const trial = line ? line + ' ' + word : word;
      if (line && font.widthOfTextAtSize(trial, size) > limit) { out.push(line); line = word; }
      else line = trial;
    });
    if (line) out.push(line);
  });
  return out.length ? out : [''];
}

function makeCtx(PDFLib, form, page, fonts, info, marginPt, shade) {
  const { rgb } = PDFLib;
  const H = info.H;
  const tint = FS_CONFIG.FIELD_TINT;
  const c = {
    PDFLib, W: info.W, H, M: marginPt, fs: 1, textScale: info.textScale, lw: 0.8,
    ink: rgb(0, 0, 0), globalRL: 0, warnings: [], names: new Set(), fields: [], checks: 0,
    font: (b, i) => fonts[(b ? 1 : 0) + (i ? 2 : 0)],
    textW: (font, s, size) => font.widthOfTextAtSize(s, size),
    name(base) {
      const n = slug(base, 28) || 'field';
      let k = n, i = 2;
      while (c.names.has(k)) k = n + '_' + i++;
      c.names.add(k);
      return k;
    },
    text(str, x, base, size, font) {
      if (str) page.drawText(str, { x, y: H - base, size, font, color: c.ink });
    },
    line(x1, y1, x2, y2, w) {
      page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: w, color: rgb(0, 0, 0) });
    },
    rect(x, y, w, h, o) {
      const opt = o || {};
      page.drawRectangle({
        x, y: H - y - h, width: w, height: h,
        color: opt.fill ? rgb(opt.fill[0], opt.fill[1], opt.fill[2]) : undefined,
        borderColor: opt.stroke === false ? undefined : rgb(0, 0, 0),
        borderWidth: opt.stroke === false ? 0 : (opt.lw || c.lw),
      });
    },
    textField(name, x, y, w, h, o) {
      if (c.fields.length >= FS_CONFIG.MAX_FIELDS) { c.capped = true; return; }
      const tf = form.createTextField(name);
      if (o.multiline) tf.enableMultiline();
      // pdf-lib defaults to a WHITE background + black border unless these keys exist,
      // so they are always passed explicitly (undefined = truly colourless).
      tf.addToPage(page, {
        x, y: H - y - h, width: w, height: h, font: fonts[0],
        textColor: rgb(0, 0, 0), borderWidth: 0, borderColor: undefined,
        backgroundColor: shade ? rgb(tint[0], tint[1], tint[2]) : undefined,
      });
      tf.setFontSize(o.size);           // needs the /DA entry that addToPage creates
      c.fields.push({ name, x, y, w, h });
    },
    checkbox(name, x, y, s) {
      c.rect(x, y, s, s, { lw: 0.8 });      // visible square is page content, so no viewer redraw can lose it
      const cb = form.createCheckBox(name);
      cb.addToPage(page, {
        x, y: H - y - s, width: s, height: s, textColor: rgb(0, 0, 0),
        borderColor: undefined, borderWidth: 0,
        backgroundColor: shade ? rgb(tint[0], tint[1], tint[2]) : undefined,
      });
      c.checks++;
    },
  };
  return c;
}

/* ---- sizes ---- */
const padX = (c) => 4 * c.fs;
const padY = (c) => 3 * c.fs;
const itemGap = (c) => 1.2 * c.fs;
const gapBetween = (a, b2, c) => (a.kind === 'F' && b2.kind === 'F' && a.blank === 'box' && b2.blank === 'box' ? 0 : itemGap(c));
const isz = (it, c) => FS_CONFIG.SIZES[it.size] * c.textScale * c.fs;
const ifont = (it, c) => c.font(it.bold, it.italic);
const rowHFor = (size, c) => Math.max(size * 1.2 + 5 * c.fs, 13.5 * c.fs);
const isLabelled = (it) => (it.kind === 'F' || it.kind === 'C') && it.text;

function labelColWidth(items, innerW, colIndex, c) {
  let lw = 0;
  items.forEach((it) => {
    if (isLabelled(it)) {
      const w = c.textW(ifont(it, c), it.text, isz(it, c));
      if (w <= 0.62 * innerW) lw = Math.max(lw, w);
    }
  });
  if (colIndex === 0 && items.some((it) => isLabelled(it) && it.rl)) lw = Math.max(lw, c.globalRL);
  return lw > 0 ? Math.min(lw + 5 * c.fs, 0.6 * innerW) : 0;
}

function globalRightLabelWidth(spec, c) {
  let m = 0;
  spec.bands.forEach((b) => {
    if (b.kind !== 'cells') return;
    b.cells.forEach((cell) => {
      if (cell.col !== 0) return;
      cell.items.forEach((it) => {
        if (isLabelled(it) && it.rl) m = Math.max(m, c.textW(ifont(it, c), it.text, isz(it, c)));
      });
    });
  });
  return m;
}

/* ---- item measure ---- */
function measureItem(it, innerW, lblW, c) {
  const size = isz(it, c), font = ifont(it, c), lh = size * 1.2, rowH = rowHFor(size, c);
  if (it.kind === 'T') {
    const lines = wrapLines(font, it.text, size, innerW);
    return { h: lines.length * lh + c.fs, lines, size, font, lh };
  }
  if (it.kind === 'HR') return { h: 5 * c.fs };
  if (it.kind === 'SP') return { h: 1.5 * c.fs, flex: it.weight || 1 };
  if (it.kind === 'F') {
    const lw = it.text ? c.textW(font, it.text, size) : 0;
    if (lw > 0.62 * innerW) {
      const lines = wrapLines(font, it.text, size, innerW);
      return { h: lines.length * lh + (it.tall ? 2.2 * rowH : rowH), long: true, lines, size, font, lh, rowH, lw, flex: it.tall ? 1 : 0 };
    }
    return { h: it.tall ? 2.2 * rowH : rowH, size, font, lh, rowH, lw, flex: it.tall ? 1 : 0 };
  }
  // C: tick boxes
  const chk = Math.max(6, 7.6 * c.fs), optH = Math.max(lh, chk) + 3 * c.fs;
  const ownLbl = it.text ? c.textW(font, it.text, size) + 5 * c.fs : 0;
  const startX = it.text ? Math.min(lblW || ownLbl, 0.6 * innerW) : 0;
  const places = [];
  let rows = 1;
  if (it.layout === 'stack') {
    it.options.forEach((o, i) => places.push({ dx: startX, row: i }));
    rows = Math.max(1, it.options.length);
  } else {
    let x = startX, row = 0;
    it.options.forEach((o) => {
      const ow = chk + 3 * c.fs + c.textW(font, o.label, size) + (o.blank ? 3 * c.fs + 60 * c.fs : 0);
      if (x > startX && x + ow > innerW) { row++; x = startX; }
      places.push({ dx: x, row });
      x += ow + 9 * c.fs;
    });
    rows = row + 1;
  }
  return { h: rows * optH, size, font, lh, chk, optH, places, startX, rows };
}

/* ---- cell measure / draw ---- */
function measureCell(cell, colW, colIndex, c) {
  if (!cell.items.length) return { nat: 0, ms: [], gaps: [], lblW: 0, innerW: 0 };
  const innerW = Math.max(colW - 2 * padX(c), 10);
  const lblW = labelColWidth(cell.items, innerW, colIndex, c);
  const ms = cell.items.map((it) => measureItem(it, innerW, lblW, c));
  const gaps = cell.items.map((it, i) => (i < cell.items.length - 1 ? gapBetween(it, cell.items[i + 1], c) : 0));
  const nat = 2 * padY(c) + ms.reduce((a, m) => a + m.h, 0) + gaps.reduce((a, g) => a + g, 0);
  return { nat, ms, gaps, lblW, innerW };
}

function drawLabel(it, m, gx, base, lw, c) {
  const tw = c.textW(m.font, it.text, m.size);
  const lx = it.rl && lw > 0 ? Math.max(gx, gx + lw - 5 * c.fs - tw) : gx;
  c.text(it.text, lx, base, m.size, m.font);
  return lx;
}

function drawField(it, m, x, y, w, h, lblW, c) {
  const size = m.size, rowH = m.rowH;
  let by = y, bh = it.tall ? h : Math.max(rowH, h);
  let lw = 0;
  if (m.long) {
    m.lines.forEach((ln, i) => c.text(ln, x, y + i * m.lh + m.lh / 2 + 0.35 * size, size, m.font));
    by = y + m.lines.length * m.lh;
    bh = Math.max(rowH, h - m.lines.length * m.lh);
  } else if (it.text) {
    const grouped = (it.align === 'center' || it.align === 'right') && it.widthPct > 0;
    lw = grouped ? m.lw + 5 * c.fs : lblW;
  } else if (it.ind) lw = lblW;
  const blankMax = w - lw;
  const blankW = it.widthPct > 0 ? Math.min(w * it.widthPct / 100, blankMax) : blankMax;
  let gx = x;
  if (it.widthPct > 0 && (it.align === 'center' || it.align === 'right')) {
    const gw = lw + blankW;
    gx = it.align === 'center' ? x + (w - gw) / 2 : x + w - gw;
  }
  if (!m.long && it.text) {
    drawLabel(it, m, gx, (it.tall ? by + m.lh / 2 : by + bh / 2) + 0.35 * size, lw, c);
  }
  const bx = gx + lw;
  if (blankW > 4 && bh > 4) {
    if (it.blank === 'box') c.rect(bx, by, blankW, bh, { lw: 0.7 });
    else if (it.blank === 'line') c.line(bx, by + bh - 0.6 * c.fs, bx + blankW, by + bh - 0.6 * c.fs, 0.6);
    const fh = it.blank === 'line' ? bh - 3.2 * c.fs : bh - 2 * c.fs;
    if (fh > 3) {
      c.textField(c.name(it.text || 'line'), bx + 1, by + 1, blankW - 2, fh, {
        multiline: it.tall && bh > 2 * rowH * 0.9,
        size: clamp(rowH * 0.58, 6, 10),
      });
    }
  }
}

function drawChecks(it, m, x, y, w, h, c) {
  const size = m.size;
  const optH = Math.max(m.optH, h / m.rows);
  if (it.text) {
    const tw = c.textW(m.font, it.text, size);
    const lx = it.rl ? Math.max(x, x + m.startX - 5 * c.fs - tw) : x;
    c.text(it.text, lx, y + optH / 2 + 0.35 * size, size, m.font);
  }
  it.options.forEach((o, i) => {
    const p = m.places[i];
    const ox = x + p.dx, oy = y + p.row * optH;
    c.checkbox(c.name((it.text ? slug(it.text, 14) + '_' : '') + slug(o.label, 14)), ox, oy + (optH - m.chk) / 2, m.chk);
    const tx = ox + m.chk + 3 * c.fs;
    c.text(o.label, tx, oy + optH / 2 + 0.35 * size, size, m.font);
    if (o.blank) {
      const lx = tx + c.textW(m.font, o.label, size) + 3 * c.fs;
      const lw2 = Math.min(60 * c.fs, x + w - lx);
      if (lw2 > 10) {
        c.line(lx, oy + optH - 2 * c.fs, lx + lw2, oy + optH - 2 * c.fs, 0.6);
        c.textField(c.name(slug(o.label, 14) + '_no'), lx, oy + 1, lw2, optH - 4.2 * c.fs, { size: clamp(optH * 0.5, 6, 9) });
      }
    }
  });
}

function drawItem(it, m, x, y, w, h, lblW, c) {
  if (it.kind === 'T') {
    m.lines.forEach((ln, i) => {
      const tw = c.textW(m.font, ln, m.size);
      const tx = it.align === 'center' ? x + (w - tw) / 2 : it.align === 'right' ? x + w - tw : x;
      const base = y + i * m.lh + m.lh / 2 + 0.35 * m.size;
      c.text(ln, tx, base, m.size, m.font);
      if (it.underline) c.line(tx, base + 1.6 * c.fs, tx + tw, base + 1.6 * c.fs, 0.5);
    });
  } else if (it.kind === 'HR') {
    const rw = it.widthPct > 0 ? w * it.widthPct / 100 : w;
    const rx = it.align === 'center' ? x + (w - rw) / 2 : it.align === 'right' ? x + w - rw : x;
    c.line(rx, y + h / 2, rx + rw, y + h / 2, 0.7);
  } else if (it.kind === 'F') drawField(it, m, x, y, w, h, m.lblW, c);
  else if (it.kind === 'C') drawChecks(it, m, x, y, w, h, c);
}

function luminance(f) { return 0.299 * f[0] + 0.587 * f[1] + 0.114 * f[2]; }

function drawCell(cell, m, x, y, w, h, c) {
  const { rgb } = c.PDFLib;
  if (cell.fill) c.rect(x, y, w, h, { fill: cell.fill, stroke: false });
  if (cell.boxed) c.rect(x, y, w, h, { lw: c.lw });
  if (!cell.items.length) return;
  const prevInk = c.ink;
  c.ink = cell.fill && luminance(cell.fill) < 0.4 ? rgb(1, 1, 1) : rgb(0, 0, 0);
  const free = h - m.nat;
  const flexTotal = m.ms.reduce((a, mm) => a + (mm.flex || 0), 0);
  const heights = m.ms.map((mm) => mm.h);
  let offset = padY(c);
  if (free > 0) {
    const stretch = cell.items.map((it) => it.kind === 'C' || it.kind === 'F');
    const visible = cell.items.filter((it) => it.kind === 'C' || (it.kind === 'F' && it.blank !== 'none')).length;
    const single = cell.items.length === 1 && stretch[0];
    if (flexTotal > 0) m.ms.forEach((mm, i) => { if (mm.flex) heights[i] += free * mm.flex / flexTotal; });
    else if (visible >= 2 || single) {
      const base = m.ms.reduce((a, mm, i) => a + (stretch[i] ? mm.h : 0), 0);
      m.ms.forEach((mm, i) => { if (stretch[i]) heights[i] += free * mm.h / base; });
    } else if (cell.items.every((it) => it.kind === 'T' || it.kind === 'HR')) offset += free / 2;
  }
  let cy = y + offset;
  const ix = x + padX(c);
  cell.items.forEach((it, i) => {
    const mm = m.ms[i];
    mm.lblW = m.lblW;
    drawItem(it, mm, ix, cy, m.innerW, heights[i], m.lblW, c);
    cy += heights[i] + m.gaps[i];
  });
  c.ink = prevInk;
}

/* water-filling: shares -> heights summing to H, never below nats */
function distribute(shares, nats, H) {
  const n = shares.length;
  const pos = shares.filter((s) => s > 0);
  const avg = pos.length ? pos.reduce((a, b) => a + b, 0) / pos.length : 1;
  const s = shares.map((v) => (v > 0 ? v : avg));
  const tot = s.reduce((a, b) => a + b, 0) || n;
  let h = s.map((v) => v / tot * H);
  let deficit = 0;
  h = h.map((v, i) => (v < nats[i] ? (deficit += nats[i] - v, nats[i]) : v));
  if (deficit > 0) {
    const slack = h.map((v, i) => Math.max(0, v - nats[i]));
    const sum = slack.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      const cut = Math.min(deficit, sum);
      h = h.map((v, i) => v - cut * slack[i] / sum);
    }
  }
  return h;
}

/* ---- bands: cells ---- */
function measureCellsBand(band, W, c) {
  const cw = band.colWidths.map((f) => f * W);
  const cols = cw.map(() => []);
  band.cells.forEach((cell) => cols[cell.col].push(cell));
  let nat = 0;
  const colInfo = cols.map((cells, j) => {
    const ms = cells.map((cell) => measureCell(cell, cw[j], j, c));
    nat = Math.max(nat, ms.reduce((a, m) => a + m.nat, 0));
    return { cells, ms };
  });
  return { kind: 'cells', nat, cw, colInfo, flexible: true, W };
}

function drawCellsBand(band, info, x, y, H, c) {
  let cx = x;
  info.colInfo.forEach((col, j) => {
    if (col.cells.length) {
      const hs = distribute(col.cells.map((cell) => cell.heightPct), col.ms.map((m) => m.nat), H);
      let cy = y;
      col.cells.forEach((cell, i) => { drawCell(cell, col.ms[i], cx, cy, info.cw[j], hs[i], c); cy += hs[i]; });
    }
    cx += info.cw[j];
  });
  if (band.boxed) c.rect(x, y, info.W, H, { lw: c.lw });
}

/* ---- bands: tables ---- */
function measureTable(band, W, c) {
  const t = band.table;
  const TW = W * t.widthPct / 100;
  const wsum = t.columns.reduce((a, col) => a + col.widthPct, 0) || 1;
  const cw = t.columns.map((col) => col.widthPct / wsum * TW);
  const size = FS_CONFIG.SIZES.sm * c.textScale * c.fs, lh = size * 1.2, pad = 2.6 * c.fs;
  const bold = c.font(true, false), reg = c.font(false, false);
  const headLines = t.columns.map((col, j) => wrapLines(bold, col.header, size, cw[j] - 2 * pad));
  const covered = new Array(t.columns.length).fill(-1);
  t.groups.forEach((g, gi) => { for (let k = g.from; k < g.from + g.span; k++) covered[k] = gi; });
  const groupLines = t.groups.map((g) => {
    const gw = cw.slice(g.from, g.from + g.span).reduce((a, b) => a + b, 0);
    return wrapLines(bold, g.text, size, gw - 2 * pad);
  });
  const groupH = t.groups.length ? Math.max(1, ...groupLines.map((l) => l.length)) * lh + 2 * pad : 0;
  const headerH = Math.max(1, ...t.columns.map((col, j) => (covered[j] >= 0 || !t.groups.length ? headLines[j].length : Math.max(1, headLines[j].length - 1)))) * lh + 2 * pad;
  const rowMin = Math.max(size * 1.2 + 2 * pad, 14.5 * c.fs);
  const staticH = t.rows.map((r) => Math.max(rowMin, ...r.map((txt, j) => (txt ? wrapLines(reg, txt, size, cw[j] - 2 * pad).length * lh + 2 * pad : 0))));
  const totalH = t.totalLabel ? rowMin * 1.05 : 0;
  const nat = groupH + headerH + staticH.reduce((a, b) => a + b, 0) + t.blankRows * rowMin + totalH;
  return { kind: 'table', nat, cw, TW, size, lh, pad, headLines, groupLines, covered, groupH, headerH, rowMin, staticH, totalH, flexible: t.blankRows > 0, W };
}

function drawTable(band, info, x, y, H, c) {
  const t = band.table;
  const { cw, size, lh, pad, headLines, groupLines, covered, groupH, headerH, rowMin, staticH, totalH } = info;
  const { rgb } = c.PDFLib;
  const bold = c.font(true, false), reg = c.font(false, false);
  const extra = Math.max(0, H - info.nat);
  const blankH = t.blankRows ? rowMin + extra / t.blankRows : 0;
  const colX = [x];
  cw.forEach((w) => colX.push(colX[colX.length - 1] + w));
  const hasGroups = t.groups.length > 0;
  const y1 = y + (hasGroups ? groupH : 0), y2 = y1 + headerH;
  const inkFor = (fill) => (fill && luminance(fill) < 0.4 ? rgb(1, 1, 1) : rgb(0, 0, 0));
  const centered = (lines, cx0, cw0, top, h0, font, fill) => {
    const prev = c.ink; c.ink = inkFor(fill);
    const block = lines.length * lh, start = top + (h0 - block) / 2;
    lines.forEach((ln, i) => {
      const tw = c.textW(font, ln, size);
      c.text(ln, cx0 + (cw0 - tw) / 2, start + i * lh + lh / 2 + 0.35 * size, size, font);
    });
    c.ink = prev;
  };
  t.groups.forEach((g, gi) => {
    const gx = colX[g.from], gw = colX[g.from + g.span] - gx;
    const fill = g.fill || t.headerFill;
    c.rect(gx, y, gw, groupH, { fill, lw: 0.6 });
    centered(groupLines[gi], gx, gw, y, groupH, bold, fill);
  });
  t.columns.forEach((col, j) => {
    const under = covered[j] >= 0;
    const top = under ? y1 : y;
    const hh = under ? headerH : (hasGroups ? groupH + headerH : headerH);
    const fill = col.fill || (under ? t.groups[covered[j]].fill : null) || t.headerFill;
    c.rect(colX[j], top, cw[j], hh, { fill, lw: 0.6 });
    centered(headLines[j], colX[j], cw[j], top, hh, bold, fill);
  });
  let cy = y2;
  const cellText = (txt, j, top, h0, font) => {
    const lines = wrapLines(font, txt, size, cw[j] - 2 * pad);
    const align = t.columns[j].align || 'left';
    const block = lines.length * lh, start = top + (h0 - block) / 2;
    lines.forEach((ln, i) => {
      const tw = c.textW(font, ln, size);
      const tx = align === 'center' ? colX[j] + (cw[j] - tw) / 2 : align === 'right' ? colX[j] + cw[j] - pad - tw : colX[j] + pad;
      c.text(ln, tx, start + i * lh + lh / 2 + 0.35 * size, size, font);
    });
  };
  const cellField = (j, top, h0, rowName) => {
    if (!t.fillable || cw[j] < 12) return;
    c.textField(c.name(rowName + '_' + slug(t.columns[j].header, 14)), colX[j] + 1, top + 1, cw[j] - 2, h0 - 2,
      { multiline: h0 > lh * 2.4, size: clamp(rowMin * 0.55, 6, 9) });
  };
  t.rows.forEach((r, i) => {
    const h0 = staticH[i];
    r.forEach((txt, j) => {
      c.rect(colX[j], cy, cw[j], h0, { lw: 0.5 });
      if (txt) cellText(txt, j, cy, h0, reg);
      else cellField(j, cy, h0, 'r' + (i + 1));
    });
    cy += h0;
  });
  for (let i = 0; i < t.blankRows; i++) {
    t.columns.forEach((col, j) => {
      c.rect(colX[j], cy, cw[j], blankH, { lw: 0.5 });
      if (t.numbered && j === 0) cellText(`${t.rows.length + i + 1}.`, 0, cy, blankH, reg);
      else cellField(j, cy, blankH, 'r' + (t.rows.length + i + 1));
    });
    cy += blankH;
  }
  if (t.totalLabel) {
    const span = Math.min(t.totalSpan, t.columns.length);
    const sw = colX[span] - x;
    c.rect(x, cy, sw, totalH, { lw: 0.5 });
    const tw = c.textW(bold, t.totalLabel, size);
    c.text(t.totalLabel, x + sw - pad - tw, cy + totalH / 2 + 0.35 * size, size, bold);
    for (let j = span; j < t.columns.length; j++) {
      c.rect(colX[j], cy, cw[j], totalH, { lw: 0.5 });
      cellField(j, cy, totalH, 'total');
    }
    cy += totalH;
  }
  c.rect(x, y, info.TW, cy - y, { lw: 0.9 });
}

/* ---- planning ---- */
function gapPts(gap, usableH) {
  return { none: 0, small: 0.015, medium: 0.03, large: 0.055 }[gap] * usableH || 0;
}

function planLayout(spec, c) {
  const contentW = c.W - 2 * c.M, usableH = c.H - 2 * c.M;
  const stackH = usableH * spec.page.fillPct / 100;
  const gaps = spec.bands.map((b, i) => (i ? gapPts(b.gap, usableH) : 0));
  const gapSum = gaps.reduce((a, b) => a + b, 0);
  const steps = [];
  for (let s = 1; s >= FS_CONFIG.MIN_FONT_SCALE - 1e-9; s -= 0.05) steps.push(Math.round(s * 100) / 100);
  let measured = null, fit = false;
  for (const s of steps) {
    c.fs = s;
    c.globalRL = globalRightLabelWidth(spec, c);
    measured = spec.bands.map((b) => (b.kind === 'table' ? measureTable(b, contentW, c) : measureCellsBand(b, contentW, c)));
    const natSum = measured.reduce((a, m) => a + m.nat, 0);
    if (natSum + gapSum <= stackH + 0.5) { fit = true; break; }
  }
  const natSum = measured.reduce((a, m) => a + m.nat, 0);
  const gapScale = natSum + gapSum > stackH ? Math.max(0, (stackH - natSum) / (gapSum || 1)) : 1;
  const G = gaps.map((g) => g * Math.min(1, gapScale));
  const avail = stackH - G.reduce((a, b) => a + b, 0);
  const pcts = spec.bands.map((b) => b.heightPct);
  const pctSum = pcts.reduce((a, b) => a + b, 0);
  const desired = pcts.map((p, i) => (pctSum > 0 ? p / pctSum * avail : measured[i].nat));
  let h = measured.map((m, i) => (m.flexible ? Math.max(desired[i], m.nat) : m.nat));
  let total = h.reduce((a, b) => a + b, 0);
  if (total > avail + 0.5) {                         // cut from bands that have slack
    const slack = h.map((v, i) => (measured[i].flexible ? Math.max(0, v - measured[i].nat) : 0));
    const sum = slack.reduce((a, b) => a + b, 0);
    if (sum > 0) { const cut = Math.min(total - avail, sum); h = h.map((v, i) => v - cut * slack[i] / sum); }
  } else if (total < avail - 0.5) {                  // hand spare height to flexible bands
    const flex = measured.map((m, i) => (m.flexible ? desired[i] : 0));
    const fsum = flex.reduce((a, b) => a + b, 0);
    if (fsum > 0) h = h.map((v, i) => v + (avail - total) * flex[i] / fsum);
  }
  return { measured, heights: h, gaps: G, fit, fontScale: c.fs, contentW };
}

function drawPlan(spec, plan, c) {
  let y = c.M;
  const tops = [], bottoms = [];
  spec.bands.forEach((b, i) => {
    y += plan.gaps[i];
    const m = plan.measured[i], hh = plan.heights[i];
    if (b.kind === 'table') drawTable(b, m, c.M, y, hh, c);
    else drawCellsBand(b, m, c.M, y, hh, c);
    tops.push(y); bottoms.push(y + hh);
    y += hh;
  });
  spec.frames.forEach((f) => c.rect(c.M, tops[f.from], plan.contentW, bottoms[f.to] - tops[f.from], { lw: c.lw * 1.15 }));
  return y;
}

/* automated QA (from the reportlab hand-off notes): fields must not collide or leave the page */
function qaFields(c) {
  const issues = [];
  const f = c.fields;
  f.forEach((a) => {
    if (a.x < -0.5 || a.y < -0.5 || a.x + a.w > c.W + 0.5 || a.y + a.h > c.H + 0.5) issues.push(`off-page: ${a.name}`);
  });
  for (let i = 0; i < f.length; i++) {
    for (let j = i + 1; j < f.length; j++) {
      const a = f[i], b = f[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ox > 1 && oy > 1) issues.push(`overlap: ${a.name} / ${b.name}`);
    }
  }
  return issues;
}

async function buildFillablePdf(PDFLib, spec, pageInfo, opts) {
  const { PDFDocument, StandardFonts } = PDFLib;
  const o = opts || {};
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(spec.title || 'Scanned form');
  pdfDoc.setCreator('Reysourcez Form Scanner');
  pdfDoc.setProducer('Reysourcez Form Scanner ' + VERSION);
  const names = FONT_MAP[pageInfo.family] || FONT_MAP.sans;
  const fonts = [];
  for (const n of names) fonts.push(await pdfDoc.embedFont(StandardFonts[n]));
  const page = pdfDoc.addPage([pageInfo.W, pageInfo.H]);
  const form = pdfDoc.getForm();
  const marginPt = clamp(pageInfo.W * spec.page.marginPct / 100, 14, 60);
  const c = makeCtx(PDFLib, form, page, fonts, pageInfo, marginPt, !!o.shade);
  const plan = planLayout(spec, c);
  drawPlan(spec, plan, c);
  form.updateFieldAppearances(fonts[0]);
  // pdf-lib never writes AcroForm /DR + /DA; without them viewers guess the typing font.
  const { PDFName, PDFString } = PDFLib;
  const acro = form.acroForm.dict;
  acro.set(PDFName.of('DR'), pdfDoc.context.obj({ Font: { [fonts[0].name]: fonts[0].ref } }));
  acro.set(PDFName.of('DA'), PDFString.of(`/${fonts[0].name} 0 Tf 0 g`));
  const bytes = await pdfDoc.save();
  const warnings = spec.warnings.slice();
  if (c.capped) warnings.push(`Only the first ${FS_CONFIG.MAX_FIELDS} fillable fields were created.`);
  if (!plan.fit) warnings.push('This form is very dense, so some text may sit close to the page edge.');
  else if (plan.fontScale < 0.999) warnings.push(`Text was reduced to ${Math.round(plan.fontScale * 100)}% so everything fits the page.`);
  const issues = qaFields(c);
  if (issues.length) warnings.push(`${issues.length} layout check${issues.length === 1 ? '' : 's'} flagged (fields close together or near the edge).`);
  return { bytes, warnings, issues, stats: { fields: c.fields.length, checkboxes: c.checks, fontScale: plan.fontScale, fit: plan.fit } };
}

/* ---------------- exports (browser global + Node tests) ---------------- */
const ENGINE = {
  VERSION, FS_CONFIG, PAGE_SIZES, parseItem, normalizeSpec, resolvePage, buildFillablePdf,
  wrapLines, qaFields, labelForSize,
};
root.FormScannerEngine = ENGINE;
if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE;
})(typeof window !== 'undefined' ? window : globalThis);
