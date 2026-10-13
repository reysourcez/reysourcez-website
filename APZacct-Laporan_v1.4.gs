// APZacct release 1.4 - file APZacct-Laporan_v1.4.gs (renamed with the release number, version constant added, no logic change)
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_LAPORAN). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — Laporan (Print, Diagnose, AI Summary)
 * ---------------------------------------------------
 * v1.2 - file-name and summary dates use the Tetapan!C23 time zone (zonMasaAPZ_ / hariIniAPZ_ in APZacct-WebAPI_v1.4.gs v1.7).
 *
 * v1.1 — janaRingkasanAI's Gemini call updated from
 * gemini-2.0-flash to gemini-3.1-flash-lite. gemini-2.0-flash (and
 * 2.0-flash-lite) were shut down by Google on 1 June 2026 — every
 * request to the old name now 404s. gemini-3.1-flash-lite is Google's
 * own suggested replacement in that same deprecation notice, and is
 * plenty for a one-shot 150-200 word summary (no vision/tools needed
 * here). The v1beta/models/...:generateContent endpoint itself is
 * still fully supported — Google's newer "Interactions API" is now
 * the recommended default for new projects, but migrating to it buys
 * nothing for this single-turn use case, so this stays on
 * generateContent. Everything else in this file is unchanged from the
 * version already in the project. If Google retires this model name
 * too, the error path below now names the changelog to check instead
 * of just failing silently.
 *
 * Three menu functions:
 *
 * 1. Cetak Penyata Kewangan (cetakPenyataKewangan)
 *    Exports the "Cetak" sheet — which live-mirrors KKK/UR/APK/AT via
 *    formulas, so it always shows current numbers — as one PDF, saved
 *    to a Drive folder. Only exports that one sheet by its gid; never
 *    touches the visibility or order of any other sheet, so there's
 *    nothing to accidentally leave in a broken state.
 *
 * 2. Diagnosis Ketidakseimbangan (diagnosisKetidakseimbangan)
 *    If Imbangan_Duga isn't SEIMBANG, walks the same checks done by
 *    hand throughout this build: does every individual transaction's
 *    own debit equal its own credit, does every Kod Akaun in
 *    Baris_Transaksi actually exist in Akaun, is every Transaksi
 *    header matched by at least one real line and vice versa. Fully
 *    deterministic — no AI call, so no risk of it guessing wrong.
 *
 * 3. Jana Ringkasan AI (janaRingkasanAI)
 *    Sends the current UR/KKK/AT totals to Gemini and asks for a
 *    150-200 word Bahasa Malaysia summary suitable for a Lembaga
 *    meeting, then writes it into Cetak's reserved AI section (A6:B11)
 *    so it becomes part of the printed document. Needs a
 *    GEMINI_API_KEY script property (Project Settings > Script
 *    Properties).
 *
 * SETUP: Extensions > Apps Script > paste alongside your other
 * APZacct scripts > Save > reload the sheet.
 */
const APZ_VER_LAPORAN = '1.4';

// ================= 1. PRINTER =================

function cetakPenyataKewangan() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const cetak = ss.getSheetByName('Cetak');
  if (!cetak) { ui.alert('RALAT: helaian "Cetak" tidak dijumpai.'); return; }

  try {
    const gid = cetak.getSheetId();
    const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() +
      '/export?format=pdf&gid=' + gid +
      '&portrait=true&fitw=true&gridlines=false&printtitle=false&sheetnames=false' +
      '&top_margin=0.5&bottom_margin=0.5&left_margin=0.5&right_margin=0.5';
    const token = ScriptApp.getOAuthToken();
    const response = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token } });

    const namaKoperasi = ss.getSheetByName('Tetapan').getRange('C5').getValue() || 'Koperasi';
    const tarikh = hariIniAPZ_();
    const fileName = namaKoperasi + ' - Penyata Kewangan - ' + tarikh + '.pdf';

    const folderName = 'APZacct - Penyata Kewangan';
    const folders = DriveApp.getFoldersByName(folderName);
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
    const pdfBlob = response.getBlob().setName(fileName);
    const file = folder.createFile(pdfBlob);

    ui.alert('Berjaya!\n\nFail: ' + fileName + '\n\nLink: ' + file.getUrl());
  } catch (err) {
    ui.alert('RALAT semasa jana PDF: ' + err.message);
  }
}

