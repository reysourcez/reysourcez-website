// APZacct release 1.4 - file APZacct-WangRuncit_v1.4.gs (renamed with the release number, version constant added, no logic change)
/**
 * RELEASE 1.4: all APZacct files now share one release number (file name, first line, constant APZ_VER_WANGRUNCIT). Entries below older than 1.4 are this file's own history; its old numbers are retired.
 * APZacct — Semak Wang Runcit (Petty Cash Reconciliation)
 * ---------------------------------------------------
 * v1.0 (new this round). Wang_Runcit already computed a correct
 * variance (Baki Buku - Baki Fizikal) in B9 — the gap was that B6/B7
 * are a single snapshot that gets overwritten every time, so there
 * was never a trail showing whether small variances are one-off typos
 * or a slow, repeated leak. This adds a running log below the
 * existing snapshot (untouched — same B4/B5/B9/B10 cells, same
 * formulas, nothing there changes) and a guided prompt that fills
 * both the snapshot AND the log in one step.
 *
 * ONE-TIME MANUAL STEP before first use: add a row to Tetapan (row 19
 * is free) — label "Had Amaran Perbezaan Wang Runcit (RM)" in column
 * A, a number like 10 in both columns B and C. This function reads
 * Tetapan!C19 and falls back to RM10 if that row doesn't exist yet,
 * so it works either way — but adding it properly means you can tune
 * the alert threshold later without touching code, same pattern as
 * every other Tetapan setting.
 *
 * SETUP: Extensions > Apps Script > paste alongside your other
 * APZacct scripts > Save > reload the sheet.
 */
const APZ_VER_WANGRUNCIT = '1.4';

function semakWangRuncit() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const wr = ss.getSheetByName('Wang_Runcit');
  const tetapan = ss.getSheetByName('Tetapan');
  if (!wr) { ui.alert('RALAT: helaian "Wang_Runcit" tidak dijumpai.'); return; }

  const bakiBuku = Number(wr.getRange('B5').getValue()) || 0;

  const resp = ui.prompt(
    'Semakan Wang Runcit',
    'Baki mengikut buku sekarang: RM' + bakiBuku.toFixed(2) +
    '\n\nKira duit sebenar dalam tin/peti SEKARANG, dan masukkan jumlahnya (RM):',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  const bakiFizikal = Number(resp.getResponseText().trim().replace(',', '.'));
  if (isNaN(bakiFizikal) || bakiFizikal < 0) {
    ui.alert('RALAT: masukkan nombor yang sah (cth. 487.50).');
    return;
  }

  const perbezaan = Math.round((bakiBuku - bakiFizikal) * 100) / 100;
  const status = perbezaan === 0 ? 'SEPADAN' : 'PERLU SIASAT';
  const tarikh = new Date();

  let nota = '';
  if (perbezaan !== 0) {
    const notaResp = ui.prompt(
      'Ada Perbezaan \u2014 Nyatakan Sebab',
      'Perbezaan RM' + Math.abs(perbezaan).toFixed(2) + ' (' + (perbezaan > 0 ? 'kurang daripada buku' : 'lebih daripada buku') + ') dikesan. ' +
      'Nyatakan sebab atau tindakan (cth. "Resit belum dicatat", "Kehilangan disahkan, dilaporkan kepada bendahari"):',
      ui.ButtonSet.OK_CANCEL
    );
    nota = (notaResp.getSelectedButton() === ui.Button.OK && notaResp.getResponseText().trim())
      ? notaResp.getResponseText().trim()
      : '(tiada nota diberikan)';
  }

  // update the existing live snapshot — unchanged behaviour, B9/B10 formulas recompute automatically
  wr.getRange('B6').setValue(tarikh);
  wr.getRange('B7').setValue(bakiFizikal);

  // append to the running log
  ensureWangRuncitLogHeader_(wr);
  const logRow = findFirstBlankRowFrom_(wr, 1, 18);
  wr.getRange(logRow, 1, 1, 6).setValues([[tarikh, bakiBuku, bakiFizikal, perbezaan, status, nota]]);
  wr.getRange(logRow, 1).setNumberFormat('yyyy-mm-dd');

  const hadAmaranRaw = tetapan ? tetapan.getRange('C19').getValue() : '';
  const hadAmaran = Number(hadAmaranRaw) || 10; // defaults to RM10 until Tetapan row 19 is added

  if (Math.abs(perbezaan) > hadAmaran) {
    ui.alert(
      'AMARAN \u2014 PERBEZAAN MELEBIHI HAD\n\n' +
      'Perbezaan RM' + Math.abs(perbezaan).toFixed(2) + ' melebihi had amaran RM' + hadAmaran.toFixed(2) +
      (tetapan && !isNaN(Number(hadAmaranRaw)) && hadAmaranRaw !== '' ? ' (Tetapan!C19)' : ' (lalai \u2014 Tetapan!C19 belum ditambah)') +
      '.\n\nDirekodkan dalam log. Disyorkan disiasat serta-merta dan dilaporkan kepada Lembaga / Jawatankuasa Audit Dalaman.'
    );
  } else {
    ui.alert('Direkodkan dalam log. Status: ' + status + (perbezaan !== 0 ? (' (RM' + Math.abs(perbezaan).toFixed(2) + ')') : ''));
  }
}

// idempotent — only writes the header once, safe to call every time
function ensureWangRuncitLogHeader_(wr) {
  if (wr.getRange('A17').getValue() === 'Tarikh') return;
  wr.getRange('A16').setValue('LOG PENGIRAAN FIZIKAL (sejarah)').setFontWeight('bold');
  wr.getRange(17, 1, 1, 6).setValues([['Tarikh', 'Baki Buku', 'Baki Fizikal', 'Perbezaan', 'Status', 'Nota']]);
  wr.getRange(17, 1, 1, 6).setFontWeight('bold');
}

// deliberately a DIFFERENT name from findFirstBlankRow_ (used
// elsewhere in this project starting at row 5) — this project shares
// one Apps Script namespace across every file, and this one needs a
// configurable start row, so it can't safely reuse that name.
function findFirstBlankRowFrom_(sheet, checkCol, startRow) {
  const maxRow = sheet.getMaxRows();
  const vals = sheet.getRange(startRow, checkCol, Math.max(maxRow - startRow + 1, 1), 1).getValues();
  for (let i = 0; i < vals.length; i++) {
    if (!vals[i][0]) return startRow + i;
  }
  return maxRow + 1;
}
