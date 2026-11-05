/**
 * /admin/analytics in the browser: one set of numbers from /api/admin/analytics,
 * drawn and redrawn as tabs, ranges and selections change. Everything that came
 * from a reader's request goes in with textContent, never as HTML.
 */
import type { Map as MLMap } from 'maplibre-gl';
import { BASE_STYLE, loadMaplibre, tintWater, webglOk } from '../scripts/map-kit.ts';
import { COUNTRY_NUMERIC } from '../data/trip-meta.ts';

type Row = { key: string; value: number };
type Grades = { g: number; o: number; p: number };
interface PageRow {
  path: string; views: number; measured: number; secs: number; avgSecs: number;
  depth: Record<string, number>; stay: Record<string, number>; clicks: number; dead: number; rage: number;
  landings: number; onward: number; leftPct: number; speed: { lcp: Grades; cls: Grades; inp: Grades };
}
interface City { cc: string; region: string; city: string; lat: number; lng: number; value: number }
interface Data {
  days: { day: string; views: number; visitors: number }[]; views: number; visitors: number; prevViews: number; prevVisitors: number;
  firstDay: string | null; measuredSince: string | null; landings: number; pagesPerVisit: number; avgSecs: number; returning: number; fresh: number;
  countries: Row[]; cities: City[]; countryPages: Record<string, Row[]>; referrers: Row[]; referrerLandings: Record<string, Row[]>;
  landingPages: Row[]; utm: Row[]; devices: Row[]; browsers: Row[]; systems: Row[]; widths: (Row & { avgSecs: number })[];
  screens: Row[]; languages: Row[]; colorScheme: Row[]; gaps: Row[]; visitCounts: Row[]; hours: number[][];
  journeys: { from: string; to: string; value: number }[]; searches: { q: string; value: number; zero: number }[]; pages: PageRow[];
  insights: { tone: 'good' | 'fix' | 'idea'; title: string; detail: string; path?: string }[];
  titles: Record<string, string>; tripOf: Record<string, string>; entryCount: number;
}
interface Detail {
  path: string; views: number; countries: Row[]; cities: Row[]; referrers: Row[]; widths: Row[]; cameFrom: Row[];
  targets: { kind: string; label: string; value: number }[]; heat: Record<string, { x: number; y: number; n: number }[]>;
}

const root = document.querySelector<HTMLElement>('[data-analytics]')!;
const panel = root.querySelector<HTMLElement>('[data-panel]')!;
const tip = root.querySelector<HTMLElement>('[data-tip]')!;
const TABS = ['overview', 'where', 'pages', 'heat', 'sources', 'people', 'search', 'vercel'];
const state = {
  days: 30, tab: 'overview', path: '/', device: 'desktop', layer: 'clicks', country: '', referrer: '', sort: 'views', desc: true, filter: '',
};
let data: Data | null = null;

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if ([7, 30, 90, 365].includes(Number(h.get('days')))) state.days = Number(h.get('days'));
  if (TABS.includes(h.get('tab') ?? '')) state.tab = h.get('tab')!;
  if (h.get('page')) state.path = h.get('page')!;
  if (['phone', 'tablet', 'desktop'].includes(h.get('device') ?? '')) state.device = h.get('device')!;
}
function writeHash() {
  const h = new URLSearchParams({ days: String(state.days), tab: state.tab });
  if (state.tab === 'heat') { h.set('page', state.path); h.set('device', state.device); }
  history.replaceState(null, '', `#${h}`);
}

// ---- small helpers -------------------------------------------------------------

type Child = Node | string | number | null | undefined | false;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v as Record<string, EventListener>)) e.addEventListener(ev, fn);
    else if (k === 'class') e.className = String(v);
    else if (k === 'style') e.setAttribute('style', String(v));
    else if (k in e && k !== 'list') (e as unknown as Record<string, unknown>)[k] = v;
    else e.setAttribute(k, String(v));
  }
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}
const present = (kids: Child[]) => kids.filter((k) => k !== null && k !== undefined && k !== false).map((k) => (k instanceof Node ? k : String(k)));
const fill = (host: Element, ...kids: Child[]) => host.append(...present(kids));
const refill = (host: Element, ...kids: Child[]) => host.replaceChildren(...present(kids));
const num = new Intl.NumberFormat('en-US');
const fmt = (n: number) => num.format(n);
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const titleOf = (p: string) => data?.titles[p] ?? p;
const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const languages = new Intl.DisplayNames(['en'], { type: 'language' });
const countryName = (cc: string) => { try { return cc === 'XX' ? 'Unknown' : regions.of(cc) ?? cc; } catch { return cc; } };
const langName = (l: string) => { try { return languages.of(l) ?? l; } catch { return l; } };
function dur(s: number) {
  if (!s) return '–';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}
const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function showTip(e: MouseEvent | FocusEvent, ...lines: Child[]) {
  tip.replaceChildren(...lines.map((l) => (l instanceof Node ? l : el('div', {}, l))));
  tip.hidden = false;
  const r = root.getBoundingClientRect();
  const m = e as MouseEvent;
  const t = (e.currentTarget as Element | null)?.getBoundingClientRect?.();
  const cx = m.clientX || (t ? t.left + t.width / 2 : 0);
  const cy = m.clientY || (t ? t.top : 0);
  const w = tip.offsetWidth;
  tip.style.left = `${Math.max(0, Math.min(r.width - w, cx - r.left - w / 2))}px`;
  tip.style.top = `${cy - r.top - tip.offsetHeight - 10}px`;
}
const hideTip = () => { tip.hidden = true; };

const card = (title: string, note: string | null, ...kids: Child[]) =>
  el('section', { class: 'an-card' }, el('h2', { class: 'an-h2' }, title), note ? el('p', { class: 'an-note' }, note) : null, ...kids);
const emptyNote = (s: string) => el('p', { class: 'an-empty' }, s);

