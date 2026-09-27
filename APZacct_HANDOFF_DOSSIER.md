# APZacct — Handoff Dossier

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
| Baris_Transaksi | Transaction lines (the actual ledger) | ID, ID Transaksi, Kod Akaun, Debit, Kredit, Memo, (col G) Kumpulan Aliran Tunai (auto, array formula) |
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
| 19 | Had Amaran Perbezaan Wang Runcit (RM) | `semakWangRuncit()` |
| 20 | URL Web App APZacct | `bukaWebApp()` |
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
| `APZacct_Menu.gs` | v1.3 | Registered Pos Susut Nilai Aset |
| `penyata-bank.js` | v1.1 | Period-lock row flagging |
| `rekonsiliasi-bank.js` | v1.1 | Period-lock row flagging (belum-direkod table only) |
| `test-akauntan-engine.js` | — | Standalone Node test suite. Corrected this session: actually 37 assertions / 7 sections at baseline (re-run directly to verify — an earlier session's "44 assertions, 11 sections" note didn't match the file). Now 42 / 8 with the new Imbangan_Duga sign-convention section (§12) |
| `APZacct_Laporan.gs` | v1.1 | Unchanged this session |
| `APZacct_BukaWebApp.gs` | v1.0 | Unchanged this session |
| `APZacct_BakiPembukaan.gs` | v1.1 | Unchanged this session |
| `APZacct_LindungiHelaian.gs` | v1.0 | Unchanged this session — protects Imbangan_Duga/UR/KKK/APK/AT/Cetak (warning-only); does **not** cover Transaksi/Baris_Transaksi, which is exactly where the real bug this session lived (see §7) — worth reconsidering |
| `APZacct_PosAgihanAPK.gs` | v1.1 | Adds a hard-stop loss/no-surplus guard before any statutory distribution can post — closes §6 item 19, see new §11 |
| `APZacct_OCRPenyataBank.gs` | v1.1 | Unchanged this session |
| `APZacct_RekonsiliasiBank.gs` | v1.0 | Unchanged this session; formula independently re-derived and verified correct |
| `APZacct_Tambah_Akaun.gs` | v1.1 | Unchanged this session |
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
2. ~~**Confirm current statutory rates** with SKM/auditor directly for the deploying cooperative's actual current fiscal year (§3's Tetapan table caveat).~~ — **general current-rate picture researched this session, see §13** — the deploying cooperative's own exact figure still needs its own auditor/SKM confirmation, since it depends on that cooperative's own Rizab-to-Modal ratio.
3. ~~**Loss-year block** in `posAgihanAPK()`~~ — **done, v1.1** (§6 item 19, §11).
4. **Google Sign-In.** Decided direction: Option A (Google's own sign-in via a JS ID-token widget in the Cloudflare-hosted page, verified server-side against `oauth2.googleapis.com/tokeninfo` — NOT cookie-based, since frontend and backend are different origins). A `Pengguna` sheet (verified email → name → role → active/inactive) is needed regardless of how identity is proven. Roles discussed: Bendahari (full read/write), Penyemak (review/approve, not post — segregation of duties), Juruaudit (read-only everywhere, with easier drill-through to supporting documents than a normal user gets, given how financial audits actually work), and a future Approver role once PV/RT exists. Agreed sequence: build sign-in first, prove it works with 2–3 real concurrent users, *then* build role enforcement. Open question: retire the shared API secret once real per-person login exists, or keep it as a second layer?
5. **Multi-framework switch** — reframed as two independent axes rather than three fixed presets: **entity type** (Koperasi/GP23 vs. a plain private entity — different equity and distribution modules, not a toggle on the same one) × **reporting depth** (MPERS vs. MFRS). Explicitly sequenced *after* the current build's core/security/backend/frontend/data-continuity is fully correct.
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

*End of dossier. This document plus the account's own persistent project memory (read automatically at the start of any new chat in this project) together cover everything a fresh instance needs — this file is the technical depth memory intentionally doesn't hold.*
