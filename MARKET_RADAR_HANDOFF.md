<!-- Market Radar — AI Continuity Dossier — v1.6.2 (2026-09-27). Generated FROM the shipped code (function/constant indexes were extracted from the files, not recalled). -->
# Market Radar — AI Continuity Dossier (v1.6.2, 2026-09-27)

**Audience:** a brand-new AI session that must continue this project without any chat history.
**Read order:** this file → `MARKET_RADAR_SETUP_AND_GLOSSARY.md` (history, deploy steps, jargon) → `market-radar-settings-reference.xlsx` (every tunable value) → the three code files.
**Standing rule (learned the hard way, 5+ incidents now):** documentation in this project has repeatedly claimed fixes that were not in the deployed code, and even a fix that WAS deployed has turned out to be built on an unverified guess (see v1.5.0's OpenDOSM switch below — reasoned about, never live-tested, and wrong). Before repeating any "this is fixed / confirmed working" statement — including ones in this file — check the actual shipped file, and prefer a live test over a document. Version tags are on-page ("Worker v1.6.0" under *Competitors in catchment*) so you can tell which build is live. **v1.6.2 adds a second instance of this exact lesson:** v1.6.1's own fix for the mode-leeching report (`applyModeVisibility()`, hardened once) was believed sufficient and was NOT — the person reported it recurring. This session had no live browser access to actually confirm the new root cause either; treat the v1.6.2 fix below the same way — a reasoned, defensive change, not a confirmed one — until someone with live access says otherwise.

---

## 1. System map

```
Browser  https://reysourcez.com/market-radar.html          (GitHub Pages, no build step)
 ├─ market-radar.html   markup + page-specific CSS           (site-wide styles.css?v=16 is NOT in this project —
 │                      this matters for §11's mode-leeching note: this session cannot inspect it)
 │                      site-config.js / nav-config.js populate the shared nav dropdown (2026-09-24
 │                      retrofit — see NAV_RETROFIT_HOWTO.md; both files live outside this project)
 ├─ market-radar.js     state, UI, scoring math              CDN: Leaflet 1.9.4, leaflet.heat 0.2.0 (pinned)
 │   ├─ mode-select ─▶ Market Analysis (one category, opportunity score — unchanged since v1.5.x)
 │   └─ mode-select ─▶ Market Gap (whole checklist at once — added 2026-09-24, see §1a)
 └─ fetch POST JSON ───────────────────────────────────────────────────────────────────────────────┐
                                                                                                    ▼
Cloudflare Worker "market-radar-proxy"  https://market-radar-proxy.reysourcez-ent.workers.dev/   (market-radar-proxy-worker.js)
 ├─ POIs ........ Overpass (3 mirrors, in order) ──all fail──▶ Geoapify Places (key-authenticated)
 ├─ catchment ... OpenRouteService isochrone (api.heigit.org)  ──fail──▶ null → client draws a circle
 ├─ population .. Data Catalogue API ──fail──▶ OpenDOSM API   dataset population_district   ──BOTH CONFIRMED BROKEN 2026-09-22, see §9──▶ pinned 2023 estimate (4 towns only, DISTRICT_POPULATION_FALLBACK_2023)
 ├─ income ...... Data Catalogue /data-catalogue  dataset hh_income_district     ──fallback──▶ OpenDOSM API
 ├─ trend ....... storage.dosm.gov.my/iowrt/iowrt_3d.csv   (national wholesale/retail YoY; 4 of 13 categories — unchanged, pharmacy/petrol not added, see §1a)
 ├─ strength .... Google Places Nearby Search (optional, PAID past 1,000 calls/month; off unless key set)
 └─ narration ... Gemini generateContent ──fail──▶ Workers AI (binding "AI", free tier)      [mode:"insight", branches on snapshot.kind]
```

Design invariants: the browser never talks to third-party data APIs directly (one Worker call per analysis); every number that matters is computed in plain deterministic client JS; the AI only narrates numbers already on screen — true for both modes, see §1a.

### 1a. Market Gap mode (added 2026-09-24, unchanged in shape since)

A second top-level mode, chosen on a `#mr-mode-select` screen shown before the wizard (see §4). Reuses the wizard, map, pin, and catchment machinery unchanged. See §1b below for the one addition v1.6.2 makes that touches both modes equally.

### 1b. Outside-catchment diagnostic markers (added 2026-09-27)

In response to a report that pharmacy/petrol stations visibly near a pin were showing as 0/"Gap" despite the map appearing to show them, `analyzeSpot()` now draws a **hollow grey, dashed circle marker** for any POI Overpass returned that matches an active category but that `catchment.containsPoint()` excluded — i.e., something OSM knows about, inside the wider over-fetch radius, but outside the actual counted shape. This never touches `competitorCount`, `categoryCounts`, the opportunity score, or the Gap checklist's counts — purely a visual diagnostic. It exists to split one previously-ambiguous symptom ("a visible business isn't counted") into three distinguishable ones:

| What's on the map at that spot | What it means |
|---|---|
| A solid red dot | Counted — inside the catchment, one of your active categories |
| A hollow grey dashed dot | Overpass found it, but it's outside the tested catchment shape (isochrone or radius) |
| Only the base OpenStreetMap tile's own icon (e.g. a fuel-pump or pharmacy-cross glyph baked into the map image itself), no coloured dot of either kind | Overpass's own search never returned this node at all — either its search radius didn't reach that far (plausible for `drive10`/`drive15` catchments along a highway, since the Worker's search radius is only `fallbackRadiusM × 1.3`, not the true, possibly-elongated isochrone extent), or the node's actual OSM tags don't match what this tool queries for (worth checking directly on openstreetmap.org) |

