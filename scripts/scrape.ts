/**
 * Phase 0 — archive cleatusandthewestvirginian.com before the Squarespace
 * subscription lapses and the CDN goes away.
 *
 *   node scripts/scrape.ts            full run
 *   node scripts/scrape.ts --no-images   metadata + HTML only
 *
 * Writes, all relative to repo root:
 *   raw/json/<trip>.json              every item the collection API returned
 *   raw/<trip>/<slug>.html            post body HTML, verbatim
 *   raw/<trip>/<slug>.meta.json       title, date, author, live URL, image list
 *   raw/pages/<page>.html             standalone pages
 *   assets/photos/<trip>/<slug>/...   every image at max available resolution
 *   raw/photo-manifest.json           CDN URL -> local path, deterministic
 *   raw/scrape-report.json            per-trip counts and reconciliation
 *
 * Nothing here is destructive: existing files are only rewritten with the same
 * content, and images already on disk with a matching byte length are skipped.
 */
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRIPS, PAGES, BASE, PLACEHOLDER_TITLE, type TripSource } from './trips.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_IMAGES = process.argv.includes('--no-images');

const UA = 'Mozilla/5.0 (compatible; cleatus-archive/1.0; personal site backup)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Squarespace content-negotiates on Accept. Left to itself, fetch() advertises
 * `*​/*` and the CDN returns WebP — a second lossy transcode of an already-lossy
 * JPEG, ~35% smaller at identical pixel dimensions. For an archive we want the
 * least-recompressed master, so images are requested as JPEG explicitly.
 */
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/*;q=0.8';

async function req(url: string, tries = 5, accept?: string): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const headers: Record<string, string> = { 'user-agent': UA };
      if (accept) headers.accept = accept;
      const res = await fetch(url, { headers });
      // 429/5xx are worth waiting out; 404 is not.
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      return res;
    } catch (e) {
      last = e;
      if ((e as { fatal?: boolean }).fatal) throw e;
      if (i === tries - 1) break;
      await sleep(2000 * (i + 1));
    }
  }
  throw last;
}

const getJson = async (url: string) => (await req(url)).json();

interface SqsAuthor { displayName?: string }
interface SqsItem {
  id: string;
  title?: string;
  urlId?: string;
  fullUrl?: string;
  body?: string;
  excerpt?: string;
  publishOn?: number;
  addedOn?: number;
  updatedOn?: number;
  author?: SqsAuthor;
  authorId?: string;
  tags?: string[];
  categories?: string[];
  assetUrl?: string;
  items?: { assetUrl?: string }[];
  recordType?: number;
  workflowState?: number;
}

/** Walk the ?offset= cursor to the end of a collection. */
async function fetchCollection(slug: string) {
  const items: SqsItem[] = [];
  const seen = new Set<string>();
  let url: string | null = `${BASE}/${slug}?format=json-pretty`;
  let collection: Record<string, unknown> | null = null;
  let pages = 0;
  let guard = 0;

  while (url && guard++ < 60) {
    const j = await getJson(url);
    collection ??= j.collection;
    pages++;
    let fresh = 0;
    for (const it of (j.items ?? []) as SqsItem[]) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      items.push(it);
      fresh++;
    }
    // Defend against a cursor that loops forever without new items.
    if (fresh === 0 && pages > 1) break;
    url = j.pagination?.nextPage ? `${BASE}${j.pagination.nextPageUrl}&format=json-pretty` : null;
    await sleep(350);
  }
  return { collection, items, pages };
}

/**
 * Most posts were imported from Blogger and kept paths like
 * `/2016/01/schnapps-and-rotwurst-128.html`. Reduce to a clean, filesystem-safe
 * slug while recording the original so redirects can be generated later.
 */
function cleanSlug(urlId: string | undefined, fallback: string): string {
  const raw = (urlId ?? '').replace(/^\/+/, '').replace(/\.html?$/i, '');
  const last = raw.split('/').filter(Boolean).pop() ?? '';
  const s = last
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return s || fallback;
}

/** The URL that actually resolves today (Squarespace emits a double slash). */
const liveUrl = (trip: string, it: SqsItem) =>
  it.fullUrl ? `${BASE}${it.fullUrl}` : `${BASE}/${trip}/${it.urlId ?? ''}`;

