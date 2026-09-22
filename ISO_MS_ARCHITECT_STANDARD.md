# ISO Management System Architect — standard (added 2026-09-23)

**For the AI or human updating this tool later.** Same spirit as `SITE_CONFIG_STANDARD.md` and `THEME_GUIDE.md` — this is the "why," so nobody has to reverse-engineer the code to find out. Pair with those two docs and `AI_BUILD_BRIEF.md` (not available in this session — if it has conventions beyond what's captured here, worth folding in).

## What this is

`iso-ms-architect.html` is the ISO equivalent of `project-plan-architect.html`: one fill-in-the-template tool, no build step, works fully offline with every field a plain input. The premise it's built on: since 2021, ISO's **Harmonized Structure (HS)** — the common clause framework that replaced the older "Annex SL" / "High Level Structure" naming — is shared, word-for-word in numbering, across every current ISO management-system standard (9001, 14001, 45001, 27001, 22301, 50001, and more). Clauses 4, 5, 6, 7, 9 and 10 are ~95% identical regardless of which standard you're building for; only the Policy field (5.2) and Clause 8 (Operation) genuinely diverge. One tool, one config object, most standards — that's the whole architecture.

Also baked in: the **climate-change amendment** ISO added to clause 4.1/4.2 in February 2024 (organizations must now explicitly determine whether climate change is a relevant issue, and whether interested parties have climate-related requirements) — see the Context tab.

## The standard-selector: both modes, one array

The user asked for flexibility (pick any combo of standards, integrated-system style) **but also** wanted a plain single-dropdown option kept available, not replaced. Both are built:

- **Single mode** — one `<select>`, one standard.
- **Multi mode** — checkboxes, any combination.

Both write into the exact same place: `getSelectedStandards()` returns a plain array of standard codes (`['9001']` or `['9001','14001','45001']`) regardless of which UI mode produced it. Nothing downstream — Policy fields, Clause 8, the Document tab — cares which mode was used. Switching modes mid-session doesn't lose data for fields that still apply.

## Clause 8 (Operation): de-duplicated by topic string

`renderOperationTab()` builds a `Map` of clause-8 topic → which standard code(s) list it, then renders **one field per unique topic**, tagged with every standard it came from. This is why 14001's and 45001's `clause8` entries both say `'Emergency preparedness & response'` **byte-for-byte** in `site-config.js` — picking both standards together shows that field once, not twice. Adding a new standard later: keep its wording identical to an existing topic only when it genuinely is the same requirement; otherwise a new, distinctly-worded topic renders as its own field, which is correct.

## Annex A / Statement of Applicability — deliberately incomplete

ISO/IEC 27001:2022 Annex A has 93 controls across 4 themes (Organizational 37, People 8, Physical 14, Technological 34). Those control **titles** are ISO/IEC's own copyrighted text from the standard itself. The SoA card in `renderOperationTab()` stops at the 4 theme names and asks the user to work the actual control list from their own copy of the standard — this is a copyright-driven choice, not an oversight. If this ever gets richer (e.g. an actual 93-row checklist), that content needs to come from the user's own licensed copy of the standard, not be generated or reproduced here.

## Internal vs. external/certification audits

Clause 9.2 is about **internal** audits only — self-performed, independent-of-the-area-audited. Real businesses preparing for certification also need to track their **certification body's** audit schedule (Stage 1, Stage 2, Surveillance, Recertification) and any second-party/supplier audits, which isn't itself a clause 9 requirement but is the practical companion to it. Performance Evaluation has two separate logs for this reason — labelled accordingly so nobody mistakes the external-audit tracker for an ISO requirement it isn't.

## Shared with `.ppa-*` — not centralized yet

`.isoa-*` (this tool's page-specific CSS) is a near-exact duplicate of `project-plan-architect.html`'s `.ppa-*` — same tabbed-panel-with-repeatable-rows shape, same reasoning both files give for their own prefix (avoid collision, same as `cost-structure-checker.js`'s `csc-`). With two instances of this pattern now, it's worth promoting into one shared class family in `styles.css` before a third tool copies it again — not done this round since it would mean also editing `project-plan-architect.html`, which wasn't part of this request. Flagged here per the KIV convention, same as `SITE_CONFIG_STANDARD.md`'s own open-items list.

## `iso-assist-worker.js` — deploy steps

Own Worker, own `GEMINI_API_KEY` secret, same shape as `pm-assist-worker.js`. Three kinds: `context-summary`, `policy-draft`, `suggest-risks-opportunities`. Full deploy steps are in that file's own header comment (dash.cloudflare.com → Workers & Pages → paste the file → add the secret → paste the resulting URL into `RZ_ISOA_CONFIG.aiAssistEndpoint` near the top of `iso-ms-architect.html`). Off by default — every tab works fully without it.

## Config shape (`site-config.js` → `isoStandards`)

```js
isoStandards: {
  '<code>': {
    name: 'Display name shown in dropdown/checkboxes/tags',
    policyLabel: 'What clause 5.2\u2019s field is called for this standard',
    clause8: ['Topic 1', 'Topic 2', ...], // rendered as one textarea per unique topic
  },
},
```

To add a standard (22301 Business Continuity and 50001 Energy are the two most likely next candidates): add one entry here. No changes needed in `iso-ms-architect.html` itself — it reads this object at runtime via the same `typeof RZ_SITE_CONFIG !== 'undefined'` guard every other retrofitted tool uses, falling back to an identical literal object if the config script hasn't loaded (verified byte-identical to this file's copy as of 2026-09-23).

## Retrofit status

Built already reading from `nav-config.js` / `site-config.js` from day one (new page, so it gets the standard immediately rather than needing a later retrofit like `project-plan-architect.html` still does). `nav-config.js` has its one new line; no other page needed touching.

## KIV / open items

- **Centralize `.ppa-*` / `.isoa-*`** into one shared class family in `styles.css` — see above. Two instances now; do it before a third appears.
- **Annex A detail** — if a fuller 93-control checklist is ever wanted, it needs to come from the business's own licensed copy of ISO/IEC 27001:2022, not be generated here.
- **22301 / 50001 / 37001 support** — straightforward config additions (see shape above) whenever those standards are actually needed; not added speculatively this round.
- **Combined vs. separate policy statements** — this tool renders one Policy field per selected standard (simpler to build, still fully valid for certification). Some integrated systems instead write a single combined policy statement covering all applicable standards — that's a genuine alternative, not built here; flagging rather than guessing which a given business wants.
- **AI-suggested Annex A controls** — deliberately left out of the ✨ buttons for now; reasoning which of 93 controls applies is a heavier, higher-stakes AI task than drafting a policy paragraph or suggesting starter risks, and deserves its own pass rather than shipping half-considered.
