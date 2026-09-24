// ---------------------------------------------------------------
// APZacct — Rekonsiliasi Bank (bank reconciliation page)
// Reads API_URL / API_SECRET / MAX_FILE_MB from config.js, loaded
// before this file in rekonsiliasi-bank.html.
//
// v1.1 (this file) — rows in the "Belum Direkod" table (new postings
// this screen is about to create) now also get flagged when their own
// date falls on or before Tetapan!C21 ("Tarikh Kunci Tempoh
// Kewangan"), read from doGet's tarikhKunciTempoh field
// (APZacct_WebAPI.gs v1.6). Same warning-not-block treatment as
// penyata-bank.js v1.1 — pre-unchecked, tinted, still postable if
// confirmed. The "Belum Clear di Bank" table is untouched: those are
// EXISTING ledger lines already posted in a prior period, not new
// postings, so a period lock has nothing to warn about there.
// ---------------------------------------------------------------

(function () {
  var accounts = [];
  var akaunWangDipilih = '';
  var fileData = null, fileMime = '';
  var tarikhKunciTempoh = ''; // '' means no lock set — nothing gets flagged
  var belumRekod = []; // editable rows for posting: { disertakan, tarikh, perkara, debit, kredit, kodKategori, konsisten, amaranKonsisten, dalamTempohKunci }

  var HARI_AMARAN_TERTUNGGAK = 60; // ledger items outstanding longer than this get visually flagged — not an error, just worth a second look

  function moneyAccounts() {
    return function (a) { return a.jenis === 'Aset' && a.kumpulanAliranTunai === 'Tidak Berkaitan'; };
  }

  function escapeHtml_(s) {
    return String(s == null ? '' : s).replace(/"/g, '&quot;');
  }

  function fmt(n) {
    return (n === null || n === undefined || isNaN(n)) ? '\u2014' : 'RM ' + Number(n).toFixed(2);
  }

  function loadAccounts() {
    fetch(API_URL + '?secret=' + encodeURIComponent(API_SECRET))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) {
          document.getElementById('setup-error').textContent = 'Tidak dapat muatkan senarai akaun: ' + data.error;
          return;
        }
        accounts = data.accounts || [];
        tarikhKunciTempoh = data.tarikhKunciTempoh || '';
        var sel = document.getElementById('sel-akaunWang');
        var opts = '<option value="">Pilih akaun...</option>';
        accounts.filter(moneyAccounts()).forEach(function (a) {
          opts += '<option value="' + a.kod + '">' + a.namaBm + '</option>';
        });
        sel.innerHTML = opts;
      })
      .catch(function (err) {
        document.getElementById('setup-error').textContent = 'RALAT SAMBUNGAN: ' + err.message + '. Semak API_URL di config.js.';
      });
  }

  function checkCanProses() {
    document.getElementById('proses-btn').disabled = !(akaunWangDipilih && fileData);
  }

  document.getElementById('sel-akaunWang').addEventListener('change', function (e) {
    akaunWangDipilih = e.target.value;
    checkCanProses();
  });

  document.getElementById('inp-fail').addEventListener('change', function (e) {
    var f = e.target.files[0];
    document.getElementById('setup-error').textContent = '';
    if (!f) return;
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      document.getElementById('setup-error').textContent = 'Fail terlalu besar (had ' + MAX_FILE_MB + 'MB).';
      e.target.value = '';
      fileData = null;
      checkCanProses();
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      fileData = reader.result.split(',')[1];
      fileMime = f.type;
      checkCanProses();
    };
    reader.readAsDataURL(f);
  });

  document.getElementById('proses-btn').addEventListener('click', function () {
    document.getElementById('setup-error').textContent = '';
    document.getElementById('setup-block').style.display = 'none';
    document.getElementById('loading-block').style.display = '';

    fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({
        secret: API_SECRET,
        action: 'rekonsiliasi_bank',
        akaunWang: akaunWangDipilih,
        tarikhMula: document.getElementById('inp-tarikhMula').value,
        tarikhTamat: document.getElementById('inp-tarikhTamat').value,
        fileData: fileData,
        fileMime: fileMime
      })
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        document.getElementById('loading-block').style.display = 'none';
        if (data.error) {
          document.getElementById('setup-block').style.display = '';
          document.getElementById('setup-error').textContent = data.error;
          return;
        }
        renderHasil(data);
        document.getElementById('hasil-block').style.display = '';
      })
      .catch(function (err) {
        document.getElementById('loading-block').style.display = 'none';
        document.getElementById('setup-block').style.display = '';
        document.getElementById('setup-error').textContent = 'RALAT SAMBUNGAN: ' + err.message;
      });
  });

  function renderHasil(data) {
    renderRingkasan(data);
    renderBelumClear(data.belumPadanDiLejar);

    belumRekod = data.belumPadanDiPenyata.map(function (s) {
      var terkunci = !!(tarikhKunciTempoh && s.tarikh && s.tarikh <= tarikhKunciTempoh);
      return {
        disertakan: !!s.konsisten && !terkunci,
        tarikh: s.tarikh, perkara: s.perkara,
        debit: s.debit || 0, kredit: s.kredit || 0,
        kodKategori: s.kodKategoriDicadang || '',
        konsisten: !!s.konsisten, amaranKonsisten: s.amaranKonsisten || '',
        dalamTempohKunci: terkunci
      };
    });
    renderBelumRekodTable();
  }

  function renderRingkasan(data) {
    var kelas, statusTxt;
    if (data.bakiPenyataAkhir === null || data.bakiPenyataAkhir === undefined) {
      kelas = '';
      statusTxt = 'Tiada baki berjalan dikesan pada baris terakhir penyata, jadi selisih automatik tidak dapat dikira \u2014 tapi senarai di bawah masih sah untuk disemak satu-satu.';
    } else if (data.berpadanan) {
      kelas = 'seimbang';
      statusTxt = 'SEIMBANG \u2014 setiap selisih dijelaskan sepenuhnya oleh item belum clear di bawah.';
    } else {
      kelas = 'tidak-seimbang';
      statusTxt = 'TIDAK SEIMBANG \u2014 ada selisih ' + fmt(Math.abs(data.selisih)) + ' yang TIDAK dijelaskan oleh item belum clear. Kemungkinan padanan tersasar (semak ID Transaksi di bawah) atau kesilapan sebenar \u2014 bukan sekadar soal masa.';
    }

    document.getElementById('ringkasan-baki').innerHTML =
      '<div class="baki-ringkasan ' + kelas + '">' +
      '<p class="status">' + statusTxt + '</p>' +
      '<div class="review-row"><span>Baki Lejar (setakat tarikh dipilih)</span><span>' + fmt(data.bakiLejarPadaTarikh) + '</span></div>' +
      '<div class="review-row"><span>Baki Penyata (baris terakhir)</span><span>' + fmt(data.bakiPenyataAkhir) + '</span></div>' +
      '<div class="review-row"><span>Jangkaan Baki Penyata (selepas laras)</span><span>' + fmt(data.jangkaanBakiPenyata) + '</span></div>' +
      '</div>';
  }

  function renderBelumClear(rows) {
    var tbody = document.getElementById('belum-clear-tbody');
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="hint" style="padding:12px 8px;">Tiada \u2014 semua kemasukan lejar dalam tempoh ini sudah clear di penyata.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (l) {
      var lama = l.hariTertunggak > HARI_AMARAN_TERTUNGGAK;
      return (
        '<tr' + (lama ? ' class="row-amaran"' : '') + (lama ? ' title="Tertunggak lebih ' + HARI_AMARAN_TERTUNGGAK + ' hari \u2014 sahkan cek/deposit ini masih sah, bukan hilang."' : '') + '>' +
        '<td>' + escapeHtml_(l.tarikh) + '</td>' +
        '<td>' + escapeHtml_(l.perkara) + '</td>' +
        '<td>' + (l.debit ? l.debit.toFixed(2) : '') + '</td>' +
        '<td>' + (l.kredit ? l.kredit.toFixed(2) : '') + '</td>' +
        '<td>' + l.hariTertunggak + '</td>' +
        '<td>' + escapeHtml_(l.idTransaksi) + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function accountOptionsHtml(selectedKod) {
    var opts = '<option value="">Pilih...</option>';
    accounts
      .filter(function (a) { return String(a.kod) !== String(akaunWangDipilih); })
      .forEach(function (a) {
        opts += '<option value="' + a.kod + '" ' + (String(selectedKod) === String(a.kod) ? 'selected' : '') + '>' + a.namaBm + '</option>';
      });
    return opts;
  }

  function tooltipFor(t) {
    if (!t.konsisten && t.dalamTempohKunci) {
      return t.amaranKonsisten + ' JUGA: tarikh ini (' + t.tarikh + ') sudah dalam tempoh yang dikunci (' + tarikhKunciTempoh + ').';
    }
    if (t.dalamTempohKunci) {
      return 'Tarikh ini (' + t.tarikh + ') sudah dalam tempoh yang dikunci (' + tarikhKunciTempoh + ') \u2014 penyata kewangan untuk tempoh ini mungkin sudah dibentangkan. Sahkan sebelum tanda dan pos.';
    }
    return t.amaranKonsisten || '';
  }

  function renderBelumRekodTable() {
    var tbody = document.getElementById('belum-rekod-tbody');
    if (!belumRekod.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="hint" style="padding:12px 8px;">Tiada \u2014 semua baris penyata sudah sepadan dengan lejar.</td></tr>';
      return;
    }
    tbody.innerHTML = belumRekod.map(function (t, i) {
      var classes = [];
      if (!t.konsisten || t.dalamTempohKunci) classes.push('row-amaran');
      if (!t.disertakan) classes.push('row-dikecualikan');
      var rowClass = classes.length ? ' class="' + classes.join(' ') + '"' : '';
      var tip = tooltipFor(t);
      var titleAttr = tip ? ' title="' + escapeHtml_(tip) + '"' : '';
      return (
        '<tr' + rowClass + '>' +
        '<td><input type="checkbox" data-i="' + i + '" data-field="disertakan" ' + (t.disertakan ? 'checked' : '') + titleAttr + '></td>' +
        '<td><input type="text" class="cell-input" data-i="' + i + '" data-field="tarikh" value="' + escapeHtml_(t.tarikh) + '"' + titleAttr + '></td>' +
        '<td><input type="text" class="cell-input cell-perkara" data-i="' + i + '" data-field="perkara" value="' + escapeHtml_(t.perkara) + '"' + titleAttr + '></td>' +
        '<td><input type="number" step="0.01" class="cell-input cell-amaun" data-i="' + i + '" data-field="debit" value="' + t.debit + '"></td>' +
        '<td><input type="number" step="0.01" class="cell-input cell-amaun" data-i="' + i + '" data-field="kredit" value="' + t.kredit + '"></td>' +
        '<td><select class="cell-input" data-i="' + i + '" data-field="kodKategori">' + accountOptionsHtml(t.kodKategori) + '</select></td>' +
        '</tr>'
      );
    }).join('');

    document.querySelectorAll('#belum-rekod-tbody [data-field]').forEach(function (el) {
      var evt = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
      el.addEventListener(evt, function (e) {
        var i = Number(e.target.dataset.i);
        var field = e.target.dataset.field;
        belumRekod[i][field] = field === 'disertakan' ? e.target.checked : e.target.value;
        if (field === 'tarikh') {
          belumRekod[i].dalamTempohKunci = !!(tarikhKunciTempoh && belumRekod[i].tarikh && belumRekod[i].tarikh <= tarikhKunciTempoh);
          renderBelumRekodTable();
          return;
        }
        if (field === 'disertakan') {
          e.target.closest('tr').classList.toggle('row-dikecualikan', !e.target.checked);
        }
      });
    });
  }

  document.getElementById('pos-belum-rekod-btn').addEventListener('click', function () {
    var dipilih = belumRekod.filter(function (t) { return t.disertakan; });
    if (!dipilih.length) {
      document.getElementById('hasil-error').style.color = '';
      document.getElementById('hasil-error').textContent = 'Tiada baris ditanda untuk dipos.';
      return;
    }
    var tidakSah = dipilih.filter(function (t) {
      var debit = Number(t.debit) || 0, kredit = Number(t.kredit) || 0;
      return (!t.kodKategori) || (debit && kredit) || (!debit && !kredit) || !/^\d{4}-\d{2}-\d{2}$/.test(t.tarikh);
    });
    if (tidakSah.length) {
      document.getElementById('hasil-error').style.color = '';
      document.getElementById('hasil-error').textContent =
        tidakSah.length + ' baris ditanda ada masalah (tarikh bukan format YYYY-MM-DD, kategori kosong, atau debit/kredit tidak sah) \u2014 betulkan atau nyahtanda dahulu.';
      return;
    }

    document.getElementById('hasil-error').textContent = '';
    var btn = document.getElementById('pos-belum-rekod-btn');
    btn.disabled = true;

    var berjaya = 0, gagal = [];

    // Sequential on purpose, same reason as penyata-bank.js: the
    // posting endpoint scans for "the next blank row" fresh on every
    // call, so parallel posts could race and overwrite each other.
    function posSatu(idx) {
      if (idx >= dipilih.length) { selesaiPos(); return; }
      var t = dipilih[idx];
      var debit = Number(t.debit) || 0, kredit = Number(t.kredit) || 0;
      var jumlah = debit || kredit;
      var lines = kredit > 0
        ? [
            { kodAkaun: akaunWangDipilih, debit: jumlah, kredit: 0, memo: 'Rekonsiliasi Bank' },
            { kodAkaun: t.kodKategori, debit: 0, kredit: jumlah, memo: 'Rekonsiliasi Bank' }
          ]
        : [
            { kodAkaun: t.kodKategori, debit: jumlah, kredit: 0, memo: 'Rekonsiliasi Bank' },
            { kodAkaun: akaunWangDipilih, debit: 0, kredit: jumlah, memo: 'Rekonsiliasi Bank' }
          ];

      btn.textContent = 'Memproses ' + (idx + 1) + ' / ' + dipilih.length + '...';

      fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          secret: API_SECRET,
          tarikh: t.tarikh,
          perkara: t.perkara,
          noPV: 'Rekonsiliasi Bank',
          kaedah: 'Bank',
          lines: lines
        })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.error) { gagal.push({ t: t, ralat: data.error }); } else { berjaya++; }
          posSatu(idx + 1);
        })
        .catch(function (err) {
          gagal.push({ t: t, ralat: err.message });
          posSatu(idx + 1);
        });
    }

    function selesaiPos() {
      var msg = berjaya + ' daripada ' + dipilih.length + ' berjaya dipos.';
      var errEl = document.getElementById('hasil-error');
      if (gagal.length) {
        msg += ' ' + gagal.length + ' gagal \u2014 semak sambungan dan cuba tanda semula baris yang gagal.';
        errEl.style.color = 'var(--danger)';
      } else {
        errEl.style.color = 'var(--accent-dark)';
      }
      errEl.textContent = msg;
      btn.disabled = false;
      btn.textContent = 'Pos Yang Ditanda';

      // drop successfully-posted rows from the table; keep failures visible so they can be retried
      belumRekod = belumRekod.filter(function (t) {
        var wasSelected = dipilih.indexOf(t) !== -1;
        var failed = gagal.some(function (g) { return g.t === t; });
        return !wasSelected || failed;
      });
      renderBelumRekodTable();
    }

    posSatu(0);
  });

  document.getElementById('mula-semula-btn').addEventListener('click', function () {
    fileData = null; fileMime = '';
    document.getElementById('inp-fail').value = '';
    belumRekod = [];
    document.getElementById('hasil-block').style.display = 'none';
    document.getElementById('setup-block').style.display = '';
    checkCanProses();
  });

  loadAccounts();
})();
