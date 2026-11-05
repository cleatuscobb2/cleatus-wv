/**
 * Instagram archives → the site, one reviewed post at a time.
 *
 *   npm run ig -- import --from "<unzipped export>" --account cleatus_cobb --author Andy
 *   npm run ig -- geocode     names the places (OpenStreetMap), skipping anything near home
 *   npm run ig -- review      the review page, http://127.0.0.1:4399
 *
 * The repo is public, so nothing here may reach it until someone has ticked it.
 * The catalogue, the decisions and the home locations all live in a private
 * folder beside the repo (IG_WORK, by default ../cleatus-wv-instagram). "Publish"
 * on the review page is the only thing that writes to the repo: the ticked posts
 * go to src/content/instagram/posts.json and assets/photos/instagram/, re-encoded
 * with their metadata stripped. Unticking and publishing again removes them.
 *
 * Only posts and reels are read from an export. Its messages, followers, logins
 * and the rest are never opened. Reposts are other people's, and are skipped.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import { geoContains } from 'd3-geo';
import sharp from 'sharp';
import { COUNTRY_NUMERIC } from '../src/data/trip-meta.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = resolve(process.env.IG_WORK ?? join(ROOT, '../cleatus-wv-instagram'));
const CATALOGUE = join(WORK, 'posts.json');
const DECISIONS = join(WORK, 'decisions.json');
const CONFIG = join(WORK, 'config.json');
const GEOCACHE = join(WORK, 'geocache.json');
const PUBLIC_JSON = join(ROOT, 'src/content/instagram/posts.json');
const PUBLIC_MEDIA = join(ROOT, 'assets/photos/instagram');
const PORT = 4399;

interface Media { uri: string; video: boolean }
interface Post {
  id: string; account: string; author: string; root: string; ts: number; date: string; caption: string;
  media: Media[]; lat: number | null; lng: number | null; pin: 'gps' | 'date' | null; pinNote?: string;
  home: string | null; country: string; place: string; trip: string | null;
}
interface Decision { publish?: boolean; trip?: string | null; pin?: { lat: number; lng: number } | null; place?: string; caption?: string }
interface Home { name: string; lat: number; lng: number; km: number }
interface Trip { id: string; title: string; start: string; end: string; countries: string[] }
interface Pinned { date: string; trip: string; name: string; lat: number; lng: number }

const readJson = async <T>(p: string, fallback: T): Promise<T> => (existsSync(p) ? JSON.parse(await readFile(p, 'utf8')) as T : fallback);
const writeJson = async (p: string, v: unknown) => {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(v, null, 1));
};
const km = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
const homeOf = (homes: Home[], lat: number | null, lng: number | null) =>
  lat == null || lng == null ? null : homes.find((h) => km([h.lng, h.lat], [lng, lat]) <= h.km)?.name ?? null;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

/** Meta's exports write UTF-8 as if it were Latin-1: "cafÃ©", and emoji as junk. */
function fixText(s: string) {
  if (!s || [...s].some((c) => c.codePointAt(0)! > 255)) return s ?? '';
  return Buffer.from(s, 'latin1').toString('utf8');
}

// --- the site's own record of where they were ---------------------------------------------
function loadTrips(): Trip[] {
  const dir = join(ROOT, 'src/content/trips');
  return readdirSync(dir).filter((f) => f.endsWith('.mdx')).map((f) => {
    const s = readFileSync(join(dir, f), 'utf8');
    const get = (k: string) => new RegExp(`^${k}:\\s*(.+?)\\s*$`, 'm').exec(s)?.[1] ?? '';
    return {
      id: f.replace(/\.mdx$/, ''),
      title: get('shortTitle').replace(/^"|"$/g, ''),
      start: get('dateStart').slice(0, 10),
      end: get('dateEnd').slice(0, 10),
      countries: JSON.parse(get('countries') || '[]') as string[],
    };
  });
}

