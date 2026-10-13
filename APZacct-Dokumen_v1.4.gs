// APZacct release 1.4 - file APZacct-Dokumen_v1.4.gs (NEW in 1.4)
/**
 * APZacct — Dokumen (Baucar Bayaran / Resit, Pihak)  -  documents phase 1
 * ---------------------------------------------------
 * v1.4 (new). Every wizard Bayaran now makes a Baucar Bayaran (PV) and every Terimaan a Resit (RT) FROM THE SAME ENTRY - nothing is typed twice.
 * Data lives in three new sheets: Pihak (people / companies), Dokumen (one row per PV/RT) and Dokumen_Baris (its lines).
 * The ledger stays the single source of truth for money; a document is a numbered, frozen record linked to its ledger transaction (Dokumen!M).
 *
 * Rules:
 *  - Number = pattern in Tetapan!C26 (PV) / C27 (RT), default PV-{YYYY}-{NNNN} / RT-{YYYY}-{NNNN}; the sequence restarts each year when the pattern has {YYYY} or {YY}.
 *  - Numbers are assigned inside the same script lock as the ledger post, so two people cannot get the same number.
 *  - An issued document is never edited or deleted. A mistake = Batal (void): a reversing ledger entry is posted, the document is marked Batal with a reason, and a new entry (new number) is made.
 *  - Control flags (SKM internal-control circular 16/2005, segregation of duties): a receipt whose issuer = recorder, or a voucher with no approver / approver = preparer, is
 *    saved but flagged in Dokumen!U. Warn, never block (real enforcement needs sign-in).
 *  - The same HTML template feeds the PDF saved to Drive (Utilities.newBlob(html).getAs(pdf)) and the browser print view (action dokumen_html).
 *    If the PDF conversion fails the document still exists; use "Jana PDF" on the Dokumen page.
 * Needs helpers from APZacct-WebAPI_v1.4.gs: dalamKunciAPZ_, barisSeterusnyaAPZ_, ensureBarisAPZ_, normaliseTarikhSel_, zonMasaAPZ_, hariIniAPZ_, jsonOut_, getOrCreateFolder_, nextId_, lastLineNumber_.
 */
const APZ_VER_DOKUMEN = '1.4';

const DOK_SHEET = 'Dokumen';
const DOK_BARIS_SHEET = 'Dokumen_Baris';
const PIHAK_SHEET = 'Pihak';
const DOK_COLS = 25;      // Dokumen A:Y
const DOKB_COLS = 13;     // Dokumen_Baris A:M
const PIHAK_COLS = 13;    // Pihak A:M
const TETAPAN_DOK = { alamat: 24, telefon: 25, polaPV: 26, polaRT: 27 };
const DOK_POLA_LALAI = { PV: 'PV-{YYYY}-{NNNN}', RT: 'RT-{YYYY}-{NNNN}' };
const DOK_JENIS = {
  PV: { tajuk: 'BAUCAR BAYARAN', noLabel: 'No. Baucar', pihakLabel: 'Dibayar kepada', jumlahLabel: 'Jumlah dibayar', folder: 'PV' },
  RT: { tajuk: 'RESIT RASMI', noLabel: 'No. Resit', pihakLabel: 'Diterima daripada', jumlahLabel: 'Jumlah diterima', folder: 'Resit' }
};
const PIHAK_JENIS_SAH = ['Pembekal', 'Pelanggan', 'Ahli', 'Pekerja', 'Lain-lain'];
const DOK_MAKS_SENARAI = 300;
const DK = { ID: 1, JENIS: 2, TAHUN: 3, URUTAN: 4, NO: 5, TARIKH: 6, ID_PIHAK: 7, NAMA_PIHAK: 8, PERKARA: 9, JUMLAH: 10, KAEDAH: 11, AKAUN_WANG: 12, ID_TX: 13,
             STATUS: 14, KELUAR: 15, REKOD: 16, LULUS: 17, RUJUK: 18, URL_PDF: 19, DICIPTA: 20, AMARAN: 21, ID_TX_BATAL: 22, TARIKH_BATAL: 23, SEBAB_BATAL: 24, URL_PDF_BATAL: 25 };

// ---------- small helpers ----------