// ================= 2. DIAGNOSIS =================

function diagnosisKetidakseimbangan() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const idg = ss.getSheetByName('Imbangan_Duga');
  const akaun = ss.getSheetByName('Akaun');
  const bt = ss.getSheetByName('Baris_Transaksi');
  const tx = ss.getSheetByName('Transaksi');

  const semakanRow = findRowByLabel_(idg, 'Semakan:');
  const status = semakanRow ? idg.getRange(semakanRow, 2).getValue() : null;

  if (status === 'SEIMBANG') {
    ui.alert('Imbangan Duga SEIMBANG. Tiada masalah dikesan.');
    return;
  }

  const findings = [];

  const akaunCodes = {};
  const akLast = akaun.getLastRow();
  akaun.getRange(5, 1, Math.max(akLast - 4, 0), 1).getValues().forEach(function (r) {
    if (r[0] !== '' && r[0] !== null) akaunCodes[String(r[0])] = true;
  });

  const btLast = bt.getLastRow();
  const btData = bt.getRange(5, 1, Math.max(btLast - 4, 0), 6).getValues();
  const byTx = {};
  btData.forEach(function (row, i) {
    const rowNum = 5 + i;
    const idTx = row[1], kod = row[2], debit = Number(row[3]) || 0, kredit = Number(row[4]) || 0;
    if (!idTx && !kod && !debit && !kredit) return;

    if (!byTx[idTx]) byTx[idTx] = { debit: 0, kredit: 0, rows: [] };
    byTx[idTx].debit += debit;
    byTx[idTx].kredit += kredit;
    byTx[idTx].rows.push(rowNum);

    if (kod === '' || kod === null) {
      if (debit || kredit) findings.push('Baris ' + rowNum + ' (Baris_Transaksi): ada jumlah tapi Kod Akaun kosong.');
    } else if (!akaunCodes[String(kod)]) {
      findings.push('Baris ' + rowNum + ' (Baris_Transaksi): Kod Akaun ' + kod + ' tidak wujud dalam Akaun \u2014 semak salah taip.');
    }
  });

  Object.keys(byTx).forEach(function (idTx) {
    const g = byTx[idTx];
    if (Math.round((g.debit - g.kredit) * 100) !== 0) {
      findings.push('Transaksi ' + idTx + ' (baris ' + g.rows.join(', ') + '): debit RM' + g.debit.toFixed(2) + ' tidak sama dengan kredit RM' + g.kredit.toFixed(2) + '.');
    }
  });

  const txLast = tx.getLastRow();
  const txIds = tx.getRange(5, 1, Math.max(txLast - 4, 0), 1).getValues().flat().filter(String);
  const txIdSet = {};
  txIds.forEach(function (id) { txIdSet[id] = true; });

  txIds.forEach(function (id) {
    if (!byTx[id]) findings.push('Transaksi ' + id + ' ada di helaian Transaksi tapi tiada baris langsung di Baris_Transaksi.');
  });
  Object.keys(byTx).forEach(function (idTx) {
    if (!txIdSet[idTx]) findings.push('Transaksi ' + idTx + ' ada baris di Baris_Transaksi tapi tiada di helaian Transaksi.');
  });

  if (!findings.length) {
    ui.alert('Imbangan Duga tidak seimbang, tetapi semakan automatik ini tidak jumpa punca jelas. Semak manual: mungkin ada nilai ditaip terus ke Imbangan_Duga (patut formula sahaja), atau julat formula (baris 5-500) sudah tak cukup luas untuk bilangan baris sebenar.');
    return;
  }

  ui.alert('DIJUMPAI ' + findings.length + ' ISU:\n\n' + findings.join('\n\n'));
}

function findRowByLabel_(sheet, label) {
  const lastRow = sheet.getLastRow();
  const vals = sheet.getRange(1, 1, lastRow, 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim() === label) return i + 1;
  }
  return null;
}

// ================= 3. AI BOARD SUMMARY =================

// NEW in v1.1 — pulled out as a constant so the next time Google
// retires a model name, this is the one line to change, and the
// changelog to check is named right here instead of buried in a
// deep comment.
// Check https://ai.google.dev/gemini-api/docs/changelog if this ever
// starts 404-ing again.
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