function loadPinned(): Pinned[] {
  const dir = join(ROOT, 'src/content/entries');
  const out: Pinned[] = [];
  for (const trip of readdirSync(dir)) {
    const tdir = join(dir, trip);
    if (!statSync(tdir).isDirectory()) continue;
    for (const f of readdirSync(tdir)) {
      if (!f.endsWith('.mdx')) continue;
      const s = readFileSync(join(tdir, f), 'utf8');
      const date = /^date:\s*(\S+)/m.exec(s)?.[1]?.slice(0, 10);
      const loc = /^location:\s*(\{.*\})\s*$/m.exec(s)?.[1];
      if (!date || !loc) continue;
      const l = JSON.parse(loc) as { name?: string; lat?: number; lng?: number };
      if (l.lat != null && l.lng != null) out.push({ date, trip, name: l.name ?? '', lat: l.lat, lng: l.lng });
    }
  }
  return out;
}

async function countryFinder() {
  const world = JSON.parse(await readFile(join(ROOT, 'node_modules/world-atlas/countries-50m.json'), 'utf8'));
  const feats = (feature(world, world.objects.countries) as unknown as { features: { id: string }[] }).features;
  const alpha = new Map(Object.entries(COUNTRY_NUMERIC).map(([a, n]) => [n, a]));
  return (lng: number, lat: number) => {
    const f = feats.find((x) => geoContains(x as never, [lng, lat]));
    return f ? alpha.get(String(f.id)) ?? '' : '';
  };
}

// --- import -------------------------------------------------------------------------------
type RawMedia = { uri: string; creation_timestamp?: number; title?: string; media_metadata?: { photo_metadata?: { exif_data?: Exif[] }; video_metadata?: { exif_data?: Exif[] } } };
type Exif = { latitude?: number; longitude?: number; date_time_original?: string };
const exifOf = (m: RawMedia) => m.media_metadata?.photo_metadata?.exif_data ?? m.media_metadata?.video_metadata?.exif_data ?? [];

function takenDate(media: RawMedia[], ts: number, lng: number | null) {
  for (const m of media) {
    for (const e of exifOf(m)) {
      const x = /^(\d{4}):(\d\d):(\d\d)/.exec(e.date_time_original ?? '');
      if (x && +x[1] > 2000) return `${x[1]}-${x[2]}-${x[3]}`;
    }
  }
  // The timestamp is UTC; the longitude is near enough to get the day right where they were.
  return new Date((ts + (lng ?? 0) * 240) * 1000).toISOString().slice(0, 10);
}

