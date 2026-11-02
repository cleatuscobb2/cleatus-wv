/**
 * The prose editor's two endpoints (see mdx.ts for what is and isn't allowed):
 *
 *   POST /api/admin/preview  { body }                         → { problems, html }
 *   POST /api/admin/entry    { path, version, title, body }   → { commit, versions }
 *
 * Preview never writes. Save re-checks everything itself — it never trusts that
 * the page showed no problems — and refuses with the list if there are any, so
 * an entry that would break the build can't reach the repository.
 */
import type { APIRoute } from 'astro';
import { getStore, ConflictError } from '../store/index.ts';
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

  const { head, imported } = splitEntry(current.text);
  const { head: fm, rest } = splitFrontmatter(head);
  const nextHead = replaceLine(fm, 'title', JSON.stringify(title)) + rest;
  const text = joinEntry(nextHead, newBody, [...new Set([...checked.components, ...imported])]);
  if (text === current.text) return json({ commit: null, versions: {} });

  const slug = path.split('/').slice(-2).join('/').replace(/\.mdx$/, '');
  try {
    return json(await store.write([{ path, text, baseVersion: current.version }], `Edit entry ${slug}: “${title}”`, user?.author));
  } catch (e) {
    if (e instanceof ConflictError) return json({ error: 'conflict', paths: e.paths }, 409);
    return json({ error: (e as Error).message }, 500);
  }
};
