/**
 * POST /api/admin/curate — save a batch of tag / bethCried / byline changes as
 * one commit.
 *
 * Body: { message, changes: [{ path, version, tags, bethCried, authors }] }
 *
 * Refuses the whole batch if any file changed on disk since the page loaded it,
 * and reports which ones, so nothing is silently overwritten.
 */
import type { APIRoute } from 'astro';
import { getStore, ConflictError } from '../store/index.ts';
import { applyCuration, validateCuration } from '../frontmatter.ts';
import { guard, json } from '../guard.ts';

export const prerender = false;

const MAX_CHANGES = 400;
// The exact shape of every entry path — no `..`, no other folders.
const ENTRY_PATH = /^src\/content\/entries\/[a-z0-9-]+\/[a-z0-9-]+\.mdx$/;

export const POST: APIRoute = async ({ request }) => {
  const blocked = guard(request);
  if (blocked) return blocked;

  let body: { message?: unknown; changes?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'expected JSON' }, 400); }

  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 4000) : '';
  const changes = Array.isArray(body.changes) ? body.changes : null;
  if (!message) return json({ error: 'a commit message is required' }, 400);
  if (!changes?.length) return json({ error: 'no changes' }, 400);
  if (changes.length > MAX_CHANGES) return json({ error: 'too many changes in one batch' }, 400);

  const store = getStore();
  const edits = [];
  const stale: string[] = [];

  for (const raw of changes as Record<string, unknown>[]) {
    const path = String(raw.path ?? '');
    if (!ENTRY_PATH.test(path)) {
      return json({ error: `not an entry: ${path}` }, 400);
    }
    let curation;
    try { curation = validateCuration(raw); } catch (e) {
      return json({ error: `${path}: ${(e as Error).message}` }, 400);
    }

    const current = await store.read(path);
    if (current.version !== raw.version) { stale.push(path); continue; }

    const text = applyCuration(current.text, curation);
    if (text !== current.text) edits.push({ path, text, baseVersion: current.version });
  }

  if (stale.length) return json({ error: 'conflict', paths: stale }, 409);
  if (!edits.length) return json({ commit: null, versions: {} });

  try {
    const result = await store.write(edits, message);
    return json(result);
  } catch (e) {
    if (e instanceof ConflictError) return json({ error: 'conflict', paths: e.paths }, 409);
    return json({ error: (e as Error).message }, 500);
  }
};
