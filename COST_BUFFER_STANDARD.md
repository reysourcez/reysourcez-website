# Cost Buffer % — standard (added 2026-09-16)

**For the AI building or updating any tool that builds up a dish/recipe
cost from ingredients** (Menu Calculator, Food Worth, and anything
similar). This doc assumes no prior context — everything needed is
below. Menu Calculator's implementation (menu-calculator.js) is live
and is the reference; everything else here is written for whoever
picks up the tools that don't have it yet.

## The gap this closes

Menu Calculator's Ingredient Costing table already had a per-ingredient
**Wastage %** field — but it defaults to 0%, and in practice most
people costing a dish don't sit down and estimate a shrinkage rate for
every single ingredient. So the dish total that came out of Menu
Portion Creator was, by default, a *theoretical* cost — clean recipe
math, no allowance for spillage, a redone batch, over-portioning, or
plain spoilage — understating what the dish actually costs to run.

A user-supplied reference template (`TEMPLATE PENGIRAAN KOS PER MENU`,
Coach Rimee Liew @ Qhalifah) builds a flat **10% wastage buffer** on
top of the total raw material cost into its worked example, treated as
standard practice rather than an edge case. That's the piece Menu
Calculator was missing, and it's now been added as **Cost Buffer %** —
a dish-level, whole-menu-item margin, separate from and in addition to
the existing per-ingredient Wastage %.

## Verification (per the request to double-check, not just trust the PDF)

The template's own math checks out — its worked example (whole
chicken RM2.08 + rice RM1.05 + oil RM0.25 + cucumber RM0.24 = RM3.62
raw cost, then 10% × RM3.62 = RM0.36 buffer) is arithmetically correct,
and its two formulas (price-per-unit = purchase price ÷ purchase
weight; food cost % = cost ÷ selling price × 100) match the standard
formulas used everywhere else on this site.

On whether a flat ~10% buffer is reasonable practice generally, not
just this one template's convention: a "Q Factor" — a percentage
allowance on top of ingredient cost for waste, over-production and
incidentals — is an established concept in professional food costing,
commonly cited in the 5–10% range. Separately, waste specifically is
often cited around 10–15% of food spend in professional kitchens. A
10% default sits squarely inside both of those ranges — reasonable and
slightly conservative, not an outlier. Malaysian F&B sources
independently make the same point: skip an explicit wastage allowance
in your food cost calculation and net profit erodes quietly. The
25–35% healthy food-cost-% range already used elsewhere on this site
also matches what both Malaysian and international sources cite, so
nothing about that figure needed to change.

None of this is regulatory or fixed — it's a planning buffer, which is
exactly why it's implemented as an editable, toggleable field rather
than a hardcoded constant.

## Where it sits in the calculation chain

This is a **cost-side** adjustment, not a price-side one — it inflates
the cost basis, the same side of the ledger as the ingredients
themselves. That's a different kind of operation from delivery
commission or SST further down the chain, which mark the *price* up
after the fact (see AI_BUILD_BRIEF.md's own commission-vs-SST note for
the same distinction applied to a different pair of fees). Concretely,
it inserts as an extra multiplicative step, before the Target Food
Cost % gross-up, not folded into it and not applied after it:

```
Σ ingredient costs (existing per-ingredient Yield/Wastage/Inflation already baked in)
        │
        ▼
  × (1 + Cost Buffer % / 100)        ← NEW STEP, this standard
        │
        ▼
  ÷ (Target Food Cost % / 100)        → Target Selling Price
        │
        ▼
  [ ÷ (1 − commission share) if sold via delivery app ]
        │
        ▼
  [ × (1 + SST %) if SST-registered ]        → Listed Price
```

Worked example, using the template's own ingredient total: RM3.62 raw
cost → ×1.10 → **RM3.98** with the buffer → ÷30% target food cost →
**RM13.27** target selling price (vs RM12.07 without the buffer — the
buffer alone moves the target price by about RM1.20 here).

## The pattern (as implemented in menu-calculator.js)

- A toggle + a `%` field, matching the existing "Sold via delivery
  app" / "SST registered" pattern exactly (`.toggle-row`, `.tooltip-icon`,
  reuses `.platform-fields`/`.sst-fields` styling rather than new CSS —
  see `.cost-buffer-fields` in styles.css).
- **Defaults ON at 10%** — the one place this differs from delivery/SST,
  which both default off. Those two are conditional on a business
  model choice (do you actually sell via a delivery app?); a wastage
  buffer isn't conditional the same way, it's closer to Target Food
  Cost %'s always-on-with-a-sensible-default treatment. Still a toggle,
  so anyone who wants to rely purely on their own per-ingredient
  Wastage % instead can turn it off.
