# APZacct — Handoff Dossier

*Dossier revision r20 — 2026-10-12 (§20-§21 added after r19). **Release 1.4 manifest in §20 is authoritative for file names and versions** (it supersedes §18's manifest; everything else in §15-§19 still holds unless §20 says otherwise). Where a newer section and an older one disagree, the newer wins. File names in §1-§19 are the OLD generic ones; every file now carries the APZacct- prefix and _v1.4 (see §20.1).*

Written at the close of an audit-and-build session, for a fresh chat (and a fresh AI instance) to pick up from with zero lost context. Read this before touching ledger logic, formulas, or scripts.

---

## 1. What this is

APZacct is a Google Sheets + Apps Script accounting system for Malaysian cooperatives (koperasi) regulated by Suruhanjaya Koperasi Malaysia (SKM) under Akta Koperasi 1993. It was developed and validated against one specific cooperative's real chart of accounts, workbook, and live posting activity — but the product itself is meant for any koperasi to deploy, not tied to that one. It is a **koperasi compliance module sitting on top of a general-purpose double-entry engine** — roughly 70–80% of what's built (chart of accounts, transaction posting, trial balance, bank reconciliation, the wizard) is reusable for any entity type; the koperasi-specific part (APK's statutory distribution waterfall, Modal Syer/Yuran equity, GP23's prescribed statement format) is the other 20–30%, and doesn't transfer to a plain SME or Sdn Bhd without a different module.

**Regulatory basis (verified against current primary sources, not assumed):** Akta Koperasi 1993, GP23 (Pindaan) 2020 — SKM's guideline, issued under Akta s.86B, in force for periods beginning on/after 1 Jan 2022. The correct framework relationship, confirmed from a real cooperative's own audited statements: *"prepared in accordance with MPERS, as modified by GP23."* MPERS governs recognition/measurement (how you calculate depreciation, revenue, etc.); GP23 overrides presentation and adds cooperative-specific disclosures. **MPERS (2025)** (aligned to IFRS for SMEs 3rd edition) is now formally issued by MASB, mandatory for periods beginning on/after 1 Jan 2027, early adoption permitted — a real date to track, no code impact yet.

**Target audience / business direction:** currently scoped for SMEs that can't pay much for an accounting product. Multi-framework expansion is planned but explicitly KIV until this build is airtight (see §9).

---

## 2. Architecture

- **Frontend:** static pages hosted on Cloudflare Pages/Workers.
  - `index.html` + `app.js` + `config.js` — the main entry wizard (DT/KT/Kontra transaction entry)
  - `penyata-bank.html` + `penyata-bank.js` — bank statement OCR import (Gemini reads a PDF/image, produces a reviewable transaction list, human confirms, posts)
  - `rekonsiliasi-bank.html` + `rekonsiliasi-bank.js` — bank reconciliation (OCR + ledger comparison, surfaces outstanding/unrecorded items)
  - All three load `config.js` first for `API_URL`, `API_SECRET`, `MAX_FILE_MB` — one place to change them, not three.
  - `styles.css`, `site-config.js`, `nav-config.js`, `THEME_GUIDE.md`, `SITE_CONFIG_STANDARD.md` belong to a **separate, sibling site** (Reysourcez Enterprise's calculator tools) that shares the same visual language on purpose but is a different product — APZacct got its own standalone entry point rather than being folded into that site's tool dropdown, precisely because APZacct is persistent/login-gated/handles real money and those tools are anonymous, throwaway calculators.

- **Backend:** Google Apps Script bound to the spreadsheet.
  - `APZacct_WebAPI.gs` — the only file with `doGet`/`doPost`; every frontend POST (wizard, OCR import, reconciliation posting) funnels through this one file's `doPost`.
  - The rest are menu-driven scripts, wired into one shared menu by `APZacct_Menu.gs` (the **only** file allowed to define `onOpen()` — Apps Script shares one namespace across all pasted files; two `onOpen()`s means one silently vanishes).

- **AI:** Gemini API, two separate model constants tuned independently — `GEMINI_MODEL` (`gemini-3.1-flash-lite`, in `APZacct_Laporan.gs`, for the board-summary prose) and `GEMINI_MODEL_PENYATA` (`gemini-3.1-flash`, in `APZacct_OCRPenyataBank.gs`, for structured statement extraction — deliberately not the lite model, since table accuracy matters more here). Both need a `GEMINI_API_KEY` script property. If either ever 404s, check `ai.google.dev/gemini-api/docs/changelog` — this has already happened once (`gemini-2.0-flash` was retired 1 June 2026).

- **Data:** one Google Sheets workbook, 16 tabs (verified directly from a real export this session — see §3).

---

## 3. Data schema — the 16 sheets

| Sheet | Purpose | Notes |
|---|---|---|
| Panduan | User-facing guide | |
| Tetapan | Config values the treasurer can edit without touching code | See table below — this is the single most important sheet to understand |
| Kamus_Istilah | Jargon dictionary | Committed to, not yet consistently kept current — GP23 terms surfaced this session (KWRS, ADK, Berkanun) should be added |
| Akaun | Chart of accounts | ~56–60 real rows. Columns: A=Kod, B=NamaEN, C=NamaBM, D=Jenis, E=Baki Normal (formula), F=Kumpulan Aliran Tunai, G=Status (Aktif/Tidak Aktif), H=Nota, I=Semasa/Bukan Semasa |
| Baki_Pembukaan | Opening-balance entry staging area | Posted via `posBakiPembukaan()` |
| Daftar_Aset_Tetap | Fixed asset register | Computes straight-line & declining-balance depreciation via formula (verified correct); column K = current-year charge, **TODAY()-dependent** — run any depreciation posting at/near actual FY-end, not mid-year |
| Transaksi | Transaction headers | ID, Tarikh, Perkara, No.PV/RT, Kaedah, Status, URL Resit |
| Baris_Transaksi | Transaction lines (the actual ledger) | ID, ID Transaksi, Kod Akaun, Debit, Kredit, Memo, (col G) Kumpulan Aliran Tunai (auto, array formula), (col H) Jenis Akaun (auto; added 2026-09-29 for AT v2) |
| Log_Perubahan | Change-tracking audit trail | **Confirmed live and working** — this session traced a real logged edit (see §7) |
| Imbangan_Duga | Trial balance | Per-account SUMIF of Baris_Transaksi, signed by normal balance — verified correct by hand |
| UR | Income statement (Akaun Untung Rugi) | Lebihan Bersih at B36 |
| APK | Profit distribution account | Live-linked: B4=`UR!B36`, B7/B8/B9 = Lebihan Bersih × Tetapan's rates |
| KKK | Balance sheet | Has its own "Semakan" (Aset = Liabiliti+Ekuiti) balance check |
| AT | Cash flow statement | **Rebuilt — see §8; confirmed applied to the live sheet 2026-09-25** |
| Wang_Runcit | Petty cash reconciliation + running log | |
| Cetak | Print-ready mirror of KKK/UR via direct cell references | Automatically reflects fixes made upstream |

**Tetapan rows that matter:**

| Row | Label | Used by |
|---|---|---|
| 5 | Nama Koperasi | `cetakPenyataKewangan()` |
| 10–14 | Kod Akaun Seterusnya (per Jenis) | `tambahAkaun()` |
| 15 | Kadar Rizab Statutori (%) — currently 25 | APK B7 |
| 16 | Kadar KWA Pendidikan (%) — currently 2 | APK B8 |
| 17 | Kadar KWA Pembangunan (%) — currently 1 | APK B9 |
| 18 | ID Transaksi Baki Pembukaan | Guards against double-posting opening balances; excludes it from AT's investing/financing sums |
| 19 | Had Amaran Perbezaan Wang Runcit (RM) | `semakWangRuncit()` — row had never actually existed in the reference workbook; added in template v1.0 (default 10), see §14 |
| 20 | URL Web App APZacct | `bukaWebApp()` — same: added in template v1.0, left blank until the customer deploys, see §14 |
| 21 | Tarikh Kunci Tempoh Kewangan | WebAPI v1.6's doGet, penyata-bank.js/rekonsiliasi-bank.js's period-lock flag. Row added, confirmed live 2026-09-25 (blank value — opt-in, unused so far). |
| 22 | Tahun Kewangan Susut Nilai Terakhir Dipos | `posSusutNilai()`'s double-post guard. Row added, confirmed live 2026-09-25 (blank value — no depreciation posted yet). |

Rows 15–17's own notes already correctly document that these rates are **not fixed constants** — Akta s.57(1) actually sets a *tiered* rate (25% while Rizab < 50% of Modal Syer+Yuran, dropping to 15% after) and the 15% baseline was itself temporarily cut to 13% by ministerial order for FYE 31 Dec 2023–30 Nov 2025, a window that has since lapsed. **Whatever a specific deploying cooperative's current fiscal year actually requires needs direct confirmation with SKM or that cooperative's auditor** — the named instruments to check are Arahan SKM Bilangan 1, 2, and 3 Tahun 2021 (Pendidikan, Pembangunan, and KWRS respectively). This is not something the software should silently assume — see §13 for a further check done on this.

---

## 4. API contract (`APZacct_WebAPI.gs`)

**`doGet(e)`** — `?secret=...`
```json
{ "accounts": [{ "kod": 1010, "namaEn": "...", "namaBm": "...", "jenis": "Aset", "bakiNormal": "Debit", "kumpulanAliranTunai": "Tidak Berkaitan" }, ...],
  "tarikhKunciTempoh": "2026-01-31" }
```
Auth failure returns `{ error, diagnosisRahsia: { tiadaDiterimaLangsung, panjangDiterima, panjangDijangka, diterimaAdaRuangDiHujung, dijangkaAdaRuangDiHujung } }` — shape-only diagnostics, never the actual secret.

**`doPost(e)`** — three shapes, routed by `body.action`:
- *(default, no action)* `{ secret, tarikh, perkara, noPV, kaedah, lines: [{kodAkaun, debit, kredit, memo}, ...] }` → posts a transaction. Validates (in order): required fields present, every `kodAkaun` exists in Akaun (v1.5+), debit total = kredit total. All-or-nothing — any failure writes nothing.
- `{ secret, action: "ocr_penyata_bank", akaunWang, fileData, fileMime }` → Gemini-extracted transaction list for review, writes nothing.
- `{ secret, action: "rekonsiliasi_bank", akaunWang, tarikhMula, tarikhTamat, fileData, fileMime }` → reconciliation comparison, writes nothing.

The shared secret is **not real access control** (sits in plain browser-visible JS) — it only deters accidental discovery. Real protection is still KIV (see §9, Sign-In).

---

## 5. File inventory & current versions

| File | Version | What changed most recently |
|---|---|---|
| `APZacct_WebAPI.gs` | v1.6 | Added `tarikhKunciTempoh` to doGet (v1.6); added Kod Akaun existence validation to doPost (v1.5) |
| `APZacct_PosSusutNilai.gs` | v1.0 (new) | Posts Daftar_Aset_Tetap's calculated depreciation into the ledger |
| `APZacct_Menu.gs` | v1.5 | v1.5 adds Jurnal Laras (v1.4: Kadar Statutori; v1.3: Pos Susut Nilai Aset) |
| `APZacct_KadarStatutori.gs` | v1.0 (new) | Dropdown on Tetapan!C15, see §14 |
| `APZacct_JurnalLaras.gs` | v1.0 (new 2026-09-29) | Menu *Jurnal Laras*: posts ONE two-line non-cash journal (accruals, prepaid/advance releases, opposite-journal corrections); see §15 |
| `APZacct_Template_Kosong_Nota_v1.1.xlsx` | v1.1 (new) | Template v1.1 + Nota tab + empty Sejarah_Baki, wired to the live sheets; see §15 |
| `APZacct_Panduan_Penggunaan_v1.0.md` | v1.0 (new) | Full user guide (tab flow, Kumpulan Aliran Tunai, Kontra, accruals/prepaids, Imbangan Duga, Nota, framework question, limits, AT patch) |
| `APZacct_test_workbook_scenarios_v1.0.py` | v1.0 (new) | Posts 16 scenarios + a 2nd-bank case into a template copy, recalculates with LibreOffice, asserts SEIMBANG + AT sections |
| `APZacct_test_gs_mock_v1.0.js` | v1.0 (new) | Mock-Apps-Script test (35 checks): shared-scope load of all .gs, menu handlers, Jurnal Laras, loss guard, Tambah Akaun |
| `APZacct_Template_Kosong_v1.1.xlsx` | v1.1 | Pristine starter workbook v1.0 (§14) + AT v2 (§15), neutral Panduan, Kamus +9 terms, Wang_Runcit!B4 blank, Tetapan!C21 text-formatted, cell notes on Akaun!F4 / Baris_Transaksi!G4,H4 / AT!A6,A7 |
| `penyata-bank.js` | v1.1 | Period-lock row flagging |
| `rekonsiliasi-bank.js` | v1.1 | Period-lock row flagging (belum-direkod table only) |
| `test-akauntan-engine.js` | — | Standalone Node test suite. Corrected this session: actually 37 assertions / 7 sections at baseline (re-run directly to verify — an earlier session's "44 assertions, 11 sections" note didn't match the file). Now 42 / 8 with the new Imbangan_Duga sign-convention section (§12) |
| `APZacct_Laporan.gs` | v1.1 | Unchanged this session |
| `APZacct_BukaWebApp.gs` | v1.0 | Unchanged this session |
| `APZacct_BakiPembukaan.gs` | v1.1 | Unchanged this session |
| `APZacct_LindungiHelaian.gs` | v1.0 | Unchanged this session — protects Imbangan_Duga/UR/KKK/APK/AT/Cetak (warning-only); does **not** cover Transaksi/Baris_Transaksi, which is exactly where the real bug this session lived (see §7) — worth reconsidering |
| `APZacct_PosAgihanAPK.gs` | v1.1 | Adds a hard-stop loss/no-surplus guard before any statutory distribution can post — closes §6 item 19, see new §11. **2026-09-29: v1.1 source rebuilt from the spec above (the file was missing from the project folder) and delivered; offline-tested (mock). Paste over the live copy.** |
| `APZacct_OCRPenyataBank.gs` | v1.1 | Unchanged this session |
| `APZacct_RekonsiliasiBank.gs` | v1.0 | Unchanged this session; formula independently re-derived and verified correct |
| `APZacct_Tambah_Akaun.gs` | v1.2 | Asks Kumpulan Aliran Tunai for Aset/Liabiliti/Ekuiti (was hard-coded 'Operasi'); success text corrected |
| `APZacct_WangRuncit.gs` | v1.0 | Unchanged this session |
| `index.html` / `app.js` / `config.js` | — | Unchanged this session |
| `penyata-bank.html` / `rekonsiliasi-bank.html` / `styles.css` | — | Unchanged this session |

All files delivered this session are attached to this chat's outputs; re-download links are at the end of this dossier's parent message.

---

## 6. Audit trail — findings and fixes, in order found

| # | Finding | Status |
|---|---|---|
| 1 | `doPost` checked Kod Akaun was a non-zero number, not that it existed in Akaun | **Fixed** — v1.5 |
| 2 | Bank reconciliation formula and debit/kredit matching-direction logic | **Verified correct** (independently re-derived, matches exactly) |
| 3 | Opening-balance, APK distribution, ledger-integrity-diagnosis math | **Verified correct** via 37→44-assertion Node test suite |
| 4 | GP23 requires 5 statement components (KKK/APK/UR/AT/Nota); APZacct has 4 | **First version built this session** — generic, config-driven Nota template, not yet imported into any live sheet or filled in for a specific cooperative (§12) |
| 5 | GP23's cash flow statement needs 4 categories, not the standard 3 | **Fixed** — §8's rebuild, confirmed applied to the live sheet 2026-09-25 (§11) |
| 6 | Faedah Bank/Hibah Bank account classification (income vs. expense direction) | **Resolved** — confirmed Hasil (income), correctly classified |
| 7 | Honorarium/Cukai/Zakat/KWA accounts' treatment as APK items not UR expenses | **Confirmed already correct** — accounts marked Tidak Aktif with explanatory notes in the real Akaun sheet |
| 8 | ADK (Akaun Deposit Koperasi) classified as non-current asset | **Confirmed already correct**, matches GP23 directly |
| 9 | Live workbook: KKK showed TIDAK SEIMBANG, RM13,123 | **Root-caused and corrected in the reference workbook** — Baris_Transaksi row 5 now reads `CONTOH-0000` / Kredit `0` in `APZacct_UPDATED.xlsx` (verified §11). Traced via Log_Perubahan's own record of the original edit, reason given as "salah taip jumlah" (typo). Log_Perubahan shows no second entry recording a *correction*, so it was applied out-of-band rather than as a live Sheets edit — **mhrey confirmed 2026-09-25 that the live Google Sheet matches.** |
| 10 | Evidence the wizard + WebAPI have already been live-tested successfully (real T-0000/T-0001 transactions, both balanced) | Positive finding — supersedes the "never run live" note in earlier project notes |
| 11 | APK's 25%+2%+1%=28% "stacking" of statutory rates vs. "netting" to 25% total | **Not a bug** — Akta s.57(4) makes netting *permissive* ("boleh ditolak"), not mandatory. Current approach is a legitimate (more conservative) policy choice; flagging for the board to confirm which they actually intend |
| 12 | AT's cash & bank definition only counts 1010+1020, missing Wang Runcit (1080) | **Fixed** — traced a RM34,543 AT-only gap to exactly one Kontra transaction into petty cash; §8's rebuild confirmed applied 2026-09-25 |
| 13 | AT has no 4th category for statutory payment settlements (Cukai/Zakat/Honorarium/KWA/Dividen) | **Fixed** — §8's exact formulas, confirmed applied to the live sheet 2026-09-25 |
| 14 | Modal Yuran has no separate account (only Modal Syer exists) | Contextual, not necessarily a gap — depends whether the deploying cooperative actually collects separate Yuran |
| 15 | `findFirstBlankRow_`/`nextId_`/`lastLineNumber_` copy-pasted identically across 4 files | Harmless today (identical), latent risk if one copy is edited without the others — optional future cleanup |
| 16 | No period-lock concept — nothing warns if a transaction is backdated into an already-reported period | **Fixed** — `tarikhKunciTempoh` mechanism, opt-in via Tetapan!C21 |
| 17 | Depreciation is calculated (Daftar_Aset_Tetap) but never posted to the ledger | **Fixed** — `posSusutNilai()` |
| 18 | Nota Akaun preparation responsibility — board/treasurer or external auditor? | **Resolved**: it's the Board's own responsibility (Akta s.58(3)/s.59(3), GP23 Bahagian B, confirmed by a real cooperative's own signed "Perakuan Ahli Lembaga"). Auditor audits/opines on what's already prepared, doesn't originate it. Belongs in APZacct's scope. |
| 19 | `posAgihanAPK()` has no check preventing distribution in a net-loss year | **Fixed** — v1.1 hard-stops when UR's current-period Lebihan Bersih ≤ 0. The specific "s.57(6)-(7)" citation used in this row's original wording could not be re-confirmed this session (see §11) — the underlying rule is solidly sourced from other subsections, that exact pairing is not |

---

## 7. What "the demo data isn't real" actually means here

The uploaded sample workbook was explicitly flagged by its account holder as containing placeholder figures from initial setup, not real financial numbers. That caveat covers the **amounts** — it does not cover the **formulas or structure**, which are real and were verified directly. The one genuine issue found (item 9 above) was a human data-entry mistake in that demo data, not a system flaw, and the fact that KKK's own balance check *and* the Log_Perubahan audit trail *and* (by construction) Diagnosis Ketidakseimbangan would all independently have caught it is a good sign about the tooling, not a bad sign about the system.

---

## 8. AT rebuild — exact steps (applied to the live sheet — confirmed by mhrey 2026-09-25)

> **PARTLY SUPERSEDED 2026-09-29 (§15, AT v2):** the B7, B23 and B25 formulas below are replaced by automatic versions; Akaun 1045 is now 'Operasi'. Rest of this section still holds.

**Step 1 — Akaun, column F (Kumpulan Aliran Tunai), retag six accounts to `Berkanun`:**
2020 (Dividen Diisytiharkan, currently Pembiayaan), 2070 (Cukai Pendapatan Belum Dibayar, currently Operasi), 2080 (Zakat Belum Dibayar, currently Operasi), 2090 (Honorarium Lembaga Belum Dibayar, currently Operasi), 2100 (KWA Pendidikan Belum Dibayar, currently Operasi), 2110 (KWA Pembangunan Belum Dibayar, currently Operasi).

**Step 2 — AT sheet: right-click row 17 (blank row under Aktiviti Pembiayaan) → Insert 3 rows above.** Sheets auto-corrects every other formula's references below this point.

Fill the 3 new rows:
- Row 17 (label): `AKTIVITI BERKANUN (Bayaran Berkanun & Agihan)`
- Row 18 (B18):
  ```
  =-SUMIFS(Baris_Transaksi!$D$5:$D$500,Baris_Transaksi!$G$5:$G$500,"Berkanun",Baris_Transaksi!$B$5:$B$500,"<>"&Tetapan!$C$18)
  ```
  Debit-only deliberately: the credit side (APK recognizing the liability) is Equity↔Liability with no cash effect; only the debit side (actually paying it) touches cash. Verified with a dedicated Node test case.
- Row 19 (label + B19): `TUNAI BERSIH DARIPADA AKTIVITI BERKANUN`, formula `=B18`

**Step 3 — update three existing formulas** (now shifted down by 3 rows; find by label, Sheets already fixed their internal references):
- "Perubahan Bersih Tunai": `=B8+B12+B16` → `=B8+B12+B16+B19`
- Opening cash row — add the Wang Runcit (1080) term:
  ```
  =SUMIFS(Baris_Transaksi!$D$5:$D$500,Baris_Transaksi!$C$5:$C$500,1010,Baris_Transaksi!$B$5:$B$500,Tetapan!$C$18)-SUMIFS(Baris_Transaksi!$E$5:$E$500,Baris_Transaksi!$C$5:$C$500,1010,Baris_Transaksi!$B$5:$B$500,Tetapan!$C$18)+SUMIFS(Baris_Transaksi!$D$5:$D$500,Baris_Transaksi!$C$5:$C$500,1020,Baris_Transaksi!$B$5:$B$500,Tetapan!$C$18)-SUMIFS(Baris_Transaksi!$E$5:$E$500,Baris_Transaksi!$C$5:$C$500,1020,Baris_Transaksi!$B$5:$B$500,Tetapan!$C$18)+SUMIFS(Baris_Transaksi!$D$5:$D$500,Baris_Transaksi!$C$5:$C$500,1080,Baris_Transaksi!$B$5:$B$500,Tetapan!$C$18)-SUMIFS(Baris_Transaksi!$E$5:$E$500,Baris_Transaksi!$C$5:$C$500,1080,Baris_Transaksi!$B$5:$B$500,Tetapan!$C$18)
  ```
- Ending-check row (the one independent of AT's own running total, pulled straight from Imbangan_Duga) — add the same term:
  ```
  =SUMIF(Imbangan_Duga!$A$5:$A$150,1010,Imbangan_Duga!$H$5:$H$150)+SUMIF(Imbangan_Duga!$A$5:$A$150,1020,Imbangan_Duga!$H$5:$H$150)+SUMIF(Imbangan_Duga!$A$5:$A$150,1080,Imbangan_Duga!$H$5:$H$150)
  ```

**Step 4 — Baris_Transaksi, fix the two data cells:** B5 (`sdfsd` → `CONTOH-0000`), E5 (`13123` → `0`).

All four steps were hand-verified against the real workbook's actual numbers before being written down here. **Correction, this session:** the original wording here claimed this was "separately covered by two automated test cases in `test-akauntan-engine.js` (sections 8 and 9)" — that test file only ever had 7 sections; no such cases exist. What actually verifies the AT rebuild is the direct LibreOffice recalculation of the real workbook done in §11 (zero formula errors, SEIMBANG, cross-checks tying out) — that's real verification, just not the one originally claimed. With all four steps applied, both KKK's and AT's own Semakan checks read SEIMBANG exactly.

**Sheet-side additions — confirmed applied 2026-09-25:** Tetapan rows 21 and 22 (see §3's table), the Baris_Transaksi fix, and the five new Akaun rows are all live, alongside this rebuild. **Still needed:** redeploy the Apps Script Web App (Deploy → Manage deployments → Edit → New version) after pasting in the current `.gs` files — including this session's new `APZacct_PosAgihanAPK.gs` v1.1 — since editing/saving alone does not push a new version live.

---

## 9. Roadmap / KIV, roughly in the order discussed

1. ~~**Nota Akaun** — design and build the actual sheet/content.~~ — **first version built, this session (§12)**: a generic, config-driven 37-note template not tied to any one cooperative's chart of accounts — reusable across any cooperative type on APZacct. Remaining: import into a live deployment's sheet, fill in that cooperative's own account-code mappings and the manual fields (Maklumat Umum, board sign-off date, board expense breakdown by name, employee count), and extend `cetakPenyataKewangan()` to include it in the printed PDF set.
2. ~~**Confirm current statutory rates** with SKM/auditor directly for the deploying cooperative's actual current fiscal year (§3's Tetapan table caveat).~~ — **general current-rate picture researched this session, see §13** — the deploying cooperative's own exact figure still needs its own auditor/SKM confirmation, since it depends on that cooperative's own Rizab-to-Modal ratio. **Superseded 2026-09-28 by decision (§14): the rate is user-configurable via a dropdown; no further research.**
3. ~~**Loss-year block** in `posAgihanAPK()`~~ — **done, v1.1** (§6 item 19, §11).
4. **Google Sign-In.** Decided direction: Option A (Google's own sign-in via a JS ID-token widget in the Cloudflare-hosted page, verified server-side against `oauth2.googleapis.com/tokeninfo` — NOT cookie-based, since frontend and backend are different origins). A `Pengguna` sheet (verified email → name → role → active/inactive) is needed regardless of how identity is proven. Roles discussed: Bendahari (full read/write), Penyemak (review/approve, not post — segregation of duties), Juruaudit (read-only everywhere, with easier drill-through to supporting documents than a normal user gets, given how financial audits actually work), and a future Approver role once PV/RT exists. Agreed sequence: build sign-in first, prove it works with 2–3 real concurrent users, *then* build role enforcement. Open question: retire the shared API secret once real per-person login exists, or keep it as a second layer?
5. **Multi-framework switch** — reframed as two independent axes rather than three fixed presets: **entity type** (Koperasi/GP23 vs. a plain private entity — different equity and distribution modules, not a toggle on the same one) × **reporting depth** (MPERS vs. MFRS). Explicitly sequenced *after* the current build's core/security/backend/frontend/data-continuity is fully correct. **Status 2026-09-28: not built. mhrey restated the intent - the core should work as plain accounting, with the SKM/GP23 framework (or others, e.g. MPERS/MFRS) switched on when needed.**
6. **Daftar Aset Tetap webapp** — a proper add/manage UI for fixed assets, instead of typing into the sheet directly.
7. **Akaun (chart of accounts) webapp** — add/check accounts without opening the spreadsheet (explicitly requested this session).
8. **Helper-function deduplication** (§6, item 15) — optional cleanup, touches multiple already-deployed files.
9. **Learning syllabus** — for future bendahari replacements, combining (a) the conceptual framework and five elements of accounting, (b) double-entry mechanics taught through APZacct's own wizard rather than generic textbook entries, (c) what GP23 actually requires and why, mapped to specific menu functions, (d) MPERS basics for the areas APZacct touches (PPE/depreciation, provisions, revenue), (e) every menu item mapped to when in the accounting cycle it's used. Explicitly deferred until the app itself is done.
10. **Kamus_Istilah** — add this session's new terms (KWRS, ADK, Bayaran Berkanun & Agihan, Nota-Nota Kepada Akaun) — a standing, not-yet-consistently-kept-current commitment.
11. Reconsider whether `lindungiHelaianFormula()`'s warning-only sheet protection should extend to Transaksi/Baris_Transaksi — the one real bug this session lived exactly in that currently-unprotected territory.

---

## 10. How to verify anything in this dossier

- Re-run `test-akauntan-engine.js` (`node test-akauntan-engine.js`) — no Google Sheet needed, pure logic verification. Run it rather than trusting any written count here (this dossier's own count has been wrong before — see §5).
- GP23 (Pindaan) 2020 primary source: `skm.gov.my/images/01-utama/perundangan/garis-panduan/gp23-panduan-penyata-kewangan-koperasi-2023.pdf`
- MPERS (2025) status: `masb.org.my/pages.php?id=615` and `masb.org.my/pages.php?id=20`
- Everything in §6 and §8 was reasoned through against the actual uploaded workbook's real formulas and cached values, not assumed from the `.gs` files' comments alone.

---

## 11. Session update — 2026-09-25: xlsx verification + loss-year guard shipped

Starting point this session: a fresh chat, this dossier, and `APZacct_UPDATED.xlsx`. Worth recording: the same filename came through this project's own knowledge/attachments with **empty** content and wasn't present in the container filesystem at all — mhrey then uploaded it directly as a regular chat attachment, which worked. If a future session needs to hand a workbook to the next one, upload it that way, not as project knowledge.

**Verified directly from the workbook** (recalculated with LibreOffice via the xlsx skill's `recalc.py` first — the file as uploaded had every formula's *cached* value stripped, which is the standard symptom of an openpyxl edit-and-save cycle that never got recalculated, not a sign of anything actually wrong with the formulas themselves):

- Zero formula errors across 2,231 formulas.
- Imbangan_Duga, KKK, and AT all independently read **SEIMBANG**. AT's own ending-balance cross-check (RM55,700) matches the Imbangan_Duga-derived figure exactly.
- The AT rebuild from §8 is fully present and computing correctly — rows 17–19 (AKTIVITI BERKANUN) exist, and the B21/B25 formulas match §8's spec exactly.
- Tetapan rows 21 and 22 both exist now (both blank — correct, since neither the period lock nor a depreciation post has been used yet).
- Baris_Transaksi row 5 reads `CONTOH-0000` / Kredit `0` — item 9's typo is corrected in this file (see item 9's updated caveat above).
- All five previously-missing APK distribution accounts (2070/2080/2090/2100/2110) now exist in Akaun and are Aktif — 56 account rows total. Still no separate Modal Yuran account (unchanged; see item 14).
- Transaksi has 7 header rows: 5 `CONTOH-*` demo rows plus real `T-0000` and `T-0001` — consistent with mhrey confirming this session that live *and* offline testing has now been run (offline = `test-akauntan-engine.js`; live = the deployed wizard/WebAPI — this directly confirms item 10 rather than just repeating it secondhand).
- Current period per UR: Hasil 1,500, Perbelanjaan 800, Lebihan Bersih 700 (positive), with APK's KWRS/Pendidikan/Pembangunan formulas computing correctly off it (175/14/7). **Correction, flagged by mhrey:** every RM figure checked this session — this one included — is test/demo data, not any real cooperative's actual financial position. It was used only to confirm the formulas compute and cross-check correctly (e.g., that a positive Lebihan Bersih correctly does NOT trip the new v1.1 loss-guard); none of it should be read as, or repeated as, a fact about any real cooperative's actual finances. Same caveat applies to every other specific number in this section (the 2,231-formula count and "zero errors" are legitimate technical facts about the file; the RM amounts are not business facts).
- No assets registered yet in Daftar_Aset_Tetap — `posSusutNilai()` correctly has nothing to post.
- Log_Perubahan has exactly the one historical entry this dossier already described (`Baris_Transaksi!E5`, 0 → 13123, `reysourcez.ent@gmail.com`, 2026-09-15) — no second entry recording a correction, which is the basis for item 9's "confirm the live sheet actually matches" caveat above.

**Shipped this session:** `APZacct_PosAgihanAPK.gs` v1.1 — closes item 19. `posAgihanAPK()` now reads UR's current-period Lebihan Bersih before doing anything else and refuses to post *any* statutory distribution line when it's zero or negative. Full reasoning is in that file's own header comment; summary:

- **Rule, well-sourced:** independent sources this round (a SKM-affiliated cooperative-movement publication, and multiple cooperatives' own SKM-registered undang-undang kecil quoting the Akta directly) confirm that s.57 distribution is tied to the audited net profit for the period (s.56), and that with no distributable profit or an unresolved accumulated loss, dividends generally cannot be paid — with one narrow exception: SKM may approve a dividend up to 5% of share/subscription capital despite an unextinguished accumulated loss, under s.57(8).
- **Citation, honestly flagged as unconfirmed:** item 19's original wording cited "s.57(6)-(7)" specifically. This session's search could not re-confirm those two subsection numbers against the Akta's actual text — only (1), (1A), (4), (5), and (8) turned up directly quoted in what was found. The rule is solid; that specific subsection pairing isn't, and has been left out of the shipped code's user-facing message for that reason.
- **Scope, deliberately narrower than the rule might require:** the check reads UR's *current-period* Lebihan Bersih only, not the *accumulated* balance in Lebihan Terkumpul (3030). The sources found this round partly phrase the rule in terms of that accumulated balance ("baki kerugian terkumpul") — a cooperative recovering from a prior-year deficit could show a current-period surplus while 3030 is still net-negative overall, and the current check wouldn't catch that. Flagged as a real open question, not silently assumed to be covered.
- **Why a hard stop, unlike every other guard in this codebase:** every other warning here (Lindungi Helaian, the double-post guards in Baki Pembukaan and Pos Susut Nilai) is warn-then-override, because a human might have a genuine reason to override a data-integrity nicety. There's no equivalent legitimate reason to override a statutory distribution prohibition, so this one check has no "teruskan juga" button. It only gates posting through this one menu item.

**Open questions from this session, for mhrey:**
1. ~~Does the live Google Sheet actually match `APZacct_UPDATED.xlsx`?~~ — **Confirmed by mhrey 2026-09-25: yes, already live.**
2. Worth building the accumulated-Lebihan-Terkumpul version of the loss check too, or is the current-period-only version enough for now?
3. Confirm the s.57 subsection numbering (or keep citing "s.57" without a specific subsection, as the shipped code now does) before this goes in front of the board or the auditor.

## 12. Nota Akaun — generic GP23 template (this session)

Built in response to "follow gp23" — after two corrections from mhrey worth recording so a future session doesn't repeat either:

1. **Don't trust the RM values found while checking the workbook as real.** Everything in §11 above got a retroactive caveat. This isn't new information (the dossier's own §7 already said the uploaded data was placeholder), but it's worth restating precisely: computed test figures are fine for proving a formula works or two sheets tie out, and are NOT fine to describe as any specific cooperative's real position — even in passing, even hedged as "small." Apply this to every future session's own checks too.
2. **APZacct is a product for any cooperative, not built around one customer's specific setup.** The first Nota draft this session hardcoded one particular cooperative's own account codes (its specific codes for PPE, the statutory liabilities, equity, and its own activity split) directly into formulas. That only works for a cooperative whose chart of accounts happens to match that exact numbering — a credit cooperative with member loans, or one holding subsidiaries, or one taking member deposits, would need entirely different accounts this design couldn't even see. Every other piece of APZacct that hardcodes account codes (`APK_DEBIT_KOD`, `SUSUT_NILAI_DEBIT_KOD`, the AT rebuild's 1010/1020/1080/2020/2070-2110) has this exact same limitation — **not touched this session**, flagged here as a real, larger question for mhrey: worth generalizing the rest of the system the same way, or is Nota Akaun a special case because it's the one piece meant to be reused as-is across different cooperative deployments?

**The fix, and the general design principle now used:** every note keys off an account code the treasurer types into a mapping cell (their own code, whatever it is), never a number assumed by the template. Chasing this down also surfaced a real formula bug, independent of the genericity question: Imbangan_Duga's own "Baki Bersih (bertanda)" column (H) is already signed by normal balance for every account type — confirmed empirically (3010 Ekuiti reads a raw positive value in its normal credit position, not negative). The first Nota draft applied an extra `-SUMIF(...)` negation for every credit-normal account (equity, liabilities), which flipped all of them to the wrong sign. Fixed by pulling column H directly with no manual negation anywhere, verified against both a debit-normal and a credit-normal mapped code (recalculated, zero errors, correct sign both ways).

**What got built:** `APZacct_Nota_Template_v1.xlsx`, a `Nota` sheet with 37 numbered notes (288 rows), covering GP23's full disclosure list (paragraphs 15, 16, 42-51 — not just the subset that happens to apply to any one cooperative). Delivered as a standalone skeleton workbook (Nota plus minimal, empty versions of the sheets its formulas reference — Tetapan/Imbangan_Duga/Baris_Transaksi/Sejarah_Baki/Daftar_Aset_Tetap), not the reference cooperative's full workbook, so nothing cooperative-specific ships in the file itself:

- Notes 1-5: universal (general info, basis of preparation, board sign-off date, accounting policy summary — pulling depreciation method/rate straight from Daftar_Aset_Tetap and the doubtful-debt policy straight from whatever account the treasurer marks as their doubtful-debt provision — and financial risk policy).
- Notes 6-31: every GP23 balance-sheet category (PPE, grants, share/property/JV/associate investments, member loans, KWRS, inventory, receivables, cash & bank, member deposits, external loans, the 6 statutory-liability accounts, payables, overdraft, share capital, redeemed shares, capital/revaluation reserves, redemption funds, member and non-member welfare funds, other liabilities) — each with a "Berkaitan? Ya/Tidak" toggle and its own account-code mapping cell(s); an unmapped/not-applicable one just reads 0 rather than needing to be deleted or hidden.
- Notes 32-37: segmental income/expense by activity (a blank N-row table — any cooperative lists its own activities and Hasil/Kos code pairs, not any one cooperative's specific set), board expense by individual member (with a cross-check against whatever code is mapped as the Perbelanjaan Lembaga account), cash-flow-method statement, employee count, contingent liabilities/subsequent events, and a note on the comparative-figures requirement itself.
- Every roll-forward note also pulls its own opening balance from Sejarah_Baki when available (`IFERROR`-wrapped so a first-year cooperative, or a cooperative that's never posted an opening balance through Baki Pembukaan, gets a clean "[ISI — tahun pertama]" prompt instead of a formula error) — this is the same mechanism `posBakiPembukaan()` v1.1 built for the KKK year-over-year column, now doing double duty here.

Verified clean both empty (2,435 formulas, zero errors) and with a handful of codes mapped in as a mechanism test (still zero errors, correct signs both ways) — see the reasoning above for why no actual RM figures from that test are repeated here.

**Deliberately not done, and why:**
- **Delivered as a standalone skeleton, not the reference cooperative's own workbook.** The first save of this file was built on top of a copy of the reference cooperative's actual workbook (all its real sheets, its own Akaun list, its own Tetapan values) with Nota just added as an extra tab — exactly the one-cooperative-specific-by-accident mistake this section is about, just at the file level instead of the formula level. Rebuilt as Nota plus empty skeleton versions of the 5 sheets it references, so the delivered file itself carries no cooperative-specific data or naming.
- **Not imported into any live sheet.** New sheets go in by hand, same reasoning as the AT rebuild in §8: Google Sheets can import a whole sheet from an uploaded xlsx (File → Import → Insert new sheet(s)) far more reliably than retyping ~288 rows, and a spreadsheet structural change is exactly the kind of thing that should be seen before it's trusted, not scripted blind.
- **Not pre-filled with any specific cooperative's own account-code mappings.** Could be done as a fast follow for a specific deployment if useful — just wasn't bundled into the same delivery as the genericity fix, so the two don't get tangled together again.
- **`cetakPenyataKewangan()` not yet extended to export Nota alongside Cetak.** GP23 treats Nota as one of the 5 required components presented together; right now the PDF export only pulls the Cetak sheet. Small, clearly-scoped follow-up.
- **The rest of the codebase's hardcoded account codes** — see point 2 above. A real, separate decision, not assumed away.

## 13. Statutory KWRS/Pendidikan/Pembangunan rates — checked against SKM and news sources (2026-09-27)

Requested directly by mhrey, who correctly recalled this had been looked at before (§3's Tetapan table caveat) but wasn't sure it was ever fully resolved. It wasn't — here's the honest current state after checking SKM's own site and contemporaneous news coverage:

**Confirmed, with real sources:**
- The Akta's own default (s.57(1)) is tiered, not flat: 25% of audited net profit while KWRS is below 50% of (Modal Syer + Modal Yuran), dropping to 15% once that threshold is reached.
- A temporary cut to **8%** applied for FYE 31 Dec 2021 – 30 Nov 2022 (Arahan SKM Bilangan 3 Tahun 2021). Long expired — historical only.
- A temporary cut from 15% to **13%** applied for FYE 31 Dec 2023 – 30 Nov 2025 (Arahan SKM Bilangan 2 Tahun 2023, "Pengurangan Kadar KWRS" — SKM's own site confirms this Arahan exists, though it's published as scanned page images, not extractable text). Independently confirmed via contemporaneous news coverage (Kosmo, Utusan Sarawak, October 2023): then-Minister Datuk Ewon Benedick (KUSKOP) announced the reduction directly, explicitly to help cooperatives recover post-COVID, citing an estimated RM20 million in freed-up liquidity sector-wide. **This is exactly the figure the dossier already had on file — confirmed accurate, not a correction.**
- The minister's own quote on what happens next matters and was easy to miss: the rate returns to the original level **"secara berperingkat"** (in stages) **"mengikut ketetapan SKM kelak"** (per SKM's determination, later) — not an automatic snap back to 15%/25% the day the window closes.

**Not found, despite a real search effort (multiple queries, a direct fetch of the SKM Arahan page, and a search of SKM's 2025/2026 announcements):** any published Arahan specifying that staged return, or a rate that explicitly applies from 1 Dec 2025 onward. Today is well past the 30 Nov 2025 end date, so this is a live gap, not a historical one. Two real possibilities, and I can't tell which from public search: (a) SKM let the temporary order lapse without a new one, so the Akta's own default (25%/15% tiered) already applies again, or (b) a staged-return Arahan exists but wasn't indexed by search or was published in a format (scanned images, like the 2023 one) that doesn't surface well.

**Bottom line for whoever is configuring Tetapan rows 15-17 right now:** don't assume 13% still applies (that window closed 30 Nov 2025) and don't assume a clean reversion to 15%/25% either, without checking. The reliable path is SKM's own "Arahan Statutori" page directly (`skm.gov.my` → Perundangan → Arahan Statutori) or a direct question to SKM/the cooperative's auditor — not a further web search, which is exactly where this session's effort hit its limit.

## 14. Session update — 2026-09-28: pristine template, rate dropdown, readiness audit

Trigger: a real koperasi customer (has a previously audited financial report; wants prior audited balances loaded, then current-FY entries, possibly bank-statement uploads) and the request to provide the empty Excel.

**Decision (mhrey, 2026-09-28):** the statutory reserve rate is a user choice, not something the software or this project researches. Supersedes §9 item 2 and §13's open gap.

**Built**
- `APZacct_Template_Kosong_v1.0.xlsx`, made from `APZacct_UPDATED.xlsx` by editing VALUES only (2,231 formulas before and after, all untouched; LibreOffice recalc: 0 errors; no drawings/shapes existed to lose; conditional formats, validations, merges, freeze panes and column widths identical).
  - Cleared: Transaksi rows 5-11 (5 `CONTOH-` demo rows + `T-0000`/`T-0001` live-test rows), Baris_Transaksi A5:F21 (column G array formulas, rows 5-500 = 496, preserved), Log_Perubahan row 2 (one historical entry that named a real email address).
  - Kept as-is: Akaun (56 accounts), Kamus_Istilah, Panduan, and all formula sheets. Already empty in the source: Baki_Pembukaan input columns, Daftar_Aset_Tetap, Wang_Runcit snapshot/log. No `Sejarah_Baki` sheet existed (it is created by the first `posBakiPembukaan()` run). Wang_Runcit!B4 (declared float, reference only) is still 500 - customer should set their own.
  - Tetapan: C5 is now a fill-in prompt (B5 keeps the "Koperasi Contoh Berhad" example); B18/C18 (was `CONTOH-0000`) blank; rows 19 and 20 ADDED - `semakWangRuncit()` and `bukaWebApp()` read C19/C20 but those rows had never existed in the reference workbook (C19 = 10, C20 blank); C15 carries a cell note about confirming the rate.
  - Statement headers KKK/UR/APK/AT!A2 hardcoded "31 Januari 2026 (data contoh)" - now `[isi tarikh ...]` placeholders. They are still static text, edited per period (Cetak mirrors them by formula). Transaksi!A3 (red banner "ALL ROWS BELOW ARE SAMPLES - DELETE BEFORE REAL USE") removed, A2 reworded, Panduan!A209's stale "delete the CONTOH rows" sentence replaced.
  - Verified after clearing: Imbangan_Duga, KKK and AT all read SEIMBANG at zero; UR/KKK/AT/APK totals all 0; no residual `contoh-`, `reysourcez`, `dfds`, `T-000x` or `2026` strings except two historical changelog lines in Panduan (A209, A221).
- `APZacct_KadarStatutori.gs` v1.0 (new): `sediakanSenaraiKadarStatutori()` puts a dropdown (25/15/13/8) on Tetapan!C15 with `setAllowInvalid(true)`, so any typed value is still accepted (the red corner mark on a non-list value is the expected warning). APK reads the cell as `=B4*Tetapan!C15/100`, i.e. a whole-number percent, which matches. `KADAR_DROPDOWN` allows another row (e.g. 16/17) in one line. Deliberately NOT baked into the xlsx via openpyxl - it is unverified whether xlsx list validation survives a Sheets import - so it runs once from the menu. API methods confirmed against Google's current reference (requireValueInList, setAllowInvalid, setHelpText, build). Offline-tested with a mock SpreadsheetApp (8 assertions) and a syntax check; NOT run live.
- `APZacct_Menu.gs` v1.4: adds the menu item above.

**Lessons**
- A demo-data scan must search the bare word `contoh`, not only the `CONTOH-` ID prefix: sample labels also lived in 4 statement headers, a warning banner and a Panduan instruction. The first pass missed all of them.
- Cross-check every menu handler against the functions actually defined in the project before packaging a deployment - it found both package gaps below.

**Readiness audit for a real koperasi customer. Verdict: supervised pilot with a parallel run; not unsupervised production.**
Package gaps (project folder vs live system):
1. `APZacct_LogPerubahan.gs` (defines `setupRevisionLogTrigger`, behind the "Aktifkan Log Perubahan" menu item) is not in the project files; recover it from the live Apps Script project. Without it a new deployment has no audit trail for edits to posted data.
2. `APZacct_PosAgihanAPK.gs` on disk is v1.0; sections 5 and 11 describe v1.1 (loss-year guard). The v1.1 source is not in the project folder and its deployment status is unconfirmed.

Security and integrity:
3. Access control is a shared secret in public `config.js`; the Web App is Execute-as-me / Anyone. Cheap mitigation with no code: Cloudflare Access on the Worker's `workers.dev` URL (Cloudflare's docs confirm Access can require sign-in on a workers.dev URL, restricted by email or domain; the Zero Trust free plan has historically covered up to 50 users - confirm current limits). It does not stop someone who already holds the API URL + secret from calling the API directly; the real fix is section 9 item 4.
4. No `LockService` anywhere. `doPost` computes `nextId_` / `findFirstBlankRow_` / `lastLineNumber_` by scanning, then writes, so two overlapping requests can collide (duplicate IDs or overwritten rows). Client-side sequential posting protects one browser only. Fix: wrap the write section in `LockService.getScriptLock()`. Not yet applied.

Never run live (as far as any file shows): `posBakiPembukaan()` v1.1 (the reference workbook has no Sejarah_Baki and Tetapan!C18 was `CONTOH-0000` - no evidence it ran for real); OCR import and reconciliation (their file headers say not yet run on a real statement; limits 5 MB per file, 200 rows per statement); `posSusutNilai()` (nothing to post yet); PosAgihanAPK v1.1.

Functional gaps: no prior-year comparatives (KKK/UR/AT have 2 columns; Sejarah_Baki holds only balance-sheet closing balances, and the KKK "Tahun Lepas" paste was never applied; UR/AT have no prior-year data source at all); Nota Akaun not imported and the PDF export covers Cetak only; period labels are static text; many new accounts means one 4-prompt Tambah Akaun dialog each; no framework switch (the app is koperasi/GP23-shaped).

Operational: single-tenant (one Sheet + Apps Script deployment + secret + Gemini key + frontend config per customer); no onboarding runbook; frontend filenames (`index.html`, `app.js`, `config.js`, `styles.css`) are generic and collide if co-hosted - deploy as its own Worker/Pages project or rename with an `APZacct-` prefix; bank statements are sent to the Gemini API (third-party processing) - data-handling terms and tier NOT verified this session.

**Recommended pilot acceptance test:** load the customer's audited closing trial balance via Baki Pembukaan; Imbangan_Duga/KKK at the opening date must reproduce the audited balance sheet line for line; post 2-3 months in parallel with their existing books; reconcile the bank monthly; compare UR/KKK against their own books.

**Deployment manifest (14 backend + 8 frontend + 1 sheet).** Backend (.gs): Menu v1.4, WebAPI v1.6, Tambah_Akaun v1.1, BakiPembukaan v1.1, PosAgihanAPK (v1.1 source needed), PosSusutNilai v1.0, WangRuncit v1.0, Laporan v1.1, LindungiHelaian v1.0, OCRPenyataBank v1.1, RekonsiliasiBank v1.0, BukaWebApp v1.0, KadarStatutori v1.0, LogPerubahan (source needed). Frontend: index.html, app.js, config.js, penyata-bank.html + .js (v1.1), rekonsiliasi-bank.html + .js (v1.1), styles.css. Sheet: APZacct_Template_Kosong_v1.0.xlsx.

**Open questions for mhrey:** (a) does "past finance data" mean audited closing balances only (supported) or prior-year P&L / cash-flow comparatives too (not supported)? (b) upload the live `APZacct_LogPerubahan.gs` and the v1.1 `APZacct_PosAgihanAPK.gs`. (c) OK to apply the LockService fix and put Cloudflare Access on the live URL next?

## 15. Session update — 2026-09-29: user guide, AT v2, Jurnal Laras, template v1.1

Trigger: mhrey asked for (a) a full how-to guide — Kontra, pendapatan/perbelanjaan terakru and terdahulu, flow of every Excel tab, what to do with the Nota template; (b) Panduan wording made plain "sistem perakaunan" (no "koperasi format" / "not SKM EasyCoop" remarks); (c) where the SKM-framework switch is and how to make a base accounting app; (d) whether Wang_Runcit!B4 = 500 matters.

**Method:** every claim below was tested by posting transactions into copies of the real template and recalculating with LibreOffice (`APZacct_test_workbook_scenarios_v1.0.py`) or by running the .gs files in a mock (`APZacct_test_gs_mock_v1.0.js`, 35 checks). Nothing has been run inside live Google Sheets. All amounts are test numbers.

### Findings
| # | Finding | Status |
|---|---|---|
| F1 | **AT v1.0 read TIDAK SEIMBANG whenever a working-capital balance was open at period end** (prepaid, accrued expense/income, deferred income, receivable, payable): AT!B7 was a typed 0 ("perlu data 2+ tempoh"). Also Akaun 1045 tagged Pelaburan pushed depreciation into investing (operating −X, investing +X), and the cash definition hard-coded 1010/1020/1080 (a properly tagged 2nd bank account was RM1,300 off in the test). | **Fixed in template v1.1 (AT v2)** — see below; live sheet needs the guide's Appendix A patch |
| F2 | **The wizard cannot post entries where no money moves** (Terimaan/Bayaran/Kontra and both import pages always have a money leg) → accrual and prepaid-release legs had no path except typing rows by hand. | **Fixed** — `APZacct_JurnalLaras.gs` |
| F3 | Tambah Akaun wrote Kumpulan 'Operasi' for every new account → a new bank account is invisible in the wizard's money list (wizard filters Aset + 'Tidak Berkaitan'); a new fixed asset/loan lands in the wrong AT section. | **Fixed** — Tambah_Akaun v1.2 asks |
| F4 | Wang_Runcit!B4 (500) is referenced by no formula in any sheet and by no script; B5 = SUMIF of Imbangan_Duga for code 1080. Reference only. | Template ships B4 blank + cell note |
| F5 | **Ledger window:** Imbangan_Duga (584 refs) and AT (33 refs) read Baris_Transaksi rows 5-500; sheets end at row 1,000. Lines beyond 500 silently drop out of every statement; beyond 1,000 posting errors. ≈245 two-line transactions. | **OPEN — pilot risk.** Fix = widen ranges (+G/H formulas, sheet rows) |
| F6 | Tetapan!C21 (period lock) was General format: Sheets turns a typed date into a Date object and WebAPI doGet does `String(value)` → string comparison garbage (every row flagged). | Template C21 now Text; **WebAPI v1.7 should also normalise Date** (KIV) |
| F7 | app.js posts `new Date().toISOString().slice(0,10)` = UTC date → an entry made 00:00-08:00 Malaysian time is dated the previous day (year-boundary risk). | **OPEN** — use local date parts |
| F8 | Panduan carried EASY COOP / real-organisation references and a stale developer changelog (6 hits). | Rewritten (neutral BM guide) |
| F9 | New accounts appear in UR/KKK JUMLAH lines but have no named row (statements = typed labels + code formulas). Renaming an Akaun row does not rename a statement row. | Documented; Tambah Akaun message corrected |
| F10 | Standalone Nota skeleton has helper sheets with the same names as live sheets; behaviour on Google Sheets import unverified. | Nota-wired variant built; old standalone not to be imported |
| F11 | The chart already has 1100 Prabayar, 1110 Pendapatan Terakru, 2050 Perbelanjaan Terakru, 2060 Pendapatan Belum Diperoleh — no account work was needed. | — |

### AT v2 (template v1.1) — exact changes
* Baris_Transaksi: new col **H "Jenis Akaun (auto)"** (H5:H500) = INDEX of Akaun!D by Kod, same pattern as col G.
* **AT!B7** = movement of Aset and Liabiliti lines whose group is 'Operasi', excluding the opening transaction (Tetapan!C18): Σ(Kredit−Debit) over Operasi Aset + Σ(Kredit−Debit) over Operasi Liabiliti. Because contra accounts (1045, 1095) are Aset/Operasi, depreciation and provisions add back automatically. **AT!B6 stays 0 (do not type depreciation there — it would double count).**
* **AT!B23** (opening cash) = opening-transaction lines on ALL Aset accounts labelled 'Tidak Berkaitan'; **AT!B25** (independent closing check) = SUMPRODUCT of Imbangan_Duga!H over the same accounts. No account codes are hard-coded any more; this matches the wizard's own definition of a money account.
* Akaun **1045 → Operasi** (was Pelaburan). Labels A6/A7/A23 shortened; cell notes explain them.
* Berkanun logic unchanged (debits only; credits cancel against 3020/3030 debits).
* **Known trap:** an Aset account holding money but labelled Operasi is silently absorbed into working capital (AT stays SEIMBANG, sections wrong). Mitigations: wizard hides it from money lists; Tambah Akaun v1.2 asks; guide §3 warns.
* Results: 16/16 scenarios SEIMBANG with correct sections (e.g. prepaid RM2,400 paid + RM200 released → operating −2,400; RM300 accrual open → operating 0; asset RM3,000 + depreciation RM100 → operating 0, investing −3,000). Old AT on the same year-end-open cases: TIDAK SEIMBANG.

### Template v1.1 — cell-level diff vs v1.0 (verified)
Panduan rewritten (45 cells), Kamus_Istilah +9 rows (Kumpulan Aliran Tunai, Aktiviti Berkanun, Jurnal Laras, Perubahan Modal Kerja, Terdahulu, Float Wang Runcit, KWRS, ADK, Nota), Akaun F(1045), Baris_Transaksi col H (497 cells), AT A6/A7/B7/A23/B23/B25, Wang_Runcit!B4 blank, Tetapan!C21 text format + notes. 2,231 → 2,728 formulas, 0 errors, all checks SEIMBANG when empty. Leftover on purpose: Tetapan!B5 default example "Koperasi Contoh Berhad" (reference column).

### Answers given to mhrey (so a fresh instance does not re-derive them)
* **Kumpulan Aliran Tunai (auto):** Akaun col F label → copied per line into Baris_Transaksi col G → AT sums by label; Tidak Berkaitan = money accounts themselves.
* **Wang_Runcit 500:** no effect; set own float or blank.
* **SKM switch:** none exists; whole workbook is koperasi/GP23-shaped (list in guide §11). Base-app options: (A) quick — hide/rename koperasi parts (1 iteration); (B) rebuild statements dynamically from Akaun + framework packs (bigger). Recommendation: after the pilot customer is validated. Decision pending from mhrey.
* **Nota:** year-end, koperasi only, Board-prepared; use the Nota-wired variant; never import the standalone into a live sheet.

### Live-sheet patch (mhrey's existing test sheet)
Guide Appendix A: H column, 1045 → Operasi, AT!B7/B23/B25 formulas, Tetapan!C21 Plain text, optional Wang_Runcit!B4. Then paste JurnalLaras.gs, Menu v1.5, PosAgihanAPK v1.1, Tambah_Akaun v1.2. **No Web App redeploy** (WebAPI.gs unchanged).

### Updated KIV (priority order)
1. **Ledger window** (F5): widen $500 ranges, G/H formulas, sheet rows; add a capacity warning on Imbangan_Duga.
2. **LockService** around doPost + all menu writers; Cloudflare Access on the workers.dev URL.
3. **app.js local date** (F7) and **WebAPI v1.7** Date normalisation for tarikhKunciTempoh (F6).
4. Rename frontend files with the `APZacct-` prefix (index/app/config/styles collide when co-hosted).
5. Live-test on a scratch Sheet: Baki Pembukaan, Jurnal Laras, Tambah Akaun v1.2, OCR + Rekonsiliasi, Pos Susut Nilai, Pos Agihan APK v1.1.
6. Base-app / framework switch (decision A vs B pending).
7. Nota into the PDF export; prior-year comparative columns; Nota mapping helper for a specific customer.
8. Existing carry-overs: Google Sign-In, Daftar Aset Tetap webapp, Akaun webapp, helper-function de-duplication, protect Transaksi/Baris_Transaksi, learning syllabus.

### How to verify (§10 addendum)
`python3 APZacct_test_workbook_scenarios_v1.0.py [template.xlsx]` (needs LibreOffice + the xlsx skill's recalc.py) · `node APZacct_test_gs_mock_v1.0.js [OUT] [PROJ]` · `node test-akauntan-engine.js`.


## 16. Session update — 2026-10-03: backdated-entry audit, version check

**Version check (mhrey: "always check context"):** the project folder was compared against the shipped set. The scripts (JurnalLaras, Menu v1.5, PosAgihanAPK v1.1, Tambah_Akaun v1.2), the guide and the mock test now in the project folder are byte-identical to what was shipped in r15. The two template workbooks (v1.1 and Nota v1.1) exist only in outputs, not in the project folder — upload them as regular chat attachments when a future session needs them.

**F12 — Backdated entries: accepted by most paths, but there is no flow.** Verified from the code and by scanning every formula in the template.
* Wizard (app.js): no date field; posts `new Date().toISOString().slice(0,10)` = today in UTC → cannot backdate, and 00:00-08:00 Malaysian time gets yesterday's date (F7).
* penyata-bank.js / rekonsiliasi-bank.js: Tarikh is an editable YYYY-MM-DD text cell per row → backdating works. Rows dated on/before Tetapan!C21 are pre-unticked and tinted (warning only, still postable). Format check is a regex only (2026-02-30 passes).
* Menu posting functions ask for a date (Baki Pembukaan, Agihan APK, Susut Nilai, Jurnal Laras). Only Jurnal Laras checks Tetapan!C21 (warn-then-override). Typing straight into Transaksi: unrestricted.
* WebAPI doPost: `tarikh` only has to be non-empty — no format check, no lock check, no future-date check. doGet merely hands Tetapan!C21 to the pages.
* **No statement formula reads a date** (only Daftar_Aset_Tetap uses TODAY()). Imbangan_Duga/UR/KKK/AT add up every line in the workbook. Consequences: a backdated entry within the current year is correct immediately; an entry dated in a previous year or locked period silently changes this year's figures; "as at" statements for a past date cannot be produced. Design = one workbook per fiscal year.
* Only existing control: Log_Perubahan (Transaksi!B Tarikh and D No. PV are watched columns) asks for a reason when an already-posted date is edited. New backdated rows are not logged.
* Recommended manual process (given to mhrey): open period → post with the real date (import page / Jurnal Laras / typed row; if wizard was used, correct Transaksi!B and give the reason); locked period → do not rewrite history, post in the current period with a reference "Pelarasan tempoh lepas", or the board reopens by moving Tetapan!C21 back with a note; previous fiscal year → adjust that year's workbook, never this one.
* **Proposed build (not started, awaiting mhrey's yes):** a "Tarikh" step in the wizard (default today in LOCAL time, editable) that warns when the date is ≤ Tetapan!C21, in the future, or in another fiscal year; WebAPI v1.7 enforcing format + lock server-side with a required reason (and normalising a Date object in C21); a "late entry" tag in the Transaksi Status column. Bundles F6 and F7.

**Direction note:** a separate plain-SME product on MPERS (no koperasi/GP23 parts) is now the stated route for the "base accounting app" question; the koperasi build stays as is. The A-vs-B "switch" decision in §15 is superseded for the SME case. Reuse candidates from this engine: Akaun/Transaksi/Baris_Transaksi, Imbangan_Duga, wizard, Jurnal Laras, AT v2, Kontra, bank import/reconciliation, Wang Runcit, Log Perubahan.

## 17. Release 1.2 — 2026-10-03: frontend rename, time zone, date rules, plans

**Decisions by mhrey this session:** (1) the SME/MPERS product is being built by another AI on top of this base app — not this project's job any more; (2) renaming every frontend file with the `APZacct-` prefix is mandatory; (3) dates must not be raw UTC — default UTC+8, user-settable; (4) most onboarding customers will arrive mid-year with back-dated history — wants a solution, and asked about AI-assisted import from Excel/photos; (5) KIV: a GUI to view accounting data, summary and health without opening Sheets.

### Release 1.2 manifest (authoritative)
| Layer | File | Version | Notes |
|---|---|---|---|
| Frontend | `APZacct-index_v1.2.html` | 1.2 | was index.html; wizard page |
| Frontend | `APZacct-wizard_v1.2.js` | 1.2 | was app.js; new Tarikh step, time zone, late-entry reason |
| Frontend | `APZacct-config_v1.2.js` | 1.2 | was config.js; API URL/secret unchanged; adds ZON_MASA_LALAI |
| Frontend | `APZacct-styles_v1.2.css` | 1.2 | was styles.css; adds .ver |
| Frontend | `APZacct-penyata-bank_v1.2.html/.js` | 1.2 | was penyata-bank.*; asks a reason when posting into a locked period |
| Frontend | `APZacct-rekonsiliasi-bank_v1.2.html/.js` | 1.2 | was rekonsiliasi-bank.*; same |
| Hosting | `_redirects` | — | one line: `/ /APZacct-index_v1.2.html 200` (Cloudflare Workers static assets support `_redirects`; 200 = rewrite). Platform-reserved name. Bump the line on every release |
| Backend | `APZacct_WebAPI.gs` | 1.7 | date rules, lock-with-reason, zonMasa/tarikhPembukaan in doGet, Date-safe C21 |
| Backend | `APZacct_JurnalLaras.gs` | 1.1 | Tetapan time zone |
| Backend | `APZacct_Tambah_Akaun.gs` | 1.3 | cash-flow group prompt (1.2) + Tetapan time zone |
| Backend | `APZacct_Laporan.gs` | 1.2 | Tetapan time zone |
| Backend | `APZacct_RekonsiliasiBank.gs` | 1.1 | ledger dates read in the spreadsheet's zone; Tetapan 'today' |
| Backend | `APZacct_PosAgihanAPK.gs` | 1.1 | loss-year hard stop |
| Backend | `APZacct_Menu.gs` | 1.5 | Jurnal Laras item |
| Backend | unchanged: BukaWebApp, BakiPembukaan, KadarStatutori, LindungiHelaian, LogPerubahan, OCRPenyataBank, PosSusutNilai, WangRuncit | as before | |
| Workbook | `APZacct_Template_Kosong_v1.2.xlsx` | 1.2 | adds Tetapan row 23 (Zon Masa), Panduan date section, 2 Kamus terms |
| Workbook | `APZacct_Template_Kosong_Nota_v1.2.xlsx` | 1.2 | same + Nota + Sejarah_Baki |
| Docs | `APZacct_Panduan_Penggunaan_v1.2.md`, this dossier | 1.2 / r17 | |
| Tests | `APZacct_test_gs_mock_v1.2.js` (52 checks), `APZacct_test_workbook_scenarios_v1.2.py` (17 checks) | 1.2 | wizard date helper tested separately in Node (7 checks, not delivered) |
Old frontend names (index.html, app.js, config.js, styles.css, penyata-bank.*, rekonsiliasi-bank.*) are retired — delete them from the host. Earlier sections of this dossier that mention them refer to the same files under their old names.

### Time zone design
Tetapan!C23 (IANA name, default and fallback Asia/Kuala_Lumpur) is the single source for "today". WebAPI `zonMasaAPZ_()` validates the name (falls back when invalid) and `hariIniAPZ_()` is used by Jurnal Laras, Tambah Akaun, Laporan, Rekonsiliasi and the Drive folder names. doGet sends `zonMasa`; the wizard builds today's date with `Intl.DateTimeFormat(..., {timeZone})`. Dates *read from cells* are formatted in the SPREADSHEET's time zone (`normaliseTarikhSel_`), because that is the frame a Sheets Date value lives in. Set the Sheets time zone, the Apps Script project time zone and C23 to the same value. Not verified live.

### Date rules (WebAPI v1.7; error codes)
TARIKH_TIDAK_SAH (not a real YYYY-MM-DD) · SEBELUM_PEMBUKAAN (earlier than the Tetapan!C18 transaction's date) · TEMPOH_DIKUNCI (on/before C21 without `sebabLewat`; with a reason the row is stored with Status 'Entri Lewat' and the reason goes to Log_Perubahan). Future dates are allowed. Import pages use `window.prompt` for the reason (GUI polish later).

### Back-fill / mid-year onboarding plan (recommendation, not built)
Vendor migration guides (e.g. Xero conversion guides) generally advise a conversion date at the start of a financial year or month, opening balances, and reconciling against the old system (read from web results, not independently verified). For APZacct (statements are date-blind, one workbook per fiscal year) the clean path is: opening balances at FY start → back-fill with real dates → verify against the customer's own trial balance and bank statements → set the lock date → go live. Phases:
1. **Prerequisites (blocking):** widen the 500-line ledger window (Imbangan_Duga 584 refs, AT 33 refs, G/H helper formulas, sheet rows, Nota ranges) · batch-post endpoint (one call, one LockService lock, atomic) · LockService on all writers.
2. **Migration mode:** Tetapan switch + banner, entries tagged 'Migrasi', a 'verify against customer figures' screen (their TB vs ours, per account), then 'Tutup migrasi' sets C21.
3. **AI-assisted import:** bank statements already work (OCR + suggested category + running-balance check); add Excel/CSV cash-book import (deterministic column mapping, AI only suggests categories), then receipt photos (lowest accuracy: suggestions only). Keep: review before post, deterministic completeness checks, a learned payee→account map. Privacy: statements go to the Gemini API — customer consent and data terms not verified.
Cheaper alternative when detail is not needed: opening balances at FY start + monthly summary journals per account for the elapsed months.

### GUI dashboard — KIV (requested)
A read-only web GUI so users need not open Sheets: health lights (Imbangan_Duga/KKK/AT SEIMBANG, bank-rec age, petty-cash variance, ledger capacity %, last entry date, lock date) · UR/KKK/AT/APK viewers · trial balance · ledger browser with date/account filters · chart of accounts. Needs a read endpoint (`doGet?action=ringkasan`) and, because it exposes financial data, real sign-in first (§9 item 4) — the shared secret in public JS is not acceptable for read access.

### Updated KIV (priority order)
1. Phase 1 prerequisites above (capacity, batch post, LockService). 2. Cloudflare Access on the Worker URL. 3. Migration mode + AI import. 4. GUI dashboard (after sign-in). 5. Live-test on a scratch Sheet: Baki Pembukaan, Jurnal Laras, Tambah Akaun, OCR + Rekonsiliasi, Pos Susut Nilai, Pos Agihan APK, the new date rules and the wizard date step. 6. Existing carry-overs (Google Sign-In, Daftar Aset Tetap webapp, Akaun webapp, helper de-duplication, protect Transaksi/Baris_Transaksi, learning syllabus, Nota in PDF export, comparatives). SME/MPERS product: handled elsewhere.

## 18. Release 1.3 — 2026-10-05: ledger window, batch posting, locking; decisions

**Decisions / statements by mhrey:** (1) go ahead with the prerequisites: ledger window ~5,000 lines, batch posting, locking; (2) asked whether locking should wait for sign-in — answered that it should NOT (see below); (3) customer data must live under the customer's own sign-in (Google account, especially Gmail users) and APZacct must not keep it — acceptable while testing, mandatory at shipping; (4) AT: follow what other apps do — no further AT work; (5) GUI dashboard last, together with sign-in; (6) OCR experience: Qwen reads structure well but text badly, Gemini reads text (incl. low quality) well but sees structure differently; he built an OCR model that turns pictures into editable PDFs and suggests mixing models (one or both, whichever is best; unsure whether Claude is free).

### Release 1.3 manifest (authoritative)
| Layer | File | Version | Notes |
|---|---|---|---|
| Frontend | `APZacct-index_v1.3.html`, `APZacct-wizard_v1.3.js`, `APZacct-config_v1.3.js`, `APZacct-styles_v1.3.css` | 1.3 | wizard logic unchanged from 1.2 (renumbered) |
| Frontend | `APZacct-penyata-bank_v1.3.html/.js`, `APZacct-rekonsiliasi-bank_v1.3.html/.js` | 1.3 | post ALL selected rows in one `pos_kelompok` request (all-or-nothing); row-level errors shown, table kept |
| Hosting | `_redirects` | — | `/ /APZacct-index_v1.3.html 200` — bump every release; delete the previous release's frontend files from the host |
| Backend | `APZacct_WebAPI.gs` | 1.8 | script lock, capacity guard, `pos_kelompok`, gap-safe block write, auto grid growth |
| Backend | `APZacct_JurnalLaras.gs` | 1.2 | script lock + capacity guard + grid growth |
| Backend | `APZacct_Tambah_Akaun.gs` 1.3 · `APZacct_Laporan.gs` 1.2 · `APZacct_RekonsiliasiBank.gs` 1.1 · `APZacct_PosAgihanAPK.gs` 1.1 · `APZacct_Menu.gs` 1.5 | as listed | unchanged this release |
| Backend | unchanged: BukaWebApp, BakiPembukaan, KadarStatutori, LindungiHelaian, LogPerubahan, OCRPenyataBank, PosSusutNilai, WangRuncit | | |
| Workbook | `APZacct_Template_Kosong_v1.3.xlsx`, `APZacct_Template_Kosong_Nota_v1.3.xlsx` | 1.3 | ledger window 5,000 (11,730 formulas, 0 errors), Imbangan_Duga row 154 capacity indicator; Nota already reads whole columns |
| Docs | `APZacct_Panduan_Penggunaan_v1.3.md` (Appendix D = widen a live sheet), this dossier | 1.3 / r18 | |
| Tests | `APZacct_test_gs_mock_v1.3.js` (70), `APZacct_test_workbook_scenarios_v1.3.py` (18), `APZacct_test_frontend_jsdom_v1.3.js` (14, needs `npm i jsdom`) | 1.3 | all pass; nothing run live in Sheets |

### What changed in the engine
* **Capacity:** `BT_KAPASITI_BARIS = 5000`; template formulas read Baris_Transaksi rows 5-5000 and the G/H helper formulas are pre-filled to 5000. Imbangan_Duga A154:C154 shows lines used / 4996 and HAMPIR PENUH above 90%. A post that would exceed the window is refused (`KAPASITI_PENUH`). Verified with 701-line and 4,983-line ledgers (all three checks SEIMBANG, capacity text correct). Whole-column Nota formulas needed no change.
* **Lock:** `dalamKunciAPZ_(fn)` = `LockService.getScriptLock().tryLock(30000)`; busy → `SISTEM_SIBUK`. Applied to doPost (single), `pos_kelompok` and Jurnal Laras. NOT yet applied to Pos Baki Pembukaan, Pos Susut Nilai, Pos Agihan APK, Tambah Akaun (KIV). The Drive receipt upload stays outside the lock.
* **Batch posting** (`action:'pos_kelompok'`, ≤ 500 transactions): validates every item with `semakTransaksiAPZ_` (date rules, opening guard, lock + reason, account codes, balance, no negatives) → any failure returns `KELOMPOK_TIDAK_SAH` with `ralat[{indeks,kod,error}]` and writes nothing; otherwise under one lock it appends after the LAST filled row (`barisSeterusnyaAPZ_`, so a gap in the middle is never overwritten), writes headers and lines with two block writes, grows the grid if needed (`ensureBarisAPZ_`), tags late items 'Entri Lewat' and logs one summary row in Log_Perubahan. Batch-level `sebabLewat` covers every late item.
* Error codes: TARIKH_TIDAK_SAH, SEBELUM_PEMBUKAAN, TEMPOH_DIKUNCI, SISTEM_SIBUK, KAPASITI_PENUH, KELOMPOK_KOSONG, KELOMPOK_BESAR, KELOMPOK_TIDAK_SAH, RALAT_SISTEM.

### Locking vs sign-in (answer given)
They solve different problems. The lock protects ledger integrity (two requests choosing the same next row/ID — possible even for one user with two tabs or a double click) and is ~15 lines; it is per script project, so it keeps working when each customer runs their own deployment. Sign-in decides WHO may call the API and where the data lives. So: lock now, sign-in later, no dependency either way.

### Target architecture for shipping (from mhrey's requirement; not built)
Per-customer deployment: each customer gets their own copy of the Sheet with its bound Apps Script under THEIR Google account (web app executes as that owner); Google sign-in (ID token verified server-side, `Pengguna` allow-list sheet, roles — §9 item 4) controls who may use it; the static frontend holds no data; OCR/AI keys are per customer (script property) so statements are never relayed through us. Needs later: a provisioning flow (copy the template into the customer's Drive, deploy, hand over the URL), per-customer `APZacct-config` generation, retirement of the shared secret. Until then the current single deployment is test-only.

### OCR engine note (recommendation, not built)
Keep Gemini now. Make the engine pluggable (config + one adapter per model), then benchmark on real statements using the existing running-balance check as an objective metric (share of statements that pass with no manual fix; amount accuracy; row recall). If an ensemble wins (structure pass by a Qwen-VL model, text pass by Gemini over the detected cells, merge, validate), adopt it. Open points: free tiers of hosted APIs may allow training on submitted data (not verified) — unacceptable for customer statements, so use paid/no-training terms or self-host; Qwen would need a reachable HTTP endpoint from Apps Script; per-customer keys.

### AT
Industry packages classify accounts into the three cash-flow sections and derive the working-capital line from the ledger/balance sheets; APZacct now does the same (§15). Decision: no further AT work for now.

### Updated KIV (priority order)
1. **Live test on a scratch Sheet** of everything added since r15 (AT v2 patch, Jurnal Laras, Tambah Akaun, date rules/time zone, lock, batch post, capacity, widened ranges, Nota variant). 2. Migration mode (Tetapan switch, 'Migrasi' tag, verify-against-customer-figures screen, 'Tutup migrasi' sets the lock date). 3. AI import: Excel/CSV cash book, then receipt photos; OCR engine abstraction + benchmark. 4. Google sign-in + per-customer deployment/provisioning. 5. GUI dashboard — last, with sign-in. 6. Lock the remaining writers (Baki Pembukaan, Susut Nilai, Agihan APK, Tambah Akaun); Cloudflare Access as an interim door; Nota in the PDF export; prior-year comparatives; learning syllabus; helper-function de-duplication.

## 19. AI financial-health analysis — design (requested 2026-10-05; not built)

Idea (mhrey): add an analysis report next to KKK / UR / AT that assesses finance and accounting health with AI, using several models and summarising their answers together, with improvement suggestions. Existing starting point: `janaRingkasanAI()` (single model, Gemini, 150-200 words into Cetak!A6).

**Principle: numbers first, AI second.** AI never calculates; it interprets a pack of figures computed by formulas, and every figure it quotes is checked against that pack.

**Layer 1 — deterministic pack** (new `Analisis` sheet; free, always on, testable in the scenario suite):
* Liquidity: current ratio (Akaun col I Semasa/Bukan Semasa), cash ratio, cash runway in months = cash / average monthly expenses over the months between the opening date and the last transaction date.
* Solvency: liabilities/assets, liabilities/equity. Profitability: surplus margin, expense mix, top-3 revenue share, top-3 expense share.
* Cash quality: AT operating cash vs surplus; receivables + prepaid as % of revenue; payables vs cash. Efficiency: receivable and payable days.
* Controls panel: Imbangan_Duga / KKK / AT SEIMBANG, ledger capacity %, wrong-side balances (expense or asset with a credit balance, revenue with a debit balance), late-entry count, manual-journal share, last petty-cash variance. Koperasi-only indicators sit behind a framework flag.
* Traffic lights; thresholds editable in Tetapan.

**Layer 2 — AI** (`janaAnalisisAI()` in Apps Script, supersedes janaRingkasanAI): send only the pack (no transactions, no names) plus context (entity type, period length, framework, language) to 2 analyst models in parallel (`UrlFetchApp.fetchAll`). Each returns structured JSON {verdict, reasons[], risks[], improvements[{action, impact, effort}], questions[], caveats[]}. One synthesiser call merges: consensus (≥2 models agree), disagreements, ranked improvements. Deterministic guard: every number or percentage in the AI text must exist in the pack (tolerance 0.5%) or it is listed as "tidak disahkan". Output sheet `Analisis_AI`: models and versions used, verdict, consensus, disagreements, unverified claims, raw answers below, disclaimer (analysis aid, not advice or audit). One failing model degrades gracefully; a single answer is labelled as such.

**Operational notes:** keys per customer in Script Properties (GEMINI_API_KEY exists); model names are constants with a changelog pointer (models get retired — gemini-2.0-flash did); request formats and endpoints for non-Gemini models must be checked against current docs before building; Gemini free-tier data terms and any hosted model's training terms are not verified — customer financial data needs paid/no-training terms or self-hosting.

**Phases:** A numbers sheet → B AI layer (needs mhrey's choice of models and keys) → C GUI + PDF integration → D framework-specific indicator packs (SME/MPERS is handled elsewhere). Fits the KIV order after sign-in/GUI only for the GUI part; Phases A and B can run earlier because they live in Sheets.

## 20. Release 1.4 — 2026-10-12: versioned .gs names, documents phase 1 (PV / Resit / Pihak)

**Decisions / statements by mhrey this session:** (1) while testing v1.3, continue KIV 2 and 3: every file, .gs included, carries the release number in its name (APZacct-<Nama>_v1.4.ext, one number for the whole release) and the first document phase; (2) the PV/RT may already exist (made earlier with another AI, AppSheet-based) and will be uploaded to context: the PV/RT layout, numbering and fields in 1.4 are PROVISIONAL until reconciled with it (§20.9); (3) tax and e-Invoice are parked (T1 optional, §20.8); (4) the GUI summary dashboard with analysis and charts is the NEXT KIV (design in §21).

### 20.1 Manifest (authoritative; all files at release 1.4)
| Layer | Files |
|---|---|
| Apps Script (17) | `APZacct-BakiPembukaan`, `-BukaWebApp`, `-Dokumen` (NEW), `-JurnalLaras`, `-KadarStatutori`, `-Laporan`, `-LindungiHelaian`, `-LogPerubahan` (watches Dokumen), `-Menu` (adds Semak Versi Fail), `-OCRPenyataBank`, `-PosAgihanAPK`, `-PosSusutNilai`, `-RekonsiliasiBank`, `-TambahAkaun` (was Tambah_Akaun), `-Versi` (NEW), `-WangRuncit`, `-WebAPI` (documents + versi), each `APZacct-<Nama>_v1.4.gs` |
| Website (10 + 1) | `APZacct-index_v1.4.html`, `-wizard_v1.4.js` (Pihak, split, Pegawai, document success), `-config_v1.4.js` (APZ_VERSI), `-styles_v1.4.css`, `-penyata-bank_v1.4.html/.js`, `-rekonsiliasi-bank_v1.4.html/.js` (rename only), `-dokumen_v1.4.html/.js` (NEW), `_redirects` = `/ /APZacct-index_v1.4.html 200` (bump every release; the only unversioned name) |
| Workbooks | `APZacct-TemplateKosong_v1.4.xlsx`, `APZacct-TemplateKosongNota_v1.4.xlsx`: v1.3 + sheets Pihak, Dokumen, Dokumen_Baris (after Baris_Transaksi), Tetapan rows 24-27, Kamus +6 terms, Panduan section. 11,730 / 11,934 formulas (unchanged), 0 errors, all checks SEIMBANG |
| Docs | `APZacct-PanduanPenggunaan_v1.4.md`, this dossier `APZacct-HandoffDossier_v1.4.md` |
| Tests | `APZacct-TestGsMock_v1.4.js` (201 checks), `APZacct-TestFrontendJsdom_v1.4.js` (70), `APZacct-TestWorkbookScenarios_v1.4.py` (28: 7 structure + 18 scenarios + E1 + D1 + D2), `APZacct-ReleaseCheck_v1.4.js` (names / first lines / constants / references) |
Note: files uploaded as project knowledge show underscores for the dots (`_v1_3.js`); the real names use dots. Old names (APZacct_WebAPI.gs, index.html, app.js ...) and all v1.3 files are retired.

### 20.2 Version registry (new)
Each .gs has line 1 `// APZacct release 1.4 - file <name> (<note>)` and `const APZ_VER_<NAMA> = '1.4';`. `APZacct-Versi_v1.4.gs` holds `APZ_RELEASE` and `senaraiVersiAPZ_()` (typeof-guarded reads of all 17 constants), `nilaiSemakVersiAPZ_()` (pure, tested) and the menu function `semakVersiAPZ()` (reports HILANG = file not pasted, LAIN = other release). doGet returns `versi: APZ_RELEASE`; the pages call `apzTunjukVersiBackend('ver-backend', versi)` (config) and show "backend v1.4" grey, or RED when the backend release differs or is unknown (typical cause: .gs saved but not Deploy > New version). An old copy of a file left in the project redeclares the same top-level consts and Apps Script fails loudly ("Identifier ... has already been declared", menu disappears) instead of silently mixing releases (mock-tested). Apps Script cannot read a `const` by name dynamically, hence the explicit list: add a line when a .gs joins the release (ReleaseCheck verifies the list).

### 20.3 Schema
**Pihak** (header row 4, data from row 5): A ID Pihak (P-0001) · B Nama · C Jenis (Pembekal/Pelanggan/Ahli/Pekerja/Lain-lain) · D No. Pendaftaran / IC · E TIN (LHDN) · F No. SST · G Kod MSIC · H Alamat · I Telefon · J Emel · K No. Akaun Bank · L Status (Aktif/Tidak Aktif) · M Nota. E-G, K are for e-Invoice later (55 data fields incl. TIN, MSIC, classification per line).
**Dokumen** (25 cols): A ID Dokumen (D-0001) · B Jenis (PV/RT) · C Tahun · D Urutan · E No. Dokumen · F Tarikh · G ID Pihak · H Nama Pihak (frozen snapshot) · I Perkara · J Jumlah (RM) · K Kaedah · L Akaun Wang · M ID Transaksi · N Status (Dikeluarkan/Batal) · O Dikeluarkan/Disediakan oleh · P Direkod oleh · Q Diluluskan oleh · R Rujukan Luar · S URL PDF · T Dicipta · U Amaran · V ID Transaksi Pembatalan · W Tarikh Batal · X Sebab Batal · Y URL PDF Batal. Text columns are plain text (a reference like 12-11 must never become a date); the script also sets '@' on the cells it writes.
**Dokumen_Baris** (13 cols): A ID Baris (DB-0001) · B ID Dokumen · C Bil · D Kod Akaun · E Nama Akaun (snapshot) · F Butiran · G Kuantiti · H Harga Seunit · I Jumlah · J Kod Klasifikasi (e-Invois) · K Jenis Cukai · L Kadar Cukai (%) · M Amaun Cukai. G-H and J-M are blank in D1 (ready for invoices / e-Invoice).
**Tetapan** rows 24 Alamat Koperasi, 25 No. Telefon / Emel, 26 Corak No. PV (default `PV-{YYYY}-{NNNN}`), 27 Corak No. Resit (default `RT-{YYYY}-{NNNN}`). Pattern: {YYYY}, {YY}, {N...} (digits = number of N). A pattern without {N..} is ignored (default used). Yearly restart only when the pattern has {YYYY} or {YY}; otherwise the count continues (no duplicate numbers).
**Transaksi** structure unchanged: with a document, column D = the generated number; the outside reference goes to Dokumen!R and the line memo. **Log_Perubahan** now also watches Dokumen columns E, F, H, J (reason required).

### 20.4 API contract additions (APZacct-WebAPI_v1.4.gs + APZacct-Dokumen_v1.4.gs)
* `doGet` → `{ accounts, tarikhKunciTempoh, zonMasa, tarikhPembukaan, versi, pihak:[{id,nama,jenis}] }` (pihak = active parties).
* `doPost` single post: optional `dokumen: { jenis:'PV'|'RT', akaunWang, pihak:{id}|{baharu:{nama,jenis,noDaftar}}, butiran, rujukanLuar, dikeluarkanOleh, direkodOleh, diluluskanOleh }`; `lines` may now be more than 2 (one money line on akaunWang + one line per category, each may carry `butiran`). Validation BEFORE anything is written (`semakInputDokumenAPZ_`): type PV/RT; not Kontra/Jurnal; akaunWang is Aset + Tidak Berkaitan; exactly one money line; RT = money in (debit), PV = money out (credit); every category line one-sided and the category sum equals the money amount; a party present; officers' names ≥2 chars (issuer, recorder; approver optional). Negative debit/kredit are now refused in single posts too (JUMLAH_NEGATIF; batch already did).
* Inside the SAME script lock: `rancangNomborDokumenAPZ_` (checks Dokumen, Dokumen_Baris and Pihak exist; computes the next number, read-only) → `selesaikanPihakAPZ_` (pick, reuse by case-insensitive name, or create P-xxxx) → Transaksi row (D = number) → Baris_Transaksi rows → `tulisDokumenAPZ_` (Dokumen row + Dokumen_Baris rows, wrapped in try/catch: a failure here returns BERJAYA with `dokumenRalat` so the client does not post twice). After the lock: `janaPdfDanSimpanAPZ_` (HTML → `Utilities.newBlob(html,'text/html',name).getAs('application/pdf')` → Drive: `APZacct - Resit & PV / Dokumen Dijana / PV|Resit / <year> / <no>.pdf`, link into Dokumen!S). A failed conversion never undoes the posting: `dokumen.urlPdf=''` and `dokumen.amaranPdf`.
* Response: `{ status:'BERJAYA', idTransaksi, bilanganBaris, urlResit, dokumen:{ id, no, jenis, urlPdf, amaran, amaranPdf? }, dokumenRalat? }`.
* Actions (all need `secret`): `dokumen_senarai` → `{dokumen:[…newest first, last 300…], jumlah, dipotong}` · `dokumen_html {idDokumen}` → `{html, no}` (print view; also used for voided copies) · `dokumen_pdf {idDokumen}` → `{status, urlPdf, batal}` (make or remake; a voided document gets the BATAL copy in Dokumen!Y) · `dokumen_batal {idDokumen, sebab}`: under the lock, refuses unless status = Dikeluarkan and sebab ≥3 chars; posts ONE reversing Jurnal dated today (Tetapan time zone) with Debit/Kredit swapped on the document's CURRENT ledger lines, memo `Pembatalan <no>`, No.PV = the document number; sets Status Batal, V, W, X; best-effort Log_Perubahan row; then the stamped PDF. Imports (`pos_kelompok`) make no documents yet.
* Error codes added: FAIL_DOKUMEN_TIADA (Dokumen .gs not pasted), HELAIAN_DOKUMEN_TIADA, DOKUMEN_TIDAK_SAH, PIHAK_DIPERLUKAN, PIHAK_TIDAK_SAH, PEGAWAI_DIPERLUKAN, JUMLAH_NEGATIF, SUDAH_BATAL, SEBAB_DIPERLUKAN, DOKUMEN_TIDAK_DIJUMPAI, LEJAR_TIDAK_DIJUMPAI, PDF_GAGAL, HELAIAN_TIADA, TINDAKAN_TIDAK_DIKENALI (plus the earlier TARIKH_*, TEMPOH_DIKUNCI, SISTEM_SIBUK, KAPASITI_PENUH, KELOMPOK_*).
* Amount in words (`perkataanBMAPZ_`): Bahasa Malaysia, e.g. 1234.50 → RINGGIT MALAYSIA SERIBU DUA RATUS TIGA PULUH EMPAT DAN SEN LIMA PULUH SAHAJA; empty string for a non-numeric, negative or ≥RM1bn amount (never a wrong sentence).
* Safety: `teksSelamatAPZ_` trims, caps length and puts a space before a leading = + - @ so Sheets cannot read typed text as a formula; every printed value is HTML-escaped. Control flags (`amaranKawalanAPZ_`): RT issuer = recorder; PV with no approver or approver = preparer (case/space-insensitive). Warn, never block.

### 20.5 Frontend
* Wizard flow (non-Kontra): intro, jenis, kaedah, akaunWang, **pihak**, kategori, **pvrt** (now "Rujukan & butiran"), tarikh, **jumlah** (optional split editor: rows of account + butiran + amount, live "baki" line, rows must equal the total), **pegawai**, review, selesai. Kontra flow unchanged (no pihak, no pegawai, no dokumen, old reference step). State additions: pihakId ('' | 'P-xxxx' | '__baharu'), pihakNama/Jenis/Daftar, butiran, pecah, baris[], dikeluarkanOleh, direkodOleh, diluluskanOleh, dok* (result). Officer names are remembered in `localStorage['apzacct_pegawai']` (try/catch). Lines: money line = total; category lines carry `butiran`. Description (`perkara`) = "Bayaran kepada <pihak> - <butiran or categories>" / "Terimaan daripada …". A new party makes the wizard re-read doGet to refresh the list. Success screen: document number, Buka PDF (https links only), flags, PDF/ledger warnings.
* Dokumen page: list newest first, filters (type, status, text), cards with Cetak (window opened inside the click so pop-up blockers allow it; HTML from `dokumen_html`; prints), Buka PDF / Jana PDF, Batalkan (prompt for reason + confirm). Non-https URLs are never rendered as links.
* config.js: `APZ_VERSI`, `apzTunjukVersiBackend`. Footer links to Dokumen on the wizard.

### 20.6 Verification run (all pass)
Mock 201/201 · jsdom 70/70 · workbook scenarios 28/28 (LibreOffice recalc, 0 errors) · release check 244/244. PV, Resit and a voided PV were rendered from the real template with wkhtmltopdf and inspected (layout fine; HTML typed into a name is shown as plain text). NOT verified live: Apps Script's own HTML→PDF engine (CSS limits), Google Sheets behaviour on import of the new sheets (data-validation ranges were trimmed to row 1004 by LibreOffice's re-save; harmless), Drive folder creation, the lock under real concurrency.

### 20.7 Findings / risks to carry
1. `dokumen_senarai` / `dokumen_html` expose names and amounts to anyone holding the shared secret (public in config.js). Test deployment only; sign-in (§9 item 4) is mandatory before a real customer.
2. Sheets parses a date-like string written with setValues as a date; Tarikh is read back through `normaliseTarikhSel_` everywhere (kept). Text cells are formatted plain text to avoid the same trap.
3. If `tulisDokumenAPZ_` fails after the ledger rows are written, the number already sits in Transaksi!D while the Dokumen row may be incomplete: the response says so (`dokumenRalat`); the next document could reuse that sequence number. Rare; the guide tells the person to check the Dokumen sheet.
4. Bank imports and Rekonsiliasi still post without PV/Resit. Candidate: a per-row "jana PV/Resit" tick.
5. LogPerubahan's trigger must be re-run once on a new sheet (unchanged).
6. v1.3 had not been live-tested when 1.4 was built: 1.4 is a superset of 1.3; test 1.4 directly if 1.3 was never deployed.

### 20.8 Tax and e-Invoice (researched this session; parked)
* APZacct has NO tax calculation: APK!B15 "Peruntukan Cukai Pendapatan" is a typed yellow cell; Pos Agihan APK posts it with the other lines as Debit 3030 / Credit 2070 Cukai Belum Dibayar (Berkanun); payment = wizard Bayaran against 2070. UR has no tax line (5110 Income Tax inactive). Pos Agihan APK hard-stops when UR surplus ≤ 0, which would also block a tax line. Daftar_Aset_Tetap has no capital-allowance columns. No CP204/CP207/Form C1 tracking.
* Koperasi income tax (HASiL "Cukai Koperasi" page, e-book 2023, Public Ruling 9/2011): exempt for 5 years from registration (Sch. 6 para 12(1)(a)); afterwards exempt only if members' funds on the FIRST DAY of the basis period < RM750,000 (para 12(1)(b)); no sales test. Members' funds = paid-up shares/subscriptions + statutory reserve + other reserves (not revaluation reserve, not provisions) + share premium + accumulated profit; members' savings/loans excluded. Exempt or not, Form C1 is due 7 months after year-end and adjusted income / losses / capital allowances are computed. Taxable: graduated scale 0% (first RM30,000) rising to 24% above RM750,000 (YA2015-2022 table; the live page shows the same); special deductions 65A(a) transfers to Rizab/KWA up to 25% of audited net profit and 65A(b) 8% of members' funds (rate may be prescribed). 2019 parliamentary reply: 178 of 673 koperasi that filed for YA2017 were taxed. Budget 2027 (tabled 9 Oct 2026): coverage seen mentioned no koperasi tax change; full measures not checked.
* e-Invoice: HASiL timeline page (updated 30 Aug 2026; Guideline v4.8, effective 1 Sep 2026): annual turnover/revenue below RM3,000,000 exempt (a vendor analysis says including co-operatives; group conditions apply: check per customer). Needs 55 data fields.
* Options held: T1 "Status Cukai" (registration date + editable RM750,000 threshold + members' funds from the opening-day equity codes the treasurer maps, advisory panel, sets APK!B15 = 0 when exempt); T2 "Pengiraan Cukai" (adjusted income, capital allowances, 65A deductions, scale, CP204/CP207). Open design question: whether Rizab/KWA are computed on surplus before or after tax (APK currently computes on UR!B36, before tax): confirm with the auditor before T2.

### 20.9 Reconciling with the existing PV/RT (open — awaiting upload)
mhrey believes the PV/RT already exists (another AI; the AppSheet PV/RT procurement system noted earlier). On upload, diff against: numbering scheme (Tetapan!C26/C27 patterns can match it without code), printed fields and layout (`binaHtmlDokumenAPZ_` is the single template), signatory blocks, approval workflow (prepared / checked / approved), party master (Pihak columns), and decide the owner: APZacct as single home for PV/Resit (recommended: data stays in each koperasi's own workbook, no second platform; AppSheet's free tier is prototype-only, about 10 users, per third-party sources, so production use means paid per-user plans unless the Workspace edition includes Core) versus AppSheet as front door pushing into APZacct.

### 20.10 Roadmap after 1.4 (priority order)
1. Live test of 1.4 on a scratch Sheet (Panduan §0 first-test, Appendix E): PDF conversion, void, Semak Versi Fail, plus everything flagged in §15-§18.
2. Reconcile with the uploaded PV/RT (§20.9).
3. **Dashboard G1** (§21) as release 1.5.
4. Documents phase 2: bills and invoices (accrual posting, "Bayar invois" pre-fills the PV, debtor/creditor aging); phase 3: quotation → PO → delivery note, approval limits; phase 4: tax / e-Invoice modules when a customer passes the RM3m turnover line.
5. Migration mode + AI import; Google sign-in + per-customer provisioning (required before real data); lock the remaining writers; Nota in PDF export; comparatives; AI health analysis (§19).

## 21. GUI summary dashboard — design for release 1.5 (requested 2026-10-12; NOT built)
**Why / who.** mhrey: most apps today open on a summary dashboard with analysis and charts; wants one (moved up from "last"). Read-only; for the treasurer first, then the Lembaga and the auditor; phone first, desktop second; no need to open Sheets. It must reuse the statements as the single source of the official numbers.

**Sections.** (1) Health lights: Imbangan_Duga / KKK / AT SEIMBANG, ledger capacity (used / 4,996), last entry date, period-lock date, count of late entries, documents flagged and voided, last petty-cash variance, and a built-in reconciliation light "monthly totals = UR totals". (2) KPI cards (period): Hasil, Perbelanjaan, Lebihan Bersih, Tunai & bank, Jumlah Aset / Liabiliti / Ekuiti (values read from UR / KKK / Imbangan_Duga, not recomputed). (3) Charts: monthly Hasil vs Perbelanjaan (grouped bars); cash balance trend (line); top expense accounts (horizontal bars); top revenue accounts; Aset vs Liabiliti + Ekuiti (stacked bar). (4) Analysis pack (deterministic, thresholds editable in Tetapan, traffic lights): current ratio (Akaun col I Semasa), cash runway in months = cash / average monthly expense, surplus margin, expense mix, top-3 revenue share, operating cash vs surplus (AT), later receivable/payable days (documents phase 2). (5) Documents panel: PV/RT counts and totals for the period, top parties, flagged list. (6) Later: AI narrative over the analysis pack (§19; numbers first, AI second; every figure the AI quotes is checked against the pack).

**Architecture.** New backend `APZacct-Dashboard_v1.5.gs` with action `ringkasan {dari, hingga}` (read-only): joins Transaksi (date, status) + Baris_Transaksi (account, debit, kredit) + Akaun (Jenis, Kumpulan) in memory (≤5,000 lines is fast) for the monthly series, and reads the statement cells for the official totals; response = `{kpi, bulanan:[{bulan,hasil,perbelanjaan,tunaiBersih,bakiTunai}], perbelanjaanIkutAkaun, hasilIkutAkaun, kesihatan, analisis, dokumen}`. Monthly cash = movement of Aset + Tidak Berkaitan accounts excluding the opening transaction (Tetapan!C18); Hasil = Σ(kredit-debit) on Jenis Hasil; Perbelanjaan = Σ(debit-kredit) on Jenis Perbelanjaan. Cache: CacheService 120 s, key = period + last rows of Transaksi / Baris_Transaksi / Dokumen (changes on any post, no write overhead). New page `APZacct-dashboard_v1.5.html/.js` (same visual language), period picker (this month / 3 months / financial year to date / custom), cards stacked on a phone. Charts: hand-rolled inline SVG (bars, line, horizontal bars, stacked bar; about 250 lines, no CDN, no supply-chain risk, prints cleanly); Chart.js (pinned version, SRI) only if tooltips or animation prove necessary. All files move to release 1.5 together (naming rule).
**Security.** `ringkasan` exposes financial totals; with the shared secret in public JS it is acceptable only on the test deployment. Sign-in (§9 item 4) comes before any real customer; then views by role (Bendahari full, Penyemak and Juruaudit read-only, Lembaga KPIs only).
**Phases.** G1: health lights + KPIs + three charts (monthly Hasil vs Perbelanjaan, cash trend, top expenses) + period picker. G2: analysis pack with thresholds, documents panel, print / PDF of the dashboard, receivable/payable aging after documents phase 2. G3: AI narrative, role views after sign-in, comparisons with the previous period / year when comparatives exist.
**Open questions for mhrey:** first audience (treasurer or Lembaga); the three charts that matter most; the default period (financial year to date?); OK to ship G1 on the shared secret for testing only. Test plan: mock for `ringkasan` (monthly totals equal the UR totals on the 18 scenarios), jsdom for the page, and a visual check of the SVG charts.

*End of dossier. This document plus the account's own persistent project memory (read automatically at the start of any new chat in this project) together cover everything a fresh instance needs — this file is the technical depth memory intentionally doesn't hold.*
