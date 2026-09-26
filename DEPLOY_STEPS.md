# Path A Pilot — Deploy Steps

**What this proves:** that a Cloudflare-hosted page can show your real
Rentals data, live, read-only. Nothing writes to your Sheet yet — that
comes after this is confirmed working. I could not test this live myself
(no live internet access from where I build), so please verify each step
as you go, same as every other piece of this project.

## Part 1 — Add the read-only API to Apps Script

1. Open the CDM Google Sheet → **Extensions → Apps Script**.
2. Add a new file: **File → New → Script**, name it `07_WebAPI`, paste in
   the full contents of `apps-script/07_WebAPI.gs` from this bundle.
3. Open `06_Signatures.gs`. Find the very first line of `doGet(e)`:
   ```
   function doGet(e) {
     const template = HtmlService.createTemplateFromFile('SignPage');
   ```
   Paste these 3 lines **immediately after** `function doGet(e) {`, before
   the `const template` line:
   ```
   if (e && e.parameter && e.parameter.api) {
     return handleApiRequest_(e);
   }
   ```
   That's the only change to this file. The signing page's own logic
   below it is untouched — it only runs when there's no `?api=` in the URL.
4. Save both files.
5. **Deploy → Manage deployments → pencil (edit) icon → Version: New
   version → Deploy.** This is the same step SETUP_NOTES.md already
   describes for any code change — the Web App URL stays the same, only
   the version changes.
6. **Verify it yourself first:** open this in a browser tab (your real
   Web App URL, with `?api=rentals` on the end):
   ```
   https://script.google.com/macros/s/AKfycbzJvvmVb_lEcjNH-UPOVjX7HPLOYQt6Yj6WJcUqa7rjX4CkWrgp_UXuCEZE24JOGY2GWQ/exec?api=rentals
   ```
   You should see plain JSON text listing your rentals. If you see an
   error page instead, stop here and check step 3 before moving on —
   nothing in Part 2 will work until this step does.

## Part 2 — Deploy the Cloudflare Worker

1. If you don't have one: create a free account at **cloudflare.com**.
2. Install **Node.js** on your computer if it isn't already (needed to
   run the deploy tool — nodejs.org, the LTS version).
3. Open a terminal in this `cdm-cloudflare` folder and run:
   ```
   npx wrangler login
   ```
   This opens a browser tab to connect your Cloudflare account — approve it.
4. Then run:
   ```
   npx wrangler deploy
   ```
   Wrangler will ask a couple of setup questions the first time; accept
   the defaults. When it finishes, it prints a URL — something like
   `https://cdm-rental-docs.<your-subdomain>.workers.dev`.
5. Open that URL. You should see the same dashboard as the earlier
   preview, but the rentals list is now pulled live from your real Sheet.
   Everything past the dashboard (rental detail, the inspection form) is
   still the look-and-feel preview from before — not wired up yet.

## If step 5 shows "Could not load rentals..."

Almost always means Part 1's URL check (step 6 above) wasn't passing yet.
Re-check that first — it isolates whether the problem is on the Google
side or the Cloudflare side.

## Honest caveat

This `.workers.dev` URL is public to anyone who has it, same as your
signing link already is — there's no login on it yet. Fine for testing
between us; before anyone else gets the link, the next piece to add is
Cloudflare Access (free, up to 50 users) to put a login in front of it.
