// APZacct v1.4 - APZacct-wizard_v1.4.js. v1.4: documents phase 1 - a Pihak step (paid to / received from), optional split across accounts, officer names, the auto-numbered PV / Resit shown on the success screen, and a red warning when the backend release differs from this page. v1.3: no logic change. v1.2: date step, time zone from Tetapan, late-entry reason, server messages shown as-is.
// ---------------------------------------------------------------
// APZacct — wizard config
// API_URL / API_SECRET / MAX_FILE_MB now live in APZacct-config_v1.4.js, loaded
// before this file in APZacct-index_v1.4.html — see that file for why. Nothing
// else on this page changes: everything below is the same wizard
// logic as before, just no longer declaring those three constants
// itself.
// ---------------------------------------------------------------

(function () {
  var state = freshState();
  var step = 0;
  var accounts = [];
  var accountsLoaded = false;
  var accountsError = '';
  var sessionEntries = [];
  var summaryOpen = false;
  var zonMasa = ZON_MASA_LALAI, tarikhKunci = '', tarikhPembukaan = '';
  var pihakList = [], versiBackend = '';

  function freshState() {
    return {
      jenis: null, kaedah: null, akaunWang: '', kategori: '',
      dariAkaun: '', keAkaun: '',
      noPV: '', tarikh: '', sebabLewat: '', jumlah: '', savedId: '', urlResitHasil: '',
      fileData: null, fileName: '', fileMime: '',
      pihakId: '', pihakNama: '', pihakJenis: '', pihakDaftar: '', butiran: '', pecah: false, baris: [],
      dikeluarkanOleh: '', direkodOleh: '', diluluskanOleh: '',
      dokNo: '', dokUrl: '', dokAmaran: '', dokPdfAmaran: '', dokRalat: ''
    };
  }

  function isKontra() { return state.jenis === 'kontra'; }

  // ---- v1.4: documents (Pihak, split across accounts, officers) ----
  var PIHAK_JENIS = ['Pembekal', 'Pelanggan', 'Ahli', 'Pekerja', 'Lain-lain'];
  function jenisDok() { return state.jenis === 'dt' ? 'RT' : 'PV'; }
  function round2(x) { return Math.round(x * 100) / 100; }
  function namaAkaun(kod) { var a = findAccount(kod); return a ? a.namaBm : String(kod || ''); }
  function pihakJenisEfektif() { return state.pihakJenis || (state.jenis === 'dt' ? 'Pelanggan' : 'Pembekal'); }
  function pihakNamaPaparan() {
    if (state.pihakId === '__baharu') return String(state.pihakNama || '').trim();
    var p = pihakList.filter(function (x) { return x.id === state.pihakId; })[0];
    return p ? p.nama : '';
  }
  function pihakPayload() {
    if (state.pihakId === '__baharu') return { baharu: { nama: String(state.pihakNama || '').trim(), jenis: pihakJenisEfektif(), noDaftar: String(state.pihakDaftar || '').trim() } };
    return { id: state.pihakId };
  }
  function barisKategori() {
    if (state.pecah) return state.baris.map(function (b) { return { kod: b.kod, jumlah: round2(Number(b.jumlah) || 0), butiran: String(b.butiran || '').trim() }; });
    return [{ kod: state.kategori, jumlah: round2(Number(state.jumlah) || 0), butiran: String(state.butiran || '').trim() }];
  }
  function ringkasKategori() { return barisKategori().map(function (b) { return namaAkaun(b.kod); }).join(', '); }
  function perkaraDok() {
    return (state.jenis === 'dt' ? 'Terimaan daripada ' : 'Bayaran kepada ') + pihakNamaPaparan() + ' - ' + (state.butiran || ringkasKategori());
  }
  function bakiPecah() {
    var j = Number(state.jumlah) || 0;
    var s = state.baris.reduce(function (t, b) { return t + (Number(b.jumlah) || 0); }, 0);
    return Math.round((j - s) * 100) / 100;
  }
  function bakiTeks(b) {
    if (Math.abs(b) < 0.005) return 'Seimbang - semua jumlah sudah diperuntukkan.';
    return b > 0 ? 'Belum diperuntukkan: RM ' + b.toFixed(2) : 'Terlebih: RM ' + Math.abs(b).toFixed(2);
  }
  function updateBaki() {
    var e = document.getElementById('split-baki');
    if (!e) return;
    var b = bakiPecah();
    e.textContent = bakiTeks(b);
    e.className = 'split-baki' + (Math.abs(b) < 0.005 ? ' ok' : '');
  }
  function splitEditorHtml() {
    var pool = accounts.filter(function (a) { return String(a.kod) !== String(state.akaunWang); });
    var rows = state.baris.map(function (b, i) {
      var opts = '<option value="">Pilih akaun...</option>' + pool.map(function (a) {
        return '<option value="' + a.kod + '"' + (String(b.kod) === String(a.kod) ? ' selected' : '') + '>' + escAttr(a.namaBm) + '</option>';
      }).join('');
      return '<div class="split-row">' +
        '<select class="split-kod" data-i="' + i + '" aria-label="Akaun baris ' + (i + 1) + '">' + opts + '</select>' +
        '<div class="split-line2">' +
        '<input class="split-but" data-i="' + i + '" type="text" maxlength="120" placeholder="Butiran (pilihan)" value="' + escAttr(b.butiran) + '">' +
        '<input class="split-jum" data-i="' + i + '" type="number" min="0" step="0.01" placeholder="0.00" value="' + escAttr(b.jumlah) + '">' +
        '</div>' +
        (state.baris.length > 1 ? '<button type="button" class="link-btn split-buang" data-i="' + i + '">Buang baris</button>' : '') +
        '</div>';
    }).join('');
    var baki = bakiPecah();
    return '<div class="split-box">' + rows +
      '<button type="button" id="split-tambah" class="btn btn-ghost btn-sm">Tambah baris</button>' +
      '<p id="split-baki" class="split-baki' + (Math.abs(baki) < 0.005 ? ' ok' : '') + '">' + bakiTeks(baki) + '</p></div>';
  }
  function amaranPegawaiTeks() {
    var k = String(state.dikeluarkanOleh || '').trim().toLowerCase(), r = String(state.direkodOleh || '').trim().toLowerCase(), l = String(state.diluluskanOleh || '').trim().toLowerCase();
    var a = [];
    if (state.jenis === 'dt' && k && r && k === r) a.push('Pengeluar resit sama dengan perekod - disimpan, tetapi ditanda untuk juruaudit.');
    if (state.jenis === 'kt') {
      if (!l) a.push('Tiada pelulus dicatat - ditanda untuk juruaudit.');
      else if (k && k === l) a.push('Penyedia baucar sama dengan pelulus - ditanda untuk juruaudit.');
    }
    return a.join(' ');
  }
  function bacaPegawai() { try { var s = window.localStorage.getItem('apzacct_pegawai'); return s ? JSON.parse(s) : {}; } catch (e) { return {}; } }
  function simpanPegawai() {
    try { window.localStorage.setItem('apzacct_pegawai', JSON.stringify({ dikeluarkanOleh: state.dikeluarkanOleh, direkodOleh: state.direkodOleh, diluluskanOleh: state.diluluskanOleh })); } catch (e) { /* storage may be blocked: the names are simply typed again */ }
  }
  function isiPegawaiLalai() {
    if (state.dikeluarkanOleh || state.direkodOleh || state.diluluskanOleh) return;
    var p = bacaPegawai();
    state.dikeluarkanOleh = p.dikeluarkanOleh || ''; state.direkodOleh = p.direkodOleh || ''; state.diluluskanOleh = p.diluluskanOleh || '';
  }
  function muatSemulaPihak() {
    fetch(API_URL + '?secret=' + encodeURIComponent(API_SECRET)).then(function (r) { return r.json(); })
      .then(function (data) { if (data && !data.error && data.pihak) pihakList = data.pihak; })
      .catch(function () { /* the list refreshes on the next page load */ });
  }

  // v1.2 - dates use the time zone from Tetapan (default Asia/Kuala_Lumpur), never raw UTC
  function tarikhHariIni() {
    try {
      var p = new Intl.DateTimeFormat('en-US', { timeZone: zonMasa || ZON_MASA_LALAI, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      var m = {}; p.forEach(function (x) { m[x.type] = x.value; });
      return m.year + '-' + m.month + '-' + m.day;
    } catch (e) {
      var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
      return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
    }
  }
  function tarikhSah(t) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
    var d = new Date(t + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t;
  }
  function isLewat() { return !!(tarikhKunci && state.tarikh && state.tarikh <= tarikhKunci); }
  function tarikhPaparan() { return (state.tarikh || '-') + (isLewat() ? ' (entri lewat)' : ''); }
  function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function clearError() { document.getElementById('error-msg').textContent = ''; }

  function optionCard(key, val, glyph, label, sub) {
    var active = state[key] === val;
    return (
      '<button type="button" class="option-card' + (active ? ' active' : '') + '" data-key="' + key + '" data-val="' + val + '">' +
      '<span class="glyph" aria-hidden="true">' + glyph + '</span>' +
      '<span><span class="label">' + label + '</span>' +
      (sub ? '<span class="sub">' + sub + '</span>' : '') +
      '</span></button>'
    );
  }

  function accountOptions(filterFn, selectedVal) {
    var pool = accounts.filter(filterFn);
    var opts = '<option value="">Pilih akaun...</option>';
    pool.forEach(function (a) {
      opts += '<option value="' + a.kod + '" ' + (String(selectedVal) === String(a.kod) ? 'selected' : '') + '>' + a.namaBm + '</option>';
    });
    return opts;
  }

  function moneyAccounts() {
    return function (a) { return a.jenis === 'Aset' && a.kumpulanAliranTunai === 'Tidak Berkaitan'; };
  }

  var ACCRUAL_KEYWORDS = ['tahunan', 'setahun', 'insurans', 'sewa', 'pendahuluan', 'advance', 'annual', 'yearly', 'deposit'];
  var accrualAcknowledged = false;

  function checkAccrualHint() {
    var haystack = ((state.noPV || '') + ' ' + (state.butiran || '') + ' ' + (state.pecah ? state.baris.map(function (b) { return namaAkaun(b.kod); }).join(' ') : ((findAccount(state.kategori) || {}).namaBm || ''))).toLowerCase();
    var hit = ACCRUAL_KEYWORDS.filter(function (k) { return haystack.indexOf(k) !== -1; })[0];
    if (!hit) return null;
    var suggestAsset = state.jenis === 'kt'; // paying out something spanning periods -> likely Prabayar; receiving -> likely Belum Diperoleh
    return {
      keyword: hit,
      suggestion: suggestAsset ? 'Perbelanjaan Prabayar' : 'Pendapatan Belum Diperoleh'
    };
  }

  function reviewRow(label, val) {
    return '<div class="review-row"><span>' + label + '</span><span>' + val + '</span></div>';
  }

  function findAccount(kod) {
    return accounts.filter(function (a) { return String(a.kod) === String(kod); })[0];
  }

  function loadingOrError() {
    if (accountsError) return '<p class="hint">Tidak dapat muatkan senarai akaun: ' + accountsError + '. Semak API_URL dan API_SECRET di APZacct-config_v1.4.js.</p>';
    return '<p class="hint">Memuatkan senarai akaun...</p>';
  }

  // ---- step definitions; visibility of some steps depends on Jenis (Kontra skips Kaedah + Kategori) ----
  var allSteps = {
    intro: {
      label: 'Langkah 1', next: 'Mula', validate: function () { return ''; },
      render: function () {
        return (
          '<div class="intro-block"><div class="intro-glyph" aria-hidden="true">&#9776;</div>' +
          '<h2>Ada kemasukan baharu?</h2>' +
          '<p class="hint">Rekod transaksi anda, langkah demi langkah.</p></div>'
        );
      }
    },
    jenis: {
      label: '',
      validate: function () { return state.jenis ? '' : 'Pilih terimaan, bayaran, atau kontra dahulu.'; },
      render: function () {
        return (
          '<h2>Jenis kemasukan?</h2>' +
          optionCard('jenis', 'dt', '&darr;', 'Terimaan (DT)', 'Wang masuk') +
          optionCard('jenis', 'kt', '&uarr;', 'Bayaran (KT)', 'Wang keluar') +
          optionCard('jenis', 'kontra', '&harr;', 'Kontra / Pindahan', 'Antara akaun wang sendiri, cth. petty ke bank')
        );
      }
    },
    kaedah: {
      label: '',
      validate: function () { return state.kaedah ? '' : 'Pilih kaedah dahulu.'; },
      render: function () {
        return (
          '<h2>Kaedah?</h2>' +
          optionCard('kaedah', 'Tunai', '&#9679;', 'Tunai', '') +
          optionCard('kaedah', 'Bank', '&#9642;', 'Bank / cek', '') +
          optionCard('kaedah', 'Online', '&#9673;', 'Online transfer', '')
        );
      }
    },
    akaunWang: {
      label: '',
      validate: function () { return state.akaunWang ? '' : 'Pilih akaun wang dahulu.'; },
      render: function () {
        if (!accountsLoaded) return loadingOrError();
        return '<h2>Akaun wang?</h2><p class="hint">Akaun yang menerima atau membayar.</p>' +
          '<select id="sel-akaunWang">' + accountOptions(moneyAccounts(), state.akaunWang) + '</select>';
      }
    },
    kategori: {
      label: '',
      validate: function () { return state.kategori ? '' : 'Pilih kategori dahulu.'; },
      render: function () {
        if (!accountsLoaded) return loadingOrError();
        return '<h2>Kategori / akaun?</h2><p class="hint">Akaun sebenar yang berkaitan transaksi ini.</p>' +
          '<select id="sel-kategori">' + accountOptions(function (a) { return String(a.kod) !== String(state.akaunWang); }, state.kategori) + '</select>';
      }
    },
    dariAkaun: {
      label: '',
      validate: function () { return state.dariAkaun ? '' : 'Pilih akaun asal dahulu.'; },
      render: function () {
        if (!accountsLoaded) return loadingOrError();
        return '<h2>Pindah DARI akaun mana?</h2>' +
          '<select id="sel-dariAkaun">' + accountOptions(moneyAccounts(), state.dariAkaun) + '</select>';
      }
    },
    keAkaun: {
      label: '',
      validate: function () {
        if (!state.keAkaun) return 'Pilih akaun destinasi dahulu.';
        if (String(state.keAkaun) === String(state.dariAkaun)) return 'Akaun destinasi tidak boleh sama dengan akaun asal.';
        return '';
      },
      render: function () {
        if (!accountsLoaded) return loadingOrError();
        return '<h2>Pindah KE akaun mana?</h2>' +
          '<select id="sel-keAkaun">' + accountOptions(function (a) { return moneyAccounts()(a) && String(a.kod) !== String(state.dariAkaun); }, state.keAkaun) + '</select>';
      }
    },
    pihak: {
      label: '',
      validate: function () {
        if (!state.pihakId) return 'Pilih pihak dahulu, atau tambah pihak baharu.';
        if (state.pihakId === '__baharu') {
          var n = String(state.pihakNama || '').trim().replace(/\s+/g, ' ');
          if (n.length < 2) return 'Isi nama pihak (sekurang-kurangnya 2 aksara).';
          var sama = pihakList.filter(function (p) { return p.nama.toLowerCase() === n.toLowerCase(); })[0];
          if (sama) return '"' + sama.nama + '" sudah ada dalam senarai - pilih daripada senarai.';
          state.pihakNama = n;
        }
        return '';
      },
      render: function () {
        if (!accountsLoaded) return loadingOrError();
        var dt = state.jenis === 'dt';
        var opts = '<option value="">Pilih...</option>';
        pihakList.forEach(function (p) {
          opts += '<option value="' + escAttr(p.id) + '"' + (state.pihakId === p.id ? ' selected' : '') + '>' + escAttr(p.nama) + (p.jenis ? ' (' + escAttr(p.jenis) + ')' : '') + '</option>';
        });
        opts += '<option value="__baharu"' + (state.pihakId === '__baharu' ? ' selected' : '') + '>+ Tambah pihak baharu</option>';
        var baharu = '';
        if (state.pihakId === '__baharu') {
          baharu =
            '<div class="sub-panel">' +
            '<label class="field-label">Nama</label>' +
            '<input id="inp-pihak-nama" type="text" maxlength="120" placeholder="Nama penuh" value="' + escAttr(state.pihakNama) + '">' +
            '<label class="field-label" style="margin-top:10px;">Jenis</label>' +
            '<select id="sel-pihak-jenis">' + PIHAK_JENIS.map(function (j) { return '<option value="' + j + '"' + (pihakJenisEfektif() === j ? ' selected' : '') + '>' + j + '</option>'; }).join('') + '</select>' +
            '<label class="field-label" style="margin-top:10px;">No. pendaftaran / IC (pilihan)</label>' +
            '<input id="inp-pihak-daftar" type="text" maxlength="40" value="' + escAttr(state.pihakDaftar) + '">' +
            '</div>';
        }
        return '<h2>' + (dt ? 'Diterima daripada siapa?' : 'Dibayar kepada siapa?') + '</h2>' +
          '<p class="hint">Nama ini dicetak pada ' + (dt ? 'resit' : 'baucar bayaran') + '.</p>' +
          '<select id="sel-pihak">' + opts + '</select>' + baharu;
      }
    },
    pvrt: {
      label: '',
      validate: function () { return ''; },
      render: function () {
        var kontra = isKontra();
        return (
          '<h2>' + (kontra ? 'No. rujukan' : 'Rujukan & butiran') + '</h2>' +
          '<p class="hint">' + (kontra
            ? 'Pilihan sahaja, cth. nombor slip deposit. Lampiran boleh dimuat naik di sini.'
            : 'Nombor ' + (state.jenis === 'dt' ? 'resit' : 'baucar') + ' dijana automatik. Rujukan luar (cth. no. invois pembekal) dan butiran adalah pilihan; lampiran boleh dimuat naik di sini.') + '</p>' +
          '<label class="field-label">' + (kontra ? 'No. rujukan' : 'Rujukan luar (pilihan)') + '</label>' +
          '<input id="inp-pv" type="text" maxlength="60" placeholder="' + (kontra ? 'Slip deposit' : 'INV-0231') + '" value="' + escAttr(state.noPV) + '">' +
          (kontra ? '' : '<label class="field-label" style="margin-top:10px;">Butiran (pilihan)</label>' +
            '<input id="inp-butiran" type="text" maxlength="160" placeholder="cth. Bil internet Disember" value="' + escAttr(state.butiran) + '">') +
          '<label class="field-label" style="margin-top:10px;">Lampiran (pilihan)</label>' +
          '<input id="inp-file" type="file" accept="image/*,.pdf">' +
          (state.fileName ? '<p class="hint">Dipilih: ' + escAttr(state.fileName) + '</p>' : '')
        );
      }
    },
    tarikh: {
      label: '',
      validate: function () {
        var t = state.tarikh || tarikhHariIni();
        if (!tarikhSah(t)) return 'Tarikh tidak sah (format YYYY-MM-DD).';
        if (tarikhPembukaan && t < tarikhPembukaan) return 'Tarikh ini (' + t + ') sebelum baki pembukaan (' + tarikhPembukaan + '). Entri tempoh lepas tidak boleh dipos dalam buku kerja ini.';
        state.tarikh = t;
        if (isLewat() && !String(state.sebabLewat || '').trim()) return 'Tarikh ini dalam tempoh yang sudah dikunci (' + tarikhKunci + '). Nyatakan sebab entri lewat dahulu.';
        return '';
      },
      render: function () {
        var t = state.tarikh || tarikhHariIni(), hari = tarikhHariIni();
        var sah = tarikhSah(t), lewat = !!(tarikhKunci && sah && t <= tarikhKunci);
        var nota = '<p class="hint">Hari ini: ' + hari + ' (zon masa ' + escAttr(zonMasa) + '). Tukar jika transaksi berlaku pada tarikh lain.</p>';
        if (sah && t > hari) nota += '<p class="hint" style="color:var(--danger);">Tarikh ini pada masa hadapan \u2014 pastikan ia memang betul.</p>';
        else if (sah && t < hari && !lewat) nota += '<p class="hint">Entri bertarikh lepas (backdated) \u2014 pastikan tarikh betul.</p>';
        var sebab = lewat
          ? '<div style="border:1.5px solid var(--accent); background:var(--accent-soft); border-radius:8px; padding:12px 14px;">' +
            '<p style="margin:0 0 8px; font-size:13px; color:var(--ink);">Tarikh ini dalam tempoh yang sudah dikunci (hingga ' + escAttr(tarikhKunci) + ') \u2014 penyata tempoh itu mungkin sudah dibentangkan. Nyatakan sebab; ia direkod dalam Log_Perubahan.</p>' +
            '<input id="inp-sebab" type="text" placeholder="Sebab entri lewat" value="' + escAttr(state.sebabLewat) + '"></div>'
          : '';
        return '<h2>Tarikh transaksi</h2>' + nota + '<input id="inp-tarikh" type="date" value="' + (sah ? t : hari) + '">' + sebab;
      }
    },
    jumlah: {
      label: '',
      next: function () { return isKontra() ? 'Semak' : 'Seterusnya'; },
      validate: function () {
        if (!(state.jumlah && Number(state.jumlah) > 0)) return 'Masukkan jumlah yang sah.';
        if (!isKontra() && state.pecah) {
          if (!state.baris.length) return 'Tambah sekurang-kurangnya satu baris.';
          for (var i = 0; i < state.baris.length; i++) {
            if (!state.baris[i].kod) return 'Baris ' + (i + 1) + ': pilih akaun.';
            if (!(Number(state.baris[i].jumlah) > 0)) return 'Baris ' + (i + 1) + ': masukkan jumlah yang sah.';
          }
          var baki = bakiPecah();
          if (Math.abs(baki) >= 0.005) return baki > 0 ? 'Masih ada RM ' + baki.toFixed(2) + ' belum diperuntukkan.' : 'Jumlah baris melebihi jumlah keseluruhan sebanyak RM ' + Math.abs(baki).toFixed(2) + '.';
        }
        return '';
      },
      render: function () {
        var html = '<h2>Jumlah (RM)</h2><input id="inp-jumlah" type="number" min="0" step="0.01" placeholder="0.00" value="' + escAttr(state.jumlah) + '">';
        if (!isKontra()) {
          html += '<label class="check-row"><input type="checkbox" id="chk-pecah"' + (state.pecah ? ' checked' : '') + '> Pecah kepada beberapa akaun</label>';
          if (state.pecah) html += splitEditorHtml();
        }
        return html;
      }
    },
    pegawai: {
      label: '',
      next: 'Semak',
      validate: function () {
        state.dikeluarkanOleh = String(state.dikeluarkanOleh || '').trim();
        state.direkodOleh = String(state.direkodOleh || '').trim();
        state.diluluskanOleh = String(state.diluluskanOleh || '').trim();
        if (state.dikeluarkanOleh.length < 2) return 'Isi nama pegawai yang ' + (state.jenis === 'dt' ? 'mengeluarkan resit' : 'menyediakan baucar') + '.';
        if (state.direkodOleh.length < 2) return 'Isi nama pegawai yang merekod entri ini.';
        simpanPegawai();
        return '';
      },
      render: function () {
        isiPegawaiLalai();
        var dt = state.jenis === 'dt';
        return '<h2>Pegawai</h2>' +
          '<p class="hint">Garis panduan kawalan dalaman SKM: pegawai yang mengeluarkan resit hendaklah berlainan daripada yang merekod. Jika sama, entri tetap disimpan tetapi ditanda untuk juruaudit.</p>' +
          '<label class="field-label">' + (dt ? 'Resit dikeluarkan oleh' : 'Baucar disediakan oleh') + '</label>' +
          '<input id="inp-keluar" type="text" maxlength="60" value="' + escAttr(state.dikeluarkanOleh) + '">' +
          '<label class="field-label" style="margin-top:10px;">Direkod oleh</label>' +
          '<input id="inp-rekod" type="text" maxlength="60" value="' + escAttr(state.direkodOleh) + '">' +
          (dt ? '' : '<label class="field-label" style="margin-top:10px;">Diluluskan oleh (pilihan)</label><input id="inp-lulus" type="text" maxlength="60" value="' + escAttr(state.diluluskanOleh) + '">') +
          '<p id="pegawai-amaran" class="hint warn">' + escAttr(amaranPegawaiTeks()) + '</p>';
      }
    },
    review: {
      label: 'Semak', next: 'Simpan',
      validate: function () {
        if (!isKontra() && !accrualAcknowledged && checkAccrualHint()) {
          return 'Pilih "Tukar kategori" atau "Teruskan juga" di atas dahulu.';
        }
        return '';
      },
      render: function () {
        var hint = (!isKontra() && !accrualAcknowledged) ? checkAccrualHint() : null;
        var hintBlock = '';
        if (hint) {
          hintBlock =
            '<div style="border:1.5px solid var(--accent); background:var(--accent-soft); border-radius:8px; padding:12px 14px; margin-bottom:10px;">' +
            '<p style="margin:0 0 8px; font-size:13px; color:var(--ink);">Perkataan "' + hint.keyword + '" dikesan \u2014 ini kelihatan seperti ia meliputi lebih daripada satu tempoh. Pertimbangkan akaun <strong>' + hint.suggestion + '</strong> supaya ia diagih ikut tempoh sebenar, bukan terus dalam bulan ini.</p>' +
            '<div style="display:flex; gap:8px;">' +
            '<button type="button" id="accrual-change-btn" class="btn btn-ghost" style="flex:1; padding:8px 10px; font-size:13px;">Tukar kategori</button>' +
            '<button type="button" id="accrual-proceed-btn" class="btn btn-ghost" style="flex:1; padding:8px 10px; font-size:13px;">Teruskan juga</button>' +
            '</div></div>';
        }
        if (isKontra()) {
          var dari = findAccount(state.dariAkaun), ke = findAccount(state.keAkaun);
          return '<h2>Semak dan simpan</h2>' + hintBlock + '<div>' +
            reviewRow('Jenis', 'Kontra / Pindahan') +
            reviewRow('Tarikh', tarikhPaparan()) +
            reviewRow('Dari akaun', dari ? dari.namaBm : state.dariAkaun) +
            reviewRow('Ke akaun', ke ? ke.namaBm : state.keAkaun) +
            reviewRow('No. rujukan', state.noPV || '-') +
            reviewRow('Lampiran', state.fileName || 'Tiada') +
            reviewRow('Jumlah', 'RM ' + Number(state.jumlah).toFixed(2)) + '</div>';
        }
        var akaunWangAcc = findAccount(state.akaunWang), dt = state.jenis === 'dt', kat = barisKategori();
        var barisRows = kat.length > 1
          ? kat.map(function (b, i) { return reviewRow('Akaun ' + (i + 1), escAttr(namaAkaun(b.kod)) + ' &mdash; RM ' + b.jumlah.toFixed(2) + (b.butiran ? ' (' + escAttr(b.butiran) + ')' : '')); }).join('')
          : reviewRow('Kategori', escAttr(namaAkaun(kat[0].kod)));
        var amaranP = amaranPegawaiTeks();
        return '<h2>Semak dan simpan</h2>' + hintBlock + '<div>' +
          reviewRow('Jenis', dt ? 'Terimaan (DT)' : 'Bayaran (KT)') +
          reviewRow('Tarikh', tarikhPaparan()) +
          reviewRow('Kaedah', state.kaedah) +
          reviewRow('Akaun wang', akaunWangAcc ? akaunWangAcc.namaBm : state.akaunWang) +
          reviewRow(dt ? 'Diterima daripada' : 'Dibayar kepada', escAttr(pihakNamaPaparan()) + (state.pihakId === '__baharu' ? ' (baharu)' : '')) +
          barisRows +
          reviewRow('Dokumen', dt ? 'Resit &mdash; nombor dijana automatik' : 'Baucar bayaran &mdash; nombor dijana automatik') +
          reviewRow('Rujukan luar', escAttr(state.noPV || '-')) +
          reviewRow('Butiran', escAttr(state.butiran || '-')) +
          reviewRow('Lampiran', escAttr(state.fileName || 'Tiada')) +
          reviewRow(dt ? 'Dikeluarkan oleh' : 'Disediakan oleh', escAttr(state.dikeluarkanOleh)) +
          reviewRow('Direkod oleh', escAttr(state.direkodOleh)) +
          (dt ? '' : reviewRow('Diluluskan oleh', escAttr(state.diluluskanOleh || '-'))) +
          reviewRow('Jumlah', 'RM ' + Number(state.jumlah).toFixed(2)) + '</div>' +
          (amaranP ? '<p class="hint warn" style="margin-top:8px;">' + escAttr(amaranP) + '</p>' : '');
      }
    },
    selesai: {
      label: 'Selesai', next: 'Tambah lagi', last: true, validate: function () { return ''; },
      render: function () {
        var uploadNote = '';
        if (state.fileName && state.urlResitHasil && String(state.urlResitHasil).indexOf('RALAT') === 0) {
          uploadNote = '<p class="hint" style="color:var(--danger);">Muat naik lampiran gagal (' + state.urlResitHasil + ') — kemasukan tetap disimpan, muat naik semula secara manual bila sempat.</p>';
        } else if (state.fileName && state.urlResitHasil) {
          uploadNote = '<p class="hint">Lampiran berjaya dimuat naik ke Drive.</p>';
        }
        return (
          '<div class="intro-block"><div class="intro-glyph" aria-hidden="true">&#10003;</div>' +
          '<h2>Berjaya disimpan</h2>' +
          '<p class="hint">ID transaksi: ' + state.savedId + '</p>' + uploadNote + '</div>' +
          dokBlok() +
          '<button type="button" id="view-summary-btn" class="btn btn-ghost" style="width:100%; margin-top:8px;">Lihat semua kemasukan sesi ini (' + sessionEntries.length + ')</button>'
        );
      }
    }
  };

  function dokBlok() {
    var h = '';
    if (state.dokNo) {
      var u = /^https:\/\//i.test(state.dokUrl || '') ? state.dokUrl : '';
      h += '<div class="dok-ok"><div class="dok-no">' + escAttr(state.dokNo) + '</div>' +
        (u ? '<a class="btn btn-primary btn-sm" href="' + escAttr(u) + '" target="_blank" rel="noopener">Buka PDF</a>'
           : '<p class="hint warn">' + escAttr(state.dokPdfAmaran || 'PDF belum dijana - buka halaman Dokumen untuk Jana PDF atau Cetak.') + '</p>') +
        (state.dokAmaran ? '<p class="hint warn">Ditanda untuk juruaudit: ' + escAttr(state.dokAmaran) + '</p>' : '') + '</div>';
    }
    if (state.dokRalat) h += '<p class="hint warn">' + escAttr(state.dokRalat) + '</p>';
    return h;
  }

  function currentFlow() {
    if (isKontra()) return ['intro', 'jenis', 'dariAkaun', 'keAkaun', 'pvrt', 'tarikh', 'jumlah', 'review', 'selesai'];
    return ['intro', 'jenis', 'kaedah', 'akaunWang', 'pihak', 'kategori', 'pvrt', 'tarikh', 'jumlah', 'pegawai', 'review', 'selesai'];
  }

  function currentStepKey() { return currentFlow()[step]; }

  function stepLabelFor(key) {
    if (key === 'intro') return allSteps.intro.label;
    if (key === 'review' || key === 'selesai') return allSteps[key].label;
    var flow = currentFlow();
    var middleSteps = flow.slice(1, flow.length - 2); // everything between intro and review/selesai
    var idx = middleSteps.indexOf(key);
    return 'Langkah ' + (idx + 2) + ' / ' + (middleSteps.length + 1);
  }

  function bind() {
    document.querySelectorAll('.option-card').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state[btn.dataset.key] = btn.dataset.val;
        clearError();
        render();
      });
    });
    ['akaunWang', 'kategori', 'dariAkaun', 'keAkaun'].forEach(function (key) {
      var sel = document.getElementById('sel-' + key);
      if (sel) sel.addEventListener('change', function (e) { state[key] = e.target.value; clearError(); });
    });
    var pv = document.getElementById('inp-pv');
    if (pv) pv.addEventListener('input', function (e) { state.noPV = e.target.value; });
    var jumlah = document.getElementById('inp-jumlah');
    if (jumlah) jumlah.addEventListener('input', function (e) { state.jumlah = e.target.value; clearError(); updateBaki(); });
    var tgl = document.getElementById('inp-tarikh');
    if (tgl) tgl.addEventListener('change', function (e) { state.tarikh = e.target.value; clearError(); render(); });
    var sbb = document.getElementById('inp-sebab');
    if (sbb) sbb.addEventListener('input', function (e) { state.sebabLewat = e.target.value; clearError(); });
    var file = document.getElementById('inp-file');
    if (file) file.addEventListener('change', handleFileSelect);
    var viewSummaryBtn = document.getElementById('view-summary-btn');
    if (viewSummaryBtn) viewSummaryBtn.addEventListener('click', openSummary);
    var accrualChangeBtn = document.getElementById('accrual-change-btn');
    if (accrualChangeBtn) accrualChangeBtn.addEventListener('click', function () {
      clearError();
      step = currentFlow().indexOf('kategori');
      render();
    });
    var accrualProceedBtn = document.getElementById('accrual-proceed-btn');
    if (accrualProceedBtn) accrualProceedBtn.addEventListener('click', function () {
      accrualAcknowledged = true;
      clearError();
      render();
    });
    // v1.4 - Pihak, description, split editor, officers
    var selPihak = document.getElementById('sel-pihak');
    if (selPihak) selPihak.addEventListener('change', function (e) { state.pihakId = e.target.value; clearError(); render(); });
    var pNama = document.getElementById('inp-pihak-nama');
    if (pNama) pNama.addEventListener('input', function (e) { state.pihakNama = e.target.value; clearError(); });
    var pJenis = document.getElementById('sel-pihak-jenis');
    if (pJenis) pJenis.addEventListener('change', function (e) { state.pihakJenis = e.target.value; });
    var pDaftar = document.getElementById('inp-pihak-daftar');
    if (pDaftar) pDaftar.addEventListener('input', function (e) { state.pihakDaftar = e.target.value; });
    var butiran = document.getElementById('inp-butiran');
    if (butiran) butiran.addEventListener('input', function (e) { state.butiran = e.target.value; });
    var chkPecah = document.getElementById('chk-pecah');
    if (chkPecah) chkPecah.addEventListener('change', function (e) {
      state.pecah = e.target.checked;
      if (state.pecah && !state.baris.length) state.baris = [{ kod: state.kategori, butiran: state.butiran || '', jumlah: state.jumlah || '' }, { kod: '', butiran: '', jumlah: '' }];
      clearError();
      render();
    });
    document.querySelectorAll('.split-kod').forEach(function (el) { el.addEventListener('change', function (e) { state.baris[Number(e.target.dataset.i)].kod = e.target.value; clearError(); }); });
    document.querySelectorAll('.split-but').forEach(function (el) { el.addEventListener('input', function (e) { state.baris[Number(e.target.dataset.i)].butiran = e.target.value; }); });
    document.querySelectorAll('.split-jum').forEach(function (el) { el.addEventListener('input', function (e) { state.baris[Number(e.target.dataset.i)].jumlah = e.target.value; clearError(); updateBaki(); }); });
    document.querySelectorAll('.split-buang').forEach(function (el) { el.addEventListener('click', function (e) { state.baris.splice(Number(e.target.dataset.i), 1); clearError(); render(); }); });
    var splitTambah = document.getElementById('split-tambah');
    if (splitTambah) splitTambah.addEventListener('click', function () { state.baris.push({ kod: '', butiran: '', jumlah: '' }); render(); });
    [['inp-keluar', 'dikeluarkanOleh'], ['inp-rekod', 'direkodOleh'], ['inp-lulus', 'diluluskanOleh']].forEach(function (p) {
      var el = document.getElementById(p[0]);
      if (el) el.addEventListener('input', function (e) {
        state[p[1]] = e.target.value; clearError();
        var wn = document.getElementById('pegawai-amaran'); if (wn) wn.textContent = amaranPegawaiTeks();
      });
    });
  }

  function handleFileSelect(e) {
    var f = e.target.files[0];
    if (!f) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      document.getElementById('error-msg').textContent = 'Fail terlalu besar (had ' + MAX_FILE_MB + 'MB).';
      e.target.value = '';
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      state.fileData = reader.result.split(',')[1]; // strip the data: prefix, keep base64 only
      state.fileMime = f.type;
      state.fileName = f.name;
      render();
    };
    reader.readAsDataURL(f);
  }

  function render() {
    var key = currentStepKey();
    var s = allSteps[key];
    document.getElementById('step-label').textContent = stepLabelFor(key);
    var flow = currentFlow();
    document.getElementById('progress-bar').style.width = Math.round(((step + 1) / flow.length) * 100) + '%';
    document.getElementById('step-content').innerHTML = s.render();
    document.getElementById('back-btn').dataset.hidden = step === 0 ? 'true' : 'false';
    var nextBtn = document.getElementById('next-btn');
    var nt = typeof s.next === 'function' ? s.next() : s.next;
    nextBtn.textContent = nt || 'Seterusnya';
    var needsAccounts = ['akaunWang', 'kategori', 'dariAkaun', 'keAkaun'].indexOf(key) !== -1;
    nextBtn.disabled = needsAccounts && !accountsLoaded;
    bind();
  }

  function buildLines() {
    var jumlah = Number(state.jumlah);
    if (isKontra()) {
      return [
        { kodAkaun: state.keAkaun, debit: jumlah, kredit: 0, memo: state.noPV || 'Kontra' },
        { kodAkaun: state.dariAkaun, debit: 0, kredit: jumlah, memo: state.noPV || 'Kontra' }
      ];
    }
    // v1.4: one money line (the total) + one line per category (several when split); every category line carries its own butiran
    var kat = barisKategori();
    var total = round2(kat.reduce(function (t, b) { return t + b.jumlah; }, 0));
    var dt = state.jenis === 'dt';
    var lines = [{ kodAkaun: state.akaunWang, debit: dt ? total : 0, kredit: dt ? 0 : total, memo: state.noPV || '' }];
    kat.forEach(function (b) {
      lines.push({ kodAkaun: b.kod, debit: dt ? 0 : b.jumlah, kredit: dt ? b.jumlah : 0, memo: b.butiran || state.noPV || '', butiran: b.butiran });
    });
    return dt ? lines : lines.slice(1).concat(lines[0]);
  }

  function saveTransaction() {
    var nextBtn = document.getElementById('next-btn');
    nextBtn.disabled = true;
    nextBtn.textContent = 'Menyimpan...';

    var payload = {
      secret: API_SECRET,
      tarikh: state.tarikh,
      sebabLewat: isLewat() ? String(state.sebabLewat || '').trim() : '',
      perkara: isKontra() ? 'Kontra / Pindahan' : perkaraDok(),
      noPV: state.noPV,
      kaedah: isKontra() ? 'Kontra' : state.kaedah,
      lines: buildLines(),
      fileData: state.fileData,
      fileMime: state.fileMime,
      fileName: state.fileName
    };
    if (!isKontra()) {
      payload.dokumen = {
        jenis: jenisDok(), akaunWang: state.akaunWang, pihak: pihakPayload(), butiran: state.butiran, rujukanLuar: state.noPV,
        dikeluarkanOleh: state.dikeluarkanOleh, direkodOleh: state.direkodOleh, diluluskanOleh: state.jenis === 'kt' ? state.diluluskanOleh : ''
      };
    }

    fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) {
          document.getElementById('error-msg').textContent = data.error;
          nextBtn.disabled = false;
          nextBtn.textContent = 'Simpan';
          return;
        }
        state.savedId = data.idTransaksi;
        state.urlResitHasil = data.urlResit || '';
        state.dokNo = data.dokumen ? data.dokumen.no : ''; state.dokUrl = data.dokumen ? (data.dokumen.urlPdf || '') : '';
        state.dokAmaran = data.dokumen ? (data.dokumen.amaran || '') : ''; state.dokPdfAmaran = data.dokumen ? (data.dokumen.amaranPdf || '') : ''; state.dokRalat = data.dokumenRalat || '';
        if (state.pihakId === '__baharu') muatSemulaPihak();
        sessionEntries.push({
          id: data.idTransaksi,
          tarikh: state.tarikh,
          jenis: isKontra() ? 'Kontra' : (state.jenis === 'dt' ? 'Terimaan' : 'Bayaran'),
          perkara: payload.perkara,
          jumlah: Number(state.jumlah),
          noPV: state.noPV || '-',
          fileName: state.fileName || 'Tiada',
          urlResitHasil: data.urlResit || '',
          dokNo: state.dokNo
        });
        step += 1;
        render();
      })
      .catch(function (err) {
        document.getElementById('error-msg').textContent = 'RALAT SAMBUNGAN: ' + err.message + '. Semak API_URL di APZacct-config_v1.4.js dan sambungan internet.';
        nextBtn.disabled = false;
        nextBtn.textContent = 'Simpan';
      });
  }

  function loadAccounts() {
    fetch(API_URL + '?secret=' + encodeURIComponent(API_SECRET))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { accountsError = data.error; return; }
        accounts = data.accounts || [];
        accountsLoaded = true;
        zonMasa = data.zonMasa || ZON_MASA_LALAI; tarikhKunci = data.tarikhKunciTempoh || ''; tarikhPembukaan = data.tarikhPembukaan || '';
        pihakList = data.pihak || []; versiBackend = data.versi || ''; apzTunjukVersiBackend('ver-backend', versiBackend);
        render();
      })
      .catch(function (err) { accountsError = err.message; render(); });
  }

  // ---- session summary overlay ----
  function openSummary() {
    summaryOpen = true;
    var rows = sessionEntries.map(function (e, i) {
      return (
        '<div style="padding:12px 0; border-bottom:1px solid var(--line);">' +
        '<div style="display:flex; justify-content:space-between; font-size:13px; color:var(--muted);">' +
        '<span>#' + (i + 1) + ' &middot; ' + e.jenis + '</span><span>' + e.id + (e.dokNo ? ' &middot; ' + e.dokNo : '') + '</span></div>' +
        '<div style="font-weight:600; margin:2px 0;">' + e.perkara + '</div>' +
        '<div style="font-size:13px; color:var(--muted);">' + e.tarikh + ' &middot; RM ' + e.jumlah.toFixed(2) + ' &middot; Rujukan: ' + e.noPV + ' &middot; Lampiran: ' + e.fileName + '</div>' +
        '</div>'
      );
    }).join('');
    var jumlahBesar = sessionEntries.reduce(function (sum, e) { return sum + e.jumlah; }, 0);
    document.getElementById('step-content').innerHTML =
      '<h2>Kemasukan sesi ini (' + sessionEntries.length + ')</h2>' +
      (sessionEntries.length ? rows : '<p class="hint">Tiada kemasukan lagi.</p>') +
      '<div class="review-row" style="margin-top:8px;"><span>Jumlah keseluruhan</span><span>RM ' + jumlahBesar.toFixed(2) + '</span></div>';
    document.getElementById('step-label').textContent = 'Ringkasan sesi';
    document.getElementById('back-btn').dataset.hidden = 'false';
    document.getElementById('next-btn').textContent = 'Tutup ringkasan';
  }

  function closeSummary() {
    summaryOpen = false;
    render();
  }

  // ---- exit ----
  function attemptExit() {
    var sure = window.confirm('Adakah anda pasti mahu keluar?');
    if (!sure) return;
    window.close();
    // window.close() is silently ignored by most browsers for tabs the user
    // opened directly (only works for tabs opened via script) — show a
    // fallback so the person isn't left staring at a button that "did nothing"
    document.getElementById('step-content').innerHTML =
      '<div class="intro-block"><h2>Selamat tinggal</h2><p class="hint">Anda boleh tutup tab/tetingkap ini dengan selamat sekarang.</p></div>';
    document.getElementById('step-label').textContent = '';
    document.getElementById('progress-bar').style.width = '0%';
    document.querySelector('.wizard-actions').style.display = 'none';
  }

  document.getElementById('next-btn').addEventListener('click', function () {
    if (summaryOpen) { closeSummary(); return; }
    var key = currentStepKey();
    var s = allSteps[key];
    var msg = s.validate();
    if (msg) { document.getElementById('error-msg').textContent = msg; return; }
    clearError();
    var flow = currentFlow();
    if (key === 'review') { saveTransaction(); return; }
    if (s.last) { state = freshState(); step = 0; accrualAcknowledged = false; } else { step = Math.min(step + 1, flow.length - 1); }
    render();
  });

  document.getElementById('back-btn').addEventListener('click', function () {
    if (summaryOpen) { closeSummary(); return; }
    clearError();
    step = Math.max(step - 1, 0);
    render();
  });

  document.getElementById('exit-btn').addEventListener('click', attemptExit);

  render();
  loadAccounts();
})();
