/**
 * POST /api/hit — the public pages' beacon (`{ p: path, r: referrer }`).
 *
 * Public on purpose: every reader's browser calls it. It always answers 204 with
 * nothing in it, counted or not, and counts only same-site requests from
 * browsers that haven't asked not to be tracked (Global Privacy Control / DNT).
 * See readers.ts for what is and isn't kept.
 */
import type { APIRoute } from 'astro';
import { recordHit } from '../readers.ts';
import { sameOrigin } from '../guard.ts';

export const prerender = false;

const done = () => new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return done();
  if (request.headers.get('sec-gpc') === '1' || request.headers.get('dnt') === '1') return done();

  const raw = await request.text().catch(() => '');
  if (raw.length > 2000) return done();
  let hit: { p?: unknown; r?: unknown };
  try { hit = JSON.parse(raw); } catch { return done(); }

  let ip = '';
  try { ip = clientAddress; } catch { /* not available in every runtime */ }
  try {
    await recordHit({
      path: String(hit.p ?? ''),
      referrer: String(hit.r ?? ''),
      country: request.headers.get('x-vercel-ip-country') ?? '',
      ua: request.headers.get('user-agent') ?? '',
      ip,
    });
  } catch (e) {
    // Counting must never break a reader's page; just note it.
    console.error('[readers] not counted:', (e as Error).message);
  }
  return done();
};
