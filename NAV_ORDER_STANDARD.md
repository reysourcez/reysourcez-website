# Business Analysis nav — standard order

**For the AI building standalone pages (per AI_BUILD_BRIEF.md).** Paste this section into AI_BUILD_BRIEF.md, or keep it alongside it — either way, treat it as a hard rule, not a suggestion.

**2026-09-06 update — name change:** item 5's nav text is now **"Margin Analysis"**, not "Margin Audit." The file is still `margin-audit-calculator.html` (not renamed) — only the label a visitor sees, in the nav and on the page itself (title + heading), changed.

**2026-09-07 update — seventh tool added:** `crypto-radar.html` is live and correctly appended itself at position 7 (per the "new tool = append to the end" rule below).

**2026-09-08 update — eighth tool added, three more announced but not built yet:** `rental-calculator.html` went live at position 8. Three more tools were named but didn't exist as pages yet at the time: Market Radar → `market-radar.html`, Cost Structure Checker → `cost-structure-checker.html`, QR Listing Creator → `qr-listing-creator.html` — with positions 9, 10, 11 reserved for them in that order. (Superseded by the entry directly below, now that two of the three are actually built.)

**2026-09-14 update — reconciling a documentation fork; ninth and tenth tools added.** Two copies of this file had drifted apart without either session knowing about the other. This copy (last touched 2026-09-08) already knew about Rental Calculator and had reserved 9/10/11 for Market Radar, Cost Structure Checker, and QR Listing Creator by exactly those names. A second, separate copy — evidently started from an older version of this file that predated Rental Calculator's own entry — was apparently the one on hand when Market Radar was actually built on 2026-09-12: it listed Market Radar as the **eighth** tool, with no mention of Rental Calculator anywhere in it at all. The visible symptom, confirmed directly against both live pages: `rental-calculator.html`'s own nav dropdown does not list Market Radar, and `market-radar.html`'s own nav dropdown does not list Rental Calculator. Each was built correctly against *a* copy of this standard — just not the same one, and not the current one.

This entry resolves it by restoring the order this file already had reserved, matching real build chronology rather than either fork's numbering: **Market Radar** (built 2026-09-12) moves from "reserved, not yet built" into the numbered list at position **9**; **Cost Structure Checker** (built 2026-09-14) at position **10** — its own reserved filename, `cost-structure-checker.html`, is used exactly as already named here. **QR Listing Creator** stays reserved at **11**, still not built.

**Net effect: every live page's `.nav-dropdown-menu` is currently missing at least one real tool** (Rental Calculator is missing from ten pages; Market Radar and Cost Structure Checker are missing from all twelve, this being the first page that lists them). See "Pages this currently applies to" below — this needs the usual central reconciliation pass, just with more ground to cover than any prior addition.

## The problem this fixes

The "Business Analysis" dropdown must be byte-for-byte identical across every page except for which single item carries `aria-current="page"`. Right now it isn't — see the 2026-09-14 entry above for the specific, currently-live way it's out of sync.

## The standard order

Every page's `.nav-dropdown-menu` must list all ten tools in exactly this order:

1. Menu Calculator
2. Overhead & Manpower
3. Printing Calculator
4. Costing Analysis
5. Margin Analysis
6. Food Worth
7. Crypto Radar
8. Rental Calculator
9. Market Radar
10. Cost Structure Checker

**Reserved, not yet built:** QR Listing Creator → `qr-listing-creator.html` (11). Do not add this to any page's live nav until it actually ships — a dropdown should never link to a page that doesn't exist. This line only reserves the slot.

## Canonical markup

Copy this exactly. On whichever page you're building, add `aria-current="page"` to that one page's own `<a>` — no other page gets it.

```html
<ul class="nav-dropdown-menu">
  <li><a href="menu-calculator.html">Menu Calculator</a></li>
  <li><a href="overhead-manpower-calculator.html">Overhead &amp; Manpower</a></li>
  <li><a href="printing-calculator.html">Printing Calculator</a></li>
  <li><a href="interactive-costing-analysis.html">Costing Analysis</a></li>
  <li><a href="margin-audit-calculator.html">Margin Analysis</a></li>
  <li><a href="food-worth-calculator.html">Food Worth</a></li>
  <li><a href="crypto-radar.html">Crypto Radar</a></li>
  <li><a href="rental-calculator.html">Rental Calculator</a></li>
  <li><a href="market-radar.html">Market Radar</a></li>
  <li><a href="cost-structure-checker.html">Cost Structure Checker</a></li>
</ul>
```

## Rules

- **Every page carries all ten links**, including the page's own link to itself (with `aria-current="page"` added).
- **New tool = append to the end** of this list (position 11, 12, ...) unless told a specific position. Don't insert a new tool in the middle without being told where.
- **A named-but-unbuilt tool goes in the "Reserved, not yet built" line, never the numbered list or any live page's nav.** Move it into the numbered list (and into every page, in the central pass) the moment it actually ships — not before.
- **Don't touch the footer** for this. `.footer-grid` and everything inside it has been `display: none` in `styles.css` for a while now, so it isn't visible on any page regardless of its HTML — nothing to keep in sync there.
- If a page's own nav doesn't match this list at all (wrong order, missing items, extra `aria-current`), replace the whole `<ul class="nav-dropdown-menu">...</ul>` block with the canonical one above rather than patching individual lines.
- **If this file is ever found in two disagreeing copies again** (see 2026-09-14 above): don't just prefer whichever copy shows the higher position number — a fork that quietly skipped a tool will look artificially caught-up rather than behind. Instead, check each live tool's own script build-date banner (`console.info('[Tool Name] script build: YYYY-MM-DD...')`, at the top of its own `.js` file) to establish the real build order, then reconcile the numbered list to match that chronology, not either fork's own numbering.

## Pages this currently applies to

`menu-calculator.html`, `overhead-manpower-calculator.html`, `printing-calculator.html`, `interactive-costing-analysis.html`, `margin-audit-calculator.html`, `food-worth-calculator.html`, `crypto-radar.html`, `rental-calculator.html`, `market-radar.html`, `cost-structure-checker.html`, plus `index.html`, `about.html`, `services.html`, `contact.html` if those also carry this dropdown.
