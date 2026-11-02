/**
 * Every admin request passes through here first.
 *
 * Hosted: no valid session means 404 — not 401 — so the admin doesn't announce
 * itself. Local: only ever answers under `astro dev`.
 *
 * Either way, "signed in" or "on localhost" is not the same as "it was you":
 * any website open in the same browser can try to send a request. Writes
 * therefore require a custom header — which a cross-site form cannot set, and
 * which makes the browser ask permission first for scripted requests — and a
 * matching Origin.
 */
import { HOSTED } from './mode.ts';
import { currentUser, type User } from './session.ts';

export const ADMIN_HEADER = 'x-cleatus-admin';

export const notFound = () =>
  new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });

export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  try {
    return !!origin && new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/** The signed-in person, or null — including when sign-in isn't configured at all. */
export function userOf(request: Request): User | null {
  try {
    return currentUser(request);
  } catch {
    return null;
  }
}

export function guard(request: Request): Response | null {
  if (HOSTED) {
    if (!userOf(request)) return notFound();
  } else if (!import.meta.env.DEV) {
    return notFound();
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (request.headers.get(ADMIN_HEADER) !== '1' || !sameOrigin(request)) {
      return new Response('forbidden', { status: 403 });
    }
  }
  return null;
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export const redirect = (location: string, cookie?: string) =>
  new Response(null, {
    status: 303,
    headers: { location, 'cache-control': 'no-store', ...(cookie ? { 'set-cookie': cookie } : {}) },
  });
