# Cross-tool file export/import format

Written 2026-09-08 by the session that owns Menu Calculator, Overhead &
Manpower, and Costing Analysis — for the session building Margin
Analysis to build against, so both sides agree on one shape without
needing a live back-and-forth. Menu Calculator and Overhead & Manpower's
export side, and Costing Analysis's import side, are already built and
live. Margin Analysis's export side is the one piece described here
that doesn't exist yet — that's this doc's actual purpose.

## Why a file, not just the existing live sync

`costing-sync.js`'s BroadcastChannel already lets tools that are open
in tabs *right now, in the same browser* hand data to each other live.
This is for the case that doesn't cover: Menu Calculator used this
morning, Overhead & Manpower used yesterday, Costing Analysis opened
tomorrow — or handed to a different person entirely. A plain `.json`
file saved from one tool and opened in another covers that gap. Not
Excel: same goal (structured, re-importable), but no library to load
and no risk of a hand-edited spreadsheet parsing wrong.

## The mechanics (copy this pattern exactly, both directions)

**Export** — a small Blob-and-anchor download, no library:

```js
function downloadJSONFile(filename, dataObj) {
  const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

**Import** — a hidden `<input type="file" accept=".json" hidden>`, triggered by a visible button, read with `FileReader` + `JSON.parse`. See Costing Analysis's `importDataFile()` for the reference implementation.

**UI placement**: an "Export data" (or "Import data") button next to the existing "Save as PDF" button, both wrapped in `.header-actions` (already in `styles.css`) — same top-right spot, not a new location.

## Every export file's shared envelope

```json
{
  "rzExportType": "menu-calculator",
  "rzExportVersion": 1,
  "exportedAt": "2026-09-08T12:34:56.000Z"
}
```

`rzExportType` is how the importer knows what it's looking at — always the tool's own file-name stem (`menu-calculator`, `overhead-manpower-calculator`, `margin-audit-calculator`). `rzExportVersion` starts at `1`; bump it only if you ever change the shape in a way older importers couldn't handle.

## Menu Calculator's export (live)

```json
{
  "rzExportType": "menu-calculator",
  "rzExportVersion": 1,
  "exportedAt": "...",
  "blocks": [
    { "blockId": "menublock-1", "dishName": "Nasi Lemak Ayam", "costMode": "detailed",
      "costPerPortion": 3.98, "costBufferPct": 10, "sellingPrice": 12.90, "targetFoodCostPct": 30 }
  ]
}
```

`costPerPortion` includes the dish-level Cost Buffer % (added
2026-09-16, see COST_BUFFER_STANDARD.md) whenever that toggle is on
for the block — same "true cost" convention the live broadcast payload
already uses, so an imported file and a live sync always agree.
`costBufferPct` is the % actually applied, 0 if the block's buffer
toggle was off — purely informational for now, same "cheap now, useful
later" reasoning as the other optional fields below. This is additive:
an importer that doesn't look for `costBufferPct` yet just ignores it
and still reads `costPerPortion` correctly, so `rzExportVersion` stays
at 1.

## Overhead & Manpower's export (live)

```json
{
  "rzExportType": "overhead-manpower-calculator",
  "rzExportVersion": 1,
  "exportedAt": "...",
  "overheadMonthly": 3200.00,
  "manpowerMonthly": 5400.00,
  "overheadRows": [{ "category": "Rent", "monthly": 1500.00 }],
  "manpowerRows": [{ "role": "Kitchen helper", "monthly": 1900.00 }]
}
```

`overheadMonthly`/`manpowerMonthly` are the two fields that matter for import — same field names the live broadcast already uses, on purpose, so the importer needs only one code path for both a live payload and an imported file. The two row arrays are extra context for a human reading the file; nothing currently requires them.

## Margin Analysis's export — proposed shape, not built yet (this is the ask)

```json
{
  "rzExportType": "margin-audit-calculator",
  "rzExportVersion": 1,
  "exportedAt": "...",
  "dishes": [
    { "blockId": "menublock-1", "name": "Nasi Lemak Ayam", "quadrant": "Star",
      "price": 12.90, "volumeDay": 40, "cost": 3.85, "contributionMargin": 9.05 }
  ]
}
```

Notes on the fields:
- **`quadrant`**: one of `"Star"`, `"Plowhorse"`, `"Puzzle"`, `"Dog"` — whatever capitalization `computeQuadrant()` already produces internally is fine, just be consistent.
- **`blockId`**: include it whenever the dish came from a Menu Calculator sync (it already carries this from the sync payload) — this is what lets Costing Analysis match a quadrant to the *same* menu item it's already showing, not just a same-named one. Omit it for manually-added dishes that have no blockId; **`name`** alone is the fallback match key for those (matched case-insensitively, trimmed).
- The rest (`price`, `volumeDay`, `cost`, `contributionMargin`) aren't consumed by anything on the Costing Analysis side yet, but include them anyway — cheap now, and useful the moment anything downstream wants them.

Costing Analysis's importer already has the receiving half of this built (`importedQuadrants`, matched by `blockId` first then `name`) — the moment a file matching this shape gets imported, item 6 of the Full Business Summary (menu category) starts showing a real answer instead of "not available." Nothing on this side needs to change once you ship your export — just match the shape above.

## What it feeds: Costing Analysis's "Full Business Summary"

A new section, `renderFullSummary()`, gathers seven things in one
place (mostly already-computed figures, finally labeled and shown
together):

1. Fixed cost (`overheadPerPortion + manpowerPerPortion`)
2. Variable cost (`ingredientsPerPortion`)
3. CMR — Contribution Margin Ratio (same figure as the Gross Profit
   Margin % card, relabeled for this report)
4. BEP — Break-Even Point (`beMonth`/`beDay`, already computed)
5. Cost Structure (the existing ingredients/overhead/manpower/margin
   % breakdown)
6. Menu category — **the one that needs your export**, see above
7. What Can Be Improved — a deterministic check of 1–5 against the
   healthy F&B ranges this site already cites (food cost 28–35%, CMR
   65–75%, NPM 10–20%), not a live AI call. Reliable even if every
   Worker on the site is down; instant either way. If you want a
   genuinely AI-generated version of this later, that's a separate,
   optional upgrade on top — not a blocker for anything above.
