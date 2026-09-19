/* ============================================================
   QR Listing Creator — customer ordering page (order.js)
   Vanilla JS, no build step. Talks to qr-listing-creator-worker.js
   over a small JSON API — see that file's own header for the full
   contract. Nothing here decides the REAL total; the Worker
   recomputes it from its own prices the moment an order is placed.
   The cart total shown while browsing is a preview only.

   URL contract:
     ?biz=<business-id>   required — which business's listing to load
     ?table=<n>            puts the page straight into dine-in mode
                            with that table pre-filled. This is what
                            each table's own QR code encodes.
     ?mode=delivery         starts on the delivery tab instead
   Nothing about the customer is remembered between visits beyond the
   current cart (sessionStorage, cleared once the tab closes) — no
   accounts, no login, matching the rest of this site's privacy bar.

   NO PAYMENT STEP, ON PURPOSE (2026-09 decision — see chat): placing
   an order here produces a summary and an order code, nothing else.
   Card and bank details never touch this page because this page
   never asks for them. Whoever is actually collecting money today —
   a POS, or cash at the counter — works from the summary screen.
   ============================================================ */

const WORKER_ENDPOINT = 'https://qr-listing-creator-proxy.reysourcez-ent.workers.dev';

// Vertical-specific wording and which order types make sense. F&B is the
// only one dine-in applies to — a retail shop or a service business
// doesn't have "tables". Service-vertical browsing works the same as
// retail for v1 (browse a list, add to an order); real appointment/time-
// slot booking is a bigger, separate feature, not built yet.
const VERTICAL_LABELS = {
  fnb:     { itemNounPlural: 'dishes', allowDineIn: true },
  retail:  { itemNounPlural: 'items', allowDineIn: false },
  service: { itemNounPlural: 'services', allowDineIn: false },
};

