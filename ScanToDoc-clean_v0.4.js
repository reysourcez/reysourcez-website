/* ============================================================
   Scan to Document - clean-up (v0.4, 2026-11-17), no AI
   Paper crop, deskew, lighting flatten, local threshold, speck/blotch removal on plain typed arrays.
   No DOM code: runs in the browser and under Node for tests. Port of ScanToDoc-probe_v0.2.py (clean_scan, adaptive mode).
   ============================================================ */
(function (root) {
'use strict';

const VERSION = 'v0.4 (2026-11-17)';
const DEF = Object.assign(
  { PAPER_BRIGHT: 110, SHAVE_PX: 10, BG_DOWNSCALE: 8, BG_CLOSE: 9, THRESH_WINDOW: 41, THRESH_C: 12, SPECK_MAX: 9, SPECK_AREA: 70, BLOB_RADIUS: 5, BORDER: 20, DPI: 200 },
  (root.ScanToDocConfig && root.ScanToDocConfig.CLEAN) || {});

/* ---------------- small helpers ---------------- */
function toGray(rgba, w, h) {                                   // RGBA -> 0..255 grey (transparent counts as paper)
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = rgba[j + 3] < 128 ? 255 : (0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]) | 0;
  return g;
}

function downscale(g, w, h, f) {                                // box average by an integer factor
  const sw = Math.max(1, Math.floor(w / f)), sh = Math.max(1, Math.floor(h / f)), out = new Uint8Array(sw * sh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      let s = 0, n = 0;
      const ye = Math.min(h, (y + 1) * f), xe = Math.min(w, (x + 1) * f);
      for (let yy = y * f; yy < ye; yy++) { const row = yy * w; for (let xx = x * f; xx < xe; xx++) { s += g[row + xx]; n++; } }
      out[y * sw + x] = (s / n + 0.5) | 0;
    }
  }
  return { data: out, w: sw, h: sh };
}

function blurU8(src, w, h, r) {                                 // separable box blur, edges replicated
  const out = new Uint8Array(w * h), tmp = new Float32Array(w * h), k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[row + x] = s / k; s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = (s / k + 0.5) | 0; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
  }
  return out;
}

function blurGauss1(src, w, h) {                                // sigma 1 gaussian on floats, edges replicated
  const K = [0.0545, 0.2442, 0.4026, 0.2442, 0.0545], tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += K[k + 2] * src[row + Math.min(w - 1, Math.max(0, x + k))];
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += K[k + 2] * tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      out[y * w + x] = s;
    }
  }
  return out;
}

function morph1D(src, w, h, k, horiz, isMax) {                  // sliding min / max, out-of-image pixels ignored
  const r = (k - 1) >> 1, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = isMax ? 0 : 255;
      if (horiz) { const a = Math.max(0, x - r), b = Math.min(w - 1, x + r), row = y * w; for (let i = a; i <= b; i++) { const p = src[row + i]; if (isMax ? p > v : p < v) v = p; } }
      else { const a = Math.max(0, y - r), b = Math.min(h - 1, y + r); for (let i = a; i <= b; i++) { const p = src[i * w + x]; if (isMax ? p > v : p < v) v = p; } }
      out[y * w + x] = v;
    }
  }
  return out;
}
const erode = (s, w, h, k) => morph1D(morph1D(s, w, h, k, true, false), w, h, k, false, false);
const dilate = (s, w, h, k) => morph1D(morph1D(s, w, h, k, true, true), w, h, k, false, true);

function label(bin, w, h, eight) {                              // connected components (iterative flood fill) with per-component stats
  const lab = new Int32Array(w * h), stack = new Int32Array(w * h);
  const st = { area: [0], x0: [0], y0: [0], x1: [0], y1: [0], cx: [0], cy: [0] };
  let n = 0;
  for (let i = 0; i < bin.length; i++) {
    if (!bin[i] || lab[i]) continue;
    n++;
    let sp = 0, area = 0, x0 = w, y0 = h, x1 = -1, y1 = -1, sx = 0, sy = 0;
    stack[sp++] = i; lab[i] = n;
    while (sp) {
      const p = stack[--sp], x = p % w, y = (p - x) / w;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx === 0 && dy === 0) || (!eight && dx !== 0 && dy !== 0)) continue;
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const q = yy * w + xx;
          if (bin[q] && !lab[q]) { lab[q] = n; stack[sp++] = q; }
        }
      }
    }
    st.area.push(area); st.x0.push(x0); st.y0.push(y0); st.x1.push(x1); st.y1.push(y1); st.cx.push(sx / area); st.cy.push(sy / area);
  }
  return { lab, n, st };
}

