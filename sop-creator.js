/* ============================================================
   SOP Creator
   Vanilla JS, no dependencies, nothing saved anywhere \u2014 same
   rule as every other tool on this site (see AI_BUILD_BRIEF.md).
   ------------------------------------------------------------
   WHAT THIS TOOL DOES: turns a business's own plain-language
   description of a process into a structured, editable Standard
   Operating Procedure, aligned to whichever standard(s) are
   relevant (ISO 9001, HACCP, ISO 27001, and so on \u2014 not just
   food & beverage), then optionally translates the finished
   document into another language.

   DATA MODEL: one SOP, built from a handful of small repeatable
   row lists \u2014 the exact same "add a row, edit it, delete it"
   pattern used everywhere else on this site (ingredient rows,
   overhead rows, dish rows). The document panel IS the editor:
   there is no separate hidden "real" copy of the data and a
   read-only preview drifting out of sync with it \u2014 what's on
   screen in the styled document panel is what prints and what
   gets downloaded, always read live off the DOM, same "never
   cache what's editable" rule getDishTotals()/getRecipeCost()
   already follow in food-worth-calculator.js.

   AI'S ROLE, DELIBERATELY NARROW: Gemini only ever fills in the
   editable fields with a first draft and suggests which
   standard(s) look relevant \u2014 it never locks anything. Every
   field is a normal input the business can correct, and the
   Worker's own prompt tells it to mark any assumed detail with
   " [assumed]" so a guess is never silently indistinguishable
   from something the business actually said. See the disclaimer
   note rendered near the standards section \u2014 this tool drafts,
   it doesn't certify; exact clause numbers still need checking
   against the current official standard text before an audit.

   NOTHING PERSISTS, same as every other tool here \u2014 close the
   tab and the draft is gone unless you've downloaded or printed
   it. The one narrow exception, matching food-worth-calculator.js
   and market-radar.js exactly, is a small anonymous per-browser
   usage counter (see MAX_ANALYSES_PER_DAY) that protects the
   shared Gemini quota \u2014 it never stores any SOP content, only a
   day + count pair.

   TO EXTEND: add a new structured field (add a row type, follow
   the pattern of createTwoFieldRow/createProcedureRow), then add
   it to assembleSOPText() so it flows into print/download/
   translate automatically \u2014 that function is the one place all
   three outputs are built from, so nothing needs updating twice.
   ============================================================ */

console.info('[SOP Creator] script build: 2026-09-15-v1');

/* ================= CONFIG =================
   Paste your deployed Worker's URL here \u2014 see
   sop-creator-proxy-worker.js's own header for deploy steps. This
   placeholder follows this site's existing *-ent.workers.dev
   naming pattern as a starting guess; replace it with whatever
   Cloudflare actually gives you. */
const PROXY_ENDPOINT = 'https://sop-creator-proxy.reysourcez-ent.workers.dev/';

const MAX_ANALYSES_PER_DAY = 15; // soft cap, same reasoning as market-radar.js: protects the shared Gemini free-tier quota from one browser using it all up
const USAGE_STORAGE_KEY = 'sop-usage';

