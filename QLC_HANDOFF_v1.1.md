# QR Listing Creator — v1.1 Handoff Document
2026-09-21. Read this before touching any of the five files below again — it has the deploy steps, the
one D1 command you must run by hand, and the full list of what changed and why.

## Files in this delivery

| File | What it is |
|---|---|
| `qr-listing-creator-worker.js` | The backend. Paste into the Cloudflare Worker's editor, replacing everything. |
| `qr-listing-creator.js` | Seller page script. |
| `qr-listing-creator.html` | Seller page markup. |
| `order.js` | Customer ordering page script. |
| `order.html` | Customer ordering page markup. |
| `floor-plan.js` | **New file.** Shared by both pages — draws the floor plan. Upload it alongside the other four. |

`styles.css`, `nav-config.js`, `site-config.js` are **unchanged** — don't re-upload them.

## Deploy steps, in order

1. **D1 Console → your database → Console tab.** Paste this one line and run it:
   ```sql
   ALTER TABLE businesses ADD COLUMN floor_plan TEXT;
   ```
   Skip this only if you are setting up the database from scratch (the CREATE TABLE in the Worker's own
   header comment already includes the column). Until this runs, the app works exactly as before —
   menus and orders are unaffected — and saving a floor plan fails with a message that says why. There's
   no rush, and no downtime either way.
2. **Worker → Edit code.** Delete everything, paste in the new `qr-listing-creator-worker.js`, Save and
   deploy.
3. **Website files.** Upload all five files above (four replace existing ones; `floor-plan.js` is new)
   to wherever the site's static files live. Do this *after* step 2 — the new front-end calls the new
   `/floorplan` endpoint, so it needs the new Worker live first.

No `WORKER_ENDPOINT` values changed — all three (`order.js`, `qr-listing-creator.js`, and the new
`connect-src` line in `order.html`, see below) already point at
`https://qr-listing-creator-proxy.reysourcez-ent.workers.dev`. If that address ever changes, all three
need updating together — that's a pre-existing rule (see the Worker's own header), not new to v1.1.

## What was fixed, and why

### 1. The 10-minute delay you saw
Not a bug in the strict sense — GitHub Pages (and most static hosts) cache files at the edge for a
while after you re-upload, so the *old* `order.js` kept being served for a few minutes. Nothing to fix
there. What v1.1 adds is a **visible state either way**: a spinner while loading, an automatic retry (up
to 3 tries with a short wait between them, with a note that a brand-new listing can take a moment to
appear), and — if it still fails — a plain message with a **Try again** button. No more silent blank
screen.

### 2. Table QR still asking "which table?"
This one really was a bug. A table's QR code (`?table=5`), the delivery QR (`?mode=delivery`), and the
takeaway QR (`?mode=takeaway`) now each **lock** the order to what they're for — no picker. Only a bare
link (`?biz=X`, nothing else) shows the Dine-in / Takeaway / Delivery picker, because that's the one
case where the link genuinely hasn't said. The seller page's QR generator was also fixed to always link
to `order.html` in the same folder — before, it only worked when the seller page's own address ended in
`qr-listing-creator.html` exactly; opened as `/qr-listing-creator` (no `.html`, which some hosts serve
automatically) it printed QR codes pointing back at itself instead of the menu.

### 3. Floor plan (built this round)
Seller draws once (Tables & QR → **Floor plan** tab): drag to draw walls, click to drop tables (each
auto-numbered, editable), click to place one door and one cashier icon. Undo, and nothing is saved until
"Save floor plan" is pressed. Customers ordering to a table get a **Floor plan** button in the header;
tapping it shows the same drawing read-only with their own table highlighted, and tapping a different
table switches the order to it — this is also how "what table am I in case we moved" is answered, and it
plugs directly into your "change table" ask.

Deliberately **not** built: freehand upload of a photo/scan of an existing floor plan. The draw tool
covers the same need with much less code and no image-hosting question to answer; if a scan-and-trace
workflow turns out to matter, it is a separate feature to scope on its own, not a variant of this one.

### 4. Security and money — found while building the floor plan, fixed at the same time
These weren't asked for, but they were serious enough to fix now rather than flag and leave:

- **One business could edit another's products.** A product's id is public (it's right there in
  `/catalog`), and the old `/catalog` endpoint only checked that *a* valid admin key was presented —
  not that it was the key for *that product's own business*. Any seller could point their own key at
  someone else's product id and rename it, delete it, or drop its price to zero. Fixed: an update now
  only touches a row that matches both the product id *and* the business id from the key.
