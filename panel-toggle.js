/* ============================================================
   Panel Toggle — shared "one open at a time, click to close" controller
   ------------------------------------------------------------
   The standard (see AI_BUILD_BRIEF.md / PANEL_TOGGLE_STANDARD.md):
   for any panel that's genuinely OPTIONAL — it can be closed down to
   showing nothing, not just switched to another fixed option —
   clicking its trigger opens it; clicking that SAME trigger again
   closes it; opening a different trigger in the same group closes
   whatever was open first. Never two of these open together, and
   never stuck open with no way to close it by re-clicking its own
   button.

   This is NOT for a mandatory-selection tab strip where something
   must always be visible and "closed to nothing" isn't a real state
   for it — e.g. Menu Calculator's Manual/AI-estimate cost tabs, or
   its Detailed/Simple sub-tabs (setCostTab/setManualSub). Those stay
   exactly as they are: plain switch-only tabs, no file needed.

   USAGE — call rzRegisterPanel() once per trigger+panel pair that
   belongs together, all sharing the same groupName string:

     rzRegisterPanel('costing-connectors', 'menu-calculator', {
       triggerEl: someButton,
       panelEl: document.getElementById('tool-dock'),
       floatingEls: [document.getElementById('rz-back-to-top')],
       onOpen: () => loadMenuCalculatorIntoDock(),
     });

   Every trigger registered under the SAME groupName is mutually
   exclusive. Panel visibility, the trigger's active-state class, and
   any floating button(s) tied to that panel all flip together in one
   place (rzTogglePanel below) — so a floating button can never end up
   shown or hidden independently of the panel it belongs to, which is
   exactly the failure mode behind "the floating button goes missing
   when I open a different panel": each page hand-rolling its own
   show/hide bookkeeping means it's easy for one code path to update
   the panel but forget the button, or vice versa. Registering both
   together here means there's one place that can get this wrong
   instead of one place per page.

   A single panelEl CAN be reused across multiple keys in the same
   group — e.g. Costing Analysis's tool dock is one shared element
   that different tools load into; onOpen/onClose are exactly the
   hook for "swap what's actually inside the shared panel," while this
   file still handles the show/hide + exclusivity + floating-button
   bookkeeping around it. See interactive-costing-analysis.js's
   initToolDockConnectors() for the worked example.
   ============================================================ */

const RZ_PANEL_GROUPS = {};

function rzRegisterPanel(groupName, key, config) {
  if (!RZ_PANEL_GROUPS[groupName]) {
    RZ_PANEL_GROUPS[groupName] = { openKey: null, panels: {} };
  }
  const entry = {
    triggerEl: config.triggerEl || null,
    panelEl: config.panelEl,
    floatingEls: config.floatingEls || [],
    activeClass: config.activeClass || 'is-active',
    onOpen: config.onOpen,
    onClose: config.onClose,
  };
  RZ_PANEL_GROUPS[groupName].panels[key] = entry;

  if (entry.triggerEl) {
    entry.triggerEl.addEventListener('click', () => rzTogglePanel(groupName, key));
  }
}

// The one function that actually changes what's open. Always closes
// whatever's currently open FIRST — even if that's this same key,
// which is what makes clicking an already-open panel's own trigger
// close it rather than re-open it — then opens the requested key only
// if it wasn't the thing that was just closed. Panel visibility, the
// trigger's active class, and its floating button(s) are flipped in
// the same pass, so they can never end up disagreeing with each
// other.
function rzTogglePanel(groupName, key) {
  const group = RZ_PANEL_GROUPS[groupName];
  if (!group || !group.panels[key]) return;
  const reopeningSameKey = group.openKey === key;

  if (group.openKey !== null) {
    const prev = group.panels[group.openKey];
    prev.panelEl.hidden = true;
    if (prev.triggerEl) prev.triggerEl.classList.remove(prev.activeClass);
    prev.floatingEls.forEach((el) => { el.hidden = true; });
    if (prev.onClose) prev.onClose();
    group.openKey = null;
  }

  if (!reopeningSameKey) {
    const next = group.panels[key];
    next.panelEl.hidden = false;
    if (next.triggerEl) next.triggerEl.classList.add(next.activeClass);
    next.floatingEls.forEach((el) => { el.hidden = false; });
    group.openKey = key;
    if (next.onOpen) next.onOpen();
  }
}

// For an explicit "×" or "Hide" button that should close whatever's
// open in a group without needing to know which key that currently is.
function rzCloseAllPanels(groupName) {
  const group = RZ_PANEL_GROUPS[groupName];
  if (group && group.openKey !== null) rzTogglePanel(groupName, group.openKey);
}

function rzIsPanelOpen(groupName, key) {
  const group = RZ_PANEL_GROUPS[groupName];
  return !!group && group.openKey === key;
}
