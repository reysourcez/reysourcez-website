/* QR Listing Creator — customer page themes (order-themes.js) — VERSION 1.4 (2026-09-25)
   10 food-app-inspired looks + the test dropdown. "Inspired by" = rough colour/layout approximations, not those apps'
   logos, fonts or assets. v1.4: this file is now also loaded on the SELLER page (qr-listing-creator.html), purely
   to read OrderThemes.list for its Theme picker — everything below the OrderThemes assignment only runs where
   #ord-app exists (the customer page), so the seller dashboard's own colours/session storage are never touched.
   Visible names are generic everywhere now (the "from" brand attribution is kept in this data only as an
   internal note for whoever edits this file — it's never rendered to anyone).
   c = [page bg, card surface, ink, accent, text-on-accent]; r = corner radius px; a = layout switches
   (cards grid|row|wide, cart bar|pill, nav pills|tabs); head = coloured header bar; x = extra CSS variables;
   f = Google Fonts family string; d / b = display / body font. */
(function () {
  const CFG = window.ORDER_CONFIG || {};
  const T = [
    { id: 'classic', n: 'Classic (Reysourcez)', from: 'current look' },
    { id: 'ubereats', n: 'Fresh Black & Green', from: 'Uber Eats', c: ['#FFFFFF', '#FFFFFF', '#000000', '#06C167', '#000000'], r: 12, f: 'Inter:wght@400;600;700;800', d: 'Inter', b: 'Inter', a: { cards: 'row', cart: 'pill' } },
    { id: 'doordash', n: 'Red Pill Rush', from: 'DoorDash', c: ['#F7F7F7', '#FFFFFF', '#191919', '#EB1700', '#FFFFFF'], r: 20, f: 'Plus+Jakarta+Sans:wght@500;700;800', d: 'Plus Jakarta Sans', b: 'Plus Jakarta Sans', x: { '--o-btn': '999px' } },
    { id: 'grab', n: 'Super-App Green', from: 'GrabFood', c: ['#F2F5F3', '#FFFFFF', '#1F2D28', '#00B14F', '#FFFFFF'], r: 14, f: 'DM+Sans:wght@400;500;700', d: 'DM Sans', b: 'DM Sans', head: 1, a: { nav: 'tabs' } },
    { id: 'foodpanda', n: 'Panda Pink', from: 'foodpanda', c: ['#FFF3F8', '#FFFFFF', '#2D2D2D', '#D70F64', '#FFFFFF'], r: 20, f: 'Nunito:wght@400;700;800', d: 'Nunito', b: 'Nunito', head: 1, a: { cart: 'pill' } },
    { id: 'shopeefood', n: 'Bazaar Orange', from: 'ShopeeFood', c: ['#F5F5F5', '#FFFFFF', '#222222', '#EE4D2D', '#FFFFFF'], r: 6, f: 'Roboto:wght@400;500;700', d: 'Roboto', b: 'Roboto', head: 1, a: { cards: 'row', nav: 'tabs' } },
    { id: 'deliveroo', n: 'Teal Wide Cards', from: 'Deliveroo', c: ['#FFFFFF', '#FFFFFF', '#2E3333', '#00CCBC', '#0B2B29'], r: 10, f: 'Rubik:wght@400;500;700', d: 'Rubik', b: 'Rubik', a: { cards: 'wide', cart: 'pill' } },
    { id: 'noirgold', n: 'Noir & Gold', from: 'premium dark / member style', c: ['#0E0E10', '#1A1A1D', '#F3EEDF', '#D4AF37', '#141414'], r: 6, f: 'Playfair+Display:wght@600;700;900&family=Inter:wght@400;600', d: 'Playfair Display', b: 'Inter', a: { cards: 'wide', nav: 'tabs' }, x: { '--tp-c1': '#8C6A12', '--tp-c2': '#F5D77A' } },
    { id: 'starbucks', n: 'Cafe Green & Cream', from: 'Starbucks', c: ['#F2F0EB', '#FFFFFF', '#1E3932', '#00704A', '#FFFFFF'], r: 16, f: 'Lato:wght@400;700;900', d: 'Lato', b: 'Lato', head: 1, a: { cards: 'row', cart: 'pill', nav: 'tabs' }, x: { '--o-img': '50%' } },
    { id: 'neo', n: 'Neo-Brutalist Snack', from: 'design trend', c: ['#FFF4D6', '#FFFFFF', '#111111', '#FFD23F', '#111111'], r: 6, f: 'Space+Grotesk:wght@400;500;700', d: 'Space Grotesk', b: 'Space Grotesk', x: { '--o-bw': '3px', '--o-shadow': '5px 5px 0 #111', '--line': '#111111', '--o-btn': '4px' } },
    { id: 'aurora', n: 'Soft Gradient', from: 'design trend', c: ['#F3F1FF', '#FFFFFF', '#1B1B3A', '#6C5CE7', '#FFFFFF'], r: 24, f: 'Outfit:wght@400;500;600;700', d: 'Outfit', b: 'Outfit', a: { cart: 'pill' }, x: { '--o-bg': 'radial-gradient(60% 45% at 8% 0%,#FFD6E8 0,transparent 70%),radial-gradient(55% 45% at 100% 15%,#C9D6FF 0,transparent 70%),#F3F1FF', '--o-shadow': '0 10px 30px rgba(108,92,231,.16)' } }
  ];
  const KEYS = ['--paper', '--surface', '--ink', '--text', '--accent', '--accent-dark', '--accent-soft', '--line', '--muted', '--on-accent', '--font-display', '--font-body', '--o-r', '--o-head', '--o-head-fg', '--o-bg', '--o-bw', '--o-shadow', '--o-img', '--o-btn', '--tp-c1', '--tp-c2'];
  const root = document.documentElement;
  const st = root.style;
  let fontLink = null;

  function loadFonts(t) {
    if (!t.f) { if (fontLink) { fontLink.remove(); fontLink = null; } return; }
    if (!fontLink) { fontLink = document.createElement('link'); fontLink.rel = 'stylesheet'; document.head.appendChild(fontLink); }
    fontLink.href = 'https://fonts.googleapis.com/css2?family=' + t.f + '&display=swap';
  }

  function apply(id) {
    const t = T.find((x) => x.id === id) || T[0];
    KEYS.forEach((k) => st.removeProperty(k));
    root.dataset.theme = t.id;
    const a = t.a || {};
    root.dataset.cards = a.cards || 'grid';
    root.dataset.cart = a.cart || 'bar';
    root.dataset.nav = a.nav || 'pills';
    if (t.head) root.dataset.head = '1'; else delete root.dataset.head;
    if (t.c) {
      const ink = t.c[2], ac = t.c[3], sf = t.c[1];
      const set = (k, v) => st.setProperty(k, v);
      set('--paper', t.c[0]); set('--surface', sf); set('--ink', ink); set('--text', ink); set('--accent', ac); set('--on-accent', t.c[4]);
      set('--accent-dark', 'color-mix(in srgb, ' + ac + ' 78%, #000)');
      set('--accent-soft', 'color-mix(in srgb, ' + ac + ' 16%, ' + sf + ')');
      set('--line', 'color-mix(in srgb, ' + ink + ' 16%, ' + sf + ')');
      set('--muted', 'color-mix(in srgb, ' + ink + ' 58%, ' + sf + ')');
      set('--o-r', t.r + 'px');
      if (t.d) set('--font-display', "'" + t.d + "', system-ui, sans-serif");
      if (t.b) set('--font-body', "'" + t.b + "', system-ui, sans-serif");
      if (t.head) { set('--o-head', ac); set('--o-head-fg', t.c[4]); }
      Object.keys(t.x || {}).forEach((k) => set(k, t.x[k]));
    }
    loadFonts(t);
    // Scoped per business (v1.6) so one seller's theme never leaks into another business's page in the
    // same browser tab session — computed inline so apply() behaves safely regardless of which page calls
    // it (the seller page's own Preview button never calls apply() itself, but this keeps it safe if that
    // ever changes).
    try { sessionStorage.setItem('ord-theme-' + (new URLSearchParams(location.search).get('biz') || ''), t.id); } catch (e) {}
    try { // keep a ?theme= link in step with the dropdown so a refresh stays put
      const u = new URL(location.href);
      if (u.searchParams.has('theme')) { u.searchParams.set('theme', t.id); history.replaceState(null, '', u); }
    } catch (e) {}
    const sel = document.querySelector('#ord-theme-test select');
    if (sel) sel.value = t.id;
  }

  // Every page that loads this file gets window.OrderThemes (the seller page's Settings tab reads
  // OrderThemes.list to build its Theme dropdown, never calling apply()). Everything below this line is
  // the CUSTOMER PAGE's own auto-apply + test dropdown, and only runs where #ord-app exists — the seller
  // dashboard must never have its own colours or session storage touched by a customer-page default. (v1.6)
  window.OrderThemes = { list: T, apply: apply };
  if (!document.getElementById('ord-app')) return;

  const qs = new URLSearchParams(location.search);
  let saved = null;
  try { saved = sessionStorage.getItem('ord-theme-' + (qs.get('biz') || '')); } catch (e) {} // scoped per business (v1.6)
  apply([qs.get('theme'), saved, CFG.defaultTheme].find((v) => v && T.some((t) => t.id === v)) || 'classic');

  const box = document.getElementById('ord-theme-test');
  const flag = qs.get('themetest'); // ?themetest=1 forces the dropdown on, =0 forces it off
  if (box && flag !== '0' && (CFG.themeTestMode || flag === '1')) {
    const sel = box.querySelector('select');
    T.forEach((t) => sel.add(new Option(t.n, t.id))); // generic name only — no brand attribution shown (v1.6)
    sel.value = root.dataset.theme;
    sel.addEventListener('change', () => apply(sel.value));
    box.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const i = (T.findIndex((t) => t.id === root.dataset.theme) + Number(b.dataset.step) + T.length) % T.length;
      apply(T[i].id);
    }));
    box.hidden = false;
  }
})();
