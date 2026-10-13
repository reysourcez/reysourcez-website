'use strict';
// APZacct release 1.4 - file APZacct-TestGsMock_v1.4.js
/* APZacct - Apps Script mock test v1.4
 * Loads EVERY APZacct-*_v1.4.gs of ONE folder into ONE shared global scope (like Apps Script: a duplicate top-level const or a missing menu handler fails here),
 * then drives the menu scripts and the Web API against a mock SpreadsheetApp / DriveApp / LockService.
 * v1.4 adds: version registry checks, and section 7 = documents phase 1 (Pihak, auto-numbered PV/Resit, split lines, control flags, PDF failure, void).
 * Run: node APZacct-TestGsMock_v1.4.js [folder with the .gs files]      Illustrative numbers only.            */
const vm = require('vm'), fs = require('fs'), path = require('path');
const DIR = process.argv[2] || '/mnt/user-data/outputs';
const RELEASE = '1.4';
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  PASS - ' : '  FAIL - ') + m); };

class Sheet {
  constructor(name) { this.name = name; this.d = {}; this.maxRows = 1000; }
  g(r, c) { const v = this.d[r + ',' + c]; return v === undefined ? '' : v; }
  s(r, c, v) { this.d[r + ',' + c] = v; }
  getRange(r, c, nr, nc) { const sh = this; nr = nr || 1; nc = nc || 1; return {
    getValue: () => sh.g(r, c),
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => sh.g(r + i, c + j))),
    setValue: v => sh.s(r, c, v), setFormula: f => sh.s(r, c, f),
    setValues: a => a.forEach((row, i) => row.forEach((v, j) => sh.s(r + i, c + j, v))),
    setFontWeight: function () { return this; }, setNumberFormat: function () { return this; } }; }
  getLastRow() { return Math.max(0, ...Object.keys(this.d).filter(k => this.d[k] !== '').map(k => +k.split(',')[0])); }
  getMaxRows() { return this.maxRows; }
  getSheetId() { return 1; }
  insertRowsAfter(n, k) { this.maxRows += k; }
  appendRow(a) { const r = this.getLastRow() + 1; a.forEach((v, j) => this.s(r, j + 1, v)); }
}
function world(opts) {
  const sheets = {}; ['Akaun', 'Transaksi', 'Baris_Transaksi', 'Tetapan', 'APK', 'UR', 'Pihak', 'Dokumen', 'Dokumen_Baris'].forEach(n => sheets[n] = new Sheet(n));
  [[1010, 'Wang Di Tangan', 'Aset', 'Tidak Berkaitan'], [1020, 'Bank', 'Aset', 'Tidak Berkaitan'], [1100, 'Perbelanjaan Prabayar', 'Aset', 'Operasi'],
   [1110, 'Pendapatan Terakru', 'Aset', 'Operasi'], [2050, 'Perbelanjaan Terakru', 'Liabiliti', 'Operasi'], [2060, 'Pendapatan Belum Diperoleh', 'Liabiliti', 'Operasi'],
   [2020, 'Dividen', 'Liabiliti', 'Berkanun'], [2070, 'Cukai', 'Liabiliti', 'Berkanun'], [2080, 'Zakat', 'Liabiliti', 'Berkanun'], [2090, 'Honorarium', 'Liabiliti', 'Berkanun'],
   [2100, 'KWA Pend', 'Liabiliti', 'Berkanun'], [2110, 'KWA Pemb', 'Liabiliti', 'Berkanun'], [3010, 'Modal Syer', 'Ekuiti', 'Pembiayaan'], [3020, 'Rizab', 'Ekuiti', 'Tidak Berkaitan'],
   [3030, 'Lebihan Terkumpul', 'Ekuiti', 'Tidak Berkaitan'], [4050, 'Pendapatan Perkhidmatan', 'Hasil', 'Operasi'], [5010, 'Perbelanjaan Pejabat', 'Perbelanjaan', 'Operasi'], [5150, 'Internet', 'Perbelanjaan', 'Operasi']]
  .forEach((a, i) => { const r = 5 + i; sheets.Akaun.s(r, 1, a[0]); sheets.Akaun.s(r, 3, a[1]); sheets.Akaun.s(r, 4, a[2]); sheets.Akaun.s(r, 6, a[3]); sheets.Akaun.s(r, 7, 'Aktif'); });
  [[10, 1010], [11, 2010], [12, 3010], [13, 4010], [14, 5010]].forEach(a => sheets.Tetapan.s(a[0], 3, a[1]));
  sheets.Tetapan.s(5, 3, 'Koperasi Ujian Berhad'); sheets.Tetapan.s(6, 3, 'SKM-123'); sheets.Tetapan.s(24, 3, 'No 1, Jalan Ujian'); sheets.Tetapan.s(25, 3, '03-1234567');
  if (opts && opts.lebihan !== undefined) { sheets.UR.s(36, 1, 'LEBIHAN BERSIH (SURPLUS) - SEBELUM PEMBAHAGIAN'); sheets.UR.s(36, 2, opts.lebihan); }
  sheets.APK.s(7, 2, 175); sheets.APK.s(8, 2, 14); sheets.APK.s(9, 2, 7);
  return sheets;
}
function ctxFor(sheets, answers) {
  const lockState = { busy: false, acquired: 0, released: 0 };
  const drive = { failPdf: false, pdfHtml: [], files: [] };
  const log = { alerts: [], prompts: [], lock: lockState, drive };
  const ui = { ButtonSet: { OK_CANCEL: 'OK_CANCEL', YES_NO: 'YES_NO', OK: 'OK' }, Button: { OK: 'OK', YES: 'YES', NO: 'NO' },
    prompt: (t, m) => { log.prompts.push(t); return { getSelectedButton: () => answers.length ? 'OK' : 'CANCEL', getResponseText: () => String(answers.shift()) }; },
    alert: (a, b, c) => { log.alerts.push(String(a) + ' | ' + String(b || '')); return (c === 'YES_NO' || b === 'YES_NO') ? (log.yesno === undefined ? 'YES' : log.yesno) : 'OK'; } };
  const ss = { getSheetByName: n => sheets[n] || null, getSpreadsheetTimeZone: () => 'Asia/Kuala_Lumpur', insertSheet: n => (sheets[n] = new Sheet(n)) };
  const ZONES = ['Asia/Kuala_Lumpur', 'Asia/Jakarta', 'UTC'];
  const mkFolder = p => {
    const f = { path: p, kids: {},
      getFoldersByName(n) { const k = this.kids[n]; let used = false; return { hasNext: () => !!k && !used, next: () => { used = true; return k; } }; },
      createFolder(n) { const c = mkFolder(p.concat(n)); this.kids[n] = c; return c; },
      createFile(blob) { const file = { name: blob.name, folder: p.join('/'), getUrl: () => 'https://drive.test/' + encodeURIComponent(p.join('/') + '/' + blob.name) }; drive.files.push(file); return file; } };
    return f;
  };
  const root = mkFolder(['root']);
  const ctx = vm.createContext({ console, Math, Number, String, Object, Array, Date, isNaN, RegExp, JSON, Error,
    SpreadsheetApp: { getUi: () => ui, getActiveSpreadsheet: () => ss },
    Session: { getScriptTimeZone: () => 'Asia/Kuala_Lumpur', getActiveUser: () => ({ getEmail: () => 'test@example.com' }) },
    Utilities: {
      formatDate: (d, tz, f) => { if (ZONES.indexOf(tz) === -1) throw new Error('Unknown time zone ' + tz); const iso = d.toISOString(); return /HH/.test(f) ? iso.slice(0, 19).replace('T', ' ') : iso.slice(0, 10); },
      newBlob: (data, type, name) => ({ data, type, name,
        getAs(t) { if (drive.failPdf) throw new Error('Conversion from text/html to application/pdf failed'); drive.pdfHtml.push(data); return { data, type: t, name: this.name, setName(n) { this.name = n; return this; } }; },
        setName(n) { this.name = n; return this; } }) },
    DriveApp: { getRootFolder: () => root, getFoldersByName: n => root.getFoldersByName(n), createFolder: n => root.createFolder(n) },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (lockState.busy) return false; lockState.acquired++; return true; }, releaseLock: () => { lockState.released++; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'JSON' } } });
  return { ctx, log };
}
const files = {};
fs.readdirSync(DIR).filter(f => /^APZacct-.*_v1\.4\.gs$/.test(f)).forEach(f => files[f] = path.join(DIR, f));
function load(ctx, skip) { Object.keys(files).sort().forEach(f => { if (skip && skip.some(s => f.indexOf(s) !== -1)) return; vm.runInContext(fs.readFileSync(files[f], 'utf8'), ctx, { filename: f }); }); }

