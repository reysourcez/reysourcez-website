# Market Radar — Setup & Reference

## Current status (as of 2026-09-16, revised)

**A note on how this doc and the shipped code drifted apart, for whichever session reads this next:** the previous version of this table said Geoapify, the 10s timeout, and the DOSM fixes were already done. Re-reading `market-radar-proxy-worker.js`'s own code on 2026-09-16 (not just re-trusting this doc) turned up that none of those three had actually made it into the file — they were designed and written up here, but the code itself still only had the 2026-09-13 Overpass-mirrors fix. That gap is closed as of this revision, confirmed by reading the actual file this time, and the file versions in this same output batch are the ones that now genuinely match this table. Lesson for next time baked into the process, not just this paragraph: treat this table as a claim to verify against the real file before repeating it, the same way this round did.

| Area | Status |
|---|---|
| Wizard, map, click-to-place pin | ✅ Working |
| Overpass competitor search | ✅ 3-mirror fallback (since 2026-09-13); Geoapify backstop and 10s per-call timeout genuinely implemented as of this revision, not just described |
| Bubble tea / other cuisine-tagged categories | ✅ Fixed this revision — `categorize()` now checks `cuisine=*` tags before generic `amenity=*`/`shop=*` tags, plus a `NAME_HINTS` brand/keyword fallback in `market-radar.js` — see that file's own 2026-09-16 comments |
| Isochrone catchment (real travel-time shape) | ✅ Working, confirmed live; falls back to a plain circle if OpenRouteService fails |
| District population & household income (DOSM) | ✅ Fixed this revision, this time confirmed against data.gov.my's own published API docs and dataset schema, not guessed — see `fetchPopulation()`'s own comment in the Worker. Still worth one live confirmation click after deploying |
| Opportunity score, editable weights, diversity index | ✅ Working — now 6 weights, see below |
| Competitor strength (Google ratings + on-site read) | ✅ Built 2026-09-16/17, off by default. Optional, costs real money past 1,000 calls/month if turned on — see the settings sheet |
| Gemini plain-English read | ✅ Working, confirmed live |
| "Still working" progress messaging on slow analyses | ✅ Working |
| Nav entries on the other 10 pages | ⏸ Not done — per this project's own `AI_BUILD_BRIEF.md`, that's a central reconciliation pass, not a single-tool job |
| `cost-structure-checker` in the nav standard | ⏸ The page itself now exists (`cost-structure-checker.html`) — still correctly held out of live nav per the same central-pass rule above, just no longer accurate to describe as "not built yet" the way `NAV_ORDER_STANDARD.md` currently does |
| `qr-code-creator` / "QR Listing Creator" in the nav standard | ⏸ Genuinely doesn't exist as a page yet — still accurate as "not built" |
| AppSheet field-survey layer | ⏸ Not started — schema specified below, waiting on the actual Sheet existing. See "Popularity / foot-traffic signals" below for how this could extend to cover that too |
| Sync handoff into Interactive Costing Analysis / Margin Analysis | ⏸ Not started — `market-radar.js` already broadcasts, the receiving side doesn't listen yet |

**Immediate next step:** redeploy `market-radar-proxy-worker.js` and `market-radar.js` (this revision) over whatever's currently live, and re-test the bubble tea category and the population figure specifically — both had a plausible-looking fix land in this project before that turned out not to be doing what it claimed.

## 2026-09-17 update

Two things happened this round, worth recording precisely rather than just "more fixes":

**1. Competitor strength shipped.** `market-radar.html`/`.js` gained a 6th, off-by-default weight, a new "On-site read" field for a manual busyness note, and a new result card. `market-radar-proxy-worker.js` gained `fetchGooglePopularity()` — one Google Places Nearby Search (New) call per analysis, only when `GOOGLE_PLACES_API_KEY` is set, matching results to already-classified competitors by proximity. Fully tested: weight-at-0 is provably a no-op (same score with or without rating data present), and directionality is correct (a strong, well-reviewed competitor lowers the factor; a quiet/thin one raises it; a manual on-site read always wins when present).