- **Combo option prices, and the purchase-with-purchase offer, were taken from the browser.** A combo's
  "+RM1.50 for Milo" was sent back by the browser when ordering — anyone could open their browser's dev
  tools and send `-RM1.50` instead, and the purchase-with-purchase discount was never actually applied
  server-side at all, just displayed. Both are now looked up fresh from the database when an order is
  placed, the same way the base price already was.
- **The admin key was stored as plain text and sent in the URL.** Now hashed in the database (a listing
  made before v1.1 upgrades itself automatically the first time its key is used — nothing for you to do)
  and sent in a request header instead of `?key=...`, so it can't end up in server logs or browser
  history. The "Copy my admin link" button now puts the key after a `#`, which browsers never send
  anywhere — that's how a link can safely carry the key at all.
- Money is now added up in whole cents everywhere (both front-end previews and the Worker's real total),
  closing a class of `0.10 + 0.20 = 0.30000000000000004` floating-point bugs that could very occasionally
  show a preview total one cent off from what's actually charged.
- A handful of smaller ones: a product name containing a quote mark used to get cut off mid-edit and
  saved that way; an empty product-options box showed on every plain item; the category bar showed even
  with only one category; opening two of the same combo's picker on one page (Top Picks + its own
  category) could break the first one's Add button; the seller's Settings tab could show stale values
  right after saving a product; a delivery order's name/phone/address weren't shown to the seller at
  all, only stored; typed delivery details could be wiped by tapping a quantity `+`/`-`; and the ordering
  page now has a security policy (CSP) that stops any injected script from running even in the unlikely
  case one ever got through — a second lock behind the existing escaping, not a replacement for it.

None of this changes how the app looks or works for a seller doing normal things — same tabs, same
buttons, same flow. It only closes gaps a customer or a nosy competitor could have found.

## KIV — discussed, not built this round

- **Packing food to take home mid-meal**, and **ordering more before paying, while still dining.** Your
  instinct in the earlier session was that both want the same underlying idea — an order stays "open"
  for a table rather than being one-and-done, with a note field for the first and an "add more" flow for
  the second. That's a real change to how orders are modeled (right now each `/order` call is
  independent and final), so it's being left as a deliberate KIV rather than bolted on. Worth scoping
  properly when you're ready.
- **One QR code instead of one per table** — raised as a question, not a request. With the picker gone
  (see #2 above), a table QR now saves a real step: no picker to tap through. Whether that's worth
  printing and taping N codes instead of one is a call about your tables' physical layout more than the
  software, so left as-is unless you want it revisited.

## Data shapes worth knowing (for a future AI session)

**Floor plan** (stored as JSON text in `businesses.floor_plan`, `null` when nothing is drawn):
```json
{ "v": 1,
  "walls":    [{ "x1": 40, "y1": 40, "x2": 600, "y2": 40 }],
  "tables":   [{ "n": "5", "x": 220, "y": 120, "shape": "round" }],
  "doors":    [{ "x": 320, "y": 40 }],
  "cashiers": [{ "x": 540, "y": 330 }]
}
```
Canvas is always 640×400 units (`floor-plan.js`'s `W`/`H`); both pages scale it to fit. `n` is matched
against `?table=` case-insensitively to decide which table is "yours" on the customer page.

**Order** (stored as JSON text in `orders.items_json` — a listing's older orders, saved before v1.1,
are a bare array instead and are still read correctly, just with no `adjustments`):
```json
{ "lines": [{ "productId": "...", "name": "Nasi Lemak", "qty": 1, "unitPrice": 8.5, "lineTotal": 8.5,
              "selectedOptions": [] }],
  "adjustments": [{ "label": "Offer price: Teh Ais", "amount": -2.0 }] }
```

**Endpoints added:** `GET /floorplan?biz=X` (public — customers need to read it), `POST
/floorplan?biz=X` (owner only; body `{ "plan": {...} }`, or `{ "plan": null }` / an empty drawing to
clear it). See the Worker's own header comment for the complete, current contract — it's kept up to date
there, not duplicated here.

## Not touched this round

Full analytics (trends, bestsellers, the Star/Plowhorse/Puzzle/Dog breakdown Margin Analysis already
has) — still a deliberate KIV per the Orders tab's own note, waiting on real order history to mean
anything.
