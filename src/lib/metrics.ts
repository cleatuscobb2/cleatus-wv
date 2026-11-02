import { getCollection } from 'astro:content';
import { tripIdOf, entrySlug } from './entries.ts';
import { beenTo } from '../data/been-to.ts';
import { travelMetrics, type TravelMetrics } from './travel.ts';

/**
 * Everything on the overview page is computed here, from the content itself.
 *
 * Two rules, because a page of numbers is only worth having if every number is
 * true:
 *   - Nothing is estimated. If the archive cannot answer it, it is not shown.
 *   - Anything the data can only partly answer is returned with its own caveat
 *     so the page can say so out loud (see `caveats`).
 */

export interface Metrics {
  trips: number;
  entries: number;
  words: number;
  longestEntry: { title: string; words: number; href: string } | null;
  shortestEntry: { title: string; words: number; href: string } | null;
  photos: number;
  /** Everywhere they've been, from the travel log and the trips together. */
  travel: TravelMetrics;
  firstYear: number;
  lastYear: number;
  yearsSpanned: number;
  daysOnTheRoad: number;
  trekMiles: number;
  maxElevationFt: number;
  highestEntry: { title: string; ft: number; href: string } | null;
  byAuthor: { andy: number; beth: number };
  byYear: { year: number; entries: number; trips: number }[];
  busiestMonth: { month: string; entries: number } | null;
  longestTrip: { title: string; days: number; href: string } | null;
  mostEntries: { title: string; entries: number; href: string } | null;
  longestGap: { from: string; to: string; days: number } | null;
  bethCried: number;
  tagged: number;
  caveats: string[];
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const wordCount = (body: string | undefined): number =>
  (body ?? '')
    .replace(/^import .*$/gm, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\\([{}<])/g, '$1')
    .replace(/[*_`#>[\]()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;

export async function computeMetrics(): Promise<Metrics> {
  const now = new Date();
  // A trip started in the admin ahead of time isn't one they've taken yet.
  const trips = (await getCollection('trips')).filter((t) => t.data.dateStart <= now);
  const entries = await getCollection('entries', ({ data }) => !data.draft);
  const caveats: string[] = [];

  // --- words -------------------------------------------------------------
  const withWords = entries.map((e) => ({
    e,
    words: wordCount(e.body),
    href: `/${tripIdOf(e)}/${entrySlug(e)}/`,
  }));
  const words = withWords.reduce((n, x) => n + x.words, 0);
  const sortedByWords = [...withWords].sort((a, b) => b.words - a.words);
  const top = sortedByWords[0];
  const bottom = sortedByWords[sortedByWords.length - 1];

  // --- photographs: what actually appears in the entries -------------------
  const photos = entries.reduce(
    (n, e) => n + ((e.body ?? '').match(/<Photo\s/g)?.length ?? 0), 0);

  // --- places: the writing and the travel log together ---------------------
  const travel = travelMetrics(trips.map((t) => t.data), beenTo(now), now);
  if (travel.countries > travel.writtenUp) {
    caveats.push(
      `The country figures come from their travel log as well as the writing: ${travel.countries - travel.writtenUp} ` +
      `of the ${travel.countries} countries have no entries yet. A visit is a country in a month, so a long trip ` +
      'through one country counts once and a weekend across a border counts twice.',
    );
  }

  // --- time ---------------------------------------------------------------
  const byStart = [...trips].sort((a, b) => +a.data.dateStart - +b.data.dateStart);
  const firstYear = byStart[0]?.data.year ?? 0;
  const lastYear = byStart[byStart.length - 1]?.data.year ?? 0;

  /*
   * Trip length comes from publish dates, which stand in for travel dates. One
   * trip (Japan 2022) has a post written 18 months after getting home, so its
   * span is meaningless; it is excluded from the total and named in the caveat
   * rather than quietly inflating the number.
   */
  const PLAUSIBLE_MAX_DAYS = 120;
  const sane = trips.filter((t) => t.data.stats.days <= PLAUSIBLE_MAX_DAYS);
  const excluded = trips.filter((t) => t.data.stats.days > PLAUSIBLE_MAX_DAYS);
  const daysOnTheRoad = sane.reduce((n, t) => n + t.data.stats.days, 0);
  if (excluded.length) {
    caveats.push(
      `Days on the road excludes ${excluded.map((t) => t.data.shortTitle).join(', ')}, ` +
      'where a post published long after the trip makes the computed span meaningless. ' +
      'Set real dates in the trip file and it will be counted.',
    );
  }

  // --- trek ---------------------------------------------------------------
  const trekMiles = trips.reduce((n, t) => n + (t.data.stats.trekMiles ?? 0), 0);
  const maxElevationFt = Math.max(0, ...trips.map((t) => t.data.stats.maxElevationFt ?? 0));
  const elevated = entries
    .filter((e) => e.data.leg?.elevationHighFt)
    .sort((a, b) => (b.data.leg!.elevationHighFt ?? 0) - (a.data.leg!.elevationHighFt ?? 0))[0];
  const legged = entries.filter((e) => e.data.leg).length;
  if (legged > 0 && legged < entries.length) {
    caveats.push(
      `Distance and elevation come from the ${legged} entries that recorded them — ` +
      'the 2024 Karakoram trek. Earlier trips did not log stats, so the real totals are higher.',
    );
  }

  // --- people -------------------------------------------------------------
  const byAuthor = { andy: 0, beth: 0 };
  for (const e of entries) for (const a of e.data.authors) byAuthor[a]++;

  // --- by year ------------------------------------------------------------
  const yearBuckets = new Map<number, { entries: number; trips: Set<string> }>();
  for (const e of entries) {
    const y = e.data.date.getUTCFullYear();
    const b = yearBuckets.get(y) ?? { entries: 0, trips: new Set<string>() };
    b.entries++;
    b.trips.add(tripIdOf(e));
    yearBuckets.set(y, b);
  }
  const byYear = [...yearBuckets.entries()]
    .map(([year, b]) => ({ year, entries: b.entries, trips: b.trips.size }))
    .sort((a, b) => a.year - b.year);

  // --- busiest month ------------------------------------------------------
  const monthBuckets = new Array(12).fill(0);
  for (const e of entries) monthBuckets[e.data.date.getUTCMonth()]++;
  const bestMonth = monthBuckets.indexOf(Math.max(...monthBuckets));

  // --- superlatives -------------------------------------------------------
  const longestTripT = [...sane].sort((a, b) => b.data.stats.days - a.data.stats.days)[0];
  const mostEntriesT = [...trips].sort((a, b) => b.data.stats.entries - a.data.stats.entries)[0];

  let longestGap: Metrics['longestGap'] = null;
  for (let i = 1; i < byStart.length; i++) {
    const days = Math.round((+byStart[i].data.dateStart - +byStart[i - 1].data.dateEnd) / 86400000);
    if (!longestGap || days > longestGap.days) {
      longestGap = { from: byStart[i - 1].data.shortTitle, to: byStart[i].data.shortTitle, days };
    }
  }

  return {
    trips: trips.length,
    entries: entries.length,
    words,
    longestEntry: top ? { title: top.e.data.title, words: top.words, href: top.href } : null,
    shortestEntry: bottom ? { title: bottom.e.data.title, words: bottom.words, href: bottom.href } : null,
    photos,
    travel,
    firstYear,
    lastYear,
    yearsSpanned: lastYear - firstYear + 1,
    daysOnTheRoad,
    trekMiles,
    maxElevationFt,
    highestEntry: elevated
      ? {
          title: elevated.data.title,
          ft: elevated.data.leg!.elevationHighFt!,
          href: `/${tripIdOf(elevated)}/${entrySlug(elevated)}/`,
        }
      : null,
    byAuthor,
    byYear,
    busiestMonth: { month: MONTHS[bestMonth], entries: monthBuckets[bestMonth] },
    longestTrip: longestTripT
      ? { title: longestTripT.data.title, days: longestTripT.data.stats.days, href: `/${longestTripT.id}/` }
      : null,
    mostEntries: mostEntriesT
      ? { title: mostEntriesT.data.title, entries: mostEntriesT.data.stats.entries, href: `/${mostEntriesT.id}/` }
      : null,
    longestGap,
    bethCried: entries.filter((e) => e.data.bethCried).length,
    tagged: entries.filter((e) => e.data.tags.length > 0).length,
    caveats,
  };
}
