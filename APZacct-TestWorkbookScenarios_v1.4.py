#!/usr/bin/env python3
# APZacct release 1.4 - file APZacct-TestWorkbookScenarios_v1.4.py
"""APZacct - workbook scenario test v1.4
Posts realistic transactions into a COPY of the template, recalculates it with LibreOffice
(xlsx skill's recalc.py) and asserts that Imbangan_Duga, KKK and AT all read SEIMBANG and that
the AT sections classify the cash correctly. It tests the real formulas - the Node suite
(test-akauntan-engine.js) cannot.
Run:  python3 APZacct_test_workbook_scenarios_v1.3.py [path-to-template.xlsx]
v1.4 adds: a structure check of the new Pihak / Dokumen / Dokumen_Baris sheets and Tetapan rows 24-27, and two scenarios (D1 documents written beside ledger entries, D2 a PV and its
void) proving the document sheets never change a statement.
Needs: openpyxl, LibreOffice, /mnt/skills/public/xlsx/scripts/recalc.py (or edit RECALC below).
All amounts are ILLUSTRATIVE test numbers, not any organisation's figures.
"""
import sys, os, json, subprocess, tempfile, openpyxl
TEMPLATE = sys.argv[1] if len(sys.argv) > 1 else '/mnt/user-data/outputs/APZacct-TemplateKosong_v1.4.xlsx'
RECALC = '/mnt/skills/public/xlsx/scripts/recalc.py'
TMP = tempfile.mkdtemp(prefix='apz_')

OPEN  = ('T-0000','2026-01-01','Baki pembukaan','Bank',[(1020,10000,0),(1010,500,0),(3010,0,10500)])
OPEN2 = ('T-0000','2026-01-01','Baki pembukaan','Bank',[(1020,8000,0),(1090,2000,0),(1100,500,0),(2010,0,1000),(3030,0,5000),(3010,0,4500)])
def T(n,d,p,k,l): return ('T-%04d'%n,d,p,k,l)

