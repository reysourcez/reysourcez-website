/* ============================================================
   QR Listing Creator — seller-facing setup & management (qr-listing-creator.js)
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
   ============================================================ */

const WORKER_ENDPOINT = 'https://qr-listing-creator-proxy.reysourcez-ent.workers.dev/';
const SESSION_KEY = 'qlc-session'; // { bizId, adminKey } for THIS browser only

function formatRM(v) {
  if (!isFinite(v) || v < 0) return 'RM0.00';
  return 'RM' + v.toFixed(2);
}
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
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

/* ================= API ================= */

async function apiFetch(path, options) {
  const res = await fetch(WORKER_ENDPOINT + path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong talking to the server.');
  return data;
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
    await apiFetch('/orders?biz=' + encodeURIComponent(bizId) + '&key=' + encodeURIComponent(key)); // fails with a clear error if the key's wrong
    saveSession(bizId, key);
    await loadManageView(false);
  } catch (err) {
    statusEl.textContent = err.message || 'Business ID or admin key not recognized.';
    statusEl.className = 'qlc-status is-error';
  }
}

/* ================= MANAGE: load + tabs ================= */

async function loadManageView(justCreated) {
  const data = await apiFetch('/catalog?biz=' + encodeURIComponent(session.bizId));
  business = data.business;
  products = data.products;

  document.getElementById('qlc-setup-section').hidden = true;
  document.getElementById('qlc-manage').hidden = false;
  document.getElementById('qlc-quick-nav').hidden = false;

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
  renderOrders();
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
      <input type="number" class="qlc-opt-price" step="0.01" placeholder="+RM" value="${o.priceDelta || 0}">
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
          <input type="number" class="qlc-opt-price" step="0.01" placeholder="+RM" value="0">
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
    const data = await apiFetch('/catalog?biz=' + encodeURIComponent(session.bizId) + '&key=' + encodeURIComponent(session.adminKey), {
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
    await apiFetch('/catalog?biz=' + encodeURIComponent(session.bizId) + '&key=' + encodeURIComponent(session.adminKey) + '&id=' + encodeURIComponent(row.dataset.id), { method: 'DELETE' });
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
  renderSettings();
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
  const base = location.origin + location.pathname.replace('qr-listing-creator.html', 'order.html');
  const cards = [];

  if (business.vertical === 'fnb' && business.tableCount > 0) {
    for (let n = 1; n <= business.tableCount; n++) {
      const url = base + '?biz=' + encodeURIComponent(session.bizId) + '&table=' + n;
      cards.push(`<div class="qlc-qr-card"><img src="${qrImageURL(url)}" alt="QR code for table ${n}" loading="lazy"><strong>Table ${n}</strong><a href="${url}" target="_blank" rel="noopener">${escapeHTML(url)}</a></div>`);
    }
  }
  const takeawayUrl = base + '?biz=' + encodeURIComponent(session.bizId);
  const deliveryUrl = base + '?biz=' + encodeURIComponent(session.bizId) + '&mode=delivery';
  cards.push(`<div class="qlc-qr-card"><img src="${qrImageURL(takeawayUrl)}" alt="QR code for takeaway"><strong>Takeaway / counter</strong><a href="${takeawayUrl}" target="_blank" rel="noopener">${escapeHTML(takeawayUrl)}</a></div>`);
  cards.push(`<div class="qlc-qr-card"><img src="${qrImageURL(deliveryUrl)}" alt="QR code for delivery"><strong>Delivery</strong><a href="${deliveryUrl}" target="_blank" rel="noopener">${escapeHTML(deliveryUrl)}</a></div>`);

  grid.innerHTML = cards.join('');
}

/* ================= SETTINGS ================= */

function renderSettings() {
  document.getElementById('qlc-set-tables').value = business.tableCount || 0;
  document.getElementById('qlc-set-video').value = business.videoBannerUrl || '';

  const options = '<option value="">&mdash; none &mdash;</option>' + products.map((p) => `<option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>`).join('');
  const triggerSel = document.getElementById('qlc-pwp-trigger');
  const offerSel = document.getElementById('qlc-pwp-offer');
  triggerSel.innerHTML = options;
  offerSel.innerHTML = options;
  triggerSel.value = business.pwpTriggerProductId || '';
  offerSel.value = business.pwpOfferProductId || '';
  document.getElementById('qlc-pwp-price').value = business.pwpOfferPrice != null ? business.pwpOfferPrice : '';
}

async function saveSettings() {
  const statusEl = document.getElementById('qlc-settings-status');
  statusEl.textContent = 'Saving\u2026';
  statusEl.className = 'qlc-status';
  try {
    await apiFetch('/business?biz=' + encodeURIComponent(session.bizId) + '&key=' + encodeURIComponent(session.adminKey), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tableCount: num(document.getElementById('qlc-set-tables'), 0),
        videoBannerUrl: document.getElementById('qlc-set-video').value.trim(),
        pwpTriggerProductId: document.getElementById('qlc-pwp-trigger').value || null,
        pwpOfferProductId: document.getElementById('qlc-pwp-offer').value || null,
        pwpOfferPrice: document.getElementById('qlc-pwp-price').value,
      }),
    });
    business.tableCount = num(document.getElementById('qlc-set-tables'), 0);
    renderTables();
    statusEl.textContent = 'Saved';
    statusEl.className = 'qlc-status is-ok';
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = 'qlc-status is-error';
  }
}

/* ================= ORDERS ================= */

async function renderOrders() {
  const tbody = document.getElementById('qlc-orders-rows');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted);">Loading&hellip;</td></tr>';
  try {
    const data = await apiFetch('/orders?biz=' + encodeURIComponent(session.bizId) + '&key=' + encodeURIComponent(session.adminKey));
    if (!data.orders.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted);">No orders yet.</td></tr>'; return; }
    tbody.innerHTML = data.orders.map((o) => {
      const context = o.order_type === 'dine_in' ? 'Table ' + (o.table_number || '\u2014') : o.order_type === 'delivery' ? 'Delivery' : 'Takeaway';
      const itemsSummary = o.items.map((i) => i.qty + '\u00d7 ' + i.name).join(', ');
      // D1's own datetime('now') is space-separated UTC ("2026-09-15 10:23:45"),
      // not ISO — swap the space for a T so Date() parses it as UTC reliably.
      const when = new Date(o.created_at.replace(' ', 'T') + 'Z').toLocaleString();
      return `<tr><td>${escapeHTML(o.id)}</td><td>${escapeHTML(context)}</td><td>${escapeHTML(itemsSummary)}</td><td>${formatRM(o.subtotal)}</td><td>${escapeHTML(when)}</td></tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#C0392B;">${escapeHTML(err.message)}</td></tr>`;
  }
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
  document.getElementById('qlc-refresh-orders').addEventListener('click', renderOrders);
  document.getElementById('qlc-copy-link').addEventListener('click', (e) => {
    const url = location.origin + location.pathname + '?biz=' + encodeURIComponent(session.bizId) + '&key=' + encodeURIComponent(session.adminKey);
    navigator.clipboard?.writeText(url).then(() => {
      const original = e.target.textContent;
      e.target.textContent = 'Copied!';
      setTimeout(() => { e.target.textContent = original; }, 1500);
    });
  });

  loadSession();
  if (session) {
    loadManageView(false).catch(() => { session = null; });
  }
}

document.addEventListener('DOMContentLoaded', init);
