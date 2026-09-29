# Market Radar — Setup & Reference

## 2026-09-27 — v1.6.2: mode-leeching hardened further, a pharmacy/petrol diagnostic, accessibility cleanup, settings sheet finally regenerated (read this first)

Four things reported this round, three genuinely addressed, one honestly still open. Client-only release — the Worker stays on v1.6.0, nothing to redeploy on Cloudflare.

### 1. "Results from either mode still leech into the other" — still happening after v1.6.1

v1.6.1 added `applyModeVisibility()` force-hiding, called from `finishWizard()`. That should have stopped this. It didn't, per the report. Re-reading it: `finishWizard()` only runs once, when the analysis screen first appears for a given mode — nothing forced that same enforcement to run again at the moment that actually matters, right before `analyzeSpot()` produces new output. **The fix this round:** `applyModeVisibility()` now also runs as the very first line of `analyzeSpot()` itself, so the correct panel set for whichever mode is active gets re-asserted immediately before any new result renders, regardless of how the screen was reached.

Separately — and this part is a **hypothesis, not a confirmed cause**, since `styles.css` lives outside this project and this session had no live access to the deployed page to inspect computed styles — every panel show/hide now goes through one new helper, `setPanelHidden(id, hide)`, which sets BOTH the native `hidden` attribute AND an explicit inline `style.display`. The reasoning: `#mr-result-cards` and `#mr-gap-results` share a class, `.ica-results`, defined in the site-wide stylesheet this project doesn't own. If that class sets its own `display` value without an accompanying `.ica-results[hidden] { display: none }` override, a same-specificity class rule can silently win the CSS cascade over the attribute selector's default, leaving an element visible despite `hidden` being `true`. This is a real, well-documented category of CSS bug — but it's also the kind of thing that, if true, would likely have shown up the very first time `mr-result-cards` was ever toggled (long before Market Gap mode existed), which argues against it being the WHOLE story. The inline-style approach is a safe superset of the old behaviour either way (clearing it back to `''` on show changes nothing when there was no conflict to begin with), so it ships regardless of whether the CSS theory turns out to be right.

**Read this as: two independent hardenings, either of which could be the actual fix, shipped together because both are safe and cheap.** If the leeching recurs a THIRD time after this, the next step is not another code guess — it's opening DevTools on the live page, finding the stuck panel, and reading its actual computed `display` value. That single check would settle the CSS-conflict question definitively, which reasoning from outside the deployed page cannot.

### 2. "Petrol/pharmacy still show as missing/gap even though the map clearly shows one nearby" — investigated, not resolved

Checked everything that could plausibly be a code bug specific to these two categories, added 2026-09-24:

- `amenity=pharmacy` and `amenity=fuel` are the correct, standard, unambiguous OSM tags (confirmed against the OSM wiki previously, re-checked this round) — neither shares a tag with any other category in `CATEGORY_TAGS`, so there's no "cafe steals the bubble-tea POI" style collision to fix here.
- `cleanTagSet()`'s tag-pair budget (`MAX_CATEGORY_TAG_PAIRS = 40`) is shared across ALL categories in one request, and does not reset per category — worth checking, since a budget silently exhausted partway through iteration could plausibly starve whichever categories happen to be processed last (pharmacy and petrol are near the end of `CATEGORY_TAGS`'s insertion order). Counted it: all 13 standard categories together use only ~23 tag pairs, and even 8 gap-mode custom items add at most 8 more (31 total) — nowhere near the 40 cap under normal use. Not the cause.
- `categorize()`'s cuisine-priority pass and the Overpass query-builder both look correct for a plain single-tag category with no special-casing needed.

None of that turned anything up. So rather than guess further and risk a sixth round of "confirmed working, wasn't" (this project's own population saga is the standing cautionary tale for exactly that pattern), this round adds a **diagnostic instead of a guessed fix**: any POI Overpass returns that matches one of your active categories, but that sits OUTSIDE the actual catchment shape your search counted, now draws as a **hollow, dashed grey marker** on the map (see the new legend entry). This turns one ambiguous symptom into three distinguishable ones:

| On the map at that spot | Meaning |
|---|---|
| Solid red dot | Counted as a competitor / checklist item |
| Hollow grey dashed dot | Found by Overpass, but outside the shape actually being counted — the over-fetch radius pulled it in, but the real catchment polygon (or radius) didn't |
| Nothing but the base map's OWN icon (a fuel-pump or pharmacy-cross glyph, if OpenStreetMap's standard tile style draws one at the current zoom) | Overpass never returned this node at all — the base map tiles show every OSM feature in view regardless of catchment, category, or anything this tool does; that rendering is completely independent of the red/grey markers this tool draws |

