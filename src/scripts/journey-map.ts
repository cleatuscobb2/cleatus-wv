/**
 * The journey map on a trip page: the route drawn as far as the entry you're
 * reading, the camera following along as you scroll, relief and 3D terrain
 * when it's close enough to see the mountains, and a Play button that walks
 * the whole trip. Enhancement only — the entries read fine without it.
 */
import type { Map as MLMap, GeoJSONSource } from 'maplibre-gl';
import { addEmojiIcons, addRelief, tintWater, BASE_STYLE, esc, km, loadMaplibre, reducedMotion, setTerrain, webglOk, whenNear } from './map-kit.ts';

interface Pt {
  slug: string; href: string; title: string; when: string; day: number | null;
  place: string; lat: number; lng: number; kinds: string[]; elevationFt: number | null; distanceMi: number | null;
}
interface Cfg { points: Pt[]; icons: Record<string, string>; live: boolean; tripTitle: string }

/** One place on the map: consecutive entries written from the same spot share it. */
interface Stop { from: number; to: number; at: [number, number]; label: string; place: string; kind: string }

/** "Day 6", "Days 6–7", "18 Aug", "25–28 Aug", "31 Aug – 3 Sep". */
function spanLabel(a: Pt, b: Pt): string {
  if (a.day != null && b.day != null) return a.day === b.day ? `Day ${a.day}` : `Days ${a.day}–${b.day}`;
  if (a.when === b.when) return a.when;
  const [da, ma] = a.when.split(' ');
  const [db, mb] = b.when.split(' ');
  return ma === mb ? `${da}–${db} ${ma}` : `${a.when} – ${b.when}`;
}

function stopsOf(pts: Pt[], coords: [number, number][]): { stops: Stop[]; stopOf: number[] } {
  const stops: Stop[] = [];
  const stopOf: number[] = [];
  pts.forEach((p, i) => {
    const last = stops[stops.length - 1];
    if (last && km(last.at, coords[i]) < 0.5) {
      last.to = i;
      if (last.kind === 'none' && p.kinds[0]) last.kind = p.kinds[0];
      if (p.kinds.includes('cried')) last.kind = 'cried';
    } else {
      stops.push({ from: i, to: i, at: coords[i], label: '', place: p.place, kind: p.kinds[0] ?? 'none' });
    }
    stopOf.push(stops.length - 1);
  });
  for (const s of stops) s.label = spanLabel(pts[s.from], pts[s.to]);
  return { stops, stopOf };
}

/**
 * The words along the line into a stop: the trek day and its miles where the
 * entry logged a leg ("Day 9 · 6 mi"), otherwise the dates either side of a
 * long hop ("23 → 25 Aug"). Short unlogged hops stay unlabelled.
 */
function legLabel(prev: Stop, next: Stop, pts: Pt[]): string {
  const p = pts[next.from];
  if (p.day != null) return p.distanceMi != null ? `Day ${p.day} · ${p.distanceMi} mi` : `Day ${p.day}`;
  if (km(prev.at, next.at) < 150) return '';
  const a = pts[prev.to].when;
  const b = p.when;
  if (a === b) return '';
  const [da, ma] = a.split(' ');
  const [db, mb] = b.split(' ');
  return ma === mb ? `${da} → ${db} ${ma}` : `${a} → ${b}`;
}

const root = document.querySelector<HTMLElement>('[data-journey]');
const box = root?.querySelector<HTMLElement>('[data-journey-map]');
// Watch the section, not the map box: the box stays display:none until the map is live.
if (root && box && webglOk()) whenNear(root, () => start(root, box).catch((e) => {
  console.warn('journey map unavailable', e);
  root.removeAttribute('data-live');
}));

