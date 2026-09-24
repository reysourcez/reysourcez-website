# QLC v1.5 — private Cost + Orders analytics (2026-09-24)
Scope: Worker + seller page. Customer page untouched. Base = the v1.1 Worker/seller files plus the v1.4 seller tabs (QLC_HANDOFF_v1.4_ADDENDUM.md).
Nothing about these features existed in the project files before this round (they were described in notes only), so they are built fresh here.

## Deploy order (all three needed for Cost; menus and orders keep working at every step)
1. D1 Console -> Console tab: `ALTER TABLE products ADD COLUMN cost REAL;`  (skip if the tables were created from the v1.5 Worker header)
2. Worker -> Edit code -> replace everything with qr-listing-creator-worker.js -> Save and deploy.
3. Upload qr-listing-creator.html (?v=4 script) + qr-listing-creator.js. Hard-refresh.
Before step 1, saving a Cost returns 200 with `warning` (shown in red under Save item) and everything else in the product still saves.

## Data + API
- `products.cost REAL` (null = not set). Private: never in the public `/catalog`. `GET /catalog?biz=X` with a valid `X-Admin-Key` adds `cost` per product (second query, try/catch for a missing column).
- `POST /catalog` accepts `cost`: `''`/null clears, absent (older cached page) leaves it, invalid -> 400. Saved by `finishProduct()` in its own UPDATE so the main save never depends on the new column.
- Seller page reads the catalog with `adminFetch` (loadManageView, refreshProductsQuietly) so `products[].cost` is present; the customer page still calls it without a key.
- Analytics have no endpoint: computed in the browser from `/orders` (latest 500) + `products[].cost`. Order lines do not store cost; margins use the product's CURRENT cost.

## Seller UI
- Products form: `.qlc-p-cost` next to Price ("optional, private").
- Orders tab: `#qlc-analytics` (rendered by `renderAnalytics(orders)` from `renderOrders`, and re-rendered after a product save via `lastOrders`) = last-30-days KPIs (orders, revenue, average order, margin on costed items), 30-bar daily revenue SVG, top-5 bestsellers, and the menu-engineering table, then the raw order list.
- `computeAnalytics(orders, prods)` is pure (tested). Menu engineering = Kasavana & Smith: popular if units share >= 0.7 / N (N = costed products, zero-sales included); profitable if margin per unit (avg selling price - cost) >= units-weighted average margin. Star = both, Plowhorse = popular only, Puzzle = profitable only, Dog = neither. Needs >= 2 costed products and >= 1 costed sale.
- Item revenue is before purchase-with-purchase discounts; the revenue total (orders.subtotal) is after them. Combo option prices count in avg price but not in cost.

## KIV
- Snapshot cost onto each order line at order time (accurate history when costs change; touches handleOrder).
- Server-side aggregation once a listing passes 500 orders per 30 days; date-range picker; Star/Plowhorse chart view.
- Cap floor-plan tables in the Worker; desktop layout; seller theme picker; seller-managed ads (earlier addenda).