console.log('=== 1. release 1.4: names, versions, one shared scope ===');
{
  const names = Object.keys(files);
  ok(names.length === 17, '17 .gs files in the release folder (found ' + names.length + ')');
  const dupe = {}; let dupes = [];
  names.forEach(f => {
    const src = fs.readFileSync(files[f], 'utf8'), nm = /^APZacct-(.+)_v1\.4\.gs$/.exec(f)[1];
    ok(src.split('\n')[0].indexOf('// APZacct release ' + RELEASE + ' - file ' + f) === 0, f + ': first line names the release and the file');
    const m = /^const APZ_VER_(\w+) = '([\d.]+)';/m.exec(src);
    ok(!!m && m[2] === RELEASE && m[1] === nm.toUpperCase(), f + ': constant APZ_VER_' + nm.toUpperCase() + " = '" + RELEASE + "'");
    (src.match(/^const (\w+)/gm) || []).forEach(x => { const k = x.slice(6); (dupe[k] = dupe[k] || []).push(f); });
  });
  dupes = Object.keys(dupe).filter(k => dupe[k].length > 1);
  ok(dupes.length === 0, 'no top-level const is declared in two files' + (dupes.length ? ' (' + dupes.join(', ') + ')' : ''));
  const { ctx } = ctxFor(world(), []); let err = null; try { load(ctx); } catch (e) { err = e; }
  ok(!err, 'all .gs files load together without a redeclaration error' + (err ? ' (' + err.message + ')' : ''));
  const menu = fs.readFileSync(files['APZacct-Menu_v1.4.gs'], 'utf8'); const handlers = [...menu.matchAll(/addItem\('[^']+', '(\w+)'\)/g)].map(m => m[1]);
  handlers.forEach(h => ok(typeof ctx[h] === 'function', 'menu handler defined: ' + h));
  ok(handlers.indexOf('semakVersiAPZ') !== -1, 'the menu offers Semak Versi Fail');
  const h = ctx.nilaiSemakVersiAPZ_();
  ok(h.ok && h.baris.length === 17 && !h.hilang.length && !h.lain.length, 'Semak Versi Fail: all 17 files present and at release ' + RELEASE);
  let e2 = null; try { vm.runInContext("const APZ_VER_WEBAPI = '1.3';", ctx); } catch (e) { e2 = e; }
  ok(!!e2 && /already been declared/.test(e2.message), 'a leftover old copy of a file (same constant declared twice) fails loudly');
  const c2 = ctxFor(world(), []); load(c2.ctx, ['-Dokumen_']);
  const h2 = c2.ctx.nilaiSemakVersiAPZ_();
  ok(!h2.ok && h2.hilang.length === 1 && h2.hilang[0] === 'APZacct-Dokumen', 'a forgotten file is reported as HILANG by name');
  c2.ctx.semakVersiAPZ();
  ok(/ADA MASALAH/.test(c2.log.alerts[0]) && /HILANG \(belum ditampal\): APZacct-Dokumen/.test(c2.log.alerts[0]), 'the menu alert tells the person which file to add');
}

console.log('\n=== 2. Jurnal Laras ===');
function run(fn, answers, opts, yesno) { const w = world(opts); const { ctx, log } = ctxFor(w, answers.slice()); if (yesno) log.yesno = yesno; load(ctx); ctx[fn](); return { w, log }; }
let r = run('posJurnalLaras', ['3', '5150', '2050', '300', '2026-12-31', 'Bil internet Dis']);
ok(r.w.Transaksi.g(5, 1) === 'T-0000' && r.w.Transaksi.g(5, 2) === '2026-12-31' && r.w.Transaksi.g(5, 5) === 'Jurnal', 'type 3 writes a Jurnal header (T-0000)');
ok(r.w.Baris_Transaksi.g(5, 3) === 5150 && r.w.Baris_Transaksi.g(5, 4) === 300 && r.w.Baris_Transaksi.g(6, 3) === 2050 && r.w.Baris_Transaksi.g(6, 5) === 300, 'Debit 5150 300 / Kredit 2050 300');
ok(r.w.Baris_Transaksi.g(5, 2) === 'T-0000' && r.w.Baris_Transaksi.g(6, 2) === 'T-0000' && r.w.Baris_Transaksi.g(5, 1) === 'L-001' && r.w.Baris_Transaksi.g(6, 1) === 'L-002', 'both lines carry the header ID; line IDs L-001/L-002');
ok(/Berjaya/.test(r.log.alerts[r.log.alerts.length - 1]), 'success alert shown');
r = run('posJurnalLaras', ['3', '5150', '1020']); ok(r.w.Transaksi.g(5, 1) === '' && /akaun WANG/.test(r.log.alerts.join()), 'money account (Bank) refused, nothing written');
r = run('posJurnalLaras', ['3', '5150', '4050']); ok(r.w.Transaksi.g(5, 1) === '' && /berjenis Liabiliti/.test(r.log.alerts.join()), 'wrong Jenis refused (type 3 credit must be Liabiliti)');
r = run('posJurnalLaras', ['3', '5150', '2050', '300', '2026-02-30']); ok(r.w.Transaksi.g(5, 1) === '' && /tarikh mesti sebenar/.test(r.log.alerts.join()), 'impossible date 2026-02-30 refused');
r = run('posJurnalLaras', ['4', '5150', '1100', '200', '2026-01-31', '']); ok(r.w.Baris_Transaksi.g(6, 3) === 1100 && r.w.Transaksi.g(5, 3) === 'Pelepasan perbelanjaan prabayar', 'type 4 (prepaid release) posts with default perkara');
r = run('posJurnalLaras', ['3', '5150', '2050', '0']); ok(r.w.Transaksi.g(5, 1) === '', 'zero amount refused');
r = run('posJurnalLaras', ['3', '5150', '2050', '300', '2026-01-10', ''], { }, 'NO'); ok(r.w.Transaksi.g(5, 1) === '', 'answering NO at the confirmation writes nothing');
{ const w = world(); w.Tetapan.s(21, 3, new Date('2026-12-31T00:00:00Z')); const { ctx, log } = ctxFor(w, ['3', '5150', '2050', '300', '2026-06-30', '']); log.yesno = 'NO'; load(ctx); ctx.posJurnalLaras();
  ok(w.Transaksi.g(5, 1) === '' && /TEMPOH DIKUNCI/.test(log.alerts.join()), 'period lock (a real Date object in Tetapan!C21) warns and honours NO'); }
{ const w = world(); const { ctx } = ctxFor(w, ['3', '5150', '2050', '300', '2026-12-31', '', '3', '5150', '2050', '50', '2026-12-31', '']); load(ctx); ctx.posJurnalLaras(); ctx.posJurnalLaras();
  ok(w.Transaksi.g(6, 1) === 'T-0001' && w.Baris_Transaksi.g(7, 1) === 'L-003' && w.Baris_Transaksi.g(8, 5) === 50, 'a second journal continues the sequence (T-0001, L-003/L-004)'); }

console.log('\n=== 3. Pos Agihan APK loss-year guard ===');
r = run('posAgihanAPK', ['2026-12-31'], { lebihan: -50 }); ok(r.w.Transaksi.g(5, 1) === '' && /TIADA AGIHAN DIBENARKAN/.test(r.log.alerts.join()), 'net loss (-50): blocked, nothing written');
r = run('posAgihanAPK', ['2026-12-31'], { lebihan: 0 }); ok(r.w.Transaksi.g(5, 1) === '' && /TIADA AGIHAN DIBENARKAN/.test(r.log.alerts.join()), 'zero surplus: blocked');
ok(!/teruskan juga\?/i.test(fs.readFileSync(files['APZacct-PosAgihanAPK_v1.4.gs'], 'utf8').replace(/menu ini sengaja tiada butang "teruskan juga"/, '')), 'no "teruskan juga" override offered');
r = run('posAgihanAPK', ['2026-12-31'], { lebihan: 700 });
const bl = []; for (let i = 5; i < 12; i++) if (r.w.Baris_Transaksi.g(i, 3) !== '') bl.push([r.w.Baris_Transaksi.g(i, 3), r.w.Baris_Transaksi.g(i, 4), r.w.Baris_Transaksi.g(i, 5)]);
const dr = bl.reduce((s, x) => s + x[1], 0), kr = bl.reduce((s, x) => s + x[2], 0);
ok(r.w.Transaksi.g(5, 1) === 'T-0000' && bl.length === 4 && dr === 196 && kr === 196 && bl[0][0] === 3030, 'surplus 700: posts one balanced entry - Debit 3030 = 196 = sum of 3 credits');
{ const w = world(); const { ctx, log } = ctxFor(w, ['2026-12-31']); load(ctx); ctx.posAgihanAPK(); ok(w.Transaksi.g(5, 1) === '' && /tidak dapat semak/.test(log.alerts.join()), 'UR row missing: fails closed (no post)'); }

console.log('\n=== 4. Tambah Akaun ===');
function tambah(answers) { const w = world(); const { ctx, log } = ctxFor(w, answers.slice()); load(ctx); ctx.tambahAkaun(); return { w, log }; }
const lastAk = w => { let r = 5; while (w.Akaun.g(r + 1, 1) !== '') r++; return r; };
let t = tambah(['Aset', '4', 'Am', 'Bank Kedua', 'Bank 2']); let row = lastAk(t.w);
ok(t.w.Akaun.g(row, 3) === 'Bank Kedua' && t.w.Akaun.g(row, 6) === 'Tidak Berkaitan' && t.w.Akaun.g(row, 4) === 'Aset', 'new Aset bank account -> Kumpulan "Tidak Berkaitan" (visible in the wizard money list)');
t = tambah(['Aset', '2', 'Am', 'Kenderaan', 'Vehicles']); row = lastAk(t.w); ok(t.w.Akaun.g(row, 6) === 'Pelaburan', 'fixed asset -> Pelaburan');
t = tambah(['Hasil', 'Am', 'Sewa', 'Rent']); row = lastAk(t.w); ok(t.w.Akaun.g(row, 3) === 'Sewa' && t.w.Akaun.g(row, 6) === 'Operasi', 'Hasil: no group question, Operasi');
t = tambah(['Aset', '9', 'Am', 'X', 'X']); ok(lastAk(t.w) === 22 && /1 hingga 5/.test(t.log.alerts.join()), 'invalid group number: nothing added');

console.log('\n=== 5. WebAPI: date rules, period lock with reason, time zone ===');
const SECRET = 'GANTI-DENGAN-RAHSIA-ANDA-SENDIRI';
function api(setup, body, method) {
  const w = world(); if (setup) setup(w);
  const { ctx } = ctxFor(w, []); load(ctx);
  const out = method === 'get' ? ctx.doGet({ parameter: { secret: SECRET } }) : ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ secret: SECRET }, body)) } });
  return { w, res: JSON.parse(out.s) };
}
const linesOK = [{ kodAkaun: 1020, debit: 100, kredit: 0 }, { kodAkaun: 4050, debit: 0, kredit: 100 }];
const post = (tarikh, extra) => Object.assign({ tarikh, perkara: 'Ujian', noPV: 'PV-1', kaedah: 'Bank', lines: linesOK }, extra || {});
const withOpening = w => { w.Tetapan.s(18, 3, 'T-0000'); w.Transaksi.s(5, 1, 'T-0000'); w.Transaksi.s(5, 2, new Date('2026-01-01T00:00:00Z')); };
const withLock = v => w => { withOpening(w); w.Tetapan.s(21, 3, v); };
let a = api(null, post('2026-03-10'));
ok(a.res.status === 'BERJAYA' && a.w.Transaksi.g(5, 2) === '2026-03-10' && a.w.Transaksi.g(5, 6) === 'Disahkan' && a.w.Transaksi.g(5, 4) === 'PV-1', 'no opening and no lock yet: any real date is accepted; a post without dokumen keeps the typed No. PV/RT (v1.3 behaviour)');
ok(a.res.dokumen === undefined && a.w.Dokumen.getLastRow() === 0, 'a post without dokumen makes no document');
a = api(null, post('2027-06-01')); ok(a.res.status === 'BERJAYA', 'a future date is accepted (post-dated items are legitimate)');
a = api(null, post('2026-02-30')); ok(a.res.kod === 'TARIKH_TIDAK_SAH' && a.w.Transaksi.g(5, 1) === '', 'impossible date 2026-02-30 refused, nothing written');
a = api(null, post('30/03/2026')); ok(a.res.kod === 'TARIKH_TIDAK_SAH', 'wrong format refused');
a = api(withOpening, post('2025-12-31')); ok(a.res.kod === 'SEBELUM_PEMBUKAAN' && a.w.Transaksi.g(6, 1) === '', 'date before the opening balances (previous fiscal year) refused');
a = api(withOpening, post('2026-01-01')); ok(a.res.status === 'BERJAYA', 'the opening date itself is allowed');
a = api(withLock('2026-03-31'), post('2026-03-15')); ok(a.res.kod === 'TEMPOH_DIKUNCI' && a.w.Transaksi.g(6, 1) === '', 'date inside the locked period without a reason: refused, nothing written');
a = api(withLock('2026-03-31'), post('2026-03-15', { sebabLewat: 'Resit lewat diterima' }));
ok(a.res.status === 'BERJAYA' && a.w.Transaksi.g(6, 6) === 'Entri Lewat', 'locked period + reason: posted and tagged Entri Lewat');
ok(a.w.Log_Perubahan && /Entri lewat: Resit lewat diterima/.test(String(a.w.Log_Perubahan.g(2, 7))), 'the reason is written to Log_Perubahan');
a = api(withLock('2026-03-31'), post('2026-04-01')); ok(a.res.status === 'BERJAYA' && a.w.Transaksi.g(6, 6) === 'Disahkan', 'first day after the lock needs no reason');
a = api(withLock(new Date('2026-03-31T00:00:00Z')), post('2026-03-31')); ok(a.res.kod === 'TEMPOH_DIKUNCI', 'lock typed as a REAL date in Tetapan!C21 is still honoured (the v1.6 bug)');
a = api(withLock(new Date('2026-03-31T00:00:00Z')), {}, 'get'); ok(a.res.tarikhKunciTempoh === '2026-03-31', 'doGet turns a real Date in C21 into YYYY-MM-DD');
ok(a.res.tarikhPembukaan === '2026-01-01', 'doGet reports the opening-balance date');
a = api(null, {}, 'get'); ok(a.res.zonMasa === 'Asia/Kuala_Lumpur', 'time zone defaults to Asia/Kuala_Lumpur (UTC+8) when Tetapan!C23 is blank');
a = api(w => w.Tetapan.s(23, 3, 'Asia/Jakarta'), {}, 'get'); ok(a.res.zonMasa === 'Asia/Jakarta', 'a time zone set in Tetapan!C23 is used');
a = api(w => w.Tetapan.s(23, 3, 'Mars/Phobos'), {}, 'get'); ok(a.res.zonMasa === 'Asia/Kuala_Lumpur', 'an invalid time zone name falls back to the default instead of failing');
a = api(null, { action: 'rekonsiliasi_bank', akaunWang: 1020 }); ok(typeof a.res.error === 'string' && !a.res.kod, 'other API actions are untouched by the date rules');
a = api(null, post('2026-03-10', { lines: [{ kodAkaun: 1020, debit: 100, kredit: 0 }, { kodAkaun: 4050, debit: -50, kredit: 150 }] }));
ok(a.res.kod === 'JUMLAH_NEGATIF' && a.w.Transaksi.g(5, 1) === '', 'v1.4: a negative debit/kredit is refused in a single post too');

