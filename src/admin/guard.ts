/**
 * Every admin request passes through here first.
 *
 * Phase A runs on localhost, but "only reachable locally" is not the same as
 * "only reachable by you": any website open in the same browser can try to send
 * a request to localhost. Writes therefore require a custom header — which a
 * cross-site form cannot set, and which makes the browser ask permission first
 * for scripted requests — and a matching Origin.
 */
export const ADMIN_HEADER = 'x-cleatus-admin';

export function guard(request: Request): Response | null {
  // Belt and braces: the routes are never built, but if they ever were,
  // they would answer as if they did not exist.
  if (!import.meta.env.DEV) return new Response(null, { status: 404 });

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (request.headers.get(ADMIN_HEADER) !== '1') {
      return new Response('forbidden', { status: 403 });
    }
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== new URL(request.url).host) {
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
