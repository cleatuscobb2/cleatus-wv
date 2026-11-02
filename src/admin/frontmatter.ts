/**
 * Read and surgically edit an entry's frontmatter.
 *
 * No YAML library and no re-serialising: an edit replaces exactly the one line
 * it is about (`tags:`, `bethCried:`, `authors:`) and leaves every other byte of
 * the file as it was. The prose below the frontmatter is never touched. If a
 * line isn't where it's expected, the edit refuses rather than guessing.
 */
import { TAGS, METERS, type Meter } from '../data/tags.ts';

export type AuthorId = 'andy' | 'beth';

export interface EntryMeta {
  title: string;
  trip: string;
  date: string;
  day: number | null;
  authors: AuthorId[];
  tags: string[];
  bethCried: boolean;
  draft: boolean;
  meters: Meters;
  location: Place | null;
}

/** 0–3 per meter; a missing key is "not rated". */
export type Meters = Partial<Record<Meter, number>>;

/** Where an entry happens. Coordinates optional: a name alone still reads. */
export interface Place { name: string; lat?: number; lng?: number }

export interface Curation {
  tags: string[];
  bethCried: boolean;
  authors: AuthorId[];
}

/** Split at the closing `---`. Everything before it is frontmatter. */
export function splitFrontmatter(text: string) {
  if (!text.startsWith('---')) throw new Error('no frontmatter');
  const close = text.indexOf('\n---', 3);
  if (close < 0) throw new Error('unterminated frontmatter');
  return { head: text.slice(0, close), rest: text.slice(close) };
}

export const line = (head: string, key: string) =>
  head.match(new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'm'))?.[1] ?? null;

export function jsonOr<T>(raw: string | null, fallback: T): T {
  if (raw == null) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

export function readMeta(text: string): EntryMeta {
  const { head } = splitFrontmatter(text);
  const titleRaw = line(head, 'title') ?? '';
  const dayRaw = line(head, 'day');
  return {
    // Titles were written JSON-escaped by convert.ts, so JSON reads them back.
    title: titleRaw.startsWith('"') ? jsonOr(titleRaw, titleRaw) : titleRaw,
    trip: (line(head, 'trip') ?? '').replace(/^"|"$/g, ''),
    date: line(head, 'date') ?? '',
    day: dayRaw && dayRaw !== 'null' ? Number(dayRaw) : null,
    authors: jsonOr<AuthorId[]>(line(head, 'authors'), []),
    tags: jsonOr<string[]>(line(head, 'tags'), []),
    bethCried: line(head, 'bethCried') === 'true',
    draft: line(head, 'draft') === 'true',
    meters: jsonOr<Meters>(line(head, 'meters'), {}),
    location: jsonOr<Place | null>(line(head, 'location'), null),
  };
}

export const list = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x)).join(', ')}]`;

export function replaceLine(head: string, key: string, value: string) {
  const re = new RegExp(`^${key}:.*$`, 'm');
  if (!re.test(head)) throw new Error(`no \`${key}:\` line to edit`);
  return head.replace(re, `${key}: ${value}`);
}

/**
 * Set a one-line key, adding the line after `after:` when the entry doesn't
 * have it yet (meters and location are newer than most entries). `null`
 * removes the line.
 */
export function upsertLine(head: string, key: string, value: string | null, after = 'bethCried') {
  const re = new RegExp(`^${key}:.*\\n?`, 'm');
  if (value == null) return head.replace(re, '');
  if (re.test(head)) return replaceLine(head, key, value);
  const anchor = new RegExp(`^${after}:.*$`, 'm');
  if (!anchor.test(head)) throw new Error(`no \`${after}:\` line to add \`${key}:\` after`);
  return head.replace(anchor, (m) => `${m}\n${key}: ${value}`);
}

/** Meters as one JSON line (valid YAML), in METERS order; null when nothing is rated. */
export function metersLine(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'object') throw new Error('meters must be an object');
  const out: Meters = {};
  for (const m of METERS) {
    const v = (raw as Record<string, unknown>)[m];
    if (v == null) continue;
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 3) throw new Error(`${m} must be 0, 1, 2 or 3`);
    out[m] = v as number;
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/** A location as one JSON line; null to clear. */
export function locationLine(raw: unknown): string | null {
  if (raw == null) return null;
  const v = raw as Partial<Place>;
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  if (!name) return null;
  if (name.length > 80) throw new Error('place name is too long');
  const out: Place = { name };
  const num = (x: unknown) => (x === '' || x == null ? undefined : Number(x));
  const lat = num(v.lat);
  const lng = num(v.lng);
  if ((lat == null) !== (lng == null)) throw new Error('give both latitude and longitude, or neither');
  if (lat != null && lng != null) {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('latitude must be between -90 and 90');
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error('longitude must be between -180 and 180');
    out.lat = Math.round(lat * 1e4) / 1e4;
    out.lng = Math.round(lng * 1e4) / 1e4;
  }
  return JSON.stringify(out);
}

/** Validate a curation against the schema's own rules before it can be written. */
export function validateCuration(c: unknown): Curation {
  const v = c as Partial<Curation>;
  if (!Array.isArray(v.tags) || !v.tags.every((t) => (TAGS as readonly string[]).includes(t))) {
    throw new Error('tags must come from src/data/tags.ts');
  }
  if (typeof v.bethCried !== 'boolean') throw new Error('bethCried must be true or false');
  if (!Array.isArray(v.authors) || !v.authors.length || !v.authors.every((a) => a === 'andy' || a === 'beth')) {
    throw new Error('authors must be andy and/or beth');
  }
  return {
    // Vocabulary order, so the same set always serialises the same way.
    tags: (TAGS as readonly string[]).filter((t) => v.tags!.includes(t)),
    bethCried: v.bethCried,
    authors: (['andy', 'beth'] as const).filter((a) => v.authors!.includes(a)),
  };
}

export function applyCuration(text: string, c: Curation): string {
  const { head, rest } = splitFrontmatter(text);
  let next = replaceLine(head, 'tags', list(c.tags));
  next = replaceLine(next, 'bethCried', String(c.bethCried));
  next = replaceLine(next, 'authors', list(c.authors));
  return next + rest;
}

/** A short plain-text excerpt for tooltips. */
export function excerptOf(text: string, max = 220): string {
  const { rest } = splitFrontmatter(text);
  const plain = rest
    .replace(/^\n?---\n/, '')
    .replace(/^import .*$/gm, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\\([{}<])/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max).replace(/\s\S*$/, '')}…` : plain;
}
