<!-- Market Radar - Setup & Reference - v1.7.0 (2026-10-15). History up to v1.6.2 lives in MARKET_RADAR_HISTORY.md. Every on-screen wording below was read from the shipped files. -->
# Market Radar — Setup & Reference (v1.7.0, 2026-10-15)

**New AI session?** Read `MARKET_RADAR_HANDOFF.md` first. **Just want to deploy?** Read sections 1–4 below, in order.

---

## 1. What this release is, in plain English

Market Radar answers two questions about a spot you pin on the map in Miri, Kuching, Sibu or Bintulu:

* **Market Analysis** – *"Which business would be the best opportunity here?"* It ranks business types and tells you **why** (first-mover, under-supplied, complementary, niche, emerging, proven demand, crowded, or "possible gap – verify"), with the evidence. It also has an **Idea check** (score one idea you already have), an **Area snapshot** and a **Businesses** list you can download.
* **Market Gap** – *"What would best complete this area?"* It ranks what the area is missing, with a **Household checklist** of everyday needs (pharmacy, clinic, minimart, laundry…).

Both modes use the **same** analysis, so switching is instant and nothing from one mode can linger in the other.

**What was wrong before, and what changed** (details in the handoff, section 1):

| You saw | Why it happened | Fixed by |
|---|---|---|
| One mode's results stayed on screen after switching | The site's stylesheet overrode the page's "hidden" switch | The page no longer hides anything that way; it redraws from scratch each time |
| A pharmacy / petrol station was on the map but "0 found" | The free map server sometimes answers "OK" but with a *timed-out, empty* result, and the old Worker believed it and remembered it for a day. Drugstore chains are tagged differently from pharmacies, and a petrol station that is also a shop was counted only once | The browser now asks the map server itself first; a timed-out answer counts as a failure and is never remembered; pharmacies use all three tags; a place can count in several types |
| Only a single score | — | Ranked opportunities and complements with the reasons shown |
| No idea whether the map data is complete | OpenStreetMap is volunteer-made | Optional second source (Overture Maps) and a completeness estimate; the page says "Possible gap – verify" instead of claiming a gap when it can't be sure |

---

## 2. The files

**Easiest: download `market-radar-v1.7.0-ALL-FILES.zip`, unzip it, and read `START_HERE.md`.** It holds every file below with the folders kept (`tools/`, `tests/`, `archive-v1.6.2/`). Downloading files one by one loses the folders.

| File | Goes to | Notes |
|---|---|---|
| `market-radar.html` | GitHub (website repo, top level) | replaces the old one |
| `market-radar.js` | GitHub (top level) | replaces the old one |
| `market-radar-engine.js` | GitHub (top level) | **new file** – must be uploaded together with `market-radar.js` |
| `market-radar-proxy-worker.js` | Cloudflare Worker `market-radar-proxy` | paste into *Edit code* |
| `market-radar-data/overture-miri.json` (+ kuching, sibu, bintulu) | GitHub, folder `market-radar-data` | **optional**, built on your PC (section 4) |
| everything else (`tools/`, `tests/`, `.md`, `.xlsx`, `START_HERE.md`) | stays in your project folder | not uploaded to the website |

The page loads the scripts as `market-radar-engine.js?v=20261015a` and `market-radar.js?v=20261015a`. The `?v=` part makes browsers fetch the new copy; **change it whenever you change a script.**

The page also loads files this project does not own: `styles.css`, `site-config.js`, `nav-config.js`, `nav-dropdown.js` (the shared menu). Leave them alone.

---

## 3. Deploy (about 10 minutes)

**Order matters: do step A and step B, then refresh. The page and the Worker must be the same version.**

### A. GitHub – the three page files
1. Open your website repository on github.com.
2. **Add file → Upload files**.
3. Drag in `market-radar.html`, `market-radar.js` and `market-radar-engine.js` (they replace/add to the ones at the top level).
4. Click **Commit changes**. Wait 1–2 minutes for GitHub Pages to publish.

