# Site Config & Nav Config — standard (added 2026-09-20)

**For the AI or human updating any page.** Paste this alongside `AI_BUILD_BRIEF.md`, same as `PANEL_TOGGLE_STANDARD.md` and `CROSS_TOOL_IMPORT_STANDARD.md` — treat it as a hard rule for any *new* page, and a retrofit worth doing on every *existing* one. Two new shared files, both written by the session that owns Menu Calculator / Overhead & Manpower / Costing Analysis, both live: `nav-config.js` and `site-config.js`.

## The problem this closes

Two different kinds of thing were duplicated across pages by hand, and both had already caused real friction:

1. **The nav dropdown.** Every page's "Business Analysis" menu was its own hand-written `<li>` list. Adding one new tool meant editing every existing HTML file — or, in practice, asking whichever AI session happened to own each page to do it, one at a time. The person running this whole project flagged this directly as the thing they'd started just doing by hand themselves because asking around was more cumbersome than the fix should be.
2. **Business constants.** Some numbers a vendor might reasonably want to tune are sitting as plain JS constants inside one tool's own file. `GUIDE_RATIOS` (the Ingredients/Overhead/Manpower/Margin benchmark per venue type) turned out to be byte-for-byte duplicated in both Costing Analysis's and Margin Analysis's own files — meaning a future edit to just one of them would have silently made the two tools disagree, the exact shape of bug `CROSS_TOOL_IMPORT_STANDARD.md` already fixed once for `costPerPortion`/`costBufferPct`.

Both get the same fix: **one shared file, one array or object, every page reads from it.**

## Why a plain `.js` global, not a `.json` fetched at runtime

