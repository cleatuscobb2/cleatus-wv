/**
 * /map/ — the interactive globe. Enhancement only: the page already shows the
 * static SVG map and the timeline; this swaps the SVG for a spinning globe with
 * the visited countries named, a marker on every city and place they've been,
 * an icon wherever something happened, a legend that filters them, a country
 * panel, a guided tour, and timeline hovers that fly the globe to the trip.
 */
import type { Map as MLMap, GeoJSONSource, LngLatBoundsLike } from 'maplibre-gl';
import { openLightbox, plainClick } from './lightbox.ts';
import { addEmojiIcons, addRelief, tintWater, BASE_STYLE, esc, firstSymbolLayer, loadMaplibre, reducedMotion, webglOk } from './map-kit.ts';

interface Country {
  code: string; name: string; state: 'written' | 'been'; years: string;
  trips: { id: string; title: string; year: number }[];
  kinds: Record<string, number>; heart: [number, number]; box: [number, number, number, number];
}
interface Ev { lng: number; lat: number; kinds: string[]; title: string; href: string | null; when: string; place: string; trip: string }
interface TripOut { id: string; title: string; shortTitle: string; year: number; countries: string[]; box: number[] | null; route: [number, number][] }
interface Place {
  name: string; country: string; countryName: string; lat: number; lng: number; n: number; years: string;
  entries: { title: string; href: string; date: string; trip: string }[]; note?: string;
}
interface Photo {
  lat: number; lng: number; author: string; caption: string; when: string; place: string;
  trip: { id: string; title: string } | null;
  media: { src: string; poster?: string; video?: boolean }[];
}
interface Data { countries: GeoJSON.FeatureCollection; states: GeoJSON.FeatureCollection; events: Ev[]; places: Place[]; photos: Photo[]; trips: TripOut[] }

/*
 * Home view: Europe, Africa and Asia facing you, the globe filling ~94% of the
 * stage's shorter side. MapLibre draws the globe with radius
 * 512·2^zoom / (2π·cos lat) px and the camera's perspective shows less than
 * that (LIMB, about 0.75 on a landscape screen), which gives a first guess;
 * settleHome() then measures the globe actually drawn and corrects, because
 * the perspective differs on a tall phone screen.
 */
const HOME: [number, number] = [45, 28];
const FILL = 0.94;
const LIMB = 0.75;
/** The globe's drawn diameter in px: walk out from the centre until a point no longer round-trips. */
function drawnDiameter(map: MLMap, el: HTMLElement) {
  const cx = el.clientWidth / 2;
  const cy = el.clientHeight / 2;
  let x = cx;
  while (x < cx + el.clientWidth) {
    const back = map.project(map.unproject([x, cy]));
    if (Math.abs(back.x - x) > 1.5) break;
    x += 1;
  }
  return 2 * (x - cx);
}

/** Correct the first-guess zoom against the measured globe; returns the home zoom. */
function settleHome(map: MLMap, el: HTMLElement) {
  const want = Math.min(el.clientHeight, el.clientWidth) * FILL;
  for (let i = 0; i < 3; i++) {
    const got = drawnDiameter(map, el);
    if (!got || Math.abs(got - want) < 4) break;
    map.jumpTo({ zoom: map.getZoom() + Math.log2(want / got) });
  }
  return map.getZoom();
}

const homeZoom = (el: HTMLElement) => {
  const d = Math.min(el.clientHeight, el.clientWidth) * FILL;
  return Math.log2((d / LIMB) * Math.PI * Math.cos((HOME[1] * Math.PI) / 180) / 512);
};

const stage = document.querySelector<HTMLElement>('[data-globe]');
if (stage && webglOk()) start(stage).catch((err) => {
  console.warn('globe unavailable, keeping the static map', err);
  stage.removeAttribute('data-live');
});