function formatRM(v) {
  if (!isFinite(v) || v < 0) return 'RM0.00';
  return 'RM' + v.toFixed(2);
}
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
// Plain string id for a category heading/tab — category NAMES can have
// spaces or punctuation ("Rice & Noodles"), which breaks as a raw HTML id.
function catSlug(cat) {
  return 'cat-' + String(cat).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

const params = new URLSearchParams(location.search);
const BIZ_ID = params.get('biz') || '';
const CART_KEY = 'ord-cart-' + BIZ_ID;

const state = {
  business: null,
  products: [],
  cart: [],   // [{ productId, name, unitPriceBase, qty, selectedOptions:[{groupLabel,name,priceDelta}] }]
  orderType: params.get('mode') === 'delivery' ? 'delivery' : 'dine_in',
  tableNumber: params.get('table') || '',
  delivery: { name: '', phone: '', address: '' },
};

function loadCart() {
  try {
    const raw = sessionStorage.getItem(CART_KEY);
    if (raw) state.cart = JSON.parse(raw);
  } catch (e) { /* a corrupt or blocked storage just means starting with an empty cart */ }
}
function saveCart() {
  try { sessionStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch (e) {}
}

/* ================= DATA ================= */

async function fetchCatalog() {
  if (!BIZ_ID) throw new Error('This link is missing which business to load — check the QR code.');
  const res = await fetch(WORKER_ENDPOINT + '/catalog?biz=' + encodeURIComponent(BIZ_ID));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Could not load this menu.');
  state.business = data.business;
  state.products = data.products;
}

/* ================= CART MATH ================= */

function cartCount() { return state.cart.reduce((s, i) => s + i.qty, 0); }
function lineTotal(item) {
  const optTotal = item.selectedOptions.reduce((s, o) => s + (o.priceDelta || 0), 0);
  return (item.unitPriceBase + optTotal) * item.qty;
}
function cartTotal() { return state.cart.reduce((s, i) => s + lineTotal(i), 0); }

function addToCart(product, selectedOptions) {
  // Two combo lines with different picks are different cart rows; anything
  // else matching the same product id just bumps the quantity.
  const optKey = JSON.stringify((selectedOptions || []).map((o) => o.name).sort());
  const existing = state.cart.find((i) => i.productId === product.id
    && JSON.stringify((i.selectedOptions || []).map((o) => o.name).sort()) === optKey);
  if (existing) existing.qty += 1;
  else state.cart.push({ productId: product.id, name: product.name, unitPriceBase: product.price, qty: 1, selectedOptions: selectedOptions || [] });
  saveCart();
  renderCartBar();
  toast(product.name + ' added');
}
function setQty(index, qty) {
  if (qty <= 0) state.cart.splice(index, 1);
  else state.cart[index].qty = qty;
  saveCart();
  renderCartBar();
  renderCartDrawer();
}

/* ================= PURCHASE-WITH-PURCHASE ================= */

// One rule per business for v1 (trigger item -> offer item at a special
// price) — set on the seller's Settings tab. Only surfaces once, and only
// if the offer isn't already in the cart on its own.
function pwpOffer() {
  const b = state.business;
  if (!b || !b.pwpTriggerProductId || !b.pwpOfferProductId) return null;
  const hasTrigger = state.cart.some((i) => i.productId === b.pwpTriggerProductId);
  const alreadyHasOffer = state.cart.some((i) => i.productId === b.pwpOfferProductId);
  if (!hasTrigger || alreadyHasOffer) return null;
  const offerProduct = state.products.find((p) => p.id === b.pwpOfferProductId);
  if (!offerProduct) return null;
  return { product: offerProduct, price: b.pwpOfferPrice != null ? b.pwpOfferPrice : offerProduct.price };
}

/* ================= SMALL UI HELPERS ================= */

function toast(msg) {
  let el = document.getElementById('ord-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ord-toast';
    el.className = 'ord-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('is-visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('is-visible'), 1600);
}

function contextBadgeText() {
  if (state.orderType === 'dine_in' && state.tableNumber) return 'Table ' + state.tableNumber;
  if (state.orderType === 'delivery') return 'Delivery';
  return 'Takeaway';
}

// Only one drawer (cart or summary) is ever open at once — matches this
// site's own "one panel open at a time" rule (see AI_BUILD_BRIEF.md).
function openDrawer(id) {
  ['ord-cart-drawer', 'ord-summary-drawer'].forEach((d) => { document.getElementById(d).hidden = (d !== id); });
  document.getElementById('ord-drawer-backdrop').hidden = false;
}
function closeDrawers() {
  document.getElementById('ord-cart-drawer').hidden = true;
  document.getElementById('ord-summary-drawer').hidden = true;
  document.getElementById('ord-drawer-backdrop').hidden = true;
}

/* ================= RENDER: header / banner / picks ================= */

function renderHeader() {
  document.getElementById('ord-biz-name').textContent = state.business.name;
  document.title = state.business.name;
  document.getElementById('ord-context-badge').textContent = contextBadgeText();
}

function renderVideoBanner() {
  const wrap = document.getElementById('ord-video-banner');
  if (!state.business.videoBannerUrl) { wrap.hidden = true; return; }
  wrap.hidden = false;
  // Set as a property, never concatenated into an HTML string — a plain
  // src assignment can't inject a script even if the URL were hostile.
  document.getElementById('ord-video').src = state.business.videoBannerUrl;
}

function renderPicks() {
  const featured = state.products.filter((p) => p.isFeatured);
  const section = document.getElementById('ord-picks-section');
  if (!featured.length) { section.hidden = true; return; }
  section.hidden = false;
  const row = document.getElementById('ord-picks-row');
  row.innerHTML = featured.map((p) => productCardHTML(p, true)).join('');
  wireProductCards(row);
}

/* ================= RENDER: catalog + native "promoted" tiles =================
   There's no separate ad system here — the one native promo tile shown
   every few products is just one of the seller's own featured items,
   tagged "Promoted", styled exactly like every other card. Reusing the
   product model this way means there's no new content type that needs
   its own escaping/safety handling — it's the same product, same rules. */

function withPromotedTiles(cards) {
  const featured = state.products.filter((p) => p.isFeatured);
  if (!featured.length) return cards.join('');
  let out = '';
  cards.forEach((html, i) => {
    out += html;
    if ((i + 1) % 6 === 0) out += productCardHTML(featured[Math.floor(i / 6) % featured.length], false, true);
  });
  return out;
}

function productCardHTML(p, compact, isPromoted) {
  const img = p.imageUrl
    ? `<img class="ord-card-img" src="${escapeHTML(p.imageUrl)}" alt="" loading="lazy">`
    : `<div class="ord-card-img ord-card-img-placeholder" aria-hidden="true"></div>`;
  const tags = (p.tags && p.tags.length) ? `<div class="ord-card-tags">${p.tags.map((t) => `<span class="ord-tag">${escapeHTML(t)}</span>`).join('')}</div>` : '';
  const typeBadge = p.type === 'combo' ? '<span class="ord-type-badge">Build your own</span>' : p.type === 'set' ? '<span class="ord-type-badge">Set</span>' : '';
  const promotedBadge = isPromoted ? '<span class="ord-promoted-badge">Promoted</span>' : '';
  return `
    <div class="ord-product-card${compact ? ' is-compact' : ''}" data-product-id="${escapeHTML(p.id)}">
      ${promotedBadge}${img}
      <div class="ord-card-body">
        ${typeBadge}
        <strong class="ord-card-name">${escapeHTML(p.name)}</strong>
        ${p.description ? `<p class="ord-card-desc">${escapeHTML(p.description)}</p>` : ''}
        ${tags}
        <div class="ord-card-footer">
          <span class="ord-card-price">${formatRM(p.price)}</span>
          <button type="button" class="btn btn-primary ord-add-btn">Add</button>
        </div>
        <div class="ord-combo-groups" hidden></div>
      </div>
    </div>`;
}

function renderCatTabs(categories) {
  const tabs = document.getElementById('ord-cat-tabs');
  if (categories.length < 2) { tabs.hidden = true; return; }
  tabs.hidden = false;
  tabs.innerHTML = categories.map((c, i) => `<button type="button" class="ord-cat-tab${i === 0 ? ' is-active' : ''}" data-slug="${catSlug(c)}">${escapeHTML(c)}</button>`).join('');
  tabs.querySelectorAll('.ord-cat-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById('ord-' + btn.dataset.slug);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      tabs.querySelectorAll('.ord-cat-tab').forEach((b) => b.classList.toggle('is-active', b === btn));
    });
  });
}

