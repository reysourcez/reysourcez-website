# Reysourcez Enterprise — Roadmap (Sonnet 5 Max Required)

**Status:** KIV — Ready for next iteration with higher-capacity model

---

## High-Priority Features

### 1️⃣ Issue #4: Multi-Menu Analysis (CRITICAL FOR BUSINESS LOGIC)

**Current State:** Only first menu syncs to Costing Analysis  
**Requirement:** Support analyzing multiple menus (a, b, c, d...) individually and comparing profitability

**Implementation Needed:**
- Add dropdown in Analysis: "Select menu to analyze" 
  - Option 1: Analyze a single menu (current behavior, just pick which one)
  - Option 2: Analyze all menus as portfolio (sum + individual breakdowns)
- Extend sync protocol to send ALL menu data to Analysis instead of just first block
- Store menu data in Analysis state (not localStorage, just in-memory)
- Rebuild cost-structure bars for selected menu

**Complexity:** HIGH  
**Why Sonnet 5 Max?**
- Requires redesigning the BroadcastChannel message protocol
- State management for tracking multiple menus
- DOM updates for dropdown-based menu selection
- Cost structure comparison across menus

**Acceptance Criteria:**
- User creates 4 menus (a, b, c, d) in Menu Portion Creator
- Opens Analysis and sees a dropdown listing all 4 menus
- Selecting menu "a" auto-updates cost structure, break-even, profit figures
- Can switch between menus without re-entering data

---

### 2️⃣ Issue #12: Tab-Based UI (Space Optimization)

**Current State:** Multiple menus/overhead items scroll vertically, taking up lots of screen real estate  
**Requirement:** Tab interface — clicking tab "a", "b", "c" shows that block's form in same space

**Implementation Needed:**
- Replace vertical scroll with horizontal tabs (a | b | c | d | + Add)
- Each tab shows only that menu/overhead block's row-building interface
- Tab styling: active = teal underline, inactive = muted
- Persist tab state during session (but not after close)
- Apply to both Menu Creator AND Overhead & Manpower pages

**Complexity:** HIGH  
**Why Sonnet 5 Max?**
- Requires significant DOM restructuring (not just CSS)
- State machine for tracking active tab + all blocks' data
- Event delegation for tab switching
- Mobile-responsive tab UX (may need overflow-x scroll on narrow screens)

**Acceptance Criteria:**
- Menu Creator: user creates 4 menus → sees tabs a | b | c | d | + Add
- Clicking tab "c" shows menu c's form, maintains its state
- Switching tabs doesn't lose unsaved data
- Same UX works on mobile (tabs scroll horizontally if many)

---

### 3️⃣ Issue #1: Open Menu / Open Overhead Buttons Under Headers (Enhancement)

**Current State:** "Open Menu Portion Creator" button in connector panel at top of Analysis  
**Requirement:** Also add these buttons directly under "Variable Costs" and "Fixed Costs" section headers

**Implementation Needed:**
- Duplicate buttons beneath `<h3>Variable Costs</h3>` and `<h3>Fixed Costs</h3>`
- Use same `data-open-tool` mechanism (already works)
- Style as secondary buttons to differentiate from main CTA

**Complexity:** LOW-MEDIUM  
**Why KIV with #4?**
- Could be done now, but ties into multi-menu support
- Once issue #4 is done (menu dropdown), these buttons become more useful for context-switching

---

### 4️⃣ Issue #3: Floating Tab Switcher Not Refocusing Analysis (Bug)

**Current State:** ✅ Tab switcher opens Menu/Overhead in new windows  
**Problem:** Clicking back from Menu → Analysis tab switcher doesn't focus Analysis tab

**Investigation Needed:**
- Check `costing-sync.js` window reference tracking
- Verify `window.opener` is being set and maintained
- May be race condition in BroadcastChannel setup
- Possible OS/browser tab behavior difference (desktop vs. mobile)

**Complexity:** MEDIUM  
**Why Sonnet 5 Max?**
- Requires debugging multi-window state management
- May involve timing issues between BroadcastChannel and `window.open`
- Need to test across browsers/devices

---

## Nice-to-Have Features (Future)

### 📊 Issue: Menu Engineering Quadrant Analysis
- Segment menu items into 4 quadrants: Stars (high profit, high volume), Ploughorse (high volume, low profit), Puzzle (low volume, high profit), Dog (low volume, low profit)
- **Requires:** Sales volume per item input (not just cost data)
- **Status:** Future enhancement after multi-menu support is live

### 💰 Issue: AI-Generated Cost-Cutting Suggestions
- Analyze cost structure and suggest improvements (e.g., "ingredient cost is 60%, try reducing to 50%")
- **Requires:** API integration (GitHub Pages is static, would need proxy or exposed API key)
- **Status:** Requires infrastructure decision; KIV pending business decision on external API

### 📱 Issue: Utility Tariff Sync (Sarawak Energy, TNB)
- Auto-populate electricity & water costs by region and meter type
- **Requires:** Tariff data research equivalent to EPF/SOCSO work
- **Status:** Research phase; flagged for later

---

## Testing Strategy for Next Phase

Once Sonnet 5 Max tackles these features:

1. **Unit Tests:** Sync protocol (sending/receiving multiple menus)
2. **Integration Tests:** Tab switching preserves data + calculations
3. **E2E Tests:** Create 4 menus → Analyze each separately → Compare profitability
4. **Mobile:** Tab overflow on narrow screens, touch-friendly menu selection
5. **Performance:** Ensure 4+ menus don't slow down Analysis calculations

---

## Technical Debt

- **BroadcastChannel compatibility:** Works in modern browsers, but no fallback for older IE11. Currently silent graceful degradation (tool still works, just no sync).
- **localStorage vs. in-memory:** Decided on in-memory (no persistence) per spec. If future requirements change, will need to add localStorage + privacy controls.
- **CSS variables:** Design is token-based, easy to rebrand. No technical debt here.

---

## Estimated Timeline (Sonnet 5 Max Work)

| Feature | Effort | Timeline |
|---------|--------|----------|
| Issue #4 (Multi-menu dropdown) | 4-6 hours | 1-2 sessions |
| Issue #12 (Tab UI) | 6-8 hours | 2 sessions |
| Issue #1 (Button placement) | 1 hour | Can bundle with #4 |
| Issue #3 (Tab switcher debug) | 2-3 hours | 1 session (if needed) |

**Total:** ~13-18 hours Sonnet 5 Max time = reasonable for next iteration

---

## Deployment Notes

- **Current state is production-ready** — all bug fixes are backward compatible
- No build step required (plain HTML/CSS/JS)
- Push to GitHub Pages when testing is complete
- Update `styles.css?v=5` cache-busting version numbers if making CSS changes
- Update script version numbers if making JS changes (e.g., `menu-calculator.js?v=5`)

---

**Last Updated:** 26 Aug 2026  
**Next Review:** After testing 1st iteration on live site
