/* ============================================================
   QR Listing Creator — floor plan drawing (floor-plan.js)
   VERSION 1.3 (2026-09-24) — v1.3: a "You" tag marks the customer's own table. (File first added in v1.1.)
   Shared by the seller page (draws + edits) and the customer page
   (read-only; tap a table to choose it). One file decides how a plan
   LOOKS, so the seller sees exactly what customers will see.

   Plan shape — the Worker's cleanFloorPlan() enforces the same limits:
     { v:1, walls:[{x1,y1,x2,y2}], tables:[{n,x,y,shape:'round'|'square'}],
       doors:[{x,y}], cashiers:[{x,y}] }
   The canvas is always 640 x 400 units; the SVG scales it to any screen.
   No network calls and no storage in here — drawing only.
   ============================================================ */
(function () {
  const W = 640, H = 400, GRID = 20; // W and H must match PLAN_W / PLAN_H in the Worker

  // Quote-safe: table names are seller-typed text that ends up inside SVG attributes.
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const int = (v) => Math.round(Number(v) || 0);

  function emptyPlan() { return { v: 1, walls: [], tables: [], doors: [], cashiers: [] }; }

  // Fills in anything missing so the drawing code never trips on a half-formed plan.
  function normalize(plan) {
    const p = plan && typeof plan === 'object' ? plan : {};
    return {
      v: 1,
      walls: Array.isArray(p.walls) ? p.walls : [],
      tables: Array.isArray(p.tables) ? p.tables : [],
      doors: Array.isArray(p.doors) ? p.doors : [],
      cashiers: Array.isArray(p.cashiers) ? p.cashiers : [],
    };
  }

  const FONT = 'font-family:var(--font-body,system-ui,sans-serif);font-weight:700';

  function chip(kind, m, i, label, color, width) {
    const x = int(m.x), y = int(m.y);
    return `<g data-kind="${kind}" data-i="${i}"><rect x="${x - width / 2}" y="${y - 13}" width="${width}" height="26" rx="13" style="fill:${color}"/>`
      + `<text x="${x}" y="${y}" dy=".35em" text-anchor="middle" pointer-events="none" style="${FONT};font-size:14px;fill:#fff">${label}</text></g>`;
  }

  /* Returns the INNER markup of the <svg> (the caller owns the <svg viewBox="0 0 640 400"> tag).
     opts.grid       draw the snap grid (editor only)
     opts.draft      {x1,y1,x2,y2} wall being dragged out (editor only)
     opts.highlight  table name to show as "your table"
     opts.selectable make tables focusable / tappable (customer page) */
  function markup(plan, opts) {
    opts = opts || {};
    const p = normalize(plan);
    const mine = opts.highlight ? String(opts.highlight).trim().toLowerCase() : '';
    const out = [];

    out.push(`<rect x="0" y="0" width="${W}" height="${H}" rx="10" style="fill:var(--paper,#FAF8F3);stroke:var(--line,#D8D4C8);stroke-width:2"/>`);
    if (opts.grid) {
      let d = '';
      for (let x = GRID; x < W; x += GRID) d += `M${x} 0V${H}`;
      for (let y = GRID; y < H; y += GRID) d += `M0 ${y}H${W}`;
      out.push(`<path d="${d}" pointer-events="none" style="fill:none;stroke:var(--line,#D8D4C8);stroke-width:.6;opacity:.7"/>`);
    }

    p.walls.forEach((w, i) => {
      const a = `x1="${int(w.x1)}" y1="${int(w.y1)}" x2="${int(w.x2)}" y2="${int(w.y2)}" stroke-linecap="round"`;
      // The wide invisible line is a fat hit-area so a wall is easy to tap on a phone.
      out.push(`<g data-kind="wall" data-i="${i}"><line ${a} pointer-events="stroke" style="stroke:transparent;stroke-width:22"/><line ${a} style="stroke:var(--ink,#1F2A26);stroke-width:6"/></g>`);
    });
    if (opts.draft) {
      const d = opts.draft;
      out.push(`<line x1="${int(d.x1)}" y1="${int(d.y1)}" x2="${int(d.x2)}" y2="${int(d.y2)}" stroke-linecap="round" pointer-events="none" style="stroke:var(--accent,#1F6F5C);stroke-width:6;stroke-dasharray:10 8;opacity:.85"/>`);
    }

    p.tables.forEach((t, i) => {
      const label = String(t.n == null ? '' : t.n);
      const isMine = !!mine && label.toLowerCase() === mine;
      const x = int(t.x), y = int(t.y);
      const size = label.length > 3 ? 12 : label.length > 2 ? 15 : 18;
      const fill = isMine ? 'var(--accent,#1F6F5C)' : 'var(--surface,#fff)';
      const stroke = 'var(--accent,#1F6F5C)';
      const shape = t.shape === 'square'
        ? `<rect x="${x - 22}" y="${y - 22}" width="44" height="44" rx="7" style="fill:${fill};stroke:${stroke};stroke-width:2.5"/>`
        : `<circle cx="${x}" cy="${y}" r="22" style="fill:${fill};stroke:${stroke};stroke-width:2.5"/>`;
      const ring = isMine
        ? `<circle cx="${x}" cy="${y}" r="30" pointer-events="none" style="fill:none;stroke:var(--accent,#1F6F5C);stroke-width:3;stroke-dasharray:5 4"/>` : '';
      const attrs = opts.selectable
        ? ` tabindex="0" role="button" aria-label="Table ${esc(label)}${isMine ? ', your table' : ''}" style="cursor:pointer"` : '';
      const ty = y < 64 ? y + 42 : y - 42; // the "You" tag sits above the table, or below it near the top edge
      const pin = isMine
        ? `<g pointer-events="none"><rect x="${x - 21}" y="${ty - 11}" width="42" height="22" rx="11" style="fill:var(--accent,#1F6F5C);stroke:var(--surface,#fff);stroke-width:2"/>`
          + `<text x="${x}" y="${ty}" dy=".35em" text-anchor="middle" style="${FONT};font-size:12px;fill:var(--on-accent,#fff)">You</text></g>` : '';
      out.push(`<g data-kind="table" data-i="${i}" data-n="${esc(label)}"${attrs}>${ring}${shape}`
        + `<text x="${x}" y="${y}" dy=".35em" text-anchor="middle" pointer-events="none" style="${FONT};font-size:${size}px;fill:${isMine ? 'var(--on-accent,#fff)' : 'var(--ink,#1F2A26)'}">${esc(label)}</text>${pin}</g>`);
    });

    p.doors.forEach((m, i) => out.push(chip('door', m, i, 'Door', '#2B6CB0', 60)));
    p.cashiers.forEach((m, i) => out.push(chip('cashier', m, i, 'Cashier', '#975A16', 76)));
    return out.join('');
  }

  window.FloorPlan = { W, H, GRID, esc, emptyPlan, normalize, markup };
})();