That third row is worth spelling out because it's a genuinely easy thing to conflate: OpenStreetMap's standard "Carto" tile style (the one this page loads from `tile.openstreetmap.org`) bakes small icons for many common amenity/shop types directly into the map image itself — fuel stations and pharmacies are exactly the kind of long-established, high-priority category that style renders distinctly. Seeing that icon on the map is a statement about what OpenStreetMap's cartographers chose to draw, not a statement about what this tool's own Overpass query returned or counted. If you're looking at a location and see a fuel-pump icon but NEITHER a red NOR a grey circle from this tool, that's the case worth checking directly on openstreetmap.org (does that exact node actually carry `amenity=fuel`, or is it tagged some other way, or is it a `way` your query should still catch but doesn't for some other reason).

A second, genuinely separate possible explanation, specific to **drive** catchments: the Worker's search radius sent to Overpass is `fallbackRadiusM × 1.3` — a deliberate over-fetch margin sized for how much a real isochrone shape typically bulges past a straight-line radius. A real drive-time isochrone can extend much further than 1.3× along a fast, straight highway corridor than it does in other directions, and petrol stations in particular tend to sit ON exactly those corridors (they need road frontage and space). If that's what's happening, the grey marker won't help — Overpass never returned the point in the first place, so there's nothing to draw a grey dot for; only the base map's icon would show. This is explanation (b) in the table above's third row, and it's the one that would actually need a code change (widening the multiplier, at a real cost to Overpass/Geoapify query load) — **not done this round**, since doing it without evidence it's actually the cause would just be another guess.

**What to do with the new markers:** re-run the exact spot that triggered the original report. If a grey dot now appears at the pharmacy/petrol location, that settles it (it's a catchment-boundary effect, working as designed, just surprising from the map's zoomed-out view). If nothing appears there but the base tile's own icon does, that points at the Overpass-radius or OSM-tagging explanations instead, and is worth reporting back with which one it looks like.

### 3. Console/DevTools items raised alongside the bug reports

- **"No label associated with a form field"** — a real, valid accessibility finding. Four fields only had a `placeholder` (which isn't an accessible name) and no `<label>`: `#mr-vacancy-floor`, `#mr-vacancy-detail`, `#mr-gap-custom-key`, `#mr-gap-custom-value`. Fixed with `aria-label` on each — zero visual change, resolves the DevTools "Issues" panel warning for a screen reader or other assistive tech that reads accessible names. The site's other custom-tag row (`#mr-custom-key`/`#mr-custom-value` in Market Analysis mode) already had proper `<label for="...">` elements and needed no change.
- **`leaflet-heat.js` "willReadFrequently" canvas warning** — a Chrome performance ADVISORY, not a functional bug and not something this project's own code causes. It comes from inside the pinned third-party `leaflet.heat@0.2.0` library's own internal use of a 2D canvas context, which doesn't set the `willReadFrequently` hint Chrome recommends for canvases read back from repeatedly. Fixing it properly would mean patching or forking that library (or monkey-patching `HTMLCanvasElement.prototype.getContext` globally before it loads, which is more invasive than this warning is worth) — left as-is. It doesn't affect correctness, only (very marginally) redraw performance.
- **`[Costing Sync] script build: 2026-09-01-switcher-removed` / "why is costing-sync.js loading, are we using the costing calculator?"** — no, this page doesn't use Interactive Costing Analysis or Margin Analysis, and nothing about this console line means it does. `costing-sync.js` is shared, site-wide infrastructure loaded on every Reysourcez tool page (same as `nav-dropdown.js`), whose sole purpose here is providing the `rzBroadcast()` function `analyzeSpot()` calls once after a successful Market Analysis run (see the KIV list — Interactive Costing Analysis and Margin Analysis don't listen for a `'market-radar'` source yet, so today that broadcast reaches nobody; it's inert, forward-looking plumbing, not an active integration). The console line itself is just that shared script announcing its own build tag on load, same as this page's own `[Market Radar] client v...` line does for itself — it says nothing about Market Radar's own behaviour. Left untouched; editing `costing-sync.js` itself is explicitly out of scope for a Market-Radar-only session, same standing rule this project already applies to the `rzBroadcast` receiving side.

### 4. `market-radar-settings-reference.xlsx` — finally regenerated

Deferred across the v1.5.1, v1.6.0, and v1.6.1 rounds "to keep turnaround quick." All the values were already fully tabulated in this doc's own Settings reference section below, so there was no remaining reason to keep deferring it. The regenerated sheet now includes every row this doc's table has, including the three additions those three rounds separately introduced and never backfilled: `DISTRICT_POPULATION_FALLBACK_2023`, the two 2026-09-24 categories (pharmacy/petrol), and `MAX_GAP_CUSTOM_ITEMS`. Same format as the site's other settings-reference sheets (current value, a blank yellow "your value" column, exact code location, notes).

### 5. Two doc-versus-code errors found while diffing this round's files against the v1.6.1 copies

Same class of mistake this project keeps making, so recorded plainly:

- **`DEFAULT_TOWN` does nothing.** Every earlier version of this doc's Settings table listed "Default town: Miri" as a changeable setting. The constant is declared in `market-radar.js` but never read anywhere — the wizard always asks which town, so editing it has no effect. Left in the code (harmless, and removing it is a separate decision) with a comment saying so; the Settings table below now says so too, and the regenerated spreadsheet flags it.
- **Two on-page strings still said "4 of the 11 categories".** The "National retail trend" tooltip in `market-radar.html` and the "Not tracked" line in `renderTrendCard()` both predated the 2026-09-24 addition of pharmacy and petrol (13 categories now). Both corrected to "13". The DOSM index still covers the same 4 categories as before — only the denominator was stale.

### Deploy (about 2 minutes — client files only)

1. **GitHub** — upload the new `market-radar.js` (cache-buster now `?v=20260927a`) and `market-radar.html`, replacing the two existing files. Commit.
2. **Cloudflare — nothing to do this round.** The Worker stays on v1.6.0.
3. **Refresh the page hard** (Ctrl+F5 / Cmd+Shift+R). Console should log `client v1.6.2`.
4. **Test the leeching fix:** complete a Market Gap analysis, click "← Choose a different analysis" back to mode-select, pick Market Analysis, tick a type, analyze — `#mr-gap-results` (the checklist table) must not be visible anywhere on that screen, at any point, not even briefly.
5. **Test the pharmacy/petrol diagnostic:** analyze the same spot that originally showed the discrepancy, in whichever mode showed it. Check the map legend for "Found by OSM, outside this catchment" and look for a hollow grey dashed dot at the pharmacy/petrol location. Report back which of the three outcomes in the table above actually happened.
6. **Test the accessibility fix:** open DevTools' Issues panel (or run an accessibility audit) on the analysis screen with the vacancy notepad and Market Gap's custom-add row visible — the "no label associated with a form field" warning for those four fields should be gone.

### What was and wasn't verified (2026-09-27)

- **Verified via search this round:** OpenStreetMap's standard "Carto" tile style (loaded from `tile.openstreetmap.org`, exactly what this page uses) does bake small icons for many common amenity/shop categories directly into the map tiles themselves, independent of any Leaflet overlay a page draws on top — a long-established, stable feature of that style, not something that changes week to week. This backs the "base-tile icon vs. this tool's own marker" distinction in section 2 above.
- **Not independently verified — genuinely open:** which of the three explanations in section 2's table actually explains the specific pharmacy/petrol report; whether the mode-leeching fix in section 1 has actually stopped the behaviour on the live, deployed page (this session had no live browser access to check); whether a CSS rule on `.ica-results` in `styles.css` is genuinely part of the leeching cause, or a red herring (this session cannot read that file — it lives outside this project). All three are flagged as open items for whoever can actually load the live page next.
- **Not measured:** how much (if any) map clutter the new grey diagnostic markers add on a dense, many-competitor search — flagged in the handoff doc as something to watch for; a visibility toggle is the natural next step if it turns out to be noisy, not built pre-emptively without evidence it's needed.


## 2026-09-25 — v1.6.1: three bugs from the v1.6.0 round (superseded in part — see the 2026-09-27 section above for the mode-leeching and pharmacy/petrol follow-ups)

Three things reported after testing v1.6.0 live, all fixed, all client-only — no Worker redeploy needed this round.

**1. The map pin's red marker stopped appearing after clicking the map.** Confirmed by reading `initMap()`/`placePin()` directly — this bug actually predates v1.6.0. `map.remove()` destroys the Leaflet map instance but does NOT clear this file's own `pinMarker` variable, which still points at the now-orphaned marker object. `placePin()` only creates a NEW marker when `pinMarker` is falsy; left unreset, every `initMap()` call after the very first one in the page's lifetime would silently call `.setLatLng()` on that orphaned marker — updating its coordinates (which is why the pin readout text kept updating correctly) with no visible effect (since the marker isn't attached to whichever map is actually on screen). This was always reachable via "Edit answers," but v1.6.0's mode-switching made `initMap()` run far more often, which is almost certainly why it became obvious now rather than earlier. **Fix:** `initMap()` now sets `pinMarker = null` before rebuilding the map, so `placePin()` always creates a fresh marker bound to the current map. **Confirmed working live, 2026-09-27.**

**2. A completed Market Gap table could stay visible after switching to Market Analysis.** Reported with a screenshot: after analyzing in Market Gap mode, switching to Market Analysis and running a fresh analyze there still showed the old gap/thin/oversupplied table underneath the new score. Reading `resetAnalysisState()`, `backToModeSelect()`, and `editAnswers()` line by line, every path back to mode-select SHOULD already call `resetAnalysisState()`, which sets `#mr-gap-results.hidden = true` — so on paper this shouldn't have been reachable, and no second code path was found that could re-show it. Rather than leave this depending on one function reliably running before another, `applyModeVisibility()` — called every single time the wizard finishes, regardless of which door got you there — now also force-hides the OTHER mode's entire output. **[CORRECTED 2026-09-27 — this was reported recurring even after this fix; see the 2026-09-27 section above for the actual next round of hardening. The diagnosis in this entry ("should already be unreachable on paper") turned out to be incomplete, not wrong exactly — the missing piece was that the hardening only ran once per screen-visit, not once per analysis.]**

**3. The Market Gap "Reach" figure read as a per-day/month/year number — it isn't one.** Reported: is "≈255,100" using a comma or a period, and does "people/shop" mean each shop must serve 255,100 people a month, a day, a year? Neither — there's no time dimension in this figure at all, and no foot-traffic or purchase-frequency data behind this tool that could support one. It's a plain, static ratio: the district's whole population (the same number Market Analysis mode shows) divided by how many of that type were found in the catchment — a rough "how many people share access to one of these" reading. Fixed two things: the wording now reads "1 per ≈255,100" instead of "≈255,100 people/shop", which doesn't invite a rate/frequency reading the way "per" attached to a bare number can; and every large number on the page (population, income, and this new figure) now calls `toLocaleString('en-MY')` explicitly instead of a bare `toLocaleString()` — the bare version renders using the *viewer's own* browser/OS locale, which could in principle use a different thousands separator than the comma this was built and tested against. Pinning the locale means every visitor sees the same formatting regardless of their own device settings.

### Also raised, not a bug — needs a live check to say more

**A Petronas station is visible on the map but Market Gap showed 0 petrol stations found.** Couldn't be confirmed or ruled out without live network access to query OSM directly at the time. **[UPDATED 2026-09-27 — this exact report recurred (this time for pharmacy too), so it's now covered in full in the 2026-09-27 section above, including a new diagnostic feature built specifically to help distinguish the candidate explanations. Still not resolved as of that round either.]**