**2. A user-supplied "previous version" of the Worker turned out to be broken, and it's worth recording exactly how, since it looked plausible on a skim and the mistake is an easy one to repeat.** That file's `GEOAPIFY_ENDPOINT` pointed at Geoapify's *geocoding* endpoint (`/v1/geocode/search`) with a hardcoded London address and a demo API key — both copy-pasted straight from Geoapify's own documentation example — then appended a second `?` onto that already-complete URL to try to add the real category/filter/key parameters. A URL can only have one `?`; everything after the first is already query-string content, so that second `?` and everything after it (including the real API key) just became part of the literal value of the fake demo key. That request could only ever fail — which lines up exactly with the report that motivated this check ("Overpass always seems to fail, and there's no working fallback"). The version in this repo has used the correct endpoint (`api.geoapify.com/v2/places`, actual lat/lng/radius interpolated in) since it was first written, confirmed against Geoapify's own current docs.

While comparing the two files, two genuinely good details from that other draft got adopted here: an actual `User-Agent` header on Overpass calls (this file was sending none — a real omission, and plausibly a second, separate contributor to Overpass failing more than it should), and `sort=-date&limit=1` on the two data.gov.my queries instead of downloading several rows to sort client-side (confirmed as a real, documented parameter after a closer read of developer.data.gov.my/request-query).

**If Overpass still seems to fail constantly after deploying this version:** `market-radar.js` already shows the Worker's exact `poisError` message on-page after a failed analysis — it names precisely which HTTP status or error each of the three mirrors returned, and says plainly whether `GEOAPIFY_API_KEY` is even configured. That message is the fastest way to tell "Overpass is genuinely down" apart from "Geoapify isn't configured" apart from "something else entirely" — worth reading closely and pasting back verbatim if the problem continues, rather than guessing again.