function janaRingkasanAI() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    ui.alert('RALAT: sila set GEMINI_API_KEY dahulu.\n\nProject Settings (ikon gear di kiri) > Script Properties > Add script property > nama: GEMINI_API_KEY, nilai: kunci API Gemini anda.');
    return;
  }

  const ur = ss.getSheetByName('UR');
  const kkk = ss.getSheetByName('KKK');
  const at = ss.getSheetByName('AT');
  const cetak = ss.getSheetByName('Cetak');

  const angka = {
    jumlahHasil: safeVal_(ur, 'JUMLAH HASIL'),
    jumlahPerbelanjaan: safeVal_(ur, 'JUMLAH PERBELANJAAN OPERASI'),
    lebihanBersih: safeVal_(ur, 'LEBIHAN BERSIH (SURPLUS) - SEBELUM PEMBAHAGIAN'),
    jumlahAset: safeVal_(kkk, 'JUMLAH ASET'),
    jumlahLiabiliti: safeVal_(kkk, 'JUMLAH LIABILITI'),
    jumlahEkuiti: safeVal_(kkk, 'JUMLAH EKUITI AHLI'),
    tunaiOperasi: safeVal_(at, 'TUNAI BERSIH DARIPADA OPERASI')
  };

  const prompt =
    'Anda seorang penasihat kewangan koperasi Malaysia. Berdasarkan angka berikut bagi satu koperasi, ' +
    'tulis ringkasan kedudukan kewangan sepanjang 150-200 patah perkataan dalam Bahasa Malaysia, sesuai ' +
    'untuk dibentangkan kepada Lembaga Koperasi. Nyatakan kedudukan semasa secara neutral dan faktual, ' +
    'senaraikan mana-mana angka yang wajar diberi perhatian (cth. liabiliti tinggi berbanding aset, atau ' +
    'tunai operasi negatif), dan JANGAN buat kesimpulan tentang trend kerana ini snapshot satu tempoh sahaja, ' +
    'bukan siri masa berbanding tempoh lepas.\n\n' +
    'Jumlah Hasil: RM' + angka.jumlahHasil + '\n' +
    'Jumlah Perbelanjaan Operasi: RM' + angka.jumlahPerbelanjaan + '\n' +
    'Lebihan Bersih: RM' + angka.lebihanBersih + '\n' +
    'Jumlah Aset: RM' + angka.jumlahAset + '\n' +
    'Jumlah Liabiliti: RM' + angka.jumlahLiabiliti + '\n' +
    'Jumlah Ekuiti Ahli: RM' + angka.jumlahEkuiti + '\n' +
    'Tunai Bersih daripada Aktiviti Operasi: RM' + angka.tunaiOperasi;

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent?key=' + apiKey;
  const payload = { contents: [{ parts: [{ text: prompt }] }] };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const data = JSON.parse(response.getContentText());
    if (data.error) {
      ui.alert(
        'RALAT Gemini: ' + data.error.message +
        '\n\nJika ini ralat "model not found" atau 404, model "' + GEMINI_MODEL + '" mungkin sudah dihentikan. ' +
        'Semak https://ai.google.dev/gemini-api/docs/changelog untuk nama model semasa, tukar pemalar ' +
        'GEMINI_MODEL di atas fail ini, dan Deploy > Manage deployments > New version jika fail ini bahagian ' +
        'daripada Web App yang sudah dideploy.'
      );
      return;
    }

    const ringkasan = data.candidates[0].content.parts[0].text;
    const tarikh = Utilities.formatDate(new Date(), zonMasaAPZ_(), 'd MMMM yyyy');
    cetak.getRange('A6').setValue(ringkasan + '\n\n(Dijana AI pada ' + tarikh + ' \u2014 semak sebelum bentang, bukan pengganti pertimbangan Lembaga.)');

    ui.alert('Ringkasan dijana dan disimpan di Cetak!A6. Semak dan edit sebelum mesyuarat jika perlu \u2014 ini cadangan AI, bukan kata muktamad.');
  } catch (err) {
    ui.alert('RALAT: ' + err.message);
  }
}

function safeVal_(sheet, label) {
  const row = findRowByLabel_(sheet, label);
  if (!row) return '(tidak dijumpai: ' + label + ')';
  const v = sheet.getRange(row, 2).getValue();
  return (typeof v === 'number') ? v.toFixed(2) : v;
}
