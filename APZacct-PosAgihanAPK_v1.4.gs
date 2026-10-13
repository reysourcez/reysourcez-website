// APZacct release 1.4 - file APZacct-PosAgihanAPK_v1.4.gs (renamed with the release number, version constant added, no logic change)
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_POSAGIHANAPK). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — Pos Agihan APK (Post APK's Approved Distribution)
 * ---------------------------------------------------
 * v1.1 - HARD STOP when the current period has no surplus. Before anything else posAgihanAPK() reads UR's
 * 'LEBIHAN BERSIH (SURPLUS) - SEBELUM PEMBAHAGIAN' and, if it is zero or negative, refuses to post ANY statutory
 * distribution (rizab, KWA, cukai, zakat, honorarium, dividen). Unlike this project's other guards there is
 * deliberately NO 'teruskan juga' button. Scope: current-period surplus only - it does not look at the accumulated
 * balance in Lebihan Terkumpul (3030); a cooperative recovering from an old deficit is not caught. The message
 * cites no specific Akta subsection (the exact numbering could not be re-confirmed). Source rebuilt 2026-09-29
 * from the dossier spec because the v1.1 file was missing from the project folder; offline-tested with a mock.
 *
 * v1.0 (new this round). Replaces the manual step where someone
 * re-types APK's board-approved figures as a journal entry after the
 * meeting. Reads APK's own cells directly and posts exactly what its
 * own Nota (bottom of the APK sheet) already specifies:
 *   Debit Lebihan Terkumpul (3030) for the total approved,
 *   Credit each relevant liability account for its share.
 *
 * Only includes a credit line for a bucket that's actually non-zero —
 * if the board didn't declare a dividend this year, there's no
 * dividend line in the posted transaction.
 *
 * IMPORTANT — five of the seven target accounts (2070 Cukai Belum
 * Dibayar, 2080 Zakat Belum Dibayar, 2090 Honorarium Belum Dibayar,
 * 2100 KWA Pendidikan Belum Dibayar, 2110 KWA Pembangunan Belum
 * Dibayar) do not exist in the sample Akaun sheet yet — only 2020 and
 * 3020/3030 currently do. This function checks every target account
 * exists BEFORE writing anything, and tells you exactly which ones to
 * create via Tambah Akaun (all five as Liabiliti) if any are missing,
 * rather than posting a partial, unbalanceable transaction.
 *
 * One more one-time step this doesn't do automatically, on purpose:
 * once those five accounts exist, KKK's LIABILITI section (currently
 * only listing Pelbagai Pemiutang and Dividen Diisytiharkan by name)
 * won't show them as named rows until you add one, matching the
 * existing pattern exactly:
 *   =SUMIF(Imbangan_Duga!$A$5:$A$150,2070,Imbangan_Duga!$H$5:$H$150)
 * (swap 2070 for each new code). JUMLAH LIABILITI (currently
 * =SUMIF(Imbangan_Duga!$C$5:$C$150,"Liabiliti",...) ) already totals
 * correctly either way — this is purely about the named breakdown
 * being visible, not about the math being right. Inserting new rows
 * into a live financial statement is exactly the kind of change
 * that's safer done by hand than scripted blind.
 *
 * SETUP: Extensions > Apps Script > paste alongside your other
 * APZacct scripts > Save > reload the sheet.
 */
const APZ_VER_POSAGIHANAPK = '1.4';

const APK_DEBIT_KOD = 3030; // Lebihan Terkumpul
const APK_DISTRIBUTION_LINES = [
  { row: 7, kod: 3020, nama: 'Kumpulan Wang Rizab Statutori' },
  { row: 8, kod: 2100, nama: 'KWA Pendidikan Koperasi Belum Dibayar' },
  { row: 9, kod: 2110, nama: 'KWA Pembangunan Koperasi Belum Dibayar' },
  { row: 15, kod: 2070, nama: 'Cukai Pendapatan Belum Dibayar' },
  { row: 16, kod: 2080, nama: 'Zakat Belum Dibayar' },
  { row: 22, kod: 2090, nama: 'Honorarium Lembaga Belum Dibayar' }
];
const APK_DIVIDEN_ROWS = [20, 21]; // Modal Syer + Modal Yuran — both close into the same liability
const APK_DIVIDEN_KOD = 2020; // Dividen Diisytiharkan — already exists in Akaun

