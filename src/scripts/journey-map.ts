/**
 * The journey map on a trip page: the route drawn as far as the entry you're
 * reading, the camera following along as you scroll, relief and 3D terrain
 * when it's close enough to see the mountains, and a Play button that walks
 * the whole trip. Enhancement only — the entries read fine without it.
 */
import type { Map as MLMap, Marker, GeoJSONSource } from 'maplibre-gl';
import { addEmojiIcons, addRelief, BASE_STYLE, esc, km, loadMaplibre, reducedMotion, setTerrain, webglOk, whenNear } from './map-kit.ts';

interface Pt {
  slug: string; href: string; title: string; when: string; day: number | null;
  place: string; lat: number; lng: number; kinds: string[]; elevationFt: number | null;
}
interface Cfg { points: Pt[]; icons: Record<string, string>; live: boolean; tripTitle: string }

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
  addRelief(map);

  addEmojiIcons(map, Object.fromEntries(Object.entries(cfg.icons).map(([k, v]) => [`k-${k}`, v])));
  addEmojiIcons(map, { 'k-none': '•' });

  const line = (n: number) => ({
    type: 'Feature' as const, properties: {},
    geometry: { type: 'LineString' as const, coordinates: coords.slice(0, Math.max(1, n)) },
  });
  map.addSource('route', { type: 'geojson', data: line(coords.length) });
  map.addSource('progress', { type: 'geojson', data: line(1) });
  map.addSource('stops', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: pts.map((p, i) => ({
        type: 'Feature', id: i, properties: { i, kind: p.kinds[0] ?? 'none' },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    },
  });
  map.addLayer({
    id: 'route', type: 'line', source: 'route',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#7fd8e8', 'line-opacity': 0.35, 'line-width': 1.5, 'line-dasharray': [2, 2] },
  });
  map.addLayer({
    id: 'progress', type: 'line', source: 'progress',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#ffc24b', 'line-width': 3, 'line-opacity': 0.95 },
  });
  map.addLayer({
    id: 'stops', type: 'symbol', source: 'stops',
    layout: { 'icon-image': ['concat', 'k-', ['get', 'kind']], 'icon-allow-overlap': true, 'icon-size': 0.85, 'symbol-sort-key': ['get', 'i'] },
  });

  // The "you are here" marker: a pulsing headlamp ring.
  const dot = document.createElement('div');
  dot.className = 'jm-here';
  const here: Marker = new ml.Marker({ element: dot }).setLngLat(coords[0]).addTo(map);

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
    active = i;
    const p = pts[i];
    (map.getSource('progress') as GeoJSONSource).setData(line(i + 1));
    here.setLngLat(coords[i]);
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

  // A stop on the map jumps the story to its entry.
  map.on('click', 'stops', (e) => {
    const i = e.features![0].properties!.i as number;
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
