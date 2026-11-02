/**
 * The prose editor's two endpoints (see mdx.ts for what is and isn't allowed):
 *
 *   POST /api/admin/preview  { body }                                  → { problems, html }
 *   POST /api/admin/entry    { path, version, title, body, draft?, photos? } → { commit, versions }
 *   POST /api/admin/new      { trip, slug, title, date, day, authors, draft, body, photos? }
 *
 * `photos` are uploads from /api/admin/photo: [{ src, token }], committed with
 * the text in one commit.
 *
 * Preview never writes. Save re-checks everything itself — it never trusts that
 * the page showed no problems — and refuses with the list if there are any, so
 * an entry that would break the build can't reach the repository.
 */
import type { APIRoute } from 'astro';
import { getStore, ConflictError, type Author, type Edit } from '../store/index.ts';
import { checkBody, joinEntry, renderPreview, splitEntry } from '../mdx.ts';
import { replaceLine, splitFrontmatter } from '../frontmatter.ts';
import { guard, json, userOf } from '../guard.ts';
import { HOSTED } from '../mode.ts';
import { countHit } from '../kv.ts';

export const prerender = false;

const ENTRY_PATH = /^src\/content\/entries\/[a-z0-9-]+\/[a-z0-9-]+\.mdx$/;
const MAX_BODY = 200_000;
const SAVES_PER_HOUR = 60;

async function readJson(request: Request) {
  try { return (await request.json()) as Record<string, unknown>; } catch { return null; }
}

export const preview: APIRoute = async ({ request }) => {
  const blocked = guard(request);
  if (blocked) return blocked;
  const body = await readJson(request);
  const text = typeof body?.body === 'string' ? body.body : null;
  if (text == null || text.length > MAX_BODY) return json({ error: 'expected a body' }, 400);

  const result = checkBody(text);
  return json({ problems: result.problems, html: result.tree ? renderPreview(result.tree) : null });
};

export const save: APIRoute = async ({ request }) => {
  const blocked = guard(request);
  if (blocked) return blocked;

  const user = HOSTED ? userOf(request) : null;
  if (user && (await countHit(`rl:save:${user.email}`, 3600)) > SAVES_PER_HOUR) {
    return json({ error: 'too many saves in the last hour — try again shortly' }, 429);
  }

  const input = await readJson(request);
  const path = String(input?.path ?? '');
  const newBody = typeof input?.body === 'string' ? input.body : null;
  const title = String(input?.title ?? '').replace(/\s+/g, ' ').trim();
  if (!ENTRY_PATH.test(path)) return json({ error: 'not an entry' }, 400);
  if (newBody == null || newBody.length > MAX_BODY) return json({ error: 'expected a body' }, 400);
  if (!title || title.length > 200) return json({ error: 'the title must be 1–200 characters' }, 400);

  const checked = checkBody(newBody);
  if (checked.problems.length) return json({ error: 'problems', problems: checked.problems }, 422);

  const store = getStore();
  let current;
  try { current = await store.read(path); } catch { return json({ error: 'not an entry' }, 404); }
  if (current.version !== input?.version) return json({ error: 'conflict', paths: [path] }, 409);

  const [, , , trip, file] = path.split('/');
  const slug = file.replace(/\.mdx$/, '');
  let photos;
  try { photos = photoEdits(input?.photos, trip, slug, newBody); } catch (e) { return json({ error: (e as Error).message }, 400); }

  const { head, imported } = splitEntry(current.text);
  const { head: fm, rest } = splitFrontmatter(head);
  let nextFm = replaceLine(fm, 'title', JSON.stringify(title));
  if (typeof input?.draft === 'boolean') nextFm = replaceLine(nextFm, 'draft', String(input.draft));
  const text = joinEntry(nextFm + rest, newBody, [...new Set([...checked.components, ...imported])]);
  if (text === current.text && !photos.length) return json({ commit: null, versions: {} });

  const what = photos.length ? ` (+${photos.length} ${photos.length === 1 ? 'photo' : 'photos'})` : '';
  return commit(
    [...(text === current.text ? [] : [{ path, text, baseVersion: current.version }]), ...photos],
    `Edit entry ${trip}/${slug}: “${title}”${what}`, user?.author,
  );
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PHOTOS = 60;

/**
 * The photographs uploaded for this save: each must live in this entry's own
 * folder, carry an upload token, and actually appear in the text.
 */
function photoEdits(raw: unknown, trip: string, slug: string, body: string): Edit[] {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_PHOTOS) throw new Error(`at most ${MAX_PHOTOS} new photographs at a time`);
  const seen = new Set<string>();
  const out: Edit[] = [];
  for (const p of raw as { src?: unknown; token?: unknown }[]) {
    const src = String(p?.src ?? '');
    const prefix = `/photos/${trip}/${slug}/`;
    if (!src.startsWith(prefix)) throw new Error(`a photograph is outside this entry's folder: ${src}`);
    if (!body.includes(`src="${src}"`)) continue; // uploaded, then removed from the text: leave it out
    if (seen.has(src)) continue;
    seen.add(src);
    out.push({ path: `assets${src}`, staged: String(p?.token ?? ''), baseVersion: null });
  }
  return out;
}

