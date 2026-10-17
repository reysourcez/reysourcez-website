CRYPTO RADAR v2.8 - RELEASE PACKAGE (built 2026-10-17)
=======================================================

WHAT IS NEW
The backtest page now has a "Relationship study". It asks whether the altcoins
move WITH, AGAINST or AFTER Bitcoin, the Nasdaq Composite and the S&P 500.
It only describes the past. It adds no buy or sell rule, and a link it finds is
not a forecast and not proof of cause.

WHAT TO DO (about 10 minutes, no coding)
1. Upload the two files in the folder 1-UPLOAD-TO-YOUR-SITE to your website,
   into the same place as styles.css:
      crypto-radar-backtest.html   replaces the old file with the same name
      crypto-radar-relations.js    is new
   Nothing else changes. Do NOT redeploy the Cloudflare Worker.
2. Open the backtest page and press Ctrl+F5 (hard refresh). The small line at
   the top must say "Relationships v1.0 (suite v2.8)".
3. Go to fred.stlouisfed.org and search for NASDAQCOM. Click Download above the
   chart and choose CSV. Do the same for SP500 (FRED keeps only about 10 years
   of it). Use the files as they come; do not edit them.
4. On the backtest page, find "Relationship study". Load each file in its box,
   leave the coins on "All" and press "Run relationship study". The first run
   takes a minute or two.
5. Click in the "Copy results for Claude" box, copy everything and paste it into
   a new chat in your "crypto app" project on claude.ai.

WHAT IS IN THIS ZIP (each file once)
   1-UPLOAD-TO-YOUR-SITE\          the two files for your website
   2-READ\                         SETUP_AND_GLOSSARY.md (guide and jargon list)
                                   CRYPTO_RADAR_HANDOFF.md (technical file for the next
                                   AI chat; section 22 is the newest, read it first)
   3-CHECKS-NOT-FOR-THE-SITE\      crypto-radar-tests.js and crypto-radar-browser-smoke.js
                                   (the test programs, for Claude or a developer;
                                   never upload these to the site)

VERSIONS
   crypto-radar-backtest.html      page v1.6 + big movers v1.2 + relationships v1.0 (suite v2.8)   CHANGED
   crypto-radar-relations.js       Relationship Study v1.0 (suite v2.8), loaded as ?v=1            NEW
   SETUP_AND_GLOSSARY.md           v2.8                                                            CHANGED
   CRYPTO_RADAR_HANDOFF.md         sections 1-22 (22 is new)                                       CHANGED
   crypto-radar-tests.js           v2.8, 105 checks                                                CHANGED
   crypto-radar-browser-smoke.js   v2.8, 28 checks                                                 CHANGED

STAYS AS IT IS (already on your site, unchanged in v2.8, so not in this zip)
   crypto-radar.html, crypto-radar.js (v2.0), crypto-radar-backtest.js (v1.6),
   crypto-radar-bigmovers.js (v1.2), crypto-radar-worker.js (Worker v2.1), styles.css

GOOD TO KNOW
- Claude's test setup has no real Luno data, so your first run is the live check.
- The study assumes a Luno daily candle starts at 00:00 UTC (Luno's documents do
  not say). The page checks this and prints a warning if it is not so. If you see
  that warning, do not trust the Nasdaq and S&P 500 rows, and tell Claude.
- How the new section looks with your real styles.css has not been checked.
- If the page cannot read a file, it says what it saw in it. Paste that message
  into the chat.
- The older backtest and big-mover result boxes still say "suite v2.7". That is
  on purpose: those two scripts did not change.
- Everything here is also in your "crypto app" project on claude.ai (the new
  module is stored there as claude/crypto-radar-relations.js).