/** A ranked list with a thin bar behind each row; pass onPick to make rows selectable. */
function bars(rows: { key: string; value: number; label?: string; sub?: string }[], opts: { onPick?: (k: string) => void; picked?: string; unit?: string; empty?: string } = {}) {
  if (!rows.length) return emptyNote(opts.empty ?? 'Nothing counted yet.');
  const top = Math.max(1, ...rows.map((r) => r.value));
  return el('ol', { class: 'an-bars' }, ...rows.map((r) => {
    const inner: Child[] = [
      el('span', { class: 'an-bars__fill', style: `width:${(r.value / top) * 100}%`, 'aria-hidden': 'true' }),
      el('span', { class: 'an-bars__label' }, r.label ?? r.key, r.sub ? el('small', {}, r.sub) : null),
      el('span', { class: 'an-bars__n mono' }, fmt(r.value), opts.unit ?? ''),
    ];
    return el('li', {}, opts.onPick
      ? el('button', { type: 'button', class: 'an-bars__row', 'aria-pressed': String(opts.picked === r.key), on: { click: () => opts.onPick!(r.key) } }, ...inner)
      : el('div', { class: 'an-bars__row' }, ...inner));
  }));
}
const pageRows = (rows: Row[]) => rows.map((r) => ({ key: r.key, value: r.value, label: titleOf(r.key), sub: data?.tripOf[r.key] }));
function openPage(path: string) {
  state.path = path;
  go('heat');
}

// ---- overview ------------------------------------------------------------------

function delta(now: number, before: number) {
  if (!before) return now ? 'new this period' : '';
  const p = Math.round(((now - before) / before) * 100);
  return `${p > 0 ? '▲' : p < 0 ? '▼' : '='} ${Math.abs(p)}% vs the ${state.days} days before`;
}
const tile = (label: string, value: string, sub = '') =>
  el('div', { class: 'an-tile' }, el('div', { class: 'an-tile__n' }, value), el('div', { class: 'an-tile__label' }, label), el('div', { class: 'an-tile__sub mono' }, sub));

