'use strict';
// APZacct release 1.4 - file APZacct-TestFrontendJsdom_v1.4.js
/* APZacct - frontend smoke test v1.4 (jsdom, no browser needed)
 * Loads the real pages + scripts into jsdom with a mocked fetch and drives: the wizard (date step, locked-period reason, Pihak step, split across accounts, officers,
 * document success screen, Kontra unchanged, backend-version warning), the new Dokumen page (list, filters, print, PDF, void) and the bank-import page (one batch request).
 * Needs:  npm i jsdom   then  NODE_PATH=<folder with node_modules> node APZacct-TestFrontendJsdom_v1.4.js [folder with the frontend files]  */
const { JSDOM } = require('jsdom'); const vm = require('vm'), fs = require('fs');
const D = (process.argv[2] || '/mnt/user-data/outputs') + '/';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  PASS - ' : '  FAIL - ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function load(html, scripts, fetchImpl, pre) {
  const dom = new JSDOM(fs.readFileSync(D + html, 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, ''), { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window; w.fetch = fetchImpl; if (pre) pre(w);
  const ctx = dom.getInternalVMContext(); scripts.forEach(s => new vm.Script(fs.readFileSync(D + s, 'utf8'), { filename: s }).runInContext(ctx));
  return w;
}
const ACC = [{ kod: 1020, namaBm: 'Bank', jenis: 'Aset', kumpulanAliranTunai: 'Tidak Berkaitan' }, { kod: 1010, namaBm: 'Wang Di Tangan', jenis: 'Aset', kumpulanAliranTunai: 'Tidak Berkaitan' },
  { kod: 4050, namaBm: 'Pendapatan Perkhidmatan', jenis: 'Hasil', kumpulanAliranTunai: 'Operasi' }, { kod: 5010, namaBm: 'Perbelanjaan Pejabat', jenis: 'Perbelanjaan', kumpulanAliranTunai: 'Operasi' },
  { kod: 5150, namaBm: 'Internet', jenis: 'Perbelanjaan', kumpulanAliranTunai: 'Operasi' }];
const PIHAK = [{ id: 'P-0001', nama: 'Syarikat Lama Sdn Bhd', jenis: 'Pembekal' }];
const ZONE = 'Asia/Kuala_Lumpur';
const hariIni = () => { const p = {}; new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).forEach(x => p[x.type] = x.value); return p.year + '-' + p.month + '-' + p.day; };
const json = o => Promise.resolve({ json: () => Promise.resolve(o) });
const GET = extra => Object.assign({ accounts: ACC, tarikhKunciTempoh: '2026-03-31', zonMasa: ZONE, tarikhPembukaan: '2026-01-01', versi: '1.4', pihak: PIHAK }, extra || {});
const POST_OK = { status: 'BERJAYA', idTransaksi: 'T-0009', urlResit: '', dokumen: { id: 'D-0001', no: 'PV-2026-0001', jenis: 'PV', urlPdf: 'https://drive.test/PV-2026-0001.pdf', amaran: '' } };

async function mkWizard(opts) {
  opts = opts || {};
  const calls = []; calls.gets = 0;
  const fetchW = (url, opt) => opt ? (calls.push(JSON.parse(opt.body)), json(opts.post || POST_OK)) : (calls.gets++, json(opts.get ? opts.get : GET()));
  const w = load('APZacct-index_v1.4.html', ['APZacct-config_v1.4.js', 'APZacct-wizard_v1.4.js'], fetchW); await sleep(30);
  const $ = id => w.document.getElementById(id);
  const X = { w, $, calls,
    text: () => $('step-content').textContent, err: () => $('error-msg').textContent,
    click: el => el.dispatchEvent(new w.Event('click', { bubbles: true })),
    change: (el, v) => { el.value = v; el.dispatchEvent(new w.Event('change', { bubbles: true })); },
    input: (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); },
    check: (el, on) => { el.checked = on; el.dispatchEvent(new w.Event('change', { bubbles: true })); },
    next: async () => { X.click($('next-btn')); await sleep(8); },
    card: v => X.click(w.document.querySelector('.option-card[data-val="' + v + '"]')) };
  return X;
}

