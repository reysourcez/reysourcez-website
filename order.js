/* ============================================================
   QR Listing Creator — customer ordering page (order.js)
   VERSION 1.4 (2026-09-25) — v1.4: applies the seller's own Theme choice (Settings tab) once the catalog
   loads, and shows the seller's own ad slides when they've set any (falls back to the shared default
   otherwise). Notes: QLC_HANDOFF_v1.6_ADDENDUM.md (v1.3 base: QLC_HANDOFF_v1.3_ADDENDUM.md, v1.1 base: QLC_HANDOFF_v1.1.md)
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
     ?mode=takeaway         (v1.1) takeaway only
   A table, delivery or takeaway link is LOCKED to what it is for: no Dine-in / Takeaway /
   Delivery picker in the cart. Only a plain ?biz= link gets the picker. (v1.1)
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

// Wording you can change in order-config.js (these are the fallbacks if that file is missing). (v1.3)
const TXT = Object.assign({ topPicks: '\u2605 Top picks', fullMenu: 'Full menu', shopLayout: 'Shop layout' }, (window.ORDER_CONFIG || {}).text);

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
// Escapes quotes too, so it is safe inside "double-quoted" attributes as well as in text. The old
// textContent/innerHTML trick left " and ' alone, so anything typed into ?table= in the address bar
// could add attributes to the table box. (v1.1)
function escapeHTML(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
  orderType: null,     // decided once the menu has loaded: see pickInitialOrderType()
  locked: false,       // true when the link itself says where the order goes (table / delivery / takeaway QR)
  editTable: false,    // a locked table order where the customer tapped "Change table" (no floor plan to tap)
  // The table number comes straight from the address bar, so it is cut down to plain characters first. (v1.1)
  tableNumber: (params.get('table') || '').replace(/[^\w .-]/g, '').slice(0, 12),
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
  // A time limit, so a stalled connection ends in "try again" instead of an endless wait. (v1.1)
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(WORKER_ENDPOINT + '/catalog?biz=' + encodeURIComponent(BIZ_ID), { signal: ctl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || 'Could not load this menu.');
      err.status = res.status;
      throw err;
    }
    state.business = data.business;
    state.products = data.products;
  } finally {
    clearTimeout(timer);
  }
}

// The cart survives in this tab (sessionStorage) but the seller may have changed the menu since. Refresh
// names and prices from the live menu, and drop anything that is gone or whose combo options changed, so
// the preview total matches what the Worker will charge. (v1.1)
function syncCartWithCatalog() {
  const byId = new Map(state.products.map((p) => [p.id, p]));
  const before = state.cart.length;
  state.cart = state.cart.filter((i) => {
    const p = byId.get(i.productId);
    if (!p) return false;
    i.name = p.name;
    i.unitPriceBase = p.price;
    if (p.type === 'combo' && p.comboGroups && p.comboGroups.length) {
      if (!Array.isArray(i.selectedOptions) || i.selectedOptions.length !== p.comboGroups.length) return false;
      for (let gi = 0; gi < p.comboGroups.length; gi++) {
        const opt = p.comboGroups[gi].options.find((o) => o.name === (i.selectedOptions[gi] && i.selectedOptions[gi].name));
        if (!opt) return false;
        i.selectedOptions[gi].groupLabel = p.comboGroups[gi].label;
        i.selectedOptions[gi].priceDelta = opt.priceDelta || 0;
      }
    } else {
      i.selectedOptions = [];
    }
    return true;
  });
  saveCart();
  if (state.cart.length < before) setTimeout(() => toast('Some items in your cart changed and were updated'), 300);
}

// A table QR, the delivery QR and the takeaway QR each mean one thing, so the cart does not ask again.
// Only a plain link (no table, no mode) gets the Dine-in / Takeaway / Delivery picker. (v1.1)
function pickInitialOrderType() {
  const v = VERTICAL_LABELS[state.business.vertical] || VERTICAL_LABELS.fnb;
  const mode = params.get('mode');
  state.locked = true;
  if (mode === 'delivery') return 'delivery';
  if (mode === 'takeaway') return 'takeaway';
  if (v.allowDineIn && state.tableNumber) return 'dine_in';
  state.locked = false;
  return 'takeaway';
}

/* ================= CART MATH ================= */

