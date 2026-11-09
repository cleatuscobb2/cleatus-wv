import { defineCollection, reference, z } from 'astro:content';
import { file, glob } from 'astro/loaders';
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
      /** As of gen-trips' last run — goes stale as entries are added. Display entryCounts() instead. */
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
    /**
     * The way here from the previous place, where a straight line would lie: the
     * off-road drive from Skardu to Askole. [lng, lat] pairs, drawn on the trip's
     * journey map. Its own line, so the admin's location editor leaves it alone.
     */
    pathIn: z
      .object({
        label: z.string().optional(),
        coords: z.array(z.tuple([z.number(), z.number()])).min(1),
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

/**
 * Cities and places they've been that no entry is pinned to — added in
 * /admin/places, one array in one file. The globe merges these with every
 * entry's place (src/lib/places.ts).
 */
const places = defineCollection({
  loader: file('src/content/places/visited.json'),
  schema: z.object({
    name: z.string().min(1).max(80),
    country: z.string().regex(/^[A-Z]{2}$/),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    when: z.string().regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/).optional(),
    note: z.string().max(140).optional(),
    /** They dived here: a dive marker on the map instead of one mid-country. */
    dived: z.boolean().optional(),
  }),
});

/**
 * Instagram posts someone has ticked for the site (npm run ig -- review). The
 * rest of the archive, and the home locations, stay out of this public repo.
 */
const instagram = defineCollection({
  loader: file('src/content/instagram/posts.json'),
  schema: z.object({
    author: z.string(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    caption: z.string(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    place: z.string().optional(),
    country: z.string().optional(),
    trip: z.string().optional(),
    /** The entry of that trip it belongs with: shown there, not in the trip's own list. */
    entry: z.string().optional(),
    /** An emoji that marks it on the globe in place of the camera, for a moment worth flagging. */
    icon: z.string().optional(),
    /** Shown instead of the date when only the season is known ("Winter 2025–26"). */
    dateLabel: z.string().optional(),
    media: z.array(z.object({
      src: z.string(),
      thumb: z.string(),
      poster: z.string().optional(),
      w: z.number(),
      h: z.number(),
      video: z.boolean().optional(),
    })).min(1),
  }),
});

export const collections = { trips, entries, people, retrospectives, comments, places, instagram };