function trend(d: Data) {
  // Drawn at the width it will show, so its labels stay readable on a phone.
  const W = Math.max(320, Math.min(1300, panel.clientWidth - 40)); const H = 240; const L = 44; const R = 64; const T = 14; const B = 26;
  const days = d.days;
  const top = Math.max(1, ...days.map((x) => x.views));
  const p10 = 10 ** Math.floor(Math.log10(top));
  const max = [1, 2, 5, 10].map((m) => m * p10).find((v) => v >= top)!;
  const x = (i: number) => L + (i / Math.max(1, days.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const ns = 'http://www.w3.org/2000/svg';
  const s = (tag: string, a: Record<string, string | number>, text?: string) => {
    const n = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Views and visitors per day: ${fmt(d.views)} views in ${days.length} days. A table follows.`, class: 'an-trend' });
  for (const t of [0, max / 2, max]) {
    svg.append(s('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), class: 'an-grid' }));
    svg.append(s('text', { x: L - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'an-axis' }, fmt(t)));
  }
  const every = Math.max(1, Math.ceil(days.length / 6));
  days.forEach((dd, i) => { if (i % every === 0) svg.append(s('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', class: 'an-axis' }, dayLabel(dd.day))); });
  const line = (key: 'views' | 'visitors') => days.map((dd, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(dd[key]).toFixed(1)}`).join('');
  svg.append(s('path', { d: line('visitors'), class: 'an-line an-line--2' }));
  svg.append(s('path', { d: line('views'), class: 'an-line an-line--1' }));
  const last = days[days.length - 1];
  if (last) {
    svg.append(s('text', { x: x(days.length - 1) + 6, y: y(last.views) + 4, class: 'an-direct' }, 'Views'));
    if (Math.abs(y(last.views) - y(last.visitors)) > 14) svg.append(s('text', { x: x(days.length - 1) + 6, y: y(last.visitors) + 4, class: 'an-direct' }, 'Visitors'));
  }
  const hair = s('line', { y1: T, y2: H - B, class: 'an-hair', visibility: 'hidden' });
  const dot = s('circle', { r: 4, class: 'an-dot', visibility: 'hidden' });
  svg.append(hair, dot);
  const hit = s('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
  svg.append(hit);
  hit.addEventListener('pointermove', (ev) => {
    const e = ev as PointerEvent;
    const box = svg.getBoundingClientRect();
    const sx = ((e.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(days.length - 1, Math.round(((sx - L) / (W - L - R)) * (days.length - 1))));
    hair.setAttribute('x1', String(x(i))); hair.setAttribute('x2', String(x(i))); hair.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', String(x(i))); dot.setAttribute('cy', String(y(days[i].views))); dot.setAttribute('visibility', 'visible');
    showTip(e, el('div', { class: 'an-tip__head' }, dayLabel(days[i].day)), el('div', {}, el('strong', {}, fmt(days[i].views)), ' views'), el('div', {}, el('strong', {}, fmt(days[i].visitors)), ' visitors'));
  });
  hit.addEventListener('pointerleave', () => { hair.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(); });
  const table = el('details', { class: 'an-table-wrap' }, el('summary', { class: 'mono' }, 'Table view'),
    el('table', { class: 'an-table' }, el('thead', {}, el('tr', {}, el('th', {}, 'Day'), el('th', {}, 'Views'), el('th', {}, 'Visitors'))),
      el('tbody', {}, ...[...days].reverse().map((dd) => el('tr', {}, el('td', {}, dayLabel(dd.day)), el('td', {}, fmt(dd.views)), el('td', {}, fmt(dd.visitors)))))));
  const legend = el('div', { class: 'an-legend' },
    el('span', {}, el('i', { class: 'an-key an-key--1' }), 'Views'),
    el('span', {}, el('i', { class: 'an-key an-key--2' }), 'Visitors (estimated, each day)'));
  return el('div', {}, legend, svg, table);
}

function renderOverview(d: Data) {
  const visits = d.returning + d.fresh;
  fill(panel, 
    el('div', { class: 'an-tiles' },
      tile('Page views', fmt(d.views), delta(d.views, d.prevViews)),
      tile('Visitors', fmt(d.visitors), delta(d.visitors, d.prevVisitors)),
      tile('Visits', fmt(d.landings), d.landings ? `${d.pagesPerVisit} pages each` : ''),
      tile('Average time on a page', dur(d.avgSecs), 'while actively reading'),
      tile('Coming back', visits ? `${pct(d.returning, visits)}%` : '–', visits ? `${fmt(d.returning)} of ${fmt(visits)} visits` : ''),
      tile('Countries', fmt(d.countries.filter((c) => c.key !== 'XX').length), d.cities.length ? `${fmt(d.cities.length)} cities` : ''),
    ),
    !d.measuredSince ? el('p', { class: 'an-banner' }, 'Clicks, time, depth, cities and repeat visits start counting when this page goes live. Views, countries, referrers and devices already have history.') : null,
    card('What to do next', d.insights.length ? null : 'Suggestions appear once a page has about 15 measured visits.',
      el('ul', { class: 'an-insights' }, ...d.insights.map((i) => el('li', { class: `an-insight an-insight--${i.tone}` },
        el('span', { class: 'an-insight__tag mono' }, i.tone === 'good' ? 'Working' : i.tone === 'fix' ? 'Fix' : 'Idea'),
        el('div', {}, el('strong', {}, i.title), el('p', {}, i.detail),
          i.path ? el('button', { type: 'button', class: 'an-link', on: { click: () => openPage(i.path!) } }, 'Open this page\'s click map →') : null))))),
    card('Views over time', null, trend(d)),
    el('div', { class: 'an-two' },
      card('Most read', null, bars(pageRows(d.pages.slice(0, 8).map((p) => ({ key: p.path, value: p.views }))), { onPick: openPage })),
      card('Where they are', null, bars(d.countries.slice(0, 8).map((c) => ({ key: c.key, value: c.value, label: countryName(c.key) })), { onPick: (k) => { state.country = k; go('where'); } }))),
  );
}

// ---- where: the planet ---------------------------------------------------------

let map: MLMap | null = null;
let centroids: Record<string, [number, number]> | null = null;

async function loadCentroids() {
  if (centroids) return centroids;
  const [{ feature }, { geoCentroid }, world] = await Promise.all([import('topojson-client'), import('d3-geo'), import('world-atlas/countries-50m.json')]);
  const atlas = (world as unknown as { default: { objects: { countries: unknown } } }).default;
  const geo = feature(atlas as never, atlas.objects.countries as never) as unknown as { features: { id: string }[] };
  const alpha = new Map(Object.entries(COUNTRY_NUMERIC).map(([a, n]) => [n, a]));
  centroids = {};
  for (const f of geo.features) {
    const a = alpha.get(String(f.id));
    if (a) centroids[a] = geoCentroid(f as never) as [number, number];
  }
  return centroids;
}

function pointsFor(d: Data, c: Record<string, [number, number]>) {
  const byCountry = new Map<string, number>();
  for (const x of d.cities) byCountry.set(x.cc, (byCountry.get(x.cc) ?? 0) + x.value);
  const features = d.cities.map((x) => ({
    type: 'Feature' as const,
    properties: { kind: 'city', cc: x.cc, label: `${x.city}${x.region ? `, ${x.region}` : ''}`, place: countryName(x.cc), value: x.value },
    geometry: { type: 'Point' as const, coordinates: [x.lng, x.lat] },
  }));
  // Views from before cities were counted, or with no city known, sit at the country's middle.
  for (const r of d.countries) {
    const rest = r.value - (byCountry.get(r.key) ?? 0);
    const at = c[r.key];
    if (rest > 0 && at) features.push({
      type: 'Feature' as const,
      properties: { kind: 'country', cc: r.key, label: countryName(r.key), place: 'City not known', value: rest },
      geometry: { type: 'Point' as const, coordinates: at },
    });
  }
  return { type: 'FeatureCollection' as const, features };
}

async function renderWhere(d: Data) {
  const mapEl = el('div', { class: 'an-map', 'aria-label': 'Map of where readers are; the same numbers are in the lists beside it' });
  const side = el('div', { class: 'an-map-side' });
  const heatBox = el('input', { type: 'checkbox', checked: true });
  const dotBox = el('input', { type: 'checkbox', checked: true });
  fill(panel, 
    el('div', { class: 'an-tiles an-tiles--3' },
      tile('Countries', fmt(d.countries.filter((c) => c.key !== 'XX').length)),
      tile('Cities', fmt(d.cities.length), d.measuredSince ? `counted since ${dayLabel(d.measuredSince)}` : 'counting starts when this goes live'),
      tile('Top place', d.cities[0]?.city ?? (d.countries[0] ? countryName(d.countries[0].key) : '–'), d.cities[0] ? countryName(d.cities[0].cc) : ''),
    ),
    el('section', { class: 'an-card an-map-card' },
      el('div', { class: 'an-map-head' },
        el('h2', { class: 'an-h2' }, 'Where on the planet'),
        el('label', { class: 'an-check' }, heatBox, 'Heat'),
        el('label', { class: 'an-check' }, dotBox, 'Dots'),
        el('span', { class: 'an-note' }, 'Solid dots are cities; hollow dots are a whole country, for views where the city isn\'t known. Click a dot or a country in the list.')),
      el('div', { class: 'an-map-grid' }, mapEl, side)));

  const drawSide = () => {
    const cc = state.country;
    side.replaceChildren(
      cc
        ? el('div', {},
          el('h3', { class: 'an-h3' }, countryName(cc)),
          el('button', { type: 'button', class: 'an-link', on: { click: () => { state.country = ''; drawSide(); } } }, '← All countries'),
          el('h4', { class: 'an-h4 mono' }, 'Cities'),
          bars(d.cities.filter((x) => x.cc === cc).slice(0, 10).map((x) => ({ key: x.city, value: x.value, label: x.city, sub: x.region })), { empty: 'No cities counted here yet.' }),
          el('h4', { class: 'an-h4 mono' }, 'What they read'),
          bars(pageRows(d.countryPages[cc] ?? []), { onPick: openPage, empty: 'Counted from when this page goes live.' }))
        : el('div', {},
          el('h3', { class: 'an-h3' }, 'Countries'),
          bars(d.countries.slice(0, 15).map((c) => ({ key: c.key, value: c.value, label: countryName(c.key) })), { onPick: (k) => { state.country = k; drawSide(); fly(k); } }),
          el('h3', { class: 'an-h3' }, 'Cities'),
          bars(d.cities.slice(0, 12).map((x) => ({ key: `${x.city}|${x.cc}`, value: x.value, label: x.city, sub: countryName(x.cc) })), { empty: 'Counting starts when this page goes live.' })),
    );
  };
  drawSide();

  const fly = (cc: string) => { const at = centroids?.[cc]; if (at && map) map.easeTo({ center: at, zoom: 3 }); };

  if (!webglOk()) { mapEl.replaceChildren(emptyNote('This browser can\'t draw the map. The lists have the same numbers.')); return; }
  const [ml, c] = await Promise.all([loadMaplibre(), loadCentroids()]);
  if (!mapEl.isConnected) return;
  map?.remove();
  const m = new ml.Map({ container: mapEl, style: BASE_STYLE, center: [-30, 25], zoom: 1.3, attributionControl: { compact: true } });
  map = m;
  m.addControl(new ml.NavigationControl({ showCompass: false }));
  const popup = new ml.Popup({ closeButton: false, offset: 10, className: 'an-pop' });
  await new Promise<void>((ok) => m.once('load', () => ok()));
  m.setProjection({ type: 'globe' });
  tintWater(m);
  const max = Math.max(1, ...d.countries.map((x) => x.value), ...d.cities.map((x) => x.value));
  m.addSource('readers', { type: 'geojson', data: pointsFor(d, c) as GeoJSON.FeatureCollection });
  m.addLayer({
    id: 'r-heat', type: 'heatmap', source: 'readers', maxzoom: 9,
    paint: {
      'heatmap-weight': ['interpolate', ['linear'], ['get', 'value'], 0, 0, max, 1],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 0, 1.2, 9, 3],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 0, 18, 9, 40],
      'heatmap-opacity': 0.75,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(255,194,75,0)', 0.25, 'rgba(255,194,75,0.35)', 0.6, 'rgba(255,170,50,0.7)', 1, 'rgba(255,120,40,0.95)'],
    },
  });
  m.addLayer({
    id: 'r-dot', type: 'circle', source: 'readers',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['sqrt', ['get', 'value']], 1, 4, Math.sqrt(max), 20],
      'circle-color': ['match', ['get', 'kind'], 'city', '#ffc24b', 'rgba(255,194,75,0.15)'],
      'circle-stroke-color': ['match', ['get', 'kind'], 'city', '#12161c', '#ffc24b'],
      'circle-stroke-width': 1.5,
    },
  });
  heatBox.addEventListener('change', () => m.setLayoutProperty('r-heat', 'visibility', heatBox.checked ? 'visible' : 'none'));
  dotBox.addEventListener('change', () => m.setLayoutProperty('r-dot', 'visibility', dotBox.checked ? 'visible' : 'none'));
  m.on('mouseenter', 'r-dot', () => { m.getCanvas().style.cursor = 'pointer'; });
  m.on('mouseleave', 'r-dot', () => { m.getCanvas().style.cursor = ''; popup.remove(); });
  m.on('mousemove', 'r-dot', (e) => {
    const p = e.features![0].properties as { label: string; place: string; value: number };
    const box = el('div', {}, el('strong', {}, `${fmt(p.value)} views`), el('div', {}, p.label), el('div', { class: 'an-pop__sub' }, p.place));
    popup.setLngLat(e.lngLat).setDOMContent(box).addTo(m);
  });
  m.on('click', 'r-dot', (e) => {
    const cc = e.features![0].properties!.cc as string;
    state.country = cc;
    drawSide();
  });
  if (state.country) fly(state.country);
}

