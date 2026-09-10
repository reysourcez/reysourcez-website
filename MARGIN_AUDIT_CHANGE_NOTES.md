# Margin Analysis Calculator — change notes

(Title/page renamed from "Margin Audit" to "Margin Analysis" 2026-09-06, per `NAV_ORDER_STANDARD.md`. The file itself is still `margin-audit-calculator.html`/`.js` — only the visitor-facing name changed. Earlier entries below use whichever name was current when they were written; not retroactively edited.)

## 2026-09-09 (later same day) — Menu Analyzer starts blank; no manual "+ Add" anymore

**What was still wrong after the collision fix.** A "Dish 1" placeholder kept showing up and would never connect to anything, no matter what. Root cause: `finishWizard()` auto-created one empty dish panel on every fresh session (a leftover from before ingredient cost went sync-only), and that panel had no `syncedBlockId` — nothing broadcast from Menu Calculator could ever match it, by construction. It wasn't hidden or malfunctioning, it was just permanently unreachable, which reads exactly like "broken."

**The fix — decided by direct instruction, not guessed.** Menu Analyzer now starts with zero dishes, always. There is no more manual "+ Add menu item" button anywhere on this page. A dish exists here for exactly one reason: it synced in from Menu Calculator, tagged with that item's `blockId`. This resolves, definitively, the "should an unsynced dish even be allowed to exist" question the original `MARGIN_AUDIT_HANDOFF.md` deliberately left open — the answer is now no.

**Reframed what this panel actually is.** Menu Analyzer isn't a place to build a menu — it's a confirmation step for a menu you've already built in Menu Calculator. Intro copy rewritten to say that directly. When it's empty, a call-to-action takes over the whole panel: "No menu items yet — Open Menu Calculator and price your dishes there first." Once at least one dish has synced in, that call-to-action is replaced by the normal dish panels plus a smaller "Pull in another item" button for adding more.

**What changed, mechanically:**
- `finishWizard()` no longer creates a starter dish; it calls `renderDishTabs()` instead, which sets the correct empty/non-empty display either way.
- `resetAllCalculationData()` (Reset all) no longer recreates a dish after clearing — it goes back to genuinely empty, matching a fresh session.
- New `updateDishEmptyState()`, called from inside `renderDishTabs()` — so every existing dish add/remove/sync path already picks up the empty-state toggle for free, nothing had to be threaded through separately.
- `createDishPanel()` itself is unchanged and still exists — it's just no longer reachable from a button. It's only ever called now from `handleSyncPayload()` (a real sync arriving) and `importData()` (restoring a previously-saved file).
- The two "nothing to show" messages elsewhere on the page (per-item breakdown, true-cost table) now point at Menu Calculator by name instead of a generic "add an item" — consistent with the rest of this change.

**Testing done, given I can't render a browser here:** `node --check` clean; grepped for every remaining reference to the removed button/id (`ma-add-dish`) — none found; re-verified every `getElementById` call in the JS against the HTML; confirmed `createDishPanel()`'s only two call sites left are the sync and import paths. **Worth testing directly:** a genuinely fresh session (clear the page / hard reload) shows the empty-state message with no phantom dish, and syncing one item in from Menu Calculator correctly swaps the empty state out for that dish's panel.

## 2026-09-09 — Diagnosed and fixed: Menu Calculator's tool dock was hiding this page's own dish panels

**The bug, as reported.** Dish 1 (and any other dish) in the Menu tab would become inaccessible after opening "Pull from Menu Portion Creator." Creating a dish seemed to interfere with Menu Calculator's own tabs. Clicking a tab *inside* the Menu Calculator instance in the dock would close the price/sold-per-day form back on this page.

**Root cause.** The tool dock injects Menu Calculator's *actual, live script* into this page — not a sandboxed copy. The injection wraps it in a function so its variable and function *names* can't collide with this file's own, but that wrapper does nothing to scope its **DOM queries** — `document.querySelectorAll(...)` inside the injected script still searches the entire page, dock or not. Menu Calculator's own tab-switcher does exactly that, with no container prefix:

```js
document.querySelectorAll('.menu-block').forEach((b) => {
  b.hidden = (b.dataset.blockId !== blockId);
});
```

