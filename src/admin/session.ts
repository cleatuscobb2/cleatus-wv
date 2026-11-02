/**
 * Sign-in links and sessions (ADMIN-PLAN.md §5).
 *
 * Both are the same kind of token — a small JSON claim signed with HMAC-SHA256
 * under SESSION_SECRET — distinguished by `k` so one can never stand in for the
 * other. Nothing is stored server-side except spent link nonces (see kv.ts).
 *
 * Every check also re-reads ADMIN_EMAILS, so taking an address out of that list
 * ends its sessions immediately, without waiting 30 days.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './mode.ts';
import type { Author } from './store/types.ts';

export const SESSION_COOKIE = '__Host-cw_session';
export const SESSION_DAYS = 30;
export const LINK_MINUTES = 15;

type Kind = 'session' | 'link';
interface Claims {
  k: Kind;
  /** Email, normalised. */
  e: string;
  /** Expiry, ms since epoch. */
  x: number;
  /** Nonce — links only, so each can be spent once. */
  n?: string;
}

function secret(): Buffer {
  const s = env('SESSION_SECRET');
  if (!s || s.length < 32) throw new Error('SESSION_SECRET is missing or shorter than 32 characters');
  return Buffer.from(s, 'utf8');
}

const mac = (body: string) => createHmac('sha256', secret()).update(body).digest();

function sign(c: Claims): string {
  const body = Buffer.from(JSON.stringify(c)).toString('base64url');
  return `${body}.${mac(body).toString('base64url')}`;
}

export function verify(token: string | null | undefined, kind: Kind): Claims | null {
  if (!token || token.length > 1024) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const want = mac(body);
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;

  let c: Claims;
  try { c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (c.k !== kind || typeof c.e !== 'string' || typeof c.x !== 'number') return null;
  if (c.x < Date.now() || !isAllowed(c.e)) return null;
  return c;
}

export const normalise = (email: string) => email.trim().toLowerCase();

export function isAllowed(email: string): boolean {
  const list = (env('ADMIN_EMAILS') ?? '').split(',').map(normalise).filter(Boolean);
  return list.includes(normalise(email));
}

export function linkToken(email: string): string {
  return sign({
    k: 'link',
    e: normalise(email),
    x: Date.now() + LINK_MINUTES * 60_000,
    n: randomBytes(16).toString('base64url'),
  });
}

export function sessionCookie(email: string): string {
  const token = sign({ k: 'session', e: normalise(email), x: Date.now() + SESSION_DAYS * 86_400_000 });
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;
}

export const clearedCookie = () => `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export interface User {
  email: string;
  /** First name, for the admin bar. */
  name: string;
  /** Who the commit says wrote the change. */
  author: Author;
}

/*
 * Commit identities. The repo is public, so the author address written into its
 * history is a display address, never the one a sign-in link is mailed to —
 * except Andy's, which is already on every commit he has made here. Beth's real
 * address appears nowhere in this repo; it lives only in the BETH_EMAIL and
 * ADMIN_EMAILS env vars.
 *
 * Anyone recognised as neither is credited to the website itself: better an
 * honest "Site admin" in the history than the wrong person's name.
 */
const ANDY: Author = { name: 'Andrew Tisdale', email: 'cleatus.cobb@gmail.com' };
const BETH: Author = { name: 'Beth Tisdale', email: 'beth@cleatusandthewestvirginian.com' };
const SITE: Author = { name: 'Site admin', email: 'admin@cleatusandthewestvirginian.com' };

/** Gmail ignores dots and +tags, so compare the mailbox rather than the spelling. */
export function mailbox(email: string): string {
  const e = normalise(email);
  const at = e.lastIndexOf('@');
  if (at < 0) return e;
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  if (domain !== 'gmail.com' && domain !== 'googlemail.com') return e;
  return `${local.split('+')[0].replace(/\./g, '')}@gmail.com`;
}

export function userFor(email: string): User {
  const e = normalise(email);
  const box = mailbox(e);
  if (box === mailbox(ANDY.email)) return { email: e, name: 'Andy', author: ANDY };
  const beth = env('BETH_EMAIL');
  if (beth && box === mailbox(beth)) return { email: e, name: 'Beth', author: BETH };
  return { email: e, name: e, author: SITE };
}

export function currentUser(request: Request): User | null {
  const c = verify(readCookie(request, SESSION_COOKIE), 'session');
  return c ? userFor(c.e) : null;
}
