/* ============================================================
   QR Listing Creator — seller-facing setup & management (qr-listing-creator.js)
   VERSION 1.1 (2026-09-21) — fixes + floor plans. Change list: QLC_HANDOFF_v1.1.md
   Vanilla JS, no build step. Talks to the same Worker as order.js —
   see qr-listing-creator-worker.js's own header for the full API
   contract. This file owns everything a seller does: set up a
   listing, manage products/combos/sets, generate table QR codes,
   set the purchase-with-purchase rule and video banner, and see the
   raw order list. Full analytics (trends, bestsellers, the
   Star/Plowhorse/Puzzle/Dog breakdown Margin Analysis already has)
   is a deliberate KIV — see the Orders tab's own note — it needs
   real order history to mean anything.

   AUTH, HONESTLY: no login system exists anywhere on this site yet.
   A business is "owned" by whoever holds its admin key, saved to
   this browser's localStorage after setup so it doesn't need
   retyping every visit. Anyone with that key can edit the listing —
   see the banner shown right after setup, and the Worker's own
   header for the tradeoffs and the upgrade path.
   v1.1: the key rides in an X-Admin-Key header (never the URL); "Copy my admin link"
   puts it in the #fragment, which a browser never sends to any server.
   ============================================================ */

const WORKER_ENDPOINT = 'https://qr-listing-creator-proxy.reysourcez-ent.workers.dev';
const SESSION_KEY = 'qlc-session'; // { bizId, adminKey } for THIS browser only

function formatRM(v) {
  if (!isFinite(v) || v < 0) return 'RM0.00';
  return 'RM' + v.toFixed(2);
}
// Escapes quotes too, so it is safe inside "double-quoted" attributes as well as in text. The old
// textContent/innerHTML trick left " and ' alone: a name containing a quote got cut off in its own
// edit box (and saved that way), and text could break out of an attribute. (v1.1)
function escapeHTML(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function num(el, fallback) {
  const v = parseFloat(el.value);
  return isFinite(v) ? v : (fallback !== undefined ? fallback : 0);
}

const VERTICAL_LABELS = { fnb: 'Food & Drink', retail: 'Retail', service: 'Services' };

let session = null; // { bizId, adminKey }
let business = null;
let products = [];
let selectedVertical = 'fnb';

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) session = JSON.parse(raw);
  } catch (e) {}
}
function saveSession(bizId, adminKey) {
  session = { bizId, adminKey };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (e) {}
}
function clearSession() {
  session = null;
  try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
}
// An admin link (…#biz=…&key=…) opened on a new device signs that device in. The key lives in the
// #fragment so it is never sent to a server or into a referrer, and it is wiped from the address bar
// straight away. (?biz=&key= is read too, for links copied before v1.1.) (v1.1)
function sessionFromLink() {
  const raw = location.hash.replace(/^#/, '') || location.search.replace(/^\?/, '');
  const params = new URLSearchParams(raw);
  const biz = params.get('biz');
  const key = params.get('key');
  if (!biz || !key) return;
  saveSession(biz, key);
  history.replaceState(null, '', location.pathname);
}

/* ================= API ================= */

async function apiFetch(path, options) {
  const res = await fetch(WORKER_ENDPOINT + path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong talking to the server.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// Every owner-only call goes through here: the admin key travels in a header, never in the URL. (v1.1)
function adminFetch(path, options) {
  const opts = options || {};
  return apiFetch(path, { ...opts, headers: { ...(opts.headers || {}), 'X-Admin-Key': session.adminKey } });
}

/* ================= SETUP WIZARD ================= */

function wireVerticalPicker() {
  document.querySelectorAll('.qlc-vertical-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.qlc-vertical-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      selectedVertical = btn.dataset.vertical;
      document.getElementById('qlc-setup-tables-label').style.display = selectedVertical === 'fnb' ? '' : 'none';
    });
  });
}

async function submitSetup() {
  const statusEl = document.getElementById('qlc-setup-status');
  const name = document.getElementById('qlc-setup-name').value.trim();
  if (!name) { statusEl.textContent = 'Give your business a name first.'; statusEl.className = 'qlc-status is-error'; return; }
  const tableCount = selectedVertical === 'fnb' ? num(document.getElementById('qlc-setup-tables'), 10) : 0;

  statusEl.textContent = 'Setting up\u2026';
  statusEl.className = 'qlc-status';
  try {
    const data = await apiFetch('/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, vertical: selectedVertical, tableCount }),
    });
    saveSession(data.businessId, data.adminKey);
    await loadManageView(true);
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'qlc-status is-error';
  }
}