// Money is added up in whole sen (RM x 100) so 0.1 + 0.2 style drift can never show up in a total. (v1.1)
const toSen = (rm) => Math.round((Number(rm) || 0) * 100);
function cartCount() { return state.cart.reduce((s, i) => s + i.qty, 0); }
function lineTotalSen(item) {
  const optSen = item.selectedOptions.reduce((s, o) => s + toSen(o.priceDelta), 0);
  return (toSen(item.unitPriceBase) + optSen) * item.qty;
}
function lineTotal(item) { return lineTotalSen(item) / 100; }

// Purchase-with-purchase, mirrored from the Worker (which is what actually charges it): with the trigger
// item in the cart, ONE unit of the offer item drops to the offer price. This is only the preview.
function pwpSavingSen() {
  const b = state.business;
  if (!b || !b.pwpTriggerProductId || !b.pwpOfferProductId || b.pwpOfferPrice == null) return 0;
  if (b.pwpTriggerProductId === b.pwpOfferProductId) return 0;
  if (!state.cart.some((i) => i.productId === b.pwpTriggerProductId)) return 0;
  const offerLine = state.cart.find((i) => i.productId === b.pwpOfferProductId);
  if (!offerLine) return 0;
  return Math.max(0, toSen(offerLine.unitPriceBase) - toSen(b.pwpOfferPrice));
}
function cartTotal() { return (state.cart.reduce((s, i) => s + lineTotalSen(i), 0) - pwpSavingSen()) / 100; }

function addToCart(product, selectedOptions) {
  // Two combo lines with different picks are different cart rows; anything
  // else matching the same product id just bumps the quantity.
  // Order matters (option 1 of group 1 is not option 1 of group 2), so the names are NOT sorted. (v1.1)
  const optKey = JSON.stringify((selectedOptions || []).map((o) => o.name));
  const existing = state.cart.find((i) => i.productId === product.id
    && JSON.stringify((i.selectedOptions || []).map((o) => o.name)) === optKey);
  if (existing) existing.qty += 1;
  else state.cart.push({ productId: product.id, name: product.name, unitPriceBase: product.price, qty: 1, selectedOptions: selectedOptions || [] });
  saveCart();
  renderCartBar();
  // The cart drawer already shows the new line; a toast there would sit on top of the Place order button. (v1.1)
  if (document.getElementById('ord-cart-drawer').hidden) toast(product.name + ' added');
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
  if (!offerProduct || offerProduct.type === 'combo') return null; // a combo needs choices made, so it is never offered blind
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
  if (state.orderType === 'dine_in') return state.tableNumber ? 'Table ' + state.tableNumber : 'Dine-in';
  if (state.orderType === 'delivery') return 'Delivery';
  return 'Takeaway';
}

// Only one drawer (cart, summary or floor plan) is ever open at once — matches this
// site's own "one panel open at a time" rule (see AI_BUILD_BRIEF.md).
function openDrawer(id) {
  ['ord-cart-drawer', 'ord-summary-drawer', 'ord-plan-drawer'].forEach((d) => { document.getElementById(d).hidden = (d !== id); });
  document.getElementById('ord-drawer-backdrop').hidden = false;
}
function closeDrawers() {
  document.getElementById('ord-cart-drawer').hidden = true;
  document.getElementById('ord-summary-drawer').hidden = true;
  document.getElementById('ord-plan-drawer').hidden = true;
  document.getElementById('ord-drawer-backdrop').hidden = true;
}

/* ================= RENDER: header / banner / picks ================= */

function renderHeader() {
  document.getElementById('ord-biz-name').textContent = state.business.name;
  document.title = state.business.name;
  document.getElementById('ord-context-badge').textContent = contextBadgeText();
  document.getElementById('ord-plan-btn').hidden = !canShowPlan();
  document.getElementById('ord-plan-btn').textContent = TXT.shopLayout;
  document.getElementById('ord-plan-title').textContent = TXT.shopLayout;
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
  const divider = document.getElementById('ord-divider');
  divider.hidden = section.hidden = !featured.length; // the line under Top picks only shows when there are picks
  if (!featured.length) return;
  document.getElementById('ord-picks-title').textContent = TXT.topPicks;
  divider.querySelector('span').textContent = TXT.fullMenu;
  const row = document.getElementById('ord-picks-row');
  row.innerHTML = featured.map((p) => productCardHTML(p, true)).join('');
  wireProductCards(row);
}

