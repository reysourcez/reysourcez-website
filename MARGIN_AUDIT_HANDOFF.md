# Margin Audit — handoff brief (multi-menu sync + cost-entry cleanup)

Written 2026-09-06 by the session that owns Menu Calculator and
Costing Analysis, for whichever session implements the Margin Audit
side of this. Nothing here has been implemented in margin-audit-
calculator.js or margin-audit-calculator.html — this is a plan, not a
diff. This doc assumes no prior context; everything needed is below.

## 1. What changed upstream (Menu Calculator), and why it matters here

Every menu item block in Menu Calculator now broadcasts its own
updates over the shared sync channel (`rzBroadcast`), each tagged with
a stable id:

    { blockId: "menublock-3", costPerPortion: 3.85, sellingPrice: 12.90, dishName: "Nasi Lemak Ayam" }

Previously, only the FIRST menu block ever broadcast anything, no
matter which one the user actually edited — that's why Margin Audit
has only ever received one synced dish, regardless of how many menu
items actually existed in Menu Calculator. That's fixed now, upstream.
`blockId` is new; older payloads never had it.

## 2. The de-dupe fix this requires in margin-audit-calculator.js

`handleSyncPayload`'s `data.source === 'menu-calculator'` branch
currently calls `createDishPanel()` unconditionally on every incoming
payload. That was fine when only one payload ever arrived, but now
every keystroke on every menu item in Menu Calculator fires a
broadcast — without a fix, that's a new duplicate dish panel every
time someone types a character anywhere in Menu Calculator.

Fix: the first time a panel is created from a synced payload, store
the blockId on it —

    panel.dataset.syncedBlockId = data.blockId;

— then, before calling `createDishPanel()` again for a menu-calculator
payload, look for an existing panel whose `dataset.syncedBlockId`
matches `data.blockId`. If one exists, update its price/cost fields in
place. If none exists yet, create one (as today) and tag it.

`collectDishes()`, `computeQuadrant()`, the structure pie, and the
insights logic need no changes at all — they already work off however
many dish panels exist on the page, synced or manual, with no
awareness of where each one came from.

Manually-added dishes (no `syncedBlockId`, because the person typed
them in directly rather than syncing) should be completely unaffected
by this — the matching logic above only ever looks at panels that came
from a sync in the first place.

## 3. The bigger ask: remove the duplicate cost-entry from each dish panel

Right now, each dish panel's own AI-estimate / "I'll enter it myself"
tabs are a second, independent way to arrive at a dish's cost — separate
from, and disconnected from, the much more precise ingredient-by-
ingredient build-up already available in Menu Calculator. That's
redundant, and worse, it's currently two different numbers for what
should be the same dish if it exists in both places.

Given cost can now reliably arrive from Menu Calculator (per section 1
and 2 above), the ask is: **remove the AI-estimate / manual-cost tabs
from each dish panel entirely.** A dish panel's cost comes from
whichever Menu Calculator item it's synced to — full stop. What stays,
because it's genuinely unique to Margin Audit and has nothing to do
with Menu Calculator: **Current price (RM)** and **Sold / day**. Those
two are the top-down-specific inputs — Margin Audit's whole job is
"you already know what you charge and roughly how many you sell; tell
us what your actual margin is and where the cost crept up," which
Menu Calculator has no equivalent of and shouldn't need one.

**Open question this doc is deliberately not answering:** should a
dish panel keep any standalone way to add an item that doesn't exist
in Menu Calculator yet — a quick competitor-price check, a
hypothetical, something you don't want to fully cost out yet — or
should the rule become "if it's not in Menu Calculator, go add it
there first, no shortcuts here anymore"? Worth deciding with whoever
requested this before removing the fallback entirely, since it's a
real behavior change either way, not just a cleanup.

**The margin-audit-proxy Worker is now spare capacity, not dead weight.** It's already live, already holding a real Gemini key, already proven to work — it just won't have a caller left in Margin Audit once section 3 above ships (Menu Calculator has since stood up its own separate Worker for its own AI-estimate tab, so there's no need to route Margin Audit's cost estimation through this one even if the fallback question above lands on "keep a standalone entry path"). Worth actively looking for something ELSE in Margin Audit that could use a working Gemini call before assuming it should just sit idle — the photo-recognition-plus-cost-inference capability it already has is a reusable building block, not a single-purpose one.

## 4. Already-made decisions worth knowing, so they don't get re-litigated

- **Printing Calculator is deliberately not a pull-source for Margin
  Audit** ("printing isn't a food cost, doesn't belong in a food
  margin tool" — already reflected in the current TOOL_DOCK_CONFIG and
  handleSyncPayload). Don't reintroduce it while doing this work.
- **Site-wide button/tab styling convention**: active tabs/toggles
  reuse `.btn.btn-secondary` as the base with an `.is-active` override
  (see `.menu-tab-btn.is-active`, `.cost-mode-tab.is-active` in
  styles.css) rather than inventing new button styles. Worth matching
  if this work touches any UI, e.g. removing the AI-estimate/manual
  tabs will likely simplify a dish panel's markup — reuse what's
  there rather than restyling.
- **Cache-busting**: whatever changes here need a version bump on
  margin-audit-calculator.html's own `margin-audit-calculator.js?v=N`
  reference, and on `styles.css?v=N` too if styles.css gets touched —
  GitHub Pages + Cloudflare caching means an unbumped version can keep
  serving the old file after deploy.

## 5. What NOT to touch as part of this

menu-calculator.js, menu-calculator.html, interactive-costing-
analysis.js, interactive-costing-analysis.html, and costing-sync.js
are all being handled by a different session as part of the same
overall multi-menu sync effort — no need to touch any of them here.
