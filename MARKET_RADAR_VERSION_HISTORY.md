# Market Radar — Version History

**Current package version: v1.4.0 (2026-09-20).**

## How versions work here

- One **package version** covers all Market Radar files together (`market-radar.html`, `market-radar.js`, `market-radar-proxy-worker.js`, the settings workbook, the docs, the tests). The Worker sends its version with every answer (`WORKER_VERSION`) and the page prints it; the browser script logs its own (`CLIENT_VERSION`, press F12). They should always match.
- **MAJOR** (2.0.0) = the architecture changes. **MINOR** (1.5.0) = a new feature or a batch of notable fixes. **PATCH** (1.4.1) = a small fix.
- Whenever any file changes: bump the number in `WORKER_VERSION` and `CLIENT_VERSION`, bump `?v=` on the script tag in `market-radar.html`, add an entry here, and re-run both test scripts (see the setup doc, "Re-running the checks").
- **Versioning began on 2026-09-20.** Entries for v1.0.0–v1.3.0 are **backfilled** from the dated notes already inside the code and the setup doc. The version labels are retroactive and the dates are the ones those notes carry; the project had no release log before this file, and the original build date is not recorded anywhere in the project files.

---

## v1.4.0 — 2026-09-20 — the Geoapify backstop can't be bypassed, and can be seen

**Why:** "still no Geoapify backstop?" Checking the real code and running it against mocked network answers showed the backstop *was* present and worked when every Overpass mirror failed hard — but it could be bypassed, nothing showed whether it had run, and the settings spreadsheet told people to name its secret wrongly.

**Worker (`market-radar-proxy-worker.js`)**
- Overpass "soft failures" (HTTP 200 + a `remark` reporting a timeout / out-of-memory) now count as a failed mirror: skipped, never cached, and they no longer skip the Geoapify backstop. Before: they were treated as a good empty answer, bypassed the backstop and cached "0 competitors" for 24 hours.
- Response now includes `poisSource`, `poisCached`, `poisTruncated`, `workerVersion`.
- Error message lists what *every* mirror returned (it kept only the last), names the exact secret to create if the key is missing, and gives plain-English hints for Geoapify 401 / 429 / 400.
- Geoapify places with no usable coordinates are dropped (a non-Point geometry could make the map throw).
- Geoapify results are requested nearest-first (`bias=proximity`) and flagged when the 500-place cap is hit.
- The Geoapify key is scrubbed from error text (a test proved a URL-echoing network error would have leaked it onto the public page).
- New optional switch `FORCE_OVERPASS_FAIL` (Worker variable, Text or JSON `1`) to fire-drill the backstop end to end. Off by default.
- New constants `WORKER_VERSION` and `GEOAPIFY_RESULT_LIMIT` (500, unchanged behaviour). `GEOAPIFY_CATEGORY_MAP` re-verified against Geoapify's published spec — no change needed.

**Page (`market-radar.js`, `market-radar.html`)**
- Under *Competitors in catchment* the page now says where the list came from ("OSM via Overpass (mirror)" / "OSM via Geoapify backstop"), whether it was cached, and which Worker version answered ("Worker version unknown — older than v1.4.0, redeploy it" if the old Worker is still live).
- Backstop answers get a status-line notice, plus an undercount warning when truncated.
- *Nearby institutions* says "Not checked" (not "None found") when Overpass was unavailable or the backstop answered.
- HTML script tag bumped to `market-radar.js?v=2`.

