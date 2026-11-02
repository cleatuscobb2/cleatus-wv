/**
 * Sends the sign-in email through Resend's REST API. The domain is verified in
 * Resend (DKIM on resend._domainkey, return path on send.), so mail comes from
 * the site's own address and Gmail trusts it.
 *
 * Under `astro dev` without RESEND_API_KEY the link is printed to the dev
 * server's log instead.
 */
import { env } from './mode.ts';
import { LINK_MINUTES } from './session.ts';

const FROM = 'Cleatus & the West Virginian <signin@cleatusandthewestvirginian.com>';

export async function sendSignInLink(to: string, url: string): Promise<void> {
  const key = env('RESEND_API_KEY');
  if (!key) {
    if (import.meta.env?.DEV) {
      console.log(`[admin] sign-in link for ${to}: ${url}`);
      return;
    }
    throw new Error('RESEND_API_KEY is not set');
  }

  const text = [
    'Here is your link to sign in and edit Cleatus & the West Virginian:',
    '',
    url,
    '',
    `It works once, for the next ${LINK_MINUTES} minutes.`,
    "If you didn't ask for it, ignore this email — nobody can sign in without the link.",
  ].join('\n');

  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f1ea;font-family:Georgia,serif;color:#12161c">
  <div style="max-width:480px;margin:0 auto;background:#fff;padding:28px;border-top:3px solid #e8b04a">
    <p style="margin:0 0 6px;font:600 11px/1.4 monospace;letter-spacing:.08em;text-transform:uppercase;color:#5b6573">Cleatus &amp; the West Virginian</p>
    <p style="margin:0 0 20px;font-size:17px;line-height:1.5">Here is your link to sign in and edit the site.</p>
    <p style="margin:0 0 22px"><a href="${url}" style="display:inline-block;background:#12161c;color:#fff;text-decoration:none;padding:12px 22px;font:600 14px/1 sans-serif">Sign in</a></p>
    <p style="margin:0;font-size:14px;line-height:1.5;color:#5b6573">It works once, for the next ${LINK_MINUTES} minutes. If you didn't ask for it, ignore this email — nobody can sign in without the link.</p>
  </div></body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject: 'Your sign-in link', text, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
