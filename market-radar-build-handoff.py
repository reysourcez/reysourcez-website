#!/usr/bin/env python3
# Market Radar - handoff dossier generator v1.7.0
"""
Writes MARKET_RADAR_HANDOFF.md. The narrative is hand-written below; every index, constant, table and test list is
EXTRACTED from the shipped files, so the dossier cannot claim something the code does not contain.
Run from anywhere:  python tools/market-radar-build-handoff.py      (set MR_DATE=YYYY-MM-DD to stamp a date)
"""
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATE = os.environ.get('MR_DATE') or time.strftime('%Y-%m-%d')
OUT = os.path.join(ROOT, 'MARKET_RADAR_HANDOFF.md')


def read(rel):
    with open(os.path.join(ROOT, rel), 'r', encoding='utf-8') as fh:
        return fh.read()


def grab(src, pat, what, flags=0):
    m = re.search(pat, src, flags)
    if not m:
        raise SystemExit('Could not find %s in the code - the code changed shape; update this generator.' % what)
    return m


page, worker, html, eng_src = read('market-radar.js'), read('market-radar-proxy-worker.js'), read('market-radar.html'), read('market-radar-engine.js')

node = subprocess.run(['node', '-e', (
    "const E=require(process.argv[1]);console.log(JSON.stringify({v:E.VERSION,api:Object.keys(E),cats:E.CATEGORIES.length,groups:Object.keys(E.GROUPS).length-1,"
    "anchors:E.ANCHORS.length,pairs:E.AFFINITY_PAIRS.length,niches:E.NICHES.length,arch:E.ARCH_PRIORITY,"
    "iowrt:E.CATEGORIES.filter(c=>c.iowrt).map(c=>c.key+'→'+c.iowrt),noFounder:E.CATEGORIES.filter(c=>!c.founder).map(c=>c.key),"
    "T:E.T,opp:E.OPP_WEIGHTS,comp:E.COMP_WEIGHTS}))"), os.path.join(ROOT, 'market-radar-engine.js')], capture_output=True, text=True)
if node.returncode != 0:
    raise SystemExit('node could not load the engine: ' + node.stderr)
E = json.loads(node.stdout)

V_PAGE = grab(page, r"const VERSION = '([\d.]+)'", 'page version').group(1)
V_WORK = grab(worker, r"const WORKER_VERSION = '([\d.]+)'", 'worker version').group(1)
V_ENG = E['v']
if len({V_PAGE, V_WORK, V_ENG}) != 1:
    raise SystemExit('Version mismatch: page %s, engine %s, worker %s. All files must carry one version.' % (V_PAGE, V_ENG, V_WORK))
VER = V_PAGE

# ---- generated blocks
client_fn = re.findall(r'^  (?:async )?function (\w+)\(', page, re.M)
client_fn_lines = [(m.group(1), page[:m.start()].count('\n') + 1) for m in re.finditer(r'^  (?:async )?function (\w+)\(', page, re.M)]
worker_fn = [(m.group(2), worker[:m.start()].count('\n') + 1) for m in re.finditer(r'^(async )?function (\w+)\(', worker, re.M)]
state = grab(page, r'  const S = \{.*?\n  \};', 'state object S', re.S).group(0)
acts = sorted(set(re.findall(r'data-act=\\?"([A-Za-z0-9_-]+)', page)))
env_names = sorted(set(re.findall(r'env\.([A-Z][A-Z_]+)', worker)))
direct = re.findall(r"'(https://[^']+)'", grab(page, r'const DIRECT_MIRRORS = \[(.*?)\];', 'DIRECT_MIRRORS', re.S).group(1))
mirrors = re.findall(r"'(https://[^']+)'", grab(worker, r'const OVERPASS_MIRRORS = \[(.*?)\];', 'OVERPASS_MIRRORS', re.S).group(1))
caps = {n: grab(worker, r'const %s = ([\d.]+)' % n, n).group(1) for n in ('MAX_TAG_PAIRS', 'MAX_SPAN_DEG', 'EXTERNAL_CALL_TIMEOUT_MS')}
lim = grab(page, r"const MAX_PER_DAY = (\d+), USAGE_KEY = '([^']+)', MAX_TICKED = (\d+), MAX_CUSTOM = (\d+);", 'page limits')
ovt_path = grab(page, r"const OVT_PATH = '([^']+)';", 'OVT_PATH').group(1)
pop = re.findall(r'(\w+): (\d+),', grab(worker, r'const DISTRICT_POPULATION_FALLBACK_2023 = \{(.*?)\};', 'population fallback', re.S).group(1))
gemini = grab(worker, r"const GEMINI_MODEL = '([^']+)'", 'GEMINI_MODEL').group(1)
wai = grab(worker, r"const WORKERS_AI_MODEL = '([^']+)'", 'WORKERS_AI_MODEL').group(1)
scripts = re.findall(r'<script src="([^"]+)"', html)
sheets = re.findall(r'<link rel="stylesheet" href="([^"]+)"', html)