- A small helper, `computeBufferedCost(block)`, wraps whatever
  `computeBlockCost(block)` already returns. Because it sits
  *downstream* of that function rather than duplicating its
  Detailed/Simple/AI-estimate branching, the buffer applies uniformly
  no matter which of the three costing modes produced the raw total —
  **the AI-estimate / photo-upload path inherits this automatically,
  with no special-casing needed.** This is the pattern to copy: don't
  add buffer logic inside each cost-input method, add one small
  function that wraps whatever the existing "give me this dish's raw
  cost" function already returns.
- The raw, un-buffered total still displays too (`.menu-total`,
  unchanged) — the buffered figure gets its own line ("Cost incl.
  buffer") right next to the toggle. Showing both numbers, not just
  silently replacing one with the other, matches how the source
  template itself presents it (raw total as its own line, then a
  second line for total-plus-buffer).

## Doesn't replace per-ingredient Wastage %

The two aren't redundant, even though both use "wastage" language:

| | Per-ingredient Wastage % (existing) | Cost Buffer % (new) |
|---|---|---|
| Scope | One specific ingredient | The whole dish, once |
| What it captures | Known, measurable trim/shrinkage for that item | Unknown-unknowns: spoilage, a redone batch, over-portioning |
| Default | 0% — you opt in per item | 10% — on by default |

They're meant to stack, the same way Yield %, Wastage %, and
Inflation % already stack at the ingredient level (see
menu-calculator.js's own comments on that). A menu-calculator.html
tooltip on the Wastage % column header now cross-references this, so
neither reads as redundant with the other.

## Sync and export — `costPerPortion` now includes the buffer

Both the live cross-tab broadcast (`rzBroadcast`) and the JSON export
(`exportMenuData`) now send the **buffered** cost as `costPerPortion`,
not the raw ingredient sum — plus a new `costBufferPct` field (the %
actually applied, 0 if the toggle was off). Rationale: every consumer
of `costPerPortion` (Costing Analysis, Margin Audit, an imported file)
treats it as "what this dish truly costs" — it was never documented as
"just the ingredients," so feeding it the more accurate figure is a
correctness fix, not a breaking change to the contract. The field name
and role are unchanged; EXPORT_IMPORT_FORMAT.md has been updated to
show the new field. This is additive — an importer that doesn't know
about `costBufferPct` yet just ignores it and still reads
`costPerPortion` correctly.

**Consequence for Margin Audit specifically:** per
MARGIN_AUDIT_HANDOFF.md's plan (not yet implemented as of this doc),
Margin Audit is meant to drop its own AI-estimate/manual-cost tabs and
take cost purely from whatever Menu Calculator item it's synced to.
Once that ships, Margin Audit inherits the buffered cost automatically
through the sync payload — it doesn't need its own Cost Buffer %
implementation, and nothing in this standard changes that plan.

## Instructions for Food Worth (and anything else with its own ingredient-cost buildup)

This session doesn't have food-worth-calculator.js/html to edit
directly — food-worth-proxy-worker.js (referenced from
menu-calculator-proxy-worker.js's own header comment) confirms Food
Worth has its own Gemini-powered ingredient/cost estimation path,
separate from Menu Calculator's. Whoever owns that file:

1. Find Food Worth's equivalent of `computeBlockCost()` — whatever
   function currently sums up a dish/recipe's raw ingredient cost,
   regardless of whether that number came from typed-in ingredients,
   a description, or a photo upload.
2. Add a `computeBufferedCost()`-style wrapper around it: same shape
   as menu-calculator.js's version above — read a toggle + a `%`
   field, multiply by `(1 + pct/100)` when the toggle is on, otherwise
   pass the raw number through unchanged. Wrapping the existing
   function (not editing inside it) is what makes this apply to every
   input path at once, AI-estimate/photo included.
3. Add the toggle + field to Food Worth's own pricing/results UI,
   reusing whatever equivalent of `.toggle-row` / `.tooltip-icon` /
   `.pricing-result` Food Worth already has (check its own version of
   styles.css usage first — don't invent new classes if an equivalent
   already exists there, same Non-negotiable as every other page).
   Default it ON at 10%, same reasoning as above.
4. If Food Worth has its own cross-tool sync or export, apply the same
   "buffered cost is what downstream consumers should see" rule from
   the Sync and export section above.
5. If Food Worth's macro-nutrient bar (`#fw-macro-bar`, per
   interactive-costing-analysis.js's comments) or any other feature
   reads from the same raw-cost function, double check whether it
   should read pre- or post-buffer — nutrition figures almost
   certainly should NOT be affected by a cost buffer (the buffer is
   money, not food weight), only cost/price figures should.

If Food Worth's architecture turns out not to map cleanly onto this
(e.g. no single obvious "raw cost" function to wrap), flag that rather
than forcing the pattern — the principle (toggle + %, defaults on at
10%, applied once before any food-cost-%-based pricing step, wraps
the existing cost function rather than special-casing each input
method) matters more than matching this exact code shape.
