/**
 * POST /api/admin/photo — upload one photograph (the raw JPEG bytes as the body).
 *
 * The browser resizes and re-encodes before sending, so each fits under
 * Vercel's request limit. Here the bytes are checked to be a real JPEG and every
 * metadata segment is cut out (jpeg.ts) — EXIF can hold the GPS position of
 * where a photo was taken, and these files are public. The cleaned photo is
 * staged, not committed: it lands in the repository only when the entry that
 * uses it is saved, in the same commit.
 *
 * → { token, width, height, bytes }
 */
import type { APIRoute } from 'astro';
import { getStore } from '../store/index.ts';
import { cleanJpeg, MAX_PHOTO_BYTES } from '../jpeg.ts';
import { guard, json, userOf } from '../guard.ts';
import { HOSTED } from '../mode.ts';
import { countHit } from '../kv.ts';

export const prerender = false;

const UPLOADS_PER_HOUR = 300;

export const POST: APIRoute = async ({ request }) => {
  const blocked = guard(request);
  if (blocked) return blocked;

  const user = HOSTED ? userOf(request) : null;
  if (user && (await countHit(`rl:photo:${user.email}`, 3600)) > UPLOADS_PER_HOUR) {
    return json({ error: 'too many photographs in the last hour — try again shortly' }, 429);
  }

  if (Number(request.headers.get('content-length') ?? 0) > MAX_PHOTO_BYTES) {
    return json({ error: 'that photograph is too large even after shrinking' }, 413);
  }
  let photo;
  try {
    photo = cleanJpeg(new Uint8Array(await request.arrayBuffer()));
  } catch (e) {
    return json({ error: `that file isn't a photograph the site can use (${(e as Error).message})` }, 400);
  }

  try {
    const token = await getStore().stage(photo.bytes);
    return json({ token, width: photo.width, height: photo.height, bytes: photo.bytes.length });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
};