**Not fixed, because no single code bug was found to fix:** the underlying pharmacy/petrol report itself. `amenity=pharmacy` and `amenity=fuel` are unambiguous, unshared, correctly-queried tags — nothing about `CATEGORY_TAGS`, `categorize()`, or `cleanTagSet()`'s shared pair-budget counter (checked: all 13 standard categories together use ~23 of the 40-pair cap, nowhere near tight) points to a categorization bug. The three-way table above is the honest deliverable this round; see `MARKET_RADAR_SETUP_AND_GLOSSARY.md`'s 2026-09-27 section for the full reasoning and what a future session should check live.

## 2. Files, versions, hosting

| File | Version | Lives at | Deployed by |
|---|---|---|---|
| `market-radar.html` | 1.6.2 (aria-label added to 4 fields; one new map-legend entry) | site root, GitHub Pages | commit/upload; `<script src="market-radar.js?v=20260927a">` is the cache-buster — change it on every JS release |
| `market-radar.js` | client 1.6.2 (`MR_CLIENT_VERSION`, first line) | site root | same |
| `market-radar-proxy-worker.js` | Worker 1.6.0 — **unchanged this round, no redeploy needed** (`WORKER_VERSION`, first line; returned in `meta.workerVersion`) | Cloudflare Worker, code pasted in dashboard "Edit code" | dashboard paste (no Wrangler) |
| `market-radar-settings-reference.xlsx` | **regenerated this round** — now includes `DISTRICT_POPULATION_FALLBACK_2023`, the two 2026-09-24 categories (pharmacy/petrol), and `MAX_GAP_CUSTOM_ITEMS`, closing out an item deferred across three prior rounds | project | human-facing config sheet: current value, yellow "your value" column, code location, notes |
| `MARKET_RADAR_SETUP_AND_GLOSSARY.md` | — | project | history, deploy steps, jargon |
| `NAV_RETROFIT_HOWTO.md` | — | project | site-wide nav coordination doc; this page's own retrofit is done (2026-09-24), see its own status list |

