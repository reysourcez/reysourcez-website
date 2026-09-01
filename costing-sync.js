/* ============================================================
   Reysourcez cross-tab sync
   Shared by menu-calculator.js, overhead-manpower-calculator.js,
   and interactive-costing-analysis.js. Nothing here touches disk —
   BroadcastChannel messages only exist in memory while the tabs
   are open, gone the moment either closes.
   ------------------------------------------------------------
   Two jobs:
   1. Broadcasting/receiving totals between tools (each tool's own
      script calls rzBroadcast() when its totals change; Cost
      Analysis calls rzListen() to receive them).
   2. Opening or focusing another tool's tab, for the "Pull from"
      connector buttons (rzOpenOrFocusTool).

   REMOVED (2026-09-01): the floating "switch tabs" button that used
   to render into #rz-switcher, plus the "come back here" tab-title-
   flash/notification signal that existed only to power that
   button's back-to-opener click. Feedback was that the floating
   button was more distracting than useful. rzOpenTabs (below) still
   tracks windows this page has opened — that part stays, since it's
   what lets a second "Pull from" click focus the already-open tab
   instead of opening a duplicate.
   ============================================================ */

const RZ_SYNC_CHANNEL_NAME = 'reysourcez-costing-sync';
console.info('[Costing Sync] script build: 2026-09-01-switcher-removed');

const RZ_TOOLS = {
  'menu-calculator': { url: 'menu-calculator.html', label: 'Menu Portion Creator', icon: '\uD83C\uDF7D\uFE0F' },
  'overhead-manpower-calculator': { url: 'overhead-manpower-calculator.html', label: 'Overhead & Manpower', icon: '\uD83D\uDCB0' },
  'interactive-costing-analysis': { url: 'interactive-costing-analysis.html', label: 'Costing Analysis', icon: '\uD83D\uDCCA' },
  'printing-calculator': { url: 'printing-calculator.html', label: 'Printing Calculator', icon: '\uD83D\uDDA8\uFE0F' },
};

function rzCurrentToolKey() {
  const path = window.location.pathname.split('/').pop();
  return Object.keys(RZ_TOOLS).find((k) => RZ_TOOLS[k].url === path) || null;
}

function rzGetChannel() {
  if (typeof BroadcastChannel === 'undefined') return null; // very old browsers: sync silently unavailable, rest of the page still works
  if (!window._rzChannel) window._rzChannel = new BroadcastChannel(RZ_SYNC_CHANNEL_NAME);
  return window._rzChannel;
}

// Call from a tool page whenever its totals change.
function rzBroadcast(payload) {
  const ch = rzGetChannel();
  if (!ch) return;
  ch.postMessage(Object.assign({ source: rzCurrentToolKey() }, payload));
}

// Call from Cost Analysis to receive totals. handler(payload) fires
// on every incoming message.
function rzListen(handler) {
  const ch = rzGetChannel();
  if (!ch) return;
  ch.addEventListener('message', (event) => handler(event.data));
}

/* ================= Opening / focusing another tool's tab =================
   Backs the "Pull from" connector buttons. Keeps its own record of
   which tab it opened for which tool, so a second click focuses the
   already-open tab instead of opening a duplicate. The window name
   (2nd arg to window.open) backs this up at the browser level too —
   if rzOpenTabs gets reset by a page reload but a same-named window
   is still open elsewhere, the browser reuses it regardless. */

const rzOpenTabs = {}; // key -> window reference

function rzOpenOrFocusTool(key) {
  const tool = RZ_TOOLS[key];
  if (!tool) return;
  if (rzOpenTabs[key] && !rzOpenTabs[key].closed) {
    rzOpenTabs[key].focus();
  } else {
    rzOpenTabs[key] = window.open(tool.url, key);
  }
}