/* ================= ADS BANNER (v1.3, per-business slides v1.6) =================
   Slides come from the seller's own Settings tab (state.business.ads) when they've set any; otherwise the
   shared defaults in order-config.js. Text is escaped; a link must be https:// or a page on this site.
   Note: saving zero slides looks the same as never having set any (both fall back to the shared default) —
   there's no separate "no ads at all for this listing" switch yet. */
let adTimer = null;
function safeAdUrl(u) {
  u = String(u || '').trim();
  return /^(https:\/\/|(?!\/\/)[\w.\/-]+$)/i.test(u) ? u : '';
}
function renderAds() {
  const cfg = (window.ORDER_CONFIG || {}).ads || {};
  const box = document.getElementById('ord-ad');
  const bizSlides = state.business.ads; // seller-managed slides (Settings tab), take priority when present (v1.6)
  const slides = cfg.enabled ? ((bizSlides && bizSlides.length ? bizSlides : cfg.slides) || []).slice(0, 6) : [];
  box.hidden = !slides.length;
  if (!slides.length) return;
  box.innerHTML = '<div class="ord-ad-track">' + slides.map((s) => {
    const url = safeAdUrl(s.url);
    const style = (s.bg ? '--ad-bg:' + escapeHTML(s.bg) + ';' : '') + (s.fg ? '--ad-fg:' + escapeHTML(s.fg) + ';' : '');
    const inner = `<span class="ord-ad-tag">Ad</span><span class="ord-ad-copy"><strong>${escapeHTML(s.title)}</strong><span>${escapeHTML(s.text)}</span>${s.cta ? `<em>${escapeHTML(s.cta)} &rsaquo;</em>` : ''}</span><span class="ord-ad-emoji" aria-hidden="true">${escapeHTML(s.emoji || '')}</span>`;
    return url
      ? `<a class="ord-ad-slide" style="${style}" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer sponsored">${inner}</a>`
      : `<div class="ord-ad-slide" style="${style}">${inner}</div>`;
  }).join('') + '</div>' + (slides.length > 1 ? '<div class="ord-ad-dots" aria-hidden="true">' + slides.map((_, i) => `<i${i ? '' : ' class="on"'}></i>`).join('') + '</div>' : '');
  if (slides.length < 2) return;
  const track = box.querySelector('.ord-ad-track');
  const dots = box.querySelectorAll('.ord-ad-dots i');
  const step = () => track.children[1].offsetLeft - track.children[0].offsetLeft;
  track.addEventListener('scroll', () => { const n = Math.round(track.scrollLeft / step()); dots.forEach((d, k) => d.classList.toggle('on', k === n)); }, { passive: true });
  if (cfg.rotateSeconds > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (adTimer) clearInterval(adTimer);
    adTimer = setInterval(() => {
      if (document.hidden || !box.offsetParent) return;
      const n = Math.round(track.scrollLeft / step()) + 1;
      track.scrollTo({ left: (n >= slides.length ? 0 : n) * step(), behavior: 'smooth' });
    }, cfg.rotateSeconds * 1000);
  }
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
  // What is in a set: the seller types it, so it should be shown. (v1.1)
  const setItems = (p.type === 'set' && p.setItems && p.setItems.length)
    ? `<ul class="ord-set-items">${p.setItems.map((x) => `<li>${escapeHTML(x.name || x)}</li>`).join('')}</ul>` : '';
  return `
    <div class="ord-product-card${compact ? ' is-compact is-top' : ''}" data-product-id="${escapeHTML(p.id)}">
      ${compact ? '<span class="ord-top-ribbon">\u2605 Top pick</span><span class="ord-glitter" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>' : ''}${promotedBadge}${img}
      <div class="ord-card-body">
        ${typeBadge}
        <strong class="ord-card-name">${escapeHTML(p.name)}</strong>
        ${p.description ? `<p class="ord-card-desc">${escapeHTML(p.description)}</p>` : ''}
        ${setItems}
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

// A featured combo is drawn more than once (Top picks, its category, promoted tiles). Radio buttons that
// share a name are one group across the whole page, so opening two of them un-picked the first one and
// its Add button then failed. Every opening gets its own name. (v1.1)
let comboPickerCount = 0;

function toggleComboPicker(card, product) {
  const box = card.querySelector('.ord-combo-groups');
  if (!box.hidden) { box.hidden = true; return; }
  box.hidden = false;
  const uid = 'c' + (++comboPickerCount);
  box.innerHTML = product.comboGroups.map((g, gi) => `
    <div class="ord-combo-group">
      <span class="ord-combo-group-label">${escapeHTML(g.label)}</span>
      ${g.options.map((o, oi) => `<label class="ord-combo-option">
        <input type="radio" name="combo-${uid}-${gi}" value="${oi}" ${oi === 0 ? 'checked' : ''}>
        ${escapeHTML(o.name)}${o.priceDelta ? ' (+' + formatRM(o.priceDelta) + ')' : ''}
      </label>`).join('')}
    </div>`).join('') + `<button type="button" class="btn btn-secondary ord-combo-confirm">Add to cart</button>`;

  box.querySelector('.ord-combo-confirm').addEventListener('click', () => {
    const selected = product.comboGroups.map((g, gi) => {
      const checked = box.querySelector(`input[name="combo-${uid}-${gi}"]:checked`);
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

// Reads what is typed in the drawer into state BEFORE it is rebuilt. Without this, tapping + / - or a tab
// re-drew the drawer from stale state and wiped a half-typed table number, name, phone or address. (v1.1)
function captureOrderFields() {
  const read = (id) => { const el = document.getElementById(id); return el ? el.value : null; };
  const table = read('ord-table-input');
  const name = read('ord-del-name');
  const phone = read('ord-del-phone');
  const address = read('ord-del-address');
  if (table !== null) state.tableNumber = table;
  if (name !== null) state.delivery.name = name;
  if (phone !== null) state.delivery.phone = phone;
  if (address !== null) state.delivery.address = address;
}

// Table chips 1..tableCount: the "change table" picker when this place has no shop layout drawn. (v1.3)
function tablePickerHTML() {
  const n = Math.min(60, Number(state.business.tableCount) || 0);
  const chips = Array.from({ length: n }, (_, i) => `<button type="button" class="ord-chip${String(i + 1) === String(state.tableNumber) ? ' is-on' : ''}" data-table="${i + 1}">${i + 1}</button>`).join('');
  return `<div class="ord-ot-fields"><span class="ord-plan-help">Tap your table &mdash; your order moves with you.</span>${n ? `<div class="ord-chips">${chips}</div>` : ''}<label>Other table <input type="text" id="ord-table-input" maxlength="12" value="${escapeHTML(state.tableNumber)}"></label></div>`;
}

function renderCartDrawer() {
  captureOrderFields();
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

  const savingSen = pwpSavingSen();
  const pwpSavingRow = savingSen > 0 ? `
    <div class="ord-cart-row">
      <div class="ord-cart-row-info"><strong>Offer price applied</strong></div>
      <span class="ord-cart-row-price">&minus;${formatRM(savingSen / 100)}</span>
    </div>` : '';

  const pwpHTML = offer ? `
    <div class="ord-pwp-card">
      <span>Add <strong>${escapeHTML(offer.product.name)}</strong> for ${formatRM(offer.price)}?</span>
      <button type="button" class="btn btn-secondary" id="ord-pwp-add">Add</button>
    </div>` : '';

  // Where the order is going. A table, takeaway or delivery QR is locked to what it is for; only a plain
  // link (no table, no mode) gets the picker. (v1.1)
  const showDineIn = vlabel.allowDineIn;
  const deliveryFields = `
    <label>Name <input type="text" id="ord-del-name" maxlength="80" value="${escapeHTML(state.delivery.name)}"></label>
    <label>Phone <input type="tel" id="ord-del-phone" maxlength="30" value="${escapeHTML(state.delivery.phone)}"></label>
    <label>Address <textarea id="ord-del-address" rows="2" maxlength="300">${escapeHTML(state.delivery.address)}</textarea></label>`;
  const tableField = `<label>Table number <input type="text" id="ord-table-input" maxlength="12" value="${escapeHTML(state.tableNumber)}"></label>`
    + (canShowPlan() ? '<button type="button" class="ord-link-btn" id="ord-plan-link">Find my table on the shop layout</button>' : '');
  let orderTypeHTML = '';
  if (state.cart.length) {
    if (state.locked && state.orderType === 'dine_in') {
      orderTypeHTML = `
        <div class="ord-locked-row ord-table-card"><span>&#128205; Ordering for <strong>Table ${escapeHTML(state.tableNumber || '?')}</strong></span>
          <button type="button" class="ord-plan-btn" id="ord-change-table">${canShowPlan() ? 'Change table &middot; ' + escapeHTML(TXT.shopLayout) : 'Change table'}</button></div>
        ${state.editTable ? tablePickerHTML() : ''}`;
    } else if (state.locked && state.orderType === 'delivery') {
      orderTypeHTML = `<div class="ord-locked-row"><span><strong>Delivery</strong> order</span></div><div class="ord-ot-fields">${deliveryFields}</div>`;
    } else if (state.locked) {
      orderTypeHTML = '<div class="ord-locked-row"><span><strong>Takeaway</strong> order</span></div>';
    } else {
      orderTypeHTML = `
        <div class="ord-order-type-tabs" role="tablist">
          ${showDineIn ? `<button type="button" class="ord-ot-tab${state.orderType === 'dine_in' ? ' is-active' : ''}" data-ot="dine_in">Dine-in</button>` : ''}
          <button type="button" class="ord-ot-tab${state.orderType === 'takeaway' ? ' is-active' : ''}" data-ot="takeaway">Takeaway</button>
          <button type="button" class="ord-ot-tab${state.orderType === 'delivery' ? ' is-active' : ''}" data-ot="delivery">Delivery</button>
        </div>
        <div class="ord-ot-fields">
          ${state.orderType === 'dine_in' && showDineIn ? tableField : ''}
          ${state.orderType === 'delivery' ? deliveryFields : ''}
        </div>`;
    }
  }

  document.getElementById('ord-cart-body').innerHTML = `
    ${rows}${pwpSavingRow}${emptyMsg}${pwpHTML}
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
  document.querySelectorAll('.ord-ot-tab').forEach((btn) => btn.addEventListener('click', () => { state.orderType = btn.dataset.ot; renderHeader(); renderCartDrawer(); }));
  const placeBtn = document.querySelector('.ord-place-order');
  if (placeBtn) placeBtn.addEventListener('click', placeOrder);
  const changeBtn = document.getElementById('ord-change-table');
  if (changeBtn) changeBtn.addEventListener('click', () => {
    if (canShowPlan()) openPlan(true);
    else { state.editTable = true; renderCartDrawer(); }
  });
  const planLink = document.getElementById('ord-plan-link');
  if (planLink) planLink.addEventListener('click', () => openPlan(true));
  document.querySelectorAll('.ord-chip').forEach((b) => b.addEventListener('click', () => chooseTable(b.dataset.table)));
}