// Text typed by a person: trimmed, length-capped, and never allowed to start with = + - @ (a leading apostrophe would be stored literally, so a space is used) so Sheets cannot read it as a formula.
function teksSelamatAPZ_(v, maks) {
  let s = String(v === null || v === undefined ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (maks && s.length > maks) s = s.slice(0, maks);
  if (/^[=+\-@]/.test(s)) s = ' ' + s;
  return s;
}
function escHtmlAPZ_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function rmAPZ_(n) {
  const x = Math.round((Number(n) || 0) * 100) / 100;
  const neg = x < 0, abs = Math.abs(x).toFixed(2).split('.');
  return (neg ? '-' : '') + abs[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + abs[1];
}
const BULAN_BM_APZ = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'];
function tarikhBMAPZ_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? (Number(m[3]) + ' ' + BULAN_BM_APZ[Number(m[2]) - 1] + ' ' + m[1]) : String(s || '');
}

// Amount in words, Bahasa Malaysia, e.g. 1234.50 -> RINGGIT MALAYSIA SERIBU DUA RATUS TIGA PULUH EMPAT DAN SEN LIMA PULUH SAHAJA
function perkataanBMAPZ_(n) {
  const sat = ['sifar', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'lapan', 'sembilan'];
  function bawah100(x) {
    if (x < 10) return sat[x];
    if (x === 10) return 'sepuluh';
    if (x === 11) return 'sebelas';
    if (x < 20) return sat[x - 10] + ' belas';
    const p = Math.floor(x / 10), u = x % 10;
    return sat[p] + ' puluh' + (u ? ' ' + sat[u] : '');
  }
  function bawah1000(x) {
    if (x < 100) return bawah100(x);
    const r = Math.floor(x / 100), b = x % 100;
    return (r === 1 ? 'seratus' : sat[r] + ' ratus') + (b ? ' ' + bawah100(b) : '');
  }
  function nombor(x) {
    if (x === 0) return 'sifar';
    const out = [];
    const juta = Math.floor(x / 1000000), ribu = Math.floor((x % 1000000) / 1000), baki = x % 1000;
    if (juta) out.push(bawah1000(juta) + ' juta');
    if (ribu) out.push(ribu === 1 ? 'seribu' : bawah1000(ribu) + ' ribu');
    if (baki) out.push(bawah1000(baki));
    return out.join(' ');
  }
  if (n === null || n === undefined || n === '') return '';
  const x = Number(n);
  if (!Number.isFinite(x)) return '';   // never print a wrong sentence for a bad amount
  const jumlah = Math.round(x * 100);
  if (!(jumlah >= 0) || jumlah >= 1000000000 * 100) return '';
  const rm = Math.floor(jumlah / 100), sen = jumlah % 100;
  const bahagian = [];
  if (rm > 0 || sen === 0) bahagian.push('RINGGIT MALAYSIA ' + nombor(rm).toUpperCase());
  if (sen > 0) bahagian.push('SEN ' + bawah100(sen).toUpperCase());
  return bahagian.join(' DAN ') + ' SAHAJA';
}

// ---------- Pihak (parties) ----------

function pihakAktifAPZ_(ss) {
  const sh = ss.getSheetByName(PIHAK_SHEET);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 5) return [];
  return sh.getRange(5, 1, last - 4, PIHAK_COLS).getValues()
    .filter(function (r) { return r[0] !== '' && r[1] !== '' && String(r[11]) !== 'Tidak Aktif'; })
    .map(function (r) { return { id: String(r[0]), nama: String(r[1]), jenis: String(r[2] || '') }; });
}

function idBerurutAPZ_(sheet, kol, awalan) {
  const last = sheet.getLastRow();
  let maks = 0;
  if (last >= 5) {
    sheet.getRange(5, kol, last - 4, 1).getValues().forEach(function (r) {
      const v = String(r[0]);
      if (v.indexOf(awalan) === 0) { const n = parseInt(v.slice(awalan.length), 10); if (!isNaN(n) && n > maks) maks = n; }
    });
  }
  return awalan + String(maks + 1).padStart(4, '0');
}

// Inside the lock. p = { id } for an existing party or { baharu: { nama, jenis, noDaftar } } for a new one (an active party with the same name is reused, never duplicated).
function selesaikanPihakAPZ_(ss, p) {
  const sh = ss.getSheetByName(PIHAK_SHEET);
  if (!sh) return { error: 'helaian "Pihak" tidak dijumpai - guna templat v1.4' };
  const last = sh.getLastRow();
  const rows = last >= 5 ? sh.getRange(5, 1, last - 4, PIHAK_COLS).getValues() : [];
  const ke = function (r) { return { id: String(r[0]), nama: String(r[1]), jenis: String(r[2] || ''), noDaftar: String(r[3] || ''), alamat: String(r[7] || '') }; };
  if (p && p.id) {
    for (let i = 0; i < rows.length; i++) {
      if (String(rows[i][0]) === String(p.id)) {
        if (String(rows[i][11]) === 'Tidak Aktif') return { error: 'pihak ' + p.id + ' tidak Aktif' };
        return { pihak: ke(rows[i]) };
      }
    }
    return { error: 'pihak ' + p.id + ' tidak dijumpai' };
  }
  const b = (p && p.baharu) || {};
  const nama = teksSelamatAPZ_(b.nama, 120);
  if (nama.length < 2) return { error: 'nama pihak mesti sekurang-kurangnya 2 aksara' };
  const kecil = nama.toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][1]).trim().toLowerCase() === kecil && String(rows[i][11]) !== 'Tidak Aktif') return { pihak: ke(rows[i]), digunaSemula: true };
  }
  const jenis = PIHAK_JENIS_SAH.indexOf(b.jenis) !== -1 ? b.jenis : 'Lain-lain';
  const noDaftar = teksSelamatAPZ_(b.noDaftar, 40);
  const id = idBerurutAPZ_(sh, 1, 'P-');
  const baris = barisSeterusnyaAPZ_(sh, 1);
  ensureBarisAPZ_(sh, baris);
  const r = sh.getRange(baris, 1, 1, PIHAK_COLS);
  r.setNumberFormat('@');
  r.setValues([[id, nama, jenis, noDaftar, '', '', '', '', '', '', '', 'Aktif', 'Ditambah melalui wizard']]);
  return { pihak: { id: id, nama: nama, jenis: jenis, noDaftar: noDaftar, alamat: '' }, baharu: true };
}