function renderCatalog() {
  const categories = [...new Set(state.products.map((p) => p.category || 'Menu'))];
  renderCatTabs(categories);
  const container = document.getElementById('ord-catalog');
  container.innerHTML = categories.map((cat) => {
    const items = state.products.filter((p) => (p.category || 'Menu') === cat);
    return `<section id="ord-${catSlug(cat)}">
      ${categories.length > 1 ? `<h2 class="ord-section-title">${escapeHTML(cat)}</h2>` : ''}
      <div class="ord-product-grid">${withPromotedTiles(items.map((p) => productCardHTML(p)))}</div>
    </section>`;
  }).join('');
  wireProductCards(container);
}

function wireProductCards(root) {
  root.querySelectorAll('.ord-product-card').forEach((card) => {
    const product = state.products.find((p) => p.id === card.dataset.productId);
    if (!product) return; // a promoted tile referencing a product this root doesn't otherwise list is still findable in state.products, so this only trips on a genuine data gap
    const addBtn = card.querySelector('.ord-add-btn');
    if (product.type === 'combo' && product.comboGroups && product.comboGroups.length) {
      addBtn.addEventListener('click', () => toggleComboPicker(card, product));
    } else {
      addBtn.addEventListener('click', () => addToCart(product, []));
    }
  });
}

function toggleComboPicker(card, product) {
  const box = card.querySelector('.ord-combo-groups');
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = product.comboGroups.map((g, gi) => `
    <div class="ord-combo-group">
      <span class="ord-combo-group-label">${escapeHTML(g.label)}</span>
      ${g.options.map((o, oi) => `<label class="ord-combo-option">
        <input type="radio" name="combo-${product.id}-${gi}" value="${oi}" ${oi === 0 ? 'checked' : ''}>
        ${escapeHTML(o.name)}${o.priceDelta ? ' (+' + formatRM(o.priceDelta) + ')' : ''}
      </label>`).join('')}
    </div>`).join('') + `<button type="button" class="btn btn-secondary ord-combo-confirm">Add to cart</button>`;

  box.querySelector('.ord-combo-confirm').addEventListener('click', () => {
    const selected = product.comboGroups.map((g, gi) => {
      const checked = box.querySelector(`input[name="combo-${product.id}-${gi}"]:checked`);
      const opt = g.options[Number(checked.value)];
      return { groupLabel: g.label, name: opt.name, priceDelta: opt.priceDelta || 0 };
    });
    addToCart(product, selected);
    box.hidden = true;
  });
}

