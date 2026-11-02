/**
 * Everything the /admin/trips screens need, read through the store so it works
 * the same locally and hosted: each trip's frontmatter and version, and its
 * entries with the photographs each one shows.
 */
import type { ContentStore } from './store/index.ts';
import { readMeta } from './frontmatter.ts';
import { photosIn, readTrip, type TripMetaRead } from './trip-edit.ts';
import { TRIP_META } from '../data/trip-meta.ts';

export interface TripEntry {
  slug: string;
  title: string;
  date: string;
  photos: string[];
}

export interface TripData {
  id: string;
  path: string;
  version: string;
  meta: TripMetaRead;
  entries: TripEntry[];
  /** What the import was unsure about (src/data/trip-meta.ts). */
  question: string | null;
}

/** Trip spans longer than this are almost certainly publish dates, not travel dates. */
export const SUSPICIOUS_DAYS = 120;

export async function loadTrips(store: ContentStore, only?: string): Promise<TripData[]> {
  const tripPaths = (await store.list('src/content/trips', '.mdx'))
    .filter((p) => !only || p === `src/content/trips/${only}.mdx`);
  const entryPaths = await store.list('src/content/entries', '.mdx');

  const trips = await Promise.all(tripPaths.map(async (path) => {
    const id = path.split('/').pop()!.replace(/\.mdx$/, '');
    const { text, version } = await store.read(path);
    const entries = await Promise.all(
      entryPaths.filter((p) => p.startsWith(`src/content/entries/${id}/`)).map(async (p) => {
        const t = (await store.read(p)).text;
        const m = readMeta(t);
        return { slug: p.split('/').pop()!.replace(/\.mdx$/, ''), title: m.title, date: m.date, photos: photosIn(t) };
      }),
    );
    entries.sort((a, b) => a.date.localeCompare(b.date) || a.slug.localeCompare(b.slug));
    return { id, path, version, meta: readTrip(text), entries, question: TRIP_META[id]?.confirm ?? null };
  }));
  return trips.sort((a, b) => b.meta.dateStart.localeCompare(a.meta.dateStart));
}

/** What's still outstanding on a trip, in plain words. Empty when it's done. */
export function outstanding(t: TripData): string[] {
  const out: string[] = [];
  if (t.meta.summaryNeedsReview) out.push('Summary is still the placeholder');
  if (!t.meta.handEdited) out.push(t.meta.hero ? 'Hero was picked automatically' : 'No hero photograph');
  else if (!t.meta.hero) out.push('No hero photograph');
  if (t.meta.hero && !/\.(jpe?g|png|gif|webp|avif)$/i.test(t.meta.hero)) out.push("Hero is a format most browsers can't show");
  if (t.meta.days > SUSPICIOUS_DAYS) out.push(`Dates span ${t.meta.days} days — probably publish dates`);
  if (t.question && !t.meta.handEdited) out.push(`Question: ${t.question}`);
  return out;
}
