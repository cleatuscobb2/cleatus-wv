/**
 * Everything the interactive globe on /map/ draws, as one static JSON file the
 * page fetches only once the map is actually starting — so the page itself
 * stays light and still renders without JavaScript.
 *
 *  - countries: the visited ones only, at 50m resolution, rounded to ~1 km
 *  - events:    every located entry (its kinds pick the icon) plus a country-
 *               level dive marker wherever the log says they dived but no
 *               located entry does
 *  - places:    every city and place they've been — the entries' places merged
 *               (src/lib/places.ts) with the ones added in /admin/places
 *  - trips:     for the timeline and the tour — where each trip should fly to
 */
import { getCollection } from 'astro:content';
import { feature } from 'topojson-client';
import { geoArea, geoBounds, geoCentroid, geoContains, geoDistance } from 'd3-geo';
import world from 'world-atlas/countries-50m.json';
import { COUNTRY_NAMES, COUNTRY_NUMERIC, POINT_MARKERS } from '../data/trip-meta.ts';
import { beenTo, yearSpans, FLAGS } from '../data/been-to.ts';
import { kindsOf, type Kind } from '../lib/journey.ts';
import { buildPlaces } from '../lib/places.ts';
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

/*
 * The antimeridian. Russia (Chukotka, Wrangel Island) and Fiji have rings whose
 * edges jump from +179.9° to −180°; a web map draws that jump the long way round
 * the world — a band circling the pole and a stray wedge across Europe. So each
 * ring is first made continuous (no step wider than 180°), then any polygon that
 * spills past ±180° is cut there into a piece on each side, the far piece moved
 * back by 360°.
 */
type Ring = number[][];

function unwrap(ring: Ring): Ring {
  const out: Ring = [[...ring[0]]];
  for (let i = 1; i < ring.length; i++) {
    let x = ring[i][0];
    const prev = out[i - 1][0];
    while (x - prev > 180) x -= 360;
    while (x - prev < -180) x += 360;
    out.push([x, ring[i][1]]);
  }
  // Keep the bulk of the ring in [-180, 180].
  const mid = (Math.min(...out.map((p) => p[0])) + Math.max(...out.map((p) => p[0]))) / 2;
  const shift = mid > 180 ? -360 : mid < -180 ? 360 : 0;
  return shift ? out.map(([x, y]) => [x + shift, y]) : out;
}

/** Sutherland–Hodgman against one vertical line: keep the side where `keep(x)` holds. */
function clipAt(ring: Ring, at: number, keep: (x: number) => boolean): Ring {
  const out: Ring = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[i + 1];
    const ain = keep(ax);
    const bin = keep(bx);
    if (ain) out.push([ax, ay]);
    if (ain !== bin) out.push([at, ay + ((at - ax) / (bx - ax)) * (by - ay)]);
  }
  if (out.length) out.push([...out[0]]);
  return out.length >= 4 ? out : [];
}

function splitPolygon(poly: Ring[]): Ring[][] {
  const rings = poly.map(unwrap);
  const xs = rings.flatMap((r) => r.map((p) => p[0]));
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  if (hi <= 180 && lo >= -180) return [rings];
  const at = hi > 180 ? 180 : -180;
  const shift = hi > 180 ? -360 : 360;
  const near = rings.map((r) => clipAt(r, at, (x) => (hi > 180 ? x <= at : x >= at)));
  const far = rings
    .map((r) => clipAt(r, at, (x) => (hi > 180 ? x >= at : x <= at)))
    .map((r) => r.map(([x, y]) => [x + shift, y]));
  // A hole only survives on a side where its outer ring does.
  return [near, far].filter((side) => side[0]?.length).map((side) => side.filter((r) => r.length));
}

function mendAntimeridian(g: Geom): Geom {
  if (g.type !== 'Polygon' && g.type !== 'MultiPolygon') return g;
  const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as Ring[][];
  const out = polys.flatMap(splitPolygon);
  return out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out };
}

/** Centre of the biggest piece — France's, not somewhere between Paris and Guiana. */
function heartOf(g: Geom): [number, number] {
  if (g.type !== 'MultiPolygon') return geoCentroid(g as never) as [number, number];
  const parts = (g.coordinates as unknown[]).map((coordinates) => ({ type: 'Polygon', coordinates }));
  const big = parts.sort((a, b) => geoArea(b as never) - geoArea(a as never))[0];
  return geoCentroid(big as never) as [number, number];
}

/**
 * Bounds of the biggest piece, for flying to a country. One that wraps past the
 * antimeridian (Russia's Chukotka) stops at 180°: a box whose east edge is past
 * 180 is read by the map as wrapping the other way round the world, and the
 * camera ends up over the Atlantic.
 */
