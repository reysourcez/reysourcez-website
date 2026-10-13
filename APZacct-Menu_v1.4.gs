// APZacct release 1.4 - file APZacct-Menu_v1.4.gs (adds "Semak Versi Fail")
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_MENU). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — Master Menu
 * ---------------------------------------------------
 * v1.4 RELEASE (this file) - adds "Semak Versi Fail (selepas tampal)" (semakVersiAPZ, in APZacct-Versi_v1.4.gs) right under "Buka APZacct (Web App)".
 * v1.5 — adds "Jurnal Laras (terakru / prabayar)", calling posJurnalLaras()
 * (new file, APZacct-JurnalLaras_v1.4.gs), grouped with the other posting functions.
 * (v1.4: Sediakan Senarai Kadar Statutori. v1.3: Pos Susut Nilai Aset.)
 * Still the ONLY file that should define onOpen() — every other APZacct .gs file defines its
 * functions but not a menu. Apps Script treats every pasted file as one shared project; two
 * functions named onOpen() means only the last one loaded actually runs, and the others
 * silently vanish. If you paste in a new script later with its own onOpen(), delete that block
 * and add its menu item here instead.
 *
 * SETUP: paste this alongside all your other APZacct .gs files.
 */
const APZ_VER_MENU = '1.4';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('APZacct')
    .addItem('Buka APZacct (Web App)', 'bukaWebApp')
    .addItem('Semak Versi Fail (selepas tampal)', 'semakVersiAPZ')
    .addSeparator()
    .addItem('Tambah Akaun (Add Account)', 'tambahAkaun')
    .addSeparator()
    .addItem('Pos Baki Pembukaan', 'posBakiPembukaan')
    .addItem('Jurnal Laras (terakru / prabayar)', 'posJurnalLaras')
    .addItem('Pos Agihan APK', 'posAgihanAPK')
    .addItem('Pos Susut Nilai Aset', 'posSusutNilai')
    .addItem('Semak Wang Runcit', 'semakWangRuncit')
    .addSeparator()
    .addItem('Cetak Penyata Kewangan', 'cetakPenyataKewangan')
    .addItem('Diagnosis Ketidakseimbangan', 'diagnosisKetidakseimbangan')
    .addItem('Jana Ringkasan AI', 'janaRingkasanAI')
    .addSeparator()
    .addItem('Lindungi Helaian Formula (jalankan sekali)', 'lindungiHelaianFormula')
    .addItem('Aktifkan Log Perubahan (jalankan sekali)', 'setupRevisionLogTrigger')
    .addItem('Sediakan Senarai Kadar Statutori (jalankan sekali)', 'sediakanSenaraiKadarStatutori')
    .addToUi();
}
