# QLC v1.6 — Worker floor-plan cap, order-line cost snapshot, seller Theme picker, seller Ad banner (2026-09-25)
Scope: Worker + seller page + customer page. D1 gets two new columns (`businesses.theme`, `businesses.ads`); no new tables.
Base = the v1.5 Worker/seller files (QLC_HANDOFF_v1.5_ADDENDUM.md) plus the v1.3 customer-page files (QLC_HANDOFF_v1.3_ADDENDUM.md).

## Why this round exists
The previous session's KIV list said "seller theme picker" and "seller-managed ads" were still open, but a later chat in
this project remembered them as already built. They were not: only the customer-page *infrastructure* for themes and
ads existed (10 themes + a dev-only test dropdown; one shared ad-slide list in `order-config.js`). Nothing let a seller
actually choose a theme or write their own ad copy, and nothing on the Worker enforced the floor-plan table cap the
seller page already displayed. This round builds the missing seller-facing half of both, plus the other two KIV items
that had no seller/Worker half yet: the Worker-side floor-plan cap, and cost snapshotted onto each order line.

## Deploy order (all files upload together; menus and orders keep working at every step)
1. D1 Console → Console tab, run both lines (skip either you already have):
   `ALTER TABLE businesses ADD COLUMN theme TEXT;`
   `ALTER TABLE businesses ADD COLUMN ads TEXT;`
2. Worker → Edit code → replace everything with qr-listing-creator-worker.js → Save and deploy.
3. Upload qr-listing-creator.html (?v=5 script) + qr-listing-creator.js, and order.html + order.js + order-themes.js
   (?v=2) + order-config.js. Hard-refresh both the seller page and any open customer page.
Before step 1, saving a Theme or an Ad banner returns 200 with a `warning` (shown in red under Save settings) and
everything else on that Save (tables, video, PWP) still saves normally. The floor-plan cap and the cost snapshot need
no column at all — they work as soon as the Worker is deployed (step 2).

## 1. Worker floor-plan cap
`handleSaveFloorPlan` now looks up the business's own `table_count` and rejects (400, does not save) a plan with more
tables than that — same rule the seller page's own `fpSave()` already checked before this round, now backstopped
server-side. Rejects rather than silently keeping the first N tables, so a save either fully succeeds or clearly fails
with a message, never quietly drops tables without saying so.

## 2. Cost snapshot on order lines
`handleOrder` now also selects each product's `cost` (same missing-column try/catch pattern as everywhere else cost is
read) and stores it as `unitCost` on that order line — the cost AT THE MOMENT of the order, not looked up again later.
`computeAnalytics` (seller Orders tab) now prefers the average of any snapshotted `unitCost` values for an item's sales
in the 30-day window, and falls back to the product's CURRENT cost only for lines that predate this upgrade (no
`unitCost` field) or when nothing sold in the window yet. A cost change today no longer rewrites yesterday's margin.
Limit: this cannot retroactively fix history — orders placed before this Worker deploy have no snapshot and always use
current cost, same as v1.5.

