'use strict';

/**
 * APZacct — Core Accounting Engine Test Suite (standalone, Node.js)
 * -------------------------------------------------------------
 * Ports the exact debit/credit and validation logic that lives in
 * app.js (buildLines), APZacct_BakiPembukaan.gs (posBakiPembukaan
 * validation), APZacct_PosAgihanAPK.gs (posAgihanAPK math),
 * APZacct_Laporan.gs (diagnosisKetidakseimbangan checks), and
 * APZacct_RekonsiliasiBank.gs (the reconciliation formula + the
 * matching algorithm) — then runs standard bookkeeping test
 * scenarios through each one and asserts the result is what real
 * double-entry accounting says it should be.
 *
 * This is a plain Node script, not Apps Script — it needs no
 * Google Sheet to run, on purpose: it proves the MATH and RULES are
 * right in isolation, which is valuable specifically because (per
 * project notes) no part of this codebase has ever actually been
 * executed yet — everything so far has been hand-traced only. This
 * is that logic's first real run.
 *
 * It CANNOT see or test the live spreadsheet's own formulas
 * (Imbangan_Duga / UR / KKK / AT / APK cell formulas) — that is a
 * separate, still-open item, covered in the audit write-up.
 *
 * Run: node test-akauntan-engine.js
 */

let pass = 0, fail = 0;
const failures = [];

function assert(cond, label) {
  if (cond) { pass++; console.log('  PASS - ' + label); }
  else { fail++; failures.push(label); console.log('  FAIL - ' + label); }
}

function assertClose(a, b, label, eps) {
  eps = eps === undefined ? 0.005 : eps;
  assert(Math.abs(a - b) < eps, label + ' (got ' + a + ', expected ' + b + ')');
}

function section(name) { console.log('\n=== ' + name + ' ==='); }

/* ------------------------------------------------------------
   Illustrative test chart of accounts — NOT KOPEMMB's real Akaun
   sheet. Only used to give the ported logic something to validate
   codes against.
   ------------------------------------------------------------ */
const AKAUN = {
  1010: { nama: 'Bank Islam', jenis: 'Aset' },
  1020: { nama: 'Wang Runcit', jenis: 'Aset' },
  2020: { nama: 'Dividen Diisytiharkan', jenis: 'Liabiliti' },
  2070: { nama: 'Cukai Pendapatan Belum Dibayar', jenis: 'Liabiliti' },
  2080: { nama: 'Zakat Belum Dibayar', jenis: 'Liabiliti' },
  2090: { nama: 'Honorarium Lembaga Belum Dibayar', jenis: 'Liabiliti' },
  2100: { nama: 'KWA Pendidikan Koperasi Belum Dibayar', jenis: 'Liabiliti' },
  2110: { nama: 'KWA Pembangunan Koperasi Belum Dibayar', jenis: 'Liabiliti' },
  2200: { nama: 'Pinjaman Bank', jenis: 'Liabiliti' },
  3010: { nama: 'Modal Syer', jenis: 'Ekuiti' },
  3020: { nama: 'Kumpulan Wang Rizab Statutori', jenis: 'Ekuiti' },
  3030: { nama: 'Lebihan Terkumpul', jenis: 'Ekuiti' },
  4010: { nama: 'Yuran Keahlian', jenis: 'Hasil' },
  5010: { nama: 'Sewa Pejabat', jenis: 'Perbelanjaan' }
};

function normalBalance(jenis) {
  // ported from Tambah_Akaun.gs column E formula:
  // =IF(OR(D="Aset",D="Perbelanjaan"),"Debit","Kredit")
  return (jenis === 'Aset' || jenis === 'Perbelanjaan') ? 'Debit' : 'Kredit';
}

/* ------------------------------------------------------------
   1. Chart-of-accounts classification
   ------------------------------------------------------------ */
section('1. Chart of accounts — normal balance rule');
assert(normalBalance('Aset') === 'Debit', 'Aset -> Debit');
assert(normalBalance('Liabiliti') === 'Kredit', 'Liabiliti -> Kredit');
assert(normalBalance('Ekuiti') === 'Kredit', 'Ekuiti -> Kredit');
assert(normalBalance('Hasil') === 'Kredit', 'Hasil -> Kredit');
assert(normalBalance('Perbelanjaan') === 'Debit', 'Perbelanjaan -> Debit');

/* ------------------------------------------------------------
   2. buildLines() — ported verbatim from app.js
   ------------------------------------------------------------ */
