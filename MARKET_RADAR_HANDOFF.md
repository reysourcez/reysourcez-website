<!-- Market Radar — AI Continuity Dossier — v1.5.1 (2026-09-22). Generated FROM the shipped code (function/constant indexes were extracted from the files, not recalled). -->
# Market Radar — AI Continuity Dossier (v1.5.1, 2026-09-22)

**Audience:** a brand-new AI session that must continue this project without any chat history.
**Read order:** this file → `MARKET_RADAR_SETUP_AND_GLOSSARY.md` (history, deploy steps, jargon) → `market-radar-settings-reference.xlsx` (every tunable value) → the three code files.
**Standing rule (learned the hard way, 5+ incidents now):** documentation in this project has repeatedly claimed fixes that were not in the deployed code, and even a fix that WAS deployed has turned out to be built on an unverified guess (see v1.5.0's OpenDOSM switch below — reasoned about, never live-tested, and wrong). Before repeating any "this is fixed / confirmed working" statement — including ones in this file — check the actual shipped file, and prefer a live test over a document. Version tags are on-page ("Worker v1.5.1" under *Competitors in catchment*) so you can tell which build is live.

---

## 1. System map

```
Browser  https://reysourcez.com/market-radar.html          (GitHub Pages, no build step)
 ├─ market-radar.html   markup + page-specific CSS           (site-wide styles.css?v=16 is NOT in this project)
 ├─ market-radar.js     state, UI, scoring math              CDN: Leaflet 1.9.4, leaflet.heat 0.2.0 (pinned)
 └─ fetch POST JSON ───────────────────────────────────────────────────────────────────────────────┐
                                                                                                    ▼
Cloudflare Worker "market-radar-proxy"  https://market-radar-proxy.reysourcez-ent.workers.dev/   (market-radar-proxy-worker.js)
 ├─ POIs ........ Overpass (3 mirrors, in order) ──all fail──▶ Geoapify Places (key-authenticated)
 ├─ catchment ... OpenRouteService isochrone (api.heigit.org)  ──fail──▶ null → client draws a circle
 ├─ population .. Data Catalogue API ──fail──▶ OpenDOSM API   dataset population_district   ──BOTH CONFIRMED BROKEN 2026-09-22, see §9──▶ pinned 2023 estimate (4 towns only, DISTRICT_POPULATION_FALLBACK_2023)
 ├─ income ...... Data Catalogue /data-catalogue  dataset hh_income_district     ──fallback──▶ OpenDOSM API
 ├─ trend ....... storage.dosm.gov.my/iowrt/iowrt_3d.csv   (national wholesale/retail YoY; 4 of 11 categories)
 ├─ strength .... Google Places Nearby Search (optional, PAID past 1,000 calls/month; off unless key set)
 └─ narration ... Gemini generateContent ──fail──▶ Workers AI (binding "AI", free tier)      [mode:"insight" only]
```

Design invariants: the browser never talks to third-party data APIs directly (one Worker call per analysis); every number that matters is computed in plain deterministic client JS; the AI only narrates numbers already on screen.

## 2. Files, versions, hosting

| File | Version | Lives at | Deployed by |
|---|---|---|---|
| `market-radar.html` | 1.5.0 markup (comment on line 2 notes v1.5.1 pairing — the page itself didn't change this round, only the cache-buster) | site root, GitHub Pages | commit/upload; `<script src="market-radar.js?v=20260922a">` is the cache-buster — change it on every JS release |
| `market-radar.js` | client 1.5.1 (`MR_CLIENT_VERSION`, first line) | site root | same |
| `market-radar-proxy-worker.js` | Worker 1.5.1 (`WORKER_VERSION`, first line; returned in `meta.workerVersion`) | Cloudflare Worker, code pasted in dashboard "Edit code" | dashboard paste (no Wrangler) |
| `market-radar-settings-reference.xlsx` | — (not regenerated this round — nothing in it is wrong, but it doesn't yet list `DISTRICT_POPULATION_FALLBACK_2023`; see §13) | project | human-facing config sheet: current value, yellow "your value" column, code location, notes |
| `MARKET_RADAR_SETUP_AND_GLOSSARY.md` | — | project | history, deploy steps, jargon |

**Stable filenames are deliberate** — other site pages link to `market-radar.html`. Versions live inside the files and on the page.
**Live-vs-project drift (2026-09-20):** the live page showed *Worker v1.4.0* while the project copies had no version tag; v1.5.0 was rebuilt from the project copies. Anything in v1.4.0 not visible in screenshots may be missing — compare against the live Worker's code before assuming parity. (This note is historical — v1.5.1 has moved on from v1.5.0, so re-check the live page's version tag before assuming even THIS file is what's deployed.)

### Cloudflare configuration inventory (names must match EXACTLY — a misspelt name is silently ignored; `geo_api_key` vs `GEOAPIFY_API_KEY` cost a debugging round)

| Kind | Name | Needed for | If absent |
|---|---|---|---|
| Secret | `GEMINI_API_KEY` | narration (primary) | falls to Workers AI if bound, else error text |
| Secret | `ORS_API_KEY` | real walk/drive-time shape | client draws a dashed circle |
| Secret | `GEOAPIFY_API_KEY` | POI backstop when all Overpass mirrors fail | `poisError` says so explicitly |
| Secret | `GOOGLE_PLACES_API_KEY` | optional competitor ratings (paid) | feature silently off |
| Binding | `AI` (Workers AI) | narration backstop | no backstop |
| — | `ALLOWED_ORIGINS` | in code: `https://reysourcez.com`, `https://www.reysourcez.com` | CORS falls back to the first entry |

Nothing changed in this table in v1.5.1 — the population fix needed no new secret or binding, which is the point of pinning the value instead of adding another API dependency.

## 3. Client state (market-radar.js)

| Variable | Type / meaning |
|---|---|
| `wizardStepIndex`, `wizardAnswers {town, catchment}` | wizard progress; town key ∈ `TOWNS`, catchment key ∈ `CATCHMENT_MODES` |
| `map, pinMarker, catchmentLayer, heatLayer, poiMarkers[], anchorMarkers[]` | Leaflet objects; cleared by `clearResultLayers()` before each analysis |
| `lastAnalysis` | see schema below; `null` until the first analysis; read by `renderScore`, `renderStrengthCard`, `getInsight` |
| `vacantUnits[]` | `{floor, detail}` notepad entries; never sent anywhere |
| `strengthAutoApplied`, `strengthAutoMoved` | on-site-read auto-weight bookkeeping (§7) |
| `rzInitialized` | init guard |
| localStorage `mr-usage` | `{day: Date.toDateString(), count}` — soft cap `MAX_ANALYSES_PER_DAY` (15) per browser per day. Nothing else persists. |

```
lastAnalysis = {
  competitorCount: int,            // selected types only, inside the catchment shape
  competitorBreakdown: [{key, label, count}],   // one per ticked type, sorted by count desc
  categoryCount: int,              // number of types ticked (drives saturation scaling)
  selectedCategories: [key],       // DOM order (= CATEGORY_TAGS order)
  diversityIndex: 0..1,            // over ALL categories found in the catchment, not just ticked ones
  districtPopulation: int|0, districtIncome: number|0,   // 0 = unavailable; population can now be a pinned
                                                          // fallback value rather than a live figure — see §9
  demographicsNotes: [string],     // Worker's reason strings — since v1.5.1 these can accompany a NON-zero
                                    // population too (the "showing DOSM's 2023 estimate instead" note)
  catchmentAreaKm2, catchmentIsReal: bool, districtLabel: string,
  categoryLabel: "A + B + C", competitorRatingSample: [{rating, reviewCount}], anchorCount: int,
  trends: { categoryKey: {growthYoy, asOf, group, label} },
  poisAvailable: bool              // false ⇒ Overpass AND Geoapify both failed; "0 competitors" must never be shown in that case
}
```

## 4. Event triggers → handlers

| Trigger | Handler | Effect |
|---|---|---|
| `DOMContentLoaded` | `init()` | builds checkbox list (`renderCategoryOptions`), fills six weight boxes from `SCORE_WEIGHTS_DEFAULT`, fills catchment `<select>`, starts wizard, binds everything below |
| wizard option click | inline in `renderWizardStep` | stores answer; last step → `finishWizard()` → shows analysis panel, `initMap(town)` |
| `#wizard-back`, `#mr-edit-answers` | `goBack`, `editAnswers` | wizard navigation |
| map click / pin `dragend` | `placePin(lat,lng)` | moves pin, updates `#mr-pin-coords` |
| category checkbox `change` | `syncCategoryUI` | enforces `MAX_CATEGORIES`: at the cap every *unticked* box is `disabled`; toggles custom-tag row; updates counter |
| `#mr-analyze-btn` click | `analyzeSpot()` | §5 |
| `#mr-get-insight` click | `getInsight()` | POST `{mode:'insight', snapshot}` |
| weight `input` (×6) | `onWeightEditedByHand` | ends any auto-weight state; recompute total + score |
| `#mr-observed-busyness` `change` | `onObservedChange` | §7 |
| `#mr-vacancy-add` click | inline | append to `vacantUnits`, `renderVacancyList` |
| `#mr-heat-toggle` `change` | inline | add/remove `heatLayer` |
| `#mr-save-pdf` click | inline | `window.print()` (`.no-print` hides controls) |

## 5. `analyzeSpot()` — exact sequence

1. Read pin, catchment mode, ticked types. **Reject** (status line, no request): none ticked; > `MAX_CATEGORIES`; custom ticked with empty/invalid key or value (`CUSTOM_TAG_PATTERN = /^[A-Za-z0-9_:\-]{1,40}$/`).
2. Build `categoriesForRequest`: **all 11 standard types always** (keeps the diversity index meaningful) + `custom` `{label:"k=v", tags:[[k,v]]}` only if ticked.
3. Guards: `WORKER_ENDPOINT` set; daily cap (`getUsageToday()+1 ≤ 15`). Start progress messages (cycle every 7 s), disable button, `clearResultLayers()`.
4. `fetchAnalysis(payload)` (§6). On success `recordUsage()`.
5. `drawCatchment(isochroneGeoJSON|null, …)` → real polygon (`isReal:true`, GeoJSON `[lng,lat]` flipped to `[lat,lng]`) or dashed circle of `fallbackRadiusM`; returns `containsPoint`, `areaKm2`, `layer`.
6. `applyNameHints(pois)` (brand/keyword names override category → `drinks`), then keep POIs inside the catchment; `competitors` = those whose `category ∈ ticked types`; `competitorBreakdown`; `categoryCounts` over all in-catchment POIs.
7. Draw red circle markers (tooltip: name, plus ` — <type>` when >1 type ticked), heat layer (`radius 35, blur 25, max 3`, gradient teal→amber→red, weight 1), blue-square anchor markers, fit map to catchment.
8. Fill `lastAnalysis`; render cards: competitor count + provenance `catchmentShape · OSM via <meta.poiSource> · Worker v<meta.workerVersion>` + per-type breakdown line; diversity; population/income (population's note now shows whenever the Worker sends one, even on a non-zero value — v1.5.1, see §9 — income's note still only shows at 0); strength card (`renderStrengthCard`); anchors; trend (`renderTrendCard`); reveal panels; `renderScore()`.
9. Status line: `Found N competitor(s) across K business types (…)` or, for one type, `Found N matching <label> competitors…`; or `data.poisError` (error style).
10. `rzBroadcast({source:'market-radar', category, categories, district, competitorCount, opportunityScore})` if `costing-sync.js` is loaded — **no receiver exists yet** (Interactive Costing Analysis / Margin Analysis don't handle this source).

## 6. Worker contract

**Request** `POST /` `Content-Type: application/json` (CORS preflight handled):
```
{ lat: number, lng: number,                       // required; finite; |lat|≤90, |lng|≤180
  radiusM: number,                                // client sends round(fallbackRadiusM × 1.3); Worker clamps to [100, 12000]
  categories: { key: { label, tags: [[k,v],…] } },// required object; sanitised (see below)
  selectedCategories: [key,…],                    // ≤12 strings; drives the DOSM trend lookup. Legacy: selectedCategory (string)
  anchors: { key: { label, tags } },
  isochrone: { profile: 'foot-walking'|'driving-car', seconds: int 60..3600 },   // anything else ⇒ ignored (null)
  district: string }                              // reduced to [A-Za-z .'-], ≤60 chars (prevents extra filter conditions via @ or ,)
| { mode: 'insight', snapshot: { town, category, competitorCount, breakdown:[{label,count}], diversityIndex,
                                 districtPopulation, districtIncome, opportunityScore, catchmentIsReal, observedBusyness } }
```
Sanitising: tag keys/values must match `TAG_TOKEN = /^[A-Za-z0-9_:\-]{1,40}$/`; category keys `[A-Za-z0-9_-]{1,30}`; ≤40 tag pairs for categories, ≤30 for anchors; `__proto__` dropped; all client strings clipped and newline-stripped before entering a prompt.

**Response 200** (also used for *partial* data — never throw for one failed source):
```
{ pois: [{name, lat, lng, category, rating?, reviewCount?}], poisError: string|null,
  anchors: [{name, lat, lng, anchorType}],
  isochrone: GeoJSON|null,
  demographics: { population: int, medianIncome: number, notes: [string] },     // notes explain why a
                                                                                 // figure is 0, OR (population
                                                                                 // only, since v1.5.1) why a
                                                                                 // NON-zero figure is a pinned
                                                                                 // fallback rather than live
  wholesaleRetailTrends: { categoryKey: {group, label, growthYoy, asOf} },      // only tracked types
  wholesaleRetailTrend: <first of the above>|null,                              // legacy single shape
  meta: { workerVersion: "1.5.1", poiSource: "Overpass (overpass-api.de)" | "… , cached" | "Geoapify (Overpass fallback)" | "none" } }
```
Insight: `200 {text, via:'Gemini'|'Workers AI'}` or `500 {error}`. Other codes: `400` malformed/invalid body, `405` non-POST, `502` unexpected exception.

**Timeouts** (`fetchWithTimeout`): 10 s default (`EXTERNAL_CALL_TIMEOUT_MS`) per Overpass mirror/Geoapify/ORS/Gemini; 8 s per DOSM API call; 15 s for the iowrt CSV. Worst case for the POI leg: 3 mirrors + Geoapify ≈ 40 s. (v1.5.1 does NOT add a population CSV fetch — see §9 — so no new timeout budget was needed; a full-file parse of `population_district.csv`, ~100x bigger than the iowrt CSV, was deliberately avoided specifically because Cloudflare Workers' free plan caps CPU time at 10ms/request and that parse risked exceeding it for no real benefit.)

**Cache keys** (Cloudflare Cache API; helpers `cacheGet/cachePut` never throw; Cloudflare only *guarantees* the Cache API on custom domains, so **nothing may depend on it**): `overpass/<hash(query)>` 24 h · `geoapify/<hash>` 24 h · `google-popularity/<hash>` 24 h · `isochrone/<profile>/<seconds>/<lat.3>/<lng.3>` 30 d · `demographics-v2/<district lowercased>` 7 d, **successes only, each figure independently** · `iowrt/<group>` 30 d. (No new cache key in v1.5.1 — `DISTRICT_POPULATION_FALLBACK_2023` is a plain in-code constant, not cached data, so it costs nothing to read and never goes stale from a cache's point of view — only from the calendar.)

## 7. Scoring math (all in `computeOpportunityScore`, pure)

```
saturation         = SATURATION_COUNT (12) × max(1, categoryCount)          // ASSUMPTION (2026-09-20): 12 per ticked type
lowCompetition     = clamp01(1 − competitorCount / saturation)
population         = clamp01(districtPopulation / 120000)
income             = clamp01(districtIncome / 7000)
diversity          = clamp01(1 − Σ(nᵢ/N)²)   over all categories in the catchment (N=0 ⇒ 1)
momentum           = 0.5                        // placeholder until snapshot history exists
competitorStrength = observedBusyness b∈1..5 ? clamp01(1 − (b−1)/4)
                     : ratingSample ? clamp01(1 − mean(clamp01(rating/5) × clamp01(log10(reviews+1)/3)))
                     : 0.5
total              = Σ wᵢ·sᵢ / Σ wᵢ      (Σ wᵢ = 0 ⇒ divide by 1)  → 0..1, shown ×100 rounded
verdict            ≥.75 "Strong opportunity" · ≥.55 "Worth a closer look" · ≥.35 "Competitive, proceed carefully" · else "Crowded — hard to stand out here"
```
Weights: `SCORE_WEIGHTS_DEFAULT = {lowCompetition .35, population .25, income .15, diversity .15, momentum .10, competitorStrength 0}` — the six `#mr-weight-*` boxes are **filled from this constant on load** (HTML `value=` attributes are only a fallback). Before 2026-09-20 the constant was dead code and the docs pointed at it anyway. (Unaffected by v1.5.1 — the `population` sub-score reads whatever `districtPopulation` the Worker sent, live or pinned, identically either way.)

**On-site read → weight rule** (`onObservedChange`): first read picked while competitorStrength weight is 0 ⇒ `competitorStrength := 0.10`, `lowCompetition -= min(0.10, current)`, notice shown, `strengthAutoApplied = true`. Clearing the read restores both. Any hand edit of a weight sets `strengthAutoApplied = false` and hides the notice. Switching between reads never re-applies.

## 8. Data schemas

`CATEGORY_TAGS[key] = { label, tags: [[osmKey, osmValue],…], msic: {code, name}|null }` — 11 standard + `custom` (no tags of its own).

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

Classification rule (`categorize` in the Worker): **all `cuisine=*` pairs are checked first across every category**, then other pairs; first match wins. Reason: OSM tags a bubble-tea stall `amenity=cafe` + `cuisine=bubble_tea`; without priority "cafe" claims it. `NAME_HINTS.drinks` (client) re-buckets by brand/keyword afterwards.
`ANCHOR_TAGS`: school, college (university|college), health (hospital|clinic), mall (mall|department_store), govt (office=government|amenity=townhall), worship, transport (bus_station|aeroway=terminal) — informational only.
`CATCHMENT_MODES`: walk5 300 s/400 m · walk10 600 s/800 m · walk15 900 s/1,200 m · drive5 300 s/2,500 m · drive10 600 s/5,000 m · drive15 900 s/8,000 m (seconds = ORS range; metres = plain-circle fallback).
`TOWNS`: miri (4.4148, 113.9917) · kuching (1.5535, 110.3593) · sibu (2.2870, 111.8305) · bintulu (3.1668, 113.0413); `district` must equal DOSM's district spelling. **v1.5.1: also the exact key set of `DISTRICT_POPULATION_FALLBACK_2023` in the Worker — adding a 5th town here means adding its district to that table too, by hand (see §9).**
`IOWRT_GROUPS` (national trend): minimart 471 · bakery 472 · hardware 475 · fashion 477 — the only categories in DOSM's wholesale/retail index (MSIC Section G).

## 9. External APIs — what is verified

| Source | Call | Limits | Status |
|---|---|---|---|
| Overpass | `POST https://<mirror>/api/interpreter`, text/plain QL body, `Accept: application/json`, custom `User-Agent` | IP-rate-limited; Workers share IPs ⇒ 429s | working (live page showed `overpass-api.de`) |
| Geoapify | `GET https://api.geoapify.com/v2/places?categories=…&filter=circle:<lng>,<lat>,<r>&limit=500&apiKey=…` (NOT the geocoding endpoint) | 3,000 credits/day | key name fixed 2026-09-20 |
| ORS | `POST https://api.heigit.org/openrouteservice/v2/isochrones/<profile>`, `Authorization: <key>`, body `{locations:[[lng,lat]], range:[s], range_type:'time'}` | ~500 total, 20/min (per earlier setup notes) | working |
| Data Catalogue (income) | `GET https://api.data.gov.my/data-catalogue?id=hh_income_district&ifilter=<District>@district&sort=-date&limit=1` → `income_median` (RM) | 4/min per API | **working** (RM6,600 for Miri on live page) |
| Data Catalogue (population) | `GET https://api.data.gov.my/data-catalogue?id=population_district&limit=3` — same endpoint the dataset's OWN page documents as correct | 4/min per API | **CONFIRMED BROKEN, 2026-09-22** — answers `[]`, even for this exact unfiltered sample query from DOSM's own docs |
| OpenDOSM (population) | `GET https://api.data.gov.my/opendosm?id=population_district&ifilter=<District>@district&sort=-date&limit=1000` | 4/min per API, no token | **CONFIRMED BROKEN, 2026-09-22** — HTTP 400 (`` `district` used in `ifilter` filter is an invalid column value. Valid columns: [] ``) on EVERY request, filtered or unfiltered — this endpoint doesn't recognise `population_district` as a dataset at all right now, it isn't a filter-syntax problem |
| DOSM CSV (iowrt) | `GET https://storage.dosm.gov.my/iowrt/iowrt_3d.csv` (CC BY 4.0); header-driven columns `date, series_type, group, <value>`; latest `growth_yoy` per group; empty cells are skipped | monthly data | working per earlier sessions |
| Gemini | `POST …/v1beta/models/gemini-flash-lite-latest:generateContent?key=…` | region-blocked from some Cloudflare colos ("User location is not supported for the API use") | intermittent by nature |
| Workers AI | `env.AI.run('@cf/meta/llama-3.1-8b-instruct-fp8-fast', {messages, max_tokens:260, temperature:0.4})` | 10,000 neurons/day free; ~10 per read (Cloudflare pricing page, 2026-09-17) | not yet exercised on the live account |
| Google Places (optional) | `POST https://places.googleapis.com/v1/places:searchNearby`, field mask `places.displayName,places.location,places.rating,places.userRatingCount` | paid past 1,000/month; needs billing | off |

**DOSM query rules** (developer.data.gov.my/request-query, read 2026-09-20): `filter` = exact, case-sensitive, and the ONLY parameter documented for several `value@column` pairs; `ifilter` = exact, case-insensitive, ONE `value@column`; `icontains` = partial, case-insensitive; `sort=-col` descending; `limit`; `include/exclude` columns.
**The four-round population bug:** three rounds tweaked filter syntax; the fourth round (v1.5.0) concluded `population_district` is served by `/opendosm`, while `/data-catalogue` returns `[]` for it even with no filters (checked live 2026-09-20 with the dataset page's own sample query). *When a query returns nothing, test the unfiltered query first.*
**Round five, 2026-09-22 — the fourth round's conclusion was ALSO wrong, this time confirmed by actually calling the endpoint rather than reasoning about it.** `/opendosm?id=population_district` returns HTTP 400 ("invalid column value, valid columns: []") on every request — filtered (screenshot from the live page) and unfiltered (tested directly) — meaning this endpoint doesn't recognise the dataset id at all. `/data-catalogue?id=population_district&limit=3` still answers `[]` too, even though it's what the dataset's own page documents as correct. **Conclusion: neither OpenAPI endpoint currently serves this dataset — a gap on DOSM's backend, not a bug in this project's code.** v1.5.1 stops chasing the live API for this one figure and pins the four supported districts' 2023 estimates directly in the Worker (`DISTRICT_POPULATION_FALLBACK_2023`), sourced this round from DOSM's own Kawasanku dashboard (`open.dosm.gov.my/dashboard/kawasanku`) and cross-checked against citypopulation.de (both cite DOSM directly) — Miri and Kuching matched exactly between the two sources for the 2020 census figure, which is what gives confidence in the same sources' 2023 estimates used here. Both OpenAPI endpoints are still tried first, in that order, so this self-heals for free if DOSM ever fixes either backend — no code change needed if that happens, the pinned table just stops being reached.
**Why not just parse `population_district.csv` at runtime instead (like `iowrt_3d.csv`)?** Considered and rejected this round: that file is roughly 300,000 rows (5 years × 160 districts × 3 sexes × 18 age bands × 7 ethnicities) versus iowrt's few thousand, and Cloudflare Workers' FREE plan caps CPU time at 10ms per request (waiting on the fetch() response doesn't count against that; the line-by-line parsing would). A full parse risked failing outright (Cloudflare's error 1102) for a number that only needs updating about once a year for four fixed towns — the pinned table gets the same correctness with zero parsing and zero CPU risk. If this tool ever needs population for many more districts, revisit this trade-off rather than growing the pinned table by hand indefinitely.
**Ten-second live checks** (paste into a browser) — both of these were proposed as "unverified" in the previous revision of this file; both have now actually been run:
- `https://api.data.gov.my/data-catalogue?id=population_district&limit=3` → `[]` (verified 2026-09-20, re-verified 2026-09-22 — still broken)
- `https://api.data.gov.my/opendosm?id=population_district&ifilter=Miri@district&limit=3` → **run 2026-09-22 — does NOT return rows with `"district": "Miri"` as previously hoped.** Returns `{"status_code": 400, "details": ["\`district\` used in \`ifilter\` filter is an invalid column value. Valid columns: []"]}`. The same call with no `ifilter` at all (`...?id=population_district&limit=3`) fails the same way, ruling out a filter-spelling issue specifically.

## 10. Decision log / invariants (do not silently break)

1. Anchors (schools, hospitals…) are never competitors and never touch the score.
2. AI narrates only; it is given numbers, never asked to compute or recommend ("never invent a number").
3. Every stat carries provenance: *Official* (DOSM), *Estimated* (OSM/ORS/Google), *Calculated* (score), *Observed* (user's on-site read). **v1.5.1 sharpens this for population specifically:** a pinned fallback value is still labelled "Official — DOSM" (it IS DOSM's own published figure, just not live-queried), but now ALSO carries an explanatory note on the card even though the number itself is non-zero — previously the client only showed a note when a figure was 0/missing, which would have let a pinned value look indistinguishable from a live one. See `demoNote('Population')` in `analyzeSpot()`.
4. "0 competitors" ≠ "couldn't check": `poisAvailable` gates both the card text and the verdict suffix.
5. Failures are never cached; a partial failure returns 200 with a reason string, never a blank screen.
6. Weights auto-normalise (÷Σw); the "should add to 1.00" warning is transparency, not validation.
7. Free/official/open data only; ruled out: CTOS, SSM e-Info, Mudah scraping, Google popular times, Foursquare popularity, Instagram/TikTok/Trends, JPPH/NAPIC listings, Waze/Google traffic (reasons in the setup guide). The v1.5.1 population fallback doesn't violate this — the pinned numbers are still DOSM's own published figures, just fetched once by hand instead of live per-request.
8. The Worker is public: CORS does not stop curl. All client input is validated (§6). Not yet enforced: `Origin` check / Turnstile (KIV).
9. No persistence beyond the daily usage counter; the vacancy notepad and on-site read reset on tab close.
10. A "custom" OSM tag counts as one of the ≤4 types and is sent alongside all standard types.

## 11. Known limitations / unverified as of 2026-09-22

- Population no longer depends on either DOSM OpenAPI endpoint working — both are **CONFIRMED broken** as of 2026-09-22 (see §9), not "unconfirmed" as this file said as recently as v1.5.0. The Worker now pins the four supported districts' 2023 estimates directly (`DISTRICT_POPULATION_FALLBACK_2023`). This needs a MANUAL refresh about once a year (check DOSM's Kawasanku dashboard or the population_district dataset page), and immediately if a 5th town is ever added to `TOWNS` — it does not grow or update itself. If DOSM fixes either OpenAPI endpoint, the live path resumes automatically (no code change needed) since both are still tried first.
- Population/income show no as-of year on the card itself — now more worth doing than before, since population can be a 2023-vintage pinned figure and the person currently has no on-page way to tell that apart from a fresh live number beyond reading the small provenance note.
- Cache API on `*.workers.dev` is not guaranteed by Cloudflare's docs → 4 req/min DOSM budget and Overpass IP limits may bite under repeated analyses; a custom domain would help.
- Gemini region-blocking is per-request; Workers AI backstop needs the `AI` binding (dashboard step) and is untested on the live account. Explicit placement hints are documented only for the Wrangler config file.
- Saturation-per-type scaling and the 10% auto-weight are judgement calls (flagged to the owner).
- Live page ran Worker v1.4.0 at handoff time; see the drift note in §2. (Re-check what the live page reports NOW before trusting even this file — see the Standing rule at the top.)
- Daily cap is per browser (localStorage) — trivially bypassed; the Worker has no per-IP limit.

## 12. Regression suite (kit: `market-radar-test-kit.zip`; re-create if lost)

Method: Node ≥ 20 + Playwright/Chromium. Serve `market-radar.html`/`.js` at `https://reysourcez.com/` via `page.route`; stub Leaflet (`window.L`) and record markers/heat; fulfil the Worker URL by calling the **real** `worker.fetch(...)` in Node with a mocked global `fetch` + in-memory `caches`; mocked upstreams reproduce: Data Catalogue `[]` for `population_district`, OpenDOSM 429/empty, all Overpass mirrors 429, Gemini 400 "User location is not supported…", CSV with an empty newest cell.
- **Worker (17):** happy path incl. URLs built; CSV empty-cell skip; empty-Data-Catalogue regression; 429 → reason + failure not cached; success cached; unknown district note; cache-hit tag; Overpass down ± Geoapify key; legacy `selectedCategory`; injection/clamp/sanitise; garbage bodies → 400/405; insight: Gemini OK / location error ± AI binding / no Gemini key / hostile snapshot.
- **Browser (27):** six catchments in wizard + dropdown; weights come from `SCORE_WEIGHTS_DEFAULT`; 12 checkboxes; cap of 4 (disable/enable/swap); custom row; empty and invalid-custom validation (no request sent); request payload (types, seconds, radius, no `custom` unless ticked); results/breakdown/provenance tag; population + income render; every card has a label + tooltip; markers/heat/anchors; trend card (one and two tracked types); saturation scaling (0.896 = 1−5/48); on-site read moves score (87→78→88→87), notice, restore, hand-edit switch-off; narration ± binding ± healthy Gemini; 5-min drive + custom; single-type behaviour; DOSM failure shows reason; no leaked `\uXXXX`/`\1`; no JS errors.
- **Lesson baked in:** a visual check caught a patch that had pasted regex back-references into markup (`\1…\2`) — functional tests had passed. Keep the "no escape sequences in visible text" and "every card has its label" checks.
- **v1.5.1 gap, not yet closed:** no test covers the new fallback path (both DOSM endpoints failing → `DISTRICT_POPULATION_FALLBACK_2023` value returned, correct provenance note text, real API failure still shown for a district NOT in the table). Should reuse the existing "Overpass down ± Geoapify key" test's shape (mock both DOSM endpoints failing, assert the pinned value and note) — mocks for this already exist (`Data Catalogue [] for population_district`); only the OpenDOSM-side mock needs updating from empty-response to an HTTP-400 body to match what's actually confirmed live now.

## 13. Open items (KIV)

Refresh `DISTRICT_POPULATION_FALLBACK_2023` about once a year (or sooner if DOSM fixes either OpenAPI endpoint — self-healing already coded, this is a "nice to know" not urgent) · add the corresponding row to `market-radar-settings-reference.xlsx` (not done this round — nothing existing in that sheet is wrong, this is purely an addition) · add the `AI` binding · show data year on population/income (more valuable now that population can be a pinned 2023 figure) · custom domain for the Worker (real caching) · `Origin` enforcement / Turnstile · receiving side of `rzBroadcast` in Interactive Costing Analysis / Margin Analysis · central nav reconciliation on the other 10 pages (per `AI_BUILD_BRIEF.md`) · AppSheet field-survey layer · momentum sub-score needs snapshot history · candidate DOSM datasets: `hies_district`, `lfs_district`, `hh_poverty_district`, `crime_district`.
