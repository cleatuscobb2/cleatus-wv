/**
 * Everything the interactive globe on /map/ draws, as one static JSON file the
 * page fetches only once the map is actually starting — so the page itself
 * stays light and still renders without JavaScript.
 *
 *  - countries: the visited ones only, at 50m resolution, rounded to ~1 km
 *  - events:    every located entry (its kinds pick the icon) plus a country-
 *               level dive marker wherever the log says they dived but no
 *               located entry does
 *  - trips:     for the timeline and the tour — where each trip should fly to
 */
import { getCollection } from 'astro:content';
import { feature } from 'topojson-client';
import { geoArea, geoBounds, geoCentroid, geoContains } from 'd3-geo';
import world from 'world-atlas/countries-50m.json';
import { COUNTRY_NAMES, COUNTRY_NUMERIC, POINT_MARKERS } from '../data/trip-meta.ts';
import { beenTo, yearSpans, FLAGS } from '../data/been-to.ts';
import { kindsOf, type Kind } from '../lib/journey.ts';
import { entrySlug, fmtDateShort, tripIdOf, chronological } from '../lib/entries.ts';

type Geom = { type: string; coordinates: unknown };
type Feat = { type: 'Feature'; id?: string; geometry: Geom; properties: Record<string, unknown> };

/** Round to 2 decimals (~1 km) and drop the repeats that leaves behind. */
function slim(c: unknown): unknown {
  if (typeof (c as number[])[0] === 'number') {
    const [x, y] = c as number[];
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
  }
  const arr = (c as unknown[]).map(slim);
  if (Array.isArray(arr[0]) && typeof (arr[0] as number[])[0] === 'number') {
    const out = arr.filter((p, i) => i === 0 || String(p) !== String(arr[i - 1]));
    return out.length >= 4 ? out : arr;
  }
  return arr;
}

/** Centre of the biggest piece — France's, not somewhere between Paris and Guiana. */
function heartOf(g: Geom): [number, number] {
  if (g.type !== 'MultiPolygon') return geoCentroid(g as never) as [number, number];
  const parts = (g.coordinates as unknown[]).map((coordinates) => ({ type: 'Polygon', coordinates }));
  const big = parts.sort((a, b) => geoArea(b as never) - geoArea(a as never))[0];
  return geoCentroid(big as never) as [number, number];
}

/** Bounds of the biggest piece too, unwrapped across the antimeridian (Fiji, Russia). */
function boxOf(g: Geom): [number, number, number, number] {
  let target: Geom = g;
  if (g.type === 'MultiPolygon') {
    const parts = (g.coordinates as unknown[]).map((coordinates) => ({ type: 'Polygon', coordinates }));
    target = parts.sort((a, b) => geoArea(b as never) - geoArea(a as never))[0];
  }
  const [[w, s], [e, n]] = geoBounds(target as never);
  return [w, s, e < w ? e + 360 : e, n];
}

