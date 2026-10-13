// APZacct release 1.4 - file APZacct-WebAPI_v1.4.gs (documents phase 1: optional body.dokumen (PV/Resit from the same entry), split lines, Pihak list + versi in doGet, dokumen_* actions)
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_WEBAPI). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — Web API (doGet / doPost)
 * ---------------------------------------------------
 * v1.4 RELEASE (this file) - documents phase 1. doGet now also returns versi (the backend release, so the pages can warn about a stale deployment) and pihak (active parties).
 * doPost accepts an optional body.dokumen ({ jenis PV|RT, akaunWang, pihak, butiran, rujukanLuar, dikeluarkanOleh, direkodOleh, diluluskanOleh }) and more than two lines (split).
 * Inside the SAME lock it numbers the document, picks or creates the Pihak, writes the ledger rows, then Dokumen + Dokumen_Baris; after the lock the PDF is saved to Drive.
 * A post without body.dokumen behaves exactly as in 1.3 (plus a new check: negative debit/kredit are refused, as the batch path already did). New actions: dokumen_senarai,
 * dokumen_html, dokumen_pdf, dokumen_batal (APZacct-Dokumen_v1.4.gs). Bank imports (pos_kelompok) do not make documents yet.
 *
 * v1.8 - concurrency, capacity and batch posting. (1) Every ledger write now runs inside LockService.getScriptLock() (30 s wait; a busy
 * lock returns SISTEM_SIBUK instead of two requests picking the same 'next row'/ID). (2) Capacity guard: statements read Baris_Transaksi up to row
 * BT_KAPASITI_BARIS (5000); a post that would go past it is refused with KAPASITI_PENUH instead of silently dropping out of every statement.
 * (3) New action 'pos_kelompok': posts up to 500 transactions in ONE request - validated first (same rules as a single post), all-or-nothing,
 * written in two block writes, appended after the last filled row. Used by the bank-import and reconciliation pages. (4) Sheets that run out
 * of grid rows are extended automatically.
 *
 * v1.7 - date rules + time zone. (1) doPost now checks the date: must be a real YYYY-MM-DD; refused if earlier than the
 * opening-balance transaction's date (that is a previous fiscal year); if it falls on/before Tetapan!C21 (period lock) it is accepted ONLY
 * with a reason in body.sebabLewat - then Status = 'Entri Lewat' and the reason goes to Log_Perubahan. No lock set = no restriction, so
 * backfilling a new customer's history is unaffected until a lock date is set. (2) doGet also returns zonMasa (Tetapan!C23, default
 * Asia/Kuala_Lumpur) and tarikhPembukaan, and turns a real Date in Tetapan!C21 into YYYY-MM-DD (before, String(Date) made the web pages
 * flag every row). (3) Drive folders use the Tetapan time zone, not the script's.
 *
 * v1.6 — doGet's response now includes tarikhKunciTempoh,
 * read from Tetapan!C21 ("Tarikh Kunci Tempoh Kewangan"). This is a
 * date the treasurer sets once a period's Penyata Kewangan has been
 * presented to the board — anything dated on or before it has already
 * been reported. Nothing here BLOCKS posting to a locked date; this
 * only hands the date to whichever frontend wants to warn about it
 * (penyata-bank.js and rekonsiliasi-bank.js, updated alongside this
 * file, since those two — not the main wizard, which always posts
 * with today's date and has no way to backdate at all — are the only
 * places a transaction's own date is directly user-editable). Blank
 * Tetapan!C21 means no lock is set and nothing gets flagged.
 *
 * ONE-TIME MANUAL STEP: add row 21 to Tetapan — label "Tarikh Kunci
 * Tempoh Kewangan" in column A, leave column C blank until you want
 * to start using it.
 *
 * v1.5 — doPost validates that every line's Kod
 * Akaun actually EXISTS in the Akaun sheet before totalling debits/
 * credits or writing anything, using the same fail-closed pattern
 * already used by posAgihanAPK_ (PosAgihanAPK.gs) and
 * posBakiPembukaan (BakiPembukaan.gs).
 *
 * Previously doPost only checked that a Kod Akaun was a non-zero
 * NUMBER, not that it was a real, active account. In normal wizard
 * use this is low-risk (the dropdowns only ever offer real codes),
 * but this endpoint is only protected by a shared secret sitting in
 * plain view in the browser (see config.js's own header comment) —
 * not real access control — and it's also the single door every
 * OTHER posting path writes through (the OCR review-then-post flow
 * in penyata-bank.js, the reconciliation posting flow in
 * rekonsiliasi-bank.js, and the normal wizard in app.js all end up
 * calling this same doPost). A stale code from a browser tab left
 * open after an account was deactivated, or any request built
 * outside the normal wizard UI, could previously post a line against
 * a code that doesn't exist — and the only thing that would ever
 * catch it was a manual run of Diagnosis Ketidakseimbangan
 * afterward, by which point the bad line is already in the ledger.
 * This closes that gap at the point of entry instead of relying on
 * catching it after the fact. If any line's Kod Akaun doesn't exist,
 * the WHOLE request is rejected and nothing is written — same
 * all-or-nothing behaviour as the existing debit/kredit balance
 * check just below it.
 *
 * v1.4 — a failed secret check includes a safe diagnostic in the
 * error response: the length of what was received vs. what was
 * expected, and whether either has leading/trailing whitespace. It
 * NEVER echoes either actual secret value — only enough shape
 * information to tell "these are genuinely different values" apart
 * from "these look the same but one has hidden whitespace" or "the
 * deployed code still has the old value", without exposing what
 * either secret actually is.
 *
 * HOW TO USE THIS: visit your deployed URL directly in a browser tab
 * with ?secret=WHATEVER_YOU_THINK_IT_IS on the end. The JSON that
 * comes back now includes a diagnosisRahsia block. Read panjangDijangka
 * (the LIVE deployed secret's length) — if that number doesn't match
 * what you'd expect from the secret you just edited in the Apps
 * Script editor, the live deployment still has an OLDER value, which
 * means Deploy > Manage deployments > New version hasn't actually run
 * yet since your last edit. If the lengths DO match but it still
 * fails, copy-paste (don't retype) the exact secret from one file
 * into the other, to rule out a one-character typo your eyes skipped.
 *
 * Everything else in this file — routing for ocr_penyata_bank and
 * rekonsiliasi_bank, normal transaction posting, Drive foldering — is
 * unchanged from v1.4.
 *
 * doGet:  ?secret=... -> returns the active Akaun list, for the
 *         wizard's Akaun Wang / Kategori dropdowns.
 * doPost: JSON body { secret, tarikh, perkara, noPV, kaedah, lines }
 *         -> normal transaction posting.
 *         OR { secret, action: 'ocr_penyata_bank', akaunWang,
 *         fileData, fileMime } -> a suggested transaction list for
 *         review; writes nothing (APZacct-OCRPenyataBank_v1.4.gs).
 *         OR { secret, action: 'rekonsiliasi_bank', akaunWang,
 *         tarikhMula, tarikhTamat, fileData, fileMime } -> compares
 *         the statement against what's already posted for that
 *         account; writes nothing itself either
 *         (APZacct-RekonsiliasiBank_v1.4.gs).
 *
 * SETUP: Extensions > Apps Script > paste alongside Tambah_Akaun.gs >
 * change API_SHARED_SECRET below to your own random string > Deploy >
 * New deployment > type "Web app" > Execute as: Me > Who has access:
 * Anyone > Deploy. Copy the web app URL — that's what the frontend
 * calls. Give the frontend the same secret string, same principle as
 * hiding the Gemini key server-side in food-worth-proxy-worker.js —
 * this URL should not be usable by anyone who just finds it.
 *
 * IMPORTANT — if you edit this file after it's already deployed, Save
 * alone does NOT update the live URL. Go to Deploy > Manage
 * deployments > pick the existing deployment > Edit (pencil) >
 * Version: "New version" > Deploy. Otherwise the URL keeps serving
 * whatever code was live at the last deployment.
 *
 * NOTE: written and traced through carefully, and the account/debit/
 * kredit validation logic now has an automated Node test suite
 * covering it (see test-akauntan-engine.js from the engine audit),
 * but this file itself is still untested in a live Apps Script
 * environment. Test with one throwaway transaction using a VALID
 * code and one using a deliberately WRONG code (e.g. 999999) before
 * pointing any real frontend at a fresh deployment of this version.
 */
const APZ_VER_WEBAPI = '1.4';

const API_SHARED_SECRET = 'GANTI-DENGAN-RAHSIA-ANDA-SENDIRI';
const AKAUN_API_FIRST_ROW = 5;
const AKAUN_API_LAST_ROW = 150;   // matches Tambah_Akaun.gs's working window
const BT_KAPASITI_BARIS = 5000;   // last Baris_Transaksi row the statement formulas read (template v1.3)
const BT_HELPER_LAST_ROW = 5000;   // matches the widened Baris_Transaksi formula range
const TETAPAN_TARIKH_KUNCI_ROW = 21;
const TETAPAN_ID_PEMBUKAAN_ROW = 18;   // Tetapan!C18 = ID of the opening-balance transaction
const TETAPAN_ZON_MASA_ROW = 23;       // Tetapan!C23 = Zon Masa (IANA name, e.g. Asia/Kuala_Lumpur)
const ZON_MASA_LALAI_GS = 'Asia/Kuala_Lumpur';

function doGet(e) {
  const secretDiterima = e.parameter && e.parameter.secret;
  if (!checkSecret_(secretDiterima)) {
    return jsonOut_({ error: 'RALAT: rahsia tidak sah', diagnosisRahsia: diagnosaRahsia_(secretDiterima) });
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const akaun = ss.getSheetByName('Akaun');
  const numRows = AKAUN_API_LAST_ROW - AKAUN_API_FIRST_ROW + 1;
  const rows = akaun.getRange(AKAUN_API_FIRST_ROW, 1, numRows, 9).getValues();

  const accounts = rows
    .filter(function (r) { return r[0] !== '' && r[0] !== null && r[6] === 'Aktif'; })
    .map(function (r) {
      return { kod: r[0], namaEn: r[1], namaBm: r[2], jenis: r[3], bakiNormal: r[4], kumpulanAliranTunai: r[5] };
    });

  const tetapan = ss.getSheetByName('Tetapan');
  const tarikhKunciTempoh = tetapan ? normaliseTarikhSel_(tetapan.getRange(TETAPAN_TARIKH_KUNCI_ROW, 3).getValue(), ss) : '';

  return jsonOut_({ accounts: accounts, tarikhKunciTempoh: tarikhKunciTempoh, zonMasa: zonMasaAPZ_(), tarikhPembukaan: tarikhPembukaanAPZ_(ss),
                    versi: (typeof APZ_RELEASE !== 'undefined' ? APZ_RELEASE : ''), pihak: (typeof pihakAktifAPZ_ === 'function' ? pihakAktifAPZ_(ss) : []) });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ error: 'RALAT: badan permintaan bukan JSON sah' });
  }
  if (!checkSecret_(body.secret)) {
    return jsonOut_({ error: 'RALAT: rahsia tidak sah', diagnosisRahsia: diagnosaRahsia_(body.secret) });
  }

  if (body.action === 'ocr_penyata_bank') {
    return prosesOCRPenyataBank_(body);
  }
  if (body.action === 'rekonsiliasi_bank') {
    return prosesRekonsiliasiBank_(body);
  }
  if (body.action === 'pos_kelompok') {
    return prosesPosKelompokAPZ_(body);
  }
  if (body.action && String(body.action).indexOf('dokumen_') === 0) {
    if (typeof prosesDokumenAPZ_ !== 'function') return jsonOut_({ error: 'RALAT: fail APZacct-Dokumen_v1.4.gs belum ditambah dalam Apps Script (jalankan menu Semak Versi Fail)', kod: 'FAIL_DOKUMEN_TIADA' });
    return prosesDokumenAPZ_(body);
  }

  const tarikh = body.tarikh;
  const perkara = body.perkara || '';
  const noPV = body.noPV || '';
  const kaedah = body.kaedah;
  const lines = body.lines;

  if (!tarikh || !kaedah || !Array.isArray(lines) || lines.length < 2) {
    return jsonOut_({ error: 'RALAT: lengkapkan tarikh, kaedah, dan sekurang-kurangnya 2 baris' });
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // NEW in v1.7 - date rules: real date, not before the opening balances, period lock needs a reason
  const tarikhStr = (tarikh instanceof Date) ? Utilities.formatDate(tarikh, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd') : String(tarikh).trim();
  if (!tarikhSahAPZ_(tarikhStr)) {
    return jsonOut_({ error: 'RALAT: tarikh mesti sebenar dan berformat YYYY-MM-DD (diterima: ' + tarikhStr + ')', kod: 'TARIKH_TIDAK_SAH' });
  }
  const tarikhPembukaan = tarikhPembukaanAPZ_(ss);
  if (tarikhPembukaan && tarikhStr < tarikhPembukaan) {
    return jsonOut_({ error: 'RALAT: tarikh ' + tarikhStr + ' sebelum baki pembukaan (' + tarikhPembukaan + '). Entri tempoh lepas tidak boleh dipos dalam buku kerja ini - guna buku kerja bagi tahun berkenaan.', kod: 'SEBELUM_PEMBUKAAN' });
  }
  const tetapanSheet = ss.getSheetByName('Tetapan');
  const tarikhKunci = tetapanSheet ? normaliseTarikhSel_(tetapanSheet.getRange(TETAPAN_TARIKH_KUNCI_ROW, 3).getValue(), ss) : '';
  const sebabLewat = String(body.sebabLewat || '').trim();
  const lewat = !!(tarikhKunci && tarikhStr <= tarikhKunci);
  if (lewat && !sebabLewat) {
    return jsonOut_({ error: 'RALAT: tarikh ' + tarikhStr + ' dalam tempoh yang sudah dikunci (' + tarikhKunci + '). Nyatakan sebab entri lewat untuk meneruskan.', kod: 'TEMPOH_DIKUNCI' });
  }

  // NEW in v1.5 — every Kod Akaun must actually exist in Akaun before
  // anything else is computed or written. Same fail-closed pattern as
  // posAgihanAPK_'s own pre-flight check (APZacct-PosAgihanAPK_v1.4.gs).
  const akaunSheet = ss.getSheetByName('Akaun');
  const akCodesValid = {};
  akaunSheet.getRange(AKAUN_API_FIRST_ROW, 1, AKAUN_API_LAST_ROW - AKAUN_API_FIRST_ROW + 1, 1).getValues().forEach(function (r) {
    if (r[0] !== '' && r[0] !== null) akCodesValid[Number(r[0])] = true;
  });

  let totalDebit = 0, totalKredit = 0;
  const kodTidakSah = [];
  for (let i = 0; i < lines.length; i++) {
    const kod = Number(lines[i].kodAkaun);
    if (!kod) return jsonOut_({ error: 'RALAT: baris ' + (i + 1) + ' tiada Kod Akaun yang sah' });
    if (!akCodesValid[kod] && kodTidakSah.indexOf(kod) === -1) kodTidakSah.push(kod);
    if ((Number(lines[i].debit) || 0) < 0 || (Number(lines[i].kredit) || 0) < 0) return jsonOut_({ error: 'RALAT: jumlah debit/kredit tidak boleh negatif', kod: 'JUMLAH_NEGATIF' });
    totalDebit += Number(lines[i].debit) || 0;
    totalKredit += Number(lines[i].kredit) || 0;
  }
  if (kodTidakSah.length) {
    return jsonOut_({ error: 'RALAT: Kod Akaun ' + kodTidakSah.join(', ') + ' tidak wujud dalam Akaun (atau tidak Aktif) \u2014 tiada apa dipos.' });
  }
  if (Math.round((totalDebit - totalKredit) * 100) !== 0) {
    return jsonOut_({ error: 'RALAT: debit (RM' + totalDebit.toFixed(2) + ') tidak sama dengan kredit (RM' + totalKredit.toFixed(2) + ')' });
  }

  // NEW in v1.4 - optional document (PV / Resit) made from this same entry; validated BEFORE anything is written
  let dokInput = null;
  if (body.dokumen) {
    if (typeof semakInputDokumenAPZ_ !== 'function') return jsonOut_({ error: 'RALAT: fail APZacct-Dokumen_v1.4.gs belum ditambah dalam Apps Script (jalankan menu Semak Versi Fail)', kod: 'FAIL_DOKUMEN_TIADA' });
    const sd = semakInputDokumenAPZ_(body.dokumen, lines, ss, kaedah);
    if (sd.error) return jsonOut_({ error: sd.error, kod: sd.kod || 'DOKUMEN_TIDAK_SAH' });
    dokInput = sd;
  }

  const tx = ss.getSheetByName('Transaksi');
  const bt = ss.getSheetByName('Baris_Transaksi');

  let resitUrl = '';
  if (body.fileData) {
    try {
      resitUrl = saveReceiptToDrive_(body.fileData, body.fileMime, body.fileName, dokInput ? dokInput.rujukan : noPV);
    } catch (err) {
      resitUrl = 'RALAT MUAT NAIK: ' + err.message;
    }
  }

  let hasil;
  try {
    hasil = dalamKunciAPZ_(function () {
      const newTxId = nextId_(tx, 1, 'T-');
      const txRow = findFirstBlankRow_(tx, 1);
      let btRow = findFirstBlankRow_(bt, 2);
      if (btRow + lines.length - 1 > BT_KAPASITI_BARIS) {
        return { error: 'RALAT: lejar penuh - Baris_Transaksi hanya dibaca hingga baris ' + BT_KAPASITI_BARIS + '. Lebarkan julat formula dahulu (lihat Panduan).', kod: 'KAPASITI_PENUH' };
      }
      ensureBarisAPZ_(tx, txRow);
      ensureBarisAPZ_(bt, btRow + lines.length - 1);
      let dokPihak = null, dokRancang = null, noTulis = noPV;
      if (dokInput) {   // number first (read only), then the party (may add a row), then the writes
        dokRancang = rancangNomborDokumenAPZ_(ss, dokInput.jenis, tarikhStr);
        if (dokRancang.error) return dokRancang;
        const ph = selesaikanPihakAPZ_(ss, dokInput.pihakInput);
        if (ph.error) return { error: 'RALAT: ' + ph.error, kod: 'PIHAK_TIDAK_SAH' };
        dokPihak = ph.pihak; noTulis = dokRancang.no;
      }
      tx.getRange(txRow, 1, 1, 7).setValues([[newTxId, tarikhStr, perkara, noTulis, kaedah, lewat ? 'Entri Lewat' : 'Disahkan', resitUrl]]);
      let lineCounter = lastLineNumber_(bt);
      lines.forEach(function (l) {
        lineCounter += 1;
        const lineId = 'L-' + String(lineCounter).padStart(3, '0');
        bt.getRange(btRow, 1, 1, 6).setValues([[
          lineId, newTxId, Number(l.kodAkaun), Number(l.debit) || 0, Number(l.kredit) || 0, l.memo || ''
        ]]);
        if (btRow > BT_HELPER_LAST_ROW) {
          bt.getRange(btRow, 7).setFormula(
            '=IF(C' + btRow + '="","",INDEX(Akaun!$F$5:$F$150,MATCH(C' + btRow + ',Akaun!$A$5:$A$150,0)))'
          );
        }
        btRow += 1;
      });
      let dokHasil = null, dokRalat = '';
      if (dokInput) {   // the ledger rows are already written: a failure here must NOT look like a failed posting (the user would post twice)
        try {
          dokHasil = tulisDokumenAPZ_(ss, dokRancang, dokPihak, { jenis: dokInput.jenis, tarikhStr: tarikhStr, perkara: perkara, jumlah: dokInput.jumlah, kaedah: kaedah, kodWang: dokInput.kodWang,
            baris: dokInput.baris, butiran: dokInput.butiran, rujukan: dokInput.rujukan, keluar: dokInput.keluar, rekod: dokInput.rekod, lulus: dokInput.lulus }, newTxId);
        } catch (errDok) { dokRalat = String(errDok && errDok.message ? errDok.message : errDok); }
      }
      return { status: 'BERJAYA', idTransaksi: newTxId, bilanganBaris: lines.length, urlResit: resitUrl, _txRow: txRow, _dok: dokHasil, _dokRalat: dokRalat };
    });
  } catch (err) {
    return ralatKunciAPZ_(err);
  }
  if (hasil.status === 'BERJAYA' && lewat && typeof logPerubahan_ === 'function') {
    try { logPerubahan_('Transaksi', 'B' + hasil._txRow, '(entri baharu)', tarikhStr, 'Entri lewat: ' + sebabLewat + ' [' + hasil.idTransaksi + ']'); } catch (err2) { /* audit log is best-effort */ }
  }
  if (hasil.status === 'BERJAYA' && hasil._dok) {   // PDF is made AFTER the lock (slow); a failure never undoes the posting
    const dk = hasil._dok;
    const j = janaPdfDanSimpanAPZ_(ss, dk.data, dk.baris, false);
    hasil.dokumen = { id: dk.id, no: dk.no, jenis: dk.jenis, urlPdf: j.url, amaran: dk.amaran };
    if (j.error) hasil.dokumen.amaranPdf = j.error;
  }
  if (hasil._dokRalat) hasil.dokumenRalat = 'Entri SUDAH dipos (' + hasil.idTransaksi + ') tetapi dokumen tidak dapat dibuat: ' + hasil._dokRalat + ' - semak helaian Dokumen; jangan pos semula entri yang sama.';
  delete hasil._dokRalat;
  delete hasil._dok;
  delete hasil._txRow;
  return jsonOut_(hasil);
}

function saveReceiptToDrive_(base64Data, mimeType, fileName, noPV) {
  const rootFolderName = 'APZacct - Resit & PV';
  const rootFolders = DriveApp.getFoldersByName(rootFolderName);
  const rootFolder = rootFolders.hasNext() ? rootFolders.next() : DriveApp.createFolder(rootFolderName);

  const now = new Date();
  const tz = zonMasaAPZ_();
  const yearFolder = getOrCreateFolder_(rootFolder, Utilities.formatDate(now, tz, 'yyyy'));
  const monthFolder = getOrCreateFolder_(yearFolder, Utilities.formatDate(now, tz, 'MM - MMMM'));

  const safeMime = mimeType || 'application/octet-stream';
  const decoded = Utilities.base64Decode(base64Data);
  const baseName = (noPV ? noPV + ' - ' : '') + (fileName || 'resit') + ' - ' +
    Utilities.formatDate(now, tz, 'yyyyMMdd-HHmmss');
  const blob = Utilities.newBlob(decoded, safeMime, baseName);

  const file = monthFolder.createFile(blob);
  return file.getUrl();
}

function getOrCreateFolder_(parent, name) {
  const existing = parent.getFoldersByName(name);
  return existing.hasNext() ? existing.next() : parent.createFolder(name);
}

function checkSecret_(secret) {
  return secret === API_SHARED_SECRET;
}

// Never returns either actual secret. Only shape information: whether
// nothing arrived at all, how long each side is, and whether either
// has whitespace that wouldn't be visible at a glance. Two different-
// but-similar-looking secrets always differ in at least one of these
// unless someone reused the exact same string, which is what a real
// match means anyway.
function diagnosaRahsia_(secretDiterima) {
  const jangkaan = API_SHARED_SECRET;
  const diterima = (secretDiterima === undefined || secretDiterima === null) ? '' : String(secretDiterima);
  return {
    tiadaDiterimaLangsung: diterima === '',
    panjangDiterima: diterima.length,
    panjangDijangka: jangkaan.length,
    diterimaAdaRuangDiHujung: diterima !== diterima.trim(),
    dijangkaAdaRuangDiHujung: jangkaan !== jangkaan.trim()
  };
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

// NEW in v1.7 - time zone and date helpers (shared by the other APZacct scripts; names end in APZ_ / Sel_ to avoid clashes)
function zonMasaAPZ_() {
  let tz = '';
  try {
    const t = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tetapan');
    tz = t ? String(t.getRange(TETAPAN_ZON_MASA_ROW, 3).getValue() || '').trim() : '';
    if (tz) Utilities.formatDate(new Date(), tz, 'yyyy'); // throws if it is not a valid time zone name
  } catch (err) { tz = ''; }
  return tz || ZON_MASA_LALAI_GS;
}

function hariIniAPZ_() { return Utilities.formatDate(new Date(), zonMasaAPZ_(), 'yyyy-MM-dd'); }

function tarikhSahAPZ_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// A date typed into a cell comes back as a Date in the SPREADSHEET's time zone; anything else is treated as text.
function normaliseTarikhSel_(v, ss) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : Utilities.formatDate(v, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return String(v === null || v === undefined ? '' : v).trim();
}

// Date of the opening-balance transaction (Tetapan!C18) = start of this workbook's fiscal year; '' when not set up yet.
function tarikhPembukaanAPZ_(ss) {
  const tetapan = ss.getSheetByName('Tetapan'), tx = ss.getSheetByName('Transaksi');
  if (!tetapan || !tx) return '';
  const id = String(tetapan.getRange(TETAPAN_ID_PEMBUKAAN_ROW, 3).getValue() || '').trim();
  if (!id) return '';
  const last = tx.getLastRow();
  if (last < 5) return '';
  const rows = tx.getRange(5, 1, last - 4, 2).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === id) return normaliseTarikhSel_(rows[i][1], ss);
  }
  return '';
}

// NEW in v1.8 - locking, grid growth and batch posting (names end in APZ_ to avoid clashes with other files)
function dalamKunciAPZ_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { const e = new Error('SISTEM_SIBUK'); e.sibuk = true; throw e; }
  try { return fn(); } finally { lock.releaseLock(); }
}

function ralatKunciAPZ_(err) {
  if (err && err.sibuk) return jsonOut_({ error: 'RALAT: sistem sibuk (pengguna lain sedang menyimpan) - cuba lagi sebentar.', kod: 'SISTEM_SIBUK' });
  return jsonOut_({ error: 'RALAT: ' + (err && err.message ? err.message : err), kod: 'RALAT_SISTEM' });
}

function ensureBarisAPZ_(sheet, barisPerlu) {
  const maxRows = sheet.getMaxRows();
  if (barisPerlu > maxRows) sheet.insertRowsAfter(maxRows, barisPerlu - maxRows + 200);
}

// Row after the LAST filled cell in a column, so a block write can never overwrite rows that sit below a gap.
function barisSeterusnyaAPZ_(sheet, kol) {
  const nilai = sheet.getRange(5, kol, Math.max(sheet.getMaxRows() - 4, 1), 1).getValues();
  for (let i = nilai.length - 1; i >= 0; i--) if (nilai[i][0] !== '' && nilai[i][0] !== null) return 5 + i + 1;
  return 5;
}

// Same rules as a single post (date, opening guard, period lock + reason, account codes, balance) for one batch item.
function semakTransaksiAPZ_(it, k) {
  if (!it || !it.tarikh || !it.kaedah || !Array.isArray(it.lines) || it.lines.length < 2) return { ok: false, kod: 'LENGKAPKAN', error: 'lengkapkan tarikh, kaedah, dan sekurang-kurangnya 2 baris' };
  const tarikhStr = (it.tarikh instanceof Date) ? Utilities.formatDate(it.tarikh, k.ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd') : String(it.tarikh).trim();
  if (!tarikhSahAPZ_(tarikhStr)) return { ok: false, kod: 'TARIKH_TIDAK_SAH', error: 'tarikh mesti sebenar dan berformat YYYY-MM-DD (diterima: ' + tarikhStr + ')' };
  if (k.tarikhPembukaan && tarikhStr < k.tarikhPembukaan) return { ok: false, kod: 'SEBELUM_PEMBUKAAN', error: 'tarikh ' + tarikhStr + ' sebelum baki pembukaan (' + k.tarikhPembukaan + ')' };
  const sebab = String(it.sebabLewat || k.sebabLalai || '').trim();
  const lewat = !!(k.tarikhKunci && tarikhStr <= k.tarikhKunci);
  if (lewat && !sebab) return { ok: false, kod: 'TEMPOH_DIKUNCI', error: 'tarikh ' + tarikhStr + ' dalam tempoh yang sudah dikunci (' + k.tarikhKunci + '); sebab entri lewat diperlukan' };
  let jd = 0, jk = 0; const baris = [];
  for (let i = 0; i < it.lines.length; i++) {
    const l = it.lines[i], kod = Number(l.kodAkaun);
    if (!kod || !k.kodSah[kod]) return { ok: false, kod: 'KOD_TIDAK_SAH', error: 'Kod Akaun ' + (l.kodAkaun || '(kosong)') + ' tidak wujud dalam Akaun' };
    const d = Number(l.debit) || 0, kr = Number(l.kredit) || 0;
    if (d < 0 || kr < 0) return { ok: false, kod: 'JUMLAH_NEGATIF', error: 'jumlah debit/kredit tidak boleh negatif' };
    jd += d; jk += kr;
    baris.push({ kod: kod, debit: d, kredit: kr, memo: l.memo || '' });
  }
  if (Math.round((jd - jk) * 100) !== 0) return { ok: false, kod: 'TAK_SEIMBANG', error: 'debit (RM' + jd.toFixed(2) + ') tidak sama dengan kredit (RM' + jk.toFixed(2) + ')' };
  return { ok: true, tarikhStr: tarikhStr, lewat: lewat, sebab: sebab, perkara: String(it.perkara || ''), noPV: String(it.noPV || ''), kaedah: String(it.kaedah), baris: baris };
}

// action 'pos_kelompok': { secret, action, sebabLewat?, transaksi: [ { tarikh, perkara, noPV, kaedah, lines:[{kodAkaun,debit,kredit,memo}], sebabLewat? } ] }
function prosesPosKelompokAPZ_(body) {
  const items = body.transaksi;
  if (!Array.isArray(items) || !items.length) return jsonOut_({ error: 'RALAT: tiada transaksi dalam kelompok', kod: 'KELOMPOK_KOSONG' });
  if (items.length > 500) return jsonOut_({ error: 'RALAT: kelompok terlalu besar (maksimum 500 transaksi sekali)', kod: 'KELOMPOK_BESAR' });
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const kodSah = {};
  ss.getSheetByName('Akaun').getRange(AKAUN_API_FIRST_ROW, 1, AKAUN_API_LAST_ROW - AKAUN_API_FIRST_ROW + 1, 1).getValues().forEach(function (r) {
    if (r[0] !== '' && r[0] !== null) kodSah[Number(r[0])] = true;
  });
  const tetapan = ss.getSheetByName('Tetapan');
  const k = { ss: ss, kodSah: kodSah, tarikhPembukaan: tarikhPembukaanAPZ_(ss),
              tarikhKunci: tetapan ? normaliseTarikhSel_(tetapan.getRange(TETAPAN_TARIKH_KUNCI_ROW, 3).getValue(), ss) : '',
              sebabLalai: String(body.sebabLewat || '').trim() };
  const sah = [], ralat = [];
  items.forEach(function (it, i) {
    const h = semakTransaksiAPZ_(it, k);
    if (h.ok) sah.push(h); else ralat.push({ indeks: i, kod: h.kod, error: h.error });
  });
  if (ralat.length) return jsonOut_({ error: 'RALAT: ' + ralat.length + ' transaksi tidak sah - tiada apa dipos', kod: 'KELOMPOK_TIDAK_SAH', ralat: ralat.slice(0, 50) });
  let hasil;
  try {
    hasil = dalamKunciAPZ_(function () {
      const tx = ss.getSheetByName('Transaksi'), bt = ss.getSheetByName('Baris_Transaksi');
      const txRow = barisSeterusnyaAPZ_(tx, 1), btRow = barisSeterusnyaAPZ_(bt, 2);
      const jumlahBaris = sah.reduce(function (s, h) { return s + h.baris.length; }, 0);
      if (btRow + jumlahBaris - 1 > BT_KAPASITI_BARIS) {
        return { error: 'RALAT: lejar tidak cukup ruang - tinggal ' + Math.max(0, BT_KAPASITI_BARIS - btRow + 1) + ' baris, kelompok ini perlu ' + jumlahBaris + '. Lebarkan julat formula dahulu.', kod: 'KAPASITI_PENUH' };
      }
      ensureBarisAPZ_(tx, txRow + sah.length - 1);
      ensureBarisAPZ_(bt, btRow + jumlahBaris - 1);
      const n0 = parseInt(nextId_(tx, 1, 'T-').slice(2), 10);
      let noBaris = lastLineNumber_(bt);
      const tajuk = [], baris = [];
      sah.forEach(function (h, i) {
        const id = 'T-' + String(n0 + i).padStart(4, '0');
        tajuk.push([id, h.tarikhStr, h.perkara, h.noPV, h.kaedah, h.lewat ? 'Entri Lewat' : 'Disahkan', '']);
        h.baris.forEach(function (l) { noBaris += 1; baris.push(['L-' + String(noBaris).padStart(3, '0'), id, l.kod, l.debit, l.kredit, l.memo]); });
      });
      tx.getRange(txRow, 1, tajuk.length, 7).setValues(tajuk);
      bt.getRange(btRow, 1, baris.length, 6).setValues(baris);
      return { status: 'BERJAYA', bilangan: tajuk.length, bilanganBaris: baris.length, idPertama: tajuk[0][0], idTerakhir: tajuk[tajuk.length - 1][0],
               bilanganLewat: sah.filter(function (h) { return h.lewat; }).length, _txRow: txRow };
    });
  } catch (err) {
    return ralatKunciAPZ_(err);
  }
  if (hasil.status === 'BERJAYA' && hasil.bilanganLewat && typeof logPerubahan_ === 'function') {
    const contoh = sah.filter(function (h) { return h.lewat; })[0];
    try { logPerubahan_('Transaksi', 'B' + hasil._txRow, '(kelompok baharu)', hasil.bilanganLewat + ' entri lewat', 'Entri lewat (kelompok ' + hasil.idPertama + ' - ' + hasil.idTerakhir + '): ' + contoh.sebab); } catch (err2) { /* audit log is best-effort */ }
  }
  delete hasil._txRow;
  return jsonOut_(hasil);
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
