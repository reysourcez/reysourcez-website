// APZacct release 1.4 - file APZacct-JurnalLaras_v1.4.gs (renamed with the release number, version constant added, no logic change)
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_JURNALLARAS). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — Jurnal Laras v1.0 (Adjusting Journal - entries where NO money moves)
 * ---------------------------------------------------
 * v1.2 - the write runs inside the script lock (dalamKunciAPZ_), refuses to go past the ledger capacity, and grows the sheet grid if needed (helpers in APZacct-WebAPI_v1.4.gs v1.8).
 *
 * v1.1 - 'today' and the period-lock date use the Tetapan!C23 time zone (zonMasaAPZ_ / normaliseTarikhSel_ in APZacct-WebAPI_v1.4.gs v1.7).
 *
 * v1.0 (new). Menu APZacct > "Jurnal Laras (terakru / prabayar)". The web wizard always
 * has a money account (bank / tunai) on one side, so it cannot record accruals or the
 * release of prepaid / received-in-advance items. This posts exactly ONE balanced two-line
 * journal (Kaedah "Jurnal") into the same Transaksi + Baris_Transaksi sheets every other
 * posting path uses. Types 1-4 check each account has the right Jenis; money accounts
 * (Aset + Tidak Berkaitan) are refused - cash entries belong in the wizard. A period-lock
 * date in Tetapan!C21 gives a warning (never a block). A wrong journal is fixed by posting
 * the opposite journal (type 5, swap Debit/Kredit) - never by deleting rows.
 * Uses nextId_, findFirstBlankRow_, lastLineNumber_ from APZacct-WebAPI_v1.4.gs (same project).
 * NOTE: offline-tested with a mock only. Post ONE throwaway journal first and confirm
 * Imbangan_Duga stays SEIMBANG.
 * SETUP: Extensions > Apps Script > paste alongside your other APZacct scripts > Save > reload.
 */
const APZ_VER_JURNALLARAS = '1.4';

const JURNAL_KUNCI_ROW = 21;        // Tetapan!C21 = Tarikh Kunci Tempoh Kewangan (optional)
const JURNAL_FORMULA_DARI_BARIS = 501; // rows below the pre-filled helper columns need their own G/H formulas
const JURNAL_JENIS = {
  '1': { tajuk: 'Pendapatan Terakru (sudah diperoleh, belum diterima)', perkara: 'Pendapatan terakru',
         d: { peranan: 'PENDAPATAN TERAKRU (Aset, cth. 1110)', jenis: 'Aset' }, k: { peranan: 'HASIL (cth. 4050)', jenis: 'Hasil' } },
  '2': { tajuk: 'Lepas Pendapatan Terdahulu (sudah terima awal, kini diperoleh)', perkara: 'Pelepasan pendapatan terdahulu',
         d: { peranan: 'PENDAPATAN BELUM DIPEROLEH (Liabiliti, cth. 2060)', jenis: 'Liabiliti' }, k: { peranan: 'HASIL', jenis: 'Hasil' } },
  '3': { tajuk: 'Perbelanjaan Terakru (sudah digunakan, belum dibayar)', perkara: 'Perbelanjaan terakru',
         d: { peranan: 'PERBELANJAAN', jenis: 'Perbelanjaan' }, k: { peranan: 'PERBELANJAAN TERAKRU (Liabiliti, cth. 2050)', jenis: 'Liabiliti' } },
  '4': { tajuk: 'Lepas Perbelanjaan Terdahulu / Prabayar (sudah bayar awal, kini digunakan)', perkara: 'Pelepasan perbelanjaan prabayar',
         d: { peranan: 'PERBELANJAAN', jenis: 'Perbelanjaan' }, k: { peranan: 'PERBELANJAAN PRABAYAR (Aset, cth. 1100)', jenis: 'Aset' } },
  '5': { tajuk: 'Jurnal Am (dua akaun, tanpa wang - juga untuk membatalkan jurnal silap)', perkara: 'Jurnal laras',
         d: { peranan: 'akaun yang di-DEBIT', jenis: null }, k: { peranan: 'akaun yang di-KREDIT', jenis: null } }
};

