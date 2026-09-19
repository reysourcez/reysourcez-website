# Cross-tool file import — standard (added 2026-09-18)

**For the AI building or updating any page.** Paste this alongside `AI_BUILD_BRIEF.md`, same as `NAV_ORDER_STANDARD.md`, `COST_BUFFER_STANDARD.md`, and `PANEL_TOGGLE_STANDARD.md` — treat it as a hard rule, not a suggestion. Written by the session that owns Margin Analysis, after bringing that page's own file-import up to parity with Costing Analysis's — this doc names the pattern both pages now share so a third page doesn't reinvent it slightly differently, and so a future session doesn't "fix" the two into disagreeing by editing one without the other in view.

## The underlying idea

`EXPORT_IMPORT_FORMAT.md` already covers the file *shape* — the shared envelope (`rzExportType`, `rzExportVersion`, `exportedAt`) and each tool's own fields. This doc covers something that doc doesn't: **which tools should have an import feature at all, and the one mechanical pattern every importer should follow.**

Not every tool needs to read files from its siblings. Two roles exist on this site today:

- **Source-role tools** — produce their own data for others to read, have no meaningful use for anyone else's export. **Menu Calculator** and **Overhead & Manpower** are both this. Each gets an "Export data" button (per `EXPORT_IMPORT_FORMAT.md`) and needs nothing else — no file input, no importer.
- **Importer-role tools** — combine data *from* other tools into their own analysis. **Costing Analysis** and **Margin Analysis** are both this. Each reads one or more sibling export types through the pattern below.

A tool can in principle be both (produce its own export AND import others') — none currently are, but nothing here rules it out. When building a new tool, ask which role it plays before copying either half of this pattern: if it only ever produces data (no sibling's numbers ever feed into it), it needs an export button and nothing importer-shaped; don't add a file input that reads nothing anyone would ever hand it.

## The rule, for any importer-role tool

**One file input, auto-detecting type from the file's own content — never a separate button per source format.** The person picks a file; the code reads `rzExportType` (or, for a tool's own private full-state save, whatever marker field it already uses — see Margin Analysis's `tool: 'margin-audit-calculator'` below) and dispatches accordingly. Costing Analysis's `importDataFile()` already does this for three shapes; Margin Analysis's own `importDataFile()` (renamed to match, see below) now does the same for three shapes of its own.

**The dispatcher never re-implements field-mapping — it hands off to the exact function the tool's own live BroadcastChannel sync already uses.** Every tool on this site with a "Pull from" connector already has a `handleSyncPayload(data)` (or equivalently-named) function that knows how to apply a `{ source: '...', ...fields }` payload arriving live over `costing-sync.js`. An imported file should build that *exact same* payload shape per entry and call that *exact same* function — never a second, parallel set of `document.getElementById(...).value = ...` lines that has to be kept in sync with the live-sync branch by hand. This is what makes "synced live, in another tab, right now" and "imported from a file saved yesterday" produce identical results through one code path, and it's the whole reason `EXPORT_IMPORT_FORMAT.md`'s field names deliberately match the live-broadcast payload's own field names in the first place.

**Name the function `importDataFile(file)`.** Both pages that do this now use that exact name — matching it on a third page costs nothing and means anyone jumping between pages recognizes the pattern instantly rather than hunting for whatever a given page happened to call it.

**The button's own label can stay whatever fits the page's voice** — Costing Analysis says "Import data," Margin Analysis says "Load previous month's data" because that's its primary use case and the other two accepted shapes are a bonus layered on top. **The helper text next to it cannot drift from what the dispatcher actually accepts.** Margin Analysis's own helper text said "Only upload a data file saved from this tool" right up until today, when the dispatcher had already been widened to accept two more shapes — caught only because the code was being touched anyway. Whenever an importer's accepted-format set changes, its helper text changes in the same commit, not "eventually."

## Worked example — what Margin Analysis just did

```js
function importDataFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) { /* ...alert, return */ }

    if (data && data.tool === 'margin-audit-calculator') {
      importOwnSnapshot(data); // this page's own full-state round trip, unchanged
    } else if (data && data.rzExportType === 'menu-calculator' && Array.isArray(data.blocks)) {
      data.blocks.forEach((b) => {
        handleSyncPayload({ source: 'menu-calculator', blockId: b.blockId, costPerPortion: b.costPerPortion, costBufferPct: b.costBufferPct, sellingPrice: b.sellingPrice, dishName: b.dishName });
      });
    } else if (data && data.rzExportType === 'overhead-manpower-calculator') {
      handleSyncPayload({ source: 'overhead-manpower-calculator', overheadMonthly: data.overheadMonthly, manpowerMonthly: data.manpowerMonthly });
    } else {
      alert('Unrecognised file...');
    }
  };
  reader.readAsText(file);
}
```

Note `data.tool === 'margin-audit-calculator'` (own private full-state save, not part of the shared interchange format) sits in the *same* dispatcher as the two `rzExportType`-based sibling formats — a tool's own private save format and the shared cross-tool format aren't in tension, they're just two more shapes the one dispatcher recognizes. Costing Analysis's own `importDataFile()` follows the identical shape, one `else if` per accepted `rzExportType`.

## Retrofit checklist, for a page that needs this and doesn't have it yet

1. Confirm the page is importer-role first (see "the underlying idea" above) — don't add this to a source-role page.
2. Find the page's existing live-sync handler (`handleSyncPayload` or whatever it's actually called) and confirm it already accepts the field shapes for whatever sibling exports matter to this page.
3. Write (or widen) `importDataFile(file)` as a plain `if`/`else if` chain on `rzExportType` (plus the page's own private marker field, if it has a full-state save format of its own), each branch calling the existing handler — never new field-mapping.
4. One file input, one button, whatever label fits the page. Helper text names every accepted shape, in plain language, not `rzExportType` strings.
5. Update the doc-comment above the dispatcher to point future readers at this standard, same as every other retrofit doc on this site asks for.

## Pages this currently applies to

**Importer-role (this pattern applies):** `interactive-costing-analysis.html` (reference implementation, built first), `margin-audit-calculator.html` (brought to parity 2026-09-18).

**Source-role (no action needed, don't add an importer):** `menu-calculator.html`, `overhead-manpower-calculator.html`. Both already have their own "Export data" button per `EXPORT_IMPORT_FORMAT.md`; neither has anything to gain from reading a sibling's export, since neither has fields that overlap with what any sibling produces. If either ever grows a field that genuinely could come from another tool's export, that's the moment to revisit this list — not before.

**Not yet built, revisit when they exist:** `printing-calculator.html`, `food-worth-calculator.html`, `rental-calculator.html`, and the three reserved-but-unbuilt tools in `NAV_ORDER_STANDARD.md` (Market Radar, Cost Structure Checker, QR Listing Creator). Classify each by the same source-role/importer-role question above before deciding whether it needs anything from this doc at all.
