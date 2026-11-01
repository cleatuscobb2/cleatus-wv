/**
 * Read and surgically edit an entry's frontmatter.
 *
 * No YAML library and no re-serialising: an edit replaces exactly the one line
 * it is about (`tags:`, `bethCried:`, `authors:`) and leaves every other byte of
 * the file as it was. The prose below the frontmatter is never touched. If a
 * line isn't where it's expected, the edit refuses rather than guessing.
 */
import { TAGS } from '../data/tags.ts';

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
}

export interface Curation {
  tags: string[];
  bethCried: boolean;
  authors: AuthorId[];
}

/** Split at the closing `---`. Everything before it is frontmatter. */
function splitFrontmatter(text: string) {
  if (!text.startsWith('---')) throw new Error('no frontmatter');
  const close = text.indexOf('\n---', 3);
  if (close < 0) throw new Error('unterminated frontmatter');
  return { head: text.slice(0, close), rest: text.slice(close) };
}

const line = (head: string, key: string) =>
  head.match(new RegExp(`^${key}:[ \\t]*(.*?)[ \\t]*$`, 'm'))?.[1] ?? null;

function jsonOr<T>(raw: string | null, fallback: T): T {
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
  };
}

const list = (xs: string[]) => `[${xs.map((x) => JSON.stringify(x)).join(', ')}]`;

function replaceLine(head: string, key: string, value: string) {
  const re = new RegExp(`^${key}:.*$`, 'm');
  if (!re.test(head)) throw new Error(`no \`${key}:\` line to edit`);
  return head.replace(re, `${key}: ${value}`);
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
