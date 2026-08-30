# Building or updating a page for Reysourcez Enterprise — quick brief

Give this file to whichever AI is building or updating a page, along with:
- `styles.css` (always — the current version, not an old copy)
- **One current, centrally-maintained page** as a structural example — `interactive-costing-analysis.html` is a solid all-round reference (shows the current header/footer exactly, tooltips, result cards, cross-tab sync). Don't use `index.html` — it's a marketing page and doesn't show any of the conventions that actually matter here.
- If updating a page that already exists (including Printing Calculator or Food Worth), use its own **current** HTML (+ its `.js` file, if separate) as the starting point — not an old copy, not from memory.

## Header nav — copy this block verbatim, don't rebuild it
This is the single most common source of drift between pages. Every page's nav puts the 5 tools inside one dropdown, not as flat top-level links:

```html
<li class="nav-dropdown">
  <button type="button" class="nav-dropdown-toggle" aria-expanded="false" aria-haspopup="true">Business Analysis <i class="nav-dropdown-caret" aria-hidden="true"></i></button>
  <ul class="nav-dropdown-menu">
    <li><a href="menu-calculator.html">Menu Calculator</a></li>
    <li><a href="overhead-manpower-calculator.html">Overhead &amp; Manpower</a></li>
    <li><a href="printing-calculator.html">Printing Calculator</a></li>
    <li><a href="interactive-costing-analysis.html">Costing Analysis</a></li>
    <li><a href="food-worth-calculator.html">Food Worth</a></li>
  </ul>
</li>
```

On whichever page IS one of those five, add `aria-current="page"` to that one link, and add `active` to the toggle button's class list — copy the exact pattern from a current tool page rather than guessing at it.

Also required, loaded alongside the page's own script(s):
```html
<script src="nav-dropdown.js?v=1" defer></script>
```
Without this file, the dropdown still *looks* right but only opens for mouse hover — no click/tap/keyboard support. It's what makes the menu actually usable on mobile.

If a page's nav doesn't match this exactly, that mismatch is what causes the nav to visibly change every time someone moves between that page and any other — worth checking any time a page feels "off" from the rest of the site.

## Non-negotiables
- Vanilla HTML/CSS/JS. No build step, no frameworks, no npm packages.
- Nothing persists — no localStorage, no server, no database. Anything typed in disappears when the tab closes. If the tool needs an API key (like Food Worth's Gemini proxy), route it through a server-side proxy holding the real key as a secret — never a key embedded in the page itself, and never one shipped to every visitor.
- Reuse existing classes and tokens from `styles.css` (`.btn`, `.calc-panel`, `.calc-intro`, `.result-card`, `.structure-bar`, `.tooltip-icon`, `--accent`, etc.) instead of inventing new ones. If something feels missing, it's more likely already there under a different name than actually absent — but flag it in a comment either way so it can be checked centrally.
- Keep page logic in its own `page-name.js` file, loaded with `<script src="page-name.js?v=1" defer></script>` — not an inline `<script>` in the HTML. Matches every other page and is far easier to slot into the site afterward.
- Every `init()` should guard against double-firing:
  ```js
  let rzInitialized = false;
  function init() {
    if (rzInitialized) return;
    rzInitialized = true;
    // ...
  }
  document.addEventListener('DOMContentLoaded', init);
  ```

## The cross-tool sync system (`costing-sync.js`)
Only include `<script src="costing-sync.js?v=X" defer></script>` (current version — check any live tool page) and `<div id="rz-switcher" class="no-print" hidden></div>` if the page is actually meant to **exchange cost data** with the other tools (broadcast a cost/price, or listen for one). If it's standalone, leave both out entirely — a switcher button that does nothing is worse than no button.

If it should sync: say so explicitly in a comment (e.g. "this should broadcast cost-per-unit and price, same shape as Menu Portion Creator"). The actual registration lives in `costing-sync.js`'s shared `RZ_TOOLS` object — that's a shared file touching every tool, so leave the registration itself for the compile pass rather than editing it from a single-page session.

## Don't worry about (all reconciled centrally, every time)
- Whether the nav / footer link list includes every page on the site yet
- Cache-busting version numbers (`?v=N`) on shared files like `styles.css` or `costing-sync.js`
- Registering the page in `costing-sync.js`

## What tends to go right (keep doing it)
- Reusing existing classes and design tokens instead of new ones
- Matching the gross-up math pattern for marketplace/SST fees (`target ÷ (1 − combined rate)`, not a naive markup)
- Explaining non-obvious choices in comments — the "why", not just the "what"
