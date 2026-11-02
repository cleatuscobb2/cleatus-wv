/**
 * Read and surgically edit a trip's frontmatter — the /admin/trips editor.
 *
 * Same rules as frontmatter.ts: each edit replaces exactly its own line, nothing
 * is re-serialised, and a missing line is an error rather than a guess. Derived
 * numbers that depend on an edited field (`stats.days` from the dates,
 * `stats.countriesCount` from the countries) are rewritten with it, so the page
 * never shows a fixed date range next to the old day count.
 */
import { COUNTRY_NAMES } from '../data/trip-meta.ts';
import { jsonOr, line, list, replaceLine, splitFrontmatter } from './frontmatter.ts';

export interface TripMetaRead {
  title: string;
  shortTitle: string;
  year: number;
  dateStart: string;
  dateEnd: string;
  countries: string[];
  regions: string[];
  summary: string;
  summaryNeedsReview: boolean;
  hero: string | null;
  startHere: string | null;
  days: number;
  entries: number;
  handEdited: boolean;
}

export interface TripEdit {
  title: string;
  shortTitle: string;
  dateStart: string;
  dateEnd: string;
  countries: string[];
  regions: string[];
  summary: string;
  summaryNeedsReview: boolean;
  hero: string | null;
  startHere: string | null;
}

const str = (raw: string | null) => (raw == null || raw === 'null' ? null : raw.startsWith('"') ? jsonOr(raw, raw) : raw);

export function readTrip(text: string): TripMetaRead {
  const { head } = splitFrontmatter(text);
  return {
    title: str(line(head, 'title')) ?? '',
    shortTitle: str(line(head, 'shortTitle')) ?? '',
    year: Number(line(head, 'year')) || 0,
    dateStart: line(head, 'dateStart') ?? '',
    dateEnd: line(head, 'dateEnd') ?? '',
    countries: jsonOr<string[]>(line(head, 'countries'), []),
    regions: jsonOr<string[]>(line(head, 'regions'), []),
    summary: str(line(head, 'summary')) ?? '',
    summaryNeedsReview: line(head, 'summaryNeedsReview') !== 'false',
    hero: str(line(head, 'hero')),
    startHere: str(line(head, 'startHere')),
    days: Number(line(head, '  days')) || 0,
    entries: Number(line(head, '  entries')) || 0,
    handEdited: line(head, 'handEdited') === 'true',
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive day count, in UTC so no time zone can shift it by one. */
export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

const oneLine = (s: unknown, max: number, what: string) => {
  const v = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!v) throw new Error(`${what} can't be empty`);
  if (v.length > max) throw new Error(`${what} is longer than ${max} characters`);
  return v;
};

export const isShowableImage = (src: string) => /\.(jpe?g|png|gif|webp|avif)$/i.test(src);

/**
 * Validate against the schema's rules and against this trip's own content:
 * the hero must be one of the trip's photographs, startHere one of its entries.
 */
export function validateTripEdit(
  raw: unknown,
  ctx: { photos: string[]; entrySlugs: string[]; currentHero?: string | null },
): TripEdit {
  const v = (raw ?? {}) as Record<string, unknown>;

  const dateStart = String(v.dateStart ?? '');
  const dateEnd = String(v.dateEnd ?? '');
  if (!ISO_DATE.test(dateStart) || Number.isNaN(Date.parse(dateStart))) throw new Error('start date is not a date');
  if (!ISO_DATE.test(dateEnd) || Number.isNaN(Date.parse(dateEnd))) throw new Error('end date is not a date');
  if (dateEnd < dateStart) throw new Error('the trip ends before it starts');

  if (!Array.isArray(v.countries) || !v.countries.length) throw new Error('a trip needs at least one country');
  const countries = [...new Set(v.countries.map(String))];
  const unknown = countries.filter((c) => !(c in COUNTRY_NAMES));
  if (unknown.length) throw new Error(`the map doesn't know ${unknown.join(', ')} yet`);

  const regions = Array.isArray(v.regions)
    ? [...new Set(v.regions.map((r) => String(r).replace(/\s+/g, ' ').trim()).filter(Boolean))]
    : [];
  if (regions.length > 12 || regions.some((r) => r.length > 40)) throw new Error('too many regions, or one is too long');

  const hero = v.hero == null || v.hero === '' ? null : String(v.hero);
  if (hero && !ctx.photos.includes(hero)) throw new Error('the hero must be one of this trip’s photographs');
  // A hero already in place is left alone whatever its format; only a newly
  // chosen one has to be something browsers can show.
  if (hero && hero !== ctx.currentHero && !isShowableImage(hero)) throw new Error('that photograph’s format won’t show in most browsers');

  const startHere = v.startHere == null || v.startHere === '' ? null : String(v.startHere);
  if (startHere && !ctx.entrySlugs.includes(startHere)) throw new Error('“start here” must be one of this trip’s entries');

  return {
    title: oneLine(v.title, 120, 'the title'),
    shortTitle: oneLine(v.shortTitle, 40, 'the short title'),
    dateStart,
    dateEnd,
    countries,
    regions,
    summary: oneLine(v.summary, 600, 'the summary'),
    summaryNeedsReview: v.summaryNeedsReview === true,
    hero,
    startHere,
  };
}

export function applyTripEdit(text: string, e: TripEdit): string {
  const { head, rest } = splitFrontmatter(text);
  let h = head;
  h = replaceLine(h, 'title', JSON.stringify(e.title));
  h = replaceLine(h, 'shortTitle', JSON.stringify(e.shortTitle));
  h = replaceLine(h, 'dateStart', e.dateStart);
  h = replaceLine(h, 'dateEnd', e.dateEnd);
  h = replaceLine(h, 'countries', list(e.countries));
  h = replaceLine(h, 'regions', list(e.regions));
  h = replaceLine(h, 'summary', JSON.stringify(e.summary));
  h = replaceLine(h, 'summaryNeedsReview', String(e.summaryNeedsReview));
  h = replaceLine(h, 'hero', e.hero ? JSON.stringify(e.hero) : 'null');
  h = replaceLine(h, '  days', String(daysBetween(e.dateStart, e.dateEnd)));
  h = replaceLine(h, '  countriesCount', String(e.countries.length));
  h = e.startHere ? upsertLine(h, 'startHere', JSON.stringify(e.startHere)) : h.replace(/\nstartHere:.*$/m, '');
  // Marks the trip as touched by a person, so gen-trips keeps these edits.
  h = upsertLine(h, 'handEdited', 'true');
  return h + rest;
}

/** Replace a top-level line, or add it at the end of the frontmatter if absent. */
function upsertLine(head: string, key: string, value: string) {
  return new RegExp(`^${key}:`, 'm').test(head) ? replaceLine(head, key, value) : `${head}\n${key}: ${value}`;
}

/** Every photograph an entry shows, in order of appearance. */
export function photosIn(entryText: string): string[] {
  return [...entryText.matchAll(/\/photos\/[^"'\s)>]+?\.(?:jpe?g|png|gif|webp|avif|heic)\b/gi)].map((m) => m[0]);
}