**Settings workbook (`market-radar-settings-reference.xlsx`)**
- **Corrected row 5:** it named `GOOGLE_PLACES_API_KEY` for the Geoapify key; the Worker reads `GEOAPIFY_API_KEY`. (Following the old sheet leaves the backstop unconfigured and sends the Geoapify key to Google's servers.) A dated correction note is on the "How to use this" tab.
- New section at the bottom: *Geoapify Backstop & Diagnostics* (result limit, fire-drill switch, soft-failure handling, versions, and the free-plan licence caution).

**Docs / tests**
- `MARKET_RADAR_SETUP_AND_GLOSSARY.md`: new 2026-09-20 section (what was true, fire drill, what was **not** verified, flow chart, how to re-run checks); corrected the Geoapify credit claim, closed the "category map unconfirmed" item, noted the 2026-09-17 claim about per-mirror errors was inaccurate; new settings rows and jargon entries.
- New `tests/` folder: `test-worker.mjs` (40 checks) and `test-client.js` (9 scenarios). They run the real code against pretend responses — no internet, no keys.
- This file.

### Upgrading from v1.3.0

1. **Cloudflare → Workers & Pages → your `market-radar-proxy` Worker → Settings → Variables and Secrets.** Confirm a **Secret** named exactly `GEOAPIFY_API_KEY` exists. If you instead created one called `GOOGLE_PLACES_API_KEY` from the old spreadsheet, delete it, add the correctly-named secret, and rotate the Geoapify key at myprojects.geoapify.com. (If you have a real Google Places key, `GOOGLE_PLACES_API_KEY` should hold *that* — and nothing else.)
2. **Edit code** → replace everything with the new `market-radar-proxy-worker.js` → **Deploy**.
3. Upload the new `market-radar.js` and `market-radar.html` to the site (same folder as before; GitHub Pages).
4. Hard-refresh the page (Ctrl/Cmd + Shift + R). Run one analysis: under *Competitors in catchment* you should see "Worker v1.4.0".
5. **Fire drill:** add Variable `FORCE_OVERPASS_FAIL` = `1`, run an analysis, expect "via Geoapify backstop", then **delete the variable**.
6. Run the same analysis twice: the second should say "cached up to 24h". If it never does, see the caching caveat in the setup doc.

### KIV — carried forward and new

*Reliability*
- **Live verification of the backstop with a real key** — the fire drill above. Not possible in the build environment.
- **Cloudflare Cache API on `*.workers.dev`** — Cloudflare's docs contradict each other; the "cached up to 24h" label is now the test. If caching doesn't work, attach the Worker to a custom domain/route.
- **Trim the Overpass query** (first raised 2026-09-16): a 10–15 minute *drive* catchment sends Overpass every category plus every institution type across a radius of up to ~10 km. *Inference, not tested:* that is the likeliest trigger for timeouts and soft failures. Split into a small "selected category only" query plus a best-effort "everything else" query.
- **Geoapify key in a header instead of the URL** — Geoapify's spec supports `x-api-key`. Not changed untested; the key is now scrubbed from messages in the meantime.
- **Geoapify backstop limits:** no institutions (anchors) and no "printing" category; results capped at 500 across all categories.

*Business / compliance*
- **Geoapify free plan is listed as "Limited Commercial Use"** (paid plans: "Commercial Use"; first paid tier listed 2026-09-20: 10,000 credits/day for USD 59/month). Read their terms before charging customers for anything that depends on the backstop.
- **Geoapify Places credit rule (~1 credit per 20 places) is inferred**, not read from their pricing section.

*Carried forward, unchanged*
- Nav entries for `market-radar.html` on the other pages — central reconciliation pass per `AI_BUILD_BRIEF.md`.
- Sync handoff into Interactive Costing Analysis / Margin Analysis (`market-radar.js` already broadcasts; receivers don't listen yet).
- AppSheet field-survey layer (schema in the setup doc).
- Momentum sub-score is a neutral placeholder until repeat-visit snapshot history exists.
- Further DOSM datasets worth wiring in: `hies_district`, `hh_poverty_district`, `lfs_district`, `crime_district`.

---

## v1.3.0 — 2026-09-18 *(backfilled)*

- MSIC 2008 codes on every category (reference metadata shown in the UI; no effect on the Overpass query).
- National retail trend card from DOSM's `iowrt_3d` CSV (Malaysia-wide; covers minimart, bakery, hardware and fashion only).
- Nearby-institution anchors (schools, universities, hospitals/clinics, malls, government offices, places of worship, transport terminals): blue map squares and a count card. Informational only — never counted as competitors, never in the score.
- Heat map recalibrated (`max: 3`, teal → amber → red, caption added).
- QR Listing Creator dropped from this project's scope.

## v1.2.0 — 2026-09-17 *(backfilled)*

- Descriptive `User-Agent` header on Overpass calls.
- data.gov.my queries use `sort=-date&limit=1` instead of downloading rows to sort client-side.
- `market-radar-settings-reference.xlsx` created.
- Density heat-map show/hide toggle; vacant-unit notepad (no live vacancy source exists in Malaysia).
- Comparison against a broken user-supplied Worker draft recorded in the setup doc (Geoapify geocoding endpoint + a second `?` in the URL).

## v1.1.0 — 2026-09-16 *(backfilled)*

- Bubble-tea / cuisine-tagged categories fixed (`cuisine=*` checked before generic tags, plus `NAME_HINTS` brand-name fallback).
- Geoapify backstop actually implemented in the Worker (earlier docs had described it as done when the code lacked it); every external call gets a 10-second timeout; on-page "still working" progress messages.
- DOSM population figure fixed (district total row, values in thousands, single `ifilter` parameter).
- Competitor strength: optional Google Places ratings or a manual on-site busyness read, as a sixth score weight (off by default).

## v1.0.0 — 2026-09-13 *(backfilled; earliest dated note)*

- First live build: town/catchment wizard, click-to-place pin, Overpass competitor search, OpenRouteService isochrone with radius fallback, data.gov.my district population and income, editable opportunity score, diversity index, Gemini plain-English read, soft daily cap, Save as PDF, provenance tags.
- Day-one fixes: Overpass `406` from `overpass-api.de` → three-mirror fallback plus `Accept` header; an Overpass failure now returns an honest error instead of discarding the isochrone and demographics; OpenRouteService moved to `api.heigit.org`.
