# Building or updating a page for Reysourcez Enterprise — quick brief

Give this file to whichever AI is building or updating a page, along with:
- `styles.css` (always — the current version, not an old copy)
- **One current, centrally-maintained page** as a structural example — `interactive-costing-analysis.html` is a solid all-round reference (shows the current header/footer exactly, tooltips, result cards, cross-tab sync). Don't use `index.html` — it's a marketing page and doesn't show any of the conventions that actually matter here.
- If updating a page that already exists (including Printing Calculator or Food Worth), use its own **current** HTML (+ its `.js` file, if separate) as the starting point — not an old copy, not from memory.

## Header nav — copy this block verbatim, don't rebuild it
This is the single most common source of drift between pages. Every page's nav puts the 7 tools inside one dropdown, not as flat top-level links:

```html
<li class="nav-dropdown">
  <button type="button" class="nav-dropdown-toggle" aria-expanded="false" aria-haspopup="true">Business Analysis <i class="nav-dropdown-caret" aria-hidden="true"></i></button>
  <ul class="nav-dropdown-menu">
    <li><a href="menu-calculator.html">Menu Calculator</a></li>
    <li><a href="overhead-manpower-calculator.html">Overhead &amp; Manpower</a></li>
    <li><a href="printing-calculator.html">Printing Calculator</a></li>
    <li><a href="interactive-costing-analysis.html">Costing Analysis</a></li>
    <li><a href="margin-audit-calculator.html">Margin Analysis</a></li>
    <li><a href="food-worth-calculator.html">Food Worth</a></li>
    <li><a href="crypto-radar.html">Crypto Radar</a></li>
  </ul>
</li>
```

On whichever page IS one of those seven, add `aria-current="page"` to that one link, and add `active` to the toggle button's class list — copy the exact pattern from a current tool page rather than guessing at it.

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

## UI/UX standards (2026-09-08)

- **Save as PDF button**: top right of the page/results area, `class="btn btn-secondary"`, wired to `window.print()`. This is already the pattern on every existing page (menu-calculator, overhead-manpower, printing, costing-analysis, margin-audit, food-worth, rental-calculator all do this identically) — don't reach for a PDF-generation library, the browser's own print dialog is the established mechanism.
- **Floating quick-jump button(s)**: bottom right, one per major section a long page needs to jump between (Margin Audit's Analysis/Calculation two-button split is the reference). A page with three or more sections worth jumping between gets a third/fourth button — the pattern scales by adding buttons, not by redesigning it.
- **Theme/visual style**: already standardized via `styles.css`'s shared tokens (see Non-negotiables above) — not a per-page decision, nothing new to add here.
- **Tooltips**: `.tooltip-icon`'s CSS now wraps long text automatically (`white-space: normal`, `max-width: 240px`, fixed 2026-09-08 — it used to be `nowrap` with no max-width, which is why long ones ran off the page edge). Write tooltip text at whatever natural length it needs; don't manually insert line breaks or artificially shorten one to fit on one line. If a tooltip still looks cut off after this fix, flag it as a bug rather than routing around it by shortening the text.
- **One form/panel open at a time**: if clicking a button reveals a form, panel, or tab's content, clicking a *different* button that reveals its own should close whatever was open before — never two at once. See menu-calculator.js's `setCostTab`/`setManualSub` for the reference pattern: every click hides all sibling panels and shows only the one just selected. Applies to cost-mode tabs, an "add row" form, or anything similarly toggled — if you're building more than one independently-togglable panel, make opening one close the others rather than letting them stack.

## The cross-tool sync system (`costing-sync.js`)
Only include `<script src="costing-sync.js?v=X" defer></script>` (current version — check any live tool page) and `<div id="rz-switcher" class="no-print" hidden></div>` if the page is actually meant to **exchange cost data** with the other tools (broadcast a cost/price, or listen for one). If it's standalone, leave both out entirely — a switcher button that does nothing is worse than no button.

If it should sync: say so explicitly in a comment (e.g. "this should broadcast cost-per-unit and price, same shape as Menu Portion Creator"). The actual registration lives in `costing-sync.js`'s shared `RZ_TOOLS` object — that's a shared file touching every tool, so leave the registration itself for the compile pass rather than editing it from a single-page session.

## Don't worry about (all reconciled centrally, every time)
- Whether the nav / footer link list includes every page on the site yet
- Cache-busting version numbers (`?v=N`) on shared files like `styles.css` or `costing-sync.js`
- Registering the page in `costing-sync.js`

## What tends to go right (keep doing it)
- Reusing existing classes and design tokens instead of new ones
- Matching the gross-up math pattern for marketplace commission fees (`target ÷ (1 − commission share)`) — but NOT blending food SST into that same division. Commission is a real deduction the platform takes, so grossing up recovers the target correctly. Food SST is money collected from the customer and remitted straight to JKDM — it's never the restaurant's own money to begin with, so it belongs as a straight multiplicative add-on (`× (1 + sst%)`) applied on top, not folded into the same protective divisor as commission. menu-calculator.js's `updateMenuBlockSummary` is the reference implementation as of the 2026-09-08 fix — copy that pattern, not an earlier version of this file that combined the two.
- Explaining non-obvious choices in comments — the "why", not just the "what"