This page's dish panels were built as `class="ma-dish-panel menu-block"` — `.menu-block` was reused purely to borrow its box styling (border/radius/background/padding), the same shortcut Food Worth's dish panels and Printing Calculator's job blocks also take. That shared name was the entire vulnerability: whichever system's tab-switcher ran, it grabbed *every* `.menu-block` on the page, including the other system's, and hid whatever didn't match its own active id. Margin Analysis has no `dataset.blockId` matching anything Menu Calculator tracks, so its dish panels got hidden wholesale the moment Menu Calculator's switcher ran for any reason — including on its own initial load inside the dock.

**The fix.** Stopped sharing the class. `.ma-dish-panel` no longer carries `.menu-block` at all — it has its own rule now (copied, not inherited: same border/radius/background/padding/margin, plus the matching print rule) in this page's own `<style>` block. This isn't a narrower version of the same risk — it makes the collision **structurally impossible**, regardless of what Menu Calculator's code does or changes to next, since the two systems' queries can no longer find each other's elements at all. Deliberately did **not** try to patch this by scoping Menu Calculator's own query (can't — that file isn't touched here) or by monkey-patching `document.querySelectorAll` during injection (fragile, and treats the symptom rather than the cause).

**Other shared classes, checked and left alone.** `.menu-block-header`, `.menu-name-input`, and `.remove-block-btn` are also reused from Menu Calculator's own visual vocabulary, but none of them have a confirmed unscoped query touching them the way `.menu-block` did — every usage I could find is scoped to a specific block/container on both sides. Left as-is rather than renamed defensively; flagging them here in case a future change on either page ever adds an unscoped query against one of these.

**A bigger option, recommended but NOT done here — needs one thing confirmed first.** The tool dock's whole reason for existing is to avoid opening a second tab; its `rzRunIsolated` wrapper has to go to real lengths (shadowing `rzBroadcast` itself) purely to work around same-page BroadcastChannel not delivering messages back to itself. Since dish cost is 100% sync-based now (see 2026-09-08 entry) and cross-tab sync already works independently of the dock, the cleanest long-term fix is probably: **stop embedding Menu Calculator at all — replace "Pull from Menu Portion Creator" with a plain link that opens `menu-calculator.html` in a new tab**, and let the existing BroadcastChannel sync do the rest. That would remove this entire class of risk, not just this one instance of it, and delete a meaningful amount of fetch-inject-execute complexity along with it.

Not implemented this round because it hinges on one thing I can't verify without `costing-sync.js` in front of me: whether its real `rzBroadcast` (the non-dock one) reliably tags outgoing payloads with `source: 'menu-calculator'` on its own. I *know* the dock path does, because `rzRunIsolated` adds that tag itself, explicitly, in the shadow wrapper — that's the one path I've actually read. If the same tagging doesn't happen for a normal standalone tab, removing the dock would silently stop dish sync from working at all, which is a far worse regression than the bug just fixed. **Before making this change: either test it directly (open Menu Calculator in a genuinely separate tab with the current code, edit a dish, confirm it syncs into Margin Analysis live with the dock never touched), or ask whoever has `costing-sync.js` open to confirm the source-tagging behavior for non-dock broadcasts.** Happy to make this change the moment that's confirmed either way.

**Renamed "Menu" tab \u2192 "Menu Analyzer".** Requested directly, to keep "the dish list on this page" and "Menu Calculator, the other tool" unambiguous in conversation. Panel heading updated to match; the old heading text ("Your menu, at today's prices") kept as the lead sentence of the intro paragraph rather than dropped.

**Testing done, given I can't render a browser here:** `node --check` clean; grepped for any remaining `class="ma-dish-panel menu-block"` (or reversed order) — none found; re-verified every `getElementById` call in the JS against the HTML; HTML tag balance re-checked. **What I can't verify without a browser, and what actually matters most here:** that opening the dock, switching dishes in it, and switching Menu Calculator's own tabs no longer touch each other's visibility. That's the one thing worth testing directly before considering this closed.

## 2026-09-08 — Ingredient cost now comes from Menu Calculator only; own AI-estimate/manual entry removed

