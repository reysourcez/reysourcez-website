# Costing Analysis — change notes

(Covers `interactive-costing-analysis.html` / `.js` — this session's own
tool. Kept as a separate file from `MARGIN_AUDIT_CHANGE_NOTES.md`, which
the parallel session on Margin Analysis maintains — the two sides
coordinate through the shared standard docs (`EXPORT_IMPORT_FORMAT.md`,
`COST_BUFFER_STANDARD.md`, `PANEL_TOGGLE_STANDARD.md`,
`CROSS_TOOL_IMPORT_STANDARD.md`), not by editing each other's code or
changelog directly.)

## 2026-09-19 — Brought into full compliance with CROSS_TOOL_IMPORT_STANDARD.md (written by the Margin Analysis session, 2026-09-18)

**What prompted this.** `CROSS_TOOL_IMPORT_STANDARD.md` arrived naming
this page's own `importDataFile()` as the reference implementation
everyone else was modeled on. Checked it against the standard's own
5-step retrofit checklist anyway, since "reference implementation"
isn't the same as "audited" — and it turned up two real gaps, plus one
separate bug the standard doesn't mention but its own stated goal
("importing a file and having the other tool open in another tab
produce identical results, one code path either way") implies should
never happen.

**Gap 1 — helper text was missing entirely.** The standard requires
helper text next to an importer's button naming every accepted shape,
in plain language, updated in the same commit the accepted set
changes. Costing Analysis's "Import data" button had no helper text at
all — Margin Analysis's own version at least had some, just briefly
stale. Fixed with a `.tooltip-icon` next to the button — the same spot
Margin Analysis's own "Export data" button already uses one — naming
all three accepted shapes.

**Gap 2 — the doc-comment above `importDataFile()` was stale.** It said
a Margin Analysis export was "not yet" handled; the code three lines
below it already handled it. Rewritten to describe all three shapes
correctly and to point at `CROSS_TOOL_IMPORT_STANDARD.md`, per that
doc's own checklist step 5.

**Real bug, previously invisible — `costBufferPct` silently dropped on
the file-import path.** Menu Calculator's live broadcast has carried
`costBufferPct` since 2026-09-16 (`COST_BUFFER_STANDARD.md`), and its
`.json` export carries it too (`EXPORT_IMPORT_FORMAT.md`) — but
`importDataFile()` never forwarded it into the `handleSyncPayload()`
call, only the live-sync path did. So a dish synced live and the
*same* dish imported from a file could disagree on this one field,
quietly — exactly what the "one code path either way" design is
supposed to prevent. Fixed: `costBufferPct` now threads through
identically on both paths.

**Small feature riding on that fix.** Now that the field actually
reaches this page, added the same touch Margin Analysis added on its
own side (see its 2026-09-17 entry): the "synced" badge next to
Ingredients & packaging now reads "← Menu Portion Creator (Dish Name,
incl. 10% cost buffer)" whenever the source dish had its buffer on —
via live sync or an imported file, identically. Purely informational,
same as Margin Analysis's version — nothing in the break-even math
reads it.

**Small unrelated fix, found while diffing this page against its
siblings for this round:** `styles.css?v=18` → `?v=19`.
`menu-calculator.html` and `margin-audit-calculator.html` were both
already on `v=19` (current since the 2026-09-16 Cost Buffer CSS
additions); this page alone was a version behind — meaning a browser
that had cached this page from before that date could still be serving
stale, pre-Cost-Buffer CSS to it specifically.

**Also hardened:** every branch of `importDataFile()`'s dispatcher now
guards with `data &&` before reading `data.rzExportType`, matching
Margin Analysis's own dispatcher. A file containing literal JSON
`null` (valid JSON — parses fine) used to throw, uncaught, inside the
`FileReader.onload` handler past that point; it now falls through
cleanly to the "Unrecognised file" alert instead.

**Version bumps:** script build tag
`2026-09-16-panel-toggle-standard` → `2026-09-19-cross-tool-import-parity`;
`interactive-costing-analysis.js?v=15` → `?v=16`.

### The cross-tool picture, as it stands today

```mermaid
flowchart LR
    MC["Menu Calculator<br/>(source-role)"]
    OM["Overhead and Manpower<br/>(source-role)"]
    CA["Costing Analysis<br/>(importer-role)"]
    MA["Margin Analysis<br/>(importer-role)"]

    MC -- "live, same browser" --> CA
    MC -- "live, same browser" --> MA
    OM -- "live, same browser" --> CA
    OM -- "live, same browser" --> MA

    MC -- "Export data" --> MCF[("menu-calculator<br/>export.json")]
    OM -- "Export data" --> OMF[("overhead-manpower<br/>export.json")]
    MA -- "Export data" --> MAF[("margin-analysis<br/>export.json")]

    MCF -- "Import data" --> CA
    MCF -- "Import data" --> MA
    OMF -- "Import data" --> CA
    OMF -- "Import data" --> MA
    MAF -- "Import data" --> CA
```