async function submitLogin() {
  const statusEl = document.getElementById('qlc-login-status');
  const bizId = document.getElementById('qlc-login-biz').value.trim();
  const key = document.getElementById('qlc-login-key').value.trim();
  if (!bizId || !key) { statusEl.textContent = 'Both fields are needed.'; statusEl.className = 'qlc-status is-error'; return; }

  statusEl.textContent = 'Checking\u2026';
  statusEl.className = 'qlc-status';
  try {
    await apiFetch('/orders?biz=' + encodeURIComponent(bizId), { headers: { 'X-Admin-Key': key } }); // fails with a clear error if the key's wrong
    saveSession(bizId, key);
    await loadManageView(false);
  } catch (err) {
    statusEl.textContent = err.message || 'Business ID or admin key not recognized.';
    statusEl.className = 'qlc-status is-error';
  }
}

/* ================= MANAGE: load + tabs ================= */

async function loadManageView(justCreated) {
  const enc = encodeURIComponent(session.bizId);
  // The orders call needs the admin key, so it also proves the saved key still works. The floor plan is
  // optional: if it cannot be fetched the seller still gets everything else. (v1.1)
  const [data, orderData, planData] = await Promise.all([
    apiFetch('/catalog?biz=' + enc),
    adminFetch('/orders?biz=' + enc),
    apiFetch('/floorplan?biz=' + enc).catch(() => ({ plan: null })),
  ]);
  business = data.business;
  products = data.products;
  fp.plan = FloorPlan.normalize(planData.plan);
  fp.history = [];
  fp.dirty = false;

  document.getElementById('qlc-setup-section').hidden = true;
  document.getElementById('qlc-manage').hidden = false;
  document.getElementById('qlc-quick-nav').hidden = false;
  // Tables, and so a floor plan, only make sense for food & drink.
  document.querySelectorAll('[data-tab="floorplan"]').forEach((el) => { el.hidden = business.vertical !== 'fnb'; });

  document.getElementById('qlc-biz-name').textContent = business.name;
  document.getElementById('qlc-biz-vertical').textContent = VERTICAL_LABELS[business.vertical] || business.vertical;

  const banner = document.getElementById('qlc-admin-key-banner');
  if (justCreated) {
    banner.hidden = false;
    document.getElementById('qlc-key-biz').textContent = session.bizId;
    document.getElementById('qlc-key-key').textContent = session.adminKey;
  } else {
    banner.hidden = true;
  }

  renderProducts();
  renderTables();
  renderSettings();
  renderOrders(orderData.orders);
  fpSetTool(fp.tool);
  fpRender();
}

