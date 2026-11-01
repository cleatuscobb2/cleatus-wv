/**
 * GET  /api/admin/git — how many local commits are not yet published.
 * POST /api/admin/git — publish them (git push). Vercel redeploys on push.
 *
 * Pushing is kept as its own explicit action: committing saves the work on this
 * laptop, publishing puts it on the live site.
 */
import type { APIRoute } from 'astro';
import { gitPush, gitStatus } from '../store/fs-store.ts';
import { guard, json } from '../guard.ts';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const blocked = guard(request);
  if (blocked) return blocked;
  return json(await gitStatus(process.cwd()));
};

export const POST: APIRoute = async ({ request }) => {
  const blocked = guard(request);
  if (blocked) return blocked;
  try {
    const output = await gitPush(process.cwd());
    return json({ ok: true, output, ...(await gitStatus(process.cwd())) });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
};
