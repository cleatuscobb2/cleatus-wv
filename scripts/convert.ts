/**
 * Phase 0.3 — turn the archived HTML into MDX entries.
 *
 *   node --experimental-strip-types scripts/convert.ts
 *
 * Writes src/content/entries/<trip>/<slug>.mdx, src/content/trips/<trip>.mdx,
 * and migration-review.md listing everything a human needs to look at.
 *
 * Every post is checked after conversion: the plain text of the MDX must match
 * the plain text of the source HTML. Any post that loses words is reported, not
 * silently accepted.
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convert, plainText } from './html-to-mdx.ts';
import { parseLeg } from './parse-leg.ts';
import { TRIPS } from './trips.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Decided in Phase 0 review: the two 2015 collections are one trip. */
const CANONICAL_2015 = 'nepal-tibet-india-golden-triangle-2015';
const DUPLICATE_2015 = 'himalayanwinteradventure2015';

const AUTHORS: Record<string, 'andy' | 'beth'> = {
  'cleatus cobb': 'andy',
  'Beth Tisdale': 'beth',
  Bethie: 'beth',
};

interface PostMeta {
  id: string; title: string | null; slug: string;
  legacyUrlId: string | null; liveUrl: string;
  publishOn: number | null; publishedISO: string | null;
  author: string | null; tags: string[]; categories: string[];
  excerpt: string | null; bodyChars: number; images: string[];
}
interface TripReport {
  trip: string; title: string; year: number;
  realPosts: number; posts: PostMeta[];
}
interface PhotoRec { cdnUrl: string; local: string; trip: string; postSlug: string; order: number }

const report: TripReport[] = JSON.parse(await readFile(join(ROOT, 'raw/scrape-report.json'), 'utf8'));
const photos: PhotoRec[] = JSON.parse(await readFile(join(ROOT, 'raw/photo-manifest.json'), 'utf8'));

const photoByUrl = new Map<string, PhotoRec>();
for (const p of photos) photoByUrl.set(p.cdnUrl, p);

const review: string[] = [];
const note = (kind: string, where: string, msg: string) =>
  review.push(`| ${kind} | \`${where}\` | ${msg} |`);

const yaml = (v: unknown): string => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.length ? `[${v.map(yaml).join(', ')}]` : '[]';
  // Two source titles contain literal newlines, which would break the
  // frontmatter block. Collapse all whitespace so every scalar stays on one line.
  const s = String(v).replace(/\s+/g, ' ').trim();
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

async function save(rel: string, data: string) {
  const abs = join(ROOT, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, data, 'utf8');
}

let written = 0, fidelityFails = 0, legsParsed = 0;
const redirects: { source: string; destination: string }[] = [];

