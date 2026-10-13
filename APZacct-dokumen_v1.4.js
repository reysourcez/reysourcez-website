// APZacct v1.4 - APZacct-dokumen_v1.4.js (NEW in 1.4)
// ---------------------------------------------------------------
// APZacct — Dokumen page: every PV (baucar bayaran) and Resit made by the wizard.
// Reads API_URL / API_SECRET from APZacct-config_v1.4.js, loaded before this file.
// Actions (all go to the Web App, APZacct-Dokumen_v1.4.gs):
//   dokumen_senarai  list (newest first)        dokumen_html  print view (browser Save as PDF / print)
//   dokumen_pdf      make or remake the PDF     dokumen_batal void: reversing ledger entry + status Batal (a reason is required; nothing is deleted)
// ---------------------------------------------------------------

(function () {
  var semua = [];

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function rm(n) {
    var p = (Number(n) || 0).toFixed(2).split('.');
    return 'RM ' + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + p[1];
  }
  function urlSelamat(u) { return /^https:\/\//i.test(String(u || '')) ? String(u) : ''; }
  function pesan(teks, baik) {
    var m = el('dok-mesej');
    m.textContent = teks || '';
    m.style.color = baik ? 'var(--accent-dark)' : '';
  }
  function api(body) {
    return fetch(API_URL, { method: 'POST', body: JSON.stringify(Object.assign({ secret: API_SECRET }, body)) })
      .then(function (r) { return r.json(); });
  }
  function ralatSambungan(err) { pesan('RALAT SAMBUNGAN: ' + err.message + '. Semak API_URL di APZacct-config_v1.4.js dan sambungan internet.'); }

  function muat(kekalkanMesej) {   // after an action the success message must stay visible
    if (!kekalkanMesej) pesan('');
    api({ action: 'dokumen_senarai' }).then(function (d) {
      if (d.error) { el('dok-list').innerHTML = ''; pesan(d.error); return; }
      semua = d.dokumen || [];
      papar();
    }).catch(function (err) { el('dok-list').innerHTML = ''; ralatSambungan(err); });
  }

  function tapis() {
    var j = el('tapis-jenis').value, s = el('tapis-status').value, c = el('tapis-cari').value.trim().toLowerCase();
    return semua.filter(function (d) {
      return (!j || d.jenis === j) && (!s || d.status === s) &&
        (!c || (d.no + ' ' + d.pihak + ' ' + d.perkara + ' ' + d.rujukan).toLowerCase().indexOf(c) !== -1);
    });
  }

  function kad(d) {
    var batal = d.status === 'Batal';
    var pdf = urlSelamat(batal ? d.urlPdfBatal : d.urlPdf);
    return (
      '<div class="dok-card' + (batal ? ' batal' : '') + '" data-no="' + esc(d.no) + '">' +
      '<div class="dok-top"><span class="dok-no">' + esc(d.no) + '</span><span class="badge' + (batal ? ' batal' : '') + '">' + (batal ? 'Batal' : 'Dikeluarkan') + '</span></div>' +
      '<div class="dok-meta">' + esc(d.tarikh) + ' &middot; ' + (d.jenis === 'PV' ? 'Baucar bayaran' : 'Resit') + ' &middot; ' + esc(d.kaedah) + '</div>' +
      '<div><span class="dok-amount">' + rm(d.jumlah) + '</span> &mdash; ' + esc(d.pihak) + '</div>' +
      (d.perkara ? '<div class="dok-meta">' + esc(d.perkara) + '</div>' : '') +
      (d.rujukan ? '<div class="dok-meta">Rujukan luar: ' + esc(d.rujukan) + '</div>' : '') +
      (d.amaran ? '<div class="dok-meta warn">Ditanda untuk juruaudit: ' + esc(d.amaran) + '</div>' : '') +
      (batal ? '<div class="dok-meta warn">Dibatalkan ' + esc(d.tarikhBatal) + ': ' + esc(d.sebabBatal) + ' (entri songsang ' + esc(d.idTransaksiBatal) + ')</div>' : '') +
      '<div class="dok-actions">' +
      '<button type="button" class="btn btn-primary btn-sm" data-act="cetak" data-id="' + esc(d.id) + '">Cetak</button>' +
      (pdf ? '<a class="btn btn-ghost btn-sm" href="' + esc(pdf) + '" target="_blank" rel="noopener">Buka PDF</a>'
           : '<button type="button" class="btn btn-ghost btn-sm" data-act="pdf" data-id="' + esc(d.id) + '">Jana PDF</button>') +
      (batal ? '' : '<button type="button" class="btn btn-danger btn-sm" data-act="batal" data-id="' + esc(d.id) + '" data-no="' + esc(d.no) + '">Batalkan</button>') +
      '</div></div>'
    );
  }

  function papar() {
    var senarai = tapis();
    el('dok-ringkas').textContent = semua.length
      ? senarai.length + ' daripada ' + semua.length + ' dokumen terkini dipaparkan.'
      : 'Belum ada dokumen. Buat satu Bayaran atau Terimaan di wizard dan ia akan muncul di sini.';
    el('dok-list').innerHTML = senarai.map(kad).join('');
  }

  function cetak(id) {
    pesan('');
    var w = window.open('', '_blank');   // opened straight from the click so pop-up blockers allow it
    if (!w) { pesan('Pelayar menyekat tetingkap baharu. Benarkan pop-up untuk halaman ini, kemudian cuba lagi.'); return; }
    try { w.document.write('<p style="font-family:Arial,sans-serif">Menyediakan dokumen...</p>'); } catch (e) { /* ignore */ }
    api({ action: 'dokumen_html', idDokumen: id }).then(function (d) {
      if (d.error) { try { w.close(); } catch (e) { /* ignore */ } pesan(d.error); return; }
      w.document.open(); w.document.write(d.html); w.document.close();
      setTimeout(function () { try { w.focus(); w.print(); } catch (e) { /* the person can print from the window */ } }, 400);
    }).catch(function (err) { try { w.close(); } catch (e) { /* ignore */ } ralatSambungan(err); });
  }

  function janaPdf(id, btn) {
    pesan('');
    btn.disabled = true; btn.textContent = 'Menjana...';
    api({ action: 'dokumen_pdf', idDokumen: id }).then(function (d) {
      if (d.error) { pesan(d.error + ' Anda masih boleh guna Cetak lalu pilih Save as PDF.'); btn.disabled = false; btn.textContent = 'Jana PDF'; return; }
      pesan('PDF dijana dan disimpan di Drive.', true);
      muat(true);
    }).catch(function (err) { btn.disabled = false; btn.textContent = 'Jana PDF'; ralatSambungan(err); });
  }

  function batalkan(id, no) {
    var sebab = window.prompt('Batalkan ' + no + '?\nSatu entri songsang akan dipos dalam lejar dan dokumen ditanda BATAL (tidak dipadam). Selepas itu buat entri baharu yang betul.\n\nNyatakan sebab pembatalan:');
    if (sebab === null) return;
    sebab = String(sebab).trim();
    if (sebab.length < 3) { pesan('Sebab pembatalan diperlukan (sekurang-kurangnya 3 aksara). Tiada apa dibatalkan.'); return; }
    if (!window.confirm('Sahkan batalkan ' + no + '?\nSebab: ' + sebab)) return;
    pesan('Membatalkan ' + no + '...', true);
    api({ action: 'dokumen_batal', idDokumen: id, sebab: sebab }).then(function (d) {
      if (d.error) { pesan(d.error); return; }
      pesan(no + ' dibatalkan. Entri songsang ' + d.idTransaksiBatal + ' telah dipos.' + (d.amaranPdf ? ' ' + d.amaranPdf : ''), true);
      muat(true);
    }).catch(ralatSambungan);
  }

  el('dok-list').addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
    if (!b) return;
    var act = b.getAttribute('data-act'), id = b.getAttribute('data-id');
    if (act === 'cetak') cetak(id);
    else if (act === 'pdf') janaPdf(id, b);
    else if (act === 'batal') batalkan(id, b.getAttribute('data-no'));
  });
  el('tapis-jenis').addEventListener('change', papar);
  el('tapis-status').addEventListener('change', papar);
  el('tapis-cari').addEventListener('input', papar);

  fetch(API_URL + '?secret=' + encodeURIComponent(API_SECRET))
    .then(function (r) { return r.json(); })
    .then(function (d) { apzTunjukVersiBackend('ver-backend', d && !d.error ? d.versi : ''); })
    .catch(function () { /* the list call below reports connection problems */ });

  muat();
})();
