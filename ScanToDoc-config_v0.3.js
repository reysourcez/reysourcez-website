/* ============================================================
   Scan to Document - settings (v0.3, 2026-11-12)
   Everything you may want to change lives here. Edit a value, save, reload the page. No other file needs touching.
   Optional site-wide override: put the same keys under RZ_SITE_CONFIG.scanToDoc in site-config.js (this file keeps its own
   literal values when that block is absent, same pattern as the other tools).
   ============================================================ */
(function (root) {
'use strict';

const SD_CONFIG = {
  VERSION: 'v0.3 (2026-11-12)',
  NAME: 'Scan to Document',

  /* ---- Languages ----
     TO ADD A LANGUAGE: add one line below. `code` is the Tesseract language code (e.g. 'fra', 'chi_sim', 'ind').
     `on` = ticked by default. noteWords / annexWords help the paragraph rules recognise "NOTE 1" / "Annex A" style lines
     (starter guesses for Malay: check them against real pages). When you host the language files yourself, also put
     <code>.traineddata.gz into the folder named by ASSETS.langPath. */
  LANGUAGES: [
    { code: 'eng', label: 'English', on: true, noteWords: ['NOTE'], annexWords: ['Annex'] },
    { code: 'msa', label: 'Bahasa Melayu', on: true, noteWords: ['NOTA', 'CATATAN'], annexWords: ['Lampiran'] },
  ],

  /* ---- Engine files ----
     Leave the paths empty to use Tesseract.js's own defaults (files come from jsDelivr; your document is never uploaded).
     To host everything yourself later, copy the Tesseract.js files into your repo and fill in the three paths. */
  ASSETS: {
    tesseractScript: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js',
    workerPath: '',   // e.g. 'ScanToDoc-vendor/tesseract/worker.min.js'
    corePath: '',     // a FOLDER holding every tesseract-core*.wasm.js file, e.g. 'ScanToDoc-vendor/tesseract-core'
    langPath: '',     // a FOLDER holding <code>.traineddata.gz, e.g. 'ScanToDoc-vendor/lang' (no slash at the end)
    pdfJsBase: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/',   // same pinned version as Form Scanner
  },

  /* ---- Reading ---- */
  PAGE_MODE_DEFAULT: '4',       // Tesseract page mode: '4' one column of text (best for standards), '3' automatic, '11' sparse
  PAGE_MODES: [
    { value: '4', label: 'Text document, one column' },
    { value: '3', label: 'Automatic layout' },
    { value: '11', label: 'Sparse text (forms, labels)' },
  ],
  RENDER_DPI: 300,              // PDF pages are drawn at this resolution (Tesseract recommends 300)
  MIN_EDGE_PX: 2600,            // photos smaller than this (longest edge) are enlarged before reading
  MAX_EDGE_PX: 3800,            // photos larger than this are reduced
  MAX_FILE_MB: 40,
  MAX_PAGES: 60,                // safety cap per run
  LOW_CONF_BELOW: 70,           // words under this confidence are shown amber in the review list
  DROP_CONF_BELOW: 30,          // words under this confidence are ignored completely

  /* ---- Clean-up (no AI): see ScanToDoc-clean_v0.3.js ---- */
  CLEAN: {
    ENABLE: true,
    PAPER_BRIGHT: 110,          // grey level that separates paper from the dark scanner surround
    SHAVE_PX: 10,               // pixels shaved off the paper edge
    BG_DOWNSCALE: 8, BG_CLOSE: 9,   // lighting estimate: scale factor and closing window (on the small copy)
    THRESH_WINDOW: 41, THRESH_C: 12,// local threshold: window size and how much darker than the neighbourhood counts as ink
    SPECK_MAX: 9, SPECK_AREA: 70,   // a mark this small (px) is a speck unless it sits next to letters
    BLOB_RADIUS: 5,             // solid dark blobs wider than 2x this are removed
  },

  /* ---- Paragraph rules: see ScanToDoc-layout_v0.3.js ---- */
  LAYOUT: {
    BOLD: 1.4,                  // a line counts as bold when its stem thickness is this many times the body median
    TOL_PCT: 1.2,               // alignment tolerance, % of page width
    TOL_JUSTIFY_PCT: 0.45,      // right-edge tolerance for justified text, % of page width
    HEADER_PCT: 8.5, FOOTER_PCT: 8.5,  // top / bottom strip treated as running header / footer, % of page height
  },

  /* ---- Output document ---- */
  DOC: {
    PAGE: { widthMm: 210, heightMm: 297 },              // A4
    MARGINS_MM: { left: 25, right: 25, top: 28, bottom: 25 },
    FONTS: ['Times New Roman', 'Arial', 'Calibri', 'Cambria', 'Courier New'],
    FONT_DEFAULT: 'Times New Roman',
    FONT_HEADING: 'Arial',
    SIZE_BODY: 10.5, SIZE_NOTE: 9, SIZE_HEAD: 12, SIZE_TITLE: 16,   // points
    SPACE_AFTER_PT: 6,
  },
};

/* optional site-wide override (same keys, shallow per section) */
try {
  const site = root.RZ_SITE_CONFIG && root.RZ_SITE_CONFIG.scanToDoc;
  if (site && typeof site === 'object') {
    Object.keys(site).forEach((k) => {
      if (site[k] && typeof site[k] === 'object' && !Array.isArray(site[k]) && SD_CONFIG[k]) Object.assign(SD_CONFIG[k], site[k]);
      else SD_CONFIG[k] = site[k];
    });
  }
} catch (e) { /* keep the literal values */ }

root.ScanToDocConfig = SD_CONFIG;
if (typeof module !== 'undefined' && module.exports) module.exports = SD_CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);
