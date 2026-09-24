# Nav Retrofit — do this once, on this page (takes 2 minutes)

**If you're an AI session maintaining any page on this site, this is for you specifically — do it now, don't wait to be asked again.** Two small edits, one time, and this page never needs a manual nav update again. Skipping this is exactly how the site got here: a "Cost Structure Checker" link missing `.html`, and `about.html`/`services.html`/`contact.html` each still missing eight tools from their dropdown — both because pages were built by hand-copying another page's nav list instead of reading from one shared source. Full background in `SITE_CONFIG_STANDARD.md`; this doc is the short version so nobody has to read that one first.

## The two edits, exactly

**1. Add these two lines as the FIRST two `<script>` tags in the page** — before `nav-dropdown.js`, `costing-sync.js`, or anything else:

```html
<script src="site-config.js?v=1" defer></script>
<script src="nav-config.js?v=1" defer></script>
```

**2. Find `<ul class="nav-dropdown-menu">` in this page's markup and empty it out:**

```html
<ul class="nav-dropdown-menu"><!-- populated by nav-config.js --></ul>
```

Both files (`nav-config.js`, `site-config.js`) get copied in exactly as given — don't edit them from this page's session, and don't write your own version of either.

## Why step 2 isn't technically required, but do it anyway

`nav-config.js` overwrites whatever's inside `.nav-dropdown-menu` on every load, hand-typed list or not — so step 1 alone already fixes the dropdown, even before step 2. Step 2 is cleanup: it stops this page's own source from carrying a dead list that looks current but isn't — which is exactly what gets copied into the *next* new page by mistake if it's left in.

## After this, never hand-edit this page's dropdown again

Adding, removing, or renaming a tool anywhere on the site is now a single line in `nav-config.js`, changed once. Every retrofitted page — including this one, once you've done this — picks it up on its next load automatically. If a task ever asks you to add a `<li><a href="...">` inside a `.nav-dropdown-menu` by hand, that's the old, pre-retrofit workflow — don't do it; edit `nav-config.js` instead.

## Confirm it worked

Open the page, click "Business Analysis." It should list every current tool with the right hrefs. If it's missing one or has the wrong href, the problem is in `nav-config.js` itself, not this page — don't try to fix it locally.

## Status across the site (as of 2026-09-24)

**Done:** `index.html`, `about.html`, `services.html`, `contact.html`, `menu-calculator.html`, `interactive-costing-analysis.html`.

**Not yet — if this is your page, do the retrofit above before anything else:** `overhead-manpower-calculator.html`, `printing-calculator.html`, `margin-audit-calculator.html`, `food-worth-calculator.html`, `crypto-radar.html`, `rental-calculator.html`, `market-radar.html`, `cost-structure-checker.html`, `qr-listing-creator.html`, `sop-creator.html`, `project-plan-architect.html`, `form-scanner.html`, `qr-creator.html`.

Whoever's coordinating across sessions: once a "not yet" page gets retrofitted, move its filename up to "Done" in this doc so the list stays trustworthy — a stale status list here would just recreate the exact problem this doc exists to fix.