**Stable filenames are deliberate** — other site pages link to `market-radar.html`. Versions live inside the files and on the page.
**Live-vs-project drift (2026-09-20):** the live page showed *Worker v1.4.0* while the project copies had no version tag; v1.5.0 was rebuilt from the project copies. Anything in v1.4.0 not visible in screenshots may be missing — compare against the live Worker's code before assuming parity. (Historical — re-check the live page's version tag before assuming even THIS file is what's deployed; see the Standing rule at the top, now doubly reinforced by the v1.6.1→v1.6.2 experience.)

### Cloudflare configuration inventory (names must match EXACTLY — a misspelt name is silently ignored; `geo_api_key` vs `GEOAPIFY_API_KEY` cost a debugging round)

| Kind | Name | Needed for | If absent |
|---|---|---|---|
| Secret | `GEMINI_API_KEY` | narration (primary) | falls to Workers AI if bound, else error text |
| Secret | `ORS_API_KEY` | real walk/drive-time shape | client draws a dashed circle |
| Secret | `GEOAPIFY_API_KEY` | POI backstop when all Overpass mirrors fail | `poisError` says so explicitly |
| Secret | `GOOGLE_PLACES_API_KEY` | optional competitor ratings (paid) | feature silently off |
| Binding | `AI` (Workers AI) | narration backstop | no backstop |
| — | `ALLOWED_ORIGINS` | in code: `https://reysourcez.com`, `https://www.reysourcez.com` | CORS falls back to the first entry |

Nothing changed in this table this round — v1.6.2 is a client-only release.

## 3. Client state (market-radar.js)

| Variable | Type / meaning |
|---|---|
| `wizardStepIndex`, `wizardAnswers {town, catchment}` | wizard progress; town key ∈ `TOWNS`, catchment key ∈ `CATCHMENT_MODES` |
| `currentMode` | `'analysis'` \| `'gap'` \| `null`; set only by `chooseMode()`, cleared only by `backToModeSelect()`. Gates `applyModeVisibility()`, `getActiveCategories()`, and which branch of `analyzeSpot()`/`getInsight()` runs |
| `gapCustomItems[]`, `gapCustomCounter` | `{key:'gapcustomN', tagKey, tagValue, label:'k=v'}`; the Market Gap mode equivalent of the single `custom` slot below, but a running list (up to `MAX_GAP_CUSTOM_ITEMS`, 8). Never sent anywhere except folded into the next `categoriesForRequest`; survives `resetAnalysisState()` the same way `vacantUnits` does |
| `map, pinMarker, catchmentLayer, heatLayer, poiMarkers[], anchorMarkers[]` | Leaflet objects; cleared by `clearResultLayers()` before each analysis |
| `outsideMarkers[]` | **added 2026-09-27** — the hollow grey diagnostic markers described in §1b; cleared the same way as `poiMarkers`/`anchorMarkers` in `clearResultLayers()`, redrawn every analysis in both modes |
| `lastAnalysis` | see schema below; `null` until the first analysis, and explicitly nulled again by `resetAnalysisState()` on "Edit answers" AND on switching modes — read by `renderScore`, `renderStrengthCard`, `getInsight`, `renderGapResults` |
| `vacantUnits[]` | `{floor, detail}` notepad entries; never sent anywhere |
| `strengthAutoApplied`, `strengthAutoMoved` | on-site-read auto-weight bookkeeping (§7) — Market Analysis mode only |
| `rzInitialized` | init guard |
| localStorage `mr-usage` | `{day: Date.toDateString(), count}` — soft cap `MAX_ANALYSES_PER_DAY` (15) per browser per day, shared across both modes. Nothing else persists. |

