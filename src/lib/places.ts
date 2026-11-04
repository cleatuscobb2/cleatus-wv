/**
 * The cities and places on the globe: every place an entry is pinned to, plus
 * the ones added by hand in /admin/places (src/content/places/visited.json) for
 * the towns they've been to and never written up.
 *
 * Entries pinned to the same place — six nights in Kathmandu, three posts from
 * Zermatt — become one marker that lists them. "Same place" is the same name
 * within 25 km, or anywhere within 2 km whatever it's called.
 *
 * Pure, so it can be tested without Astro.
 */
/** Great-circle distance in km. */
function km(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r;
  const dLng = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

export interface HandPlace {
  id: string;
  name: string;
  /** ISO alpha-2. */
  country: string;
  lat: number;
  lng: number;
  /** 'YYYY' or 'YYYY-MM', when known. */
  when?: string;
  note?: string;
}

export interface PinnedEntry {
  name: string;
  lat: number;
  lng: number;
  title: string;
  href: string;
  /** 'YYYY-MM-DD' */
  date: string;
  trip: string;
  /** ISO alpha-2, when the caller already knows it. */
  country?: string;
}

export interface Place {
  name: string;
  country: string;
  lat: number;
  lng: number;
  /** How many entries are written from here; 0 for a hand-added place. */
  n: number;
  years: string;
  entries: { title: string; href: string; date: string; trip: string }[];
  note?: string;
}

const SAME_NAME_KM = 25;
const SAME_SPOT_KM = 2;
const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function spanOf(years: number[]) {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  if (!ys.length) return '';
  // 2013, 2017–2019
  const out: string[] = [];
  for (let i = 0; i < ys.length; i++) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++;
    out.push(j > i ? `${ys[i]}–${ys[j]}` : String(ys[i]));
    i = j;
  }
  return out.join(', ');
}

export function buildPlaces(
  pinned: PinnedEntry[],
  hand: HandPlace[],
  countryOf: (lng: number, lat: number) => string,
): Place[] {
  type Acc = { name: string; lat: number; lng: number; entries: PinnedEntry[]; hand: HandPlace[] };
  const groups: Acc[] = [];
  const find = (name: string, lat: number, lng: number) =>
    groups.find((g) => {
      const d = km([g.lng, g.lat], [lng, lat]);
      return d < SAME_SPOT_KM || (d < SAME_NAME_KM && norm(g.name) === norm(name));
    });

  for (const e of pinned) {
    const g = find(e.name, e.lat, e.lng);
    if (g) g.entries.push(e);
    else groups.push({ name: e.name, lat: e.lat, lng: e.lng, entries: [e], hand: [] });
  }
  for (const h of hand) {
    const g = find(h.name, h.lat, h.lng);
    if (g) g.hand.push(h);
    else groups.push({ name: h.name, lat: h.lat, lng: h.lng, entries: [], hand: [h] });
  }

  return groups.map((g) => {
    // The marker sits where most entries put it, named the way most of them do.
    const names = new Map<string, number>();
    for (const e of g.entries) names.set(e.name, (names.get(e.name) ?? 0) + 1);
    const name = g.entries.length ? [...names].sort((a, b) => b[1] - a[1])[0][0] : g.hand[0].name;
    const lat = g.entries.length ? g.entries[0].lat : g.hand[0].lat;
    const lng = g.entries.length ? g.entries[0].lng : g.hand[0].lng;
    const years = [
      ...g.entries.map((e) => Number(e.date.slice(0, 4))),
      ...g.hand.filter((h) => h.when).map((h) => Number(h.when!.slice(0, 4))),
    ];
    const entries = [...g.entries]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(({ title, href, date, trip }) => ({ title, href, date, trip }));
    const note = g.hand.map((h) => h.note).filter(Boolean).join(' · ') || undefined;
    return {
      name,
      country: g.entries[0]?.country || g.hand[0]?.country || countryOf(lng, lat),
      lat,
      lng,
      n: g.entries.length,
      years: spanOf(years),
      entries,
      ...(note ? { note } : {}),
    };
  }).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

/** A stable id for a hand-added place: `kyoto-jp`, `kyoto-jp-2` if taken. */
export function placeId(name: string, country: string, taken: Set<string>) {
  const base = `${norm(name).replace(/ /g, '-').slice(0, 60) || 'place'}-${country.toLowerCase()}`;
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}