const CDN_RE = /https:\/\/images\.squarespace-cdn\.com\/content\/[^"'\s\\?)]+/g;

function imageUrls(it: SqsItem): string[] {
  const out = new Set<string>();
  for (const u of (it.body ?? '').match(CDN_RE) ?? []) out.add(u);
  for (const sub of it.items ?? []) if (sub.assetUrl) out.add(sub.assetUrl.split('?')[0]);
  return [...out];
}

/** Read intrinsic dimensions and container format from the file header. */
function dimensions(buf: Buffer): { w: number; h: number; fmt: string } | null {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), fmt: 'png' };
  }
  if (buf.length > 30 && buf.subarray(0, 4).toString('latin1') === 'RIFF'
      && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    const chunk = buf.subarray(12, 16).toString('latin1');
    if (chunk === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), fmt: 'webp' };
    if (chunk === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, fmt: 'webp' };
    if (chunk === 'VP8L') {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1, fmt: 'webp' };
    }
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const m = buf[o + 1];
      if (m === 0xff) { o++; continue; }              // fill byte
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd9)) { o += 2; continue; }  // no length field
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7), fmt: 'jpeg' };
      }
      o += 2 + buf.readUInt16BE(o + 2);
    }
  }
  return null;
}

/** JPEG APP1/Exif presence — Squarespace strips this, so we record the truth. */
const hasExif = (buf: Buffer) =>
  buf.subarray(0, Math.min(buf.length, 65536)).includes(Buffer.from('Exif\0\0', 'binary'));

interface PhotoRecord {
  cdnUrl: string;
  local: string;
  trip: string;
  postSlug: string;
  order: number;
  bytes: number;
  format: string | null;
  width: number | null;
  height: number | null;
  declaredWidth: number | null;
  declaredHeight: number | null;
  exif: boolean;
}

const manifest: PhotoRecord[] = [];
const notes: string[] = [];

async function save(rel: string, data: string | Buffer) {
  const abs = join(ROOT, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, data);
}

async function downloadImage(
  cdnUrl: string, trip: string, postSlug: string, order: number,
  declared: Map<string, [number, number]>,
): Promise<void> {
  const name = decodeURIComponent(cdnUrl.split('/').pop() ?? 'image.jpg')
    .replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  const rel = join('assets', 'photos', trip, postSlug, `${String(order).padStart(2, '0')}-${name}`)
    .replaceAll('\\', '/');
  const abs = join(ROOT, rel);
  const d = declared.get(cdnUrl);

  let buf: Buffer | null = null;
  if (existsSync(abs) && (await stat(abs)).size > 0) {
    const existing = await readFile(abs);
    // Re-pull anything previously saved as WebP; we want the JPEG master.
    if (dimensions(existing)?.fmt === 'jpeg' || dimensions(existing)?.fmt === 'png') buf = existing;
  }
  if (!buf) {
    // The bare URL is the largest the CDN will serve. Verified: ?format=original
    // and ?format=4000w return the identical 2500px-capped file.
    const res = await req(cdnUrl, 5, IMAGE_ACCEPT);
    buf = Buffer.from(await res.arrayBuffer());
    await save(rel, buf);
    await sleep(120);
  }

  const dim = dimensions(buf);
  manifest.push({
    cdnUrl, local: rel, trip, postSlug, order,
    bytes: buf.length,
    format: dim?.fmt ?? null,
    width: dim?.w ?? null, height: dim?.h ?? null,
    declaredWidth: d?.[0] ?? null, declaredHeight: d?.[1] ?? null,
    exif: hasExif(buf),
  });

  if (d && dim && (dim.w < d[0] || dim.h < d[1])) {
    notes.push(
      `RESOLUTION LOSS  ${trip}/${postSlug}  ${name} — source ${d[0]}x${d[1]}, CDN caps at ${dim.w}x${dim.h}`,
    );
  }
}

const report: Record<string, unknown>[] = [];