# name: (opening, transactions, expected AT ops / inv / fin / berkanun (None = not asserted), ending cash)
S = {
 'K1 Kontra Bank->Wang Di Tangan RM300':   (OPEN,[T(1,'2026-01-05','Kontra','Kontra',[(1010,300,0),(1020,0,300)])],            dict(ops=0,inv=0,fin=0,end=10500)),
 'K2 Kontra Wang Di Tangan->Bank RM200':   (OPEN,[T(1,'2026-01-06','Kontra','Kontra',[(1020,200,0),(1010,0,200)])],            dict(ops=0,inv=0,fin=0,end=10500)),
 'K3 Kontra Bank->Wang Runcit float RM500':(OPEN,[T(1,'2026-01-07','Kontra','Kontra',[(1080,500,0),(1020,0,500)])],            dict(ops=0,inv=0,fin=0,end=10500)),
 'B1 Terimaan RM1000 + Bayaran RM400':     (OPEN,[T(1,'2026-01-08','Terimaan','Bank',[(1020,1000,0),(4010,0,1000)]),T(2,'2026-01-09','Bayaran','Bank',[(5010,400,0),(1020,0,400)])], dict(ops=600,end=11100)),
 'P1 Prabayar: bayar RM2400 + lepas RM200':(OPEN,[T(1,'2026-01-10','Sewa 12 bln','Bank',[(1100,2400,0),(1020,0,2400)]),T(2,'2026-01-31','Lepas sewa','Jurnal',[(5010,200,0),(1100,0,200)])], dict(ops=-2400,end=8100)),
 'A1 Terakru bil RM300 belum bayar (tutup tempoh)':(OPEN,[T(1,'2026-12-31','Bil terakru','Jurnal',[(5150,300,0),(2050,0,300)])], dict(ops=0,end=10500)),
 'A2 Terakru bil RM300 kemudian dibayar':  (OPEN,[T(1,'2026-12-31','Bil terakru','Jurnal',[(5150,300,0),(2050,0,300)]),T(2,'2027-01-10','Bayar bil','Bank',[(2050,300,0),(1020,0,300)])], dict(ops=-300,end=10200)),
 'I1 Pendapatan terakru RM800 belum terima':(OPEN,[T(1,'2026-12-31','Pendapatan terakru','Jurnal',[(1110,800,0),(4050,0,800)])], dict(ops=0,end=10500)),
 'I2 Pendapatan terakru RM800 kemudian diterima':(OPEN,[T(1,'2026-12-31','Pendapatan terakru','Jurnal',[(1110,800,0),(4050,0,800)]),T(2,'2027-01-12','Terima','Bank',[(1020,800,0),(1110,0,800)])], dict(ops=800,end=11300)),
 'D1 Pendapatan terdahulu: terima RM600 + lepas RM100':(OPEN,[T(1,'2026-01-11','Yuran kursus awal','Bank',[(1020,600,0),(2060,0,600)]),T(2,'2026-01-31','Lepas','Jurnal',[(2060,100,0),(4060,0,100)])], dict(ops=600,end=11100)),
 'F1 Beli aset RM3000 + susut nilai RM100':(OPEN,[T(1,'2026-01-12','Beli komputer','Bank',[(1040,3000,0),(1020,0,3000)]),T(2,'2026-12-31','Susut nilai','Jurnal',[(5160,100,0),(1045,0,100)])], dict(ops=0,inv=-3000,end=7500)),
 'F2 Modal syer RM500 + deposit tetap RM2000':(OPEN,[T(1,'2026-01-13','Modal syer','Bank',[(1020,500,0),(3010,0,500)]),T(2,'2026-01-14','Deposit tetap','Bank',[(1030,2000,0),(1020,0,2000)])], dict(inv=-2000,fin=500,end=9000)),
 'F3 Surplus + agihan APK + bayar KWA':    (OPEN,[T(1,'2026-01-15','Fi','Bank',[(1020,2000,0),(4010,0,2000)]),T(2,'2026-12-31','Agihan APK','Jurnal',[(3030,300,0),(3020,0,250),(2100,0,50)]),T(3,'2027-01-20','Bayar KWA','Bank',[(2100,50,0),(1020,0,50)])], dict(ops=2000,berk=-50,end=12450)),
 'R1 Jualan kredit RM700 (penghutang)':    (OPEN,[T(1,'2026-03-01','Jualan kredit','Jurnal',[(1090,700,0),(4050,0,700)])], dict(ops=0,end=10500)),
 'R2 Belian kredit RM450 (pemiutang)':     (OPEN,[T(1,'2026-03-02','Belian kredit','Jurnal',[(5010,450,0),(2010,0,450)])], dict(ops=0,end=10500)),
 'O1 Baki pembukaan ada penghutang/pemiutang/prabayar/lebihan terkumpul':(OPEN2,[T(1,'2026-01-20','Kutip penghutang','Bank',[(1020,2000,0),(1090,0,2000)]),T(2,'2026-01-25','Bayar pemiutang','Bank',[(2010,600,0),(1020,0,600)]),T(3,'2026-01-31','Lepas prabayar','Jurnal',[(5010,100,0),(1100,0,100)])], dict(ops=1400,end=9400)),
}

def big(n):
    return [T(i, '2026-02-01', 'Terimaan %d' % i, 'Bank', [(1020, 100, 0), (4010, 0, 100)]) for i in range(1, n + 1)]
S['L1 Lejar 701 baris - melepasi baris 500 lama'] = (OPEN, big(349), dict(ops=34900, end=45400, cap='701 / 4996'))
S['L2 Lejar 4983 baris - hampir had 4996'] = (OPEN, big(2490), dict(ops=249000, end=259500, cap='4983 / 4996'))


