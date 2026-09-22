/* ============================================================
   Cost Structure Checker — CONTENT FILE
   ------------------------------------------------------------
   This file holds every editable WORD on the page: the guide
   ratios, the full cost-creep cause library, and the jargon
   index. It has almost no logic in it on purpose — it's meant
   to be the one file a non-coder can open, read top to bottom,
   and safely edit without touching cost-structure-checker.js at
   all. Loaded BEFORE cost-structure-checker.js (see the <script>
   order in cost-structure-checker.html) so its objects already
   exist by the time the logic file runs.

   TO ADD A NEW CAUSE: copy an existing cause block inside the
   right category's `causes` array below and edit the four
   fields (id, label, looksLike, actions). The rest of the page
   picks it up automatically — no other file needs to change.
   `id` just needs to be unique within its own category.

   TO ADD A NEW VENUE TYPE: add one line to GUIDE_RATIOS. It
   needs to stay a 1-line-in from wizardAnswers.venue —
   cost-structure-checker.js reads whichever key the wizard
   button used as its value.
   ============================================================ */

/* ================= GUIDE RATIOS =================
   Same four numbers, same venue keys, as Interactive Costing
   Analysis, Margin Analysis, and Rental Calculator already use
   on this site. Copied here rather than shared at runtime, same
   "each page stays independent, no build step" reasoning those
   pages already state in their own comments — but that also
   means if one of those files is ever deliberately retuned,
   this table has to be updated by hand to match, on purpose.

   These four numbers are themselves a scaled-down version of the
   classic full-service F&B benchmark — roughly 28-35% food cost,
   25-35% labor, 20-30% overhead of revenue — leaned out further
   for formats with less overhead/manpower (home-based, a stall)
   and scaled back up for formats that carry more of both (a full
   store/restaurant). See the Methodology section on the page
   itself for the plain-English version of this same note. */
const GUIDE_RATIOS = {
  home:  { ingredients: 55, overhead: 15, manpower: 15, margin: 15 },
  stall: { ingredients: 50, overhead: 20, manpower: 15, margin: 15 },
  truck: { ingredients: 42, overhead: 20, manpower: 23, margin: 15 },
  store: { ingredients: 35, overhead: 20, manpower: 30, margin: 15 },
};

const VENUE_LABELS = {
  home: 'Home-based',
  stall: 'Stall / hawker',
  truck: 'Food truck',
  store: 'Store / restaurant',
};

/* ================= CATEGORY META =================
   badDirection: which side of the guide number is the PROBLEM
   side for this category. Ingredients/Overhead/Manpower are
   "bad" when they run HIGH; Margin is "bad" when it runs LOW —
   this one flag is what lets computeStatus() in the logic file
   treat all four categories with the same function instead of
   special-casing Margin everywhere it's checked. */
const CATEGORY_META = {
  ingredients: {
    label: 'Ingredients & Packaging',
    guideKey: 'ingredients',
    badDirection: 'high',
    shortHint: 'What you spend on food, drink, and packaging, as a % of sales.',
  },
  overhead: {
    label: 'Overhead',
    guideKey: 'overhead',
    badDirection: 'high',
    shortHint: 'Rent, utilities, licenses, and other running costs, as a % of sales.',
  },
  manpower: {
    label: 'Manpower',
    guideKey: 'manpower',
    badDirection: 'high',
    shortHint: "Total staff cost — including your own wage if it's just you — as a % of sales.",
  },
  margin: {
    label: 'Margin',
    guideKey: 'margin',
    badDirection: 'low',
    shortHint: "What's actually left over as profit, as a % of sales.",
  },
};
const CATEGORY_ORDER = ['ingredients', 'overhead', 'manpower', 'margin'];

/* ================= CAUSE LIBRARY =================
   The actual content of the tool. Every cause follows standard
   F&B cost-control / menu-engineering practice, not a guess —
   several deliberately point back at another tool already on
   this site (Menu Calculator, Margin Analysis, Interactive
   Costing Analysis, Overhead & Manpower Calculator) rather than
   re-explaining something that tool already does properly.
   `tool` is optional — only set on causes with a genuine
   in-page helper (right now, just the Wastage & Par-Level
   Tracker further down this page). */
