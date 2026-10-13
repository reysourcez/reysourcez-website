'use strict';
// APZacct release 1.4 - file APZacct-ReleaseCheck_v1.4.js
/* APZacct - release check v1.4
 * Looks at a release folder (default: the folder this script is in) and fails if the release is not internally consistent:
 *   1. every file is named APZacct-<Nama>_v1.4.<ext> (only _redirects is exempt) and the expected files are all there, nothing extra from an older release;
 *   2. every .gs / .js / .html / .css starts with an "APZacct release/v 1.4" line that names the file itself;
 *   3. every .gs declares const APZ_VER_<NAMA> = '1.4' (the name matches the file) and APZacct-Versi_v1.4.gs lists every .gs file;
 *   4. no old-style references (APZacct_*.gs, _v1.3) are left; the html pages only load files that exist; _redirects points at an existing page;
 *   5. config.js carries APZ_VERSI = '1.4' and the pages call apzTunjukVersiBackend.
 * Run: node APZacct-ReleaseCheck_v1.4.js [folder]        Exit code 1 = something to fix.            */
const fs = require('fs'), path = require('path');
const DIR = process.argv[2] || __dirname, REL = '1.4';
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; if (!c) console.log('  FAIL - ' + m); };
const files = fs.readdirSync(DIR).filter(f => fs.statSync(path.join(DIR, f)).isFile());
const read = f => fs.readFileSync(path.join(DIR, f), 'utf8');

const GS = ['BakiPembukaan', 'BukaWebApp', 'Dokumen', 'JurnalLaras', 'KadarStatutori', 'Laporan', 'LindungiHelaian', 'LogPerubahan', 'Menu', 'OCRPenyataBank', 'PosAgihanAPK', 'PosSusutNilai', 'RekonsiliasiBank', 'TambahAkaun', 'Versi', 'WangRuncit', 'WebAPI'];
const WEB = ['index.html', 'wizard.js', 'config.js', 'styles.css', 'penyata-bank.html', 'penyata-bank.js', 'rekonsiliasi-bank.html', 'rekonsiliasi-bank.js', 'dokumen.html', 'dokumen.js'];
const OTHER = ['TemplateKosong.xlsx', 'TemplateKosongNota.xlsx', 'PanduanPenggunaan.md', 'HandoffDossier.md', 'TestGsMock.js', 'TestFrontendJsdom.js', 'TestWorkbookScenarios.py', 'ReleaseCheck.js'];
const expected = []
  .concat(GS.map(n => 'APZacct-' + n + '_v' + REL + '.gs'))
  .concat(WEB.map(n => { const i = n.lastIndexOf('.'); return 'APZacct-' + n.slice(0, i) + '_v' + REL + n.slice(i); }))
  .concat(OTHER.map(n => { const i = n.lastIndexOf('.'); return 'APZacct-' + n.slice(0, i) + '_v' + REL + n.slice(i); }))
  .concat(['_redirects']);

console.log('=== 1. file set and names ===');
const re = new RegExp('^APZacct-[A-Za-z0-9-]+_v' + REL.replace('.', '\\.') + '\\.[a-z]+$');
files.forEach(f => ok(f === '_redirects' || re.test(f), 'bad file name (needs APZacct-<Nama>_v' + REL + '.<ext>): ' + f));
expected.forEach(f => ok(files.indexOf(f) !== -1, 'missing from the release: ' + f));
files.forEach(f => ok(expected.indexOf(f) !== -1, 'unexpected file (left over from another release?): ' + f));
console.log('  ' + files.length + ' files, ' + expected.length + ' expected');

console.log('=== 2. first line names the release and the file ===');
files.filter(f => /\.(gs|js|css|html)$/.test(f)).forEach(f => {
  const head = read(f).split('\n').slice(0, 2).join('\n');
  const bare = f.replace(/_v[\d.]+\.(\w+)$/, '');
  ok(head.indexOf(f) !== -1 && /APZacct (release|v)\s?1\.4/.test(head), f + ': first lines must say "APZacct release 1.4" / "APZacct v1.4" and name the file itself');
});