**Where this came from.** Two docs from the session that owns Menu Calculator and Costing Analysis — `MARGIN_AUDIT_HANDOFF.md` and `MULTI_MENU_SYNC_PLAN.md` — plus a direct steer in chat. Both are worth keeping around; this entry summarizes what actually shipped from them, not the full brief.

**The upstream fix that made this possible.** Every menu item block in Menu Calculator used to broadcast updates from only the *first* block on the page, regardless of which one you actually edited — `document.querySelector('.menu-block')` always returns the first match, full stop, it never meant "the one that changed." That's fixed upstream now: every block broadcasts its own updates, tagged with a stable `blockId` (e.g. `menublock-3`). Menu Calculator also grew its own Detailed / Simple / AI-estimate modes per item, with its own Worker behind the AI-estimate one.

**What that means here.** Margin Analysis had its own, completely separate AI-estimate/manual dish-costing UI — describe a dish or snap a photo, call `margin-audit-proxy-worker.js`, get a cost back. Once Menu Calculator can do all of that itself *and* reliably tell this page about it, keeping a second, disconnected way to arrive at a cost for what might be the same dish was pure redundancy — worse, a real risk of two different numbers for one dish. That whole UI, and everything behind it (`PROXY_ENDPOINT`, `resizeImageToBase64`, `handleDishPhoto`, `estimateDishCost`, `switchDishSource`, the AI-estimate/manual tab markup), is gone.

**What a dish panel asks for now: exactly two things.** Current price (RM) and Sold / day — the two numbers that are genuinely Margin Analysis's own job to ask, since Menu Calculator has no equivalent of "what do you currently charge" or "how many do you actually sell." Ingredient cost is display-only now, driven entirely by sync: a status line reads either "Ingredient cost not yet synced" or "Ingredient cost: RM3.85 ← synced from Menu Calculator."

**De-duping synced dishes.** The first time a dish panel is created from a sync payload, it's tagged `panel.dataset.syncedBlockId = blockId`. Every later payload for that same `blockId` finds the existing panel (`findDishPanelByBlockId`) and updates its cost, price, and name *in place* instead of creating a duplicate. A payload with no `blockId` at all (a shape from before this change) falls back to always creating a fresh dish, same as the old behavior — there's nothing to de-dupe against without one.

**An open question from the handoff doc, resolved one way.** "Should a dish panel keep any standalone way to add an item that doesn't exist in Menu Calculator yet, or should the rule become 'add it in Menu Calculator first, no shortcuts here'?" — deliberately left open there. Decided here: **kept.** "+ Add menu item" still creates a dish panel with no cost yet; it just sits at "not yet synced" (reads as RM0 ingredient cost in every calculation) until something matches it via `blockId`, if ever. Reasoning: removing the ability to even create a placeholder felt like a bigger, less reversible behavior change than what was actually asked for, and an unsynced dish fails safely (an obviously-wrong RM0 true cost, not a crash or a silently-stale number) rather than blocking the page from being useful before every dish exists in Menu Calculator.

**A second judgment call, flagged rather than silently made.** The handoff doc says a matched payload should "update its price/cost fields in place" — read literally, meaning both the stated selling price *and* the ingredient cost get overwritten on every sync, not just cost. That's what shipped: **every** matching sync payload updates both `Current price` and the ingredient cost, even on a dish that already existed and already had a manually-typed price. If that turns out to clobber a price you deliberately set differently from Menu Calculator's own suggestion, the fix is small — stop re-writing `ma-dish-price` after the dish's first creation — flagging it now rather than guessing wrong quietly.

**Naming collision, resolved.** The page itself is now titled "Margin Analysis" (H1, tab title, nav). The results half of the page was ALSO called "Margin Analysis" as an internal section label from the 2026-09-05 restructure — same name, two different things on the same screen. Renamed that section's eyebrow (and its floating nav button) to **"Results"** instead, so the page doesn't visually echo its own name back at the visitor. "Margin Calculation" (the input half) had no such collision and is unchanged.

**Nav sync.** `margin-audit-calculator.html`'s own dropdown now matches the current 7-item canonical list from `NAV_ORDER_STANDARD.md` — "Margin Analysis" label, `crypto-radar.html` appended at position 7. Every other page's nav was already updated by the other session; this page was the one gap.