export async function GET() {
  const now = new Date();
  const trips = (await getCollection('trips')).filter((t) => t.data.dateStart <= now);
  const entries = chronological(await getCollection('entries', ({ data }) => !data.draft))
    .filter((e) => trips.some((t) => t.id === tripIdOf(e)));
  const been = beenTo(now);
  const written = new Set(trips.flatMap((t) => t.data.countries));
  const codes = [...new Set([...written, ...Object.keys(been)])];
  const tripsIn = (code: string) => trips.filter((t) => t.data.countries.includes(code));

  const located = entries.filter((e) => e.data.location?.lat != null && e.data.location?.lng != null);
  const tripShort = (id: string) => trips.find((t) => t.id === id)?.data.shortTitle ?? id;

  const events: Record<string, unknown>[] = located.map((e) => ({
    lng: e.data.location!.lng,
    lat: e.data.location!.lat,
    kinds: kindsOf(e),
    title: e.data.title,
    href: `/${tripIdOf(e)}/${entrySlug(e)}/`,
    when: fmtDateShort(e.data.date) + ` ${e.data.date.getUTCFullYear()}`,
    place: e.data.location!.name,
    trip: tripShort(tripIdOf(e)),
  }));

  // --- countries ---------------------------------------------------------------
  const all = (feature(world as never, (world as never as { objects: { countries: unknown } }).objects.countries) as unknown as {
    features: Feat[];
  }).features;
  const byNum = new Map(all.map((f) => [String(f.id), f]));
  const countries: Feat[] = [];
  const hearts: Record<string, [number, number]> = {};
  const boxes: Record<string, [number, number, number, number]> = {};

  for (const code of codes) {
    const f = byNum.get(COUNTRY_NUMERIC[code] ?? '');
    const kinds: Partial<Record<Kind, number>> = {};
    if (f) {
      for (const e of located) {
        if (!geoContains(f as never, [e.data.location!.lng!, e.data.location!.lat!])) continue;
        for (const k of kindsOf(e)) kinds[k] = (kinds[k] ?? 0) + 1;
      }
    }
    const props = {
      code,
      name: COUNTRY_NAMES[code] ?? code,
      state: written.has(code) ? 'written' : 'been',
      years: been[code]?.length ? yearSpans(been[code]) : tripsIn(code).length ? '' : 'date not recorded',
      trips: tripsIn(code).map((t) => ({ id: t.id, title: t.data.shortTitle, year: t.data.year })),
      kinds,
    };
    if (f) {
      hearts[code] = heartOf(f.geometry);
      boxes[code] = boxOf(f.geometry);
      countries.push({ type: 'Feature', geometry: { type: f.geometry.type, coordinates: slim(f.geometry.coordinates) }, properties: { ...props, heart: hearts[code], box: boxes[code] } });
    } else if (POINT_MARKERS[code]) {
      // Too small for the dataset: a point the globe draws as a dot.
      const [x, y] = POINT_MARKERS[code];
      hearts[code] = [x, y];
      boxes[code] = [x - 0.6, y - 0.6, x + 0.6, y + 0.6];
      countries.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: { ...props, heart: hearts[code], box: boxes[code] } });
    }
  }

  // Dived there, per the log, but no located entry says so: one marker per country.
  for (const code of FLAGS.scuba as readonly string[]) {
    if (!codes.includes(code) || !hearts[code]) continue;
    const f = byNum.get(COUNTRY_NUMERIC[code] ?? '');
    const covered = located.some(
      (e) => e.data.tags.includes('diving') && (f ? geoContains(f as never, [e.data.location!.lng!, e.data.location!.lat!]) : false),
    );
    if (covered) continue;
    const ts = tripsIn(code);
    events.push({
      lng: hearts[code][0],
      lat: hearts[code][1],
      kinds: ['diving'],
      title: `Dived in ${COUNTRY_NAMES[code] ?? code}`,
      href: ts.length ? `/places/${code.toLowerCase()}/` : null,
      when: been[code]?.length ? yearSpans(been[code]) : '',
      place: COUNTRY_NAMES[code] ?? code,
      trip: '',
    });
  }

  // --- trips: where the tour and the timeline fly to ----------------------------------
  const tripOut = trips
    .sort((a, b) => +a.data.dateStart - +b.data.dateStart)
    .map((t) => {
      const pts = located.filter((e) => tripIdOf(e) === t.id).map((e) => [e.data.location!.lng!, e.data.location!.lat!] as const);
      const ccBoxes = t.data.countries.map((c) => boxes[c]).filter(Boolean);
      const src = pts.length >= 2
        ? pts.map(([x, y]) => [x, y, x, y] as const)
        : ccBoxes;
      const box = src.length
        ? [Math.min(...src.map((b) => b[0])), Math.min(...src.map((b) => b[1])), Math.max(...src.map((b) => b[2])), Math.max(...src.map((b) => b[3]))]
        : null;
      return {
        id: t.id,
        title: t.data.title,
        shortTitle: t.data.shortTitle,
        year: t.data.year,
        countries: t.data.countries,
        box,
        route: pts,
      };
    });

  return new Response(JSON.stringify({ countries: { type: 'FeatureCollection', features: countries }, events, trips: tripOut }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