## 3. Seller Theme picker (Settings tab)
- New: `business.theme` (`businesses.theme` column, one of `order-themes.js`'s 11 ids, default `classic`).
- Settings tab → "Look & feel" → a `<select>` built from `OrderThemes.list` (so the seller list and the customer-page
  theme list can never drift apart) + a "Preview on the ordering page" button that opens `order.html?biz=X&theme=Y`
  in a new tab using whatever is currently selected, even before Save.
- `order-themes.js` is now loaded on the seller page too, purely for its data. Its old auto-apply / session-storage /
  test-dropdown code is now guarded behind `document.getElementById('ord-app')` so none of that ever touches the
  seller dashboard's own colours or storage — verified with a DOM mock for both the with- and without-`#ord-app` cases.
- Customer page: `order.js`'s `start()` calls `OrderThemes.apply(state.business.theme)` once the catalog loads, unless
  the URL has an explicit `?theme=` (a support/testing link still wins). The very first paint (before the catalog
  fetch resolves) still uses `order-themes.js`'s own `?theme=` → session → `ORDER_CONFIG.defaultTheme` → `classic`
  chain, so there's no flash of a wrong theme while waiting on the network.
- Theme names shown to sellers are the plain, already-generic `n` values only (e.g. "Fresh Black & Green") — the
  brand-attribution `from` field ("— Uber Eats" etc.) is never rendered anywhere anymore, including the old test
  dropdown. `from` stays in `order-themes.js`'s own data purely as an internal note for whoever edits that file next.
  The internal `id` strings (`ubereats`, `doordash`, …) still exist as keys but are never shown to anyone.
- `order-config.js`'s `themeTestMode` now defaults to `false` (the seller Settings tab is the real mechanism now) —
  flip it back to `true` locally any time to preview every theme quickly.
- The per-viewer `sessionStorage` theme key is now scoped per business (`ord-theme-<bizId>`, was one shared key for
  every listing) so switching between two businesses in the same browser tab session can't leak one's theme onto
  the other's page.

## 4. Seller Ad banner (Settings tab)
- New: `business.ads` (`businesses.ads` column, JSON array, up to 6 slides; `null` = none set).
- Settings tab → "Ad banner" → a stacked list of slide rows (Headline, Body text, Button label, Link) with
  "+ Add slide" / "Remove slide", saved together with the rest of Settings.
- Colour (`bg`/`fg`) is not exposed in the editor yet — `order-look.css` already falls back to a gradient in the
  theme's own accent colour when they are blank, so seller-made slides still look intentional without needing that.
- Customer page: `order.js`'s `renderAds()` uses the business's own slides when it has any; otherwise the shared
  defaults in `order-config.js`, unchanged from v1.3. `ORDER_CONFIG.ads.enabled` is still a genuine site-wide kill
  switch — `false` hides the banner everywhere, even for a business with its own slides.
- Limit: an explicitly-saved empty slide list looks identical to "never set any" (both store `null` and fall back to
  the shared default) — there is no separate "no ad banner at all for this listing" switch yet. Worth a small
  follow-up (e.g. a checkbox) if a seller specifically wants to turn ads off rather than replace them.
- Link safety: `cleanAdSlides`'s `cleanAdUrl` uses the exact same allow-pattern as the customer page's own
  `safeAdUrl()` (`https://…` or a same-site relative path only — never `javascript:`/`data:`), tested directly
  against the shipped Worker code with 10 cases (safe and unsafe) — see Testing below.

## Data + API changes
- `businesses` table: `+ theme TEXT`, `+ ads TEXT` (both nullable; included in the fresh-setup `CREATE TABLE` block
  in the Worker's header now, so a brand-new listing never needs the `ALTER TABLE` lines at all).
- `GET /catalog?biz=X` → `business` object gains `theme` and `ads` (both public, not owner-gated, same bucket as
  `hasFloorPlan`/`videoBannerUrl` — the customer page needs them to render).
- `POST /business?biz=X` → body gains optional `theme` (validated against a small `ALLOWED_THEMES` allow-list on the
  Worker, mirrored from `order-themes.js`'s ids since the Worker can't load that file) and optional `ads` (cleaned by
  `cleanAdSlides`). Both are saved in their own UPDATE, separate from the existing table/video/PWP UPDATE, so a
  database missing either new column still saves everything else; response gains an optional `warning` string.
- `POST /order` line items gain `unitCost` (RM, `null` when the product has no cost or the line predates this
  upgrade) — private, only ever seen via the owner-only `/orders` endpoint.
- `POST /floorplan` now rejects (400) a plan with more tables than "Number of tables" allows, instead of accepting it.

## Testing done this round (no live browser or live D1 — same caveat as v1.5)
- `node --check` on every changed `.js` file, after every edit, not just at the end.
- `cleanAdUrl` (Worker): 10 cases run against the actual shipped function (extracted from the file, not retyped) —
  `https://…` and relative paths accepted; `javascript:`, `data:`, `//host`, bare `http://` all neutralised.
- `cleanAdSlides` (Worker): 6 cases against the shipped function — caps at 6, drops a slide with no title/text,
  truncates an overlong title to 60 chars, neutralises an unsafe URL inside a slide, `[]` and non-array both → `null`.
- `computeAnalytics` cost blend (seller JS): run against the shipped function with synthetic orders — a product with
  a mix of snapshotted and pre-upgrade lines blends correctly (weighted average of the snapshotted ones only); a
  product with zero in-window sales falls back to current cost; a fully pre-upgrade order set reproduces the exact
  v1.5 numbers (backward-compatibility check).
- `order-themes.js`'s page-detection guard: simulated with a minimal DOM mock for both "seller page" (no `#ord-app`)
  and "customer page" (`#ord-app` present) — confirmed `OrderThemes.list` is populated either way, confirmed the
  seller-page case touches no CSS variables and leaves `root.dataset.theme` untouched, confirmed the customer-page
  case scopes its `sessionStorage` key to the business id.
Not done: opening either page in an actual browser, or running against a real D1 database. Please do a normal
smoke test after deploying — place a test order, save a theme, save an ad slide, try to draw one more table than the
limit allows — before real customers rely on this.

## Built / where / version ledger
So this can't drift again — what actually exists right now, and in which file:

| Feature | Seller-facing? | Where | Since |
|---|---|---|---|
| Product Cost (private) + Orders analytics | Yes (Products tab, Orders tab) | qr-listing-creator.html/js, Worker | v1.5 |
| Cost snapshotted per order line (accurate history) | Feeds the Orders tab automatically | Worker `handleOrder`, seller JS `computeAnalytics` | v1.6 |
| Floor-plan table cap | Yes (front-end message) + Worker backstop | qr-listing-creator.js (`fpTableLimit`, v1.4) + Worker (v1.6) | v1.4 (front-end), v1.6 (Worker) |
| 10 customer-page themes + generic names | No seller control until v1.6 | order-themes.js | v1.3 (themes), v1.6 (seller picker + generic-only names) |
| Seller Theme picker | Yes (Settings tab) | qr-listing-creator.html/js, order-themes.js, order.js, Worker | v1.6 |
| Ad banner (site-wide shared slides) | No seller control until v1.6 | order-config.js, order.js | v1.3 |
| Seller-managed ad slides | Yes (Settings tab) | qr-listing-creator.html/js, order.js, Worker | v1.6 |
| Desktop layout for customer page | — | not started | KIV |
| Take-home packing / add-more-before-paying | — | not started | KIV |

## KIV
- Desktop layout for the customer page, mobile untouched (a `@media (min-width: …)` block only) — its own round,
  CSS-only, so mobile can't regress. Also fix the wide-screen ads-banner-shows-2-slides bug noted in v1.4.
- A real "no ad banner at all" switch for a listing, separate from "using the shared default".
- Ad slide colour (`bg`/`fg`) in the seller editor, if the accent-colour fallback ever isn't enough.
- Server-side aggregation once a listing passes 500 orders per 30 days; date-range picker; Star/Plowhorse chart view.
- Packing-to-take-home / add-more-before-paying (see v1.1) — needs a short design conversation first, not just a build.
- Deeper per-theme structure (floating add button, icon category rail, bento grid, scrollspy tabs) — v1.3 KIV, still open.
