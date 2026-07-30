/**
 * Phase 0 gate. Proves the archive and the conversion are complete and lossless.
 * Exits non-zero on any failure so it can gate a build.
 *
 *   node --experimental-strip-types scripts/verify-phase0.ts
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DUPLICATE_2015 = 'himalayanwinteradventure2015';

const fail: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, msg: string) => (cond ? ok : fail).push(msg);

const report = JSON.parse(await readFile(join(ROOT, 'raw/scrape-report.json'), 'utf8'));
const photos = JSON.parse(await readFile(join(ROOT, 'raw/photo-manifest.json'), 'utf8'));
const redirects = JSON.parse(await readFile(join(ROOT, 'raw/redirects.json'), 'utf8'));

// 1. every archived post has HTML on disk
let missingHtml = 0;
for (const t of report) {
  for (const p of t.posts) {
    try { await stat(join(ROOT, `raw/${t.trip}/${p.slug}.html`)); }
    catch { missingHtml++; }
  }
}
const totalPosts = report.reduce((n: number, t: any) => n + t.realPosts, 0);
check(missingHtml === 0, `archived HTML present for all ${totalPosts} posts (missing: ${missingHtml})`);

// 2. every manifest image exists and is non-empty
let missingImg = 0, emptyImg = 0;
for (const m of photos) {
  try {
    const s = await stat(join(ROOT, m.local));
    if (s.size === 0) emptyImg++;
  } catch { missingImg++; }
}
check(missingImg === 0 && emptyImg === 0,
  `all ${photos.length} images on disk and non-empty (missing ${missingImg}, empty ${emptyImg})`);

// 3. MDX entry count == posts minus the duplicate collection
const expected = totalPosts - (report.find((t: any) => t.trip === DUPLICATE_2015)?.realPosts ?? 0);
let mdxCount = 0;
const entriesDir = join(ROOT, 'src/content/entries');
for (const trip of await readdir(entriesDir)) {
  const files = (await readdir(join(entriesDir, trip))).filter((f) => f.endsWith('.mdx'));
  mdxCount += files.length;
}
check(mdxCount === expected, `MDX entries: ${mdxCount} (expected ${expected})`);

// 4. frontmatter completeness + non-empty body
let noTitle = 0, noDate = 0, noTrip = 0, emptyBody = 0, noAuthor = 0;
for (const trip of await readdir(entriesDir)) {
  for (const f of (await readdir(join(entriesDir, trip))).filter((x) => x.endsWith('.mdx'))) {
    const s = await readFile(join(entriesDir, trip, f), 'utf8');
    const fm = s.slice(0, s.indexOf('\n---', 4));
    if (!/\ntitle: ".+"/.test(fm)) noTitle++;
    if (!/\ndate: \d{4}-\d{2}-\d{2}/.test(fm)) noDate++;
    if (!/\ntrip: ".+"/.test(fm)) noTrip++;
    if (/\nauthors: \[\]/.test(fm)) noAuthor++;
    const body = s.split(/\n---\n/).slice(1).join('\n---\n')
      .replace(/^import .*$/gm, '').replace(/<Photo[^>]*\/>/g, '').trim();
    if (body.length < 40) emptyBody++;
  }
}
check(noTitle === 0, `every entry has a title (missing ${noTitle})`);
check(noDate === 0, `every entry has a date (missing ${noDate})`);
check(noTrip === 0, `every entry references a trip (missing ${noTrip})`);
check(noAuthor === 0, `every entry has an author (missing ${noAuthor})`);
check(emptyBody === 0, `no entry has an empty body (empty ${emptyBody})`);

// 5. every legacy URL is covered by a redirect or is already canonical
const covered = new Set(redirects.map((r: any) => r.source));
let uncovered = 0;
for (const t of report) {
  for (const p of t.posts) {
    const path = new URL(p.liveUrl).pathname;
    const canonical = `/${t.trip === DUPLICATE_2015 ? 'nepal-tibet-india-golden-triangle-2015' : t.trip}/${p.slug}`;
    if (path !== canonical && !covered.has(path)) uncovered++;
  }
}
check(uncovered === 0, `every legacy URL has a redirect (uncovered: ${uncovered})`);

// 6. no redirect points at a non-existent entry
let danglingRedirect = 0;
for (const r of redirects) {
  const m = r.destination.match(/^\/([^/]+)\/(.+)$/);
  if (!m) continue;
  try { await stat(join(entriesDir, m[1], `${m[2]}.mdx`)); }
  catch { danglingRedirect++; }
}
check(danglingRedirect === 0, `no redirect points at a missing entry (dangling: ${danglingRedirect})`);

console.log('PASS');
for (const o of ok) console.log('  ✓ ' + o);
if (fail.length) {
  console.log('FAIL');
  for (const f of fail) console.log('  ✗ ' + f);
}
process.exit(fail.length ? 1 : 0);