Both arrows into any importer (live or file) now converge on that
importer's own `handleSyncPayload()` for the Menu Calculator and
Overhead & Manpower shapes. The one exception is Margin Analysis's own
export arriving at Costing Analysis — it has no live-sync equivalent
to converge with, so that branch populates `importedQuadrants`
directly instead.

### What this deliberately did NOT touch

- Menu Calculator's or Overhead & Manpower's own export code — both
  already produce the right shape, and per the standard, source-role
  tools don't get an import feature of their own.
- A Costing-Analysis-side export — nothing downstream wants to import
  a break-even analysis today, so this page stays importer-only.
  Revisit only if that changes.
- No new user-configurable value was introduced this round, so there's
  nothing new for a settings sheet this time — this was a
  consistency/parity pass, not a new feature with its own rate or
  default.

### Jargon index (terms specific to this round)

| Term | Plain-English meaning |
|---|---|
| Source-role tool | Only ever produces data for others to read (Menu Calculator, Overhead & Manpower) — no import feature of its own. |
| Importer-role tool | Reads data from siblings (Costing Analysis, Margin Analysis) — owns an `importDataFile()`. |
| `rzExportType` | The field inside every exported `.json` that says which tool produced it — how an importer knows what it's looking at. |
| `costBufferPct` | The % of Menu Calculator's dish-level Cost Buffer actually applied — informational only; the cost figure it rides alongside (`costPerPortion`) is already the true, buffered number either way. |
| `handleSyncPayload()` | The one function, per tool, that actually applies an incoming number — shared by the live path and the file-import path so the two can't quietly drift apart. |
| Live sync vs. file import | Two delivery mechanisms for the same data: live (another tool open in a browser tab right now) or a saved `.json` (a different day/device/person). |

### Testing done, given I can't render a browser here

`node --check` on the full JS file (clean). Every `getElementById`/
`querySelector` this round's edits touch, cross-checked against the
HTML — no new ids introduced, only existing ones read. Traced
`costBufferPct` by hand through both paths: (a) a Menu Calculator block
with the buffer on → live broadcast → `handleSyncPayload` →
`syncedMenuItems` → `applySyncedMenuItem` → badge includes the note;
(b) the same block → `exportMenuData()` → saved file →
`importDataFile()` → same `handleSyncPayload` call → same badge text.
Both now produce identical output for the same source dish.

**Worth testing directly, since I can't run a browser here:** export a
dish from Menu Calculator with Cost Buffer on, import that file into
Costing Analysis, and confirm the "incl. N% cost buffer" note shows
next to Ingredients & packaging — then do the same with Menu
Calculator open live in a second tab instead of a file, and confirm
the note reads identically either way.

## KIV / open items

- **A genuinely separate, non-code settings sheet** (change a value
  without opening any `.js` file) doesn't exist anywhere on this site
  yet — every tool's defaults are still plain JS constants with a
  markdown table alongside documenting *where* to change them in the
  code, not a true externally-editable source. Flagging this against
  your own stated preference for one — not something this round
  solved. A real fix (e.g. one `site-config.json` every tool
  `fetch()`s at load, still no build step) is a scoped, separate piece
  of work if you want it built next — happy to spec it out.
- Everything already flagged as open in `CROSS_TOOL_IMPORT_STANDARD.md`
  (Printing Calculator, Food Worth, Rental Calculator not yet
  retrofitted) is unchanged by this round.

## Deploy checklist

- [ ] Replace `interactive-costing-analysis.js` and
      `interactive-costing-analysis.html` with the two files delivered
      alongside this note — both full-file replacements, not patches.
- [ ] Also replace your copy of `CROSS_TOOL_IMPORT_STANDARD.md` with
      the updated one delivered alongside this note (or hand it to the
      Margin Analysis session — it's the doc it wrote), one new
      section added at the end, nothing else changed.
- [ ] No changes needed to `menu-calculator.js/.html`,
      `overhead-manpower-calculator.js/.html`,
      `margin-audit-calculator.js/.html`, `styles.css`,
      `panel-toggle.js`, or `costing-sync.js` — none touched this
      round.
- [ ] Confirm the deployed `menu-calculator.js` already broadcasts
      `costBufferPct` (shipped 2026-09-16) — if an older version is
      still live somewhere, the new badge note just never shows, no
      error (degrades gracefully, not a hard dependency).