function buildLines(state) {
  var jumlah = Number(state.jumlah);
  if (state.jenis === 'kontra') {
    return [
      { kodAkaun: state.keAkaun, debit: jumlah, kredit: 0 },
      { kodAkaun: state.dariAkaun, debit: 0, kredit: jumlah }
    ];
  }
  if (state.jenis === 'dt') {
    return [
      { kodAkaun: state.akaunWang, debit: jumlah, kredit: 0 },
      { kodAkaun: state.kategori, debit: 0, kredit: jumlah }
    ];
  }
  return [
    { kodAkaun: state.kategori, debit: jumlah, kredit: 0 },
    { kodAkaun: state.akaunWang, debit: 0, kredit: jumlah }
  ];
}

function linesBalance(lines) {
  var d = lines.reduce(function (s, l) { return s + l.debit; }, 0);
  var k = lines.reduce(function (s, l) { return s + l.kredit; }, 0);
  return Math.round((d - k) * 100) === 0;
}

section('2. buildLines() — DT / KT / Kontra dual-entry generation');

var l1 = buildLines({ jenis: 'dt', akaunWang: 1010, kategori: 4010, jumlah: 100 });
assert(linesBalance(l1), 'DT: RM100 membership fee receipt balances');
assert(l1[0].kodAkaun === 1010 && l1[0].debit === 100, 'DT: money account (Bank) is DEBITED');
assert(l1[1].kodAkaun === 4010 && l1[1].kredit === 100, 'DT: category (Revenue) is CREDITED');

var l2 = buildLines({ jenis: 'kt', akaunWang: 1010, kategori: 5010, jumlah: 800 });
assert(linesBalance(l2), 'KT: RM800 office rent payment balances');
assert(l2[0].kodAkaun === 5010 && l2[0].debit === 800, 'KT: category (Expense) is DEBITED');
assert(l2[1].kodAkaun === 1010 && l2[1].kredit === 800, 'KT: money account (Bank) is CREDITED');

var l3 = buildLines({ jenis: 'kontra', keAkaun: 1010, dariAkaun: 1020, jumlah: 500 });
assert(linesBalance(l3), 'Kontra: RM500 Petty Cash -> Bank transfer balances');
assert(l3[0].kodAkaun === 1010 && l3[0].debit === 500, 'Kontra: destination (Bank) is DEBITED');
assert(l3[1].kodAkaun === 1020 && l3[1].kredit === 500, 'Kontra: source (Petty Cash) is CREDITED');

/* ------------------------------------------------------------
   3. Opening balance posting — ported from posBakiPembukaan()
   ------------------------------------------------------------ */
section('3. Opening balance posting rules');

function validateOpeningLines(rows) {
  var errors = [];
  var totalDebit = 0, totalKredit = 0;
  rows.forEach(function (row, i) {
    var kod = row.kod, debit = row.debit || 0, kredit = row.kredit || 0;
    var info = AKAUN[kod];
    if (!info) { errors.push('row ' + i + ': unknown kod'); return; }
    if (info.jenis === 'Hasil' || info.jenis === 'Perbelanjaan') {
      errors.push('row ' + i + ': ' + info.nama + ' is ' + info.jenis + ' — cannot carry an opening balance');
      return;
    }
    if (debit && kredit) { errors.push('row ' + i + ': both debit and kredit filled'); return; }
    totalDebit += debit; totalKredit += kredit;
  });
  var balanced = Math.round((totalDebit - totalKredit) * 100) === 0;
  return { errors: errors, balanced: balanced, totalDebit: totalDebit, totalKredit: totalKredit };
}

var validOpening = validateOpeningLines([
  { kod: 1010, debit: 50000 },
  { kod: 2200, kredit: 20000 },
  { kod: 3010, kredit: 30000 }
]);
assert(validOpening.errors.length === 0, 'Valid opening balances: no errors');
assert(validOpening.balanced, 'Valid opening balances: 50000 debit === 50000 kredit');

var badOpening = validateOpeningLines([
  { kod: 1010, debit: 50000 },
  { kod: 4010, kredit: 50000 } // Hasil account — must be rejected
]);
assert(badOpening.errors.length === 1, 'Opening balance on a Hasil (revenue) account is rejected');

