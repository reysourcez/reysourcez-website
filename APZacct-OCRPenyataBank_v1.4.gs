// APZacct release 1.4 - file APZacct-OCRPenyataBank_v1.4.gs (renamed with the release number, version constant added, no logic change)
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_OCRPENYATABANK). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — OCR Penyata Bank (Bank Statement OCR -> Review -> Post)
 * ---------------------------------------------------
 * v1.1 (this file) — the actual Gemini call is now a shared function,
 * ekstrakPenyataBank_(), used by both this file's import flow AND the
 * new APZacct-RekonsiliasiBank_v1.4.gs. Both need the exact same OCR step
 * (read a statement, return structured lines with a consistency
 * check) — one posts new entries from it, the other compares it
 * against what's already in the ledger. v1.0's logic is unchanged,
 * just moved into a function that returns a plain object instead of
 * calling jsonOut_ directly, so a second caller can inspect the
 * result before deciding its own response shape.
 *
 * Called by doPost in APZacct-WebAPI_v1.4.gs when the request body has
 * action: 'ocr_penyata_bank'. Takes a bank statement (PDF or image,
 * base64) and returns a list of suggested transactions for a human to
 * review in the browser — it does NOT write anything to
 * Transaksi/Baris_Transaksi itself. Posting still goes through the
 * exact same doPost the normal wizard uses, once per confirmed row,
 * from penyata-bank.js.
 *
 * Two things matter more here than in janaRingkasanAI()'s summary
 * call, which is why this doesn't just reuse that file's model/setup:
 *
 * 1. STRUCTURED OUTPUT, not prose. generationConfig.response_schema
 *    forces Gemini to return actual JSON matching a fixed shape,
 *    rather than hoping it writes well-formed JSON inside a text
 *    reply. This is the current documented pattern for structured
 *    extraction (ai.google.dev/gemini-api/docs/structured-output).
 *
 * 2. A DETERMINISTIC SANITY CHECK on top of the model's own answer.
 *    Every bank statement prints a running balance after each line —
 *    tandakKetidakkonsistenan_() below recomputes what that balance
 *    SHOULD be from the debit/kredit Gemini extracted, and flags any
 *    row where it doesn't match what the statement actually shows.
 *    This catches OCR misreads (a smudged 7 read as a 1, a skipped
 *    line) automatically, before a human ever looks at the table —
 *    it does not need a second AI call, it's just arithmetic.
 *
 * Uses a stronger, non-"lite" model on purpose — this is reading a
 * table for numbers that go straight into a ledger, which is a
 * different accuracy bar than a one-shot prose summary. Deliberately
 * a SEPARATE constant from janaRingkasanAI()'s GEMINI_MODEL (both
 * live in the same Apps Script project, so they can't share a name —
 * `const` can't be redeclared across files here any more than within
 * one file) so the two tasks can be tuned independently.
 * Check https://ai.google.dev/gemini-api/docs/changelog if this ever
 * starts 404-ing.
 *
 * SETUP: Extensions > Apps Script > paste alongside your other
 * APZacct scripts > Save. Needs the same GEMINI_API_KEY script
 * property janaRingkasanAI() already uses (Project Settings > Script
 * Properties) — nothing new to configure if that's already set.
 *
 * NOTE: not yet run against a real bank statement. Sanity-check
 * against one real (or one deliberately messy/blurry) statement
 * before trusting this with a real month-end catch-up.
 */
const APZ_VER_OCRPENYATABANK = '1.4';

const GEMINI_MODEL_PENYATA = 'gemini-3.1-flash'; // not flash-lite — table accuracy matters more here
const MAX_PENYATA_TRANSAKSI = 200; // sane ceiling so a malformed response can't hand the browser an unbounded table

function prosesOCRPenyataBank_(body) {
  return jsonOut_(ekstrakPenyataBank_(body));
}

