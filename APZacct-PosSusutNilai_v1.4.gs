// APZacct release 1.4 - file APZacct-PosSusutNilai_v1.4.gs (renamed with the release number, version constant added, no logic change)
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_POSSUSUTNILAI). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — Pos Susut Nilai (Post Depreciation)
 * ---------------------------------------------------
 * v1.0 (new). Daftar_Aset_Tetap already CALCULATES every asset's
 * current-year depreciation (its own column K, via straight-line or
 * declining-balance formulas — both verified correct in the engine
 * audit) the moment an asset is registered. Nothing has ever POSTED
 * that figure into the ledger: Susut Nilai Aset (5160) sits at RM0 in
 * UR and Susut Nilai Terkumpul (1045) sits at RM0 in KKK regardless
 * of what the register shows, until this runs.
 *
 * Under MPERS (Section 17) — which is the base standard GP23 sits on
 * top of for an ordinary, non-PIE cooperative — depreciation is
 * simply a P&L expense with a matching contra-asset; GP23 itself adds
 * nothing method-specific, only where it has to appear: as an expense
 * in UR, netted against cost in KKK, and (separately, not built here)
 * as a per-category cost/accumulated-depreciation/NBV movement
 * schedule in the Notes to Accounts.
 *
 * Reads Daftar_Aset_Tetap's own column K for every row with a
 * registered asset, sums it, and posts ONE transaction: Debit Susut
 * Nilai Aset (5160), Credit Susut Nilai Terkumpul (1045) — same
 * "one aggregate line per bucket, full breakdown in the confirmation
 * dialog" pattern posAgihanAPK already uses, not one line per asset.
 *
 * GUARD AGAINST DOUBLE-POSTING, same pattern as posBakiPembukaan's
 * Tetapan!C18 check: Tetapan!C22 ("Tahun Kewangan Susut Nilai
 * Terakhir Dipos") records which fiscal year was last posted here.
 * Running it again for the SAME year warns and asks for confirmation
 * rather than blocking outright — the same warning-over-hard-lock
 * philosophy as Log_Perubahan and Lindungi Helaian elsewhere in this
 * project.
 *
 * IMPORTANT — column K computes "this year's depreciation" by
 * comparing accumulated depreciation as of TODAY() against accumulated
 * depreciation one year before TODAY(). That means the figure this
 * reads depends on WHEN you run it, not a fixed period-end date. Run
 * this AT or right after your actual fiscal year-end — not mid-year,
 * not long after — or the amount posted won't match that period's
 * true depreciation. (Making K a fixed-period-end calculation instead
 * of a TODAY()-based one is a separate, worthwhile follow-up once
 * Daftar_Aset_Tetap gets its own real usage.)
 *
 * ONE-TIME MANUAL STEP: add row 22 to Tetapan — label "Tahun Kewangan
 * Susut Nilai Terakhir Dipos" in column A, leave column C blank (this
 * function fills it in after the first successful post).
 *
 * SETUP: Extensions > Apps Script > paste alongside your other
 * APZacct scripts > Save > reload the sheet.
 */
const APZ_VER_POSSUSUTNILAI = '1.4';

const SUSUT_NILAI_DEBIT_KOD = 5160;   // Susut Nilai Aset (expense, UR)
const SUSUT_NILAI_KREDIT_KOD = 1045;  // Susut Nilai Terkumpul - Aset Tetap (contra-asset, KKK)
const TETAPAN_TAHUN_SUSUT_NILAI_ROW = 22;

