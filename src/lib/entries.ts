import { getCollection, type CollectionEntry } from 'astro:content';

export type Entry = CollectionEntry<'entries'>;
export type Trip = CollectionEntry<'trips'>;

/** The trip slug an entry belongs to. */
export const tripIdOf = (e: Entry): string =>
  typeof e.data.trip === 'string' ? e.data.trip : e.data.trip.id;

/** The entry's own slug, without the trip directory prefix the glob loader adds. */
export const entrySlug = (e: Entry): string => e.id.split('/').pop()!;

export const entryPath = (e: Entry): string => `/${tripIdOf(e)}/${entrySlug(e)}/`;

/**
 * Forward chronological — Day 1 first. This is problem 5 in the brief: the old
 * site put Day 11 above Day 1 and dropped first-time readers at the end.
 *
 * Day number wins where it exists (the 2024 trek), date otherwise.
 */
export function chronological(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.data.day != null && b.data.day != null) return a.data.day - b.data.day;
    return +a.data.date - +b.data.date;
  });
}

export async function entriesForTrip(tripId: string): Promise<Entry[]> {
  const all = await getCollection('entries', ({ data }) => !data.draft);
  return chronological(all.filter((e) => tripIdOf(e) === tripId));
}

/** Nodes for the route line: elevation where a leg has it, null otherwise. */
export const routeNodes = (entries: Entry[]) =>
  entries.map((e) => ({
    slug: entrySlug(e),
    title: e.data.title,
    day: e.data.day,
    date: e.data.date,
    elevationFt: e.data.leg?.elevationHighFt ?? null,
  }));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Dates are data, so they are set in mono and formatted like a log entry. */
export const fmtDate = (d: Date): string =>
  `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

export const fmtDateShort = (d: Date): string =>
  `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;

export function fmtRange(a: Date, b: Date): string {
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  return sameYear ? `${fmtDateShort(a)} – ${fmtDate(b)}` : `${fmtDate(a)} – ${fmtDate(b)}`;
}

export const AUTHOR_NAMES = { andy: 'Andy', beth: 'Beth' } as const;

/**
 * First sentence or so of an entry, for cards. Reads the compiled body rather
 * than a hand-written excerpt so it can never go stale.
 */
export function excerpt(body: string | undefined, max = 180): string {
  if (!body) return '';
  const text = body
    .replace(/^import .*$/gm, '')
    .replace(/<[^>]*>/g, '')
    .replace(/^\s*[*_#>-]+\s*/gm, '')
    .replace(/\\([{}<])/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.replace(/\s\S*$/, '')}…`;
}