function boxOf(g: Geom): [number, number, number, number] {
  let target: Geom = g;
  if (g.type === 'MultiPolygon') {
    const parts = (g.coordinates as unknown[]).map((coordinates) => ({ type: 'Polygon', coordinates }));
    target = parts.sort((a, b) => geoArea(b as never) - geoArea(a as never))[0];
  }
  const [[w, s], [e, n]] = geoBounds(target as never);
  return [w, s, e < w ? 180 : e, n];
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
  const alphaOf = new Map(Object.entries(COUNTRY_NUMERIC).map(([a, n]) => [n, a]));
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
      const geometry = mendAntimeridian({ type: f.geometry.type, coordinates: slim(f.geometry.coordinates) });
      countries.push({ type: 'Feature', geometry, properties: { ...props, heart: hearts[code], box: boxes[code] } });
    } else if (POINT_MARKERS[code]) {
      // Too small for the dataset: a point the globe draws as a dot.
      const [x, y] = POINT_MARKERS[code];
      hearts[code] = [x, y];
      boxes[code] = [x - 0.6, y - 0.6, x + 0.6, y + 0.6];
      countries.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x, y] }, properties: { ...props, heart: hearts[code], box: boxes[code] } });
    }
  }

  // --- places: cities and towns, from the entries and from /admin/places ------------
  const hand = (await getCollection('places')).map((p) => ({ id: p.id, ...p.data }));
  const visited = new Set(codes);
  /*
   * The country a place is in. The outline that holds it, if that's somewhere
   * they've been; otherwise — just off an outline (Venice, Hvar, a Galápagos
   * landing), or an island the outlines give a neighbour (San Andrés is
   * Colombian) — the nearest of `prefer` (the entry's trip countries), or of
   * everywhere they've been.
   */
  const countryOf = (lng: number, lat: number, prefer: string[] = []) => {
    const f = all.find((x) => geoContains(x as never, [lng, lat]));
    const a = f ? alphaOf.get(String(f.id)) : undefined;
    if (a && (prefer.includes(a) || visited.has(a))) return a;
    const pool = prefer.some((c) => hearts[c]) ? new Set(prefer) : visited;
    let best = '';
    let bestD = Infinity;
    for (const [c, h] of Object.entries(hearts)) {
      if (!pool.has(c)) continue;
      const d = geoDistance([lng, lat], h) * 6371;
      if (d < bestD) { bestD = d; best = c; }
    }
    // A home-country stopover (Brooklyn, Houston) stays where it is.
    return a && bestD > 2000 ? a : best || a || '';
  };
  const places = buildPlaces(
    located.map((e) => ({
      name: e.data.location!.name,
      lat: e.data.location!.lat!,
      lng: e.data.location!.lng!,
      title: e.data.title,
      href: `/${tripIdOf(e)}/${entrySlug(e)}/`,
      date: e.data.date.toISOString().slice(0, 10),
      trip: tripShort(tripIdOf(e)),
      country: countryOf(e.data.location!.lng!, e.data.location!.lat!, trips.find((t) => t.id === tripIdOf(e))?.data.countries),
    })),
    hand,
    countryOf,
  ).map((p) => ({ ...p, countryName: COUNTRY_NAMES[p.country] ?? p.country }));

  // The same rule for an entry: its trip's countries first (San Andrés dives are Colombian).
  const countryOfEntry = (e: (typeof located)[number]) =>
    countryOf(e.data.location!.lng!, e.data.location!.lat!, trips.find((t) => t.id === tripIdOf(e))?.data.countries);

  // Dive sites added in /admin/places ("Dived here"): a dive marker on each.
  const handDives = hand.filter((p) => p.dived);
  for (const p of handDives) {
    events.push({
      lng: p.lng,
      lat: p.lat,
      kinds: ['diving'],
      title: `Dived at ${p.name}`,
      href: tripsIn(p.country).length ? `/places/${p.country.toLowerCase()}/` : null,
      when: p.when ? yearSpans([p.when]) : '',
      place: COUNTRY_NAMES[p.country] ?? p.country,
      trip: '',
    });
  }

  // Dived there, per the log, but neither an entry nor a hand-added place says
  // where: one marker in the middle of the country.
  for (const code of FLAGS.scuba as readonly string[]) {
    if (!codes.includes(code) || !hearts[code]) continue;
    const covered = handDives.some((p) => p.country === code) || located.some(
      (e) => e.data.tags.includes('diving') && countryOfEntry(e) === code,
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
      // Stops in a country the trip doesn't list — a Brooklyn stopover, a Houston
      // layover on the way out — would stretch the view across an ocean. Points
      // just off the outlines (Venice, Hvar, the Galápagos) are in no country and stay.
      const elsewhere = (lng: number, lat: number) =>
        all.some((f) => {
          const a = alphaOf.get(String(f.id));
          return a && !t.data.countries.includes(a) && geoContains(f as never, [lng, lat]);
        });
      const pts = located
        .filter((e) => tripIdOf(e) === t.id && !elsewhere(e.data.location!.lng!, e.data.location!.lat!))
        .map((e) => [e.data.location!.lng!, e.data.location!.lat!] as const);
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

  return new Response(JSON.stringify({ countries: { type: 'FeatureCollection', features: countries }, events, places, trips: tripOut }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