This site has no build step, and at least one existing feature (the tool dock's `fetch()` calls) is already documented elsewhere as broken when a page is opened directly as a local file (`file://`) rather than through a server — `fetch()` of a local resource is blocked by the browser in that case. A plain `<script src="nav-config.js">` / `<script src="site-config.js">` tag has no such restriction; it loads the same way whether the page is opened via a real server or double-clicked from disk. So both new files are ordinary global-defining scripts, not JSON — same shape as `RZ_TOOLS` (from `costing-sync.js`) or `RZ_PANEL_GROUPS` (from `panel-toggle.js`), just applied to nav entries and business numbers instead of tool URLs and panel state.

## `nav-config.js` — the nav dropdown

```js
const RZ_NAV_PAGES = [
  { href: 'menu-calculator.html', label: 'Menu Calculator' },
  // ...one entry per page...
];
```

`rzRenderNavDropdown()` runs on `DOMContentLoaded`, finds every `.nav-dropdown-menu` on the page (normally exactly one), and rebuilds its `<li>` list from `RZ_NAV_PAGES` — including working out `aria-current="page"` from the browser's own URL, so that's no longer a manual step either.

**To add a new page:** add one line to `RZ_NAV_PAGES`. Nothing else, on any page, needs to change. This is the whole point — from here on, a new tool doesn't need every page touched, doesn't need whichever AI session owns each page pinged individually, and doesn't need the person running this project to hand-edit anything either, unless they want to.

**Deliberately does not touch the footer's own "Site" link list.** That block (`.footer-col` under `.footer-links`) is `display: none` site-wide already (`styles.css` section 11) — wiring it up would be effort spent on markup nobody can currently see. Flagged as a KIV below rather than guessed at.

**This doesn't replace `NAV_ORDER_STANDARD.md`** — that doc is still the place for *why* the canonical order is what it is, and which positions are reserved-but-unbuilt. `RZ_NAV_PAGES` is now the literal, executable version of that doc's list; whoever maintains `NAV_ORDER_STANDARD.md` should point it at this file rather than re-stating the list in prose, so the two can't drift apart from each other the same way the two `GUIDE_RATIOS` copies could.

## `site-config.js` — business numbers

```js
const RZ_SITE_CONFIG = {
  siteName: 'Reysourcez Enterprise',
  contactEmail: 'reysourcez.ent@gmail.com',
  tagline: 'We focus on providing catered solutions to your dilemmas.',
  guideRatios: { home: {...}, stall: {...}, truck: {...}, store: {...} },
  theme: 'default',
};
```

**Not** a replacement for a tool's own on-page inputs — Target Food Cost %, Cost Buffer %, per-dish prices, and so on all stay exactly where they are, still editable per item in each tool's own UI. This is only for the smaller set of values that are currently a plain constant someone would otherwise have to open a `.js` file to change.

**How a tool reads it** — guard with a `typeof` check and keep the tool's own literal object as the fallback, so a page that hasn't added the `<script>` tag yet keeps working exactly as before:

```js
const GUIDE_RATIOS = (typeof RZ_SITE_CONFIG !== 'undefined' && RZ_SITE_CONFIG.guideRatios) || {
  home:  { ingredients: 55, overhead: 15, manpower: 15, margin: 15 },
  // ...same literal object as before, unchanged, just now the fallback...
};
```

This is the exact pattern already live in `interactive-costing-analysis.js` — see it there for the worked example.

**What's in it today, and what isn't yet:**
- `guideRatios` — live, read by Costing Analysis. Margin Analysis's own file has the identical object hardcoded; retrofitting it to read from here is the highest-value single change on the retrofit list below, since it's the one place actual drift has already nearly happened.
- `siteName` / `contactEmail` / `tagline` — defined, not read by anything yet. Every page's own `<title>`, `.brand` text, and footer copy still has its own literal copy of these strings, and the footer is hidden site-wide anyway (see above) so there's nothing live to wire up right now. Included so the value exists in one place the moment any page's own script wants to read it instead of hand-typing it again.
- `theme` — defined, not automatically applied yet. See `THEME_GUIDE.md`.
- **Healthy-range thresholds (28–35% food cost, 65–75% CMR, 10–20% NPM) were considered for this file and deliberately left out this round.** Costing Analysis's own flag logic doesn't use those exact numbers as its trigger points — it flags food cost below 25% and above 35%, not below 28%, evidently a deliberate few points of slack below the stated "healthy" floor so a borderline case doesn't get flagged. Collapsing that into one `foodCostPctMin: 28` config value would quietly make the flag more sensitive than it is today — a real behavior change dressed up as a refactor. Worth centralizing properly (as two numbers — the stated range and the separate flag-trigger points, or a conscious decision to fold them into one) but that's a small decision for a person to make, not something to guess silently while "just" moving a number into config.

## Retrofit checklist, for any page that doesn't have this yet

1. Add these two lines as the *first* two script tags on the page, before `costing-sync.js`:
   ```html
   <script src="site-config.js?v=1" defer></script>
   <script src="nav-config.js?v=1" defer></script>
   ```
2. Find the page's `<ul class="nav-dropdown-menu">...</ul>` and delete everything inside it:
   ```html
   <ul class="nav-dropdown-menu"><!-- populated by nav-config.js --></ul>
   ```
3. That's it for nav. A page can even skip step 2 initially and just do step 1 — `nav-config.js` overwrites whatever's inside `.nav-dropdown-menu` on load regardless, so adding the script tag alone already fixes/future-proofs the dropdown even before the old hand-written `<li>`s are cleaned out. Lower-risk than it might look; there's no moment where the nav is broken partway through.
4. For business constants: find the tool's own hardcoded object/constant that matches something in `RZ_SITE_CONFIG` (right now, that's `GUIDE_RATIOS`), and wrap it in the `typeof RZ_SITE_CONFIG !== 'undefined'` pattern shown above, keeping the exact existing values as the fallback object. Bump that file's own script version.
5. Confirm `node --check` (or equivalent) is still clean, and that the dropdown actually renders after the change — open the page and check the "Business Analysis" menu still lists every tool correctly.

## Pages this currently applies to

**Done:** `menu-calculator.html` (nav only — no business constants to wire yet), `interactive-costing-analysis.html` / `.js` (nav + `guideRatios`), `rental-calculator.html` (nav only, 2026-09-24 — its `GUIDE_RATIOS` is equipment-category-based, not the venue-type schema `guideRatios` holds, so there's no matching value here for it to read yet).

**Needs the retrofit, not done this round** (this session doesn't have direct access to these files): `overhead-manpower-calculator.html`, `printing-calculator.html`, `margin-audit-calculator.html` (nav retrofit, **plus** its own `GUIDE_RATIOS` object is the byte-for-byte duplicate this whole file exists to fix — highest-value single retrofit on this list), `food-worth-calculator.html`, `crypto-radar.html`, `index.html`, `about.html`, `services.html`, `contact.html`.

## KIV / open items

- Footer "Site" link list — currently dead markup (`display: none`), left unwired. Either wire it to `RZ_NAV_PAGES` too when the footer is ever un-hidden, or remove the redundant markup entirely; not urgent either way since nobody can see it today.
- Healthy-range thresholds — see the note under `site-config.js` above. Needs a person's call on whether the "stated range" and the "flag trigger point" should be one config number or two before this gets centralized.
- Default Cost Buffer % (10%, currently a literal `value="10"` in Menu Calculator's own HTML template) is a reasonable future `site-config.js` candidate — not duplicated anywhere yet, so no drift risk today, but it is a genuine "a vendor in a different trade might want a different default" business assumption, same category as `guideRatios`. Flagged, not built.
