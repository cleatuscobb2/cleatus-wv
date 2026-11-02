/**
 * The site's own reader counter (ADMIN-PLAN.md §7a), kept in the Upstash store
 * the admin already uses — chosen over reading Vercel Analytics, which would
 * need a Vercel token able to control every project on the account.
 *
 * Aggregate only, by day: one hash per day of counters (views, and views per
 * page, country, referring site, device, browser, system). No row per visit, no
 * cookie, nothing on the reader's machine.
 *
 * Visitors are counted, not identified: each request is hashed with a secret
 * that changes every day, and the hash goes into a HyperLogLog, which keeps
 * only an estimate of how many distinct hashes it has seen. Today's visitor
 * can't be linked to yesterday's, and no hash is ever stored.
 */
import { createHmac } from 'node:crypto';
import { env } from './mode.ts';
import { countHit, kvPipeline } from './kv.ts';

const RETAIN_SECONDS = 400 * 86_400;
/** Days run midnight to midnight where the two of you live. */
export const TIME_ZONE = 'America/Los_Angeles';
const SITE_HOST = 'cleatusandthewestvirginian.com';
const HITS_PER_IP_PER_HOUR = 300;

const BOT = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python|axios|node-fetch|undici|go-http|java\/|okhttp|httpclient|scrapy|vercel/i;
const PATH = /^\/[a-z0-9\-\/]{0,160}$/;

export const dayOf = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export interface Agent { device: string; browser: string; os: string }

export function parseAgent(ua: string): Agent {
  const device = /iPad|Tablet|Android(?!.*Mobile)/i.test(ua) ? 'Tablet' : /Mobi|iPhone|iPod|Android/i.test(ua) ? 'Phone' : 'Computer';
  const browser =
    /Edg\//.test(ua) ? 'Edge'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\/|FxiOS/.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Other';
  const os =
    /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'macOS'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : 'Other';
  return { device, browser, os };
}

export interface Hit {
  path: string;
  referrer: string;
  /** Two-letter code from Vercel's edge, or empty. */
  country: string;
  ua: string;
  ip: string;
}

/** Normalises a page path; null for anything that isn't a public page. */
export function cleanPath(raw: string): string | null {
  let p = raw.split(/[?#]/)[0].toLowerCase();
  if (!p.endsWith('/')) p += '/';
  if (!PATH.test(p) || /^\/(admin|api)\//.test(p)) return null;
  return p;
}

/** Where a reader came from: another site's hostname, or null for direct / this site. */
export function referrerHost(raw: string): string | null {
  try {
    const host = new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
    if (!host || host === SITE_HOST || host === 'localhost' || host.endsWith('.vercel.app')) return null;
    return host.slice(0, 80);
  } catch {
    return null;
  }
}

/** Counts one page view. False when it wasn't counted (a bot, a non-page, too many from one address). */
export async function recordHit(h: Hit, now = new Date()): Promise<boolean> {
  if (!h.ua || BOT.test(h.ua)) return false;
  const path = cleanPath(h.path);
  if (!path) return false;
  if ((await countHit(`rl:hit:${h.ip}`, 3600)) > HITS_PER_IP_PER_HOUR) return false;

  const day = dayOf(now);
  const key = `rd:${day}`;
  const { device, browser, os } = parseAgent(h.ua);
  const country = /^[A-Z]{2}$/.test(h.country) ? h.country : 'XX';
  const ref = referrerHost(h.referrer);

  // A secret that changes every day, so a visitor's hash today shares nothing with tomorrow's.
  const salt = createHmac('sha256', env('SESSION_SECRET') ?? 'dev-only').update(`readers:${day}`).digest();
  const visitor = createHmac('sha256', salt).update(`${h.ip}|${h.ua}`).digest('hex').slice(0, 16);

  await kvPipeline([
    ['HINCRBY', key, 'v', 1],
    ['HINCRBY', key, `p:${path}`, 1],
    ['HINCRBY', key, `c:${country}`, 1],
    ['HINCRBY', key, `r:${ref ?? '(direct)'}`, 1],
    ['HINCRBY', key, `d:${device}`, 1],
    ['HINCRBY', key, `b:${browser}`, 1],
    ['HINCRBY', key, `o:${os}`, 1],
    ['EXPIRE', key, RETAIN_SECONDS],
    ['PFADD', `${key}:u`, visitor],
    ['EXPIRE', `${key}:u`, RETAIN_SECONDS],
  ]);
  return true;
}

/** `n` day strings ending at `end` (inclusive), oldest first. */
export function daysBack(n: number, end: string): string[] {
  const base = Date.parse(`${end}T12:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(base - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

export interface Report {
  days: { day: string; views: number; visitors: number }[];
  views: number;
  visitors: number;
  prevViews: number;
  prevVisitors: number;
  pages: Map<string, number>;
  countries: Map<string, number>;
  referrers: Map<string, number>;
  devices: Map<string, number>;
  browsers: Map<string, number>;
  systems: Map<string, number>;
  /** Earliest day in the range that has anything counted. */
  firstDay: string | null;
}

/** Everything for the last `n` days, plus the `n` before them for comparison. */
export async function readReport(n: number, now = new Date()): Promise<Report> {
  const current = daysBack(n, dayOf(now));
  const previous = daysBack(n, daysBack(n + 1, dayOf(now))[0]);
  const all = [...previous, ...current];

  const results = await kvPipeline([
    ...all.map((d) => ['HGETALL', `rd:${d}`]),
    ...current.map((d) => ['PFCOUNT', `rd:${d}:u`]),
    ['PFCOUNT', ...current.map((d) => `rd:${d}:u`)],
    ['PFCOUNT', ...previous.map((d) => `rd:${d}:u`)],
  ]);

  const hashes = results.slice(0, all.length).map((r) => {
    const flat = (r ?? []) as string[];
    const m = new Map<string, number>();
    for (let i = 0; i < flat.length; i += 2) m.set(flat[i], Number(flat[i + 1]));
    return m;
  });
  const dailyVisitors = results.slice(all.length, all.length + current.length).map(Number);
  const [visitors, prevVisitors] = results.slice(all.length + current.length).map(Number);

  const report: Report = {
    days: [], views: 0, visitors, prevViews: 0, prevVisitors,
    pages: new Map(), countries: new Map(), referrers: new Map(), devices: new Map(), browsers: new Map(), systems: new Map(),
    firstDay: null,
  };
  const into: Record<string, Map<string, number>> = {
    p: report.pages, c: report.countries, r: report.referrers, d: report.devices, b: report.browsers, o: report.systems,
  };

  hashes.forEach((h, i) => {
    const views = h.get('v') ?? 0;
    if (i < previous.length) { report.prevViews += views; return; }
    const ci = i - previous.length;
    report.days.push({ day: current[ci], views, visitors: dailyVisitors[ci] });
    report.views += views;
    if (views && !report.firstDay) report.firstDay = current[ci];
    for (const [field, count] of h) {
      const target = into[field.slice(0, field.indexOf(':'))];
      if (!target || field === 'v') continue;
      const name = field.slice(field.indexOf(':') + 1);
      target.set(name, (target.get(name) ?? 0) + count);
    }
  });
  return report;
}

/** Largest first. */
export const ranked = (m: Map<string, number>, limit = 15) => [...m].sort((a, b) => b[1] - a[1]).slice(0, limit);
