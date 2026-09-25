# Market Radar — Setup & Reference

## 2026-09-24 — v1.6.0: Market Gap mode, nav retrofit (read this first)

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


## 2026-09-23 — v1.5.2 (still fully current for the edit-answers fix — see the 2026-09-24 section above for the most recent, larger round)

**Reported:** after clicking "Edit answers" to scout a different town or catchment, the analysis screen kept showing the PREVIOUS spot's competitor count, opportunity score, and AI read — right up until "Analyze this spot" was clicked again for the new pin. The map itself looked fine immediately (a blank new map for the new town), which is what made this easy to miss on a glance; only the score banner, result cards, and AI box underneath it were stale.

**Root cause, confirmed by reading the actual shipped v1.5.1 code (not assumed):** `editAnswers()` only ever toggled which section was visible — it never reset `lastAnalysis`, never re-hid the score banner/result cards/panels, and never cleared the on-site busyness read. The map alone self-corrected, because `initMap()` — always called once the wizard finishes again — calls `map.remove()` and builds a brand-new Leaflet instance, which happens to wipe every marker/heat/catchment layer as a side effect. Nothing else on the page had an equivalent reset. Concretely, this could actively mislead: `getInsight()` builds its snapshot from `TOWNS[wizardAnswers.town].label` (the NEW town, already updated by the wizard) alongside `lastAnalysis.competitorCount` etc. (the OLD town's numbers) — so a plain-English read requested right after switching towns, before re-analyzing, would describe the new town's name over the old town's data. A stale on-site busyness read was the same problem in miniature: left picked, it would keep shifting the NEXT spot's score under an "Observed" tag that implies a fresh, current read.

**The fix:** a new `resetAnalysisState()` in `market-radar.js`, called at the top of `editAnswers()`. Nulls `lastAnalysis`; clears the on-site read and undoes whatever auto-weight shift it had applied (the same restore `onObservedChange()` already does when a read is cleared by hand — manually-edited weights are left alone, since those are a standing preference across spots, not tied to one location); re-hides the score banner, result cards, on-site-read panel, vacancy panel, and weights panel; resets the AI box to its pre-analysis placeholder; clears the status line. The vacancy notepad's own entries are deliberately left untouched — that's documented as a running, session-long notepad, not a per-spot result.

**Not changed this round:** `market-radar-proxy-worker.js` — nothing about this bug touched the Worker, so there's nothing to redeploy on Cloudflare this time. `market-radar.html`'s markup is unchanged too, aside from the cache-buster.

### Deploy (about 2 minutes)

1. **GitHub** — upload the new `market-radar.js` (cache-buster now `?v=20260923a`) and `market-radar.html`, replacing the two existing files. Commit. Give GitHub Pages a minute.
2. **Cloudflare — nothing to do this round.** The Worker stays on v1.5.1.
3. **Refresh the page hard** (Ctrl+F5 / Cmd+Shift+R). The browser console should log `client v1.5.2`.
4. **Test the actual fix:** analyze a spot in Miri, click "Edit answers," pick Kuching, and look at the analysis screen BEFORE clicking "Analyze this spot" again — the score banner, result cards, and AI box should all be gone (not just blank), same as the very first time the page ever loaded.

### Two things raised alongside this fix, not yet resolved

**"Competitor strength does nothing"** — true, but specifically when the weight is raised by hand with neither an on-site read nor a configured `GOOGLE_PLACES_API_KEY` present: with no signal, `computeCompetitorStrengthFactor()` returns a flat, neutral `0.5` by design (no invented signal is better than a fake one). The on-site-read path — the one already confirmed working — is this exact same mechanism; removing "competitor strength" outright would remove that too. Recommendation: leave it as-is (free, dormant, zero cost when unused, and the on-site read already earns its keep); optionally strip only the Google-Places half if it's judged not worth keeping since it needs a paid key nobody's configured. Owner to decide — see `MARKET_RADAR_HANDOFF.md` §13.

**Proposed second analysis mode — "gap finder."** Idea floated: instead of scoring one chosen business type, sweep several walk/drive time-bands (5/10/30/60 min proposed) around a pin, inventory every business type Overpass/Geoapify find in each band, and surface which types are thin or absent as candidate gaps. Reuses most of the existing plumbing (one Worker call, provenance tagging, the isochrone/radius-fallback pattern) but raises real open questions before it's buildable — see the chat reply from this round for the fuller breakdown; short version: (1) ORS's isochrone quota (500/day, shared across every visitor) gets eaten fast if every band gets its own real isochrone per click — cheapest fix is one real isochrone for the widest band actually requested, with inner bands approximated by radius, each tagged accordingly, never presented as equally precise; (2) a 60-minute DRIVE band could span tens of kilometres, past both `MAX_RADIUS_M` (12,000 m) and Overpass's practical single-query size for a dense town centre — worth confirming live whether that's the intended scope before building against it; (3) today's 11-category `CATEGORY_TAGS` is F&B/retail-specific by design — a genuine "what's missing here" scan wants a broader OSM `shop=*`/`amenity=*`/`office=*` sweep; (4) "gap" needs a precise, honest definition consistent with this tool's "never invent a number" rule — simplest defensible version: count each type found, show "≈X people per shop of this type" using `districtPopulation` (already fetched), and flag zero-count categories plainly as "none found" rather than inventing a benchmark ratio with no source behind it. Not started — see `MARKET_RADAR_HANDOFF.md` §13 for the pointer.

## 2026-09-22 — v1.5.1 (still fully current — see the 2026-09-23 section above for the most recent, unrelated fix)

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

**Not changed this round:** the page's own markup (`market-radar.html`, aside from its cache-buster) — this fix is entirely inside the Worker plus one line of client rendering logic, so nothing about the wizard, the map, or the layout needed touching.

### Deploy (about 5 minutes)

1. **GitHub** — upload the new `market-radar.js` (cache-buster now `?v=20260922a`) and `market-radar.html` into the same folder as your other pages, replacing the two existing files. Commit. Give GitHub Pages a minute or two.
2. **Cloudflare** — Workers & Pages → `market-radar-proxy` → **Edit code** → select everything → paste the whole of the new `market-radar-proxy-worker.js` → **Deploy**.
3. **Refresh the page hard** (Ctrl+F5, or Cmd+Shift+R on Mac). *Competitors in catchment* should now say `Worker v1.5.1` underneath.
4. **Analyze one spot per town** (Miri, Kuching, Sibu, Bintulu) and check *District population* shows a real number with a small note underneath it (rather than "Not available"). No Cloudflare CPU-limit concern to watch for this round, since nothing new runs at request time beyond a plain lookup — that risk was specifically what the pinned-table approach avoided.

### What was and wasn't verified (2026-09-22)

- **Verified live, this round:** `opendosm?id=population_district` returns HTTP 400 on every request, filtered and unfiltered; `data-catalogue?id=population_district&limit=3` still answers `[]`; `population_district.csv` downloads correctly and its header matches the documented columns; Cloudflare Workers' free-plan CPU-time limit is 10ms/request (developers.cloudflare.com/workers/platform/limits); DOSM's Kawasanku dashboard and citypopulation.de agree exactly on Miri's and Kuching's 2020 census populations.
- **Not independently re-verified:** the exact 2023 estimates for Sibu and Bintulu weren't cross-checked against a second source the way Miri and Kuching were (citypopulation.de was the only source found for those two specifically) — still DOSM-sourced, just single-sourced rather than double-checked.
- **Not measured:** how large `population_district.csv` actually is in megabytes, or precisely how much CPU time parsing it would have consumed on a real Cloudflare invocation — the decision to avoid that path was made from the row-count math and Cloudflare's documented limit, not a live measurement, since the safer and simpler pinned-table approach made an actual measurement unnecessary.


## 2026-09-20 — v1.5.0 (superseded — kept for history; see the 2026-09-22 section above for what's actually true today)

**Filenames stay the same.** The site's nav links point at `market-radar.html`, so renaming files would break them. The version is instead in the first line of every file, on the page itself ("Worker v1.5.0" under *Competitors in catchment*), and in the `?v=20260920a` on the script tag.

**Heads-up on drift.** The live page was reporting *Worker v1.4.0*, but the copies in this project had no version tag at all — a round of changes had been deployed without the project files being refreshed. v1.5.0 was rebuilt from the project copies and re-creates the one visible v1.4.0 feature (the "OSM via … · Worker v…" source tag). If v1.4.0 contained anything else that isn't in these files, compare before deploying. Cloudflare keeps the previous Worker version, so a rollback is one click (Worker → Deployments/Versions).

### What changed

| You asked / reported | What was done |
|---|---|
| 5-minute walk and 5-minute drive | Added `walk5` / `drive5` (300 s; fallback circles 400 m / 2,500 m). The wizard's step 2 and the page dropdown read the same list, so both show all six. |
| "What are you thinking of opening?" as checkboxes, max 4 | 12 checkboxes (11 business types + Custom). At 4 ticked, the unticked ones grey out until you untick one. The competitor count is the sum across ticked types, with a per-type line under it; each map marker's tooltip names its type; the DOSM trend card gets one line per ticked type it tracks. **Assumption to confirm:** the "crowded" threshold is 12 *per type ticked* (4 types → 48), so ticking four food types isn't scored as four times as crowded. It is one line to change (`computeOpportunityScore`). |
| "DOSM population still not available" | **Root cause, found and reproduced:** `population_district` is served by the **OpenDOSM API** (`api.data.gov.my/opendosm`), not the Data Catalogue API the Worker was calling. The Data Catalogue endpoint answers `[]` for it — even for the dataset page's own unfiltered sample query (checked live 2026-09-20). So no filter wording could ever have worked. Fixed: population asks OpenDOSM, income stays on Data Catalogue, each falls back to the other. Also fixed: a *failed* lookup used to be cached for 7 days (so a later fix would still have shown "Not available"), and a rate-limit or empty answer now prints its reason on the card. **[CORRECTED 2026-09-22 — this "root cause" was itself wrong; see the section above. The OpenDOSM switch does not work either.]** |
| "Gemini error" (`User location is not supported for the API use`) | Not your location and not the key. Google refuses the call when Cloudflare happens to run the Worker in a region Gemini doesn't serve (Hong Kong is the one reported on Cloudflare's community forum), and that region changes between requests — which is why it worked before. Fix: if Gemini fails, the Worker falls back to Cloudflare's own Workers AI (free). **Needs one dashboard step — the `AI` binding, below.** |
| "Changing the on-site read doesn't change the rating" | By design it only counted once *Competitor strength* had been raised above 0 in the weights panel — which nobody would guess. Now the first read you pick sets that weight to 0.10 (taken from *Low competition*, so the total stays 1.00), says so on screen, and undoes it if you clear the read. Weights you edit by hand are never touched. The Competitor strength card now shows your read ("Packed") instead of "No Google match". |
| Geoapify key typo (`geo_api_key`) | Fixed by you in Cloudflare. The settings sheet had listed the *wrong* secret name on that row (`GOOGLE_PLACES_API_KEY`) — corrected there too. |
| Google Places is paid | Correct: the rating fields need a billing-enabled Google Cloud project (1,000 free calls/month, then $35 per 1,000). It stays off; the on-site read is the free replacement. |
| Not asked for, done anyway | The Worker now validates everything it is sent (radius, OSM tags, district, catchment profile) because the endpoint is public and CORS only stops other *websites*, not curl. One CSV download now serves every ticked type. |