/* ================= RENDER: cart bar + drawer ================= */

function renderCartBar() {
  const bar = document.getElementById('ord-cart-bar');
  const count = cartCount();
  bar.hidden = count === 0;
  if (count === 0) return;
  document.getElementById('ord-cart-count').textContent = count + (count === 1 ? ' item' : ' items');
  document.getElementById('ord-cart-total').textContent = formatRM(cartTotal());
}

function renderCartDrawer() {
  const vlabel = VERTICAL_LABELS[state.business.vertical] || VERTICAL_LABELS.fnb;
  const offer = pwpOffer();

  const rows = state.cart.map((item, i) => `
    <div class="ord-cart-row">
      <div class="ord-cart-row-info">
        <strong>${escapeHTML(item.name)}</strong>
        ${item.selectedOptions.length ? `<span class="ord-cart-row-opts">${item.selectedOptions.map((o) => escapeHTML(o.name)).join(', ')}</span>` : ''}
      </div>
      <div class="ord-qty-stepper">
        <button type="button" data-i="${i}" data-d="-1" aria-label="One fewer">&minus;</button>
        <span>${item.qty}</span>
        <button type="button" data-i="${i}" data-d="1" aria-label="One more">+</button>
      </div>
      <span class="ord-cart-row-price">${formatRM(lineTotal(item))}</span>
    </div>`).join('');

  const emptyMsg = state.cart.length ? '' : `<p class="ord-empty">No ${vlabel.itemNounPlural} yet &mdash; close this and add something.</p>`;

  const pwpHTML = offer ? `
    <div class="ord-pwp-card">
      <span>Add <strong>${escapeHTML(offer.product.name)}</strong> for ${formatRM(offer.price)}?</span>
      <button type="button" class="btn btn-secondary" id="ord-pwp-add">Add</button>
    </div>` : '';

  const showDineIn = vlabel.allowDineIn;
  const orderTypeHTML = state.cart.length ? `
    <div class="ord-order-type-tabs" role="tablist">
      ${showDineIn ? `<button type="button" class="ord-ot-tab${state.orderType === 'dine_in' ? ' is-active' : ''}" data-ot="dine_in">Dine-in</button>` : ''}
      <button type="button" class="ord-ot-tab${state.orderType === 'takeaway' ? ' is-active' : ''}" data-ot="takeaway">Takeaway</button>
      <button type="button" class="ord-ot-tab${state.orderType === 'delivery' ? ' is-active' : ''}" data-ot="delivery">Delivery</button>
    </div>
    <div class="ord-ot-fields">
      ${state.orderType === 'dine_in' && showDineIn ? `<label>Table number <input type="text" id="ord-table-input" value="${escapeHTML(state.tableNumber)}"></label>` : ''}
      ${state.orderType === 'delivery' ? `
        <label>Name <input type="text" id="ord-del-name" value="${escapeHTML(state.delivery.name)}"></label>
        <label>Phone <input type="tel" id="ord-del-phone" value="${escapeHTML(state.delivery.phone)}"></label>
        <label>Address <textarea id="ord-del-address" rows="2">${escapeHTML(state.delivery.address)}</textarea></label>` : ''}
    </div>` : '';

  document.getElementById('ord-cart-body').innerHTML = `
    ${rows}${emptyMsg}${pwpHTML}
    ${state.cart.length ? `<div class="ord-cart-total-row"><span>Total</span><strong>${formatRM(cartTotal())}</strong></div>` : ''}
    ${orderTypeHTML}
    ${state.cart.length ? `<p class="ord-note">No payment here &mdash; this just places your order. Pay however this place normally takes payment.</p>
    <button type="button" class="btn btn-primary ord-place-order">Place order</button>` : ''}
    <p class="ord-status" id="ord-cart-status" role="status" aria-live="polite"></p>
  `;

  document.querySelectorAll('.ord-qty-stepper button').forEach((btn) => {
    btn.addEventListener('click', () => setQty(Number(btn.dataset.i), state.cart[Number(btn.dataset.i)].qty + Number(btn.dataset.d)));
  });
  const pwpBtn = document.getElementById('ord-pwp-add');
  if (pwpBtn) pwpBtn.addEventListener('click', () => { addToCart(offer.product, []); renderCartDrawer(); });
  document.querySelectorAll('.ord-ot-tab').forEach((btn) => btn.addEventListener('click', () => { state.orderType = btn.dataset.ot; renderCartDrawer(); }));
  const placeBtn = document.querySelector('.ord-place-order');
  if (placeBtn) placeBtn.addEventListener('click', placeOrder);
}