**`margin-audit-proxy-worker.js` is now spare capacity.** Still deployed, still holding a real Gemini key, just with no caller left in this file. Not touched this round — flagging per the handoff doc's own suggestion that it's worth finding a genuine new use for it before assuming it should sit idle, rather than deciding that unprompted here.

**Testing done, given I can't render a browser here:** `node --check` clean; HTML tag balance re-verified; cross-checked every `getElementById` call in the JS against an id that actually exists in the HTML (one intentional exception — `ma-print-data-view`, created dynamically by `saveDataSnapshot()`, not present in static markup); grepped for every removed identifier (`PROXY_ENDPOINT`, `dishAiCost`, `dishAiImage`, `switchDishSource`, `handleDishPhoto`, `estimateDishCost`, `resizeImageToBase64`, `costSource`, `manualCost`, every `.ma-ai-*`/`.ma-source-*`/`.ma-manual-*` class) — none found outside of explanatory comments. Still worth clicking through for real: open the same dish in Menu Calculator via "Pull from Menu Portion Creator," edit it, and confirm the sync-status line updates in place rather than adding a second dish tab.

## 2026-09-05 — Split into Margin Analysis (top) and Margin Calculation (bottom, tabbed)

**The problem this fixes.** The page had two different places that both ended up managing the same dish list — a "Your menu, at today's prices" box up top with its own native AI-estimate/manual entry form, and a "Pull from Menu Portion Creator" button near the footer that opened a completely different tool in a dock and ALSO created dishes into that same top box. Editing a dish meant knowing which of the two mechanisms had created it. Overhead, utilities, and manpower had a similar split: native fields in one box, plus a "Pull from Overhead & Manpower" button elsewhere doing the same job through a different UI.

**The fix — two sections, one job each.**

- **Margin Analysis** (top, right under the wizard): pure output. True cost breakdown, what your menu is earning, per-item breakdown, the popularity/margin quadrant, cost-structure pies, and insights. Nothing here is a cost input — "Your target margin %" and the guide-venue dropdown only change how results are *compared* or *labeled*, never the math itself.
- **Margin Calculation** (near the footer): every actual cost input, now including the dish list that used to live in its own box up top. Split into four tabs — **Menu**, **Fixed Overhead**, **Variable Overhead**, **Manpower** — plus a **Reset all** button. Each tab is an independent show/hide toggle, not a switcher: opening Fixed Overhead doesn't close Menu, and closing a tab never clears what's inside it — same idea as a native `<details>` element, just styled as pill buttons to match the rest of the site. A shared "Operating days / month" field sits above the four tabs since every one of them depends on it (dish volume/month, utility usage/month, and the per-portion overhead/manpower split all read from the same number).

Printing Calculator has been removed as a pull-from source on this page specifically — printing isn't a food cost, so it had no business in a *food* margin tool. `printing-calculator.html` itself is completely untouched and still reachable directly and from Interactive Costing Analysis. If a services-margin sibling tool gets built later (see KIV list below), it can offer its own pull-from-Printing-Calculator button.

**Reset All vs. closing a tab — these are deliberately different actions.** Clicking a tab button toggles that tab's visibility only; nothing is ever lost by opening or closing a tab. **Reset all**, at the end of the tab row, is the only control that clears data, and it asks for confirmation first because it can't be undone — it puts every field in Margin Calculation back to its starting default (one empty dish, default rent/manpower, the four default electricity items, default water/gas settings), the same state as a fresh page load. It does not touch the wizard answers, the target margin, or the guide-venue dropdown, since those live in Margin Analysis, not Margin Calculation.

**Floating nav is now two buttons, not one.** With results at the top of the page and inputs at the bottom, a single "back to top" button no longer covered the actual need — now there's "↑ Margin Analysis" and "↑ Margin Calculation", both visible as soon as the wizard is done, not just while the tool dock happens to be open.

**Utilities are now three separate boxed cards, not one shared block.** Electricity, Water, and Gas each get their own bordered card with a colored top edge, inside the Variable Overhead tab — colors are reused from the site's existing tool-dock theme tokens (teal for electricity, blue for water, rust for gas), not new palette entries.

