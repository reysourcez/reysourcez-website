# Business Analysis nav — standard order

**For the AI building standalone pages (per AI_BUILD_BRIEF.md).** Paste this section into AI_BUILD_BRIEF.md, or keep it alongside it — either way, treat it as a hard rule, not a suggestion.

**2026-09-06 update — name change:** item 5's nav text is now **"Margin Analysis"**, not "Margin Audit." The file is still `margin-audit-calculator.html` (not renamed) — only the label a visitor sees, in the nav and on the page itself (title + heading), changed. If you're touching that page for any other reason, make sure any nav copy you write or copy-paste uses the new name, not the old one from an earlier version of this doc.

**2026-09-07 update — seventh tool added:** `crypto-radar.html` is live and correctly appended itself at position 7 (per the "new tool = append to the end" rule below) — this doc and `AI_BUILD_BRIEF.md` are now updated to match, and all seven other pages have been synced to include it. Note it's a genuinely different kind of tool (crypto market analysis, not F&B costing) sharing the same "Business Analysis" dropdown as everything else — that label may be worth revisiting at some point, flagging rather than deciding here.

**2026-09-08 update — eighth tool added, three more announced but not built yet:** `rental-calculator.html` is live at position 8, synced everywhere. Three more tools have been named but don't exist as pages yet: **Market Radar** → `market-radar.html` (9), **Cost Structure Checker** → `cost-structure-checker.html` (10), **QR Listing Creator** → `qr-listing-creator.html` (11) — lowercase, hyphenated, same convention as every existing page (`menu-calculator.html`, `crypto-radar.html`, etc.), not CamelCase or underscores. Same rule as before applied to Rental Calculator while it didn't exist: do NOT add these to any page's live nav until each one is actually built — no page should ever link to a page that doesn't exist. This paragraph just reserves the order so whoever builds any of them knows exactly where it slots in without asking. As each one goes live, move it out of this paragraph and into the numbered list below, in this same order, per the "append to the end" rule.

## The problem this fixes

Right now the "Business Analysis" dropdown doesn't match across pages — some list Margin Audit, some don't, and where it does appear the order differs page to page. The dropdown must be byte-for-byte identical everywhere except for which single item carries `aria-current="page"`.

## The standard order

Every page's `.nav-dropdown-menu` must list all eight tools in exactly this order:

1. Menu Calculator
2. Overhead & Manpower
3. Printing Calculator
4. Costing Analysis
5. Margin Analysis
6. Food Worth
7. Crypto Radar
8. Rental Calculator

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
</ul>
```

## Rules

- **Every page carries all seven links**, including the page's own link to itself (with `aria-current="page"` added).
- **New tool = append to the end** of this list (position 8, 9, ...) unless you're told a specific position. Don't insert a new tool in the middle without being told where.
- **Don't touch the footer** for this. The site's footer link grid (`.footer-grid` and everything inside it) has been `display: none` in `styles.css` for a while now, so it's not visible on any page regardless of what HTML is in it — there's nothing to keep in sync there. Leave the footer as-is; only `.nav-dropdown-menu` matters here.
- If a page's own nav currently doesn't match this list at all (wrong order, missing items, extra `aria-current`), replace the whole `<ul class="nav-dropdown-menu">...</ul>` block with the canonical one above rather than patching individual lines — less room for a partial/inconsistent fix.

## Pages this currently applies to

`menu-calculator.html`, `overhead-manpower-calculator.html`, `printing-calculator.html`, `interactive-costing-analysis.html`, `margin-audit-calculator.html`, `food-worth-calculator.html`, `crypto-radar.html`, `rental-calculator.html`, plus `index.html`, `about.html`, `services.html`, `contact.html` if those also carry this dropdown.
