# Market Radar — Setup & Reference

## Current status (as of 2026-09-16)

Built, deployed, and through three real rounds of bug fixes from actual live testing — not just written and assumed to work. If you're picking this up in a new chat: everything below is current, and the file versions in this same output batch are the ones to use, not any earlier version from elsewhere in this project.

| Area | Status |
|---|---|
| Wizard, map, click-to-place pin | ✅ Working |
| Overpass competitor search | ✅ Working — 3-mirror fallback, Geoapify backstop, 10s timeout per attempt |
| Isochrone catchment (real travel-time shape) | ✅ Working, confirmed live; falls back to a plain circle if OpenRouteService fails |
| District population & household income (DOSM) | ✅ Fixed — three separate bugs resolved (wrong row, wrong unit, wrong query syntax), worth one more live confirmation |
| Opportunity score, editable weights, diversity index | ✅ Working |
| Gemini plain-English read | ✅ Working, confirmed live |
| "Still working" progress messaging on slow analyses | ✅ Added this round |
| Nav entries on the other 10 pages | ⏸ Not done — per this project's own `AI_BUILD_BRIEF.md`, that's a central reconciliation pass, not a single-tool job |
| `cost-structure-checker` / `qr-code-creator` in the nav standard | ⏸ Blocked — their files/filenames/labels haven't been shared yet |
| AppSheet field-survey layer | ⏸ Not started — schema specified below, waiting on the actual Sheet existing |
| Sync handoff into Interactive Costing Analysis / Margin Analysis | ⏸ Not started — `market-radar.js` already broadcasts, the receiving side doesn't listen yet |

**Immediate next step:** redeploy `market-radar-proxy-worker.js` (this version) over whatever's currently live, and re-test — the DOSM and timeout fixes haven't had a live confirmation yet.

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
| Timeout per external call (each Overpass mirror, Geoapify, ORS, Gemini) | 10 seconds | `EXTERNAL_CALL_TIMEOUT_MS`, `market-radar-proxy-worker.js` |
| How often the "still working" status message updates during a slow analysis | Every 7 seconds | `PROGRESS_MESSAGES` / `startProgressMessages()`, `market-radar.js` |
| Geoapify category mapping (Overpass-fallback only) | 11 categories, see `GEOAPIFY_CATEGORY_MAP` | `GEOAPIFY_CATEGORY_MAP`, `market-radar-proxy-worker.js` — not confirmed live, see the Overpass note above |
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
- **Handoff into the rest of the tool suite** — `market-radar.js` already calls `rzBroadcast({ source: 'market-radar', ... })` if `costing-sync.js` is loaded, but Interactive Costing Analysis and Margin Analysis's own `handleSyncPayload` functions don't recognise that source yet. That's a small, contained edit to those two existing files — see "Nav & sync reconciliation" below.

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
| Opportunity score | This tool's own summary number, 0–100: a plain weighted blend of low competition, population, income, and category diversity. Fully visible, fully editable — never a black box. |
| Diversity index | How mixed the businesses near your pin are, not just how many of your own category exist. Built from the same idea as the Herfindahl-Hirschman Index economists use for market concentration, inverted so higher = more mixed. |
| Provenance tag | The small "Official / Estimated / Calculated" label under every stat, so a government population figure never reads with the same confidence as a crowd-sourced OpenStreetMap count. |
| DOSM | Department of Statistics Malaysia — the government body behind the population and household-income datasets this tool uses, both published freely via data.gov.my. |
| HIES | Household Income and Expenditure Survey — the actual survey DOSM's income-by-district numbers come from, most recently run in 2022. |
| Worker | The Cloudflare Worker (`market-radar-proxy-worker.js`) — holds the OpenRouteService and Gemini keys server-side and caches every external call so this tool doesn't quietly exhaust a shared free-tier allowance. |