// ---- pages ---------------------------------------------------------------------

const COLUMNS: { key: string; label: string; title?: string; value: (p: PageRow) => number; show: (p: PageRow) => string }[] = [
  { key: 'views', label: 'Views', value: (p) => p.views, show: (p) => fmt(p.views) },
  { key: 'time', label: 'Avg time', title: 'Average time actively reading', value: (p) => p.avgSecs, show: (p) => dur(p.avgSecs) },
  { key: 'total', label: 'Total time', title: 'All reading time on this page', value: (p) => p.secs, show: (p) => dur(p.secs) },
  { key: 'depth', label: 'Read to end', title: 'Share who reached 90% of the page', value: (p) => p.depth[90], show: (p) => (p.measured ? `${p.depth[90]}%` : '–') },
  { key: 'left', label: 'Left site', title: 'Estimate: views that didn\'t go on to another page here', value: (p) => p.leftPct, show: (p) => (p.views ? `${p.leftPct}%` : '–') },
  { key: 'landed', label: 'Landed', title: 'Visits that started here', value: (p) => p.landings, show: (p) => fmt(p.landings) },
  { key: 'clicks', label: 'Clicks', value: (p) => p.clicks, show: (p) => fmt(p.clicks) },
  { key: 'dead', label: 'Dead clicks', title: 'Clicks on something that does nothing', value: (p) => p.dead, show: (p) => fmt(p.dead) },
];

function renderPages(d: Data) {
  const body = el('tbody');
  const headRow = el('tr');
  const draw = () => {
    const col = COLUMNS.find((c) => c.key === state.sort) ?? COLUMNS[0];
    const q = state.filter.toLowerCase();
    const rows = d.pages
      .filter((p) => !q || p.path.includes(q) || titleOf(p.path).toLowerCase().includes(q))
      .sort((a, b) => (state.desc ? col.value(b) - col.value(a) : col.value(a) - col.value(b)))
      .slice(0, 200);
    body.replaceChildren(...rows.map((p) => el('tr', {},
      el('th', { scope: 'row', class: 'an-table__page' },
        el('button', { type: 'button', class: 'an-link', on: { click: () => openPage(p.path) } }, titleOf(p.path)),
        el('small', { class: 'mono' }, d.tripOf[p.path] ?? p.path)),
      ...COLUMNS.map((c) => el('td', { class: 'mono' }, c.show(p))))));
    headRow.replaceChildren(
      el('th', { scope: 'col' }, 'Page'),
      ...COLUMNS.map((c) => el('th', { scope: 'col', 'aria-sort': c.key === state.sort ? (state.desc ? 'descending' : 'ascending') : 'none' },
        el('button', {
          type: 'button', class: 'an-sort', title: c.title,
          on: { click: () => { if (state.sort === c.key) state.desc = !state.desc; else { state.sort = c.key; state.desc = true; } draw(); } },
        }, c.label, c.key === state.sort ? (state.desc ? ' ↓' : ' ↑') : ''))),
    );
  };
  draw();
  fill(panel, card('Every page', 'Sort by any column; click a title for its click map. Time, depth and clicks count from when this page goes live.',
    el('input', { type: 'search', class: 'an-search', placeholder: 'Filter pages…', 'aria-label': 'Filter pages', value: state.filter, on: { input: (e: Event) => { state.filter = (e.target as HTMLInputElement).value; draw(); } } }),
    el('div', { class: 'an-scroll' }, el('table', { class: 'an-table an-table--pages' }, el('thead', {}, headRow), body))));
}

