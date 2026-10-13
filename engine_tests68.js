const fs = require('fs'), { execSync } = require('child_process');
const E = require('/home/claude/v68/form-scanner-engine.js');
const OLD = require('/home/claude/v67/form-scanner-engine.js');           // the v6.7 engine, kept only to prove the bug reproduces there
const PDFLib = require('/home/claude/.npm-global/lib/node_modules/pdf-lib');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const C = E.FS_CONFIG;
const mkEng = (ids) => ['gemini','cfqwen','groq','dots','qwen','orfree','mistral','cfscout'].map((id) => ({ id, label: id, ready: ids.includes(id) }));
const ALL = ['gemini','cfqwen','groq','dots','qwen','orfree','mistral','cfscout'];

ok(E.VERSION === 'v6.8 (2026-10-13)', 'version', E.VERSION);
ok(JSON.stringify(C.AUTO_ORDER) === JSON.stringify(['cfqwen','dots','groq','gemini']), 'AUTO_ORDER (router out)', C.AUTO_ORDER);
ok(JSON.stringify(C.WORDING_ORDER) === JSON.stringify(['gemini','mistral']), 'WORDING_ORDER unchanged', C.WORDING_ORDER);
ok(JSON.stringify(C.COMPARE_SKIP) === JSON.stringify(['qwen']), 'COMPARE_SKIP', C.COMPARE_SKIP);
ok(C.SLOW_ENGINES.includes('cfqwen') && C.SLOW_ENGINES.includes('dots') && C.SLOW_ENGINES.includes('orfree'), 'SLOW_ENGINES still lists the router (still selectable)');
// planning
ok(E.planAuto(C.AUTO_ORDER, mkEng(ALL)).join() === 'cfqwen,dots,groq,gemini', 'planAuto all ready: router, retired qwen and scout never used by Auto', E.planAuto(C.AUTO_ORDER, mkEng(ALL)));
ok(E.planAuto(C.AUTO_ORDER, mkEng(['gemini','orfree'])).join() === 'gemini', 'planAuto router alone is not used');
ok(E.planAuto(C.AUTO_ORDER, mkEng(['gemini','groq'])).join() === 'groq,gemini', 'planAuto groq+gemini');
ok(E.planAuto(C.AUTO_ORDER, mkEng(['gemini','dots'])).join() === 'dots,gemini', 'planAuto dots+gemini');
ok(E.planAuto(C.AUTO_ORDER, mkEng([])).length === 0, 'planAuto none');
ok(E.planWording(C.WORDING_ORDER, mkEng(['gemini','mistral','cfscout'])).join() === 'gemini,mistral', 'planWording never uses Llama Scout');
// Compare all
const pa = (ids, skip) => E.planAll(mkEng(ids), C.AUTO_ORDER, skip).join();
ok(pa(['gemini','cfqwen','groq','dots','qwen','orfree','cfscout'], C.COMPARE_SKIP) === 'cfqwen,dots,groq,gemini,orfree,cfscout', 'planAll skips retired qwen, keeps router + scout', pa(['gemini','cfqwen','groq','dots','qwen','orfree','cfscout'], C.COMPARE_SKIP));
ok(pa(['gemini','cfqwen','groq','dots','qwen','orfree','cfscout']) === 'cfqwen,dots,groq,gemini,qwen,orfree,cfscout', 'planAll without skip behaves as before', pa(['gemini','cfqwen','groq','dots','qwen','orfree','cfscout']));
ok(pa(['qwen','gemini'], ['qwen']) === 'gemini' && pa(['qwen'], ['qwen']) === '' && pa([], ['qwen']) === '', 'planAll skip edge cases');
ok(E.planAll(mkEng(['gemini','qwen']), C.AUTO_ORDER, 'qwen').join() === 'gemini,qwen', 'planAll ignores a junk skip (string, not list)');
ok(OLD.planAll(mkEng(['gemini','qwen']), C.AUTO_ORDER).join() === 'gemini,qwen', 'sanity: v6.7 planAll had no skip');
// stray size-flag words (the Gemini "xs" bug seen on the 2026-10-13 wastage image run)
const it = (s) => E.parseItem(s);
ok(it('F[line,w70] xs').kind === 'F' && it('F[line,w70] xs').text === '', 'F label "xs" becomes a bare blank', it('F[line,w70] xs'));
ok(it('T[b] xs') === null && it('T xs') === null && it('xs') === null, 'T text "xs" is dropped');
ok(['sm','md','lg','xl'].every((f) => it('F[line] ' + f).text === '' && it('T ' + f) === null), 'all five size words handled');
ok(it('F[line] XL').text === 'XL' && it('F[line] XS').text === 'XS' && it('T[b] XL').text === 'XL', 'printed capital sizes (XL / XS) are kept');
ok(it('F[line] Xs size').text === 'Xs size' && it('T[b] xs-large').text === 'xs-large' && it('F[box] Name :').text === 'Name :', 'real labels untouched');
ok(it('C[stack] Size :: xs ; sm ; md').options.map((o) => o.label).join() === 'xs,sm,md', 'tick-box options named xs/sm/md are untouched (only T and F labels are cleaned)', it('C[stack] Size :: xs ; sm ; md').options);
// end to end: the same spec through BOTH engines, printed text read back from the PDF
async function pdfText(engine, tag) {
  const raw = { recognized: true, title: 'T', page: { size: 'A4', orientation: 'portrait', font: 'sans' }, bands: [{ kind: 'cells', height_pct: 100, col_widths_pct: [100], cells: [{ col: 1, height_pct: 100, items: ['T[b,sm,center] Disediakan Oleh (Staf Dapur)', 'SP[2]', 'F[line,w70] xs', 'F[none,sm] Nama :', 'F[line] XL'] }] }] };
  const spec = engine.normalizeSpec(raw); const page = engine.resolvePage(spec, null);
  const r = await engine.buildFillablePdf(PDFLib, spec, page, {});
  fs.writeFileSync('/tmp/t_' + tag + '.pdf', r.bytes);
  return execSync('pdftotext -raw /tmp/t_' + tag + '.pdf -').toString().split('\n').map((l) => l.trim()).filter(Boolean);
}
(async () => {
  const oldL = await pdfText(OLD, 'old'), newL = await pdfText(E, 'new');
  ok(oldL.includes('xs'), 'v6.7 engine really printed the stray "xs" (bug reproduced)', oldL);
  ok(!newL.includes('xs') && newL.includes('Nama :') && newL.includes('XL') && newL.includes('Disediakan Oleh (Staf Dapur)'), 'v6.8 engine does not print "xs" and keeps real text', newL);
  // the wording merge is untouched: same result as in v6.7 on the real dots-vs-Gemini texts
  const rd = (f) => fs.readFileSync(f, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  const dots = rd('/home/claude/look/dots.txt'), gem = rd('/home/claude/look/gem.txt');
  const spec = { title: '', referenceCode: '', frames: [], warnings: [], bands: [{ kind: 'cells', cells: [{ items: dots.map((t) => ({ kind: 'T', text: t })) }] }] };
  const before = spec.bands[0].cells[0].items.map((i) => i.text);
  const res = E.mergeWording(spec, gem);
  const changed = before.filter((b, i) => b !== spec.bands[0].cells[0].items[i].text).length;
  ok(res.fixed === 9 && changed === 10 && res.unconfirmed.length === 5, 'merge regression (9 fixed / 10 changed / 5 amber)', [res.fixed, changed, res.unconfirmed.length]);
  ok(E.runDetail({ usage: { in: 3408, out: 2171, neurons: 771 }, tries: 1 }) === '3,408 in / 2,171 out tokens \u00b7 about 771 neurons (8% of the free 10,000 a day)', 'runDetail on a real row from the 2026-10-13 log', E.runDetail({ usage: { in: 3408, out: 2171, neurons: 771 }, tries: 1 }));
  console.log(`ENGINE TESTS (v6.8): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