// ---------- numbering ----------

function polaNomborAPZ_(ss, jenis) {
  const t = ss.getSheetByName('Tetapan');
  const baca = t ? String(t.getRange(jenis === 'PV' ? TETAPAN_DOK.polaPV : TETAPAN_DOK.polaRT, 3).getValue() || '').trim() : '';
  return /\{N+\}/.test(baca) ? baca : DOK_POLA_LALAI[jenis];
}
function formatNomborAPZ_(pola, tahun, urutan) {
  return pola.replace(/\{YYYY\}/g, String(tahun)).replace(/\{YY\}/g, String(tahun).slice(-2))
    .replace(/\{(N+)\}/g, function (m, n) { return String(urutan).padStart(n.length, '0'); });
}
// Inside the lock, BEFORE the ledger rows are written (the number goes into Transaksi!D).
function rancangNomborDokumenAPZ_(ss, jenis, tarikhStr) {
  const dok = ss.getSheetByName(DOK_SHEET);
  if (!dok || !ss.getSheetByName(DOK_BARIS_SHEET) || !ss.getSheetByName(PIHAK_SHEET)) {   // checked BEFORE any ledger row is written
    return { error: 'RALAT: helaian Dokumen / Dokumen_Baris / Pihak tidak lengkap - guna templat v1.4 (lihat Panduan)', kod: 'HELAIAN_DOKUMEN_TIADA' };
  }
  const tahun = Number(tarikhStr.slice(0, 4));
  const pola = polaNomborAPZ_(ss, jenis);
  const resetTahunan = /\{YY(YY)?\}/.test(pola);
  const last = dok.getLastRow();
  let maks = 0;
  if (last >= 5) {
    dok.getRange(5, DK.JENIS, last - 4, 3).getValues().forEach(function (r) {   // Jenis, Tahun, Urutan
      if (String(r[0]) === jenis && (!resetTahunan || Number(r[1]) === tahun)) { const u = Number(r[2]) || 0; if (u > maks) maks = u; }
    });
  }
  const urutan = maks + 1;
  return { jenis: jenis, tahun: tahun, urutan: urutan, no: formatNomborAPZ_(pola, tahun, urutan) };
}

// ---------- controls ----------

function amaranKawalanAPZ_(jenis, keluar, rekod, lulus) {
  const sama = function (a, b) { return !!(a && b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase()); };
  const a = [];
  if (jenis === 'RT' && sama(keluar, rekod)) a.push('Pengeluar resit sama dengan perekod');
  if (jenis === 'PV') {
    if (!lulus) a.push('Tiada pelulus dicatat');
    else if (sama(keluar, lulus)) a.push('Penyedia baucar sama dengan pelulus');
  }
  return a.join('; ');
}

// ---------- validation of the dokumen part of a post ----------