(async () => {
  console.log('=== wizard: Bayaran with a new party, split across two accounts, officers ===');
  let A = await mkWizard(); const $ = A.$;
  ok(A.$('ver-backend').textContent === 'backend v1.4' && A.$('ver-backend').className === 'ver', 'footer shows the backend release next to the page release when they match');
  await A.next(); A.card('kt'); await A.next(); A.card('Bank'); await A.next(); A.change($('sel-akaunWang'), '1020'); await A.next();
  ok(/Dibayar kepada siapa/.test(A.text()) && /Nama ini dicetak pada baucar bayaran/.test(A.text()), 'a Pihak step follows Akaun wang ("Dibayar kepada siapa?")');
  ok([...$('sel-pihak').options].map(o => o.textContent).join('|') === 'Pilih...|Syarikat Lama Sdn Bhd (Pembekal)|+ Tambah pihak baharu', 'the party list comes from the backend, with "Tambah pihak baharu" last');
  await A.next(); ok(/Pilih pihak dahulu/.test(A.err()), 'cannot continue without a party');
  A.change($('sel-pihak'), '__baharu'); ok(!!$('inp-pihak-nama') && !!$('sel-pihak-jenis') && $('sel-pihak-jenis').value === 'Pembekal', 'choosing "Tambah pihak baharu" shows name, type (Pembekal for a payment) and registration no.');
  A.input($('inp-pihak-nama'), 'A'); await A.next(); ok(/sekurang-kurangnya 2 aksara/.test(A.err()), 'a one-letter name is refused');
  A.input($('inp-pihak-nama'), 'syarikat lama SDN bhd'); await A.next(); ok(/sudah ada dalam senarai/.test(A.err()), 'a name that already exists (any case) must be picked from the list, not duplicated');
  A.input($('inp-pihak-nama'), 'Syarikat Baharu Sdn Bhd'); A.input($('inp-pihak-daftar'), '123-X'); await A.next();
  ok(/Kategori/.test(A.text()), 'then the Kategori step');
  A.change($('sel-kategori'), '5150'); await A.next();
  ok(/Rujukan & butiran/.test(A.text()) && /dijana automatik/.test(A.text()) && !!$('inp-butiran'), 'the old "No. PV/RT" box is now "Rujukan luar" + "Butiran"; the number is generated');
  A.input($('inp-pv'), 'INV-77'); A.input($('inp-butiran'), 'Bil internet Dis'); await A.next();
  A.change($('inp-tarikh'), '2026-04-10'); await A.next();
  ok(/Jumlah \(RM\)/.test(A.text()) && $('next-btn').textContent === 'Seterusnya', 'amount step; the button says Seterusnya because officers come next');
  A.input($('inp-jumlah'), '300'); A.check($('chk-pecah'), true);
  ok(w2count(A, '.split-row') === 2 && /Seimbang/.test($('split-baki').textContent), 'split on: two rows, first row starts with the whole amount (balanced)');
  A.input(A.w.document.querySelectorAll('.split-jum')[0], '200');
  ok(/Belum diperuntukkan: RM 100.00/.test($('split-baki').textContent) && $('split-baki').className === 'split-baki', 'the remaining amount updates live without re-drawing');
  await A.next(); ok(/Baris 2: pilih akaun/.test(A.err()), 'a split row needs an account');
  A.change(A.w.document.querySelectorAll('.split-kod')[1], '5010'); A.input(A.w.document.querySelectorAll('.split-jum')[1], '50');
  await A.next(); ok(/Masih ada RM 50.00 belum diperuntukkan/.test(A.err()), 'the rows must add up to the total (too little)');
  A.input(A.w.document.querySelectorAll('.split-jum')[1], '120'); await A.next(); ok(/melebihi jumlah keseluruhan sebanyak RM 20.00/.test(A.err()), 'the rows must add up to the total (too much)');
  A.input(A.w.document.querySelectorAll('.split-jum')[1], '100'); await A.next();
  ok(/Pegawai/.test(A.text()) && /Baucar disediakan oleh/.test(A.text()) && !!$('inp-lulus'), 'officer step for a voucher: preparer, recorder, approver (optional)');
  await A.next(); ok(/menyediakan baucar/.test(A.err()), 'the preparer name is required');
  A.input($('inp-keluar'), 'Aminah'); A.input($('inp-rekod'), 'Zaki');
  ok(/Tiada pelulus dicatat/.test($('pegawai-amaran').textContent), 'no approver: a warning shows live (never blocks)');
  A.input($('inp-lulus'), 'aminah'); ok(/Penyedia baucar sama dengan pelulus/.test($('pegawai-amaran').textContent), 'preparer = approver: warning');
  A.input($('inp-lulus'), 'Hasan'); ok($('pegawai-amaran').textContent === '', 'different approver: no warning');
  await A.next();
  ok(/Dibayar kepada/.test(A.text()) && /Syarikat Baharu Sdn Bhd \(baharu\)/.test(A.text()) && /Akaun 1/.test(A.text()) && /Akaun 2/.test(A.text()) && /Baucar bayaran/.test(A.text()) && /Hasan/.test(A.text()), 'review shows the party (new), each split line, the document type and the approver');
  await A.next(); await sleep(20);
  const p = A.calls[0] || {};
  ok(p.tarikh === '2026-04-10' && p.sebabLewat === '' && p.perkara === 'Bayaran kepada Syarikat Baharu Sdn Bhd - Bil internet Dis' && p.kaedah === 'Bank', 'payload: date, description built from party + butiran, no late reason outside the lock');
  const d = p.dokumen || {};
  ok(d.jenis === 'PV' && String(d.akaunWang) === '1020' && d.pihak && d.pihak.baharu && d.pihak.baharu.nama === 'Syarikat Baharu Sdn Bhd' && d.pihak.baharu.jenis === 'Pembekal' && d.pihak.baharu.noDaftar === '123-X' &&
     d.rujukanLuar === 'INV-77' && d.butiran === 'Bil internet Dis' && d.dikeluarkanOleh === 'Aminah' && d.direkodOleh === 'Zaki' && d.diluluskanOleh === 'Hasan', 'payload.dokumen carries type, money account, new party, references and the three officers');
  const L = p.lines || [];
  ok(L.length === 3 && String(L[0].kodAkaun) === '5150' && L[0].debit === 200 && L[0].butiran === 'Bil internet Dis' && String(L[1].kodAkaun) === '5010' && L[1].debit === 100 && L[1].memo === 'INV-77' && String(L[2].kodAkaun) === '1020' && L[2].kredit === 300 && L[2].debit === 0, 'split payload: two debit lines + ONE credit line for the bank (balanced 300 / 300)');
  ok(/PV-2026-0001/.test(A.text()) && !!A.w.document.querySelector('a[href="https://drive.test/PV-2026-0001.pdf"]') && /Berjaya disimpan/.test(A.text()), 'success screen shows the generated number and a Buka PDF link');
  ok(A.calls.gets === 2, 'a newly added party makes the wizard re-read the party list');
  // second entry: Terimaan with an existing party; officer names remembered in the browser
  await A.next(); await A.next(); A.card('dt'); await A.next(); A.card('Online'); await A.next(); A.change($('sel-akaunWang'), '1020'); await A.next();
  ok(/Diterima daripada siapa/.test(A.text()), 'a receipt asks "Diterima daripada siapa?"');
  A.change($('sel-pihak'), 'P-0001'); await A.next(); A.change($('sel-kategori'), '4050'); await A.next(); await A.next(); A.change($('inp-tarikh'), '2026-05-01'); await A.next();
  A.input($('inp-jumlah'), '450.5'); await A.next();
  ok(/Resit dikeluarkan oleh/.test(A.text()) && !$('inp-lulus') && $('inp-keluar').value === 'Aminah' && $('inp-rekod').value === 'Zaki', 'receipt officer step: no approver box; the last names are remembered');
  A.input($('inp-rekod'), 'aminah'); ok(/Pengeluar resit sama dengan perekod/.test($('pegawai-amaran').textContent), 'issuer = recorder on a receipt: warning (SKM internal-control circular)');
  await A.next(); ok(/Pengeluar resit sama dengan perekod/.test(A.text()), 'the warning is repeated on the review screen');
  A.calls.length = 0; await A.next(); await sleep(20);
  const q = A.calls[0] || {}, qd = q.dokumen || {}, ql = q.lines || [];
  ok(qd.jenis === 'RT' && qd.pihak && qd.pihak.id === 'P-0001' && !qd.pihak.baharu && qd.diluluskanOleh === '' && q.perkara === 'Terimaan daripada Syarikat Lama Sdn Bhd - Pendapatan Perkhidmatan', 'Resit payload: type RT, existing party by id, no approver, description from the category when there is no butiran');
  ok(ql.length === 2 && String(ql[0].kodAkaun) === '1020' && ql[0].debit === 450.5 && ql[0].kredit === 0 && String(ql[1].kodAkaun) === '4050' && ql[1].kredit === 450.5, 'Resit lines: debit the money account, credit the category');

  console.log('\n=== wizard: locked period, late reason, accrual hint, split rows ===');
  const B = await mkWizard(); const b$ = B.$;
  await B.next(); B.card('kt'); await B.next(); B.card('Tunai'); await B.next(); B.change(b$('sel-akaunWang'), '1010'); await B.next(); B.change(b$('sel-pihak'), 'P-0001'); await B.next();
  B.change(b$('sel-kategori'), '5010'); await B.next(); B.input(b$('inp-butiran'), 'sewa tahunan pejabat'); await B.next();
  ok(/Tarikh transaksi/.test(B.text()) && b$('inp-tarikh').value === hariIni(), 'date step: defaults to today in the Tetapan time zone (' + hariIni() + ')');
  B.change(b$('inp-tarikh'), '2025-12-31'); await B.next(); ok(/sebelum baki pembukaan/.test(B.err()), 'a date before the opening balances is blocked');
  B.change(b$('inp-tarikh'), '2026-03-15'); ok(!!b$('inp-sebab'), 'a date inside the locked period shows the reason box');
  await B.next(); ok(/Nyatakan sebab/.test(B.err()), 'cannot continue without a reason');
  B.input(b$('inp-sebab'), 'Resit lewat'); await B.next(); ok(/Jumlah/.test(B.text()), 'with a reason the wizard moves on');
  B.input(b$('inp-jumlah'), '100'); B.check(b$('chk-pecah'), true); B.click(b$('split-tambah')); await sleep(5);
  ok(w2count(B, '.split-row') === 3 && w2count(B, '.split-buang') === 3, 'Tambah baris adds a row; every row can be removed');
  B.click(B.w.document.querySelectorAll('.split-buang')[2]); await sleep(5); B.click(B.w.document.querySelectorAll('.split-buang')[1]); await sleep(5);
  ok(w2count(B, '.split-row') === 1 && w2count(B, '.split-buang') === 0, 'rows can be removed down to one (the last one cannot be removed)');
  B.check(b$('chk-pecah'), false); await B.next();
  B.input(b$('inp-keluar'), 'Aminah'); B.input(b$('inp-rekod'), 'Zaki'); B.input(b$('inp-lulus'), 'Hasan'); await B.next();
  ok(/Perkataan "tahunan" dikesan/.test(B.text()) && /entri lewat/.test(B.text()), 'review: the accrual hint also reads the new description box, and the late-entry tag shows');
  B.click(b$('accrual-proceed-btn')); await sleep(5); await B.next(); await sleep(20);
  ok(B.calls[0].sebabLewat === 'Resit lewat' && B.calls[0].tarikh === '2026-03-15' && B.calls[0].lines.length === 2, 'late reason travels with the payload; an un-split payment is still two lines');

  console.log('\n=== wizard: Kontra is unchanged (no party, no officers, no document) ===');
  const K = await mkWizard({ post: { status: 'BERJAYA', idTransaksi: 'T-0013', urlResit: '' } }); const k$ = K.$;
  await K.next(); K.card('kontra'); await K.next(); K.change(k$('sel-dariAkaun'), '1020'); await K.next(); K.change(k$('sel-keAkaun'), '1010'); await K.next();
  ok(/No. rujukan/.test(K.text()) && !k$('inp-butiran') && /slip deposit/.test(K.text()), 'Kontra reference step is the old simple one');
  K.input(k$('inp-pv'), 'SLIP-9'); await K.next(); K.change(k$('inp-tarikh'), '2026-05-02'); await K.next();
  ok($('next-btn') && k$('next-btn').textContent === 'Semak', 'Kontra amount step still says Semak');
  K.input(k$('inp-jumlah'), '300'); ok(!k$('chk-pecah'), 'Kontra has no split option'); await K.next();
  ok(/Kontra \/ Pindahan/.test(K.text()) && !/Diluluskan/.test(K.text()), 'Kontra goes straight to review');
  await K.next(); await sleep(20);
  ok(K.calls[0].dokumen === undefined && K.calls[0].lines.length === 2 && K.calls[0].kaedah === 'Kontra' && K.calls[0].noPV === 'SLIP-9' && /Berjaya disimpan/.test(K.text()) && !/dok-ok/.test(K.w.document.body.innerHTML), 'Kontra payload has no dokumen; the success screen shows no document box');

  console.log('\n=== wizard: odd server answers and release warnings ===');
  for (const [lbl, post, expect] of [
    ['PDF failed', { status: 'BERJAYA', idTransaksi: 'T-0010', dokumen: { id: 'D-0002', no: 'PV-2026-0002', jenis: 'PV', urlPdf: '', amaran: 'Tiada pelulus dicatat', amaranPdf: 'PDF tidak dapat dijana (x)' } }, /PDF tidak dapat dijana/],
    ['javascript: link', { status: 'BERJAYA', idTransaksi: 'T-0011', dokumen: { id: 'D-0003', no: 'PV-2026-0003', jenis: 'PV', urlPdf: 'javascript:alert(1)', amaran: '' } }, /PDF belum dijana/],
    ['document write failed', { status: 'BERJAYA', idTransaksi: 'T-0012', dokumenRalat: 'Entri SUDAH dipos (T-0012) tetapi dokumen tidak dapat dibuat: x - jangan pos semula' }, /jangan pos semula/]]) {
    const W = await mkWizard({ post }); const w$ = W.$;
    await W.next(); W.card('kt'); await W.next(); W.card('Bank'); await W.next(); W.change(w$('sel-akaunWang'), '1020'); await W.next(); W.change(w$('sel-pihak'), 'P-0001'); await W.next(); W.change(w$('sel-kategori'), '5150'); await W.next(); await W.next();
    W.change(w$('inp-tarikh'), '2026-05-03'); await W.next(); W.input(w$('inp-jumlah'), '10'); await W.next(); W.input(w$('inp-keluar'), 'Aminah'); W.input(w$('inp-rekod'), 'Zaki'); await W.next(); await W.next(); await sleep(20);
    ok(expect.test(W.text()) && !W.w.document.querySelector('.dok-ok a[href^="javascript"]'), 'success screen handles: ' + lbl);
  }
  for (const [lbl, get, cls, rx] of [['older backend (release 1.3)', GET({ versi: '1.3' }), 'ver bad', /backend v1\.3 tidak sepadan dengan halaman v1\.4/], ['backend without a release', { accounts: ACC }, 'ver bad', /versi tidak diketahui/]]) {
    const W = await mkWizard({ get }); const el = W.$('ver-backend');
    ok(el.className === cls && rx.test(el.textContent), 'footer warns in red: ' + lbl);
  }
  { const W = await mkWizard({ get: { accounts: ACC, versi: '1.4' } }); const w$ = W.$;
    await W.next(); W.card('kt'); await W.next(); W.card('Bank'); await W.next(); W.change(w$('sel-akaunWang'), '1020'); await W.next();
    ok([...w$('sel-pihak').options].length === 2, 'an older backend without a party list still lets the wizard add a party'); }

  console.log('\n=== Dokumen page ===');
  const LIST = { dokumen: [
    { id: 'D-0003', jenis: 'RT', no: 'RT-2026-0001', tarikh: '2026-05-01', pihak: 'Ahli Satu', perkara: 'Terimaan daripada Ahli Satu', jumlah: 450.5, kaedah: 'Online', status: 'Dikeluarkan', rujukan: '', urlPdf: 'https://drive.test/RT-2026-0001.pdf', urlPdfBatal: '', amaran: 'Pengeluar resit sama dengan perekod', sebabBatal: '', tarikhBatal: '', idTransaksiBatal: '' },
    { id: 'D-0002', jenis: 'PV', no: 'PV-2026-0002', tarikh: '2026-04-10', pihak: 'Syarikat Lama Sdn Bhd', perkara: 'Bayaran kepada Syarikat Lama', jumlah: 1234.5, kaedah: 'Bank', status: 'Dikeluarkan', rujukan: 'INV-9', urlPdf: '', urlPdfBatal: '', amaran: '', sebabBatal: '', tarikhBatal: '', idTransaksiBatal: '' },
    { id: 'D-0001', jenis: 'PV', no: 'PV-2026-0001', tarikh: '2026-03-10', pihak: 'Syarikat Lama Sdn Bhd', perkara: 'x', jumlah: 300, kaedah: 'Bank', status: 'Batal', rujukan: '', urlPdf: 'javascript:alert(1)', urlPdfBatal: 'https://drive.test/PV-2026-0001-BATAL.pdf', amaran: '', sebabBatal: 'Salah jumlah', tarikhBatal: '2026-03-12', idTransaksiBatal: 'T-0005' }] };
  const calls2 = []; let printed = 0, written = ''; let promptAns = ''; let confirmAns = true;
  const fakeWin = { document: { write: s => { written += s; }, open() {}, close() {} }, focus() {}, print() { printed++; }, close() {} };
  const fetchD = (url, opt) => {
    if (!opt) return json(GET());
    const b = JSON.parse(opt.body); calls2.push(b);
    if (b.action === 'dokumen_senarai') return json(LIST);
    if (b.action === 'dokumen_html') return json({ html: '<html><body>BAUCAR BAYARAN ' + b.idDokumen + '</body></html>', no: 'PV-2026-0002' });
    if (b.action === 'dokumen_pdf') return json({ status: 'BERJAYA', urlPdf: 'https://drive.test/x.pdf' });
    if (b.action === 'dokumen_batal') return json({ status: 'BERJAYA', idTransaksiBatal: 'T-0020', noDokumen: 'PV-2026-0002' });
    return json({ error: 'x' });
  };
  const P = load('APZacct-dokumen_v1.4.html', ['APZacct-config_v1.4.js', 'APZacct-dokumen_v1.4.js'], fetchD, ww => { ww.open = () => fakeWin; ww.prompt = () => promptAns; ww.confirm = () => confirmAns; }); await sleep(40);
  const p$ = id => P.document.getElementById(id), cards = () => [...P.document.querySelectorAll('.dok-card')];
  ok(cards().length === 3 && cards()[0].dataset.no === 'RT-2026-0001' && /3 daripada 3 dokumen/.test(p$('dok-ringkas').textContent), 'the page lists the documents newest first');
  ok(p$('ver-backend').textContent === 'backend v1.4', 'the page shows the backend release');
  ok(/RM 1,234.50/.test(cards()[1].textContent) && /INV-9/.test(cards()[1].textContent) && /Ditanda untuk juruaudit: Pengeluar resit sama dengan perekod/.test(cards()[0].textContent), 'amounts, the outside reference and control flags are visible');
  ok(!!cards()[0].querySelector('a[href="https://drive.test/RT-2026-0001.pdf"]') && !!cards()[1].querySelector('button[data-act="pdf"]') && !cards()[1].querySelector('a'), 'a PDF link when it exists, a Jana PDF button when it does not');
  ok(cards()[2].classList.contains('batal') && !!cards()[2].querySelector('a[href="https://drive.test/PV-2026-0001-BATAL.pdf"]') && !cards()[2].querySelector('button[data-act="batal"]') && /Salah jumlah/.test(cards()[2].textContent) && !P.document.querySelector('a[href^="javascript"]'), 'a voided document shows its reason and the BATAL pdf, cannot be voided again, and an unsafe link is never rendered');
  p$('tapis-jenis').value = 'PV'; p$('tapis-jenis').dispatchEvent(new P.Event('change')); ok(cards().length === 2, 'filter by type');
  p$('tapis-status').value = 'Batal'; p$('tapis-status').dispatchEvent(new P.Event('change')); ok(cards().length === 1 && cards()[0].dataset.no === 'PV-2026-0001', 'filter by status');
  p$('tapis-jenis').value = ''; p$('tapis-status').value = ''; p$('tapis-cari').value = 'inv-9'; p$('tapis-cari').dispatchEvent(new P.Event('input')); ok(cards().length === 1 && cards()[0].dataset.no === 'PV-2026-0002', 'search finds a document by its outside reference');
  p$('tapis-cari').value = ''; p$('tapis-cari').dispatchEvent(new P.Event('input'));
  const btn = (act, no) => [...P.document.querySelectorAll('button[data-act="' + act + '"]')].filter(x => !no || x.closest('.dok-card').dataset.no === no)[0];
  btn('cetak', 'PV-2026-0002').dispatchEvent(new P.Event('click', { bubbles: true })); await sleep(500);
  ok(calls2.some(c => c.action === 'dokumen_html' && c.idDokumen === 'D-0002') && /BAUCAR BAYARAN D-0002/.test(written) && printed === 1, 'Cetak opens a window, loads the print view from the server and prints it');
  btn('pdf', 'PV-2026-0002').dispatchEvent(new P.Event('click', { bubbles: true })); await sleep(30);
  ok(calls2.some(c => c.action === 'dokumen_pdf' && c.idDokumen === 'D-0002') && /PDF dijana/.test(p$('dok-mesej').textContent), 'Jana PDF asks the server and reloads the list');
  promptAns = ''; btn('batal', 'PV-2026-0002').dispatchEvent(new P.Event('click', { bubbles: true })); await sleep(10);
  ok(/Sebab pembatalan diperlukan/.test(p$('dok-mesej').textContent) && !calls2.some(c => c.action === 'dokumen_batal'), 'void without a reason: nothing is sent');
  promptAns = 'Salah jumlah'; confirmAns = false; btn('batal', 'PV-2026-0002').dispatchEvent(new P.Event('click', { bubbles: true })); await sleep(10);
  ok(!calls2.some(c => c.action === 'dokumen_batal'), 'void: answering No at the confirmation sends nothing');
  confirmAns = true; btn('batal', 'PV-2026-0002').dispatchEvent(new P.Event('click', { bubbles: true })); await sleep(30);
  const vb = calls2.filter(c => c.action === 'dokumen_batal')[0];
  ok(!!vb && vb.idDokumen === 'D-0002' && vb.sebab === 'Salah jumlah' && /PV-2026-0002 dibatalkan/.test(p$('dok-mesej').textContent) && /T-0020/.test(p$('dok-mesej').textContent), 'void with a reason: sent once and the reversing entry number is shown');

  console.log('\n=== bank import page (one batch request) ===');
  const calls3 = []; let mode = 'ok';
  const fetchP = (url, opt) => {
    if (!opt) return json(GET());
    const b = JSON.parse(opt.body); calls3.push(b);
    if (b.action === 'ocr_penyata_bank') return json({ transaksi: [
      { tarikh: '2026-04-10', perkara: 'Fi', debit: 0, kredit: 50, bakiBerjalan: 150, kodKategoriDicadang: 4050, konsisten: true },
      { tarikh: '2026-03-05', perkara: 'Bayar', debit: 20, kredit: 0, bakiBerjalan: 130, kodKategoriDicadang: 5010, konsisten: true }], bilangan: 2, bilanganTidakKonsisten: 0 });
    return mode === 'ok' ? json({ status: 'BERJAYA', bilangan: 2 }) : json({ error: 'RALAT: 1 transaksi tidak sah - tiada apa dipos', kod: 'KELOMPOK_TIDAK_SAH', ralat: [{ indeks: 1, kod: 'TEMPOH_DIKUNCI', error: 'tarikh dalam tempoh dikunci' }] });
  };
  const w2 = load('APZacct-penyata-bank_v1.4.html', ['APZacct-config_v1.4.js', 'APZacct-penyata-bank_v1.4.js'], fetchP, ww => { ww.prompt = () => 'Sebab ujian'; }); await sleep(30);
  const $2 = id => w2.document.getElementById(id);
  const f = new w2.File(['x'], 'a.pdf', { type: 'application/pdf' }); Object.defineProperty($2('inp-fail'), 'files', { value: [f] }); $2('inp-fail').dispatchEvent(new w2.Event('change')); await sleep(50);
  $2('sel-akaunWang').value = '1020'; $2('sel-akaunWang').dispatchEvent(new w2.Event('change'));
  $2('proses-btn').dispatchEvent(new w2.Event('click')); await sleep(30);
  const boxes = w2.document.querySelectorAll('#penyata-tbody input[data-field="disertakan"]');
  ok(boxes.length === 2 && boxes[0].checked && !boxes[1].checked, 'two rows loaded; the row dated inside the locked period starts unticked');
  boxes[1].checked = true; boxes[1].dispatchEvent(new w2.Event('change'));
  $2('pos-semua-btn').dispatchEvent(new w2.Event('click')); await sleep(30);
  const post = calls3.filter(c => c.action === 'pos_kelompok');
  ok(post.length === 1 && post[0].transaksi.length === 2 && post[0].sebabLewat === 'Sebab ujian', 'both rows go in ONE pos_kelompok request, with the reason from the prompt');
  const t0 = post[0].transaksi[0], t1 = post[0].transaksi[1];
  ok(String(t0.lines[0].kodAkaun) === '1020' && t0.lines[0].debit === 50 && String(t1.lines[0].kodAkaun) === '5010' && t1.lines[0].debit === 20 && String(t1.lines[1].kodAkaun) === '1020' && t1.lines[1].kredit === 20, 'money in = debit bank; money out = debit category / credit bank');
  ok(/2 daripada 2 transaksi berjaya dipos/.test($2('selesai-block').textContent), 'completion screen reports 2 of 2 posted');
  mode = 'err'; calls3.length = 0;
  const w3 = load('APZacct-penyata-bank_v1.4.html', ['APZacct-config_v1.4.js', 'APZacct-penyata-bank_v1.4.js'], fetchP, ww => { ww.prompt = () => 'x'; }); await sleep(30);
  const $3 = id => w3.document.getElementById(id);
  Object.defineProperty($3('inp-fail'), 'files', { value: [new w3.File(['x'], 'a.pdf', { type: 'application/pdf' })] }); $3('inp-fail').dispatchEvent(new w3.Event('change')); await sleep(50);
  $3('sel-akaunWang').value = '1020'; $3('sel-akaunWang').dispatchEvent(new w3.Event('change')); $3('proses-btn').dispatchEvent(new w3.Event('click')); await sleep(30);
  const bx = w3.document.querySelectorAll('#penyata-tbody input[data-field="disertakan"]'); bx[1].checked = true; bx[1].dispatchEvent(new w3.Event('change'));
  $3('pos-semua-btn').dispatchEvent(new w3.Event('click')); await sleep(30);
  ok(/tidak sah/.test($3('hasil-error').textContent) && /baris 2/.test($3('hasil-error').textContent) && !$3('pos-semua-btn').disabled && $3('hasil-block').style.display !== 'none', 'a rejected batch shows which row failed, keeps the table and re-enables the button');
  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed.'); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('CRASH', e && e.stack || e); process.exit(2); });

function w2count(X, sel) { return X.w.document.querySelectorAll(sel).length; }