function integral(src, w, h) {                                  // summed-area table, (w+1)*(h+1)
  const W1 = w + 1, I = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let rs = 0;
    for (let x = 0; x < w; x++) { rs += src[y * w + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + rs; }
  }
  return I;
}
function windowSum(I, w, h, x, y, rx, ry) {
  const W1 = w + 1, x0 = Math.max(0, x - rx), y0 = Math.max(0, y - ry), x1 = Math.min(w - 1, x + rx), y1 = Math.min(h - 1, y + ry);
  return { sum: I[(y1 + 1) * W1 + x1 + 1] - I[y0 * W1 + x1 + 1] - I[(y1 + 1) * W1 + x0] + I[y0 * W1 + x0], n: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

function boxBlurF(src, w, h, k) {                               // separable box blur on floats, edges replicated
  const r = (k - 1) >> 1, tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let x = -r; x <= r; x++) s += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) { tmp[row + x] = s / k; s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) { out[y * w + x] = s / k; s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
  }
  return out;
}

function gaussThreshold(src, w, h, win, C) {                    // like OpenCV adaptive threshold (gaussian window): ink where a pixel is C darker than its gaussian-weighted neighbourhood
  const sigma = 0.3 * ((win - 1) * 0.5 - 1) + 0.8, bw = Math.max(3, Math.round(Math.sqrt(4 * sigma * sigma + 1)) | 1);
  const m = boxBlurF(boxBlurF(boxBlurF(src, w, h, bw), w, h, bw), w, h, bw), out = new Uint8Array(w * h);   // three box passes approximate the gaussian
  for (let i = 0; i < out.length; i++) out[i] = src[i] < m[i] - C ? 1 : 0;
  return out;
}

function localThreshold(src, w, h, win, C) {                    // ink where a pixel is C darker than the mean of its window
  const I = integral(src, w, h), r = (win - 1) >> 1, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { const q = windowSum(I, w, h, x, y, r, r); out[y * w + x] = src[y * w + x] < q.sum / q.n - C ? 1 : 0; }
  }
  return out;
}

function dilateRect(mask, w, h, rx, ry) {                       // any set pixel within +-rx, +-ry
  const I = integral(mask, w, h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = windowSum(I, w, h, x, y, rx, ry).sum > 0 ? 1 : 0;
  return out;
}

/* exact squared euclidean distance transform (Felzenszwalb & Huttenlocher): distance of every pixel to the nearest feature pixel */
function dt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -1e30; z[1] = 1e30;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e30;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}
function edtSq(feat, w, h) {
  const INF = 1e12, d = new Float32Array(w * h), n = Math.max(w, h);
  const f = new Float64Array(n), o = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let i = 0; i < d.length; i++) d[i] = feat[i] ? 0 : INF;
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = d[y * w + x]; dt1d(f, h, o, v, z); for (let y = 0; y < h; y++) d[y * w + x] = o[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = d[y * w + x]; dt1d(f, w, o, v, z); for (let x = 0; x < w; x++) d[y * w + x] = o[x]; }
  return d;
}

