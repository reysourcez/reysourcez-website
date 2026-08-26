# Reysourcez 2nd Iteration — Complete Testing Guide

**Duration:** ~20 minutes (2 iterations combined)  
**Coverage:** 14 tests across all 3 calculator pages + Costing Analysis

---

## Test 1: Layout Stability (Issue #5)

**Where:** Menu Calculator page  
**What:** Scroll stability when data entered

**Steps:**
1. Open Menu Calculator
2. Add 5 ingredients with data
3. Scroll down slowly
4. Watch page right edge — should NOT jitter left/right

**Expected:** ✅ Page stays aligned; no scrollbar shift jitter  
**Status:** Pass / Fail: ___

---

## Test 2: Desktop Tooltips (Issue #6)

**Where:** All calculator pages  
**What:** Hover tooltips appear correctly

**Steps:**
1. Open Menu Calculator
2. Hover over **?** icon next to "Inflation Buffer %"
3. Dark popover should appear above icon with text about supplier price rises
4. Move mouse away → popover disappears
5. Repeat for other tooltips:
   - "Target Food Cost %"
   - "Sold via delivery app"
   - "SST registered"
   - "Amortize" (Overhead & Manpower page)

**Expected:**  
- ✅ Tooltip text appears above icon on hover
- ✅ Arrow pointer below text
- ✅ Matches design (dark background, white text)
- ✅ Disappears when mouse leaves

**Status:** Pass / Fail: ___

---

## Test 3: Mobile Tooltips Hidden (Issue #6)

**Where:** All pages (mobile view)  
**What:** Tooltips are hidden on mobile

**Steps:**
1. Open browser dev tools (F12)
2. Set viewport to mobile (375px width)
3. Scroll through Menu Calculator
4. Look for **?** icons

**Expected:** ✅ NO question mark icons visible anywhere on mobile  
**Status:** Pass / Fail: ___

---

## Test 4: Selling Price Sync (Issue #2) — CRITICAL

**Where:** Menu Calculator ↔ Costing Analysis

**Setup:**
- Menu Calculator in tab 1
- Costing Analysis in tab 2

**Steps:**
1. Menu Calculator: Create ingredient "Chicken" RM3.00
2. Create menu "TestDish"
3. Add ingredient amount: 100g
4. Set Target Food Cost % = 30%
5. Check "Sold via delivery app" (30% commission + 8% tax on commission)
6. Leave SST unchecked
7. Read "Price to list" value (should be ~RM5.00)
8. Go to Analysis tab
9. Look for "Open Menu Portion Creator" button → click it
10. Analysis page should now show:
    - "Ingredients & packaging" = **RM3.00** ✅ (cost synced)
    - "Selling price" = **~RM5.00** ✅ (price synced - NEW FIX)
    - Both have badges "← Menu Portion Creator (TestDish)"

**Expected:**  
- ✅ Ingredient cost appears in Analysis
- ✅ Selling price appears in Analysis (this was broken, now fixed)
- ✅ Both have sync badges

**Status:** Pass / Fail: ___

---

## Test 5: Pessimistic Preset (Issue #7)

**Where:** Costing Analysis

**Steps:**
1. Open Costing Analysis
2. Complete wizard (pick "home-based")
3. Scroll to "Volume" section
4. Click "Pessimistic (50/day)" button
5. Check "Sales volume (portions/day)" number box

**Expected:** ✅ Shows 50 (not 100)  
**Status:** Pass / Fail: ___

---

## Test 6: Add Item Button Styling (Issue #14)

**Where:** Menu Calculator

**Steps:**
1. Scroll to "Menu Portion Creator" section
2. Click "+ Add Menu"
3. Inside the menu block, look for "+ Add item to menu" button
4. Button color should be **TEAL/GREEN** (primary color)
5. Compare to "+ Add overhead item" button (Overhead page) — should match

**Expected:** ✅ Button is teal/green (primary color, not gray)  
**Status:** Pass / Fail: ___