function posJurnalLaras() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const akaun = ss.getSheetByName('Akaun');
  const tx = ss.getSheetByName('Transaksi');
  const bt = ss.getSheetByName('Baris_Transaksi');
  const tetapan = ss.getSheetByName('Tetapan');
  if (!akaun || !tx || !bt) { ui.alert('RALAT: helaian Akaun / Transaksi / Baris_Transaksi tidak dijumpai.'); return; }

  const akMap = {};
  akaun.getRange(5, 1, 146, 9).getValues().forEach(function (r) {   // Akaun rows 5-150
    if (r[0] !== '' && r[0] !== null) akMap[Number(r[0])] = { nama: r[2], jenis: r[3], kumpulan: r[5], status: r[6] };
  });

  const senarai = Object.keys(JURNAL_JENIS).map(function (k) { return k + ' = ' + JURNAL_JENIS[k].tajuk; }).join('\n');
  const rJenis = ui.prompt('Jurnal Laras - jenis?', 'Jurnal ini TIDAK melibatkan wang (guna wizard untuk wang masuk/keluar). Taip nombor 1-5:\n\n' + senarai, ui.ButtonSet.OK_CANCEL);
  if (rJenis.getSelectedButton() !== ui.Button.OK) return;
  const t = JURNAL_JENIS[rJenis.getResponseText().trim()];
  if (!t) { ui.alert('RALAT: taip nombor 1 hingga 5 sahaja.'); return; }

  const kodD = tanyaAkaunJurnal_(ui, akMap, t.d, 'DEBIT');
  if (kodD === null) return;
  const kodK = tanyaAkaunJurnal_(ui, akMap, t.k, 'KREDIT');
  if (kodK === null) return;
  if (kodD === kodK) { ui.alert('RALAT: akaun Debit dan Kredit tidak boleh sama.'); return; }

  const rAmaun = ui.prompt('Jumlah (RM)', 'Jumlah jurnal (RM), cth. 300 atau 300.50:', ui.ButtonSet.OK_CANCEL);
  if (rAmaun.getSelectedButton() !== ui.Button.OK) return;
  const amaun = Math.round(Number(rAmaun.getResponseText().trim().replace(',', '.')) * 100) / 100;
  if (!(amaun > 0)) { ui.alert('RALAT: jumlah mesti nombor lebih daripada 0.'); return; }

  const hariIni = hariIniAPZ_();
  const rTarikh = ui.prompt('Tarikh jurnal', 'Format YYYY-MM-DD (kosongkan = hari ini, ' + hariIni + '). Pelarasan hujung tempoh guna tarikh akhir tempoh, cth. 2026-12-31:', ui.ButtonSet.OK_CANCEL);
  if (rTarikh.getSelectedButton() !== ui.Button.OK) return;
  const tarikh = rTarikh.getResponseText().trim() || hariIni;
  if (!tarikhSahJurnal_(tarikh)) { ui.alert('RALAT: tarikh mesti sebenar dan berformat YYYY-MM-DD.'); return; }

  const rPerkara = ui.prompt('Perkara / sebab', 'Penerangan ringkas (cth. "Bil internet Dis belum dibayar"). Kosongkan = "' + t.perkara + '":', ui.ButtonSet.OK_CANCEL);
  if (rPerkara.getSelectedButton() !== ui.Button.OK) return;
  const perkara = rPerkara.getResponseText().trim() || t.perkara;

  let kunci = tetapan ? tetapan.getRange(JURNAL_KUNCI_ROW, 3).getValue() : '';
  kunci = normaliseTarikhSel_(kunci, ss);
  if (kunci && tarikh <= kunci) {
    const teruskan = ui.alert('AMARAN - TEMPOH DIKUNCI',
      'Tarikh ' + tarikh + ' berada dalam tempoh yang sudah dikunci (' + kunci + '); penyata untuk tempoh itu mungkin sudah dibentangkan. Teruskan juga?', ui.ButtonSet.YES_NO);
    if (teruskan !== ui.Button.YES) return;
  }

  const sah = ui.alert('Sahkan Sebelum Pos',
    'Tarikh: ' + tarikh + '\nPerkara: ' + perkara + '\n\nDEBIT   ' + kodD + ' ' + akMap[kodD].nama + '   RM' + amaun.toFixed(2) +
    '\nKREDIT  ' + kodK + ' ' + akMap[kodK].nama + '   RM' + amaun.toFixed(2) + '\n\nTeruskan?', ui.ButtonSet.YES_NO);
  if (sah !== ui.Button.YES) return;

  let newTxId;
  try {
    newTxId = dalamKunciAPZ_(function () {
      const id = nextId_(tx, 1, 'T-');
      const txRow = findFirstBlankRow_(tx, 1);
      let btRow = findFirstBlankRow_(bt, 2);
      if (btRow + 1 > BT_KAPASITI_BARIS) throw new Error('KAPASITI_PENUH');
      ensureBarisAPZ_(tx, txRow);
      ensureBarisAPZ_(bt, btRow + 1);
      tx.getRange(txRow, 1, 1, 7).setValues([[id, tarikh, perkara, 'JL-' + tarikh.slice(0, 4), 'Jurnal', 'Disahkan', '']]);
      let lineCounter = lastLineNumber_(bt);
      [[kodD, amaun, 0], [kodK, 0, amaun]].forEach(function (b) {
        lineCounter += 1;
        bt.getRange(btRow, 1, 1, 6).setValues([['L-' + String(lineCounter).padStart(3, '0'), id, b[0], b[1], b[2], 'Jurnal laras']]);
        if (btRow >= JURNAL_FORMULA_DARI_BARIS && btRow > BT_HELPER_LAST_ROW) {
          bt.getRange(btRow, 7).setFormula('=IF(C' + btRow + '="","",INDEX(Akaun!$F$5:$F$150,MATCH(C' + btRow + ',Akaun!$A$5:$A$150,0)))');
          bt.getRange(btRow, 8).setFormula('=IF(C' + btRow + '="","",INDEX(Akaun!$D$5:$D$150,MATCH(C' + btRow + ',Akaun!$A$5:$A$150,0)))');
        }
        btRow += 1;
      });
      return id;
    });
  } catch (err) {
    ui.alert(err && err.sibuk ? 'Sistem sibuk - pengguna lain sedang menyimpan. Cuba lagi sebentar.'
      : (String(err && err.message) === 'KAPASITI_PENUH' ? 'RALAT: lejar sudah penuh (had ' + BT_KAPASITI_BARIS + ' baris). Lebarkan julat formula dahulu.' : 'RALAT: ' + (err && err.message ? err.message : err)));
    return;
  }
  ui.alert('Berjaya dipos! ID Transaksi: ' + newTxId + '.\n\nSemak Imbangan_Duga masih SEIMBANG. Jika jurnal ini silap, jangan padam baris - pos jurnal songsang (jenis 5, tukar Debit/Kredit).');
}

