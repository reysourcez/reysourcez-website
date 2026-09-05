# Margin Audit Calculator — change notes

## 2026-09-05 — Split into Margin Analysis (top) and Margin Calculation (bottom, tabbed)

**The problem this fixes.** The page had two different places that both ended up managing the same dish list — a "Your menu, at today's prices" box up top with its own native AI-estimate/manual entry form, and a "Pull from Menu Portion Creator" button near the footer that opened a completely different tool in a dock and ALSO created dishes into that same top box. Editing a dish meant knowing which of the two mechanisms had created it. Overhead, utilities, and manpower had a similar split: native fields in one box, plus a "Pull from Overhead & Manpower" button elsewhere doing the same job through a different UI.

**The fix — two sections, one job each.**

- **Margin Analysis** (top, right under the wizard): pure output. True cost breakdown, what your menu is earning, per-item breakdown, the popularity/margin quadrant, cost-structure pies, and insights. Nothing here is a cost input — "Your target margin %" and the guide-venue dropdown only change how results are *compared* or *labeled*, never the math itself.
- **Margin Calculation** (near the footer): every actual cost input, now including the dish list that used to live in its own box up top. Split into four tabs — **Menu**, **Fixed Overhead**, **Variable Overhead**, **Manpower** — plus a **Reset all** button. Each tab is an independent show/hide toggle, not a switcher: opening Fixed Overhead doesn't close Menu, and closing a tab never clears what's inside it — same idea as a native `<details>` element, just styled as pill buttons to match the rest of the site. A shared "Operating days / month" field sits above the four tabs since every one of them depends on it (dish volume/month, utility usage/month, and the per-portion overhead/manpower split all read from the same number).

Printing Calculator has been removed as a pull-from source on this page specifically — printing isn't a food cost, so it had no business in a *food* margin tool. `printing-calculator.html` itself is completely untouched and still reachable directly and from Interactive Costing Analysis. If a services-margin sibling tool gets built later (see KIV list below), it can offer its own pull-from-Printing-Calculator button.

**Reset All vs. closing a tab — these are deliberately different actions.** Clicking a tab button toggles that tab's visibility only; nothing is ever lost by opening or closing a tab. **Reset all**, at the end of the tab row, is the only control that clears data, and it asks for confirmation first because it can't be undone — it puts every field in Margin Calculation back to its starting default (one empty dish, default rent/manpower, the four default electricity items, default water/gas settings), the same state as a fresh page load. It does not touch the wizard answers, the target margin, or the guide-venue dropdown, since those live in Margin Analysis, not Margin Calculation.

**Floating nav is now two buttons, not one.** With results at the top of the page and inputs at the bottom, a single "back to top" button no longer covered the actual need — now there's "↑ Margin Analysis" and "↑ Margin Calculation", both visible as soon as the wizard is done, not just while the tool dock happens to be open.

**Utilities are now three separate boxed cards, not one shared block.** Electricity, Water, and Gas each get their own bordered card with a colored top edge, inside the Variable Overhead tab — colors are reused from the site's existing tool-dock theme tokens (teal for electricity, blue for water, rust for gas), not new palette entries.

**Nothing about the underlying math changed.** True cost, contribution margin, the quadrant classification, the structure-comparison pies — every formula is byte-for-byte what it was before. This round was entirely about where you enter numbers and how it's organized on the page, not what gets calculated from them.

**Testing done, given I can't render a browser here:** `node --check` on the full JS file (clean); HTML tag balance verified (`<section>`, `<div>`, `<table>`, `<thead>`, `<tbody>`, `<tr>` all matched open/close counts); every DOM id referenced by the JS confirmed present in the HTML; grepped for leftover references to every element this round removes (`tool-dock-hide-btn`, the old single `rz-back-to-top`, `updateConnectorActiveState`, the old `.connector-btn` classes, any printing-calculator *button* wiring) — none found outside of explanatory comments. None of this replaces actually clicking through it on a phone, especially: tapping each calc-tab open/closed a few times in a row, confirming Reset All's confirm-dialog wording reads right, and pulling from Menu Portion Creator / Overhead & Manpower to check both the dish sync and the "which tabs auto-open" behavior.

**KIV, not built — services-margin sibling tool.** Printing Calculator (and any other non-food service costing) would get its own margin-audit-style page later, reusing this same Margin Analysis / Margin Calculation split and the same tool-dock mechanism, just pulling from Printing Calculator instead of Menu Calculator. Not started.

**KIV, not built — direct link between Fixed Overhead and Variable Overhead's shared "operating days".** Right now both tabs (plus Menu) all read the one shared `ma-operating-days` field correctly already, so there's no bug here — just noting that if a future request wants operating days to be per-tab instead of shared, that's a bigger structural change than it looks (utilities math, dish monthly-volume math, and the per-portion overhead/manpower split all assume one shared number).

## Jargon index