// Industry -> starting standards. These are sensible, commonly-cited
// defaults, NOT a certification guarantee \u2014 see the disclaimer
// rendered next to the Standards section on the page itself. Every
// one of these is just a starting chip the business can remove, and
// Generate can suggest others on top of whatever's picked here.
// Vocabulary deliberately matches what's already named elsewhere on
// this site (HACCP / GMP / GAP / Halal Certification all already
// appear as line items in overhead-manpower-calculator.js's own
// OVERHEAD_CATEGORIES) rather than inventing a second naming style.
const INDUSTRIES = {
  fnb:            { label: 'Food & Beverage', standards: ['ISO 22000:2018 (Food Safety)', 'HACCP', 'Halal Certification (MS 1500)'] },
  manufacturing:  { label: 'Manufacturing / Production', standards: ['ISO 9001:2015 (Quality Management)', 'ISO 45001:2018 (Occupational Health & Safety)', 'GMP'] },
  construction:   { label: 'Construction / Trades', standards: ['ISO 45001:2018 (Occupational Health & Safety)', 'ISO 9001:2015 (Quality Management)'] },
  healthcare:     { label: 'Healthcare / Clinics', standards: ['ISO 9001:2015 (Quality Management)', 'ISO 13485:2016 (Medical Devices)'] },
  it:             { label: 'IT / Software / Digital Services', standards: ['ISO/IEC 27001:2022 (Information Security)', 'ISO/IEC 20000-1:2018 (IT Service Management)'] },
  retail:         { label: 'Retail / E-commerce', standards: ['ISO 9001:2015 (Quality Management)'] },
  logistics:      { label: 'Logistics / Warehousing / Delivery', standards: ['ISO 9001:2015 (Quality Management)', 'ISO 28000 (Supply Chain Security)'] },
  professional:   { label: 'Professional Services / Finance / Admin', standards: ['ISO 9001:2015 (Quality Management)', 'ISO/IEC 27001:2022 (Information Security)'] },
  education:      { label: 'Education / Training Provider', standards: ['ISO 21001:2018 (Educational Organizations)'] },
  agriculture:    { label: 'Agriculture / Farming', standards: ['GAP (Good Agricultural Practice)', 'ISO 22000:2018 (Food Safety)'] },
  events:         { label: 'Events / Hospitality', standards: ['ISO 9001:2015 (Quality Management)'] },
  environmental:  { label: 'Environmental / Sustainability', standards: ['ISO 14001:2015 (Environmental Management)'] },
  other:          { label: 'Other / General Business', standards: ['ISO 9001:2015 (Quality Management)'] },
};

// Union of every industry's defaults, plus a few extra well-known
// standards, feeding the <datalist> on the "add a standard" input so
// typing gets autocomplete help without locking the field to a
// fixed list \u2014 the business can always type something not on it.
const STANDARDS_LIBRARY = Array.from(new Set(
  Object.values(INDUSTRIES).flatMap((i) => i.standards).concat([
    'ISO 31000:2018 (Risk Management)',
    'ISO 22301:2019 (Business Continuity)',
    'GMP',
    'HACCP',
  ])
));

// Malaysia's own official/major languages listed first (matching this
// site's Malaysian audience elsewhere \u2014 Sarawak Energy rates, EPF/
// SOCSO, SST), then a broader spread of world languages after. Free
// text isn't offered here on purpose: Gemini translates far more
// reliably when told a real language name than a typo'd one.
const LANGUAGES = [
  'Bahasa Malaysia', 'Simplified Chinese', 'Traditional Chinese', 'Tamil', 'English',
  'Indonesian', 'Tagalog (Filipino)', 'Thai', 'Vietnamese',
  'Arabic', 'Hindi', 'Spanish', 'French', 'Portuguese', 'German', 'Japanese', 'Korean',
];

/* ================= SHARED UTILITIES ================= */

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function val(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : '';
}
function setStatus(el, text, isError) {
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-error', !!isError);
}

/* ================= SOFT USAGE CAP (same pattern as food-worth-calculator.js / market-radar.js) ================= */

function getUsageToday() {
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_STORAGE_KEY) || 'null');
    if (!raw || raw.day !== new Date().toDateString()) return 0;
    return raw.count;
  } catch (e) { return 0; }
}
function recordUsage() {
  try { localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify({ day: new Date().toDateString(), count: getUsageToday() + 1 })); }
  catch (e) {}
}

/* ================= WIZARD ================= */

let wizardAnswers = { industry: null };

function renderWizardStep() {
  const container = document.getElementById('wizard-question');
  container.innerHTML = `
    <p class="wizard-progress">Step 1 of 1</p>
    <h3>What kind of business is this SOP for?</h3>
    <div class="wizard-options">
      ${Object.entries(INDUSTRIES).map(([id, i]) => `<button type="button" class="wizard-option" data-value="${id}">${escapeHTML(i.label)}</button>`).join('')}
    </div>
  `;
  container.querySelectorAll('.wizard-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      wizardAnswers.industry = btn.dataset.value;
      finishWizard();
    });
  });
}