console.log('\n=== 6. WebAPI: lock, batch posting, capacity ===');
function api2(setup, body, busy) {
  const w = world(); if (setup) setup(w);
  const { ctx, log } = ctxFor(w, []); if (busy) log.lock.busy = true; load(ctx);
  const out = ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ secret: SECRET }, body)) } });
  return { w, res: JSON.parse(out.s), log };
}
const item = (tarikh, extra) => Object.assign({ tarikh, perkara: 'Bank', noPV: 'Import', kaedah: 'Bank', lines: [{ kodAkaun: 1020, debit: 100, kredit: 0 }, { kodAkaun: 4050, debit: 0, kredit: 100 }] }, extra || {});
let b = api2(null, post('2026-03-10'));
ok(b.res.status === 'BERJAYA' && b.log.lock.acquired === 1 && b.log.lock.released === 1, 'a single post takes the script lock once and releases it');
b = api2(null, post('2026-03-10'), true); ok(b.res.kod === 'SISTEM_SIBUK' && b.w.Transaksi.g(5, 1) === '', 'busy lock: SISTEM_SIBUK and nothing is written');
b = api2(withOpening, { action: 'pos_kelompok', transaksi: [item('2026-02-01'), item('2026-02-02'), item('2026-02-03')] });
ok(b.res.status === 'BERJAYA' && b.res.bilangan === 3 && b.res.idPertama === 'T-0001' && b.res.idTerakhir === 'T-0003' && b.res.bilanganBaris === 6, 'batch of 3 posts in one request (T-0001..T-0003, 6 lines)');
ok(b.w.Transaksi.g(6, 1) === 'T-0001' && b.w.Transaksi.g(8, 1) === 'T-0003' && b.w.Baris_Transaksi.g(5, 1) === 'L-001' && b.w.Baris_Transaksi.g(10, 1) === 'L-006' && b.w.Baris_Transaksi.g(10, 5) === 100, 'batch rows are contiguous and numbered correctly');
ok(b.log.lock.acquired === 1 && b.log.lock.released === 1, 'the whole batch runs under ONE lock');
b = api2(withOpening, { action: 'pos_kelompok', transaksi: [item('2026-02-01'), item('2026-02-02', { lines: [{ kodAkaun: 1020, debit: 100, kredit: 0 }, { kodAkaun: 4050, debit: 0, kredit: 90 }] }), item('2026-02-03')] });
ok(b.res.kod === 'KELOMPOK_TIDAK_SAH' && b.res.ralat[0].indeks === 1 && b.res.ralat[0].kod === 'TAK_SEIMBANG' && b.w.Transaksi.g(6, 1) === '', 'one unbalanced item rejects the whole batch (all-or-nothing) and names it');
b = api2(withOpening, { action: 'pos_kelompok', transaksi: [item('2026-02-01', { lines: [{ kodAkaun: 9999, debit: 5, kredit: 0 }, { kodAkaun: 4050, debit: 0, kredit: 5 }] })] }); ok(b.res.ralat[0].kod === 'KOD_TIDAK_SAH', 'unknown account code is caught per item');
b = api2(withOpening, { action: 'pos_kelompok', transaksi: [item('2025-06-01')] }); ok(b.res.ralat[0].kod === 'SEBELUM_PEMBUKAAN', 'batch applies the before-opening rule');
b = api2(withLock('2026-03-31'), { action: 'pos_kelompok', transaksi: [item('2026-03-10')] }); ok(b.res.ralat[0].kod === 'TEMPOH_DIKUNCI' && b.w.Transaksi.g(6, 1) === '', 'batch into a locked period without a reason is refused');
b = api2(withLock('2026-03-31'), { action: 'pos_kelompok', sebabLewat: 'Penyata lewat diterima', transaksi: [item('2026-03-10'), item('2026-04-02')] });
ok(b.res.status === 'BERJAYA' && b.res.bilanganLewat === 1 && b.w.Transaksi.g(6, 6) === 'Entri Lewat' && b.w.Transaksi.g(7, 6) === 'Disahkan', 'batch with a reason: only the locked-period item is tagged Entri Lewat');
ok(b.w.Log_Perubahan && /kelompok/.test(String(b.w.Log_Perubahan.g(2, 7))) && /Penyata lewat diterima/.test(String(b.w.Log_Perubahan.g(2, 7))), 'the batch reason is logged once in Log_Perubahan');
b = api2(w => { withOpening(w); w.Transaksi.s(7, 1, 'T-0005'); }, { action: 'pos_kelompok', transaksi: [item('2026-02-01')] });
ok(b.w.Transaksi.g(6, 1) === '' && b.w.Transaksi.g(8, 1) === 'T-0006', 'a gap in the middle is never filled by a block write (rows below stay safe)');
b = api2(null, { action: 'pos_kelompok', transaksi: [] }); ok(b.res.kod === 'KELOMPOK_KOSONG', 'empty batch refused');
b = api2(null, { action: 'pos_kelompok', transaksi: Array.from({ length: 501 }, () => item('2026-02-01')) }); ok(b.res.kod === 'KELOMPOK_BESAR', 'more than 500 per request refused');
const fillBt = n => w => { w.Baris_Transaksi.maxRows = 5000; for (let r = 5; r <= n; r++) w.Baris_Transaksi.s(r, 2, 'X'); };
b = api2(fillBt(4998), { action: 'pos_kelompok', transaksi: [item('2026-02-01'), item('2026-02-02')] }); ok(b.res.kod === 'KAPASITI_PENUH' && /tinggal 2 baris/.test(b.res.error) && b.w.Transaksi.g(5, 1) === '', 'batch that does not fit in the ledger window is refused with the remaining space');
b = api2(fillBt(4999), post('2026-02-01')); ok(b.res.kod === 'KAPASITI_PENUH' && b.w.Transaksi.g(5, 1) === '', 'a single post past the capacity is refused instead of silently falling outside the statements');
b = api2(fillBt(4996), post('2026-02-01')); ok(b.res.status === 'BERJAYA', 'a post that exactly fits (rows 4997-4998 free) still works');
b = api2(w => { for (let r = 5; r <= 1000; r++) w.Transaksi.s(r, 1, 'T-' + String(r).padStart(4, '0')); }, { action: 'pos_kelompok', transaksi: [item('2026-02-01'), item('2026-02-02')] });
ok(b.res.status === 'BERJAYA' && b.w.Transaksi.maxRows > 1000 && b.w.Transaksi.g(1001, 1) !== '', 'a full Transaksi grid is extended automatically');

