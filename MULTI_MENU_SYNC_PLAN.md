# Multi-menu sync — implementation notes

Written by the integrator session, 2026-09-06. Steps 1 and 2 below are
now implemented (menu-calculator.js, interactive-costing-analysis.js).
Step 3 (margin-audit-calculator.js) is intentionally NOT implemented
here — see MARGIN_AUDIT_HANDOFF.md, a self-contained brief meant to be
sent to whichever session/person implements Margin Audit separately.

## The one root cause (now fixed)

menu-calculator.js used to only ever broadcast its FIRST menu block,
regardless of which block the user was actually editing:

    if (typeof rzBroadcast === 'function' && block === document.querySelector('.menu-block')) {
      rzBroadcast({ costPerPortion: total, sellingPrice: ..., dishName: name });
    }

`document.querySelector('.menu-block')` always returns the first
matching element in the DOM, full stop — it didn't mean "the block
that just changed." Every downstream "only handles one menu" symptom,
in both Costing Analysis and Margin Audit, traced back to this one
line.

## What changed

1. **menu-calculator.js** — the guard is gone; every block now
   broadcasts its own updates, tagged with its own stable
   `blockId` (`block.dataset.blockId`, e.g. `menublock-3`):

       rzBroadcast({ blockId: block.dataset.blockId, costPerPortion: total, sellingPrice, dishName: name });

   `computeBlockCost(block)` also became mode-aware — Detailed sums
   the ingredient rows same as always, but Simple and AI-estimate now
   feed the same `total` differently. See the chat for that whole
   Manual/AI-estimate tab discussion; the sync payload shape doesn't
   care which of the three produced the number.

2. **interactive-costing-analysis.js** (`handleSyncPayload`) — no
   longer overwrites `#ing-cost`/`#sell-price` from whatever arrived
   last. Keeps a `Map` keyed by `blockId` (dishName, costPerPortion,
   sellingPrice), renders a dropdown once more than one item has
   synced, and only the selected entry writes into the fields. An
   update to a menu item that ISN'T the one currently selected updates
   its map entry and dropdown label but doesn't yank the visible
   fields to a different item. This is Issue #4 in
   ROADMAP_SONNET5MAX.md, scoped as one-item-at-a-time pricing
   (bottom-up) — the portfolio-wide view belongs to Margin Audit.

3. **margin-audit-calculator.js** — NOT touched by this session. See
   MARGIN_AUDIT_HANDOFF.md.

## Don't change (still true)

- `computeQuadrant`, `collectDishes`, the structure pie, and the
  insights logic in Margin Audit — all already source-agnostic,
  already correct for N dishes once fed correctly.
- Manually-added dishes there (no `syncedBlockId` on the panel) should
  keep working exactly as they do today.

