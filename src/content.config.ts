import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { TAGS, METERS, type Meter } from './data/tags.ts';

const tag = z.enum(TAGS);

const trips = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/trips' }),
  schema: z.object({
    title: z.string(),
    shortTitle: z.string(),
    year: z.number(),
    dateStart: z.date(),
    dateEnd: z.date(),
    countries: z.array(z.string()),
    regions: z.array(z.string()).default([]),
    summary: z.string(),
    /** Path under /photos/. Null on the two trips with no photographs at all. */
    hero: z.string().nullable().default(null),
    stats: z.object({
      days: z.number(),
      entries: z.number(),
      trekMiles: z.number().optional(),
      maxElevationFt: z.number().optional(),
      countriesCount: z.number(),
    }),
    gpx: z.string().optional(),
    featured: z.boolean().default(false),
    startHere: z.string().optional(),
    /** Set where a summary is still auto-derived and wants a human rewrite. */
    summaryNeedsReview: z.boolean().default(false),
    /** A person has edited this trip (via /admin/trips); gen-trips keeps their edits. */
    handEdited: z.boolean().default(false),
  }),
});

const entries = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/entries' }),
  schema: z.object({
    title: z.string(),
    trip: reference('trips'),
    day: z.number().nullable().default(null),
    date: z.date(),
    authors: z.array(z.enum(['andy', 'beth'])),
    location: z
      .object({
        name: z.string(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        elevationFt: z.number().optional(),
      })
      .optional(),
    leg: z
      .object({
        from: z.string().nullable(),
        to: z.string().nullable(),
        distanceMi: z.number().nullable(),
        cumulativeMi: z.number().nullable(),
        elevationHighFt: z.number().nullable(),
        elevationLowFt: z.number().nullable(),
        /** The original italic line, kept so the parse stays auditable. */
        sourceLine: z.string().optional(),
      })
      .optional(),
    tags: z.array(tag).default([]),
    people: z.array(reference('people')).default([]),
    bethCried: z.boolean().default(false),
    /** How it felt, 0–3 each (src/data/tags.ts METERS). Unset means not rated. */
    meters: z
      .object(Object.fromEntries(METERS.map((m) => [m, z.number().int().min(0).max(3).optional()])) as Record<Meter, z.ZodOptional<z.ZodNumber>>)
      .default({}),
    draft: z.boolean().default(false),
    // Provenance, written by scripts/convert.ts. Not for hand editing.
    sourceUrl: z.string().optional(),
    sourceId: z.string().optional(),
  }),
});

const people = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/people' }),
  schema: z.object({
    name: z.string(),
    role: z.string(),
    trips: z.array(reference('trips')).default([]),
    note: z.string().optional(),
  }),
});

const retrospectives = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/retrospectives' }),
  schema: z.object({
    trip: reference('trips'),
    author: z.enum(['andy', 'beth']),
    writtenAt: z.date(),
    title: z.string(),
  }),
});

/**
 * Readers' comments, one JSON file each at comments/<trip>/<entry>/<id>.json.
 * Committed only once approved in /admin/comments (ADMIN-PLAN.md §7b), so they
 * live beside the writing and survive any platform — the old site's 176 died
 * with its hosting. JSON rather than Markdown: a stranger's words are kept and
 * shown exactly as plain text, and nothing in them is ever rendered as HTML.
 */
const comments = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/comments' }),
  schema: z.object({
    /** `trip/entry-slug` */
    entry: z.string(),
    name: z.string(),
    date: z.coerce.date(),
    body: z.string(),
    /** Recovered from the old Squarespace site. */
    archival: z.boolean().default(false),
  }),
});

export const collections = { trips, entries, people, retrospectives, comments };
