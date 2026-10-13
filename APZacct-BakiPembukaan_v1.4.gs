// APZacct release 1.4 - file APZacct-BakiPembukaan_v1.4.gs (renamed with the release number, version constant added, no logic change)
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_BAKIPEMBUKAAN). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — Pos Baki Pembukaan (Post Opening Balances)
 * ---------------------------------------------------
 * v1.1 (this file) — posBakiPembukaan() now also writes every line it
 * posts into a new "Sejarah_Baki" sheet (created automatically on
 * first use), tagged with the fiscal year those figures CLOSE OUT.
 * Example: posting 2026's opening balances on 2026-01-01 archives
 * those same figures as "2025 closing" — because numerically, this
 * year's opening IS last year's closing.
 *
 * This is what makes a real year-over-year KKK column possible: KKK's
 * own formulas only ever look at Imbangan_Duga's LIVE current
 * balances, so there was nowhere to pull "as at last year-end" from
 * until now. See the accompanying guidance for the exact formulas to
 * paste into a new KKK column C ("Tahun Lepas") once this has run at
 * least once — that part is a manual, reviewable paste, not something
 * this script touches automatically, since inserting into a live
 * financial statement sheet blind is exactly the kind of change that
 * should be seen before it's trusted.
 *
 * Everything else below — validation, the confirmation prompt, the
 * Tetapan!C18 fix, the CONTOH- cleanup offer — is unchanged from the
 * version already in the project.
 *
 * SETUP: Extensions > Apps Script > paste alongside your other
 * APZacct scripts > Save > reload the sheet.
 */
const APZ_VER_BAKIPEMBUKAAN = '1.4';

