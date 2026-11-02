/**
 * Readers' comments (ADMIN-PLAN.md §7b): public, and default-deny.
 *
 * A submission lands in a pending queue in Upstash and nowhere else. Nothing a
 * stranger writes reaches the site until one of you approves it in
 * /admin/comments — the two of you can be on a glacier for six weeks, and
 * anything that published on submission would sit there in public meanwhile.
 * Approval commits the comment as a JSON file beside the entry.
 *
 * What is kept about a commenter: the name they typed and what they wrote. No
 * email, no address, no identifier.
 */
import { getCollection } from 'astro:content';
import { claimOnce, countHit, kvPipeline } from './kv.ts';
import { env } from './mode.ts';
import { sendMail } from './mail.ts';

export const PENDING_KEY = 'cm:pending';
const MAX_PENDING = 300;
const PER_IP_PER_HOUR = 5;
/** A person needs at least this long to read a page and write anything. */
const MIN_FILL_MS = 3000;

export const NAME_MAX = 60;
export const BODY_MAX = 4000;

export interface Pending {
  id: string;
  /** `trip/entry-slug` */
  entry: string;
  name: string;
  body: string;
  /** ISO time it was sent. */
  date: string;
}

export type Outcome = 'sent' | 'later' | 'invalid';

const clean = (s: unknown, max: number) =>
  String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max + 1);

/** `20261102-031500-x7k2`: sortable, unique enough, nothing personal in it. */
function newId(now: Date) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15).toLowerCase();
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Cloudflare Turnstile, when its secret is configured. */
async function humanCheck(token: string, ip: string): Promise<boolean> {
  const secret = env('TURNSTILE_SECRET_KEY');
  if (!secret) return true;
  if (!token) return false;
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) }),
  }).catch(() => null);
  const out = (await res?.json().catch(() => null)) as { success?: boolean } | null;
  return !!out?.success;
}

export interface Submission {
  entry: unknown;
  name: unknown;
  body: unknown;
  /** Hidden field real people leave empty. */
  website: unknown;
  /** When the form became usable (ms), set by the page; absent without JavaScript. */
  t: unknown;
  turnstile: unknown;
  ip: string;
}

/**
 * Queues a comment for approval. 'sent' for anything that looks like a bot too —
 * there is no point telling one what gave it away.
 */
export async function submit(s: Submission, now = new Date()): Promise<Outcome> {
  if (String(s.website ?? '').trim()) return 'sent';
  const t = Number(s.t);
  if (s.t && Number.isFinite(t) && now.getTime() - t < MIN_FILL_MS) return 'sent';

  const entry = String(s.entry ?? '');
  const name = clean(s.name, NAME_MAX);
  const body = clean(s.body, BODY_MAX);
  if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(entry)) return 'invalid';
  if (!name || name.length > NAME_MAX || !body || body.length > BODY_MAX) return 'invalid';

  const published = await getCollection('entries', ({ data }) => !data.draft);
  if (!published.some((e) => `${e.data.trip.id}/${e.id.split('/').pop()}` === entry)) return 'invalid';

  if (!(await humanCheck(String(s.turnstile ?? ''), s.ip))) return 'invalid';
  if ((await countHit(`rl:comment:${s.ip}`, 3600)) > PER_IP_PER_HOUR) return 'later';
  const [queued] = (await kvPipeline([['HLEN', PENDING_KEY]])) as number[];
  if (Number(queued) >= MAX_PENDING) return 'later';

  const p: Pending = { id: newId(now), entry, name, body, date: now.toISOString() };
  await kvPipeline([['HSET', PENDING_KEY, p.id, JSON.stringify(p)]]);
  await notify(p).catch((e) => console.error('[comments] notification failed:', (e as Error).message));
  return 'sent';
}

/** At most one email an hour, so a burst of comments is one nudge, not twenty. */
async function notify(p: Pending) {
  if (!(await claimOnce('cm:notified', 3600))) return;
  const to = (env('ADMIN_EMAILS') ?? '').split(',').map((e) => e.trim()).filter(Boolean);
  if (!to.length) return;
  const site = 'https://cleatusandthewestvirginian.com';
  await sendMail(to, 'A comment is waiting for you', [
    `${p.name} left a comment on ${site}/${p.entry}/ :`,
    '',
    p.body.length > 400 ? `${p.body.slice(0, 400)}…` : p.body,
    '',
    `Read it and publish or delete it at ${site}/admin/comments`,
    '(More may arrive this hour without another email.)',
  ].join('\n'));
}

export async function pending(): Promise<Pending[]> {
  const [flat] = (await kvPipeline([['HGETALL', PENDING_KEY]])) as string[][];
  const out: Pending[] = [];
  for (let i = 0; i < (flat ?? []).length; i += 2) {
    try { out.push(JSON.parse(flat[i + 1])); } catch { /* a damaged record: skip it */ }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export async function dropPending(ids: string[]) {
  if (ids.length) await kvPipeline([['HDEL', PENDING_KEY, ...ids]]);
}

/** Where an approved comment is committed. */
export const commentPath = (p: { entry: string; id: string }) => `src/content/comments/${p.entry}/${p.id}.json`;

/** The committed file: what the site shows, nothing more. */
export const commentFile = (p: Pending) =>
  `${JSON.stringify({ entry: p.entry, name: p.name, date: p.date, body: p.body }, null, 2)}\n`;
