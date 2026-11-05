/**
 * The depth behind /admin/analytics, kept beside the daily counts in readers.ts:
 * where readers are, how they arrive and move through the site, how far they read,
 * what they click and how fast it felt.
 *
 * Still aggregate only. Every one of these is a counter in a per-day hash; there is
 * no row for a visit and no visitor id, so "who did what" can't be asked of it. A
 * visitor's location is the city Vercel's edge reports, kept as a count against that
 * city, and "returning" is the browser's own report of a rough time since its last
 * visit (src/scripts/reader-pulse.ts).
 *
 *   an:<day>                site-wide: cities, screens, hours, journeys, searches
 *   ae:<day>                per page: time, depth, clicks, speed. Field is `what|path`.
 *   ap:<day>:<path>         one page: its countries, referrers, click targets
 *   hm:<day>:<class>:<path> one page's click map for one screen class: `x:y` cells
 */
import { countHit, kvPipeline } from './kv.ts';
import { BOT, cleanPath, dayOf, daysBack, readReport, ranked, referrerHost, type Report } from './readers.ts';

const KEEP = 400 * 86_400;
/** Click maps are the bulkiest thing here and go stale as pages change. */
const KEEP_HEAT = 120 * 86_400;
const PULSES_PER_IP_PER_HOUR = 600;

