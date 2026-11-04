/**
 * Shared by the world globe (/map/) and the journey map on each trip page.
 *
 * MapLibre is ~250 KB gzipped, so nothing here imports it statically: callers
 * load it when the map is about to be seen, and a browser without WebGL keeps
 * the static page it already has. Tiles are OpenFreeMap's dark style (free, no
 * key, OSM data); relief is AWS's open Terrarium elevation tiles.
 */
import type { Map as MLMap } from 'maplibre-gl';

export const BASE_STYLE = 'https://tiles.openfreemap.org/styles/dark';
const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export async function loadMaplibre() {
  const [ml, worker] = await Promise.all([
    import('maplibre-gl'),
    // v6 finds its worker beside its own module, which a bundler moves; hand it
    // the emitted file instead. The worker is self-contained, so ?url is enough.
    import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ]);
  ml.setWorkerUrl(new URL(worker.default, location.href).href);
  return ml;
}

/** Load once the element is near the viewport — the library is heavy. */
export function whenNear(el: Element, run: () => void) {
  if (!('IntersectionObserver' in window)) return run();
  const io = new IntersectionObserver((xs) => {
    if (xs.some((x) => x.isIntersecting)) { io.disconnect(); run(); }
  }, { rootMargin: '400px' });
  io.observe(el);
}

/*
 * Water in the site's palette. The dark basemap draws oceans, lakes and rivers
 * a grey just lighter than land; these are a deep navy — bluer (hue ~212°) and
 * darker than the teal country fills (~188°), so a visited coastline never
 * reads as sea. Close up, the satellite imagery takes over anyway.
 */
const WATER = {
  fill: '#102a47', // oceans, seas, lakes
  line: '#1d4a6e', // rivers and canals
  label: '#6f9fc0', // sea and lake names
  halo: '#081626',
};

export function tintWater(map: MLMap) {
  const has = (id: string) => !!map.getLayer(id);
  if (has('water')) map.setPaintProperty('water', 'fill-color', WATER.fill);
  if (has('waterway')) map.setPaintProperty('waterway', 'line-color', WATER.line);
  if (has('water_name')) {
    map.setPaintProperty('water_name', 'text-color', WATER.label);
    map.setPaintProperty('water_name', 'text-halo-color', WATER.halo);
  }
}

/** The first label layer, so fills and routes can go beneath place names. */
export const firstSymbolLayer = (map: MLMap) => map.getStyle().layers.find((l) => l.type === 'symbol')?.id;

/**
 * Satellite imagery that fades in as you zoom past country scale, so a trek
 * close-up shows the actual glaciers, and hillshade from open elevation tiles
 * on top for depth. Imagery: EOX Sentinel-2 cloudless 2020 (CC BY-NC-SA 4.0 —
 * fine for this non-commercial journal, with the credit below).
 */
const SAT_TILES = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg';
const SAT_CREDIT =
  '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless – s2maps.eu</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020)';

export function addRelief(map: MLMap) {
  if (map.getSource('dem')) return;
  const below = firstSymbolLayer(map);
  map.addSource('sat', { type: 'raster', tiles: [SAT_TILES], tileSize: 256, maxzoom: 14, attribution: SAT_CREDIT });
  map.addLayer({
    id: 'sat',
    type: 'raster',
    source: 'sat',
    minzoom: 4.5,
    paint: {
      'raster-opacity': ['interpolate', ['linear'], ['zoom'], 4.5, 0, 7, 0.9],
      'raster-saturation': -0.15,
      'raster-brightness-max': 0.92,
    },
  }, below);
  map.addSource('dem', { type: 'raster-dem', tiles: [DEM_TILES], tileSize: 256, encoding: 'terrarium', maxzoom: 14 });
  map.addLayer({
    id: 'relief',
    type: 'hillshade',
    source: 'dem',
    paint: {
      'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 3, 0.6, 8, 0.35] as never,
      'hillshade-shadow-color': '#05080b',
      'hillshade-highlight-color': '#5b6b79',
      'hillshade-accent-color': '#0b1016',
    },
  }, below);
}

export function setTerrain(map: MLMap, on: boolean) {
  if (!map.getSource('dem')) return;
  map.setTerrain(on ? { source: 'dem', exaggeration: 1.35 } : null);
}

/**
 * Emoji badges as map images: a dark disc with a rime ring and the emoji in
 * the middle. Drawn on a canvas so the symbol layer can use them (map fonts
 * have no emoji). `ring` overrides the ring colour, e.g. headlamp for "now".
 */
export function addEmojiIcons(map: MLMap, icons: Record<string, string>, ring = '#7fd8e8') {
  const S = 64;
  for (const [name, emoji] of Object.entries(icons)) {
    if (map.hasImage(name)) continue;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2);
    g.fillStyle = '#12161c';
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = ring;
    g.stroke();
    g.font = `${S * 0.5}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, S / 2, S / 2 + 2);
    const img = g.getImageData(0, 0, S, S);
    map.addImage(name, { width: S, height: S, data: new Uint8Array(img.data.buffer) }, { pixelRatio: 2 });
  }
}

/** Escape text for the few bits of HTML the popups build. */
export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Great-circle distance in km. */
export function km(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r;
  const dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