def check_structure(path):
    wb = openpyxl.load_workbook(path); names = wb.sheetnames; good_all = True
    def rep(good, msg):
        nonlocal good_all
        print(('PASS ' if good else 'FAIL ') + msg); good_all = good_all and good
    for s, n in {'Pihak': 13, 'Dokumen': 25, 'Dokumen_Baris': 13}.items():
        rep(s in names and sum(1 for c in wb[s][4] if c.value) == n, 'sheet %s exists with %d header columns' % (s, n))
    rep(names.index('Pihak') == names.index('Baris_Transaksi') + 1 and names.index('Dokumen') == names.index('Pihak') + 1 and names.index('Dokumen_Baris') == names.index('Dokumen') + 1, 'new sheets sit right after Baris_Transaksi')
    te = wb['Tetapan']
    rep(all(te.cell(r, 1).value for r in range(24, 28)) and str(te['C26'].value) == 'PV-{YYYY}-{NNNN}' and str(te['C27'].value) == 'RT-{YYYY}-{NNNN}', 'Tetapan rows 24-27 (address, phone, PV and RT patterns) exist')
    rep('v1.4' in str(wb['Panduan']['A1'].value), 'Panduan title says v1.4')
    rep(sum(1 for r in range(1, wb['Kamus_Istilah'].max_row + 1) if wb['Kamus_Istilah'].cell(r, 1).value in ('Party (Pihak)', 'Payment Voucher (PV)', 'Official Receipt (RT)')) == 3, 'Kamus_Istilah has the new document terms')
    return good_all


def docs_tweak(wb):
    ph, dk, db = wb['Pihak'], wb['Dokumen'], wb['Dokumen_Baris']
    for k, v in enumerate(['P-0001', 'Syarikat Ujian', 'Pembekal', '123-X', '', '', '', '', '', '', '', 'Aktif', 'x'], start=1): ph.cell(5, k, v)
    for k, v in enumerate(['D-0001', 'PV', 2026, 1, 'PV-2026-0001', '2026-01-09', 'P-0001', 'Syarikat Ujian', 'Bayaran', 400, 'Bank', 1020, 'T-0002', 'Dikeluarkan', 'Aminah', 'Zaki', 'Hasan', 'INV-1', '', '2026-01-09 10:00:00', '', '', '', '', ''], start=1): dk.cell(5, k, v)
    for k, v in enumerate(['DB-0001', 'D-0001', 1, 5010, 'Perbelanjaan Pejabat', 'Alat tulis', '', '', 400, '', '', '', ''], start=1): db.cell(5, k, v)

def run(name, opening, txns, exp, tweak=None):
    wb = openpyxl.load_workbook(TEMPLATE)
    tx, bt = wb['Transaksi'], wb['Baris_Transaksi']
    tr = br = 5; ln = 0
    for (tid,dt,pk,kd,lines) in [opening]+txns:
        tx.cell(tr,1,tid); tx.cell(tr,2,dt); tx.cell(tr,3,pk); tx.cell(tr,4,'TEST'); tx.cell(tr,5,kd); tx.cell(tr,6,'Disahkan'); tr += 1
        for (kod,d,k) in lines:
            ln += 1; bt.cell(br,1,'L-%03d'%ln); bt.cell(br,2,tid); bt.cell(br,3,kod); bt.cell(br,4,d); bt.cell(br,5,k); bt.cell(br,6,'test'); br += 1
    wb['Tetapan']['C18'] = opening[0]
    if tweak: tweak(wb)
    path = os.path.join(TMP, name.split()[0] + '.xlsx'); wb.save(path)
    info = json.loads(subprocess.run(['python3', RECALC, path, '120'], capture_output=True, text=True).stdout)
    v = openpyxl.load_workbook(path, data_only=True); g = lambda s,c: v[s][c].value
    got = dict(ID=g('Imbangan_Duga','B153'), KKK=g('KKK','B28'), AT=g('AT','B27'), ops=g('AT','B8'), inv=g('AT','B12'), fin=g('AT','B16'), berk=g('AT','B19'), end=g('AT','B25'), wc=g('AT','B7'), cap=g('Imbangan_Duga','B154'), errors=info.get('total_errors'))
    ok = got['ID']=='SEIMBANG' and got['KKK']=='SEIMBANG' and got['AT']=='SEIMBANG' and got['errors']==0
    for k, want in exp.items():
        if isinstance(want, str):
            if got[k] != want: ok = False
        elif want is not None and round(got[k]-want, 2) != 0: ok = False
    return ok, got, path

