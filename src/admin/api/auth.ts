/**
 * Email sign-in (ADMIN-PLAN.md §5). Three plain form posts, so they work with
 * no JavaScript at all:
 *
 *   POST /api/auth/request  { email }  → emails a one-time link
 *   POST /api/auth/verify   { t }      → spends the link, sets the session
 *   POST /api/auth/signout             → clears the session
 *
 * The link opens /admin/verify, a page with a "Sign in" button, rather than
 * signing in on the GET itself: mail scanners follow links in emails, and would
 * otherwise spend a single-use link before the person ever clicked it.
 */
import type { APIRoute } from 'astro';
import { HOSTED, siteOrigin } from '../mode.ts';
import { notFound, redirect, sameOrigin } from '../guard.ts';
import { clearedCookie, isAllowed, linkToken, LINK_MINUTES, normalise, sessionCookie, verify } from '../session.ts';
import { claimOnce, countHit } from '../kv.ts';
import { sendSignInLink } from '../mail.ts';

export const prerender = false;

const LINKS_PER_ADDRESS_PER_HOUR = 5;
const REQUESTS_PER_IP_PER_HOUR = 20;

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function form(request: Request) {
  return request.formData().catch(() => null);
}

export const requestLink: APIRoute = async ({ request, clientAddress }) => {
  if (!HOSTED) return notFound();
  if (!sameOrigin(request)) return new Response('forbidden', { status: 403 });

  const email = normalise(String((await form(request))?.get('email') ?? '')).slice(0, 254);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return redirect('/admin?m=bad');

  let ip = 'unknown';
  try { ip = clientAddress; } catch { /* not available in every runtime */ }
  if ((await countHit(`rl:ip:${ip}`, 3600)) > REQUESTS_PER_IP_PER_HOUR) return redirect('/admin?m=sent');

  // The answer is the same whether or not the address may sign in, and roughly
  // as slow, so the form can't be used to discover which addresses work.
  if (!isAllowed(email)) {
    await pause(300 + Math.random() * 400);
    return redirect('/admin?m=sent');
  }
  if ((await countHit(`rl:addr:${email}`, 3600)) > LINKS_PER_ADDRESS_PER_HOUR) return redirect('/admin?m=sent');

  try {
    await sendSignInLink(email, `${siteOrigin(request)}/admin/verify?t=${linkToken(email)}`);
  } catch (err) {
    console.error('[admin] sending sign-in link failed:', err);
    return redirect('/admin?m=sendfail');
  }
  return redirect('/admin?m=sent');
};

export const verifyLink: APIRoute = async ({ request }) => {
  if (!HOSTED) return notFound();
  if (!sameOrigin(request)) return new Response('forbidden', { status: 403 });

  const claims = verify(String((await form(request))?.get('t') ?? ''), 'link');
  if (!claims?.n) return redirect('/admin?m=expired');
  // Single use: the first click claims the nonce; any later one is refused.
  if (!(await claimOnce(`nonce:${claims.n}`, LINK_MINUTES * 60 + 60))) return redirect('/admin?m=used');

  return redirect('/admin', sessionCookie(claims.e));
};

export const signOut: APIRoute = async ({ request }) => {
  if (!HOSTED) return notFound();
  if (!sameOrigin(request)) return new Response('forbidden', { status: 403 });
  return redirect('/admin?m=out', clearedCookie());
};