// body.dokumen = { jenis:'PV'|'RT', akaunWang, pihak:{id}|{baharu:{nama,jenis,noDaftar}}, butiran, rujukanLuar, dikeluarkanOleh, direkodOleh, diluluskanOleh }
// lines = the posted ledger lines (one money line on akaunWang + the category lines, each may carry .butiran).
function semakInputDokumenAPZ_(d, lines, ss, kaedah) {
  if (typeof d !== 'object' || d === null) return { error: 'RALAT: bahagian dokumen tidak sah', kod: 'DOKUMEN_TIDAK_SAH' };
  if (!DOK_JENIS[d.jenis]) return { error: 'RALAT: jenis dokumen mesti PV atau RT', kod: 'DOKUMEN_TIDAK_SAH' };
  if (kaedah === 'Kontra' || kaedah === 'Jurnal') return { error: 'RALAT: Kontra / Jurnal tidak mengeluarkan PV atau Resit', kod: 'DOKUMEN_TIDAK_SAH' };
  const kodWang = Number(d.akaunWang);
  if (!kodWang) return { error: 'RALAT: akaun wang bagi dokumen tidak diberi', kod: 'DOKUMEN_TIDAK_SAH' };
  const ak = ss.getSheetByName('Akaun').getRange(AKAUN_API_FIRST_ROW, 1, AKAUN_API_LAST_ROW - AKAUN_API_FIRST_ROW + 1, 9).getValues();
  let wang = null; const nama = {};
  ak.forEach(function (r) { if (r[0] !== '' && r[0] !== null) { nama[Number(r[0])] = String(r[2] || r[1] || ''); if (Number(r[0]) === kodWang) wang = r; } });
  if (!wang || wang[3] !== 'Aset' || wang[5] !== 'Tidak Berkaitan') return { error: 'RALAT: ' + kodWang + ' bukan akaun wang (Aset, Tidak Berkaitan)', kod: 'DOKUMEN_TIDAK_SAH' };
  const wangLines = lines.filter(function (l) { return Number(l.kodAkaun) === kodWang; });
  if (wangLines.length !== 1) return { error: 'RALAT: mesti ada tepat satu baris akaun wang untuk dokumen', kod: 'DOKUMEN_TIDAK_SAH' };
  const w = wangLines[0], wd = Number(w.debit) || 0, wk = Number(w.kredit) || 0;
  if (d.jenis === 'RT' && !(wd > 0 && wk === 0)) return { error: 'RALAT: Resit mesti wang MASUK (debit akaun wang)', kod: 'DOKUMEN_TIDAK_SAH' };
  if (d.jenis === 'PV' && !(wk > 0 && wd === 0)) return { error: 'RALAT: Baucar mesti wang KELUAR (kredit akaun wang)', kod: 'DOKUMEN_TIDAK_SAH' };
  const jumlah = d.jenis === 'RT' ? wd : wk;
  const baris = [];
  lines.forEach(function (l) {
    if (Number(l.kodAkaun) === kodWang) return;
    const nilai = d.jenis === 'RT' ? (Number(l.kredit) || 0) : (Number(l.debit) || 0);
    const lawan = d.jenis === 'RT' ? (Number(l.debit) || 0) : (Number(l.kredit) || 0);
    if (!(nilai > 0) || lawan !== 0) return;
    baris.push({ kod: Number(l.kodAkaun), nama: nama[Number(l.kodAkaun)] || '', butiran: teksSelamatAPZ_(l.butiran || l.memo, 120), jumlah: nilai });
  });
  if (!baris.length) return { error: 'RALAT: dokumen tiada baris kategori', kod: 'DOKUMEN_TIDAK_SAH' };
  const jumlahBaris = Math.round(baris.reduce(function (s, b) { return s + b.jumlah; }, 0) * 100);
  if (jumlahBaris !== Math.round(jumlah * 100)) return { error: 'RALAT: baris kategori tidak sepadan dengan jumlah wang - dokumen tidak dibuat', kod: 'DOKUMEN_TIDAK_SAH' };
  const pihak = d.pihak || {};
  if (!pihak.id && !(pihak.baharu && pihak.baharu.nama)) return { error: 'RALAT: pilih atau tambah pihak (dibayar kepada / diterima daripada)', kod: 'PIHAK_DIPERLUKAN' };
  const keluar = teksSelamatAPZ_(d.dikeluarkanOleh, 60), rekod = teksSelamatAPZ_(d.direkodOleh, 60), lulus = teksSelamatAPZ_(d.diluluskanOleh, 60);
  if (keluar.length < 2 || rekod.length < 2) return { error: 'RALAT: isi nama pegawai yang ' + (d.jenis === 'RT' ? 'mengeluarkan resit' : 'menyediakan baucar') + ' dan yang merekod', kod: 'PEGAWAI_DIPERLUKAN' };
  return { jenis: d.jenis, kodWang: kodWang, namaWang: nama[kodWang] || '', jumlah: Math.round(jumlah * 100) / 100, baris: baris, pihakInput: pihak,
           butiran: teksSelamatAPZ_(d.butiran, 160), rujukan: teksSelamatAPZ_(d.rujukanLuar, 60), keluar: keluar, rekod: rekod, lulus: lulus };
}

// ---------- write (inside the lock, after the ledger rows) ----------

function tulisDokumenAPZ_(ss, rancang, pihak, k, tx) {
  const dok = ss.getSheetByName(DOK_SHEET), bar = ss.getSheetByName(DOK_BARIS_SHEET);
  if (!bar) throw new Error('Helaian "Dokumen_Baris" tidak dijumpai - guna templat v1.4');
  const id = idBerurutAPZ_(dok, DK.ID, 'D-');
  const baris = barisSeterusnyaAPZ_(dok, DK.ID);
  ensureBarisAPZ_(dok, baris);
  const amaran = amaranKawalanAPZ_(k.jenis, k.keluar, k.rekod, k.lulus);
  const dicipta = Utilities.formatDate(new Date(), zonMasaAPZ_(), 'yyyy-MM-dd HH:mm:ss');
  dok.getRange(baris, DK.NAMA_PIHAK, 1, 2).setNumberFormat('@');
  dok.getRange(baris, DK.KELUAR, 1, 4).setNumberFormat('@');
  dok.getRange(baris, DK.AMARAN).setNumberFormat('@');
  dok.getRange(baris, 1, 1, DOK_COLS).setValues([[
    id, k.jenis, rancang.tahun, rancang.urutan, rancang.no, k.tarikhStr, pihak.id, pihak.nama, k.perkara, k.jumlah, k.kaedah, k.kodWang, tx,
    'Dikeluarkan', k.keluar, k.rekod, k.lulus, k.rujukan, '', dicipta, amaran, '', '', '', ''
  ]]);
  const nBar = k.baris.length;
  const mula = barisSeterusnyaAPZ_(bar, 1);
  ensureBarisAPZ_(bar, mula + nBar - 1);
  let no = 0;
  const lastB = bar.getLastRow();
  if (lastB >= 5) bar.getRange(5, 1, lastB - 4, 1).getValues().forEach(function (r) { const v = String(r[0]); if (v.indexOf('DB-') === 0) { const n = parseInt(v.slice(3), 10); if (!isNaN(n) && n > no) no = n; } });
  const isi = k.baris.map(function (b, i) {
    no += 1;
    return ['DB-' + String(no).padStart(4, '0'), id, i + 1, b.kod, b.nama, b.butiran || k.butiran || b.nama, '', '', b.jumlah, '', '', '', ''];
  });
  bar.getRange(mula, 5, nBar, 2).setNumberFormat('@');
  bar.getRange(mula, 1, nBar, DOKB_COLS).setValues(isi);
  return { id: id, no: rancang.no, jenis: k.jenis, tahun: rancang.tahun, urutan: rancang.urutan, baris: baris, amaran: amaran,
           data: dokumenObjAPZ_([id, k.jenis, rancang.tahun, rancang.urutan, rancang.no, k.tarikhStr, pihak.id, pihak.nama, k.perkara, k.jumlah, k.kaedah, k.kodWang, tx,
                                  'Dikeluarkan', k.keluar, k.rekod, k.lulus, k.rujukan, '', dicipta, amaran, '', '', '', ''], ss, k.baris.map(function (b, i) { return { bil: i + 1, kod: b.kod, nama: b.nama, butiran: b.butiran || k.butiran || b.nama, jumlah: b.jumlah }; }), pihak) };
}

