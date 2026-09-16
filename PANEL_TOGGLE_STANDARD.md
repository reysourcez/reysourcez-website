# Panel Toggle / "Queue" standard (added 2026-09-16)

**For the AI building or updating any page.** Paste this alongside
AI_BUILD_BRIEF.md, same as NAV_ORDER_STANDARD.md — treat it as a hard
rule, not a suggestion. This tightens AI_BUILD_BRIEF.md's existing
"One form/panel open at a time" bullet into something with an actual
shared implementation behind it, instead of every page hand-rolling
its own version slightly differently.

## The rule

For any panel that's genuinely **optional** — it can be closed down to
showing nothing, it's not one of a fixed set where something must
always be visible:

1. Clicking its trigger button opens it.
2. Clicking that **same** trigger again closes it (back to nothing open).
3. Opening a **different** trigger in the same group always closes
   whatever was open first — never two of these panels open together.

No stacking, anywhere, full stop. This applies to a "Pull from"
connector dock, an expandable detail/category section, a jump-to
panel — anything a user opens and might want to close again, not just
switch away from.

**What this is NOT for:** a mandatory-selection tab strip where
something must always be showing and "closed to nothing" isn't a real
state for it — Menu Calculator's Manual/AI-estimate cost tabs and its
Detailed/Simple sub-tabs (`setCostTab`/`setManualSub`) are the
reference example. Those already only ever show one at a time (that
part of the rule was always true for them) and stay exactly as they
are — plain switch-only tabs, `panel-toggle.js` not needed. If a
page's "one at a time" panels turn out to be this mandatory-tab shape
rather than a genuinely closable one, plain switch-tabs are correct
and this doc doesn't add anything for that page.

## Don't hand-roll it — use `panel-toggle.js`

A shared utility script, same idea as `nav-dropdown.js`: include it
only on pages that actually have at least one optional/closable panel
(same opt-in-if-relevant spirit as `costing-sync.js`, not mandatory
like `nav-dropdown.js`), positioned in the same load order — after
`nav-dropdown.js`, before the page's own script:

```html
<script src="costing-sync.js?v=4" defer></script>
<script src="nav-dropdown.js?v=1" defer></script>
<script src="panel-toggle.js?v=1" defer></script>
<script src="your-page.js?v=N" defer></script>
```

Then register each trigger+panel pair once, all sharing one
`groupName` string per set of mutually-exclusive panels on that page:

```js
rzRegisterPanel('some-group-name', 'panel-key', {
  triggerEl: someButtonElement,
  panelEl: somePanelElement,
  floatingEls: [someFloatingButtonElement],   // optional — see below
  onOpen: () => { /* fill in / reveal whatever this panel needs */ },
  onClose: () => { /* optional cleanup */ },
});
```

`rzTogglePanel`, `rzCloseAllPanels`, and `rzIsPanelOpen` are the other
three functions it exposes — full API comment is at the top of
`panel-toggle.js` itself. Interactive Costing Analysis's "Pull from"
tool dock (`initToolDockConnectors`/`rzFillToolDock` in
interactive-costing-analysis.js) is the live, working reference
implementation — including the trickier case of **one shared panel
element that different triggers load different content into**, which
is exactly what `onOpen`/`onClose` are for.

## This is also the fix for "the floating button goes missing"

Register a floating button as one of the panel's `floatingEls` and it
gets shown/hidden in the exact same pass as the panel itself, inside
one function (`rzTogglePanel`). That's the structural fix for a
button going missing (or staying missing) when you open a different
panel: the previous, common failure pattern is a page tying a floating
button's visibility to ONE specific panel's own toggle function, so
switching to a DIFFERENT panel's own (separately hand-rolled) toggle
function never touches that first button's hide/show logic at all —
it can't be told to reappear by code that doesn't know it exists.
Registering the button through `panel-toggle.js` instead means there's
exactly one place that controls its visibility, tied to the panel it
actually belongs to, not one hand-rolled path per page that has to
remember to handle it correctly.

Costing Analysis's own dock + `#rz-back-to-top` button was checked
against this — its old hide/show logic was already atomic enough that
this specific symptom wasn't present there, but the toggle-close gap
was (see below), and the whole flow now goes through `panel-toggle.js`
regardless, so it's covered either way. This session doesn't have
Margin Audit's, Rental Calculator's, or Cost Structure Checker's
current code to check directly — see the retrofit list below.

## What actually changed in Costing Analysis (worked example)

The "Pull from" tool dock previously had no way to close by re-clicking
the same connector button — clicking "Menu Portion Creator" while it
was already showing just re-scrolled to it; you had to reach for the
separate Hide/× button instead. That's the toggle-close gap this
standard fixes. Behavior now:

- Click a connector button while its tool is showing → dock closes.
- Click a connector button for a tool that's loaded but currently
  hidden (closed via Hide/×, or you switched to a different tool and
  back) → reveals it again, doesn't refetch, doesn't lose anything
  typed in there.
- Click a connector button for a genuinely different tool → closes
  whatever was open, loads the new one fresh (unchanged from before —
  switching tools was always meant to reset one).

## Retrofit checklist

This session has direct access to `interactive-costing-analysis.js`
(done, above), `menu-calculator.js`, and `overhead-manpower-calculator.js`
— the latter two don't currently have any genuinely-optional/closable
panel (their tabs are all the mandatory-selection kind), so neither
needed a change here.

Flagged as still stacking, per the person building this: **Margin
Audit** and **Rental Calculator**. Also worth checking once
available: **Cost Structure Checker** (its Ingredients/Manpower-style
category panels are exactly the shape this standard targets — see the
worked comparison this doc's rule is based on), **Printing
Calculator**, and **Food Worth**. This session doesn't have any of
those five files, so couldn't check or patch them directly this pass —
whoever picks them up next:

1. Find each page's existing "open a panel, maybe hide another one"
   logic (its own hand-rolled version of what `panel-toggle.js` now
   does centrally).
2. Add the `panel-toggle.js?v=1` script tag (load order above).
3. Replace the hand-rolled show/hide calls with `rzRegisterPanel()` +
   `rzTogglePanel()`/`rzCloseAllPanels()`, following
   `initToolDockConnectors()` in interactive-costing-analysis.js as
   the template — including for a floating button, if the page has
   one tied to that panel's visibility (Margin Audit's Analysis/
   Calculation floating buttons are worth checking here specifically,
   given the reported symptom).
4. Bump that page's own script version and confirm no dead references
   to whatever function names get removed (`grep` for them, same
   check this session ran on interactive-costing-analysis.js).

## Pages this currently applies to

`interactive-costing-analysis.html` (done). Needs checking/retrofitting:
`margin-audit-calculator.html`, `rental-calculator.html`,
`cost-structure-checker.html` (if live), `printing-calculator.html`,
`food-worth-calculator.html`. Not needed: `menu-calculator.html`,
`overhead-manpower-calculator.html` (no closable panels on either page
today — re-check this list if either one gains one later).