function setTab(tab) {
  document.querySelectorAll('.qlc-calc-tab').forEach((b) => {
    const active = b.dataset.tab === tab;
    b.classList.toggle('is-active', active);
    b.setAttribute('aria-expanded', String(active));
  });
  document.querySelectorAll('.qlc-panel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
}

/* ================= PRODUCTS ================= */

function comboGroupHTML(group, gi) {
  const options = (group.options || []).map((o) => `
    <div class="qlc-combo-option-row">
      <input type="text" class="qlc-opt-name" placeholder="Option name" value="${escapeHTML(o.name || '')}">
      <input type="number" class="qlc-opt-price" min="0" step="0.01" placeholder="+RM" value="${o.priceDelta || 0}">
      <button type="button" class="delete-row qlc-remove-option" aria-label="Remove option">&times;</button>
    </div>`).join('');
  return `
    <div class="qlc-combo-group-row" data-gi="${gi}">
      <input type="text" class="qlc-group-label" placeholder="Group name, e.g. Choose a drink" value="${escapeHTML(group.label || '')}" style="width:100%; margin-bottom:8px; padding:7px 9px; border:1px solid var(--line); border-radius:4px; box-sizing:border-box;">
      <div class="qlc-options">${options}</div>
      <div class="qlc-row-actions">
        <button type="button" class="btn btn-secondary qlc-add-option">+ Add option</button>
        <button type="button" class="btn btn-secondary qlc-remove-group">Remove group</button>
      </div>
    </div>`;
}

function wireComboBuilder(row) {
  const builder = row.querySelector('.qlc-combo-builder');
  const groupsEl = builder.querySelector('.qlc-combo-groups-list');

  function wireOptionRemovers(groupRow) {
    groupRow.querySelectorAll('.qlc-remove-option').forEach((btn) => {
      btn.onclick = () => btn.closest('.qlc-combo-option-row').remove();
    });
  }
  function wireGroupRow(groupRow) {
    groupRow.querySelector('.qlc-add-option').addEventListener('click', () => {
      groupRow.querySelector('.qlc-options').insertAdjacentHTML('beforeend', `
        <div class="qlc-combo-option-row">
          <input type="text" class="qlc-opt-name" placeholder="Option name">
          <input type="number" class="qlc-opt-price" min="0" step="0.01" placeholder="+RM" value="0">
          <button type="button" class="delete-row qlc-remove-option" aria-label="Remove option">&times;</button>
        </div>`);
      wireOptionRemovers(groupRow);
    });
    groupRow.querySelector('.qlc-remove-group').addEventListener('click', () => groupRow.remove());
    wireOptionRemovers(groupRow);
  }

  builder.querySelector('.qlc-add-group').addEventListener('click', () => {
    groupsEl.insertAdjacentHTML('beforeend', comboGroupHTML({ label: '', options: [{ name: '', priceDelta: 0 }] }, groupsEl.children.length));
    wireGroupRow(groupsEl.lastElementChild);
  });
  groupsEl.querySelectorAll('.qlc-combo-group-row').forEach(wireGroupRow);
}

function readComboGroups(row) {
  return Array.from(row.querySelectorAll('.qlc-combo-group-row')).map((g) => ({
    label: g.querySelector('.qlc-group-label').value.trim() || 'Choose one',
    options: Array.from(g.querySelectorAll('.qlc-combo-option-row')).map((o) => ({
      name: o.querySelector('.qlc-opt-name').value.trim(),
      priceDelta: parseFloat(o.querySelector('.qlc-opt-price').value) || 0,
    })).filter((o) => o.name),
  })).filter((g) => g.options.length);
}

function productRowHTML(p) {
  p = p || { id: '', name: '', description: '', price: 0, imageUrl: '', category: '', type: 'single', isFeatured: false, tags: [], comboGroups: [], setItems: [] };
  const safeId = escapeHTML(p.id) || 'new-' + Math.random().toString(36).slice(2, 8);
  return `
    <div class="qlc-product-row" data-id="${escapeHTML(p.id)}">
      <div class="qlc-product-row-head">
        <input type="text" class="menu-name-input qlc-p-name" placeholder="Item name" value="${escapeHTML(p.name)}" style="font-size:1.1rem;">
        <button type="button" class="remove-block-btn qlc-remove-product no-print">Remove</button>
      </div>
      <div class="qlc-field-grid">
        <label>Price (RM) <input type="number" class="qlc-p-price" min="0" step="0.01" value="${p.price}"></label>
        <label>Category <input type="text" class="qlc-p-category" placeholder="e.g. Mains" value="${escapeHTML(p.category || '')}"></label>
        <label>Type
          <select class="qlc-p-type">
            <option value="single" ${p.type === 'single' ? 'selected' : ''}>Single item</option>
            <option value="set" ${p.type === 'set' ? 'selected' : ''}>Set (fixed bundle)</option>
            <option value="combo" ${p.type === 'combo' ? 'selected' : ''}>Combo (customer picks)</option>
          </select>
        </label>
        <label>Image URL <input type="text" class="qlc-p-image" placeholder="https://…" value="${escapeHTML(p.imageUrl || '')}"></label>
        <label>Tags <span class="toggle-hint">comma separated</span><input type="text" class="qlc-p-tags" placeholder="halal, spicy" value="${escapeHTML((p.tags || []).join(', '))}"></label>
      </div>
      <label style="display:block; margin-top:14px; font-weight:600; font-size:0.85rem;">Description
        <textarea class="qlc-p-desc" rows="2" style="width:100%; margin-top:5px; padding:8px 10px; border:1px solid var(--line); border-radius:4px; font-family:var(--font-body); box-sizing:border-box;">${escapeHTML(p.description || '')}</textarea>
      </label>

      <div class="qlc-combo-builder" data-visible-for="combo" ${p.type === 'combo' ? '' : 'hidden'}>
        <p class="toggle-hint" style="margin:0 0 8px;">Each group is one choice the customer makes (e.g. "Choose a drink"), with a few options and an optional extra price.</p>
        <div class="qlc-combo-groups-list">${(p.comboGroups && p.comboGroups.length ? p.comboGroups : [{ label: '', options: [{ name: '', priceDelta: 0 }] }]).map(comboGroupHTML).join('')}</div>
        <button type="button" class="btn btn-secondary qlc-add-group">+ Add group</button>
      </div>

      <label class="qlc-set-items" data-visible-for="set" ${p.type === 'set' ? '' : 'hidden'} style="display:block; margin-top:14px; font-weight:600; font-size:0.85rem;">What's included <span class="toggle-hint">one line each &mdash; descriptive only, priced as the one bundle above</span>
        <textarea class="qlc-p-setitems" rows="3" style="width:100%; margin-top:5px; padding:8px 10px; border:1px solid var(--line); border-radius:4px; font-family:var(--font-body); box-sizing:border-box;">${escapeHTML((p.setItems || []).map((s) => s.name || s).join('\n'))}</textarea>
      </label>

      <div class="qlc-featured-row">
        <input type="checkbox" id="feat-${safeId}" class="qlc-p-featured" ${p.isFeatured ? 'checked' : ''}>
        <label for="feat-${safeId}">Featured &mdash; shows in Top Picks and the promoted tile</label>
      </div>

      <div class="qlc-row-actions">
        <button type="button" class="btn btn-primary qlc-save-product">Save item</button>
        <span class="qlc-status" role="status"></span>
      </div>
    </div>`;
}

function wireProductRow(row) {
  const typeSelect = row.querySelector('.qlc-p-type');
  typeSelect.addEventListener('change', () => {
    row.querySelectorAll('[data-visible-for]').forEach((el) => { el.hidden = el.dataset.visibleFor !== typeSelect.value; });
  });
  wireComboBuilder(row);
  row.querySelector('.qlc-save-product').addEventListener('click', () => saveProductRow(row));
  row.querySelector('.qlc-remove-product').addEventListener('click', () => removeProductRow(row));
}

async function saveProductRow(row) {
  const statusEl = row.querySelector('.qlc-status');
  const type = row.querySelector('.qlc-p-type').value;
  const body = {
    id: row.dataset.id || undefined,
    name: row.querySelector('.qlc-p-name').value.trim(),
    price: num(row.querySelector('.qlc-p-price')),
    category: row.querySelector('.qlc-p-category').value.trim(),
    description: row.querySelector('.qlc-p-desc').value.trim(),
    imageUrl: row.querySelector('.qlc-p-image').value.trim(),
    type,
    tags: row.querySelector('.qlc-p-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    isFeatured: row.querySelector('.qlc-p-featured').checked,
    comboGroups: type === 'combo' ? readComboGroups(row) : null,
    setItems: type === 'set' ? row.querySelector('.qlc-p-setitems').value.split('\n').map((l) => l.trim()).filter(Boolean).map((name) => ({ name })) : null,
  };
  if (!body.name) { statusEl.textContent = 'Needs a name.'; statusEl.className = 'qlc-status is-error'; return; }

  statusEl.textContent = 'Saving\u2026';
  statusEl.className = 'qlc-status';
  try {
    const data = await adminFetch('/catalog?biz=' + encodeURIComponent(session.bizId), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    row.dataset.id = data.id;
    statusEl.textContent = 'Saved';
    statusEl.className = 'qlc-status is-ok';
    await refreshProductsQuietly();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'qlc-status is-error';
  }
}

async function removeProductRow(row) {
  if (!row.dataset.id) { row.remove(); return; }
  if (!confirm('Remove this item from the listing?')) return;
  try {
    await adminFetch('/catalog?biz=' + encodeURIComponent(session.bizId) + '&id=' + encodeURIComponent(row.dataset.id), { method: 'DELETE' });
    row.remove();
    await refreshProductsQuietly();
  } catch (err) {
    alert(err.message);
  }
}

// Re-pulls the catalog after a change (a saved item might now need to
// appear in the PWP dropdowns on Settings) without rebuilding product
// rows the seller might still be mid-edit on.
async function refreshProductsQuietly() {
  const data = await apiFetch('/catalog?biz=' + encodeURIComponent(session.bizId));
  products = data.products;
  renderPwpOptions(); // only the dropdowns: anything typed but not yet saved in Settings stays put
}

function renderProducts() {
  const list = document.getElementById('qlc-product-list');
  list.innerHTML = products.map(productRowHTML).join('');
  list.querySelectorAll('.qlc-product-row').forEach(wireProductRow);
}

document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'qlc-add-product') {
    const list = document.getElementById('qlc-product-list');
    list.insertAdjacentHTML('beforeend', productRowHTML(null));
    const row = list.lastElementChild;
    wireProductRow(row);
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});

/* ================= TABLES & QR =================
   api.qrserver.com is a free, widely-used, no-signup QR image service —
   the same kind of deliberate, documented exception Market Radar already
   makes for Leaflet.js. Nothing sensitive is encoded (just this
   listing's own public order-page URL), so there's no privacy concern
   in a third party briefly seeing it; swap the URL builder below if
   this service ever goes away. */

function qrImageURL(targetUrl) {
  return 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=' + encodeURIComponent(targetUrl);
}

function renderTables() {
  const grid = document.getElementById('qlc-qr-grid');
  // Same folder as this page, whatever its own file name looks like. The old version only worked when the
  // address ended in qr-listing-creator.html; opened as /qr-listing-creator it printed QR codes that
  // pointed back at THIS page instead of the menu. (v1.1)
  const base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'order.html';
  const cards = [];

  if (business.vertical === 'fnb' && business.tableCount > 0) {
    for (let n = 1; n <= business.tableCount; n++) {
      const url = base + '?biz=' + encodeURIComponent(session.bizId) + '&table=' + n;
      cards.push(`<div class="qlc-qr-card"><img src="${qrImageURL(url)}" alt="QR code for table ${n}" loading="lazy"><strong>Table ${n}</strong><a href="${url}" target="_blank" rel="noopener">${escapeHTML(url)}</a></div>`);
    }
  }
  const takeawayUrl = base + '?biz=' + encodeURIComponent(session.bizId) + '&mode=takeaway'; // locked to takeaway (v1.1)
  const deliveryUrl = base + '?biz=' + encodeURIComponent(session.bizId) + '&mode=delivery';
  cards.push(`<div class="qlc-qr-card"><img src="${qrImageURL(takeawayUrl)}" alt="QR code for takeaway"><strong>Takeaway / counter</strong><a href="${takeawayUrl}" target="_blank" rel="noopener">${escapeHTML(takeawayUrl)}</a></div>`);
  cards.push(`<div class="qlc-qr-card"><img src="${qrImageURL(deliveryUrl)}" alt="QR code for delivery"><strong>Delivery</strong><a href="${deliveryUrl}" target="_blank" rel="noopener">${escapeHTML(deliveryUrl)}</a></div>`);

  grid.innerHTML = cards.join('');
}

/* ================= SETTINGS ================= */

// Rebuilds the two purchase-with-purchase dropdowns from the current product list and keeps whatever the
// seller has picked but not saved yet. A combo cannot be the offer (it needs choices made). (v1.1)
function renderPwpOptions() {
  const optionsFor = (list) => '<option value="">&mdash; none &mdash;</option>'
    + list.map((p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('');
  const triggerSel = document.getElementById('qlc-pwp-trigger');
  const offerSel = document.getElementById('qlc-pwp-offer');
  const keepTrigger = triggerSel.value;
  const keepOffer = offerSel.value;
  triggerSel.innerHTML = optionsFor(products);
  offerSel.innerHTML = optionsFor(products.filter((p) => p.type !== 'combo'));
  triggerSel.value = keepTrigger;
  offerSel.value = keepOffer;
}

function renderSettings() {
  document.getElementById('qlc-set-tables').value = business.tableCount || 0;
  document.getElementById('qlc-set-video').value = business.videoBannerUrl || '';
  renderPwpOptions();
  document.getElementById('qlc-pwp-trigger').value = business.pwpTriggerProductId || '';
  document.getElementById('qlc-pwp-offer').value = business.pwpOfferProductId || '';
  document.getElementById('qlc-pwp-price').value = business.pwpOfferPrice != null ? business.pwpOfferPrice : '';
}

async function saveSettings() {
  const statusEl = document.getElementById('qlc-settings-status');
  statusEl.textContent = 'Saving\u2026';
  statusEl.className = 'qlc-status';
  try {
    const data = await adminFetch('/business?biz=' + encodeURIComponent(session.bizId), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableCount: num(document.getElementById('qlc-set-tables'), 0),
        videoBannerUrl: document.getElementById('qlc-set-video').value.trim(),
        pwpTriggerProductId: document.getElementById('qlc-pwp-trigger').value || null,
        pwpOfferProductId: document.getElementById('qlc-pwp-offer').value || null,
        pwpOfferPrice: document.getElementById('qlc-pwp-price').value,
      }),
    });
    // Take back what the server really saved. The old version updated only the table count, so after
    // saving a product the Settings boxes snapped back to stale values. (v1.1)
    Object.assign(business, data.settings || {});
    renderSettings();
    renderTables();
    fpUpdateInfo();
    statusEl.textContent = 'Saved';
    statusEl.className = 'qlc-status is-ok';
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'qlc-status is-error';
  }
}

