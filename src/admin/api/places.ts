/**
 * POST /api/admin/places — replace the hand-added places with the list the
 * page sends, as one commit.
 *
 * Body: { version, places: HandPlace[] }
 *
 * The page geocodes in the browser (Nominatim); this only checks the shape and
 * that every country is a real one, then writes the file.
 */
import type { APIRoute } from 'astro';
import { getStore, ConflictError } from '../store/index.ts';
import { guard, json, userOf } from '../guard.ts';
import { HOSTED } from '../mode.ts';
import { countHit } from '../kv.ts';
import { PLACES_PATH, parsePlaces, serializePlaces, validatePlaces } from '../places.ts';

export const prerender = false;

const SAVES_PER_HOUR = 60;

export const POST: APIRoute = async ({ request }) => {
  const blocked = guard(request);
  if (blocked) return blocked;

  const user = HOSTED ? userOf(request) : null;
  if (user && (await countHit(`rl:save:${user.email}`, 3600)) > SAVES_PER_HOUR) {
    return json({ error: 'too many saves in the last hour — try again shortly' }, 429);
  }

  let body: { version?: unknown; places?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'expected JSON' }, 400); }

  const store = getStore();
  const current = await store.read(PLACES_PATH).catch(() => null);
  if ((current?.version ?? null) !== (body.version ?? null)) return json({ error: 'conflict', paths: [PLACES_PATH] }, 409);

  let places;
  try { places = validatePlaces(body.places); } catch (e) { return json({ error: (e as Error).message }, 400); }

  const text = serializePlaces(places);
  if (current && text === current.text) return json({ commit: null, versions: {} });

  const before = new Set(current ? parsePlaces(current.text).map((p) => p.id) : []);
  const after = new Set(places.map((p) => p.id));
  const added = places.filter((p) => !before.has(p.id)).map((p) => p.name);
  const removed = [...before].filter((id) => !after.has(id)).length;
  const parts = [
    added.length ? `add ${added.length <= 3 ? added.join(', ') : `${added.length} places`}` : '',
    removed ? `remove ${removed}` : '',
  ].filter(Boolean);
  const message = `Map places: ${parts.join('; ') || 'edit'}`;

  try {
    return json(await store.write([{ path: PLACES_PATH, text, baseVersion: current?.version ?? null }], message, user?.author));
  } catch (e) {
    if (e instanceof ConflictError) return json({ error: 'conflict', paths: e.paths }, 409);
    return json({ error: (e as Error).message }, 500);
  }
};