**3. `market-radar-settings-reference.xlsx` now exists**, matching the same format as `rental-calculator-settings-reference.xlsx` and `cost-structure-checker-settings-reference.xlsx` — current default in column B, a blank yellow-highlighted column for your own value, exact code location, and notes. Covers every API key (never the actual key values — those stay in Cloudflare's Secrets store only), all 11 category-to-OSM-tag mappings, the bubble-tea name-hint keyword list, all 6 score weights and both normalizers, and the 4 town presets.

## 2026-09-17, later the same day: three more ideas checked

**Heat map — already existed.** `leaflet.heat` has been loaded and wired up since before this session (`heatLayer = L.heatLayer(competitors.map(...))`, radius 30, blur 20) — it just had no visibility toggle, so it was easy to not notice sitting under the red competitor pins. Added a "Density heat map" checkbox next to the map legend so it's visible and controllable rather than always-on-and-easy-to-miss.

**Live vacant-shop / commercial-property listings — no viable source, built a notepad instead.** Checked JPPH/NAPIC (Malaysia's official property valuation authority): they publish only *past sale transactions*, via paid subscription or ad-hoc request (RM1 per floor specifically for rental data), not current vacancies, and not as a live API. Checked PropertyGuru/CommercialGuru and the other portals: no official public API anywhere — every available integration is a third-party scraper, the same ToS-risk category this project already ruled out Mudah scraping for. Built a plain, non-persistent notepad instead (floor level + free-text asking price/notes) — same "resets on tab close, nothing verified automatically" pattern as the on-site busyness field.

**"Which business types are gaining/losing traction, from DOSM" — real data exists, not practically usable here.** `iowrt_3d` (Wholesale & Retail Trade by 3-digit MSIC group) publishes exactly this as a pre-computed `growth_yoy` series — but its own page explicitly says "not available through OpenAPI... unsuitable for API access," bulk CSV/Parquet only. Even solving that, it's Malaysia-wide with no state or district breakdown, and covers MSIC Section G (wholesale/retail) only — not Section I (accommodation & food service), so it wouldn't say anything about cafes, restaurants, or bubble tea regardless. Not worth building against for this tool. While checking this, confirmed a useful pattern for evaluating any future DOSM dataset: check the exact dataset's own "Sample OpenAPI query" section specifically — simple one-row-per-district tables (`population_district`, `hh_income_district`, `lfs_district`) tend to be live-queryable; large transactional tables and computed time-series indices tend to be bulk-only.

## 2026-09-18: MSIC alignment, DOSM trend (reconsidered), anchors, heat map fix

**QR Listing Creator dropped from this project's KIV list** — being handled elsewhere.

**MSIC 2008 codes added to every category**, purely as reference metadata shown in the UI (tooltips) — plays no part in the actual Overpass query or classification logic. Sourced from Malaysia-specific documents (LHDN's own MSIC2008 business-code PDF, data.gov.my's `msic` lookup table), cross-checked against at least two independent Malaysia-specific sources per code, not just the generic international ISIC numbering, which occasionally diverges at this level of detail. Full table now in `market-radar-settings-reference.xlsx`.

**The DOSM business-trend idea — reconsidered, and actually built.** Previous conclusion ("bulk-only, not practical here") was too quick: `iowrt_3d` not being on the *filterable query* API doesn't mean it's inaccessible — the actual CSV DOSM publishes for download is CC BY 4.0 licensed for exactly this kind of reuse, and at this dataset's real size (a monthly index across ~30 groups, not millions of transactional rows like `pricecatcher`), fetching and parsing it directly is genuinely practical. `fetchWholesaleRetailTrend()` in the Worker now does exactly that — fetches the real CSV, parses it defensively (header-driven column lookup, not a hardcoded position, since the value column's exact name isn't confirmed the way date/series_type/group are), caches for 30 days (matches the update cadence), and returns the actual figure with its real `asOf` date pulled from the data itself — never a hardcoded/guessed date. Caught and fixed a real bug during testing: the first version picked the wrong column when more than one extra numeric column was present; fixed to validate against actually-parseable values per row rather than trusting column position. Still only covers minimart/bakery/hardware/fashion (Section G) and is still Malaysia-wide, not Miri-specific — both limits shown plainly in the card's own tooltip, not hidden.

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

Business density (OpenStreetMap/Overpass) and district demographics (data.gov.my) need no API key at all — once the Worker is deployed with just `ALLOWED_ORIGINS` updated, those two layers work immediately. Three things are optional and degrade gracefully without a key:

- **No `ORS_API_KEY`** → every catchment falls back to a plain dashed-circle radius instead of a real walk/drive-time shape. Everything else keeps working.
- **No `GEMINI_API_KEY`** → the "Get a plain-English read" button returns an error message. Every number on the page is unaffected either way, since Gemini only narrates, never calculates.
- **No `GEOAPIFY_API_KEY`** → if every free Overpass mirror happens to be down at once (see "A note on Overpass" below — this turned out to be more common than expected), competitor data shows as honestly unavailable instead of quietly recovering through a second source. Everything else on the page is unaffected.

## Deploying the Worker

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com) if you don't have one — you likely already do, from your other Workers.
2. **Workers & Pages → Create → Create Worker**. Name it (e.g. `market-radar-proxy`), deploy the default template, then **Edit code** and replace everything with `market-radar-proxy-worker.js`'s contents. Deploy.
3. **Settings → Variables and Secrets → Add**, as **Secret**:
   - `GEMINI_API_KEY` — the same key your other tools already use
   - `ORS_API_KEY` — see below
   - `GEOAPIFY_API_KEY` — see below
4. Copy the Worker's `*.workers.dev` URL and paste it into `WORKER_ENDPOINT` near the top of `market-radar.js`.

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

### The population figure that was wrong three times over

Three separate bugs, all now fixed:

1. **Wrong row entirely.** `population_district` publishes dozens of rows per district — one for every combination of sex, age band, and ethnicity, not one tidy row per district. Fixed by filtering to `sex=both`, `age=overall`, `ethnicity=overall` as well as district.
2. **Wrong unit.** The dataset publishes population in **thousands**, not headcount — confirmed directly against DOSM's own variable definitions. A district of 300,000 people was being read and shown as "300."
3. **The actual, final bug — combining two query parameters that were never confirmed to combine.** The first fix for #1 above used `ifilter=<district>@district` and `filter=both@sex,overall@age,overall@ethnicity` as two SEPARATE query parameters. data.gov.my's own docs (developer.data.gov.my/request-query) confirm the comma-separated multi-column syntax WITHIN either parameter, but never confirm the two parameter types can be combined in one request — and in practice, this combination came back with zero matching rows every single time, which is exactly what "population always unavailable, even on an otherwise-perfect run" looked like. Fixed by putting every condition under one `ifilter` parameter instead. The Worker also now logs a `demographics debug` line (district, HTTP status, and row count for each of the two datasets) visible in Cloudflare's dashboard under the Worker's **Logs** tab — if this ever goes quiet a fourth time, that line says why immediately instead of needing another guess-and-redeploy round.

Household income needed none of this — `income_median` was correct from the first guess, confirmed against DOSM's own documentation for `hh_income_district`, which has no further breakdown dimensions to trip over.

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
| Business categories & their OpenStreetMap tags | 11 categories, see `CATEGORY_TAGS` | `CATEGORY_TAGS`, `market-radar.js` |
| Catchment modes offered | 10/15-min walk, 10/15-min drive | `CATCHMENT_MODES`, `market-radar.js` |
| Opportunity score starting weights | Low competition 35%, population 25%, income 15%, diversity 15%, momentum 10% | `SCORE_WEIGHTS_DEFAULT`, `market-radar.js` — also editable live on the page itself |
| Competitor count that counts as "saturated" | 12 | `SATURATION_COUNT`, `market-radar.js` |
| District size that maxes out the population sub-score | 120,000 people | `POPULATION_NORMALIZER`, `market-radar.js` |
| District income that maxes out the income sub-score | RM7,000/month | `INCOME_NORMALIZER`, `market-radar.js` |
| Daily analysis limit per browser | 15 | `MAX_ANALYSES_PER_DAY`, `market-radar.js` |
| Overpass POI cache duration | 24 hours | `fetchOverpassPOIs`, `market-radar-proxy-worker.js` |
| Overpass mirrors tried, in order | overpass-api.de, overpass.kumi.systems, overpass.private.coffee | `OVERPASS_MIRRORS`, `market-radar-proxy-worker.js` |
| Timeout per external call (each Overpass mirror, Geoapify, ORS, data.gov.my, Gemini) | 10 seconds | `EXTERNAL_CALL_TIMEOUT_MS`, `market-radar-proxy-worker.js` |
| How often the "still working" status message updates during a slow analysis | Every 7 seconds | `PROGRESS_MESSAGES` / `startProgressMessages()`, `market-radar.js` |
| Geoapify category mapping (Overpass-fallback only) | 10 categories mapped, "printing" unmapped (Geoapify has no print-shop equivalent) — see `GEOAPIFY_CATEGORY_MAP` | `GEOAPIFY_CATEGORY_MAP`, `market-radar-proxy-worker.js` |
| Brand-name / keyword fallback for categories where the primary OSM tag is shared with other business types | "drinks" only for now (bubble tea brand names + generic words) | `NAME_HINTS`, `market-radar.js` — add another category's array the same way if it runs into the same problem |
| Isochrone cache duration | 30 days | `fetchIsochrone`, `market-radar-proxy-worker.js` |
| Demographics cache duration | 7 days | `fetchDemographics`, `market-radar-proxy-worker.js` — data.gov.my's Data Catalogue API allows only 4 requests/minute total, confirmed at developer.data.gov.my/rate-limit, so this is deliberately long |
| Websites allowed to call the Worker (CORS) | `reysourcez.com`, `www.reysourcez.com` | `ALLOWED_ORIGINS`, `market-radar-proxy-worker.js` |
| Gemini model used for narration | `gemini-flash-lite-latest` | `GEMINI_MODEL`, `market-radar-proxy-worker.js` |

## What's built vs. what's KIV

**Built:** wizard (town + catchment mode), click-to-place pin, live Overpass competitor search by category with a Geoapify fallback for when Overpass's shared-IP rate limiting kicks in, real isochrone catchment with radius fallback, district population + income from data.gov.my (server-side filtered, correct units), a fully editable opportunity score, category-diversity index, Gemini plain-English narration, soft daily usage cap, Save as PDF, provenance tags on every stat.

**KIV, not built this round:**
- **AppSheet field-survey ingestion** — the fourth "Observed" data layer discussed when this tool was scoped. Schema for the AppSheet app, ready whenever you want to build it:

  | Field | Type | Notes |
  |---|---|---|
  | Timestamp | DateTime | Auto-filled by AppSheet |
  | Latitude / Longitude | Decimal | Use AppSheet's built-in location capture |
  | Business or spot name | Text | |
  | Observed foot traffic (1–5) | Number | Your own subjective scale |
  | Notes | Long text | Free text — "shoplot looks vacant", "parking full at lunch", etc. |

  Publish the resulting Google Sheet as CSV (**File → Share → Publish to web → CSV**, free), and `market-radar-proxy-worker.js` can fetch and cache that URL as a fourth data source once it exists — there's nothing to build on the Worker side until the Sheet does.
- **Full MSIC-code alignment** — `CATEGORY_TAGS` covers the ~11 categories most likely to matter for a first F&B/retail business, not Malaysia's full official industrial classification.
- **Momentum / trend tracking** — the momentum sub-score sits at a neutral placeholder until repeated snapshots exist to diff against.
- **Popularity / foot-traffic signals (researched 2026-09-16, not built)** — the idea: weight each competitor by how known/busy it actually is, not just count heads. Researched Google popular times, Foursquare, Instagram, TikTok, and Google Trends; conclusion for each is in that day's chat, short version here for continuity:
  - Google popular times: no official API at all — Google's own Places field catalogue doesn't expose it, and the only ways to get it are scrapers that Google's own ToS (clause 10.1(b)) explicitly prohibits. Not recommended.
  - Foursquare: does have a real "popularity" field, but it's a Premium (paid, no free tier) endpoint under a restrictive, non-redistributable license, and coverage outside dense Western/US markets — which very much includes Miri — is unconfirmed. Possible future paid upgrade, not a fit right now.
  - Instagram Graph API: officially supports looking up a NAMED competitor's own follower/media count (Business Discovery), but nothing area-wide or hashtag-based for arbitrary businesses, and it requires reysourcez's own Instagram Business account to clear Meta App Review first. Too much overhead for what it'd add.
  - TikTok: the public Creative Center shows country/industry-level trending hashtags, not per-business or per-location data — wrong granularity for this tool regardless of access method.
  - Google Trends: the real API Google announced is still an invitation-only alpha with no timeline; the old unofficial workaround (pytrends) is dead/unmaintained. Even with access, small-town, single-shop search volume in Sarawak is likely too sparse to register at all.
  - **What's actually worth building:** (1) Google Places API's official `rating` + `user_ratings_total` fields as a lawful, officially-supported "how known/liked is this specific competitor" proxy — a new integration (needs its own Google Cloud API key), not free at high volume, but no ToS issue; (2) extend the AppSheet layer above with one more field, e.g. "Visible queue or crowd at peak time (Y/N)" or "Estimated social media presence (1–5)" — free, lawful, and fits the existing Observed-data tier exactly as designed. Either should land as a refinement to competitor STRENGTH inside the existing low-competition sub-score (or a new, clearly-labelled, optional sub-score) — never silently folded into the existing weights, per this tool's own transparency principle.
- **Handoff into the rest of the tool suite** — `market-radar.js` already calls `rzBroadcast({ source: 'market-radar', ... })` if `costing-sync.js` is loaded, but Interactive Costing Analysis and Margin Analysis's own `handleSyncPayload` functions don't recognise that source yet. That's a small, contained edit to those two existing files — see "Nav & sync reconciliation" below.

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
| Diversity index | How mixed the businesses near your pin are, not just how many of your own category exist. Built from the same idea as the Herfindahl-Hirschman Index economists use for market concentration, inverted so higher = more mixed. |
| Provenance tag | The small "Official / Estimated / Calculated" label under every stat, so a government population figure never reads with the same confidence as a crowd-sourced OpenStreetMap count. |
| DOSM | Department of Statistics Malaysia — the government body behind the population and household-income datasets this tool uses, both published freely via data.gov.my. |
| HIES | Household Income and Expenditure Survey — the actual survey DOSM's income-by-district numbers come from, most recently run in 2022. |
| Worker | The Cloudflare Worker (`market-radar-proxy-worker.js`) — holds the OpenRouteService and Gemini keys server-side and caches every external call so this tool doesn't quietly exhaust a shared free-tier allowance. |