### Deploy (about 2 minutes)

1. **GitHub** — upload the new `market-radar.js` (cache-buster now `?v=20260925a`) and `market-radar.html`, replacing the two existing files. Commit.
2. **Cloudflare — nothing to do this round.** The Worker stays on v1.6.0.
3. **Refresh the page hard.** Console should log `client v1.6.1`.
4. **Test fix 1:** go through the wizard once, click the map — pin should move with a visible marker. Click "Edit answers," go through the wizard again (same or a different town), click the map again — the marker must still appear, not just the coordinate readout.
5. **Test fix 2:** analyze a spot in Market Gap mode, then go all the way back to mode-select and pick Market Analysis, tick a type, analyze — the gap table must not be visible anywhere on that screen.
6. **Test fix 3:** analyze a spot in Market Gap mode and check the "Reach" column reads "1 per ≈N" rather than the old phrasing.


## 2026-09-24 — v1.6.0: Market Gap mode, nav retrofit (still fully current — see the 2026-09-25 and 2026-09-27 sections above for follow-up fixes)

Three things happened this round: the site-wide nav retrofit (overdue on this page specifically — see `NAV_RETROFIT_HOWTO.md`), competitor strength was confirmed to stay as-is (no code change), and a second analysis mode — **Market Gap** — was scoped, researched, and built.

### Nav retrofit

This page was still on the site's OLD hand-copied nav pattern — flagged in `NAV_RETROFIT_HOWTO.md` as "do it now, don't wait to be asked again," and it had been sitting un-done since that doc was written. Two edits, done: `site-config.js?v=1` and `nav-config.js?v=1` added as the first two `<script>` tags in the page (before Leaflet, before everything else), and `<ul class="nav-dropdown-menu">` emptied to `<!-- populated by nav-config.js -->`. Both files are copied in from elsewhere on the site, unedited — this project doesn't own or modify them. `NAV_RETROFIT_HOWTO.md`'s own status list has been updated to move `market-radar.html` into "Done."

### Competitor strength — decision: keep

Raised 2026-09-23 as "does nothing." Diagnosis held up: it's not broken, it's a flat neutral 0.5 sub-score when neither an on-site read nor `GOOGLE_PLACES_API_KEY` is present, by design (no invented signal). The on-site-read path is the same mechanism and already works. Decision: leave it exactly as it is — free, dormant, zero cost, and it's what makes the on-site read count toward the score at all. No code changed for this.

### Market Gap mode — what it is

A second entry point (`#mr-mode-select`, two buttons: "Market Analysis" and "Market Gap") shown before the wizard. Both modes share the exact same wizard (town + catchment), the same map, the same pin, the same catchment machinery — Market Gap adds a checklist-based results panel instead of the single-category score. Capped at the existing 15-minute catchments (walk15/drive15) per direction this round — this ended up meaning almost no new backend surface was needed at all: no new isochrone band, no new Overpass query shape, no new external API. The whole addition is two more standard categories, a client-side relative-ranking computation over data the tool already fetches, and one new Worker-side narration prompt.

**What it checks:** every standard business type at once (now 13, not 11 — see below), plus anything the person adds via a small "OSM key / OSM value" add-to-checklist row (same validation as the existing single custom-tag slot in Market Analysis mode, but a running list — up to 8 items — since auditing a whole checklist is the point of this mode, not picking one thing).

