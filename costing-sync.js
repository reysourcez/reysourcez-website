/* ============================================================
   Reysourcez cross-tab sync
   Shared by menu-calculator.js, overhead-manpower-calculator.js,
   and interactive-costing-analysis.js. Nothing here touches disk —
   BroadcastChannel messages and window references only exist in
   memory while the tabs are open, gone the moment either closes.
   ------------------------------------------------------------
   Two jobs:
   1. Broadcasting/receiving totals between tools (each tool's own
      script calls rzBroadcast() when its totals change; Cost
      Analysis calls rzListen() to receive them).
   2. A floating "switch tabs" button — the mobile-friendly
      alternative to the OS tab switcher, since these tools are
      meant to be used together.
   ============================================================ */

const RZ_SYNC_CHANNEL_NAME = 'reysourcez-costing-sync';
console.info('[Costing Sync] script build: 2026-08-28-printing-calculator');

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

/* ================= Floating tab switcher ================= */

// Asked once, tied to the person actually opening the switcher — not
// on page load, and not tied to the specific "back" click either, so
// it doesn't interrupt that action. If granted, "come back" requests
// can show a real notification (see rzInitComeBackListener below),
// whose click reliably focuses this tab — the one case browsers
// don't restrict. If denied, everything still works via the title
// flash alone.
function rzMaybeRequestNotificationPermission() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

// Turns invisible permission state into something visible in the
// switcher itself — browser-level permission (this can request) and
// OS-level notification settings for the browser app (this can't
// see or control at all) are two separate gates, and only the first
// one is something a website has any influence over.
function rzNotificationStatusText() {
  if (typeof Notification === 'undefined') {
    return 'Notifications not supported here \u2014 back button will flash the tab title only';
  }
  if (Notification.permission === 'granted') {
    return 'Notifications on \u2014 back button can bring this tab forward. (If it still doesn\u2019t, check your computer\u2019s own notification settings for this browser \u2014 that\u2019s a separate switch outside this site\u2019s control.)';
  }
  if (Notification.permission === 'denied') {
    return 'Notifications blocked for this site \u2014 back button will only flash the tab title. Allow them in your browser\u2019s site settings to enable one-click switching.';
  }
  return 'Notifications not yet allowed \u2014 open the \u22ee menu once to be asked, or back button will just flash the tab title for now';
}

const rzOpenTabs = {}; // key -> window reference, hub side only

function rzOpenOrFocusTool(key) {
  const tool = RZ_TOOLS[key];
  if (!tool) return;
  if (rzOpenTabs[key] && !rzOpenTabs[key].closed) {
    rzOpenTabs[key].focus();
  } else {
    rzOpenTabs[key] = window.open(tool.url + '?opener=' + rzCurrentToolKey(), key);
  }
}

function rzOpenerKey() {
  return new URLSearchParams(window.location.search).get('opener');
}

function rzBuildSwitcherEntries() {
  const myKey = rzCurrentToolKey();
  const entries = [];
  if (myKey) entries.push({ key: myKey, current: true });
  Object.keys(rzOpenTabs).forEach((k) => {
    if (rzOpenTabs[k] && !rzOpenTabs[k].closed && k !== myKey) entries.push({ key: k, current: false });
  });
  return entries;
}

let rzSwitcherInitialized = false;