var unbalancedOpening = validateOpeningLines([
  { kod: 1010, debit: 50000 },
  { kod: 3010, kredit: 40000 }
]);
assert(!unbalancedOpening.balanced, 'Unbalanced opening balances (50000 vs 40000) correctly flagged');

function tahunDitutup(tarikhPembukaan) { return Number(tarikhPembukaan.slice(0, 4)) - 1; }
assert(tahunDitutup('2026-01-01') === 2025, 'Opening 2026-01-01 archives its figures as 2025 closing (Sejarah_Baki)');

/* ------------------------------------------------------------
   4. APK surplus-distribution posting — ported from posAgihanAPK()
   ------------------------------------------------------------ */
section('4. APK surplus-distribution posting');

function buildApkPosting(figures) {
  var creditLines = [];
  ['rizab', 'pendidikan', 'pembangunan', 'cukai', 'zakat', 'honorarium'].forEach(function (key) {
    if (Math.round((figures[key] || 0) * 100) !== 0) creditLines.push({ key: key, amaun: figures[key] });
  });
  if (Math.round((figures.dividen || 0) * 100) !== 0) creditLines.push({ key: 'dividen', amaun: figures.dividen });
  var total = creditLines.reduce(function (s, l) { return s + l.amaun; }, 0);
  return { debit: total, creditLines: creditLines, creditTotal: total };
}

var apk = buildApkPosting({ rizab: 5000, pendidikan: 1000, pembangunan: 1000, cukai: 500, zakat: 300, honorarium: 700, dividen: 2500 });
assertClose(apk.debit, 11000, 'APK: debit to Lebihan Terkumpul (3030) = 11000');
assertClose(apk.creditTotal, 11000, 'APK: sum of credit lines = 11000 (balances the debit)');
assert(apk.creditLines.length === 7, 'APK: all 7 non-zero buckets each produce a credit line');

var apkNoDividend = buildApkPosting({ rizab: 4000, pendidikan: 800, pembangunan: 800, cukai: 0, zakat: 0, honorarium: 0, dividen: 0 });
assert(apkNoDividend.creditLines.length === 3, 'APK: zero buckets (e.g. no dividend this year) are omitted, not posted as RM0 lines');
assertClose(apkNoDividend.debit, 5600, 'APK: debit matches only the non-zero buckets (5600)');

// GP23 / Akta s.57(4): KWA Pendidikan + KWA Pembangunan rates are
// DEDUCTED FROM the KWRS rate, not added on top of it — e.g. a
// 15%/2%/1% split is 15% total, not 18%. The posting math itself
// (above) is rate-agnostic and correct either way; this just checks
// the arithmetic relationship the treasurer must apply BEFORE typing
// figures into APK, since posAgihanAPK() does not compute this itself.
var totalStatutoryRate = 0.15; // illustrative, NOT a claim about KOPEMMB's current rate — see write-up
var pendidikanRate = 0.02, pembangunanRate = 0.01;
var netRizabRate = totalStatutoryRate - pendidikanRate - pembangunanRate;
assertClose(netRizabRate, 0.12, 'Illustrative split: 15% total = 12% net KWRS + 2% Pendidikan + 1% Pembangunan');

/* ------------------------------------------------------------
   5. Ledger-integrity diagnosis — ported from
      diagnosisKetidakseimbangan()
   ------------------------------------------------------------ */
section('5. Ledger integrity diagnosis');

function diagnose(barisTransaksi, transaksiIds, akaunCodes) {
  var findings = [];
  var byTx = {};
  barisTransaksi.forEach(function (r) {
    if (!byTx[r.idTx]) byTx[r.idTx] = { debit: 0, kredit: 0 };
    byTx[r.idTx].debit += r.debit || 0;
    byTx[r.idTx].kredit += r.kredit || 0;
    if (!akaunCodes[r.kod]) findings.push('unknown kod ' + r.kod + ' on ' + r.idTx);
  });
  Object.keys(byTx).forEach(function (id) {
    var g = byTx[id];
    if (Math.round((g.debit - g.kredit) * 100) !== 0) findings.push('unbalanced transaction ' + id);
  });
  transaksiIds.forEach(function (id) { if (!byTx[id]) findings.push('orphan header ' + id + ' (no lines)'); });
  Object.keys(byTx).forEach(function (id) { if (transaksiIds.indexOf(id) === -1) findings.push('orphan lines ' + id + ' (no header)'); });
  return findings;
}

var akCodes = { 1010: true, 4010: true, 5010: true };