async function commit(edits: Edit[], message: string, author?: Author) {
  try {
    return json(await getStore().write(edits, message, author));
  } catch (e) {
    if (e instanceof ConflictError) return json({ error: 'conflict', paths: e.paths }, 409);
    const msg = (e as Error).message;
    // Shape errors from the store (a bad photo path or token) are the request's fault.
    return json({ error: msg }, /^(not a photo path|photos can only|an edit needs|bad path)/.test(msg) ? 400 : 500);
  }
}

/** POST /api/admin/new — create an entry (and its photographs) in one commit. */
export const create: APIRoute = async ({ request }) => {
  const blocked = guard(request);
  if (blocked) return blocked;

  const user = HOSTED ? userOf(request) : null;
  if (user && (await countHit(`rl:save:${user.email}`, 3600)) > SAVES_PER_HOUR) {
    return json({ error: 'too many saves in the last hour — try again shortly' }, 429);
  }

  const input = await readJson(request);
  const trip = String(input?.trip ?? '');
  const slug = String(input?.slug ?? '');
  const title = String(input?.title ?? '').replace(/\s+/g, ' ').trim();
  const date = String(input?.date ?? '');
  const day = input?.day == null || input.day === '' ? null : Number(input.day);
  const authors = (['andy', 'beth'] as const).filter((a) => Array.isArray(input?.authors) && input.authors.includes(a));
  const newBody = typeof input?.body === 'string' ? input.body : null;

  if (!SLUG.test(trip)) return json({ error: 'choose a trip' }, 400);
  if (!SLUG.test(slug) || slug.length > 80) return json({ error: 'the web address can only use a–z, 0–9 and hyphens' }, 400);
  if (!title || title.length > 200) return json({ error: 'the title must be 1–200 characters' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return json({ error: 'the date is not a date' }, 400);
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 999)) return json({ error: 'the day must be a whole number' }, 400);
  if (!authors.length) return json({ error: 'choose who wrote it' }, 400);
  if (newBody == null || newBody.length > MAX_BODY || !newBody.trim()) return json({ error: 'write something first' }, 400);

  const checked = checkBody(newBody);
  if (checked.problems.length) return json({ error: 'problems', problems: checked.problems }, 422);

  const store = getStore();
  try { await store.read(`src/content/trips/${trip}.mdx`); } catch { return json({ error: 'that trip doesn’t exist' }, 400); }

  let photos;
  try { photos = photoEdits(input?.photos, trip, slug, newBody); } catch (e) { return json({ error: (e as Error).message }, 400); }

  const head = [
    '---',
    `title: ${JSON.stringify(title)}`,
    `trip: ${JSON.stringify(trip)}`,
    `day: ${day ?? 'null'}`,
    `date: ${date}`,
    `authors: ${JSON.stringify(authors).replace(/,/g, ', ')}`,
    'tags: []',
    'people: []',
    'bethCried: false',
    `draft: ${input?.draft === true}`,
    '---',
    '',
  ].join('\n');
  const path = `src/content/entries/${trip}/${slug}.mdx`;
  const text = joinEntry(head, newBody, checked.components);
  const what = photos.length ? ` (+${photos.length} ${photos.length === 1 ? 'photo' : 'photos'})` : '';
  const res = await commit([{ path, text, baseVersion: null }, ...photos], `New entry ${trip}/${slug}: “${title}”${what}`, user?.author);
  if (res.status !== 200) return res;
  return json({ ...(await res.json()), path, href: `/admin/entry/${trip}/${slug}` });
};
