/* ============================================================
   wastage-calc.js — shared Wastage & Par-Level formula
   v1.0 — 2026-09-25
   ------------------------------------------------------------
   Owned by Cost Structure Checker — this is where the formula
   was built, for the Wastage & Par-Level Tracker. Lifted out
   unchanged (not a rewrite — nothing here needed re-deriving or
   re-verifying, see COST_STRUCTURE_CHECKER_NOTES.md /
   WASTAGE_SYNC_STANDARD_REPLY.md) so any other page can call it
   directly instead of retyping it.

   LOADING: plain global script tag, same pattern as
   nav-config.js / site-config.js — no build step, works the same
   whether the page is opened through a server or double-clicked
   from disk, unlike fetch(). On Cost Structure Checker itself
   this is a REQUIRED dependency (loaded before
   cost-structure-checker.js, same as cost-structure-checker-
   content.js already is) — not guarded with a typeof check the
   way costing-sync.js's rzListen/rzBroadcast are, because CSC
   ships and controls the load order of this file itself. A page
   that ISN'T Cost Structure Checker and wants to reuse the
   formula (Menu Calculator, per WASTAGE_SYNC_STANDARD.md's own
   diagram — "could call it too, own formula stays as fallback")
   should still guard its own call with
   `typeof rzComputeWastage === 'function'`, same as any other
   optional cross-tool global on this site.

   INPUT: opening/purchased/closing stock, an optional expected-
   usage number, and the three Tracker-wide settings (period
   length, supplier lead time, safety buffer). `expected` should
   be passed as `undefined` (not 0) when the person hasn't
   entered one — that's what tells this function there's nothing
   to compare consumption against, same as the page's own
   hasExpected check before this extraction.

   OUTPUT: { consumed, wastageQty, wastagePct, avgDaily,
   suggestedPar }. wastageQty/wastagePct are `null`, not 0, when
   no expected usage was given — the page's own rendering (and
   the broadcast/export payload) both treat null as "nothing to
   show" rather than "zero wastage", and any other caller should
   too.
   ============================================================ */

console.info('[wastage-calc] script build: 2026-09-25-v1.0');

function rzComputeWastage({ opening, purchased, closing, expected, periodDays, leadTimeDays, safetyBufferDays }) {
  // Clamped at 0 — a negative "consumed" only ever means a counting
  // mistake (closing stock entered higher than opening + purchased), not
  // a real negative quantity, so this coerces rather than trusts the raw
  // input, same reasoning as the tracker's own pre-extraction comment.
  const consumed = Math.max(0, (opening || 0) + (purchased || 0) - (closing || 0));
  const hasExpected = typeof expected === 'number' && isFinite(expected) && expected >= 0;
  const wastageQty = hasExpected ? Math.max(0, consumed - expected) : null;
  const wastagePct = (hasExpected && consumed > 0) ? (wastageQty / consumed) * 100 : null;
  const avgDaily = periodDays > 0 ? consumed / periodDays : 0;
  const suggestedPar = avgDaily * ((leadTimeDays || 0) + (safetyBufferDays || 0));
  return { consumed, wastageQty, wastagePct, avgDaily, suggestedPar };
}