async function runImport() {
  const from = resolve(arg('from') ?? '');
  const account = arg('account');
  const author = arg('author');
  if (!arg('from') || !account || !author) throw new Error('needs --from, --account and --author');

  const config = await readJson<{ homes: Home[] }>(CONFIG, { homes: [] });
  if (!config.homes.length) throw new Error(`Add your home locations to ${CONFIG} first`);
  const trips = loadTrips();
  const pinned = loadPinned();
  const countryOf = await countryFinder();
  const read = (f: string) => JSON.parse(readFileSync(join(from, 'your_instagram_activity/media', f), 'utf8'));

  // posts_1.json has the captions and the photos' own EXIF. posts.json has the same posts
  // with the location Instagram recorded, which a multi-photo post's own photos lack. A
  // multi-photo post has a different file in each, so the two match on the upload time.
  type Labelled = { label_values?: { label?: string; value?: string; media?: RawMedia[] }[] };
  const recorded = new Map<number, { lat: number; lng: number }>();
  const recordedByCaption = new Map<string, { lat: number; lng: number }>();
  for (const p of read('posts.json') as Labelled[]) {
    const label = (l: string) => p.label_values?.find((x) => x.label === l);
    const lat = Number(label('Latitude')?.value ?? 0);
    const lng = Number(label('Longitude')?.value ?? 0);
    if (!lat && !lng) continue;
    for (const m of p.label_values?.flatMap((x) => (x.label === 'Media' ? x.media ?? [] : [])) ?? []) {
      if (m.creation_timestamp) recorded.set(m.creation_timestamp, { lat, lng });
      if (m.title) recordedByCaption.set(m.title, { lat, lng });
    }
  }

  const raw: { media: RawMedia[]; caption: string; ts: number }[] = [];
  for (const p of read('posts_1.json') as { media: RawMedia[]; title?: string; creation_timestamp?: number }[]) {
    if (!p.media?.length) continue;
    raw.push({ media: p.media, caption: p.title || p.media[0].title || '', ts: p.creation_timestamp ?? p.media[0].creation_timestamp ?? 0 });
  }
  const reels = read('reels.json') as { ig_reels_media?: { media: RawMedia[] }[] };
  for (const p of reels.ig_reels_media ?? []) {
    if (!p.media?.length) continue;
    raw.push({ media: p.media, caption: p.media[0].title || '', ts: p.media[0].creation_timestamp ?? 0 });
  }

  const posts: Post[] = raw.map(({ media, caption, ts }) => {
    const byCaption = caption ? recordedByCaption.get(caption) : undefined;
    const gps = media.flatMap(exifOf).find((e) => e.latitude != null && e.longitude != null && (e.latitude !== 0 || e.longitude !== 0));
    const logged = media.map((m) => recorded.get(m.creation_timestamp ?? 0)).find(Boolean) ?? byCaption;
    let lat = gps?.latitude ?? logged?.lat ?? null;
    let lng = gps?.longitude ?? logged?.lng ?? null;
    const date = takenDate(media, ts, lng);
    let pin: Post['pin'] = lat != null ? 'gps' : null;
    let pinNote: string | undefined;
    let place = '';
    // No GPS: if an entry was written from somewhere within two days, it was probably there.
    if (lat == null) {
      const inTrip = trips.find((t) => date >= t.start && date <= t.end);
      const near = inTrip && pinned
        .filter((e) => e.trip === inTrip.id && e.date >= addDays(date, -2) && e.date <= addDays(date, 2))
        .sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(date)) - Math.abs(Date.parse(b.date) - Date.parse(date)))[0];
      if (near) {
        lat = near.lat; lng = near.lng; pin = 'date'; place = near.name;
        pinNote = `Guessed from the entry written at ${near.name} on ${near.date}`;
      }
    }
    const home = homeOf(config.homes, lat, lng);
    const country = lat != null && lng != null ? countryOf(lng, lat) : '';
    // On a trip if it's in one of the trip's countries, from just before it started until
    // six weeks after it ended: plenty of these went up after they got home.
    const trip = trips.find((t) => (country
      ? t.countries.includes(country) && date >= addDays(t.start, -3) && date <= addDays(t.end, 45)
      : date >= t.start && date <= t.end))?.id ?? null;
    const first = media[0].uri.split('/').pop()!.replace(/\.[^.]+$/, '');
    return {
      id: first, account, author, root: from, ts, date, caption: fixText(caption).trim(),
      media: media.map((m) => ({ uri: m.uri, video: m.uri.endsWith('.mp4') })),
      lat, lng, pin, pinNote, home, country, place, trip: home ? null : trip,
    };
  });

  const others = (await readJson<Post[]>(CATALOGUE, [])).filter((p) => p.account !== account);
  await writeJson(CATALOGUE, [...others, ...posts].sort((a, b) => b.ts - a.ts));
  console.log(`${account}: ${posts.length} posts (${posts.filter((p) => p.pin === 'gps').length} with GPS, ` +
    `${posts.filter((p) => p.pin === 'date').length} placed by date, ${posts.filter((p) => !p.pin).length} unplaced, ` +
    `${posts.filter((p) => p.home).length} near home, ${posts.filter((p) => p.trip).length} on a trip)`);
}

