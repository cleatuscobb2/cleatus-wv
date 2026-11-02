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

// ---- general pipeline (the readers counter) ---------------------------------

type Cmd = (string | number)[];
const hashes = new Map<string, Map<string, number>>();
const sets = new Map<string, Set<string>>();

/** The handful of commands the readers counter uses, for `astro dev` without Upstash. */
function memoryRun([op, key, ...args]: Cmd): unknown {
  const k = String(key);
  switch (String(op).toUpperCase()) {
    case 'HINCRBY': {
      const h = hashes.get(k) ?? new Map<string, number>();
      h.set(String(args[0]), (h.get(String(args[0])) ?? 0) + Number(args[1]));
      hashes.set(k, h);
      return h.get(String(args[0]));
    }
    case 'HGETALL': return [...(hashes.get(k) ?? new Map())].flat().map(String);
    case 'PFADD': {
      const s = sets.get(k) ?? new Set<string>();
      const before = s.size;
      for (const a of args) s.add(String(a));
      sets.set(k, s);
      return s.size > before ? 1 : 0;
    }
    case 'PFCOUNT': {
      const all = new Set<string>();
      for (const name of [k, ...args.map(String)]) for (const v of sets.get(name) ?? []) all.add(v);
      return all.size;
    }
    case 'EXPIRE': return 1;
    default: throw new Error(`memory store doesn't do ${op}`);
  }
}

/** Runs several commands in one round trip; returns each one's result in order. */
export async function kvPipeline(cmds: Cmd[]): Promise<unknown[]> {
  if (!cmds.length) return [];
  if (!rest()) return cmds.map(memoryRun);
  const out = (await call('/pipeline', cmds.map((c) => c.map(String)))) as { result?: unknown; error?: string }[];
  const failed = out.find((r) => r.error);
  if (failed) throw new Error(`Upstash: ${failed.error}`);
  return out.map((r) => r.result);
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
