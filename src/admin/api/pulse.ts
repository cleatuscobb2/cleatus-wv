/**
 * POST /api/pulse — a public page reporting its time, depth, clicks and speed.
 *
 * Public on purpose, like /api/hit: every reader's browser calls it, it always
 * answers 204 with nothing in it, and it counts only same-site requests from
 * browsers that haven't asked not to be tracked. Your own signed-in visits aren't
 * counted. See pulse.ts for what is kept.
 */
import type { APIRoute } from 'astro';
import { recordPulse } from '../pulse.ts';
import { sameOrigin, userOf } from '../guard.ts';
import { HOSTED } from '../mode.ts';

export const prerender = false;

const done = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return done();
  if (request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1') return done();
  if (HOSTED && userOf(request)) return done();

  const raw = await request.text().catch(() => '');
  if (raw.length > 8000) return done();
  let body;
  try { body = JSON.parse(raw); } catch { return done(); }

  let ip = '';
  try { ip = clientAddress; } catch { /* not available in every runtime */ }
  try {
    await recordPulse(body, request.headers.get('user-agent') ?? '', ip);
  } catch (e) {
    console.error('[pulse] not counted:', (e as Error).message);
  }
  return done();
};