/* ================= ORDERS ================= */

// `preloaded` is the orders array when the caller already has it (first load); otherwise it is fetched.
async function renderOrders(preloaded) {
  const tbody = document.getElementById('qlc-orders-rows');
  try {
    let orders = preloaded;
    if (!orders) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted);">Loading&hellip;</td></tr>';
      orders = (await adminFetch('/orders?biz=' + encodeURIComponent(session.bizId))).orders;
    }
    if (!orders.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted);">No orders yet.</td></tr>'; return; }
    tbody.innerHTML = orders.map((o) => {
      const context = o.order_type === 'dine_in' ? 'Table ' + (o.table_number || '\u2014') : o.order_type === 'delivery' ? 'Delivery' : 'Takeaway';
      // A delivery order carries who and where: the seller needs it to actually deliver. (v1.1)
      const deliveryLines = o.order_type === 'delivery'
        ? `<br><small>${escapeHTML(o.delivery_name || '')} &middot; ${escapeHTML(o.delivery_phone || '')}<br>${escapeHTML(o.delivery_address || '')}</small>` : '';
      const itemsSummary = o.items.map((i) => i.qty + '\u00d7 ' + i.name).join(', ');
      const offers = (o.adjustments || []).map((a) => ' \u00b7 ' + a.label + ' \u2212' + formatRM(Math.abs(a.amount))).join('');
      // D1's own datetime('now') is space-separated UTC ("2026-09-15 10:23:45"),
      // not ISO — swap the space for a T so Date() parses it as UTC reliably.
      const when = new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleString();
      return `<tr><td>${escapeHTML(o.id)}</td><td>${escapeHTML(context)}${deliveryLines}</td><td>${escapeHTML(itemsSummary + offers)}</td><td>${formatRM(o.subtotal)}</td><td>${escapeHTML(when)}</td></tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#C0392B;">${escapeHTML(err.message)}</td></tr>`;
  }
}