### B. Cloudflare – the Worker
1. **Workers & Pages → market-radar-proxy → Edit code**.
2. Click inside the code, **Ctrl+A** (select everything), then paste the entire contents of `market-radar-proxy-worker.js`.
3. Click **Deploy**.
4. **Settings → Variables and Secrets**: check these names exist, spelled exactly: `GEMINI_API_KEY`, `ORS_API_KEY`, `GEOAPIFY_API_KEY`. (A misspelt name is silently ignored.) **Settings → Bindings**: a *Workers AI* binding named exactly `AI`. Nothing new is needed for v1.7.0. `GOOGLE_PLACES_API_KEY` is no longer used; you may delete it.

### C. Refresh and check it is really v1.7.0
1. Open `reysourcez.com/market-radar.html` and press **Ctrl+F5** (Mac: Cmd+Shift+R).
2. Next to the title you should see a small **v1.7.0**. (Press **F12** → Console: `[Market Radar] page v1.7.0 · engine v1.7.0`.)
3. Pin a spot, press **Analyze this spot**, open the **Area snapshot** tab → *Where the data came from*. You should see **Worker – v1.7.0 answered this analysis**. If instead it says *"This page is v1.7.0 but the Worker is v…"* or *"No answer from the Worker"*, redo step B.

### Rolling back
Roll back **both together**: on GitHub re-upload the old page files (kept in `archive-v1.6.2/`; their names end in `-v1.6.2`, rename them back to `market-radar.html` / `market-radar.js` when uploading), and in Cloudflare open the Worker's *Deployments/Versions* and restore the previous version. A new page with an old Worker (or the reverse) shows errors.

---

## 4. Optional but recommended: the Overture cross-check files

Without these the page works from OpenStreetMap only and says so ("Overture layer: Not loaded for this town"). With them it can estimate how complete the map data is and show businesses OpenStreetMap is missing.

On your PC (Python 3.8+ and internet), in the folder that contains `tools/`:

1. `python -m pip install overturemaps` (on Windows `py -m pip install overturemaps` also works).
2. `python tools/market-radar-build-overture.py --town all` — takes a few minutes. It downloads the latest Overture places for each town and writes four small files into a new folder `market-radar-data/`. It prints how many places it kept and dropped.
3. On GitHub: **Add file → Upload files**, drag the whole `market-radar-data` folder in, **Commit**.
4. Refresh the page and analyse a spot. *Area snapshot → Overture layer* should now show a release, a place count and "matched with OpenStreetMap", and a completeness estimate.
5. **First-run check (important):** in *Area snapshot*, look for the row **"Overture categories not mapped"**. If it lists something that is clearly a business type you care about, tell your AI assistant the label – its words get added to the registry (the page ignores places in unmapped categories).
6. Repeat steps 2–3 every two to three months (Overture publishes monthly).

If the script says *"NOT WRITTEN: only N rows"* the download was incomplete – run it again (it will not overwrite a good file with a bad one). *"Cannot find the overturemaps tool"* – close and reopen the terminal after installing.

> **Sharing downloads:** the page merges OpenStreetMap (ODbL licence) and Overture data. If you share a downloaded list publicly, keep both credits. (This is a note, not legal advice.)

---

## 5. How to read the page

* **Data confidence** (top of the results): *High / Medium / Low*. Without Overture it only reflects how many businesses are mapped; with Overture it is an actual completeness estimate (two independent sources overlap → implies how many exist).
* **Archetypes**: **First-mover** – none found, and the area shows demand signals (needs *High* confidence, otherwise it says **Possible gap – verify**). **Under-supplied** – a few exist but too few for a high-need type. **Complementary** – fits businesses already clustered here. **Niche** – a crowded category with a missing sub-type (e.g. no Japanese among the restaurants; only shown when enough places have cuisine data). **Emerging** – Malaysia-wide retail trend is rising (only 4 retail types are tracked). **Proven demand** – competitors confirm demand; win by differentiating. **Crowded** – dense competition.
* **Every card explains itself** ("Why this?") and has a "Show N existing on map" button. Tick **Found, outside area** under the map layers to see places that were found but fall just outside your catchment shape (hollow dashed grey dots).
* **Idea check**: tick up to four types you are weighing (or add your own OpenStreetMap tag). The *On-site read* (how busy the competitors look when you visit) counts 10%; clear it and the weight goes back. Weights are editable; the score updates live.
* **Plain-English read**: an AI writes 3–4 sentences about the numbers on screen. It never invents a number and never tells you to open or not open anywhere.
* **Assumptions**: crowding densities, need tiers, capital levels, anchor pulls and thresholds are the author's judgements, **not measurements**. They are listed in `market-radar-settings-reference.xlsx`. Calibrate them against streets you know.
* **Not in the tool**: rent, foot traffic, sales. Ask landlords/agents; walk the area at peak hours. Hawker stalls and food carts are probably under-counted by both data sources.

