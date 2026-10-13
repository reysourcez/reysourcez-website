// APZacct release 1.4 - file APZacct-RekonsiliasiBank_v1.4.gs (renamed with the release number, version constant added, no logic change)
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_REKONSILIASIBANK). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — Rekonsiliasi Bank (Bank Reconciliation)
 * ---------------------------------------------------
 * v1.1 - ledger dates read from cells are formatted in the SPREADSHEET's time zone (normaliseTarikhSel_), and 'today' uses the Tetapan!C23 time zone. Before, a script time zone that differed from the sheet's could shift a ledger date by a day and break matching.
 *
 * v1.0 (new). Called by doPost in APZacct-WebAPI_v1.4.gs when the request
 * body has action: 'rekonsiliasi_bank'. Compares an OCR'd bank
 * statement against what's already posted in Baris_Transaksi for the
 * same Akaun Wang, and explains the difference the way a real
 * reconciliation does — which ledger entries haven't cleared the
 * bank yet, and which statement lines aren't in the ledger yet —
 * rather than just showing two balances that don't match and leaving
 * you to work out why by hand.
 *
 * Reuses ekstrakPenyataBank_() from APZacct-OCRPenyataBank_v1.4.gs for the
 * OCR step itself — this file only adds the ledger-side pull and the
 * matching/balance logic on top of that shared extraction.
 *
 * MATCHING DIRECTION — easy to get backwards, so spelled out here. A
 * bank statement's DEBIT column means money LEFT the account. From
 * the cooperative's own ledger, that same event is a CREDIT to the
 * bank account (an asset decreasing). So a statement debit line is
 * matched against a ledger line's KREDIT amount, and a statement
 * kredit line against a ledger line's DEBIT amount — not debit-to-
 * debit. Get this backwards and every single line looks unmatched.
 *
 * RECONCILIATION MATH, spelled out once here rather than scattered in
 * comments below: outstanding ledger items (things you've recorded
 * that the bank hasn't processed yet) mean your book and the bank
 * disagree only because of TIMING, not error — deposits you've
 * recorded make your book balance temporarily higher than the bank's
 * view, so they're SUBTRACTED when working from book toward bank;
 * payments you've recorded but the bank hasn't cleared make your book
 * temporarily lower, so they're ADDED back. Statement items you
 * haven't recorded yet (bank fees, interest) work the other way. If,
 * after all of that, there's still a difference, that's a genuine
 * unexplained gap — a real error, a duplicate, or a matching miss —
 * not a timing difference, and it's surfaced as such rather than
 * buried in the adjustment.
 *
 * MATCHING LIMITATION, also worth knowing plainly: this matches by
 * amount and closest date, not a bank reference number — statements
 * don't reliably carry one your ledger also stores. Two genuinely
 * different transactions for the exact same amount on nearby dates
 * can occasionally pair with each other instead of their true match.
 * That's a real limitation, not a hidden bug: every match this
 * produces shows which ledger transaction ID it paired with which
 * statement line, so a wrong pairing is visible on screen and
 * correctable, never silent.
 *
 * SETUP: paste alongside your other APZacct scripts. Needs
 * APZacct-OCRPenyataBank_v1.4.gs already in the same project (for
 * ekstrakPenyataBank_) and APZacct-WebAPI_v1.4.gs routing
 * action: 'rekonsiliasi_bank' to prosesRekonsiliasiBank_ (already
 * wired in the v1.3 WebAPI.gs in this same batch).
 *
 * NOTE: not yet run against a real statement + real ledger data.
 */
const APZ_VER_REKONSILIASIBANK = '1.4';

function prosesRekonsiliasiBank_(body) {
  const hasil = ekstrakPenyataBank_(body);
  if (hasil.error) return jsonOut_(hasil);

  const akaunWang = Number(body.akaunWang);
  const tarikhMula = (body.tarikhMula || '').trim();   // optional — only narrows the DISPLAY window, doesn't affect the balance-as-at-date math below
  const tarikhTamat = (body.tarikhTamat || '').trim(); // recommended — should be the statement's own closing date

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tx = ss.getSheetByName('Transaksi');
  const bt = ss.getSheetByName('Baris_Transaksi');

  const txLast = tx.getLastRow();
  const txRows = tx.getRange(5, 1, Math.max(txLast - 4, 0), 3).getValues(); // ID, Tarikh, Perkara
  const txMap = {};
  txRows.forEach(function (r) {
    if (!r[0]) return;
    const tarikh = normaliseTarikhSel_(r[1], ss);
    txMap[r[0]] = { tarikh: tarikh, perkara: r[2] };
  });

  const btLast = bt.getLastRow();
  const btRows = bt.getRange(5, 1, Math.max(btLast - 4, 0), 5).getValues(); // ID, ID Transaksi, Kod Akaun, Debit, Kredit

  // Balance-as-at-date has to include EVERYTHING up to tarikhTamat for
  // this account, even entries before tarikhMula — tarikhMula only
  // trims what's shown in the "belum clear" list below, it can't trim
  // what counts toward the running balance without producing a wrong
  // number.
  let bakiLejarPadaTarikh = 0;
  const ledgerLinesUntukPadan = [];

  btRows.forEach(function (r) {
    const idTx = r[1], kod = Number(r[2]), debit = Number(r[3]) || 0, kredit = Number(r[4]) || 0;
    if (kod !== akaunWang || !txMap[idTx]) return;
    const info = txMap[idTx];
    if (tarikhTamat && info.tarikh > tarikhTamat) return; // dated after this reconciliation — ignore entirely, not even in the balance

    bakiLejarPadaTarikh += debit - kredit;

    if (tarikhMula && info.tarikh < tarikhMula) return; // before the display window — already counted above, just not listed
    ledgerLinesUntukPadan.push({
      idTransaksi: idTx, tarikh: info.tarikh, perkara: info.perkara,
      debit: debit, kredit: kredit, dipadankan: false
    });
  });

  const statementLines = hasil.transaksi.map(function (t) {
    return {
      tarikh: t.tarikh, perkara: t.perkara, debit: Number(t.debit) || 0, kredit: Number(t.kredit) || 0,
      konsisten: !!t.konsisten, amaranKonsisten: t.amaranKonsisten || '',
      kodKategoriDicadang: t.kodKategoriDicadang, namaKategoriDicadang: t.namaKategoriDicadang,
      dipadankan: false, idTransaksiDipadankan: null
    };
  });

  padankanTransaksi_(statementLines, ledgerLinesUntukPadan);

  const belumPadanDiLejar = ledgerLinesUntukPadan.filter(function (l) { return !l.dipadankan; });
  const belumPadanDiPenyata = statementLines.filter(function (s) { return !s.dipadankan; });

  const tarikhRujukanUmur = tarikhTamat || hariIniAPZ_();
  belumPadanDiLejar.forEach(function (l) {
    l.hariTertunggak = Math.max(0, Math.round(bezaHari_(tarikhRujukanUmur, l.tarikh)));
  });

  const jumlahDepositBelumClear = belumPadanDiLejar.reduce(function (sum, l) { return sum + l.debit; }, 0);
  const jumlahBayaranBelumClear = belumPadanDiLejar.reduce(function (sum, l) { return sum + l.kredit; }, 0);
  const jumlahKreditBelumDirekod = belumPadanDiPenyata.reduce(function (sum, s) { return sum + s.kredit; }, 0);
  const jumlahDebitBelumDirekod = belumPadanDiPenyata.reduce(function (sum, s) { return sum + s.debit; }, 0);

  const barisTerakhir = hasil.transaksi[hasil.transaksi.length - 1];
  const bakiPenyataAkhir = barisTerakhir ? Number(barisTerakhir.bakiBerjalan) : null;

  let jangkaanBakiPenyata = null, selisih = null, berpadanan = null;
  if (bakiPenyataAkhir !== null && !isNaN(bakiPenyataAkhir)) {
    // book balance, adjusted toward the bank's view — see the file
    // header comment for why each term has the sign it has
    jangkaanBakiPenyata = bakiLejarPadaTarikh - jumlahDepositBelumClear + jumlahBayaranBelumClear
      + jumlahKreditBelumDirekod - jumlahDebitBelumDirekod;
    selisih = Math.round((bakiPenyataAkhir - jangkaanBakiPenyata) * 100) / 100;
    berpadanan = Math.abs(selisih) < 0.01;
  }

  return jsonOut_({
    bakiLejarPadaTarikh: Math.round(bakiLejarPadaTarikh * 100) / 100,
    bakiPenyataAkhir: bakiPenyataAkhir,
    jangkaanBakiPenyata: jangkaanBakiPenyata !== null ? Math.round(jangkaanBakiPenyata * 100) / 100 : null,
    selisih: selisih,
    berpadanan: berpadanan,
    belumPadanDiLejar: belumPadanDiLejar,
    belumPadanDiPenyata: belumPadanDiPenyata,
    bilanganDipadankan: statementLines.length - belumPadanDiPenyata.length,
    bilanganTidakKonsistenPenyata: hasil.bilanganTidakKonsisten
  });
}

// Matches by amount (opposite debit/kredit side — see file header)
// and, among same-amount candidates, closest date. Mutates both
// arrays' `dipadankan` flags in place and records
// statementLine.idTransaksiDipadankan on a successful match.
function padankanTransaksi_(statementLines, ledgerLines) {
  statementLines.forEach(function (s) {
    const jumlahDicari = s.debit > 0 ? s.debit : s.kredit;
    if (!jumlahDicari) return;
    const sisiLedger = s.debit > 0 ? 'kredit' : 'debit';

    const calon = ledgerLines.filter(function (l) {
      return !l.dipadankan && Math.abs(l[sisiLedger] - jumlahDicari) < 0.01;
    });
    if (!calon.length) return;

    calon.sort(function (a, b) {
      return Math.abs(bezaHari_(a.tarikh, s.tarikh)) - Math.abs(bezaHari_(b.tarikh, s.tarikh));
    });
    calon[0].dipadankan = true;
    s.dipadankan = true;
    s.idTransaksiDipadankan = calon[0].idTransaksi;
  });
}

function bezaHari_(a, b) {
  return (new Date(a).getTime() - new Date(b).getTime()) / 86400000;
}