// ---- heat: one page, under its clicks ------------------------------------------

const VIEWPORTS: Record<string, number> = { phone: 390, tablet: 820, desktop: 1280 };
const KIND_LABEL: Record<string, string> = {
  link: 'Link', out: 'Outside link', ui: 'Button', photo: 'Photo', instagram: 'Instagram photo', map: 'Map', dead: 'Nothing there', 'dead-photo': 'Photo that doesn\'t open',
};

async function renderHeat(d: Data) {
  const known = d.pages.filter((p) => p.views > 0);
  const select = el('select', { 'aria-label': 'Page', class: 'an-select', on: { change: (e: Event) => { state.path = (e.target as HTMLSelectElement).value; go('heat'); } } },
    ...(known.some((p) => p.path === state.path) ? [] : [el('option', { value: state.path, selected: true }, titleOf(state.path))]),
    ...known.slice(0, 300).map((p) => el('option', { value: p.path, selected: p.path === state.path }, `${titleOf(p.path)} (${fmt(p.views)})`)));
  const segment = (name: string, options: [string, string][], current: string, set: (v: string) => void) =>
    el('div', { class: 'an-seg', role: 'group', 'aria-label': name }, ...options.map(([v, label]) =>
      el('button', { type: 'button', 'aria-pressed': String(v === current), on: { click: () => set(v) } }, label)));

  const stage = el('div', { class: 'an-stage' });
  const side = el('div', { class: 'an-heat-side' }, emptyNote('Loading…'));
  fill(panel, el('section', { class: 'an-card' },
    el('div', { class: 'an-heat-controls' },
      select,
      segment('Screen', [['phone', 'Phone'], ['tablet', 'Tablet'], ['desktop', 'Computer']], state.device, (v) => { state.device = v; go('heat'); }),
      segment('Layer', [['clicks', 'Clicks'], ['scroll', 'How far they read'], ['both', 'Both']], state.layer, (v) => { state.layer = v; go('heat'); })),
    el('p', { class: 'an-note' }, 'The real page, drawn with readers\' clicks on top. Positions are close rather than exact, because a page can change height as photos load. Maps and search are blank here because the preview runs no scripts.'),
    el('div', { class: 'an-heat-grid' }, stage, side)));

  const row = d.pages.find((p) => p.path === state.path);
  const res = await fetch(`/api/admin/analytics?days=${state.days}&path=${encodeURIComponent(state.path)}`);
  const detail = (await res.json()) as Detail;
  if (!stage.isConnected) return;

  const cells = detail.heat?.[state.device] ?? [];
  const total = cells.reduce((s, c) => s + c.n, 0);
  refill(side,
    el('h3', { class: 'an-h3' }, titleOf(state.path)),
    el('p', { class: 'an-note' }, el('a', { href: state.path, target: '_blank', rel: 'noopener' }, 'Open the page ↗')),
    el('dl', { class: 'an-facts' },
      el('dt', {}, 'Views'), el('dd', { class: 'mono' }, fmt(row?.views ?? detail.views)),
      el('dt', {}, 'Average time'), el('dd', { class: 'mono' }, dur(row?.avgSecs ?? 0)),
      el('dt', {}, `Clicks on ${state.device === 'desktop' ? 'a computer' : `a ${state.device}`}`), el('dd', { class: 'mono' }, fmt(total)),
      el('dt', {}, 'Dead clicks'), el('dd', { class: 'mono' }, fmt(row?.dead ?? 0)),
      el('dt', {}, 'Rapid repeat clicks'), el('dd', { class: 'mono' }, fmt(row?.rage ?? 0))),
    el('h4', { class: 'an-h4 mono' }, 'What gets clicked'),
    bars(detail.targets.slice(0, 12).map((t) => ({
      key: `${t.kind}|${t.label}`, value: t.value,
      label: t.kind === 'link' ? titleOf(t.label) : t.label || KIND_LABEL[t.kind] || t.kind,
      sub: KIND_LABEL[t.kind],
    })), { empty: 'No clicks counted yet.' }),
    row?.measured ? el('div', {},
      el('h4', { class: 'an-h4 mono' }, 'How far they read'),
      bars([25, 50, 75, 90, 100].map((b) => ({ key: String(b), value: row.depth[b], label: `${b}% of the page` })), { unit: '%' }),
      el('h4', { class: 'an-h4 mono' }, 'How long they stayed'),
      bars([[10, '10 seconds'], [30, '30 seconds'], [60, '1 minute'], [180, '3 minutes'], [600, '10 minutes']].map(([b, l]) => ({ key: String(b), value: row.stay[b as number], label: `${l} or more` })), { unit: '%' }),
    ) : null,
    el('h4', { class: 'an-h4 mono' }, 'Came from'),
    bars([...detail.referrers, ...detail.cameFrom.map((r) => ({ key: r.key, value: r.value, label: titleOf(r.key) }))].sort((a, b) => b.value - a.value).slice(0, 8)),
    el('h4', { class: 'an-h4 mono' }, 'Where they are'),
    bars(detail.countries.slice(0, 8).map((c) => ({ key: c.key, value: c.value, label: countryName(c.key) }))),
  );

  // The page itself. No scripts run in the frame, so it can't count itself or go anywhere.
  const width = VIEWPORTS[state.device];
  const frame = el('iframe', { src: state.path, title: `Preview of ${titleOf(state.path)}`, sandbox: 'allow-same-origin', scrolling: 'no', tabIndex: -1 }) as HTMLIFrameElement;
  frame.style.width = `${width}px`;
  frame.style.height = '900px';
  const canvas = el('canvas', { class: 'an-heat-canvas', 'aria-hidden': 'true' });
  const marks = el('div', { class: 'an-depths', 'aria-hidden': 'true' });
  const inner = el('div', { class: 'an-stage__inner' }, frame, canvas, marks);
  // Scaling doesn't shrink the space an element takes up, so this holds the scaled height.
  const sizer = el('div', { class: 'an-stage__sizer' }, inner);
  stage.replaceChildren(sizer);
  const scale = Math.min(1, (stage.clientWidth || width) / width);
  inner.style.width = `${width}px`;
  inner.style.transform = `scale(${scale})`;

  frame.addEventListener('load', () => {
    const doc = frame.contentDocument;
    const measure = () => Math.min(20000, Math.max(doc?.documentElement.scrollHeight ?? 900, doc?.body?.scrollHeight ?? 900));
    const draw = () => {
      if (!canvas.isConnected) return;
      const first = measure();
      frame.style.height = `${first}px`;
      // A page sized to the window would grow with the frame; keep the first height if so.
      let height = measure();
      if (height > first * 1.5) { height = first; frame.style.height = `${first}px`; if (doc?.documentElement) doc.documentElement.style.overflow = 'hidden'; }
      inner.style.height = `${height}px`;
      sizer.style.height = `${height * scale}px`;
      canvas.width = width;
      canvas.height = height;
      const g = canvas.getContext('2d')!;
      g.clearRect(0, 0, width, height);
      marks.replaceChildren();
      if (state.layer !== 'clicks' && row?.measured) {
        const steps = [25, 50, 75, 90, 100];
        steps.forEach((b, i) => {
          const y1 = (b / 100) * height;
          const y0 = i ? (steps[i - 1] / 100) * height : 0;
          // Shade by how many readers never got this far.
          g.fillStyle = `rgba(18,22,28,${((100 - row.depth[b]) / 100) * 0.6})`;
          g.fillRect(0, y0, width, y1 - y0);
          marks.append(el('div', { class: 'an-depth', style: `top:${y1}px` }, el('span', {}, `${row.depth[b]}% reached ${b}% of the page`)));
        });
      }
      if (state.layer !== 'scroll' && cells.length) {
        const top = Math.max(...cells.map((c) => c.n));
        const r = Math.max(20, width / 40);
        for (const c of cells) {
          const x = ((c.x + 0.5) / 50) * width;
          const y = ((c.y + 0.5) / 200) * height;
          const a = 0.25 + 0.65 * Math.sqrt(c.n / top);
          const glow = g.createRadialGradient(x, y, 0, x, y, r);
          glow.addColorStop(0, `rgba(226,52,28,${a})`);
          glow.addColorStop(1, 'rgba(226,52,28,0)');
          g.fillStyle = glow;
          g.fillRect(x - r, y - r, r * 2, r * 2);
        }
      }
    };
    draw();
    // Photos arrive after the page does, and change its height.
    setTimeout(draw, 1500);
    setTimeout(draw, 5000);

    canvas.addEventListener('pointermove', (e) => {
      const box = canvas.getBoundingClientRect();
      const px = ((e.clientX - box.left) / box.width) * 50;
      const py = ((e.clientY - box.top) / box.height) * 200;
      const near = cells.filter((c) => Math.abs(c.x + 0.5 - px) < 1.5 && Math.abs(c.y + 0.5 - py) < 1.5 * (canvas.height > 4000 ? 1 : 2));
      if (!near.length) { hideTip(); return; }
      showTip(e, el('div', {}, el('strong', {}, fmt(near.reduce((s, c) => s + c.n, 0))), ' clicks here'));
    });
    canvas.addEventListener('pointerleave', hideTip);
  });
}