async function start(root: HTMLElement, box: HTMLElement) {
  const cfg = JSON.parse(root.querySelector('#journey-config')!.textContent!) as Cfg;
  const pts = cfg.points;
  const ml = await loadMaplibre();
  const coords = pts.map((p) => [p.lng, p.lat] as [number, number]);
  const bounds = coords.reduce((b, c) => b.extend(c), new ml.LngLatBounds(coords[0], coords[0]));

  // Live first, so the container has a size when the map measures it.
  root.setAttribute('data-live', '');
  const map: MLMap = new ml.Map({
    container: box.querySelector<HTMLElement>('[data-journey-canvas]')!,
    style: BASE_STYLE,
    bounds,
    fitBoundsOptions: { padding: 60 },
    attributionControl: { compact: true },
    maxPitch: 70,
    cooperativeGestures: matchMedia('(pointer: coarse)').matches,
  });
  map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
  await new Promise<void>((ok) => map.once('load', () => ok()));
  map.setProjection({ type: 'globe' });
  tintWater(map);
  addRelief(map);

  addEmojiIcons(map, Object.fromEntries(Object.entries(cfg.icons).map(([k, v]) => [`k-${k}`, v])));
  addEmojiIcons(map, { 'k-none': '•' });

  const line = (n: number) => ({
    type: 'Feature' as const, properties: {},
    geometry: { type: 'LineString' as const, coordinates: coords.slice(0, Math.max(1, n)) },
  });
  map.addSource('route', { type: 'geojson', data: line(coords.length) });
  map.addSource('progress', { type: 'geojson', data: line(1) });
  const { stops, stopOf } = stopsOf(pts, coords);
  map.addSource('stops', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: stops.map((s, i) => ({
        type: 'Feature', id: i, properties: { s: i, kind: s.kind, label: s.label, place: s.place },
        geometry: { type: 'Point', coordinates: s.at },
      })),
    },
  });
  map.addSource('legs', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: stops.slice(1).flatMap((s, i) => {
        const label = legLabel(stops[i], s, pts);
        return label
          ? [{ type: 'Feature' as const, properties: { label }, geometry: { type: 'LineString' as const, coordinates: [stops[i].at, s.at] } }]
          : [];
      }),
    },
  });
  // The stop being read, labelled on top of everything so it never collides away.
  map.addSource('current', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  // Dark casings under both lines, so they read on snow and glacier as well as on the dark map.
  map.addLayer({
    id: 'route-casing', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#05080b', 'line-opacity': 0.45, 'line-width': 4.5 },
  });
  map.addLayer({
    id: 'route', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#7fd8e8', 'line-opacity': 0.75, 'line-width': 2, 'line-dasharray': [2, 1.5] },
  });
  map.addLayer({
    id: 'progress-casing', type: 'line', source: 'progress',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#05080b', 'line-opacity': 0.6, 'line-width': 7 },
  });
  map.addLayer({
    id: 'progress', type: 'line', source: 'progress',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#ffc24b', 'line-width': 3.5, 'line-opacity': 1 },
  });
  const halo = { 'text-halo-color': 'rgba(8, 11, 15, 0.92)', 'text-halo-width': 1.8, 'text-halo-blur': 0.4 };
  map.addLayer({
    id: 'legs', type: 'symbol', source: 'legs',
    layout: {
      'symbol-placement': 'line-center',
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12.5,
      'text-letter-spacing': 0.04,
      'text-keep-upright': true,
      'text-pitch-alignment': 'viewport',
      'text-offset': [0, -0.9],
    },
    paint: { 'text-color': '#ffd98a', ...halo, 'text-halo-width': 2.2 },
  });
  map.addLayer({
    id: 'here', type: 'circle', source: 'current',
    paint: {
      'circle-radius': 17,
      'circle-color': 'rgba(255, 194, 75, 0.18)',
      'circle-stroke-color': '#ffc24b',
      'circle-stroke-width': 3,
      'circle-pitch-alignment': 'viewport',
    },
  });
  map.addLayer({
    id: 'stops', type: 'symbol', source: 'stops',
    layout: {
      'icon-image': ['concat', 'k-', ['get', 'kind']],
      'icon-allow-overlap': true,
      'icon-size': 0.85,
      'symbol-sort-key': ['get', 's'],
      // "Days 6–7" over "Concordia"; the words give way when crowded, the icon never does.
      'text-field': ['format', ['get', 'label'], { 'font-scale': 1 }, '\n', {}, ['get', 'place'], { 'font-scale': 0.85 }],
      'text-font': ['Noto Sans Bold'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 1.35],
      'text-max-width': 11,
      'text-optional': true,
    },
    paint: {
      'text-color': '#edf1f3',
      // The stop being read is labelled by the 'current' layer instead.
      'text-opacity': ['case', ['boolean', ['feature-state', 'active'], false], 0, 1] as never,
      ...halo,
    },
  });
  map.addLayer({
    id: 'current', type: 'symbol', source: 'current',
    layout: {
      'text-field': ['format', ['get', 'label'], { 'font-scale': 1 }, '\n', {}, ['get', 'place'], { 'font-scale': 0.82 }],
      'text-font': ['Noto Sans Bold'],
      'text-size': 15,
      'text-anchor': 'top',
      'text-offset': [0, 1.2],
      'text-max-width': 12,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': '#ffc24b', ...halo, 'text-halo-width': 2.2 },
  });


  const caption = box.querySelector<HTMLElement>('[data-journey-caption]')!;
  const cards = [...document.querySelectorAll<HTMLElement>('[data-point]')];
  let active = -1;

  function zoomFor(i: number) {
    const near = [i - 1, i + 1]
      .filter((j) => j >= 0 && j < pts.length)
      .map((j) => km(coords[i], coords[j]))
      .filter((d) => d > 0.5);
    const d = near.length ? Math.min(...near) : 50;
    return d < 12 ? 11.2 : d < 40 ? 10 : d < 150 ? 8.2 : d < 600 ? 6.2 : d < 2000 ? 4.6 : 3.4;
  }

  function activate(i: number, fly = true) {
    if (i < 0 || i >= pts.length || i === active) return;
    if (active >= 0) map.setFeatureState({ source: 'stops', id: stopOf[active] }, { active: false });
    active = i;
    const p = pts[i];
    const s = stops[stopOf[i]];
    map.setFeatureState({ source: 'stops', id: stopOf[i] }, { active: true });
    (map.getSource('current') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { label: s.label, place: s.place }, geometry: { type: 'Point', coordinates: s.at } }],
    });
    (map.getSource('progress') as GeoJSONSource).setData(line(i + 1));
    const zoom = zoomFor(i);
    const close = zoom >= 9;
    setTerrain(map, close);
    const cam = { center: coords[i], zoom, pitch: close ? 58 : 20, bearing: close ? -20 : 0 };
    if (fly && !reducedMotion()) map.flyTo({ ...cam, duration: 1700, essential: true });
    else map.jumpTo(cam);
    caption.innerHTML = `<span class="jm-cap__meta">${esc([p.day != null ? `Day ${p.day}` : '', p.when, p.place, p.elevationFt ? `${p.elevationFt.toLocaleString('en-US')} ft` : ''].filter(Boolean).join(' · '))}</span>
      <a href="${p.href}">${p.kinds.slice(0, 3).map((k) => cfg.icons[k] ?? '').join('')} ${esc(p.title)}</a>`;
    caption.hidden = false;
    for (const c of cards) c.toggleAttribute('data-active', Number(c.dataset.point) === i);
  }

  function overview() {
    if (active >= 0) map.setFeatureState({ source: 'stops', id: stopOf[active] }, { active: false });
    (map.getSource('current') as GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
    active = -1;
    setTerrain(map, false);
    (map.getSource('progress') as GeoJSONSource).setData(line(coords.length));
    map.fitBounds(bounds, { padding: 60, pitch: 0, bearing: 0, duration: reducedMotion() ? 0 : 1400 });
    caption.hidden = true;
    for (const c of cards) c.removeAttribute('data-active');
  }

  // Scrolling the story moves the map: the card crossing the middle of the screen wins.
  // On a phone the map covers the top 42% of the screen, so the line sits just below it.
  const narrow = matchMedia('(max-width: 960px)').matches;
  /** Bring a card into view: centred beside the map, or just under it on a phone. */
  const show = (card: HTMLElement) =>
    card.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: narrow ? 'start' : 'center' });
  const io = new IntersectionObserver((xs) => {
    for (const x of xs) if (x.isIntersecting) activate(Number((x.target as HTMLElement).dataset.point));
  }, { rootMargin: narrow ? '-50% 0px -46% 0px' : '-45% 0px -50% 0px' });
  cards.forEach((c) => io.observe(c));

  // A stop on the map jumps the story to its (first) entry.
  map.on('click', 'stops', (e) => {
    const i = stops[e.features![0].properties!.s as number].from;
    stopPlay();
    const card = cards.find((c) => Number(c.dataset.point) === i);
    if (card) show(card);
    activate(i);
  });
  map.on('mouseenter', 'stops', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'stops', () => { map.getCanvas().style.cursor = ''; });

  // Play: scroll the story one located entry at a time; the observer does the rest.
  const playBtn = root.querySelector<HTMLButtonElement>('[data-journey-play]')!;
  let playing = 0;
  const stopPlay = () => { playing = 0; playBtn.textContent = '▶ Play the trip'; };
  playBtn.addEventListener('click', async () => {
    if (playing) return stopPlay();
    const run = ++playing;
    playBtn.textContent = '■ Pause';
    const from = active >= pts.length - 1 ? 0 : Math.max(0, active);
    for (let i = from; i < pts.length; i++) {
      if (playing !== run) return;
      const card = cards.find((c) => Number(c.dataset.point) === i);
      if (card) show(card);
      activate(i);
      await new Promise((r) => setTimeout(r, reducedMotion() ? 2200 : 3200));
    }
    if (playing === run) stopPlay();
  });
  for (const ev of ['wheel', 'touchmove', 'keydown'] as const) addEventListener(ev, () => { if (playing) stopPlay(); }, { passive: true });
  root.querySelector('[data-journey-overview]')?.addEventListener('click', () => { stopPlay(); overview(); });

  // A trip still under way opens on where they are now.
  if (cfg.live) activate(pts.length - 1, false);
}
