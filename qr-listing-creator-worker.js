/* ============================================================
   QR Listing Creator — ordering backend (Cloudflare Worker + D1)
   VERSION 1.5 (2026-09-24) — v1.5: private product Cost (seller-only). Base v1.1: security + correctness pass, floor plans.
   Full change list and API notes: QLC_HANDOFF_v1.1.md (v1.5: QLC_HANDOFF_v1.5_ADDENDUM.md)
   ------------------------------------------------------------
   Deploys separately from GitHub Pages, same pattern as every other
   *-worker.js on this site — holds nothing secret this time (no API
   key), but it's still the only thing allowed to write to the
   database, and the only place an order's real total is decided.

   WHY THIS TOOL IS DIFFERENT FROM EVERY OTHER CALCULATOR HERE:
   Every other tool on Reysourcez promises "nothing is saved" — an
   order can't make that promise, since it has to survive the trip
   from a customer's phone to the seller's dashboard and, later, a
   kitchen screen. This is the first tool with a real database
   (Cloudflare D1, generous free tier) behind it.

   AUTH, HONESTLY STATED: there's no login system anywhere on this
   site yet, so v1 uses one admin key per business — a long random
   string handed back once at setup (see handleSetup). Whoever has
   it can manage that business's catalog and see its orders. That's
   genuinely weaker than a real account system; fine for a soft
   launch where the seller keeps their own key safe, worth upgrading
   (Cloudflare Access, or real email+password) before this handles
   serious volume.
   v1.1: the key is stored only as a SHA-256 hash (listings made
   earlier upgrade themselves the first time their key is used),
   and travels in an X-Admin-Key header instead of the URL.

   MONEY: no payment gateway is wired up here on purpose (see chat
   with the business owner, 2026-09) — an order just produces a
   summary; whoever's actually taking payment today (a POS, or cash)
   works from that. What IS built in: handleOrder() below always
   recomputes the total from THIS database's own product prices,
   never trusts whatever the browser's own cart total says. Same
   discipline as the recipe-cost math elsewhere on this site — the
   number shown while browsing is a preview, this is the real one.
   v1.1: that now covers combo option prices and the purchase-with-
   purchase offer as well — before, option prices were taken from
   the browser. Money is added up in whole sen, never floats.

   ONE-TIME SETUP (Cloudflare dashboard, no CLI needed — corrected
   2026-09-18 against Cloudflare's own current docs: their dashboard
   has since moved D1 OUT of the Workers & Pages menu, which is
   exactly the kind of thing worth re-checking rather than trusting
   from memory):
     1. dash.cloudflare.com -> Workers & Pages -> Create application
        -> Start with Hello World! -> Get started. Name it (e.g.
        qr-listing-creator-proxy) -> Deploy. Then open it, click the
        Edit code icon (</>), delete everything in the editor, paste
        this whole file in, and Save.
     2. Left sidebar -> Storage & Databases -> D1 SQL Database ->
        Create Database. Name it (e.g. qr-listing-db) -> location
        hint can be left blank -> Create.
     3. On that database's own page -> Console tab -> paste and run
        the three CREATE TABLE blocks and two CREATE INDEX lines
        below, once.
     4. Workers & Pages -> select your Worker -> Bindings tab -> Add
        binding -> D1 database -> Add binding. Variable name must be
        exactly DB, capital letters (this file reads env.DB) -> pick
        qr-listing-db from the dropdown -> Add binding.
     5. Back in Edit code, confirm ALLOWED_ORIGINS below lists your
        real domain(s) -> Save.
     6. Copy the Worker's *.workers.dev URL (shown on its own
        overview page) into WORKER_ENDPOINT in qr-listing-creator.js,
        order.js AND the connect-src line of the security policy at
        the top of order.html (three places, all the same URL).

   UPGRADING TO v1.5 (private product Cost) — D1 Console, once, then paste this file into the Worker as usual:
          ALTER TABLE products ADD COLUMN cost REAL;
        (Skip it if you created the tables from THIS version of the file.) Until it runs, menus and orders work as
        normal; only saving a Cost is refused, with a message saying why.

   UPGRADING AN EXISTING DATABASE TO v1.1 — in this order:
     A. D1 Console: run this one line, once (room for floor plans):
          ALTER TABLE businesses ADD COLUMN floor_plan TEXT;
        (Skip it if you created the tables from THIS version of the
        file — the CREATE TABLE below already includes the column.)
     B. Worker -> Edit code -> paste this whole file -> Save and deploy.
     C. Only then upload the website files — they need this Worker.
     Until step A is done, menus and orders work as normal; only
     saving a floor plan is refused, with a message saying why.

   ---- paste into the D1 Console once, before first use ----
   CREATE TABLE businesses (
     id TEXT PRIMARY KEY,
     admin_key TEXT NOT NULL,
     name TEXT NOT NULL,
     vertical TEXT NOT NULL DEFAULT 'fnb',
     table_count INTEGER NOT NULL DEFAULT 0,
     video_banner_url TEXT,
     pwp_trigger_product_id TEXT,
     pwp_offer_product_id TEXT,
     pwp_offer_price REAL,
     floor_plan TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE products (
     id TEXT PRIMARY KEY,
     business_id TEXT NOT NULL,
     name TEXT NOT NULL,
     description TEXT,
     price REAL NOT NULL,
     image_url TEXT,
     category TEXT,
     type TEXT NOT NULL DEFAULT 'single',
     is_featured INTEGER NOT NULL DEFAULT 0,
     is_active INTEGER NOT NULL DEFAULT 1,
     tags TEXT,
     combo_groups TEXT,
     set_items TEXT,
     cost REAL,
     sort_order INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE TABLE orders (
     id TEXT PRIMARY KEY,
     business_id TEXT NOT NULL,
     order_type TEXT NOT NULL,
     table_number TEXT,
     delivery_name TEXT,
     delivery_phone TEXT,
     delivery_address TEXT,
     items_json TEXT NOT NULL,
     subtotal REAL NOT NULL,
     status TEXT NOT NULL DEFAULT 'new',
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX idx_products_biz ON products(business_id);
   CREATE INDEX idx_orders_biz ON orders(business_id, created_at);
   ------------------------------------------------------------

   Contract with the browser (owner-only calls send the key as an
   X-Admin-Key header; ?key=Y is still accepted for pages cached from
   before v1.1 and should be removed later):
     POST   /setup                     { name, vertical, tableCount } -> { businessId, adminKey }
     GET    /catalog?biz=X             -> { business{..., hasFloorPlan}, products }  (+ each product's private cost when X-Admin-Key is sent)
     POST   /catalog?biz=X             { product fields; id = update }   -> { id }   (owner)
     DELETE /catalog?biz=X&id=Z        -> { ok }                          (owner)
     POST   /business?biz=X            { settings fields }            -> { ok, settings }  (owner)
     GET    /floorplan?biz=X           -> { plan | null }
     POST   /floorplan?biz=X           { plan }  (null / empty clears)  -> { ok, plan }  (owner)
     POST   /order?biz=X               { orderType, items, ... }      -> { orderId, items, adjustments, subtotal }
     GET    /orders?biz=X              -> { orders }                      (owner)
   ============================================================ */