console.log('\n=== 7. Documents phase 1: Pihak, auto-numbered PV / Resit, split lines, flags, PDF, void ===');
{
  const { ctx } = ctxFor(world(), []); load(ctx);
  const P = ctx.perkataanBMAPZ_;
  const T = [[0, 'RINGGIT MALAYSIA SIFAR SAHAJA'], [1, 'RINGGIT MALAYSIA SATU SAHAJA'], [11, 'RINGGIT MALAYSIA SEBELAS SAHAJA'], [15, 'RINGGIT MALAYSIA LIMA BELAS SAHAJA'],
    [21.5, 'RINGGIT MALAYSIA DUA PULUH SATU DAN SEN LIMA PULUH SAHAJA'], [100, 'RINGGIT MALAYSIA SERATUS SAHAJA'], [101, 'RINGGIT MALAYSIA SERATUS SATU SAHAJA'],
    [110, 'RINGGIT MALAYSIA SERATUS SEPULUH SAHAJA'], [111, 'RINGGIT MALAYSIA SERATUS SEBELAS SAHAJA'], [999, 'RINGGIT MALAYSIA SEMBILAN RATUS SEMBILAN PULUH SEMBILAN SAHAJA'],
    [1000, 'RINGGIT MALAYSIA SERIBU SAHAJA'], [1001, 'RINGGIT MALAYSIA SERIBU SATU SAHAJA'], [1234.5, 'RINGGIT MALAYSIA SERIBU DUA RATUS TIGA PULUH EMPAT DAN SEN LIMA PULUH SAHAJA'],
    [2500, 'RINGGIT MALAYSIA DUA RIBU LIMA RATUS SAHAJA'], [10000, 'RINGGIT MALAYSIA SEPULUH RIBU SAHAJA'], [11000, 'RINGGIT MALAYSIA SEBELAS RIBU SAHAJA'],
    [100000, 'RINGGIT MALAYSIA SERATUS RIBU SAHAJA'], [1000000, 'RINGGIT MALAYSIA SATU JUTA SAHAJA'], [1001000, 'RINGGIT MALAYSIA SATU JUTA SERIBU SAHAJA'],
    [1234567, 'RINGGIT MALAYSIA SATU JUTA DUA RATUS TIGA PULUH EMPAT RIBU LIMA RATUS ENAM PULUH TUJUH SAHAJA'], [0.05, 'SEN LIMA SAHAJA'], [0.5, 'SEN LIMA PULUH SAHAJA']];
  T.forEach(x => ok(P(x[0]) === x[1], 'amount in words ' + x[0] + ' -> ' + x[1]));
  ok(P(-5) === '' && P(NaN) === '', 'amount in words: negative / NaN give an empty string, never a wrong sentence');
  ok(ctx.teksSelamatAPZ_('=1+1') === ' =1+1' && ctx.teksSelamatAPZ_('+6012') === ' +6012' && ctx.teksSelamatAPZ_('  a   b ') === 'a b' && ctx.teksSelamatAPZ_(null) === '' && ctx.teksSelamatAPZ_('x'.repeat(300), 10).length === 10,
     'typed text: a leading = + - @ is neutralised (no formula injection), spaces collapsed, length capped');
  ok(ctx.rmAPZ_(1234.5) === '1,234.50' && ctx.rmAPZ_(0) === '0.00' && ctx.tarikhBMAPZ_('2026-10-10') === '10 Oktober 2026', 'RM and Malay date formatting');
  ok(ctx.formatNomborAPZ_('PV/{YY}/{NNN}', 2026, 7) === 'PV/26/007' && ctx.formatNomborAPZ_('RT-{YYYY}-{NNNN}', 2026, 12) === 'RT-2026-0012', 'number pattern placeholders');
  ok(ctx.amaranKawalanAPZ_('RT', 'Aminah', ' aminah ', '') === 'Pengeluar resit sama dengan perekod' && ctx.amaranKawalanAPZ_('RT', 'Aminah', 'Zaki', '') === '' &&
     ctx.amaranKawalanAPZ_('PV', 'Aminah', 'Zaki', '') === 'Tiada pelulus dicatat' && ctx.amaranKawalanAPZ_('PV', 'Aminah', 'Zaki', 'AMINAH') === 'Penyedia baucar sama dengan pelulus' && ctx.amaranKawalanAPZ_('PV', 'Aminah', 'Zaki', 'Hasan') === '',
     'control flags: receipt issuer = recorder, voucher without approver, preparer = approver (case/space-insensitive)');
}
const WANG = 1020;
const barisPV = (kat, j) => [{ kodAkaun: kat, debit: j, kredit: 0, butiran: 'Bil internet Dis' }, { kodAkaun: WANG, debit: 0, kredit: j, memo: 'INV-77' }];
const barisRT = (kat, j) => [{ kodAkaun: WANG, debit: j, kredit: 0, memo: '' }, { kodAkaun: kat, debit: 0, kredit: j, butiran: 'Yuran kursus' }];
const dok = (jenis, extra) => Object.assign({ jenis, akaunWang: WANG, pihak: { baharu: { nama: 'Syarikat Ujian Sdn Bhd', jenis: 'Pembekal', noDaftar: '123456-X' } }, butiran: 'Bil Dis', rujukanLuar: 'INV-77', dikeluarkanOleh: 'Aminah', direkodOleh: 'Zaki', diluluskanOleh: 'Hasan' }, extra || {});
const bodyD = (jenis, lines, dx, bx) => Object.assign({ tarikh: '2026-03-10', perkara: 'Bayaran kepada Syarikat Ujian', noPV: '', kaedah: 'Bank', lines, dokumen: dok(jenis, dx) }, bx || {});
const seimbang = w => { let d = 0, k = 0; for (let i = 5; i < 1000; i++) { d += Number(w.Baris_Transaksi.g(i, 4)) || 0; k += Number(w.Baris_Transaksi.g(i, 5)) || 0; } return Math.round((d - k) * 100) === 0; };
function session(setup, skip) {
  const w = world(); if (setup) setup(w);
  const { ctx, log } = ctxFor(w, []); load(ctx, skip);
  const call = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ secret: SECRET }, body)) } }).s);
  const get = () => JSON.parse(ctx.doGet({ parameter: { secret: SECRET } }).s);
  return { w, ctx, log, post: call, get };
}
const nothingWritten = S => S.w.Transaksi.getLastRow() === 0 && S.w.Baris_Transaksi.getLastRow() === 0 && S.w.Dokumen.getLastRow() === 0 && S.w.Dokumen_Baris.getLastRow() === 0 && S.w.Pihak.getLastRow() === 0;