Limits: 15 analyses per browser per day (a soft limit that protects shared free services).

---

## 6. Live smoke tests (the ones a build sandbox cannot do)

This release passed 87 automated tests (35 engine, 14 Worker, 12 Overture builder, 26 real-browser) — but **the build environment had no internet**, so nothing was run against the real Overpass, Overture, ORS, DOSM or Gemini servers, or against your real site stylesheet. After deploying, please check:

1. **Basic run:** Miri, *10-minute walk*, pin the town centre, *Analyze this spot*. Status line: *"Found N businesses in the 10-minute walk area (… km²) via Overpass (…, direct from your browser)."*
2. **The pharmacy/petrol case that burned earlier rounds:** pin near a hospital or a Petronas station; open **Businesses**, filter the type. They should be listed. If one is visible on the map tile but missing, turn on **Found, outside area** and tell your assistant what you see: *solid red dot* = counted; *hollow grey dot* = found but outside the shape; *nothing but the base-map icon* = the map server did not return it.
3. **Mode switching:** switch Market Analysis ⇄ Market Gap several times, analysing in between. Exactly one set of results should be visible each time.
4. **Each town once** (Miri, Kuching, Sibu, Bintulu): district population should show with a note that it is DOSM's 2023 estimate (the live DOSM service for it has been broken since 2026-09-22).
5. **Plain-English read** in both modes. If it says Gemini refused the region, add the `AI` binding (step B4).
6. **Phone:** the layout should fit without sideways scrolling.
7. If an analysis fails, the status line lists what each route said. Copy it to your assistant.

---

## 7. Troubleshooting

| You see | Likely cause | Do this |
|---|---|---|
| *"This Worker (v1.7.0) expects mode: context \| pois \| insight…"* | Old page cached in the browser | Ctrl+F5; check the `?v=` numbers (section 2) |
| Area snapshot: *"No answer from the Worker"*, or district data *Unavailable* | Worker not updated, or ORS/DOSM down | Redo step B; check Cloudflare logs |
| *"This page is v… but the Worker is v…"* | One of the two was not updated | Upload/paste the matching file |
| Dashed circle instead of a shape | `ORS_API_KEY` missing or ORS down | Estimated radius is used and labelled so |
| Population says *Not available* for a new town | A 5th town needs its pinned figure | See the workbook sheet *Towns* |
| *"Every Overpass mirror failed …"* | All free map servers busy/blocked | Try again in a minute; the message lists each route |
| Plain-English read fails | Gemini refused the region and no `AI` binding | Add the `AI` binding |
| Overture row says *Not loaded for this town* | Files not uploaded or wrong folder name | Folder must be exactly `market-radar-data` |
| Console line `[Costing Sync] …` | Old page version | v1.7.0 no longer loads that script |

---

## 8. What was and was not verified

**Verified (in the build environment):** 87 automated tests, including the real Worker code against mocked upstreams (a "timed-out" answer is a failure and is not cached; byte-identical query text in page and Worker), a real Chromium browser driving the real page with the site stylesheet deliberately made hostile, and the Overture builder against the real classifier. Also verified against Overture's current documentation (2026-10): the CLI, the place fields, the STAC "latest" release id, the per-record licences, and that Overture does not contain OpenStreetMap data.