const CAUSE_LIBRARY = {

  ingredients: {
    causes: [
      {
        id: 'ing-wastage',
        label: 'High wastage / spoilage',
        looksLike: "Trim, spoilage, or produce that gets thrown out regularly — often the single biggest leak in food cost, and the easiest one to miss, since it never shows up as a line on any invoice.",
        actions: [
          'Log every wastage event as it happens, with what, how much, and why — the Daily Wastage Log below is built for exactly this, using the same reason codes a real kitchen SOP uses.',
          'Rank by wastage in RM, not quantity — a kilo of wasted prawns matters far more than a kilo of wasted rice, even if the rice bag looks fuller in the bin.',
          'Fix your worst 2-3 offenders first (better storage, smaller batch prep, tighter portioning) rather than trying to fix everything on the menu at once.',
        ],
        tool: { anchor: 'csc-wastage-log', label: 'Open the Daily Wastage Log' },
      },
      {
        id: 'ing-execution-errors',
        label: 'Burnt, overcooked, or spoiled in cooking',
        looksLike: "Food gets binned during active cooking \u2014 burnt, overcooked, or otherwise ruined before it ever reaches a plate. Different from a bad ingredient or a bad recipe: the food and the process were both fine, the execution on that attempt wasn't.",
        actions: [
          'Log every kitchen-execution loss as it happens \u2014 what, roughly when, and why (rushed, distracted, equipment) \u2014 the Daily Wastage Log below is built for exactly this.',
          'Look for a pattern before blaming an individual: the same dish burning repeatedly usually points at equipment (an oven running hot, a warped pan) or timing (a station overloaded at that point in service), not carelessness.',
          'Retrain on the specific failure point once you know it \u2014 "don\u2019t burn things" isn\u2019t actionable; "pull it off heat during the 90-second plating window" is.',
        ],
        tool: { anchor: 'csc-wastage-log', label: 'Open the Daily Wastage Log' },
      },
      {
        id: 'ing-spillage',
        label: 'Spillage, drops, and handling accidents',
        looksLike: "Product is lost to a physical accident \u2014 dropped, spilled, knocked over \u2014 rather than a cooking or storage failure. Easy to wave off as bad luck, but a station that loses stock this way repeatedly usually has a real, fixable cause behind it.",
        actions: [
          "Log it when it happens, with roughly what and how much \u2014 the Daily Wastage Log below is built for exactly this, and a pattern only becomes visible once it's written down a few times.",
          'Check the physical setup at the station where it keeps happening \u2014 cramped counter space, a shelf that\u2019s too high, a walkway doubling as a prep path \u2014 before assuming it\u2019s just carelessness.',
          'If it clusters around one especially busy point in service, that\u2019s a staffing/pacing problem wearing a spillage costume \u2014 worth checking against Manpower\u2019s overstaffed/overtime causes too.',
        ],
        tool: { anchor: 'csc-wastage-log', label: 'Open the Daily Wastage Log' },
      },
      {
        id: 'ing-fifo',
        label: 'Not practicing FIFO (First In, First Out)',
        looksLike: "Newer stock gets used first because it's sitting at the front of the shelf or fridge, while older stock sits at the back until it spoils and has to be thrown out.",
        actions: [
          'Date every delivery the moment it comes in — a marker and a piece of tape is enough.',
          'Physically rotate stock on receiving: new stock goes to the BACK, older stock moves to the front.',
          "Do a 5-minute 'oldest stock' check at the start of every shift, so anything close to turning gets used first or added to the day's specials.",
        ],
      },
      {
        id: 'ing-portioning',
        label: 'Inconsistent portioning',
        looksLike: "Two plates of the 'same' dish don't actually carry the same amount of protein, sauce, or garnish, because staff are eyeballing portions instead of measuring them.",
        actions: [
          'Standardize every recipe with an exact weight or scoop/ladle size, written on a card at the station — not just held in one cook\u2019s head.',
          'Buy cheap tools that force consistency: a digital scale, colour-coded scoops, portion cups.',
          'Spot-check plated portions against the recipe card weekly, not only during initial training.',
        ],
      },
      {
        id: 'ing-sop',
        label: 'Recipe / SOP not followed',
        looksLike: 'The recipe card says one thing, but what actually goes into the pot depends on who\u2019s cooking that shift.',
        actions: [
          'Make the recipe card the single source of truth, visible at the station — not filed away in a folder.',
          'Correct a deviation the moment it\u2019s spotted, specifically ("this dish should use 150g, that one used 220g") rather than a vague reminder later.',
          'If someone keeps deviating because they genuinely think their version is better, test it properly (cost it, taste it) and either adopt it formally or explain why the SOP stands — an SOP nobody believes in gets quietly ignored.',
        ],
      },
      {
        id: 'ing-price',
        label: 'High purchase price / no supplier comparison',
        looksLike: "You're paying more per kg or unit than you need to, because you're buying from whoever's convenient rather than comparing.",
        actions: [
          'Get 2-3 quotes for your top 5 highest-spend ingredients — a 5% saving on your biggest-spend item usually beats a 20% saving on a minor one.',
          'Ask your main supplier for volume-based pricing once your order size is predictable — see the par-level tool below for how to know that number.',
          'Re-shop annually, not once — supplier pricing drifts, and loyalty pricing isn\u2019t guaranteed to stay competitive on its own.',
        ],
      },
      {
        id: 'ing-parlevel',
        label: 'No par levels — emergency / rush buying',
        looksLike: "You run out mid-service and someone dashes to the nearest shop and pays retail, or you over-order 'just in case' and half of it goes to waste.",
        actions: [
          'Set a par level — a target stock-on-hand number — for every core ingredient, based on your actual average daily usage. The tracker below works this out for you once you log a week or two.',
          "Order to hit par, not to guess — 'top up to par' is a far more repeatable decision than 'how much do I think we\u2019ll need.'",
          'Review par levels monthly, or whenever sales volume genuinely shifts (a new promotion, a slow season).',
        ],
        tool: { anchor: 'csc-wastage-tracker', label: 'Open the Wastage & Par-Level Tracker' },
      },
      {
        id: 'ing-outdated-costing',
        label: 'Menu costing not updated for price inflation',
        looksLike: 'Your recipe costs and selling prices were set months (or years) ago, but supplier prices have crept up since — the menu is quietly less profitable than it looks on paper.',
        actions: [
          'Re-cost your top-selling dishes at least quarterly using CURRENT supplier prices, not the prices you first costed them at.',
          "Use Menu Calculator's Inflation Buffer % to build in a forward cushion, rather than always costing at exactly today's price.",
          'When a key ingredient jumps in price for good (not a short-term spike), update the menu price too — quietly absorbing it erodes margin permanently.',
        ],
      },
      {
        id: 'ing-theft',
        label: 'Theft / pilferage',
        looksLike: "Stock counts don't add up even after accounting for waste and sales — inventory is disappearing without a paper trail behind it.",
        actions: [
          'Compare theoretical usage (from sales \u00d7 recipe) against actual usage (from stock counts) regularly — a persistent, unexplained gap is the real signal, not a one-off.',
          'Tighten access to high-value stock: locked storage, a sign-out log for expensive items.',
          "Address it directly and specifically if a pattern points to one person or one shift — vague, general warnings rarely stop it on their own.",
        ],
      },
      {
        id: 'ing-comps',
        label: 'Comps, voids, staff meals, and unrecorded tasting',
        looksLike: "Free staff meals, sent-back plates, manager comps, and tasting/quality-checking while cooking are all real ingredient cost — but nobody's logging them, so they just show up as 'unexplained' food cost at month end.",
        actions: [
          'Log every comp, void, staff meal, and taste-test against the dish it came from, even briefly — the Daily Wastage Log below has a reason code built for exactly the tasting/sampling case.',
          'Set a policy for staff meals (what\u2019s allowed, roughly how much per shift) so it\u2019s a planned, bounded cost rather than an open-ended one.',
          'Review the comp/void total monthly as its own line — a creeping trend there is worth investigating on its own.',
        ],
        tool: { anchor: 'csc-wastage-log', label: 'Open the Daily Wastage Log' },
      },
      {
        id: 'ing-customer-returns',
        label: 'Customer complaints and returns not tracked or analyzed',
        looksLike: "A dish comes back, or a customer complains and it gets remade or refunded \u2014 the food cost is real, but if nobody's writing down which dish, how often, and why, there's no way to tell an unlucky one-off from a genuine recipe or execution problem.",
        actions: [
          'Log every return/complaint against the specific dish and a reason, even briefly \u2014 the Daily Wastage Log below has a reason code built for exactly this.',
          'Watch for the same dish coming back more than once or twice in a short window \u2014 that\u2019s worth investigating (a recipe drifted from its SOP, one station\u2019s execution, an ingredient batch) rather than treating it as one-off bad luck.',
          'Distinguish a genuine kitchen fault from a mismatched expectation (the customer wanted something the dish was never meant to be) \u2014 the fix is completely different for each.',
        ],
        tool: { anchor: 'csc-wastage-log', label: 'Open the Daily Wastage Log' },
      },
      {
        id: 'ing-receiving',
        label: 'Poor receiving / delivery controls',
        looksLike: "Deliveries go straight into storage without checking the invoice against what actually arrived — short deliveries or quiet substitutions go uncaught.",
        actions: [
          'Check every delivery against its invoice or order before it\u2019s put away — quantity, weight, and quality, not just "did it arrive."',
          "Weigh or count anything sold by weight or count yourself — don't trust the supplier's stated figure blindly.",
          'Reject or flag anything short or substandard on the spot, in writing, rather than after it\u2019s already been used.',
        ],
      },
      {
        id: 'ing-menu-complexity',
        label: 'Menu too complex / low cross-utilization',
        looksLike: 'A long menu means dozens of ingredients each used in only one or two dishes — small amounts of many things spoiling before they\u2019re fully used.',
        actions: [
          'Audit your menu for ingredients used in only one dish — can that dish be reworked to share ingredients already used elsewhere?',
          'Favour "building block" ingredients that show up across several dishes over one-off specialty items, where the recipe allows it.',
          'If a low-cross-utilization item is a genuine signature dish, that\u2019s a fair trade-off — just price it to cover its own higher spoilage risk.',
        ],
      },
      {
        id: 'ing-yield',
        label: 'No yield testing',
        looksLike: "Recipe costs assume a certain usable weight per ingredient after trimming or cooking loss, but nobody's actually confirmed that assumption still holds.",
        actions: [
          'Yield-test your highest-spend raw ingredients: weigh before and after trimming or cooking to get the real usable %, then compare it to what your recipe costing assumes.',
          'Update recipe costs to the real yield %, not the textbook or assumed one — even a 5-10% yield gap on a core ingredient moves your true food cost noticeably.',
          "Retest if you change supplier or cut/grade of an ingredient — yield isn't fixed forever.",
        ],
      },
      {
        id: 'ing-variance',
        label: 'Theoretical vs. actual cost not tracked',
        looksLike: "Nobody's ever compared 'what food cost SHOULD be, based on what was sold' against 'what it ACTUALLY was, based on purchases and stock' — so cost creep has nowhere to be caught.",
        actions: [
          "Work out theoretical food cost from your sales mix and recipe costs — Menu Calculator already gives you the per-dish cost to build this from.",
          'Compare it monthly against actual food cost (purchases + opening stock \u2212 closing stock).',
          'A persistent, growing gap between the two is a real signal something on this list is happening, even before you know exactly which one.',
        ],
      },
    ],
  },

  overhead: {
    causes: [
      {
        id: 'oh-rent',
        label: "Lease/rent too high for the location's revenue potential",
        looksLike: 'Rent looks reasonable on paper, but the foot traffic or sales the location actually generates doesn\u2019t support it.',
        actions: [
          'Calculate rent as a % of revenue specifically, not just RM/month — 6-10% of revenue is a commonly cited healthy range for F&B; well above that is a real flag regardless of the raw RM figure.',
          "Before renewing, price out 1-2 alternative locations even if you don\u2019t plan to move — it keeps your current rent honest.",
          'If moving isn\u2019t realistic, negotiate at renewal using your actual trading history as leverage, rather than accepting a standard increase.',
        ],
      },
      {
        id: 'oh-energy',
        label: 'Energy inefficiency',
        looksLike: 'Old equipment, no monitoring, or idle equipment left running are quietly inflating your electricity bill.',
        actions: [
          'Walk the space at close and note everything still running that doesn\u2019t need to be — this alone often catches real, recurring waste.',
          "Check your actual tariff tier against your usage pattern — Overhead & Manpower Calculator's electricity estimator can sanity-check what your bill 'should' look like against your equipment list.",
          'Prioritize replacing the single most energy-hungry piece of equipment first when budget allows, rather than spreading a small budget thin.',
        ],
      },
      {
        id: 'oh-space',
        label: 'Underutilized space',
        looksLike: "You're paying for square footage that isn't actually driving revenue — an oversized dining area for your covers, or storage that's mostly empty.",
        actions: [
          'Map revenue-per-square-foot for each zone of your space (kitchen, dining, storage) — a standard hospitality metric for exactly this question.',
          'Consider subletting, repurposing, or downsizing genuinely unused space if your lease allows it.',
          'Before expanding, confirm the space you already have is being used efficiently — more space rarely fixes an underlying utilization problem.',
        ],
      },
      {
        id: 'oh-maintenance',
        label: 'No preventive maintenance',
        looksLike: 'Equipment only gets attention when it breaks mid-service, which costs more overall (the repair itself, plus the lost trade) than scheduled servicing would have.',
        actions: [
          'Build a simple maintenance calendar for major equipment (fridge, exhaust, fryer, aircon) based on manufacturer-recommended intervals.',
          'Budget preventive maintenance as a planned monthly cost, rather than treating every repair as a surprise.',
          'Track repeat breakdowns on the same equipment — that\u2019s usually a sign it needs replacing, not repairing again.',
        ],
      },
      {
        id: 'oh-subscriptions',
        label: 'Redundant subscriptions / services never reviewed',
        looksLike: "POS add-ons, software subscriptions, and service contracts signed up for once and never revisited — some may no longer even be used.",
        actions: [
          'List every recurring subscription or service and what it\u2019s actually used for right now — anything nobody can explain the current use of is a cancellation candidate.',
          'Set a calendar reminder to review this list every 6 months, not just once.',
          'Downgrade tiers you\u2019re not fully using rather than cancelling outright, if the service itself is still genuinely needed.',
        ],
      },
      {
        id: 'oh-negotiate',
        label: 'No competitive quotes / renegotiation for recurring services',
        looksLike: 'Internet, insurance, POS, and similar recurring costs have sat on the same plan for years without ever being re-shopped.',
        actions: [
          'Get a competing quote annually for your largest 2-3 recurring service costs, even if you don\u2019t plan to switch — it\u2019s the strongest renegotiation leverage you have.',
          "Bundle where it genuinely saves (insurance across several policies, for example) — but don't bundle just for convenience if it costs more.",
          'Ask directly for a loyalty discount at renewal — many providers have one that isn\u2019t offered unless asked.',
        ],
      },
      {
        id: 'oh-compliance',
        label: 'Compliance costs not planned or budgeted',
        looksLike: 'Licenses, permits, and HACCP/halal renewals land as a surprise expense each time, rather than a planned annual line item.',
        actions: [
          'List every license/certification you hold with its renewal date and cost, and put it on a calendar a month ahead of each renewal.',
          "Budget a monthly 'compliance reserve' (renewal cost \u00f7 12) so the cash is already set aside when it\u2019s due — Overhead & Manpower Calculator's amortize-over-N-months field is built for exactly this.",
          'Check whether any certification is being renewed out of habit rather than genuine need for your current operations.',
        ],
      },
      {
        id: 'oh-insurance',
        label: 'Insurance not right-sized',
        looksLike: "Coverage doesn't match what you actually need — either paying for cover you don't need, or under-insured and exposed to a much bigger loss.",
        actions: [
          'Review your policy against your CURRENT equipment value and business size — cover commonly falls out of date as a business grows or changes.',
          'Get a comparison quote at renewal instead of an automatic renewal.',
          'Never let a policy lapse, even briefly — reinstatement after a lapse is often priced at a real penalty.',
        ],
      },
      {
        id: 'oh-layout',
        label: 'Poor space/layout increasing utility use',
        looksLike: 'Kitchen airflow, lighting, or equipment placement forces you to run cooling or lighting harder than a better layout would need.',
        actions: [
          'Check hot equipment (stoves, fryers) isn\u2019t fighting your aircon unnecessarily — proper exhaust placement cuts AC load a lot.',
          'Swap to LED lighting wherever you haven\u2019t already — one of the fastest-payback overhead fixes there is.',
          'If a full layout change isn\u2019t practical, small fixes (better door seals, exhaust fan timers) are usually cheap wins on their own.',
        ],
      },
      {
        id: 'oh-tracking',
        label: 'Fixed vs. variable overhead not separated or tracked',
        looksLike: "Overhead is one lump number every month — you can't tell what's genuinely fixed (rent) from what's actually controllable (utilities, subscriptions).",
        actions: [
          'Split overhead into Fixed (rent, insurance, licenses) and Variable (utilities, consumable supplies) — Margin Analysis already separates these into their own tabs for exactly this reason.',
          'Focus cost-cutting effort on the variable side first — it responds to behaviour change, where fixed costs mostly don\u2019t until a contract renews.',
          'Track the variable side monthly so a creeping trend gets caught early, not at year-end.',
        ],
      },
    ],
  },

  manpower: {
    causes: [
      {
        id: 'mp-overstaffed',
        label: 'Overstaffed for actual sales volume',
        looksLike: 'The same number of staff work a slow Tuesday and a packed Saturday, because shifts are scheduled by habit rather than by expected sales.',
        actions: [
          'Track labor cost as a % of sales, by shift or day, not just monthly — this exposes exactly which shifts are over- or under-staffed.',
          "Build a staffing template keyed to expected sales volume — Interactive Costing Analysis's own volume slider, or your own sales history, both work as the input.",
          'Cross-train staff so you can flex headcount up or down without leaving a station uncovered.',
        ],
      },
      {
        id: 'mp-turnover',
        label: 'High staff turnover',
        looksLike: "You're constantly retraining, running short-staffed while hiring, and paying recruitment costs again and again.",
        actions: [
          'Track turnover as a real number (staff who left \u00f7 average headcount, over a year) — it\u2019s easy to underestimate how much this is genuinely costing until it\u2019s measured.',
          'Exit-interview leavers, even briefly and informally — the same reason repeating across several exits is worth acting on directly.',
          "Compare your pay/conditions against similar local businesses — if turnover is high specifically because of pay, cheaper fixes elsewhere on this list won't solve it alone.",
        ],
      },
      {
        id: 'mp-overtime',
        label: 'Excess overtime from poor shift planning',
        looksLike: "Overtime is routine, not occasional — often because a shift is understaffed for its actual peak, so 'keep someone late' becomes the default peak-coverage plan.",
        actions: [
          'Identify which specific shifts generate most of your overtime — usually a small number of recurring patterns, not random.',
          'Adjust the base schedule to cover the actual peak, rather than treating overtime as the plan.',
          'Track overtime hours as their own line, monthly — it should trend down once the schedule\u2019s fixed, confirming the fix actually worked.',
        ],
      },
      {
        id: 'mp-skill-mismatch',
        label: 'Skill mismatch — high-cost staff on low-skill tasks',
        looksLike: 'Your most experienced (and most expensive) staff are spending time on tasks a junior or part-timer could do just as well.',
        actions: [
          'Map out who\u2019s doing what for a typical shift — it\u2019s often more revealing than expected.',
          'Move routine or low-skill tasks (prep, cleaning, simple assembly) to lower-cost roles where possible.',
          'Protect your highest-skill staff\u2019s time for the tasks that genuinely need it — that\u2019s what the premium is actually paying for.',
        ],
      },
      {
        id: 'mp-no-sop-timing',
        label: 'No productivity standards / SOP timing benchmarks',
        looksLike: "There's no sense of how long a task 'should' take, so there's no way to tell an efficient shift from an inefficient one.",
        actions: [
          'Time your core recurring tasks once (prep for a standard shift, average ticket time) to set a realistic baseline.',
          'Share the baseline with the team as a target, not a punishment — most people work more efficiently once they know what "good" looks like.',
          'Revisit the baseline occasionally as your menu or process changes — a stale benchmark stops being useful.',
        ],
      },
      {
        id: 'mp-statutory',
        label: 'Statutory costs (EPF/SOCSO/EIS) miscalculated or mismanaged',
        looksLike: 'Payroll costs don\u2019t match what you expected, or you\u2019ve had a compliance issue or penalty around EPF, SOCSO, or EIS.',
        actions: [
          'Use Overhead & Manpower Calculator\u2019s built-in statutory tables (real EPF Third Schedule rounding, real SOCSO/EIS wage-band tables) rather than a rough percentage guess.',
          'Double-check any staff aged 60+ or non-citizen/non-PR separately — those tables don\u2019t cover those cases, and the real rates genuinely differ.',
          'Reconcile your actual KWSP/PERKESO statements against what you budgeted, at least quarterly.',
        ],
      },
      {
        id: 'mp-absenteeism',
        label: 'Absenteeism not managed',
        looksLike: 'Last-minute no-shows force expensive same-day fixes — calling someone in on overtime, or running short for the shift.',
        actions: [
          'Track absences by staff member and by day of week — patterns (always Mondays, always the same person) point to a specific, fixable cause.',
          'Build a small on-call/backup system for your busiest days specifically, rather than scrambling fresh every time.',
          'Address a repeat pattern directly and early — it rarely resolves itself on its own.',
        ],
      },
      {
        id: 'mp-owner-labor',
        label: "Owner's own labor not counted as a cost",
        looksLike: 'You (or a family member) work full shifts for free, so the true cost of running the business is hidden — it looks more profitable than it really is.',
        actions: [
          "Give yourself a real, market-rate wage line in your own costing, even if you don't draw it as actual cash yet — Interactive Costing Analysis's manpower field literally prompts for this.",
          'Use that fully-loaded number when deciding whether the business is genuinely profitable, not the number with your own labor stripped out.',
          'This matters most if you ever plan to hire someone to replace your own role — that\u2019s the real cost you\u2019d be taking on.',
        ],
      },
      {
        id: 'mp-onboarding',
        label: 'Poor onboarding slows new hires down for too long',
        looksLike: 'New staff take much longer than they should to reach normal speed or accuracy, which shows up as lower output per labor RM spent during that stretch.',
        actions: [
          'Write your SOPs down once, properly, rather than relying on verbal training passed shift to shift — it pays for itself the first time it\u2019s reused.',
          "Pair every new hire with an experienced staff member for a defined first-week period, not an open-ended 'figure it out.'",
          'Set a simple checkpoint (a 2-week check-in, say) to catch a struggling new hire early, rather than after months of below-par output.',
        ],
      },
      {
        id: 'mp-cross-training',
        label: 'No cross-training — single points of failure',
        looksLike: "If one specific person is out, that station simply doesn't run properly — forcing you to overstaff 'just in case' that person is ever absent.",
        actions: [
          'Cross-train at least one backup person for every critical station.',
          'Rotate staff through different stations periodically, even when fully staffed, so cross-training stays current.',
          'This directly reduces the "just in case" overstaffing buffer described under Overstaffed above — the two usually travel together.',
        ],
      },
    ],
  },

  margin: {
    causes: [
      {
        id: 'mg-not-engineered',
        label: 'Menu not engineered to true cost & contribution margin',
        looksLike: 'Prices were set once, or copied from a competitor, rather than built up from actual cost plus a target margin per dish.',
        actions: [
          'Cost every dish properly in Menu Calculator, then set price FROM the Target Food Cost %, rather than the other way around.',
          "Use Margin Analysis's own Star / Plowhorse / Puzzle / Dog chart to see which dishes are genuinely earning their keep — the standard menu-engineering view for exactly this question.",
          'Push Stars (popular AND profitable) harder in how the menu is presented; rework or reprice Dogs (neither popular nor profitable).',
        ],
      },
      {
        id: 'mg-stagnant-pricing',
        label: 'Menu prices not reviewed as ingredient costs rise',
        looksLike: "Ingredient costs have crept up over time, but menu prices haven't moved to match — the gap between the two IS the margin loss.",
        actions: [
          'Re-check true cost vs. current price at least quarterly (see "Menu costing not updated" under Ingredients above — the two issues are closely linked).',
          'Small, regular price adjustments are generally easier for customers to accept than one large, overdue jump.',
          "If you're reluctant to move headline prices, consider a portion or recipe adjustment instead — but re-cost it properly rather than guessing.",
        ],
      },
      {
        id: 'mg-discounting',
        label: 'Discounting / promotions run without margin impact analysis',
        looksLike: "A promo looked good for driving traffic, but nobody checked what it actually did to margin on those specific orders.",
        actions: [
          'Before running a promo, calculate margin at the DISCOUNTED price, not the full price — a 20% discount on a 30%-margin item can wipe the margin out entirely.',
          'Prefer discounting or bundling your lower-food-cost items, where there\u2019s more room, over your tightest-margin dishes.',
          'Track sales and margin during and after a promo period specifically, so you actually know whether it worked.',
        ],
      },
      {
        id: 'mg-delivery-commission',
        label: 'Delivery-app commission not priced in',
        looksLike: "The same dish is priced identically on a delivery app as dine-in, quietly letting the platform's commission eat margin on every delivery order.",
        actions: [
          "Use Menu Calculator's own delivery-app toggle to gross up delivery pricing properly — the same target margin should apply on every channel, not just dine-in.",
          'Check whether your delivery price is actually different from your dine-in price right now — if it\u2019s identical, this is very likely happening.',
          'Review commission and tax-on-commission rates periodically — platforms do change them.',
        ],
      },
      {
        id: 'mg-low-volume',
        label: 'Low sales volume — fixed costs not spread over enough covers',
        looksLike: 'Fixed costs (rent, base staffing) are the same whether you sell 50 or 150 portions a day, so low volume alone can push margin down even with healthy per-dish pricing.',
        actions: [
          'Check your break-even volume in Interactive Costing Analysis, and compare it honestly against your actual daily volume.',
          'If you\u2019re below break-even, the fastest lever is usually volume (marketing, hours, visibility) rather than cutting costs further, which has a floor.',
          'If volume genuinely can\u2019t grow at this location, that\u2019s worth confronting directly, even if the conclusion is uncomfortable.',
        ],
      },
      {
        id: 'mg-upsell',
        label: 'Poor upselling / cross-selling — low average check',
        looksLike: "Each table or order could reasonably include one more item — a drink, a side, a dessert — but usually doesn't, because staff aren't prompted or trained to suggest it.",
        actions: [
          "Pick 2-3 specific, natural upsell pairings — not a vague 'upsell more' — and train staff exactly when and how to mention them.",
          'Track average check size over time — a small, steady increase compounds meaningfully across a month.',
          'Menu placement matters too — put higher-margin add-ons somewhere they\u2019re actually seen, not buried.',
        ],
      },
      {
        id: 'mg-hero-subsidy',
        label: 'High-cost items subsidizing low-margin promos disproportionately',
        looksLike: "A generous, high-cost 'value' item or combo is quietly dragging down blended margin more than its popularity justifies.",
        actions: [
          'Check the true cost and margin of your combo/value deals specifically, not just individual items — combos are a common blind spot.',
          'If a combo is a deliberate loss-leader to drive traffic, make sure that\u2019s a conscious choice with a clear reason, not an accident.',
          'Rebalance a combo\u2019s contents (swap one high-cost component) rather than dropping it outright, if it\u2019s popular for a reason.',
        ],
      },
      {
        id: 'mg-unpriced-extras',
        label: "Un-priced 'value adds' eroding margin silently",
        looksLike: "Free refills, extra sauces, or generous sides feel like good service, but nobody's checked what they actually cost across every order.",
        actions: [
          "Cost your 'free' extras properly, the same way you'd cost any other menu item — a habit of small unpriced extras adds up over time.",
          'Decide deliberately which of these are worth keeping as a genuine differentiator, and price the rest in — even a small line-item charge, or build it into the base price.',
          'This is usually many small leaks rather than one big one — worth a proper audit rather than a guess.',
        ],
      },
    ],
  },
};