function dokumenObjAPZ_(r, ss, baris, pihak) {
  return {
    id: String(r[DK.ID - 1]), jenis: String(r[DK.JENIS - 1]), no: String(r[DK.NO - 1]), tarikh: normaliseTarikhSel_(r[DK.TARIKH - 1], ss),
    idPihak: String(r[DK.ID_PIHAK - 1]), pihak: String(r[DK.NAMA_PIHAK - 1]), perkara: String(r[DK.PERKARA - 1]), jumlah: Number(r[DK.JUMLAH - 1]) || 0,
    kaedah: String(r[DK.KAEDAH - 1]), akaunWang: r[DK.AKAUN_WANG - 1], idTransaksi: String(r[DK.ID_TX - 1]), status: String(r[DK.STATUS - 1]),
    keluar: String(r[DK.KELUAR - 1]), rekod: String(r[DK.REKOD - 1]), lulus: String(r[DK.LULUS - 1]), rujukan: String(r[DK.RUJUK - 1]),
    urlPdf: String(r[DK.URL_PDF - 1] || ''), amaran: String(r[DK.AMARAN - 1] || ''), idTransaksiBatal: String(r[DK.ID_TX_BATAL - 1] || ''),
    tarikhBatal: normaliseTarikhSel_(r[DK.TARIKH_BATAL - 1], ss), sebabBatal: String(r[DK.SEBAB_BATAL - 1] || ''), urlPdfBatal: String(r[DK.URL_PDF_BATAL - 1] || ''),
    pihakDetail: pihak || null, baris: baris || []
  };
}

// ---------- reading ----------

function cariBarisDokumenAPZ_(dok, id) {
  const last = dok.getLastRow();
  if (last < 5) return 0;
  const v = dok.getRange(5, 1, last - 4, 1).getValues();
  for (let i = 0; i < v.length; i++) if (String(v[i][0]) === String(id)) return 5 + i;
  return 0;
}

function bacaDokumenAPZ_(ss, id) {
  const dok = ss.getSheetByName(DOK_SHEET), bar = ss.getSheetByName(DOK_BARIS_SHEET);
  if (!dok || !bar) return null;
  const baris = cariBarisDokumenAPZ_(dok, id);
  if (!baris) return null;
  const rec = dok.getRange(baris, 1, 1, DOK_COLS).getValues()[0];
  const lastB = bar.getLastRow();
  const lines = (lastB >= 5 ? bar.getRange(5, 1, lastB - 4, DOKB_COLS).getValues() : [])
    .filter(function (r) { return String(r[1]) === String(id); })
    .map(function (r) { return { bil: Number(r[2]) || 0, kod: r[3], nama: String(r[4] || ''), butiran: String(r[5] || ''), jumlah: Number(r[8]) || 0 }; });
  let pihakDetail = null;
  const ph = ss.getSheetByName(PIHAK_SHEET);
  if (ph && rec[DK.ID_PIHAK - 1]) {
    const lastP = ph.getLastRow();
    (lastP >= 5 ? ph.getRange(5, 1, lastP - 4, PIHAK_COLS).getValues() : []).forEach(function (r) {
      if (String(r[0]) === String(rec[DK.ID_PIHAK - 1])) pihakDetail = { id: String(r[0]), nama: String(r[1]), noDaftar: String(r[3] || ''), alamat: String(r[7] || '') };
    });
  }
  return { row: baris, d: dokumenObjAPZ_(rec, ss, lines, pihakDetail) };
}

function profilKoperasiAPZ_(ss) {
  const t = ss.getSheetByName('Tetapan');
  const baca = function (r) { return t ? String(t.getRange(r, 3).getValue() || '').trim() : ''; };
  return { nama: baca(5), noSKM: baca(6), alamat: baca(TETAPAN_DOK.alamat), telefon: baca(TETAPAN_DOK.telefon) };
}

// ---------- rendering (shared by PDF and the browser print view) ----------

