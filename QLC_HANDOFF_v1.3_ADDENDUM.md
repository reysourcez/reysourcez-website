# QLC v1.3 — customer-page UI addendum (2026-09-24)
Scope: customer page only. Worker, seller page and D1 are untouched — no SQL, no deploy order. Built on the **v1.1** copies of
order.html / order.js / floor-plan.js held in the project (the v1.2 seller-analytics round is not in these files).
Read alongside QLC_HANDOFF_v1.1.md (endpoints, data shapes, security notes still apply).

## Files (upload all 6; names stay unversioned because printed table QR codes point at order.html — version = file header + ?v= query)
| file | status |
|---|---|
| order.html, order.js, floor-plan.js | edited (v1.3) |
| order-config.js, order-themes.js, order-look.css | NEW |

## Load order
styles.css -> inline <style> -> order-look.css. Scripts (defer, in order): order-config.js -> order-themes.js -> floor-plan.js -> order.js.
CSP unchanged (Google Fonts already allowed). `<html>` ships with data-theme="classic" so the page is safe if the theme file fails to load.

## Contracts
- `ORDER_CONFIG` = { themeTestMode, defaultTheme, text{topPicks,fullMenu,shopLayout}, ads{enabled,rotateSeconds,slides[{title,text,cta,url,emoji,bg,fg}]} }
- Theme = { id, n, from, c[bg,surface,ink,accent,onAccent], r, f, d, b, a{cards,cart,nav}, head, x{} }; `OrderThemes.apply(id)`, `.list`
- Theme pick order: `?theme=` -> sessionStorage `ord-theme` -> `ORDER_CONFIG.defaultTheme` -> classic. `?themetest=1|0` forces the dropdown on/off.
- html attrs: data-theme, data-cards (grid|row|wide), data-cart (bar|pill), data-nav (pills|tabs), data-head (1 = coloured header)
- CSS vars: existing --paper --surface --ink --text --accent --accent-dark --accent-soft --line --muted --font-display --font-body;
  new --on-accent --o-r --o-btn --o-bw --o-shadow --o-img --o-head --o-head-fg --o-bg --tp-c1 --tp-c2 --tp-glow. accent-dark/soft/line/muted are derived with color-mix().
- New ids: ord-ad, ord-divider, ord-picks-title, ord-plan-title, ord-theme-test. New classes: .is-top .ord-top-ribbon .ord-glitter .ord-ad-* .ord-table-card .ord-chips .ord-chip
- Ad links: https:// or same-site relative only (`safeAdUrl`), opened with rel="noopener noreferrer sponsored".

## Flow: change table (dine-in)
Cart drawer -> [Change table · Shop layout] -> shop layout saved? `openPlan(true)` : `state.editTable` -> chips 1..business.tableCount + text box.
Tap a table -> `chooseTable(label, fromPlan)`: state.tableNumber + orderType='dine_in' -> typed box synced -> `history.replaceState(?table=label)` -> header badge + toast -> cart re-renders.
Cart (sessionStorage) is untouched; `/order` sends the new tableNumber. `floor-plan.js markup({highlight})` draws a "You" tag on that table.
If the header has no Shop layout button, the seller has not saved a plan (or the v1.1 `ALTER TABLE businesses ADD COLUMN floor_plan TEXT;` was never run).

## KIV
- Seller-side theme picker: needs `ALTER TABLE businesses ADD COLUMN theme TEXT;` + Worker allowlist + `/catalog` field; dropdown then becomes seller-only.
- Deeper per-theme structure: floating "+" add button, icon category rail, bento grid, scrollspy tabs.
- Seller-managed ads (today: one shared list in order-config.js). Rename themes to generic names before launch (brand/trademark caution).
