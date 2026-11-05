/**
 * GET /api/admin/analytics?days=30            the site-wide picture
 * GET /api/admin/analytics?days=30&path=/x/   one page, with its click map
 * GET /api/admin/analytics?days=30&vercel=1   Vercel's own numbers
 *
 * Behind the sign-in: the numbers are about other people.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { guard, json } from '../guard.ts';
import { insightsFrom, readOverview, readPage } from '../pulse.ts';
import { readVercel } from '../vercel-analytics.ts';

export const prerender = false;

const RANGES = [7, 30, 90, 365];

export const GET: APIRoute = async ({ request, url }) => {
  const blocked = guard(request);
  if (blocked) return blocked;

  const asked = Number(url.searchParams.get('days'));
  const days = RANGES.includes(asked) ? asked : 30;

  try {
    if (url.searchParams.get('vercel') === '1') return json(await readVercel(days));

    const path = url.searchParams.get('path');
    if (path) {
      const page = await readPage(path, days);
      return page ? json(page) : json({ error: 'not a page' }, 400);
    }

    const [entries, trips, overview] = await Promise.all([getCollection('entries'), getCollection('trips'), readOverview(days)]);
    const entryPaths = entries.filter((e) => !e.data.draft).map((e) => `/${e.data.trip.id}/${e.id.split('/').pop()}/`);
    const titles = new Map<string, string>([
      ['/', 'Home'], ['/map/', 'Map'], ['/numbers/', 'By the numbers'], ['/archive/', 'Archive'], ['/about/', 'About'],
      ['/search/', 'Search'], ['/trips/', 'All trips'], ['/places/', 'Places'], ['/tags/', 'Tags'], ['/beth-cried-here/', 'Beth cried here'],
      ...trips.map((t) => [`/${t.id}/`, t.data.title] as [string, string]),
      ...entries.map((e) => [`/${e.data.trip.id}/${e.id.split('/').pop()}/`, e.data.title] as [string, string]),
    ]);
    const titleOf = (p: string) => titles.get(p) ?? p;
    const tripOf = Object.fromEntries(entries.map((e) => [`/${e.data.trip.id}/${e.id.split('/').pop()}/`, trips.find((t) => t.id === e.data.trip.id)?.data.shortTitle ?? '']));
    const seen = [...new Set([...overview.pages.map((p) => p.path), ...overview.journeys.flatMap((j) => [j.from, j.to]), ...overview.landingPages.map((l) => l.key), ...Object.values(overview.countryPages).flat().map((c) => c.key), ...Object.values(overview.referrerLandings).flat().map((c) => c.key)])];
    return json({
      ...overview,
      insights: insightsFrom(overview, titleOf, entryPaths),
      titles: Object.fromEntries(seen.map((p) => [p, titleOf(p)])),
      tripOf: Object.fromEntries(seen.filter((p) => tripOf[p]).map((p) => [p, tripOf[p]])),
      entryCount: entryPaths.length,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
};