for (const trip of report) {
  if (trip.trip === DUPLICATE_2015) continue;   // folded into the canonical 2015 trip

  // Forward chronological — Day 1 first. This is problem 5 in the brief.
  const posts = [...trip.posts].sort((a, b) => (a.publishOn ?? 0) - (b.publishOn ?? 0));

  for (const p of posts) {
    const html = await readFile(join(ROOT, `raw/${trip.trip}/${p.slug}.html`), 'utf8');
    const { mdx, images } = convert(html);

    /*
     * Fidelity check. Compared with all whitespace removed: the source HTML
     * frequently splits words across inline tags (`w<span…>ith`), so a
     * word-count comparison reports drift where the conversion is in fact
     * repairing the text. Character sequence is the real invariant.
     */
    const before = plainText(html).replace(/\s+/g, '');
    const after = plainText(mdx).replace(/\s+/g, '');
    if (before !== after) {
      fidelityFails++;
      let at = 0;
      while (at < before.length && before[at] === after[at]) at++;
      note('TEXT DRIFT', `${trip.trip}/${p.slug}`,
        `${before.length} chars in source vs ${after.length} in MDX; first difference at ${at}: ` +
        `source \`${before.slice(at, at + 40)}\` / mdx \`${after.slice(at, at + 40)}\``);
    }

    // --- day number ---
    const dayM = (p.title ?? '').match(/^day\s*(\d+)/i);
    const day = dayM ? Number(dayM[1]) : null;

    // --- leg stats from the leading emphasised line ---
    let legYaml = '';
    const firstEm = html.match(/<p\b[^>]*>\s*(?:<strong>)?\s*<(?:em|i)>([\s\S]*?)<\/(?:em|i)>/i);
    if (firstEm) {
      const raw = firstEm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      const { leg, assumptions, problems, matched } = parseLeg(raw);
      if (matched) {
        legsParsed++;
        legYaml = [
          'leg:',
          `  from: ${yaml(leg.from)}`,
          `  to: ${yaml(leg.to)}`,
          `  distanceMi: ${yaml(leg.distanceMi)}`,
          `  cumulativeMi: ${yaml(leg.cumulativeMi)}`,
          `  elevationHighFt: ${yaml(leg.elevationHighFt)}`,
          `  elevationLowFt: ${yaml(leg.elevationLowFt)}`,
          `  sourceLine: ${yaml(raw)}`,
        ].join('\n');
        for (const a of assumptions) note('LEG ASSUMPTION', `${trip.trip}/${p.slug}`, `${a} — source: \`${raw}\``);
        for (const q of problems) note('LEG UNPARSED', `${trip.trip}/${p.slug}`, `${q} — source: \`${raw}\``);
      }
    }

    // --- author ---
    const author = AUTHORS[p.author ?? ''];
    if (!author) note('AUTHOR UNKNOWN', `${trip.trip}/${p.slug}`, `byline ${JSON.stringify(p.author)} not mapped`);

    /*
     * Sanity-check the byline against the prose. A post bylined Andy that talks
     * about Andy in the third person was written by Beth and posted from his
     * account. The byline is source data, so it is flagged rather than rewritten.
     */
    if (author) {
      const other = author === 'andy' ? 'Andy' : 'Beth';
      const thirdPerson = (mdx.match(new RegExp(`\\b${other}\\b`, 'g')) ?? []).length;
      if (thirdPerson >= 2) {
        note('BYLINE SUSPECT', `${trip.trip}/${p.slug}`,
          `bylined \`${p.author}\` (→ ${author}) but refers to ${other} in the third person ` +
          `${thirdPerson}× — probably written by the other of you. Not changed.`);
      }
    }

    // --- images: emitted at the end for now; Phase 3 relocates them ---
    const photoBlocks: string[] = [];
    for (const img of images) {
      const rec = photoByUrl.get(img.src);
      if (!rec) {
        note('IMAGE UNRESOLVED', `${trip.trip}/${p.slug}`, `no archived file for ${img.src.slice(0, 90)}`);
        continue;
      }
      // assets/photos is linked to public/photos at build time, so the served
      // path drops the assets/ prefix.
      const served = rec.local.replace(/^assets\/photos\//, '/photos/');
      const alt = img.alt ? ` alt=${yaml(img.alt)}` : '';
      photoBlocks.push(`<Photo src="${served}"${alt} />`);
    }

    const tripRef = trip.trip === CANONICAL_2015 ? CANONICAL_2015 : trip.trip;
    const date = p.publishedISO ? p.publishedISO.slice(0, 10) : null;
    if (!date) note('NO DATE', `${trip.trip}/${p.slug}`, 'publishOn missing');

    const fm = [
      '---',
      `title: ${yaml(p.title ?? p.slug)}`,
      `trip: ${yaml(tripRef)}`,
      `day: ${yaml(day)}`,
      `date: ${date ?? 'null'}`,
      `authors: [${author ? yaml(author) : ''}]`,
      legYaml,
      'tags: []',
      'people: []',
      'bethCried: false',
      'draft: false',
      '# provenance — do not edit',
      `sourceUrl: ${yaml(p.liveUrl)}`,
      `sourceId: ${yaml(p.id)}`,
      '---',
    ].filter(Boolean).join('\n');

    const body = [
      photoBlocks.length ? "import Photo from '../../../components/Photo.astro';\n" : '',
      mdx,
      photoBlocks.length ? `\n${photoBlocks.join('\n')}` : '',
    ].filter(Boolean).join('\n');

    await save(`src/content/entries/${tripRef}/${p.slug}.mdx`, `${fm}\n\n${body}\n`);
    written++;

    // Legacy URL → new canonical URL.
    const legacyPath = new URL(p.liveUrl).pathname;
    const dest = `/${tripRef}/${p.slug}`;
    if (legacyPath !== dest) redirects.push({ source: legacyPath, destination: dest });
  }
}

// The duplicate 2015 collection redirects wholesale into the canonical one.
const dup = report.find((t) => t.trip === DUPLICATE_2015);
if (dup) {
  const canon = report.find((t) => t.trip === CANONICAL_2015)!;
  const canonSlugs = new Set(canon.posts.map((p) => p.slug));
  // The 8 slugs that differ between the two collections are the same posts saved
  // under variant slugs, so fall back to matching on title, then on publish date.
  const byTitle = new Map(canon.posts.map((p) => [(p.title ?? '').trim().toLowerCase(), p.slug]));
  const byDate = new Map(canon.posts.map((p) => [p.publishedISO?.slice(0, 10) ?? '', p.slug]));

  for (const p of dup.posts) {
    let target = canonSlugs.has(p.slug) ? p.slug : undefined;
    let how = 'slug';
    if (!target) {
      target = byTitle.get((p.title ?? '').trim().toLowerCase());
      how = 'title';
    }
    if (!target) {
      target = byDate.get(p.publishedISO?.slice(0, 10) ?? '');
      how = 'date';
    }
    if (target && how !== 'slug') {
      note('DUPLICATE MATCHED', `${DUPLICATE_2015}/${p.slug}`,
        `slug differs from the canonical trip; matched by ${how} to \`${target}\``);
    }
    if (!target) {
      note('DUPLICATE UNMATCHED', `${DUPLICATE_2015}/${p.slug}`,
        `no counterpart found in ${CANONICAL_2015}; redirected to the trip page. ` +
        'If this is a genuinely distinct post it needs adding by hand.');
    }
    redirects.push({
      source: new URL(p.liveUrl).pathname,
      destination: target ? `/${CANONICAL_2015}/${target}` : `/${CANONICAL_2015}`,
    });
  }
  redirects.push({ source: `/${DUPLICATE_2015}`, destination: `/${CANONICAL_2015}` });
}

await save(
  'migration-review.md',
  [
    '# Migration review',
    '',
    'Generated by `scripts/convert.ts`. Every row is something the converter would',
    'not decide on its own. Nothing here has been guessed.',
    '',
    `${review.length} items.`,
    '',
    '| Kind | Where | Detail |',
    '|---|---|---|',
    ...review,
    '',
  ].join('\n'),
);

await save('raw/redirects.json', JSON.stringify(redirects, null, 2));

/*
 * vercel.json — §4.4. Every legacy path must keep resolving.
 *
 * The old paths contain a double slash (`/trip//2016/01/post.html`) because the
 * Blogger import kept a leading slash in the urlId. Vercel matches `source`
 * against the raw pathname, so the double slash is written literally.
 */
const seenSource = new Set<string>();
const rules = redirects
  .filter((r) => {
    if (r.source === r.destination || seenSource.has(r.source)) return false;
    seenSource.add(r.source);
    return true;
  })
  .map((r) => ({ source: r.source, destination: r.destination, permanent: true }));

// The Squarespace commerce route the brief asks to remove.
rules.push({ source: '/cart', destination: '/', permanent: true });
rules.push({ source: '/checkout', destination: '/', permanent: true });

await save('vercel.json', `${JSON.stringify({ redirects: rules }, null, 2)}\n`);
console.log(`vercel.json rules  : ${rules.length}`);

console.log(`entries written    : ${written}`);
console.log(`leg stat lines     : ${legsParsed}`);
console.log(`redirects          : ${redirects.length}`);
console.log(`text-drift posts   : ${fidelityFails}`);
console.log(`review items       : ${review.length}  -> migration-review.md`);
