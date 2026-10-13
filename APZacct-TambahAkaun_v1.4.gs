// APZacct release 1.4 - file APZacct-TambahAkaun_v1.4.gs (renamed with the release number, version constant added, no logic change)
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_TAMBAHAKAUN). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — Tambah Akaun (Add Account)
 * ---------------------------------------------------
 * v1.3 - the date stamped in column H uses the Tetapan!C23 time zone (hariIniAPZ_ in APZacct-WebAPI_v1.4.gs v1.7).
 *
 * v1.2 - asks for the Kumpulan Aliran Tunai (Akaun column F) for Aset / Liabiliti / Ekuiti instead of silently writing
 * 'Operasi' for every new account. That default hid new bank/cash accounts from the wizard's money-account list (it only
 * offers Aset + 'Tidak Berkaitan') and put fixed assets, loans and share capital in the wrong Penyata Aliran Tunai section.
 * Hasil / Perbelanjaan are always 'Operasi' (no question). Also: the success message no longer claims UR/KKK show the
 * new account by name - it is included in the JUMLAH lines, but UR/KKK only list accounts that have a named row.
 *
 * v1.1 — fixes a real drift bug: Tetapan!C10:C14 ("Kod
 * Akaun Seterusnya — Aset/Liabiliti/Ekuiti/Hasil/Perbelanjaan") are
 * static numbers, not formulas. v1.0 computed the next code purely by
 * scanning Akaun and never touched those cells, so after your very
 * first new account, Tetapan's "next code" display would already be
 * wrong and just sit there looking authoritative. It never caused bad
 * DATA — Akaun itself was always correct — but it made Tetapan
 * untrustworthy, which defeats the point of a settings sheet.
 *
 * Fix: tambahAkaun() now treats Tetapan's cell as the proposed next
 * code, cross-checks it against what Akaun actually contains, uses
 * whichever is safe (never assigns a code that's already taken), and
 * writes the corrected next value back after creating the account. If
 * Tetapan was stale or blank, it self-heals silently and tells you so
 * in the success message — you don't have to notice or fix it by hand.
 *
 * Everything else below (the account-creation flow itself, the
 * numbering ranges) is unchanged from the version already in the
 * project.
 *
 * SETUP (one-time): Extensions > Apps Script > paste this alongside
 * your other v2 scripts > Save > reload the sheet. Adds a
 * "Tambah Akaun (Add Account)" item to the "APZacct" menu
 * (creates that menu if this is the first v2 script installed).
 *
 * NOTE: written and reasoned through carefully, but not yet run in a
 * live Apps Script environment — sanity-check the first account it
 * creates before relying on it for real entries.
 */
const APZ_VER_TAMBAHAKAUN = '1.4';

const AKAUN_FIRST_ROW = 5;
const AKAUN_LAST_POSSIBLE_ROW = 150; // matches Imbangan_Duga's pre-filled formula range — widen both together if this is ever raised
const JENIS_RANGES = {
  'Aset': 1000,
  'Liabiliti': 2000,
  'Ekuiti': 3000,
  'Hasil': 4000,
  'Perbelanjaan': 5000
};
// NEW in v1.1 — which Tetapan row (column C = "Nilai Digunakan") holds
// the next-code reference for each Jenis. Matches the live sheet as
// of this build: row 10=Aset, 11=Liabiliti, 12=Ekuiti, 13=Hasil,
// 14=Perbelanjaan. If you ever reorder Tetapan, update this map.
const TETAPAN_NEXT_CODE_ROW = {
  'Aset': 10, 'Liabiliti': 11, 'Ekuiti': 12, 'Hasil': 13, 'Perbelanjaan': 14
};

function tambahAkaun() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const akaun = ss.getSheetByName('Akaun');
  if (!akaun) {
    ui.alert('RALAT: helaian "Akaun" tidak dijumpai.');
    return;
  }

  // Langkah 1: Jenis
  const jenisResp = ui.prompt(
    'Tambah Akaun \u2014 Langkah 1',
    'Jenis akaun? Taip salah satu:\nAset, Liabiliti, Ekuiti, Hasil, Perbelanjaan',
    ui.ButtonSet.OK_CANCEL
  );
  if (jenisResp.getSelectedButton() !== ui.Button.OK) return;
  const jenis = jenisResp.getResponseText().trim();
  if (!JENIS_RANGES.hasOwnProperty(jenis)) {
    ui.alert('RALAT: "' + jenis + '" bukan pilihan sah. Cuba lagi \u2014 taip tepat salah satu: Aset, Liabiliti, Ekuiti, Hasil, atau Perbelanjaan.');
    return;
  }

  // NEW v1.2 - Kumpulan Aliran Tunai: only asked where there is a real choice
  let kumpulan = 'Operasi';
  if (jenis === 'Aset' || jenis === 'Liabiliti' || jenis === 'Ekuiti') {
    const petunjuk = {
      'Aset': 'Bank / tunai / wang runcit = 4;  penghutang, prabayar, terakru, inventori = 1;  aset tetap, deposit tetap, pelaburan = 2',
      'Liabiliti': 'Pemiutang, terakru, belum diperoleh = 1;  pinjaman, simpanan ahli = 3;  bayaran berkanun (cukai, zakat, KWA, dividen) = 5',
      'Ekuiti': 'Modal syer / modal = 3;  rizab dan lebihan terkumpul = 4'
    }[jenis];
    const kgResp = ui.prompt(
      'Tambah Akaun - Kumpulan Aliran Tunai',
      'Pilih kumpulan (menentukan bahagian Penyata Aliran Tunai). Taip nombor:\n1 = Operasi\n2 = Pelaburan\n3 = Pembiayaan\n' +
      '4 = Tidak Berkaitan (akaun WANG: bank, tunai, wang runcit; juga rizab)\n5 = Berkanun\n\nPetunjuk untuk ' + jenis + ':\n' + petunjuk,
      ui.ButtonSet.OK_CANCEL
    );
    if (kgResp.getSelectedButton() !== ui.Button.OK) return;
    kumpulan = { '1': 'Operasi', '2': 'Pelaburan', '3': 'Pembiayaan', '4': 'Tidak Berkaitan', '5': 'Berkanun' }[kgResp.getResponseText().trim()];
    if (!kumpulan) { ui.alert('RALAT: taip nombor 1 hingga 5 sahaja. Tiada akaun ditambah.'); return; }
  }

  // Langkah 2: aktiviti perniagaan (untuk Nota sahaja, tak jejas logik kod)
  const kategoriResp = ui.prompt(
    'Tambah Akaun \u2014 Langkah 2',
    'Akaun ini untuk aktiviti apa? (cth: Runcit, Latihan, Sembelihan Ayam, atau "Am" jika pentadbiran am)',
    ui.ButtonSet.OK_CANCEL
  );
  if (kategoriResp.getSelectedButton() !== ui.Button.OK) return;
  const kategori = kategoriResp.getResponseText().trim() || 'Am';

  // Langkah 3: nama (BM)
  const namaBmResp = ui.prompt(
    'Tambah Akaun \u2014 Langkah 3',
    'Nama akaun (Bahasa Malaysia)?',
    ui.ButtonSet.OK_CANCEL
  );
  if (namaBmResp.getSelectedButton() !== ui.Button.OK) return;
  const namaBM = namaBmResp.getResponseText().trim();
  if (!namaBM) {
    ui.alert('RALAT: nama akaun tidak boleh kosong.');
    return;
  }

  // Langkah 4: nama (English), pilihan
  const namaEnResp = ui.prompt(
    'Tambah Akaun \u2014 Langkah 4',
    'Nama akaun (English)? (kosongkan untuk guna nama BM yang sama)',
    ui.ButtonSet.OK_CANCEL
  );
  if (namaEnResp.getSelectedButton() !== ui.Button.OK) return;
  const namaEN = namaEnResp.getResponseText().trim() || namaBM;

  // cari baris terakhir yang ada data + semak nama pendua, dalam julat kerja tetap
  const numRows = AKAUN_LAST_POSSIBLE_ROW - AKAUN_FIRST_ROW + 1;
  const data = akaun.getRange(AKAUN_FIRST_ROW, 1, numRows, 3).getValues(); // A:C -> kod, nama EN, nama BM
  let lastRow = AKAUN_FIRST_ROW - 1;
  let duplicateFound = false;
  const codesInRange = [];

  data.forEach(function (row, i) {
    const kod = row[0];
    const namaBmExisting = row[2];
    if (kod !== '' && kod !== null) {
      lastRow = AKAUN_FIRST_ROW + i;
      codesInRange.push(Number(kod));
    }
    if (namaBmExisting && String(namaBmExisting).trim().toLowerCase() === namaBM.toLowerCase()) {
      duplicateFound = true;
    }
  });

  if (duplicateFound) {
    const dupResp = ui.alert(
      'AMARAN',
      'Akaun bernama "' + namaBM + '" nampaknya sudah wujud. Teruskan cipta akaun baharu juga?',
      ui.ButtonSet.YES_NO
    );
    if (dupResp !== ui.Button.YES) return;
  }

  if (lastRow >= AKAUN_LAST_POSSIBLE_ROW) {
    ui.alert('RALAT: Akaun sudah sampai baris ' + AKAUN_LAST_POSSIBLE_ROW + ' (had semasa julat formula Imbangan_Duga). Lebarkan julat formula Imbangan_Duga/UR/KKK/AT dahulu sebelum tambah lagi akaun.');
    return;
  }

  const rangeStart = JENIS_RANGES[jenis];

  // scan-based fallback — this is v1.0's entire logic, kept as the
  // safety net that's always correct even if Tetapan is wrong/blank
  const inRange = codesInRange.filter(function (c) { return c >= rangeStart && c < rangeStart + 1000; });
  const scanBasedNext = inRange.length ? Math.max.apply(null, inRange) + 10 : rangeStart + 10;

  // NEW in v1.1 — read Tetapan's proposed next code and use it only
  // if it's actually safe to use (not already taken, not behind what
  // the real ledger shows). Otherwise fall back to scanBasedNext and
  // flag that Tetapan needed correcting.
  const tetapan = ss.getSheetByName('Tetapan');
  const tetapanRow = TETAPAN_NEXT_CODE_ROW[jenis];
  const tetapanRaw = tetapan ? tetapan.getRange(tetapanRow, 3).getValue() : '';
  const tetapanValue = Number(tetapanRaw);

  let nextCode;
  let tetapanWasStale = false;
  const tetapanLooksUsable = !isNaN(tetapanValue) && tetapanValue > 0 &&
    codesInRange.indexOf(tetapanValue) === -1 && tetapanValue >= scanBasedNext;

  if (tetapanLooksUsable) {
    nextCode = tetapanValue;
  } else {
    nextCode = scanBasedNext;
    tetapanWasStale = tetapan && (isNaN(tetapanValue) || tetapanValue !== scanBasedNext);
  }

  const newRow = lastRow + 1;
  akaun.getRange(newRow, 1).setValue(nextCode);
  akaun.getRange(newRow, 2).setValue(namaEN);
  akaun.getRange(newRow, 3).setValue(namaBM);
  akaun.getRange(newRow, 4).setValue(jenis);
  akaun.getRange(newRow, 5).setFormula('=IF(OR(D' + newRow + '="Aset",D' + newRow + '="Perbelanjaan"),"Debit","Kredit")');
  akaun.getRange(newRow, 6).setValue(kumpulan);
  akaun.getRange(newRow, 7).setValue('Aktif');
  akaun.getRange(newRow, 8).setValue(
    'Ditambah via Tambah Akaun (' + kategori + '), ' +
    hariIniAPZ_()
  );
  akaun.getRange(newRow, 9).setValue((jenis === 'Aset' || jenis === 'Liabiliti') ? 'Semasa' : '');

  // write the corrected next-value back so Tetapan stays live
  if (tetapan && tetapanRow) {
    tetapan.getRange(tetapanRow, 3).setValue(nextCode + 10);
  }

  ui.alert(
    'Berjaya ditambah!\n\n' +
    'Kod: ' + nextCode + '\n' +
    'Nama: ' + namaBM + ' (' + namaEN + ')\n' +
    'Jenis: ' + jenis + '\nKumpulan Aliran Tunai: ' + kumpulan + (jenis === 'Aset' && kumpulan === 'Tidak Berkaitan' ? ' (kini muncul sebagai akaun wang dalam wizard)' : '') + '\n\n' +
    'Tiada apa-apa lagi perlu dibuat \u2014 Imbangan_Duga, UR, KKK dan AT memasukkan kod ' + nextCode +
    ' sebaik sahaja transaksi pertama masuk (dalam JUMLAH; UR/KKK tiada baris bernama untuk akaun baharu - tambah baris di penyata jika mahu dipaparkan berasingan). Jika Aset/Liabiliti, semak lajur Semasa/Bukan Semasa (lajur I) \u2014 lalai "Semasa", tukar jika akaun ini sepatutnya jangka panjang.' +
    (tetapanWasStale ? '\n\nNota: Tetapan!C' + tetapanRow + ' (Kod Akaun Seterusnya \u2014 ' + jenis + ') tidak sepadan dengan Akaun sebenar, jadi kod dikira semula terus daripada helaian Akaun dan Tetapan telah dibetulkan secara automatik.' : '')
  );
}
