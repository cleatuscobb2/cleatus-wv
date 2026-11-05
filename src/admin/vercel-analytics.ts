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

export type VercelResult =
  | { status: 'not-connected' }
  | { status: 'analytics-off' }
  | { status: 'failed'; message: string }
  | {
    status: 'ok';
    series: { day: string; views: number }[];
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
    value: Number(d.pageviews ?? d.visits ?? d.count ?? d.total ?? 0),
  })).sort((a, b) => b.value - a.value);

export async function readVercel(days: number): Promise<VercelResult> {
  const token = env('VERCEL_ANALYTICS_TOKEN');
  if (!token) return { status: 'not-connected' };
  const hit = cache.get(days);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const until = new Date();
  const since = new Date(until.getTime() - days * 864e5);
  let value: VercelResult;
  try {
    const q = (by: string, limit?: number) => query(token, by, since.toISOString(), until.toISOString(), limit);
    const [day, country, path, ref, browser, os, device] = await Promise.all([
      q('day', 100), q('country'), q('requestPath'), q('referrerHostname'), q('browserName'), q('osName'), q('deviceType'),
    ]);
    value = {
      status: 'ok',
      series: rows(day.data, 'timestamp').map((r) => ({ day: r.key.slice(0, 10), views: r.value })).sort((a, b) => a.day.localeCompare(b.day)),
      countries: rows(country.data, 'country'), pages: rows(path.data, 'requestPath'),
      referrers: rows(ref.data, 'referrerHostname'), browsers: rows(browser.data, 'browserName'),
      systems: rows(os.data, 'osName'), devices: rows(device.data, 'deviceType'),
    };
  } catch (e) {
    const status = (e as { status?: number }).status;
    value = status === 404
      ? { status: 'analytics-off' }
      : { status: 'failed', message: status === 401 || status === 403 ? 'Vercel refused the token. It may have expired.' : `Vercel didn't answer properly${status ? ` (${status})` : ''}.` };
  }
  cache.set(days, { at: Date.now(), value });
  return value;
}