// ---- sources -------------------------------------------------------------------

function renderSources(d: Data) {
  const landing = el('div');
  const drawLanding = () => {
    const ref = state.referrer;
    landing.replaceChildren(ref
      ? el('div', {},
        el('h3', { class: 'an-h3' }, `Landing from ${ref}`),
        el('button', { type: 'button', class: 'an-link', on: { click: () => { state.referrer = ''; drawLanding(); redrawRefs(); } } }, '← All landing pages'),
        bars(pageRows(d.referrerLandings[ref] ?? []), { onPick: openPage, empty: 'Counted from when this page goes live.' }))
      : el('div', {}, el('h3', { class: 'an-h3' }, 'Where visits start'),
        bars(pageRows(d.landingPages.slice(0, 12)), { onPick: openPage, empty: 'Counted from when this page goes live.' })));
  };
  const refsHost = el('div');
  const redrawRefs = () => refsHost.replaceChildren(bars(d.referrers.map((r) => ({ key: r.key, value: r.value, label: r.key === '(direct)' ? 'Direct or unknown' : r.key })), {
    picked: state.referrer, onPick: (k) => { state.referrer = state.referrer === k ? '' : k; drawLanding(); redrawRefs(); },
  }));
  redrawRefs();
  drawLanding();
  fill(panel, 
    el('div', { class: 'an-two' },
      card('Redirected from', 'The site each view arrived from. Pick one to see where it lands.', refsHost),
      el('section', { class: 'an-card' }, landing)),
    card('How readers move around', 'The most common steps from one page to the next.',
      d.journeys.length
        ? el('ol', { class: 'an-flows' }, ...d.journeys.slice(0, 20).map((j) => el('li', {},
          el('button', { type: 'button', class: 'an-link', on: { click: () => openPage(j.from) } }, titleOf(j.from)),
          el('span', { class: 'an-flows__arrow', 'aria-label': 'then' }, '→'),
          el('button', { type: 'button', class: 'an-link', on: { click: () => openPage(j.to) } }, titleOf(j.to)),
          el('span', { class: 'mono an-flows__n' }, fmt(j.value)))))
        : emptyNote('Counted from when this page goes live.')),
    d.utm.length ? card('Campaign links', 'Links you tagged with utm_source.', bars(d.utm.map((u) => ({ key: u.key, value: u.value, label: u.key.replace('|', ' · ') })))) : null,
  );
}