function finishWizard() {
  document.getElementById('wizard').hidden = true;
  document.getElementById('sop-workspace').hidden = false;
  document.getElementById('sop-quick-nav').hidden = false;
  const industry = INDUSTRIES[wizardAnswers.industry] || INDUSTRIES.other;
  document.getElementById('sop-tip').textContent =
    `For ${industry.label.toLowerCase()}, a common starting point is ${industry.standards.join(', ')} \u2014 already added as tags below. Add, remove, or type your own; Generate will suggest more once it reads your process.`;
  // Seed the standards tag list fresh only if this is the very first
  // time finishing the wizard this session \u2014 re-running the wizard
  // (Edit answers) after picking a different industry should NOT wipe
  // out standards the business already added or edited.
  if (!document.querySelector('.sop-standard-tag')) {
    industry.standards.forEach((name) => addStandardTag(name, ''));
  }
  assembleSOPText(); // populates the empty-state document preview
}

function editAnswers() {
  document.getElementById('sop-workspace').hidden = true;
  document.getElementById('sop-quick-nav').hidden = true;
  document.getElementById('wizard').hidden = false;
}

/* ================= STANDARDS TAGS ================= */

function addStandardTag(name, note) {
  name = name.trim();
  if (!name) return;
  const container = document.getElementById('sop-standards-tags');
  const existing = Array.from(container.querySelectorAll('.sop-standard-tag')).find((t) => t.dataset.name.toLowerCase() === name.toLowerCase());
  if (existing) {
    if (note) existing.dataset.note = note; // Generate re-running can add a note to a tag that was already there
    renderStandardTag(existing, name, existing.dataset.note || '');
    return;
  }
  const tag = document.createElement('span');
  tag.className = 'sop-standard-tag';
  tag.dataset.name = name;
  tag.dataset.note = note || '';
  container.appendChild(tag);
  renderStandardTag(tag, name, note || '');
}

function renderStandardTag(tag, name, note) {
  tag.innerHTML = `${escapeHTML(name)}${note ? `<span class="tooltip-icon" data-tooltip="${escapeHTML(note)}">?</span>` : ''}<button type="button" class="sop-standard-remove" aria-label="Remove ${escapeHTML(name)}">&times;</button>`;
  tag.querySelector('.sop-standard-remove').addEventListener('click', () => tag.remove());
}

function getStandards() {
  return Array.from(document.querySelectorAll('.sop-standard-tag')).map((t) => ({ name: t.dataset.name, note: t.dataset.note || '' }));
}

/* ================= REPEATABLE ROWS (definitions / responsibilities / records / revisions / procedure)
   Same "add a row, edit it, delete it" pattern used throughout this
   site (createIngredientRow, createOverheadRow, createMenuRow) \u2014
   deliberately generalized here into two small helpers since these
   rows are simple 1-3 text fields each, rather than five near-
   identical functions repeating the same handful of lines. */

let rowIdCounter = 0;

function createFieldRow(tbodyId, fields) {
  // fields: [{ cls, placeholder }, ...] \u2014 one <input type="text"> per entry
  rowIdCounter++;
  const tbody = document.getElementById(tbodyId);
  const tr = document.createElement('tr');
  tr.dataset.rowId = 'sop-row-' + rowIdCounter;
  tr.innerHTML = fields.map((f) => `<td><input type="text" class="${f.cls}" placeholder="${escapeHTML(f.placeholder)}"></td>`).join('')
    + `<td class="no-print"><button type="button" class="delete-row" aria-label="Remove this row">&times;</button></td>`;
  tbody.appendChild(tr);
  tr.querySelector('.delete-row').addEventListener('click', () => tr.remove());
  return tr;
}

function readFieldRows(tbodyId, classes) {
  return Array.from(document.querySelectorAll(`#${tbodyId} > tr`)).map((tr) => {
    const out = {};
    classes.forEach((cls) => { out[cls] = tr.querySelector('.' + cls).value.trim(); });
    return out;
  }).filter((row) => Object.values(row).some((v) => v));
}

