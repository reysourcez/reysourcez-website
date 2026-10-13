// APZacct release 1.4 - file APZacct-KadarStatutori_v1.4.gs (renamed with the release number, version constant added, no logic change)
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_KADARSTATUTORI). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — Kadar Statutori (dropdown for the Tetapan rate cell)
 * ---------------------------------------------------
 * v1.0 (new). The statutory reserve rate (Tetapan!C15) is not one fixed
 * number — it has been 25%, 15%, 13% and 8% at different times, and which
 * one applies depends on the cooperative's own situation and on SKM's
 * current Arahan. The software should not guess. This puts a dropdown on
 * that cell with those four quick-picks, but ANY other value can still be
 * typed straight in (setAllowInvalid(true) = warn, never reject), so
 * whatever the treasurer/auditor decides, it can always be entered and
 * changed later. The cell stays a plain whole-number percent (25 = 25%),
 * exactly what APK already expects (=B4*Tetapan!C15/100).
 *
 * A custom value that isn't in the list shows a small red corner mark in
 * Google Sheets. That is the "warning" and is expected — not an error.
 *
 * To offer a dropdown on another rate later (e.g. row 16/17), add ONE line
 * to KADAR_DROPDOWN below and run this again — no other code to touch.
 * Safe to run more than once.
 *
 * SETUP: Extensions > Apps Script > paste alongside your other APZacct
 * scripts > Save > reload the sheet > APZacct menu > "Sediakan Senarai
 * Kadar Statutori (jalankan sekali)". If this file is part of an already-
 * deployed Web App, nothing needs redeploying — it only touches the sheet.
 *
 * NOTE: syntax- and wiring-tested offline only; not yet run live in Google
 * Sheets. After the first run, click Tetapan!C15 and check the dropdown
 * appears and that changing it changes APK!B7.
 */
const APZ_VER_KADARSTATUTORI = '1.4';

// Tetapan row (value goes in column C) -> quick-pick list.
const KADAR_DROPDOWN = {
  15: ['25', '15', '13', '8'] // Kadar Rizab Statutori
};

function sediakanSenaraiKadarStatutori() {
  const ui = SpreadsheetApp.getUi();
  const tetapan = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Tetapan');
  if (!tetapan) { ui.alert('RALAT: helaian "Tetapan" tidak dijumpai.'); return; }

  Object.keys(KADAR_DROPDOWN).forEach(function (row) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(KADAR_DROPDOWN[row], true)
      .setAllowInvalid(true)
      .setHelpText('Pilih kadar yang pernah berkuat kuasa (' + KADAR_DROPDOWN[row].join('/') + '), atau taip terus kadar yang disahkan SKM/juruaudit anda. Kadar lain yang ditaip akan nampak tanda merah kecil di penjuru sel - itu normal, bukan ralat.')
      .build();
    tetapan.getRange(Number(row), 3).setDataValidation(rule);
  });

  ui.alert(
    'Berjaya!\n\n' +
    'Tetapan!C15 (Kadar Rizab Statutori) kini ada senarai lungsur: 25, 15, 13, 8. ' +
    'Anda MASIH boleh taip kadar lain terus - tanda merah kecil di penjuru sel itu normal.\n\n' +
    'PENTING: senarai ini hanya memudahkan pilihan, BUKAN pengesahan kadar mana yang berkuat kuasa sekarang. ' +
    'Sahkan dengan SKM atau juruaudit koperasi anda sebelum agihan pertama.'
  );
}