```
// Market Analysis mode (unchanged shape):
lastAnalysis = {
  competitorCount: int,            // selected types only, inside the catchment shape
  competitorBreakdown: [{key, label, count}],   // one per ticked type, sorted by count desc
  categoryCount: int,              // number of types ticked (drives saturation scaling)
  selectedCategories: [key],       // DOM order (= CATEGORY_TAGS order)
  diversityIndex: 0..1,            // over ALL categories found in the catchment, not just ticked ones
  districtPopulation: int|0, districtIncome: number|0,   // 0 = unavailable; population can be a pinned
                                                          // fallback value rather than a live figure — see §9
  demographicsNotes: [string],
  catchmentAreaKm2, catchmentIsReal: bool, districtLabel: string,
  categoryLabel: "A + B + C", competitorRatingSample: [{rating, reviewCount}], anchorCount: int,
  trends: { categoryKey: {growthYoy, asOf, group, label} },
  poisAvailable: bool              // false ⇒ Overpass AND Geoapify both failed; "0 competitors" must never be shown in that case
}

// Market Gap mode (deliberately a DIFFERENT, smaller shape; nothing above applies):
lastAnalysis = {
  poisAvailable: bool,
  gapRows: [{key, label, count, read: 'gap'|'thin'|'adequate'|'oversupplied', perShop: int|null}],  // see computeGapReads()
  districtPopulation: int|0, districtIncome: number|0, demographicsNotes: [string],
  catchmentIsReal: bool, districtLabel: string,
  categoryLabel: "Household needs checklist"
}
```

Note: `outsideMarkers` is a MAP-layer concern only (§1b) — it is never stored on `lastAnalysis` and never sent to the Worker's `mode:'insight'` snapshot in either mode. It is recomputed fresh every `analyzeSpot()` call from the same `pois` array the rest of the function already has in scope.

## 4. Event triggers → handlers

| Trigger | Handler | Effect |
|---|---|---|
| `DOMContentLoaded` | `init()` | builds checkbox list (`renderCategoryOptions`, 13 standard types), fills six weight boxes from `SCORE_WEIGHTS_DEFAULT`, fills catchment `<select>`, binds everything below. Opens on `#mr-mode-select`, not the wizard |
| `#mr-mode-analysis-btn`, `#mr-mode-gap-btn` click | `chooseMode('analysis'\|'gap')` | sets `currentMode`, hides mode-select, shows the wizard, starts it at step 0 |
| wizard option click | inline in `renderWizardStep` | stores answer; last step → `finishWizard()` → shows analysis panel, `initMap(town)`, `applyModeVisibility()` |
| `#wizard-back`, `#mr-edit-answers` | `goBack`, `editAnswers` | wizard navigation; `editAnswers` calls `resetAnalysisState()` first — nulls `lastAnalysis`, hides every result panel in BOTH modes (via `setPanelHidden()`, see §10 item 15), clears the on-site read and undoes its auto-weight shift, resets the AI box and status line. `goBack()` at wizard step 0 calls `backToModeSelect()`; the back button relabels itself to "← Choose a different analysis" at step 0 |
| map click / pin `dragend` | `placePin(lat,lng)` | moves pin, updates `#mr-pin-coords` |
| category checkbox `change` | `syncCategoryUI` | enforces `MAX_CATEGORIES` (Market Analysis mode only): at the cap every *unticked* box is `disabled`; toggles custom-tag row; updates counter |
| `#mr-gap-custom-add` click | `addGapCustomItem()` | validates against `CUSTOM_TAG_PATTERN`, pushes to `gapCustomItems` (cap `MAX_GAP_CUSTOM_ITEMS`), re-renders the list |
| `#mr-analyze-btn` click | `analyzeSpot()` | §5. **v1.6.2: now calls `applyModeVisibility()` as its very first line** — see §10 item 15 |
| `#mr-get-insight` click | `getInsight()` | POST `{mode:'insight', snapshot}` — snapshot shape branches on `currentMode` (§6) |
| weight `input` (×6) | `onWeightEditedByHand` | ends any auto-weight state; recompute total + score — Market Analysis mode only |
| `#mr-observed-busyness` `change` | `onObservedChange` | §7 — Market Analysis mode only (element stays hidden in Market Gap) |
| `#mr-vacancy-add` click | inline | append to `vacantUnits`, `renderVacancyList` |
| `#mr-heat-toggle` `change` | inline | add/remove `heatLayer` |
| `#mr-save-pdf` click | inline | `window.print()` (`.no-print` hides controls) |