function addDefinitionRow(term, meaning) {
  const tr = createFieldRow('sop-definitions-rows', [
    { cls: 'sop-def-term', placeholder: 'Term or abbreviation' },
    { cls: 'sop-def-meaning', placeholder: 'What it means' },
  ]);
  if (term) tr.querySelector('.sop-def-term').value = term;
  if (meaning) tr.querySelector('.sop-def-meaning').value = meaning;
}
function addResponsibilityRow(role, duty) {
  const tr = createFieldRow('sop-responsibilities-rows', [
    { cls: 'sop-resp-role', placeholder: 'Role (e.g. Shift Supervisor)' },
    { cls: 'sop-resp-duty', placeholder: 'What they\u2019re responsible for' },
  ]);
  if (role) tr.querySelector('.sop-resp-role').value = role;
  if (duty) tr.querySelector('.sop-resp-duty').value = duty;
}
function addRecordRow(name) {
  const tr = createFieldRow('sop-records-rows', [{ cls: 'sop-record-name', placeholder: 'e.g. Daily temperature log' }]);
  if (name) tr.querySelector('.sop-record-name').value = name;
}
function addRevisionRow(version, date, description) {
  const tr = createFieldRow('sop-revisions-rows', [
    { cls: 'sop-rev-version', placeholder: '1.0' },
    { cls: 'sop-rev-date', placeholder: 'YYYY-MM-DD' },
    { cls: 'sop-rev-desc', placeholder: 'What changed' },
  ]);
  tr.querySelector('.sop-rev-version').value = version || '';
  tr.querySelector('.sop-rev-date').value = date || '';
  tr.querySelector('.sop-rev-desc').value = description || '';
}

/* ---- Procedure: order genuinely matters here (it's a sequence of
   steps), so it gets its own row type with move-up/move-down instead
   of the generic helper above, and its own live renumbering. ---- */

function addProcedureRow(stepText) {
  rowIdCounter++;
  const list = document.getElementById('sop-procedure-rows');
  const row = document.createElement('div');
  row.className = 'sop-step-row';
  row.dataset.rowId = 'sop-row-' + rowIdCounter;
  row.innerHTML = `
    <span class="sop-step-number"></span>
    <textarea class="sop-step-text" rows="2" placeholder="One clear action \u2014 e.g. \u201cCheck the delivery against the purchase order before signing.\u201d"></textarea>
    <div class="sop-step-controls no-print">
      <button type="button" class="sop-step-up" aria-label="Move step up">&uarr;</button>
      <button type="button" class="sop-step-down" aria-label="Move step down">&darr;</button>
      <button type="button" class="delete-row sop-step-remove" aria-label="Remove this step">&times;</button>
    </div>
  `;
  list.appendChild(row);
  if (stepText) row.querySelector('.sop-step-text').value = stepText;

  row.querySelector('.sop-step-up').addEventListener('click', () => {
    const prev = row.previousElementSibling;
    if (prev) list.insertBefore(row, prev);
    renumberProcedure();
  });
  row.querySelector('.sop-step-down').addEventListener('click', () => {
    const next = row.nextElementSibling;
    if (next) list.insertBefore(next, row);
    renumberProcedure();
  });
  row.querySelector('.sop-step-remove').addEventListener('click', () => { row.remove(); renumberProcedure(); });

  renumberProcedure();
}
function renumberProcedure() {
  document.querySelectorAll('#sop-procedure-rows > .sop-step-row').forEach((row, i) => {
    row.querySelector('.sop-step-number').textContent = (i + 1) + '.';
  });
}
function getProcedureSteps() {
  return Array.from(document.querySelectorAll('#sop-procedure-rows > .sop-step-row'))
    .map((row) => row.querySelector('.sop-step-text').value.trim())
    .filter(Boolean);
}

/* ================= ASSEMBLE (the one place print / download / translate all read from) ================= */