function tanyaAkaunJurnal_(ui, akMap, peranan, sisi) {
  const r = ui.prompt('Akaun ' + sisi, 'Kod akaun untuk ' + peranan.peranan + ' (nombor sahaja):', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return null;
  const kod = Number(r.getResponseText().trim());
  const a = akMap[kod];
  if (!kod || !a) { ui.alert('RALAT: Kod Akaun "' + r.getResponseText().trim() + '" tidak wujud dalam Akaun.'); return null; }
  if (a.status !== 'Aktif') { ui.alert('RALAT: akaun ' + kod + ' ' + a.nama + ' tidak Aktif.'); return null; }
  if (a.jenis === 'Aset' && a.kumpulan === 'Tidak Berkaitan') {
    ui.alert('RALAT: ' + kod + ' ' + a.nama + ' ialah akaun WANG. Jurnal ini tanpa wang - guna wizard (Terimaan / Bayaran / Kontra).'); return null;
  }
  if (peranan.jenis && a.jenis !== peranan.jenis) {
    ui.alert('RALAT: ' + peranan.peranan + ' mesti akaun berjenis ' + peranan.jenis + ', tetapi ' + kod + ' ' + a.nama + ' berjenis ' + a.jenis + '.'); return null;
  }
  return kod;
}

function tarikhSahJurnal_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
