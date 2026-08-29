# Building a new page for Reysourcez Enterprise — quick brief

Give this file to whichever AI is building the page, along with:
- `styles.css` (always)
- **One** existing page closest to what you're building, as a structural example:
  - Another costing/pricing calculator (materials → per-unit cost → quoted price) → `menu-calculator.html`
  - A standalone single-purpose tool (not meant to share data with the others) → `food-worth-calculator.html`
- If you're asking for changes to a page that already exists (not a brand new one), give its **current** HTML (+ its `.js` file, if it has a separate one) instead of an old copy — edit forward from what's actually live, not from memory.

## Non-negotiables
- Vanilla HTML/CSS/JS. No build step, no frameworks, no npm packages.
- Nothing persists — no localStorage, no server, no database. Anything typed in disappears when the tab closes. If the tool needs an API key (like Food Worth's Gemini key), it's the *visitor's own* key, kept in-memory/sessionStorage only, sent straight to the third party — never routed through Reysourcez.
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
Only include `<script src="costing-sync.js?v=1" defer></script>` and `<div id="rz-switcher" class="no-print" hidden></div>` if the page is actually meant to **exchange cost data** with the other tools (broadcast a cost/price, or listen for one). If it's standalone, leave both out entirely — a switcher button that does nothing is worse than no button.

If it should sync: say so explicitly in a comment (e.g. "this should broadcast cost-per-unit and price, same shape as Menu Portion Creator"). The actual registration lives in `costing-sync.js`'s shared `RZ_TOOLS` object — that's a shared file touching every tool, so leave the registration itself for the compile pass rather than editing it from a single-page session.

## Don't worry about (all reconciled centrally, every time)
- Whether the nav / footer link list includes every page on the site yet
- Cache-busting version numbers (`?v=N`) on shared files like `styles.css` or `costing-sync.js`
- Registering the page in `costing-sync.js`

## What tends to go right (keep doing it)
- Reusing existing classes and design tokens instead of new ones
- Matching the gross-up math pattern for marketplace/SST fees (`target ÷ (1 − combined rate)`, not a naive markup)
- Explaining non-obvious choices in comments — the "why", not just the "what"
