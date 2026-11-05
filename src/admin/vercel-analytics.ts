/**
 * Vercel Web Analytics' own numbers, for comparing with the site's count on
 * /admin/analytics. Optional: it needs VERCEL_ANALYTICS_TOKEN set in Vercel's
 * environment variables, and answers "not connected" until then.
 *
 * Vercel tokens can't be limited to one project or to reading, so this token could
 * reach every project on the account. It stays on the server: only ever read here,
 * never sent to a browser, and never included in an error message.
 */
import { env } from './mode.ts';

const API = 'https://api.vercel.com/v1/query/web-analytics/visits/aggregate';
const TEAM = 'andrew-tisdale-s-projects';
const CACHE_MS = 5 * 60_000;
/** Vercel's free plan keeps one month, and what it does with longer requests isn't documented. */
const MAX_DAYS = 30;

export type VercelResult =
  | { status: 'not-connected' }
  | { status: 'not-found' }
  | { status: 'failed'; message: string }
  | {
    status: 'ok';
    days: number;
    series: { day: string; views: number; visitors: number }[];
    countries: Row[]; pages: Row[]; referrers: Row[]; browsers: Row[]; systems: Row[]; devices: Row[];
  };
type Row = { key: string; value: number };

const cache = new Map<number, { at: number; value: VercelResult }>();

async function query(token: string, by: string, since: string, until: string, limit = 25) {
  const params = new URLSearchParams({
    projectId: env('VERCEL_PROJECT_ID') ?? 'cleatus-wv', slug: TEAM, by, since, until, limit: String(limit),
  });
  const res = await fetch(`${API}?${params}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw Object.assign(new Error(`Vercel answered ${res.status}`), { status: res.status });
  return (await res.json()) as { data?: Record<string, unknown>[] };
}

const rows = (data: Record<string, unknown>[] | undefined, field: string): Row[] =>
  (data ?? []).map((d) => ({
    key: String(d[field] ?? 'Other'),
    value: Number(d.pageviews ?? 0),
  })).sort((a, b) => b.value - a.value);

export async function readVercel(asked: number): Promise<VercelResult> {
  const token = env('VERCEL_ANALYTICS_TOKEN');
  if (!token) return { status: 'not-connected' };
  const days = Math.min(asked, MAX_DAYS);
  const hit = cache.get(days);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const until = new Date();
  const since = new Date(until.getTime() - days * 864e5);
  try {
    const q = (by: string, limit?: number) => query(token, by, since.toISOString(), until.toISOString(), limit);
    const [day, country, path, ref, browser, os, device] = await Promise.all([
      q('day', 100), q('country'), q('requestPath'), q('referrerHostname'), q('browserName'), q('osName'), q('deviceType'),
    ]);
    const value: VercelResult = {
      status: 'ok',
      days,
      series: (day.data ?? []).map((d) => ({
        day: String(d.timestamp).slice(0, 10), views: Number(d.pageviews ?? 0), visitors: Number(d.visitors ?? 0),
      })).sort((a, b) => a.day.localeCompare(b.day)),
      countries: rows(country.data, 'country'), pages: rows(path.data, 'requestPath'),
      referrers: rows(ref.data, 'referrerHostname'), browsers: rows(browser.data, 'browserName'),
      systems: rows(os.data, 'osName'), devices: rows(device.data, 'deviceType'),
    };
    cache.set(days, { at: Date.now(), value });
    return value;
  } catch (e) {
    // Not cached, so a fixed setting shows up on the next look.
    const status = (e as { status?: number }).status;
    if (status === 404) return { status: 'not-found' };
    return { status: 'failed', message: status === 401 || status === 403 ? `Vercel refused the token (${status}). It may have expired, or not cover this project's team.` : `Vercel didn't answer properly${status ? ` (${status})` : ''}.` };
  }
}