## 5. `analyzeSpot()` — exact sequence

0. **v1.6.2 addition:** `applyModeVisibility()` runs FIRST, before anything else in the function — see §10 item 15 for why this is the more important of its two call sites now.
1. Read pin, catchment mode, and the active category list — `getActiveCategories()`: the ticked types in Market Analysis mode, or the full checklist (13 standard + any `gapCustomItems`) in Market Gap mode. **Reject** (status line, no request), Market Analysis mode only: none ticked; > `MAX_CATEGORIES`; custom ticked with empty/invalid key or value. Market Gap mode never rejects on category count.
2. Build `categoriesForRequest`: all 13 standard types always + `custom` only if ticked (Market Analysis) + every `gapCustomItems` entry (Market Gap).
3. Guards: `WORKER_ENDPOINT` set; daily cap. Start progress messages, disable button, `clearResultLayers()` (now also clears `outsideMarkers`).
4. `fetchAnalysis(payload)` (§6). On success `recordUsage()`.
5. `drawCatchment(isochroneGeoJSON|null, …)` → real polygon or dashed circle; returns `containsPoint`, `areaKm2`, `layer`.
6. `applyNameHints(pois)`, then keep POIs inside the catchment; `competitors` = those whose `category ∈ ticked types`; `competitorBreakdown`; `categoryCounts` over all in-catchment POIs.
7. Draw red circle markers, heat layer, **v1.6.2: hollow grey "outside catchment" markers (§1b)**, blue-square anchor markers, fit map to catchment.
8. Fill `lastAnalysis`; render cards; reveal panels (each show now goes through `setPanelHidden(..., false)`); `renderScore()`.
9. Status line: found-N message or `data.poisError`.
10. `rzBroadcast(...)` if `costing-sync.js` is loaded — **no receiver exists yet**; Market Gap mode never broadcasts.

## 6. Worker contract

**Unchanged in v1.6.2** — this was a client-only release; nothing about the request/response shape below is new.

**Request** `POST /` `Content-Type: application/json` (CORS preflight handled):
```
{ lat: number, lng: number,
  radiusM: number,
  categories: { key: { label, tags: [[k,v],…] } },   // 13 standard keys
  selectedCategories: [key,…],
  anchors: { key: { label, tags } },
  isochrone: { profile: 'foot-walking'|'driving-car', seconds: int 60..3600 },
  district: string }
| { mode: 'insight', snapshot: { town, category, competitorCount, breakdown:[{label,count}], diversityIndex,
                                 districtPopulation, districtIncome, opportunityScore, catchmentIsReal, observedBusyness } }
| { mode: 'insight', snapshot: { kind: 'gap', town, rows:[{label,count,read}], districtPopulation, catchmentIsReal } }
```

**Response 200:**
```
{ pois: [{name, lat, lng, category, rating?, reviewCount?}], poisError: string|null,
  anchors: [{name, lat, lng, anchorType}],
  isochrone: GeoJSON|null,
  demographics: { population: int, medianIncome: number, notes: [string] },
  wholesaleRetailTrends: { categoryKey: {group, label, growthYoy, asOf} },   // still just minimart/bakery/hardware/fashion
  wholesaleRetailTrend: <first of the above>|null,
  meta: { workerVersion: "1.6.0", poiSource: "Overpass (overpass-api.de)" | "… , cached" | "Geoapify (Overpass fallback)" | "none" } }
```
Insight: `200 {text, via:'Gemini'|'Workers AI'}` or `500 {error}`. Other codes: `400`/`405`/`502`.

**Timeouts, cache keys:** unchanged — see prior versions of this file or the Worker's own comments.

## 7. Scoring math (all in `computeOpportunityScore`, pure)

