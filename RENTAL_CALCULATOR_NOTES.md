# Rental Calculator — concept, formulas, and deploy notes

New tool, built 2026-09-11, for renting out equipment (JCB backhoe loaders, excavators, and similar machinery) — the 8th tool in the Business Analysis dropdown, alongside the existing seven. Named exactly "Rental Calculator" per instruction, so it's referenced consistently across the team.

This doc assumes no prior context. If you only read one section, read "Cost structure, in plain terms" and "What changed from your old Excel."

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
| Quick operator statutory multiplier — citizen/PR | ×1.155 | `ESTIMATED_STATUTORY_MULTIPLIER_CITIZEN`, `rental-calculator.js` |
| Quick operator statutory multiplier — foreign worker | ×1.04 | `ESTIMATED_STATUTORY_MULTIPLIER_FOREIGN`, `rental-calculator.js` |
| Hourly→daily market-rate conversion | 8 hours = 1 day | `MARKET_RATE_HOURS_PER_DAY`, `rental-calculator.js` |
| Monthly→daily market-rate conversion | ÷ 26 days | `MARKET_RATE_DAYS_PER_MONTH`, `rental-calculator.js` |
| SST rate on rental/leasing | 6% (toggle off by default) | `rc-sst-pct` default, `rental-calculator.html` |
| Default revenue-share partners | 5% / 10% / 15% | `seedDefaultPartners()`, `rental-calculator.js` |
| Default member discount | 20% | `rc-member-discount` default, `rental-calculator.html` |
| Default member-pricing mode | Standard hits target, non-member pays more | `rc-mode-protect` checked by default |
| Default security deposits | 20% member / 30% non-member | `rc-deposit-member-pct` / `rc-deposit-nonmember-pct` defaults |
| Cost-structure guide ratios per category | See `GUIDE_RATIOS` | `GUIDE_RATIOS`, `rental-calculator.js` |
| New-equipment starting values | See the xlsx | Inside `createEquipmentPanel()`'s template, `rental-calculator.js` |

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
- [ ] No changes needed to any other file to make this page work on its own — `costing-sync.js`'s `RZ_TOOLS` registry already lists `overhead-manpower-calculator`, which is the only tool this page pulls from.
- [ ] **Central nav sync (not done here, per `AI_BUILD_BRIEF.md`)**: the other 7 pages' Business Analysis dropdowns don't yet list Rental Calculator. Add `<li><a href="rental-calculator.html">Rental Calculator</a></li>` as the 8th item on each, and update `NAV_ORDER_STANDARD.md`'s canonical list to match.
- [ ] Verify `overhead-manpower-calculator.html` and `.js` are already deployed and unchanged — the tool dock fetches them live.
- [ ] `favicon.ico` / `site.webmanifest` etc. are assumed already present site-wide; nothing new needed for this page specifically.
- [ ] No Cloudflare Worker needed for this tool — it makes no external API calls (no Gemini, nothing to proxy), so there's no key to protect and nothing to deploy beyond the two static files.

## Testing done, and what still needs a real browser

Given I can't render a browser here: `node --check` clean on the JS; every `getElementById` call in the JS cross-checked against a real `id="..."` in the HTML (zero mismatches); zero ID collisions with anything the tool dock injects from `overhead-manpower-calculator.html`; HTML tag balance checked across every structural tag. Worked through the loan-amortization formula, the break-even-days formula, and the member-pricing gross-up by hand against your own Excel's numbers to confirm the math lines up. Not yet done, and worth doing before relying on this for a real quote: actually clicking through it — adding a second and third equipment tab, opening the "Pull from Overhead & Manpower Calculator" dock and confirming it doesn't disturb the equipment tabs underneath it, and checking the floating quick-nav buttons on an actual phone screen.