function posAgihanAPK() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const apk = ss.getSheetByName('APK');
  const akaun = ss.getSheetByName('Akaun');
  const tx = ss.getSheetByName('Transaksi');
  const bt = ss.getSheetByName('Baris_Transaksi');
  if (!apk) { ui.alert('RALAT: helaian "APK" tidak dijumpai.'); return; }

  // v1.1 - hard stop: no statutory distribution when there is no current-period surplus
  const lebihan = bacaLebihanBersihUR_(ss.getSheetByName('UR'));
  if (!lebihan.ok) { ui.alert('RALAT - tidak dapat semak Lebihan Bersih, jadi tiada apa dipos:\n\n' + lebihan.sebab); return; }
  if (Math.round(lebihan.nilai * 100) <= 0) {
    ui.alert('TIADA AGIHAN DIBENARKAN\n\nLebihan Bersih tempoh semasa (UR) ialah RM' + lebihan.nilai.toFixed(2) +
      ' - sifar atau negatif. Agihan berkanun (rizab, KWA, cukai, zakat, honorarium, dividen) tidak boleh dipos apabila tiada lebihan. ' +
      'Semak UR dan transaksi tempoh ini dahulu. Jika ada keadaan khas, rujuk juruaudit atau SKM - menu ini sengaja tiada butang "teruskan juga".');
    return;
  }

  const creditLines = [];
  APK_DISTRIBUTION_LINES.forEach(function (item) {
    const amt = Number(apk.getRange(item.row, 2).getValue()) || 0;
    if (Math.round(amt * 100) !== 0) creditLines.push({ kod: item.kod, amaun: amt, nama: item.nama });
  });
  const dividenTotal = APK_DIVIDEN_ROWS.reduce(function (sum, r) {
    return sum + (Number(apk.getRange(r, 2).getValue()) || 0);
  }, 0);
  if (Math.round(dividenTotal * 100) !== 0) {
    creditLines.push({ kod: APK_DIVIDEN_KOD, amaun: dividenTotal, nama: 'Dividen Diisytiharkan' });
  }

  if (!creditLines.length) {
    ui.alert('Tiada apa-apa untuk diagihkan \u2014 semua baris pembahagian di helaian APK (baris 7-9, 15-16, 20-22) masih sifar. Isi keputusan Lembaga di lajur kuning APK dahulu.');
    return;
  }

  const totalAgihan = creditLines.reduce(function (sum, l) { return sum + l.amaun; }, 0);

  // validate every account this is about to touch actually exists —
  // fail safely rather than post a line against a code that doesn't exist
  const akLast = akaun.getLastRow();
  const akCodes = {};
  akaun.getRange(5, 1, Math.max(akLast - 4, 0), 1).getValues().forEach(function (r) {
    if (r[0] !== '' && r[0] !== null) akCodes[Number(r[0])] = true;
  });
  const missing = [];
  if (!akCodes[APK_DEBIT_KOD]) missing.push(APK_DEBIT_KOD + ' (Lebihan Terkumpul)');
  creditLines.forEach(function (l) { if (!akCodes[l.kod]) missing.push(l.kod + ' (' + l.nama + ')'); });
  if (missing.length) {
    ui.alert(
      'RALAT \u2014 akaun berikut belum wujud dalam Akaun, jadi tiada apa dipos:\n\n' + missing.join('\n') +
      '\n\nGuna APZacct > Tambah Akaun untuk cipta setiap satu sebagai Liabiliti dahulu, kemudian cuba Pos Agihan APK semula.'
    );
    return;
  }

  const tarikhResp = ui.prompt(
    'Tarikh Agihan APK',
    'Tarikh keputusan Lembaga/AGM meluluskan agihan ini (format: YYYY-MM-DD):',
    ui.ButtonSet.OK_CANCEL
  );
  if (tarikhResp.getSelectedButton() !== ui.Button.OK) return;
  const tarikh = tarikhResp.getResponseText().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tarikh)) { ui.alert('RALAT: format tarikh mesti YYYY-MM-DD.'); return; }

  const ringkasan = creditLines.map(function (l) { return l.nama + ' (' + l.kod + '): RM' + l.amaun.toFixed(2); }).join('\n');
  const sahkan = ui.alert(
    'Sahkan Sebelum Pos',
    'Debit Lebihan Terkumpul (3030): RM' + totalAgihan.toFixed(2) + '\n\nKredit:\n' + ringkasan +
    '\n\nPastikan ini dipos SELEPAS Lembaga/AGM benar-benar luluskan angka di helaian APK, bukan sebelum. Teruskan?',
    ui.ButtonSet.YES_NO
  );
  if (sahkan !== ui.Button.YES) return;

  const newTxId = nextId_(tx, 1, 'T-');
  const txRow = findFirstBlankRow_(tx, 1);
  tx.getRange(txRow, 1, 1, 7).setValues([[newTxId, tarikh, 'Agihan APK diluluskan Lembaga/AGM', 'APK-' + tarikh.slice(0, 4), 'Jurnal', 'Disahkan', '']]);

  let lineCounter = lastLineNumber_(bt);
  let btRow = findFirstBlankRow_(bt, 2);

  lineCounter += 1;
  bt.getRange(btRow, 1, 1, 6).setValues([['L-' + String(lineCounter).padStart(3, '0'), newTxId, APK_DEBIT_KOD, totalAgihan, 0, 'Agihan APK \u2014 debit']]);
  btRow += 1;

  creditLines.forEach(function (l) {
    lineCounter += 1;
    bt.getRange(btRow, 1, 1, 6).setValues([['L-' + String(lineCounter).padStart(3, '0'), newTxId, l.kod, 0, l.amaun, 'Agihan APK \u2014 ' + l.nama]]);
    btRow += 1;
  });

  ui.alert('Berjaya dipos! ID Transaksi: ' + newTxId + '.\n\nSemak Imbangan Duga masih tunjuk SEIMBANG selepas ini, dan jalankan Diagnosis Ketidakseimbangan jika tidak.');
}

// v1.1 - reads UR's current-period surplus by its label (robust to inserted rows). Returns { ok, nilai } or { ok:false, sebab }.
function bacaLebihanBersihUR_(ur) {
  const label = 'LEBIHAN BERSIH (SURPLUS) - SEBELUM PEMBAHAGIAN';
  if (!ur) return { ok: false, sebab: 'Helaian "UR" tidak dijumpai.' };
  const kolA = ur.getRange(1, 1, ur.getLastRow(), 1).getValues();
  for (let i = 0; i < kolA.length; i++) {
    if (String(kolA[i][0]).trim() === label) {
      const v = ur.getRange(i + 1, 2).getValue();
      return (typeof v === 'number') ? { ok: true, nilai: v } : { ok: false, sebab: 'Nilai Lebihan Bersih di UR bukan nombor (' + v + ').' };
    }
  }
  return { ok: false, sebab: 'Baris "' + label + '" tidak dijumpai dalam UR.' };
}