/* ---------------- 1. find the paper (bright block) among a dark scanner surround ---------------- */
function findPaper(g, w, h, o) {
  const f = 4, s = downscale(g, w, h, f), sw = s.w, sh = s.h;
  const b = blurU8(blurU8(s.data, sw, sh, 1), sw, sh, 1);
  const bright = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) bright[i] = b[i] > o.PAPER_BRIGHT ? 1 : 0;
  const opened = dilate(erode(bright, sw, sh, 7), sw, sh, 7);
  const cc = label(opened, sw, sh, false);
  if (!cc.n) return null;
  let best = 1;
  for (let i = 2; i <= cc.n; i++) if (cc.st.area[i] > cc.st.area[best]) best = i;
  if (cc.st.area[best] < 0.25 * sw * sh) return null;
  const px = [], py = [], lab = cc.lab;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = y * sw + x;
      if (lab[i] !== best) continue;
      if (x === 0 || y === 0 || x === sw - 1 || y === sh - 1 || lab[i - 1] !== best || lab[i + 1] !== best || lab[i - sw] !== best || lab[i + sw] !== best) { px.push(x); py.push(y); }
    }
  }
  let bestArea = 1e30, rect = null;
  for (let a = -10; a <= 10.0001; a += 0.25) {                  // smallest rotated rectangle around the paper (pages are only slightly tilted)
    const th = a * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
    let umin = 1e30, umax = -1e30, vmin = 1e30, vmax = -1e30;
    for (let i = 0; i < px.length; i++) {
      const u = px[i] * c + py[i] * sn, v = -px[i] * sn + py[i] * c;
      if (u < umin) umin = u; if (u > umax) umax = u; if (v < vmin) vmin = v; if (v > vmax) vmax = v;
    }
    const area = (umax - umin) * (vmax - vmin);
    if (area < bestArea) { bestArea = area; rect = { th, umin: umin * f, umax: umax * f + f, vmin: vmin * f, vmax: vmax * f + f }; }
  }
  return rect;
}

function cropToPaper(g, w, h, o) {                              // everything outside the paper becomes white, then crop
  const r = findPaper(g, w, h, o);
  if (!r) return { g, w, h, rect: null };
  const m = o.SHAVE_PX, c = Math.cos(r.th), s = Math.sin(r.th);
  const u0 = r.umin + m, u1 = r.umax - m, v0 = r.vmin + m, v1 = r.vmax - m;
  if (u1 <= u0 || v1 <= v0) return { g, w, h, rect: null };
  const xs = [], ys = [];
  [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].forEach(([u, v]) => { xs.push(u * c - v * s); ys.push(u * s + v * c); });
  const bx0 = Math.max(0, Math.floor(Math.min(...xs))), bx1 = Math.min(w - 1, Math.ceil(Math.max(...xs)));
  const by0 = Math.max(0, Math.floor(Math.min(...ys))), by1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  if (bw < 50 || bh < 50) return { g, w, h, rect: null };
  const out = new Uint8Array(bw * bh).fill(255);
  for (let y = by0; y <= by1; y++) {
    for (let x = bx0; x <= bx1; x++) {
      const u = x * c + y * s, v = -x * s + y * c;
      if (u >= u0 && u <= u1 && v >= v0 && v <= v1) out[(y - by0) * bw + (x - bx0)] = g[y * w + x];
    }
  }
  return { g: out, w: bw, h: bh, rect: r };
}

/* ---------------- 2. skew: the rotation that makes text rows sharpest ---------------- */
function estimateSkew(g, w, h) {
  const f = Math.max(1, Math.ceil(Math.max(w, h) / 1000)), s = f > 1 ? downscale(g, w, h, f) : { data: g, w, h }, sw = s.w, sh = s.h;
  const f32 = new Float32Array(s.data.length);
  for (let i = 0; i < f32.length; i++) f32[i] = s.data[i];
  const ink = localThreshold(f32, sw, sh, 31, 10), cc = label(ink, sw, sh, true);
  const X = [], Y = [];
  for (let i = 0; i < ink.length; i++) if (ink[i] && cc.st.area[cc.lab[i]] >= 8) { X.push(i % sw); Y.push((i / sw) | 0); }
  if (X.length < 200) return 0;
  const cx = sw / 2, cy = sh / 2, rows = Math.ceil(Math.hypot(sw, sh)) + 4, off = rows / 2;
  const score = (a) => {
    const r = a * Math.PI / 180, c = Math.cos(r), sn = Math.sin(r), bins = new Float64Array(rows);
    for (let i = 0; i < X.length; i++) bins[Math.round(-(X[i] - cx) * sn + (Y[i] - cy) * c + off)]++;
    let t = 0;
    for (let i = 1; i < rows; i++) { const d = bins[i] - bins[i - 1]; t += d * d; }
    return t;
  };
  let best = 0, bs = -1;
  for (let a = -6; a <= 6.0001; a += 0.5) { const v = score(a); if (v > bs) { bs = v; best = a; } }
  const c0 = best;
  for (let a = c0 - 0.5; a <= c0 + 0.5001; a += 0.05) { const v = score(a); if (v > bs) { bs = v; best = a; } }
  return best;
}