**What it reports, per category:** the raw count found in the catchment, "≈X people per shop of this type" (using the same DOSM population figure Market Analysis mode already shows), and a read: **Gap** (zero found), **Thin**, **Adequate**, or **Oversupplied**. Thin/Adequate/Oversupplied are ranked against the OTHER categories found in the SAME catchment (below 40% of the catchment's own average count = thin; at or above double it = oversupplied) — deliberately NOT against an external "a healthy area should have N of these" number, because this project has no verified source for a number like that, and inventing one would repeat exactly the mistake the population saga (see the 2026-09-20/22 sections below) already burned five rounds on. Zero is the one case that needs no benchmark at all, so it's always just "Gap."

### The two new categories — pharmacy and petrol

Added directly to `CATEGORY_TAGS` (now 13 standard types), not a separate list — so they're also just ordinary tickable options in Market Analysis mode, and the Worker's existing "query every category regardless of what's ticked" behaviour picks them up with zero Worker changes. `amenity=pharmacy` and `amenity=fuel` are both well-established, unambiguous OSM tags (no cuisine-tag-style priority conflict the way bubble tea needed). MSIC codes: pharmacy 47721, fuel 47300 — **cross-checked against other ISIC-derived country codes at this same 5-digit level (India's NIC-2008 for pharmacy, Sweden's SNI for fuel), not a direct Malaysia SSM/DOSM lookup.** Flagging that distinction plainly, the same way this file already does for every other MSIC code here — worth a direct Malaysia-specific confirmation before treating these as fully verified, though the ISIC base structure rarely diverges at this level for such generic categories.

**Deliberately NOT done:** added to `IOWRT_GROUPS` (the DOSM trend index) — both are technically Section G retail, and group 477 already covers `fashion` so pharmacy might share it, but neither has been checked against what `iowrt_3d.csv` actually publishes at the group level. Guessing here would be the sixth round of exactly the population mistake. Both correctly show "not tracked" today via the existing fallback, at zero risk. Also not done: `GEOAPIFY_CATEGORY_MAP` / `GOOGLE_PLACE_TYPES` entries for either — both already degrade gracefully to "no backstop for this category" via the existing `|| []` pattern, same as `printing` already does for Geoapify.

### The persona question — researched, not built

Asked this round: should the checklist differ for a normal household vs. a small business/office vs. an institution — and could research back that up rather than guessing. What was actually found:

- **Household needs: well supported.** The "15-minute city" concept (Carlos Moreno, popularised via C40 and adopted in planning discussions in Paris, Melbourne, and elsewhere) consistently names a common core of neighbourhood essentials: food/groceries, healthcare (including pharmacy), education, retail, personal services, and recreation — this lines up closely with, and gives real backing to, the 13-category checklist already built. Malaysia's own town-planning body (PLANMalaysia/JPBD) publishes `Garis Panduan Perancangan Kemudahan Masyarakat` — official population-ratio standards for **civic** facilities (schools, religious buildings, welfare centres) — real and Malaysia-specific, but scoped to civic/public facilities, not the commercial retail/service mix this tool actually checks (dry cleaning, printing, bubble tea, etc.), so it doesn't directly supply thresholds here — noted for completeness, not used as a source for the checklist itself.
- **Small business / institution needs: thin.** Searched specifically for research on what amenities a small business or office cluster needs nearby. What's out there is generic site-selection advice (rent, footfall, parking, target market) — not a specific "which other business types should be nearby" checklist the way the household literature provides. No credible equivalent found.

**Given that asymmetry, the decision this round was to ship the household checklist (well-grounded) and NOT build a persona picker or a second, weakly-sourced checklist for business/institution personas** — that would mean inventing a checklist without the same evidence backing given the household one has, which doesn't sit well with this project's own standards. If personas get built later, the small-business/institution checklist should probably be sourced from this project owner's own domain knowledge of Sarawak commercial patterns rather than presented as research-backed the way the household one now can be, and clearly labelled as such rather than blurred together.

### What Market Gap does NOT show yet (KIV, not a bug)

Anchors, the DOSM trend card, and the population/income display cards all still only render in Market Analysis mode — the underlying data is already in every Worker response regardless of mode, this is purely unfinished display work, deferred to keep this round reviewable. See `MARKET_RADAR_HANDOFF.md` §11/§13.

### Deploy (about 5 minutes)

1. **GitHub** — upload `market-radar.html` (cache-buster now `?v=20260924a`) and `market-radar.js`, replacing the two existing files. Commit.
2. **Cloudflare** — Workers & Pages → `market-radar-proxy` → **Edit code** → paste the whole of the new `market-radar-proxy-worker.js` → **Deploy**. This round DOES need a Worker redeploy (unlike v1.5.2) — the gap-mode plain-English read needs `gapInsightPrompt()` server-side.
3. **Refresh the page hard.** You should land on a screen with two buttons ("Market Analysis" / "Market Gap") instead of the wizard. Console should log `client v1.6.0`; *Competitors in catchment* (once you're in Market Analysis mode) should say `Worker v1.6.0`.
4. **Test Market Analysis still works exactly as before** — pick it, run through the wizard, tick a type, analyze. Nothing about this flow should feel different apart from the extra step of picking it from mode-select first, and pharmacy/petrol now appearing as two more tickable checkboxes.
5. **Test Market Gap** — pick it, run the wizard, analyze a spot with no custom additions. You should see a table of all 13 categories, sorted lowest-count-first, with Gap/Thin/Adequate/Oversupplied badges. Try adding a custom item (e.g. `shop=optician`) before analyzing — it should appear as an extra row.
6. **Test the reset** — from a completed Market Gap analysis, click "Edit answers," then at the wizard's first step click "← Choose a different analysis" to get back to mode-select, then pick Market Analysis. Nothing from the Market Gap run should still be visible or affecting the new session.

### What was and wasn't verified (2026-09-24)

- **Verified live, this round:** the 15-minute-city concept's core category list, via general web search — a well-established urban-planning framework, not this project's own claim. PLANMalaysia/JPBD's community-facilities planning guideline exists and covers population-ratio standards for civic facilities. MSIC 47721 and 47300 cross-checked against two other countries' ISIC-derived classification systems each.
- **Not independently verified:** whether Malaysia's own MSIC 2008 schedule assigns EXACTLY 47721/47300 to pharmacy/fuel retail (the cross-check was against India's NIC and Sweden's SNI, both ISIC-derived, not a direct Malaysia SSM/DOSM source) — flagged in the code and in `MARKET_RADAR_HANDOFF.md` §8, same as this project already does for lower-confidence facts elsewhere. Whether DOSM's `iowrt_3d.csv` publishes usable group-level rows for pharmacy/fuel retail specifically — not checked, which is exactly why `IOWRT_GROUPS` wasn't touched this round. Geoapify's and Google's exact category strings for pharmacy/fuel — not checked against either provider's current docs.
- **Not measured:** how research-backed the eventual small-business/institution checklist would need to be before it's worth shipping — this is a judgement call for the project owner, not something a web search resolves.


## 2026-09-23 — v1.5.2 (fully superseded by later rounds above — kept for history)

**Reported:** after clicking "Edit answers" to scout a different town or catchment, the analysis screen kept showing the PREVIOUS spot's competitor count, opportunity score, and AI read — right up until "Analyze this spot" was clicked again for the new pin. The map itself looked fine immediately (a blank new map for the new town), which is what made this easy to miss on a glance; only the score banner, result cards, and AI box underneath it were stale.

**Root cause, confirmed by reading the actual shipped v1.5.1 code (not assumed):** `editAnswers()` only ever toggled which section was visible — it never reset `lastAnalysis`, never re-hid the score banner/result cards/panels, and never cleared the on-site busyness read. The map alone self-corrected, because `initMap()` — always called once the wizard finishes again — calls `map.remove()` and builds a brand-new Leaflet instance, which happens to wipe every marker/heat/catchment layer as a side effect. Nothing else on the page had an equivalent reset. Concretely, this could actively mislead: `getInsight()` builds its snapshot from `TOWNS[wizardAnswers.town].label` (the NEW town, already updated by the wizard) alongside `lastAnalysis.competitorCount` etc. (the OLD town's numbers) — so a plain-English read requested right after switching towns, before re-analyzing, would describe the new town's name over the old town's data. A stale on-site busyness read was the same problem in miniature: left picked, it would keep shifting the NEXT spot's score under an "Observed" tag that implies a fresh, current read.

**The fix:** a new `resetAnalysisState()` in `market-radar.js`, called at the top of `editAnswers()`. Nulls `lastAnalysis`; clears the on-site read and undoes whatever auto-weight shift it had applied; re-hides the score banner, result cards, on-site-read panel, vacancy panel, and weights panel; resets the AI box to its pre-analysis placeholder; clears the status line. The vacancy notepad's own entries are deliberately left untouched — that's documented as a running, session-long notepad, not a per-spot result.

### Two things raised alongside this fix, resolved in later rounds

**"Competitor strength does nothing"** — resolved 2026-09-24 (decision: keep as-is, see above).
**Proposed second analysis mode — "gap finder."** Built as Market Gap mode, 2026-09-24 (see above).


## 2026-09-22 — v1.5.1 (still fully current)

**Population, re-checked live — the v1.5.0 fix does not work.** You ran the 10-second browser check this doc asked for (`https://api.data.gov.my/opendosm?id=population_district&ifilter=Miri@district&limit=3`) and got back `{"status_code": 400, "details": ["`district` used in `ifilter` filter is an invalid column value. Valid columns: []"]}` — not the "not yet confirmed, but should work" result v1.5.0 assumed. Re-tested independently this round, both ways:

- `api.data.gov.my/opendosm?id=population_district` — HTTP 400 on **every** call, filtered or not (tested unfiltered directly). The OpenDOSM endpoint doesn't recognise this dataset id at all right now; it isn't a filter-syntax problem.
- `api.data.gov.my/data-catalogue?id=population_district&limit=3` — still answers `[]`, even though this exact call is what `population_district`'s own dataset page (`open.dosm.gov.my/data-catalogue/population_district`) documents as its official "Sample OpenAPI query."

So DOSM's own two OpenAPI endpoints, and DOSM's own documented example, all currently fail for this one dataset. That reads as a gap on DOSM's backend (the dataset not wired into either endpoint's live query engine yet), not a mistake in this project's code — but it also means the v1.5.0 "root-cause fix" (switching to OpenDOSM) was itself an unverified guess that doesn't work, on the exact item this project has already gotten wrong four times now.

**Considered and rejected: parsing `population_district.csv` directly, the same way `iowrt_3d.csv` already works.** That file is DOSM's own direct download (CC BY 4.0), confirmed live — real header row `state,district,date,sex,age,ethnicity,population`, matching the documented columns exactly. But it's roughly 300,000 rows (5 years × 160 districts × 3 sexes × 18 age bands × 7 ethnicities) versus iowrt's few thousand, and Cloudflare Workers' **free plan caps CPU time at 10ms per request** (confirmed against Cloudflare's current docs this round — waiting on the download itself doesn't count against that, but parsing 300k lines does). A full parse risked failing outright on the free plan for a number that barely changes and is only ever needed for four fixed towns.

**The actual fix, v1.5.1:** since this tool only ever asks for population for Miri, Kuching, Sibu, or Bintulu — never an arbitrary district — the Worker now pins those four districts' current DOSM figures directly in code (`DISTRICT_POPULATION_FALLBACK_2023` in `market-radar-proxy-worker.js`), rather than live-querying or parsing anything at request time. This is effectively "filtering" the CSV: done once, by hand, against only the four rows this tool will ever need, instead of at runtime against all 300,000 of them. It costs nothing (a plain object lookup — no download, no parsing, no CPU risk on any Cloudflare plan) and is exactly as "official DOSM data" as the live query would have been:

| District | Pinned figure (DOSM 2023 estimate) |
|---|---|
| Miri | 255,100 |
| Kuching | 621,700 |
| Sibu | 254,000 |
| Bintulu | 186,600 |

Sourced 2026-09-22 from DOSM's own Kawasanku dashboard (`open.dosm.gov.my/dashboard/kawasanku`) and cross-checked against citypopulation.de's Malaysia tables (which cite DOSM directly) — Miri and Kuching's 2020-census figures matched exactly between the two independent sources (248,877 and 609,205 respectively), which is what gives confidence in the same sources' 2023 estimates used here.

Both OpenAPI endpoints are still tried first on every request, now in the order DOSM's own dataset page documents (data-catalogue, then opendosm) — this costs a little latency (two fast-failing calls) but means if DOSM ever fixes either backend, fresher live data returns automatically with **no code change needed**. The pinned table is read only when both fail, which today is always.

**One consequence worth knowing:** the population card can now show a number that is DOSM's real figure but not a *live* one. So the client (`market-radar.js`) got a small, one-line change: the little provenance note under the population card now shows even when a number IS present (previously it only showed on "Not available"), so a pinned figure is visibly marked as such rather than looking identical to a live query. Look for: *"DOSM's live API is down for this dataset right now — showing DOSM's 2023 district estimate instead."*

**Two things to maintain going forward, since this is a pinned table, not a live feed:**
1. **Refresh yearly** — check `open.dosm.gov.my/data-catalogue/population_district` or the Kawasanku dashboard per district around when DOSM publishes new estimates, and update the four numbers in `DISTRICT_POPULATION_FALLBACK_2023`.
2. **Update immediately if a 5th town is ever added** to `TOWNS` in `market-radar.js` — the pinned table does not grow on its own, and a district missing from it just falls through to the existing honest "Not available" (with the real API failure reason) rather than breaking anything.

### What was and wasn't verified (2026-09-22)

- **Verified live, this round:** `opendosm?id=population_district` returns HTTP 400 on every request, filtered and unfiltered; `data-catalogue?id=population_district&limit=3` still answers `[]`; `population_district.csv` downloads correctly and its header matches the documented columns; Cloudflare Workers' free-plan CPU-time limit is 10ms/request (developers.cloudflare.com/workers/platform/limits); DOSM's Kawasanku dashboard and citypopulation.de agree exactly on Miri's and Kuching's 2020 census populations.
- **Not independently re-verified:** the exact 2023 estimates for Sibu and Bintulu weren't cross-checked against a second source the way Miri and Kuching were (citypopulation.de was the only source found for those two specifically) — still DOSM-sourced, just single-sourced rather than double-checked.
- **Not measured:** how large `population_district.csv` actually is in megabytes, or precisely how much CPU time parsing it would have consumed on a real Cloudflare invocation — the decision to avoid that path was made from the row-count math and Cloudflare's documented limit, not a live measurement, since the safer and simpler pinned-table approach made an actual measurement unnecessary.


## 2026-09-20 — v1.5.0 (superseded — kept for history)

**Filenames stay the same.** The site's nav links point at `market-radar.html`, so renaming files would break them. The version is instead in the first line of every file, on the page itself, and in the script tag's cache-buster.

### What changed

| You asked / reported | What was done |
|---|---|
| 5-minute walk and 5-minute drive | Added `walk5` / `drive5` (300 s; fallback circles 400 m / 2,500 m). |
| "What are you thinking of opening?" as checkboxes, max 4 | 12 checkboxes (11 business types + Custom, at the time). At 4 ticked, the unticked ones grey out until you untick one. |
| "DOSM population still not available" | Believed root cause found (OpenDOSM endpoint) — **later confirmed wrong, see the v1.5.1 section above.** |
| "Gemini error" (`User location is not supported for the API use`) | Fix: Workers AI backstop added, needs the `AI` binding. |
| "Changing the on-site read doesn't change the rating" | Fixed — first read picked auto-sets the Competitor strength weight. |
| Geoapify key typo | Fixed by the project owner in Cloudflare; settings sheet corrected too. |
| Not asked for, done anyway | Worker-side input validation added, since the endpoint is public. |

### What was and wasn't verified (2026-09-20)

- **Verified live:** the Data Catalogue endpoint returns `[]` for `population_district`; rate limits; Workers AI's free allowance.
- **Not verified at the time:** whether OpenDOSM actually returns Miri rows. **[Now verified, 2026-09-22: it does NOT — it 400s. See above.]**


## Current status (as of 2026-09-27)

**A note on how this doc and the shipped code have drifted apart before, for whichever session reads this next:** this project has now had the SAME shape of lesson twice on two different features — the 2026-09-20 population "root cause" was reasoning-based and wrong (corrected 2026-09-22), and the 2026-09-25 mode-leeching "fix" was also incomplete (a second round was needed 2026-09-27). Treat every claim in this table as something to verify against a live test before repeating it, including the ones below that currently say ✅ — and treat the two ⚠️ rows below as genuinely open, not "probably fine."

| Area | Status |
|---|---|
| Wizard, map, click-to-place pin | ✅ Working, including the pin-marker fix — confirmed live 2026-09-27 |
| Mode-select (Market Analysis vs. Market Gap) | ✅ Built 2026-09-24 |
| Mode results leeching into each other after switching | ⚠️ **Two fix rounds now (2026-09-25, 2026-09-27) — not yet confirmed to have actually stopped on the live page.** See the 2026-09-27 section above before assuming this is settled |
| Market Gap "Reach" figure wording/number formatting | ✅ Fixed 2026-09-25 |
| Pharmacy/petrol undercounted relative to what's visible on the map | ⚠️ **Not resolved.** A diagnostic overlay was added 2026-09-27 to help distinguish the candidate causes; the underlying report itself is still open — see that section above |
| Market Gap checklist (13 categories + custom additions, gap/thin/oversupplied read) | ✅ Built 2026-09-24 — client-side computation only; anchors/trend/population cards not yet ported to this mode's display (KIV) |
| Site nav dropdown (site-config.js / nav-config.js) | ✅ Retrofitted 2026-09-24 |
| Accessible names on all form fields | ✅ Fixed 2026-09-27 — 4 fields that only had a placeholder now carry `aria-label` |
| `market-radar-settings-reference.xlsx` | ✅ Regenerated 2026-09-27 — was deferred across three prior rounds |
| Overpass competitor search | ✅ 3-mirror fallback plus a Geoapify backstop |
| Bubble tea / other cuisine-tagged categories | ✅ Fixed 2026-09-20 |
| Isochrone catchment (real travel-time shape) | ✅ Working, confirmed live; falls back to a plain circle if OpenRouteService fails |
| District population & household income (DOSM) | Income ✅ working. Population: pinned fallback (`DISTRICT_POPULATION_FALLBACK_2023`) since both live endpoints are confirmed broken |
| Opportunity score, editable weights, diversity index | ✅ Working |
| Competitor strength (Google ratings + on-site read) | ✅ Reviewed 2026-09-23, decision: keep as-is |
| Gemini plain-English read | ⚠️ Intermittent by nature (region-blocking); Workers AI backstop needs the `AI` binding. Branches on `snapshot.kind` for both modes |
| Business-type checkboxes (max 4) | ✅ 13 types now, not 11 |
| Worker input guards, version tag | ✅ Built 2026-09-20 |
| Nav entries on the other pages | ⏸ Central reconciliation pass, not done — this page's OWN nav is retrofitted |
| AppSheet field-survey layer | ⏸ Not started |
| Sync handoff into Interactive Costing Analysis / Margin Analysis | ⏸ Not started — Market Gap mode has no broadcast shape designed at all yet |
| Household-vs-business/institution personas for Market Gap | ⏸ Researched, not built |

**Immediate next step:** deploy v1.6.2, then specifically re-test the two ⚠️ rows above (mode-leeching and pharmacy/petrol) and report back which of the documented candidate outcomes actually happened — both need a live result this session couldn't produce itself.


## 2026-09-17 update

Two things happened this round, worth recording precisely rather than just "more fixes":

**1. Competitor strength shipped.** `market-radar.html`/`.js` gained a 6th, off-by-default weight, a new "On-site read" field for a manual busyness note, and a new result card. `market-radar-proxy-worker.js` gained `fetchGooglePopularity()` — one Google Places Nearby Search (New) call per analysis, only when `GOOGLE_PLACES_API_KEY` is set, matching results to already-classified competitors by proximity. Fully tested: weight-at-0 is provably a no-op (same score with or without rating data present), and directionality is correct (a strong, well-reviewed competitor lowers the factor; a quiet/thin one raises it; a manual on-site read always wins when present).

**2. A user-supplied "previous version" of the Worker turned out to be broken, and it's worth recording exactly how, since it looked plausible on a skim and the mistake is an easy one to repeat.** That file's `GEOAPIFY_ENDPOINT` pointed at Geoapify's *geocoding* endpoint (`/v1/geocode/search`) with a hardcoded London address and a demo API key — both copy-pasted straight from Geoapify's own documentation example — then appended a second `?` onto that already-complete URL to try to add the real category/filter/key parameters. A URL can only have one `?`; everything after the first is already query-string content, so that second `?` and everything after it (including the real API key) just became part of the literal value of the fake demo key. That request could only ever fail — which lines up exactly with the report that motivated this check ("Overpass always seems to fail, and there's no working fallback"). The version in this repo has used the correct endpoint (`api.geoapify.com/v2/places`, actual lat/lng/radius interpolated in) since it was first written, confirmed against Geoapify's own current docs.

While comparing the two files, two genuinely good details from that other draft got adopted here: an actual `User-Agent` header on Overpass calls (this file was sending none — a real omission, and plausibly a second, separate contributor to Overpass failing more than it should), and `sort=-date&limit=1` on the two data.gov.my queries instead of downloading several rows to sort client-side (confirmed as a real, documented parameter after a closer read of developer.data.gov.my/request-query).

**3. `market-radar-settings-reference.xlsx` first created**, matching the same format as `rental-calculator-settings-reference.xlsx` and `cost-structure-checker-settings-reference.xlsx` — current default in column B, a blank yellow-highlighted column for your own value, exact code location, and notes. **Regenerated 2026-09-27 to add everything introduced since — see the top of this doc.**

## 2026-09-17, later the same day: three more ideas checked

**Heat map — already existed.** `leaflet.heat` has been loaded and wired up since before this session — it just had no visibility toggle, so it was easy to not notice sitting under the red competitor pins. Added a "Density heat map" checkbox next to the map legend.

**Live vacant-shop / commercial-property listings — no viable source, built a notepad instead.** Checked JPPH/NAPIC and PropertyGuru/CommercialGuru: no official public API anywhere for current vacancies. Built a plain, non-persistent notepad instead.

**"Which business types are gaining/losing traction, from DOSM" — real data exists, not practically usable at first pass, then reconsidered 2026-09-18 (see below).**

## 2026-09-18: MSIC alignment, DOSM trend (reconsidered), anchors, heat map fix

**MSIC 2008 codes added to every category**, purely as reference metadata shown in the UI. Sourced from Malaysia-specific documents, cross-checked against at least two independent Malaysia-specific sources per code.

**The DOSM business-trend idea — reconsidered, and actually built.** `fetchWholesaleRetailTrend()` in the Worker fetches DOSM's real `iowrt_3d.csv` directly and parses it defensively (header-driven column lookup), caching for 30 days. Still only covers minimart/bakery/hardware/fashion (Section G) and is still Malaysia-wide, not town-specific.

**Vacant shops / Mudah — checked directly:** no official API; every integration is a paid third-party scraper — ruled out on the same grounds as everything else here.

**Car traffic / "car heatmap" — checked, not viable.** No usable free/official path found.

**"Big business" / anchor institutions — built.** `ANCHOR_TAGS` folded into the same combined Overpass query, shown as blue markers plus a count card, informational only.

**Heat map recalibrated.** `max: 3`, weight raised to 1, an explicit 3-stop gradient — see the code's own comments for the full calibration story.

---

Three files, one job each, same split as every other tool on this site:

| File | Runs where | What it does |
|---|---|---|
| `market-radar.html` | Visitor's browser | The page itself — wizard, map, results |
| `market-radar.js` | Visitor's browser | All page logic: geometry, opportunity score, rendering |
| `market-radar-proxy-worker.js` | Cloudflare (your account) | The only thing allowed to hold the OpenRouteService, Gemini, and Geoapify keys |

Drop the first two into the same folder as every other page on the site. The Worker deploys separately, to Cloudflare — see below.

## What works with zero setup

Business density (OpenStreetMap/Overpass) and district demographics (data.gov.my, plus the pinned population fallback) need no API key at all — once the Worker is deployed with just `ALLOWED_ORIGINS` updated, those two layers work immediately. Three things are optional and degrade gracefully without a key:

- **No `ORS_API_KEY`** → every catchment falls back to a plain dashed-circle radius instead of a real walk/drive-time shape. Everything else keeps working.
- **No `GEMINI_API_KEY`** → the "Get a plain-English read" button uses the Workers AI backstop if the `AI` binding exists, otherwise shows an error message. Every number on the page is unaffected either way, since the narrator only describes, never calculates.
- **No `AI` binding** → if Gemini is ever blocked, the read fails with a plain-English explanation instead of falling back. Everything else keeps working.
- **No `GEOAPIFY_API_KEY`** → if every free Overpass mirror happens to be down at once, competitor data shows as honestly unavailable instead of quietly recovering through a second source. Everything else on the page is unaffected.

## Deploying the Worker

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com) if you don't have one.
2. **Workers & Pages → Create → Create Worker**. Name it (e.g. `market-radar-proxy`), deploy the default template, then **Edit code** and replace everything with `market-radar-proxy-worker.js`'s contents. Deploy.
3. **Settings → Variables and Secrets → Add**, as **Secret**:
   - `GEMINI_API_KEY` — the same key your other tools already use
   - `ORS_API_KEY` — see below
   - `GEOAPIFY_API_KEY` — see below
   - ⚠ Spell the names exactly, capitals and underscores included. A misspelled name is silently ignored (this project hit it with `geo_api_key`).
4. Copy the Worker's `*.workers.dev` URL and paste it into `WORKER_ENDPOINT` near the top of `market-radar.js`.
5. **Recommended — the Gemini backstop:** Worker → Settings → **Bindings** → Add → **Workers AI** → variable name `AI`. Free.

### Getting a free OpenRouteService key

Sign up at **[account.heigit.org](https://account.heigit.org)** (openrouteservice moved its account system there). Your key appears as **"Basic Key"** — that's `ORS_API_KEY`. Total quota is 500 isochrones at 20/minute — generous for personal use, and the Worker caches every isochrone for 30 days on top of that. The API itself moved from `api.openrouteservice.org` to `api.heigit.org` — already updated in the Worker.

### Getting a free Geoapify key (only needed as an Overpass backstop)

Sign up at [myprojects.geoapify.com](https://myprojects.geoapify.com) — free, no card, 3,000 credits/day. Never the primary source; only called when every entry in `OVERPASS_MIRRORS` has already failed.

### A note on Overpass, since it broke twice during real testing

**Round one:** a `406` from `overpass-api.de` specifically — a real, independently-reported reliability problem with that one server. Fixed by trying three mirrors in order, plus an `Accept: application/json` header.

**Round two:** every mirror started returning `429`. Cause: Cloudflare Workers share outbound IP ranges across every customer worldwide, and Overpass (no API key concept) can only rate-limit by IP — it can't tell this Worker's traffic apart from any other Workers script that's ever hit it. Fixed with a Geoapify backstop, which rate-limits by key instead of IP.

### The population figure — five rounds wrong before it stopped depending on the live API at all

See the 2026-09-20/22 sections above for the full blow-by-blow. Short version: four different, each-individually-plausible theories about this ONE dataset (wrong row, wrong unit, wrong parameter combination, wrong endpoint) were each written up as "the root cause, fixed" before being tested against the actual live endpoint. Only the fifth check — actually calling the URL and reading the literal response — settled it. **This project has since had one more instance of the same underlying lesson, on a completely different feature: the 2026-09-25 mode-leeching fix, believed sufficient, needed a second round 2026-09-27.** Reasoning about what code *should* do, without a live test, is not the same as confirming what it *does* do.

### "It's taking forever and never finishes" — the actual fix

Fixed with `fetchWithTimeout()` — every external call in the Worker now gets 10 seconds before giving up and moving to the next thing in the chain. Worst case is bounded at roughly 40 seconds, not indefinite. The status line cycles through a few honest "still working" messages every 7 seconds.

## Settings reference

Everything a layperson might want to change lives in one `CONFIG` block near the top of `market-radar.js`, with the current value on the left. **This table is now fully mirrored in `market-radar-settings-reference.xlsx` as of 2026-09-27** — the spreadsheet was regenerated this round specifically to close the gap that had been deferred across the three prior releases.

| Setting | Current value | Where to change it |
|---|---|---|
| Towns available in the wizard | Miri, Kuching, Sibu, Bintulu | `TOWNS`, `market-radar.js` |
| Default town | Miri — **NOT ACTUALLY USED**: declared but never read; the wizard always asks, so changing it has no effect | `DEFAULT_TOWN`, `market-radar.js` |
| Business categories & their OpenStreetMap tags | 13 categories, see `CATEGORY_TAGS` | `CATEGORY_TAGS`, `market-radar.js` |
| Catchment modes offered | 5/10/15-min walk, 5/10/15-min drive — also the full set Market Gap mode uses | `CATCHMENT_MODES`, `market-radar.js` |
| Opportunity score starting weights | Low competition 35%, population 25%, income 15%, diversity 15%, momentum 10%, competitor strength 0% | `SCORE_WEIGHTS_DEFAULT`, `market-radar.js` |
| Competitor count that counts as "saturated" | 12 per business type ticked | `SATURATION_COUNT`, `market-radar.js` |
| District size that maxes out the population sub-score | 120,000 people | `POPULATION_NORMALIZER`, `market-radar.js` |
| District income that maxes out the income sub-score | RM7,000/month | `INCOME_NORMALIZER`, `market-radar.js` |
| Daily analysis limit per browser | 15 | `MAX_ANALYSES_PER_DAY`, `market-radar.js` |
| Pinned population fallback | Miri 255,100 · Kuching 621,700 · Sibu 254,000 · Bintulu 186,600 (DOSM 2023 estimates) | `DISTRICT_POPULATION_FALLBACK_2023`, `market-radar-proxy-worker.js` — refresh yearly by hand |
| Overpass POI cache duration | 24 hours | `fetchOverpassPOIs`, `market-radar-proxy-worker.js` |
| Overpass mirrors tried, in order | overpass-api.de, overpass.kumi.systems, overpass.private.coffee | `OVERPASS_MIRRORS`, `market-radar-proxy-worker.js` |
| Timeout per external call | 10 seconds | `EXTERNAL_CALL_TIMEOUT_MS`, `market-radar-proxy-worker.js` |
| "Still working" status message interval | Every 7 seconds | `PROGRESS_MESSAGES`, `market-radar.js` |
| Geoapify category mapping | 10 categories mapped, "printing"/"pharmacy"/"petrol" unmapped | `GEOAPIFY_CATEGORY_MAP`, `market-radar-proxy-worker.js` |
| Brand-name / keyword fallback for shared-tag categories | "drinks" only | `NAME_HINTS`, `market-radar.js` |
| Isochrone cache duration | 30 days | `fetchIsochrone`, `market-radar-proxy-worker.js` |
| Demographics cache duration | 7 days, successes only | `fetchDemographics`, `market-radar-proxy-worker.js` |
| Websites allowed to call the Worker (CORS) | `reysourcez.com`, `www.reysourcez.com` | `ALLOWED_ORIGINS`, `market-radar-proxy-worker.js` |
| Gemini model used for narration | `gemini-flash-lite-latest` | `GEMINI_MODEL`, `market-radar-proxy-worker.js` |
| Most business types tickable at once | 4 | `MAX_CATEGORIES`, `market-radar.js` |
| Business type ticked on page load | Cafe / kopitiam | `DEFAULT_CATEGORIES`, `market-radar.js` |
| Weight given to an on-site read the moment one is picked | 0.10, taken from Low competition | `ON_SITE_AUTO_WEIGHT`, `market-radar.js` |
| Fallback narration model (Workers AI) | `@cf/meta/llama-3.1-8b-instruct-fp8-fast` | `WORKERS_AI_MODEL`, `market-radar-proxy-worker.js` |
| Largest search radius the Worker accepts | 12,000 m | `MAX_RADIUS_M`, `market-radar-proxy-worker.js` |
| Over-fetch multiplier applied to a catchment's fallback radius before asking Overpass | 1.3× | inline in `analyzeSpot()`'s `fetchAnalysis` call, `market-radar.js` — a candidate factor in the 2026-09-27 pharmacy/petrol report for drive catchments specifically; not changed without live evidence, see that section |
| Most custom items addable to the Market Gap checklist | 8 | `MAX_GAP_CUSTOM_ITEMS`, `market-radar.js` |
| Market Gap "oversupplied" / "thin" thresholds | ≥2× the catchment's own average count = oversupplied; ≤0.4× = thin; 0 = gap always | `computeGapReads()`, `market-radar.js` |
| Worker version shown on the page | 1.6.0 | `WORKER_VERSION`, `market-radar-proxy-worker.js` |
| Client version shown in the console | 1.6.2 | `MR_CLIENT_VERSION`, `market-radar.js` |

## What's built vs. what's KIV

**Built:** wizard, click-to-place pin (with the orphaned-marker fix), live Overpass competitor search with a Geoapify fallback, real isochrone catchment with radius fallback, district population + income with a pinned population fallback, a fully editable opportunity score, category-diversity index, Gemini plain-English narration (both modes), soft daily usage cap, Save as PDF, provenance tags on every stat, the site nav retrofit, a mode-select screen splitting Market Analysis from Market Gap, 13 standard categories, the Market Gap checklist (gap/thin/adequate/oversupplied), custom checklist additions, resetting every result-dependent element on "Edit answers" and on mode-switch. **Added 2026-09-27:** a second, more aggressive round of mode-leeching hardening (`setPanelHidden()` centralising hide/show, `applyModeVisibility()` now called from `analyzeSpot()` too); a diagnostic "outside catchment" marker overlay for the pharmacy/petrol report; `aria-label` on four previously-unlabelled form fields; `market-radar-settings-reference.xlsx` finally regenerated.

**KIV, not built this round:**
- **Confirm live whether the mode-leeching fix actually holds, and which of the three pharmacy/petrol explanations is the real one** — both need a live test this session could not perform itself; see the 2026-09-27 section above.
- **Port anchors, the DOSM trend card, and population/income display to Market Gap mode's results panel.**
- **Verify (don't guess) whether `pharmacy`/`petrol` belong in `IOWRT_GROUPS`**, and add real `GEOAPIFY_CATEGORY_MAP` / `GOOGLE_PLACE_TYPES` entries for both.
- **Household-vs-business/institution personas for Market Gap** — researched, household-only shipped; see the 2026-09-24 section.
- **AppSheet field-survey ingestion** — schema specified in prior revisions of this doc, waiting on the actual Sheet existing.
- **Full MSIC-code alignment** beyond the current 13 categories.
- **Momentum / trend tracking** — needs repeated snapshots.
- **Popularity / foot-traffic signals beyond the current on-site read + optional Google ratings** — researched in earlier rounds, decision made 2026-09-23 to keep the current mechanism as-is.
- **Handoff into the rest of the tool suite** — `rzBroadcast` is called but nothing listens yet; Market Gap mode doesn't broadcast at all.
- **Put the Worker on a custom domain** for real caching.
- **Enforce `Origin` / add Turnstile** to the public Worker endpoint.
- **Show the data year on the population and income cards.**
- **A visibility toggle for the new outside-catchment markers**, if a dense search turns out to make them cluttered — not built pre-emptively without that evidence.
- **Refresh `DISTRICT_POPULATION_FALLBACK_2023` yearly**, or sooner if DOSM fixes either OpenAPI endpoint.
- **Widen the 1.3× over-fetch multiplier for drive catchments**, ONLY if a live check confirms that's actually why a petrol/pharmacy station is being missed — see the 2026-09-27 section; this has a real query-load cost and shouldn't be changed speculatively.


## Other data.gov.my / OpenDOSM datasets worth a look

Full catalogue: `open.dosm.gov.my/data-catalogue`. Beyond `population_district` and `hh_income_district` (both already wired in): `hies_district` (income AND expenditure), `hh_poverty_district` (poverty rate), `lfs_district` (labour force participation), `crime_district` (crime by district/type). `pricecatcher`/`lookup_premise` ruled out (bulk-only, wrong scope). `gdp_district_real_supply` (slow-moving, last published 2020). `msic` (full classification lookup, the natural next step if this tool outgrows its current 13 hand-picked categories).

**Note:** before wiring in any of these the way `population_district` was assumed (but not verified) to work, actually call the dataset's OpenAPI endpoint live first.

## Nav & sync reconciliation (for whichever pass handles this centrally)

Per `AI_BUILD_BRIEF.md`'s own rule, a single-tool build session doesn't patch every other page's nav — that's reconciled centrally. For that pass, when it happens:

- Add the `market-radar.html` entry to the `.nav-dropdown-menu` block on every page still on the old hand-copied pattern (see `NAV_RETROFIT_HOWTO.md`'s own status list for which pages remain).
- Optionally, add a small `market-radar` branch to `handleSyncPayload` in `interactive-costing-analysis.js` and `margin-audit-calculator.js` so a completed Market Radar analysis can pre-fill a starting rent/overhead guess.

## Jargon index

| Term | Plain-English meaning |
|---|---|
| Isochrone | A real "everywhere reachable within N minutes" shape from a routing engine — not a circle. |
| Catchment | The area counted as "around" your pin for this analysis — either a real isochrone, or a radius-circle fallback. |
| Overpass API | OpenStreetMap's free query engine for "find me every X within this area." Rate limiting is by IP address only. |
| Shared IP (Cloudflare Workers) | Every Cloudflare Worker, from every customer worldwide, shares outbound IP ranges — a free API that rate-limits by IP can end up throttled by strangers' usage, not its own. |
| Geoapify | A commercial, OSM-based places API used as a fallback, tried after every Overpass mirror fails. |
| OSM tag | The key=value label OpenStreetMap uses to describe a place, e.g. `amenity=cafe`. |
| Cuisine tag | A more specific OSM sub-tag layered ON TOP of a primary type, e.g. `amenity=cafe` + `cuisine=bubble_tea`. |
| Name hint | A last-resort check on a place's actual NAME for real-world cases where even a cuisine tag is missing. |
| Opportunity score | This tool's own summary number, 0–100: a plain weighted blend of low competition, population, income, and category diversity. |
| Market Gap mode | The second analysis mode. Checks a whole household-needs checklist at once and reports each category as a gap, thin, adequate, or oversupplied. |
| Gap / thin / oversupplied | Market Gap mode's per-category read, RELATIVE to the other categories found in the same catchment — this tool has no verified external "should have N" benchmark. |
| 15-minute city | An urban-planning concept (Carlos Moreno) that a neighbourhood should meet most daily needs within a 15-minute walk or equivalent. Used as research backing for the household checklist. |
| Diversity index | How mixed the businesses near your pin are — a Herfindahl-Hirschman-style measure, inverted so higher = more mixed. |
| Provenance tag | The small "Official / Estimated / Calculated / Observed" label under every stat. |
| DOSM | Department of Statistics Malaysia — the government body behind the population and household-income datasets this tool uses. |
| HIES | Household Income and Expenditure Survey — the survey DOSM's income-by-district numbers come from. |
| Worker | The Cloudflare Worker — holds the OpenRouteService and Gemini keys server-side and caches every external call. |
| OpenDOSM API vs Data Catalogue API | Two separate endpoints on `api.data.gov.my`; as of 2026-09-22, `population_district` doesn't work on EITHER, confirmed live. |
| `filter` / `ifilter` / `icontains` | The query parameters for narrowing data.gov.my rows: exact case-sensitive, exact case-insensitive, and partial case-insensitive respectively. |
| Workers AI | Cloudflare's own AI service — the backstop for the plain-English read when Gemini is unavailable. |
| Binding | A named connection between a Worker and a Cloudflare service, made in Settings — not a secret, no key. |
| Region block (Gemini) | Google's Gemini API refuses requests that arrive from unsupported regions; a Worker's location varies request to request. |
| Pinned fallback (population) | A small, hand-maintained table of known-correct values, read only when a live API is confirmed unable to serve the same data. |
| Workers CPU-time limit | The free Cloudflare Workers plan caps actual JS execution time at 10ms per request — why population isn't parsed live from its full CSV. |
| **Outside-catchment marker** | **Added 2026-09-27.** A hollow, dashed grey circle Market Radar draws for a POI that Overpass returned and that matches an active category, but that sits outside the catchment shape actually being counted — distinguishes "found, just excluded by geometry" from "Overpass never found this at all," which previously looked identical on screen. Never affects any count or score. |
| **`setPanelHidden()`** | **Added 2026-09-27.** The helper `market-radar.js` now uses for every result-panel show/hide; sets both the native `hidden` attribute and an explicit inline `style.display`, as a defensive measure against a possible (unconfirmed) CSS specificity conflict on the shared `.ica-results` class between the two modes' result panels. |