```
saturation         = SATURATION_COUNT (12) × max(1, categoryCount)
lowCompetition     = clamp01(1 − competitorCount / saturation)
population         = clamp01(districtPopulation / 120000)
income             = clamp01(districtIncome / 7000)
diversity          = clamp01(1 − Σ(nᵢ/N)²)   over all categories in the catchment (N=0 ⇒ 1)
momentum           = 0.5
competitorStrength = observedBusyness b∈1..5 ? clamp01(1 − (b−1)/4)
                     : ratingSample ? clamp01(1 − mean(clamp01(rating/5) × clamp01(log10(reviews+1)/3)))
                     : 0.5
total              = Σ wᵢ·sᵢ / Σ wᵢ      (Σ wᵢ = 0 ⇒ divide by 1)  → 0..1, shown ×100 rounded
verdict            ≥.75 "Strong opportunity" · ≥.55 "Worth a closer look" · ≥.35 "Competitive, proceed carefully" · else "Crowded — hard to stand out here"
```
Unchanged this round. Weights: `SCORE_WEIGHTS_DEFAULT = {lowCompetition .35, population .25, income .15, diversity .15, momentum .10, competitorStrength 0}`.

**On-site read → weight rule** (`onObservedChange`): unchanged — see prior versions of this file.

## 8. Data schemas

`CATEGORY_TAGS[key] = { label, tags: [[osmKey, osmValue],…], msic: {code, name}|null }` — 13 standard + `custom`. Unchanged this round (no category added/removed).