function rotateGray(g, w, h, angleDeg, fill) {                  // content turned counter-clockwise by angleDeg, bilinear
  const a = angleDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), cx = (w - 1) / 2, cy = (h - 1) / 2, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy, xs = c * dx - s * dy + cx, ys = s * dx + c * dy + cy;
      if (xs < 0 || ys < 0 || xs > w - 1 || ys > h - 1) { out[y * w + x] = fill; continue; }
      const x0 = xs | 0, y0 = ys | 0, x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = xs - x0, fy = ys - y0;
      out[y * w + x] = (g[y0 * w + x0] * (1 - fx) + g[y0 * w + x1] * fx) * (1 - fy) + (g[y1 * w + x0] * (1 - fx) + g[y1 * w + x1] * fx) * fy + 0.5;
    }
  }
  return out;
}

/* ---------------- 3. flatten the lighting, threshold locally ---------------- */
function flatten(g, w, h, o) {                                  // divide by an estimate of the paper brightness (closing of a small copy)
  const s = downscale(g, w, h, o.BG_DOWNSCALE), bgS = erode(dilate(s.data, s.w, s.h, o.BG_CLOSE), s.w, s.h, o.BG_CLOSE);
  const norm = new Float32Array(w * h), fx = s.w / w, fy = s.h / h;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(s.h - 1, Math.max(0, (y + 0.5) * fy - 0.5)), y0 = sy | 0, y1 = Math.min(s.h - 1, y0 + 1), wy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(s.w - 1, Math.max(0, (x + 0.5) * fx - 0.5)), x0 = sx | 0, x1 = Math.min(s.w - 1, x0 + 1), wx = sx - x0;
      const bg = (bgS[y0 * s.w + x0] * (1 - wx) + bgS[y0 * s.w + x1] * wx) * (1 - wy) + (bgS[y1 * s.w + x0] * (1 - wx) + bgS[y1 * s.w + x1] * wx) * wy;
      norm[y * w + x] = Math.min(255, g[y * w + x] * 255 / Math.max(bg, 20));
    }
  }
  return norm;
}

/* ---------------- 4. remove specks and blotches ---------------- */
function despeckle(ink, w, h, o) {
  const cc = label(ink, w, h, true), n = cc.n, st = cc.st, lab = cc.lab;
  if (!n) return { ink, removed: 0 };
  const R2 = o.BLOB_RADIUS * o.BLOB_RADIUS, N = w * h, sc = o.SCALE || 1;
  const bgFeat = new Uint8Array(N);
  for (let i = 0; i < N; i++) bgFeat[i] = ink[i] ? 0 : 1;
  const d1 = edtSq(bgFeat, w, h), centres = new Uint8Array(N);   // opening with a disk: erosion centres, then dilate them back
  for (let i = 0; i < N; i++) centres[i] = ink[i] && d1[i] > R2 ? 1 : 0;
  const d2 = edtSq(centres, w, h), core = new Int32Array(n + 1);
  for (let i = 0; i < N; i++) if (ink[i] && d2[i] <= R2) core[lab[i]]++;
  const small = new Uint8Array(n + 1), solid = new Uint8Array(n + 1), letters = new Uint8Array(n + 1);
  for (let k = 1; k <= n; k++) {
    const cw = st.x1[k] - st.x0[k] + 1, ch = st.y1[k] - st.y0[k] + 1, big = Math.max(cw, ch), area = st.area[k];
    small[k] = big <= o.SPECK_MAX && area <= o.SPECK_AREA ? 1 : 0;
    solid[k] = core[k] > 0.5 * area && area < 8000 * sc * sc && big < 250 * sc ? 1 : 0;
    letters[k] = !small[k] && !solid[k] && big >= 10 * sc ? 1 : 0;
  }
  const letterMask = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (ink[i] && letters[lab[i]]) letterMask[i] = 1;
  const near = dilateRect(letterMask, w, h, Math.round(25 * sc), Math.round(10 * sc)), bad = new Uint8Array(n + 1);
  let removed = 0;
  for (let k = 1; k <= n; k++) {
    const cx = Math.min(w - 1, Math.max(0, Math.round(st.cx[k]))), cy = Math.min(h - 1, Math.max(0, Math.round(st.cy[k])));
    if ((small[k] && !near[cy * w + cx]) || solid[k] || st.area[k] < 4) { bad[k] = 1; removed++; }   // small marks stay only next to letter-sized marks (i-dots, full stops)
  }
  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = ink[i] && !bad[lab[i]] ? 1 : 0;
  return { ink: out, removed };
}

