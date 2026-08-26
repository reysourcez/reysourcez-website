# 1st Iteration — Quick Testing Guide

**Test Duration:** ~10-15 minutes  
**Devices:** Test both desktop and mobile (mobile browser dev tools)

---

## Test 1: Layout Stability (Issue #5)

**Steps:**
1. Open Menu Calculator in browser
2. **Desktop:** Scroll down, add 5 ingredients with data
3. Watch right edge of page — does it stay aligned? (should not jump left/right)
4. **Mobile:** Do the same in mobile view — page should be stable

**Expected:** No jittery left/right shifts when scrollbar appears/disappears  
**Status:** ✅ If stable

---

## Test 2: Tooltips (Issue #6)

**Desktop:**
1. Open Menu Calculator
2. Hover over **?** icon next to "Inflation Buffer %"
3. Dark popover should appear above icon with text
4. Move mouse away → popover disappears

**Mobile:**
1. Open Menu Calculator in mobile view
2. Look for **?** icons — should NOT be visible
3. Scroll down — no question mark icons anywhere

**Expected:**  
- ✅ Desktop: Tooltips appear on hover
- ✅ Mobile: Tooltips hidden (no question marks)

**Locations to check:**
- Menu Creator: Inflation, Target Food Cost, Delivery app, SST
- Overhead & Manpower: Amortize field

---

## Test 3: Selling Price Sync (Issue #2) — CRITICAL

**Setup:**
1. Open Menu Calculator **in one tab**
2. Open Costing Analysis **in another tab**

**Steps:**
1. Menu Calculator: Add ingredient (e.g., RM3 cost)
2. Create menu "TestDish"
3. Set Target Food Cost % = 30%
4. Check "Sold via delivery app" with 30% commission (no extra tax for simplicity)
5. Look at "Price to list" — should show ~RM5 (cost 3 ÷ 0.3 with delivery markup)
6. Go to Analysis tab (should see "Open Menu Portion Creator" button)
7. Click the button → Menu Calculator opens/focuses in new window
8. **Check Analysis page:**
   - "Ingredients & packaging" field: should show **RM3.00** ✅ (cost synced)
   - "Selling price" field: should show **~RM5.00** ✅ **NEW** (price synced)
   - Both fields should have badges "← Menu Portion Creator (TestDish)"

**Expected:** Both cost AND selling price sync from menu to analysis  
**Status:** ✅ If both values appear with badges

---

## Test 4: Pessimistic Preset (Issue #7)

**Steps:**
1. Open Costing Analysis
2. Complete wizard (pick "home-based")
3. Scroll to "Volume" section
4. Click "Pessimistic (50/day)" button
5. Check "Sales volume (portions/day)" slider value

**Expected:** Slider jumps to 50 (not 100)  
**Status:** ✅ If it shows 50/day

---

## Test 5: Button Styling (Issue #14)

**Menu Creator page:**
1. Scroll to "Menu Portion Creator" section
2. Click "+ Add Menu" to add a menu block
3. Inside that block, look for button
4. Should read "+ Add item to menu"
5. **Button should be TEAL/GREEN** (primary color), not gray

**Overhead & Manpower page:**
1. Look at "+ Add overhead item" button
2. Should be teal/green (primary)
3. Compare to "+ Add item to menu" — should match color

**Expected:** Both buttons same teal/green color (primary style)  
**Status:** ✅ If colors match

---

## Test 6: Save PDF Button Position (Issue #14)

**All three calculator pages:**
1. Menu Calculator, Overhead & Manpower, Costing Analysis
2. Look at **page title section** (top)
3. "Save as PDF" button should be on **right side** of title
4. On mobile, button should stack below title (not squeeze it)

**Expected:**  
- Desktop: "Title" [flex space] "Save PDF" button (top-right)
- Mobile: Title block / Save PDF button below (stacked)

**Status:** ✅ If positioned top-right on desktop, stacked on mobile

---

## Test 7: Footer Simplification (Issue #16)

**All pages:**
1. Scroll to bottom (footer)
2. Should see only: **"© 2026 Reysourcez Enterprise. All rights reserved."**
3. No links to Home, About, Services, Contact
4. No tagline "We focus on providing catered solutions..."

**Expected:** Minimal footer, copyright only  
**Status:** ✅ If only copyright text shows

---

## Test 8: "How It's Calculated" Position (Issue #15)

**Menu Calculator:**
1. Scroll to very bottom of page (before footer)
2. See section titled "How it's calculated:"
3. Should contain text about Yield %, Wastage %, Inflation

**Overhead & Manpower:**
1. Scroll to very bottom (before footer)
2. See section titled "About the numbers:"
3. Should contain text about EPF, SOCSO, EIS

**Expected:** These help sections are at END of page, not interrupting the form  
**Status:** ✅ If explanations are at bottom

---

## Test 9: "Open Menu" / "Open Overhead" Buttons (Issue #1 — Not Done Yet)

**Costing Analysis:**
1. Look for "Open Menu Portion Creator" button
2. Look for "Open Overhead & Manpower" button
3. Current location: Inside "Pull numbers in live..." panel

**Note:** These buttons work fine where they are now. Moving them under section headers is KIV for Sonnet 5 Max work.

**Status:** ✅ If buttons work (already tested in #3 above)

---

## Test 10: Tab Switcher (Issue #3 — Partial)

**Setup:** Have Menu Calculator + Analysis open in separate windows

**Steps:**
1. In bottom-right corner, look for **⋮** (three-dot) circle button (floating)
2. Click it → menu appears with list of open tabs
3. Click "Menu Portion Creator" → switches/opens that tab
4. Go back to Analysis tab manually
5. Click the ⋮ button again

**Expected:**  
- ✅ Tab switcher button appears when multiple tabs open
- ✅ Clicking menu item switches to that tab
- ✅ Menu hides after selection

**Known Issue:**  
- Clicking "Costing Analysis (back)" from Menu Calculator doesn't auto-focus Analysis tab
- **This is NOT fixed yet** (requires Sonnet 5 Max debugging)

**Status:** ⚠️ Partial — switcher works, but back button doesn't focus

---

## Summary Checklist

- [ ] Test 1: Layout stable (no jittery shifts)
- [ ] Test 2: Tooltips appear desktop, hidden mobile
- [ ] Test 3: **Both cost AND selling price sync** to Analysis
- [ ] Test 4: Pessimistic = 50/day
- [ ] Test 5: Add item button is green/teal
- [ ] Test 6: Save PDF in top-right
- [ ] Test 7: Footer minimal (copyright only)
- [ ] Test 8: Help text at bottom of pages
- [ ] Test 9: Open buttons work (not repositioned)
- [ ] Test 10: Tab switcher mostly works

**Go/No-Go:** ✅ Go if ALL except Test 10 pass. Test 10 partial OK for now.

---

## Bugs Found During Testing?

**Please document:**
1. Which test number
2. What you expected
3. What actually happened
4. Desktop or mobile or both
5. Browser (Chrome, Safari, Firefox)

---

**Ready to test?** Open the files in `/mnt/user-data/outputs/` and run through this guide!