/* ================= SESSION HELPERS (v1.1) ================= */

function showKeyBanner() {
  document.getElementById('qlc-key-biz').textContent = session.bizId;
  document.getElementById('qlc-key-key').textContent = session.adminKey;
  const banner = document.getElementById('qlc-admin-key-banner');
  banner.hidden = false;
  banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function signOut() {
  if (!confirm('Sign out of this device? You will need your Business ID and admin key to get back in.')) return;
  clearSession();
  location.reload();
}

function showLoginProblem(message) {
  document.getElementById('qlc-login-fields').hidden = false;
  const statusEl = document.getElementById('qlc-login-status');
  statusEl.textContent = message;
  statusEl.className = 'qlc-status is-error';
}

function copyAdminLink(e) {
  // #fragment, not ?query: a browser never sends a fragment to any server. sessionFromLink() reads it back.
  const url = location.origin + location.pathname + '#biz=' + encodeURIComponent(session.bizId) + '&key=' + encodeURIComponent(session.adminKey);
  const btn = e.currentTarget;
  const original = btn.textContent;
  const done = () => { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = original; }, 1500); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, () => window.prompt('Copy this link:', url));
  else window.prompt('Copy this link:', url);
}

/* ================= FLOOR PLAN (v1.1) =================
   The seller draws the seating once: walls, numbered tables, the door, the cashier. Customers get a
   read-only copy on the ordering page (their own table highlighted). floor-plan.js does the drawing so
   both sides look identical; this section is only the editing: pointer events on one <svg>, snapped to
   a 20-unit grid, with undo. Nothing is saved until "Save floor plan". */

