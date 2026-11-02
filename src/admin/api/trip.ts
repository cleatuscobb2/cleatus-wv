/**
 * POST /api/admin/trip — save one trip's summary, names, dates, countries,
 * hero and "start here" as one commit.
 *
 * Body: { id, version, edit: TripEdit }
 *
 * The hero is checked against this trip's own photographs and "start here"
 * against its own entries, read fresh from the store — not trusted from the page.
 */
import type { APIRoute } from 'astro';
import { getStore, ConflictError } from '../store/index.ts';
import { applyTripEdit, photosIn, readTrip, validateTripEdit, type TripMetaRead } from '../trip-edit.ts';
import { guard, json, userOf } from '../guard.ts';
import { HOSTED } from '../mode.ts';
import { countHit } from '../kv.ts';

export const prerender = false;

const TRIP_ID = /^[a-z0-9-]+$/;
const SAVES_PER_HOUR = 60;

const LABELS: Partial<Record<keyof TripMetaRead, string>> = {
  summary: 'summary', title: 'title', shortTitle: 'short title', dateStart: 'dates', dateEnd: 'dates',
  countries: 'countries', regions: 'regions', hero: 'hero', startHere: 'start here',
  summaryNeedsReview: 'summary status',
};

export const POST: APIRoute = async ({ request }) => {
  const blocked = guard(request);
  if (blocked) return blocked;

  const user = HOSTED ? userOf(request) : null;
  if (user && (await countHit(`rl:save:${user.email}`, 3600)) > SAVES_PER_HOUR) {
    return json({ error: 'too many saves in the last hour — try again shortly' }, 429);
  }

  let body: { id?: unknown; version?: unknown; edit?: unknown };
  try { body = await request.json(); } catch { return json({ error: 'expected JSON' }, 400); }
  const id = String(body.id ?? '');
  if (!TRIP_ID.test(id)) return json({ error: 'not a trip' }, 400);
  const path = `src/content/trips/${id}.mdx`;

  const store = getStore();
  let current;
  try { current = await store.read(path); } catch { return json({ error: 'not a trip' }, 404); }
  if (current.version !== body.version) return json({ error: 'conflict', paths: [path] }, 409);

  const entryPaths = (await store.list('src/content/entries', '.mdx')).filter((p) => p.startsWith(`src/content/entries/${id}/`));
  const texts = await Promise.all(entryPaths.map(async (p) => (await store.read(p)).text));
  const ctx = {
    photos: texts.flatMap(photosIn),
    entrySlugs: entryPaths.map((p) => p.split('/').pop()!.replace(/\.mdx$/, '')),
    currentHero: readTrip(current.text).hero,
  };

  let edit;
  try { edit = validateTripEdit(body.edit, ctx); } catch (e) { return json({ error: (e as Error).message }, 400); }

  const before = readTrip(current.text);
  const text = applyTripEdit(current.text, edit);
  if (text === current.text) return json({ commit: null, versions: {} });

  const after = readTrip(text);
  const changed = [...new Set(
    (Object.keys(LABELS) as (keyof TripMetaRead)[])
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      .map((k) => LABELS[k]!),
  )];
  const message = `Edit trip ${after.shortTitle}: ${changed.join(', ') || 'mark as edited'}`;

  try {
    return json(await store.write([{ path, text, baseVersion: current.version }], message, user?.author));
  } catch (e) {
    if (e instanceof ConflictError) return json({ error: 'conflict', paths: e.paths }, 409);
    return json({ error: (e as Error).message }, 500);
  }
};