**Not verified:** anything live (see section 6); the real Overture download (the builder tolerates the two likely JSON shapes, but was only run on synthetic files); whether Overture's real category labels are all covered (22 labels from its own docs were checked; the *"Overture categories not mapped"* row is your safety net); the site's `styles.css`; real phones; whether the assumption-based scores match local reality; the quality of the plain-English read from the fallback model.

---

## 9. Settings

Every number you might want to change is in **`market-radar-settings-reference.xlsx`** (generated from the code, so it cannot drift): type your wished value in the yellow cell and give the sheet to your assistant. To regenerate it after code changes: `python tools/market-radar-build-settings.py`.

---

## 10. Glossary

| Term | Plain-English meaning |
|---|---|
| **Catchment / area** | The area around your pin that is analysed: a real walk or drive-time shape (from OpenRouteService), or an estimated circle if that is unavailable. |
| **Isochrone** | "Everywhere reachable within N minutes" – hugs real streets, so it is not a circle. |
| **Overpass** | OpenStreetMap's free query service: "give me every X inside this box". Public, shared, sometimes slow, and it can answer *OK* with an empty result when it timed out (the `remark`). |
| **Passthrough** | The Worker forwards the map server's answer untouched instead of reading it, so it cannot run out of its small CPU allowance. |
| **Overture Maps** | A separate, open places database (several providers). Used only as a cross-check. Its places theme does not contain OpenStreetMap data. |
| **GERS id / taxonomy / basic category** | Overture's stable place id; its category tree (`taxonomy.primary` is the specific label); and its ~280 broad labels (`basic_category`). The page matches on both. |
| **Capture–recapture** | Estimating a total from two independent lists: if list A has 100, list B has 80 and 40 are in both, about 100×80/40 = 200 exist. Used for the completeness estimate. |
| **Data confidence** | How sure the page is that a "none found" really means none exist. |
| **Saturation** | Density of a business type ÷ the density at which that type is treated as crowded (an assumption). |
| **White space** | 1 − saturation (floored): room left in the market. |
| **Anchor / demand driver** | Schools, colleges, hospitals, malls, government offices, places of worship, transport terminals, attractions. They create foot traffic; they are never counted as competitors. |
| **Complement** | A business that fits what is already clustered nearby (e.g. a laundry near a minimart). |
| **Co-location lift** | How much more often two types are found together than chance would predict in this area. |
| **MSIC** | Malaysia's official industry codes; shown for reference only. |
| **DOSM** | Department of Statistics Malaysia (population, income, retail-trade index). |
| **Pinned fallback** | A hand-copied official figure kept inside the Worker for use when the live service is confirmed broken (district population). Refresh yearly. |
| **ORS** | OpenRouteService – draws the walk/drive shapes. |
| **Worker / binding / secret** | Your small Cloudflare program; a named connection to a Cloudflare service (`AI`); a stored key only the Worker can read. |
| **ODbL** | OpenStreetMap's data licence: keep the credit, and share-alike rules may apply to databases built from it. |
| **Assumption** | A judgement written into the model, not a measurement. Listed in the workbook. |

---

## 11. Files and versions (all v1.7.0 — except `MARKET_RADAR_HISTORY.md`, an archive that ends at v1.6.2, and `archive-v1.6.2/`, the old version kept for rollback)

`market-radar.html` · `market-radar.js` · `market-radar-engine.js` · `market-radar-proxy-worker.js` · `market-radar-data/overture-<town>.json` (built) · `tools/market-radar-build-overture.py` · `tools/market-radar-build-settings.py` · `tools/market-radar-build-handoff.py` · `tools/market-radar-build-package.py` · `market-radar-v1.7.0-ALL-FILES.zip` · `START_HERE.md` · `tests/` (`run-all.sh`, `engine.test.cjs`, `worker.test.mjs`, `overture-builder.test.py`, `e2e.mjs`, `leaflet-stub.js`) · `market-radar-settings-reference.xlsx` · `MARKET_RADAR_HANDOFF.md` · `MARKET_RADAR_SETUP_AND_GLOSSARY.md` · `MARKET_RADAR_HISTORY.md` · `_MANIFEST.md`.