---

## Test 7: Save PDF Button Position (Issue #14)

**Where:** Menu Calculator, Overhead & Manpower, Costing Analysis

**Steps on each page:**
1. Find the page title section (top)
2. "Save as PDF" button should be on **right side** of the title area
3. On mobile (narrow screen), button should stack below title (not squeeze it)

**Desktop Expected:** Title [space] Save PDF button (right-aligned)  
**Mobile Expected:** Title stacked above Save PDF button  
**Status:** Pass / Fail: ___

---

## Test 8: Help Text Position (Issue #15)

**Menu Calculator:**
1. Scroll to BOTTOM of page (before footer)
2. Find section titled "How it's calculated:"
3. Contains text about Yield %, Wastage %, Inflation

**Overhead & Manpower:**
1. Scroll to BOTTOM
2. Find section titled "About the numbers:"
3. Contains text about EPF, SOCSO, EIS

**Expected:** ✅ Help sections at END of pages, not interrupting form  
**Status:** Pass / Fail: ___

---

## Test 9: Footer Simplification (Issue #16)

**All pages:**
1. Scroll to bottom (footer area)
2. Should see only: "© 2026 Reysourcez Enterprise. All rights reserved."
3. NO links to Home, About, Services
4. NO tagline "We focus on providing catered solutions..."

**Expected:** ✅ Minimal footer, copyright only  
**Status:** Pass / Fail: ___

---

## Test 10: Tab Switcher (Issue #3 — Partial)

**Setup:** Have Menu Calculator + Analysis open in separate windows

**Steps:**
1. Bottom-right corner: look for **⋮** (three-dot circle button)
2. Click it → menu appears with list of open tabs
3. Click "Menu Portion Creator" → switches/opens that tab
4. Manually go back to Analysis tab
5. Click ⋮ button again
6. Click "Menu Portion Creator (back)"

**Expected:**
- ✅ Switcher button appears when multiple tabs open
- ✅ Clicking menu items switches tabs
- ⚠️ "Back" button may not auto-focus (known issue, KIV)

**Status:** Pass / Fail: ___  
**Known Issue:** Back button doesn't auto-focus (OK for now)

---

## Test 11: Cost Structure Bar Width (Issue #9) — NEW

**Where:** Costing Analysis

**Steps:**
1. Complete wizard
2. Scroll to "Cost Structure: Your Numbers vs. Guide"
3. Look at the colored bar for "Your numbers"
4. Measure bar width visually (should be fixed width)
5. Adjust "Sales volume (portions/day)" slider left/right
6. Watch the bar for "Your numbers"

**Expected:**
- ✅ Bar stays SAME WIDTH (300px fixed)
- ✅ Internal colored segments CHANGE WIDTH as percentages shift
- ✅ When you decrease volume, segments resize but bar width unchanged
- ✅ "Guide: home" bar also exactly same width as "Your numbers"

**Before (bug):** Bars would shrink/expand with percentages  
**After (fixed):** Bars fixed at 300px, only internal segments change

**Status:** Pass / Fail: ___

---

## Test 12: Cost Structure Dropdown Position (Issue #8) — NEW

**Where:** Costing Analysis

**Steps:**
1. Scroll to "Cost Structure" section
2. Look at the row with colored legend squares:
   - [Green] Ingredients
   - [Blue] Overhead
   - [Gold] Manpower
   - [Pink] Margin
3. On the RIGHT SIDE of this legend row, find "Guide: [Home ▼]" dropdown
4. Click dropdown → options appear
5. Select "Stall / hawker" → bars update immediately
6. Check alignment on mobile (narrow screen)

**Expected:**
- ✅ Dropdown is on SAME LINE as legend (not above/below)
- ✅ Dropdown right-aligned (uses margin-left: auto)
- ✅ Changes venue immediately update bars
- ✅ On mobile, legend wraps if needed but dropdown still visible

