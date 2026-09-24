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

## Audit Plans & Checklists (the Audits tab, added 2026-09-24)

The Performance tab's Internal/External audit tables are the **programme** level (ISO 19011 clause 5 — the year's schedule: which areas, how often, who). The **Audits** tab is the **individual audit** level (ISO 19011 clause 6.3 — objectives, scope, criteria, schedule, team for ONE audit) plus its **checklist** and **documents to request** (clause 6.3.3/6.3.5). Both levels are kept, deliberately — see the note on the Performance tab pointing users to Audits for the detailed version.

Worth knowing: **ISO 19011:2018 was superseded by a 4th edition, ISO 19011:2026, published May 2026** — a technical revision (clarifying/updating, not a rewrite) that leans further into remote/hybrid audit methods and explicitly supports combined audits across multiple management-system standards. Both of those show up directly in the Audits tab: the Method field (On-site/Remote/Hybrid) and the fact that one audit's Criteria list can span every selected standard at once.

**Data model** — each `.isoa-audit-card` is a self-contained card, not a simple repeat-row, because it holds nested state (fields + a checked-criteria list + a generated checklist + a generated document list). Fields are found by **class**, not `id` (`.audit-title`, `.audit-type`, ...), since multiple cards can exist and none of them get a unique numeric ID — every read/write is scoped via `card.querySelector(...)` or, for event handlers, `e.target.closest('.isoa-audit-card')`. `addRow()` was generalized to accept either a container `id` string (the original top-level sections) or an element reference directly (the per-card document list), so both share one function.

**`CLAUSE_AUDIT_BANK`** (in `iso-ms-architect.html`, not `site-config.js`) is a static key → `{ label, question, document? }` map: one entry per core clause (20: the fixed 4.1–10 topics) plus one per standard-specific Clause 8 topic (12, keyed by the *exact same strings* as `ISO_STANDARDS`' `clause8` arrays — verified byte-identical against each other when this was built). This is why the tool works fully **without** the AI Worker: "Generate checklist" pulls a real, specific question and a suggested document straight from this bank for every checked clause. The ✨ button per checklist row (`refine-checklist-question`, the 4th Worker kind) is an optional polish pass on top, not a requirement. All question/document text here is original phrasing for this tool — not copied from any certification body's proprietary checklist.

**Regenerating a checklist is additive, not destructive** — `generateAuditChecklist()` only adds rows for checked clauses that don't already have one (tracked via each row's `data-clause-key`) and only adds documents whose name isn't already listed (case-insensitive match). Unchecking a clause after generating does not auto-remove its row; the auditor removes it by hand if the scope genuinely changed. This was a deliberate call to avoid ever silently deleting evidence someone already typed in.

## Shared with `.ppa-*` — not centralized yet

`.isoa-*` (this tool's page-specific CSS) is a near-exact duplicate of `project-plan-architect.html`'s `.ppa-*` — same tabbed-panel-with-repeatable-rows shape, same reasoning both files give for their own prefix (avoid collision, same as `cost-structure-checker.js`'s `csc-`). With two instances of this pattern now, it's worth promoting into one shared class family in `styles.css` before a third tool copies it again — not done this round since it would mean also editing `project-plan-architect.html`, which wasn't part of this request. Flagged here per the KIV convention, same as `SITE_CONFIG_STANDARD.md`'s own open-items list.

## `iso-assist-worker.js` — deploy steps

Own Worker, own `GEMINI_API_KEY` secret, same shape as `pm-assist-worker.js`. Four kinds: `context-summary`, `policy-draft`, `suggest-risks-opportunities`, `refine-checklist-question` (the per-row ✨ on the Audits tab). Full deploy steps are in that file's own header comment (dash.cloudflare.com → Workers & Pages → paste the file → add the secret → paste the resulting URL into `RZ_ISOA_CONFIG.aiAssistEndpoint` near the top of `iso-ms-architect.html`). Off by default — every tab works fully without it.

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
- **Per-audit print/export** — right now a specific audit's Plan+Checklist only shows up as part of the full compiled Document (section "Audit Plans & Checklists"). A standalone "print just this audit" view (handy to hand a single sheet to an auditee ahead of time) isn't built — the full-document print already contains everything, this would just be a convenience.
- **Un-checking a criterion after generating its checklist row** doesn't remove that row automatically (see above) — worth a "sync checklist to criteria" button if this friction turns out to matter in practice, rather than assuming it's wanted.
- **Linking a closed Nonconformity (clause 10) back to the audit that raised it** isn't wired up — the two logs are independent today. Worth doing if cross-referencing turns out to matter more than the added complexity.