const fp = { plan: null, tool: 'move', history: [], drag: null, dirty: false };
const FP_HINTS = {
  move: 'Drag a table, the door, the cashier or a wall to move it.',
  wall: 'Drag across the plan to draw a wall. Walls snap to the grid.',
  table: 'Click or tap the plan to place the next table.',
  door: 'Click or tap where the door is.',
  cashier: 'Click or tap where the cashier is.',
  erase: 'Click or tap anything to remove it.',
};
const fpSvg = () => document.getElementById('qlc-fp-svg');
const fpClamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const fpSnap = (v, max) => fpClamp(Math.round(v / FloorPlan.GRID) * FloorPlan.GRID, 0, max);

function fpStatus(message, kind) {
  const el = document.getElementById('qlc-fp-status');
  el.textContent = message;
  el.className = 'qlc-status' + (kind ? ' is-' + kind : '');
}
function fpMarkDirty() { fp.dirty = true; fpStatus('Unsaved changes.', ''); }

function fpNextFreeNumber() {
  const used = new Set(fp.plan.tables.map((t) => String(t.n).toLowerCase()));
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}

function fpUpdateInfo() {
  if (!fp.plan) return;
  const labels = fp.plan.tables.map((t) => String(t.n));
  const qrCount = business ? (business.tableCount || 0) : 0;
  const hasQr = (n) => /^\d+$/.test(n) && Number(n) >= 1 && Number(n) <= qrCount;
  const noQr = labels.filter((n) => !hasQr(n));
  let text = labels.length + (labels.length === 1 ? ' table' : ' tables') + ' on the plan.';
  if (noQr.length) text += ' No QR code for ' + noQr.slice(0, 12).join(', ') + ' — QR codes are numbered 1 to ' + qrCount + '; raise the number of tables in Settings.';
  document.getElementById('qlc-fp-info').textContent = text;
  const box = document.getElementById('qlc-fp-label');
  if (!box.dataset.custom) box.value = fpNextFreeNumber(); // points at a free number unless the seller typed their own
}

function fpRender() {
  const svg = fpSvg();
  if (!svg || !fp.plan) return;
  svg.innerHTML = FloorPlan.markup(fp.plan, { grid: true, draft: fp.drag && fp.drag.kind === 'wall' ? fp.drag : null });
  fpUpdateInfo();
}