// ---- people and devices --------------------------------------------------------

function hourGrid(d: Data) {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const top = Math.max(0, ...d.hours.flat());
  if (!top) return emptyNote('Counted from when this page goes live.');
  return el('div', { class: 'an-scroll' }, el('table', { class: 'an-hours' },
    el('caption', { class: 'an-note' }, 'Hours are the reader\'s own local time. Darker means more views.'),
    el('thead', {}, el('tr', {}, el('th', {}), ...Array.from({ length: 24 }, (_, h) => el('th', { scope: 'col', class: 'mono' }, h % 3 === 0 ? String(h) : '')))),
    el('tbody', {}, ...d.hours.map((row, i) => el('tr', {}, el('th', { scope: 'row', class: 'mono' }, names[i]), ...row.map((v, h) => {
      const text = `${names[i]} ${String(h).padStart(2, '0')}:00, ${fmt(v)} views`;
      return el('td', {
        tabIndex: v ? 0 : -1, 'aria-label': text, style: `--a:${v ? 0.12 + 0.88 * Math.sqrt(v / top) : 0}`,
        on: { pointermove: (e: Event) => showTip(e as MouseEvent, el('div', {}, el('strong', {}, fmt(v)), ` views, ${names[i]} ${String(h).padStart(2, '0')}:00`)), pointerleave: hideTip, focus: (e: Event) => showTip(e as FocusEvent, text), blur: hideTip },
      });
    }))))));
}

function renderPeople(d: Data) {
  const visits = d.returning + d.fresh;
  const gapNames: Record<string, string> = { 1: 'A day or less', '2-7': '2–7 days', '8-30': '8–30 days', '31-90': '1–3 months', '91+': 'Over 3 months' };
  const gapOrder = ['1', '2-7', '8-30', '31-90', '91+'];
  const visitOrder = ['1', '2', '3-5', '6-10', '11+'];
  const byOrder = (rows: Row[], order: string[]) => order.map((k) => rows.find((r) => r.key === k) ?? { key: k, value: 0 });
  fill(panel, 
    el('div', { class: 'an-tiles an-tiles--3' },
      tile('First visit', fmt(d.fresh), visits ? `${pct(d.fresh, visits)}% of visits` : ''),
      tile('Returning', fmt(d.returning), visits ? `${pct(d.returning, visits)}% of visits` : ''),
      tile('Pages per visit', d.pagesPerVisit ? String(d.pagesPerVisit) : '–')),
    el('div', { class: 'an-two' },
      card('How long since their last visit', 'Reported by the reader\'s own browser as a rough range. No visitor can be followed.', visits ? bars(byOrder(d.gaps, gapOrder).map((g) => ({ key: g.key, value: g.value, label: gapNames[g.key] }))) : emptyNote('Counted from when this page goes live.')),
      card('How many visits so far', null, visits ? bars(byOrder(d.visitCounts, visitOrder).map((g) => ({ key: g.key, value: g.value, label: `${g.key} ${g.key === '1' ? 'visit' : 'visits'}` }))) : emptyNote('Counted from when this page goes live.'))),
    card('When they read', null, hourGrid(d)),
    el('div', { class: 'an-three' },
      card('Device', null, bars(d.devices)),
      card('Browser', null, bars(d.browsers)),
      card('System', null, bars(d.systems)),
      card('Time by screen', 'Average active time on a page.', bars(d.widths.map((w) => ({ key: w.key, value: w.avgSecs, label: w.key[0].toUpperCase() + w.key.slice(1), sub: `${fmt(w.value)} views` })), { unit: ' sec' })),
      card('Screen size', null, bars(d.screens)),
      card('Language', null, bars(d.languages.map((l) => ({ key: l.key, value: l.value, label: langName(l.key) })))),
      card('Light or dark', 'What the reader\'s device prefers.', bars(d.colorScheme.map((c) => ({ ...c, label: c.key === 'dark' ? 'Dark' : 'Light' })))),
    ),
  );
}

// ---- search and speed ----------------------------------------------------------

function renderSearch(d: Data) {
  const sum = (m: 'lcp' | 'cls' | 'inp') => d.pages.reduce((s, p) => ({ g: s.g + p.speed[m].g, o: s.o + p.speed[m].o, p: s.p + p.speed[m].p }), { g: 0, o: 0, p: 0 });
  const metric = (name: string, about: string, m: 'lcp' | 'cls' | 'inp') => {
    const t = sum(m);
    const total = t.g + t.o + t.p;
    return el('div', { class: 'an-speed' },
      el('div', { class: 'an-speed__head' }, el('strong', {}, name), el('span', { class: 'an-note' }, about)),
      total
        ? el('div', {},
          el('div', { class: 'an-speed__bar', role: 'img', 'aria-label': `${pct(t.g, total)}% good, ${pct(t.o, total)}% needs work, ${pct(t.p, total)}% poor` },
            el('span', { class: 'is-good', style: `flex-grow:${t.g}` }), el('span', { class: 'is-ok', style: `flex-grow:${t.o}` }), el('span', { class: 'is-poor', style: `flex-grow:${t.p}` })),
          el('div', { class: 'an-speed__key mono' }, `✓ ${pct(t.g, total)}% good`, ' · ', `~ ${pct(t.o, total)}% needs work`, ' · ', `! ${pct(t.p, total)}% poor`))
        : emptyNote('Counted from when this page goes live.'));
  };
  const slow = d.pages
    .map((p) => { const t = p.speed.lcp.g + p.speed.lcp.o + p.speed.lcp.p; return { p, t, poor: pct(p.speed.lcp.p, t) }; })
    .filter((x) => x.t >= 3 && x.poor > 0)
    .sort((a, b) => b.poor - a.poor || b.t - a.t)
    .slice(0, 10);
  fill(panel, 
    el('div', { class: 'an-two' },
      card('What they search for', 'Words typed into the site\'s search. Ones marked "no results" are things readers wanted and didn\'t find.',
        d.searches.length
          ? el('table', { class: 'an-table' }, el('thead', {}, el('tr', {}, el('th', {}, 'Search'), el('th', {}, 'Times'), el('th', {}, 'No results'))),
            el('tbody', {}, ...d.searches.map((s) => el('tr', {}, el('td', { class: 'an-left' }, s.q), el('td', { class: 'mono' }, fmt(s.value)), el('td', { class: 'mono' }, s.zero ? fmt(s.zero) : '–')))))
          : emptyNote('Counted from when this page goes live.')),
      card('How fast it feels', 'Measured in readers\' real browsers.',
        metric('Loading', 'time until the main content shows', 'lcp'),
        metric('Responding', 'delay after a tap or click', 'inp'),
        metric('Stability', 'how much the page jumps around', 'cls'),
        el('h4', { class: 'an-h4 mono' }, 'Slowest pages'),
        bars(slow.map((x) => ({ key: x.p.path, value: x.poor, label: titleOf(x.p.path), sub: `${x.t} visits measured` })), { unit: '% slow', onPick: openPage, empty: 'None so far.' }))),
  );
}

