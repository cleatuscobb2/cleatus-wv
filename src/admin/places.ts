/**
 * The hand-added places file (src/content/places/visited.json): checking what
 * the /admin/places page sends, and writing it back one place per line so a
 * commit's diff shows exactly which places came and went.
 */
import { COUNTRY_NAMES } from '../data/trip-meta.ts';
import { placeId, type HandPlace } from '../lib/places.ts';

export const PLACES_PATH = 'src/content/places/visited.json';
const MAX = 2000;
const WHEN = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
const ID = /^[a-z0-9-]{1,80}$/;
const round = (x: number) => Math.round(x * 10000) / 10000;

export function parsePlaces(text: string): HandPlace[] {
  const out = JSON.parse(text || '[]');
  if (!Array.isArray(out)) throw new Error(`${PLACES_PATH} is not a list`);
  return out as HandPlace[];
}

export function validatePlaces(raw: unknown): HandPlace[] {
  if (!Array.isArray(raw)) throw new Error('expected a list of places');
  if (raw.length > MAX) throw new Error(`at most ${MAX} places`);
  const taken = new Set<string>();
  return raw.map((r, i) => {
    const p = (r ?? {}) as Record<string, unknown>;
    const where = `place ${i + 1}`;
    const name = String(p.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 80) throw new Error(`${where}: needs a name of up to 80 characters`);
    const country = String(p.country ?? '').toUpperCase();
    if (!COUNTRY_NAMES[country]) throw new Error(`${where} (${name}): unknown country "${country}"`);
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      throw new Error(`${where} (${name}): bad position`);
    }
    const when = p.when == null || p.when === '' ? undefined : String(p.when);
    if (when && !WHEN.test(when)) throw new Error(`${where} (${name}): when should be YYYY or YYYY-MM`);
    const note = p.note == null ? '' : String(p.note).replace(/\s+/g, ' ').trim();
    if (note.length > 140) throw new Error(`${where} (${name}): note is over 140 characters`);
    const given = typeof p.id === 'string' && ID.test(p.id) && !taken.has(p.id) ? p.id : null;
    const id = given ?? placeId(name, country, taken);
    taken.add(id);
    const dived = p.dived === true;
    return {
      id, name, country, lat: round(lat), lng: round(lng),
      ...(when ? { when } : {}), ...(note ? { note } : {}), ...(dived ? { dived } : {}),
    };
  });
}

/** One place per line, sorted by country then name. */
export function serializePlaces(places: HandPlace[]): string {
  const sorted = [...places].sort((a, b) => a.country.localeCompare(b.country) || a.name.localeCompare(b.name));
  if (!sorted.length) return '[\n]\n';
  return `[\n${sorted.map((p) => `  ${JSON.stringify(p)}`).join(',\n')}\n]\n`;
}