const ALLOWED_ORIGINS = ['https://reysourcez.com', 'https://www.reysourcez.com'];

// Limits live in one place so they're easy to tune. (v1.1)
const MAX_LINES = 40;        // distinct cart lines in one order — D1 allows 100 bound parameters per query; this stays well under
const MAX_QTY = 50;          // units of any one line
const CODE_TRIES = 6;        // re-rolls when a short order / listing code is already taken
const HASH_PREFIX = 'h1:';   // marks an admin key that is stored as a SHA-256 hash, not plain text
const PLAN_W = 640;          // floor plan canvas — must match W / H in floor-plan.js
const PLAN_H = 400;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
  };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/* ---------- small helpers ---------- */

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'business';
}
// No 0/O/1/I/l in here — a key someone has to retype from a printed sheet
// shouldn't hinge on squinting at a font.
function randomKey(len) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = '';
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}
function orderCode() { return randomKey(4).toUpperCase(); }
function safeParse(text) { try { return JSON.parse(text); } catch (e) { return null; } }
function jsonOrNull(v) { return v ? JSON.stringify(v) : null; }

function cleanText(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
// Table names: letters, digits, space, dot, dash, underscore — the same rule the order page uses on ?table=
function cleanLabel(v, max) { return String(v == null ? '' : v).replace(/[^\w .-]/g, '').trim().slice(0, max); }
// '' (nothing) or an https:// link. null = something else (http:, data:, javascript: ...).
function cleanHttpsUrl(v) {
  const s = cleanText(v, 500);
  if (s && !/^https:\/\//i.test(s)) return null;
  return s;
}
// An amount from the browser: finite, not negative, rounded to whole sen. null = not usable.
function parseMoney(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!isFinite(n) || n < 0 || n > 1000000) return null;
  return Math.round(n * 100) / 100;
}
// Money is added up in whole sen (RM x 100) so 0.1 + 0.2 style drift can never reach a total.
const toSen = (rm) => Math.round((Number(rm) || 0) * 100);
const fromSen = (sen) => sen / 100;

function cleanComboGroups(groups) {
  if (!Array.isArray(groups)) return null;
  const out = groups.slice(0, 10).map((g) => ({
    label: cleanText(g && g.label, 60) || 'Choose one',
    options: (Array.isArray(g && g.options) ? g.options : []).slice(0, 30)
      .map((o) => ({ name: cleanText(o && o.name, 60), priceDelta: parseMoney(o && o.priceDelta) || 0 }))
      .filter((o) => o.name),
  })).filter((g) => g.options.length);
  return out.length ? out : null;
}
function cleanSetItems(items) {
  if (!Array.isArray(items)) return null;
  const out = items.slice(0, 30)
    .map((s) => ({ name: cleanText(s && typeof s === 'object' ? s.name : s, 80) }))
    .filter((s) => s.name);
  return out.length ? out : null;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const coord = (v, max) => Math.round(clamp(Number(v) || 0, 0, max));

// The floor plan the seller draws. Everything is re-built from known fields with hard limits, so what
// gets stored is always a small, well-formed drawing no matter what the browser sent. An empty drawing
// counts as "no floor plan".
function cleanFloorPlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const walls = (Array.isArray(plan.walls) ? plan.walls : []).slice(0, 300).map((w) => ({
    x1: coord(w && w.x1, PLAN_W), y1: coord(w && w.y1, PLAN_H), x2: coord(w && w.x2, PLAN_W), y2: coord(w && w.y2, PLAN_H),
  })).filter((w) => w.x1 !== w.x2 || w.y1 !== w.y2);

  const tables = [];
  const seen = new Set();
  for (const t of (Array.isArray(plan.tables) ? plan.tables : []).slice(0, 200)) {
    const n = cleanLabel(t && t.n, 8);
    if (!n || seen.has(n.toLowerCase())) continue; // a table name appears once
    seen.add(n.toLowerCase());
    tables.push({ n, x: coord(t.x, PLAN_W), y: coord(t.y, PLAN_H), shape: t.shape === 'square' ? 'square' : 'round' });
  }
  const marks = (list) => (Array.isArray(list) ? list : []).slice(0, 10).map((m) => ({ x: coord(m && m.x, PLAN_W), y: coord(m && m.y, PLAN_H) }));
  const doors = marks(plan.doors);
  const cashiers = marks(plan.cashiers);
  if (!walls.length && !tables.length && !doors.length && !cashiers.length) return null;
  return { v: 1, walls, tables, doors, cashiers };
}

/* ---------- admin key: stored as a hash, checked without leaking timing ---------- */

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
// The key normally rides in the X-Admin-Key header. ?key= is still read so a page cached from before
// v1.1 keeps working for a while — remove this fallback once every seller has reloaded.
function readKey(request, url) {
  return request.headers.get('X-Admin-Key') || url.searchParams.get('key') || '';
}
async function requireOwner(env, bizId, key) {
  if (!key || !bizId) return false;
  const row = await env.DB.prepare('SELECT admin_key FROM businesses WHERE id = ?').bind(bizId).first();
  if (!row) return false;
  const hashed = HASH_PREFIX + await sha256Hex(key);
  if (safeEqual(row.admin_key, hashed)) return true;
  // A listing made before v1.1 still holds its key in plain text: accept it once, then swap it for its hash.
  if (!row.admin_key.startsWith(HASH_PREFIX) && safeEqual(row.admin_key, key)) {
    await env.DB.prepare('UPDATE businesses SET admin_key = ? WHERE id = ?').bind(hashed, bizId).run();
    return true;
  }
  return false;
}

/* ---------- floor plan storage (the floor_plan column is added by the one-line upgrade in the header) ---------- */

async function readFloorPlan(env, bizId) {
  try {
    const row = await env.DB.prepare('SELECT floor_plan FROM businesses WHERE id = ?').bind(bizId).first();
    return row && row.floor_plan ? safeParse(row.floor_plan) : null;
  } catch (e) {
    return null; // column not added yet: same as "no floor plan", never a broken menu
  }
}
async function floorPlanExists(env, bizId) {
  try {
    const row = await env.DB.prepare('SELECT 1 AS yes FROM businesses WHERE id = ? AND floor_plan IS NOT NULL').bind(bizId).first();
    return !!row;
  } catch (e) {
    return false;
  }
}

/* ---------- handlers ---------- */

async function handleSetup(env, body, origin) {
  const name = cleanText(body.name, 80);
  const vertical = ['fnb', 'retail', 'service'].includes(body.vertical) ? body.vertical : 'fnb';
  const tableCount = Math.max(0, Math.min(200, parseInt(body.tableCount, 10) || 0));
  if (!name) return json({ error: 'Give your business a name first.' }, 400, origin);

  const adminKey = randomKey(16);
  const keyHash = HASH_PREFIX + await sha256Hex(adminKey);
  const base = slugify(name);
  for (let attempt = 0; attempt < CODE_TRIES; attempt++) {
    const id = attempt === 0 ? base : base + '-' + randomKey(4);
    const res = await env.DB.prepare('INSERT OR IGNORE INTO businesses (id, admin_key, name, vertical, table_count) VALUES (?, ?, ?, ?, ?)')
      .bind(id, keyHash, name, vertical, tableCount).run();
    if (res.meta && res.meta.changes === 1) return json({ businessId: id, adminKey }, 200, origin);
  }
  return json({ error: 'Could not create that listing just now — please try again.' }, 500, origin);
}

async function handleGetCatalog(env, bizId, origin, owner) {
  const business = await env.DB.prepare(
    'SELECT id, name, vertical, table_count, video_banner_url, pwp_trigger_product_id, pwp_offer_product_id, pwp_offer_price FROM businesses WHERE id = ?'
  ).bind(bizId).first();
  if (!business) return json({ error: 'No listing found for that link — check the QR or URL.' }, 404, origin);

  const { results } = await env.DB.prepare(
    'SELECT id, name, description, price, image_url, category, type, is_featured, tags, combo_groups, set_items FROM products WHERE business_id = ? AND is_active = 1 ORDER BY sort_order ASC, name ASC'
  ).bind(bizId).all();

  const products = (results || []).map((p) => ({
    id: p.id, name: p.name, description: p.description, price: p.price, imageUrl: p.image_url,
    category: p.category, type: p.type, isFeatured: !!p.is_featured,
    tags: p.tags ? p.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    comboGroups: p.combo_groups ? safeParse(p.combo_groups) : null,
    setItems: p.set_items ? safeParse(p.set_items) : null,
  }));

  // Cost is private: only a request carrying this business's own admin key ever receives it. (v1.5)
  if (owner) {
    try {
      const { results: costRows } = await env.DB.prepare('SELECT id, cost FROM products WHERE business_id = ? AND is_active = 1').bind(bizId).all();
      const costs = new Map((costRows || []).map((r) => [r.id, r.cost]));
      products.forEach((p) => { p.cost = costs.has(p.id) ? costs.get(p.id) : null; });
    } catch (e) { /* column not added yet: no costs to show */ }
  }

  return json({
    business: {
      id: business.id, name: business.name, vertical: business.vertical, tableCount: business.table_count,
      videoBannerUrl: business.video_banner_url, pwpTriggerProductId: business.pwp_trigger_product_id,
      pwpOfferProductId: business.pwp_offer_product_id, pwpOfferPrice: business.pwp_offer_price,
      hasFloorPlan: await floorPlanExists(env, bizId),
    },
    products,
  }, 200, origin);
}

// Update-or-create, but an update only ever touches a product that belongs to THIS business. (v1.1)
// The old single "upsert" statement matched on the product id alone — and product ids are public in
// /catalog — so one business could overwrite another's items just by sending that id.
async function handleUpsertProduct(env, bizId, key, body, origin) {
  if (!(await requireOwner(env, bizId, key))) return json({ error: 'Not authorized for this business.' }, 403, origin);

  const name = cleanText(body.name, 100);
  const price = parseMoney(body.price);
  if (!name || price === null) return json({ error: 'Every item needs a name and a valid price.' }, 400, origin);
  const imageUrl = cleanHttpsUrl(body.imageUrl);
  if (imageUrl === null) return json({ error: 'Image links need to start with https://' }, 400, origin);
  // Cost is private and optional (v1.5): '' clears it; undefined (an older cached page) leaves it alone.
  let cost;
  if (body.cost !== undefined) {
    const blank = body.cost === '' || body.cost === null;
    cost = blank ? null : parseMoney(body.cost);
    if (!blank && cost === null) return json({ error: 'Cost needs to be a valid amount, or leave it blank.' }, 400, origin);
  }

  const type = ['single', 'combo', 'set'].includes(body.type) ? body.type : 'single';
  const tags = (Array.isArray(body.tags) ? body.tags : [])
    .map((t) => cleanText(t, 30).replace(/,/g, ' ')).filter(Boolean).slice(0, 12).join(',');
  const fields = [
    name, cleanText(body.description, 500), price, imageUrl, cleanText(body.category, 60), type, body.isFeatured ? 1 : 0, tags,
    type === 'combo' ? jsonOrNull(cleanComboGroups(body.comboGroups)) : null,
    type === 'set' ? jsonOrNull(cleanSetItems(body.setItems)) : null,
  ];

  if (body.id) {
    const id = String(body.id);
    const res = await env.DB.prepare(`
      UPDATE products SET name=?, description=?, price=?, image_url=?, category=?, type=?, is_featured=?, tags=?, combo_groups=?, set_items=?
      WHERE id = ? AND business_id = ? AND is_active = 1
    `).bind(...fields, id, bizId).run();
    if (!res.meta || res.meta.changes < 1) return json({ error: 'That item was not found in this listing — it may have been removed.' }, 404, origin);
    return await finishProduct(env, bizId, id, cost, origin);
  }

  const id = Date.now().toString(36) + randomKey(4);
  await env.DB.prepare(`
    INSERT INTO products (id, business_id, name, description, price, image_url, category, type, is_featured, tags, combo_groups, set_items, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)
  `).bind(id, bizId, ...fields).run();
  return await finishProduct(env, bizId, id, cost, origin);
}

// Cost lives in its own column (added by the one-line v1.5 upgrade) and is saved separately, so a listing whose database
// has not been upgraded yet still saves everything else and is told exactly what to run. (v1.5)
async function finishProduct(env, bizId, id, cost, origin) {
  if (cost === undefined) return json({ id }, 200, origin);
  try {
    await env.DB.prepare('UPDATE products SET cost = ? WHERE id = ? AND business_id = ?').bind(cost, id, bizId).run();
  } catch (err) {
    if (/no such column/i.test(String(err && err.message))) {
      return json({ id, warning: 'Saved, but Cost needs the one-time database update: run  ALTER TABLE products ADD COLUMN cost REAL;  in the D1 console, then save again.' }, 200, origin);
    }
    throw err;
  }
  return json({ id }, 200, origin);
}

async function handleDeleteProduct(env, bizId, key, productId, origin) {
  if (!(await requireOwner(env, bizId, key))) return json({ error: 'Not authorized for this business.' }, 403, origin);
  await env.DB.prepare('UPDATE products SET is_active = 0 WHERE id = ? AND business_id = ?').bind(productId, bizId).run();
  return json({ ok: true }, 200, origin);
}

async function handleUpdateBusiness(env, bizId, key, body, origin) {
  if (!(await requireOwner(env, bizId, key))) return json({ error: 'Not authorized for this business.' }, 403, origin);

  const videoBannerUrl = cleanHttpsUrl(body.videoBannerUrl);
  if (videoBannerUrl === null) return json({ error: 'The video link needs to start with https://' }, 400, origin);
  const tableCount = Math.max(0, Math.min(200, parseInt(body.tableCount, 10) || 0));

  const trigger = body.pwpTriggerProductId ? String(body.pwpTriggerProductId) : null;
  const offer = body.pwpOfferProductId ? String(body.pwpOfferProductId) : null;
  let offerPrice = null;
  if (trigger || offer) {
    if (!trigger || !offer) return json({ error: 'Pick both the trigger item and the offer item — or clear both.' }, 400, origin);
    if (trigger === offer) return json({ error: 'The trigger and the offer need to be two different items.' }, 400, origin);
    if (body.pwpOfferPrice != null && body.pwpOfferPrice !== '') {
      offerPrice = parseMoney(body.pwpOfferPrice);
      if (offerPrice === null) return json({ error: 'The offer price needs to be a valid amount.' }, 400, origin);
    }
    // Both must be live items in THIS listing, and the offer can't be a combo (it needs choices made).
    const { results } = await env.DB.prepare('SELECT id, type FROM products WHERE business_id = ? AND is_active = 1 AND id IN (?, ?)')
      .bind(bizId, trigger, offer).all();
    const found = new Map((results || []).map((r) => [r.id, r]));
    if (!found.has(trigger) || !found.has(offer)) return json({ error: 'Both items need to be products in this listing.' }, 400, origin);
    if (found.get(offer).type === 'combo') return json({ error: 'A combo can’t be the offer item — pick a single item or a set.' }, 400, origin);
  }

  await env.DB.prepare(`
    UPDATE businesses SET video_banner_url=?, table_count=?, pwp_trigger_product_id=?, pwp_offer_product_id=?, pwp_offer_price=?
    WHERE id=?
  `).bind(videoBannerUrl || null, tableCount, trigger, offer, offerPrice, bizId).run();

  // Echo what was really saved so the seller page never drifts from the database.
  return json({ ok: true, settings: {
    tableCount, videoBannerUrl: videoBannerUrl || null,
    pwpTriggerProductId: trigger, pwpOfferProductId: offer, pwpOfferPrice: offerPrice,
  } }, 200, origin);
}

async function handleGetFloorPlan(env, bizId, origin) {
  const business = await env.DB.prepare('SELECT id FROM businesses WHERE id = ?').bind(bizId).first();
  if (!business) return json({ error: 'No listing found for that link.' }, 404, origin);
  return json({ plan: await readFloorPlan(env, bizId) }, 200, origin);
}

async function handleSaveFloorPlan(env, bizId, key, body, origin) {
  if (!(await requireOwner(env, bizId, key))) return json({ error: 'Not authorized for this business.' }, 403, origin);
  const plan = cleanFloorPlan(body.plan); // null (nothing drawn) clears the floor plan
  const text = plan ? JSON.stringify(plan) : null;
  if (text && text.length > 60000) return json({ error: 'That floor plan is too detailed — remove some walls and save again.' }, 400, origin);
  try {
    await env.DB.prepare('UPDATE businesses SET floor_plan = ? WHERE id = ?').bind(text, bizId).run();
  } catch (err) {
    if (/no such column/i.test(String(err && err.message))) {
      return json({ error: 'Your database needs its one-time update before floor plans can be saved. Run the ALTER TABLE line from the update notes, then save again.' }, 500, origin);
    }
    throw err;
  }
  return json({ ok: true, plan }, 200, origin);
}

// The one place money actually gets decided — every price is looked up fresh from the database, and
// (v1.1) that now includes combo option prices and the purchase-with-purchase offer. Nothing the browser
// says about a price is used.
async function handleOrder(env, bizId, body, origin) {
  const business = await env.DB.prepare(
    'SELECT id, vertical, pwp_trigger_product_id, pwp_offer_product_id, pwp_offer_price FROM businesses WHERE id = ?'
  ).bind(bizId).first();
  if (!business) return json({ error: 'No listing found for that link.' }, 404, origin);

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) return json({ error: 'Your cart is empty.' }, 400, origin);
  if (items.length > MAX_LINES) return json({ error: 'That is a lot of different items — please split it into two orders.' }, 400, origin);

  // Where it's going, and the details that place needs.
  let orderType = ['dine_in', 'takeaway', 'delivery'].includes(body.orderType) ? body.orderType : 'takeaway';
  if (orderType === 'dine_in' && business.vertical !== 'fnb') orderType = 'takeaway'; // only food & drink has tables
  const tableNumber = cleanLabel(body.tableNumber, 12);
  const delivery = {
    name: cleanText(body.delivery && body.delivery.name, 80),
    phone: cleanText(body.delivery && body.delivery.phone, 30),
    address: cleanText(body.delivery && body.delivery.address, 300),
  };
  if (orderType === 'dine_in' && !tableNumber) return json({ error: 'Enter your table number first.' }, 400, origin);
  if (orderType === 'delivery' && !(delivery.name && delivery.phone && delivery.address)) {
    return json({ error: 'Fill in your name, phone, and address for delivery.' }, 400, origin);
  }

  // One query for every product in the cart (a Free-plan Worker is capped at 50 D1 queries per request).
  const ids = [...new Set(items.map((i) => String((i && i.productId) || '')).filter(Boolean))];
  const { results } = ids.length
    ? await env.DB.prepare(`SELECT id, name, price, type, combo_groups FROM products WHERE business_id = ? AND is_active = 1 AND id IN (${ids.map(() => '?').join(',')})`)
        .bind(bizId, ...ids).all()
    : { results: [] };
  const byId = new Map((results || []).map((p) => [p.id, p]));

  const priced = [];
  let subtotalSen = 0;
  for (const item of items) {
    const product = byId.get(String((item && item.productId) || ''));
    if (!product) continue; // since-removed item — skip it rather than fail the whole order
    const qty = Math.max(1, Math.min(MAX_QTY, parseInt(item.qty, 10) || 1));

    // Combo picks are checked against THIS product's own option list (matched by position) and priced
    // from it. If the seller changed the options since the customer added it, say so instead of guessing.
    let selectedOptions = [];
    let optionsSen = 0;
    const groups = product.type === 'combo' && product.combo_groups ? safeParse(product.combo_groups) : null;
    if (Array.isArray(groups) && groups.length) {
      const picks = Array.isArray(item.selectedOptions) ? item.selectedOptions : [];
      const stale = { error: `The options for ${product.name} have changed — please remove it from your cart and add it again.` };
      if (picks.length !== groups.length) return json(stale, 400, origin);
      for (let gi = 0; gi < groups.length; gi++) {
        const opt = (groups[gi].options || []).find((o) => o.name === (picks[gi] && picks[gi].name));
        if (!opt) return json(stale, 400, origin);
        selectedOptions.push({ groupLabel: groups[gi].label, name: opt.name, priceDelta: Number(opt.priceDelta) || 0 });
        optionsSen += toSen(opt.priceDelta);
      }
    }

    const unitSen = toSen(product.price) + optionsSen;
    const lineSen = unitSen * qty;
    subtotalSen += lineSen;
    priced.push({ productId: product.id, name: product.name, qty, unitPrice: fromSen(unitSen), lineTotal: fromSen(lineSen), selectedOptions });
  }
  if (!priced.length) return json({ error: 'None of those items are available anymore — please refresh the menu.' }, 400, origin);

  // Purchase-with-purchase: with the trigger item in the order, ONE unit of the offer item drops to the
  // offer price. Decided here; the order page only mirrors it for the preview total.
  const adjustments = [];
  const trig = business.pwp_trigger_product_id;
  const off = business.pwp_offer_product_id;
  if (trig && off && trig !== off && business.pwp_offer_price != null
      && priced.some((l) => l.productId === trig) && priced.some((l) => l.productId === off)) {
    const savingSen = toSen(byId.get(off).price) - toSen(business.pwp_offer_price);
    if (savingSen > 0) {
      adjustments.push({ label: 'Offer price: ' + byId.get(off).name, amount: -fromSen(savingSen) });
      subtotalSen -= savingSen;
    }
  }

  // The short code is the primary key across ALL businesses, so two orders can roll the same one.
  // INSERT OR IGNORE + re-roll turns that from a failed order into a non-event.
  let id = null;
  for (let attempt = 0; attempt < CODE_TRIES && !id; attempt++) {
    const code = orderCode();
    const res = await env.DB.prepare(`
      INSERT OR IGNORE INTO orders (id, business_id, order_type, table_number, delivery_name, delivery_phone, delivery_address, items_json, subtotal, status)
      VALUES (?,?,?,?,?,?,?,?,?, 'new')
    `).bind(
      code, bizId, orderType,
      orderType === 'dine_in' ? tableNumber : null,
      orderType === 'delivery' ? delivery.name : null,
      orderType === 'delivery' ? delivery.phone : null,
      orderType === 'delivery' ? delivery.address : null,
      JSON.stringify({ lines: priced, adjustments }), fromSen(subtotalSen)
    ).run();
    if (res.meta && res.meta.changes === 1) id = code;
  }
  if (!id) return json({ error: 'Could not place that order just now — please try again.' }, 500, origin);

  return json({
    orderId: id, orderType, tableNumber: orderType === 'dine_in' ? tableNumber : null,
    items: priced, adjustments, subtotal: fromSen(subtotalSen),
  }, 200, origin);
}

