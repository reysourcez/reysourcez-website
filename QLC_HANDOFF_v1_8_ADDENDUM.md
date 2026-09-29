# QLC v1.8 — customer questions (support) + live-refreshing seller tabs (2026-09-27)
Scope: Worker + seller page + customer page. D1 gets one new table (`questions`); no existing table changes.
Base = the v1.7 customer-page files (QLC_HANDOFF_v1.7_ADDENDUM.md) plus the v1.6 Worker/seller files (QLC_HANDOFF_v1.6_ADDENDUM.md).

## Why this round exists
Two asks: (1) a customer browsing the menu should be able to ask a quick question — about a specific item or
something general — without leaving the page, and the seller should see it live, not just on a manual refresh;
(2) the existing Orders tab, and this new Questions tab, should both keep themselves current on their own while
the seller is looking at them, without losing the manual Refresh button either one has. Everything below is
built to that spec. The receipt-number / POS-connection question asked earlier in this round is answered
inline further down and logged under KIV, not built.

## Deploy order (all three needed for Questions; menu, cart and orders keep working at every step)
1. D1 Console → Console tab, run once (skip if you already created the tables from THIS version of the Worker file):
   ```sql
   CREATE TABLE questions (
     id TEXT PRIMARY KEY,
     business_id TEXT NOT NULL,
     session_id TEXT NOT NULL,
     order_type TEXT,
     table_number TEXT,
     product_id TEXT,
     product_name TEXT,
     question TEXT NOT NULL,
     answer TEXT,
     status TEXT NOT NULL DEFAULT 'open',
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     answered_at TEXT
   );
   CREATE INDEX idx_questions_biz ON questions(business_id, created_at);
   CREATE INDEX idx_questions_session ON questions(business_id, session_id, status);
   ```
2. Worker → Edit code → replace everything with qr-listing-creator-worker.js → Save and deploy.
3. Upload qr-listing-creator.html (?v=6 script) + qr-listing-creator.js, and order.html (?v=5 script) + order.js.
   Hard-refresh both the seller page and any open customer page.

Before step 1, a customer trying to send a question gets a plain "not set up yet" message instead of an error
page, and the seller's Questions tab just shows "no open questions" — nothing else breaks.

## 1. Customer: "Ask a question"
- A round 💬 button floats above the cart bar on the ordering page at all times — not just for dine-in — so a
  customer can ask before they've even chosen dine-in/takeaway/delivery.
- Tapping it opens a drawer: a dropdown ("General question" + every item currently on the menu), a short text
  box (300 characters), Send, and a "Your questions" list below showing everything asked this browser session
  and, once the seller replies, the answer — or "Marked as resolved by the staff" if the seller resolved it
  without typing a reply.
- No accounts — same privacy bar as the cart. A random id (`crypto.randomUUID()`, with a plain fallback) is
  generated once and kept in this tab's `sessionStorage` (`ord-qsession-<bizId>`) so the customer can find their
  own questions again: gone once the tab closes, and — being effectively unguessable — never something another
  customer could use to read someone else's.
