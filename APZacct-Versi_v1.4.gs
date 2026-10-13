// APZacct release 1.4 - file APZacct-Versi_v1.4.gs (NEW in 1.4)
/**
 * APZacct — Versi (release registry + "Semak Versi Fail")
 * ---------------------------------------------------
 * v1.4 (new). Every APZacct .gs file now carries the release number in three places: its file name (APZacct-<Nama>_v1.4.gs), its first line, and a constant APZ_VER_<NAMA>.
 * This file holds the release itself (APZ_RELEASE) and a menu check that lists every expected file with its version, so a file that was forgotten, or left at an older release,
 * shows up immediately instead of causing a strange bug later.
 *
 * Two safety nets work together:
 *  1. Menu APZacct > "Semak Versi Fail": run it after pasting. It reports HILANG (file not pasted) or LAIN (file from another release).
 *  2. doGet returns APZ_RELEASE as "versi"; the web pages show it next to their own version and warn in red when they differ (typical cause: saved the code but did not
 *     Deploy > Manage deployments > New version).
 * If an OLD copy of a file is left in the project beside the new one, both declare the same top-level constants and Apps Script stops with
 * "Identifier ... has already been declared" (the APZacct menu then does not appear). Delete the old copy: Apps Script editor > file > Remove.
 *
 * Add a line to senaraiVersiAPZ_() whenever a new .gs file joins the release (APZacct-ReleaseCheck_v1.4.js checks the list against the folder).
 * SETUP: Extensions > Apps Script > + > Script > name it APZacct-Versi_v1.4 > paste > Save > reload the sheet.
 */
const APZ_VER_VERSI = '1.4';
const APZ_RELEASE = '1.4';

function senaraiVersiAPZ_() {
  return [
    ['APZacct-BakiPembukaan', typeof APZ_VER_BAKIPEMBUKAAN === 'undefined' ? '' : APZ_VER_BAKIPEMBUKAAN],
    ['APZacct-BukaWebApp', typeof APZ_VER_BUKAWEBAPP === 'undefined' ? '' : APZ_VER_BUKAWEBAPP],
    ['APZacct-Dokumen', typeof APZ_VER_DOKUMEN === 'undefined' ? '' : APZ_VER_DOKUMEN],
    ['APZacct-JurnalLaras', typeof APZ_VER_JURNALLARAS === 'undefined' ? '' : APZ_VER_JURNALLARAS],
    ['APZacct-KadarStatutori', typeof APZ_VER_KADARSTATUTORI === 'undefined' ? '' : APZ_VER_KADARSTATUTORI],
    ['APZacct-Laporan', typeof APZ_VER_LAPORAN === 'undefined' ? '' : APZ_VER_LAPORAN],
    ['APZacct-LindungiHelaian', typeof APZ_VER_LINDUNGIHELAIAN === 'undefined' ? '' : APZ_VER_LINDUNGIHELAIAN],
    ['APZacct-LogPerubahan', typeof APZ_VER_LOGPERUBAHAN === 'undefined' ? '' : APZ_VER_LOGPERUBAHAN],
    ['APZacct-Menu', typeof APZ_VER_MENU === 'undefined' ? '' : APZ_VER_MENU],
    ['APZacct-OCRPenyataBank', typeof APZ_VER_OCRPENYATABANK === 'undefined' ? '' : APZ_VER_OCRPENYATABANK],
    ['APZacct-PosAgihanAPK', typeof APZ_VER_POSAGIHANAPK === 'undefined' ? '' : APZ_VER_POSAGIHANAPK],
    ['APZacct-PosSusutNilai', typeof APZ_VER_POSSUSUTNILAI === 'undefined' ? '' : APZ_VER_POSSUSUTNILAI],
    ['APZacct-RekonsiliasiBank', typeof APZ_VER_REKONSILIASIBANK === 'undefined' ? '' : APZ_VER_REKONSILIASIBANK],
    ['APZacct-TambahAkaun', typeof APZ_VER_TAMBAHAKAUN === 'undefined' ? '' : APZ_VER_TAMBAHAKAUN],
    ['APZacct-Versi', typeof APZ_VER_VERSI === 'undefined' ? '' : APZ_VER_VERSI],
    ['APZacct-WangRuncit', typeof APZ_VER_WANGRUNCIT === 'undefined' ? '' : APZ_VER_WANGRUNCIT],
    ['APZacct-WebAPI', typeof APZ_VER_WEBAPI === 'undefined' ? '' : APZ_VER_WEBAPI]
  ];
}

// Pure function (no UI) so it can be tested: returns { ok, baris:[text], hilang:[], lain:[] }.
function nilaiSemakVersiAPZ_() {
  const hilang = [], lain = [], baris = [];
  senaraiVersiAPZ_().forEach(function (p) {
    let status = 'OK';
    if (!p[1]) { status = 'HILANG'; hilang.push(p[0]); }
    else if (p[1] !== APZ_RELEASE) { status = 'LAIN'; lain.push(p[0] + ' (v' + p[1] + ')'); }
    baris.push(p[0] + ': ' + (p[1] ? 'v' + p[1] : '-') + '  ' + status);
  });
  return { ok: !hilang.length && !lain.length, baris: baris, hilang: hilang, lain: lain };
}

function semakVersiAPZ() {
  const ui = SpreadsheetApp.getUi();
  const h = nilaiSemakVersiAPZ_();
  let teks = (h.ok ? 'SEMUA FAIL OK - release ' + APZ_RELEASE : 'ADA MASALAH - release dijangka ' + APZ_RELEASE) + '\n\n' + h.baris.join('\n');
  if (h.hilang.length) teks += '\n\nHILANG (belum ditampal): ' + h.hilang.join(', ') + '\nTambah fail itu: + > Script > beri nama tepat seperti di atas > tampal kandungannya.';
  if (h.lain.length) teks += '\n\nRELEASE LAIN: ' + h.lain.join(', ') + '\nTampal semula fail itu daripada release ' + APZ_RELEASE + '.';
  teks += '\n\nWeb App: selepas menampal, Deploy > Manage deployments > pensil > Version: New version > Deploy. Halaman web akan menunjukkan merah jika versi backend tidak sama.';
  ui.alert('Semak Versi Fail', teks, ui.ButtonSet.OK);
}