async function handleGetOrders(env, bizId, key, origin) {
  if (!(await requireOwner(env, bizId, key))) return json({ error: 'Not authorized for this business.' }, 403, origin);
  const { results } = await env.DB.prepare(
    'SELECT id, order_type, table_number, delivery_name, delivery_phone, delivery_address, items_json, subtotal, status, created_at FROM orders WHERE business_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 500'
  ).bind(bizId).all();

  const orders = (results || []).map((o) => {
    // Orders saved before v1.1 stored just the list of lines; newer ones store { lines, adjustments }.
    const parsed = safeParse(o.items_json);
    const lines = Array.isArray(parsed) ? parsed : ((parsed && parsed.lines) || []);
    const adjustments = Array.isArray(parsed) ? [] : ((parsed && parsed.adjustments) || []);
    return {
      id: o.id, order_type: o.order_type, table_number: o.table_number,
      delivery_name: o.delivery_name, delivery_phone: o.delivery_phone, delivery_address: o.delivery_address,
      items: lines, adjustments, subtotal: o.subtotal, status: o.status, created_at: o.created_at,
    };
  });
  return json({ orders }, 200, origin);
}

async function readJson(request) {
  try {
    const b = await request.json();
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  } catch (e) {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(origin) });

    const url = new URL(request.url);
    const bizId = url.searchParams.get('biz') || '';
    const key = readKey(request, url);
    const path = url.pathname;

    try {
      let body = {};
      if (request.method === 'POST') {
        body = await readJson(request);
        if (!body) return json({ error: 'That request could not be read.' }, 400, origin);
      }
      if (path === '/setup' && request.method === 'POST') return await handleSetup(env, body, origin);
      if (path === '/catalog' && request.method === 'GET') return await handleGetCatalog(env, bizId, origin, key ? await requireOwner(env, bizId, key) : false);
      if (path === '/catalog' && request.method === 'POST') return await handleUpsertProduct(env, bizId, key, body, origin);
      if (path === '/catalog' && request.method === 'DELETE') return await handleDeleteProduct(env, bizId, key, url.searchParams.get('id') || '', origin);
      if (path === '/business' && request.method === 'POST') return await handleUpdateBusiness(env, bizId, key, body, origin);
      if (path === '/floorplan' && request.method === 'GET') return await handleGetFloorPlan(env, bizId, origin);
      if (path === '/floorplan' && request.method === 'POST') return await handleSaveFloorPlan(env, bizId, key, body, origin);
      if (path === '/order' && request.method === 'POST') return await handleOrder(env, bizId, body, origin);
      if (path === '/orders' && request.method === 'GET') return await handleGetOrders(env, bizId, key, origin);
      return json({ error: 'Unknown endpoint.' }, 404, origin);
    } catch (err) {
      // Path only (never the query string) so an admin key can't end up in the logs.
      console.error('[QR Listing Creator Worker]', request.method, path, (err && err.stack) || err);
      return json({ error: 'Something went wrong on the server side.' }, 500, origin);
    }
  },
};