let S = session();
let res = S.post(bodyD('PV', barisPV(5150, 300)));
ok(res.status === 'BERJAYA' && !!res.dokumen && res.dokumen.no === 'PV-2026-0001' && res.dokumen.jenis === 'PV' && res.dokumen.id === 'D-0001', 'PV: the response carries the document number');
ok(S.w.Transaksi.g(5, 4) === 'PV-2026-0001', 'Transaksi!D holds the generated number (replaces typing No. PV/RT)');
ok(S.w.Dokumen.g(5, 5) === 'PV-2026-0001' && S.w.Dokumen.g(5, 2) === 'PV' && S.w.Dokumen.g(5, 3) === 2026 && S.w.Dokumen.g(5, 4) === 1 && S.w.Dokumen.g(5, 10) === 300 && S.w.Dokumen.g(5, 13) === res.idTransaksi && S.w.Dokumen.g(5, 14) === 'Dikeluarkan' && S.w.Dokumen.g(5, 18) === 'INV-77', 'Dokumen row written and linked to the ledger transaction');
ok(S.w.Dokumen.g(5, 8) === 'Syarikat Ujian Sdn Bhd' && S.w.Dokumen.g(5, 7) === 'P-0001' && S.w.Pihak.g(5, 1) === 'P-0001' && S.w.Pihak.g(5, 4) === '123456-X' && S.w.Pihak.g(5, 12) === 'Aktif', 'new party created once (P-0001) and its name frozen on the document');
ok(S.w.Dokumen_Baris.g(5, 2) === 'D-0001' && S.w.Dokumen_Baris.g(5, 4) === 5150 && S.w.Dokumen_Baris.g(5, 9) === 300 && S.w.Dokumen_Baris.g(5, 6) === 'Bil internet Dis' && S.w.Dokumen_Baris.g(5, 5) === 'Internet' && S.w.Dokumen_Baris.g(5, 1) === 'DB-0001', 'document line copied (frozen) with its account name and butiran');
ok(seimbang(S.w) && S.w.Baris_Transaksi.g(5, 3) === 5150 && S.w.Baris_Transaksi.g(6, 3) === 1020 && S.w.Baris_Transaksi.g(6, 5) === 300, 'the ledger is balanced: Debit 5150 / Kredit 1020');
const html0 = S.log.drive.pdfHtml[0] || '';
ok(/BAUCAR BAYARAN/.test(html0) && /TIGA RATUS SAHAJA/.test(html0) && /Syarikat Ujian Sdn Bhd/.test(html0) && /Koperasi Ujian Berhad/.test(html0) && /SKM-123/.test(html0) && /10 Mac 2026/.test(html0) && /Diluluskan oleh/.test(html0) && /\(Hasan\)/.test(html0), 'PDF html: title, koperasi, party, amount in words, date, approver');
ok(S.log.drive.files[0].folder === 'root/APZacct - Resit & PV/Dokumen Dijana/PV/2026' && S.log.drive.files[0].name === 'PV-2026-0001.pdf' && res.dokumen.urlPdf === 'https://drive.test/' + encodeURIComponent('root/APZacct - Resit & PV/Dokumen Dijana/PV/2026/PV-2026-0001.pdf') && S.w.Dokumen.g(5, 19) === res.dokumen.urlPdf, 'PDF saved under Dokumen Dijana/PV/2026 and its link stored in Dokumen!S');
ok(res.dokumen.amaran === '' && S.w.Dokumen.g(5, 21) === '', 'approver present and different from the preparer: no control flag');
ok(S.log.lock.acquired === 1 && S.log.lock.released === 1, 'the ledger rows, the party and the document are written under ONE lock');