function posSusutNilai() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const daftar = ss.getSheetByName('Daftar_Aset_Tetap');
  const akaun = ss.getSheetByName('Akaun');
  const tx = ss.getSheetByName('Transaksi');
  const bt = ss.getSheetByName('Baris_Transaksi');
  const tetapan = ss.getSheetByName('Tetapan');
  if (!daftar) { ui.alert('RALAT: helaian "Daftar_Aset_Tetap" tidak dijumpai.'); return; }

  const lastRow = daftar.getLastRow();
  const numRows = Math.max(lastRow - 4, 0);
  const namaCol = daftar.getRange(5, 1, numRows, 1).getValues();
  const kCol = daftar.getRange(5, 11, numRows, 1).getValues(); // column K: Susut Nilai Tahun Ini

  const aset = [];
  kCol.forEach(function (r, i) {
    const nilai = Number(r[0]) || 0;
    if (nilai > 0 && namaCol[i][0]) aset.push({ nama: namaCol[i][0], susutNilai: nilai });
  });

  if (!aset.length) {
    ui.alert('Tiada susut nilai untuk dipos \u2014 Daftar_Aset_Tetap tiada aset dengan Susut Nilai Tahun Ini > 0. Semak Kos Asal dan Jangka Hayat setiap aset diisi.');
    return;
  }

  const jumlahSusutNilai = aset.reduce(function (sum, a) { return sum + a.susutNilai; }, 0);

  // validate both target accounts exist first — fail safely rather than post against a missing code
  const akLast = akaun.getLastRow();
  const akCodes = {};
  akaun.getRange(5, 1, Math.max(akLast - 4, 0), 1).getValues().forEach(function (r) {
    if (r[0] !== '' && r[0] !== null) akCodes[Number(r[0])] = true;
  });
  const missing = [];
  if (!akCodes[SUSUT_NILAI_DEBIT_KOD]) missing.push(SUSUT_NILAI_DEBIT_KOD + ' (Susut Nilai Aset)');
  if (!akCodes[SUSUT_NILAI_KREDIT_KOD]) missing.push(SUSUT_NILAI_KREDIT_KOD + ' (Susut Nilai Terkumpul)');
  if (missing.length) {
    ui.alert('RALAT \u2014 akaun berikut belum wujud dalam Akaun:\n\n' + missing.join('\n') + '\n\nGuna APZacct > Tambah Akaun dahulu.');
    return;
  }

  const tarikhResp = ui.prompt(
    'Tarikh & Tahun Kewangan Susut Nilai',
    'Tarikh akhir tahun kewangan yang disusut nilai ini mewakili (format: YYYY-MM-DD), cth. 2026-12-31:',
    ui.ButtonSet.OK_CANCEL
  );
  if (tarikhResp.getSelectedButton() !== ui.Button.OK) return;
  const tarikh = tarikhResp.getResponseText().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarikh)) { ui.alert('RALAT: format tarikh mesti YYYY-MM-DD.'); return; }
  const tahunKewangan = tarikh.slice(0, 4);

  const tahunTerakhirDipos = tetapan ? String(tetapan.getRange(TETAPAN_TAHUN_SUSUT_NILAI_ROW, 3).getValue() || '') : '';
  if (tahunTerakhirDipos === tahunKewangan) {
    const sudahAda = ui.alert(
      'AMARAN',
      'Susut nilai untuk tahun kewangan ' + tahunKewangan + ' nampaknya sudah pernah dipos (Tetapan!C' + TETAPAN_TAHUN_SUSUT_NILAI_ROW + '). ' +
      'Pos SEKALI LAGI untuk tahun yang sama akan double-count susut nilai. Teruskan juga?',
      ui.ButtonSet.YES_NO
    );
    if (sudahAda !== ui.Button.YES) return;
  }

  const ringkasan = aset.map(function (a) { return a.nama + ': RM' + a.susutNilai.toFixed(2); }).join('\n');
  const sahkan = ui.alert(
    'Sahkan Sebelum Pos',
    'Ini akan pos SATU transaksi bertarikh ' + tarikh + ':\n\n' +
    'Debit Susut Nilai Aset (5160): RM' + jumlahSusutNilai.toFixed(2) + '\n' +
    'Kredit Susut Nilai Terkumpul (1045): RM' + jumlahSusutNilai.toFixed(2) + '\n\n' +
    'Pecahan ikut aset:\n' + ringkasan +
    '\n\nTeruskan?',
    ui.ButtonSet.YES_NO
  );
  if (sahkan !== ui.Button.YES) return;

  const newTxId = nextId_(tx, 1, 'T-');
  const txRow = findFirstBlankRow_(tx, 1);
  tx.getRange(txRow, 1, 1, 7).setValues([[newTxId, tarikh, 'Susut nilai aset tetap tahun kewangan ' + tahunKewangan, 'SN-' + tahunKewangan, 'Jurnal', 'Disahkan', '']]);

  let lineCounter = lastLineNumber_(bt);
  let btRow = findFirstBlankRow_(bt, 2);
  lineCounter += 1;
  bt.getRange(btRow, 1, 1, 6).setValues([['L-' + String(lineCounter).padStart(3, '0'), newTxId, SUSUT_NILAI_DEBIT_KOD, jumlahSusutNilai, 0, 'Susut nilai tahun ' + tahunKewangan + ' (' + aset.length + ' aset)']]);
  btRow += 1;
  lineCounter += 1;
  bt.getRange(btRow, 1, 1, 6).setValues([['L-' + String(lineCounter).padStart(3, '0'), newTxId, SUSUT_NILAI_KREDIT_KOD, 0, jumlahSusutNilai, 'Susut nilai tahun ' + tahunKewangan + ' (' + aset.length + ' aset)']]);

  if (tetapan) tetapan.getRange(TETAPAN_TAHUN_SUSUT_NILAI_ROW, 3).setValue(tahunKewangan);

  ui.alert('Berjaya dipos! ID Transaksi: ' + newTxId + '. RM' + jumlahSusutNilai.toFixed(2) + ' susut nilai merentasi ' + aset.length + ' aset.');
}

// Deliberately local copies, matching the exact pattern already used
// in APZacct-WebAPI_v1.4.gs / APZacct-BakiPembukaan_v1.4.gs / APZacct-PosAgihanAPK_v1.4.gs
// (all three define these identically). Worth knowing: because Apps
// Script shares one namespace across every file in the project,
// having 4 identical copies now is harmless today, but if any ONE
// copy is ever edited without updating the others, whichever file
// loads last silently wins — a real, if currently dormant, risk.
// Consolidating all four into one shared file is a reasonable future
// cleanup, not done here since it means touching several already-
// deployed files at once.
function findFirstBlankRow_(sheet, checkCol) {
  const maxRow = sheet.getMaxRows();
  const vals = sheet.getRange(5, checkCol, maxRow - 4, 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (!vals[i][0]) return 5 + i;
  }
  return maxRow + 1;
}

function nextId_(sheet, col, prefix) {
  const maxRow = sheet.getMaxRows();
  const vals = sheet.getRange(5, col, maxRow - 4, 1).getValues().flat().filter(String);
  const nums = vals
    .filter(function (v) { return String(v).indexOf(prefix) === 0; })
    .map(function (v) { return parseInt(String(v).slice(prefix.length), 10); })
    .filter(function (n) { return !isNaN(n); });
  const next = nums.length ? Math.max.apply(null, nums) + 1 : 0;
  return prefix + String(next).padStart(4, '0');
}

function lastLineNumber_(bt) {
  const maxRow = bt.getMaxRows();
  const vals = bt.getRange(5, 1, maxRow - 4, 1).getValues().flat().filter(String);
  const nums = vals
    .filter(function (v) { return String(v).indexOf('L-') === 0; })
    .map(function (v) { return parseInt(String(v).slice(2), 10); })
    .filter(function (n) { return !isNaN(n); });
  return nums.length ? Math.max.apply(null, nums) : 0;
}