// Table-based layout with inline CSS only: the Apps Script HTML-to-PDF converter handles that reliably (no flex / grid / web fonts).
function binaHtmlDokumenAPZ_(d, profil) {
  const J = DOK_JENIS[d.jenis], e = escHtmlAPZ_;
  const batal = d.status === 'Batal';
  const baris = (d.baris || []).map(function (b, i) {
    return '<tr><td style="border:1px solid #444;padding:5px 6px;text-align:center;">' + (b.bil || i + 1) + '</td>' +
      '<td style="border:1px solid #444;padding:5px 6px;">' + e(b.butiran || b.nama) + (b.nama && b.butiran && b.butiran !== b.nama ? '<br><span style="color:#555;font-size:10px;">' + e(b.nama) + '</span>' : '') + '</td>' +
      '<td style="border:1px solid #444;padding:5px 6px;text-align:center;">' + e(b.kod) + '</td>' +
      '<td style="border:1px solid #444;padding:5px 6px;text-align:right;">' + rmAPZ_(b.jumlah) + '</td></tr>';
  }).join('');
  const kaedahTeks = { Tunai: 'Tunai', Bank: 'Bank / cek', Online: 'Pindahan atas talian' }[d.kaedah] || e(d.kaedah);
  const sig = function (tajuk, nama) {
    return '<td style="width:33%;padding:0 10px;text-align:center;vertical-align:bottom;"><div style="height:46px;"></div><div style="border-top:1px solid #000;padding-top:3px;font-size:11px;">' + tajuk + '</div><div style="font-size:11px;min-height:14px;">' + (nama ? '(' + e(nama) + ')' : '&nbsp;') + '</div></td>';
  };
  const tandatangan = d.jenis === 'PV'
    ? sig('Disediakan oleh', d.keluar) + sig('Diluluskan oleh', d.lulus) + sig('Diterima oleh (penerima)', d.pihak)
    : sig('Dikeluarkan oleh', d.keluar) + '<td style="width:33%;"></td><td style="width:33%;padding:0 10px;text-align:center;vertical-align:bottom;"><div style="height:46px;"></div><div style="border-top:1px solid #000;padding-top:3px;font-size:11px;">Cop koperasi</div></td>';
  let h = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + e(d.no) + '</title></head>' +
    '<body style="margin:0;padding:26px 30px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#000;">';
  if (batal) h += '<div style="border:3px solid #b00020;color:#b00020;font-weight:bold;font-size:14px;text-align:center;padding:6px;margin-bottom:12px;">DIBATALKAN pada ' + e(tarikhBMAPZ_(d.tarikhBatal)) + ' &mdash; ' + e(d.sebabBatal) + '</div>';
  h += '<table style="width:100%;border-collapse:collapse;"><tr><td style="vertical-align:top;">' +
    '<div style="font-size:16px;font-weight:bold;">' + e(profil.nama || 'Koperasi') + '</div>' +
    (profil.noSKM ? '<div>No. Pendaftaran SKM: ' + e(profil.noSKM) + '</div>' : '') +
    (profil.alamat ? '<div>' + e(profil.alamat) + '</div>' : '') + (profil.telefon ? '<div>' + e(profil.telefon) + '</div>' : '') +
    '</td><td style="vertical-align:top;text-align:right;"><div style="border:2px solid #000;padding:6px 14px;font-size:15px;font-weight:bold;display:inline-block;">' + J.tajuk + '</div></td></tr></table>' +
    '<hr style="border:0;border-top:2px solid #000;margin:10px 0 12px;">' +
    '<table style="width:100%;border-collapse:collapse;margin-bottom:12px;">' +
    '<tr><td style="width:19%;padding:3px 0;">' + J.noLabel + '</td><td style="width:41%;padding:3px 0;font-weight:bold;">: ' + e(d.no) + '</td><td style="width:12%;padding:3px 0;">Tarikh</td><td style="padding:3px 0;">: ' + e(tarikhBMAPZ_(d.tarikh)) + '</td></tr>' +
    '<tr><td style="padding:3px 0;vertical-align:top;">' + J.pihakLabel + '</td><td colspan="3" style="padding:3px 0;">: <b>' + e(d.pihak) + '</b>' +
    (d.pihakDetail && d.pihakDetail.noDaftar ? ' (' + e(d.pihakDetail.noDaftar) + ')' : '') + (d.pihakDetail && d.pihakDetail.alamat ? '<br>&nbsp;&nbsp;' + e(d.pihakDetail.alamat) : '') + '</td></tr>' +
    '<tr><td style="padding:3px 0;">Kaedah</td><td style="padding:3px 0;">: ' + kaedahTeks + '</td><td style="padding:3px 0;">Rujukan</td><td style="padding:3px 0;">: ' + e(d.rujukan || '-') + '</td></tr></table>' +
    '<table style="width:100%;border-collapse:collapse;"><tr style="background:#e9e9e9;"><th style="border:1px solid #444;padding:5px 6px;width:7%;">Bil</th><th style="border:1px solid #444;padding:5px 6px;text-align:left;">Butiran</th>' +
    '<th style="border:1px solid #444;padding:5px 6px;width:13%;">Kod akaun</th><th style="border:1px solid #444;padding:5px 6px;width:18%;text-align:right;">Jumlah (RM)</th></tr>' + baris +
    '<tr><td colspan="3" style="border:1px solid #444;padding:6px;text-align:right;font-weight:bold;">' + J.jumlahLabel + '</td><td style="border:1px solid #444;padding:6px;text-align:right;font-weight:bold;">' + rmAPZ_(d.jumlah) + '</td></tr></table>' +
    '<p style="margin:10px 0 0;font-weight:bold;">' + e(perkataanBMAPZ_(d.jumlah)) + '</p>' +
    '<table style="width:100%;border-collapse:collapse;margin-top:26px;"><tr>' + tandatangan + '</tr></table>' +
    '<p style="margin:22px 0 0;font-size:9px;color:#777;">Dijana oleh APZacct v' + (typeof APZ_RELEASE !== 'undefined' ? APZ_RELEASE : '') + ' &middot; ID transaksi ' + e(d.idTransaksi) + ' &middot; ID dokumen ' + e(d.id) + '</p>' +
    '</body></html>';
  return h;
}