**Before:** Dropdown was in separate row above legend ("Guide for: [Home ▼]")  
**After:** Dropdown inline with legend on right side ("Guide: [Home ▼]")

**Status:** Pass / Fail: ___

---

## Test 13: Percentage Display Removed (Issue #10) — NEW

**Where:** Costing Analysis

**Steps:**
1. Scroll to "Cost Structure" section
2. Look at the colored bar for "Your numbers"
3. To the RIGHT of the bar, look for text like "33% / 4% / 5% / 58%"

**Expected:** ✅ NO percentage text visible on right side of bars  
**After change:** Percentages are now implicit in:
- Bar segment widths (visual representation)
- Legend colors (color coding)
- Hover tooltips on segments (if you hover over a segment, shows %)

**Before:** Numbers appeared "33% / 4% / 5% / 58%" at bottom-right  
**After:** Numbers removed for cleaner UI

**Status:** Pass / Fail: ___

---

## Test 14: Ehailing/Tax/SST Display (Issue #13) — NEW

**Where:** Menu Calculator → Menu Portion Creator

**Steps:**
1. Create ingredient RM3.00
2. Create menu
3. Check "Sold via delivery app" (30% commission + 8% tax)
4. Check "SST registered" (6%)
5. Look at breakdown below "Price to list"

**Expected:**
- ✅ Shows "Price to list: RM X"
- ✅ Shows "− Commission: RM Y"
- ✅ Shows "− Tax on commission: RM Z"
- ✅ Shows "− SST: RM W"
- ✅ Shows "= You keep: RM (total)"
- ✅ Breakdown is logical and clear

**Verdict:** Display is already well-designed ✅  
**Status:** Pass / Fail: ___

---

## Master Checklist

### 1st Iteration Tests
- [ ] Test 1: Layout stable
- [ ] Test 2: Desktop tooltips
- [ ] Test 3: Mobile tooltips hidden
- [ ] Test 4: Selling price syncs ✅ **CRITICAL**
- [ ] Test 5: Pessimistic = 50/day
- [ ] Test 6: Add item button green
- [ ] Test 7: Save PDF positioned top-right
- [ ] Test 8: Help text at bottom
- [ ] Test 9: Footer minimal
- [ ] Test 10: Tab switcher works (mostly)

### 2nd Iteration Tests (NEW)
- [ ] Test 11: Cost bars fixed width
- [ ] Test 12: Dropdown in legend row
- [ ] Test 13: Percentages removed from bars
- [ ] Test 14: Ehailing display verified

---

## Go/No-Go Decision

**Go to Production if:**
- ✅ All tests 1-10 pass
- ✅ Tests 11-14 pass
- ⚠️ Test 10 partial OK (tab switcher works, back button doesn't auto-focus)

**No-Go if:**
- ❌ Any critical test fails (especially #4, #11, #12)
- ❌ Layout broken on mobile

---

## Quick Failure Troubleshooting

| Symptom | Possible Cause | Check |
|---------|---|---|
| Tooltips don't appear | CSS not loaded | Cache: clear browser cache, hard refresh (Ctrl+Shift+R) |
| Bars wrong width | JS not loaded | Check console (F12) for errors |
| Selling price doesn't sync | Old JS file | Force refresh, check file version in console |
| Dropdown not visible | CSS float issue | Check via browser dev tools (Inspect) |

---

## Questions?

If any test fails:
1. Screenshot the issue
2. Note which browser/OS
3. Note exact test # that failed
4. Check browser console (F12) for JavaScript errors
5. Try hard refresh (Ctrl+Shift+R) to clear cache

---

**Ready to test?** Use this guide step-by-step. Should take 15-20 minutes.

**Files to test:**
- `/mnt/user-data/outputs/menu-calculator.html`
- `/mnt/user-data/outputs/overhead-manpower-calculator.html`
- `/mnt/user-data/outputs/interactive-costing-analysis.html`
- All corresponding `.js` files above
- `styles.css`

Happy testing! 🎉