/* ================= DAILY WASTAGE LOG =================
   Straight from a real operational SOP a user shared directly
   (document code SOP-KIT-WS01, "Borang Kawalan Kebocoran &
   Pembaziran Dapur Harian" \u2014 Daily Kitchen Leakage & Wastage
   Control Form): six reason codes, used verbatim rather than
   inventing a different set, since a business already running
   that SOP may have staff already trained on exactly these
   letters. Genuinely complementary to the Wastage & Par-Level
   Tracker below rather than a duplicate of it \u2014 this is an
   event log (what happened, right when it happened, and why);
   the tracker is a period reconciliation (how much moved off the
   shelf in total, worked out from stock counts). A kitchen using
   only one of the two has a real blind spot the other one covers. */
const REASON_CODES = [
  { code: 'A', label: 'Expired / spoiled in storage' },
  { code: 'B', label: 'Burnt / overcooked' },
  { code: 'C', label: 'Spilled / dropped / mishandled' },
  { code: 'D', label: 'Customer return (complaint)' },
  { code: 'E', label: 'Wrong cut / over-portioned' },
  { code: 'F', label: 'Taste test / unrecorded sampling' },
];

// Not from the source form (it left this column's values undefined) —
// a reasonable general F&B default set. Free-text "Other" always
// covers anything that doesn't fit.
const WASTAGE_LOG_CATEGORIES = ['Protein', 'Vegetable', 'Dairy', 'Dry goods', 'Beverage', 'Prepared dish', 'Other'];