console.log('=== 3. .gs constants and the registry ===');
const versi = read('APZacct-Versi_v' + REL + '.gs');
GS.forEach(n => {
  const f = 'APZacct-' + n + '_v' + REL + '.gs'; if (files.indexOf(f) === -1) return;
  const src = read(f), m = new RegExp("^const APZ_VER_" + n.toUpperCase() + " = '([\\d.]+)';", 'm').exec(src);
  ok(!!m && m[1] === REL, f + ": needs  const APZ_VER_" + n.toUpperCase() + " = '" + REL + "';");
  ok(versi.indexOf("'APZacct-" + n + "'") !== -1 && versi.indexOf('APZ_VER_' + n.toUpperCase()) !== -1, 'APZacct-Versi lists ' + n);
});
ok(new RegExp("const APZ_RELEASE = '" + REL.replace('.', '\\.') + "';").test(versi), 'APZacct-Versi declares APZ_RELEASE = ' + REL);
const consts = {};
files.filter(f => f.endsWith('.gs')).forEach(f => (read(f).match(/^const (\w+)/gm) || []).forEach(x => { const k = x.slice(6); (consts[k] = consts[k] || []).push(f); }));
Object.keys(consts).filter(k => consts[k].length > 1).forEach(k => ok(false, 'const ' + k + ' declared in two .gs files: ' + consts[k].join(', ')));

console.log('=== 4. references ===');
files.filter(f => /\.(gs|js|css|html|md|py)$/.test(f) && f !== 'APZacct-ReleaseCheck_v1.4.js' && f !== 'APZacct-HandoffDossier_v1.4.md').forEach(f => {
  const src = read(f);
  const old = src.match(/APZacct_[A-Za-z_]+\.gs|APZacct[-_][A-Za-z-]+_v1\.3\.[a-z]+/g);
  if (f.endsWith('.md') || f.endsWith('.py') || f === 'APZacct-TestGsMock_v1.4.js') return;   // guide / tests may quote old names when explaining the rename
  ok(!old, f + ': still mentions an old file name: ' + (old || []).slice(0, 2).join(', '));
});
files.filter(f => f.endsWith('.html')).forEach(f => {
  (read(f).match(/(?:src|href)="(APZacct-[^"]+)"/g) || []).forEach(x => { const t = /"([^"]+)"/.exec(x)[1]; ok(files.indexOf(t) !== -1, f + ' refers to a file that is not in the release: ' + t); });
});
ok(/\/ \/(APZacct-index_v1\.4\.html) 200/.test(read('_redirects')) && files.indexOf('APZacct-index_v1.4.html') !== -1, '_redirects points at APZacct-index_v1.4.html');
const cfg = read('APZacct-config_v1.4.js');
ok(/const APZ_VERSI = '1\.4';/.test(cfg) && /function apzTunjukVersiBackend/.test(cfg), 'config.js carries APZ_VERSI and apzTunjukVersiBackend');
['APZacct-index_v1.4.html', 'APZacct-dokumen_v1.4.html'].forEach(f => ok(/id="ver-backend"/.test(read(f)), f + ' has the backend-version badge'));
ok(/apzTunjukVersiBackend/.test(read('APZacct-wizard_v1.4.js')) && /apzTunjukVersiBackend/.test(read('APZacct-dokumen_v1.4.js')), 'wizard and Dokumen page show the backend release');
const menu = read('APZacct-Menu_v1.4.gs'); const handlers = [...menu.matchAll(/addItem\('[^']+', '(\w+)'\)/g)].map(m => m[1]);
const allSrc = files.filter(f => f.endsWith('.gs')).map(read).join('\n');
handlers.forEach(h => ok(new RegExp('function ' + h + '\\s*\\(').test(allSrc), 'menu handler has no function: ' + h));

console.log('\nRESULT: ' + pass + ' checks passed, ' + fail + ' failed.'); process.exit(fail ? 1 : 0);
