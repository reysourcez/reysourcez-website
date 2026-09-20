# Should the Daily Wastage Log / Wastage & Par-Level Tracker live somewhere else?

Written 2026-09-20, in response to a direct question: would Menu Calculator, Interactive Costing Analysis, Margin Analysis, Rental Calculator, or "Service Calculator" be a better home for these two sub-tools than Cost Structure Checker, with Cost Structure Checker instead just calling on them the way Margin Analysis / Interactive Costing Analysis are treated as "analysis" pages rather than calculators?

**Decision: no — both stay on Cost Structure Checker.** Reasoning below, plus one small optional idea that was considered and NOT built, and two unrelated things this research turned up along the way.

---

## 1. Why they stay put

- **Wastage is already this page's own center of gravity, not a bolt-on.** Of the 16 causes in Cost Structure Checker's own Ingredients & Packaging category, six are wastage-adjacent (high wastage, burnt/overcooked, spillage, comps/tasting, customer returns, no par levels) and link straight to one of these two tools via a same-page anchor (`#csc-wastage-log` / `#csc-wastage-tracker`). No other page on the site has anywhere near that concentration of wastage-specific diagnostic content for these tools to plug into.
- **The tick-a-cause → jump-to-the-matching-tool flow depends on same-page anchors.** That's the actual point of these two tools existing inside Cost Structure Checker at all (see `COST_STRUCTURE_CHECKER_NOTES.md` section 6). Move them to another page and every one of those six links becomes a full page navigation instead of a scroll — the person loses their ticked-cause context and has to re-orient on a page built for a different question.
- **Nothing else on the platform is core to this data.** Menu Calculator prices a dish from ingredient cost; Interactive Costing Analysis and Margin Analysis work from cost totals and margin, not from what actually left the shelf; Rental Calculator is lease economics only. None of them has wastage or par-level stock as its subject — moving the tools there would be a bolt-on in a new place instead of a bolt-on in the right place.
- **This site's own architecture makes "move" mean "duplicate," not "relocate."** `AI_BUILD_BRIEF.md` is explicit: no build step, no shared runtime — the pattern already in use for genuinely shared logic (the pie-chart math, `.menu-tabs`) is to copy the code into each page that needs it, by hand, and keep the copies in sync by hand. A 12-column stateful tracker table with its own recalculation logic is a much bigger thing to duplicate and hand-sync forever than a couple of small pie-chart functions — and there's no real forcing function making a second copy worth that ongoing cost, since (per the point above) no other page's cause library needs to link to it the way this one's does.

## 2. Considered, not built: a pointer link the other direction

Rather than moving the tools, the lighter version of this idea is a small note added TO one or two of the other pages, pointing back AT Cost Structure Checker's tools — the same "points back at another tool already on this site" pattern Cost Structure Checker's own cause library already uses toward Menu Calculator and Margin Analysis (see `COST_STRUCTURE_CHECKER_NOTES.md` section 4).

Of the five pages named in the original question, only one is a plausible fit on its own merits:

- **Interactive Costing Analysis** — this is the page that computes a person's overall Ingredients % from their real cost inputs. If that number comes back running high, wastage is one of the most common reasons, and this page currently has no pointer toward the tool that would help someone find out why. **This is the one worth adding, if any.**
- Margin Analysis, Menu Calculator — plausible in theory (both touch ingredient cost somewhere) but one hop further removed; not worth it on their own.
- Rental Calculator — no real connection to wastage at all. Skip.
- "Service Calculator" — searched for this by name across the live nav (see section 3) and didn't find it. Can't evaluate a page that doesn't exist yet under that name.

**Not built here, on purpose:** writing the exact HTML/CSS to insert requires the page's own *current* markup, per `AI_BUILD_BRIEF.md`'s own rule ("use its own current HTML... not an old copy, not from memory"). A live fetch of `interactive-costing-analysis.html` today returned only its `<head>`/nav/footer — the actual page body (result cards, structure bars) is rendered client-side by `interactive-costing-analysis.js` after load, which a static fetch doesn't execute, so its current DOM structure wasn't actually visible from here. Writing exact insertion instructions against unverified markup would be a guess dressed up as an instruction. **If this is worth doing, whoever builds it should:**