function fpPush() {
  fp.history.push(JSON.stringify(fp.plan));
  if (fp.history.length > 60) fp.history.shift();
}
function fpUndo() {
  const last = fp.history.pop();
  if (!last) { fpStatus('Nothing to undo.', ''); return; }
  fp.plan = FloorPlan.normalize(JSON.parse(last));
  fpMarkDirty();
  fpRender();
}

function fpPoint(e) {
  const svg = fpSvg();
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return { x: fpClamp(p.x, 0, FloorPlan.W), y: fpClamp(p.y, 0, FloorPlan.H) };
}
function fpListFor(kind) {
  return kind === 'wall' ? fp.plan.walls : kind === 'table' ? fp.plan.tables : kind === 'door' ? fp.plan.doors : kind === 'cashier' ? fp.plan.cashiers : null;
}

function fpPlaceTable(x, y) {
  const box = document.getElementById('qlc-fp-label');
  const label = box.value.trim().replace(/[^\w .-]/g, '').slice(0, 8);
  if (!label) { fpStatus('Give the table a name or number first.', 'error'); return; }
  if (fp.plan.tables.some((t) => String(t.n).toLowerCase() === label.toLowerCase())) { fpStatus('There is already a table "' + label + '" on the plan.', 'error'); return; }
  if (fp.plan.tables.some((t) => Math.hypot(t.x - x, t.y - y) < 30)) { fpStatus('There is already a table there. Pick a different spot.', 'error'); return; }
  fpPush();
  fp.plan.tables.push({ n: label, x, y, shape: document.getElementById('qlc-fp-shape').value === 'square' ? 'square' : 'round' });
  delete box.dataset.custom;
  fpMarkDirty();
}

function fpPointerDown(e) {
  if (e.button > 0) return; // left button, touch or pen only
  e.preventDefault();
  const p = fpPoint(e);
  const x = fpSnap(p.x, FloorPlan.W);
  const y = fpSnap(p.y, FloorPlan.H);
  const hit = e.target.closest ? e.target.closest('[data-kind]') : null;

  if (fp.tool === 'wall') {
    if (fp.plan.walls.length >= 300) { fpStatus('That is the most walls one plan can hold (300).', 'error'); return; }
    fp.drag = { kind: 'wall', x1: x, y1: y, x2: x, y2: y };
    fpSvg().setPointerCapture(e.pointerId);
  } else if (fp.tool === 'table') {
    if (fp.plan.tables.length >= 200) fpStatus('That is the most tables one plan can hold (200).', 'error');
    else fpPlaceTable(x, y);
  } else if (fp.tool === 'door' || fp.tool === 'cashier') {
    const list = fpListFor(fp.tool);
    if (list.length >= 10) fpStatus('That is plenty. Remove one first.', 'error');
    else { fpPush(); list.push({ x, y }); fpMarkDirty(); }
  } else if (fp.tool === 'erase') {
    const list = hit && fpListFor(hit.dataset.kind);
    if (list) { fpPush(); list.splice(Number(hit.dataset.i), 1); fpMarkDirty(); }
  } else if (fp.tool === 'move' && hit) {
    const list = fpListFor(hit.dataset.kind);
    const item = list && list[Number(hit.dataset.i)];
    if (item) {
      fpPush();
      fp.drag = { kind: 'move', what: hit.dataset.kind, item, start: p, orig: { ...item } };
      fpSvg().setPointerCapture(e.pointerId);
    }
  }
  fpRender();
}

function fpPointerMove(e) {
  const d = fp.drag;
  if (!d) return;
  const p = fpPoint(e);
  if (d.kind === 'wall') {
    let x2 = fpSnap(p.x, FloorPlan.W);
    let y2 = fpSnap(p.y, FloorPlan.H);
    // Nearly straight means straight, so walls stay square without a steady hand.
    if (Math.abs(x2 - d.x1) <= FloorPlan.GRID) x2 = d.x1;
    else if (Math.abs(y2 - d.y1) <= FloorPlan.GRID) y2 = d.y1;
    d.x2 = x2;
    d.y2 = y2;
  } else if (d.kind === 'move') {
    const dx = Math.round((p.x - d.start.x) / FloorPlan.GRID) * FloorPlan.GRID;
    const dy = Math.round((p.y - d.start.y) / FloorPlan.GRID) * FloorPlan.GRID;
    if (d.what === 'wall') {
      const o = d.orig; // keep the whole wall inside the canvas
      const cdx = fpClamp(dx, -Math.min(o.x1, o.x2), FloorPlan.W - Math.max(o.x1, o.x2));
      const cdy = fpClamp(dy, -Math.min(o.y1, o.y2), FloorPlan.H - Math.max(o.y1, o.y2));
      d.item.x1 = o.x1 + cdx; d.item.x2 = o.x2 + cdx;
      d.item.y1 = o.y1 + cdy; d.item.y2 = o.y2 + cdy;
    } else {
      d.item.x = fpClamp(d.orig.x + dx, 0, FloorPlan.W);
      d.item.y = fpClamp(d.orig.y + dy, 0, FloorPlan.H);
    }
  }
  fpRender();
}

