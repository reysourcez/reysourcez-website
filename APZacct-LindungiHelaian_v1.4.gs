// APZacct release 1.4 - file APZacct-LindungiHelaian_v1.4.gs (renamed with the release number, version constant added, no logic change)
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_LINDUNGIHELAIAN). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — Lindungi Helaian Formula (Protect Computed Sheets)
 * ---------------------------------------------------
 * v1.0 (new this round). Closes iterations_planned item 4's "hide/
 * protect non-editable tabs" half.
 *
 * Imbangan_Duga, UR, KKK, APK, AT, and Cetak are 100% formula-driven —
 * there is no legitimate reason for a human to type a value directly
 * into any of them. This adds a warning banner (Google Sheets' native
 * "you're editing a protected range" prompt) to all six.
 *
 * Deliberately WARNING-ONLY, not a hard lock, for two reasons:
 *  1. Same philosophy as Log_Perubahan.gs — a hard lock would also
 *     block a genuine emergency fix, and this project's whole
 *     approach elsewhere is "require a reason", not "forbid outright".
 *  2. A hard restriction (limiting editors) can also block Apps
 *     Script itself from writing to a protected range, depending on
 *     who runs the script — and janaRingkasanAI() writes to Cetak!A6,
 *     cetakPenyataKewangan() reads from it. Warning-only protection
 *     never touches script-based writes at all, only interactive
 *     typing by a human, so nothing else in this project can break
 *     by running this.
 *
 * Safe to run more than once — it checks for an existing protection
 * on each sheet first and skips it rather than stacking duplicates.
 *
 * SETUP: Extensions > Apps Script > paste alongside your other
 * APZacct scripts > Save > reload the sheet > run once from the
 * APZacct menu (or re-run any time after adding a new computed
 * sheet).
 */
const APZ_VER_LINDUNGIHELAIAN = '1.4';

const SHEETS_TO_PROTECT = ['Imbangan_Duga', 'UR', 'KKK', 'APK', 'AT', 'Cetak'];

function lindungiHelaianFormula() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const results = [];

  SHEETS_TO_PROTECT.forEach(function (name) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) { results.push(name + ': TIDAK DIJUMPAI \u2014 dilangkau'); return; }

    const existing = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    if (existing.length > 0) { results.push(name + ': sudah dilindungi (tiada perubahan)'); return; }

    const protection = sheet.protect();
    protection.setDescription('APZacct: helaian formula \u2014 jangan taip terus. Guna Tambah Akaun / wizard kemasukan / Pos Baki Pembukaan / Pos Agihan APK untuk apa-apa perubahan.');
    protection.setWarningOnly(true);
    results.push(name + ': dilindungi (amaran sahaja)');
  });

  ui.alert(
    'Lindungi Helaian Formula\n\n' + results.join('\n') +
    '\n\nIni AMARAN SAHAJA \u2014 sesiapa masih boleh override dan taip terus jika mereka sengaja mahu (mereka akan nampak amaran dahulu sebelum boleh teruskan). ' +
    'Ini sengaja dibuat begini supaya pembetulan kecemasan tidak disekat sepenuhnya, konsisten dengan pendekatan Log_Perubahan.gs di tempat lain dalam sistem ini.'
  );
}