| key | OSM tags | MSIC 2008 |
|---|---|---|
| cafe | amenity=cafe | 56302 |
| restaurant | amenity=restaurant | 56101 |
| fastfood | amenity=fast_food | 56103 |
| bakery | shop=bakery / pastry / confectionery | 47216 |
| drinks | cuisine=bubble_tea, shop=beverages / tea / coffee | 56303 |
| minimart | shop=convenience / supermarket | 47113 |
| fashion | shop=clothes / shoes | 47711 |
| hardware | shop=hardware / doityourself | 47520 |
| laundry | shop=laundry | 96011 |
| salon | shop=hairdresser / beauty | 96020 |
| printing | shop=copyshop / printing | 82190 |
| pharmacy | amenity=pharmacy | 47721 *(cross-checked against India's NIC-2008, not a direct Malaysia SSM/DOSM lookup — still unverified as of this round; not the suspected cause of the 2026-09-27 report, see §1b)* |
| petrol | amenity=fuel | 47300 *(same caveat, cross-checked against Sweden's SNI)* |

Classification rule (`categorize` in the Worker): `cuisine=*` pairs checked first across every category, then other pairs; first match wins. Neither `pharmacy` nor `petrol` need this priority pass — their tags aren't shared with anything else in this table.
`ANCHOR_TAGS`, `CATCHMENT_MODES`, `TOWNS`, `IOWRT_GROUPS`: unchanged this round — see prior versions of this file.

## 9. External APIs — what is verified

Unchanged this round — see `MARKET_RADAR_SETUP_AND_GLOSSARY.md` for the full table and the population saga's history. No external API call changed shape or endpoint in v1.6.2.

## 10. Decision log / invariants (do not silently break)

1. Anchors (schools, hospitals…) are never competitors and never touch the score.
2. AI narrates only; never asked to compute or recommend. `gapInsightPrompt()` follows the identical rule with an explicit relative-framing instruction.
3. Every stat carries provenance (*Official* / *Estimated* / *Calculated* / *Observed*). A pinned population fallback is still "Official — DOSM" but also carries an explanatory note even when non-zero.
4. "0 competitors" ≠ "couldn't check": `poisAvailable` gates both the card text and the verdict suffix.
5. Failures are never cached; a partial failure returns 200 with a reason string, never a blank screen.
6. Weights auto-normalise (÷Σw); the "should add to 1.00" warning is transparency, not validation.
7. Free/official/open data only.
8. The Worker is public: CORS does not stop curl. All client input is validated. Not yet enforced: `Origin` check / Turnstile (KIV).
9. No persistence beyond the daily usage counter; the vacancy notepad and on-site read reset on tab close.
10. A "custom" OSM tag counts as one of the ≤4 types and is sent alongside all standard types.
11. Going back to "Edit answers" always resets every result-dependent element to its pre-analysis state; `backToModeSelect()` runs the same reset before returning to `#mr-mode-select`.
12. Market Gap's gap/thin/oversupplied read is ALWAYS relative to the other checklist categories found in the SAME catchment, never against an external "should have N" number.
13. `initMap()` always resets `pinMarker = null` before rebuilding the Leaflet map.
14. `applyModeVisibility()` force-hides the INACTIVE mode's entire output every time it runs (v1.6.1), not just on the assumption that `resetAnalysisState()` already ran.
15. **NEW, v1.6.2 — panel visibility is centralised through `setPanelHidden(id, hide)`, which sets BOTH the native `hidden` attribute and an inline `style.display`, and `applyModeVisibility()` is now called at the TOP of `analyzeSpot()` in addition to `finishWizard()`.** Rationale: v1.6.1's fix (item 14 above) was only ever invoked when the analysis screen first appeared for a mode; it was never re-asserted at the one moment that actually produces new output. The person reported the leeching recurring after v1.6.1 shipped, so this round moves the enforcement to run immediately before every single analysis, not just once per screen-visit — this closes the sequencing gap regardless of whether a CSS conflict on the shared `.ica-results` class was ALSO a contributing factor (unconfirmed either way; this session had no live access to styles.css or the deployed page to check computed styles directly). **If this recurs a third time, the CSS-conflict hypothesis is the next thing to actually verify live** — inspect computed `display` on the stuck panel in DevTools, not another code guess from a session without eyes on the page.
16. **NEW, v1.6.2 — the hollow-grey "outside catchment" markers (§1b) are diagnostic only.** They must never be added to `competitorCount`, `categoryCounts`, `computeDiversityIndex`'s input, `computeGapReads`'s input, or any Worker-bound snapshot. If a future change to the marker-drawing code accidentally starts double-counting from `outsideCatchmentPois`, that breaks invariant 12 (Gap mode's relative read) silently.

## 11. Known limitations / unverified as of 2026-09-27

- **Pharmacy/petrol undercounting — NOT resolved.** See §1b's three-way table and `MARKET_RADAR_SETUP_AND_GLOSSARY.md`'s 2026-09-27 section. Three candidate explanations, not mutually exclusive, none confirmed: (a) the point genuinely sits outside the real catchment shape while still rendering inside the wider, padded map view (`fitBounds` padding + Overpass's `radiusM × 1.3` over-fetch can both make something "visible" without being "counted"); (b) for drive catchments specifically, `fallbackRadiusM × 1.3` may not reach as far as a real elongated isochrone along a highway, meaning Overpass's OWN search misses the node entirely, before any client-side filtering happens; (c) the specific OSM node's tagging doesn't actually match `amenity=fuel`/`amenity=pharmacy` (needs a direct openstreetmap.org check, not a code fix). The new outside-catchment markers (§1b) let a person distinguish (a)/(b)-together from (c) at a glance; distinguishing (a) from (b) specifically would need comparing the marker (or its absence) against the catchment polygon's own visible outline. **Next AI session: do NOT touch the `1.3` multiplier or `CATEGORY_TAGS.pharmacy`/`.petrol` without a live test confirming which of (a)/(b)/(c) is actually happening** — this project has a documented history (§9) of "fixing" this exact kind of thing based on reasoning alone and being wrong.
- **Mode-leeching — believed fixed, NOT confirmed live.** See §10 item 15. This is the SECOND fix attempt for the same report (first: v1.6.1's `applyModeVisibility()` hardening). If a person reports it recurring a third time, escalate straight to "inspect computed CSS on the stuck element," not another sequencing guess.
- Market Gap mode still doesn't show anchors, the DOSM trend card, or the population/income display cards the way Market Analysis mode does — display-only work, still deferred.
- `pharmacy`/`petrol` still have no `GEOAPIFY_CATEGORY_MAP` or `GOOGLE_PLACE_TYPES` entries, and still aren't in `IOWRT_GROUPS` — all three remain deliberately unguessed pending a live check against each source.
- Household-needs checklist is still single-persona (household only) — see prior versions of this file / the setup doc for the research reasoning.
- **`DEFAULT_TOWN` (market-radar.js) is dead config** — declared, never read; the wizard always asks for the town. Earlier docs listed it as a working setting. Found 2026-09-27 by grepping for its usages. Harmless; remove it or wire it up as a deliberate decision, don't assume it does anything.
- Everything else unchanged from v1.6.1 — see that revision's own §11 (population pinned-fallback maintenance, no as-of year shown, Cache API on `*.workers.dev` unguaranteed, Gemini region-blocking, daily cap trivially bypassed) for items this round didn't touch.

## 12. Regression suite (kit: `market-radar-test-kit.zip`; re-create if lost)

Everything from prior versions still applies (Worker's 17 tests, Browser's 27, the v1.5.1/v1.5.2/v1.6.0/v1.6.1 gaps already logged in earlier revisions of this file) plus:
- **v1.6.2 gap, not yet closed:** no test covers `setPanelHidden()` actually forcing `style.display` — needs: toggle a panel hidden via the helper, assert BOTH `el.hidden === true` AND `getComputedStyle(el).display === 'none'` (a test that only checks `.hidden` would have passed on the v1.6.1 code too, and evidently didn't catch the recurrence). No test covers `applyModeVisibility()` running at the top of `analyzeSpot()` specifically — needs a scenario that would have caught the ACTUAL reported bug: complete a Gap analysis, switch to Analysis mode via mode-select (not just via a fresh page load), tick a category, click Analyze, and assert `#mr-gap-results` is hidden THROUGHOUT the analyze call, not just after `finishWizard()`. No test covers the new outside-catchment markers — needs: mock a Worker response with one POI outside the mocked catchment polygon, assert it draws as a hollow marker and is absent from `competitorCount`.

## 13. Open items (KIV)

**Resolved this round (2026-09-27):** `market-radar-settings-reference.xlsx` regenerated (deferred across three prior rounds) · four unlabelled form fields given `aria-label` (`mr-vacancy-floor`, `mr-vacancy-detail`, `mr-gap-custom-key`, `mr-gap-custom-value`) · a diagnostic overlay for the pharmacy/petrol report (the report itself is NOT resolved, see §11).

**Still open, unchanged from v1.6.1:** refresh `DISTRICT_POPULATION_FALLBACK_2023` about once a year · add the `AI` binding · show data year on population/income · custom domain for the Worker · `Origin` enforcement / Turnstile · receiving side of `rzBroadcast` (Market Gap mode still has no broadcast shape designed at all) · central nav reconciliation on the other pages · AppSheet field-survey layer · momentum sub-score needs snapshot history · candidate DOSM datasets (`hies_district`, `lfs_district`, `hh_poverty_district`, `crime_district`) · port anchors/trend/population display into `#mr-gap-results` · verify `pharmacy`/`petrol` against `IOWRT_GROUPS`/`GEOAPIFY_CATEGORY_MAP`/`GOOGLE_PLACE_TYPES` · household-vs-business/institution personas for Market Gap.

**New from this round:**
- **Live-verify which of the three pharmacy/petrol explanations (§11) is actually happening**, ideally by re-running the exact spot that triggered the report with the new v1.6.2 markers visible, and reporting back which of the three table rows in §1b matched.
- **Confirm the v1.6.2 mode-leeching fix actually holds** by repeating the exact switch-modes-then-analyze sequence that produced the original report.
- **If either of the above still fails:** for leeching, inspect computed CSS on the stuck panel directly (this session could not); for pharmacy/petrol, widen the Overpass over-fetch multiplier for drive catchments specifically (a real trade-off against Overpass/Geoapify load — don't do this without evidence it's actually explanation (b) from §11) or check the specific node's tags directly on openstreetmap.org (evidence for explanation (c)).
