/**
 * Every entry, as little as it takes to land someone on one at random: the dice
 * on the trips page and the home page fetch this only when it is first reached
 * for, so neither page carries 300 titles it may never use.
 *
 *   trips: [id, title]
 *   picks: [trip index, slug, title, date, photo or null]
 */
import { getCollection } from 'astro:content';
import { chronological, entrySlug, fmtDate, tripIdOf } from '../lib/entries.ts';
import { firstPhoto } from '../lib/journey.ts';
import { cover } from '../lib/covers.ts';

export async function GET() {
  const trips = (await getCollection('trips')).map((t) => [t.id, t.data.title] as const);
  const index = new Map(trips.map(([id], i) => [id, i]));
  const picks = chronological(await getCollection('entries', (e) => !e.data.draft))
    .filter((e) => index.has(tripIdOf(e)))
    .map((e) => {
      const photo = firstPhoto(e);
      return [index.get(tripIdOf(e)), entrySlug(e), e.data.title, fmtDate(e.data.date), photo ? cover(photo) : null];
    });
  return new Response(JSON.stringify({ trips, picks }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