const WIDTHS = new Set(['phone', 'tablet', 'desktop']);
const GAPS = new Set(['1', '2-7', '8-30', '31-90', '91+']);
const VISITS = new Set(['1', '2', '3-5', '6-10', '11+']);
const DEPTHS = new Set([25, 50, 75, 90, 100]);
const TIMES = new Set([10, 30, 60, 180, 600]);
const KINDS = new Set(['link', 'out', 'ui', 'photo', 'instagram', 'map', 'dead', 'dead-photo']);
const LABEL = /^[\p{L}\p{N} .,:;!?'&()/_#+-]{1,60}$/u;
const QUERY = /^[\p{L}\p{N} '-]{2,40}$/u;
const WORD = /^[\p{L}\p{N} .'-]{1,50}$/u;

const inRange = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const plain = (s: unknown, re: RegExp, fallback = '') => {
  const t = String(s ?? '').trim();
  return re.test(t) ? t : fallback;
};
function decoded(s: string | null) {
  if (!s) return '';
  try { return decodeURIComponent(s); } catch { return s; }
}

type Cmd = (string | number)[];

// ---- recording ------------------------------------------------------------------

export interface HitBody {
  p?: unknown; r?: unknown; l?: unknown; g?: unknown; nv?: unknown; w?: unknown; sz?: unknown;
  lg?: unknown; dm?: unknown; h?: unknown; wd?: unknown; us?: unknown; uc?: unknown;
}

/** Everything a page view adds beyond the daily count. Called once recordHit has counted it. */
export async function recordVisit(body: HitBody, headers: Headers, now = new Date()) {
  const path = cleanPath(String(body.p ?? ''));
  if (!path) return;
  const day = dayOf(now);
  const site = `an:${day}`;
  const page = `ap:${day}:${path}`;
  const add = (key: string, field: string): Cmd => ['HINCRBY', key, field, 1];

  const width = WIDTHS.has(String(body.w)) ? String(body.w) : '';
  const raw = String(body.r ?? '');
  const ref = referrerHost(raw);
  const landing = body.l === 1;
  const cc = /^[A-Z]{2}$/.test(headers.get('x-vercel-ip-country') ?? '') ? headers.get('x-vercel-ip-country')! : 'XX';
  const region = plain(decoded(headers.get('x-vercel-ip-country-region')), WORD);
  const city = plain(decoded(headers.get('x-vercel-ip-city')), WORD);
  const lat = Number(headers.get('x-vercel-ip-latitude'));
  const lng = Number(headers.get('x-vercel-ip-longitude'));

  const cmds: Cmd[] = [add(page, 'v'), add(page, `c:${cc}`)];
  if (width) cmds.push(add(site, `w:${width}`), add(page, `w:${width}`));

  const size = String(body.sz ?? '');
  if (/^\d{3,5}x\d{3,5}$/.test(size)) cmds.push(add(site, `sz:${size}`));
  const lang = String(body.lg ?? '');
  if (/^[a-z]{2}$/.test(lang)) cmds.push(add(site, `lg:${lang}`));
  cmds.push(add(site, `dm:${body.dm === 1 ? 'dark' : 'light'}`));
  if (inRange(body.h, 0, 23) && inRange(body.wd, 0, 6)) cmds.push(add(site, `hw:${body.wd}:${body.h}`));

  cmds.push(add(site, `cp:${cc}|${path}`));
  if (city && Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) {
    cmds.push(
      add(site, `ci:${cc}|${region}|${city}|${lat.toFixed(2)}|${lng.toFixed(2)}`),
      add(page, `ci:${city}, ${cc}`),
    );
  }

  // Arrived from another page here, or from outside?
  let from: string | null = null;
  try {
    const u = new URL(raw);
    if (!ref && u.pathname && u.hostname) from = cleanPath(u.pathname);
  } catch { /* no referrer */ }
  if (from && from !== path) {
    cmds.push(add(site, `t:${from}>${path}`), add(page, `f:${from}`));
  }

  if (landing) {
    cmds.push(add(site, `l:${path}`), add(site, `rl:${ref ?? '(direct)'}|${path}`), add(page, `r:${ref ?? '(direct)'}`));
    const gap = String(body.g ?? '');
    cmds.push(add(site, `vt:${GAPS.has(gap) ? 'returning' : 'new'}`));
    if (GAPS.has(gap)) cmds.push(add(site, `gp:${gap}`));
    const visits = String(body.nv ?? '');
    if (VISITS.has(visits)) cmds.push(add(site, `nv:${visits}`));
    const source = plain(body.us, WORD);
    if (source) cmds.push(add(site, `ut:${source}|${plain(body.uc, WORD)}`));
  }
  cmds.push(['EXPIRE', site, KEEP], ['EXPIRE', page, KEEP]);
  await kvPipeline(cmds);
}

export interface PulseBody {
  p?: unknown; w?: unknown; f?: unknown; t?: unknown; tb?: unknown; sb?: unknown; c?: unknown;
  d?: unknown; rg?: unknown; lcp?: unknown; cls?: unknown; inp?: unknown; q?: unknown; qz?: unknown;
}

const grade = (v: number, good: number, ok: number) => (v <= good ? 'g' : v <= ok ? 'o' : 'p');

/** A page's report of time, depth, clicks and speed. False when it wasn't counted. */
export async function recordPulse(body: PulseBody, ua: string, ip: string, now = new Date()): Promise<boolean> {
  if (!ua || BOT.test(ua)) return false;
  const path = cleanPath(String(body.p ?? ''));
  if (!path) return false;
  if ((await countHit(`rl:pulse:${ip}`, 3600)) > PULSES_PER_IP_PER_HOUR) return false;

  const day = dayOf(now);
  const width = WIDTHS.has(String(body.w)) ? String(body.w) : 'desktop';
  const eng = `ae:${day}`;
  const site = `an:${day}`;
  const page = `ap:${day}:${path}`;
  const heat = `hm:${day}:${width}:${path}`;
  const cmds: Cmd[] = [];
  const add = (key: string, field: string, by = 1) => cmds.push(['HINCRBY', key, field, by]);

  if (body.f === 1) {
    add(eng, `n|${path}`);
    add(eng, `nw|${width}`);
    const vital = (name: string, value: unknown, good: number, ok: number) => {
      if (typeof value === 'number' && value > 0 && value < 120_000) add(eng, `v${name}${grade(value, good, ok)}|${path}`);
    };
    vital('l', body.lcp, 2500, 4000);
    vital('c', body.cls, 0.1, 0.25);
    vital('i', body.inp, 200, 500);
  }
  if (inRange(body.t, 1, 3600)) {
    add(eng, `t|${path}`, body.t as number);
    add(eng, `tw|${width}`, body.t as number);
  }
  for (const b of Array.isArray(body.sb) ? body.sb.slice(0, 5) : []) if (DEPTHS.has(b)) add(eng, `s${b}|${path}`);
  for (const b of Array.isArray(body.tb) ? body.tb.slice(0, 5) : []) if (TIMES.has(b)) add(eng, `b${b}|${path}`);
  if (inRange(body.d, 1, 25)) add(eng, `dd|${path}`, body.d as number);
  if (inRange(body.rg, 1, 25)) add(eng, `rg|${path}`, body.rg as number);

  let heatUsed = false;
  for (const c of Array.isArray(body.c) ? body.c.slice(0, 25) : []) {
    if (!Array.isArray(c) || !inRange(c[0], 0, 49) || !inRange(c[1], 0, 199) || !KINDS.has(String(c[2]))) continue;
    add(heat, `${c[0]}:${c[1]}`);
    heatUsed = true;
    add(eng, `cl|${path}`);
    const label = plain(c[3], LABEL);
    add(page, `k:${c[2]}|${label}`);
  }
  if (heatUsed) cmds.push(['EXPIRE', heat, KEEP_HEAT], ['EXPIRE', page, KEEP]);

  const q = String(body.q ?? '').trim().toLowerCase();
  // Letters, numbers and spaces only, so an address or a phone number never lands here.
  if (QUERY.test(q) && !/\d{5,}/.test(q)) {
    add(site, `q:${q}`);
    if (body.qz === 1) add(site, `qz:${q}`);
    cmds.push(['EXPIRE', site, KEEP]);
  }
  if (!cmds.length) return true;
  cmds.push(['EXPIRE', eng, KEEP]);
  await kvPipeline(cmds);
  return true;
}

// ---- reading --------------------------------------------------------------------

const toMap = (flat: unknown) => {
  const arr = (flat ?? []) as string[];
  const m = new Map<string, number>();
  for (let i = 0; i < arr.length; i += 2) m.set(arr[i], Number(arr[i + 1]));
  return m;
};
const bump = (m: Map<string, number>, k: string, by: number) => m.set(k, (m.get(k) ?? 0) + by);
const pairs = (m: Map<string, number>, limit = 50) => ranked(m, limit).map(([key, value]) => ({ key, value }));

export interface PageRow {
  path: string; views: number; prevViews?: number; measured: number; secs: number; avgSecs: number;
  depth: Record<number, number>; stay: Record<number, number>; clicks: number; dead: number; rage: number;
  landings: number; onward: number; leftPct: number; speed: { lcp: Grades; cls: Grades; inp: Grades };
}
type Grades = { g: number; o: number; p: number };

export interface Overview {
  days: Report['days']; views: number; visitors: number; prevViews: number; prevVisitors: number; firstDay: string | null;
  measuredSince: string | null; landings: number; pagesPerVisit: number; avgSecs: number; returning: number; fresh: number;
  countries: { key: string; value: number }[]; cities: { cc: string; region: string; city: string; lat: number; lng: number; value: number }[];
  countryPages: Record<string, { key: string; value: number }[]>;
  referrers: { key: string; value: number }[]; referrerLandings: Record<string, { key: string; value: number }[]>;
  landingPages: { key: string; value: number }[]; utm: { key: string; value: number }[];
  devices: { key: string; value: number }[]; browsers: { key: string; value: number }[]; systems: { key: string; value: number }[];
  widths: { key: string; value: number; avgSecs: number }[]; screens: { key: string; value: number }[]; languages: { key: string; value: number }[];
  colorScheme: { key: string; value: number }[]; gaps: { key: string; value: number }[]; visitCounts: { key: string; value: number }[];
  hours: number[][]; journeys: { from: string; to: string; value: number }[];
  searches: { q: string; value: number; zero: number }[]; pages: PageRow[];
}

/** Everything site-wide for the last `n` days. */
export async function readOverview(n: number, now = new Date()): Promise<Overview> {
  const report = await readReport(n, now);
  const days = daysBack(n, dayOf(now));
  const results = await kvPipeline([...days.map((d) => ['HGETALL', `an:${d}`]), ...days.map((d) => ['HGETALL', `ae:${d}`])]);
  const an = results.slice(0, days.length).map(toMap);
  const ae = results.slice(days.length).map(toMap);

  const site = new Map<string, Map<string, number>>();
  const group = (p: string) => { let g = site.get(p); if (!g) { g = new Map(); site.set(p, g); } return g; };
  let measuredSince: string | null = null;
  an.forEach((h, i) => {
    if (h.size && !measuredSince) measuredSince = days[i];
    for (const [f, v] of h) {
      const c = f.indexOf(':');
      bump(group(f.slice(0, c)), f.slice(c + 1), v);
    }
  });

  const eng = new Map<string, Map<string, number>>();
  const widthTotals = new Map<string, { secs: number; n: number }>();
  for (const h of ae) {
    for (const [f, v] of h) {
      const c = f.indexOf('|');
      const what = f.slice(0, c);
      const key = f.slice(c + 1);
      if (what === 'tw' || what === 'nw') {
        const w = widthTotals.get(key) ?? { secs: 0, n: 0 };
        if (what === 'tw') w.secs += v; else w.n += v;
        widthTotals.set(key, w);
        continue;
      }
      let e = eng.get(key);
      if (!e) { e = new Map(); eng.set(key, e); }
      bump(e, what, v);
    }
  }

  const journeys = [...group('t')].map(([k, value]) => {
    const [from, to] = k.split('>');
    return { from, to, value };
  }).sort((a, b) => b.value - a.value);
  const onward = new Map<string, number>();
  for (const j of journeys) bump(onward, j.from, j.value);

  const landingMap = group('l');
  const paths = new Set<string>([...report.pages.keys(), ...eng.keys()]);
  const pages: PageRow[] = [...paths].map((path) => {
    const e = eng.get(path) ?? new Map<string, number>();
    const views = report.pages.get(path) ?? 0;
    const measured = e.get('n') ?? 0;
    const secs = e.get('t') ?? 0;
    const out = onward.get(path) ?? 0;
    const pct = (key: string) => (measured ? Math.min(100, Math.round(((e.get(key) ?? 0) / measured) * 100)) : 0);
    const grades = (m: string): Grades => ({ g: e.get(`v${m}g`) ?? 0, o: e.get(`v${m}o`) ?? 0, p: e.get(`v${m}p`) ?? 0 });
    return {
      path, views, measured, secs,
      avgSecs: measured ? Math.round(secs / measured) : 0,
      depth: { 25: pct('s25'), 50: pct('s50'), 75: pct('s75'), 90: pct('s90'), 100: pct('s100') },
      stay: { 10: pct('b10'), 30: pct('b30'), 60: pct('b60'), 180: pct('b180'), 600: pct('b600') },
      clicks: e.get('cl') ?? 0, dead: e.get('dd') ?? 0, rage: e.get('rg') ?? 0,
      landings: landingMap.get(path) ?? 0, onward: out,
      leftPct: views ? Math.max(0, Math.round((1 - out / views) * 100)) : 0,
      speed: { lcp: grades('l'), cls: grades('c'), inp: grades('i') },
    };
  }).sort((a, b) => b.views - a.views);

  const cities = [...group('ci')].map(([k, value]) => {
    const [cc, region, city, lat, lng] = k.split('|');
    return { cc, region, city, lat: Number(lat), lng: Number(lng), value };
  }).sort((a, b) => b.value - a.value);

  const countryPages: Overview['countryPages'] = {};
  for (const [k, v] of group('cp')) {
    const [cc, path] = k.split('|');
    (countryPages[cc] ??= []).push({ key: path, value: v });
  }
  for (const cc of Object.keys(countryPages)) countryPages[cc] = countryPages[cc].sort((a, b) => b.value - a.value).slice(0, 12);

  const referrerLandings: Overview['referrerLandings'] = {};
  for (const [k, v] of group('rl')) {
    const [ref, path] = k.split('|');
    (referrerLandings[ref] ??= []).push({ key: path, value: v });
  }
  for (const r of Object.keys(referrerLandings)) referrerLandings[r] = referrerLandings[r].sort((a, b) => b.value - a.value).slice(0, 12);

  const hours = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const [k, v] of group('hw')) {
    const [d, h] = k.split(':').map(Number);
    if (hours[d]?.[h] !== undefined) hours[d][h] += v;
  }

  const totalMeasured = pages.reduce((s, p) => s + p.measured, 0);
  const totalSecs = pages.reduce((s, p) => s + p.secs, 0);
  const landings = [...landingMap.values()].reduce((s, v) => s + v, 0);
  const zero = group('qz');
  const vt = group('vt');

  return {
    days: report.days, views: report.views, visitors: report.visitors, prevViews: report.prevViews, prevVisitors: report.prevVisitors,
    firstDay: report.firstDay, measuredSince,
    landings,
    pagesPerVisit: landings ? Math.round((report.views / landings) * 10) / 10 : 0,
    avgSecs: totalMeasured ? Math.round(totalSecs / totalMeasured) : 0,
    returning: vt.get('returning') ?? 0, fresh: vt.get('new') ?? 0,
    countries: pairs(report.countries, 250), cities: cities.slice(0, 500), countryPages,
    referrers: pairs(report.referrers, 40), referrerLandings,
    landingPages: pairs(landingMap, 30), utm: pairs(group('ut'), 20),
    devices: pairs(report.devices, 6), browsers: pairs(report.browsers, 8), systems: pairs(report.systems, 8),
    widths: pairs(group('w'), 3).map((w) => {
      const t = widthTotals.get(w.key);
      return { ...w, avgSecs: t?.n ? Math.round(t.secs / t.n) : 0 };
    }),
    screens: pairs(group('sz'), 12), languages: pairs(group('lg'), 15), colorScheme: pairs(group('dm'), 2),
    gaps: pairs(group('gp'), 5), visitCounts: pairs(group('nv'), 5),
    hours, journeys: journeys.slice(0, 60),
    searches: pairs(group('q'), 60).map(({ key, value }) => ({ q: key, value, zero: zero.get(key) ?? 0 })),
    pages,
  };
}

export interface PageDetail {
  path: string; views: number; countries: { key: string; value: number }[]; cities: { key: string; value: number }[];
  referrers: { key: string; value: number }[]; widths: { key: string; value: number }[];
  cameFrom: { key: string; value: number }[]; targets: { kind: string; label: string; value: number }[];
  heat: Record<string, { x: number; y: number; n: number }[]>;
}

/** One page, for the drill-down and its click map. */
export async function readPage(rawPath: string, n: number, now = new Date()): Promise<PageDetail | null> {
  const path = cleanPath(rawPath);
  if (!path) return null;
  const days = daysBack(n, dayOf(now));
  const heatDays = days.slice(-120);
  const classes = ['phone', 'tablet', 'desktop'];
  const results = await kvPipeline([
    ...days.map((d) => ['HGETALL', `ap:${d}:${path}`]),
    ...classes.flatMap((c) => heatDays.map((d) => ['HGETALL', `hm:${d}:${c}:${path}`])),
  ]);
  const page = new Map<string, Map<string, number>>();
  let views = 0;
  for (const h of results.slice(0, days.length).map(toMap)) {
    for (const [f, v] of h) {
      if (f === 'v') { views += v; continue; }
      const c = f.indexOf(':');
      const p = f.slice(0, c);
      const g = page.get(p) ?? new Map<string, number>();
      bump(g, f.slice(c + 1), v);
      page.set(p, g);
    }
  }
  const get = (p: string, limit = 15) => pairs(page.get(p) ?? new Map(), limit);
  const heat: PageDetail['heat'] = {};
  classes.forEach((c, ci) => {
    const cells = new Map<string, number>();
    const offset = days.length + ci * heatDays.length;
    for (const h of results.slice(offset, offset + heatDays.length).map(toMap)) {
      for (const [k, v] of h) bump(cells, k, v);
    }
    heat[c] = [...cells].map(([k, v]) => {
      const [x, y] = k.split(':').map(Number);
      return { x, y, n: v };
    });
  });
  return {
    path, views,
    countries: get('c', 20), cities: get('ci', 20), referrers: get('r', 15), widths: get('w', 3), cameFrom: get('f', 15),
    targets: [...(page.get('k') ?? new Map<string, number>())].map(([k, value]) => {
      const i = k.indexOf('|');
      return { kind: k.slice(0, i), label: k.slice(i + 1), value };
    }).sort((a, b) => b.value - a.value).slice(0, 40),
    heat,
  };
}

// ---- turning the numbers into suggestions ----------------------------------------

export interface Insight { tone: 'good' | 'fix' | 'idea'; title: string; detail: string; path?: string }

/** Plain suggestions, each only when the numbers behind it are big enough to mean something. */
export function insightsFrom(o: Overview, titleOf: (p: string) => string, allPaths: string[]): Insight[] {
  const out: Insight[] = [];
  const pages = o.pages.filter((p) => p.measured >= 15);

  const shallow = pages.filter((p) => p.depth[75] < 30 && p.path !== '/' && p.path !== '/map/').sort((a, b) => b.views - a.views)[0];
  if (shallow) out.push({ tone: 'fix', path: shallow.path, title: `Most readers stop early on "${titleOf(shallow.path)}"`, detail: `Only ${shallow.depth[75]}% get three-quarters of the way down, across ${shallow.views} views. Try a stronger opening, or a photo higher up.` });

  const loved = pages.filter((p) => p.avgSecs >= 90 && p.depth[90] >= 50).sort((a, b) => b.avgSecs - a.avgSecs)[0];
  if (loved) out.push({ tone: 'good', path: loved.path, title: `"${titleOf(loved.path)}" holds people`, detail: `${Math.round(loved.avgSecs / 60 * 10) / 10} minutes on average, and ${loved.depth[90]}% read nearly to the end. Feature it on the home page or in a "start here".` });

  const dropoff = pages.filter((p) => p.depth[90] >= 40 && p.leftPct >= 85).sort((a, b) => b.views - a.views)[0];
  if (dropoff) out.push({ tone: 'idea', path: dropoff.path, title: `Readers finish "${titleOf(dropoff.path)}", then leave`, detail: `${dropoff.depth[90]}% read to the end, but about ${dropoff.leftPct}% don't go on to another page. A clearer "next day" link at the end could keep them reading.` });

  const slow = o.pages.filter((p) => p.speed.lcp.g + p.speed.lcp.o + p.speed.lcp.p >= 10 && p.speed.lcp.p / (p.speed.lcp.g + p.speed.lcp.o + p.speed.lcp.p) >= 0.25).sort((a, b) => b.views - a.views)[0];
  if (slow) {
    const total = slow.speed.lcp.g + slow.speed.lcp.o + slow.speed.lcp.p;
    out.push({ tone: 'fix', path: slow.path, title: `"${titleOf(slow.path)}" is slow to load`, detail: `${Math.round((slow.speed.lcp.p / total) * 100)}% of visits waited over 4 seconds for the main content. Large photos are the usual cause.` });
  }

  const raged = o.pages.filter((p) => p.rage >= 3).sort((a, b) => b.rage - a.rage)[0];
  if (raged) out.push({ tone: 'fix', path: raged.path, title: `People are clicking repeatedly on "${titleOf(raged.path)}"`, detail: `${raged.rage} bursts of rapid clicks usually mean something looked clickable and did nothing. The click map shows where.` });

  const zero = o.searches.filter((s) => s.zero >= 2).sort((a, b) => b.zero - a.zero).slice(0, 3);
  if (zero.length) out.push({ tone: 'idea', title: `Searches that found nothing: ${zero.map((s) => `"${s.q}"`).join(', ')}`, detail: 'Readers want these and the site has no answer. Consider an entry or a tag, or add the word to one that fits.' });

  const refs = o.referrers.filter((r) => r.key !== '(direct)' && r.value >= 10);
  if (refs[0]) {
    const land = o.referrerLandings[refs[0].key]?.[0];
    out.push({ tone: 'good', path: land?.key, title: `${refs[0].key} is your top outside source`, detail: `${refs[0].value} views came from it${land ? `, most landing on "${titleOf(land.key)}"` : ''}. Worth sharing more there.` });
  }

  const phone = o.widths.find((w) => w.key === 'phone');
  const desktop = o.widths.find((w) => w.key === 'desktop');
  if (phone && desktop && phone.value >= 20 && desktop.value >= 20 && phone.avgSecs && desktop.avgSecs && phone.avgSecs < desktop.avgSecs * 0.6) {
    out.push({ tone: 'fix', title: 'Phone readers leave much sooner', detail: `${phone.avgSecs}s on average on a phone against ${desktop.avgSecs}s on a computer. Check the long entries and the map on a phone.` });
  }

  if (o.returning + o.fresh >= 30) {
    const share = Math.round((o.returning / (o.returning + o.fresh)) * 100);
    out.push({ tone: share >= 30 ? 'good' : 'idea', title: `${share}% of visits are people coming back`, detail: share >= 30 ? 'A loyal readership. They would notice regular new entries.' : 'Most visits are first visits. An email list or a "new since you were here" could bring people back.' });
  }

  if (o.days.length >= 30 && o.views >= 100) {
    const seen = new Set(o.pages.filter((p) => p.views > 0).map((p) => p.path));
    const unseen = allPaths.filter((p) => !seen.has(p));
    if (unseen.length) out.push({ tone: 'idea', title: `${unseen.length} entries weren't opened in this period`, detail: `For example "${titleOf(unseen[0])}". Links between related entries could bring these back to life.`, path: unseen[0] });
  }
  return out;
}
