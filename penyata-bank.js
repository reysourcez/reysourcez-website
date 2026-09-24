// ---------------------------------------------------------------
// APZacct — Import Penyata Bank (bank statement review page)
// Reads API_URL / API_SECRET / MAX_FILE_MB from config.js, loaded
// before this file in penyata-bank.html.
//
// v1.1 (this file) — rows now also get flagged when their own date
// falls on or before Tetapan!C21 ("Tarikh Kunci Tempoh Kewangan"),
// read from doGet's new tarikhKunciTempoh field (APZacct_WebAPI.gs
// v1.6). This is a WARNING, not a block — the row is pre-unchecked
// and tinted, same as an OCR-consistency flag, but can still be
// ticked and posted if that's genuinely what's needed (e.g. a
// legitimate late entry for a period that's already been reported,
// which the treasurer may still want posted with eyes open). Kept
// entirely separate from the `konsisten` flag so the tooltip always
// says which kind of warning is showing, since they mean different
// things: one is "the OCR's own arithmetic doesn't add up", the
// other is "this date has already been reported to the board".
// ---------------------------------------------------------------

(function () {
  var accounts = [];
  var akaunWangDipilih = '';
  var fileData = null, fileMime = '', fileName = '';
  var tarikhKunciTempoh = ''; // '' means no lock set — nothing gets flagged
  var hasil = []; // reviewed rows: { disertakan, tarikh, perkara, debit, kredit, kodKategori, konsisten, amaranKonsisten, dalamTempohKunci }

  function moneyAccounts() {
    return function (a) { return a.jenis === 'Aset' && a.kumpulanAliranTunai === 'Tidak Berkaitan'; };
  }

  function findAccount(kod) {
    return accounts.filter(function (a) { return String(a.kod) === String(kod); })[0];
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
        renderAkaunSelect();
      })
      .catch(function (err) {
        document.getElementById('setup-error').textContent = 'RALAT SAMBUNGAN: ' + err.message + '. Semak API_URL di config.js.';
      });
  }

  function renderAkaunSelect() {
    var sel = document.getElementById('sel-akaunWang');
    var pool = accounts.filter(moneyAccounts());
    var opts = '<option value="">Pilih akaun...</option>';
    pool.forEach(function (a) {
      opts += '<option value="' + a.kod + '">' + a.namaBm + '</option>';
    });
    sel.innerHTML = opts;
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
      fileData = reader.result.split(',')[1]; // strip the data: prefix, keep base64 only
      fileMime = f.type;
      fileName = f.name;
      checkCanProses();
    };
    reader.readAsDataURL(f);
  });

  function checkCanProses() {
    document.getElementById('proses-btn').disabled = !(akaunWangDipilih && fileData);
  }

  document.getElementById('proses-btn').addEventListener('click', function () {
    document.getElementById('setup-error').textContent = '';
    document.getElementById('setup-block').style.display = 'none';
    document.getElementById('loading-block').style.display = '';

    fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify({
        secret: API_SECRET,
        action: 'ocr_penyata_bank',
        akaunWang: akaunWangDipilih,
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
        hasil = data.transaksi.map(function (t) {
          var terkunci = !!(tarikhKunciTempoh && t.tarikh && t.tarikh <= tarikhKunciTempoh);
          return {
            // inconsistent OR locked-period rows start UNCHECKED —
            // nobody posts a flagged row by accident just by clicking
            // the main button
            disertakan: !!t.konsisten && !terkunci,
            tarikh: t.tarikh,
            perkara: t.perkara,
            debit: t.debit || 0,
            kredit: t.kredit || 0,
            kodKategori: t.kodKategoriDicadang || '',
            konsisten: !!t.konsisten,
            amaranKonsisten: t.amaranKonsisten || '',
            dalamTempohKunci: terkunci
          };
        });
        var ringkasanTxt = data.bilangan + ' transaksi dikesan';
        if (data.bilanganTidakKonsisten > 0) {
          ringkasanTxt += ', ' + data.bilanganTidakKonsisten + ' ditanda untuk disemak (tidak akan dipos sehingga anda semak dan tandakannya)';
        }
        var bilanganTerkunci = hasil.filter(function (t) { return t.dalamTempohKunci; }).length;
        if (bilanganTerkunci > 0) {
          ringkasanTxt += ', ' + bilanganTerkunci + ' bertarikh dalam tempoh yang sudah dikunci (' + tarikhKunciTempoh + ' \u2014 lihat Tetapan) dan tidak ditanda secara automatik';
        }
        if (data.dipotong) {
          ringkasanTxt += '. Nota: disekat pada ' + hasil.length + ' baris pertama sahaja untuk fail ini.';
        }
        document.getElementById('ringkasan-hasil').textContent = ringkasanTxt;
        renderTable();
        document.getElementById('hasil-block').style.display = '';
      })
      .catch(function (err) {
        document.getElementById('loading-block').style.display = 'none';
        document.getElementById('setup-block').style.display = '';
        document.getElementById('setup-error').textContent = 'RALAT SAMBUNGAN: ' + err.message;
      });
  });

  function accountOptionsHtml(selectedKod) {
    var opts = '<option value="">Pilih...</option>';
    accounts
      .filter(function (a) { return String(a.kod) !== String(akaunWangDipilih); })
      .forEach(function (a) {
        opts += '<option value="' + a.kod + '" ' + (String(selectedKod) === String(a.kod) ? 'selected' : '') + '>' + a.namaBm + '</option>';
      });
    return opts;
  }

  function rowClassFor(t) {
    var classes = [];
    if (!t.konsisten || t.dalamTempohKunci) classes.push('row-amaran');
    if (!t.disertakan) classes.push('row-dikecualikan');
    return classes.length ? ' class="' + classes.join(' ') + '"' : '';
  }

  function tooltipFor(t) {
    // distinct message per reason, since they mean different things —
    // an OCR-arithmetic warning and an already-reported-period warning
    // need different follow-up actions from the person reviewing.
    if (!t.konsisten && t.dalamTempohKunci) {
      return t.amaranKonsisten + ' JUGA: tarikh ini (' + t.tarikh + ') sudah dalam tempoh yang dikunci (' + tarikhKunciTempoh + ').';
    }
    if (t.dalamTempohKunci) {
      return 'Tarikh ini (' + t.tarikh + ') sudah dalam tempoh yang dikunci (' + tarikhKunciTempoh + ') \u2014 penyata kewangan untuk tempoh ini mungkin sudah dibentangkan. Sahkan sebelum tanda dan pos.';
    }
    return t.amaranKonsisten || '';
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s).replace(/"/g, '&quot;');
  }

  function renderTable() {
    var tbody = document.getElementById('penyata-tbody');
    tbody.innerHTML = hasil.map(function (t, i) {
      var tip = tooltipFor(t);
      var titleAttr = tip ? ' title="' + escapeAttr(tip) + '"' : '';
      return (
        '<tr' + rowClassFor(t) + '>' +
        '<td><input type="checkbox" data-i="' + i + '" data-field="disertakan" ' + (t.disertakan ? 'checked' : '') + titleAttr + '></td>' +
        '<td><input type="text" class="cell-input" data-i="' + i + '" data-field="tarikh" value="' + escapeAttr(t.tarikh) + '"' + titleAttr + '></td>' +
        '<td><input type="text" class="cell-input cell-perkara" data-i="' + i + '" data-field="perkara" value="' + escapeAttr(t.perkara) + '"' + titleAttr + '></td>' +
        '<td><input type="number" step="0.01" class="cell-input cell-amaun" data-i="' + i + '" data-field="debit" value="' + t.debit + '"></td>' +
        '<td><input type="number" step="0.01" class="cell-input cell-amaun" data-i="' + i + '" data-field="kredit" value="' + t.kredit + '"></td>' +
        '<td><select class="cell-input" data-i="' + i + '" data-field="kodKategori">' + accountOptionsHtml(t.kodKategori) + '</select></td>' +
        '</tr>'
      );
    }).join('');
    bindTableEvents();
  }

  function bindTableEvents() {
    document.querySelectorAll('#penyata-tbody [data-field]').forEach(function (el) {
      var evt = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
      el.addEventListener(evt, function (e) {
        var i = Number(e.target.dataset.i);
        var field = e.target.dataset.field;
        hasil[i][field] = field === 'disertakan' ? e.target.checked : e.target.value;
        if (field === 'tarikh') {
          hasil[i].dalamTempohKunci = !!(tarikhKunciTempoh && hasil[i].tarikh && hasil[i].tarikh <= tarikhKunciTempoh);
          renderTable();
          return;
        }
        if (field === 'disertakan') {
          e.target.closest('tr').classList.toggle('row-dikecualikan', !e.target.checked);
        }
      });
    });
  }

  document.getElementById('mula-semula-btn').addEventListener('click', resetUntukFailBaharu);

  function resetUntukFailBaharu() {
    fileData = null; fileName = ''; fileMime = '';
    document.getElementById('inp-fail').value = '';
    hasil = [];
    document.getElementById('hasil-block').style.display = 'none';
    document.getElementById('selesai-block').style.display = 'none';
    document.getElementById('setup-block').style.display = '';
    checkCanProses();
  }

  document.getElementById('pos-semua-btn').addEventListener('click', function () {
    var dipilih = hasil.filter(function (t) { return t.disertakan; });
    if (!dipilih.length) {
      document.getElementById('hasil-error').textContent = 'Tiada baris ditanda untuk dipos.';
      return;
    }
    var tidakSah = dipilih.filter(function (t) {
      var debit = Number(t.debit) || 0, kredit = Number(t.kredit) || 0;
      return (!t.kodKategori) || (debit && kredit) || (!debit && !kredit) || !/^\d{4}-\d{2}-\d{2}$/.test(t.tarikh);
    });
    if (tidakSah.length) {
      document.getElementById('hasil-error').textContent =
        tidakSah.length + ' baris ditanda ada masalah (tarikh bukan format YYYY-MM-DD, kategori kosong, atau debit/kredit tidak sah) — betulkan atau nyahtanda dahulu.';
      return;
    }

    document.getElementById('hasil-error').textContent = '';
    var btn = document.getElementById('pos-semua-btn');
    btn.disabled = true;
    document.getElementById('mula-semula-btn').disabled = true;

    var berjaya = 0, gagal = [];

    // Posted ONE AT A TIME on purpose, not in parallel. The posting
    // endpoint finds "the next blank row" by scanning Transaksi/
    // Baris_Transaksi fresh on every call — firing several of these
    // at once would race, with two requests computing the same "next
    // row" before either had written, and one silently overwriting
    // the other. Sequential is slower but correct, and it lets this
    // show real progress instead of an indefinite spinner.
    function posSatu(idx) {
      if (idx >= dipilih.length) { selesai(); return; }
      var t = dipilih[idx];
      var debit = Number(t.debit) || 0, kredit = Number(t.kredit) || 0;
      var jumlah = debit || kredit;
      var lines = kredit > 0
        ? [
            { kodAkaun: akaunWangDipilih, debit: jumlah, kredit: 0, memo: 'Import Penyata Bank' },
            { kodAkaun: t.kodKategori, debit: 0, kredit: jumlah, memo: 'Import Penyata Bank' }
          ]
        : [
            { kodAkaun: t.kodKategori, debit: jumlah, kredit: 0, memo: 'Import Penyata Bank' },
            { kodAkaun: akaunWangDipilih, debit: 0, kredit: jumlah, memo: 'Import Penyata Bank' }
          ];

      btn.textContent = 'Memproses ' + (idx + 1) + ' / ' + dipilih.length + '...';

      fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify({
          secret: API_SECRET,
          tarikh: t.tarikh,
          perkara: t.perkara,
          noPV: 'Import Penyata Bank',
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

    function selesai() {
      document.getElementById('hasil-block').style.display = 'none';
      var blok = document.getElementById('selesai-block');
      var ringkasanGagal = '';
      if (gagal.length) {
        ringkasanGagal = '<p class="hint" style="color:var(--danger);">' + gagal.length + ' baris GAGAL dipos:</p>' +
          gagal.map(function (g) {
            return '<div class="review-row"><span>' + escapeAttr(g.t.tarikh) + ' \u2014 ' + escapeAttr(g.t.perkara) + '</span><span>' + escapeAttr(g.ralat) + '</span></div>';
          }).join('');
      }
      blok.innerHTML =
        '<div class="intro-block"><div class="intro-glyph" aria-hidden="true">&#10003;</div>' +
        '<h2>Selesai</h2>' +
        '<p class="hint">' + berjaya + ' daripada ' + dipilih.length + ' transaksi berjaya dipos.</p></div>' +
        ringkasanGagal +
        '<button type="button" id="import-lain-btn" class="btn btn-ghost" style="width:100%; margin-top:12px;">Import penyata lain</button>';
      blok.style.display = '';
      document.getElementById('import-lain-btn').addEventListener('click', resetUntukFailBaharu);
    }

    posSatu(0);
  });

  loadAccounts();
})();