def second_bank(tag):
    def tw(wb):
        ak = wb['Akaun']; r = 5
        while ak.cell(r,1).value not in (None,''): r += 1
        ak.cell(r,1,1120); ak.cell(r,2,'Bank 2'); ak.cell(r,3,'Bank Kedua'); ak.cell(r,4,'Aset')
        ak.cell(r,5,'=IF(OR(D%d="Aset",D%d="Perbelanjaan"),"Debit","Kredit")'%(r,r)); ak.cell(r,6,tag); ak.cell(r,7,'Aktif'); ak.cell(r,9,'Semasa')
    return tw

if __name__ == '__main__':
    fails = 0
    good = check_structure(TEMPLATE); fails += (not good)
    for name,(op,tx,exp) in S.items():
        ok, got, _ = run(name, op, tx, exp)
        fails += (not ok)
        print(('PASS ' if ok else 'FAIL ') + name + '  | ops=%s inv=%s fin=%s berk=%s wc=%s end=%s' % (got['ops'],got['inv'],got['fin'],got['berk'],got['wc'],got['end']))
    b2 = [T(1,'2026-02-01','Terima di bank 2','Bank',[(1120,900,0),(4010,0,900)]), T(2,'2026-02-02','Kontra bank1->bank2','Kontra',[(1120,400,0),(1020,0,400)])]
    ok, got, _ = run('E1 Bank kedua ditag Tidak Berkaitan', OPEN, b2, dict(ops=900, end=11400), second_bank('Tidak Berkaitan'))
    fails += (not ok); print(('PASS ' if ok else 'FAIL ') + 'E1 Bank kedua (Tidak Berkaitan) dikira dalam tunai | ops=%s end=%s' % (got['ops'], got['end']))
    ok, got, _ = run('E2 Bank kedua ditag Operasi (salah)', OPEN, b2, dict(), second_bank('Operasi'))
    print('INFO E2 bank kedua SALAH tag (Operasi): AT tetap %s tetapi ops=%s wc=%s - salah klasifikasi; inilah sebab akaun bank MESTI Tidak Berkaitan' % (got['AT'], got['ops'], got['wc']))
    d1 = [T(1,'2026-01-08','Terimaan','Bank',[(1020,1000,0),(4010,0,1000)]), T(2,'2026-01-09','Bayaran','Bank',[(5010,400,0),(1020,0,400)])]
    ok, got, _ = run('D1 PV dan Resit beserta baris Pihak/Dokumen/Dokumen_Baris', OPEN, d1, dict(ops=600, end=11100), docs_tweak)
    fails += (not ok); print(('PASS ' if ok else 'FAIL ') + 'D1 helaian dokumen tidak mengubah penyata | ops=%s end=%s' % (got['ops'], got['end']))
    d2 = [T(1,'2026-01-09','Bayaran PV-2026-0001','Bank',[(5010,300,0),(1020,0,300)]), T(2,'2026-01-12','Pembatalan PV-2026-0001','Jurnal',[(5010,0,300),(1020,300,0)])]
    ok, got, _ = run('D2 PV dibatalkan dengan entri songsang', OPEN, d2, dict(ops=0, inv=0, fin=0, end=10500), docs_tweak)
    fails += (not ok); print(('PASS ' if ok else 'FAIL ') + 'D2 PV + entri songsang bersih sifar | ops=%s end=%s' % (got['ops'], got['end']))
    print('\nRESULT: %d scenario(s) failed' % fails); sys.exit(1 if fails else 0)