- Closing the drawer with a question still unanswered doesn't stop checking: it keeps quietly polling every 12
  seconds (paused while the browser tab isn't in front, and stopping on its own once nothing is left waiting)
  and pops a toast — "You have a reply to your question" — plus a small dot on the 💬 button, the moment the
  seller answers. A customer who never asks anything never triggers a single extra request.

## 2. Seller: Questions tab
- New tab, placed after Orders. Open questions sit on top — context (table number, "Takeaway customer",
  "Delivery customer") plus the item if one was picked, the question itself, a reply box, Send reply, and "Mark
  resolved (no reply)" for the ones answered by walking over instead of typing (asks for a quick confirmation
  first, since it's a bit final). Answered/resolved questions sit in a second, read-only list underneath.
- A small red count badge sits next to the "Questions" tab label whenever at least one question is open —
  visible even while the seller is on a different tab, so nothing sits unnoticed just because Products or
  Settings happens to be the open tab.

## 3. Real-time sync, Orders + Questions
- **Questions** refreshes every 10 seconds the whole time the seller is signed in — not just while that tab is
  open — so the badge count is always current. A poll tick only rebuilds a question's card when something
  about it actually changed; an unchanged card (reply box, half-typed text and all) is left completely alone,
  so replying is never interrupted mid-keystroke by the next automatic check.
- **Orders** refreshes every 10 seconds too, but only while the Orders tab is the one currently open (switching
  tabs starts/stops it) — nothing on that tab is ever mid-edit, so a plain redraw is safe there, and it's
  skipped entirely when the order list hasn't actually changed since the last check.
- The **Refresh** button on Orders, and the new one on Questions, still work exactly as before — either one
  forces an immediate check without waiting for the next tick.
- Both timers pause while the browser tab is in the background (`document.hidden`) and simply resume on the
  normal schedule once it's back in front.

## Receipt number / POS — answered, not built
The 4-character code a customer sees after placing an order (e.g. "K7M2") is `orderCode()` in the Worker — the
order's own `id` in D1. It's returned as `orderId` and shown on both the customer's summary screen and as the
first column of the seller's Orders tab, so a screen can be matched to a row. There's no connection to any POS
system today, on purpose (see the Worker header's MONEY section): the code is a shared reference number for a
human to match up, not a live link into a till. A real connection means picking a specific POS first (Square,
StoreHub, Loyverse, Toast, …) — they don't share an API, so it becomes a separate, vendor-specific project once
there's one to target. Logged under KIV below rather than built this round.

## Data + API changes
- New table `questions` (SQL above) — nothing existing changed.
- `POST /questions?biz=X` → `{ sessionId, productId?, question, orderType?, tableNumber? }` → `{ id, productName,
  question, status }`. Public (no admin key), same pattern as `/order`. A session is capped at 15 open questions
  at once (429) as a simple abuse/stuck-retry guard.
- `GET /questions?biz=X[&session=Y]` → `{ questions[] }`. With a valid `X-Admin-Key`: every question for the
  business (owner view, latest 200 — same cap style as `/orders`). Without one: `session` is required and only
  that session's own questions come back (latest 50).
- `POST /questions?biz=X&id=Z` → `{ answer }` or `{ dismiss: true }` → `{ ok: true }`. Owner only, scoped
  `WHERE id = ? AND business_id = ?` like every other single-row update on this file.
- `/order`, `/catalog`, `computeAnalytics` — all untouched. Questions are entirely independent of ordering and
  cost analytics.

## Testing done this round (still no live browser or live D1 — same caveat as every round since v1.5)
- `node --check` on every changed `.js` file, after every edit.
- A script-based cross-check that every DOM id each JS file looks up with `getElementById` actually exists,
  either in the matching HTML file's static markup or inside that same JS file's own generated template
  strings (both patterns are used throughout this codebase already).
- Traced the create → owner-GET → answer/dismiss → session-GET path by hand against the Worker code, including
  the 15-open-questions cap and both the "no such table yet" fallbacks (friendly message for the customer,
  quiet empty list for the seller).
- Confirmed by reading (not running) that a poll tick which finds nothing changed for a given question leaves
  that card — and any half-typed reply inside it — untouched; only a genuinely new or changed question causes
  that one card to be rebuilt.

Not done: opening either page in a browser, or checking against a real D1 database. This gap has now carried
across four rounds (v1.5–v1.8) and is the most valuable thing to close before the next round that touches
interactive or timing-sensitive behaviour again.

**Suggested smoke test after deploying:** open the ordering page, tap 💬, ask a question about a specific item.
On the seller dashboard, open Questions (the badge should already show "1" even from another tab) and reply.
Back on the customer page with the drawer closed, confirm the toast and the reply both appear within about 12
seconds, with no manual refresh. Then place a couple of test orders and confirm the Orders tab updates within
about 10 seconds while sitting on that tab, again without clicking Refresh.

## Built / where / version ledger (carried forward, updated)
| Feature | Seller-facing? | Where | Since |
|---|---|---|---|
| Product Cost (private) + Orders analytics | Yes (Products tab, Orders tab) | qr-listing-creator.html/js, Worker | v1.5 |
| Cost snapshotted per order line (accurate history) | Feeds the Orders tab automatically | Worker `handleOrder`, seller JS `computeAnalytics` | v1.6 |
| Floor-plan table cap | Yes (front-end message) + Worker backstop | qr-listing-creator.js (`fpTableLimit`, v1.4) + Worker (v1.6) | v1.4 (front-end), v1.6 (Worker) |
| Seller Theme picker | Yes (Settings tab) | qr-listing-creator.html/js, order-themes.js, order.js, Worker | v1.6 |
| Seller-managed ad slides | Yes (Settings tab) | qr-listing-creator.html/js, order.js, Worker | v1.6 |
| Desktop layout for the customer page | No (view-only) | order-look.css | v1.7 |
| Ads-banner wide-screen/high-zoom fix | No | order-look.css | v1.7 |
| Customer "Ask a question" (item or general) | No (customer-facing) | order.html/js, Worker | v1.8 |
| Seller Questions tab (reply / mark resolved) | Yes (Questions tab) | qr-listing-creator.html/js, Worker | v1.8 |
| Live badge + 10s auto-refresh, Questions tab | Yes | qr-listing-creator.js | v1.8 |
| 10s auto-refresh, Orders tab (while open) | Yes | qr-listing-creator.js | v1.8 |
| Take-home packing / add-more-before-paying | — | not started | KIV |
| POS / payment-system connection | — | not started — no POS chosen yet | KIV |

## KIV
- **POS / payment system integration** — no automated link to any till today (see above); needs a specific POS
  picked first, since Square/StoreHub/Loyverse/Toast/etc. each need their own, unrelated integration.
- A real "no ad banner at all" switch for a listing, separate from "using the shared default".
- Ad slide colour (`bg`/`fg`) in the seller editor, if the accent-colour fallback ever isn't enough.
- Server-side aggregation once a listing passes 500 orders per 30 days; date-range picker; Star/Plowhorse chart view.
- Packing-to-take-home / add-more-before-paying (see v1.1) — needs a short design conversation first, not just a build.
- Deeper per-theme structure (floating add button, icon category rail, bento grid, scrollspy tabs) — v1.3 KIV, still open.
- Auto-archiving very old answered/resolved questions once the table grows large — the 200/50-row caps on GET
  keep responses small in the meantime, so this is housekeeping, not urgent.
- Optional: a real browser/push notification (not just the in-dashboard badge) for a brand-new question or
  order — useful if the seller isn't looking at the dashboard tab at all. Bigger lift (Notifications API + a
  permission prompt), deliberately left out of this round.
- Confirm this round's changes in an actual browser, against a real D1 database, watching the polling behaviour
  over a few minutes — plus the still-unverified v1.7 desktop layout and ads-banner fix. This gap has now
  carried across four rounds (v1.5–v1.8) and is the single most valuable thing to close before the next round
  that touches interactive or timing-sensitive behaviour again.
