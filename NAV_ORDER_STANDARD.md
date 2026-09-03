# Business Analysis nav — standard order

**For the AI building standalone pages (per AI_BUILD_BRIEF.md).** Paste this section into AI_BUILD_BRIEF.md, or keep it alongside it — either way, treat it as a hard rule, not a suggestion.

## The problem this fixes

Right now the "Business Analysis" dropdown doesn't match across pages — some list Margin Audit, some don't, and where it does appear the order differs page to page. The dropdown must be byte-for-byte identical everywhere except for which single item carries `aria-current="page"`.

## The standard order

Every page's `.nav-dropdown-menu` must list all six tools in exactly this order:

1. Menu Calculator
2. Overhead & Manpower
3. Printing Calculator
4. Costing Analysis
5. Margin Audit
6. Food Worth

## Canonical markup

Copy this exactly. On whichever page you're building, add `aria-current="page"` to that one page's own `<a>` — no other page gets it.

```html
<ul class="nav-dropdown-menu">
  <li><a href="menu-calculator.html">Menu Calculator</a></li>
  <li><a href="overhead-manpower-calculator.html">Overhead &amp; Manpower</a></li>
  <li><a href="printing-calculator.html">Printing Calculator</a></li>
  <li><a href="interactive-costing-analysis.html">Costing Analysis</a></li>
  <li><a href="margin-audit-calculator.html">Margin Audit</a></li>
  <li><a href="food-worth-calculator.html">Food Worth</a></li>
</ul>
```

## Rules

- **Every page carries all six links**, including the page's own link to itself (with `aria-current="page"` added).
- **New tool = append to the end** of this list (position 7, 8, ...) unless you're told a specific position. Don't insert a new tool in the middle without being told where.
- **Don't touch the footer** for this. The site's footer link grid (`.footer-grid` and everything inside it) has been `display: none` in `styles.css` for a while now, so it's not visible on any page regardless of what HTML is in it — there's nothing to keep in sync there. Leave the footer as-is; only `.nav-dropdown-menu` matters here.
- If a page's own nav currently doesn't match this list at all (wrong order, missing items, extra `aria-current`), replace the whole `<ul class="nav-dropdown-menu">...</ul>` block with the canonical one above rather than patching individual lines — less room for a partial/inconsistent fix.

## Pages this currently applies to

`menu-calculator.html`, `overhead-manpower-calculator.html`, `printing-calculator.html`, `interactive-costing-analysis.html`, `margin-audit-calculator.html`, `food-worth-calculator.html`, plus `index.html`, `about.html`, `services.html`, `contact.html` if those also carry this dropdown.
