/**
 * /map/ — the interactive globe. Enhancement only: the page already shows the
 * static SVG map and the timeline; this swaps the SVG for a spinning globe with
 * the visited countries, an icon wherever something happened, a legend that
 * filters them, a country panel, a guided tour, and timeline hovers that fly
 * the globe to the trip.
 */
import type { Map as MLMap, GeoJSONSource, LngLatBoundsLike } from 'maplibre-gl';
import { addEmojiIcons, addRelief, BASE_STYLE, esc, firstSymbolLayer, loadMaplibre, reducedMotion, webglOk } from './map-kit.ts';

interface Country {
  code: string; name: string; state: 'written' | 'been'; years: string;
  trips: { id: string; title: string; year: number }[];
  kinds: Record<string, number>; heart: [number, number]; box: [number, number, number, number];
}
interface Ev { lng: number; lat: number; kinds: string[]; title: string; href: string | null; when: string; place: string; trip: string }
interface TripOut { id: string; title: string; shortTitle: string; year: number; countries: string[]; box: number[] | null; route: [number, number][] }
interface Data { countries: GeoJSON.FeatureCollection; events: Ev[]; trips: TripOut[] }

/** The whole globe in view, as big as the stage allows. */
const homeZoom = () => (innerWidth < 700 ? 0.9 : innerWidth < 1200 ? 1.6 : 2.05);

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
    center: [40, 22],
    zoom: homeZoom(),
    attributionControl: { compact: true },
    maxPitch: 70,
  });
  map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
  map.addControl(new ml.FullscreenControl({ container: stage }), 'top-right');
  document.querySelector('[data-map-wrap]')?.setAttribute('data-globe-live', '');

  await new Promise<void>((ok) => map.once('load', () => ok()));
  map.setProjection({ type: 'globe' });
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

  // --- interaction -------------------------------------------------------------------------
  const panel = stage.querySelector<HTMLElement>('[data-globe-panel]')!;
  const caption = stage.querySelector<HTMLElement>('[data-globe-caption]')!;
  const popup = new ml.Popup({ closeButton: false, maxWidth: '280px', offset: 18, className: 'globe-pop' });

  let spinning = !reducedMotion();
  const stopSpin = () => { spinning = false; };
  const spin = () => {
    if (!spinning || map.isMoving() || map.getZoom() > 2.5) return;
    const c = map.getCenter();
    map.easeTo({ center: [c.lng + 6, c.lat], duration: 1000, easing: (t) => t });
  };
  map.on('moveend', spin);
  for (const ev of ['mousedown', 'touchstart', 'wheel', 'dragstart'] as const) map.on(ev, stopSpin);
  spin();

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
    if (map.queryRenderedFeatures([e.point.x, e.point.y], { layers: ['ev-icon', 'ev-cluster'] }).length) return;
    const code = e.features?.[0]?.properties?.code as string | undefined;
    if (code) showCountry(code);
  };
  map.on('click', 'cc-fill', onCountry);
  map.on('click', 'cc-dot', onCountry);

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
  });
  for (const l of ['ev-icon', 'ev-cluster', 'cc-dot']) {
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
      map.easeTo({ zoom: homeZoom(), duration: 1500 });
    }
  });

  stage.querySelector('[data-globe-reset]')?.addEventListener('click', () => {
    light([], null);
    caption.hidden = true;
    panel.hidden = true;
    map.easeTo({ center: [40, 22], zoom: homeZoom(), pitch: 0, bearing: 0, duration: 1200 });
  });
}