**Nothing about the underlying math changed.** True cost, contribution margin, the quadrant classification, the structure-comparison pies — every formula is byte-for-byte what it was before. This round was entirely about where you enter numbers and how it's organized on the page, not what gets calculated from them.

**Testing done, given I can't render a browser here:** `node --check` on the full JS file (clean); HTML tag balance verified (`<section>`, `<div>`, `<table>`, `<thead>`, `<tbody>`, `<tr>` all matched open/close counts); every DOM id referenced by the JS confirmed present in the HTML; grepped for leftover references to every element this round removes (`tool-dock-hide-btn`, the old single `rz-back-to-top`, `updateConnectorActiveState`, the old `.connector-btn` classes, any printing-calculator *button* wiring) — none found outside of explanatory comments. None of this replaces actually clicking through it on a phone, especially: tapping each calc-tab open/closed a few times in a row, confirming Reset All's confirm-dialog wording reads right, and pulling from Menu Portion Creator / Overhead & Manpower to check both the dish sync and the "which tabs auto-open" behavior.

**KIV, not built — services-margin sibling tool.** Printing Calculator (and any other non-food service costing) would get its own margin-audit-style page later, reusing this same Margin Analysis / Margin Calculation split and the same tool-dock mechanism, just pulling from Printing Calculator instead of Menu Calculator. Not started.

**KIV, not built — direct link between Fixed Overhead and Variable Overhead's shared "operating days".** Right now both tabs (plus Menu) all read the one shared `ma-operating-days` field correctly already, so there's no bug here — just noting that if a future request wants operating days to be per-tab instead of shared, that's a bigger structural change than it looks (utilities math, dish monthly-volume math, and the per-portion overhead/manpower split all assume one shared number).

## Jargon index

