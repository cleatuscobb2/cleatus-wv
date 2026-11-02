/**
 * What the maps and the story flow need to know about each entry: where it
 * happened, what kind of day it was, and how it felt. Server-side only; the
 * results are handed to the client scripts as JSON.
 *
 * "Kinds" are the tags plus `cried` (Beth cried), in the order that decides
 * which one an entry's marker shows when it has several — the most
 * story-worthy first.
 */
import { TAGS, TAG_ICONS, TAG_LABELS, BETH_CRIED_ICON, METERS, type Tag, type Meter } from '../data/tags.ts';
import { entrySlug, fmtDateShort, tripIdOf, type Entry } from './entries.ts';

export type Kind = Tag | 'cried';

export const KIND_ORDER: Kind[] = [
  'cried', 'near-miss', 'diving', 'altitude', 'glacier', 'trekking', 'wildlife', 'illness',
  'celebration', 'gear-failure', 'border-crossing', 'food', 'culture', 'history', 'water',
  'weather', 'people', 'city', 'transport', 'logistics', 'rest-day',
];
// Every tag must have a place in the order, or its entries would never show.
for (const t of TAGS) if (!KIND_ORDER.includes(t)) throw new Error(`journey.ts: KIND_ORDER is missing ${t}`);

export const KIND_ICONS: Record<Kind, string> = { ...TAG_ICONS, cried: BETH_CRIED_ICON };
export const KIND_LABELS: Record<Kind, string> = { ...TAG_LABELS, cried: 'Beth cried' };

export const kindsOf = (e: Entry): Kind[] =>
  KIND_ORDER.filter((k) => (k === 'cried' ? e.data.bethCried : e.data.tags.includes(k)));

export interface JourneyPoint {
  slug: string;
  href: string;
  title: string;
  /** ISO date */
  date: string;
  when: string;
  day: number | null;
  place: string;
  lat: number;
  lng: number;
  kinds: Kind[];
  meters: Partial<Record<Meter, number>>;
  elevationFt: number | null;
  photo: string | null;
}

export const firstPhoto = (e: Entry) => e.body?.match(/<Photo src="([^"]+)"/)?.[1] ?? null;

/** Entries with coordinates, in the order given (already chronological). */
export function journeyPoints(entries: Entry[]): JourneyPoint[] {
  return entries
    .filter((e) => e.data.location?.lat != null && e.data.location?.lng != null)
    .map((e) => ({
      slug: entrySlug(e),
      href: `/${tripIdOf(e)}/${entrySlug(e)}/`,
      title: e.data.title,
      date: e.data.date.toISOString().slice(0, 10),
      when: fmtDateShort(e.data.date),
      day: e.data.day,
      place: e.data.location!.name,
      lat: e.data.location!.lat!,
      lng: e.data.location!.lng!,
      kinds: kindsOf(e),
      meters: Object.fromEntries(METERS.filter((m) => e.data.meters[m] != null).map((m) => [m, e.data.meters[m]!])),
      elevationFt: e.data.leg?.elevationHighFt ?? e.data.location?.elevationFt ?? null,
      photo: firstPhoto(e),
    }));
}

/** Meter totals and peaks across a trip, for the teasers. */
export function peakOf(entries: Entry[], m: Meter): Entry | undefined {
  let best: Entry | undefined;
  for (const e of entries) {
    const v = e.data.meters[m] ?? -1;
    if (v >= 2 && (!best || v > (best.data.meters[m] ?? -1))) best = e;
  }
  return best;
}
