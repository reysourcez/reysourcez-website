# Food Worth Calculator — changes, 2026-08-31

Three changes, all in the files attached to this handoff:

1. **Micronutrients are now tags, not numbers.** "Vitamins & minerals" shows "Good source of: Vitamin C, Iron" / "Higher in: Sodium" instead of raw mcg/mg figures. Gemini still estimates the same numbers behind the scenes (Worker schema unchanged there) — the frontend just checks each one against its FDA Daily Value and only shows whether it clears a meaningful bar, never the number itself.
2. **"What did it cost?" now shows a typical market price range** (e.g. RM8–RM12), estimated by Gemini per dish and summed across every included dish, next to your own price-paid input. This needed a new field on the Worker's Gemini schema (`typical_price_myr`), so **the Worker needs to be redeployed** — paste the new `food-worth-proxy-worker.js` into the Cloudflare dashboard same as before.
3. **Nav rebuilt into the "Business Analysis" dropdown**, matching `interactive-costing-analysis.html` and `AI_BUILD_BRIEF.md` exactly, with Food Worth marked as the current page. Added the `nav-dropdown.js` script tag it depends on for click/tap/keyboard support.

Bonus fix: the old "Vitamins & minerals" paragraph had literal `\u2014` text sitting in the HTML instead of an actual dash (that escape only means anything inside a JS string, not raw HTML) — it would have rendered as visible backslash-u-2014 on the page. Rewritten along with the rest of that paragraph.

The diagram above traces the new path: one Gemini call still returns items + micronutrients + price together, and it's the *display* layer that turns micronutrients into a tag and price into a range.

## Jargon index

| Term | Plain-English meaning |
|---|---|
| Daily Value (DV) | The FDA's reference amount of a nutrient for one day, printed on US nutrition labels. Used here purely as a yardstick — never shown to the visitor as a number. |
| "Good source" / "Excellent source" | The FDA's own labeling thresholds: a meal counts as a "good source" of a nutrient at ≥10% of its Daily Value, and "excellent"/"high in" at ≥20%. This tool reuses those exact cutoffs. |
| Worker | The Cloudflare Worker (`food-worth-proxy-worker.js`) — a small server that holds the secret Gemini key and calls Gemini on the browser's behalf, so the key is never exposed to visitors. |
| Schema | The exact shape of data asked of Gemini (field names, types) — like a form Gemini has to fill in every time. |
| WeakMap | A JavaScript lookup table keyed by a webpage element (here, a dish panel) that cleans itself up automatically when that element is removed, so removing a dish can't leak memory. |
| Dish-level vs. meal-level | One dish = one photo/panel. A "meal" = every dish added together. Micronutrients and typical price are estimated per dish, then summed into the meal totals shown at the bottom. |
| MYR | The international currency code for Malaysian Ringgit — used internally in the data; "RM" is what's actually displayed. |

## Settings reference

Everything below lives inside the code (this site has no separate settings file), but these are the specific lines to open if a value ever needs adjusting.

| Setting | Current value | Where to change it |
|---|---|---|
| "Good source" threshold | 10% of Daily Value | `microLevel()` in `food-worth-calculator.js` — the `10` |
| "Excellent / Higher in" threshold | 20% of Daily Value | `microLevel()` in `food-worth-calculator.js` — the `20` |
| Which nutrient gets the caution treatment | Sodium only | `caution: true` on the sodium row in `MICRONUTRIENT_FIELDS`, `food-worth-calculator.js` |
| Per-nutrient Daily Value figures | FDA 2016 values (e.g. Vitamin C 90mg, Calcium 1300mg) | `dv:` field on each row in `MICRONUTRIENT_FIELDS`, `food-worth-calculator.js` |
| Where typical price is calibrated to | "Malaysian hawker stall, kopitiam, or casual eatery" | `PROMPT` text in `food-worth-proxy-worker.js` |
| Daily analysis limit | 20 photos/day per browser | `MAX_ANALYSES_PER_DAY`, `food-worth-calculator.js` |
| Cloudflare Worker URL the browser calls | `food-worth-proxy.reysourcez-ent.workers.dev` | `PROXY_ENDPOINT`, `food-worth-calculator.js` |
| Websites allowed to call the Worker (CORS) | `reysourcez.com`, `www.reysourcez.com` | `ALLOWED_ORIGINS`, `food-worth-proxy-worker.js` |

None of these are editable without opening the file — this site has no build step or config file to point to, so "current value → new value" would need an actual separate settings file (e.g. a small `config.js` the other pages could also read from). That's a bigger, standalone change touching more than today's three asks, so it's left for a future pass rather than folded in here uninvited.

## Deploy checklist

- [ ] `food-worth-calculator.html` and `food-worth-calculator.js` → push to GitHub Pages as usual.
- [ ] `food-worth-proxy-worker.js` → paste into the Cloudflare Worker dashboard and redeploy (required — the schema changed).
- [ ] Confirm `nav-dropdown.js` already exists in the repo (it should, since `interactive-costing-analysis.html` already depends on it).
