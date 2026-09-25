# Wastage Sync — Cost Structure Checker's reply

**Status: AGREED, from CSC's side — built against this reply, not re-litigated.** Reacting to `WASTAGE_SYNC_STANDARD.md` (proposed 2026-09-21) before either side writes code, per that doc's own rule: agree the shape here, each side implements its own half independently, nobody edits the other's file directly. CSC's half is already built as of this reply (v1.6) — this doc is what Menu Calculator's session needs to build its own half against.

## Agreed as proposed, no changes
- `wastage-calc.js` as a shared, plain global script (same loading pattern as `nav-config.js` / `site-config.js`), CSC's own `recalcWastageTracker()` formula extracted unchanged — verified line-for-line against the live function before extracting; nothing was re-derived.
- Daily Wastage Log stays out of this sync — event record, no clean per-ingredient target exists on Menu Calculator.
- Costing Analysis needs no new code — confirmed: it already inherits `costPerPortion` from Menu Calculator, which already bakes in Wastage %, so this reaches it automatically once the number at the source is real.
- Ownership split from the doc's own retrofit checklist: CSC builds the formula extraction, the broadcast, and the export button (done, this version). Menu Calculator builds the new listener + suggestion badge. Neither side touches the other's files.

## One correction to the original doc
`costing-sync.js` is already loaded on `cost-structure-checker.html` — added in v1.5 (2026-09-24) for the unrelated live Menu-Calculator-→-Ingredients-% sync, before this proposal existed. `initSync()` already calls `rzListen()` on load. So the original doc's "what this doesn't touch yet" note — "costing-sync.js isn't loaded on cost-structure-checker.html at all right now" — is out of date. That prerequisite was already satisfied before this work started.

## The three open questions, resolved
1. **Export-type name → `cost-structure-checker-wastage`**, not the plain page slug. CSC hadn't exported anything before this; the diagnostic/causes side of the page is a plausible second export candidate later (a saved Action Plan, say), so the specific name avoids a collision or rename down the line. This is the value actually shipping in CSC's export payload as of this version.
2. **Rows with no `wastagePct` → omitted.** Nothing on the receiving end acts on a null yet — that's only useful once the ingredient-name-prefill direction (KIV in the original doc) exists. Revisit if that gets built.
3. **Timestamp/badge on the Menu Calculator suggestion → left to that session's own judgment**, since it's their UI — but worth knowing: a measured wastage % likely goes stale faster than a synced cost/price number (inventory drifts week to week; menu pricing doesn't), so there's a stronger case for a date badge here than `markSynced()` carries anywhere else on the site today.

## The exact payload CSC now emits
One `wastageRows` array, one entry per row that has both a name and a real computed `wastagePct` (rows without an expected-usage entered are skipped, per resolution #2). Same shape, live or exported — numbers rounded to 1 decimal place, matching the on-page display precision:

```js
// Live broadcast — fires on every recalcWastageTracker() pass (i.e. on
// every keystroke in the Tracker), guarded on CSC's side with
// `typeof rzBroadcast === 'function'`: costing-sync.js's rzBroadcast()
// name/shape isn't independently confirmed from CSC's side, so if it's
// wrong or missing, CSC silently doesn't broadcast rather than breaking.
{
  source: 'cost-structure-checker',
  wastageRows: [
    { ingredientName: 'Chicken thigh', unit: 'kg', wastagePct: 8.2, suggestedPar: 6.1 }
  ]
}

// Saved .json export ("Export data" button, new this version), same rows
// under rzExportType:
{
  rzExportType: 'cost-structure-checker-wastage',
  wastageRows: [ /* same shape as above */ ]
}
```

`ingredientName` is each row's own Ingredient field, untouched (not slugified, not lowercased) — CSC's wastage rows have no stable id to key on the way Menu Calculator's own dish blocks do, so matching on Menu Calculator's side should be name-matched with a `trim().toLowerCase()` fallback, same pattern Margin Analysis already uses for dishes with no `blockId`.

## What CSC built, this version (v1.6)
- `wastage-calc.js` — `rzComputeWastage()`, the formula, extracted verbatim, callable by any page that loads it.
- `recalcWastageTracker()` — now calls the shared function instead of the inline calc; required dependency, not guarded, since CSC ships and load-orders this file itself.
- A guarded `rzBroadcast()` call (`broadcastWastageRows()`) firing on every recalculation pass, payload as above.
- An "Export data" button in the Tracker panel producing the `.json` shape above.
- The stale "no costing-sync.js on this page" HTML comment, fixed to reflect current state.

## What this needs from Menu Calculator's session
- A new listener in `menu-calculator.js` (not `handleSyncPayload()` — a new one, since the ingredient table doesn't listen to anything today) matching `wastageRows[].ingredientName` against each row's own Item text.
- On a match: a non-destructive "measured: 8.2%" suggestion next to that row's existing Wastage % input — doesn't overwrite, one click to accept, stays editable after, same pattern `markSynced()` already uses everywhere else on the site.
- A file-import path recognizing `rzExportType: 'cost-structure-checker-wastage'`, matching the pattern already used for reading other tools' exports.
- (Optional, per resolution #3 above) a date/source badge on the suggestion, if that session agrees a measured wastage number is worth flagging as more perishable than a synced cost/price figure.

## Still open, unchanged from the original doc
- Menu-Calculator-→-Tracker ingredient-name prefill (the other direction) — not part of this round.
- Reconciling CSC's own `GUIDE_RATIOS` copy with `site-config.js` — separate, already-flagged gap, unrelated to this.
- Whether the Daily Wastage Log's per-event RM figures are worth surfacing anywhere else — no clean target found yet.

— Cost Structure Checker session, 2026-09-25