// --- geocode ------------------------------------------------------------------------------
/** Names each pin via OpenStreetMap, 1 request a second. Pins near home are never sent. */
async function runGeocode() {
  const posts = await readJson<Post[]>(CATALOGUE, []);
  const cache = await readJson<Record<string, { name: string; cc: string }>>(GEOCACHE, {});
  let asked = 0;
  for (const p of posts) {
    if (p.home || p.pin !== 'gps' || p.lat == null || p.lng == null) continue;
    const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
    if (!cache[key]) {
      const [la, ln] = key.split(',');
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=${la}&lon=${ln}`, {
        headers: { 'User-Agent': 'cleatus-wv-instagram-import/1.0 (https://cleatusandthewestvirginian.com)' },
      });
      if (!r.ok) { console.error(`stopped: OpenStreetMap said ${r.status}`); break; }
      const j = await r.json() as { name?: string; address?: Record<string, string> };
      const a = j.address ?? {};
      cache[key] = {
        name: a.city || a.town || a.village || a.municipality || j.name || a.county || a.state || '',
        cc: (a.country_code ?? '').toUpperCase(),
      };
      asked++;
      if (asked % 20 === 0) { await writeJson(GEOCACHE, cache); console.log(`${asked} named…`); }
      await new Promise((ok) => setTimeout(ok, 1100));
    }
    if (cache[key].name) p.place = cache[key].name;
    if (cache[key].cc) p.country = cache[key].cc;
  }
  await writeJson(GEOCACHE, cache);
  // A country found here can bring a post onto a trip the outlines missed.
  const trips = loadTrips();
  for (const p of posts) {
    if (p.trip || p.home || !p.country) continue;
    p.trip = trips.find((t) => t.countries.includes(p.country) && p.date >= addDays(t.start, -3) && p.date <= addDays(t.end, 45))?.id ?? null;
  }
  await writeJson(CATALOGUE, posts);
  console.log(`done: asked for ${asked} places; ${posts.filter((p) => p.place).length} of ${posts.length} posts named`);
}

// --- publish ------------------------------------------------------------------------------
const run = (cmd: string, args: string[]) => new Promise<string>((ok, no) => {
  const c = spawn(cmd, args);
  let out = '';
  let err = '';
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { err += d; });
  c.on('error', no);
  c.on('close', (code) => (code === 0 ? ok(out) : no(new Error(`${cmd}: ${err.slice(-400)}`))));
});

async function publish() {
  const config = await readJson<{ homes: Home[] }>(CONFIG, { homes: [] });
  const posts = await readJson<Post[]>(CATALOGUE, []);
  const decisions = await readJson<Record<string, Decision>>(DECISIONS, {});
  const out: Record<string, unknown>[] = [];
  const refused: string[] = [];
  const wanted = new Set<string>();

  for (const p of posts) {
    const d = decisions[p.id] ?? {};
    if (!d.publish) continue;
    const lat = d.pin ? d.pin.lat : p.lat;
    const lng = d.pin ? d.pin.lng : p.lng;
    // The last word on home, whatever the page sent: a typed pin counts too.
    if (p.home || homeOf(config.homes, lat, lng)) { refused.push(p.id); continue; }
    wanted.add(p.id);
    const dir = join(PUBLIC_MEDIA, p.id);
    await mkdir(dir, { recursive: true });
    const media: Record<string, unknown>[] = [];
    for (const [i, m] of p.media.entries()) {
      const n = i + 1;
      const src = join(p.root, m.uri);
      const base = `/photos/instagram/${p.id}/${n}`;
      const thumb = join(dir, `${n}-thumb.jpg`);
      if (m.video) {
        const mp4 = join(dir, `${n}.mp4`);
        const poster = join(dir, `${n}-poster.jpg`);
        if (!existsSync(mp4)) await run('ffmpeg', ['-y', '-v', 'error', '-i', src, '-map_metadata', '-1', '-c', 'copy', '-movflags', '+faststart', mp4]);
        if (!existsSync(poster)) await run('ffmpeg', ['-y', '-v', 'error', '-i', mp4, '-frames:v', '1', '-q:v', '3', poster]);
        if (!existsSync(thumb)) await sharp(poster).resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toFile(thumb);
        const dims = (await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', mp4])).trim().split(',');
        media.push({ src: `${base}.mp4`, thumb: `${base}-thumb.jpg`, poster: `${base}-poster.jpg`, w: +dims[0], h: +dims[1], video: true });
      } else {
        const jpg = join(dir, `${n}.jpg`);
        // sharp drops EXIF unless told to keep it, so GPS and device ids stop here.
        if (!existsSync(jpg)) await sharp(src).rotate().resize({ width: 1440, withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toFile(jpg);
        if (!existsSync(thumb)) await sharp(jpg).resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toFile(thumb);
        const meta = await sharp(jpg).metadata();
        media.push({ src: `${base}.jpg`, thumb: `${base}-thumb.jpg`, w: meta.width, h: meta.height });
      }
    }
    const trip = d.trip === undefined ? p.trip : d.trip;
    out.push({
      id: p.id, author: p.author, date: p.date, caption: d.caption ?? p.caption,
      ...(lat != null && lng != null ? { lat: Math.round(lat * 1e4) / 1e4, lng: Math.round(lng * 1e4) / 1e4 } : {}),
      ...((d.place ?? p.place) ? { place: d.place ?? p.place } : {}),
      ...(p.country ? { country: p.country } : {}),
      ...(trip ? { trip } : {}),
      media,
    });
  }

  // Anything no longer ticked leaves the repo.
  let removed = 0;
  if (existsSync(PUBLIC_MEDIA)) {
    for (const f of readdirSync(PUBLIC_MEDIA)) {
      if (!wanted.has(f)) { await rm(join(PUBLIC_MEDIA, f), { recursive: true, force: true }); removed++; }
    }
  }
  await mkdir(dirname(PUBLIC_JSON), { recursive: true });
  const lines = out.map((o) => `  ${JSON.stringify(o)}`).join(',\n');
  await writeFile(PUBLIC_JSON, out.length ? `[\n${lines}\n]\n` : '[\n]\n');
  return { published: out.length, removed, refused: refused.length };
}

// --- review -------------------------------------------------------------------------------
const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.mp4': 'video/mp4' };

async function runReview() {
  const page = await readFile(join(ROOT, 'scripts/instagram-review.html'));
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      // Reachable only from this machine; a page elsewhere can't post to it either.
      if (req.method === 'POST' && req.headers.origin !== `http://127.0.0.1:${PORT}` && req.headers.origin !== `http://localhost:${PORT}`) {
        res.writeHead(403).end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
      } else if (req.method === 'GET' && url.pathname === '/api/data') {
        const posts = (await readJson<Post[]>(CATALOGUE, [])).map(({ root: _root, ...p }) => p);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          posts, decisions: await readJson(DECISIONS, {}), trips: loadTrips(),
        }));
      } else if (req.method === 'POST' && url.pathname === '/api/decisions') {
        let body = '';
        for await (const c of req) body += c;
        await writeJson(DECISIONS, JSON.parse(body));
        res.writeHead(204).end();
      } else if (req.method === 'POST' && url.pathname === '/api/publish') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(await publish()));
      } else if (req.method === 'GET' && url.pathname.startsWith('/m/')) {
        // Only files the catalogue names, looked up by post id and index.
        const [, , id, n] = url.pathname.split('/');
        const p = (await readJson<Post[]>(CATALOGUE, [])).find((x) => x.id === id);
        const m = p?.media[Number(n)];
        if (!p || !m) { res.writeHead(404).end(); return; }
        const file = join(p.root, m.uri);
        res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Content-Length': statSync(file).size });
        createReadStream(file).pipe(res);
      } else {
        res.writeHead(404).end();
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(e));
    }
  });
  server.listen(PORT, '127.0.0.1', () => console.log(`Review page: http://127.0.0.1:${PORT}`));
}

const cmd = process.argv[2];
if (cmd === 'import') await runImport();
else if (cmd === 'geocode') await runGeocode();
else if (cmd === 'review') await runReview();
else console.error('npm run ig -- import | geocode | review');
