# Rental Calculator — concept, formulas, and deploy notes

New tool, built 2026-09-11, for renting out equipment (JCB backhoe loaders, excavators, and similar machinery) — the 8th tool in the Business Analysis dropdown, alongside the existing seven. Named exactly "Rental Calculator" per instruction, so it's referenced consistently across the team.

This doc assumes no prior context. If you only read one section, read "Cost structure, in plain terms" and "What changed from your old Excel." For the most recent additions, read the entries immediately below first (newest first, same convention as this site's other change-notes files).

## 2026-09-24 — nav retrofit (per `NAV_RETROFIT_HOWTO.md`)

Per that doc's own instruction to any AI session maintaining a page here — do it now, don't wait to be asked again. Two edits, both nav-only:

1. Added `<script src="site-config.js?v=1" defer></script>` and `<script src="nav-config.js?v=1" defer></script>` as the first two script tags on the page, before `costing-sync.js` and `nav-dropdown.js`.
2. Emptied this page's hard-coded `<ul class="nav-dropdown-menu">` list down to the single placeholder comment — `nav-config.js` now renders it from `RZ_NAV_PAGES` on every load. This page's old hard-coded list was already stale (missing SOP Creator, Project Planner, Form Creator, and QR Creator, all four added to `RZ_NAV_PAGES` after this page's own dropdown was last hand-edited) — the retrofit fixes that as a side effect, not a separate change.

**Business-constants half of the retrofit (step 4) does NOT apply here.** This file's own `GUIDE_RATIOS` is keyed by equipment category (excavator, backhoe, crane, forklift…) — a different schema entirely from `RZ_SITE_CONFIG.guideRatios`, which is keyed by F&B venue type (home/stall/truck/store) for Costing Analysis and Margin Analysis. There's nothing in site-config.js today for this file's `GUIDE_RATIOS` to read from, and inventing a new shared config entry for a value only this one tool currently uses would add complexity with no present drift risk to justify it (same reasoning `SITE_CONFIG_STANDARD.md` already applies to its own "flagged, not built" candidates) — left as a local constant, unchanged.

Also fixed in passing: both `NAV_RETROFIT_HOWTO.md` and `SITE_CONFIG_STANDARD.md` still listed this page under "not yet retrofitted" — moved to "done" in both, since a stale tracker is exactly the kind of drift these docs exist to prevent.

No settings-reference or version-string changes needed — this was markup/script-tag only, `rental-calculator.js` itself is untouched.

## 2026-09-22 — machine photos in the ad, and a checkbox-driven client-safe print summary

Two features, both direct requests, both resolve open items from the 2026-09-20 entry below.

**1. Print Summary — the "Save as PDF reveals your margin" issue now has a real fix, not just a flag.** A new "Print summary…" button sits beside the existing "Save as PDF" button — **"Save as PDF" itself is completely unchanged**, still prints everything, exactly as before, per direct instruction to keep it as the standard. "Print summary" opens a checklist (11 sections: Pricing, Deposits, All-equipment comparison, True cost breakdown, Margin by tier, Partner payouts, Margin/break-even/revenue, Cost-structure chart, Market comparison, Insights, Rental Calculation inputs) — Pricing and Deposits are checked by default, everything else starts off, and you tick whatever you actually want in a given printout. The Ad Creator, quick-nav, formulas, and glossary are never included in a summary, checked or not — they're not report material. Mechanism: temporarily adds this page's own existing `.no-print` class to whatever's unchecked, calls the normal browser print dialog, then removes it again once printing is done — nothing on screen ever changes, and nothing new is invented for the hiding itself, just reused. Every checkbox was cross-checked programmatically against a real tagged section in the HTML before shipping this — zero orphaned checkboxes, zero untagged sections.

**2. Machine photos in the Ad Creator.** New "Machine photo" upload under the ad controls, kept per equipment tab (switch machines, each keeps its own photo) and, like everything else here, never uploaded or saved anywhere — it lives in the browser tab's memory for this session only. When a photo is set, it replaces the big typography-only headline in the ad's header zone (contain-fit, never cropped or stretched, so a portrait or landscape photo both still fit the fixed header height) with a small category/name caption underneath; with no photo, the ad looks exactly as it did before today. Recommended: a PNG with the background already removed, so it sits on the theme's color block cleanly.

**On the two photos supplied for testing (Komatsu PC130, JCB backhoe):** both were flat JPGs with a checkerboard pattern baked into the pixels to *simulate* transparency (a known quirk of asking an image generator for "transparent background" — it can't produce real alpha, so it renders a fake checkerboard instead). Real background removal was done here: corner-sampled the two checkerboard shades, flood-filled from the image border through connected regions matching either shade, and merged in a few large disconnected patches that a stray thin line had isolated from the main region — never blind color-keying, since large parts of both machines are legitimately white/light-gray too, and a plain color threshold would have punched holes straight through the bodywork. **Excavator came out clean.** The **JCB backhoe has faint leftover checkerboard flecks** in a few open background patches — that image has thin dashed reference/grid lines running across the whole canvas (a Gemini styling choice) that fragment the background into far more disconnected pieces than the excavator has, and chasing the last few percent risked eating into the machine's own panels instead (an earlier, more aggressive attempt did exactly that — reverted). Good enough to use; say so if you want another pass, or a regenerate without the grid-line overlay would likely come out cleaner on the first try. Delivered as `komatsu-pc130-transparent.png` and `jcb-backhoe-transparent.png`, alongside the two calculator files.

No settings-reference changes this round — nothing new introduced today is a tunable constant in the sense the settings sheet tracks.

## 2026-09-20 — cost-accuracy audit: two real margin bugs, margin-by-tier visibility, tab toggle, three ad themes

Prompted by a direct "make sure there's no cost creep" ask. Two of the findings below change the actual numbers the tool shows; everything is verified by hand and by running the real code against the file's own default inputs (not just eyeballed) — see the exact figures below.

**1. Margin achieved was dividing by the wrong number.** `marginAt()` computed `(net revenue − true cost) / price` — dividing by the *gross* quoted price, not by what you actually keep after revenue-share and SST come out. That's a different question than the one the price-setting formula answers (target margin on what you *net*, not on the sticker price). The result: "margin achieved" was silently showing `target% × (1 − combined share)` — always lower than what you typed, for no real reason. At this file's own defaults (25% target, 30% combined partner share, no SST), the card read **17.5%** even though the price was correctly hitting 25%. **Fixed** — now divides by net revenue. Re-ran the actual code against the default inputs to confirm: standard margin now reads exactly **25.0%**.

**2. Fuel was being inflated by the "unscheduled repair" buffer.** `bufferedFuelPerHour` multiplied fuel/hour by `(1 + repair buffer% / 100)` — the same buffer meant for maintenance & wear. Fuel consumption doesn't carry unscheduled-repair risk, so this had no real-world justification; it was just quietly overstating wet operating cost. At this file's defaults (10% buffer), that's RM20.00/day of true cost and roughly RM38/day of quoted standard price on a single default machine, confirmed by running the code before and after. **Fixed** — the buffer now only touches maintenance & wear, matching its own label. If you actually intended a broader operating-cost contingency (not just repairs), say so and it can come back as its own, separately-labeled field.

**3. Margin is now shown by tier, not just Daily.** Daily's "margin achieved" is tautological — it's exactly how that price is built, so it will always equal your target margin. Hourly and Monthly aren't built that way: Hourly takes the Daily price and layers a premium on top; Monthly takes it and layers an extra discount on top — so their *real* margin can drift away from target in opposite directions, and until now that was invisible. New "Margin achieved by tier" table in Results, directly under the pricing grid. At this file's defaults, after fix #1: **Hourly ≈ 40.0%** (the premium pushes it up — a genuine bonus), **Daily = 25.0%** (by construction), **Monthly ≈ 14.8%** (the extra monthly discount eats into margin faster than the longer mobilization spread saves it). A new insight also fires if a machine's Monthly margin drops more than 5 points under target.

**4. Rental Calculation tabs now genuinely toggle open/closed.** The 2026-09-12 single-select fix made the four tabs mutually exclusive, but exactly one was always open, and clicking the already-open tab did nothing. Now clicking the open tab closes it too (all four hidden) — real click-to-open/click-to-close. Equipment's own machine-switcher tabs (when you have 2+ machines) are unchanged on purpose: there's always exactly one active machine, since Results needs one to display.

**5. `MARKET_RATE_HOURS_PER_DAY` removed.** Confirmed dead code before touching it: once tier-aware market matching shipped (2026-09-12), hourly market rates started comparing directly against the hourly computed price, and this conversion constant was never read again. Settings-reference workbook updated to match (row marked retired, not silently deleted).

**6. Three more ad themes: Safety Orange, Forest Green, Site Crimson.** Same zero-dependency canvas approach as the existing three — colors picked to echo common heavy-equipment safety/brand palettes (hazard orange, equipment green, machinery red) rather than invented arbitrarily. Six themes total now.

**Flagged, not changed — needs your call, not a guess:**
- **"Save as PDF" currently prints everything**, including the internal true-cost breakdown, margin %, and partner payouts — not just customer-facing pricing. If that exact PDF goes to a client, you're handing them your own cost structure and margin. Options: (a) make print always lean/customer-safe by default, (b) add a second "client copy" print button alongside the existing one, (c) leave as-is and just be deliberate about what you export. Needs a decision before it's built either way.
- **DOSH/JKKP lifting-equipment inspection & certification** (Occupational Safety and Health Act 2022 / Plant Regulations 2024 — a registered Competent Person examines and certifies lifting machinery periodically) is a real, currently-enforced Malaysian compliance cost for cranes, and potentially forklifts/excavators depending on how they're used — confirmed via a live search, not assumed from memory. It isn't its own line item today (it may already be folded into "Registration & permits," or it may not be captured at all). No confident RM figure to quote — it varies by equipment type and capacity — worth a real quote from a DOSH-registered examiner, then either fold it into Registration & permits or ask for a dedicated field.
- **Cost of capital / opportunity cost** for equipment bought outright (not financed) still isn't modeled — a financed machine gets an interest cost, a cash-purchased one gets none, even though that cash could have earned something elsewhere. Common in more advanced costing models; optional, not urgent.
- **Ad Creator + AI-generated art (Gemini or similar):** discussed in chat, not built. Per-image cost is genuinely small (roughly a few US cents on Google's Imagen/Gemini image models, confirmed via Google's own pricing page), but two things matter more than the price: (1) it needs a backend (e.g. a Cloudflare Worker) to keep the API key off the page — matches the Worker idea already raised for this site; (2) the ad canvas currently redraws on every keystroke (`recalculateAll()` on `input`), so an AI call wired into that same path would fire on every keystroke — needs its own "Generate new background" action, decoupled from live recalculation, or costs and latency add up fast. Free path (more canvas themes, done above) ships now with zero new cost or architecture; the AI-art path is a real option but is its own small project.
- **Ad formats beyond 4:5:** a Story/WhatsApp-Status (9:16) and a landscape (1.91:1) canvas variant were suggested — same zero-cost canvas approach, but the header/footer zone math in `drawAdCanvas()` would need to be re-derived per aspect ratio rather than reused as-is. Not built this pass; flag if you want it next.

## 2026-09-13 — partner payout table, Ad Creator, nav grown to 11 tools

**Nav update.** Confirmed filenames for the three other new tools now live in the Business Analysis dropdown here: `market-radar.html`, `cost-structure-checker.html`, `qr-listing-creator.html` (all kebab-case, matching every other page on the site). Rental Calculator's own copy of the dropdown now lists all 11 tools. The other pages' copies still need the central sync pass per `AI_BUILD_BRIEF.md`'s usual convention.

**Partner payout table.** New tables in Results ("Where the money goes — partner payouts"), directly under the hourly/daily/monthly pricing grid: exactly how much RM each revenue-share partner receives, plus SST, plus what's left for the business — one column per tier, one table for standard price and one for non-member. Built off `collectPartners()`, a sibling to the existing `collectPartnerSharePct()` that keeps each partner's own name and % instead of only the combined total.

**Ad Creator.** A real, working feature now, not a mockup — a new "Create a rental ad" box at the end of Results renders a 1080×1350 shareable image on a `<canvas>`, using the active equipment's own live hourly/daily/monthly/member/non-member pricing. Editable business name, tagline, contact phone, contact email, a 3-theme picker (Site Teal / Construction Amber / Steel Graphite), and a toggle for whether to show the non-member price alongside the member one. Downloads as a PNG via `canvas.toDataURL`.

Deliberately no equipment photography — there's no legitimate photo of the actual machine to draw from, and a stock image would be the wrong call. Leans on bold, high-contrast typography and color-blocking instead, following current flyer/poster design direction (oversized scannable type, purposeful elements only, contrast over raw brightness) rather than working around the missing photo.

The layout uses fixed header/footer zones (460px / 150px) with everything else divided proportionally between them, specifically so it can't overflow regardless of business-name length or whether the non-member toggle is on — a genuinely long business name (the reference poster's own "Koperasi Dewan Usahawan Bumiputera Sarawak Miri Berhad" is a real example of exactly this) auto-shrinks to fit rather than running off the canvas.

**A note on the reference poster you shared.** Its own numbers show Hourly = Daily ÷ 8 and Monthly = Daily × 30, with no separate volume discount — simpler than the hourly-premium/monthly-discount mechanism built into this calculator. Both styles are supported: set Hourly premium % and Extra monthly discount % to 0 on a given machine to reproduce that exact flat-rate style, or leave them at their defaults for genuine volume pricing. Also worth knowing: that poster's monthly rate assumes a 30-calendar-day month (with Feb/31st-day adjustments per its own terms), not the 26-working-day figure this calculator defaults "Typical monthly-job length" to — edit that field to 30 on a given machine if you want to match this exact convention.

---

## 2026-09-12 — five real fixes from testing feedback

Testing against an actual quote surfaced real problems, not polish items. All five below trace back to two root causes: one data-entry trap, and one field that looked wired up but wasn't.

**1. The absurd price (~RM30,000+/day).** Root-caused, not guessed at: Wear & Tear used to be a single bare "RM/hour" field. Typing a lump-sum figure there — the natural instinct, since Scheduled Maintenance right next to it works as "cost per service" — silently became the PER-HOUR rate, and at 8 hours/day that error compounds fast (RM2,000 typed as a rate produced RM16,000/day from that one field alone). Verified this by hand: with your exact other inputs, RM2,000/hour of wear & tear alone accounts for essentially the entire absurd result — the formula itself was doing exactly what it was told. **Fixed** by making Wear & Tear work exactly like Scheduled Maintenance now: a cost and the interval it covers, computed internally. There's no longer a bare per-hour field to misread. A new guardrail insight also fires if maintenance + wear & tear per hour comes out far above fuel cost per hour — the exact shape of this specific mistake — so a repeat gets flagged immediately instead of silently producing a five-figure daily rate.

**2. Shared Fixed Overhead "not adding the manpower."** This wasn't a math bug so much as an incomplete wire: the field for shared manpower always existed conceptually, but the sync handler only ever wrote `manpowerMonthly` into an inert text note, never into a real input that fed the calculation — a deliberately cautious choice at the time (see the original "why operator cost is only an estimate" reasoning below), but one that read as broken once you actually needed it to work like Costing Analysis's own sync does. **Fixed** by adding a real "Shared manpower pool" field (Shared Overhead & Manpower tab) that the same Pull button now fills for real, split equally across every wet-hire machine.

**3. Operator cost is now a pure summary, not a second estimate.** Per your direct instruction — you already have a manpower calculator, so this page shouldn't re-derive wages. Every per-equipment wage/statutory-multiplier input is gone; each wet-hire machine now just shows its share of the shared manpower pool above. Foreign-worker handling is KIV, noted here rather than half-built into a page that no longer asks for a wage at all — if it's ever needed, it belongs in Overhead & Manpower Calculator itself, not duplicated here.

**4. Dry vs. wet, and hourly/daily/monthly tiers.** Two related asks: market quotes specify with/without driver independently of period, and a provider's monthly rate is a genuinely lower per-day number, not the same rate restated. Both now modeled directly: every machine gets a **dry** true cost (ownership + maintenance & wear + overhead, no fuel, no operator) and a **wet** true cost (+ fuel + operator), and each is priced across three tiers — Daily is the base calculation; Monthly reuses it but spreads the mobilization fee over a much longer typical booking length (so it's cheaper for a genuine, cost-based reason, not an arbitrary discount) plus an additional editable discount %; Hourly is the daily rate divided by hours, marked up by an editable premium % (short bookings cost more per hour to service — mobilizing a crew for two hours costs proportionally more than for a full day). Verified by hand that hourly > daily > monthly holds on every test case. Market-rate rows now tag both period AND service level, and Results compares each one against your exact matching tier — a "RM700/day with driver" entry is never blended against a "without driver" price.

**5. Tabs — single-select now.** Rental Calculation's four tabs (Equipment / Shared Overhead & Manpower / Revenue-Share & Tax / Margin & Member Pricing) now behave like an ordinary tab switcher: opening one closes whichever else was open. This is a deliberate difference from Margin Analysis's own tabs (which stay independent/accordion-style there) — done this way here because that's what was asked for on this tool specifically, not a global site convention change.

**A note on "are the calculations correct."** Yes, and this was checked against something more concrete than intuition: your own cost model is the real, standard "Ownership & Operating" methodology used in actual equipment-rate calculators (the same structure behind the US Army Corps of Engineers' EP 1110-1-8 approach) — not something improvised for this tool. Separately, real Malaysian listings found for backhoes/excavators run roughly RM700–800/day **with** an operator, with at least one real example already discounting toward longer bookings (RM780→RM700/day past a 7-day threshold) — which is exactly the "cheaper toward monthly" pattern now built in, and a genuine data point worth entering directly into the new market-rate rows (tagged wet, daily) to compare against your own numbers. With realistic inputs, the calculator now lands in that same hundreds-of-Ringgit range rather than tens of thousands.

---

---

## Cost structure, in plain terms

A rental business's cost has two genuinely different characters, and mixing them up is the most common costing mistake in this industry:

**Ownership cost — fixed, time-based.** What it costs to simply own the machine, whether or not it works a single day this month: depreciation, financing interest, insurance, registration/permits. This is recovered by spreading it across however many days you *expect* to rent the machine out — not the days it's merely *available*. That distinction is where utilization comes in (see below).

**Operating cost — variable, usage-based.** What it costs to actually run the machine: fuel, scheduled maintenance, and — the category your old sheet didn't have — a **wear & tear reserve**. Undercarriage, hydraulic hoses, bucket teeth, and tires wear out on a schedule tied to *hours run*, not to the machine's whole useful life, and they wear out faster than routine servicing alone accounts for. This is genuinely a separate line from scheduled maintenance, not a bigger buffer on top of it.

On top of those two, this tool adds:

- **Operator cost** (wet hire only) — a quick EPF/SOCSO/EIS estimate. See "Why the operator cost is only an estimate" below for why this is deliberately not the exact statutory tables.
- **Overhead share** — your general business overhead (depot rent, admin, business-level insurance/licenses — nothing equipment-specific), split equally across every machine you enter.
- **Mobilization** — the one-off cost of getting a machine to and from a job, spread over however many rental days it should reasonably cover.

Add all five together, divided appropriately, and you get **true cost per day** — the number every price is built from.

## Why utilization is the real lever, not price

Ownership and overhead costs are the same total *whether the machine works 10 days or 25 days this month*. That means cost-per-day is really a function of how many days you actually rent it out, not a fixed number. The **break-even rental days** figure in Results makes this concrete: it's fixed monthly costs ÷ contribution margin per day (the same break-even shape as Interactive Costing Analysis's own model, just in days instead of portions). Every rental day beyond that break-even point in a given month is largely pure profit, because the fixed costs are already covered. If you want to move margin, moving utilization up 10 percentage points usually beats trying to push price up 10% — worth checking both, but don't assume price is the only dial.

## The revenue-share gross-up (your "Company A / Company B" question)

Your reference Excel already had this worked out, and it turns out there are **three** partners in it, not two — 5%, 10%, and 15% (referred to there as KODUBS, DUBSH, and DUBSMYY). The Rental Calculator generalizes this to any number of named partners, each with their own editable %, pre-filled with that same 5/10/15 split as a starting point.

The mechanism: every revenue-share % (and SST, if you charge it) is applied to the price you *quote*, then the quoted price is **grossed up** — divided by `(1 − combined share)`, not multiplied by it — so that after every partner is paid, you still net exactly your target. This is the identical shape your Menu Calculator already uses for delivery-app commission and SST; nothing new was invented for this, it's the same math applied to a different business.

## Member pricing — two modes, defaulting to match your own practice

Your old sheet computed a "Standard/Member" price first (already margin-protected after commissions), then built a higher "Non-member" price *up* from that base — rather than starting from a list price and discounting members *down*. That's mathematically equivalent to a 20% member discount, just anchored from the other end, and it protects your margin at whichever price most of your volume probably transacts at.

The calculator defaults to that same mode ("standard hits target margin, non-member pays more"), with a second mode available if you'd rather the more familiar direction (list price hits target, member gets a straight discount off it — margin at the member price will then usually land below target, and Results shows you by exactly how much).

## Why the operator cost is only an estimate

Malaysia's actual SOCSO/EIS calculation is table-based (banded by wage, not a flat percentage) and EPF rounds up to the next ringgit under the Third Schedule — all of which is *already built correctly* in your Overhead & Manpower Calculator. Re-deriving those ~150 lines of banded tables a second time in this file would just create a second place for them to eventually drift out of sync with the original.

Instead, each equipment panel's operator field uses a fast multiplier (≈1.155× basic wage for a citizen/PR, ≈1.04× for a foreign worker) — good enough to price a job, not good enough for payroll. For the exact figure, build just that one operator in Overhead & Manpower Calculator, then type their real Employer Cost into this equipment's own wage field instead of their basic wage. The "Pull from Overhead & Manpower Calculator" button in the Shared Overhead tab is for the business's *general* overhead only (rent, admin, licenses) — it deliberately does not try to map that tool's combined manpower total onto any one machine's operator, since that total could include staff who have nothing to do with this equipment.

## Malaysia law, verified 2026-09-11 (not carried over from memory)

| Figure | Status |
|---|---|
| National minimum wage, RM1,700/month | Confirmed current, nationwide including Sarawak — matches what's already in `overhead-manpower-calculator.js`. |
| EPF: 11% employee, 13%/12% employer (≤/> RM5,000), Third Schedule rounding | Confirmed current — matches the existing calculator exactly. |
| SOCSO/EIS wage ceiling RM6,000 | Confirmed current (effective Oct 2024) — matches the existing calculator's table exactly. |
| **Foreign worker EPF now mandatory at 2% employer** | **New since Oct 2025** — was voluntary before. Not modeled anywhere else on the site yet; the Rental Calculator's foreign-worker checkbox is the first place this shows up. |
| **SST now applies to equipment rental/leasing (industrial/commercial use), 6%** | **New, effective 1 Jan 2026** (reduced from 8% for H2 2025). MSME exemption threshold RM1.5 million/12 months. This is genuinely new territory for this site — none of the F&B tools needed to model this. |

## What changed from your old Excel

Kept, generalized: the ownership/operating split, financing interest handling, mobilization, insurance/NCD-adjacent thinking (simplified to a direct annual premium input rather than replicating the NCD-ratio scaling), member vs non-member structure, security deposit percentages, and — importantly — the revenue-share partners, now supporting any number instead of being hard-coded.

Added: the **wear & tear reserve** you flagged as missing, a proper loan-amortization formula for financing interest (rather than treating a full loan repayment as a cost, which would have double-counted against depreciation), a break-even-days figure, a local market comparison you populate yourself, and support for multiple pieces of equipment as tabs with shared costs split fairly across them.

Not carried over: the exact NCD/sum-insured ratio scaling for insurance (simplified to one annual premium field — the ratio logic is real but adds complexity without changing the pricing math, so it's a candidate to add back later if you want it precisely), and the specific "revert to bucket" / breaker-attachment line items (a breaker or any other attachment is really its own piece of equipment with its own ownership/operating cost — add it as its own equipment tab rather than a sub-line under the excavator it's mounted to).

## Architecture — why it's built this way

Same non-negotiables as every other tool on the site (per `AI_BUILD_BRIEF.md`): vanilla HTML/CSS/JS, no build step, nothing persists, page logic in its own `.js` file, `rzInitialized` guard. Equipment panels use their own `.rc-equipment-panel` class rather than reusing `.menu-block` — this isn't a style preference, it's a fix for a bug you already hit once (see `MARGIN_AUDIT_CHANGE_NOTES.md`'s 2026-09-09 entry): if this page's equipment tabs shared a class name with whatever the tool dock injects, Overhead & Manpower Calculator's own tab-switching logic could reach outside its own dock and hide this page's equipment panels by accident. Every ID on this page is `rc-`-prefixed for the same reason.

The tool dock (pulling Overhead & Manpower Calculator's shared overhead figure) uses the identical fetch-inject-execute mechanism already proven in `interactive-costing-analysis.js` and `margin-audit-calculator.js` — nothing new invented, just the third application of a pattern this site already trusts.

**Nav**: added as the 8th entry in this page's own copy of the Business Analysis dropdown, per `NAV_ORDER_STANDARD.md`'s own rule ("new tool = append to the end"). The other seven pages' copies of the dropdown don't have this entry yet — per `AI_BUILD_BRIEF.md` that's reconciled centrally, the same way Crypto Radar's own addition was handled.

---

## Settings reference

The full version — every default, current value, and a blank column for your own number — is in the companion `rental-calculator-settings-reference.xlsx`. Condensed here for anyone who'd rather not open Excel:

| Setting | Current value | Where to change it |
|---|---|---|
| Monthly→daily market-rate conversion | ÷ 26 days | `MARKET_RATE_DAYS_PER_MONTH`, `rental-calculator.js` |
| SST rate on rental/leasing | 6% (toggle off by default) | `rc-sst-pct` default, `rental-calculator.html` |
| Default revenue-share partners | 5% / 10% / 15% | `seedDefaultPartners()`, `rental-calculator.js` |
| Default member discount | 20% | `rc-member-discount` default, `rental-calculator.html` |
| Default member-pricing mode | Standard hits target, non-member pays more | `rc-mode-protect` checked by default |
| Default security deposits | 20% member / 30% non-member | `rc-deposit-member-pct` / `rc-deposit-nonmember-pct` defaults |
| Cost-structure guide ratios per category | See `GUIDE_RATIOS` | `GUIDE_RATIOS`, `rental-calculator.js` |
| New-equipment starting values | See the xlsx | Inside `createEquipmentPanel()`'s template, `rental-calculator.js` |
| Ad themes | Site Teal / Construction Amber / Steel Graphite / Safety Orange / Forest Green / Site Crimson | `AD_THEMES`, `rental-calculator.js` |

*(2026-09-20 cleanup: removed two rows for `ESTIMATED_STATUTORY_MULTIPLIER_CITIZEN`/`_FOREIGN` and one for `MARKET_RATE_HOURS_PER_DAY` — none of these three constants exist in the code any more. The multiplier rows were already stale from the 2026-09-12 operator-cost rewrite and should have been removed then; caught while updating this table for an unrelated reason, so fixing now rather than leaving them to mislead the next person who reads this file.)*

## Jargon index

Also built into the page itself as a collapsible "Jargon index" section (so it travels with the tool, not just this doc) — same content, condensed here:

| Term | Plain-English meaning |
|---|---|
| Ownership cost | Fixed cost of owning the machine — depreciation, financing interest, insurance, registration. Recovered regardless of usage. |
| Operating cost | Variable cost of running the machine — fuel, maintenance, wear & tear. Scales with hours, not calendar time. |
| Wear & tear reserve | Per-hour set-aside for parts that wear faster than the whole machine — undercarriage, hoses, teeth, tires. |
| Wet hire / Dry hire | Wet hire includes an operator; dry hire is machine-only. |
| Utilization | Share of available days a machine is actually rented out — the single biggest lever on cost per day. |
| Break-even rental days | Days/month needed at your standard price before fixed costs are covered. Days beyond that are largely pure profit. |
| Revenue-share partner | Anyone owed a % of a job's revenue — a referring branch, holding company, or the actual machine owner if sub-leasing. |
| Gross-up | Dividing by (1 − rate) instead of multiplying by rate, so a cut comes out of the price without eating your own target. |
| Standard / Member price | The price built to hit target margin after every partner and SST are paid. |
| EPF / SOCSO / EIS | Malaysia's retirement fund, workplace injury/invalidity, and employment insurance schemes — see the law table above for current rates. |

---

## Deploy checklist

- [ ] `rental-calculator.html` and `rental-calculator.js` → add to your GitHub Pages repo root alongside the existing files.
- [ ] `komatsu-pc130-transparent.png` and `jcb-backhoe-transparent.png` (2026-09-22) → only needed if you want them pre-loaded somewhere; the Ad Creator's photo upload reads a file picked in-browser each time, it doesn't fetch these from the repo automatically.
- [ ] No changes needed to any other file to make this page work on its own — `costing-sync.js`'s `RZ_TOOLS` registry already lists `overhead-manpower-calculator`, which is the only tool this page pulls from.
- [ ] **Central nav sync (not done here, per `AI_BUILD_BRIEF.md`)**: the other 7 pages' Business Analysis dropdowns don't yet list Rental Calculator. Add `<li><a href="rental-calculator.html">Rental Calculator</a></li>` as the 8th item on each, and update `NAV_ORDER_STANDARD.md`'s canonical list to match.
- [ ] Verify `overhead-manpower-calculator.html` and `.js` are already deployed and unchanged — the tool dock fetches them live.
- [ ] `favicon.ico` / `site.webmanifest` etc. are assumed already present site-wide; nothing new needed for this page specifically.
- [ ] No Cloudflare Worker needed for this tool — it makes no external API calls (no Gemini, nothing to proxy), so there's no key to protect and nothing to deploy beyond the two static files. (If AI-generated ad art is ever added, this line changes — see the 2026-09-20 entry's notes on that.)

## Testing done, and what still needs a real browser

**2026-09-22 additions:** `node --check` clean; every `data-print-section` checkbox cross-checked programmatically against a real tagged element (11/11 matched both ways, zero orphans); ID/tag-balance checks re-run clean. The background removal on the two sample photos was verified visually (composited each cutout over a solid color to check for holes or leftover fringing) and iterated three times after the first two attempts either left large disconnected patches or, in one pass, ate through the machine's own panels -- reverted that one immediately rather than shipping it. **Not yet done, no headless browser available this session:** actually clicking the new photo upload and Print Summary controls in a real browser -- the logic was reviewed by hand and the DOM wiring is exact, but neither a file-input pick, a canvas redraw with a real image, nor an actual print-dialog round-trip was exercised live. Worth 5 minutes in a real browser before this goes in front of a customer. Older items from the original build (adding a second/third equipment tab, the Overhead & Manpower dock, quick-nav on a phone) are still outstanding for the same reason -- no browser here.
