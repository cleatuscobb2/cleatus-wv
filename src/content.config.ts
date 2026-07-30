import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { TAGS } from './data/tags.ts';

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
    /**
     * A spoken reading of this entry. Optional throughout: an entry without one
     * simply shows no player, so the archive can fill in gradually rather than
     * looking broken while it does.
     *
     * `src` is deliberately a plain string, not an asset import, so the same
     * field works whether the file sits in public/, on R2, or anywhere else —
     * the hosting decision stays open.
     */
    audio: z
      .object({
        src: z.string(),
        durationSec: z.number().optional(),
        bytes: z.number().optional(),
        type: z.string().default('audio/mpeg'),
        /** Who is speaking. `synthetic` is marked as such on the page. */
        voice: z.enum(['andy', 'beth', 'synthetic']).default('synthetic'),
        recordedAt: z.date().optional(),
      })
      .optional(),
    tags: z.array(tag).default([]),
    people: z.array(reference('people')).default([]),
    bethCried: z.boolean().default(false),
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

export const collections = { trips, entries, people, retrospectives };