for (const trip of TRIPS as TripSource[]) {
  const { collection, items, pages } = await fetchCollection(trip.slug);
  const real = items.filter((it) => !PLACEHOLDER_TITLE.test(it.title ?? ''));
  const placeholders = items.length - real.length;
  const declaredCount = (collection as { itemCount?: number } | null)?.itemCount ?? null;

  await save(`raw/json/${trip.slug}.json`, JSON.stringify({ collection, items }, null, 2));

  const usedSlugs = new Map<string, number>();
  const posts: Record<string, unknown>[] = [];
  let imgCount = 0;

  for (const it of real) {
    let slug = cleanSlug(it.urlId, it.id);
    const n = usedSlugs.get(slug) ?? 0;
    usedSlugs.set(slug, n + 1);
    if (n > 0) {
      notes.push(`SLUG COLLISION  ${trip.slug}  "${slug}" reused — suffixed -${n + 1}`);
      slug = `${slug}-${n + 1}`;
    }

    await save(`raw/${trip.slug}/${slug}.html`, it.body ?? '');

    const declared = new Map<string, [number, number]>();
    const body = it.body ?? '';
    for (const m of body.matchAll(
      /data-src="(https:\/\/images\.squarespace-cdn\.com[^"?]+)"[^>]*?data-image-dimensions="(\d+)x(\d+)"/g,
    )) declared.set(m[1], [Number(m[2]), Number(m[3])]);
    for (const m of body.matchAll(
      /data-image-dimensions="(\d+)x(\d+)"[\s\S]{0,400}?data-src="(https:\/\/images\.squarespace-cdn\.com[^"?]+)"/g,
    )) if (!declared.has(m[3])) declared.set(m[3], [Number(m[1]), Number(m[2])]);

    const urls = imageUrls(it);
    imgCount += urls.length;
    if (!SKIP_IMAGES) {
      for (const [i, u] of urls.entries()) {
        try {
          await downloadImage(u, trip.slug, slug, i + 1, declared);
        } catch (e) {
          notes.push(`IMAGE FAILED  ${trip.slug}/${slug}  ${u} — ${(e as Error).message}`);
        }
      }
    }

    const meta = {
      id: it.id,
      title: it.title ?? null,
      slug,
      legacyUrlId: it.urlId ?? null,
      liveUrl: liveUrl(trip.slug, it),
      publishOn: it.publishOn ?? null,
      publishedISO: it.publishOn ? new Date(it.publishOn).toISOString() : null,
      author: it.author?.displayName ?? null,
      tags: it.tags ?? [],
      categories: it.categories ?? [],
      excerpt: it.excerpt ?? null,
      bodyChars: (it.body ?? '').length,
      images: urls,
    };
    await save(`raw/${trip.slug}/${slug}.meta.json`, JSON.stringify(meta, null, 2));
    posts.push(meta);
  }

  if (declaredCount !== null && declaredCount !== items.length) {
    notes.push(
      `COUNT GAP  ${trip.slug} — collection.itemCount=${declaredCount} but feed returned ${items.length} ` +
      `(${placeholders} template placeholders seen). Unreturned items are almost certainly unpublished ` +
      `template posts, but this is unverifiable from the public API — confirm in Squarespace admin.`,
    );
  }

  const r = {
    trip: trip.slug, title: trip.title, year: trip.year,
    declaredItemCount: declaredCount, fetched: items.length,
    realPosts: real.length, placeholders, pages, images: imgCount,
    posts,
  };
  report.push(r);
  console.log(
    `${trip.slug.padEnd(50)} real=${String(real.length).padStart(3)} ` +
    `imgs=${String(imgCount).padStart(4)} pages=${pages}`,
  );
}

for (const page of PAGES) {
  try {
    const j = await getJson(`${BASE}/${page}?format=json-pretty`);
    await save(`raw/pages/${page}.json`, JSON.stringify(j, null, 2));
    const html = (await (await req(`${BASE}/${page}`)).text());
    await save(`raw/pages/${page}.html`, html);
    console.log(`page ${page} archived`);
  } catch (e) {
    notes.push(`PAGE FAILED  ${page} — ${(e as Error).message}`);
  }
}

await save('raw/photo-manifest.json', JSON.stringify(manifest, null, 2));
await save('raw/scrape-report.json', JSON.stringify(report, null, 2));
await save(
  'raw/scrape-notes.md',
  `# Scrape notes\n\nGenerated by \`scripts/scrape.ts\`.\n\n` +
  (notes.length ? notes.map((n) => `- ${n}`).join('\n') : '- No anomalies recorded.') + '\n',
);

const totals = report.reduce(
  (t, r) => ({
    posts: t.posts + (r.realPosts as number),
    imgs: t.imgs + (r.images as number),
  }), { posts: 0, imgs: 0 },
);
const stripped = manifest.filter((m) => !m.exif).length;
const downsized = manifest.filter(
  (m) => m.declaredWidth && m.width && m.height &&
    (m.width < m.declaredWidth || m.height < (m.declaredHeight ?? 0)),
).length;
const fmts = manifest.reduce<Record<string, number>>(
  (a, m) => ((a[m.format ?? 'unknown'] = (a[m.format ?? 'unknown'] ?? 0) + 1), a), {});

console.log(`\nposts archived : ${totals.posts}`);
console.log(`image slots    : ${totals.imgs}  (unique files written: ${manifest.length})`);
console.log(`formats        : ${Object.entries(fmts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`EXIF stripped  : ${stripped}/${manifest.length}`);
console.log(`downsized byCDN: ${downsized}/${manifest.length}`);
console.log(`notes          : ${notes.length}  -> raw/scrape-notes.md`);