var f1 = diagnose([{ idTx: 'T-0001', kod: 1010, debit: 100, kredit: 0 }, { idTx: 'T-0001', kod: 4010, debit: 0, kredit: 90 }], ['T-0001'], akCodes);
assert(f1.indexOf('unbalanced transaction T-0001') !== -1, 'Diagnosis catches a genuinely unbalanced transaction (100 debit vs 90 kredit)');

var f2 = diagnose([{ idTx: 'T-0002', kod: 9999, debit: 50, kredit: 0 }, { idTx: 'T-0002', kod: 1010, debit: 0, kredit: 50 }], ['T-0002'], akCodes);
assert(f2.indexOf('unknown kod 9999 on T-0002') !== -1, 'Diagnosis catches a line posted against a nonexistent Kod Akaun');

var f3 = diagnose([], ['T-0003'], akCodes);
assert(f3.indexOf('orphan header T-0003 (no lines)') !== -1, 'Diagnosis catches a Transaksi header with zero matching lines');

var f4 = diagnose([{ idTx: 'T-0004', kod: 1010, debit: 20, kredit: 0 }, { idTx: 'T-0004', kod: 4010, debit: 0, kredit: 20 }], [], akCodes);
assert(f4.indexOf('orphan lines T-0004 (no header)') !== -1, 'Diagnosis catches Baris_Transaksi rows with no matching Transaksi header');

var fClean = diagnose([{ idTx: 'T-0005', kod: 1010, debit: 20, kredit: 0 }, { idTx: 'T-0005', kod: 4010, debit: 0, kredit: 20 }], ['T-0005'], akCodes);
assert(fClean.length === 0, 'Diagnosis reports nothing for a genuinely clean, balanced transaction');

/* ------------------------------------------------------------
   6. Bank reconciliation — ported from prosesRekonsiliasiBank_()
   ------------------------------------------------------------ */
section('6. Bank reconciliation formula + matching direction');

function expectedStatementBalance(bakiLejar, depositBelumClear, bayaranBelumClear, kreditBelumDirekod, debitBelumDirekod) {
  return bakiLejar - depositBelumClear + bayaranBelumClear + kreditBelumDirekod - debitBelumDirekod;
}

// Book balance 10,000. One deposit-in-transit (RM200, a ledger debit
// not yet on the statement), one outstanding payment (RM300, a
// ledger kredit not yet on the statement). Statement has one
// unrecorded bank fee (RM15, statement debit) and one unrecorded
// interest credit (RM5, statement kredit).
var jangkaan = expectedStatementBalance(10000, 200, 300, 5, 15);
assertClose(jangkaan, 10090, 'Reconciliation formula predicts statement balance = 10,090');

var selisihOK = Math.round((10090 - jangkaan) * 100) / 100;
assert(Math.abs(selisihOK) < 0.01, 'Matches the actual statement ending balance -> selisih = 0 (berpadanan = true)');

var selisihBad = Math.round((10150 - jangkaan) * 100) / 100;
assertClose(selisihBad, 60, 'A genuine RM60 unexplained gap is surfaced as a real gap, not absorbed into the adjustment');

function matchSide(statementLine) { return statementLine.debit > 0 ? 'kredit' : 'debit'; }
assert(matchSide({ debit: 300, kredit: 0 }) === 'kredit', 'Statement debit (money out) is matched against ledger KREDIT — not debit-to-debit');
assert(matchSide({ debit: 0, kredit: 200 }) === 'debit', 'Statement kredit (money in) is matched against ledger DEBIT — not kredit-to-kredit');

/* ------------------------------------------------------------
   7. Floating-point safety in currency comparisons
   ------------------------------------------------------------ */
section('7. Floating-point safety');
var classicFloatBug = 0.1 + 0.2; // canonical JS float artefact
assert(classicFloatBug !== 0.3, 'Raw JS float addition (0.1+0.2) is NOT exactly 0.3 (got ' + classicFloatBug + ') — the same risk applies to any raw decimal currency sum');
assert(Math.round((classicFloatBug - 0.3) * 100) === 0, "The codebase's own Math.round(x*100) pattern correctly treats it as equal anyway — this is why every debit/kredit check in the .gs files uses that pattern instead of ===");

/* ------------------------------------------------------------ */
section('RESULT');
console.log(pass + ' passed, ' + fail + ' failed.');
if (fail > 0) { console.log('FAILURES:', failures); process.exitCode = 1; }