1. Open the *current* `interactive-costing-analysis.html` + `.js` (not this doc, not memory) and find where the Ingredients % result is actually rendered.
2. Add one short `structure-note`-style line near it, shown only when Ingredients is running high against that page's own guide band (it already computes this comparison) — something like: *"Ingredients cost higher than expected? Cost Structure Checker's Wastage & Par-Level Tracker can help pinpoint why → `cost-structure-checker.html#csc-wastage-tracker`"* — reusing whatever conditional-tip pattern the page already has for its own guide-band flags, rather than inventing a new one.
2a. Confirm the actual live href for Cost Structure Checker first — see section 4 below, the homepage links to it as `/cost-structure-checker` with no `.html`, which doesn't match the file's own name or how every older tool links to every other tool on this site.
3. Nothing structural required on the Cost Structure Checker side — the tracker's `id="csc-wastage-tracker"` anchor already exists and already works for the six in-page cause links; a cross-page link just needs to point at it.

This is genuinely optional polish, not a gap that breaks anything. Skip it if there's higher-value work queued.

## 3. "Service Calculator" — not found

The live nav (`https://reysourcez.com`, fetched 2026-09-20) currently lists 15 tools under Business Analysis: Menu Calculator, Overhead & Manpower, Printing Calculator, Costing Analysis, Margin Analysis, Food Worth, Crypto Radar, Rental Calculator, Market Radar, Cost Structure Checker, QR Listing Creator, SOP Creator, Project Planner, Form Creator, QR Creator. No "Service Calculator" among them. Worth a second look at whether that's a tool planned but not yet built, a different existing tool by another name, or a mishearing — this doc can't evaluate a page it can't find.

Separately: the live tool count (15) is well beyond the 10 tools `NAV_ORDER_STANDARD.md` and this project's other notes describe — five more (QR Listing Creator, SOP Creator, Project Planner, Form Creator, QR Creator) exist live that aren't reflected in the file set this session had access to. Nothing in this doc's recommendations above depends on those five, but whoever next reconciles `NAV_ORDER_STANDARD.md` centrally should know the canonical list has grown past 10.

## 4. Two things found along the way (flagged, not fixed here)

- **GitHub's default branch for this repo (`reysourcez-patch-1`) looks stale.** Its copy of `AI_BUILD_BRIEF.md` shows a 5-tool nav example (Menu Calculator through Food Worth only) — no Margin Analysis, Crypto Radar, Rental Calculator, Market Radar, or Cost Structure Checker anywhere in it. That's older than everything else this project's own notes describe. If GitHub Pages is actually deploying from this same branch, that's just a stale docs branch and harmless; if a future AI session starts a build by browsing the repo's default branch (exactly what `AI_BUILD_BRIEF.md` itself tells it to do), it would silently work from months-old reference material without any signal that it's out of date. Worth checking which branch Pages actually deploys from, and whether `reysourcez-patch-1` should be the default branch at all.
- **Interactive Costing Analysis's own live nav dropdown is missing three tools** — Rental Calculator, Market Radar, and Cost Structure Checker all absent from `interactive-costing-analysis.html`'s dropdown as fetched live just now (it only lists through Crypto Radar). This is exactly the class of drift `NAV_ORDER_STANDARD.md` already describes and predicted ("every live page's nav dropdown is currently missing at least one real tool") — this is direct, current confirmation of it on at least this one page, not a new problem. Given the platform now has 15 live tools rather than 10, the central nav-reconciliation pass flagged as outstanding in `NAV_ORDER_STANDARD.md` and `COST_STRUCTURE_CHECKER_NOTES.md` is now considerably further behind than either of those docs currently states. Not fixed here — same standing reason as every prior tool addition: this session doesn't have current, verified content for the other pages to safely patch them.
