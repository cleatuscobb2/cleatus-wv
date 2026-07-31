/**
 * Start a new trip.
 *
 *   npm run new:trip -- --title "Torres del Paine 2027" --countries CL,AR
 *   npm run new:trip -- --title "Kyrgyzstan" --countries KG --short "Kyrgyzstan" --start 2027-06-01
 *
 * Writes src/content/trips/<slug>.mdx and creates the entries folder, so
 * `npm run new:entry --trip <slug>` works immediately.
 *
 * The trip is created with `summaryNeedsReview: false` — you are writing this
 * one yourself, so `npm run gen:trips` will only ever refresh its derived stats
 * and will never overwrite what you wrote.
 *
 * Countries use ISO 3166-1 alpha-2. Any code not already known to
 * src/data/trip-meta.ts is reported so it can be added there for the map.
 */
import { writeFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COUNTRY_NAMES, COUNTRY_NUMERIC } from '../src/data/trip-meta.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};

const title = arg('title');
if (!title) {
  console.error(`
Usage: npm run new:trip -- --title "Torres del Paine 2027" [options]

  --title      required. Full trip title.
  --countries  ISO alpha-2, comma separated, e.g. CL,AR
  --short      short title for nav and cards. Defaults to --title.
  --slug       url slug. Defaults to a slug of the title.
  --start      YYYY-MM-DD. Defaults to today.
  --end        YYYY-MM-DD. Defaults to --start.
  --regions    comma separated, e.g. "Patagonia,Torres del Paine"
`);
  process.exit(1);
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const slug = arg('slug') ?? slugify(title);
const short = arg('short') ?? title;
const start = arg('start') ?? new Date().toISOString().slice(0, 10);
const end = arg('end') ?? start;
const countries = (arg('countries') ?? '').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
const regions = (arg('regions') ?? '').split(',').map((r) => r.trim()).filter(Boolean);

for (const d of [start, end]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    console.error(`Dates must be YYYY-MM-DD, got "${d}"`);
    process.exit(1);
  }
}

const tripFile = join(ROOT, `src/content/trips/${slug}.mdx`);
if (existsSync(tripFile)) {
  console.error(`\n  src/content/trips/${slug}.mdx already exists.`);
  console.error('  Edit it directly, or pass a different --slug.\n');
  process.exit(1);
}

const q = (s: unknown) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const days = Math.max(1, Math.round((+new Date(end) - +new Date(start)) / 86400000) + 1);

const body = `---
title: ${q(title)}
shortTitle: ${q(short)}
year: ${Number(start.slice(0, 4))}
dateStart: ${start}
dateEnd: ${end}
countries: [${countries.map(q).join(', ')}]
regions: [${regions.map(q).join(', ')}]
summary: ""
# You are writing this trip, so gen:trips will only refresh the stats below and
# will never overwrite the summary, hero or dates. Leave this false.
summaryNeedsReview: false
hero: null
stats:
  days: ${days}
  entries: 0
  countriesCount: ${countries.length}
featured: false
---
`;

await mkdir(join(ROOT, 'src/content/trips'), { recursive: true });
await writeFile(tripFile, body, 'utf8');
await mkdir(join(ROOT, 'src/content/entries', slug), { recursive: true });

console.log(`\n  src/content/trips/${slug}.mdx`);
console.log(`  src/content/entries/${slug}/   (empty, ready for entries)\n`);
console.log(`  title      ${title}`);
console.log(`  dates      ${start} → ${end}  (${days} days)`);
console.log(`  countries  ${countries.map((c) => COUNTRY_NAMES[c] ?? c).join(', ') || '(none set)'}`);

const unknown = countries.filter((c) => !COUNTRY_NAMES[c]);
const unmapped = countries.filter((c) => COUNTRY_NAMES[c] && !COUNTRY_NUMERIC[c]);
if (unknown.length) {
  console.log(`\n  ⚠ not in src/data/trip-meta.ts: ${unknown.join(', ')}`);
  console.log('    Add a name to COUNTRY_NAMES and an ISO numeric to COUNTRY_NUMERIC,');
  console.log('    or the country will be missing from /map and /places.');
}
if (unmapped.length) {
  console.log(`\n  ⚠ no map geometry for: ${unmapped.join(', ')} — add to COUNTRY_NUMERIC.`);
}

console.log('\n  Next:');
console.log(`    npm run new:entry -- --trip ${slug} --title "Day 1 ..."`);
console.log('    write a two-sentence summary in the trip file');
console.log('    npm run dev\n');