function rzInitSwitcher() {
  if (rzSwitcherInitialized) return;
  rzSwitcherInitialized = true;
  const container = document.getElementById('rz-switcher');
  if (!container) return;

  const openerKey = rzOpenerKey();
  const hasOpener = !!window.opener && !window.opener.closed;

  container.innerHTML = `
    <div class="rz-switcher-menu" hidden></div>
    <button type="button" class="rz-switcher-toggle" aria-label="Switch between related tabs" aria-expanded="false">&#8942;</button>
  `;
  const toggle = container.querySelector('.rz-switcher-toggle');
  const menu = container.querySelector('.rz-switcher-menu');

  function refresh() {
    const entries = rzBuildSwitcherEntries();
    const showBack = hasOpener && openerKey && RZ_TOOLS[openerKey];
    if (entries.length <= 1 && !showBack) {
      container.hidden = true;
      return false;
    }
    container.hidden = false;
    let html = '';
    entries.forEach((e) => {
      const tool = RZ_TOOLS[e.key];
      html += `<button type="button" class="rz-switcher-item${e.current ? ' current' : ''}" data-key="${e.key}" ${e.current ? 'disabled' : ''}>${tool.icon} ${tool.label}${e.current ? ' (this tab)' : ''}</button>`;
    });
    if (showBack) {
      html += `<button type="button" class="rz-switcher-item" id="rz-back-to-opener">${RZ_TOOLS[openerKey].icon} ${RZ_TOOLS[openerKey].label} (back)</button>`;
      html += `<div class="rz-switcher-status">${rzNotificationStatusText()}</div>`;
    }
    menu.innerHTML = html;
    menu.querySelectorAll('.rz-switcher-item[data-key]').forEach((btn) => {
      btn.addEventListener('click', () => { rzOpenOrFocusTool(btn.dataset.key); menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); });
    });
    const backBtn = menu.querySelector('#rz-back-to-opener');
    if (backBtn) backBtn.addEventListener('click', () => {
      // window.opener.focus() is best-effort only — Chrome (since
      // v64) and Firefox both deliberately restrict a background tab
      // from pulling focus back onto its opener, so this frequently
      // does nothing even though it's not an error. The broadcast
      // below is the actual fix: it asks the opener tab to flash its
      // title, which reliably shows up in the tab bar even when we
      // can't force focus onto it.
      window.opener.focus();
      if (typeof rzBroadcast === 'function') rzBroadcast({ type: 'rz-come-back', target: openerKey });
      menu.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    });
    return true;
  }

  toggle.addEventListener('click', () => {
    rzMaybeRequestNotificationPermission();
    refresh();
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
  });

  refresh();
}

document.addEventListener('DOMContentLoaded', rzInitSwitcher);

/* ================= "Come back here" signal ================= */
// Since a background tab can't reliably force focus onto its opener
// (see the back-button handler above), it asks instead: every page
// listens here, and if it's the addressed tab, flashes its own
// title so it's easy to spot in the tab bar. Reverts on its own
// once that tab actually gets focus, or after 20s regardless.
function rzInitComeBackListener() {
  const ch = rzGetChannel();
  if (!ch) return;
  const myKey = rzCurrentToolKey();
  if (!myKey) return;
  const originalTitle = document.title;
  let revertTimer = null;

  function revert() {
    document.title = originalTitle;
    if (revertTimer) { clearTimeout(revertTimer); revertTimer = null; }
    window.removeEventListener('focus', revert);
  }

  ch.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'rz-come-back' && event.data.target === myKey) {
      document.title = '\u21A9 Switch back here \u2014 ' + originalTitle;
      window.addEventListener('focus', revert);
      if (revertTimer) clearTimeout(revertTimer);
      revertTimer = setTimeout(revert, 20000);

      // This part is the actual fix, not just a nicety: clicking a
      // notification is specifically exempted from the restriction
      // that blocks a plain window.opener.focus() call — browsers
      // treat it as a trusted user gesture and focus the tab by
      // default (see MDN's Notification click_event docs). Only
      // fires if permission was already granted; does nothing
      // otherwise, title flash still covers that case.
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const n = new Notification('Reysourcez \u2014 switch back here', {
            body: originalTitle,
            tag: 'rz-come-back',
            requireInteraction: true,
          });
          n.onclick = () => { window.focus(); n.close(); };
        } catch (err) {
          console.error('[Costing Sync] Notification failed to show:', err);
        }
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', rzInitComeBackListener);