function folderDokumenAPZ_(jenis, tahun) {
  const akar = getOrCreateFolder_(DriveApp.getRootFolder(), 'APZacct - Resit & PV');
  return getOrCreateFolder_(getOrCreateFolder_(getOrCreateFolder_(akar, 'Dokumen Dijana'), DOK_JENIS[jenis].folder), String(tahun));
}

// Returns the Drive URL of the PDF, or throws (callers catch: the document must survive a failed conversion).
function simpanPdfDokumenAPZ_(d, profil, batal) {
  const html = binaHtmlDokumenAPZ_(d, profil);
  const nama = String(d.no).replace(/[\\\/:*?"<>|]/g, '-') + (batal ? ' (BATAL)' : '');
  const blob = Utilities.newBlob(html, 'text/html', nama + '.html').getAs('application/pdf');
  blob.setName(nama + '.pdf');
  return folderDokumenAPZ_(d.jenis, String(d.tarikh).slice(0, 4)).createFile(blob).getUrl();
}

// Called after the lock is released. Fills Dokumen!S (or Y when void). Never throws.
function janaPdfDanSimpanAPZ_(ss, dokumen, baris, batal) {
  try {
    const url = simpanPdfDokumenAPZ_(dokumen, profilKoperasiAPZ_(ss), batal);
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DOK_SHEET).getRange(baris, batal ? DK.URL_PDF_BATAL : DK.URL_PDF).setValue(url);
    return { url: url };
  } catch (err) {
    return { url: '', error: 'PDF tidak dapat dijana (' + (err && err.message ? err.message : err) + ') - guna Jana PDF di halaman Dokumen atau Cetak' };
  }
}

// ---------- API actions: dokumen_senarai / dokumen_html / dokumen_pdf / dokumen_batal ----------

function prosesDokumenAPZ_(body) {
  if (body.action === 'dokumen_senarai') return prosesDokumenSenaraiAPZ_();
  if (body.action === 'dokumen_html') return prosesDokumenHtmlAPZ_(body);
  if (body.action === 'dokumen_pdf') return prosesDokumenPdfAPZ_(body);
  if (body.action === 'dokumen_batal') return prosesDokumenBatalAPZ_(body);
  return jsonOut_({ error: 'RALAT: tindakan dokumen tidak dikenali', kod: 'TINDAKAN_TIDAK_DIKENALI' });
}

function prosesDokumenSenaraiAPZ_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dok = ss.getSheetByName(DOK_SHEET);
  if (!dok) return jsonOut_({ error: 'RALAT: helaian "Dokumen" tidak dijumpai - guna templat v1.4', kod: 'HELAIAN_DOKUMEN_TIADA' });
  const last = dok.getLastRow();
  if (last < 5) return jsonOut_({ dokumen: [], jumlah: 0 });
  const mula = Math.max(5, last - DOK_MAKS_SENARAI + 1);
  const baris = dok.getRange(mula, 1, last - mula + 1, DOK_COLS).getValues().filter(function (r) { return r[0] !== ''; });
  const senarai = baris.map(function (r) {
    const o = dokumenObjAPZ_(r, ss, null, null);
    delete o.baris; delete o.pihakDetail;
    return o;
  }).reverse();
  return jsonOut_({ dokumen: senarai, jumlah: senarai.length, dipotong: (mula > 5) });
}

function prosesDokumenHtmlAPZ_(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r = bacaDokumenAPZ_(ss, String(body.idDokumen || ''));
  if (!r) return jsonOut_({ error: 'RALAT: dokumen tidak dijumpai', kod: 'DOKUMEN_TIDAK_DIJUMPAI' });
  return jsonOut_({ html: binaHtmlDokumenAPZ_(r.d, profilKoperasiAPZ_(ss)), no: r.d.no });
}