### Deploy (in this order, about 10 minutes)

1. **GitHub** — upload `market-radar.html` and `market-radar.js` into the same folder as your other pages, replacing the two existing files. Commit. Give GitHub Pages a minute or two.
2. **Cloudflare, code** — Workers & Pages → `market-radar-proxy` → **Edit code** → select everything → paste the whole of `market-radar-proxy-worker.js` → **Deploy**.
3. **Cloudflare, secrets** — Settings → Variables and Secrets. Check the three names are spelled exactly `GEMINI_API_KEY`, `ORS_API_KEY`, `GEOAPIFY_API_KEY` (capitals and underscores matter — a misspelled name is silently ignored, which is what `geo_api_key` did).
4. **Cloudflare, the Gemini backstop** — Worker → Settings → **Bindings** → **Add** → **Workers AI** → variable name exactly `AI` → save/deploy. (Cloudflare's docs say bindings can be created on the dashboard; the menu wording may differ slightly from this.) Free allowance: 10,000 "neurons" a day; one read costs about 10.
5. **Refresh the page hard** (Ctrl+F5, or Cmd+Shift+R on Mac). *Competitors in catchment* should now say `Worker v1.5.0` underneath.

### Check it worked

1. **Population, in a browser tab (10 seconds):** open `https://api.data.gov.my/opendosm?id=population_district&ifilter=Miri@district&limit=3`. Expect JSON rows containing `"district": "Miri"`. If you get `[]`, try `…&icontains=miri@district&limit=3` and tell me what comes back — then the district *spelling* is the issue, not the code. **[This check has now been run — see the 2026-09-22 section above for the actual result, which was neither of the outcomes this checklist anticipated.]**
2. **Analyze a spot** with Restaurant + Cafe + Bakery + Drink ticked. *District population* should show a real number. If it says "Not available", the reason is printed on the card — send me that line.
3. **On-site read:** pick *Packed*, then *Very quiet*. The score must move, the weights panel shows 0.25 / 0.10, and the notice explains why.
4. **Plain-English read:** click it. If Gemini is blocked you'll see the text with "(Written by Workers AI — Gemini was unavailable.)".

### What was and wasn't verified (2026-09-20)

- **Verified live:** the Data Catalogue endpoint returns `[]` for `population_district`; the dataset's variables (`both`/`overall`/`overall`, thousands); `ifilter` is documented single-column only and multi-column only for `filter`; `icontains` is the partial-match parameter; the rate limit is 4 requests/minute per API; Workers AI's free allowance and current model list (Cloudflare pricing page, updated 2026-09-17); Cloudflare Smart Placement needs traffic from several locations and explicit placement hints are documented only for the Wrangler config file (neither suits a dashboard-pasted Worker — hence the backstop instead).
- **Not verified:** that the OpenDOSM endpoint actually returns Miri rows — my tools would not fetch that URL, so the browser check above is the proof. Also not verified: the exact dashboard menu wording for the binding, and how good Workers AI's prose is compared with Gemini's. **[Now verified, 2026-09-22: it does NOT return Miri rows — it 400s. See above.]**
- **Tested:** 17 Worker tests and 26 browser checks (real page in headless Chromium + the real Worker code) against a mocked network that reproduces the failures above (empty Data Catalogue answer, 429s, Gemini's location error, Overpass down). The test kit ships separately as `market-radar-test-kit.zip` — for a future AI session, not for the website.


## Current status (as of 2026-09-24, revised again)

**A note on how this doc and the shipped code drifted apart, for whichever session reads this next:** the previous version of this table said Geoapify, the 10s timeout, and the DOSM fixes were already done. Re-reading `market-radar-proxy-worker.js`'s own code on 2026-09-16 (not just re-trusting this doc) turned up that none of those three had actually made it into the file — they were designed and written up here, but the code itself still only had the 2026-09-13 Overpass-mirrors fix. That gap was closed in that revision. **A second instance of the same lesson happened on 2026-09-22:** the 2026-09-20 revision's population "root cause" (switch to OpenDOSM) was written from reasoning about the dataset's structure, not from actually calling the endpoint — and when it was actually called, it didn't work. Treat every claim in this table as something to verify against a live test before repeating it, including the ones below that currently say ✅.

| Area | Status |
|---|---|
| Wizard, map, click-to-place pin | ✅ Working |
| Mode-select (Market Analysis vs. Market Gap) | ✅ Built 2026-09-24 — shared wizard/map/catchment machinery, mutually exclusive results panels, see the section above |
| Market Gap checklist (13 categories + custom additions, gap/thin/oversupplied read) | ✅ Built 2026-09-24 — client-side computation only, no new external API; anchors/trend/population cards not yet ported to this mode's display (KIV) |
| Site nav dropdown (site-config.js / nav-config.js) | ✅ Retrofitted 2026-09-24 — was still on the old hand-copied list; see `NAV_RETROFIT_HOWTO.md` |
| "Edit answers" clears the previous spot's results | ✅ Fixed 2026-09-23, extended 2026-09-24 to cover switching modes too (`resetAnalysisState()` / `backToModeSelect()`) |
| Overpass competitor search | ✅ 3-mirror fallback (since 2026-09-13) plus a Geoapify backstop. The Geoapify secret must be named exactly `GEOAPIFY_API_KEY` — it had been saved as `geo_api_key` and silently ignored (fixed 2026-09-20). v1.5.0 also shows which source answered, e.g. "OSM via Overpass (overpass-api.de)" |
| Bubble tea / other cuisine-tagged categories | ✅ Fixed 2026-09-20 — `categorize()` now checks `cuisine=*` tags before generic `amenity=*`/`shop=*` tags, plus a `NAME_HINTS` brand/keyword fallback in `market-radar.js` — see that file's own 2026-09-16 comments |
| Isochrone catchment (real travel-time shape) | ✅ Working, confirmed live; falls back to a plain circle if OpenRouteService fails |
| District population & household income (DOSM) | Income ✅ working. Population: **v1.5.0's endpoint fix confirmed BROKEN, 2026-09-22** — both OpenAPI endpoints fail live (see the v1.5.1 section further down). v1.5.1 pins the four supported districts' 2023 estimates directly in the Worker instead (`DISTRICT_POPULATION_FALLBACK_2023`), needing a yearly manual refresh rather than a live query |
| Opportunity score, editable weights, diversity index | ✅ Working — 6 weights, see below |
| Competitor strength (Google ratings + on-site read) | ✅ Google ratings: optional, off, paid past 1,000 calls/month. On-site read: counts automatically at 10% (since v1.5.0) — see the settings sheet. **Reviewed 2026-09-23, decision: keep as-is** |
| Gemini plain-English read | ⚠️ Intermittent: Gemini refuses when Cloudflare runs the Worker in a region Google blocks. Workers AI backstop added v1.5.0 — **needs the `AI` binding (deploy step 4)**. Now branches on `snapshot.kind` (2026-09-24) to narrate either mode |
| 5-minute walk / 5-minute drive | ✅ Built 2026-09-20 |
| Business-type checkboxes (max 4) | ✅ Built 2026-09-20 — counts are combined; the saturation threshold scales per type (assumption, see above). 13 types now, not 11 (pharmacy/petrol added 2026-09-24) |
| Worker input guards, version tag | ✅ Built 2026-09-20 |
| "Still working" progress messaging on slow analyses | ✅ Working |
| Nav entries on the other pages | ⏸ Not done — per this project's own `AI_BUILD_BRIEF.md`, that's a central reconciliation pass, not a single-tool job. This page's OWN nav is now retrofitted (row above) — the central pass is about every OTHER page still on the old pattern |
| `cost-structure-checker` in the nav standard | ⏸ The page itself now exists (`cost-structure-checker.html`) — still correctly held out of live nav per the same central-pass rule above, just no longer accurate to describe as "not built yet" the way `NAV_ORDER_STANDARD.md` currently does |
| `qr-code-creator` / "QR Listing Creator" in the nav standard | ⏸ Genuinely doesn't exist as a page yet — still accurate as "not built" |
| AppSheet field-survey layer | ⏸ Not started — schema specified below, waiting on the actual Sheet existing. See "Popularity / foot-traffic signals" below for how this could extend to cover that too |
| Sync handoff into Interactive Costing Analysis / Margin Analysis | ⏸ Not started — `market-radar.js` already broadcasts for Market Analysis mode, the receiving side doesn't listen yet; Market Gap mode doesn't broadcast at all (no shape designed for a checklist result) |
| Household-vs-business/institution personas for Market Gap | ⏸ Researched, not built — household checklist is research-backed, business/institution research came back thin; see the 2026-09-24 section above before building this |

**Immediate next step:** deploy v1.6.0 (steps in the section at the top of this doc) and confirm both mode buttons work end to end, especially the reset when switching between them.

## 2026-09-17 update

Two things happened this round, worth recording precisely rather than just "more fixes":

**1. Competitor strength shipped.** `market-radar.html`/`.js` gained a 6th, off-by-default weight, a new "On-site read" field for a manual busyness note, and a new result card. `market-radar-proxy-worker.js` gained `fetchGooglePopularity()` — one Google Places Nearby Search (New) call per analysis, only when `GOOGLE_PLACES_API_KEY` is set, matching results to already-classified competitors by proximity. Fully tested: weight-at-0 is provably a no-op (same score with or without rating data present), and directionality is correct (a strong, well-reviewed competitor lowers the factor; a quiet/thin one raises it; a manual on-site read always wins when present).

**2. A user-supplied "previous version" of the Worker turned out to be broken, and it's worth recording exactly how, since it looked plausible on a skim and the mistake is an easy one to repeat.** That file's `GEOAPIFY_ENDPOINT` pointed at Geoapify's *geocoding* endpoint (`/v1/geocode/search`) with a hardcoded London address and a demo API key — both copy-pasted straight from Geoapify's own documentation example — then appended a second `?` onto that already-complete URL to try to add the real category/filter/key parameters. A URL can only have one `?`; everything after the first is already query-string content, so that second `?` and everything after it (including the real API key) just became part of the literal value of the fake demo key. That request could only ever fail — which lines up exactly with the report that motivated this check ("Overpass always seems to fail, and there's no working fallback"). The version in this repo has used the correct endpoint (`api.geoapify.com/v2/places`, actual lat/lng/radius interpolated in) since it was first written, confirmed against Geoapify's own current docs.

While comparing the two files, two genuinely good details from that other draft got adopted here: an actual `User-Agent` header on Overpass calls (this file was sending none — a real omission, and plausibly a second, separate contributor to Overpass failing more than it should), and `sort=-date&limit=1` on the two data.gov.my queries instead of downloading several rows to sort client-side (confirmed as a real, documented parameter after a closer read of developer.data.gov.my/request-query).

**If Overpass still seems to fail constantly after deploying this version:** `market-radar.js` already shows the Worker's exact `poisError` message on-page after a failed analysis — it names precisely which HTTP status or error each of the three mirrors returned, and says plainly whether `GEOAPIFY_API_KEY` is even configured. That message is the fastest way to tell "Overpass is genuinely down" apart from "Geoapify isn't configured" apart from "something else entirely" — worth reading closely and pasting back verbatim if the problem continues, rather than guessing again.

**3. `market-radar-settings-reference.xlsx` now exists**, matching the same format as `rental-calculator-settings-reference.xlsx` and `cost-structure-checker-settings-reference.xlsx` — current default in column B, a blank yellow-highlighted column for your own value, exact code location, and notes. Covers every API key (never the actual key values — those stay in Cloudflare's Secrets store only), all 11 category-to-OSM-tag mappings, the bubble-tea name-hint keyword list, all 6 score weights and both normalizers, and the 4 town presets. **Not yet updated for v1.5.1's `DISTRICT_POPULATION_FALLBACK_2023` — see the Open Items list below.**

## 2026-09-17, later the same day: three more ideas checked

**Heat map — already existed.** `leaflet.heat` has been loaded and wired up since before this session (`heatLayer = L.heatLayer(competitors.map(...))`, radius 30, blur 20) — it just had no visibility toggle, so it was easy to not notice sitting under the red competitor pins. Added a "Density heat map" checkbox next to the map legend so it's visible and controllable rather than always-on-and-easy-to-miss.

**Live vacant-shop / commercial-property listings — no viable source, built a notepad instead.** Checked JPPH/NAPIC (Malaysia's official property valuation authority): they publish only *past sale transactions*, via paid subscription or ad-hoc request (RM1 per floor specifically for rental data), not current vacancies, and not as a live API. Checked PropertyGuru/CommercialGuru and the other portals: no official public API anywhere — every available integration is a third-party scraper, the same ToS-risk category this project already ruled out Mudah scraping for. Built a plain, non-persistent notepad instead (floor level + free-text asking price/notes) — same "resets on tab close, nothing verified automatically" pattern as the on-site busyness field.

**"Which business types are gaining/losing traction, from DOSM" — real data exists, not practically usable here.** `iowrt_3d` (Wholesale & Retail Trade by 3-digit MSIC group) publishes exactly this as a pre-computed `growth_yoy` series — but its own page explicitly says "not available through OpenAPI... unsuitable for API access," bulk CSV/Parquet only. Even solving that, it's Malaysia-wide with no state or district breakdown, and covers MSIC Section G (wholesale/retail) only — not Section I (accommodation & food service), so it wouldn't say anything about cafes, restaurants, or bubble tea regardless. Not worth building against for this tool. While checking this, confirmed a useful pattern for evaluating any future DOSM dataset: check the exact dataset's own "Sample OpenAPI query" section specifically — simple one-row-per-district tables (`population_district`, `hh_income_district`, `lfs_district`) tend to be live-queryable; large transactional tables and computed time-series indices tend to be bulk-only. **[Caveat added 2026-09-22: "tend to be live-queryable" turned out not to hold for `population_district` specifically, despite it being exactly this kind of simple one-row-per-district table — the pattern is a reasonable starting guess, not a guarantee, so still test the actual dataset before relying on it.]**

## 2026-09-18: MSIC alignment, DOSM trend (reconsidered), anchors, heat map fix

**QR Listing Creator dropped from this project's KIV list** — being handled elsewhere.

**MSIC 2008 codes added to every category**, purely as reference metadata shown in the UI (tooltips) — plays no part in the actual Overpass query or classification logic. Sourced from Malaysia-specific documents (LHDN's own MSIC2008 business-code PDF, data.gov.my's `msic` lookup table), cross-checked against at least two independent Malaysia-specific sources per code, not just the generic international ISIC numbering, which occasionally diverges at this level of detail. Full table now in `market-radar-settings-reference.xlsx`.

**The DOSM business-trend idea — reconsidered, and actually built.** Previous conclusion ("bulk-only, not practical here") was too quick: `iowrt_3d` not being on the *filterable query* API doesn't mean it's inaccessible — the actual CSV DOSM publishes for download is CC BY 4.0 licensed for exactly this kind of reuse, and at this dataset's real size (a monthly index across ~30 groups, not millions of transactional rows like `pricecatcher`), fetching and parsing it directly is genuinely practical. `fetchWholesaleRetailTrend()` in the Worker now does exactly that — fetches the real CSV, parses it defensively (header-driven column lookup, not a hardcoded position, since the value column's exact name isn't confirmed the way date/series_type/group are), caches for 30 days (matches the update cadence), and returns the actual figure with its real `asOf` date pulled from the data itself — never a hardcoded/guessed date. Caught and fixed a real bug during testing: the first version picked the wrong column when more than one extra numeric column was present; fixed to validate against actually-parseable values per row rather than trusting column position. Still only covers minimart/bakery/hardware/fashion (Section G) and is still Malaysia-wide, not Miri-specific — both limits shown plainly in the card's own tooltip, not hidden. **[2026-09-22 note: this same "fetch the real CSV directly" pattern was considered for `population_district.csv` too, but rejected on CPU-budget grounds specific to that file's much larger size — see the v1.5.1 section at the top. The pattern that works well for iowrt (a few thousand rows) doesn't automatically transfer to a ~300k-row file.]**

**Vacant shops / Mudah — re-asked, same answer, with the specific evidence this time.** Checked directly: Mudah has no official API; every available integration is a paid third-party scraper (Apify, $2–10/1,000 results) against Mudah's own public pages — the identical ToS-risk category already established for ruling this out, just now with the actual current evidence in hand rather than a general policy.

**Car traffic / "car heatmap" — checked, not viable.** Google's `TrafficLayer` is a live visual overlay (current-moment congestion coloring), not a peak-hours data point, needs its own separate paid Google Maps JavaScript instance (a second map engine alongside this page's Leaflet/OSM map), and has no historical/predictive API behind it. Waze's data-sharing program (Waze for Cities) is explicitly restricted to government transportation/public-safety authorities and major event operators — not available to a business tool like this one. No viable path found.

**"Big business" / anchor institutions — built.** New `ANCHOR_TAGS` (schools, universities, hospitals/clinics, malls, government offices, places of worship, transport terminals) folded into the same combined Overpass query as competitors (one call still covers everything), shown as distinct blue markers on the map plus a "Nearby institutions" count card. Deliberately informational only — never counted as competitors, never touches the opportunity score. Large private employers left out on purpose: OSM has no reliable tag for "this specific company has 200 staff," so a generic office/industrial-land tag would be more noise than signal; the vacancy-notepad pattern is the honest way to capture that if it matters for a specific spot.

**Heat map recalibrated.** Reported as "just a blue gradient, hard to interpret" — and that was a real calibration bug, not a misunderstanding: Leaflet.heat's default `max` (1.0) combined with this tool's low per-point weight (0.6) meant even a single, fully isolated competitor could never cross about the "cyan" mark on the default blue-to-red gradient. At this tool's actual scale (single digits to a few dozen competitors per search, not the thousands a heat map is usually tuned for), that default was never going to show red. Recalibrated: `max: 3` (3 overlapping same-category competitors now reads as fully saturated), weight raised to 1, and an explicit 3-stop gradient (teal → amber → red) matching the site's own accent colors. A caption next to the toggle now spells out what the colors mean. One isolated competitor should now show as a clear, visible color — but a spot with only 1-2 well-spaced competitors will still correctly look mild, since that's an accurate reflection of low clustering, not a sign it's still broken.

---

Three files, one job each, same split as every other tool on this site:

| File | Runs where | What it does |
|---|---|---|
| `market-radar.html` | Visitor's browser | The page itself — wizard, map, results |
| `market-radar.js` | Visitor's browser | All page logic: geometry, opportunity score, rendering |
| `market-radar-proxy-worker.js` | Cloudflare (your account) | The only thing allowed to hold the OpenRouteService, Gemini, and Geoapify keys |

Drop the first two into the same folder as every other page on the site. The Worker deploys separately, to Cloudflare — see below.

## What works with zero setup

Business density (OpenStreetMap/Overpass) and district demographics (data.gov.my, plus the pinned population fallback as of v1.5.1) need no API key at all — once the Worker is deployed with just `ALLOWED_ORIGINS` updated, those two layers work immediately. Three things are optional and degrade gracefully without a key:

- **No `ORS_API_KEY`** → every catchment falls back to a plain dashed-circle radius instead of a real walk/drive-time shape. Everything else keeps working.
- **No `GEMINI_API_KEY`** → the "Get a plain-English read" button uses the Workers AI backstop if the `AI` binding exists, otherwise shows an error message. Every number on the page is unaffected either way, since the narrator only describes, never calculates.
- **No `AI` binding** → if Gemini is ever blocked (see the 2026-09-20 notes), the read fails with a plain-English explanation instead of falling back. Everything else keeps working.
- **No `GEOAPIFY_API_KEY`** → if every free Overpass mirror happens to be down at once (see "A note on Overpass" below — this turned out to be more common than expected), competitor data shows as honestly unavailable instead of quietly recovering through a second source. Everything else on the page is unaffected.

## Deploying the Worker

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com) if you don't have one — you likely already do, from your other Workers.
2. **Workers & Pages → Create → Create Worker**. Name it (e.g. `market-radar-proxy`), deploy the default template, then **Edit code** and replace everything with `market-radar-proxy-worker.js`'s contents. Deploy.
3. **Settings → Variables and Secrets → Add**, as **Secret**:
   - `GEMINI_API_KEY` — the same key your other tools already use
   - `ORS_API_KEY` — see below
   - `GEOAPIFY_API_KEY` — see below
   - ⚠ Spell the names exactly, capitals and underscores included. A misspelled name is silently ignored (this project hit it with `geo_api_key`).
4. Copy the Worker's `*.workers.dev` URL and paste it into `WORKER_ENDPOINT` near the top of `market-radar.js`.
5. **Recommended — the Gemini backstop:** Worker → Settings → **Bindings** → Add → **Workers AI** → variable name `AI`. Free; see the 2026-09-20 section above.

### Getting a free OpenRouteService key

openrouteservice moved its whole account system to HeiGIT (the org behind it) partway through this build — sign up at **[account.heigit.org](https://account.heigit.org)**, not the old openrouteservice.org dashboard, though that old link should still redirect through to the same place.

1. Sign up — free, no card.
2. Your key appears on the dashboard as **"Basic Key"** — that's what goes in `ORS_API_KEY`. Total quota is 500 isochrones (renewing periodically) at 20/minute — since this is only called once per "Analyze" click, that's generous for personal use, and the Worker caches every isochrone for 30 days on top of that.
3. The underlying API also moved domains, from `api.openrouteservice.org` to `api.heigit.org` — already updated in `market-radar-proxy-worker.js`. The old domain still works today but has had its quota deliberately throttled since 28 April 2026 to push people off it, so there was no reason to keep using it.

### Getting a free Geoapify key (only needed as an Overpass backstop)

Sign up at [myprojects.geoapify.com](https://myprojects.geoapify.com) — free, no card, 3,000 credits/day (roughly 1,000+ place searches, at ~1-2 credits each). This is never the primary source; it only gets called when every entry in `OVERPASS_MIRRORS` has already failed. See below for why that turned out to matter more than expected.

### A note on Overpass, since it broke twice during real testing

**Round one:** the very first live "Analyze" click hit a `406` from `overpass-api.de` — a real, independently-reported reliability problem with that specific public server (GitHub issue #791, an OSM community forum thread, same error, same rough timeframe). Fixed by trying three mirrors in order instead of trusting one (`overpass-api.de`, `overpass.kumi.systems`, `overpass.private.coffee`), and sending the `Accept: application/json` header several of those same reports pointed at.

**Round two, a full day later, same problem:** every mirror started returning `429` (rate limited) — consistently, from the first request of a fresh day, which rules out ordinary temporary overload. The actual cause: Cloudflare Workers share outbound IP ranges across every Workers customer worldwide, and free services that can only rate-limit by IP (Overpass has no concept of an API key) have no way to tell this Worker's traffic apart from any other Workers-hosted script that has ever hit the same server. This is a documented, known category of problem for calling IP-rate-limited free APIs from inside a Workers function — not something fixable by retrying harder from the same architecture.

**The actual fix:** `market-radar-proxy-worker.js` now tries Geoapify's Places API as a genuine second-tier fallback once every Overpass mirror has failed. Geoapify is also OSM-based underneath, but rate-limits by API key rather than by IP, which is the one property that actually sidesteps this specific failure mode. Needs `GEOAPIFY_API_KEY` (above) — without it, a full Overpass outage still degrades honestly to "competitor data unavailable" rather than crashing, it just doesn't get a second chance to recover first. One open item: Geoapify's category taxonomy doesn't match OpenStreetMap's tags one-for-one, so `GEOAPIFY_CATEGORY_MAP` in the Worker is a best-effort translation, not confirmed against a live response the way the data.gov.my fixes below were — worth a check against [apidocs.geoapify.com/docs/places/#categories](https://apidocs.geoapify.com/docs/places/#categories) if one specific category seems to return too little once it's coming from this path.

### The population figure — five rounds wrong before it stopped depending on the live API at all

> **CORRECTION, 2026-09-22 — read this before trusting anything below this line about population.** Everything in this subsection describes a series of fixes that were each believed correct at the time and each turned out to be wrong in some way. As of v1.5.1, population no longer depends on getting this API right at all — see the section at the very top of this document. The history below is kept because the specific mistakes are worth not repeating on some OTHER dataset in the future.

> **CORRECTION, 2026-09-20 (superseded further by the 2026-09-22 note above)** — Item 3 below, and the "confirmed working query shape" claims that used to sit in the Worker's comments, were **wrong**. The real cause was believed to be the *endpoint*: `population_district` is an OpenDOSM-portal dataset served by `api.data.gov.my/opendosm`. The Data Catalogue endpoint the Worker was calling returns `[]` for it — even for the dataset page's own unfiltered sample query (`?id=population_district&limit=3`, checked live). With no rows possible, no filter wording could ever have worked, which is why three rounds of filter fixes changed nothing. Also: the query docs show the comma-separated multi-column form **only for `filter`**, not for `ifilter`. Items 1 and 2 (the both/overall/overall total row; the figure is in thousands) are still correct — those facts about the DATA held up even though the endpoint theory didn't.

Bugs found and "fixed," in order:

1. **Wrong row entirely.** `population_district` publishes dozens of rows per district — one for every combination of sex, age band, and ethnicity, not one tidy row per district. Fixed by filtering to `sex=both`, `age=overall`, `ethnicity=overall` as well as district. (This fact about the data's shape is still correct.)
2. **Wrong unit.** The dataset publishes population in **thousands**, not headcount — confirmed directly against DOSM's own variable definitions. A district of 300,000 people was being read and shown as "300." (Still correct.)
3. **Believed fix: combining two query parameters that were never confirmed to combine.** The first fix for #1 above used `ifilter=<district>@district` and `filter=both@sex,overall@age,overall@ethnicity` as two SEPARATE query parameters, then later just `ifilter` with everything combined. Neither actually mattered, per #4.
4. **Believed fix (v1.5.0): wrong endpoint.** `population_district` was believed to live on OpenDOSM (`api.data.gov.my/opendosm`) instead of Data Catalogue, based on reasoning about DOSM's own portal structure — plausible, never actually tested against the live endpoint before being written up as fixed.
5. **What's actually true (v1.5.1, confirmed by calling both endpoints directly):** NEITHER `api.data.gov.my/opendosm` NOR `api.data.gov.my/data-catalogue` currently serves `population_district` at all. OpenDOSM 400s outright (doesn't recognise the dataset id); Data Catalogue silently answers `[]`. This isn't a filter, unit, parameter-combination, or endpoint-choice problem — it's DOSM's backend not having this dataset wired into either query engine right now, for reasons outside this project's control. **The fix that actually works** is not querying it live at all: `DISTRICT_POPULATION_FALLBACK_2023` in the Worker pins the four needed districts' figures directly, sourced by hand this round.

Household income needed none of this — `income_median` was correct from the first guess, confirmed against DOSM's own documentation for `hh_income_district`, which has no further breakdown dimensions to trip over, and (unlike population) its Data Catalogue endpoint actually answers real rows when queried.

**The lesson, stated plainly for whichever session reads this next:** four different, each-individually-plausible theories about this ONE dataset (wrong row, wrong unit, wrong parameter combination, wrong endpoint) were each written up as "the root cause, fixed" before being tested against the actual live endpoint. Only the fifth check — actually calling the URL and reading the literal response — settled it. Reasoning about what an API *should* do, from its documentation or its portal structure, is not the same as calling it.

### "It's taking forever and never finishes" — the actual fix

Nothing in the original version of this Worker put a ceiling on how long any single external call was allowed to run. A mirror that hangs rather than erroring cleanly (which is exactly what a `524` — Cloudflare's own "origin timed out" code — means: the *origin server itself* is too slow, not a network problem on this end) would just sit there until Cloudflare's own platform-level Workers execution limit eventually killed the whole request. From the browser's side, that's indistinguishable from "broken" — there was no timeout, no retry-with-visible-progress, nothing.

Fixed with `fetchWithTimeout()` — every external call in the Worker (each Overpass mirror, Geoapify, the ORS isochrone call, even the Gemini insight call) now gets 10 seconds before this Worker gives up on it and moves to the next thing in the chain. Worst case — every Overpass mirror AND Geoapify all timing out — is bounded at roughly 40 seconds, not indefinite. On the page itself, the status line now cycles through a few honest "still working" messages every 7 seconds instead of sitting on one static line the whole time, so a slow-but-working analysis doesn't read as a stuck one.

**On "is it business hours in Malaysia" for Overpass being slow at 6pm:** plausible, though not something either of us can confirm without watching it over many days — these are community-run, globally-shared servers, so their load follows worldwide usage patterns rather than any one country's clock. 6pm in Malaysia is late morning in Europe, where a meaningful share of OSM's own contributor and tooling traffic originates, so a correlation wouldn't be surprising — but it's a plausible pattern, not a confirmed one.

**If this keeps happening even with the timeout fix:** the next lever, not pulled yet, is trimming the Overpass query itself. Right now every "Analyze" click queries all 11 categories in one query (for the diversity metric) even though only one of them is the actual competitor count that matters most — splitting that into a small, fast "just the selected category" query (retried across mirrors) plus a separate, best-effort "everything else" query (tried once, allowed to fail silently) would cut the load on whichever mirror answers, and likely cut how often a 524 happens in the first place. Flagging this as the next thing to try, not implementing it preemptively.

## Settings reference

Everything a layperson might want to change lives in one `CONFIG` block near the top of `market-radar.js`, with the current value on the left:

| Setting | Current value | Where to change it |
|---|---|---|
| Towns available in the wizard | Miri, Kuching, Sibu, Bintulu | `TOWNS`, `market-radar.js` |
| Default town | Miri | `DEFAULT_TOWN`, `market-radar.js` |
| Business categories & their OpenStreetMap tags | 13 categories (pharmacy, petrol added 2026-09-24), see `CATEGORY_TAGS` | `CATEGORY_TAGS`, `market-radar.js` |
| Catchment modes offered | 5/10/15-min walk, 5/10/15-min drive — also the full set Market Gap mode uses, uncapped further | `CATCHMENT_MODES`, `market-radar.js` |
| Opportunity score starting weights | Low competition 35%, population 25%, income 15%, diversity 15%, momentum 10%, competitor strength 0% | `SCORE_WEIGHTS_DEFAULT`, `market-radar.js` — the six weight boxes on the page are filled from it on load (the `value=` attributes in the HTML are only a fallback); still editable live on the page |
| Competitor count that counts as "saturated" | 12 **per business type ticked** (4 types → 48) | `SATURATION_COUNT`, `market-radar.js` — scaled in `computeOpportunityScore` |
| District size that maxes out the population sub-score | 120,000 people | `POPULATION_NORMALIZER`, `market-radar.js` |
| District income that maxes out the income sub-score | RM7,000/month | `INCOME_NORMALIZER`, `market-radar.js` |
| Daily analysis limit per browser | 15 | `MAX_ANALYSES_PER_DAY`, `market-radar.js` |
| **Pinned population fallback (used when both DOSM OpenAPI endpoints fail — currently always)** | **Miri 255,100 · Kuching 621,700 · Sibu 254,000 · Bintulu 186,600 (DOSM 2023 estimates)** | **`DISTRICT_POPULATION_FALLBACK_2023`, `market-radar-proxy-worker.js` — refresh yearly by hand; add a row here if a 5th town is ever added to `TOWNS`** |
| Overpass POI cache duration | 24 hours | `fetchOverpassPOIs`, `market-radar-proxy-worker.js` |
| Overpass mirrors tried, in order | overpass-api.de, overpass.kumi.systems, overpass.private.coffee | `OVERPASS_MIRRORS`, `market-radar-proxy-worker.js` |
| Timeout per external call (each Overpass mirror, Geoapify, ORS, data.gov.my, Gemini) | 10 seconds | `EXTERNAL_CALL_TIMEOUT_MS`, `market-radar-proxy-worker.js` |
| How often the "still working" status message updates during a slow analysis | Every 7 seconds | `PROGRESS_MESSAGES` / `startProgressMessages()`, `market-radar.js` |
| Geoapify category mapping (Overpass-fallback only) | 10 categories mapped, "printing" unmapped (Geoapify has no print-shop equivalent) — see `GEOAPIFY_CATEGORY_MAP` | `GEOAPIFY_CATEGORY_MAP`, `market-radar-proxy-worker.js` |
| Brand-name / keyword fallback for categories where the primary OSM tag is shared with other business types | "drinks" only for now (bubble tea brand names + generic words) | `NAME_HINTS`, `market-radar.js` — add another category's array the same way if it runs into the same problem |
| Isochrone cache duration | 30 days | `fetchIsochrone`, `market-radar-proxy-worker.js` |
| Demographics cache duration | 7 days, **successes only** (key `demographics-v2`) | `fetchDemographics`, `market-radar-proxy-worker.js` — the Data Catalogue and OpenDOSM APIs each allow only 4 requests/minute (developer.data.gov.my/rate-limit). Cloudflare only guarantees its Cache API on custom domains, so nothing depends on it. Doesn't apply to the pinned population fallback, which isn't cached data at all — it's a plain constant |
| Websites allowed to call the Worker (CORS) | `reysourcez.com`, `www.reysourcez.com` | `ALLOWED_ORIGINS`, `market-radar-proxy-worker.js` |
| Gemini model used for narration | `gemini-flash-lite-latest` | `GEMINI_MODEL`, `market-radar-proxy-worker.js` |
| Most business types tickable at once | 4 | `MAX_CATEGORIES`, `market-radar.js` |
| Business type ticked on page load | Cafe / kopitiam | `DEFAULT_CATEGORIES`, `market-radar.js` |
| Weight given to an on-site read the moment one is picked | 0.10, taken from Low competition | `ON_SITE_AUTO_WEIGHT`, `market-radar.js` |
| Fallback narration model (Workers AI) | `@cf/meta/llama-3.1-8b-instruct-fp8-fast` | `WORKERS_AI_MODEL`, `market-radar-proxy-worker.js` — Cloudflare retires models periodically; check developers.cloudflare.com/workers-ai/platform/pricing if it stops answering |
| Largest search radius the Worker accepts | 12,000 m | `MAX_RADIUS_M`, `market-radar-proxy-worker.js` |
| Most custom items addable to the Market Gap checklist | 8 | `MAX_GAP_CUSTOM_ITEMS`, `market-radar.js` |
| Market Gap "oversupplied" / "thin" thresholds | ≥2× the catchment's own average count = oversupplied; ≤0.4× = thin; 0 = gap always | `computeGapReads()`, `market-radar.js` — a relative, in-catchment judgement call, deliberately not an external benchmark; see the 2026-09-24 section above |
| Worker version shown on the page | 1.6.0 | `WORKER_VERSION`, `market-radar-proxy-worker.js` — bump on every deploy |

**Not yet reflected in `market-radar-settings-reference.xlsx`:** `DISTRICT_POPULATION_FALLBACK_2023` (from v1.5.1), and now also the two new categories (pharmacy/petrol) and `MAX_GAP_CUSTOM_ITEMS` (from v1.6.0). Nothing already in that spreadsheet is wrong — these are purely additions, deferred again this round to keep turnaround quick; see Open Items below.

## What's built vs. what's KIV

**Built:** wizard (town + catchment mode), click-to-place pin, live Overpass competitor search by category with a Geoapify fallback for when Overpass's shared-IP rate limiting kicks in, real isochrone catchment with radius fallback, district population + income from data.gov.my (server-side filtered, correct units) with a pinned fallback for population now that both live endpoints are confirmed broken, a fully editable opportunity score, category-diversity index, Gemini plain-English narration, soft daily usage cap, Save as PDF, provenance tags on every stat (now including a visible note when population is a pinned rather than live figure). **Added 2026-09-20:** 5-minute catchments, the max-4 business-type checkboxes with a per-type breakdown, the on-site read feeding the score automatically, the (since-superseded) OpenDOSM endpoint fix for population, the Workers AI narration backstop, and Worker-side input validation. **Added 2026-09-22:** the pinned population fallback that actually resolves the population issue, and the client-side note that surfaces it. **Added 2026-09-23:** resetting every result-dependent element (score, cards, on-site read + its auto-weight, AI box, status line) when the person goes back to "Edit answers," so a new spot never starts by showing the previous one's numbers. **Added 2026-09-24:** the site nav retrofit; a mode-select screen splitting the tool into Market Analysis (unchanged) and the new Market Gap mode; two more standard categories (pharmacy, petrol — 13 total); the Market Gap checklist itself (gap/thin/adequate/oversupplied read, per-category "people per shop," custom checklist additions, and a matching plain-English-read prompt).

**KIV, not built this round:**
- **Port anchors, the DOSM trend card, and the population/income display to Market Gap mode's results panel.** The data is already in every Worker response regardless of mode — this is display work only, deferred to keep the first version of this mode reviewable rather than sprawling.
- **Verify (don't guess) whether `pharmacy`/`petrol` belong in `IOWRT_GROUPS`**, and add real `GEOAPIFY_CATEGORY_MAP` / `GOOGLE_PLACE_TYPES` entries for both once checked against each provider's current docs — both fall through to graceful "not tracked"/"no backstop" defaults today, so nothing is broken, just incomplete.
- **Household-vs-business/institution personas for Market Gap.** Researched 2026-09-24: the household checklist is well-backed by the 15-minute-city literature; research on what a small business or institution specifically needs nearby came back thin (mostly generic site-selection advice, not a "which other business types" checklist). Decision this round was to ship the research-backed household list rather than build a persona picker on a weaker evidence base for two of the three personas — revisit if the project owner wants to supply the business/institution checklist from their own domain knowledge instead, clearly labelled as such rather than presented as equally research-backed.
- **Add `DISTRICT_POPULATION_FALLBACK_2023`, the two new categories, and `MAX_GAP_CUSTOM_ITEMS` to `market-radar-settings-reference.xlsx`** — straightforward additions, deferred twice now to keep turnaround quick.
- **AppSheet field-survey ingestion** — the fourth "Observed" data layer discussed when this tool was scoped. Schema for the AppSheet app, ready whenever you want to build it:

  | Field | Type | Notes |
  |---|---|---|
  | Timestamp | DateTime | Auto-filled by AppSheet |
  | Latitude / Longitude | Decimal | Use AppSheet's built-in location capture |
  | Business or spot name | Text | |
  | Observed foot traffic (1–5) | Number | Your own subjective scale |
  | Notes | Long text | Free text — "shoplot looks vacant", "parking full at lunch", etc. |

  Publish the resulting Google Sheet as CSV (**File → Share → Publish to web → CSV**, free), and `market-radar-proxy-worker.js` can fetch and cache that URL as a fourth data source once it exists — there's nothing to build on the Worker side until the Sheet does.
- **Full MSIC-code alignment** — `CATEGORY_TAGS` covers the 13 categories most likely to matter for a first F&B/retail business (or, now, a household-needs scan), not Malaysia's full official industrial classification.
- **Momentum / trend tracking** — the momentum sub-score sits at a neutral placeholder until repeated snapshots exist to diff against.
- **Popularity / foot-traffic signals (researched 2026-09-16, not built)** — the idea: weight each competitor by how known/busy it actually is, not just count heads. Researched Google popular times, Foursquare, Instagram, TikTok, and Google Trends; conclusion for each is in that day's chat, short version here for continuity:
  - Google popular times: no official API at all — Google's own Places field catalogue doesn't expose it, and the only ways to get it are scrapers that Google's own ToS (clause 10.1(b)) explicitly prohibits. Not recommended.
  - Foursquare: does have a real "popularity" field, but it's a Premium (paid, no free tier) endpoint under a restrictive, non-redistributable license, and coverage outside dense Western/US markets — which very much includes Miri — is unconfirmed. Possible future paid upgrade, not a fit right now.
  - Instagram Graph API: officially supports looking up a NAMED competitor's own follower/media count (Business Discovery), but nothing area-wide or hashtag-based for arbitrary businesses, and it requires reysourcez's own Instagram Business account to clear Meta App Review first. Too much overhead for what it'd add.
  - TikTok: the public Creative Center shows country/industry-level trending hashtags, not per-business or per-location data — wrong granularity for this tool regardless of access method.
  - Google Trends: the real API Google announced is still an invitation-only alpha with no timeline; the old unofficial workaround (pytrends) is dead/unmaintained. Even with access, small-town, single-shop search volume in Sarawak is likely too sparse to register at all.
  - **What's actually worth building:** (1) Google Places API's official `rating` + `user_ratings_total` fields as a lawful, officially-supported "how known/liked is this specific competitor" proxy — a new integration (needs its own Google Cloud API key), not free at high volume, but no ToS issue; (2) extend the AppSheet layer above with one more field, e.g. "Visible queue or crowd at peak time (Y/N)" or "Estimated social media presence (1–5)" — free, lawful, and fits the existing Observed-data tier exactly as designed. Either should land as a refinement to competitor STRENGTH inside the existing low-competition sub-score (or a new, clearly-labelled, optional sub-score) — never silently folded into the existing weights, per this tool's own transparency principle. **Reviewed again 2026-09-23: decision is to keep competitor strength exactly as it is (the on-site read is the free half of this and already works); no change made.**
- **Handoff into the rest of the tool suite** — `market-radar.js` already calls `rzBroadcast({ source: 'market-radar', ... })` for Market Analysis mode if `costing-sync.js` is loaded, but Interactive Costing Analysis and Margin Analysis's own `handleSyncPayload` functions don't recognise that source yet. Market Gap mode doesn't broadcast at all — no shape has been designed for a checklist result. That's a small, contained edit to those two existing files — see "Nav & sync reconciliation" below.
- **(2026-09-20) Put the Worker on a custom domain** (e.g. `api.reysourcez.com`). Cloudflare only guarantees its Cache API on custom domains, so today the 24-hour/7-day/30-day caches may not be doing anything on `*.workers.dev`; a custom domain would make them real and take pressure off the 4-requests/minute data.gov.my limit. The Worker was rewritten so nothing *depends* on caching, but it would still help.
- **(2026-09-20) Stop random callers using the Worker.** CORS only blocks other websites. Enforcing the `Origin` header, or adding Cloudflare Turnstile, would block casual curl abuse. Not done because it would also block local testing from `file://`; say the word.
- **(2026-09-20) Show the data year on the population and income cards** (population is annual, latest 2024 as of the dataset page; income is survey-year). The Worker already has the date for income; for population, this now matters more, since a pinned 2023 estimate should ideally be labelled with its year directly rather than only via the provenance note's prose.
- **(2026-09-20) Explicit Cloudflare placement hints** (Wrangler config only) if the Workers AI backstop ever proves not enough for Gemini — not needed while the backstop works.
- **(2026-09-22) Refresh `DISTRICT_POPULATION_FALLBACK_2023` yearly**, or sooner if DOSM fixes either OpenAPI endpoint (self-healing is already coded — check whether the "showing DOSM's 2023 district estimate instead" note has stopped appearing, which would mean a live figure is coming through again).
- **(2026-09-23) Decide the fate of Google-Places-driven competitor strength** — without a paid `GOOGLE_PLACES_API_KEY`, manually raising that one weight has no informative effect (flat neutral 0.5, by design, not a bug). The on-site-read path is unaffected either way and already works well. Keep it dormant (free, zero cost) or strip the Google-only half out — owner's call.
- **(2026-09-23) Scope a second "gap analysis" mode** — sweep several walk/drive time-bands around a pin, inventory every business type found, and surface thin/absent categories as candidate gaps. See the 2026-09-23 section above for the open questions (ORS isochrone quota, `MAX_RADIUS_M` vs. a 60-min drive band, category-taxonomy breadth, and a precise, non-invented definition of "gap") that need answers before this moves from idea to build.


## Other data.gov.my / OpenDOSM datasets worth a look (researched 2026-09-16)

Full catalogue: `open.dosm.gov.my/data-catalogue`. Beyond `population_district` and `hh_income_district` (both already wired in), the ones most relevant to site selection, roughly in order of likely value:

| Dataset id | What it adds |
|---|---|
| `hies_district` | Household income AND EXPENDITURE at district level (2022 HIES) — expenditure is arguably a better demand proxy than income alone |
| `hh_poverty_district` | Poverty rate by district — context for how far a headline income figure actually stretches |
| `lfs_district` | Unemployment / labour-force participation by district — a second, independent read on local economic health |
| `crime_district` | Crimes by district and type (PDRM) — relevant to evening foot traffic and a genuinely different risk signal than anything else here |
| `pricecatcher` + `lookup_premise` | Investigated 2026-09-17, ruled out: both are explicitly marked "not available through OpenAPI" on their own data.gov.my pages — bulk CSV/Parquet download only (the transactional table alone is "over a million price records per month"), which doesn't fit a per-request Cloudflare Worker call. `lookup_premise` is also scoped to KPDN-monitored grocery/commodity premises (supermarkets, wet markets) specifically, not a general business directory, so even a batch-download-and-cache approach would only ever extend the "minimart" category. Not worth the infrastructure jump (scheduled batch job + storage) for that scope. |
| `gdp_district_real_supply` | District GDP by economic sector — last published for 2020 as of this check, so more a slow-moving backdrop than a current signal |
| `msic` | Full official Malaysian industrial classification lookup — the natural next step if this tool ever grows past its current ~11 hand-picked categories toward the "Full MSIC-code category alignment" KIV item above |

**Note added 2026-09-22:** before wiring in any of these the way `population_district` was assumed (but not verified) to work, actually call the dataset's OpenAPI endpoint live first — see "The population figure — five rounds wrong" above for why this project no longer trusts a dataset's documentation page or its apparent similarity to a working dataset as a substitute for testing it.

## Nav & sync reconciliation (for whichever pass handles this centrally)

Per `AI_BUILD_BRIEF.md`'s own rule, a single-tool build session doesn't patch every other page's nav — that's reconciled centrally. For that pass, when it happens:

- Add the `market-radar.html` entry (see the updated `NAV_ORDER_STANDARD.md` in this same output) to the `.nav-dropdown-menu` block on: `index.html`, `about.html`, `services.html`, `contact.html`, `menu-calculator.html`, `overhead-manpower-calculator.html`, `printing-calculator.html`, `interactive-costing-analysis.html`, `margin-audit-calculator.html`, `food-worth-calculator.html`, `crypto-radar.html`.
- Optionally, add a small `market-radar` branch to `handleSyncPayload` in `interactive-costing-analysis.js` and `margin-audit-calculator.js` so a completed Market Radar analysis can pre-fill a starting rent/overhead guess — not required for Market Radar to work standalone, just for the "front door to the whole suite" flow.

## Jargon index

| Term | Plain-English meaning |
|---|---|
| Isochrone | A real "everywhere reachable within N minutes" shape from a routing engine — not a circle. A 10-minute walk isochrone hugs actual streets, so it's narrower across a river or a highway than a plain-radius circle would be. |
| Catchment | The area counted as "around" your pin for this analysis — either a real isochrone, or a radius-circle fallback if the isochrone service didn't answer. |
| Overpass API | OpenStreetMap's free query engine for "find me every X within this area." No key, no cost, crowd-sourced data — meaning coverage is good in busy areas and patchier in quiet ones, and rate limiting is by IP address only, which is exactly what caused this tool's second real bug (see "shared IP" below). |
| Shared IP (Cloudflare Workers) | Every Cloudflare Worker, from every customer worldwide, sends outbound requests from a pool of shared IP addresses — there's no way to get a dedicated one on the free tier. A free API that rate-limits by IP (like Overpass) can't tell this Worker's traffic apart from any other Workers script that's ever hit it, so it can end up throttled by strangers' usage, not its own. Geoapify was added specifically because it rate-limits by API key instead, sidestepping this. |
| Geoapify | A commercial, OSM-based places API used here only as a fallback, tried after every Overpass mirror fails. Free tier: 3,000 credits/day, no card. |
| OSM tag | The key=value label OpenStreetMap uses to describe a place, e.g. `amenity=cafe`. Tagging is done by volunteers and is genuinely inconsistent, which is why competitor counts here are a signal, not a census. |
| Cuisine tag | A more specific OSM sub-tag layered ON TOP of a primary type, e.g. `amenity=cafe` + `cuisine=bubble_tea`. Several genuinely different businesses can share the same primary tag (a plain kopitiam and a bubble tea stall are both often just `amenity=cafe`), so this tool checks cuisine tags first, before the broader primary tag, when deciding which category a place belongs to — see `categorize()` in the Worker. |
| Name hint | A last-resort check on a place's actual NAME (e.g. "Chatime", "boba") for the handful of real-world cases where even a cuisine tag is missing. Only used for "Drink stall / bubble tea" so far — see `NAME_HINTS` in `market-radar.js`. |
| Opportunity score | This tool's own summary number, 0–100: a plain weighted blend of low competition, population, income, and category diversity. Fully visible, fully editable — never a black box. |
| Market Gap mode | Added 2026-09-24 — the second analysis mode. Instead of scoring one chosen business type, it checks a whole household-needs checklist at once and reports each category as a gap, thin, adequate, or oversupplied — see `computeGapReads()` in `market-radar.js`. |
| Gap / thin / oversupplied | Market Gap mode's per-category read. "Gap" = none found (the only absolute case). Thin/adequate/oversupplied are RELATIVE to the other categories found in the same catchment — this tool has no verified external "should have N" benchmark, so it deliberately doesn't pretend to. |
| 15-minute city | An urban-planning concept (Carlos Moreno) that a neighbourhood should meet most daily needs — food, healthcare, education, retail, personal services — within a 15-minute walk or equivalent. Used as research backing for Market Gap mode's household checklist, not as this project's own claim. |
| Diversity index | How mixed the businesses near your pin are, not just how many of your own category exist. Built from the same idea as the Herfindahl-Hirschman Index economists use for market concentration, inverted so higher = more mixed. |
| Provenance tag | The small "Official / Estimated / Calculated" label under every stat, so a government population figure never reads with the same confidence as a crowd-sourced OpenStreetMap count. Since v1.5.1, population's note also distinguishes a live DOSM query from a pinned DOSM figure — both are "Official," but only one is current-request-fresh. |
| DOSM | Department of Statistics Malaysia — the government body behind the population and household-income datasets this tool uses, both published freely via data.gov.my. |
| HIES | Household Income and Expenditure Survey — the actual survey DOSM's income-by-district numbers come from, most recently run in 2022. |
| Worker | The Cloudflare Worker (`market-radar-proxy-worker.js`) — holds the OpenRouteService and Gemini keys server-side and caches every external call so this tool doesn't quietly exhaust a shared free-tier allowance. |
| OpenDOSM API vs Data Catalogue API | Two separate endpoints on `api.data.gov.my`: `/opendosm` serves datasets published on open.dosm.gov.my, `/data-catalogue` serves the general data.gov.my catalogue. In theory each dataset lives on one or the other; in practice, as of 2026-09-22, `population_district` doesn't work on EITHER — confirmed live, not assumed — which is why v1.5.1 stopped depending on this distinction for that one dataset. |
| `filter` / `ifilter` / `icontains` | The query parameters for narrowing rows: `filter` = exact, case-sensitive (the only one documented for several `value@column` pairs at once); `ifilter` = exact, case-insensitive, one `value@column`; `icontains` = partial, case-insensitive. |
| Workers AI | Cloudflare's own AI service, callable from inside a Worker with no outside network hop and no API key — used here only as the backstop for the plain-English read. Free up to 10,000 "neurons" a day. |
| Binding | A named connection between a Worker and a Cloudflare service, made in the Worker's Settings (not a secret, no key). The Workers AI binding must be named exactly `AI`. |
| Region block (Gemini) | Google's Gemini API refuses requests that arrive from unsupported regions. A Worker runs in whichever Cloudflare data centre handles the request — usually near the visitor, but not always — so the same Worker can pass one minute and be refused the next ("User location is not supported for the API use"). |
| Smart Placement / placement hints | Cloudflare settings that move a Worker closer to the services it calls. Smart Placement needs steady traffic from several locations to decide anything; explicit hints are documented only for the Wrangler config file. Neither suits a Worker pasted into the dashboard, hence the backstop. |
| Pinned fallback (population) | New in v1.5.1: a small, hand-maintained table of known-correct values kept directly in the Worker's code, read only when a live API is confirmed unable to serve the same data. Trades live-ness for reliability and zero runtime cost — appropriate here because the tool only needs four specific districts and the real-world figure barely moves year to year. |
| Workers CPU-time limit | The free Cloudflare Workers plan caps actual JS execution time (not network wait time) at 10ms per request. A large synchronous operation — like parsing a ~300k-row CSV — can exceed this and fail outright (error 1102), which is why v1.5.1 pins population instead of parsing `population_district.csv` the way `iowrt_3d.csv` (a much smaller file) is parsed. |
