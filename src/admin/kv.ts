/**
 * The two Redis operations the hosted admin needs, over Upstash's REST API —
 * no client library. Connected through the Vercel Marketplace, which supplies
 * KV_REST_API_URL and KV_REST_API_TOKEN.
 *
 * Under `astro dev` without those variables it falls back to memory, so the
 * sign-in flow can be tested locally. In production a missing store is an error,
 * never a silent fallback: single-use links depend on it.
 */
import { env } from './mode.ts';

const memory = new Map<string, { value: number; until: number }>();

function rest(): { url: string; token: string } | null {
  const url = env('KV_REST_API_URL');
  const token = env('KV_REST_API_TOKEN');
  if (url && token) return { url, token };
  if (import.meta.env?.DEV) return null;
  throw new Error('KV_REST_API_URL / KV_REST_API_TOKEN are not set');
}

async function call(path: string, body: unknown) {
  const { url, token } = rest()!;
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}: ${await res.text()}`);
  return res.json();
}

function memoryGet(key: string) {
  const hit = memory.get(key);
  if (hit && hit.until < Date.now()) memory.delete(key);
  return memory.get(key);
}

/** Records `key` for `seconds`. True the first time, false if it was already there. */
export async function claimOnce(key: string, seconds: number): Promise<boolean> {
  if (!rest()) {
    if (memoryGet(key)) return false;
    memory.set(key, { value: 1, until: Date.now() + seconds * 1000 });
    return true;
  }
  const out = await call('', ['SET', key, '1', 'NX', 'EX', String(seconds)]);
  return out.result === 'OK';
}

/** Counts a hit in a fixed window of `seconds`; returns the count so far. */
export async function countHit(key: string, seconds: number): Promise<number> {
  if (!rest()) {
    const cur = memoryGet(key) ?? { value: 0, until: Date.now() + seconds * 1000 };
    cur.value++;
    memory.set(key, cur);
    return cur.value;
  }
  const out = await call('/pipeline', [
    ['SET', key, '0', 'EX', String(seconds), 'NX'],
    ['INCR', key],
  ]);
  return Number(out[1].result);
}