| Term | Plain-English meaning |
|---|---|
| Margin Analysis | The whole page's name, as of 2026-09-06 (was "Margin Audit") — shown in the nav, the tab title, and the H1. |
| Results | The top section of the page (was internally called "Margin Analysis" too, until that collided with the page's own new name). Everything in it is a *result* — nothing here is typed in to drive a calculation. |
| Margin Calculation | The section near the footer where you actually enter numbers, organized into four tabs. |
| Calc-tab | One of the four buttons (Menu / Fixed Overhead / Variable Overhead / Manpower) in Margin Calculation. Each independently shows or hides its own panel — it's a toggle, not a switch between mutually-exclusive views. |
| Fixed overhead | Costs that stay roughly the same no matter how much you sell — rent, licenses, and similar. |
| Variable overhead | This tool's utilities — electricity, water, gas — which change with usage. |
| True cost | Ingredient cost + a fair per-portion share of overhead (fixed + utilities) + a fair per-portion share of manpower. The two "fair share" numbers are the same for every dish; only the ingredient cost varies dish to dish. |
| Contribution margin (CM) | Price charged minus true cost, per portion — what's actually left over per sale once every real cost is counted. |
| Quadrant (Star / Plowhorse / Puzzle / Dog) | The standard menu-engineering classification: popular-and-profitable, popular-but-thin-margin, profitable-but-rarely-ordered, or neither. Popularity is volume-weighted so a high margin *percentage* on a low-volume item doesn't get mistaken for a Star. |
| Tool dock | The panel that loads another tool's real page (Menu Portion Creator or Overhead & Manpower Calculator) directly into this page, so you can use that tool's own interface without leaving this one. |
| Pull from / sync | Using the tool dock (or a live BroadcastChannel if Menu Calculator happens to be open in another tab) to bring a number computed in another tool into this page automatically, instead of retyping it. |
| blockId | A stable id Menu Calculator now stamps on every menu block (e.g. `menublock-3`) and includes in every sync broadcast. Lets Margin Analysis tell "this is an update to a dish I already have" apart from "this is a new dish," instead of guessing. |
| Synced vs. unsynced dish | A dish panel is "synced" once a matching `blockId` payload has given it an ingredient cost; until then it's "unsynced" and reads as RM0 ingredient cost in every calculation, clearly flagged on its own status line. |
| Reset all | The one destructive control in Margin Calculation — clears every dish and puts overhead/utilities/manpower back to their starting defaults. Confirms before doing it, since it can't be undone. |
| Guide ratio | A rough, editable benchmark ingredient/overhead/manpower/margin split for a given venue type (home-based, stall, truck, store) — comparison only, never feeds the math. |

## Settings reference

| Setting | Current value | Where to change it |
|---|---|---|
| Default rent/fixed overhead on a fresh page (and after Reset all) | RM900/month | `RENT_DEFAULT`, `margin-audit-calculator.js` |
| Default manpower on a fresh page (and after Reset all) | RM1,200/month | `MANPOWER_DEFAULT`, `margin-audit-calculator.js` |
| Default operating days/month | 26 | `OPERATING_DAYS_DEFAULT`, `margin-audit-calculator.js` |
| Default electricity equipment list | Rice cooker, Exhaust fan, Fridge, Lighting (with typical watts/hours) | `ELECTRICITY_DEFAULTS`, `margin-audit-calculator.js` |
| Electricity rate | RM0.28/kWh (Sarawak Energy stated average) | `ELECTRICITY_RATE_DEFAULT`, `margin-audit-calculator.js` |
| Default water usage on a fresh page | 500 L/day | `WATER_LITERS_DEFAULT`, `margin-audit-calculator.js` |
| Water tariff (Sarawak W3 commercial) | RM22.00 minimum, RM0.97/1,000L up to 25,000L, RM1.06 beyond | `WATER_TARIFF`, `margin-audit-calculator.js` |
| Gas cylinder size | 14 kg | `GAS_CYLINDER_KG`, `margin-audit-calculator.js` |
| Gas subsidised threshold | 42 kg (three cylinders) | `GAS_SUBSIDISED_THRESHOLD_KG`, `margin-audit-calculator.js` |
| Gas prices per 14 kg (household / commercial) | RM26.60 / RM70.00 | `GAS_PRICE_HOUSEHOLD_DEFAULT` / `GAS_PRICE_COMMERCIAL_DEFAULT`, `margin-audit-calculator.js` |
| Menu-engineering popularity threshold | 70% of an even/fair share across all items | `computeQuadrant()`, `margin-audit-calculator.js` |
| Guide ratios per venue type | See `GUIDE_RATIOS` | `GUIDE_RATIOS`, `margin-audit-calculator.js` |
| Which tab opens by default | Menu (open); Fixed Overhead / Variable Overhead / Manpower (closed) | `setCalcTabOpen(...)` calls in `init()`, `margin-audit-calculator.js` |
| Which external tools are offered as "Pull from" | Menu Portion Creator, Overhead & Manpower Calculator (Printing Calculator intentionally excluded) | `TOOL_DOCK_CONFIG`, `margin-audit-calculator.js` |
| Utility box accent colors (Electricity / Water / Gas) | Teal / blue / rust (reused from existing site tokens, no new colors added) | `.ma-util-elec` / `.ma-util-water` / `.ma-util-gas`, `margin-audit-calculator.html` `<style>` block |
| Does a re-sync overwrite an already-set "Current price"? | Yes — every matching sync updates both price and cost, not cost alone (see 2026-09-08 entry's second judgment call) | `handleSyncPayload()`'s `menu-calculator` branch, `margin-audit-calculator.js` |
| Can a dish exist with no Menu Calculator match at all? | Yes — shows "not yet synced," reads as RM0 ingredient cost | `getDishCost()` / `renderDishSyncStatus()`, `margin-audit-calculator.js` |
| ~~AI-estimate/manual dish costing~~ | Removed 2026-09-08 — cost is sync-only now | n/a |

## Deploy checklist

- [ ] `margin-audit-calculator.html` and `margin-audit-calculator.js` → push to GitHub Pages as usual. Both are full-file replacements this round, not patches.
- [ ] No Worker changes needed to ship this — `margin-audit-proxy-worker.js` is untouched. It's no longer called from anywhere in this file though (see 2026-09-08 entry); it isn't broken, it's just idle, worth a look before assuming it should stay that way.
- [ ] Confirm `costing-sync.js` and `nav-dropdown.js` are already deployed (this page depends on both, unchanged from before) — and confirm the deployed `menu-calculator.js` is the version that broadcasts per-block with `blockId`, or the de-dupe logic here has nothing to match against yet.
