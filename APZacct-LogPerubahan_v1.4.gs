// APZacct release 1.4 - file APZacct-LogPerubahan_v1.4.gs (also watches the Dokumen sheet (No. Dokumen, Tarikh, Nama Pihak, Jumlah))
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_LOGPERUBAHAN). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — Log Perubahan (Revision Log)
 * ---------------------------------------------------
 * Doesn't lock the sheet — locking would make fixing a genuine typo
 * painful. Instead: editing an already-filled cell in the watched
 * columns (transaction amounts/accounts, or an account's Jenis)
 * requires a reason before it's accepted. Cancel or leave it blank
 * and the edit is reverted. Every accepted change is logged with
 * timestamp, editor, sheet, cell, old value, new value, and reason.
 *
 * Watches:
 *  - Baris_Transaksi: Kod Akaun, Debit, Kredit (columns C, D, E)
 *  - Transaksi: Tarikh, No. PV/Rujukan (columns B, D)
 *  - Dokumen (v1.4): No. Dokumen, Tarikh, Nama Pihak, Jumlah (columns E, F, H, J) - an issued PV/Resit is frozen; editing it needs a reason
 *  - Akaun: Jenis (column D) — reclassifying an account after it has
 *    real transactions silently changes every past statement, so this
 *    one gets the same treatment even though it isn't a money field
 *
 * New entries (a blank cell being filled in for the first time) are
 * NOT logged — only edits to something that already had a value.
 *
 * IMPORTANT — this is a SIMPLE trigger limitation you need to know:
 * onEdit() as Apps Script auto-installs it cannot show ui.prompt()
 * dialogs. This file's onEditInstallable() function needs to be wired
 * up as an INSTALLABLE trigger to work — see setupRevisionLogTrigger()
 * below, run it once manually.
 *
 * ALSO IMPORTANT — Session.getActiveUser().getEmail() can return an
 * empty string depending on sharing settings and account type (a known
 * Apps Script limitation, not a bug in this code). If your log shows
 * blank editors, that's why — verified this is a real constraint, not
 * something this script can work around.
 *
 * SETUP: Extensions > Apps Script > paste alongside your other
 * APZacct scripts > Save > run setupRevisionLogTrigger() once from
 * the Apps Script editor (select it from the function dropdown, click
 * Run) > authorize when prompted.
 */
const APZ_VER_LOGPERUBAHAN = '1.4';

const WATCHED_COLUMNS = {
  'Baris_Transaksi': [3, 4, 5],
  'Transaksi': [2, 4],
  'Akaun': [4],
  'Dokumen': [5, 6, 8, 10]   // v1.4: No. Dokumen, Tarikh, Nama Pihak, Jumlah of an issued PV / Resit
};
const WATCHED_FIRST_ROW = 5;

function setupRevisionLogTrigger() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'onEditInstallable';
  });
  existing.forEach(function (t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('onEditInstallable')
    .forSpreadsheet(ss)
    .onEdit()
    .create();

  SpreadsheetApp.getUi().alert('Trigger log perubahan diaktifkan. Cuba edit satu sel di Baris_Transaksi untuk uji.');
}

function onEditInstallable(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  const sheetName = sheet.getName();
  const watchedCols = WATCHED_COLUMNS[sheetName];
  if (!watchedCols) return;

  const row = e.range.getRow();
  const col = e.range.getColumn();
  if (row < WATCHED_FIRST_ROW) return;
  if (watchedCols.indexOf(col) === -1) return;

  const oldValue = e.oldValue;
  const newValue = e.value;
  if (oldValue === undefined || oldValue === '' || oldValue === null) return; // new entry, not a revision
  if (String(oldValue) === String(newValue)) return; // no real change (e.g. re-typing the same value)

  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt(
    'Sebab Perubahan Diperlukan',
    'Anda ubah ' + sheetName + '!' + e.range.getA1Notation() + ' daripada "' + oldValue + '" kepada "' + newValue + '".\n\n' +
    'Sila nyatakan sebab (cth. "Salah taip jumlah", "No. PV tersalah", "Jenis akaun disahkan silap"):',
    ui.ButtonSet.OK_CANCEL
  );

  if (resp.getSelectedButton() !== ui.Button.OK || !resp.getResponseText().trim()) {
    e.range.setValue(oldValue);
    ui.alert('Perubahan dibatalkan \u2014 sebab diperlukan untuk ubah data yang sudah dipos.');
    return;
  }

  logPerubahan_(sheetName, e.range.getA1Notation(), oldValue, newValue, resp.getResponseText().trim());
}

function logPerubahan_(sheetName, sel, lama, baharu, sebab) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let log = ss.getSheetByName('Log_Perubahan');
  if (!log) {
    log = ss.insertSheet('Log_Perubahan');
    log.appendRow(['Tarikh & Masa', 'Pengguna', 'Helaian', 'Sel', 'Nilai Lama', 'Nilai Baharu', 'Sebab']);
    log.getRange(1, 1, 1, 7).setFontWeight('bold');
  }
  let emel = '';
  try { emel = Session.getActiveUser().getEmail(); } catch (err) { emel = '(tidak dapat dikesan)'; }
  log.appendRow([new Date(), emel || '(kosong \u2014 lihat nota had di atas fail ini)', sheetName, sel, lama, baharu, sebab]);
}
