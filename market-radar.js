/* Market Radar page logic v1.7.0 (2026-10-15). Pure logic: market-radar-engine.js. This file: state, network, rendering.
   Rule: results are RENDERED from state into #mr-results — nothing is shown/hidden with the [hidden] attribute (author CSS overrides it). */
(function () {
  'use strict';
  const E = window.MarketRadarEngine;
  const $ = (id) => document.getElementById(id);
  if (!E) { $('mr-status').textContent = 'The analysis engine failed to load — refresh the page.'; return; }
  const esc = E.util.esc;
  const VERSION = '1.7.0';
  console.info('[Market Radar] page v' + VERSION + ' · engine v' + E.VERSION);

  const WORKER = 'https://market-radar-proxy.reysourcez-ent.workers.dev/';
  const MAX_PER_DAY = 15, USAGE_KEY = 'mr-usage', MAX_TICKED = 4, MAX_CUSTOM = 8;
  const DIRECT_MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const OVT_PATH = 'market-radar-data/overture-';
  const TOWNS = {
    miri: { label: 'Miri', lat: 4.4148, lng: 113.9917, district: 'Miri' },
    kuching: { label: 'Kuching', lat: 1.5535, lng: 110.3593, district: 'Kuching' },
    sibu: { label: 'Sibu', lat: 2.2870, lng: 111.8305, district: 'Sibu' },
    bintulu: { label: 'Bintulu', lat: 3.1668, lng: 113.0413, district: 'Bintulu' },
  };
  const CATCHMENTS = {
    walk5: { label: '5-minute walk', profile: 'foot-walking', seconds: 300, fallbackM: 400 },
    walk10: { label: '10-minute walk', profile: 'foot-walking', seconds: 600, fallbackM: 800 },
    walk15: { label: '15-minute walk', profile: 'foot-walking', seconds: 900, fallbackM: 1200 },
    drive5: { label: '5-minute drive', profile: 'driving-car', seconds: 300, fallbackM: 2500 },
    drive10: { label: '10-minute drive', profile: 'driving-car', seconds: 600, fallbackM: 5000 },
    drive15: { label: '15-minute drive', profile: 'driving-car', seconds: 900, fallbackM: 8000 },
  };
  const TABS = {
    analysis: [['opp', 'Best opportunities'], ['idea', 'Idea check'], ['area', 'Area snapshot'], ['biz', 'Businesses']],
    gap: [['comp', 'Best complements'], ['list', 'Household checklist'], ['area', 'Area snapshot'], ['biz', 'Businesses']],
  };
  const CUSTOM_RE = /^[A-Za-z0-9_:\-]{1,40}$/;

  const S = {
    mode: 'analysis', tab: 'opp', town: 'miri', catchment: 'walk10', pin: null, busy: false, stage: '', stale: false,
    data: null, an: null, focus: [], expanded: {}, filter: 'all', showAssump: false, ticked: ['cafe'], custom: [], customN: 0, customOpen: false,
    weights: Object.assign({}, E.IDEA_WEIGHTS), weightsOpen: false, onSite: null, onSiteMoved: null, vacancies: [], gapOnly: false,
    layers: { all: true, focus: true, heat: true, anchors: true, outside: false }, ai: { text: '', via: '', busy: false, err: '' },
    biz: { q: '', cat: '', src: '' }, printAll: false, ovt: {},
  };
  const catalog = () => E.CATEGORIES.concat(S.custom.map((c) => E.makeCustom(c.key, c.k, c.v)));
  const labelOf = (key) => { const c = (S.data && S.data.cat || catalog()).find((x) => x.key === key); return c ? c.label : key; };
  const fmtN = (n) => Number(n).toLocaleString('en-MY');
  const pct = (x) => Math.round(x * 100);
  function setStatus(msg, err) { const el = $('mr-status'); el.textContent = msg || ''; el.classList.toggle('is-error', !!err); }
  function setStage(msg) { S.stage = msg; setStatus(msg); if (S.busy) renderResults(); }
  const usageToday = () => { try { const r = JSON.parse(localStorage.getItem(USAGE_KEY) || 'null'); return r && r.day === new Date().toDateString() ? r.count : 0; } catch (e) { return 0; } };
  const recordUse = () => { try { localStorage.setItem(USAGE_KEY, JSON.stringify({ day: new Date().toDateString(), count: usageToday() + 1 })); } catch (e) { /* optional */ } };
  const ensureTab = () => { if (!TABS[S.mode].some((t) => t[0] === S.tab)) S.tab = TABS[S.mode][0][0]; };
  const focusKeys = () => (S.focus.length ? S.focus : (S.mode === 'analysis' && S.tab === 'idea' ? S.ticked : []));

  /* ================= map ================= */
  let map, pinMarker, catchLayer, heat, gAll, gFocus, gOutside, gAnchors;
  function initMap() {
    if (typeof L === 'undefined') { setStatus('The map library did not load (network or a blocker). Refresh to retry.', true); return false; }
    const T = TOWNS[S.town];
    map = L.map('mr-map', { preferCanvas: true }).setView([T.lat, T.lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    gAll = L.layerGroup().addTo(map); gOutside = L.layerGroup().addTo(map); gFocus = L.layerGroup().addTo(map); gAnchors = L.layerGroup().addTo(map);
    map.on('click', (e) => placePin(e.latlng.lat, e.latlng.lng, true));
    placePin(T.lat, T.lng, false);
    return true;
  }
  function placePin(lat, lng, fromUser) {
    S.pin = { lat, lng };
    if (map) {
      if (pinMarker) pinMarker.setLatLng([lat, lng]);
      else { pinMarker = L.marker([lat, lng], { draggable: true }).addTo(map); pinMarker.on('dragend', () => { const p = pinMarker.getLatLng(); placePin(p.lat, p.lng, true); }); }
    }
    $('mr-pin').textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
    if (fromUser && S.an) { S.stale = true; renderResults(); }
  }
  const SRC_LABEL = { osm: 'OpenStreetMap', ovt: 'Overture', geo: 'Geoapify' };
  const srcText = (p) => (p.sources.includes('osm') && p.sources.includes('ovt') ? 'Both sources' : SRC_LABEL[p.sources[0]] || p.sources[0]);
  const tip = (p) => esc(p.name || '(unnamed)') + ' — ' + esc(p.cats.map(labelOf).join(', ')) + ' · ' + esc(srcText(p));
  function drawMap() {
    if (!map) return;
    [gAll, gFocus, gOutside, gAnchors].forEach((g) => g.clearLayers());
    if (catchLayer) { map.removeLayer(catchLayer); catchLayer = null; }
    if (heat) { map.removeLayer(heat); heat = null; }
    const d = S.data; if (!d) return;
    catchLayer = L.polygon(d.ring, d.isReal ? { color: '#1F6F5C', weight: 2, fillOpacity: 0.08 } : { color: '#5C6D64', weight: 2, dashArray: '5 4', fillOpacity: 0.05 }).addTo(map);
    const fk = focusKeys(), isF = (p) => p.cats.some((c) => fk.includes(c));
    if (S.layers.all) d.pois.forEach((p) => { if (!fk.length || !isF(p)) L.circleMarker([p.lat, p.lng], { radius: 3, weight: 0, fillColor: '#8a948f', fillOpacity: 0.45 }).bindTooltip(tip(p)).addTo(gAll); });
    const fp = d.pois.filter(isF);
    if (S.layers.focus) fp.forEach((p) => {
      const ovtOnly = !p.sources.includes('osm');
      L.circleMarker([p.lat, p.lng], { radius: 6, color: p.sources.includes('ovt') && !ovtOnly ? '#6B3FA0' : (ovtOnly ? '#6B3FA0' : '#C0392B'), weight: 1.5, fillColor: ovtOnly ? '#6B3FA0' : '#C0392B', fillOpacity: 0.75 }).bindTooltip(tip(p)).addTo(gFocus);
    });
    if (S.layers.heat && fp.length && typeof L.heatLayer === 'function') { heat = L.heatLayer(fp.map((p) => [p.lat, p.lng, 1]), { radius: 35, blur: 25, max: 3, gradient: { 0.15: '#1F6F5C', 0.5: '#E8A33D', 1: '#C0392B' } }).addTo(map); }
    if (S.layers.outside) d.outside.filter(isF).forEach((p) => L.circleMarker([p.lat, p.lng], { radius: 6, color: '#8A8A8A', fillColor: '#fff', fillOpacity: 0.5, weight: 2, dashArray: '3,3' }).bindTooltip(tip(p) + ' (outside this area)').addTo(gOutside));
    if (S.layers.anchors) d.anchors.forEach((a) => L.marker([a.lat, a.lng], { icon: L.divIcon({ className: 'mr-anchor', html: '<span style="color:#2A5DB0;font-size:14px;line-height:14px;text-shadow:0 0 2px #fff,0 0 2px #fff">■</span>', iconSize: [14, 14] }) }).bindTooltip(esc(a.name || '(unnamed)') + ' — ' + esc(E.ANCHOR_BY_KEY[a.type].label)).addTo(gAnchors));
  }
  function renderLayers() {
    const box = (k, label) => '<label><input type="checkbox" data-layer="' + k + '"' + (S.layers[k] ? ' checked' : '') + '> ' + label + '</label>';
    $('mr-layers').innerHTML = S.data
      ? box('all', '<span class="mr-dot" style="background:#8a948f"></span> All businesses') + box('focus', '<span class="mr-dot" style="background:#C0392B"></span> Selected type (OSM) <span class="mr-dot" style="background:#6B3FA0"></span> (Overture only)')
        + box('heat', 'Heat map') + box('anchors', '<span style="color:#2A5DB0">■</span> Demand drivers') + box('outside', '<span class="mr-dot" style="border:2px dashed #8a8a8a;background:#fff"></span> Found, outside area')
      : '<span>Place the pin, then press Analyze. Pick a result to see its businesses here.</span>';
  }

  /* ================= data ================= */
  async function postWorker(body, ms) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), ms || 40000);
    try { return await fetch(WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: c.signal }); } finally { clearTimeout(t); }
  }
  async function fetchContext(cm, town, cat) {
    const groups = Array.from(new Set(cat.map((c) => c.iowrt).filter(Boolean)));
    try {
      const r = await postWorker({ mode: 'context', lat: S.pin.lat, lng: S.pin.lng, isochrone: { profile: cm.profile, seconds: cm.seconds }, district: town.district, iowrtGroups: groups }, 30000);
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      return j;
    } catch (e) { return { error: e.name === 'AbortError' ? 'timed out' : (e.message || String(e)) }; }
  }
  async function fetchOsm(bbox, tags, timeoutS, geoReq) {
    const q = E.buildOverpassQuery(bbox, tags, timeoutS), trail = [];
    for (const m of DIRECT_MIRRORS) {
      const host = new URL(m).hostname;
      setStage('Searching businesses on OpenStreetMap (' + host + ')…');
      try {
        const c = new AbortController(), t = setTimeout(() => c.abort(), (timeoutS + 10) * 1000);
        const r = await fetch(m, { method: 'POST', body: q, headers: { 'Content-Type': 'text/plain', Accept: 'application/json' }, signal: c.signal });
        clearTimeout(t);
        if (!r.ok) { trail.push(host + ' HTTP ' + r.status); continue; }
        const insp = E.inspectOverpass(await r.json());
        if (!insp.ok) { trail.push(host + ': ' + insp.problem.slice(0, 100)); continue; }
        return { kind: 'osm', elements: insp.elements, source: 'Overpass (' + host + ', direct from your browser)', trail };
      } catch (e) { trail.push(host + ': ' + (e.name === 'AbortError' ? 'timed out' : e.name === 'SyntaxError' ? 'unreadable response' : 'blocked or unreachable')); }
    }
    setStage('Browser route failed — trying the backup route…');
    try {
      const r = await postWorker({ mode: 'pois', bbox, osmTags: tags, timeoutS, geoapify: geoReq }, (timeoutS + 20) * 1000);
      const j = await r.json();
      if (r.ok && j.features) return { kind: 'geo', features: j.features, source: j.mr_source || 'Geoapify', trail: trail.concat(j.trail || []) };
      if (r.ok) { const insp = E.inspectOverpass(j); if (insp.ok) return { kind: 'osm', elements: insp.elements, source: r.headers.get('X-MR-Source') || 'Overpass (via Worker)', trail }; trail.push('worker: ' + insp.problem); }
      else trail.push('worker: ' + (j.error || 'HTTP ' + r.status));
    } catch (e) { trail.push('worker: ' + (e.name === 'AbortError' ? 'timed out' : e.message)); }
    return { error: trail.join(' · '), trail };
  }
  async function loadOverture(key) {
    if (S.ovt[key] !== undefined) return S.ovt[key];
    try {
      const r = await fetch(OVT_PATH + key + '.json'); if (!r.ok) throw new Error('missing');
      const j = await r.json(), ix = {}; j.cols.forEach((c, i) => { ix[c] = i; });
      S.ovt[key] = { release: j.release, built: j.built, rows: j.rows.map((x) => ({ id: x[ix.id], lat: x[ix.lat], lng: x[ix.lng], name: x[ix.name], cat: x[ix.cat], basic: x[ix.basic], conf: x[ix.conf], src: x[ix.src] })) };
    } catch (e) { S.ovt[key] = null; }
    return S.ovt[key];
  }
  function buildData(o) {
    const inside = (p) => E.geo.pointInRing(p.lat, p.lng, o.ring);
    const osmP = [], outside = [], anchors = [];
    if (o.osm.kind === 'osm') o.osm.elements.forEach((el) => {
      const r = E.classifyOsm(el, o.cat); if (!r) return;
      if (r.poi) (inside(r.poi) ? osmP : outside).push(r.poi);
      r.anchors.forEach((a) => { if (inside(a)) anchors.push(a); });
    });
    else o.osm.features.forEach((f) => { const p = E.classifyGeoapify(f, o.cat); if (p) (inside(p) ? osmP : outside).push(p); });
    const ovtP = [], unm = {}, b = o.bbox;
    if (o.ovt) o.ovt.rows.forEach((r) => {
      if (r.lat < b[0] || r.lat > b[2] || r.lng < b[1] || r.lng > b[3]) return;
      const c = E.classifyOverture(r, o.cat); if (c.skipped) return;
      if (c.poi) { if (inside(c.poi)) ovtP.push(c.poi); else outside.push(c.poi); }
      c.anchors.forEach((a) => { if (inside(a) && !anchors.some((x) => x.type === a.type && E.geo.haversineM(x.lat, x.lng, a.lat, a.lng) < 100)) anchors.push(a); });
      if (c.unmapped && inside(r)) unm[c.unmapped] = (unm[c.unmapped] || 0) + 1;
    });
    const m = E.mergePois(osmP, ovtP), dm = (o.ctx && o.ctx.demographics) || {};
    return {
      pois: m.pois, anchors, outside, ring: o.ring, isReal: o.isReal, areaKm2: o.areaKm2, bbox: o.bbox, cat: o.cat, cm: o.cm, town: S.town,
      source: o.osm.source, trail: o.osm.trail || [], mergeStats: m.stats, ovt: o.ovt ? { release: o.ovt.release, built: o.ovt.built, rows: o.ovt.rows.length, used: ovtP.length } : null,
      unmapped: Object.entries(unm).sort((a, b2) => b2[1] - a[1]).slice(0, 10), trends: (o.ctx && o.ctx.trends) || {}, ctxError: (o.ctx && o.ctx.error) || '', workerVersion: (o.ctx && o.ctx.meta && o.ctx.meta.workerVersion) || '',
      demo: { population: dm.population || 0, income: dm.medianIncome || 0, notes: dm.notes || [] },
    };
  }
  const runAnalysis = () => E.analyze({ pois: S.data.pois, anchors: S.data.anchors, areaKm2: S.data.areaKm2, pin: S.pin, catalog: S.data.cat, trends: S.data.trends, demographics: { population: S.data.demo.population, income: S.data.demo.income }, mergeStats: S.data.mergeStats, hasOvt: !!S.data.ovt });

  async function analyze() {
    if (S.busy) return;
    if (!S.pin) { setStatus('Click the map to place the pin first.', true); return; }
    if (usageToday() + 1 > MAX_PER_DAY) { setStatus('This browser has used today’s ' + MAX_PER_DAY + ' analyses. Try again tomorrow.', true); return; }
    const town = TOWNS[S.town], cm = CATCHMENTS[S.catchment], cat = catalog();
    S.busy = true; S.stale = false; S.ai = { text: '', via: '', busy: false, err: '' }; S.expanded = {}; S.focus = [];
    renderToolbar(); setStage('Finding the area around your pin…');
    try {
      const ctx = await fetchContext(cm, town, cat);
      const f = ctx.isochrone && ctx.isochrone.features && ctx.isochrone.features[0];
      const real = !!(f && f.geometry && f.geometry.type === 'Polygon' && Array.isArray(f.geometry.coordinates[0]));
      const ring = real ? f.geometry.coordinates[0].map(([lng, lat]) => [lat, lng]) : E.geo.circleRing(S.pin.lat, S.pin.lng, cm.fallbackM);
      const areaKm2 = real ? E.geo.ringAreaKm2(ring, S.pin.lat) : Math.PI * (cm.fallbackM / 1000) ** 2;
      const bbox = E.geo.ringBbox(ring, 120);
      const geoReq = { lat: S.pin.lat, lng: S.pin.lng, radiusM: Math.round(cm.fallbackM * 1.3), categories: Array.from(new Set(cat.flatMap((c) => c.geo || []))) };
      const [osm, ovt] = await Promise.all([fetchOsm(bbox, E.collectOsmTags(cat), cm.profile === 'driving-car' ? 45 : 30, geoReq), loadOverture(S.town)]);
      if (osm.error) throw new Error('Could not load businesses: ' + osm.error);
      recordUse();
      S.data = buildData({ ctx, ring, isReal: real, areaKm2, bbox, osm, ovt, cat, cm });
      S.an = runAnalysis();
      ensureTab();
      const n = S.data.pois.length;
      setStatus('Found ' + n + ' businesses in the ' + cm.label + ' area (' + S.data.areaKm2.toFixed(1) + ' km²) via ' + S.data.source + (S.data.ovt ? ' + Overture cross-check' : '') + '.');
      S.busy = false; renderAll();
      if (map) { try { map.fitBounds(catchLayer.getBounds(), { padding: [20, 20] }); } catch (e) { /* stub/no layer */ } }
    } catch (err) { S.busy = false; setStatus(err.message || 'Something went wrong. Try again.', true); renderAll(); }
  }

  /* ================= rendering ================= */
  const chips = (r) => (r.archetypes && r.archetypes.length ? r.archetypes.map((a) => '<span class="mr-chip ' + a + '">' + esc(E.ARCH[a].label) + '</span>').join('') : '<span class="mr-chip cap">No strong signal</span>');
  const confNote = () => {
    const c = S.an.coverage;
    return '<p class="mr-note ' + (c.level === 'Low' ? 'warn' : '') + '"><strong>Data confidence: ' + c.level + '.</strong> ' + esc(c.note) + (c.level === 'Low' ? ' “First-mover” is only claimed when confidence is at least ' + pct(E.T.PIONEER_MIN_CONF) + '%; otherwise a gap is shown as “Possible gap — verify”.' : '') + '</p>';
  };
  function card(r, i, mode) {
    const open = !!S.expanded[mode + r.key], foc = S.focus.includes(r.key), sc = pct(r.score);
    const benefits = mode === 'comp' && r.benefits.length ? '<p class="mr-why"><strong>Adds value to:</strong> ' + r.benefits.map((b) => esc(labelOf(b.key)) + ' ×' + b.n).join(', ') + '</p>' : '';
    const why = r.primary ? '<p class="mr-why">' + esc(r.why[r.primary]) + '</p>' : '';
    return '<article class="mr-card' + (i < 3 ? ' is-top' : '') + (foc ? ' is-focus' : '') + '" data-key="' + esc(r.key) + '">'
      + '<div class="mr-card-h"><span class="mr-rank">' + (i + 1) + '</span><div><div class="mr-title">' + esc(r.label) + '</div><div class="mr-grp">' + esc(E.GROUPS[r.group]) + ' · need: ' + esc(r.needTier) + ' · capital: ' + esc(r.capital) + '</div></div>'
      + '<div class="mr-score">' + sc + '<small>' + (mode === 'comp' ? 'value' : 'score') + ' /100</small></div></div>'
      + '<div class="mr-meter" aria-hidden="true"><i style="width:' + sc + '%"></i></div><div class="mr-chips">' + chips(r) + '</div>' + why + benefits
      + '<div class="mr-acts"><button type="button" class="mr-link" data-act="exp" data-key="' + esc(r.key) + '" aria-expanded="' + open + '">' + (open ? 'Hide the evidence' : 'Why this?') + '</button>'
      + '<button type="button" class="mr-link" data-act="focus" data-key="' + esc(r.key) + '">' + (foc ? 'Showing on map — clear' : 'Show ' + r.count + ' existing on map') + '</button></div>'
      + (open ? '<ul class="mr-ev">' + r.evidence.map((e) => '<li>' + esc(e) + '</li>').join('') + '</ul><ul class="mr-ev verify">' + r.verify.map((e) => '<li>Verify: ' + esc(e) + '</li>').join('') + '</ul>' : '') + '</article>';
  }
  function oppPanel() {
    const ranked = E.rankOpportunities(S.an, null, true), seen = {};
    ranked.forEach((r) => r.archetypes.forEach((a) => { seen[a] = (seen[a] || 0) + 1; }));
    const list = ranked.filter((r) => S.filter === 'all' || r.archetypes.includes(S.filter));
    const fb = (k, l) => '<button type="button" class="mr-fbtn" data-act="filter" data-f="' + k + '" aria-pressed="' + (S.filter === k) + '">' + l + '</button>';
    return confNote() + '<p class="mr-sub">Ranked for a founder: unmet demand × white space, softened by capital needed and data confidence. Banks and food-court operators are left out as unrealistic for a small founder. Every card explains itself.</p>'
      + '<div class="mr-filter" role="group" aria-label="Filter by kind of opportunity">' + fb('all', 'All (' + ranked.length + ')') + E.ARCH_PRIORITY.filter((a) => seen[a]).map((a) => fb(a, esc(E.ARCH[a].label) + ' (' + seen[a] + ')')).join('') + '</div>'
      + (list.length ? list.map((r, i) => card(r, i, 'opp')).join('') : '<p class="mr-sub">Nothing matches this filter here.</p>');
  }
  function compPanel() {
    const ranked = E.rankComplements(S.an), gaps = E.checklist(S.an).filter((c) => c.read === 'gap' && c.needTier === 'core');
    return confNote() + (gaps.length ? '<p class="mr-note bad"><strong>Core needs with nothing found here:</strong> ' + gaps.map((g) => esc(g.label)).join(', ') + '.</p>' : '')
      + '<p class="mr-sub">Ranked by how much each business type would add to what is already here: filling a need, riding the demand drivers nearby, and fitting the existing cluster — reduced where the type is already crowded.</p>'
      + ranked.map((r, i) => card(r, i, 'comp')).join('');
  }
  function listPanel() {
    const rows = E.checklist(S.an).filter((r) => !S.gapOnly || r.read === 'gap' || r.read === 'thin');
    const READ = { gap: 'Gap', thin: 'Thin', healthy: 'Healthy', crowded: 'Crowded' };
    return confNote() + '<p class="mr-sub">Gap = none found. Thin = well below the assumed crowding level. Crowded = at or above it. Crowding levels are assumptions (see “How this is scored”).</p>'
      + '<p><button type="button" class="mr-fbtn" data-act="gaponly" aria-pressed="' + S.gapOnly + '">Show gaps and thin only</button></p>'
      + '<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>Business type</th><th>Need</th><th>Found</th><th>Per km²</th><th>Nearest</th><th>Read</th></tr></thead><tbody>'
      + rows.map((r) => '<tr><td>' + esc(r.label) + '<br><span class="mr-grp">' + esc(E.GROUPS[r.group]) + '</span></td><td>' + esc(r.needTier) + '</td><td>' + r.count + '</td><td>' + r.density.toFixed(1) + '</td><td>' + (r.nearestM == null ? '—' : esc(E.util.fmtDist(r.nearestM))) + '</td><td><span class="mr-chip ' + r.read + '">' + READ[r.read] + '</span></td></tr>').join('')
      + '</tbody></table></div>';
  }
  function demoNote(prefix) { return S.data.demo.notes.filter((n) => n.indexOf(prefix) === 0).join('; '); }
  function ideaPanel() {
    const an = S.an, d = S.data, keys = S.ticked.filter((k) => an.perCat[k]);
    const ids = new Set(); d.pois.forEach((p) => { if (p.cats.some((c) => keys.includes(c))) ids.add(p.id); });
    const sc = E.ideaScore(keys, an, S.weights, { observedBusyness: S.onSite }), total = Object.values(S.weights).reduce((s, x) => s + x, 0);
    const READ = ['', 'Very quiet', 'Quiet', 'Moderate', 'Busy', 'Packed — queue out the door'];
    const trendLines = keys.map((k) => { const c = d.cat.find((x) => x.key === k), t = c && c.iowrt && d.trends[c.iowrt]; return t ? esc(c.label) + ': ' + (t.growthYoy > 0 ? '+' : '') + t.growthYoy.toFixed(1) + '% YoY (as of ' + esc(t.asOf) + ')' : ''; }).filter(Boolean);
    const pick = d.cat.map((c) => '<label class="mr-pick' + (S.ticked.includes(c.key) ? ' is-on' : '') + '"><input type="checkbox" data-pick="' + esc(c.key) + '"' + (S.ticked.includes(c.key) ? ' checked' : '') + (!S.ticked.includes(c.key) && S.ticked.length >= MAX_TICKED ? ' disabled' : '') + '> ' + esc(c.label) + '</label>').join('');
    const wrow = [['lowCompetition', 'Low competition'], ['population', 'Population reached'], ['income', 'Household income band'], ['diversity', 'Category diversity'], ['momentum', 'Momentum (neutral)'], ['competitorStrength', 'Competitor strength (your on-site read)']];
    return '<p class="mr-sub">Pick up to ' + MAX_TICKED + ' business types you are weighing. Nothing is re-fetched — this re-reads the analysis you already ran.</p><div class="mr-picks">' + pick + '</div>'
      + (keys.length ? '<div class="mr-banner"><div class="mr-big">' + pct(sc.total) + '</div><div><strong>' + esc(E.verdict(sc.total)) + '</strong><span class="mr-prov">Market score for your ticked types — calculated, using your weights below</span></div></div>'
        + '<div class="mr-kpis"><div class="mr-kpi"><b>' + ids.size + '</b><span>Competitors in the area</span><span class="mr-prov">Estimated — ' + esc(d.source) + '</span></div>'
        + '<div class="mr-kpi"><b>' + pct(an.diversity) + '% mixed</b><span>Category mix nearby</span></div>'
        + '<div class="mr-kpi"><b>' + (d.demo.population ? fmtN(d.demo.population) : 'Not available') + '</b><span>District population</span><span class="mr-prov">Official — DOSM (district-level)' + (demoNote('Population') ? ' · ' + esc(demoNote('Population')) : '') + '</span></div>'
        + '<div class="mr-kpi"><b>' + (d.demo.income ? 'RM' + fmtN(Math.round(d.demo.income)) + '/mo' : 'Not available') + '</b><span>Median household income</span><span class="mr-prov">Official — DOSM (district-level)</span></div>'
        + '<div class="mr-kpi"><b>' + (S.onSite ? READ[S.onSite] : 'Not noted') + '</b><span>Competitor strength</span><span class="mr-prov">Observed — your own on-site read</span></div>'
        + '<div class="mr-kpi"><b>' + d.anchors.length + '</b><span>Nearby institutions</span><span class="mr-prov">' + esc(Object.entries(an.anchorCounts).map(([k, n]) => n + ' ' + E.ANCHOR_BY_KEY[k].label.toLowerCase()).join(', ') || 'none found') + '</span></div></div>'
        + '<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>Type</th><th>Found</th><th>Per km²</th><th>Nearest</th><th>Signal</th></tr></thead><tbody>'
        + keys.map((k) => { const m = an.perCat[k]; return '<tr><td>' + esc(m.label) + '</td><td>' + m.count + '</td><td>' + m.density.toFixed(1) + '</td><td>' + (m.nearestM == null ? '—' : esc(E.util.fmtDist(m.nearestM))) + '</td><td><span class="mr-chips">' + chips(m) + '</span></td></tr>'; }).join('') + '</tbody></table></div>'
        + (trendLines.length ? '<p class="mr-sub">National retail trend (Malaysia-wide, not town-specific): ' + trendLines.join(' · ') + '</p>' : '<p class="mr-sub">National retail trend: none of these types is in DOSM’s wholesale &amp; retail index.</p>')
      : '<p class="mr-note warn">Tick at least one business type to see its market score.</p>')
      + '<h3 class="mr-h">On-site read <span class="mr-hint">(optional — counts in the score at 10% when picked)</span></h3><div class="mr-field"><label for="mr-onsite">How busy do the competitors look right now?</label><select id="mr-onsite"><option value="">Not noted — leave out of the score</option>' + [1, 2, 3, 4, 5].map((n) => '<option value="' + n + '"' + (S.onSite === n ? ' selected' : '') + '>' + READ[n] + '</option>').join('') + '</select></div>'
      + '<h3 class="mr-h">Score weights <button type="button" class="mr-link" data-act="weights">' + (S.weightsOpen ? 'hide' : 'edit') + '</button></h3>'
      + (S.weightsOpen ? '<table class="mr-table mr-wts"><tbody>' + wrow.map(([k, l]) => '<tr><td>' + l + '</td><td><input type="number" min="0" max="1" step="0.05" data-w="' + k + '" value="' + S.weights[k].toFixed(2) + '" aria-label="' + esc(l) + ' weight"></td></tr>').join('') + '</tbody></table><p class="mr-sub">Weights are re-scaled to add up to 1, so any total gives a sane score. Current total: ' + total.toFixed(2) + '.</p>' : '')
      + '<h3 class="mr-h">Vacant units you have spotted <span class="mr-hint">(notepad — nothing is looked up)</span></h3><div class="mr-inline"><select id="mr-vfloor" aria-label="Floor"><option>Ground floor</option><option>1st floor</option><option>2nd floor</option><option>3rd floor</option><option>Other / whole shoplot</option></select><input type="text" id="mr-vdetail" maxlength="140" placeholder="e.g. ~600 sqft, asking RM1,800/mo" aria-label="Vacancy notes"><button type="button" class="btn" data-act="vadd">Add</button></div>'
      + (S.vacancies.length ? '<ul class="mr-ev">' + S.vacancies.map((v, i) => '<li>' + esc(v.floor) + ' — ' + esc(v.detail) + ' <button type="button" class="mr-link" data-act="vdel" data-i="' + i + '" aria-label="Remove">✕</button></li>').join('') + '</ul>' : '');
  }
  function areaPanel() {
    const an = S.an, d = S.data, c = an.coverage, st = c.stats || {}, nm = an.niche;
    return confNote()
      + '<div class="mr-kpis"><div class="mr-kpi"><b>' + d.pois.length + '</b><span>Businesses mapped in the area</span></div><div class="mr-kpi"><b>' + d.areaKm2.toFixed(1) + ' km²</b><span>Area analysed</span><span class="mr-prov">' + (d.isReal ? 'Real travel-time shape' : 'Estimated radius — not a travel-time shape') + '</span></div>'
      + '<div class="mr-kpi"><b>' + (d.pois.length / d.areaKm2).toFixed(1) + '/km²</b><span>Business density</span></div><div class="mr-kpi"><b>' + d.anchors.length + '</b><span>Demand drivers</span><span class="mr-prov">' + esc(Object.entries(an.anchorCounts).map(([k, n]) => n + ' ' + E.ANCHOR_BY_KEY[k].label.toLowerCase()).join(', ') || 'none found') + '</span></div>'
      + '<div class="mr-kpi"><b>' + (d.demo.population ? fmtN(d.demo.population) : 'Not available') + '</b><span>District population</span><span class="mr-prov">Official — DOSM (district-level, not this catchment)' + (demoNote('Population') ? ' · ' + esc(demoNote('Population')) : '') + '</span></div>'
      + '<div class="mr-kpi"><b>' + (d.demo.income ? 'RM' + fmtN(Math.round(d.demo.income)) + '/mo' : 'Not available') + '</b><span>Median household income</span><span class="mr-prov">Official — DOSM (district-level)</span></div></div>'
      + '<h3 class="mr-h">Where the data came from</h3><div class="mr-table-wrap"><table class="mr-table"><tbody>'
      + '<tr><th>OpenStreetMap</th><td>' + esc(d.source) + (d.trail.length ? '<br><span class="mr-prov">Other routes that failed first: ' + esc(d.trail.join(' · ')) + '</span>' : '') + '</td></tr>'
      + '<tr><th>Overture layer</th><td>' + (d.ovt ? 'Release ' + esc(d.ovt.release || '?') + ' · ' + fmtN(d.ovt.rows) + ' places in town file · ' + d.ovt.used + ' inside this area · ' + (st.matched || 0) + ' matched with OpenStreetMap' : 'Not loaded for this town (optional). Confidence below reflects how many businesses are mapped, not true completeness.') + '</td></tr>'
      + (c.mode === 'capture-recapture' ? '<tr><th>Completeness estimate</th><td>About ' + fmtN(Math.round(st.nHat)) + ' businesses expected here; ' + c.nUnion + ' mapped (' + pct(c.k) + '). OpenStreetMap alone recovers about ' + pct(st.recallOsm || 0) + ' of what Overture lists.</td></tr>' : '')
      + '<tr><th>Cuisine tagging</th><td>' + nm.tagged + ' of ' + nm.total + ' restaurants/food stalls have a cuisine (' + pct(nm.taggedShare) + '). ' + (nm.reliable ? 'Enough to spot niche gaps.' : 'Too sparse to call niche gaps reliably.') + '</td></tr>'
      + '<tr><th>Worker</th><td>' + (d.workerVersion ? 'v' + esc(d.workerVersion) + ' answered this analysis'
        + (d.workerVersion !== VERSION ? '<br><span class="mr-prov"><b>This page is v' + esc(VERSION) + ' but the Worker is v' + esc(d.workerVersion) + '</b> — paste the matching market-radar-proxy-worker.js into Cloudflare (see the setup guide).</span>' : '') : 'No answer from the Worker for this analysis (see District data below). Check that market-radar-proxy-worker.js v' + esc(VERSION) + ' is deployed.') + '</td></tr>'
      + (d.ctxError ? '<tr><th>District data</th><td>Unavailable: ' + esc(d.ctxError) + '. The catchment is an estimated circle and population/income are missing.</td></tr>' : '')
      + (d.unmapped.length ? '<tr><th>Overture categories not mapped</th><td>' + esc(d.unmapped.map(([k, n]) => k + ' (' + n + ')').join(', ')) + '<br><span class="mr-prov">Places in these categories are ignored. Add their words to the registry if they matter.</span></td></tr>' : '')
      + '</tbody></table></div>';
  }
  const bizRows = () => {
    const d = S.data, f = S.biz, q = f.q.trim().toLowerCase();
    return d.pois.filter((p) => (!q || (p.name || '').toLowerCase().includes(q)) && (!f.cat || p.cats.includes(f.cat)) && (!f.src || (f.src === 'both' ? p.sources.length > 1 : p.sources.length === 1 && p.sources[0] === f.src)))
      .map((p) => Object.assign({ dist: E.geo.haversineM(S.pin.lat, S.pin.lng, p.lat, p.lng) }, p)).sort((a, b) => a.dist - b.dist);
  };
  function bizBody() {
    const rows = bizRows();
    return rows.slice(0, 150).map((p) => '<tr><td>' + esc(p.name || '(unnamed)') + '</td><td>' + esc(p.cats.map(labelOf).join(', ')) + '</td><td>' + esc(srcText(p)) + '</td><td>' + esc(E.util.fmtDist(p.dist)) + '</td></tr>').join('') + (rows.length > 150 ? '<tr><td colspan="4" class="mr-prov">Showing the nearest 150 of ' + rows.length + '. Download the CSV for all.</td></tr>' : '') + (rows.length ? '' : '<tr><td colspan="4">No businesses match.</td></tr>');
  }
  function bizPanel() {
    const cats = S.data.cat.map((c) => '<option value="' + esc(c.key) + '"' + (S.biz.cat === c.key ? ' selected' : '') + '>' + esc(c.label) + '</option>').join('');
    const srcs = [['', 'Any source'], ['osm', 'OpenStreetMap only'], ['ovt', 'Overture only'], ['both', 'Both']].map(([v, l]) => '<option value="' + v + '"' + (S.biz.src === v ? ' selected' : '') + '>' + l + '</option>').join('');
    return '<div class="mr-inline"><input type="search" id="mr-bq" placeholder="Search name" value="' + esc(S.biz.q) + '" aria-label="Search business name"><select id="mr-bcat" aria-label="Type"><option value="">All types</option>' + cats + '</select><select id="mr-bsrc" aria-label="Source">' + srcs + '</select><button type="button" class="btn" data-act="csv" data-what="biz">Download CSV</button></div>'
      + '<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>Name</th><th>Type</th><th>Source</th><th>From pin</th></tr></thead><tbody id="mr-bbody">' + bizBody() + '</tbody></table></div>';
  }
  function assumpPanel() {
    return '<div class="mr-note"><strong>Every value here is a judgement, not a measurement.</strong> They are editable in the Settings workbook and listed in the handoff document. The opportunity score is: <em>potential</em> (demand drivers ' + E.OPP_WEIGHTS.demand + ', cluster fit ' + E.OPP_WEIGHTS.cluster + ', need ' + E.OPP_WEIGHTS.need + ', national trend ' + E.OPP_WEIGHTS.trend + ') × <em>white space</em> (floor ' + E.T.WHITE_FLOOR + ') × capital factor (low 1, medium ' + E.CAPITAL_FACTOR.medium + ', high ' + E.CAPITAL_FACTOR.high + ') × data-confidence factor.</div>'
      + '<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>Type</th><th>Need</th><th>Treated as crowded at</th><th>Capital</th></tr></thead><tbody>' + E.CATEGORIES.map((c) => '<tr><td>' + esc(c.label) + '</td><td>' + esc(c.needTier) + '</td><td>' + c.crowded + ' per km²</td><td>' + esc(c.capital) + (c.founder ? '' : ' (not offered to founders)') + '</td></tr>').join('') + '</tbody></table></div>';
  }
  function footerHtml() {
    const ai = S.ai;
    return '<div class="no-print"><h3 class="mr-h">Plain-English read</h3><div class="mr-ai' + (ai.text || ai.err ? '' : ' is-empty') + '" id="mr-ai">' + (ai.busy ? 'Writing a plain-English read…' : ai.err ? esc(ai.err) : ai.text ? esc(ai.text) + (ai.via && ai.via !== 'Gemini' ? ' (Written by ' + esc(ai.via) + ' — Gemini was unavailable.)' : '') : 'Describes only the numbers on this page; it never invents a business or figure.') + '</div>'
      + '<div class="mr-acts"><button type="button" class="btn btn-secondary" data-act="ai"' + (ai.busy ? ' disabled' : '') + '>Get a plain-English read</button>'
      + (S.tab === 'opp' || S.tab === 'comp' || S.tab === 'list' ? '<button type="button" class="btn btn-secondary" data-act="csv" data-what="rank">Download this ranking (CSV)</button>' : '')
      + '<button type="button" class="mr-link" data-act="assump">' + (S.showAssump ? 'Hide' : 'How this is scored') + '</button></div>' + (S.showAssump ? assumpPanel() : '') + '</div>';
  }
  function panelHtml(tab) { return { opp: oppPanel, idea: ideaPanel, comp: compPanel, list: listPanel, area: areaPanel, biz: bizPanel }[tab](); }
  function renderResults() {
    const el = $('mr-results');
    if (S.busy) { el.innerHTML = '<div class="mr-empty"><p><span class="mr-spin"></span>' + esc(S.stage || 'Working…') + '</p><p class="mr-sub">Big areas can take up to a minute — public map servers are shared.</p></div>'; return; }
    if (!S.an) {
      el.innerHTML = '<div class="mr-empty"><h3>Start with a pin</h3><ol><li>Pick a town and how far around the pin to look (walk for a single shoplot, drive for a whole market).</li><li>Click the map (or search a place) to drop the pin.</li><li>Press <strong>Analyze this spot</strong>. Switching between <em>Market Analysis</em> and <em>Market Gap</em> afterwards is instant — nothing is re-fetched.</li></ol></div>';
      return;
    }
    ensureTab();
    const stale = S.stale ? '<p class="mr-note warn no-print">The pin, area or custom types changed — press <strong>Analyze this spot</strong> to refresh these results.</p>' : '';
    if (S.printAll) { el.innerHTML = TABS[S.mode].map(([k, l]) => '<h2 class="mr-h">' + esc(l) + '</h2>' + panelHtml(k)).join(''); return; }
    el.innerHTML = stale + '<div class="mr-tabs no-print" role="tablist" aria-label="Results">' + TABS[S.mode].map(([k, l]) => '<button type="button" role="tab" id="mr-tab-' + k + '" class="mr-tab" aria-selected="' + (S.tab === k) + '" tabindex="' + (S.tab === k ? 0 : -1) + '" data-act="tab" data-tab="' + k + '">' + l + '</button>').join('') + '</div>'
      + '<div role="tabpanel" id="mr-panel" aria-labelledby="mr-tab-' + S.tab + '">' + panelHtml(S.tab) + '</div>' + footerHtml();
  }
  function renderToolbar() {
    document.querySelectorAll('#mr-mode .mr-seg-btn').forEach((b) => { const on = b.dataset.mode === S.mode; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', String(on)); });
    $('mr-analyze').disabled = S.busy; $('mr-analyze').textContent = S.busy ? 'Analyzing…' : 'Analyze this spot';
    $('mr-quota').textContent = Math.max(0, MAX_PER_DAY - usageToday()) + ' of ' + MAX_PER_DAY + ' analyses left today';
  }
  function renderCustom() {
    const chipsHtml = S.custom.map((c, i) => '<span class="mr-tagchip">' + esc(c.k + '=' + c.v) + '<button type="button" data-act="cdel" data-i="' + i + '" aria-label="Remove ' + esc(c.k + '=' + c.v) + '">✕</button></span>').join(' ');
    $('mr-custom').innerHTML = '<button type="button" class="mr-link" data-act="copen" aria-expanded="' + S.customOpen + '">' + (S.customOpen ? 'Close' : '＋ Add your own business type') + '</button> ' + chipsHtml
      + (S.customOpen ? '<div class="mr-inline"><input type="text" id="mr-ck" maxlength="40" placeholder="OSM key, e.g. shop" aria-label="OSM key" autocomplete="off"><input type="text" id="mr-cv" maxlength="40" placeholder="OSM value, e.g. optician" aria-label="OSM value" autocomplete="off"><button type="button" class="btn" data-act="cadd">Add</button><span class="mr-hint">letters, numbers, _ : - only · up to ' + MAX_CUSTOM + ' · applies from the next analysis</span></div>' : '');
  }
  function renderAll() { renderToolbar(); renderLayers(); renderCustom(); renderResults(); drawMap(); }

  /* ================= csv / ai ================= */
  function download(name, headers, rows) {
    const blob = new Blob(['\ufeff' + E.toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function exportCsv(what) {
    const stamp = TOWNS[S.town].label.toLowerCase() + '-' + S.catchment;
    if (what === 'biz') return download('market-radar-businesses-' + stamp + '.csv', ['name', 'types', 'sources', 'lat', 'lng', 'metres_from_pin'], bizRows().map((p) => [p.name, p.cats.map(labelOf).join('; '), p.sources.join('+'), p.lat, p.lng, Math.round(p.dist)]));
    if (S.tab === 'list') return download('market-radar-checklist-' + stamp + '.csv', ['business_type', 'group', 'need', 'found', 'per_km2', 'nearest_m', 'read'], E.checklist(S.an).map((r) => [r.label, E.GROUPS[r.group], r.needTier, r.count, r.density.toFixed(2), r.nearestM == null ? '' : Math.round(r.nearestM), r.read]));
    const comp = S.mode === 'gap', rk = comp ? E.rankComplements(S.an) : E.rankOpportunities(S.an, null, true);
    download('market-radar-' + (comp ? 'complements' : 'opportunities') + '-' + stamp + '.csv', ['rank', 'business_type', 'group', 'score_0_100', 'kind', 'found', 'per_km2', 'nearest_m', 'need', 'capital', 'evidence'],
      rk.map((r, i) => [i + 1, r.label, E.GROUPS[r.group], pct(r.score), r.archetypes.map((a) => E.ARCH[a].label).join(' + '), r.count, r.density.toFixed(2), r.nearestM == null ? '' : Math.round(r.nearestM), r.needTier, r.capital, r.evidence.join(' | ')]));
  }
  function snapshot() {
    const an = S.an, d = S.data, cov = an.coverage;
    const base = { town: TOWNS[S.town].label, catchment: CATCHMENTS[S.catchment].label, areaKm2: an.areaKm2, confidence: cov.level, confidenceNote: cov.note, districtPopulation: d.demo.population, districtIncome: d.demo.income, catchmentIsReal: d.isReal };
    const rows = (rk, comp) => rk.slice(0, 5).map((x) => ({ label: x.label, archetype: x.primary ? E.ARCH[x.primary].label : 'No strong signal', score: pct(x.score), evidence: (comp ? x.benefits.map((b) => 'Benefits ' + b.n + '× ' + labelOf(b.key)) : []).concat(x.evidence.slice(0, 3)) }));
    if (S.mode === 'gap') return Object.assign({ kind: 'complement', top: rows(E.rankComplements(an), true), gaps: E.checklist(an).filter((c) => c.read === 'gap' && c.needTier === 'core').map((c) => c.label) }, base);
    if (S.tab === 'idea') {
      const keys = S.ticked.filter((k) => an.perCat[k]), ids = new Set(); d.pois.forEach((p) => { if (p.cats.some((c) => keys.includes(c))) ids.add(p.id); });
      return Object.assign({ kind: 'idea', category: keys.map(labelOf).join(' + '), competitorCount: ids.size, breakdown: keys.map((k) => ({ label: labelOf(k), count: an.perCat[k].count })), opportunityScore: pct(E.ideaScore(keys, an, S.weights, { observedBusyness: S.onSite }).total), observedBusyness: S.onSite }, base);
    }
    return Object.assign({ kind: 'opportunity', top: rows(E.rankOpportunities(an, null, true), false) }, base);
  }
  async function getInsight() {
    if (!S.an || S.ai.busy) return;
    S.ai = { text: '', via: '', busy: true, err: '' }; renderResults();
    try {
      const r = await postWorker({ mode: 'insight', snapshot: snapshot() }, 40000), j = await r.json();
      if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
      S.ai = { text: j.text || 'No usable text came back — the numbers are unaffected.', via: j.via, busy: false, err: '' };
    } catch (e) { S.ai = { text: '', via: '', busy: false, err: 'Couldn’t get a written read right now (' + (e.message || 'unknown error') + '). The numbers above are unaffected.' }; }
    renderResults();
  }

  /* ================= place search (Nominatim: submit-only, throttled) ================= */
  let lastFind = 0;
  async function findPlace(q) {
    q = q.trim(); if (!q) return;
    if (Date.now() - lastFind < 1200) { setStatus('One moment — place search is rate-limited.'); return; }
    lastFind = Date.now(); setStatus('Searching for “' + q + '”…');
    try {
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=my&bounded=1&viewbox=109.5,5.2,115.9,0.8&q=' + encodeURIComponent(q));
      const j = await r.json();
      if (!j.length) { setStatus('No match in Sarawak — try a street or landmark name, or click the map.', true); return; }
      const lat = Number(j[0].lat), lng = Number(j[0].lon);
      let best = S.town, bd = Infinity; Object.keys(TOWNS).forEach((k) => { const dd = E.geo.haversineM(lat, lng, TOWNS[k].lat, TOWNS[k].lng); if (dd < bd) { bd = dd; best = k; } });
      if (bd > 40000) { setStatus('That is more than 40 km from Miri, Kuching, Sibu or Bintulu — pick a nearer place.', true); return; }
      if (best !== S.town) { S.town = best; $('mr-town').value = best; resetResults(); }
      if (map) map.setView([lat, lng], 16);
      placePin(lat, lng, true); setStatus('Pin moved to ' + String(j[0].display_name).split(',').slice(0, 2).join(',') + '. Press Analyze this spot.');
    } catch (e) { setStatus('Place search is unavailable right now — click the map instead.', true); }
  }

  /* ================= events ================= */
  // The on-site read is a per-spot observation. Forgetting it also gives back the 10% weight that picking it moved from "Low competition".
  function releaseOnSite() {
    if (S.onSiteMoved != null) { S.weights.lowCompetition += S.onSiteMoved; S.weights.competitorStrength = 0; S.onSiteMoved = null; }
    S.onSite = null;
  }
  function resetResults() { releaseOnSite(); S.data = null; S.an = null; S.ai = { text: '', via: '', busy: false, err: '' }; S.focus = []; S.stale = false; S.expanded = {}; S.biz = { q: '', cat: '', src: '' }; renderAll(); }
  function setMode(m) { S.mode = m; ensureTab(); S.focus = []; S.ai = { text: '', via: '', busy: false, err: '' }; renderToolbar(); renderResults(); drawMap(); }
  function onAct(act, el) {
    const key = el.dataset.key;
    if (act === 'tab') { S.tab = el.dataset.tab; S.ai = { text: '', via: '', busy: false, err: '' }; renderResults(); if (S.tab === 'idea') drawMap(); return; }
    if (act === 'exp') { S.expanded[(S.tab === 'comp' ? 'comp' : 'opp') + key] = !S.expanded[(S.tab === 'comp' ? 'comp' : 'opp') + key]; renderResults(); return; }
    if (act === 'focus') { S.focus = S.focus.includes(key) ? [] : [key]; renderResults(); drawMap(); return; }
    if (act === 'filter') { S.filter = el.dataset.f; renderResults(); return; }
    if (act === 'gaponly') { S.gapOnly = !S.gapOnly; renderResults(); return; }
    if (act === 'weights') { S.weightsOpen = !S.weightsOpen; renderResults(); return; }
    if (act === 'assump') { S.showAssump = !S.showAssump; renderResults(); return; }
    if (act === 'csv') { exportCsv(el.dataset.what); return; }
    if (act === 'ai') { getInsight(); return; }
    if (act === 'vadd') { const det = $('mr-vdetail').value.trim(); if (!det) { $('mr-vdetail').focus(); return; } S.vacancies.push({ floor: $('mr-vfloor').value, detail: det }); renderResults(); return; }
    if (act === 'vdel') { S.vacancies.splice(Number(el.dataset.i), 1); renderResults(); }
  }
  function init() {
    $('mr-town').innerHTML = Object.entries(TOWNS).map(([k, t]) => '<option value="' + k + '">' + esc(t.label) + '</option>').join('');
    $('mr-catchment').innerHTML = Object.entries(CATCHMENTS).map(([k, c]) => '<option value="' + k + '">' + esc(c.label) + '</option>').join('');
    $('mr-town').value = S.town; $('mr-catchment').value = S.catchment;
    $('mr-ver').textContent = 'v' + VERSION; $('mr-ver').title = 'Page v' + VERSION + ' · engine v' + E.VERSION + ' · the Worker version appears in Area snapshot → Where the data came from, after an analysis';
    initMap();
    $('mr-mode').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
    $('mr-town').addEventListener('change', (e) => { S.town = e.target.value; const T = TOWNS[S.town]; if (map) map.setView([T.lat, T.lng], 14); placePin(T.lat, T.lng, false); resetResults(); setStatus(''); });
    $('mr-catchment').addEventListener('change', (e) => { S.catchment = e.target.value; if (S.an) { S.stale = true; renderResults(); } });
    $('mr-analyze').addEventListener('click', analyze);
    $('mr-print').addEventListener('click', () => window.print());
    $('mr-find-form').addEventListener('submit', (e) => { e.preventDefault(); findPlace($('mr-find').value); });
    $('mr-layers').addEventListener('change', (e) => { const k = e.target.dataset.layer; if (k) { S.layers[k] = e.target.checked; drawMap(); } });
    $('mr-custom').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'copen') { S.customOpen = !S.customOpen; renderCustom(); return; }
      if (b.dataset.act === 'cdel') { S.custom.splice(Number(b.dataset.i), 1); if (S.an) S.stale = true; renderCustom(); renderResults(); return; }
      if (b.dataset.act === 'cadd') {
        const k = $('mr-ck').value.trim(), v = $('mr-cv').value.trim();
        if (!CUSTOM_RE.test(k) || !CUSTOM_RE.test(v)) { setStatus('Custom OSM tags need a key and a value using only letters, numbers, _ : and - (up to 40 characters).', true); return; }
        if (S.custom.length >= MAX_CUSTOM) { setStatus('Up to ' + MAX_CUSTOM + ' custom types — remove one first.', true); return; }
        S.custom.push({ key: 'custom' + (++S.customN), k, v }); if (S.an) S.stale = true; setStatus(''); renderCustom(); renderResults();
      }
    });
    const res = $('mr-results');
    res.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) onAct(b.dataset.act, b); });
    res.addEventListener('keydown', (e) => {
      if (!e.target.matches('[role=tab]') || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      const tabs = TABS[S.mode].map((t) => t[0]), i = tabs.indexOf(S.tab), n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      S.tab = n; renderResults(); const t = $('mr-tab-' + n); if (t) t.focus();
    });
    res.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.pick) { const k = t.dataset.pick; S.ticked = t.checked ? S.ticked.concat(k).slice(0, MAX_TICKED) : S.ticked.filter((x) => x !== k); renderResults(); drawMap(); }
      else if (t.id === 'mr-onsite') {
        if (t.value) {
          S.onSite = Number(t.value);
          if (S.weights.competitorStrength === 0) { const mv = Math.min(0.10, S.weights.lowCompetition); S.weights.lowCompetition -= mv; S.weights.competitorStrength = 0.10; S.onSiteMoved = mv; }
        } else releaseOnSite();
        renderResults();
      }
      else if (t.dataset.w) { S.onSiteMoved = null; S.weights[t.dataset.w] = Math.max(0, Math.min(1, parseFloat(t.value) || 0)); renderResults(); }
      else if (t.id === 'mr-bcat') { S.biz.cat = t.value; $('mr-bbody').innerHTML = bizBody(); }
      else if (t.id === 'mr-bsrc') { S.biz.src = t.value; $('mr-bbody').innerHTML = bizBody(); }
    });
    res.addEventListener('input', (e) => { if (e.target.id === 'mr-bq') { S.biz.q = e.target.value; $('mr-bbody').innerHTML = bizBody(); } });
    window.addEventListener('beforeprint', () => { if (S.an) { S.printAll = true; renderResults(); } });
    window.addEventListener('afterprint', () => { if (S.printAll) { S.printAll = false; renderResults(); } });
    renderAll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.__MR = { S, analyze, setMode }; // test hook only
})();