res = S.post(bodyD('PV', barisPV(5150, 120)));
ok(res.dokumen.no === 'PV-2026-0002' && S.w.Pihak.g(6, 1) === '' && S.w.Dokumen.g(6, 7) === 'P-0001', 'second PV: next number, and the same party name is reused (no duplicate Pihak row)');
res = S.post(bodyD('RT', barisRT(4050, 500), { pihak: { baharu: { nama: 'Ahli Satu' } }, dikeluarkanOleh: 'Zaki', direkodOleh: 'zaki', diluluskanOleh: '' }, { perkara: 'Terimaan daripada Ahli Satu' }));
ok(res.dokumen.no === 'RT-2026-0001' && /RESIT RASMI/.test(S.log.drive.pdfHtml[2]) && /LIMA RATUS SAHAJA/.test(S.log.drive.pdfHtml[2]) && /Diterima daripada/.test(S.log.drive.pdfHtml[2]), 'Resit has its own sequence (RT-2026-0001) and its own layout');
ok(res.dokumen.amaran === 'Pengeluar resit sama dengan perekod' && S.w.Dokumen.g(7, 21) === 'Pengeluar resit sama dengan perekod', 'receipt issued and recorded by the same person: saved, flagged (warn, never block)');
ok(S.w.Pihak.g(6, 1) === 'P-0002' && S.w.Pihak.g(6, 3) === 'Lain-lain', 'unknown party type falls back to Lain-lain');
res = S.post(bodyD('PV', barisPV(5150, 80), { diluluskanOleh: '' }));
ok(res.dokumen.amaran === 'Tiada pelulus dicatat', 'voucher without an approver is flagged');
res = S.post(bodyD('PV', barisPV(5150, 90), { diluluskanOleh: 'aminah' }));
ok(res.dokumen.amaran === 'Penyedia baucar sama dengan pelulus', 'voucher approved by its own preparer is flagged');
res = S.post(bodyD('PV', barisPV(5150, 10), {}, { tarikh: '2027-01-05' }));
ok(res.dokumen.no === 'PV-2027-0001', 'the sequence restarts in a new year when the pattern has {YYYY}');
ok(seimbang(S.w), 'ledger still balanced after 7 documents');

S = session(w => { w.Tetapan.s(26, 3, 'PV-{NNNN}'); w.Tetapan.s(27, 3, 'RT/{YY}/{NNN}'); });
ok(S.post(bodyD('PV', barisPV(5150, 10))).dokumen.no === 'PV-0001' && S.post(bodyD('PV', barisPV(5150, 10), {}, { tarikh: '2027-02-01' })).dokumen.no === 'PV-0002', 'pattern without a year keeps counting across years (no duplicate numbers)');
ok(S.post(bodyD('RT', barisRT(4050, 10))).dokumen.no === 'RT/26/001', 'a custom pattern from Tetapan!C27 is used (RT/26/001)');
S = session(w => w.Tetapan.s(26, 3, 'tanpa-nombor'));
ok(S.post(bodyD('PV', barisPV(5150, 10))).dokumen.no === 'PV-2026-0001', 'a pattern with no {N...} is ignored: the default pattern keeps numbers unique');