/* ================= PLACE ORDER ================= */

async function placeOrder() {
  const statusEl = document.getElementById('ord-cart-status');
  if (state.orderType === 'dine_in') state.tableNumber = document.getElementById('ord-table-input')?.value.trim() || '';
  if (state.orderType === 'delivery') {
    state.delivery.name = document.getElementById('ord-del-name')?.value.trim() || '';
    state.delivery.phone = document.getElementById('ord-del-phone')?.value.trim() || '';
    state.delivery.address = document.getElementById('ord-del-address')?.value.trim() || '';
    if (!state.delivery.name || !state.delivery.phone || !state.delivery.address) {
      statusEl.textContent = 'Fill in your name, phone, and address for delivery.';
      statusEl.classList.add('is-error');
      return;
    }
  }

  const btn = document.querySelector('.ord-place-order');
  btn.disabled = true;
  statusEl.textContent = 'Placing your order\u2026';
  statusEl.classList.remove('is-error');

  try {
    const res = await fetch(WORKER_ENDPOINT + '/order?biz=' + encodeURIComponent(BIZ_ID), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderType: state.orderType, tableNumber: state.tableNumber,
        delivery: state.orderType === 'delivery' ? state.delivery : undefined,
        items: state.cart.map((i) => ({ productId: i.productId, qty: i.qty, selectedOptions: i.selectedOptions })),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not place that order.');

    state.cart = [];
    saveCart();
    renderCartBar();
    renderSummary(data);
    openDrawer('ord-summary-drawer');
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.classList.add('is-error');
    btn.disabled = false;
  }
}

function renderSummary(order) {
  const contextLine = order.orderType === 'dine_in' ? 'Table ' + escapeHTML(order.tableNumber || '\u2014')
    : order.orderType === 'delivery' ? 'Delivery' : 'Takeaway';
  document.getElementById('ord-summary-body').innerHTML = `
    <div class="ord-summary-code">${escapeHTML(order.orderId)}</div>
    <p class="ord-summary-sub">${contextLine}</p>
    <div>${order.items.map((i) => `<div class="ord-summary-row"><span>${i.qty}&times; ${escapeHTML(i.name)}</span><span>${formatRM(i.lineTotal)}</span></div>`).join('')}</div>
    <div class="ord-summary-total"><span>Total</span><strong>${formatRM(order.subtotal)}</strong></div>
    <p class="ord-note">Show this screen at the counter to pay.</p>
    <button type="button" class="btn btn-secondary" id="ord-new-order">Back to the menu</button>
  `;
  document.getElementById('ord-new-order').addEventListener('click', closeDrawers);
}

/* ================= INIT ================= */

async function init() {
  loadCart();
  try {
    await fetchCatalog();
  } catch (err) {
    document.getElementById('ord-loading').textContent = err.message || 'Could not load this menu.';
    return;
  }
  document.getElementById('ord-loading').hidden = true;
  document.getElementById('ord-app').hidden = false;

  renderHeader();
  renderVideoBanner();
  renderPicks();
  renderCatalog();
  renderCartBar();

  document.getElementById('ord-cart-bar-btn').addEventListener('click', () => { renderCartDrawer(); openDrawer('ord-cart-drawer'); });
  document.getElementById('ord-cart-close').addEventListener('click', closeDrawers);
  document.getElementById('ord-summary-close').addEventListener('click', closeDrawers);
  document.getElementById('ord-drawer-backdrop').addEventListener('click', closeDrawers);
}

document.addEventListener('DOMContentLoaded', init);
