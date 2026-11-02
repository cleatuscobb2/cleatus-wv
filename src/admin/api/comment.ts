/**
 * POST /api/comment — a reader's comment, from the form under every entry.
 *
 * Public. Works as a plain form post with no JavaScript (answers with a redirect
 * back to the entry, to an anchor that shows the outcome), and as a fetch from
 * the page's small script (answers JSON, so the text survives an error).
 * Everything else is in comments.ts.
 */
import type { APIRoute } from 'astro';
import { submit, type Outcome } from '../comments.ts';
import { sameOrigin } from '../guard.ts';

export const prerender = false;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!sameOrigin(request)) return new Response('forbidden', { status: 403 });

  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
  const form = await request.formData().catch(() => null);
  const entry = String(form?.get('entry') ?? '');

  let ip = '';
  try { ip = clientAddress; } catch { /* not available in every runtime */ }

  let outcome: Outcome;
  try {
    outcome = await submit({
      entry,
      name: form?.get('name'),
      body: form?.get('body'),
      website: form?.get('website'),
      t: form?.get('t'),
      turnstile: form?.get('cf-turnstile-response'),
      ip,
    });
  } catch (e) {
    console.error('[comments] submission failed:', (e as Error).message);
    outcome = 'later';
  }

  if (wantsJson) {
    return new Response(JSON.stringify({ outcome }), {
      status: outcome === 'sent' ? 200 : outcome === 'later' ? 429 : 400,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }
  const back = /^[a-z0-9-]+\/[a-z0-9-]+$/.test(entry) ? `/${entry}/` : '/';
  return new Response(null, { status: 303, headers: { location: `${back}#comment-${outcome}`, 'cache-control': 'no-store' } });
};