S = session();
res = S.post(bodyD('PV', [{ kodAkaun: 5150, debit: 200, kredit: 0, butiran: 'Internet' }, { kodAkaun: 5010, debit: 100, kredit: 0, butiran: 'Alat tulis' }, { kodAkaun: WANG, debit: 0, kredit: 300, memo: '' }]));
ok(res.status === 'BERJAYA' && S.w.Dokumen.g(5, 10) === 300 && S.w.Dokumen_Baris.g(5, 9) === 200 && S.w.Dokumen_Baris.g(6, 9) === 100 && S.w.Dokumen_Baris.g(6, 3) === 2 && S.w.Dokumen_Baris.g(6, 6) === 'Alat tulis' && S.w.Baris_Transaksi.g(7, 5) === 300 && seimbang(S.w), 'split: one PV, two document lines, three balanced ledger lines');

const fails = [
  ['no party', S => S.post(bodyD('PV', barisPV(5150, 50), { pihak: {} })), 'PIHAK_DIPERLUKAN'],
  ['party name too short', S => S.post(bodyD('PV', barisPV(5150, 50), { pihak: { baharu: { nama: 'A' } } })), 'PIHAK_TIDAK_SAH'],
  ['unknown party id', S => S.post(bodyD('PV', barisPV(5150, 50), { pihak: { id: 'P-0099' } })), 'PIHAK_TIDAK_SAH'],
  ['missing officer names', S => S.post(bodyD('PV', barisPV(5150, 50), { dikeluarkanOleh: '' })), 'PEGAWAI_DIPERLUKAN'],
  ['money account is not a money account', S => S.post(bodyD('PV', [{ kodAkaun: 5150, debit: 50, kredit: 0 }, { kodAkaun: 1100, debit: 0, kredit: 50 }], { akaunWang: 1100 })), 'DOKUMEN_TIDAK_SAH'],
  ['Resit with money going out', S => S.post(bodyD('RT', barisPV(5150, 50))), 'DOKUMEN_TIDAK_SAH'],
  ['Baucar with money coming in', S => S.post(bodyD('PV', barisRT(4050, 50))), 'DOKUMEN_TIDAK_SAH'],
  ['unknown document type', S => S.post(bodyD('XX', barisPV(5150, 50))), 'DOKUMEN_TIDAK_SAH'],
  ['Kontra with a document', S => S.post(bodyD('PV', barisPV(5150, 50), {}, { kaedah: 'Kontra' })), 'DOKUMEN_TIDAK_SAH'],
  ['two money lines', S => S.post(bodyD('PV', [{ kodAkaun: 5150, debit: 100, kredit: 0 }, { kodAkaun: WANG, debit: 0, kredit: 50 }, { kodAkaun: WANG, debit: 0, kredit: 50 }])), 'DOKUMEN_TIDAK_SAH'],
  ['a category line with both sides', S => S.post(bodyD('PV', [{ kodAkaun: 5150, debit: 100, kredit: 40 }, { kodAkaun: 5010, debit: 0, kredit: 0 }, { kodAkaun: WANG, debit: 0, kredit: 60 }])), 'DOKUMEN_TIDAK_SAH']
];
fails.forEach(f => { const s = session(); const x = f[1](s); ok(x.kod === f[2] && nothingWritten(s), 'refused (' + f[0] + '): ' + f[2] + ' and NOTHING is written'); });
{ const s = session(w => { w.Pihak.s(5, 1, 'P-0001'); w.Pihak.s(5, 2, 'Pembekal Lama'); w.Pihak.s(5, 12, 'Tidak Aktif'); });
  const x = s.post(bodyD('PV', barisPV(5150, 50), { pihak: { id: 'P-0001' } })); ok(x.kod === 'PIHAK_TIDAK_SAH' && s.w.Transaksi.getLastRow() === 0 && s.w.Dokumen.getLastRow() === 0, 'an inactive party cannot be used (nothing written)');
  const g = s.get(); ok(Array.isArray(g.pihak) && g.pihak.length === 0, 'doGet leaves inactive parties out of the list'); }
{ const s = session(w => { w.Pihak.s(5, 1, 'P-0001'); w.Pihak.s(5, 2, 'Pembekal Tetap'); w.Pihak.s(5, 3, 'Pembekal'); w.Pihak.s(5, 12, 'Aktif'); w.Pihak.s(5, 4, 'BRN-9'); w.Pihak.s(5, 8, 'Jalan Pembekal'); });
  const g = s.get(); ok(g.versi === RELEASE && g.pihak.length === 1 && g.pihak[0].id === 'P-0001' && g.pihak[0].nama === 'Pembekal Tetap' && g.pihak[0].jenis === 'Pembekal', 'doGet returns the backend release and the active parties');
  const x = s.post(bodyD('PV', barisPV(5150, 50), { pihak: { id: 'P-0001' } }));
  ok(x.status === 'BERJAYA' && s.w.Dokumen.g(5, 8) === 'Pembekal Tetap' && s.w.Pihak.g(6, 1) === '' && /BRN-9/.test(s.log.drive.pdfHtml[0]) && /Jalan Pembekal/.test(s.log.drive.pdfHtml[0]), 'an existing party picked by id: no new row; its registration no. and address print on the document'); }
{ const s = session(); s.post(bodyD('PV', barisPV(5150, 50), { pihak: { baharu: { nama: '=HYPERLINK("http://x")' } } }));
  ok(String(s.w.Pihak.g(5, 2)).indexOf(' =') === 0 && String(s.w.Dokumen.g(5, 8)).indexOf(' =') === 0 && !/<script|=HYPERLINK\("http/.test(s.log.drive.pdfHtml[0].replace(/&quot;/g, '"').replace(/ =HYPERLINK/g, '')), 'a party name that looks like a formula is stored as plain text'); }
{ const s = session(); s.post(bodyD('PV', barisPV(5150, 50), { pihak: { baharu: { nama: '<b>Gempar</b> & Anak' } } }));
  ok(/&lt;b&gt;Gempar&lt;\/b&gt; &amp; Anak/.test(s.log.drive.pdfHtml[0]) && !/<b>Gempar/.test(s.log.drive.pdfHtml[0]), 'HTML in a name is escaped on the printed document'); }

S = session(); S.log.drive.failPdf = true;
res = S.post(bodyD('PV', barisPV(5150, 300)));
ok(res.status === 'BERJAYA' && res.dokumen.no === 'PV-2026-0001' && res.dokumen.urlPdf === '' && /PDF tidak dapat dijana/.test(res.dokumen.amaranPdf) && S.w.Dokumen.g(5, 19) === '' && seimbang(S.w), 'PDF conversion fails: the posting and the document still stand, the link stays empty, the message explains');
S.log.drive.failPdf = false;
let p2 = S.post({ action: 'dokumen_pdf', idDokumen: 'D-0001' });
ok(p2.status === 'BERJAYA' && /PV-2026-0001\.pdf/.test(decodeURIComponent(p2.urlPdf)) && S.w.Dokumen.g(5, 19) === p2.urlPdf, 'Jana PDF later: the link is filled in Dokumen!S');

S = session(); S.post(bodyD('PV', barisPV(5150, 300))); S.post(bodyD('RT', barisRT(4050, 50), { dikeluarkanOleh: 'Ali' }));
const sen = S.post({ action: 'dokumen_senarai' });
ok(sen.jumlah === 2 && sen.dokumen[0].no === 'RT-2026-0001' && sen.dokumen[1].no === 'PV-2026-0001' && sen.dokumen[1].jumlah === 300 && sen.dokumen[1].status === 'Dikeluarkan' && sen.dokumen[0].baris === undefined && sen.dokumen[1].tarikh === '2026-03-10', 'dokumen_senarai: newest first, compact rows, normalised dates');
const hh = S.post({ action: 'dokumen_html', idDokumen: 'D-0001' });
ok(/^<!DOCTYPE html>/.test(hh.html) && /BAUCAR BAYARAN/.test(hh.html) && hh.no === 'PV-2026-0001' && S.post({ action: 'dokumen_html', idDokumen: 'D-0099' }).kod === 'DOKUMEN_TIDAK_DIJUMPAI', 'dokumen_html returns the print view (and a clear error for an unknown id)');

const lejarSebelum = JSON.stringify(S.w.Baris_Transaksi.d);
ok(S.post({ action: 'dokumen_batal', idDokumen: 'D-0001', sebab: '' }).kod === 'SEBAB_DIPERLUKAN' && S.post({ action: 'dokumen_batal', idDokumen: 'D-0099', sebab: 'Salah' }).kod === 'DOKUMEN_TIDAK_DIJUMPAI' && JSON.stringify(S.w.Baris_Transaksi.d) === lejarSebelum, 'void needs a reason and a real document; nothing changes otherwise');
const bt = S.post({ action: 'dokumen_batal', idDokumen: 'D-0001', sebab: 'Salah jumlah' });
ok(bt.status === 'BERJAYA' && bt.noDokumen === 'PV-2026-0001' && bt.idTransaksiBatal === 'T-0002' && S.w.Dokumen.g(5, 14) === 'Batal' && S.w.Dokumen.g(5, 22) === 'T-0002' && S.w.Dokumen.g(5, 24) === 'Salah jumlah', 'void: document marked Batal with the reason and the reversing transaction');
ok(S.w.Transaksi.g(7, 1) === 'T-0002' && S.w.Transaksi.g(7, 5) === 'Jurnal' && /Pembatalan PV-2026-0001/.test(S.w.Transaksi.g(7, 3)) && S.w.Transaksi.g(7, 4) === 'PV-2026-0001', 'the reversal is an ordinary Jurnal transaction that quotes the document number');
ok(S.w.Baris_Transaksi.g(9, 3) === 5150 && S.w.Baris_Transaksi.g(9, 5) === 300 && S.w.Baris_Transaksi.g(9, 4) === 0 && S.w.Baris_Transaksi.g(10, 3) === 1020 && S.w.Baris_Transaksi.g(10, 4) === 300 && seimbang(S.w), 'reversal lines swap Debit and Kredit; the ledger stays balanced');
let net5150 = 0; for (let i = 5; i < 20; i++) if (S.w.Baris_Transaksi.g(i, 3) === 5150) net5150 += (Number(S.w.Baris_Transaksi.g(i, 4)) || 0) - (Number(S.w.Baris_Transaksi.g(i, 5)) || 0);
ok(net5150 === 0, 'the expense account nets to zero after the void');
ok(/PV-2026-0001 \(BATAL\)\.pdf/.test(decodeURIComponent(bt.urlPdfBatal)) && S.w.Dokumen.g(5, 25) === bt.urlPdfBatal && /DIBATALKAN pada 20\d\d-|DIBATALKAN pada \d+ /.test(S.log.drive.pdfHtml[S.log.drive.pdfHtml.length - 1]) && /Salah jumlah/.test(S.log.drive.pdfHtml[S.log.drive.pdfHtml.length - 1]), 'a PDF copy stamped DIBATALKAN (with the reason) is saved and linked in Dokumen!Y');
ok(S.post({ action: 'dokumen_batal', idDokumen: 'D-0001', sebab: 'Sekali lagi' }).kod === 'SUDAH_BATAL', 'a document cannot be voided twice');
ok(S.w.Log_Perubahan && /Batal PV-2026-0001: Salah jumlah/.test(String(S.w.Log_Perubahan.g(2, 7))) && S.w.Log_Perubahan.g(2, 3) === 'Dokumen', 'the void is written to Log_Perubahan with its reason');
ok(/DIBATALKAN/.test(S.post({ action: 'dokumen_html', idDokumen: 'D-0001' }).html), 'the print view of a voided document shows the DIBATALKAN banner');

S = session(); S.log.lock.busy = true;
ok(S.post(bodyD('PV', barisPV(5150, 50))).kod === 'SISTEM_SIBUK' && nothingWritten(S), 'busy lock: SISTEM_SIBUK, no ledger row, no party, no document');
S = session(fillBt(4999));
ok(S.post(bodyD('PV', barisPV(5150, 50))).kod === 'KAPASITI_PENUH' && S.w.Pihak.getLastRow() === 0 && S.w.Dokumen.getLastRow() === 0 && S.w.Transaksi.getLastRow() === 0, 'a full ledger refuses the document post before any party or document is created');
S = session(); S.post(bodyD('PV', barisPV(5150, 50))); S.log.lock.busy = true;
ok(S.post({ action: 'dokumen_batal', idDokumen: 'D-0001', sebab: 'Ujian' }).kod === 'SISTEM_SIBUK' && S.w.Dokumen.g(5, 14) === 'Dikeluarkan', 'busy lock on void: refused, the document is untouched');

S = session(w => { delete w.Dokumen_Baris; });
{ const w2 = world(); const x = (() => { const { ctx } = ctxFor(w2, []); w2.Dokumen_Baris = undefined; delete w2.Dokumen_Baris; load(ctx);
    const out = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ secret: SECRET, ...bodyD('PV', barisPV(5150, 50)) }) } }).s); return out; })();
  ok(x.kod === 'HELAIAN_DOKUMEN_TIADA' && w2.Transaksi.getLastRow() === 0 && w2.Baris_Transaksi.getLastRow() === 0 && w2.Pihak.getLastRow() === 0, 'a workbook without Dokumen_Baris is detected BEFORE anything is written (use template v1.4)'); }
{ const s = session(null, ['-Dokumen_']); const x = s.post(bodyD('PV', barisPV(5150, 50)));
  ok(x.kod === 'FAIL_DOKUMEN_TIADA' && s.w.Transaksi.getLastRow() === 0, 'APZacct-Dokumen_v1.4.gs forgotten in Apps Script: a clear error, nothing written');
  ok(s.get().pihak.length === 0 && s.get().versi === RELEASE, 'doGet still works without the Dokumen file');
  ok(s.post({ action: 'dokumen_senarai' }).kod === 'FAIL_DOKUMEN_TIADA', 'document actions explain the missing file too'); }
{ const s = session(); const x = s.post({ tarikh: '2026-03-10', perkara: 'Lama', noPV: 'PV-5', kaedah: 'Bank', lines: barisPV(5150, 70) });
  ok(x.status === 'BERJAYA' && x.dokumen === undefined && s.w.Transaksi.g(5, 4) === 'PV-5' && s.w.Dokumen.getLastRow() === 0, 'a v1.3-style post (no dokumen) still works and keeps the typed reference'); }

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed.'); process.exit(fail ? 1 : 0);