// Shared by prosesOCRPenyataBank_ (this file) and
// prosesRekonsiliasiBank_ (APZacct-RekonsiliasiBank_v1.4.gs). Returns a
// PLAIN OBJECT — either { error: '...' } or { transaksi, bilangan,
// bilanganTidakKonsisten, dipotong } — never a ContentService object,
// so callers can inspect it and add their own fields before wrapping
// their own response in jsonOut_.
function ekstrakPenyataBank_(body) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    return { error: 'RALAT: GEMINI_API_KEY belum ditetapkan. Project Settings > Script Properties > Add script property.' };
  }
  if (!body.fileData) {
    return { error: 'RALAT: tiada fail penyata bank diterima.' };
  }
  const akaunWang = Number(body.akaunWang);
  if (!akaunWang) {
    return { error: 'RALAT: pilih akaun bank/wang yang berkaitan dahulu sebelum muat naik.' };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const akaun = ss.getSheetByName('Akaun');
  const numRows = AKAUN_API_LAST_ROW - AKAUN_API_FIRST_ROW + 1;
  const akaunRows = akaun.getRange(AKAUN_API_FIRST_ROW, 1, numRows, 9).getValues();

  const senaraiKategoriUntukPrompt = akaunRows
    .filter(function (r) { return r[0] !== '' && r[0] !== null && r[6] === 'Aktif' && Number(r[0]) !== akaunWang; })
    .map(function (r) { return r[0] + ': ' + r[2]; })
    .join('\n');

  const prompt =
    'Anda membaca satu penyata bank koperasi Malaysia (mungkin berbilang muka surat). Ekstrak SETIAP baris ' +
    'transaksi sebenar yang tertera (bukan baris ringkasan, subtotal, atau tajuk lajur). Untuk setiap baris:\n' +
    '- tarikh: format YYYY-MM-DD\n' +
    '- perkara: penerangan/rujukan seperti tertera pada penyata, jangan ubah atau ringkaskan\n' +
    '- debit: amaun wang KELUAR daripada akaun (0 jika baris ini bukan debit)\n' +
    '- kredit: amaun wang MASUK ke akaun (0 jika baris ini bukan kredit)\n' +
    '- bakiBerjalan: baki berjalan selepas baris ini SEPERTI TERTERA PADA PENYATA \u2014 ambil terus daripada ' +
    'penyata, JANGAN kira atau anggarkan sendiri\n' +
    '- kodKategoriDicadang: SATU kod akaun paling sesuai daripada senarai di bawah, berdasarkan perkara. ' +
    'Jika tidak pasti, guna 0 \u2014 JANGAN meneka secara sembarangan.\n\n' +
    'Senarai akaun kategori aktif (kod: nama):\n' + senaraiKategoriUntukPrompt;

  const schema = {
    type: 'OBJECT',
    properties: {
      transaksi: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            tarikh: { type: 'STRING' },
            perkara: { type: 'STRING' },
            debit: { type: 'NUMBER' },
            kredit: { type: 'NUMBER' },
            bakiBerjalan: { type: 'NUMBER' },
            kodKategoriDicadang: { type: 'NUMBER' }
          },
          required: ['tarikh', 'perkara', 'debit', 'kredit', 'bakiBerjalan', 'kodKategoriDicadang']
        }
      }
    },
    required: ['transaksi']
  };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL_PENYATA + ':generateContent?key=' + apiKey;
  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: body.fileMime || 'application/pdf', data: body.fileData } }
      ]
    }],
    generationConfig: {
      response_mime_type: 'application/json',
      response_schema: schema
    }
  };

  let data;
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    data = JSON.parse(response.getContentText());
  } catch (err) {
    return { error: 'RALAT sambungan Gemini: ' + err.message };
  }

  if (data.error) {
    return {
      error: 'RALAT Gemini: ' + data.error.message +
        '. Jika ini ralat "not found" atau 404, model "' + GEMINI_MODEL_PENYATA + '" mungkin sudah dihentikan \u2014 ' +
        'semak https://ai.google.dev/gemini-api/docs/changelog dan tukar GEMINI_MODEL_PENYATA di atas fail ini.'
    };
  }

  let hasil;
  try {
    const teks = data.candidates[0].content.parts[0].text;
    hasil = JSON.parse(teks);
  } catch (err) {
    return { error: 'RALAT: Gemini tidak pulangkan JSON yang sah untuk fail ini. Cuba semula, atau muat naik imbasan yang lebih jelas.' };
  }

  let transaksi = Array.isArray(hasil.transaksi) ? hasil.transaksi : [];
  if (!transaksi.length) {
    return { error: 'Tiada transaksi dikesan dalam fail ini. Semak fail betul dan cukup jelas untuk dibaca (bukan kabur/senget).' };
  }
  const dipotong = transaksi.length > MAX_PENYATA_TRANSAKSI;
  if (dipotong) transaksi = transaksi.slice(0, MAX_PENYATA_TRANSAKSI);

  tandakKetidakkonsistenan_(transaksi);

  const namaAkaunMap = {};
  akaunRows.forEach(function (r) { if (r[0] !== '' && r[0] !== null) namaAkaunMap[Number(r[0])] = r[2]; });
  transaksi.forEach(function (t) {
    t.namaKategoriDicadang = namaAkaunMap[Number(t.kodKategoriDicadang)] || '';
  });

  const bilanganTidakKonsisten = transaksi.filter(function (t) { return !t.konsisten; }).length;

  return {
    transaksi: transaksi,
    bilangan: transaksi.length,
    bilanganTidakKonsisten: bilanganTidakKonsisten,
    dipotong: dipotong
  };
}

// Recomputes what each line's running balance SHOULD be from the
// debit/kredit Gemini extracted, and compares it to what the
// statement actually shows for that line. Pure arithmetic, no AI
// call — this is what catches an OCR misread without needing a
// second, equally-fallible model pass to "double check" the first.
function tandakKetidakkonsistenan_(transaksi) {
  let bakiSebelum = null;
  transaksi.forEach(function (t) {
    t.konsisten = true;
    t.amaranKonsisten = '';
    const debit = Number(t.debit) || 0;
    const kredit = Number(t.kredit) || 0;
    const bakiBerjalan = Number(t.bakiBerjalan);

    if (debit && kredit) {
      t.konsisten = false;
      t.amaranKonsisten = 'Debit dan Kredit kedua-duanya ada nilai \u2014 tidak sepatutnya berlaku, semak baris ini.';
    } else if (bakiSebelum !== null && !isNaN(bakiBerjalan)) {
      const jangkaan = Math.round((bakiSebelum - debit + kredit) * 100) / 100;
      const sebenar = Math.round(bakiBerjalan * 100) / 100;
      if (Math.abs(jangkaan - sebenar) > 0.01) {
        t.konsisten = false;
        t.amaranKonsisten = 'Baki jangkaan RM' + jangkaan.toFixed(2) + ' tidak sepadan RM' + sebenar.toFixed(2) + ' pada penyata \u2014 semak baris ini.';
      }
    }
    if (!isNaN(bakiBerjalan)) bakiSebelum = bakiBerjalan;
  });
}
