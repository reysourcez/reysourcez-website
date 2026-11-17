/* ============================================================
   Scan to Document - Word (.docx) and text export (v0.3, 2026-11-12)
   No outside library: a minimal ZIP writer (stored, no compression) plus the WordprocessingML a text document needs.
   No DOM code: runs in the browser and under Node for tests.
   Model: { paragraphs: [ { type: 'heading'|'body'|'note'|'list', align: 'left'|'center'|'right'|'justify', text, sizePt,
            bold, italic, indentMm, firstLineMm } ], font, headingFont, page: { widthMm, heightMm }, margins: { left, right, top, bottom }, title }
   ============================================================ */
(function (root) {
'use strict';

const VERSION = 'v0.3 (2026-11-12)';
const enc = (s) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : Buffer.from(s, 'utf8'));

/* ---------------- ZIP (store only) ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function dosDateTime(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
function zipStore(files) {                                      // files: [{ name, data: Uint8Array }]
  const dt = dosDateTime(new Date()), parts = [], central = [];
  let offset = 0;
  files.forEach((f) => {
    const name = enc(f.name), crc = crc32(f.data), size = f.data.length;
    const lh = new Uint8Array(30 + name.length), v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true);
    v.setUint16(10, dt.time, true); v.setUint16(12, dt.date, true); v.setUint32(14, crc, true); v.setUint32(18, size, true); v.setUint32(22, size, true);
    v.setUint16(26, name.length, true); v.setUint16(28, 0, true); lh.set(name, 30);
    parts.push(lh, f.data);
    const ch = new Uint8Array(46 + name.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dt.time, true); c.setUint16(14, dt.date, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true);
    c.setUint16(28, name.length, true); c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true); c.setUint32(38, 0, true); c.setUint32(42, offset, true);
    ch.set(name, 46);
    central.push(ch);
    offset += lh.length + size;
  });
  const cdSize = central.reduce((a, b) => a + b.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true); e.setUint16(20, 0, true);
  const all = parts.concat(central, [end]), out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  all.forEach((b) => { out.set(b, p); p += b.length; });
  return out;
}

/* ---------------- WordprocessingML ---------------- */
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const esc = (s) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const twip = (mm) => Math.round(mm * 56.6929);
const JC = { left: 'left', center: 'center', right: 'right', justify: 'both' };

function runXml(text, font, sizePt, bold, italic) {
  const rpr = '<w:rPr>' + (font ? `<w:rFonts w:ascii="${esc(font)}" w:hAnsi="${esc(font)}" w:eastAsia="${esc(font)}" w:cs="${esc(font)}"/>` : '') + (bold ? '<w:b/><w:bCs/>' : '') + (italic ? '<w:i/><w:iCs/>' : '') +
    (sizePt ? `<w:sz w:val="${Math.round(sizePt * 2)}"/><w:szCs w:val="${Math.round(sizePt * 2)}"/>` : '') + '</w:rPr>';
  const pieces = String(text).split(/(\t|\n)/).map((s) => (s === '\t' ? '<w:tab/>' : s === '\n' ? '<w:br/>' : (s ? `<w:t xml:space="preserve">${esc(s)}</w:t>` : '')));
  return `<w:r>${rpr}${pieces.join('')}</w:r>`;
}

function paraXml(p, m) {
  const isTitle = p.type === 'heading' && p.align === 'center' && (p.sizePt || 0) >= 14;
  const style = isTitle ? 'Title' : (p.type === 'heading' ? 'Heading1' : '');
  const hanging = (p.firstLineMm || 0) < 0, indent = Math.max(0, p.indentMm || 0);
  let text = String(p.text == null ? '' : p.text);
  if (hanging && indent > 0) text = text.replace(/^(\S{1,9})\s+/, '$1\t');           // marker, tab, text: the hanging indent lines the text up
  let ppr = style ? `<w:pStyle w:val="${style}"/>` : '';
  if (p.type === 'heading') ppr += '<w:keepNext/>';
  ppr += `<w:spacing w:before="${p.type === 'heading' ? 200 : 0}" w:after="${p.type === 'heading' ? 100 : 120}"/>`;
  if (indent > 0 || p.firstLineMm) {
    ppr += `<w:ind w:left="${twip(indent)}"` + (hanging ? ` w:hanging="${twip(-p.firstLineMm)}"` : (p.firstLineMm > 0 ? ` w:firstLine="${twip(p.firstLineMm)}"` : '')) + '/>';
  }
  ppr += `<w:jc w:val="${JC[p.align] || 'left'}"/>`;
  const font = p.type === 'heading' ? (m.headingFont || m.font) : m.font;
  return `<w:p><w:pPr>${ppr}</w:pPr>${runXml(text, font, p.sizePt, p.type === 'heading' || p.bold, p.italic)}</w:p>`;
}

function stylesXml(m) {
  const f = esc(m.font || 'Times New Roman'), hf = esc(m.headingFont || m.font || 'Arial'), sz = Math.round((m.sizeBody || 10.5) * 2);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>` +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="${hf}" w:hAnsi="${hf}" w:eastAsia="${hf}" w:cs="${hf}"/><w:b/><w:bCs/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:rFonts w:ascii="${hf}" w:hAnsi="${hf}" w:eastAsia="${hf}" w:cs="${hf}"/><w:b/><w:bCs/></w:rPr></w:style></w:styles>`;
}

function buildDocx(model) {
  const m = model || {}, pg = m.page || { widthMm: 210, heightMm: 297 }, mg = m.margins || { left: 25, right: 25, top: 28, bottom: 25 };
  const body = (m.paragraphs || []).filter((p) => p && (p.text || '').trim() !== '').map((p) => paraXml(p, m)).join('') || '<w:p/>';
  const sect = `<w:sectPr><w:pgSz w:w="${twip(pg.widthMm)}" w:h="${twip(pg.heightMm)}"/><w:pgMar w:top="${twip(mg.top)}" w:right="${twip(mg.right)}" w:bottom="${twip(mg.bottom)}" w:left="${twip(mg.left)}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = [
    { name: '[Content_Types].xml', text: X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>' },
    { name: '_rels/.rels', text: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>' },
    { name: 'word/_rels/document.xml.rels', text: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'word/document.xml', text: X + `<w:document xmlns:w="${NS_W}"><w:body>${body}${sect}</w:body></w:document>` },
    { name: 'word/styles.xml', text: stylesXml(m) },
    { name: 'docProps/core.xml', text: X + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(m.title || 'Scanned document')}</dc:title><dc:creator>Reysourcez Scan to Document</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>` },
  ].map((f) => ({ name: f.name, data: enc(f.text) }));
  return zipStore(files);
}

function buildTxt(model) {                                      // plain text: one paragraph per block, blank line between
  return (model.paragraphs || []).map((p) => String(p.text || '').trim()).filter(Boolean).join('\n\n') + '\n';
}

const API = { VERSION, buildDocx, buildTxt, zipStore, crc32 };
root.ScanToDocDocx = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