function assembleSOPText() {
  const lines = [];
  const title = val('sop-doc-title') || 'Standard Operating Procedure';
  lines.push(title.toUpperCase());
  lines.push('Document No.: ' + (val('sop-doc-number') || '[Insert Document No.]') + '    Version: 1.0');
  lines.push('Department/Owner: ' + (val('sop-doc-department') || '[Insert Department]'));
  lines.push('Effective Date: ' + (val('sop-doc-effective') || '[Insert Date]'));
  lines.push('');
  lines.push('1. PURPOSE');
  lines.push(val('sop-purpose') || '[Not yet filled in]');
  lines.push('');
  lines.push('2. SCOPE');
  lines.push(val('sop-scope') || '[Not yet filled in]');
  lines.push('');
  lines.push('3. DEFINITIONS & ABBREVIATIONS');
  const defs = readFieldRows('sop-definitions-rows', ['sop-def-term', 'sop-def-meaning']);
  lines.push(defs.length ? defs.map((d) => `- ${d['sop-def-term']}: ${d['sop-def-meaning']}`).join('\n') : '(None)');
  lines.push('');
  lines.push('4. ROLES & RESPONSIBILITIES');
  const resp = readFieldRows('sop-responsibilities-rows', ['sop-resp-role', 'sop-resp-duty']);
  lines.push(resp.length ? resp.map((r) => `- ${r['sop-resp-role']}: ${r['sop-resp-duty']}`).join('\n') : '[Not yet filled in]');
  lines.push('');
  lines.push('5. PROCEDURE');
  const steps = getProcedureSteps();
  lines.push(steps.length ? steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : '[Not yet filled in]');
  lines.push('');
  lines.push('6. RELATED / REFERENCED STANDARDS');
  const standards = getStandards();
  lines.push(standards.length ? standards.map((s) => `- ${s.name}${s.note ? ' \u2014 ' + s.note : ''}`).join('\n') : '(None selected)');
  lines.push('');
  lines.push('7. RECORDS & FORMS');
  const records = readFieldRows('sop-records-rows', ['sop-record-name']);
  lines.push(records.length ? records.map((r) => `- ${r['sop-record-name']}`).join('\n') : '(None)');
  lines.push('');
  lines.push('8. REVISION HISTORY');
  const revs = readFieldRows('sop-revisions-rows', ['sop-rev-version', 'sop-rev-date', 'sop-rev-desc']);
  lines.push(revs.length ? revs.map((r) => `${r['sop-rev-version'] || '\u2014'} | ${r['sop-rev-date'] || '\u2014'} | ${r['sop-rev-desc'] || '\u2014'}`).join('\n') : '1.0 | \u2014 | Initial draft');

  const text = lines.join('\n');
  const preview = document.getElementById('sop-doc-text-preview');
  if (preview) preview.textContent = text; // kept only for the "Copy" convenience button, not the source of truth
  return text;
}

/* ================= WORKER CALL ================= */