/* ================= PLACE ORDER ================= */

async function placeOrder() {
  const statusEl = document.getElementById('ord-cart-status');
  captureOrderFields(); // a locked table has no box on screen; this leaves its number alone
  if (state.orderType === 'dine_in' && !state.tableNumber.trim()) {
    statusEl.textContent = 'Enter your table number first.';
    statusEl.classList.add('is-error');
    return;
  }
  if (state.orderType === 'delivery') {
    state.delivery.name = state.delivery.name.trim();
    state.delivery.phone = state.delivery.phone.trim();
    state.delivery.address = state.delivery.address.trim();
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
    <div>${order.items.map((i) => `<div class="ord-summary-row"><span>${i.qty}&times; ${escapeHTML(i.name)}</span><span>${formatRM(i.lineTotal)}</span></div>`).join('')}${(order.adjustments || []).map((a) => `<div class="ord-summary-row"><span>${escapeHTML(a.label)}</span><span>&minus;${formatRM(Math.abs(a.amount))}</span></div>`).join('')}</div>
    <div class="ord-summary-total"><span>Total</span><strong>${formatRM(order.subtotal)}</strong></div>
    <p class="ord-note">Show this screen at the counter to pay.</p>
    <button type="button" class="btn btn-secondary" id="ord-new-order">Back to the menu</button>
  `;
  document.getElementById('ord-new-order').addEventListener('click', closeDrawers);
}

/* ================= FLOOR PLAN (v1.1) =================
   Read-only for customers: it shows where their table is, and lets them tap another table if they move.
   The seller draws it (see qr-listing-creator.js); floor-plan.js does the drawing so both look the same. */

let planData;              // undefined = not fetched yet; null = this place has no plan
let planZoom = window.innerWidth < 480 ? 1.5 : 1;   // a phone starts a little zoomed in: tables are big enough to tap
let planFromCart = false;  // opened from the cart drawer, so closing it should go back there
const PLAN_ZOOMS = [1, 1.5, 2, 3];

// Offered only to someone ordering to a table, at a place that has drawn a plan.
function canShowPlan() {
  return !!(state.business && state.business.hasFloorPlan && state.orderType === 'dine_in' && window.FloorPlan);
}

async function openPlan(fromCart) {
  planFromCart = !!fromCart;
  const body = document.getElementById('ord-plan-body');
  body.innerHTML = '<p class="ord-empty">Loading the floor plan&hellip;</p>';
  openDrawer('ord-plan-drawer');
  try {
    if (planData === undefined) {
      const res = await fetch(WORKER_ENDPOINT + '/floorplan?biz=' + encodeURIComponent(BIZ_ID));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load the floor plan.');
      planData = data.plan || null;
    }
    renderPlan();
  } catch (err) {
    body.innerHTML = `<p class="ord-empty">${escapeHTML(err.message)}</p><button type="button" class="btn btn-secondary ord-btn" id="ord-plan-retry">Try again</button>`;
    document.getElementById('ord-plan-retry').addEventListener('click', () => openPlan(planFromCart));
  }
}

function renderPlan() {
  const body = document.getElementById('ord-plan-body');
  if (!planData) { body.innerHTML = '<p class="ord-empty">This place has not drawn a floor plan yet.</p>'; return; }
  const mine = String(state.tableNumber || '').trim();
  body.innerHTML = `
    <div class="ord-plan-tools">
      <span class="ord-plan-help">${mine ? 'You are at <strong>Table ' + escapeHTML(mine) + '</strong> (marked &ldquo;You&rdquo;). Tap another table and your order moves there.' : 'Tap your table.'}</span>
      <span class="ord-plan-zoom">
        <button type="button" id="ord-plan-out" aria-label="Zoom out">&minus;</button>
        <button type="button" id="ord-plan-in" aria-label="Zoom in">+</button>
      </span>
    </div>
    <div class="ord-plan-scroll" id="ord-plan-scroll">
      <svg id="ord-plan-svg" viewBox="0 0 ${FloorPlan.W} ${FloorPlan.H}" role="group" aria-label="Floor plan" style="width:${planZoom * 100}%">${FloorPlan.markup(planData, { selectable: true, highlight: mine })}</svg>
    </div>`;
  const svg = document.getElementById('ord-plan-svg');
  svg.addEventListener('click', (e) => {
    const g = e.target.closest('[data-kind="table"]');
    if (g) chooseTable(g.dataset.n, true);
  });
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const g = e.target.closest('[data-kind="table"]');
    if (g) { e.preventDefault(); chooseTable(g.dataset.n, true); }
  });
  document.getElementById('ord-plan-in').addEventListener('click', () => zoomPlan(1));
  document.getElementById('ord-plan-out').addEventListener('click', () => zoomPlan(-1));
  centerPlanOnMine();
}

function zoomPlan(direction) {
  const i = Math.max(0, Math.min(PLAN_ZOOMS.length - 1, PLAN_ZOOMS.indexOf(planZoom) + direction));
  planZoom = PLAN_ZOOMS[i];
  document.getElementById('ord-plan-svg').style.width = (planZoom * 100) + '%';
  centerPlanOnMine();
}

// When zoomed in, scroll so the customer's own table is in view.
function centerPlanOnMine() {
  const box = document.getElementById('ord-plan-scroll');
  const svg = document.getElementById('ord-plan-svg');
  const mine = String(state.tableNumber || '').trim().toLowerCase();
  const table = mine && planData.tables.find((t) => String(t.n).toLowerCase() === mine);
  if (!box || !table || planZoom === 1) return;
  const width = svg.getBoundingClientRect().width;
  box.scrollLeft = Math.max(0, (table.x / FloorPlan.W) * width - box.clientWidth / 2);
  box.scrollTop = Math.max(0, (table.y / FloorPlan.H) * (width * FloorPlan.H / FloorPlan.W) - box.clientHeight / 2);
}

// Moving to another table keeps the cart and re-tags the order: ?table= in the address bar follows, so a refresh or
// re-scan lands on the new table too. (v1.3)
function chooseTable(label, fromPlan) {
  state.tableNumber = label;
  state.orderType = 'dine_in';
  state.editTable = false;
  const box = document.getElementById('ord-table-input');
  if (box) box.value = label; // otherwise the cart reads the old typed number back over the new one
  try {
    const q = new URLSearchParams(location.search);
    q.set('table', label);
    history.replaceState(null, '', location.pathname + '?' + q.toString());
  } catch (e) {}
  renderHeader();
  toast('Order moved to Table ' + label);
  if (fromPlan) closePlan(); else renderCartDrawer();
}

function closePlan() {
  if (planFromCart) { renderCartDrawer(); openDrawer('ord-cart-drawer'); }
  else closeDrawers();
}

/* ================= INIT ================= */

// mode: 'busy' = spinner; 'retry' = message + Try again; 'stop' = message only (trying again would not help)
// hint: an optional second line, for the case where the listing was only just set up
function setLoading(message, mode, hint) {
  document.getElementById('ord-loading').hidden = false;
  document.getElementById('ord-app').hidden = true;
  document.getElementById('ord-loading-text').textContent = message;
  document.getElementById('ord-loading-hint').textContent = hint || '';
  document.getElementById('ord-loading-hint').hidden = !hint;
  document.getElementById('ord-spinner').hidden = mode !== 'busy';
  document.getElementById('ord-retry').hidden = mode !== 'retry';
}

// Up to 3 tries before giving up, so a slow first scan (or a listing that has only just been published)
// sorts itself out without the customer doing anything. (v1.1)
async function loadWithRetry() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await fetchCatalog();
      return;
    } catch (err) {
      if (attempt === 3 || err.status === 404 || !BIZ_ID) throw err;
      setLoading('Still loading the menu\u2026 (try ' + (attempt + 1) + ' of 3)', 'busy', 'If this menu was only just set up, it can take a moment to appear.');
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
}

let listenersWired = false;

async function start() {
  setLoading('Loading the menu\u2026', 'busy');
  try {
    await loadWithRetry();
  } catch (err) {
    const stop = err.status === 404 || !BIZ_ID;
    setLoading(stop ? err.message : 'We could not load the menu. Check your connection, then tap Try again.', stop ? 'stop' : 'retry',
      stop ? '' : 'If this menu was only just set up, wait a minute and try again.');
    return;
  }
  syncCartWithCatalog();
  // The seller's own theme choice (Settings tab) is the real per-listing look; an explicit ?theme= link
  // (support/testing) still wins over it. order-themes.js already applied its best guess synchronously at
  // script-load time (so there's no flash of the wrong look before this fetch resolves) — this just swaps
  // in the seller's actual saved choice now that it's known. (v1.6)
  if (window.OrderThemes && state.business.theme && !params.get('theme')) OrderThemes.apply(state.business.theme);
  state.orderType = pickInitialOrderType();
  document.getElementById('ord-loading').hidden = true;
  document.getElementById('ord-app').hidden = false;

  renderHeader();
  renderVideoBanner();
  renderAds();
  renderPicks();
  renderCatalog();
  renderCartBar();

  if (listenersWired) return;
  listenersWired = true;
  document.getElementById('ord-cart-bar-btn').addEventListener('click', () => { renderCartDrawer(); openDrawer('ord-cart-drawer'); });
  document.getElementById('ord-cart-close').addEventListener('click', closeDrawers);
  document.getElementById('ord-summary-close').addEventListener('click', closeDrawers);
  document.getElementById('ord-drawer-backdrop').addEventListener('click', closeDrawers);
  document.getElementById('ord-plan-btn').addEventListener('click', () => openPlan(false));
  document.getElementById('ord-plan-close').addEventListener('click', closePlan);
}

function init() {
  loadCart();
  document.getElementById('ord-retry').addEventListener('click', start);
  start();
}

document.addEventListener('DOMContentLoaded', init);
