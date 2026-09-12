# Market Radar — Setup & Reference

Three files, one job each, same split as every other tool on this site:

| File | Runs where | What it does |
|---|---|---|
| `market-radar.html` | Visitor's browser | The page itself — wizard, map, results |
| `market-radar.js` | Visitor's browser | All page logic: geometry, opportunity score, rendering |
| `market-radar-proxy-worker.js` | Cloudflare (your account) | The only thing allowed to hold the OpenRouteService and Gemini keys |

Drop the first two into the same folder as every other page on the site. The Worker deploys separately, to Cloudflare — see below.

## What works with zero setup

Business density (OpenStreetMap/Overpass) and district demographics (data.gov.my) need no API key at all — once the Worker is deployed with just `ALLOWED_ORIGINS` updated, those two layers work immediately. Only two things are optional and degrade gracefully without a key:

- **No `ORS_API_KEY`** → every catchment falls back to a plain dashed-circle radius instead of a real walk/drive-time shape. Everything else keeps working.
- **No `GEMINI_API_KEY`** → the "Get a plain-English read" button returns an error message. Every number on the page is unaffected either way, since Gemini only narrates, never calculates.

## Deploying the Worker

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com) if you don't have one — you likely already do, from your other Workers.
2. **Workers & Pages → Create → Create Worker**. Name it (e.g. `market-radar-proxy`), deploy the default template, then **Edit code** and replace everything with `market-radar-proxy-worker.js`'s contents. Deploy.
3. **Settings → Variables and Secrets → Add**, as **Secret**:
   - `GEMINI_API_KEY` — the same key your other tools already use
   - `ORS_API_KEY` — see below
4. Copy the Worker's `*.workers.dev` URL and paste it into `WORKER_ENDPOINT` near the top of `market-radar.js`.

### Getting a free OpenRouteService key

1. Sign up at [openrouteservice.org/dev-dashboard](https://openrouteservice.org/dev-dashboard) — free, no card.
2. Create a token under the standard plan. This gives isochrone access at 500 requests/day and 20/minute — since this is only called once per "Analyze" click (not per visitor, per click), that's generous for personal use, and the Worker caches every isochrone for 30 days on top of that.
3. Paste the token as `ORS_API_KEY` above.

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
| Isochrone cache duration | 30 days | `fetchIsochrone`, `market-radar-proxy-worker.js` |
| Demographics cache duration | 7 days | `fetchDemographics`, `market-radar-proxy-worker.js` |
| Websites allowed to call the Worker (CORS) | `reysourcez.com`, `www.reysourcez.com` | `ALLOWED_ORIGINS`, `market-radar-proxy-worker.js` |
| Gemini model used for narration | `gemini-flash-lite-latest` | `GEMINI_MODEL`, `market-radar-proxy-worker.js` |

## What's built vs. what's KIV

**Built:** wizard (town + catchment mode), click-to-place pin, live Overpass competitor search by category, real isochrone catchment with radius fallback, district population + income from data.gov.my, a fully editable opportunity score, category-diversity index, Gemini plain-English narration, soft daily usage cap, Save as PDF, provenance tags on every stat.

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
| Overpass API | OpenStreetMap's free query engine for "find me every X within this area." No key, no cost, crowd-sourced data — meaning coverage is good in busy areas and patchier in quiet ones. |
| OSM tag | The key=value label OpenStreetMap uses to describe a place, e.g. `amenity=cafe`. Tagging is done by volunteers and is genuinely inconsistent, which is why competitor counts here are a signal, not a census. |
| Opportunity score | This tool's own summary number, 0–100: a plain weighted blend of low competition, population, income, and category diversity. Fully visible, fully editable — never a black box. |
| Diversity index | How mixed the businesses near your pin are, not just how many of your own category exist. Built from the same idea as the Herfindahl-Hirschman Index economists use for market concentration, inverted so higher = more mixed. |
| Provenance tag | The small "Official / Estimated / Calculated" label under every stat, so a government population figure never reads with the same confidence as a crowd-sourced OpenStreetMap count. |
| DOSM | Department of Statistics Malaysia — the government body behind the population and household-income datasets this tool uses, both published freely via data.gov.my. |
| HIES | Household Income and Expenditure Survey — the actual survey DOSM's income-by-district numbers come from, most recently run in 2022. |
| Worker | The Cloudflare Worker (`market-radar-proxy-worker.js`) — holds the OpenRouteService and Gemini keys server-side and caches every external call so this tool doesn't quietly exhaust a shared free-tier allowance. |