/* ---------------- the whole clean-up ---------------- */
function addBorder(ink, w, h, b) {                              // small white border: Tesseract reads edge text better
  const W = w + 2 * b, H = h + 2 * b, out = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) out.set(ink.subarray(y * w, y * w + w), (y + b) * W + b);
  return { ink: out, w: W, h: H };
}

function rotateQuarter(g, w, h, k) {                             // k quarter turns clockwise (0-3); returns { g, w, h }
  k = ((k % 4) + 4) % 4;
  if (!k) return { g, w, h };
  const nw = k === 2 ? w : h, nh = k === 2 ? h : w, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = k === 1 ? h - 1 - y : k === 2 ? w - 1 - x : y, ny = k === 1 ? x : k === 2 ? h - 1 - y : w - 1 - x;
    out[ny * nw + nx] = g[y * w + x];
  }
  return { g: out, w: nw, h: nh };
}

function cleanScan(gray, w, h, opts) {
  const o0 = Object.assign({}, DEF, opts || {}), t0 = Date.now(), full = o0.MODE !== 'light';
  const sc = Math.min(2.5, Math.max(0.5, (o0.DPI || 200) / 200)), odd = (n) => Math.max(3, Math.round(n) | 1);   // the settings are written for 200 dpi: scale them to the real resolution
  const o = Object.assign({}, o0, { SCALE: sc, SHAVE_PX: Math.round(o0.SHAVE_PX * sc), BG_DOWNSCALE: Math.max(2, Math.round(o0.BG_DOWNSCALE * sc)), THRESH_WINDOW: odd(o0.THRESH_WINDOW * sc), SPECK_MAX: Math.round(o0.SPECK_MAX * sc), SPECK_AREA: Math.round(o0.SPECK_AREA * sc * sc), BLOB_RADIUS: Math.max(2, Math.round(o0.BLOB_RADIUS * sc)), BORDER: Math.round(o0.BORDER * sc) });
  let g = gray, gw = w, gh = h, paper = false, skew = 0, removed = 0;
  if (full) {
    const c = cropToPaper(g, gw, gh, o);
    g = c.g; gw = c.w; gh = c.h; paper = !!c.rect;
    skew = estimateSkew(g, gw, gh);
    if (Math.abs(skew) > 0.02) g = rotateGray(g, gw, gh, skew, 255);
  }
  let ink = gaussThreshold(blurGauss1(flatten(g, gw, gh, o), gw, gh), gw, gh, o.THRESH_WINDOW, o.THRESH_C);
  if (full) { const d = despeckle(ink, gw, gh, o); ink = d.ink; removed = d.removed; }
  const b = addBorder(ink, gw, gh, o.BORDER);
  return { ink: b.ink, w: b.w, h: b.h, border: o.BORDER, skewDeg: skew, removed, paperFound: paper, ms: Date.now() - t0 };
}

function inkToRGBA(ink, w, h) {                                 // black text on white, for a canvas
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < ink.length; i++, j += 4) { const v = ink[i] ? 0 : 255; out[j] = v; out[j + 1] = v; out[j + 2] = v; out[j + 3] = 255; }
  return out;
}

const API = { VERSION, DEFAULTS: DEF, rotateQuarter, toGray, cleanScan, inkToRGBA, findPaper, cropToPaper, estimateSkew, rotateGray, flatten, despeckle, localThreshold, gaussThreshold, label, edtSq, downscale };
root.ScanToDocClean = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