// ---- Vercel's numbers ----------------------------------------------------------

async function renderVercel(d: Data) {
  const host = el('div', {}, emptyNote('Asking Vercel…'));
  fill(panel, host);
  const res = await fetch(`/api/admin/analytics?days=${state.days}&vercel=1`);
  const v = await res.json();
  if (!host.isConnected) return;
  if (v.status === 'not-connected') {
    host.replaceChildren(card('Vercel isn\'t connected yet', 'Everything else on this page comes from the site\'s own counter and works without this.',
      el('ol', { class: 'an-steps' },
        el('li', {}, 'In the Vercel dashboard, open the cleatus-wv project, then Analytics, and turn on Web Analytics if it\'s off.'),
        el('li', {}, 'In Vercel account settings, create a token with an expiry date, for the team that holds this project. It can reach every project there, so name it for this and don\'t reuse it.'),
        el('li', {}, 'In the project\'s environment variables, add it as VERCEL_ANALYTICS_TOKEN for Production, then redeploy.')),
    ));
    return;
  }
  if (v.status === 'not-found') {
    host.replaceChildren(card('Vercel answered "not found"', 'The token was read and Vercel replied, but it found no analytics to give back. Everything else on this page still works.',
      el('ol', { class: 'an-steps' },
        el('li', {}, 'If Web Analytics was only just turned on, look again in a little while.'),
        el('li', {}, 'Check that the token\'s scope is the team that holds cleatus-wv, not only your personal account. If it isn\'t, replace the token and redeploy.'),
        el('li', {}, 'Check that the project\'s Analytics page in Vercel shows views.')),
    ));
    return;
  }
  if (v.status === 'failed') { host.replaceChildren(card('Couldn\'t read Vercel\'s numbers', v.message)); return; }
  // Vercel only knows the days since it was turned on, so compare those days and no others.
  const counted = (v.series as { day: string; views: number; visitors: number }[]).filter((x) => x.views > 0);
  if (!counted.length) {
    host.replaceChildren(card('Vercel has no views to show yet', `Vercel answered, but has nothing for the last ${v.days} days. New views can take a little while to appear.`));
    return;
  }
  const first = counted[0].day;
  const theirs = counted.reduce((s, x) => s + x.views, 0);
  const ours = d.days.filter((x) => x.day >= first).reduce((s, x) => s + x.views, 0);
  refill(host,
    el('div', { class: 'an-tiles an-tiles--3' },
      tile('Vercel\'s views', fmt(theirs), `since ${dayLabel(first)}`),
      tile('Vercel\'s visitors', fmt(counted.reduce((s, x) => s + x.visitors, 0)), 'added up by day'),
      tile('This site, same days', fmt(ours), `${pct(Math.abs(theirs - ours), theirs)}% apart; the two treat bots and blockers differently`)),
    state.days > v.days ? el('p', { class: 'an-note' }, `Vercel's numbers cover the last ${v.days} days at most, because its free plan keeps one month.`) : null,
    el('div', { class: 'an-three' },
      card('Pages', null, bars(pageRows(v.pages))),
      card('Countries', null, bars((v.countries as Row[]).map((c) => ({ ...c, label: countryName(c.key) })))),
      card('Referrers', null, bars(v.referrers)),
      card('Browsers', null, bars(v.browsers)),
      card('Systems', null, bars(v.systems)),
      card('Devices', null, bars(v.devices))),
  );
}

// ---- wiring --------------------------------------------------------------------

async function draw() {
  writeHash();
  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  root.querySelectorAll<HTMLButtonElement>('[data-days]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.days) === state.days)));
  hideTip();
  if (!data) return;
  if (state.tab !== 'where' && map) { map.remove(); map = null; }
  panel.replaceChildren();
  const d = data;
  try {
    if (state.tab === 'overview') renderOverview(d);
    if (state.tab === 'where') await renderWhere(d);
    if (state.tab === 'pages') renderPages(d);
    if (state.tab === 'heat') await renderHeat(d);
    if (state.tab === 'sources') renderSources(d);
    if (state.tab === 'people') renderPeople(d);
    if (state.tab === 'search') renderSearch(d);
    if (state.tab === 'vercel') await renderVercel(d);
  } catch (e) {
    fill(panel, card('Something went wrong drawing this', (e as Error).message));
  }
}

function go(tab: string) {
  state.tab = tab;
  void draw();
}

async function load() {
  panel.replaceChildren(el('p', { class: 'an-empty' }, 'Reading the numbers…'));
  try {
    const res = await fetch(`/api/admin/analytics?days=${state.days}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
    data = json;
  } catch (e) {
    panel.replaceChildren(card('Couldn\'t read the numbers', (e as Error).message));
    return;
  }
  await draw();
}

root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => go(b.dataset.tab!)));
root.querySelectorAll<HTMLButtonElement>('[data-days]').forEach((b) => b.addEventListener('click', () => {
  state.days = Number(b.dataset.days);
  void load();
}));
readHash();
void load();