function prosesDokumenPdfAPZ_(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const r = bacaDokumenAPZ_(ss, String(body.idDokumen || ''));
  if (!r) return jsonOut_({ error: 'RALAT: dokumen tidak dijumpai', kod: 'DOKUMEN_TIDAK_DIJUMPAI' });
  const batal = r.d.status === 'Batal';
  const j = janaPdfDanSimpanAPZ_(ss, r.d, r.row, batal);
  if (!j.url) return jsonOut_({ error: 'RALAT: ' + j.error, kod: 'PDF_GAGAL' });
  return jsonOut_({ status: 'BERJAYA', urlPdf: j.url, batal: batal });
}

function prosesDokumenBatalAPZ_(body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const id = String(body.idDokumen || '').trim();
  const sebab = teksSelamatAPZ_(body.sebab, 200);
  if (!id) return jsonOut_({ error: 'RALAT: idDokumen diperlukan', kod: 'DOKUMEN_TIDAK_SAH' });
  if (sebab.length < 3) return jsonOut_({ error: 'RALAT: nyatakan sebab pembatalan (sekurang-kurangnya 3 aksara)', kod: 'SEBAB_DIPERLUKAN' });
  let hasil;
  try {
    hasil = dalamKunciAPZ_(function () {
      const dok = ss.getSheetByName(DOK_SHEET), tx = ss.getSheetByName('Transaksi'), bt = ss.getSheetByName('Baris_Transaksi');
      if (!dok || !tx || !bt) return { error: 'RALAT: helaian Dokumen / Transaksi / Baris_Transaksi tidak dijumpai', kod: 'HELAIAN_TIADA' };
      const baris = cariBarisDokumenAPZ_(dok, id);
      if (!baris) return { error: 'RALAT: dokumen ' + id + ' tidak dijumpai', kod: 'DOKUMEN_TIDAK_DIJUMPAI' };
      const rec = dok.getRange(baris, 1, 1, DOK_COLS).getValues()[0];
      if (String(rec[DK.STATUS - 1]) !== 'Dikeluarkan') return { error: 'RALAT: dokumen ' + rec[DK.NO - 1] + ' sudah dibatalkan', kod: 'SUDAH_BATAL' };
      const idTx = String(rec[DK.ID_TX - 1]), no = String(rec[DK.NO - 1]);
      const btLast = bt.getLastRow();
      const asal = (btLast >= 5 ? bt.getRange(5, 1, btLast - 4, 6).getValues() : []).filter(function (r) { return String(r[1]) === idTx && r[2] !== ''; });
      if (asal.length < 2) return { error: 'RALAT: baris lejar bagi ' + idTx + ' tidak dijumpai - tiada apa dibatalkan', kod: 'LEJAR_TIDAK_DIJUMPAI' };
      const btRow = barisSeterusnyaAPZ_(bt, 2), txRow = barisSeterusnyaAPZ_(tx, 1);
      if (btRow + asal.length - 1 > BT_KAPASITI_BARIS) return { error: 'RALAT: lejar penuh - tiada ruang untuk entri songsang', kod: 'KAPASITI_PENUH' };
      ensureBarisAPZ_(tx, txRow); ensureBarisAPZ_(bt, btRow + asal.length - 1);
      const idBatal = nextId_(tx, 1, 'T-');
      const tarikh = hariIniAPZ_();
      tx.getRange(txRow, 1, 1, 7).setValues([[idBatal, tarikh, 'Pembatalan ' + no + ': ' + sebab, no, 'Jurnal', 'Disahkan', '']]);
      let kira = lastLineNumber_(bt);
      const songsang = asal.map(function (r) { kira += 1; return ['L-' + String(kira).padStart(3, '0'), idBatal, r[2], Number(r[4]) || 0, Number(r[3]) || 0, 'Pembatalan ' + no]; });
      bt.getRange(btRow, 1, songsang.length, 6).setValues(songsang);
      dok.getRange(baris, DK.SEBAB_BATAL).setNumberFormat('@');
      dok.getRange(baris, DK.STATUS).setValue('Batal');
      dok.getRange(baris, DK.ID_TX_BATAL).setValue(idBatal);
      dok.getRange(baris, DK.TARIKH_BATAL).setValue(tarikh);
      dok.getRange(baris, DK.SEBAB_BATAL).setValue(sebab);
      return { status: 'BERJAYA', idDokumen: id, noDokumen: no, idTransaksiBatal: idBatal, tarikhBatal: tarikh, _baris: baris };
    });
  } catch (err) {
    return ralatKunciAPZ_(err);
  }
  if (hasil.status !== 'BERJAYA') return jsonOut_(hasil);
  if (typeof logPerubahan_ === 'function') {
    try { logPerubahan_('Dokumen', 'N' + hasil._baris, 'Dikeluarkan', 'Batal', 'Batal ' + hasil.noDokumen + ': ' + sebab); } catch (e2) { /* audit log is best-effort */ }
  }
  const r = bacaDokumenAPZ_(ss, id);
  let urlPdfBatal = '', amaranPdf = '';
  if (r) { const j = janaPdfDanSimpanAPZ_(ss, r.d, hasil._baris, true); urlPdfBatal = j.url; amaranPdf = j.error || ''; }
  delete hasil._baris;
  hasil.urlPdfBatal = urlPdfBatal;
  if (amaranPdf) hasil.amaranPdf = amaranPdf;
  return jsonOut_(hasil);
}