| Term | Plain-English meaning |
|---|---|
| Margin Analysis | The top section of the page. Everything in it is a *result* — nothing here is typed in to drive a calculation. |
| Margin Calculation | The section near the footer where you actually enter numbers, organized into four tabs. |
| Calc-tab | One of the four buttons (Menu / Fixed Overhead / Variable Overhead / Manpower) in Margin Calculation. Each independently shows or hides its own panel — it's a toggle, not a switch between mutually-exclusive views. |
| Fixed overhead | Costs that stay roughly the same no matter how much you sell — rent, licenses, and similar. |
| Variable overhead | This tool's utilities — electricity, water, gas — which change with usage. |
| True cost | Ingredient cost + a fair per-portion share of overhead (fixed + utilities) + a fair per-portion share of manpower. The two "fair share" numbers are the same for every dish; only the ingredient cost varies dish to dish. |
| Contribution margin (CM) | Price charged minus true cost, per portion — what's actually left over per sale once every real cost is counted. |
| Quadrant (Star / Plowhorse / Puzzle / Dog) | The standard menu-engineering classification: popular-and-profitable, popular-but-thin-margin, profitable-but-rarely-ordered, or neither. Popularity is volume-weighted so a high margin *percentage* on a low-volume item doesn't get mistaken for a Star. |
| Tool dock | The panel that loads another tool's real page (Menu Portion Creator or Overhead & Manpower Calculator) directly into this page, so you can use that tool's own interface without leaving this one. |
| Pull from / sync | Using the tool dock to bring a number computed in another tool (a dish's cost, or overhead/manpower totals) into this page automatically, instead of retyping it. |
| Reset all | The one destructive control in Margin Calculation — clears every dish and puts overhead/utilities/manpower back to their starting defaults. Confirms before doing it, since it can't be undone. |
| Cost source (AI estimate / manual) | Per dish: either describe it (or snap a photo) and let Gemini estimate the ingredient cost, or type a number you already know. |
| Guide ratio | A rough, editable benchmark ingredient/overhead/manpower/margin split for a given venue type (home-based, stall, truck, store) — comparison only, never feeds the math. |

## Settings reference

| Setting | Current value | Where to change it |
|---|---|---|
| Default rent/fixed overhead on a fresh page (and after Reset all) | RM900/month | `RENT_DEFAULT`, `margin-audit-calculator.js` |
| Default manpower on a fresh page (and after Reset all) | RM1,200/month | `MANPOWER_DEFAULT`, `margin-audit-calculator.js` |
| Default operating days/month | 26 | `OPERATING_DAYS_DEFAULT`, `margin-audit-calculator.js` |
| Default electricity equipment list | Rice cooker, Exhaust fan, Fridge, Lighting (with typical watts/hours) | `ELECTRICITY_DEFAULTS`, `margin-audit-calculator.js` |
| Electricity rate | RM0.28/kWh (Sarawak Energy stated average) | `ELECTRICITY_RATE_DEFAULT`, `margin-audit-calculator.js` |
| Default water usage on a fresh page | 500 L/day | `WATER_LITERS_DEFAULT`, `margin-audit-calculator.js` |
| Water tariff (Sarawak W3 commercial) | RM22.00 minimum, RM0.97/1,000L up to 25,000L, RM1.06 beyond | `WATER_TARIFF`, `margin-audit-calculator.js` |
| Gas cylinder size | 14 kg | `GAS_CYLINDER_KG`, `margin-audit-calculator.js` |
| Gas subsidised threshold | 42 kg (three cylinders) | `GAS_SUBSIDISED_THRESHOLD_KG`, `margin-audit-calculator.js` |
| Gas prices per 14 kg (household / commercial) | RM26.60 / RM70.00 | `GAS_PRICE_HOUSEHOLD_DEFAULT` / `GAS_PRICE_COMMERCIAL_DEFAULT`, `margin-audit-calculator.js` |
| Menu-engineering popularity threshold | 70% of an even/fair share across all items | `computeQuadrant()`, `margin-audit-calculator.js` |
| Guide ratios per venue type | See `GUIDE_RATIOS` | `GUIDE_RATIOS`, `margin-audit-calculator.js` |
| Which tab opens by default | Menu (open); Fixed Overhead / Variable Overhead / Manpower (closed) | `setCalcTabOpen(...)` calls in `init()`, `margin-audit-calculator.js` |
| Which external tools are offered as "Pull from" | Menu Portion Creator, Overhead & Manpower Calculator (Printing Calculator intentionally excluded) | `TOOL_DOCK_CONFIG`, `margin-audit-calculator.js` |
| Utility box accent colors (Electricity / Water / Gas) | Teal / blue / rust (reused from existing site tokens, no new colors added) | `.ma-util-elec` / `.ma-util-water` / `.ma-util-gas`, `margin-audit-calculator.html` `<style>` block |

## Deploy checklist

- [ ] `margin-audit-calculator.html` and `margin-audit-calculator.js` → push to GitHub Pages as usual. Both are full-file replacements this round, not patches.
- [ ] No Worker changes — `margin-audit-proxy-worker.js` is untouched, nothing here touched the Gemini contract.
- [ ] Confirm `costing-sync.js` and `nav-dropdown.js` are already deployed (this page depends on both, unchanged from before).