function posBakiPembukaan() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bp = ss.getSheetByName('Baki_Pembukaan');
  const akaun = ss.getSheetByName('Akaun');
  const tx = ss.getSheetByName('Transaksi');
  const bt = ss.getSheetByName('Baris_Transaksi');
  const tetapan = ss.getSheetByName('Tetapan');

  const existingId = tetapan.getRange('C18').getValue();
  if (existingId && String(existingId).indexOf('CONTOH') === -1) {
    const sudahAda = ui.alert(
      'AMARAN',
      'Tetapan!C18 sudah ada ID transaksi baki pembukaan (' + existingId + ') yang bukan data contoh. ' +
      'Ini nampak macam sudah pernah dipos. Teruskan dan pos SATU LAGI set baki pembukaan?',
      ui.ButtonSet.YES_NO
    );
    if (sudahAda !== ui.Button.YES) return;
  }

  const akLast = akaun.getLastRow();
  const akData = akaun.getRange(5, 1, Math.max(akLast - 4, 0), 4).getValues(); // Kod, NamaEN, NamaBM, Jenis
  const akMap = {};
  akData.forEach(function (r) { if (r[0] !== '' && r[0] !== null) akMap[String(r[0])] = { nama: r[2], jenis: r[3] }; });

  const bpData = bp.getRange(5, 1, 50, 5).getValues(); // Kod, NamaAuto, JenisAuto, Debit, Kredit
  const lines = [];
  const errors = [];
  let totalDebit = 0, totalKredit = 0;

  bpData.forEach(function (row, i) {
    const rowNum = 5 + i;
    const kod = row[0], debit = Number(row[3]) || 0, kredit = Number(row[4]) || 0;
    if (!kod && !debit && !kredit) return;
    if (!kod) { errors.push('Baris ' + rowNum + ': jumlah diisi tapi Kod Akaun kosong.'); return; }
    const info = akMap[String(kod)];
    if (!info) { errors.push('Baris ' + rowNum + ': Kod Akaun ' + kod + ' tidak wujud dalam Akaun.'); return; }
    if (info.jenis === 'Hasil' || info.jenis === 'Perbelanjaan') {
      errors.push('Baris ' + rowNum + ': ' + info.nama + ' ialah akaun ' + info.jenis + ' — tidak patut ada baki pembukaan, ia bermula sifar setiap tahun.');
      return;
    }
    if (debit && kredit) { errors.push('Baris ' + rowNum + ': isi Debit ATAU Kredit sahaja, bukan kedua-dua.'); return; }
    if (!debit && !kredit) { errors.push('Baris ' + rowNum + ': Kod Akaun diisi tapi tiada jumlah.'); return; }
    totalDebit += debit;
    totalKredit += kredit;
    lines.push({ kod: kod, debit: debit, kredit: kredit, nama: info.nama });
  });

  if (errors.length) {
    ui.alert('RALAT — betulkan dahulu:\n\n' + errors.join('\n'));
    return;
  }
  if (!lines.length) {
    ui.alert('Tiada baris diisi di Baki_Pembukaan.');
    return;
  }
  if (Math.round((totalDebit - totalKredit) * 100) !== 0) {
    ui.alert('RALAT: jumlah Debit (RM' + totalDebit.toFixed(2) + ') tidak sama dengan jumlah Kredit (RM' + totalKredit.toFixed(2) + ').');
    return;
  }

  const tarikhResp = ui.prompt(
    'Tarikh Baki Pembukaan',
    'Tarikh permulaan tahun kewangan ini (format: YYYY-MM-DD), cth. 2026-01-01:',
    ui.ButtonSet.OK_CANCEL
  );
  if (tarikhResp.getSelectedButton() !== ui.Button.OK) return;
  const tarikh = tarikhResp.getResponseText().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarikh)) {
    ui.alert('RALAT: format tarikh mesti YYYY-MM-DD.');
    return;
  }

  const ringkasan = lines.map(function (l) {
    return l.nama + ': ' + (l.debit ? 'Debit RM' + l.debit.toFixed(2) : 'Kredit RM' + l.kredit.toFixed(2));
  }).join('\n');
  const sahkan = ui.alert(
    'Sahkan Sebelum Pos',
    'Ini akan pos SATU transaksi dengan ' + lines.length + ' baris, bertarikh ' + tarikh + ':\n\n' + ringkasan +
    '\n\nJumlah: RM' + totalDebit.toFixed(2) + '\n\nTeruskan?',
    ui.ButtonSet.YES_NO
  );
  if (sahkan !== ui.Button.YES) return;

  const newTxId = nextId_(tx, 1, 'T-');
  const txRow = findFirstBlankRow_(tx, 1);
  tx.getRange(txRow, 1, 1, 7).setValues([[newTxId, tarikh, 'Baki pembukaan tahun kewangan (audited)', 'BA-' + tarikh.slice(0, 4), 'Bank', 'Disahkan', '']]);

  let btRow = findFirstBlankRow_(bt, 2);
  let lineCounter = lastLineNumber_(bt);
  lines.forEach(function (l) {
    lineCounter += 1;
    const lineId = 'L-' + String(lineCounter).padStart(3, '0');
    bt.getRange(btRow, 1, 1, 6).setValues([[lineId, newTxId, Number(l.kod), l.debit, l.kredit, 'Baki pembukaan']]);
    bt.getRange(btRow, 7).setFormula('=IF(C' + btRow + '="","",INDEX(Akaun!$F$5:$F$150,MATCH(C' + btRow + ',Akaun!$A$5:$A$150,0)))');
    btRow += 1;
  });

  tetapan.getRange('C18').setValue(newTxId);

  // NEW in v1.1 — archive these same lines as "closing balance for
  // the year before this opening date" so a future KKK column can
  // read real history instead of nothing.
  arkibkanBakiPenutup_(ss, lines, tarikh);

  const bersihkan = ui.alert(
    'Berjaya Dipos!',
    'ID Transaksi: ' + newTxId + '. Tetapan!C18 dikemaskini supaya Aliran Tunai kecualikan baki ini daripada aktiviti tempoh semasa dengan betul. ' +
    'Angka yang sama juga diarkibkan di helaian Sejarah_Baki untuk sokong perbandingan tahun-ke-tahun kelak.\n\n' +
    'Padam SEMUA baris CONTOH- (data demo) sekarang juga? (Disyorkan — data sebenar dan data contoh tidak patut wujud bersama.)',
    ui.ButtonSet.YES_NO
  );
  if (bersihkan === ui.Button.YES) {
    padamDataContoh_(tx, bt);
    ui.alert('Data CONTOH- dipadam. Baki pembukaan sebenar kini satu-satunya data dalam lejar.');
  }
}

// NEW in v1.1 — one row per account per fiscal year, in
// Sejarah_Baki: Tahun | Kod Akaun | Nama Akaun | Debit | Kredit.
// Creates the sheet with a header row on first use. Purely additive —
// never reads or changes anything outside this one new sheet.
function arkibkanBakiPenutup_(ss, lines, tarikhPembukaan) {
  let sejarah = ss.getSheetByName('Sejarah_Baki');
  if (!sejarah) {
    sejarah = ss.insertSheet('Sejarah_Baki');
    sejarah.appendRow(['Tahun (baki ditutup)', 'Kod Akaun', 'Nama Akaun', 'Debit', 'Kredit']);
    sejarah.getRange(1, 1, 1, 5).setFontWeight('bold');
  }
  const tahunDitutup = Number(tarikhPembukaan.slice(0, 4)) - 1;
  const rows = lines.map(function (l) {
    return [tahunDitutup, Number(l.kod), l.nama, l.debit, l.kredit];
  });
  sejarah.getRange(sejarah.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
}

function padamDataContoh_(tx, bt) {
  [tx, bt].forEach(function (sheet) {
    const lastRow = sheet.getLastRow();
    for (let r = lastRow; r >= 5; r--) {
      const idCol = sheet.getName() === 'Transaksi' ? 1 : 2;
      const val = sheet.getRange(r, idCol).getValue();
      if (String(val).indexOf('CONTOH') === 0) {
        sheet.deleteRow(r);
      }
    }
  });
}

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
