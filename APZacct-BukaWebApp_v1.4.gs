// APZacct release 1.4 - file APZacct-BukaWebApp_v1.4.gs (renamed with the release number, version constant added, no logic change)
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_BUKAWEBAPP). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — Buka Web App (open the deployed wizard from Sheets)
 * ---------------------------------------------------
 * v1.0 (new). One menu click opens the deployed wizard in a new
 * browser tab, instead of having to remember or dig up the Cloudflare
 * URL separately from the spreadsheet.
 *
 * Apps Script menu items run server-side — there's no browser window
 * in that context, so a menu function can't call window.open()
 * directly. This shows a small dialog with a real link in it, which
 * you then click yourself. That's the standard way to do this from
 * Apps Script, not a workaround.
 *
 * The URL is read from Tetapan!C20 first, falling back to
 * WEB_APP_URL_LALAI below if that cell is blank. ONE-TIME MANUAL
 * STEP: add row 20 to Tetapan — label "URL Web App APZacct" in
 * column A, the live URL in columns B and C. Same pattern as every
 * other Tetapan setting in this build: once that row exists, you can
 * update the live URL from the sheet itself if it ever changes again,
 * without touching this script.
 *
 * SETUP: Extensions > Apps Script > paste alongside your other
 * APZacct scripts > Save > reload the sheet.
 */
const APZ_VER_BUKAWEBAPP = '1.4';

const WEB_APP_URL_LALAI = 'https://apz-acct.reysourcez-ent.workers.dev';

function bukaWebApp() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tetapan = ss.getSheetByName('Tetapan');
  const urlDaripadaTetapan = tetapan ? String(tetapan.getRange('C20').getValue() || '').trim() : '';
  const url = urlDaripadaTetapan || WEB_APP_URL_LALAI;

  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,Helvetica,sans-serif; padding:22px; text-align:center;">' +
    '<p style="margin:0 0 16px; font-size:14px; color:#333;">Klik untuk buka APZacct di tab baharu:</p>' +
    '<a href="' + url + '" target="_blank" rel="noopener" ' +
    'style="display:inline-block; padding:12px 26px; background:#1F6F5C; color:#fff; text-decoration:none; border-radius:6px; font-weight:600; font-size:14px;">Buka APZacct &rarr;</a>' +
    '<p style="margin:16px 0 0; font-size:11px; color:#888; word-break:break-all;">' + url + '</p>' +
    '</div>'
  ).setWidth(340).setHeight(170);

  SpreadsheetApp.getUi().showModalDialog(html, 'Buka APZacct Web App');
}