def js_tests(rel):
    src = read(rel)
    out = []
    for m in re.finditer(r"^(?:await )?t\('((?:[^'\\]|\\.)*)'", src, re.M):
        out.append(m.group(1).replace("\\'", "'").replace('\\"', '"'))
    return out


def py_tests(rel):
    return re.findall(r'^    def (test_\w+)\(', read(rel), re.M)


suites = [('engine.test.cjs', 'Engine unit tests (pure logic, no network)', js_tests('tests/engine.test.cjs')),
          ('worker.test.mjs', 'Worker tests (the real Worker code, mocked upstreams and cache)', js_tests('tests/worker.test.mjs')),
          ('overture-builder.test.py', 'Overture builder + engine contract (Python unittest)', py_tests('tests/overture-builder.test.py')),
          ('e2e.mjs', 'Real Chromium end-to-end (real page + client + engine + Worker code; Leaflet stubbed; network mocked)', js_tests('tests/e2e.mjs'))]
tests_md = []
for f, desc, names in suites:
    tests_md.append('**tests/%s** - %s - **%d tests**\n\n%s\n' % (f, desc, len(names), '\n'.join('%d. %s' % (i + 1, n) for i, n in enumerate(names))))
n_tests = sum(len(s[2]) for s in suites)

T_ROWS = '\n'.join('| `T.%s` | %s |' % (k, v) for k, v in E['T'].items())
fn_md = ', '.join('%s (L%d)' % x for x in client_fn_lines)
wfn_md = ', '.join('%s (L%d)' % x for x in worker_fn)
pop_md = ' · '.join('%s %s' % (k.title(), format(int(v), ',')) for k, v in pop)

