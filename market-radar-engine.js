/* Market Radar engine v1.7.0 (2026-10-15) — pure logic: no DOM, no network. Shared by the page and the Node tests.
   Every number marked "assumption" is a judgement, not a measurement: it is listed in ASSUMPTIONS and in the settings workbook. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MarketRadarEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = '1.7.0';

  /* ---------------- tunables (assumptions) ---------------- */
  const NEED_TIER = { core: 1, important: 0.7, supporting: 0.45, discretionary: 0.2 };
  const CAPITAL_FACTOR = { low: 1, medium: 0.95, high: 0.85 };
  const ANCHOR_SIZE = { school: 1, college: 1.5, hospital: 1.5, mall: 1.5, govt: 0.8, worship: 0.6, transport: 1.2, attraction: 1 };
  const T = {
    ANCHOR_N: 2, CLUSTER_N: 3, PIONEER_MIN_CONF: 0.6, SPARSE_N: 40, OVT_MIN_CONF: 0.5,
    MERGE_NAMED_M: 80, MERGE_UNNAMED_M: 30, MERGE_NAME_SIM: 0.5,
    COLOC_R_M: 250, COLOC_MIN_N: 5, NICHE_MIN_FOOD: 8, NICHE_MIN_TAGGED: 0.3,
    THIN_SAT: 0.25, CROWDED_SAT: 0.9, EMERGING_SCORE: 0.7, CR_MIN_MATCHES: 5, WHITE_FLOOR: 0.35,
  };
  const OPP_WEIGHTS = { demand: 0.35, cluster: 0.20, need: 0.30, trend: 0.15 };
  const COMP_WEIGHTS = { need: 0.40, cluster: 0.30, demand: 0.30 };
  const IDEA_WEIGHTS = { lowCompetition: 0.35, population: 0.25, income: 0.15, diversity: 0.15, momentum: 0.10, competitorStrength: 0 };
  const POP_NORM = 120000, INCOME_NORM = 7000;

  /* ---------------- helpers ---------------- */
  const clamp01 = (v) => Math.max(0, Math.min(1, isFinite(v) ? v : 0));
  const pairs = (s) => s.split(';').map((p) => p.trim()).filter(Boolean).map((p) => p.split('='));
  const tok = (names) => new RegExp('(?:^|[^a-z0-9])(?:' + names + ')(?:[^a-z0-9]|$)');
  function haversineM(a1, o1, a2, o2) {
    const R = 6371000, r = Math.PI / 180, dA = (a2 - a1) * r, dO = (o2 - o1) * r;
    const x = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function pointInRing(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [aI, oI] = ring[i], [aJ, oJ] = ring[j];
      if (((oI > lng) !== (oJ > lng)) && (lat < (aJ - aI) * (lng - oI) / (oJ - oI) + aI)) inside = !inside;
    }
    return inside;
  }
  function ringAreaKm2(ring, centerLat) {
    const kLat = 111.32, kLng = 111.32 * Math.cos(centerLat * Math.PI / 180);
    let s = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      s += (ring[j][1] * kLng) * (ring[i][0] * kLat) - (ring[i][1] * kLng) * (ring[j][0] * kLat);
    }
    return Math.abs(s / 2);
  }
  function ringBbox(ring, marginM) {
    let s = 90, w = 180, n = -90, e = -180;
    ring.forEach(([a, o]) => { s = Math.min(s, a); n = Math.max(n, a); w = Math.min(w, o); e = Math.max(e, o); });
    const m = marginM || 0, dLat = m / 110540, dLng = m / (111320 * Math.cos(((s + n) / 2) * Math.PI / 180));
    return [s - dLat, w - dLng, n + dLat, e + dLng];
  }
  function circleBbox(lat, lng, rM) {
    const dLat = rM / 110540, dLng = rM / (111320 * Math.cos(lat * Math.PI / 180));
    return [lat - dLat, lng - dLng, lat + dLat, lng + dLng];
  }
  function circleRing(lat, lng, rM, steps) {
    const out = [], n = steps || 48;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      out.push([lat + (rM * Math.sin(a)) / 110540, lng + (rM * Math.cos(a)) / (111320 * Math.cos(lat * Math.PI / 180))]);
    }
    return out;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- registry ---------------- */
  const GROUPS = { food: 'Food & drink', daily: 'Daily needs', health: 'Health & wellbeing', retail: 'Shopping', auto: 'Auto & fuel', services: 'Services & education', custom: 'Your own types' };
  function cat(key, label, group, need, crowded, capital, osm, x) {
    return Object.assign({ key, label, group, needTier: need, need: NEED_TIER[need], crowded, capital, osm: pairs(osm), msic: null, iowrt: null, geo: [], ovt: '', founder: true, niches: false }, x || {});
  }
  const CATEGORIES = [
    cat('cafe', 'Cafe / kopitiam', 'food', 'supporting', 6, 'medium', 'amenity=cafe', { msic: { code: '56302', name: 'Coffee shops' }, ovt: 'cafe|coffee_shop|tea_room' }),
    cat('restaurant', 'Restaurant', 'food', 'important', 12, 'medium', 'amenity=restaurant', { msic: { code: '56101', name: 'Restaurants and restaurant cum night clubs' }, ovt: 'restaurant|eatery|diner|bistro|noodle_house|steakhouse', niches: true, geo: ['catering.restaurant'] }),
    cat('fastfood', 'Fast food / food stall', 'food', 'supporting', 8, 'low', 'amenity=fast_food', { msic: { code: '56103', name: 'Fast-food restaurants' }, ovt: 'fast_food|food_stand|food_truck|street_vendor|hawker', niches: true, geo: ['catering.fast_food'] }),
    cat('foodcourt', 'Food court / hawker centre', 'food', 'important', 1.5, 'high', 'amenity=food_court', { ovt: 'food_court|hawker_center|hawker_centre', founder: false }),
    cat('bakery', 'Bakery / dessert', 'food', 'supporting', 3, 'medium', 'shop=bakery;shop=pastry;shop=confectionery;amenity=ice_cream', { msic: { code: '47216', name: 'Retail sale of bakery products and sugar confectionery' }, iowrt: '472', ovt: 'bakery|patisserie|dessert|ice_cream|candy|confectionery|pastry', geo: ['commercial.food_and_drink.bakery', 'commercial.food_and_drink.confectionery'] }),
    cat('drinks', 'Drink stall / bubble tea', 'food', 'discretionary', 3, 'low', 'cuisine=bubble_tea;shop=beverages;shop=tea;shop=coffee', { msic: { code: '56303', name: 'Drink stalls/hawkers' }, ovt: 'bubble_tea|juice|smoothie|beverage|tea_house', geo: ['catering.cafe.bubble_tea', 'catering.cafe.tea', 'commercial.food_and_drink.coffee_and_tea', 'commercial.food_and_drink.drinks'] }),
    cat('minimart', 'Convenience / minimart', 'daily', 'core', 6, 'medium', 'shop=convenience;shop=supermarket;shop=general;shop=variety_store', { msic: { code: '47113', name: 'Mini market' }, iowrt: '471', ovt: 'convenience_store|supermarket|grocery|general_store|variety_store|mini_?mart', geo: ['commercial.convenience', 'commercial.supermarket'] }),
    cat('freshfood', 'Fresh food / wet market', 'daily', 'core', 3, 'low', 'amenity=marketplace;shop=greengrocer;shop=butcher;shop=seafood;shop=farm', { ovt: 'farmers_market|fruit_and_vegetable|butcher|seafood_market|fish_market|wet_market|meat_shop|produce' }),
    cat('pharmacy', 'Pharmacy / drugstore', 'health', 'core', 3, 'high', 'amenity=pharmacy;healthcare=pharmacy;shop=chemist', { ovt: 'pharmacy|drugstore|chemist' }),
    cat('clinic', 'Clinic / GP', 'health', 'core', 4, 'high', 'amenity=clinic;amenity=doctors;healthcare=clinic;healthcare=doctor', { ovt: 'clinic|doctors?|medical_cent(?:er|re)|general_practitioner|family_practice|urgent_care' }),
    cat('dentist', 'Dentist', 'health', 'important', 2, 'high', 'amenity=dentist;healthcare=dentist', { ovt: 'dentist[a-z]*|dental|orthodont[a-z]*' }),
    cat('optician', 'Optician', 'health', 'supporting', 1.5, 'medium', 'shop=optician', { ovt: 'optician[a-z]*|optometrist[a-z]*|eyewear|eye_care|eyeglass[a-z]*' }),
    cat('gym', 'Gym / fitness', 'health', 'supporting', 1.5, 'medium', 'leisure=fitness_centre', { ovt: 'gym|fitness|yoga|pilates' }),
    cat('fashion', 'Fashion / apparel', 'retail', 'supporting', 8, 'medium', 'shop=clothes;shop=shoes;shop=boutique;shop=fashion_accessories;shop=bag', { msic: { code: '47711', name: 'Retail sale of articles of clothing, articles of fur, and clothing accessories' }, iowrt: '477', ovt: 'clothing|shoe_store|fashion|boutique|apparel|handbag|bag_store', geo: ['commercial.clothing'] }),
    cat('electronics', 'Electronics / phones', 'retail', 'supporting', 4, 'medium', 'shop=electronics;shop=mobile_phone;shop=computer', { ovt: 'electronics|mobile_phone|cell_phone|computer_store|phone_store|appliance' }),
    cat('hardware', 'Hardware', 'retail', 'important', 2.5, 'medium', 'shop=hardware;shop=doityourself;shop=paint', { msic: { code: '47520', name: 'Retail sale of construction materials, hardware, paints, and glass' }, iowrt: '475', ovt: 'hardware|home_improvement|building_supply|paint_store|lumber', geo: ['commercial.houseware_and_hardware.hardware_and_tools', 'commercial.houseware_and_hardware.doityourself'] }),
    cat('homegoods', 'Furniture / home goods', 'retail', 'supporting', 3, 'medium', 'shop=furniture;shop=houseware;shop=interior_decoration;shop=bed;shop=kitchen;shop=curtain', { ovt: 'furniture|home_goods|houseware|home_decor|mattress|kitchen_supply|curtain' }),
    cat('stationery', 'Stationery / books', 'retail', 'supporting', 2, 'low', 'shop=stationery;shop=books', { ovt: 'stationery|bookstore|book_store|office_suppl[a-z]*' }),
    cat('pet', 'Pets / vet', 'retail', 'discretionary', 1.5, 'medium', 'shop=pet;shop=pet_grooming;amenity=veterinary', { ovt: 'pet_store|pet_shop|veterinar[a-z]*|pet_groom[a-z]*' }),
    cat('kids', 'Baby / toys', 'retail', 'discretionary', 1.5, 'medium', 'shop=baby_goods;shop=toys', { ovt: 'baby|toy_store|toys|children_store' }),
    cat('gifts', 'Florist / gifts', 'retail', 'discretionary', 2, 'low', 'shop=florist;shop=gift', { ovt: 'florist|gift_shop|flower' }),
    cat('petrol', 'Petrol / fuel station', 'auto', 'important', 1, 'high', 'amenity=fuel', { msic: { code: '47300', name: 'Retail sale of automotive fuel in specialised stores' }, ovt: 'gas_station|fuel|petrol' }),
    cat('autoservice', 'Auto service / car wash', 'auto', 'important', 5, 'medium', 'shop=car_repair;shop=tyres;shop=car_parts;amenity=car_wash;shop=motorcycle;shop=motorcycle_repair', { ovt: 'auto_repair|automotive_repair|car_repair|auto_parts|tires?|tyres?|car_wash|motorcycle|mechanic|auto_body|auto_service|car_service' }),
    cat('salon', 'Salon / barber / spa', 'services', 'important', 8, 'low', 'shop=hairdresser;shop=beauty;shop=massage', { msic: { code: '96020', name: 'Hairdressing and other beauty treatment' }, ovt: 'salon|hair[a-z]*|barber[a-z]*|beauty|nail|spa|massage|waxing|eyelash', geo: ['service.beauty.hairdresser', 'service.beauty'] }),
    cat('laundry', 'Laundry / dry-clean', 'services', 'important', 2.5, 'medium', 'shop=laundry;shop=dry_cleaning', { msic: { code: '96011', name: 'Laundering and dry-cleaning of textile and fur products' }, ovt: 'laundry|laundromat|dry_clean[a-z_]*', geo: ['service.cleaning.laundry'] }),
    cat('printing', 'Printing / copy shop', 'services', 'supporting', 2, 'medium', 'shop=copyshop;shop=printing', { msic: { code: '82190', name: 'Photocopying, document preparation and other specialised office support activities' }, ovt: 'printing|print_shop|copy_shop|photocopy|print_services' }),
    cat('tailor', 'Tailor / alterations', 'services', 'discretionary', 1.5, 'low', 'shop=tailor;craft=tailor', { ovt: 'tailor[a-z]*|alteration[a-z]*|dressmak[a-z]*|seamstress' }),
    cat('childcare', 'Childcare / kindergarten', 'services', 'core', 2, 'medium', 'amenity=kindergarten;amenity=childcare', { ovt: 'child_care|childcare|day_care|daycare|kindergarten|nursery_school|preschool|pre_school' }),
    cat('tuition', 'Tuition / training', 'services', 'important', 2, 'low', 'amenity=prep_school;amenity=language_school;amenity=music_school;amenity=driving_school', { ovt: 'tutoring|tuition|test_prep|language_school|music_school|driving_school|educational_service[a-z]*|learning_cent[a-z]*' }),
    cat('lodging', 'Hotel / homestay', 'services', 'discretionary', 2, 'high', 'tourism=hotel;tourism=guest_house;tourism=hostel;tourism=motel;tourism=apartment', { ovt: 'hotel|hostel|guest_house|motel|resort|bed_and_breakfast|homestay|inn|accommodation|lodging' }),
    cat('bank', 'Bank branch', 'services', 'important', 1.5, 'high', 'amenity=bank', { ovt: 'bank|credit_union', founder: false }),
  ];
  const BY_KEY = {};
  CATEGORIES.forEach((c) => { BY_KEY[c.key] = c; });
  // Overture rows carry ONE primary category: first match wins, so more specific rules go first.
  const OVT_ORDER = ['foodcourt', 'tuition', 'childcare', 'pet', 'dentist', 'optician', 'fastfood', 'drinks', 'cafe', 'bakery', 'restaurant', 'freshfood', 'minimart', 'pharmacy', 'clinic', 'gym', 'fashion', 'electronics', 'hardware', 'homegoods', 'stationery', 'kids', 'gifts', 'petrol', 'autoservice', 'salon', 'laundry', 'printing', 'tailor', 'lodging', 'bank'];
  const OVT_RE = {};
  CATEGORIES.forEach((c) => { if (c.ovt) OVT_RE[c.key] = tok(c.ovt); });

  const ANCHORS = [
    { key: 'school', label: 'School', osm: pairs('amenity=school'), ovt: 'school|elementary|primary_school|secondary_school|high_school|middle_school' },
    { key: 'college', label: 'University / college', osm: pairs('amenity=university;amenity=college'), ovt: 'college|university' },
    { key: 'hospital', label: 'Hospital', osm: pairs('amenity=hospital'), ovt: 'hospital' },
    { key: 'mall', label: 'Mall / department store', osm: pairs('shop=mall;shop=department_store'), ovt: 'shopping_mall|shopping_center|mall|department_store|hypermarket' },
    { key: 'govt', label: 'Government office', osm: pairs('office=government;amenity=townhall'), ovt: 'government|city_hall|town_hall|courthouse|public_service' },
    { key: 'worship', label: 'Place of worship', osm: pairs('amenity=place_of_worship'), ovt: 'mosque|church|temple|shrine|place_of_worship|synagogue|religious|buddhist|hindu' },
    { key: 'transport', label: 'Bus / transport terminal', osm: pairs('amenity=bus_station;aeroway=terminal'), ovt: 'bus_station|airport|ferry_terminal|train_station|railway_station|transit_station|transport_hub|bus_terminal' },
    { key: 'attraction', label: 'Attraction / museum', osm: pairs('tourism=attraction;tourism=museum'), ovt: 'tourist_attraction|museum|landmark|attractions|monument|zoo|aquarium|national_park' },
  ];
  const ANCHOR_BY_KEY = {};
  ANCHORS.forEach((a) => { ANCHOR_BY_KEY[a.key] = a; a.re = tok(a.ovt); });

  // Judgement priors (assumptions): how strongly an anchor draws each business type, and which types cluster well.
  const ANCHOR_AFFINITY = {
    school: { stationery: .8, printing: .7, drinks: .7, fastfood: .6, minimart: .6, bakery: .5, cafe: .4, tuition: .8, childcare: .6, kids: .4 },
    college: { cafe: .8, drinks: .8, printing: .8, fastfood: .7, stationery: .6, laundry: .6, minimart: .6, electronics: .5, gym: .5, restaurant: .5, salon: .4, lodging: .3 },
    hospital: { pharmacy: 1, cafe: .6, restaurant: .5, minimart: .5, gifts: .5, lodging: .5, fastfood: .4, bakery: .4, clinic: .4, optician: .3, dentist: .3, laundry: .3 },
    mall: { restaurant: .6, cafe: .5, fastfood: .5, drinks: .5, salon: .4, electronics: .4, optician: .3, gym: .3 },
    govt: { printing: .8, cafe: .6, restaurant: .6, bank: .6, stationery: .5, fastfood: .5, drinks: .5, minimart: .4, tailor: .3 },
    worship: { restaurant: .4, gifts: .4, bakery: .3, freshfood: .3, minimart: .3, fashion: .3 },
    transport: { minimart: .8, fastfood: .7, cafe: .6, drinks: .6, lodging: .5, restaurant: .5, petrol: .5, bakery: .4, autoservice: .2 },
    attraction: { gifts: .8, lodging: .8, cafe: .7, restaurant: .6, drinks: .6, bakery: .4, fashion: .3 },
  };
  const AFFINITY_PAIRS = [
    ['cafe', 'restaurant', .6], ['cafe', 'bakery', .7], ['cafe', 'drinks', .5], ['cafe', 'fastfood', .4], ['restaurant', 'foodcourt', .5], ['restaurant', 'drinks', .5],
    ['restaurant', 'fastfood', .5], ['restaurant', 'bakery', .3], ['restaurant', 'lodging', .5], ['minimart', 'freshfood', .6], ['minimart', 'pharmacy', .5], ['minimart', 'laundry', .5],
    ['minimart', 'bakery', .4], ['minimart', 'fastfood', .3], ['minimart', 'petrol', .5], ['pharmacy', 'clinic', 1], ['pharmacy', 'dentist', .5], ['pharmacy', 'optician', .4],
    ['pharmacy', 'freshfood', .3], ['clinic', 'dentist', .6], ['clinic', 'optician', .5], ['gym', 'drinks', .5], ['gym', 'cafe', .5], ['gym', 'salon', .3], ['fashion', 'salon', .5],
    ['fashion', 'cafe', .4], ['fashion', 'electronics', .3], ['fashion', 'tailor', .6], ['fashion', 'gifts', .3], ['hardware', 'homegoods', .7], ['hardware', 'autoservice', .5],
    ['hardware', 'electronics', .3], ['autoservice', 'petrol', .6], ['autoservice', 'minimart', .3], ['petrol', 'fastfood', .4], ['petrol', 'drinks', .3], ['salon', 'laundry', .3],
    ['salon', 'cafe', .3], ['printing', 'stationery', .8], ['printing', 'tuition', .4], ['printing', 'electronics', .3], ['childcare', 'tuition', .6], ['childcare', 'kids', .5],
    ['childcare', 'minimart', .3], ['childcare', 'pharmacy', .3], ['lodging', 'cafe', .5], ['lodging', 'gifts', .5], ['bank', 'cafe', .3], ['bank', 'fastfood', .3], ['bank', 'minimart', .3],
    ['bank', 'restaurant', .3], ['bank', 'printing', .4],
  ];
  const AFFINITY = {};
  AFFINITY_PAIRS.forEach(([a, b, w]) => { (AFFINITY[a] = AFFINITY[a] || {})[b] = w; (AFFINITY[b] = AFFINITY[b] || {})[a] = w; });

  const NICHES = [
    { key: 'chinese', label: 'Chinese', osm: ['chinese', 'cantonese', 'hokkien', 'teochew', 'hakka', 'dim_sum'], re: tok('chinese|dim_sum|cantonese|taiwanese') },
    { key: 'malay', label: 'Malay / local', osm: ['malay', 'malaysian', 'indonesian', 'sarawak', 'local', 'nasi_lemak'], re: tok('malay|malaysian|indonesian|nasi') },
    { key: 'indian', label: 'Indian / mamak', osm: ['indian', 'mamak', 'south_indian', 'north_indian'], re: tok('indian|mamak|curry') },
    { key: 'western', label: 'Western', osm: ['western', 'american', 'italian', 'pizza', 'burger', 'steak_house', 'steak', 'french', 'european', 'mediterranean'], re: tok('american|italian|pizza|burger|steak|french|european|western') },
    { key: 'japanese', label: 'Japanese', osm: ['japanese', 'sushi', 'ramen', 'udon'], re: tok('japanese|sushi|ramen') },
    { key: 'korean', label: 'Korean', osm: ['korean'], re: tok('korean') },
    { key: 'thai', label: 'Thai', osm: ['thai'], re: tok('thai') },
    { key: 'seafood', label: 'Seafood', osm: ['seafood'], re: tok('seafood') },
    { key: 'vegetarian', label: 'Vegetarian / vegan', osm: ['vegetarian', 'vegan'], re: tok('vegetarian|vegan') },
    { key: 'middleeast', label: 'Middle Eastern', osm: ['arab', 'lebanese', 'turkish', 'middle_eastern', 'kebab'], re: tok('middle_eastern|turkish|lebanese|arab|kebab') },
  ];
  const DRINK_HINTS = ['bubble tea', 'boba', 'pearl milk tea', 'chatime', 'tealive', 'gong cha', 'koi thé', 'koi the', 'xing fu tang', 'tiger sugar', 'sharetea', 'share tea', 'comebuy', 'come buy', 'daboba', 'the alley', 'liho', 'yifang', 'each a cup'];

  const ARCH = {
    pioneer: { label: 'First-mover', blurb: 'None found here, yet the area shows demand signals.' },
    thin: { label: 'Under-supplied', blurb: 'Some exist, but supply is thin for a high-need or well-driven category.' },
    complementary: { label: 'Complementary', blurb: 'Fits businesses already clustered here.' },
    niche: { label: 'Niche', blurb: 'Category is crowded, but a specific sub-segment is missing.' },
    emerging: { label: 'Emerging', blurb: 'National retail trend is rising and the area is not crowded.' },
    proven: { label: 'Proven demand', blurb: 'Competitors confirm demand — win by differentiating.' },
    unverified: { label: 'Possible gap — verify', blurb: 'Nothing found, but the data is too thin to be sure.' },
    saturated: { label: 'Crowded', blurb: 'Dense competition — avoid or differentiate hard.' },
  };
  const ARCH_PRIORITY = ['pioneer', 'thin', 'complementary', 'niche', 'emerging', 'proven', 'unverified', 'saturated'];

  function makeCustom(key, k, v) {
    return { key, label: k + '=' + v, group: 'custom', needTier: 'supporting', need: NEED_TIER.supporting, crowded: 4, capital: 'medium', osm: [[k, v]], msic: null, iowrt: null, geo: [], ovt: '', founder: true, niches: false, custom: true };
  }

  /* ---------------- queries ---------------- */
  function collectOsmTags(catalog, anchors) {
    const seen = new Set(), out = [];
    (catalog || CATEGORIES).concat(anchors || ANCHORS).forEach((c) => c.osm.forEach(([k, v]) => { const id = k + '=' + v; if (!seen.has(id)) { seen.add(id); out.push([k, v]); } }));
    return out;
  }
  function buildOverpassQuery(bbox, tags, timeoutS) {
    const by = {};
    tags.forEach(([k, v]) => { (by[k] = by[k] || new Set()).add(v); });
    const bb = bbox.map((x) => Number(x).toFixed(6)).join(',');
    const body = Object.keys(by).sort().map((k) => {
      const vals = Array.from(by[k]).sort();
      return 'nwr["' + k + '"' + (vals.length === 1 ? '="' + vals[0] + '"' : '~"^(' + vals.join('|') + ')$"') + '](' + bb + ');';
    }).join('');
    return '[out:json][timeout:' + (timeoutS || 30) + '];(' + body + ');out center tags;';
  }
  function inspectOverpass(data) {
    if (!data || typeof data !== 'object') return { ok: false, problem: 'unreadable response', remark: '', elements: [] };
    const remark = typeof data.remark === 'string' ? data.remark : '';
    const bad = /runtime error|timed out|out of memory|too many requests|rate.?limit/i.test(remark);
    return { ok: !bad, problem: bad ? remark : '', remark, elements: Array.isArray(data.elements) ? data.elements : [] };
  }

  /* ---------------- classification ---------------- */
  function normName(s) {
    const stop = new Set(['sdn', 'bhd', 'enterprise', 'trading', 'restaurant', 'restoran', 'kedai', 'cafe', 'coffee', 'shop', 'store', 'the', 'and', 'branch', 'cawangan', 'miri', 'kuching', 'sibu', 'bintulu']);
    const all = String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    const kept = all.filter((t) => !stop.has(t));
    return new Set(kept.length ? kept : all);
  }
  function nameSim(a, b) {
    if (!a.size || !b.size) return 0;
    let n = 0; a.forEach((t) => { if (b.has(t)) n++; });
    return n / Math.min(a.size, b.size);
  }
  function cuisineNiches(values, fromOvt) {
    const out = [];
    NICHES.forEach((n) => {
      const hit = fromOvt ? n.re.test(String(values).toLowerCase()) : values.some((v) => n.osm.includes(v));
      if (hit) out.push(n.key);
    });
    return out;
  }
  function classifyOsm(el, catalog, anchors) {
    const t = el.tags || {};
    const lat = el.lat != null ? el.lat : (el.center && el.center.lat), lng = el.lon != null ? el.lon : (el.center && el.center.lon);
    if (lat == null || lng == null) return null;
    const name = t.name || t['name:en'] || '';
    const cats = [];
    (catalog || CATEGORIES).forEach((c) => { if (c.osm.some(([k, v]) => t[k] === v)) cats.push(c.key); });
    const lname = name.toLowerCase();
    if (t.cuisine === 'bubble_tea' || (lname && DRINK_HINTS.some((h) => lname.includes(h)))) { cats.length = 0; cats.push('drinks'); }
    const anchorHits = [];
    (anchors || ANCHORS).forEach((a) => { if (a.osm.some(([k, v]) => t[k] === v)) anchorHits.push(a.key); });
    const id = (el.type ? el.type[0] : 'n') + (el.id != null ? el.id : Math.random().toString(36).slice(2));
    const base = { id, name, lat, lng, sources: ['osm'] };
    const cuisines = String(t.cuisine || '').split(';').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return {
      poi: cats.length ? Object.assign({}, base, { cats, primary: cats[0], niche: cuisineNiches(cuisines, false), hasCuisine: cuisines.length > 0 }) : null,
      anchors: anchorHits.map((k) => Object.assign({}, base, { type: k })),
    };
  }
  function classifyOverture(r, catalog) {
    const cat = String(r.cat || '').toLowerCase(), basic = String(r.basic || '').toLowerCase();
    const blob = basic + ' ' + cat;
    if (!r.name || r.lat == null || r.lng == null || (r.conf != null && r.conf < T.OVT_MIN_CONF)) return { poi: null, anchors: [], unmapped: null, skipped: true };
    const base = { id: 'o' + (r.id || r.lat + ',' + r.lng), name: r.name, lat: r.lat, lng: r.lng, sources: ['ovt'], conf: r.conf, src: r.src };
    const keys = catalog ? catalog.map((c) => c.key) : null;
    let hit = null;
    for (const k of OVT_ORDER) { if ((!keys || keys.includes(k)) && OVT_RE[k] && OVT_RE[k].test(blob)) { hit = k; break; } }
    if (/(?:^|[^a-z0-9])(?:bubble_tea)(?:[^a-z0-9]|$)/.test(blob) || DRINK_HINTS.some((h) => r.name.toLowerCase().includes(h))) hit = 'drinks';
    const anchorHits = [];
    if (hit !== 'tuition' && hit !== 'childcare' && hit !== 'pet') ANCHORS.forEach((a) => { if (a.re.test(blob)) anchorHits.push(a.key); });
    return {
      poi: hit ? Object.assign({}, base, { cats: [hit], primary: hit, niche: BY_KEY[hit] && BY_KEY[hit].niches ? cuisineNiches(blob, true) : [], hasCuisine: false }) : null,
      anchors: anchorHits.map((k) => Object.assign({}, base, { type: k })),
      unmapped: !hit && !anchorHits.length ? (cat || basic || '(none)') : null,
    };
  }
  function classifyGeoapify(f, catalog) {
    const p = f.properties || {}, c = f.geometry && f.geometry.coordinates;
    if (!c) return null;
    const have = String(p.categories || '').split(',');
    const list = [];
    (catalog || CATEGORIES).forEach((cc) => { if ((cc.geo || []).some((g) => have.includes(g))) list.push(cc.key); });
    return list.length ? { id: 'g' + (p.place_id || c.join(',')), name: p.name || '', lat: c[1], lng: c[0], sources: ['geo'], cats: list, primary: list[0], niche: [], hasCuisine: false } : null;
  }

  function mergePois(osm, ovt) {
    const CELL = 0.001, key = (lat, lng) => Math.floor(lat / CELL) + ':' + Math.floor(lng / CELL);
    const grid = new Map();
    osm.forEach((p) => { p._n = normName(p.name); const k = key(p.lat, p.lng); (grid.get(k) || grid.set(k, []).get(k)).push(p); });
    let matched = 0;
    const extra = [];
    ovt.forEach((o) => {
      o._n = normName(o.name);
      const ci = Math.floor(o.lat / CELL), cj = Math.floor(o.lng / CELL);
      let best = null, bestD = Infinity;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        (grid.get((ci + di) + ':' + (cj + dj)) || []).forEach((p) => {
          if (!p.cats.some((c) => o.cats.includes(c))) return;
          const d = haversineM(p.lat, p.lng, o.lat, o.lng), named = p.name && o.name;
          const ok = named ? (d <= T.MERGE_NAMED_M && nameSim(p._n, o._n) >= T.MERGE_NAME_SIM) : d <= T.MERGE_UNNAMED_M;
          if (ok && d < bestD) { best = p; bestD = d; }
        });
      }
      if (best) { matched++; if (!best.sources.includes('ovt')) best.sources.push('ovt'); if (!best.name && o.name) best.name = o.name; best.conf = o.conf; }
      else extra.push(o);
    });
    const pois = osm.concat(extra);
    pois.forEach((p) => { delete p._n; });
    const nOsm = osm.length, nOvt = ovt.length, union = pois.length;
    const nHat = matched >= T.CR_MIN_MATCHES ? (nOsm * nOvt) / matched : null;
    return { pois, stats: { nOsm, nOvt, matched, union, nHat, recallOsm: nOvt ? matched / nOvt : null, recallOvt: nOsm ? matched / nOsm : null } };
  }

  /* ---------------- analysis ---------------- */
  const f1 = (n, s) => 1 - Math.exp(-n / s);
  const noisyOr = (xs) => 1 - xs.reduce((p, x) => p * (1 - clamp01(x)), 1);
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const fmtDist = (m) => (m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(1) + ' km');

  function colocation(pois, areaKm2, centerLat, catalog) {
    const lat0 = centerLat, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540, R = T.COLOC_R_M;
    const pts = pois.map((p) => ({ x: p.lng * kx, y: p.lat * ky, cats: p.cats }));
    const cell = new Map(), ck = (x, y) => Math.floor(x / R) + ':' + Math.floor(y / R);
    pts.forEach((p, i) => { const k = ck(p.x, p.y); (cell.get(k) || cell.set(k, []).get(k)).push(i); });
    const counts = {};
    pts.forEach((p) => p.cats.forEach((c) => { counts[c] = (counts[c] || 0) + 1; }));
    const near = (i, cat) => {
      const p = pts[i], cx = Math.floor(p.x / R), cy = Math.floor(p.y / R);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const arr = cell.get((cx + dx) + ':' + (cy + dy));
        if (!arr) continue;
        for (const j of arr) if (j !== i && pts[j].cats.includes(cat) && Math.hypot(pts[j].x - p.x, pts[j].y - p.y) <= R) return true;
      }
      return false;
    };
    const dir = (a, b) => {
      const nA = counts[a] || 0, nB = counts[b] || 0;
      if (nA < T.COLOC_MIN_N || nB < T.COLOC_MIN_N || !areaKm2) return null;
      const expected = 1 - Math.exp(-(nB / areaKm2) * Math.PI * (R / 1000) ** 2);
      if (expected < 0.02 || expected > 0.95) return null;
      let hit = 0, tot = 0;
      pts.forEach((p, i) => { if (p.cats.includes(a)) { tot++; if (near(i, b)) hit++; } });
      return (hit / tot) / expected;
    };
    const out = {};
    const keys = new Set((catalog || CATEGORIES).map((c) => c.key));
    AFFINITY_PAIRS.forEach(([a, b]) => {
      if (!keys.has(a) || !keys.has(b)) return;
      const l1 = dir(a, b), l2 = dir(b, a), v = [l1, l2].filter((x) => x != null);
      if (v.length) out[a + '|' + b] = { lift: v.reduce((s, x) => s + x, 0) / v.length, nA: counts[a], nB: counts[b] };
    });
    return out;
  }
  const obsFor = (co, a, b) => co[a + '|' + b] || co[b + '|' + a] || null;

  function coverageFrom(stats, hasOvt, nUnion) {
    let k, mode, note;
    if (hasOvt && stats.nHat) {
      k = clamp01(nUnion / stats.nHat); mode = 'capture-recapture';
      note = 'Two independent sources overlap on ' + stats.matched + ' places, which implies roughly ' + Math.round(stats.nHat) + ' businesses in this area; ' + nUnion + ' are mapped.';
    } else {
      k = clamp01(nUnion / T.SPARSE_N); mode = 'sparsity';
      note = hasOvt ? 'Too few places match across sources to estimate completeness; confidence is based on how many businesses are mapped.' : 'Overture layer not loaded: confidence only reflects how many businesses are mapped, not true completeness.';
    }
    return { k, level: k >= 0.75 ? 'High' : k >= 0.45 ? 'Medium' : 'Low', mode, note, stats, nUnion };
  }

  function analyze(inp) {
    const catalog = inp.catalog || CATEGORIES, pois = inp.pois || [], anchors = inp.anchors || [];
    const area = Math.max(inp.areaKm2 || 0.01, 0.01), pin = inp.pin || null;
    const trends = inp.trends || {};
    const anchorCounts = {};
    anchors.forEach((a) => { anchorCounts[a.type] = (anchorCounts[a.type] || 0) + 1; });
    const byCat = {};
    catalog.forEach((c) => { byCat[c.key] = []; });
    pois.forEach((p) => p.cats.forEach((k) => { if (byCat[k]) byCat[k].push(p); }));
    const cov = coverageFrom(inp.mergeStats || { nOsm: pois.length, nOvt: 0, matched: 0 }, !!inp.hasOvt, pois.length);
    const co = colocation(pois, area, pin ? pin.lat : (pois[0] ? pois[0].lat : 0), catalog);

    const hhi = (() => { const m = {}; pois.forEach((p) => { m[p.primary] = (m[p.primary] || 0) + 1; }); const n = pois.length; return n ? 1 - Object.values(m).reduce((s, x) => s + (x / n) ** 2, 0) : 1; })();

    const foodList = (byCat.restaurant || []).concat(byCat.fastfood || []);
    const tagged = foodList.filter((p) => p.hasCuisine || (p.niche && p.niche.length));
    const nicheCounts = {};
    NICHES.forEach((n) => { nicheCounts[n.key] = foodList.filter((p) => p.niche && p.niche.includes(n.key)).length; });
    const nicheInfo = {
      total: foodList.length, tagged: tagged.length, taggedShare: foodList.length ? tagged.length / foodList.length : 0, counts: nicheCounts,
      reliable: foodList.length >= T.NICHE_MIN_FOOD && tagged.length / foodList.length >= T.NICHE_MIN_TAGGED,
      gaps: NICHES.filter((n) => nicheCounts[n.key] === 0).map((n) => n.label),
    };

    const perCat = {};
    catalog.forEach((c) => {
      const list = byCat[c.key] || [], count = list.length, density = count / area;
      let nearest = null, within500 = 0;
      if (pin) list.forEach((p) => { const d = haversineM(pin.lat, pin.lng, p.lat, p.lng); if (nearest == null || d < nearest) nearest = d; if (d <= 500) within500++; });
      const sat = density / c.crowded;
      const drivers = [], dTerms = [];
      Object.keys(ANCHOR_AFFINITY).forEach((a) => {
        const w = (ANCHOR_AFFINITY[a] || {})[c.key];
        if (w && anchorCounts[a]) { const v = w * f1(anchorCounts[a] * (ANCHOR_SIZE[a] || 1), T.ANCHOR_N); dTerms.push(v); drivers.push({ anchor: a, n: anchorCounts[a], v }); }
      });
      const rel = [], cTerms = [];
      Object.keys(AFFINITY[c.key] || {}).forEach((r) => {
        const n = (byCat[r] || []).length;
        if (n && catalog.some((x) => x.key === r)) { const v = AFFINITY[c.key][r] * f1(n, T.CLUSTER_N); cTerms.push(v); rel.push({ key: r, n, w: AFFINITY[c.key][r], v }); }
      });
      drivers.sort((a, b) => b.v - a.v); rel.sort((a, b) => b.v - a.v);
      const yoy = c.iowrt && trends[c.iowrt] ? trends[c.iowrt].growthYoy : null;
      const trendScore = yoy == null ? null : clamp01(0.5 + yoy / 20);
      perCat[c.key] = {
        key: c.key, label: c.label, group: c.group, count, density, nearestM: nearest, within500, sat, white: 1 - Math.min(sat, 1),
        demand: noisyOr(dTerms), cluster: noisyOr(cTerms), need: c.need, needTier: c.needTier, drivers, related: rel, yoy, trendScore,
        conf: count > 0 ? 1 : cov.k, capital: c.capital, founder: c.founder, crowdedAt: c.crowded,
      };
    });

    // archetypes
    Object.values(perCat).forEach((m) => {
      const tags = [], why = {};
      const signal = m.demand >= 0.3 || m.cluster >= 0.4 || m.need >= 0.7;
      if (m.count === 0 && signal) {
        if (cov.k >= T.PIONEER_MIN_CONF) { tags.push('pioneer'); why.pioneer = 'Nothing found in this catchment and the area shows demand signals.'; }
        else { tags.push('unverified'); why.unverified = 'Nothing mapped, but only ' + Math.round(cov.k * 100) + '% data confidence — could be unmapped rather than absent.'; }
      }
      if (m.count >= 1 && m.sat < T.THIN_SAT && (m.need >= 0.7 || m.demand >= 0.4)) { tags.push('thin'); why.thin = 'Only ' + plural(m.count, 'place') + ' (' + m.density.toFixed(1) + '/km², crowded at ~' + m.crowdedAt + ') for a high-need or well-driven category.'; }
      if (m.count >= 1 && m.cluster >= 0.45 && m.sat < T.CROWDED_SAT) { tags.push('complementary'); why.complementary = 'Fits what is already here: ' + m.related.slice(0, 3).map((r) => r.n + '× ' + BY_KEY[r.key].label).join(', ') + '.'; }
      if (m.trendScore != null && m.trendScore >= T.EMERGING_SCORE && m.sat < T.CROWDED_SAT) { tags.push('emerging'); why.emerging = 'National retail trend ' + (m.yoy > 0 ? '+' : '') + m.yoy.toFixed(1) + '% YoY (DOSM, Malaysia-wide).'; }
      if ((m.key === 'restaurant' || m.key === 'fastfood') && m.sat >= 0.6 && nicheInfo.reliable && nicheInfo.gaps.length) {
        tags.push('niche'); why.niche = 'Crowded overall, but no ' + nicheInfo.gaps.slice(0, 3).join(' / ') + ' among ' + nicheInfo.total + ' food places (cuisine known for ' + Math.round(nicheInfo.taggedShare * 100) + '%).';
      }
      if (m.sat >= T.THIN_SAT && m.sat < T.CROWDED_SAT && m.demand >= 0.2 && !tags.length) { tags.push('proven'); why.proven = 'Competitors confirm demand (' + plural(m.count, 'place') + '); win by differentiating.'; }
      if (m.sat >= T.CROWDED_SAT) { tags.push('saturated'); why.saturated = m.density.toFixed(1) + '/km² vs ~' + m.crowdedAt + ' considered crowded (assumption).'; }
      m.archetypes = ARCH_PRIORITY.filter((a) => tags.includes(a));
      m.primary = m.archetypes[0] || null;
      m.why = why;
    });

    return {
      version: VERSION, areaKm2: area, pin, catalogKeys: catalog.map((c) => c.key), perCat, anchorCounts, diversity: hhi,
      coverage: cov, colocation: co, niche: nicheInfo, totals: { pois: pois.length, anchors: anchors.length }, demographics: inp.demographics || {}, trends,
    };
  }

  /* ---------------- ranking ---------------- */
  function explain(m, an, mode) {
    const ev = [], cov = an.coverage;
    if (m.count === 0) ev.push('None found in this catchment' + (cov.stats && cov.stats.nOvt ? ' (OpenStreetMap + Overture)' : ' (OpenStreetMap)') + ' — data confidence ' + cov.level.toLowerCase() + '.');
    else ev.push(plural(m.count, 'place') + ' found (' + m.density.toFixed(1) + '/km²; ~' + m.crowdedAt + '/km² is treated as crowded).' + (m.nearestM != null ? ' Nearest is ' + fmtDist(m.nearestM) + ' from your pin.' : ''));
    if (m.drivers.length) ev.push('Demand drivers nearby: ' + m.drivers.slice(0, 3).map((d) => d.n + '× ' + ANCHOR_BY_KEY[d.anchor].label.toLowerCase()).join(', ') + '.');
    if (m.related.length) {
      const obs = m.related.slice(0, 2).map((r) => { const o = obsFor(an.colocation, m.key, r.key); return o ? (o.lift >= 1.5 ? ' (seen ' + o.lift.toFixed(1) + '× more often than chance here)' : o.lift < 0.8 ? ' (not seen together here)' : '') : ''; });
      ev.push('Goes with ' + m.related.slice(0, 3).map((r, i) => r.n + '× ' + BY_KEY[r.key].label.toLowerCase() + (obs[i] || '')).join(', ') + ' already here.');
    }
    if (m.yoy != null) ev.push('National trend ' + (m.yoy > 0 ? '+' : '') + m.yoy.toFixed(1) + '% YoY (Malaysia-wide).');
    if (mode === 'opp') ev.push('Capital needed: ' + m.capital + ' (judgement).');
    Object.keys(m.why).forEach((k) => { if (ARCH[k] && !ev.includes(m.why[k])) ev.push(m.why[k]); });
    return ev;
  }
  function verifyTips(m, mode) {
    const t = [];
    if (m.archetypes.includes('pioneer') || m.archetypes.includes('unverified')) t.push('Walk the area and confirm there really is no ' + m.label.toLowerCase() + ' — the map can be out of date.');
    if (m.archetypes.includes('niche')) t.push('Check menus and reviews for the missing cuisine before committing.');
    if (m.archetypes.includes('saturated') || m.archetypes.includes('proven')) t.push('Visit the busiest competitor at peak hours and note queue length.');
    t.push('Ask landlords/agents for rent on units near this pin; this tool has no rent data.');
    return t;
  }
  function rankOpportunities(an, w, filterFounder) {
    const W = Object.assign({}, OPP_WEIGHTS, w || {}), sum = Object.values(W).reduce((s, x) => s + x, 0) || 1;
    return Object.values(an.perCat).filter((m) => !filterFounder || m.founder).map((m) => {
      const potential = (W.demand * m.demand + W.cluster * m.cluster + W.need * m.need + W.trend * (m.trendScore == null ? 0.5 : m.trendScore)) / sum;
      const score = clamp01(potential * (T.WHITE_FLOOR + (1 - T.WHITE_FLOOR) * m.white) * CAPITAL_FACTOR[m.capital] * (0.75 + 0.25 * m.conf));
      return Object.assign({ score, evidence: explain(m, an, 'opp'), verify: verifyTips(m, 'opp') }, m);
    }).sort((a, b) => b.score - a.score);
  }
  function rankComplements(an, w) {
    const W = Object.assign({}, COMP_WEIGHTS, w || {}), sum = Object.values(W).reduce((s, x) => s + x, 0) || 1;
    return Object.values(an.perCat).map((m) => {
      const raw = (W.need * m.need + W.cluster * m.cluster + W.demand * m.demand) / sum;
      const score = clamp01(raw * Math.sqrt(m.white) * (0.75 + 0.25 * m.conf));
      const benefits = [];
      Object.keys(AFFINITY[m.key] || {}).forEach((r) => { const pm = an.perCat[r]; if (pm && pm.count) benefits.push({ key: r, n: pm.count, v: AFFINITY[m.key][r] * f1(pm.count, T.CLUSTER_N) }); });
      benefits.sort((a, b) => b.v - a.v);
      return Object.assign({ score, benefits: benefits.slice(0, 3), evidence: explain(m, an, 'comp'), verify: verifyTips(m, 'comp') }, m);
    }).sort((a, b) => b.score - a.score);
  }
  function checklist(an) {
    return Object.values(an.perCat).map((m) => ({
      key: m.key, label: m.label, group: m.group, count: m.count, density: m.density, needTier: m.needTier, nearestM: m.nearestM,
      read: m.count === 0 ? 'gap' : m.sat < T.THIN_SAT ? 'thin' : m.sat < T.CROWDED_SAT ? 'healthy' : 'crowded',
    })).sort((a, b) => ({ gap: 0, thin: 1, healthy: 2, crowded: 3 }[a.read] - { gap: 0, thin: 1, healthy: 2, crowded: 3 }[b.read]) || (NEED_TIER[b.needTier] - NEED_TIER[a.needTier]));
  }
  function ideaScore(keys, an, weights, opts) {
    const W = Object.assign({}, IDEA_WEIGHTS, weights || {}), o = opts || {};
    const ms = keys.map((k) => an.perCat[k]).filter(Boolean);
    const low = ms.length ? 1 - ms.reduce((s, m) => s + Math.min(m.sat, 1), 0) / ms.length : 0.5;
    const d = an.demographics || {};
    const parts = {
      lowCompetition: clamp01(low), population: clamp01((d.population || 0) / POP_NORM), income: clamp01((d.income || 0) / INCOME_NORM), diversity: clamp01(an.diversity), momentum: 0.5,
      competitorStrength: o.observedBusyness != null ? clamp01(1 - (o.observedBusyness - 1) / 4) : 0.5,
    };
    const sum = Object.values(W).reduce((s, x) => s + x, 0) || 1;
    const total = Object.keys(parts).reduce((s, k) => s + (W[k] || 0) * parts[k], 0) / sum;
    return { total: clamp01(total), parts };
  }
  const verdict = (s) => (s >= 0.75 ? 'Strong opportunity' : s >= 0.55 ? 'Worth a closer look' : s >= 0.35 ? 'Competitive, proceed carefully' : 'Crowded — hard to stand out here');

  function toCsv(headers, rows) {
    const q = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [headers.map(q).join(',')].concat(rows.map((r) => r.map(q).join(','))).join('\r\n');
  }

  return {
    VERSION, CATEGORIES, BY_KEY, GROUPS, ANCHORS, ANCHOR_BY_KEY, ANCHOR_AFFINITY, AFFINITY, AFFINITY_PAIRS, NICHES, ARCH, ARCH_PRIORITY, OVT_ORDER,
    NEED_TIER, CAPITAL_FACTOR, ANCHOR_SIZE, T, OPP_WEIGHTS, COMP_WEIGHTS, IDEA_WEIGHTS, POP_NORM, INCOME_NORM, DRINK_HINTS,
    makeCustom, collectOsmTags, buildOverpassQuery, inspectOverpass, classifyOsm, classifyOverture, classifyGeoapify, mergePois, analyze,
    rankOpportunities, rankComplements, checklist, ideaScore, verdict, colocation, toCsv,
    geo: { haversineM, pointInRing, ringAreaKm2, ringBbox, circleBbox, circleRing }, util: { esc, clamp01, normName, nameSim, fmtDist, plural },
  };
});
