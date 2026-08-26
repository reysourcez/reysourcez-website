# Reysourcez Enterprise — 1st Iteration Changelog

**Date:** 26 Aug 2026  
**Model Used:** Claude Haiku 4.5  
**Status:** Ready for testing

---

## Issues Addressed (✅ Complete)

### Bug Fixes

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 2 | Selling price not transferring from menu to analysis | ✅ Fixed | Now syncs `listedPrice` from Menu Portion Creator → Analysis `sell-price` field |
| 5 | Layout shift when data inserted (scrollbar appearing) | ✅ Fixed | Added `overflow-y: scroll` to body to maintain consistent scrollbar width |
| 7 | Pessimistic button should be 50/day not 100 | ✅ Fixed | Updated button label from "100/day" to "50/day" |

### UX & Design Improvements

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 6 | Excessive inline notes suffocating space | ✅ Improved | Replaced inline text with hover tooltips (question mark icon); hidden on mobile |
| 14 | "Add item to menu" doesn't look clickable | ✅ Fixed | Changed button class from `btn-secondary` to `btn-primary` for better visibility |
| 14 | Save PDF button positioning | ✅ Fixed | Moved all "Save as PDF" buttons to top-right of calc intro section |
| 15 | "How it's calculated" note positioning | ✅ Moved | Moved to bottom of page (Menu Creator & Overhead/Manpower) to keep form upwards |
| 16 | Footer wasting space | ✅ Simplified | Removed all site/contact links, kept only copyright notice |

---

## Changes by File

### `styles.css`
- **Layout shifts:** Added `overflow-y: scroll` to `body` (fixes #5)
- **Tooltips:** New `.tooltip-icon` class with hover-based popover styling
  - Shows on desktop hover via `::after` and `::before` pseudo-elements
  - Hides on mobile (max-width: 600px)
- **Footer:** Hidden all `.footer-grid`, `.footer-brand`, `.footer-links` elements; only `.footer-bottom` shows
- **Calc intro header:** New `.calc-intro-header` flex layout for Save PDF button positioning (top-right)
- **Analysis page:** New `.analysis-top-bar` for Edit Answers + Save PDF side-by-side layout

### `menu-calculator.html`
- **Inflation label:** Added tooltip icon with "Forward buffer for supplier price rises"
- **Calc intro:** Wrapped content in `calc-intro-header` flex container; moved Save PDF button here
- **Section reorder:** Moved `.calc-note` from before menu-builder to end of page
- **Buttons:** Styled add-menu-row button class change in JS

### `menu-calculator.js`
- **Target Food Cost label:** Added tooltip "As % of selling price — lower % means higher margin"
- **Delivery app checkbox:** Added tooltip "Platform takes commission; you also pay tax on that commission"
- **SST checkbox:** Added tooltip "Sales & Service Tax on the selling price"
- **Add item button:** Changed class from `btn-secondary` to `btn-primary` in createMenuBlock
- **Sync broadcast:** Enhanced to include `sellingPrice` (the `listedPrice`) alongside `costPerPortion`

### `overhead-manpower-calculator.html`
- **Calc intro:** Wrapped in `calc-intro-header` flex; moved Save PDF button here
- **Section reorder:** Moved `.calc-note` from top to bottom of page
- **Grand total section:** Removed duplicate Save PDF button

### `overhead-manpower-calculator.js`
- **Amortize field:** Added tooltip inside "Over X months" span: "Spread this one-time cost across how many months to get a monthly figure"

### `interactive-costing-analysis.html`
- **Analysis top bar:** New layout with Edit Answers link and Save PDF button side-by-side (top-right)
- **Selling price label:** Wrapped in `<span class="label-text">` and added `id="sell-price-label"` for sync badges
- **Pessimistic button:** Updated label from "(100/day)" to "(50/day)"
- **Removed:** Duplicate Save PDF button from inside inputs section

### `interactive-costing-analysis.js`
- **Selling price sync:** Added handler in `initSync()` to receive and apply `data.sellingPrice` from menu calculator
- **Sync badge:** Now marks the selling price label when value is synced from Menu Portion Creator

---

## Tooltips Added

### Menu Creator
1. **Inflation Buffer %** → "Forward buffer for supplier price rises — applies uniformly to all items"
2. **Target Food Cost %** → "As % of selling price — lower % means higher margin"
3. **Sold via delivery app** → "Platform takes commission; you also pay tax on that commission"
4. **SST registered** → "Sales & Service Tax on the selling price"

### Overhead & Manpower
1. **Amortize months** → "Spread this one-time cost across how many months to get a monthly figure"

### Design
- **Mobile:** Tooltips hidden (`:hover` doesn't exist on touch devices)
- **Desktop:** Hover on question-mark icon → dark popover appears above, with arrow pointer
- **Styling:** Uses `data-tooltip` attribute for reusability

---

## KIV (Keep In View) for Sonnet 5 Max

The following require architectural changes and should be tackled with Sonnet 5 Max:

| # | Issue | Reason |
|---|-------|--------|
| 4 | Multi-menu dropdown + tracking all menus for analysis | Requires sync broadcast redesign + state management for multiple menus |
| 12 | Tab-based menu/overhead instead of scroll | Requires major DOM restructure + tab state machine |
| 1 | Button placement (Open Menu / Open Overhead beneath headers) | Can be added now if desired, but tied to feature #4 |
| 3 | Floating tab switcher not refocusing Analysis | May be BroadcastChannel timing issue; needs debugging with higher model |

---

## Testing Checklist

- [ ] Desktop: No layout shift when entering data in menu
- [ ] Desktop: Hover tooltips appear on question marks
- [ ] Mobile: Tooltips are hidden; layout unbroken
- [ ] Menu → Analysis: Ingredient cost syncs ✅
- [ ] Menu → Analysis: Selling price now syncs ✅ (was missing before)
- [ ] Footer on all pages: Only shows copyright
- [ ] Save PDF buttons: Top-right position on all calc pages
- [ ] "How it's calculated" notes: Bottom of page, not interrupting form
- [ ] Pessimistic preset: Sets 50/day (not 100/day)
- [ ] "Add item to menu" button: Looks like a primary button

---

## Build Info
- **Build Date:** 26 Aug 2026, ~18:00 MYT
- **Files Modified:** 8 (styles.css, 3x .html, 3x .js, + this changelog)
- **New Dependencies:** None
- **Breaking Changes:** None
- **Backwards Compatible:** ✅ Yes

Ready to push to GitHub Pages when verified.