TEMPLATE = r'''<!-- Market Radar - AI Continuity Dossier - v@@VER@@ (@@DATE@@). Indexes, constants and test lists are EXTRACTED from the shipped files by tools/market-radar-build-handoff.py; the narrative is hand-written. -->
# Market Radar - AI Continuity Dossier (v@@VER@@, @@DATE@@)

**Audience:** a brand-new AI session that must continue this project with no chat history.
**Read order:** this file -> `MARKET_RADAR_SETUP_AND_GLOSSARY.md` (deploy, verification, jargon) -> `market-radar-settings-reference.xlsx` (every tunable value, generated from the code) -> the four code files -> `MARKET_RADAR_HISTORY.md` only if you need the story up to v1.6.2.

**Standing rules (learned the hard way - six incidents now):**
1. Documentation in this project has repeatedly claimed fixes that were not in the shipped code, and "confirmed" fixes built on unverified guesses (the DOSM population saga; the v1.6.1 mode-leeching fix). Before repeating any "fixed / confirmed" statement, check the shipped file, and prefer a live test over a document. Section 12 says what has and has not been tested live.
2. **Never keep the only copy of work in /home/claude or /tmp.** The build sandbox was wiped mid-session while producing v1.7.0; the five source files were recovered by replaying the original create/patch tool calls from the conversation transcript (Section 15). Work in `/mnt/user-data/outputs/`, keep `_MANIFEST.md`, and checkpoint after every milestone.
3. One version number for every CURRENT file (page, engine, Worker, tools, docs); the only exceptions are the archive (`MARKET_RADAR_HISTORY.md`, `archive-v1.6.2/`) and they are labelled as such. Old copies must carry their version in the file NAME (`...-v1.6.2.*`) so they can never be mistaken for current ones in a download list. `tools/*-build-*.py` refuse to run if the versions disagree.
4. **Delivery rule (owner requirement):** the final reply of every build round presents the COMPLETE current file set plus ONE ZIP with folders kept (`tools/package` builds it) and a `START_HERE.md`. The owner downloads files individually without folder structure and cannot easily tell snapshots apart in the Artifacts panel.
5. Free / official / open data only. Never scrape. Every number on screen carries its provenance; anything that is a judgement says "assumption".

---

## 1. What v@@VER@@ changed, and why (root causes, not symptoms)

| Reported symptom | Root cause (how known) | Fix in v@@VER@@ | Proof |
|---|---|---|---|
| Results of one mode "leech" into the other after switching, even after two fix attempts | Author CSS such as `display:grid/flex` on a class both result panels share beats the HTML `hidden` attribute (confirmed in headless Chromium). The site-wide `styles.css` that may contain such a rule is **not in this project**, so the exact rule is unverified - but every report is consistent with it | The page **never uses `hidden`** for results. One container (`#mr-results`) is re-rendered from state on every change; the only hide mechanism is `.mr-hide{display:none!important}`. Mode switch re-renders from the same analysis object (no refetch) | e2e "switching modes re-renders from the same data... even with hostile site CSS" |
| "0 found" / petrol / pharmacy missing although visible on the map | (a) Overpass answers HTTP 200 with a `remark` ("Query timed out", out of memory) and empty/partial `elements`; the old Worker never read `remark`, treated it as success and **cached it for 24 h** (OSM-side issue documented upstream). Cloudflare Worker addresses are also blocked by overpass-api.de in the wild. (b) Pharmacies are tagged `amenity=pharmacy` **or** `healthcare=pharmacy` **or** `shop=chemist` (drugstore chains). (c) A fuel-station node often also carries `shop=convenience`; the old classifier kept only the first match. (d) The old query box was a 1.3x radius, which can miss an elongated drive-time shape | (a) Browser-direct Overpass first (visitor's own connection), Worker passthrough second, Geoapify third; `remark` is checked on both paths; failures are never cached. (b) 3 tags. (c) A place can belong to several types. (d) The query box is the **real catchment's own bounding box + 120 m** (the Geoapify fallback still uses radius x1.3). Plus a hollow-grey "outside this area" layer (opt-in) so a person can see places that were found but excluded by geometry | Worker: "remark timeout is a FAILURE... not cached"; e2e: browser-route-blocked, remark-timeout, multi-category fuel station + outside-area chemist |
| Analysis too shallow (one score for one idea) | Design | Two modes on one dataset: **Market Analysis** (ranked opportunities: first-mover, under-supplied, complementary, niche, emerging, proven, possible-gap-verify, crowded - each with its evidence; plus Idea check, Area snapshot, Businesses) and **Market Gap** (what would best complete the area; core-need checklist) | engine ranking tests; e2e views |
| No idea how complete the map data is | OSM is crowd-sourced | Optional **Overture** cross-check (independent source). Completeness estimated by capture-recapture (Lincoln-Petersen) when enough places match; otherwise a sparsity measure. A zero-count is only called a "First-mover" gap when data confidence >= `T.PIONEER_MIN_CONF`, else "Possible gap - verify" | engine tests; e2e Overture merge |
| On-site read left over from another spot / not given back when cleared | v1.7.0's first client had no restore logic (v1.5.2 had) | `releaseOnSite()`; hand edit of a weight ends the automation | e2e "on-site read: picking moves 10%..." (verified to FAIL on the previous client) |
| Paid, dormant Google Places path; unused `costing-sync.js` console line | Dead code | Removed (Worker no longer reads `GOOGLE_PLACES_API_KEY`; the page no longer loads `costing-sync.js` and no longer calls `rzBroadcast`) | grep |

## 2. System map

```
Browser  https://reysourcez.com/market-radar.html                      (GitHub Pages, no build step)
 |- market-radar.html          markup + page CSS; ONE results container; .mr-hide is the only hide mechanism
 |- market-radar-engine.js     ALL scoring + classification (pure, UMD: same file runs in the page and in Node tests)
 |- market-radar.js            state S, network, Leaflet map, rendering, exports; NO scoring logic
 |- market-radar-data/overture-<town>.json     OPTIONAL second source (built on the owner's PC by tools/market-radar-build-overture.py)
 |- Leaflet 1.9.4 + leaflet.heat 0.2.0 (CDN, pinned); site files not owned here: @@SITEFILES@@
 |
 |  per analysis (in parallel):
 |   1. POST Worker {mode:'context'}   -> real walk/drive shape (ORS) + DOSM district figures + DOSM retail trend
 |   2. POST Overpass DIRECT (browser) -> businesses + anchors; on any failure/remark: POST Worker {mode:'pois'} (passthrough)
 |   3. GET  market-radar-data/overture-<town>.json (cached in memory per town; absent => OSM only, and the page says so)
 |   4. engine.analyze(): classify -> merge OSM+Overture -> completeness -> per-type metrics -> archetypes -> rankings
 |   5. optional: POST Worker {mode:'insight'} -> plain-English read (Gemini -> Workers AI)
 v
Cloudflare Worker "market-radar-proxy"  https://market-radar-proxy.reysourcez-ent.workers.dev/
 |- mode=context : ORS isochrone | DOSM income (data-catalogue) + population (both endpoints broken -> pinned 2023) | DOSM iowrt CSV (trend)
 |- mode=pois    : Overpass mirrors in order (bytes passed through, never JSON.parse'd) -> Geoapify backstop
 |- mode=insight : Gemini -> Workers AI backstop; the model only NARRATES numbers already on screen
```

Design invariants: browser calls Overpass/Nominatim/Overture-file itself (own IP, no CPU limit); the Worker is a fallback and the only holder of secrets; every number that matters is computed by deterministic engine code, never by an AI.

## 3. Files, versions, hosting

| File | Version | Lives at | Deployed by |
|---|---|---|---|
| `market-radar.html` | @@VER@@ | GitHub Pages, site root | upload |
| `market-radar.js` | @@VER@@ | same | upload (cache-buster `?v=` on the script tags: change on every release) |
| `market-radar-engine.js` | @@VER@@ | same | upload **together with** market-radar.js |
| `market-radar-proxy-worker.js` | @@VER@@ | Cloudflare Worker "market-radar-proxy" | paste into Edit code, Deploy |
| `market-radar-data/overture-{miri,kuching,sibu,bintulu}.json` | built | GitHub Pages, folder `market-radar-data/` | upload after running the builder |
| `tools/market-radar-build-overture.py` | @@VER@@ | owner's PC | `python -m pip install overturemaps` then `python market-radar-build-overture.py --town all` |
| `tools/market-radar-build-settings.py`, `tools/market-radar-build-handoff.py` | @@VER@@ | any machine | regenerate the workbook / this dossier from the code |
| `tests/` | @@VER@@ | project folder | `sh tests/run-all.sh` |
| `market-radar-settings-reference.xlsx`, `MARKET_RADAR_HANDOFF.md`, `MARKET_RADAR_SETUP_AND_GLOSSARY.md`, `START_HERE.md`, `_MANIFEST.md` | @@VER@@ | project folder | n/a |
| `tools/market-radar-build-package.py` | @@VER@@ | any machine | writes `_MANIFEST.md` (file hashes) and the ZIP below |
| `market-radar-v@@VER@@-ALL-FILES.zip` | @@VER@@ | the download | **the one-stop package: every file above with folders kept** |
| `MARKET_RADAR_HISTORY.md` | *archive: content ends at v1.6.2* | project folder | n/a - an archive, not out of date |
| `archive-v1.6.2/` (files named `...-v1.6.2.*`) | *v1.6.2 (old)* | project folder | rollback only - needs the old v1.6.0 Worker too |

Stable file names are deliberate (other pages link to `market-radar.html`); the version lives inside each file, on the page ("Market Radar v@@VER@@") and in the Area snapshot tab ("Worker v...").
Files the page loads that this project does **not** own: @@SITEFILES@@. Nav is populated by `nav-config.js` (see NAV_RETROFIT_HOWTO.md); never hand-edit the dropdown.

### Cloudflare configuration (names must match EXACTLY - a misspelt name is silently ignored)
Names the Worker code reads: **@@ENVS@@**. `GEMINI_API_KEY` (secret, narration), `ORS_API_KEY` (secret, real catchment shape), `GEOAPIFY_API_KEY` (secret, last-resort POI backstop), `AI` (Workers AI binding, narration backstop). No new secrets in v@@VER@@; `GOOGLE_PLACES_API_KEY` is no longer used and may be deleted. Origins allowed (CORS): `reysourcez.com`, `www.reysourcez.com`.

## 4. One analysis, step by step (client `analyze()`)
1. Pin + area (`CATCHMENTS`: walk5/10/15, drive5/10/15) + business types. Daily soft cap @@MAXDAY@@ per browser (localStorage `@@USAGEKEY@@`). Market Gap always checks the whole registry; Idea check ticks at most @@MAXTICKED@@ types; up to @@MAXCUSTOM@@ custom OSM types (validated `^[A-Za-z0-9_:\-]{1,40}$`).
2. In parallel: Worker `context` (isochrone + demographics + trend) and, once the shape is known, Overpass for the shape's bbox + 120 m (all registry tags + anchor tags in **one** query; timeout 30 s walk / 45 s drive). Browser-direct mirrors: @@DIRECT@@. On network error, non-OK status, unreadable body **or a `remark` about a timeout/out-of-memory** -> next route; after the last, Worker `pois` (mirrors: @@MIRRORS@@; then Geoapify). If everything fails the page shows the trail, re-enables the button and renders nothing half-finished.
3. Overture file for the town (if present): rows classified by `classifyOverture` (confidence < `T.OVT_MIN_CONF` ignored; unmapped categories are counted and listed in Area snapshot).
4. `buildData()` filters to the catchment polygon (ray casting; circle fallback if no ORS shape), merges OSM + Overture (`mergePois`), keeps an "outside" list for the diagnostic layer, then `E.analyze()` produces `S.an`.
5. `renderAll()` -> `renderResults()` draws only what the current `S.mode`/`S.tab` needs from `S`. Pin move / area change / custom type change only set `S.stale` (banner: press Analyze); a **town change** calls `resetResults()` (also forgets the on-site read).

## 5. Worker contract (v@@VER@@)
All requests: `POST /` JSON. Router: `mode` in `context | pois | insight`; any other mode returns 400 `{error}` telling the person to hard-refresh the page (Ctrl+F5) so the browser loads the matching market-radar.js. Non-POST -> 405; OPTIONS answered with CORS incl. `Access-Control-Expose-Headers: X-MR-Source, X-MR-Cache`.

* **`{mode:'context', lat, lng, district, isochrone:{profile:'foot-walking'|'driving-car', seconds:60..3600}, iowrtGroups:['471',...]}`** -> `{isochrone: GeoJSON|null, demographics:{population, medianIncome, notes[]}, trends:{<group>:{growthYoy, asOf, ...}}, meta:{workerVersion}}`. Never throws for one failed source: missing figure = 0 + a note giving the real reason. Pinned population is returned with an explanatory note (Official - DOSM, not live).
* **`{mode:'pois', bbox:[s,w,n,e], osmTags:[[k,v],...], timeoutS?:10..60, geoapify?:{lat,lng,radiusM,categories}}`** -> success: the raw Overpass JSON **bytes** + headers `X-MR-Source` (`Overpass (host)`), `X-MR-Cache` (`hit|miss`); only answers that pass the `remark` check are cached (24 h). Geoapify backstop: JSON `{mr_source:'Geoapify (Overpass fallback)', features, trail}`. Total failure: 502 `{error:'Every Overpass mirror failed (<per-mirror trail>). <Geoapify note>'}`; invalid input: 400 `{error}`. Validation: `bbox` <= @@MAXSPAN@@ degrees wide, <= @@MAXPAIRS@@ tag pairs, tag tokens `^[A-Za-z0-9_:\-]{1,40}$`. The query text is built by the **same function as the engine** (`buildOverpassQuery`); a test asserts byte-identical output.
* **`{mode:'insight', snapshot}`** -> `{text, via:'Gemini'|'Workers AI'}` or 500 `{error}` (readable). Every snapshot carries `town, catchment, areaKm2, confidence, confidenceNote, districtPopulation, districtIncome, catchmentIsReal` plus a `kind`: `'opportunity'` -> `top:[{label, archetype, score, evidence[]}]` (5 rows); `'complement'` (Market Gap) -> `top:[...same, evidence starts with 'Benefits n x ...']` and `gaps:[core-need types with none found]`; `'idea'` -> `category, competitorCount, breakdown:[{label,count}], opportunityScore, observedBusyness`. Hard rules in the system prompt: never state revenue/profit, never say "open / don't open here", never invent a number; all client text is clipped and newline-stripped before it enters a prompt (injection test).
* Timeouts: @@EXTMS@@ ms per outside call. Caches (Cache API; **not guaranteed on `*.workers.dev`**, nothing depends on it): Overpass 24 h, isochrone 30 d, demographics 7 d (successes only), DOSM trend 30 d.
* Pinned population fallback (DOSM 2023 estimates, used because both live DOSM endpoints were confirmed broken on 2026-09-22; refresh yearly): @@POP@@. Models: Gemini `@@GEMINI@@`, Workers AI `@@WAI@@`.
* Worker functions: @@WFN@@.

## 6. Engine reference (`market-radar-engine.js`, UMD, no DOM, no network)
Registry: **@@NCATS@@ business types in @@NGROUPS@@ groups**, @@NANCH@@ anchor types, @@NPAIRS@@ "goes with" pairs, @@NNICHES@@ cuisine niches (all listed in the workbook). Judgement fields per type: `crowded` (places/km2 at which the type is treated as crowded), `needTier` (core 1 / important .7 / supporting .45 / discretionary .2), `capital` (low 1 / medium .95 / high .85). Founder-ineligible types (left out of Best opportunities): @@NOFOUNDER@@. DOSM wholesale/retail trend groups mapped: @@IOWRT@@ (nothing else is verified against the CSV - do not add pharmacy/petrol without checking the file).

**Per category (inside one catchment)** - `density = count / area (>= 0.01 km2)`; `sat = density / crowded`; `white = 1 - min(sat,1)`; `demand = noisyOR_a( pull[a][cat] * (1 - exp(-anchors_a * size_a / T.ANCHOR_N)) )`; `cluster = noisyOR_r( goesWith[cat][r] * (1 - exp(-count_r / T.CLUSTER_N)) )`; `need = tier value`; `trend = clamp01(0.5 + yoy/20)` (only for mapped DOSM groups); `conf = count>0 ? 1 : coverage.k`.
**Archetypes** (priority order @@ARCH@@): *pioneer* = zero found, a demand/cluster/need signal (demand>=.3 or cluster>=.4 or need>=.7) **and** coverage.k >= PIONEER_MIN_CONF (else *unverified*); *thin* = count>=1, sat<THIN_SAT, (need>=.7 or demand>=.4); *complementary* = cluster>=.45 and sat<CROWDED_SAT; *niche* = restaurant/fastfood with sat>=.6, cuisine data reliable and a missing cuisine; *emerging* = trend>=EMERGING_SCORE and sat<CROWDED_SAT; *proven* = THIN_SAT<=sat<CROWDED_SAT, demand>=.2, no other tag; *saturated* = sat>=CROWDED_SAT.
**Rankings** - Opportunities: `potential = (w.demand*demand + w.cluster*cluster + w.need*need + w.trend*(trend ?? .5)) / sum(w)`; `score = potential * (WHITE_FLOOR + (1-WHITE_FLOOR)*white) * CAPITAL_FACTOR * (0.75 + 0.25*conf)`, weights `@@OPPW@@`. Complements: `raw = (w.need*need + w.cluster*cluster + w.demand*demand)/sum(w)`; `score = raw * sqrt(white) * (0.75 + 0.25*conf)`, weights `@@COMPW@@`; each card also lists which existing businesses benefit. Checklist read: gap (0) / thin / healthy / crowded, sorted gap-first then by need. Idea check = the legacy 6-weight blend (low competition, population, income, diversity, momentum=0.5, competitor strength from the on-site read), weights auto-normalised; verdict bands .75/.55/.35.
**Data confidence** - capture-recapture: `N_hat = nOSM * nOvt / matched` when matched >= `T.CR_MIN_MATCHES`, `k = clamp01(union / N_hat)`; else `k = clamp01(mapped / T.SPARSE_N)`; High >=.75, Medium >=.45. **Merge**: same category AND (named: <= `T.MERGE_NAMED_M` and name-word overlap >= `T.MERGE_NAME_SIM`; unnamed: <= `T.MERGE_UNNAMED_M`). **Co-location lift**: observed neighbour rate within `T.COLOC_R_M` divided by the rate expected under uniform density, shown only when both types have >= `T.COLOC_MIN_N` places.
**Classification**: OSM element -> every registry type whose tag matches (multi-category); `cuisine=bubble_tea` or a drink-brand name forces *drinks*. Overture row -> first match in `OVT_ORDER` over the words of `basic_category + taxonomy.primary` (tokens split on non-alphanumerics, so `chinese_restaurant` contains `restaurant`); unknown -> counted as `unmapped`. Geoapify feature -> `geo` category lists.

Thresholds (all **assumptions**, edit in the workbook):

| Name | Value |
|---|---|
@@TROWS@@

Engine API (`Object.keys(E)`): @@ENGAPI@@.

## 7. Client reference (`market-radar.js`, single IIFE)
State object (verbatim from the file):
```js
@@STATE@@
```
Actions (`data-act`): @@ACTS@@. Tabs: Market Analysis = Best opportunities | Idea check | Area snapshot | Businesses; Market Gap = Best complements | Household checklist | Area snapshot | Businesses. Tabs are a real `role=tablist` with arrow-key navigation. Map layers: all businesses (grey), focused type (red; purple = Overture-only), heat, outside-the-area (hollow dashed grey, opt-in), anchors (blue squares). Exports: businesses / ranking / checklist CSV (RFC 4180, UTF-8 BOM). Print: `beforeprint` renders every tab of the current mode, `afterprint` restores. Place search = Nominatim, submit-only, >= 1.2 s between searches, Malaysia only (`countrycodes=my`, bounded to Sarawak). The on-site read (1-5) moves 10% of weight from Low competition to Competitor strength the first time it is picked, gives it back when cleared, and is forgotten on a town change; a hand edit of any weight ends that automation.
Function index: @@FN@@.
`window.__MR = {S, analyze, setMode}` is a test hook (not an API).

## 8. Overture layer
* File: `market-radar-data/overture-<town>.json` = `{v:1, release, built, town, bbox, minConf, attribution, cols:['id','lat','lng','name','cat','basic','conf','src'], rows:[[...]]}` (`cat` = `taxonomy.primary`, `basic` = `basic_category`, `conf` = `confidence`, `src` = first source dataset). Built by `tools/market-radar-build-overture.py` from `overturemaps download --bbox=W,S,E,N -f geojsonseq --type=place`; drops permanently-closed, unnamed, non-point and confidence < 0.4 rows; refuses to write < 50 rows or to shrink an existing file by more than half unless `--force`; output order is deterministic.
* **Verified live (docs.overturemaps.org, 2026-10-13/15):** CLI usage; place schema fields (`names.primary`, `taxonomy{primary,hierarchy,alternates}`, `basic_category`, `confidence`, `operating_status`, `sources[]`); the old `categories` field is removed (Sept 2026 release); STAC catalog `https://stac.overturemaps.org/catalog.json` has a top-level `latest` release id; places carry **per-record source licences** (CC0-1.0, Apache-2.0, CDLA-Permissive-2.0 among them) and attribution is required (https://docs.overturemaps.org/attribution/); Overture says places contain duplicates and a high junk rate, that `confidence` measures existence only, and that its definition of a place **excludes movable things such as food carts** - so hawker/stall counts are probably under-stated in BOTH sources. Overture's places theme does **not** contain OpenStreetMap data, which is why the two sources can be treated as independent for the completeness estimate.
* **NOT verified (no internet in the build sandbox):** the CLI's exact JSON nesting (the builder accepts nested objects or JSON text); and that the engine's `ovt` word lists cover the real taxonomy. The 22 labels named in Overture's own docs were run through the classifier (all sensible: e.g. `gas_station_sushi` -> restaurant, not petrol; parks/castles -> unmapped). **First-run check for the owner:** after building the files, analyse a busy spot and open Area snapshot -> the row "Overture categories not mapped" (up to 10 labels with counts); if a business-like label is listed there, add its words to that type's `ovt` string in the engine and re-run the tests.
* **Licence note (not legal advice):** the page merges OpenStreetMap (ODbL) and Overture data in the browser for analysis. Overture says combining CDLA-Permissive data with OSM is permitted but the resulting database may need to carry the ODbL. The page footer and the CSV exports therefore tell people to keep both credits if they share a download.

## 9. External APIs - verified status
| Source | Use | Status |
|---|---|---|
| Overpass (public mirrors) | businesses + anchors | Browser-first in v@@VER@@. Failure mode `HTTP 200 + remark` handled. Not re-tested live from the sandbox |
| Overture Maps | optional cross-check | docs/CLI/STAC verified 2026-10; builder never run against live data |
| OpenRouteService (api.heigit.org) | walk/drive shape | working as of 2026-09-22; free key from account.heigit.org |
| DOSM `hh_income_district` via data.gov.my data-catalogue | income | working as of 2026-09-22 |
| DOSM `population_district` (both data-catalogue and opendosm) | population | **both broken as of 2026-09-22** (HTTP 400 / empty) -> pinned 2023 estimates; self-heals if DOSM fixes either; not re-tested |
| DOSM `iowrt_3d.csv` (storage.dosm.gov.my) | national retail trend | working per earlier sessions; parsed defensively |
| Gemini / Workers AI | narration | Gemini refuses some Cloudflare regions (intermittent); Workers AI needs the `AI` binding |
| Geoapify Places v2 | last-resort POI backstop | key-authenticated; free tier 3,000 credits/day (not re-verified) |
| Nominatim | place search | usage policy verified 2026-10: submit-only, <= 1 request/s per site, identify the app, attribute OSM |
| OSM tile server | base map | fine for a low-traffic tool; check OSM's tile usage policy if traffic grows |

## 10. Decision log / invariants (do not silently break)
1. Anchors (schools, hospitals...) are never competitors; they only feed the demand-driver signal.
2. The AI narrates only; it is given numbers and told never to invent one or to say "open / don't open".
3. Every stat carries provenance (Official / Estimated / Calculated / Observed). A pinned population is still "Official - DOSM" **plus** a visible note that it is not live.
4. "0 found" is never shown when the data could not be fetched; a zero-count is only a *First-mover* when data confidence is high, otherwise *Possible gap - verify*.
5. Failures are never cached; an Overpass `remark` about a timeout/out-of-memory is a **failure**, not an empty success.
6. **No result element may rely on the `hidden` attribute.** Results are re-rendered from state into one container.
7. One element can belong to several business types (a fuel station that is also a shop is both).
8. Gap/thin/crowded reads come from density versus a labelled assumption (`crowded` per type), never from an invented outside benchmark; the "assumptions" are listed on the page and in the workbook.
9. The query the browser sends and the query the Worker builds come from one function (byte-parity test).
10. The Worker is public: CORS only stops other websites. All client input is validated; Origin enforcement / Turnstile is open work.
11. No persistence beyond the daily-cap counter; the vacancy notepad and on-site read reset with the tab.
12. The browser never sends secrets; the Worker never receives free-form text into a prompt without clipping.
13. `initMap()` resets the pin marker before rebuilding the map (orphaned-marker bug, v1.6.1).
14. Nothing in `market-radar-engine.js` touches the DOM or network - keep it testable in Node.

## 11. Tests (@@NTESTS@@ total; run `sh tests/run-all.sh`)
@@TESTS@@
What the suites do **not** prove: real map tiles and real Leaflet (stubbed), real Cloudflare behaviour (cache on `*.workers.dev`, region blocks), live upstream APIs, real phones (only a 390 px emulation), whether the assumption-based scores match local reality, and the unverified items in Section 12. The e2e suite injects hostile site CSS to prove mode switching does not depend on the site's stylesheet.

## 12. Known limitations / unverified
* **Nothing in this release has been run against live Overpass, ORS, DOSM, Gemini, Geoapify or the real site stylesheet** - the build sandbox has no internet. First live run: Section 13 of the setup guide lists the exact smoke tests.
* The Overture layer is unbuilt until the owner runs the builder; until then the page uses OpenStreetMap only and says so. Overture label coverage is partly unverified (Section 8).
* Hawker stalls / food carts are probably under-counted by both sources.
* Scores are decision aids built on labelled assumptions (crowding densities, need tiers, capital levels, anchor pulls, thresholds); calibrate them against a few streets you know.
* Population is district-level (pinned 2023 DOSM estimates); no local density layer yet. Income is district median.
* There is no per-shop "reach" or throughput figure anywhere (the tool has no foot-traffic data); the v1.6.x "1 per ~N people" column was dropped on purpose.
* The DOSM trend covers only the groups listed in Section 6 and is Malaysia-wide.
* Daily cap is per browser (trivially bypassed); Worker has no per-IP limit.

## 13. Open items (KIV)
1. **Run the Overture builder** (`python tools/market-radar-build-overture.py --town all`), upload `market-radar-data/`, check "Unmapped Overture categories".
2. Live smoke tests (setup guide Section 6): pharmacy near a hospital; a petrol station; switch modes; one analysis per town.
3. Verify `pharmacy` (47721) and `petrol` (47300) against `iowrt_3d.csv` groups before mapping them; MSIC codes for them were cross-checked against other countries' lists only.
4. Local population density (WorldPop/HRSL) instead of district-level DOSM.
5. Worker on a custom domain (real caching); `Origin` enforcement or Turnstile.
6. Refresh pinned populations yearly; a 5th town needs: `TOWNS` (client), pinned population (Worker), `TOWNS` in the builder, and a new Overture file.
7. Optional GitHub Action to rebuild the Overture files monthly (needs checking that a commit made with the default `GITHUB_TOKEN` actually triggers a Pages rebuild - unverified).
8. Calibration pass of the assumption tables with local ground truth; household vs small-business personas for Market Gap.
9. AppSheet field-survey layer; momentum needs snapshot history; candidate DOSM datasets `hies_district`, `lfs_district`, `hh_poverty_district`, `crime_district` (call the endpoint live before trusting any of them).

## 14. Recovery / rebuild notes
If the working folder is lost: the transcript (`/mnt/transcripts/...`) contains every `create_file` and patch command in order. Parse it, replay creates and bash patches into a scratch folder with paths remapped, run the four suites, and diff against the last known good outputs. This is exactly how v@@VER@@ was recovered after the sandbox reset (35/35 engine, 14/14 Worker, 24/24 browser passed again on the replayed files; a hand-rebuilt engine differed from the replayed one only in comments and equivalent expressions).

## 15. Indexes (generated)
Client functions: @@FNX@@.
'''

