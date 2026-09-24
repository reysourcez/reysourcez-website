# QLC v1.4 — seller-page addendum (2026-09-24)
Scope: seller page only (qr-listing-creator.html + .js). Customer page, Worker and D1 untouched (no SQL, no Worker paste).
Base = the **v1.1** seller files in the project (the live Products tab shows no Cost field, so it matches v1.1). If a v1.2 seller page
(Cost field / Orders analytics) is live, do NOT upload these two files: send the live ones and the two edits below get re-applied to them.
Read with QLC_HANDOFF_v1.1.md and QLC_HANDOFF_v1.3_ADDENDUM.md.

## UI vocabulary (use these words in requests)
- **Tabbed editor** ("hide siblings, show one"): one form visible, a tab row above switches between items, "+ Add" beside the tabs, tabs appear
  once there are 2+ items. Used by Menu Calculator (menu tabs), Food Worth (dish tabs), Printing Calculator (job tabs) and, from v1.4, the Products tab.
- **Stacked list** (repeater): every item gets its own full form, one under another. Products tab before v1.4.

## Products tab
Markup: `#qlc-product-tabs` + `#qlc-add-product` share one `.calc-actions` row, then `#qlc-product-list`.
Code: `showProductRow(row)` hides every `.qlc-product-row` but one, then `renderProductTabs()`; tabs are `.qlc-ptab` (label = live product name, "New item" if blank;
none for 1 product; a hint for 0). `dropProductRow(row)` removes a form and opens its neighbour. Forms stay in the DOM (hidden) so unsaved typing survives tab switches.
Old HTML (no `#qlc-product-tabs`) + new JS = `showProductRow()` is a no-op, list stays stacked. Save / Remove / combo builder code is unchanged.

## Floor plan limit
`fpTableLimit()` = Settings "Number of tables" (0..200). Table tool refuses to place beyond it, `fpSave()` refuses to save more tables than the limit,
`fpUpdateInfo()` shows "N of M tables". Front-end rule only: the Worker's `cleanFloorPlan()` still allows 200.

## Cache-busting
qr-listing-creator.html loads `floor-plan.js?v=2` (was v=1, so the seller page now gets the v1.3 "You" tag file) and `qr-listing-creator.js?v=3`.

## Nav retrofit (NAV_RETROFIT_HOWTO.md)
Seller page already has site-config.js + nav-config.js as its first two scripts and an empty `.nav-dropdown-menu`; the doc's status list was stale and is corrected.
`order.html` has no site nav by design.

## KIV
- Desktop layout for the customer page, mobile untouched (a `@media (min-width: …)` block only). Seen at 25% zoom: on very wide screens the ads banner shows slide 2 beside slide 1.
- Cap floor-plan tables to `table_count` inside the Worker (needs the current Worker file).
- Seller theme picker, seller-managed ads, deeper per-theme structure (see v1.3 addendum). Packing-to-take-home / add-more-before-paying (see v1.1).
