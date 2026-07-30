/**
 * §7.8 — RSS. Newest first here, deliberately: a feed is a subscription, not a
 * trek. Forward ordering belongs on the trip pages.
 */
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { tripIdOf, entrySlug, excerpt, AUTHOR_NAMES } from '../lib/entries.ts';

export async function GET(context: APIContext) {
  const entries = await getCollection('entries', ({ data }) => !data.draft);
  const trips = await getCollection('trips');
  const tripTitle = (id: string) => trips.find((t) => t.id === id)?.data.title ?? id;

  const items = entries
    .sort((a, b) => +b.data.date - +a.data.date)
    .map((e) => ({
      title: e.data.title,
      pubDate: e.data.date,
      link: `/${tripIdOf(e)}/${entrySlug(e)}/`,
      description: excerpt(e.body, 280),
      categories: [tripTitle(tripIdOf(e)), ...e.data.tags],
      author: e.data.authors.map((a) => AUTHOR_NAMES[a]).join(' & '),
    }));

  return rss({
    title: 'Cleatus and the West Virginian',
    description:
      "Andy and Beth's travel journal. Long, hard trips since 2009 — written mostly by Beth, mostly while exhausted.",
    site: context.site ?? 'https://cleatusandthewestvirginian.com',
    items,
    customData: '<language>en-us</language>',
  });
}