function fpPointerUp() {
  const d = fp.drag;
  if (!d) return;
  fp.drag = null;
  if (d.kind === 'wall') {
    if (d.x1 !== d.x2 || d.y1 !== d.y2) {
      fpPush();
      fp.plan.walls.push({ x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 });
      fpMarkDirty();
    }
  } else if (fp.history.length && fp.history[fp.history.length - 1] === JSON.stringify(fp.plan)) {
    fp.history.pop(); // a click that moved nothing: drop the snapshot taken when it started
  } else {
    fpMarkDirty();
  }
  fpRender();
}

function fpClear() {
  const p = fp.plan;
  if (!p.walls.length && !p.tables.length && !p.doors.length && !p.cashiers.length) return;
  if (!confirm('Clear the whole floor plan? Undo brings it back until you save.')) return;
  fpPush();
  fp.plan = FloorPlan.emptyPlan();
  fpMarkDirty();
  fpRender();
}

async function fpSave() {
  fpStatus('Saving\u2026', '');
  try {
    const data = await adminFetch('/floorplan?biz=' + encodeURIComponent(session.bizId), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: fp.plan }),
    });
    fp.plan = FloorPlan.normalize(data.plan);
    fp.dirty = false;
    business.hasFloorPlan = !!data.plan;
    fpRender();
    fpStatus(data.plan ? 'Saved. Customers can open it from the ordering page.' : 'Saved. The floor plan is cleared.', 'ok');
  } catch (err) {
    fpStatus(err.message, 'error');
  }
}

function fpSetTool(tool) {
  fp.tool = tool;
  document.querySelectorAll('[data-fp-tool]').forEach((b) => {
    const on = b.dataset.fpTool === tool;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.getElementById('qlc-fp-hint').textContent = FP_HINTS[tool];
  document.getElementById('qlc-fp-table-opts').hidden = tool !== 'table';
  fpSvg().style.cursor = tool === 'move' ? 'default' : tool === 'erase' ? 'not-allowed' : 'crosshair';
}

function wireFloorPlan() {
  const svg = fpSvg();
  svg.addEventListener('pointerdown', fpPointerDown);
  svg.addEventListener('pointermove', fpPointerMove);
  svg.addEventListener('pointerup', fpPointerUp);
  svg.addEventListener('pointercancel', fpPointerUp);
  document.querySelectorAll('[data-fp-tool]').forEach((b) => b.addEventListener('click', () => fpSetTool(b.dataset.fpTool)));
  document.getElementById('qlc-fp-undo').addEventListener('click', fpUndo);
  document.getElementById('qlc-fp-clear').addEventListener('click', fpClear);
  document.getElementById('qlc-fp-save').addEventListener('click', fpSave);
  document.getElementById('qlc-fp-label').addEventListener('input', (e) => { e.target.dataset.custom = '1'; });
  window.addEventListener('beforeunload', (e) => { if (fp.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

/* ================= INIT ================= */

let rzInitialized = false;

function init() {
  if (rzInitialized) return;
  rzInitialized = true;

  wireVerticalPicker();
  document.getElementById('qlc-setup-submit').addEventListener('click', submitSetup);
  document.getElementById('qlc-show-login').addEventListener('click', () => { document.getElementById('qlc-login-fields').hidden = false; });
  document.getElementById('qlc-login-submit').addEventListener('click', submitLogin);
  document.getElementById('qlc-save-pdf').addEventListener('click', () => window.print());

  document.querySelectorAll('.qlc-calc-tab').forEach((btn) => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
  document.querySelectorAll('.qlc-quick-nav-btn').forEach((btn) => btn.addEventListener('click', () => {
    setTab(btn.dataset.tab);
    document.getElementById('qlc-manage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  document.getElementById('qlc-save-settings').addEventListener('click', saveSettings);
  document.getElementById('qlc-refresh-orders').addEventListener('click', () => renderOrders());
  document.getElementById('qlc-copy-link').addEventListener('click', copyAdminLink);
  document.getElementById('qlc-show-key').addEventListener('click', showKeyBanner);
  document.getElementById('qlc-sign-out').addEventListener('click', signOut);
  wireFloorPlan();

  loadSession();
  sessionFromLink(); // an admin link opened on a new device signs that device in
  if (session) {
    loadManageView(false).catch((err) => {
      if (err && (err.status === 403 || err.status === 404)) {
        clearSession();
        showLoginProblem('That saved Business ID and admin key no longer work. Enter them again to get back in.');
      } else {
        showLoginProblem('Could not load your listing. Check your connection, then refresh the page.');
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
