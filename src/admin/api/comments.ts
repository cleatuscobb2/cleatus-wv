/**
 * POST /api/admin/comments — moderate readers' comments.
 *
 *   { action: 'publish', ids }        commit these pending comments (one commit), then drop them from the queue
 *   { action: 'delete',  ids }        drop these pending comments; nothing is kept
 *   { action: 'remove',  path, version }  take down a published comment (a commit that deletes its file)
 */
import type { APIRoute } from 'astro';
import { getStore, ConflictError } from '../store/index.ts';
import { commentFile, commentPath, dropPending, pending } from '../comments.ts';
import { guard, json, userOf } from '../guard.ts';
import { HOSTED } from '../mode.ts';
import { COMMENT_PATH } from '../store/types.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const blocked = guard(request);
  if (blocked) return blocked;
  const author = HOSTED ? userOf(request)?.author : undefined;

  let body: { action?: unknown; ids?: unknown; path?: unknown; version?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'expected JSON' }, 400); }
  const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : [];

  try {
    if (body.action === 'delete') {
      await dropPending(ids);
      return json({ deleted: ids.length });
    }

    if (body.action === 'publish') {
      const chosen = (await pending()).filter((p) => ids.includes(p.id));
      if (!chosen.length) return json({ commit: null, published: 0 });
      const n = chosen.length;
      const result = await getStore().write(
        chosen.map((p) => ({ path: commentPath(p), text: commentFile(p), baseVersion: null })),
        `Publish ${n} ${n === 1 ? 'comment' : 'comments'} (${[...new Set(chosen.map((p) => p.entry))].join(', ')})`,
        author,
      );
      // Only once they are safely committed.
      await dropPending(chosen.map((p) => p.id));
      return json({ commit: result.commit, published: n });
    }

    if (body.action === 'remove') {
      const path = String(body.path ?? '');
      if (!COMMENT_PATH.test(path)) return json({ error: 'not a comment' }, 400);
      const result = await getStore().write(
        [{ path, remove: true, baseVersion: String(body.version ?? '') }],
        `Remove comment ${path.replace(/^src\/content\/comments\//, '')}`,
        author,
      );
      return json({ commit: result.commit });
    }
  } catch (e) {
    if (e instanceof ConflictError) return json({ error: 'conflict', paths: e.paths }, 409);
    return json({ error: (e as Error).message }, 500);
  }
  return json({ error: 'unknown action' }, 400);
};
