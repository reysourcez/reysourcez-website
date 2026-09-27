# QLC v1.7 — customer-page desktop layout + ads-banner fix (2026-09-26)
Scope: customer page only (order.html, order-look.css). Worker, seller page, D1, and every other customer-page
file (order.js, order-themes.js, order-config.js, floor-plan.js) are untouched — no SQL, no Worker deploy, no
JS changes at all. Base = the v1.4 customer-page files (QLC_HANDOFF_v1.6_ADDENDUM.md).

## Why this round exists
Two items were sitting in the KIV list: the customer page had never had a deliberate desktop pass (it only
ever widened through the fluid `--o-pad` centering and the drawers' own `@media (min-width:700px)` rule), and
the wide-screen/high-zoom bug where the ads banner shows two slides at once instead of snapping to one was
never root-caused. The seller's own instruction on this was explicit: make desktop look intentional — mobile
is already right and must not change. Both are handled here, entirely in CSS, in one file.

## Files
| file | status |
|---|---|
| order-look.css | edited → **VERSION 1.4** (first edit since v1.3, 2026-09-24) |
| order.html | edited → **VERSION 1.5** — two lines only: the header comment, and `order-look.css?v=1` → `?v=2` |

## Deploy (no Worker, no D1 — just the two files above)
1. Upload `order.html` and `order-look.css` to the site, same folder and same file names as before (overwriting
   the old copies — file names never change here on purpose, since every printed table QR code points at
   `order.html` directly).
2. Hard-refresh the ordering page once, on one device, to confirm the new look. The `?v=2` on the stylesheet
   link forces every other browser to fetch the new CSS too, even one that had the old page cached.
That's it. No D1 console, no Worker edit, no `ALTER TABLE`, no other file to touch.

## 1. Desktop layout
Everything new lives inside one `@media (min-width: 860px)` block, appended at the end of order-look.css. That
means the CSS above that line — everything that shapes the page below 860px — is byte-for-byte what it was in
v1.3, so mobile cannot have regressed. Below 860px, nothing changes; a phone or a narrow window looks exactly
as it did before this round.
- **Catalog grid**: the default ("grid") card layout's column minimum goes from 160px to 230px, so a wide
  monitor shows a handful of comfortably-sized cards instead of six or more narrow ones. Themes with their own
  row/wide card layout (`data-cards="row"|"wide"`) already set a wider minimum of their own and outrank this
  rule on specificity, so they're unaffected.
- **Top picks row**: cards widen from 214px to 240px to match the wider catalog cards.
- **Video banner**: insets into the same centred column as the rest of the page (it was full-bleed
  edge-to-edge before) and allows a taller clip — 220px max height becomes 320px — with the same rounded
  corners as a product card.
- **Cart bar**: still the same fixed-to-the-bottom bar as mobile — no JS changed, it still opens the same cart
  drawer the same way — just capped at 640px and centred instead of stretched across an ultrawide screen.
  Pill-style themes (foodpanda, deliveroo, starbucks, aurora) already float and cap themselves narrower on
  their own, more specific rule, so they're unaffected by this.
- **Floor-plan drawer**: widens from the shared 420px drawer width to `min(720px, 90vw)`, so table numbers are
  easier to make out without pinch-zooming. The cart and order-summary drawers keep the narrower 420px — right
  for a short list of line items, no reason to widen those.

## 2. Ads-banner wide-screen fix
`.ord-ad-slide` gains two declarations: `box-sizing: border-box` (its own padding could previously add on top
of the `flex-basis: 100%` figure instead of being counted inside it, letting the rendered slide end up wider
than the visible track) and `scroll-snap-stop: always` (stops the browser from ever coasting past a slide
without snapping fully onto it — a known contributor to "two partially visible slides" at extreme zoom).

**Stated plainly**: this was fixed by code review, not by reproducing the bug live — this project still has no
real browser to test in, the same limitation as every round since v1.5. Please specifically re-check the ads
banner at a very wide window and at a low browser-zoom level after deploying. If a sliver of a second slide is
still visible, it's worth a follow-up round with an actual screenshot to look at, since there are other,
harder-to-fix explanations (a browser-specific scroll-snap rounding bug at extreme zoom) that this round's fix
does not rule out.

## Testing done this round
- Diffed the finished order.html and order-look.css against the v1.4/v1.3 copies line-by-line to confirm
  nothing changed outside: order.html's two intended lines, and order-look.css's header, the one modified
  `.ord-ad-slide` rule, and the new block appended at the end of the file.
- Brace- and paren-balance check on the full CSS file (88 open/close braces, 164 open/close parens) — no CSS
  parser is installable in this environment (no network access), so this is the available sanity check.
Not done: opening the page in an actual browser at any width, and not done: visually confirming the ads-banner
fix. Please smoke-test both the catalog/video/cart-bar layout and the ads banner (ideally at a wide window and
a low zoom level) after deploying.

## Built / where / version ledger (carried forward, updated)
| Feature | Seller-facing? | Where | Since |
|---|---|---|---|
| Product Cost (private) + Orders analytics | Yes (Products tab, Orders tab) | qr-listing-creator.html/js, Worker | v1.5 |
| Cost snapshotted per order line (accurate history) | Feeds the Orders tab automatically | Worker `handleOrder`, seller JS `computeAnalytics` | v1.6 |
| Floor-plan table cap | Yes (front-end message) + Worker backstop | qr-listing-creator.js (`fpTableLimit`, v1.4) + Worker (v1.6) | v1.4 (front-end), v1.6 (Worker) |
| 10 customer-page themes + generic names | No seller control until v1.6 | order-themes.js | v1.3 (themes), v1.6 (seller picker + generic-only names) |
| Seller Theme picker | Yes (Settings tab) | qr-listing-creator.html/js, order-themes.js, order.js, Worker | v1.6 |
| Seller-managed ad slides | Yes (Settings tab) | qr-listing-creator.html/js, order.js, Worker | v1.6 |
| Desktop layout for the customer page | No (view-only) | order-look.css | v1.7 |
| Ads-banner wide-screen/high-zoom fix | No | order-look.css | v1.7 |
| Take-home packing / add-more-before-paying | — | not started, needs a design conversation first | KIV |

## KIV
- A real "no ad banner at all" switch for a listing, separate from "using the shared default".
- Ad slide colour (`bg`/`fg`) in the seller editor, if the accent-colour fallback ever isn't enough.
- Server-side aggregation once a listing passes 500 orders per 30 days; date-range picker; Star/Plowhorse
  chart view.
- Packing-to-take-home / add-more-before-paying (see v1.1) — needs a short design conversation first, not just
  a build.
- Deeper per-theme structure (floating add button, icon category rail, bento grid, scrollspy tabs) — v1.3 KIV,
  still open.
- Confirm this round's two changes in an actual browser — a wide window for the layout, a wide window at low
  zoom for the ads banner. This project has shipped without live-browser testing since v1.5; that gap is
  cumulative and worth closing before the next round that touches visual behaviour again.