repl = {
    '@@VER@@': VER, '@@DATE@@': DATE,
    '@@SITEFILES@@': ', '.join(['`%s`' % x for x in sheets + scripts if not x.startswith('https://') and not x.startswith('market-radar')]),
    '@@ENVS@@': ', '.join('`%s`' % n for n in env_names),
    '@@DIRECT@@': ', '.join(direct), '@@MIRRORS@@': ', '.join(mirrors),
    '@@MAXDAY@@': lim.group(1), '@@USAGEKEY@@': lim.group(2), '@@MAXTICKED@@': lim.group(3), '@@MAXCUSTOM@@': lim.group(4),
    '@@MAXSPAN@@': caps['MAX_SPAN_DEG'], '@@MAXPAIRS@@': caps['MAX_TAG_PAIRS'], '@@EXTMS@@': caps['EXTERNAL_CALL_TIMEOUT_MS'],
    '@@POP@@': pop_md, '@@GEMINI@@': gemini, '@@WAI@@': wai, '@@WFN@@': wfn_md, '@@FN@@': fn_md, '@@FNX@@': fn_md,
    '@@NCATS@@': str(E['cats']), '@@NGROUPS@@': str(E['groups']), '@@NANCH@@': str(E['anchors']), '@@NPAIRS@@': str(E['pairs']), '@@NNICHES@@': str(E['niches']),
    '@@NOFOUNDER@@': ', '.join(E['noFounder']), '@@IOWRT@@': ', '.join(E['iowrt']), '@@ARCH@@': ' > '.join(E['arch']),
    '@@OPPW@@': json.dumps(E['opp']), '@@COMPW@@': json.dumps(E['comp']), '@@TROWS@@': T_ROWS,
    '@@ENGAPI@@': ', '.join(E['api']), '@@STATE@@': state, '@@ACTS@@': ', '.join('`%s`' % a for a in acts),
    '@@TESTS@@': '\n'.join(tests_md), '@@NTESTS@@': str(n_tests),
}
out = TEMPLATE
for k, v in repl.items():
    out = out.replace(k, v)
left = re.findall(r'@@[A-Z]+@@', out)
if left:
    raise SystemExit('Unfilled placeholders: %s' % sorted(set(left)))
with open(OUT, 'w', encoding='utf-8', newline='\n') as fh:
    fh.write(out)
print('wrote %s (%d KB, %d tests listed, version %s)' % (OUT, len(out) // 1024, n_tests, VER))
