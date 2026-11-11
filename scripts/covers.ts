/**
 * Small copies of the photographs the trips page and the home page show.
 *
 *   node --experimental-strip-types scripts/covers.ts
 *
 * Those two pages put a dozen trips' pictures on one screen, and the archive
 * holds them at whatever size they were taken — some are 4 MB. This writes a
 * 960px WebP of every trip's cover and every entry's first photograph, an
 * 1800px one for the pictures shown large, and a 240px one of each photograph
 * on the map for the home page's reel, into public/covers/ (generated, not
 * committed). The originals are never touched.
 *
 * It also settles which picture a trip shows large. A cover chosen for a small
 * card can be a 180px thumbnail from the old blog; for the big frame the trip
 * falls back to its largest photograph instead.
 *
 * public/covers/manifest.json records what was made: src/lib/covers.ts reads it,
 * and any picture missing from it is simply served at its original size.
 */
import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PHOTOS = join(ROOT, 'assets');           // a src of /photos/x lives at assets/photos/x
const OUT = join(ROOT, 'public/covers');
const TRIPS = join(ROOT, 'src/content/trips');
const ENTRIES = join(ROOT, 'src/content/entries');

const POSTS = join(ROOT, 'src/content/instagram/posts.json');

const SMALL = 960;
const LARGE = 1800;
const TINY = 240;
/** A picture at least this long on one side can fill the big frame. */
const BIG_ENOUGH = 1000;

interface Cover { w: number; h: number; sm: string; lg?: string }

const firstPhoto = (body: string) => body.match(/<Photo src="([^"]+)"/)?.[1] ?? null;
const field = (body: string, key: string) =>
  body.match(new RegExp(`^${key}:\\s*"?([^"\\n]*)"?\\s*$`, 'm'))?.[1]?.trim() ?? '';

// ---- what the pages can show ----
const heroes = new Map<string, string>();      // trip id → cover
for (const f of await readdir(TRIPS)) {
  if (!f.endsWith('.mdx')) continue;
  const hero = field(await readFile(join(TRIPS, f), 'utf8'), 'hero');
  if (hero && hero !== 'null') heroes.set(f.slice(0, -4), hero);
}
const byTrip = new Map<string, string[]>();    // trip id → every entry's first photo
for (const trip of await readdir(ENTRIES)) {
  const dir = join(ENTRIES, trip);
  if (!(await stat(dir)).isDirectory()) continue;
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.mdx')) continue;
    const body = await readFile(join(dir, f), 'utf8');
    if (/^draft:\s*true\s*$/m.test(body)) continue;
    const p = firstPhoto(body);
    if (p) byTrip.set(trip, [...(byTrip.get(trip) ?? []), p]);
  }
}

// ---- measure them ----
const all = new Set<string>([...heroes.values(), ...[...byTrip.values()].flat()]);
const sizes = new Map<string, { w: number; h: number; file: string; key: string }>();
for (const src of all) {
  const file = join(PHOTOS, decodeURIComponent(src));
  if (!existsSync(file)) continue;
  try {
    const m = await sharp(file).metadata();
    if (!m.width || !m.height) continue;
    // Phones store some pictures sideways and say so in the file.
    const turned = (m.orientation ?? 1) >= 5;
    const { size } = await stat(file);
    sizes.set(src, {
      w: turned ? m.height : m.width,
      h: turned ? m.width : m.height,
      file,
      key: createHash('sha1').update(`${src}|${size}`).digest('hex').slice(0, 12),
    });
  } catch {
    // Not a picture sharp can read: the page uses the original.
  }
}

// ---- which one each trip shows large ----
const stage: Record<string, string> = {};
for (const trip of new Set([...heroes.keys(), ...byTrip.keys()])) {
  const hero = heroes.get(trip);
  const heroSize = hero ? sizes.get(hero) : undefined;
  if (hero && heroSize && Math.max(heroSize.w, heroSize.h) >= BIG_ENOUGH) { stage[trip] = hero; continue; }
  const best = (byTrip.get(trip) ?? [])
    .filter((p) => sizes.has(p))
    // Wide pictures suit the frame, so a tall one has to be clearly bigger to win.
    .sort((a, b) => score(sizes.get(b)!) - score(sizes.get(a)!))[0];
  const pick = best && (!heroSize || score(sizes.get(best)!) > score(heroSize) * 1.5) ? best : hero;
  if (pick && sizes.has(pick)) stage[trip] = pick;
}
function score(s: { w: number; h: number }) {
  return s.w * s.h * (s.w >= s.h ? 1 : 0.6);
}

// ---- write the copies ----
await mkdir(OUT, { recursive: true });
const large = new Set<string>([...heroes.values(), ...Object.values(stage)]);
const photos: Record<string, Cover> = {};
let made = 0;
for (const [src, s] of sizes) {
  const cover: Cover = { w: s.w, h: s.h, sm: `/covers/${s.key}-${SMALL}.webp` };
  const jobs: [string, number, number][] = [[cover.sm, SMALL, 70]];
  if (large.has(src) && Math.max(s.w, s.h) > SMALL) {
    cover.lg = `/covers/${s.key}-${LARGE}.webp`;
    jobs.push([cover.lg, LARGE, 74]);
  }
  try {
    for (const [url, width, quality] of jobs) {
      const out = join(ROOT, 'public', url);
      if (existsSync(out)) continue;
      await sharp(s.file)
        .rotate()
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toFile(out);
      made++;
    }
    photos[src] = cover;
  } catch (err) {
    console.warn(`covers: skipped ${src} (${(err as Error).message})`);
  }
}

// ---- the photographs on the map, at the size of a contact print ----
try {
  const posts: { media: { thumb: string }[] }[] = JSON.parse(await readFile(POSTS, 'utf8'));
  for (const post of posts) {
    const src = post.media[0]?.thumb;
    const file = src ? join(PHOTOS, decodeURIComponent(src)) : '';
    if (!src || !existsSync(file)) continue;
    const { size } = await stat(file);
    const key = createHash('sha1').update(`${src}|${size}`).digest('hex').slice(0, 12);
    const url = `/covers/${key}-${TINY}.webp`;
    const out = join(ROOT, 'public', url);
    try {
      if (!existsSync(out)) {
        await sharp(file).rotate().resize({ width: TINY, withoutEnlargement: true }).webp({ quality: 68 }).toFile(out);
        made++;
      }
      const m = await sharp(out).metadata();
      photos[src] = { w: m.width ?? TINY, h: m.height ?? TINY, sm: url };
    } catch (err) {
      console.warn(`covers: skipped ${src} (${(err as Error).message})`);
    }
  }
} catch {
  // No photographs published to the map yet.
}

await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ photos, stage }));
console.log(`covers: ${Object.keys(photos).length} photographs, ${made} new files`);