async function callWorker(payload) {
  let response;
  try {
    response = await fetch(PROXY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    throw new Error('Could not reach the drafting service \u2014 check PROXY_ENDPOINT is correct and this page\u2019s URL is in the Worker\u2019s ALLOWED_ORIGINS.');
  }
  let data;
  try { data = await response.json(); }
  catch (e) { throw new Error('Got an unreadable response. Try again.'); }
  if (!response.ok) throw new Error(data.error || ('Request failed (error ' + response.status + '). Try again.'));
  return data;
}

/* ================= GENERATE ================= */

function hasAnyDraftedContent() {
  return !!(val('sop-purpose') || val('sop-scope') || document.querySelector('#sop-definitions-rows > tr')
    || document.querySelector('#sop-responsibilities-rows > tr') || document.querySelector('#sop-procedure-rows > .sop-step-row')
    || document.querySelector('#sop-records-rows > tr'));
}

async function generateSOP() {
  const statusEl = document.getElementById('sop-generate-status');
  const flowSummary = document.getElementById('sop-flow-summary').value.trim();
  if (!flowSummary) { setStatus(statusEl, 'Describe the process first.', true); return; }
  if (!PROXY_ENDPOINT || PROXY_ENDPOINT.indexOf('PASTE_YOUR') === 0) {
    setStatus(statusEl, 'This tool needs its proxy URL set \u2014 see PROXY_ENDPOINT near the top of sop-creator.js.', true);
    return;
  }
  if (getUsageToday() + 1 > MAX_ANALYSES_PER_DAY) {
    setStatus(statusEl, 'This browser has hit today\u2019s drafting limit. Try again tomorrow.', true);
    return;
  }
  if (hasAnyDraftedContent()) {
    const ok = confirm('Generate will replace the Purpose, Scope, Definitions, Responsibilities, Procedure, and Records below with a fresh draft based on the process description above. Standards tags are kept, not replaced. Continue?');
    if (!ok) return;
  }

  const btn = document.getElementById('sop-generate-btn');
  btn.disabled = true;
  setStatus(statusEl, 'Reading your process description\u2026');

  try {
    const data = await callWorker({
      industry: (INDUSTRIES[wizardAnswers.industry] || INDUSTRIES.other).label,
      processName: val('sop-process-name'),
      department: val('sop-doc-department'),
      standards: getStandards().map((s) => s.name),
      flowSummary,
    });
    recordUsage();

    document.getElementById('sop-purpose').value = data.purpose || '';
    document.getElementById('sop-scope').value = data.scope || '';

    document.getElementById('sop-definitions-rows').innerHTML = '';
    (data.definitions || []).forEach((d) => addDefinitionRow(d.term, d.meaning));

    document.getElementById('sop-responsibilities-rows').innerHTML = '';
    (data.responsibilities || []).forEach((r) => addResponsibilityRow(r.role, r.duty));

    document.getElementById('sop-procedure-rows').innerHTML = '';
    (data.procedure || []).forEach((p) => addProcedureRow(p.step));

    document.getElementById('sop-records-rows').innerHTML = '';
    (data.records || []).forEach((r) => addRecordRow(r));

    (data.suggestedStandards || []).forEach((s) => addStandardTag(s.name, s.note));

    document.getElementById('sop-doc-title').value = val('sop-doc-title') || (val('sop-process-name') ? val('sop-process-name') + ' \u2014 Standard Operating Procedure' : 'Standard Operating Procedure');

    assembleSOPText();
    document.getElementById('sop-doc-section').hidden = false;
    document.getElementById('sop-translate-section').hidden = false;
    setStatus(statusEl, 'Draft ready below \u2014 review every field, especially anything marked \u201c[assumed]\u201d, before using this for real.');
    document.getElementById('sop-doc').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    setStatus(statusEl, err.message || 'Something went wrong. Try again.', true);
  } finally {
    btn.disabled = false;
  }
}

/* ================= TRANSLATE ================= */

async function translateSOP() {
  const statusEl = document.getElementById('sop-translate-status');
  const targetLanguage = document.getElementById('sop-language-select').value;
  const sourceText = assembleSOPText();
  if (!document.getElementById('sop-purpose').value.trim() && !document.getElementById('sop-scope').value.trim()) {
    setStatus(statusEl, 'Generate (or fill in) the SOP above first \u2014 there\u2019s nothing to translate yet.', true);
    return;
  }
  if (getUsageToday() + 1 > MAX_ANALYSES_PER_DAY) {
    setStatus(statusEl, 'This browser has hit today\u2019s drafting limit. Try again tomorrow.', true);
    return;
  }
  const btn = document.getElementById('sop-translate-btn');
  btn.disabled = true;
  setStatus(statusEl, 'Translating into ' + targetLanguage + '\u2026');
  try {
    const data = await callWorker({ mode: 'translate', text: sourceText, targetLanguage });
    recordUsage();
    const output = document.getElementById('sop-translated-output');
    output.value = data.text || '';
    output.hidden = false;
    document.getElementById('sop-translated-actions').hidden = false;
    document.getElementById('sop-translated-lang-label').textContent = targetLanguage;
    setStatus(statusEl, 'Translated \u2014 you can edit the result below before downloading it.');
  } catch (err) {
    setStatus(statusEl, err.message || 'Something went wrong. Try again.', true);
  } finally {
    btn.disabled = false;
  }
}

/* ================= DOWNLOAD (client-side Blob, same as every export button on this site) ================= */

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function downloadSourceSOP() {
  const name = (val('sop-doc-title') || 'SOP').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'SOP';
  downloadText(assembleSOPText(), name + '.txt');
}
function downloadTranslatedSOP() {
  const name = (val('sop-doc-title') || 'SOP').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'SOP';
  const lang = document.getElementById('sop-language-select').value.replace(/[^a-z0-9]+/gi, '-');
  downloadText(document.getElementById('sop-translated-output').value, name + '-' + lang + '.txt');
}

/* ================= INIT ================= */

let rzInitialized = false;

function init() {
  if (rzInitialized) return;
  rzInitialized = true;

  try {
    renderWizardStep();
    document.getElementById('sop-edit-answers').addEventListener('click', editAnswers);
    document.getElementById('sop-save-pdf').addEventListener('click', () => window.print());
    document.getElementById('sop-download-source').addEventListener('click', downloadSourceSOP);
    document.getElementById('sop-generate-btn').addEventListener('click', generateSOP);
    document.getElementById('sop-translate-btn').addEventListener('click', translateSOP);
    document.getElementById('sop-download-translated').addEventListener('click', downloadTranslatedSOP);

    document.getElementById('sop-add-definition').addEventListener('click', () => addDefinitionRow());
    document.getElementById('sop-add-responsibility').addEventListener('click', () => addResponsibilityRow());
    document.getElementById('sop-add-record').addEventListener('click', () => addRecordRow());
    document.getElementById('sop-add-procedure').addEventListener('click', () => addProcedureRow());
    document.getElementById('sop-add-revision').addEventListener('click', () => addRevisionRow());

    document.getElementById('sop-add-standard-btn').addEventListener('click', () => {
      const input = document.getElementById('sop-add-standard-input');
      addStandardTag(input.value, '');
      input.value = '';
      input.focus();
    });
    document.getElementById('sop-add-standard-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('sop-add-standard-btn').click(); }
    });

    // Populate the language <select> and the standards <datalist> from
    // CONFIG \u2014 the one non-negotiable ("Everything you can change
    // without touching code" is a documented aspiration on this site,
    // not yet a separate config file for any tool, so these two lists
    // still live in sop-creator.js's own CONFIG block; see this tool's
    // own SETUP_AND_GLOSSARY doc for exactly which lines to edit).
    document.getElementById('sop-language-select').innerHTML = LANGUAGES.map((l) => `<option value="${escapeHTML(l)}">${escapeHTML(l)}</option>`).join('');
    document.getElementById('sop-standards-datalist').innerHTML = STANDARDS_LIBRARY.map((s) => `<option value="${escapeHTML(s)}">`).join('');

    // Seed one revision row so the document never renders an empty
    // Revision History table \u2014 matches the "always start with one"
    // convention already used for ingredient/overhead/job rows.
    addRevisionRow('1.0', new Date().toISOString().slice(0, 10), 'Initial draft');

    // Re-assemble on any edit anywhere in the document panel, so the
    // Copy-text convenience box and the translate/download source
    // never go stale. Delegated to one listener on the whole panel
    // rather than wiring every single input individually.
    document.getElementById('sop-doc').addEventListener('input', assembleSOPText);

    // Floating quick-nav, same bottom-right cluster pattern as every
    // other multi-section tool on this site (Food Worth, Margin
    // Analysis, Rental Calculator, Crypto Radar all do this).
    document.querySelectorAll('.sop-quick-nav-btn[data-target]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });

    console.log('[SOP Creator] init complete, all listeners attached');
  } catch (err) {
    console.error('[SOP Creator] setup failed:', err);
  }
}

document.addEventListener('DOMContentLoaded', init);