async function start(stage: HTMLElement) {
  const el = stage.querySelector<HTMLElement>('[data-globe-map]')!;
  const cfg = JSON.parse(stage.querySelector('#globe-config')!.textContent!) as {
    icons: Record<string, string>; labels: Record<string, string>; order: string[]; defaultOff: string[];
  };
  const [ml, data] = await Promise.all([
    loadMaplibre(),
    fetch('/map-data.json').then((r) => r.json() as Promise<Data>),
  ]);

  stage.setAttribute('data-live', '');
  const map: MLMap = new ml.Map({
    container: el,
    style: BASE_STYLE,
    center: HOME,
    zoom: homeZoom(el),
    attributionControl: { compact: true },
    maxPitch: 70,
  });
  map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new ml.FullscreenControl({ container: stage }), 'top-right');
  document.querySelector('[data-map-wrap]')?.setAttribute('data-globe-live', '');

  let homeZ = homeZoom(el);
  if (import.meta.env.DEV) (window as unknown as { __globe: MLMap }).__globe = map;
  await new Promise<void>((ok) => map.once('load', () => ok()));
  map.setProjection({ type: 'globe' });
  homeZ = settleHome(map, el);
  tintWater(map);
  addRelief(map);
  const below = firstSymbolLayer(map);
  const byCode = new Map(data.countries.features.map((f) => [f.properties!.code as string, f.properties as unknown as Country]));

  // --- countries -----------------------------------------------------------------
  map.addSource('cc', { type: 'geojson', data: data.countries, promoteId: 'code' });
  const fill = ['match', ['get', 'state'], 'written', '#7fd8e8', '#3a8f9c'];
  map.addLayer({
    id: 'cc-fill', type: 'fill', source: 'cc', filter: ['==', ['geometry-type'], 'Polygon'],
    paint: {
      'fill-color': ['case', ['boolean', ['feature-state', 'lit'], false], '#ffc24b', fill] as never,
      'fill-opacity': ['case', ['boolean', ['feature-state', 'lit'], false], 0.75, ['boolean', ['feature-state', 'hover'], false], 0.7, 0.45] as never,
    },
  }, below);
  map.addLayer({
    id: 'cc-line', type: 'line', source: 'cc', filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'line-color': fill as never, 'line-width': 0.8, 'line-opacity': 0.9 },
  }, below);
  map.addLayer({
    id: 'cc-dot', type: 'circle', source: 'cc', filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 5,
      'circle-color': ['case', ['boolean', ['feature-state', 'lit'], false], '#ffc24b', fill] as never,
      'circle-stroke-color': '#0a0e13', 'circle-stroke-width': 1,
    },
  }, below);

  // --- US states they've been to: home isn't among the countries, so it's by state ------
  map.addSource('st', { type: 'geojson', data: data.states, promoteId: 'code' });
  map.addLayer({
    id: 'st-fill', type: 'fill', source: 'st',
    paint: {
      'fill-color': '#3a8f9c',
      'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.7, 0.45] as never,
    },
  }, below);
  map.addLayer({
    id: 'st-line', type: 'line', source: 'st',
    paint: { 'line-color': '#7fd8e8', 'line-width': 0.6, 'line-opacity': 0.55 },
  }, below);
  stage.querySelector('[data-states-n]')!.textContent = `${data.states.features.length} of 50`;

  // --- trip routes, faint, so the events read as journeys ------------------------------
  map.addSource('routes', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: data.trips.filter((t) => t.route.length > 1).map((t) => ({
        type: 'Feature', properties: { id: t.id }, geometry: { type: 'LineString', coordinates: t.route },
      })),
    },
    promoteId: 'id',
  });
  map.addLayer({
    id: 'routes', type: 'line', source: 'routes',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'lit'], false], '#ffc24b', '#7fd8e8'] as never,
      'line-opacity': ['case', ['boolean', ['feature-state', 'lit'], false], 0.95, 0.28] as never,
      'line-width': ['case', ['boolean', ['feature-state', 'lit'], false], 2.5, 1.2] as never,
    },
  });

  // --- country names: the visited ones, in the site's teal, over the basemap's grey ---------
  for (const id of ['place_country_major', 'place_country_minor', 'place_country_other']) {
    if (map.getLayer(id)) map.setPaintProperty(id, 'text-opacity', 0.45);
  }
  map.addSource('cc-names', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: data.countries.features.map((f) => ({
        type: 'Feature' as const,
        properties: { code: f.properties!.code, name: f.properties!.name, state: f.properties!.state },
        geometry: { type: 'Point' as const, coordinates: f.properties!.heart as [number, number] },
      })),
    },
  });
  map.addLayer({
    id: 'cc-name', type: 'symbol', source: 'cc-names', maxzoom: 5.2,
    layout: {
      'text-field': ['upcase', ['get', 'name']],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 1, 9, 4, 13],
      'text-letter-spacing': 0.12,
      'text-max-width': 7,
      'symbol-sort-key': ['match', ['get', 'state'], 'written', 0, 1],
    },
    paint: {
      'text-color': ['match', ['get', 'state'], 'written', '#a9e9f2', '#7fc4cc'],
      'text-halo-color': '#081626', 'text-halo-width': 1.4,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], 4.4, 1, 5.2, 0],
    },
  });

  // --- cities and places: a dot for each, named once you're close enough to read them ----------
  stage.querySelector('[data-places-n]')!.textContent = String(data.places.length);
  map.addSource('places', {
    type: 'geojson',
    data: {
      type: 'FeatureCollection',
      features: data.places.map((p, i) => ({
        type: 'Feature' as const, id: i,
        properties: { i, name: p.name, n: p.n },
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      })),
    },
  });
  map.addLayer({
    id: 'pl-dot', type: 'circle', source: 'places',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['case', ['>=', ['get', 'n'], 3], 2.6, 1.8], 6, ['case', ['>=', ['get', 'n'], 3], 5, 4]] as never,
      // White where they've written from; yellow where they've been but haven't yet.
      'circle-color': ['case', ['>', ['get', 'n'], 0], '#f4fbfc', '#ffc24b'] as never,
      'circle-stroke-color': '#0a0e13',
      'circle-stroke-width': 1,
    },
  });
  map.addLayer({
    id: 'pl-label', type: 'symbol', source: 'places', minzoom: 2.2,
    layout: {
      // The places with the most entries are named first; the rest join in closer up.
      'text-field': ['step', ['zoom'], ['case', ['>=', ['get', 'n'], 4], ['get', 'name'], ''], 3.4, ['get', 'name']] as never,
      'text-font': ['case', ['>=', ['get', 'n'], 3], ['literal', ['Noto Sans Bold']], ['literal', ['Noto Sans Regular']]] as never,
      'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 7, 13],
      'text-variable-anchor': ['left', 'right', 'top', 'bottom'],
      // Far enough out to clear an event icon or cluster badge on the same spot.
      'text-radial-offset': 1.35,
      'text-justify': 'auto',
      'text-max-width': 9,
      'symbol-sort-key': ['-', 0, ['get', 'n']] as never,
    },
    paint: { 'text-color': '#eef7f8', 'text-halo-color': '#081626', 'text-halo-width': 1.5 },
  });

  // --- Instagram posts, under the events so a photo never hides a story -------------------
  addEmojiIcons(map, { 'ig-photo': '📷' }, '#ff8fb8');
  map.addSource('ig', {
    type: 'geojson', cluster: true, clusterRadius: 30, clusterMaxZoom: 11,
    data: {
      type: 'FeatureCollection',
      features: data.photos.map((p, i) => ({
        type: 'Feature' as const, properties: { i }, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
      })),
    },
  });
  map.addLayer({
    id: 'ig-cluster', type: 'circle', source: 'ig', filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#12161c', 'circle-stroke-color': '#ff8fb8', 'circle-stroke-width': 2,
      'circle-radius': ['step', ['get', 'point_count'], 12, 8, 15, 25, 18],
    },
  });
  map.addLayer({
    id: 'ig-count', type: 'symbol', source: 'ig', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true },
    paint: { 'text-color': '#ff8fb8' },
  });
  map.addLayer({
    id: 'ig-icon', type: 'symbol', source: 'ig', filter: ['!', ['has', 'point_count']],
    layout: { 'icon-image': 'ig-photo', 'icon-size': 0.5, 'icon-allow-overlap': true },
  });
  const igRow = stage.querySelector<HTMLElement>('[data-ig-row]');
  if (igRow) igRow.hidden = !data.photos.length;
  stage.querySelector('[data-ig-n]')!.textContent = String(data.photos.length);

  // --- events ----------------------------------------------------------------------------
  addEmojiIcons(map, Object.fromEntries(Object.entries(cfg.icons).map(([k, v]) => [`k-${k}`, v])));
  const enabled = new Set(cfg.order.filter((k) => !cfg.defaultOff.includes(k)));
  const evFeatures = () => ({
    type: 'FeatureCollection' as const,
    features: data.events.flatMap((e, i) => {
      const k = cfg.order.find((x) => e.kinds.includes(x) && enabled.has(x));
      return k ? [{ type: 'Feature' as const, id: i, properties: { i, kind: k }, geometry: { type: 'Point' as const, coordinates: [e.lng, e.lat] } }] : [];
    }),
  });
  map.addSource('ev', { type: 'geojson', data: evFeatures(), cluster: true, clusterRadius: 38, clusterMaxZoom: 9 });
  map.addLayer({
    id: 'ev-cluster', type: 'circle', source: 'ev', filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#12161c', 'circle-stroke-color': '#ffc24b', 'circle-stroke-width': 2,
      'circle-radius': ['step', ['get', 'point_count'], 13, 8, 16, 25, 20],
    },
  });
  map.addLayer({
    id: 'ev-count', type: 'symbol', source: 'ev', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
    paint: { 'text-color': '#ffc24b' },
  });
  map.addLayer({
    id: 'ev-icon', type: 'symbol', source: 'ev', filter: ['!', ['has', 'point_count']],
    layout: { 'icon-image': ['concat', 'k-', ['get', 'kind']], 'icon-size': 1, 'icon-allow-overlap': true },
  });
  // Place names over the icons, so a badge never hides the name beside it.
  map.moveLayer('pl-label');

  // --- interaction -------------------------------------------------------------------------
  const panel = stage.querySelector<HTMLElement>('[data-globe-panel]')!;
  const caption = stage.querySelector<HTMLElement>('[data-globe-caption]')!;
  const popup = new ml.Popup({ closeButton: false, maxWidth: '280px', offset: 18, className: 'globe-pop' });

  let spinning = !reducedMotion();
  const stopSpin = () => { spinning = false; };
  const spin = () => {
    if (!spinning || map.isMoving() || map.getZoom() > homeZ + 0.3) return;
    const c = map.getCenter();
    map.easeTo({ center: [c.lng + 4, c.lat], duration: 1000, easing: (t) => t });
  };
  map.on('moveend', spin);
  for (const ev of ['mousedown', 'touchstart', 'wheel', 'dragstart'] as const) map.on(ev, stopSpin);
  // Hold the home view a moment — Europe, Africa and Asia — before it starts to turn.
  setTimeout(spin, 4000);

  let hovered: string | null = null;
  map.on('mousemove', 'cc-fill', (e) => {
    const id = e.features?.[0]?.properties?.code as string | undefined;
    if (hovered && hovered !== id) map.setFeatureState({ source: 'cc', id: hovered }, { hover: false });
    if (id) { hovered = id; map.setFeatureState({ source: 'cc', id }, { hover: true }); }
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'cc-fill', () => {
    if (hovered) map.setFeatureState({ source: 'cc', id: hovered }, { hover: false });
    hovered = null;
    map.getCanvas().style.cursor = '';
  });

  const showCountry = (code: string) => {
    const c = byCode.get(code);
    if (!c) return;
    const kinds = typeof c.kinds === 'string' ? JSON.parse(c.kinds) : c.kinds;
    const trips = typeof c.trips === 'string' ? JSON.parse(c.trips) : c.trips;
    const k = cfg.order.filter((x) => kinds[x]);
    panel.innerHTML = `
      <button class="gp__close" type="button" aria-label="Close">×</button>
      <p class="gp__kicker">${c.state === 'written' ? 'Written up' : 'Been, no entries yet'}</p>
      <h2 class="gp__name">${esc(c.name)}</h2>
      ${c.years ? `<p class="gp__years">${esc(c.years)}</p>` : ''}
      ${k.length ? `<ul class="gp__kinds">${k.map((x) => `<li><span aria-hidden="true">${cfg.icons[x]}</span> ${esc(cfg.labels[x])} <b>${kinds[x]}</b></li>`).join('')}</ul>` : ''}
      ${trips.length ? `<ul class="gp__trips">${trips.map((t: TripOut) => `<li><a href="/${t.id}/">${esc(t.title)}</a> <span>${t.year}</span></li>`).join('')}</ul>
        <a class="gp__more" href="/places/${code.toLowerCase()}/">Every entry from ${esc(c.name)} →</a>` : ''}`;
    panel.hidden = false;
    panel.querySelector('.gp__close')!.addEventListener('click', () => { panel.hidden = true; });
  };
  const onCountry = (e: { point: { x: number; y: number }; features?: { properties: Record<string, unknown> }[] }) => {
    stopSpin();
    // An icon or cluster on top of the country gets the click, not the country.
    if (map.queryRenderedFeatures([e.point.x, e.point.y], { layers: ['ev-icon', 'ev-cluster', 'ig-icon', 'ig-cluster', 'pl-dot', 'pl-label'] }).length) return;
    const code = e.features?.[0]?.properties?.code as string | undefined;
    if (code) showCountry(code);
  };
  map.on('click', 'cc-fill', onCountry);
  map.on('click', 'cc-dot', onCountry);

  let stHovered: string | null = null;
  map.on('mousemove', 'st-fill', (e) => {
    const id = e.features?.[0]?.properties?.code as string | undefined;
    if (stHovered && stHovered !== id) map.setFeatureState({ source: 'st', id: stHovered }, { hover: false });
    if (id) { stHovered = id; map.setFeatureState({ source: 'st', id }, { hover: true }); }
    map.getCanvas().style.cursor = 'pointer';
  });
  map.on('mouseleave', 'st-fill', () => {
    if (stHovered) map.setFeatureState({ source: 'st', id: stHovered }, { hover: false });
    stHovered = null;
    map.getCanvas().style.cursor = '';
  });
  map.on('click', 'st-fill', (e) => {
    stopSpin();
    if (map.queryRenderedFeatures([e.point.x, e.point.y], { layers: ['ev-icon', 'ev-cluster', 'ig-icon', 'ig-cluster', 'pl-dot', 'pl-label'] }).length) return;
    const name = e.features?.[0]?.properties?.name as string | undefined;
    if (!name) return;
    popup
      .setLngLat(e.lngLat)
      .setHTML(`<p class="gpop__title">${esc(name)}</p><p class="gpop__meta">One of the ${data.states.features.length} US states they've been to</p>`)
      .addTo(map);
  });

  map.on('click', 'ev-cluster', async (e) => {
    stopSpin();
    const f = e.features![0];
    const z = await (map.getSource('ev') as GeoJSONSource).getClusterExpansionZoom(f.properties!.cluster_id);
    map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z + 0.3 });
  });
  map.on('click', 'ev-icon', (e) => {
    stopSpin();
    const ev = data.events[e.features![0].properties!.i as number];
    const icons = ev.kinds.map((k) => cfg.icons[k]).join(' ');
    popup
      .setLngLat([ev.lng, ev.lat])
      .setHTML(`<p class="gpop__icons">${icons}</p><p class="gpop__title">${ev.href ? `<a href="${ev.href}">${esc(ev.title)}</a>` : esc(ev.title)}</p>
        <p class="gpop__meta">${esc([ev.place, ev.when, ev.trip].filter(Boolean).join(' · '))}</p>`)
      .addTo(map);
    // Instagram posts sit under the events: offer any on this same spot.
    const here = photosAt(e.point);
    if (here.length) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gpop__ig';
      b.textContent = `📷 ${here.length} Instagram ${here.length > 1 ? 'posts' : 'post'} here`;
      b.addEventListener('click', () => { popup.remove(); showPhotos(here, [here[0].lng, here[0].lat]); });
      popup.getElement().querySelector('.maplibregl-popup-content')?.append(b);
    }
  });
  // A place: what's written from there, or a note that nothing is yet.
  const onPlace = (e: { point: { x: number; y: number }; features?: { properties: Record<string, unknown> }[] }) => {
    stopSpin();
    if (map.queryRenderedFeatures([e.point.x, e.point.y], { layers: ['ev-icon', 'ev-cluster', 'ig-icon', 'ig-cluster'] }).length) return;
    const p = data.places[e.features![0].properties!.i as number];
    const SHOW = 5;
    const list = p.entries.slice(0, SHOW).map((x) =>
      `<li><a href="${x.href}">${esc(x.title)}</a><span>${esc(x.trip)}</span></li>`).join('');
    const more = p.entries.length > SHOW
      ? `<p class="gpop__more"><a href="/places/${p.country.toLowerCase()}/">${p.entries.length - SHOW} more from ${esc(p.countryName)} →</a></p>` : '';
    const count = p.n ? `${p.n} ${p.n === 1 ? 'entry' : 'entries'}` : 'nothing written from here yet';
    popup
      .setLngLat([p.lng, p.lat])
      .setHTML(`<p class="gpop__title">${esc(p.name)}</p>
        <p class="gpop__meta">${esc([p.countryName, p.years, count].filter(Boolean).join(' · '))}</p>
        ${p.note ? `<p class="gpop__meta">${esc(p.note)}</p>` : ''}
        ${list ? `<ul class="gpop__list">${list}</ul>` : ''}${more}`)
      .addTo(map);
  };
  map.on('click', 'pl-dot', onPlace);
  map.on('click', 'pl-label', onPlace);

  // An Instagram post: its photos and write-up. Posts on the same spot share one popup.
  const igPopup = new ml.Popup({ closeButton: true, maxWidth: '340px', offset: 16, className: 'globe-pop globe-pop--ig' });
  function photosAt(pt: { x: number; y: number }) {
    const near = map.queryRenderedFeatures([[pt.x - 8, pt.y - 8], [pt.x + 8, pt.y + 8]], { layers: ['ig-icon'] });
    const seen = new Set<number>();
    return near.map((f) => f.properties!.i as number).filter((i) => !seen.has(i) && seen.add(i)).map((i) => data.photos[i]);
  }
  const showPhotos = (list: Photo[], at: [number, number]) => {
    const slides = list.flatMap((post) => post.media.map((m) => ({ post, m })));
    let n = 0;
    const root = document.createElement('div');
    root.className = 'igp';
    const draw = () => {
      const { post, m } = slides[n];
      const meta = [post.when, post.place, post.author].filter(Boolean).join(' · ');
      root.innerHTML = `<div class="igp__media">${m.video
        ? `<video src="${esc(m.src)}" poster="${esc(m.poster ?? '')}" controls playsinline preload="metadata"></video>`
        : `<a href="${esc(m.src)}" aria-label="Enlarge photo"><img src="${esc(m.src)}" alt="" /></a>`}</div>
        ${slides.length > 1 ? `<div class="igp__nav"><button type="button" data-d="-1" aria-label="Previous">‹</button><span class="mono">${n + 1} / ${slides.length}</span><button type="button" data-d="1" aria-label="Next">›</button></div>` : ''}
        ${post.caption ? `<p class="igp__caption">${esc(post.caption)}</p>` : ''}
        <p class="gpop__meta">${esc(meta)}</p>
        ${post.trip ? `<p class="gpop__more"><a href="/${esc(post.trip.id)}/">${esc(post.trip.title)} →</a></p>` : ''}`;
      // Enlarge in place, with the rest of this post's photos a swipe away.
      root.querySelector<HTMLAnchorElement>('.igp__media a')?.addEventListener('click', (e) => {
        if (!plainClick(e)) return;
        e.preventDefault();
        const photos = post.media.filter((x) => !x.video);
        openLightbox(photos.map((x) => ({ src: x.src, caption: post.caption, meta })), photos.indexOf(m));
      });
      root.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => b.addEventListener('click', () => {
        n = (n + Number(b.dataset.d) + slides.length) % slides.length;
        draw();
      }));
    };
    draw();
    // Bring the spot up the screen, so the photo opening below it clears the legend.
    map.easeTo({ center: at, offset: [0, -map.getContainer().clientHeight * 0.24], duration: reducedMotion() ? 0 : 400 });
    igPopup.setLngLat(at).setDOMContent(root).addTo(map);
  };
  map.on('click', 'ig-icon', (e) => {
    stopSpin();
    if (map.queryRenderedFeatures([e.point.x, e.point.y], { layers: ['ev-icon', 'ev-cluster'] }).length) return;
    const list = photosAt(e.point);
    if (list.length) showPhotos(list, [list[0].lng, list[0].lat]);
  });
  map.on('click', 'ig-cluster', async (e) => {
    stopSpin();
    if (map.queryRenderedFeatures([e.point.x, e.point.y], { layers: ['ev-icon', 'ev-cluster'] }).length) return;
    const f = e.features![0];
    const z = await (map.getSource('ig') as GeoJSONSource).getClusterExpansionZoom(f.properties!.cluster_id);
    map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom: z + 0.3 });
  });

  for (const l of ['ev-icon', 'ev-cluster', 'ig-icon', 'ig-cluster', 'cc-dot', 'pl-dot', 'pl-label']) {
    map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', l, () => { map.getCanvas().style.cursor = ''; });
  }

  // --- legend toggles ----------------------------------------------------------------------------
  stage.querySelectorAll<HTMLInputElement>('[data-kind-toggle]').forEach((box) => {
    box.checked = enabled.has(box.value);
    box.addEventListener('change', () => {
      if (box.checked) enabled.add(box.value); else enabled.delete(box.value);
      (map.getSource('ev') as GeoJSONSource).setData(evFeatures());
    });
  });
  stage.querySelector('[data-kinds-all]')?.addEventListener('click', () => {
    const allOn = enabled.size === cfg.order.length;
    stage.querySelectorAll<HTMLInputElement>('[data-kind-toggle]').forEach((b) => {
      b.checked = !allOn;
      if (b.checked) enabled.add(b.value); else enabled.delete(b.value);
    });
    (map.getSource('ev') as GeoJSONSource).setData(evFeatures());
  });

  const LAYERS: Record<string, string[]> = { places: ['pl-dot', 'pl-label'], names: ['cc-name'], states: ['st-fill', 'st-line'], instagram: ['ig-cluster', 'ig-count', 'ig-icon'] };
  stage.querySelectorAll<HTMLInputElement>('[data-layer-toggle]').forEach((box) => {
    box.addEventListener('change', () => {
      for (const id of LAYERS[box.value] ?? []) map.setLayoutProperty(id, 'visibility', box.checked ? 'visible' : 'none');
    });
  });

  // --- flying to things --------------------------------------------------------------------------
  let lit: { codes: string[]; route: string | null } = { codes: [], route: null };
  const light = (codes: string[], route: string | null) => {
    for (const c of lit.codes) if (byCode.has(c)) map.setFeatureState({ source: 'cc', id: c }, { lit: false });
    if (lit.route) map.setFeatureState({ source: 'routes', id: lit.route }, { lit: false });
    for (const c of codes) if (byCode.has(c)) map.setFeatureState({ source: 'cc', id: c }, { lit: true });
    if (route) map.setFeatureState({ source: 'routes', id: route }, { lit: true });
    lit = { codes, route };
  };
  const fly = (box: number[] | null, opts: { maxZoom?: number } = {}) => {
    if (!box) return;
    const bounds: LngLatBoundsLike = [[box[0], box[1]], [box[2], box[3]]];
    map.fitBounds(bounds, {
      padding: { top: 90, bottom: 90, left: innerWidth > 900 ? 360 : 40, right: 60 },
      maxZoom: opts.maxZoom ?? 6, duration: reducedMotion() ? 0 : 1600, essential: true,
    });
  };
  const boxOfCodes = (codes: string[]) => {
    const bs = codes.map((c) => byCode.get(c)?.box).filter(Boolean) as number[][];
    if (!bs.length) return null;
    const b = typeof bs[0] === 'string' ? bs.map((x) => JSON.parse(x as unknown as string)) : bs;
    return [Math.min(...b.map((x) => x[0])), Math.min(...b.map((x) => x[1])), Math.max(...b.map((x) => x[2])), Math.max(...b.map((x) => x[3]))];
  };

  // Timeline: a bar flies to its trip, a dot to the countries of that month.
  const wrap = document.querySelector<HTMLElement>('[data-map-wrap]');
  wrap?.querySelectorAll<HTMLElement>('.tl__bar, .tl__visit').forEach((bar) => {
    const go = () => {
      stopSpin();
      const codes = (bar.dataset.countries ?? '').split(',').filter(Boolean);
      const id = bar.matches('.tl__bar') ? bar.getAttribute('href')?.replace(/\//g, '') ?? null : null;
      const trip = id ? data.trips.find((t) => t.id === id) : undefined;
      light(codes, trip && trip.route.length > 1 ? trip.id : null);
      fly(trip?.box ?? boxOfCodes(codes));
      caption.innerHTML = `<b>${esc(bar.dataset.title ?? '')}</b> ${esc(bar.dataset.when ?? '')}`;
      caption.hidden = false;
      if (innerWidth < 900) stage.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    };
    bar.addEventListener('pointerenter', (e) => { if ((e as PointerEvent).pointerType === 'mouse') go(); });
    bar.addEventListener('focus', go);
    // A tap on a dot flies too (bars are links and keep their click).
    if (bar.matches('.tl__visit')) bar.addEventListener('click', go);
  });

  // --- the tour: every trip in order -------------------------------------------------------------
  const tourBtn = stage.querySelector<HTMLButtonElement>('[data-globe-tour]')!;
  let touring = 0;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  tourBtn.addEventListener('click', async () => {
    if (touring) { touring = 0; tourBtn.textContent = '▶ Tour the trips'; return; }
    const run = ++touring;
    stopSpin();
    panel.hidden = true;
    popup.remove();
    tourBtn.textContent = '■ Stop';
    for (const t of data.trips) {
      if (touring !== run) return;
      light(t.countries, t.route.length > 1 ? t.id : null);
      fly(t.box, { maxZoom: 5.5 });
      caption.innerHTML = `<span class="gc__year">${t.year}</span> <a href="/${t.id}/">${esc(t.title)}</a>`;
      caption.hidden = false;
      await wait(reducedMotion() ? 2500 : 3600);
    }
    if (touring === run) {
      touring = 0;
      tourBtn.textContent = '▶ Tour the trips';
      light([], null);
      map.easeTo({ center: HOME, zoom: homeZ, duration: 1500 });
    }
  });

  stage.querySelector('[data-globe-reset]')?.addEventListener('click', () => {
    light([], null);
    caption.hidden = true;
    panel.hidden = true;
    map.easeTo({ center: HOME, zoom: homeZ, pitch: 0, bearing: 0, duration: 1200 });
  });
}
