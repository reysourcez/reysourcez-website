# Food Worth Calculator — change notes

## 2026-09-01 — Nutrient gap analysis, calorie/BMI fit, USA/Malaysia standard toggle

Three additions, all in `food-worth-calculator.html` / `.js` — no Worker changes this round.

1. **"Could use more" and sodium suggestions.** The vitamins/minerals tags now include a third group for nutrients notably low in this meal (capped at the 3 most notably low, so a normal meal doesn't get buried under nutrients it was never going to cover), each paired with a plain food suggestion — e.g. "Fiber — vegetables, fruit, or whole grains." "Higher in" (sodium) now carries its own suggestion too, e.g. "ask for less salt, sauce, or seasoning next time." Fiber is evaluated here too, even though it isn't part of the Worker's `micronutrients` object — it's already tracked per-item as `fiber_g` and summed into `mealTotals.fiber`, so it just needed its own Daily Value/NRV reference (28g, same under both standards) rather than any new data source.
2. **"How this fits your day"** — a new section comparing this meal's calories against an estimated daily need. Two modes: "Calculate my need" (sex, age, height, weight, activity level → Mifflin-St Jeor BMR × a TDEE activity multiplier, the same formula/multiplier set virtually every calorie calculator uses) or "I know my target" (type your own number directly). Also shows BMI as supplementary context, with a plain-language disclaimer that it's a screening figure, not a diagnosis. The comparison itself is deliberately neutral — "39% of your day — a solid portion" rather than anything alarmist — since a single meal being calorie-dense isn't inherently a problem, just a data point.
3. **USA / Malaysia standard toggle**, sitting above the vitamins/minerals tags and controlling two things at once: which reference values decide "good source" vs. "could use more" (FDA Daily Values vs. Malaysia's Nutrient Reference Values), and which BMI bands apply. This matters in practice — Malaysia's Ministry of Health uses lower overweight/obese cutoffs than the global WHO chart (23 / 27.5 vs. 25 / 30) because Asian populations show elevated cardiometabolic risk at a lower BMI than the Western reference population the global chart was built on. Defaults to Malaysia, since that's this site's actual audience. The BMR/TDEE formula itself doesn't change with the toggle — it's a physiological equation, not a policy figure.

**A flag on data confidence:** the Malaysian NRV figures for Vitamin C and Vitamin D are the last-confirmed pre-2024-amendment values (60mg and 5mcg) — Malaysia's own amendment notice states both increased in the 2020 amendment (in force since 1 Jan 2024) but doesn't publish the replacement numbers anywhere this could verify. Potassium and sodium use the same figure under both standards, since Malaysia's regulations appear to handle those two as flat mg claim thresholds rather than a %NRV table the way the other eight nutrients work. Everything else (Vitamin A, B12, Calcium, Iron, Magnesium, Zinc, and the full BMI classification) is confirmed against current sources. All of this is a single number per row in `MICRONUTRIENT_FIELDS` — worth a five-minute check against the current gazetted Fifth A Schedule text if precision here matters for the business, and easy to correct either way.

## 2026-08-31 — Qualitative micronutrients, typical market price, nav fix

1. **Micronutrients became tags, not numbers.** "Vitamins & minerals" shows "Good source of: Vitamin C, Iron" instead of raw mcg/mg. Gemini still estimates the same numbers behind the scenes — the frontend checks each one against a reference value and shows only whether it clears a meaningful bar.
2. **"What did it cost?" gained a typical market price range** (e.g. RM8–RM12), estimated by Gemini per dish and summed across every included dish. This needed a new field on the Worker's schema (`typical_price_myr`), so **the Worker needed redeploying** — paste `food-worth-proxy-worker.js` into the Cloudflare dashboard if that hasn't happened yet.
3. **Nav rebuilt into the "Business Analysis" dropdown**, matching `interactive-costing-analysis.html` and `AI_BUILD_BRIEF.md`, with Food Worth marked as the current page. Added the `nav-dropdown.js` script tag it depends on for click/tap/keyboard support.

Bonus fix: the old "Vitamins & minerals" paragraph had literal `\u2014` text sitting in the HTML instead of an actual dash — that escape only means anything inside a JS string, not raw HTML — so it would have rendered as visible backslash-u-2014 on the page. Rewritten along with the rest of that paragraph.

## Jargon index

| Term | Plain-English meaning |
|---|---|
| Daily Value (DV) / Nutrient Reference Value (NRV) | The USA's and Malaysia's respective reference amounts of a nutrient for one day. Used here purely as a yardstick — never shown to the visitor as a number. |
| "Good source" / "Could use more" | A meal counts as a "good source" of a nutrient at ≥10% of the reference value, "excellent"/"higher in" at ≥20%, and "could use more" (a gap) below 5%. 5–10% is a quiet middle ground, flagged neither way. |
| BMR / TDEE | Basal Metabolic Rate (calories your body burns at rest) and Total Daily Energy Expenditure (BMR × how active you are) — together, your estimated daily calorie need. |
| Mifflin-St Jeor | The specific BMR formula used here — the modern standard, generally considered more accurate across body types than the older Harris-Benedict equation. |
| BMI | Body Mass Index — weight ÷ height², a coarse screening figure, not a diagnosis. Shown with its own disclaimer for that reason. |
| Worker | The Cloudflare Worker (`food-worth-proxy-worker.js`) — a small server that holds the secret Gemini key and calls Gemini on the browser's behalf, so the key is never exposed to visitors. |
| Schema | The exact shape of data asked of Gemini (field names, types) — like a form Gemini has to fill in every time. |
| WeakMap | A JavaScript lookup table keyed by a webpage element (here, a dish panel) that cleans itself up automatically when that element is removed, so removing a dish can't leak memory. |
| Dish-level vs. meal-level | One dish = one photo/panel. A "meal" = every dish added together. Micronutrients and typical price are estimated per dish, then summed into the meal totals shown at the bottom. |
| MYR | The international currency code for Malaysian Ringgit — used internally in the data; "RM" is what's actually displayed. |

## Settings reference

Everything below lives inside the code (this site has no separate settings file), but these are the specific lines to open if a value ever needs adjusting. None of these are editable without opening the file — a true "change it without touching code" setup would need a separate config file the pages could read from, which is a bigger, standalone change than any of today's asks, so it's left for a future pass rather than folded in here uninvited.

| Setting | Current value | Where to change it |
|---|---|---|
| "Good source" / "could use more" thresholds | 10% and 5% of DV/NRV | `levelFromPct()` in `food-worth-calculator.js` |
| "Excellent / Higher in" threshold | 20% of DV/NRV | `levelFromPct()` in `food-worth-calculator.js` |
| Which nutrient gets the caution treatment | Sodium only | `caution: true` on the sodium row in `MICRONUTRIENT_FIELDS`, `food-worth-calculator.js` |
| Per-nutrient reference values (both standards) | See `MICRONUTRIENT_FIELDS` | `dvUsa:` / `dvMy:` on each row, `food-worth-calculator.js` |
| Food-suggestion text per nutrient | See `MICRONUTRIENT_FIELDS` | `lowHint:` / `highHint:` on each row, `food-worth-calculator.js` |
| Fiber reference value | 28g (both standards) | `FIBER_DV`, `food-worth-calculator.js` |
| How many "could use more" nutrients show | 3 | `.slice(0, 3)` at the end of `computeNutrientCoverage()`, `food-worth-calculator.js` |
| Default reference standard | Malaysia | `let activeStandard = 'malaysia'`, `food-worth-calculator.js` |
| BMI band cutoffs, both standards | Malaysia 23/27.5, USA 25/30 | `BMI_STANDARDS`, `food-worth-calculator.js` |
| Activity level multipliers | 1.2 / 1.375 / 1.55 / 1.725 | `ACTIVITY_LEVELS`, `food-worth-calculator.js` |
| General population calorie reference (shown as text only) | ~2,000 kcal women / ~2,500 kcal men | Structure-note paragraph above the calorie fields, `food-worth-calculator.html` |
| Where typical price is calibrated to | "Malaysian hawker stall, kopitiam, or casual eatery" | `PROMPT` text in `food-worth-proxy-worker.js` |
| Daily analysis limit | 20 photos/day per browser | `MAX_ANALYSES_PER_DAY`, `food-worth-calculator.js` |
| Cloudflare Worker URL the browser calls | `food-worth-proxy.reysourcez-ent.workers.dev` | `PROXY_ENDPOINT`, `food-worth-calculator.js` |
| Websites allowed to call the Worker (CORS) | `reysourcez.com`, `www.reysourcez.com` | `ALLOWED_ORIGINS`, `food-worth-proxy-worker.js` |

## Deploy checklist

- [ ] `food-worth-calculator.html` and `food-worth-calculator.js` → push to GitHub Pages as usual.
- [ ] `food-worth-proxy-worker.js` → only needs redeploying if you haven't already picked up the 2026-08-31 typical-price change; nothing in today's (09-01) update touches the Worker.
- [ ] Confirm `nav-dropdown.js` already exists in the repo (it should, since `interactive-costing-analysis.html` already depends on it).