/* ================= JARGON INDEX ================= */
const JARGON = [
  { term: 'Food cost % (ingredient cost %)', def: 'What you spend on ingredients and packaging for a dish, as a % of what it sells for. The classic full-service benchmark is roughly 28-35% — see the guide ratios above, which scale this down or up depending on how lean your format is.' },
  { term: 'Prime cost', def: 'Ingredient cost + labor cost, added together. Often treated as the single most important number in F&B cost control, since together they usually make up the majority of what can actually be managed day to day.' },
  { term: 'FIFO (First In, First Out)', def: 'Using or selling the oldest stock first, so nothing sits at the back of a shelf or fridge until it spoils.' },
  { term: 'Par level', def: 'The stock-on-hand target you set for an ingredient, based on how much you typically use before your next delivery arrives. Ordering "up to par" replaces guessing with a repeatable number.' },
  { term: 'Yield %', def: 'How much of an ingredient is actually usable after trimming, cooking loss, or prep — as a % of what you bought. A recipe costed on an assumed yield that turns out lower than reality will always under-state true food cost.' },
  { term: 'Theoretical vs. actual cost (variance)', def: 'Theoretical cost is what food cost SHOULD be, worked out from your sales and recipe costs. Actual cost is what it REALLY was, from purchases and stock counts. The gap between the two is where wastage, theft, and portioning problems get caught.' },
  { term: 'Contribution margin', def: 'Selling price minus variable cost per portion — what\u2019s left over from each sale to cover fixed costs and, beyond that, profit.' },
  { term: 'Menu engineering (Stars / Plowhorses / Puzzles / Dogs)', def: "The standard way to classify menu items by popularity against contribution margin: Stars are popular and profitable, Plowhorses are popular but thin-margin, Puzzles are profitable but rarely ordered, and Dogs are neither. Margin Analysis's own quadrant chart uses this exact framework." },
  { term: 'COGS (Cost of Goods Sold)', def: 'The direct cost of what you sold in a period — for F&B, this is essentially your ingredient/packaging cost.' },
  { term: 'Break-even point', def: 'The sales volume at which revenue exactly covers total cost — below it you\u2019re losing money, above it every extra sale adds to profit.' },
  { term: 'Cost creep', def: "A gradual, often unnoticed rise in a cost category over time — rarely one dramatic event, usually a slow drift that only becomes obvious once it's measured against a benchmark like the guide ratios above." },
  { term: 'Fixed vs. variable overhead', def: 'Fixed overhead stays roughly the same regardless of sales volume (rent, licenses). Variable overhead changes with usage (utilities, consumables). Separating the two shows you what\u2019s actually controllable month to month.' },
  { term: 'SOP (Standard Operating Procedure)', def: 'A written, standard way of doing a task — a recipe card, a portioning guide, a receiving checklist — so the outcome doesn\u2019t depend on who\u2019s on shift.' },
];
