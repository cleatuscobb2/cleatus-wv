/**
 * Build src/content/trips/*.mdx from the converted entries.
 *
 *   node --experimental-strip-types scripts/gen-trips.ts
 *
 * Everything measurable — dates, day span, entry count, trek miles, max
 * elevation, hero image — is derived from the entries themselves, so it cannot
 * drift from the content. Everything that is voice is NOT written here: each
 * trip gets a factual placeholder summary and `summaryNeedsReview: true`, and
 * TRIPS-TODO.md lists them for Andy and Beth.
 */
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRIPS } from './trips.ts';
import { TRIP_META, COUNTRY_NAMES } from '../src/data/trip-meta.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = join(ROOT, 'src/content/entries');

const q = (s: unknown) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Pull a scalar out of a frontmatter block without a YAML dependency. */
function fm(src: string, key: string): string | null {
  const m = src.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  if (!m) return null;
  return m[1].trim().replace(/^"(.*)"$/, '$1');
}

const todo: string[] = [];
let written = 0;
let refreshed = 0;
const FORCE = process.argv.includes('--force');

/*
 * Which trips to consider.
 *
 * `TRIPS` in scripts/trips.ts is the archival record of what was scraped off
 * Squarespace — it is history and should stay frozen. A trip taken *after* the
 * migration will never appear there, so the real list is "every directory that
 * has entries in it", with the archival list only supplying titles and years
 * for the imported ones.
 */
const entryDirs = (await readdir(ENTRIES, { withFileTypes: true }))
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const known = new Map(TRIPS.map((t) => [t.slug, t]));
const slugs = [...new Set([...TRIPS.map((t) => t.slug), ...entryDirs])];

for (const slug of slugs) {
  let files: string[];
  try {
    files = (await readdir(join(ENTRIES, slug))).filter((f) => f.endsWith('.mdx'));
  } catch {
    continue; // the duplicate 2015 collection has no entries directory
  }
  if (!files.length) continue;

  const tripFile = join(ROOT, `src/content/trips/${slug}.mdx`);
  let existing: string | null = null;
  try { existing = await readFile(tripFile, 'utf8'); } catch { /* new trip */ }

  /*
   * Never overwrite a trip a human has touched.
   *
   * `summaryNeedsReview: false` means someone has written a real summary,
   * chosen a hero, or fixed the dates. Regenerating would replace all of that
   * with the auto-derived placeholder and silently undo the work — so those
   * trips get their derived stats refreshed in place and nothing else.
   */
  if (existing && fm(existing, 'summaryNeedsReview') === 'false' && !FORCE) {
    const rows = [];
    for (const f of files) {
      const s = await readFile(join(ENTRIES, slug, f), 'utf8');
      rows.push({
        date: fm(s, 'date') ?? '',
        cumulativeMi: Number(fm(s, '  cumulativeMi')) || null,
        distanceMi: Number(fm(s, '  distanceMi')) || null,
        elevationHighFt: Number(fm(s, '  elevationHighFt')) || null,
      });
    }
    const dates = rows.map((r) => r.date).filter(Boolean).sort();
    const start = new Date(dates[0]);
    const end = new Date(dates[dates.length - 1]);
    const days = Math.max(1, Math.round((+end - +start) / 86400000) + 1);
    const trek = Math.max(0, ...rows.map((r) => r.cumulativeMi ?? 0))
      || rows.reduce((n, r) => n + (r.distanceMi ?? 0), 0);
    const maxEl = Math.max(0, ...rows.map((r) => r.elevationHighFt ?? 0));
    const countries = (existing.match(/^countries: \[(.*)\]$/m)?.[1] ?? '').split(',').filter((x) => x.trim()).length;

    const stats = [
      'stats:',
      `  days: ${days}`,
      `  entries: ${rows.length}`,
      ...(trek > 0 ? [`  trekMiles: ${Math.round(trek)}`] : []),
      ...(maxEl > 0 ? [`  maxElevationFt: ${maxEl}`] : []),
      `  countriesCount: ${countries}`,
    ].join('\n');

    const next = existing.replace(/^stats:\n(?:  .*\n)*/m, `${stats}\n`);
    if (next !== existing) await writeFile(tripFile, next, 'utf8');
    refreshed++;
    console.log(`${slug.padEnd(50)} stats refreshed (summary kept — hand-edited)`);
    continue;
  }

  const trip = known.get(slug) ?? {
    slug,
    title: fm(existing ?? '', 'title') ?? slug,
    year: Number(fm(existing ?? '', 'year')) || new Date().getUTCFullYear(),
  };

  const meta = TRIP_META[slug];
  if (!meta) {
    todo.push(
      `- **${slug}** — new trip with no entry in \`src/data/trip-meta.ts\`. ` +
      'Run `npm run new:trip` instead, or add countries and a short title there.',
    );
    continue;
  }

  const rows = [];
  for (const f of files) {
    const s = await readFile(join(ENTRIES, trip.slug, f), 'utf8');
    rows.push({
      slug: f.replace(/\.mdx$/, ''),
      title: fm(s, 'title') ?? '',
      date: fm(s, 'date') ?? '',
      day: Number(fm(s, 'day')) || null,
      cumulativeMi: Number(fm(s, '  cumulativeMi')) || null,
      distanceMi: Number(fm(s, '  distanceMi')) || null,
      elevationHighFt: Number(fm(s, '  elevationHighFt')) || null,
      photo: s.match(/<Photo src="([^"]+)"/)?.[1] ?? null,
      body: s.split(/\n---\n/).slice(1).join('\n').replace(/^import .*$/gm, '').trim(),
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  const start = new Date(dates[0]);
  const end = new Date(dates[dates.length - 1]);
  const days = Math.max(1, Math.round((+end - +start) / 86400000) + 1);

  /*
   * Publish dates stand in for travel dates, which is fine until someone posts
   * months after getting home. Japan 2022 spans 535 days for exactly that
   * reason. Flag rather than silently print a wrong number on the trip page.
   */
  if (days > 120) {
    todo.push(
      `- **${trip.slug}** — computed span is ${days} days (${iso(start)} → ${iso(end)}), ` +
      'which is a publish-date artefact, not the trip length. Set the real dateStart/dateEnd by hand.',
    );
  }

  const trekMiles = Math.max(0, ...rows.map((r) => r.cumulativeMi ?? 0))
    || rows.reduce((n, r) => n + (r.distanceMi ?? 0), 0);
  const maxElevationFt = Math.max(0, ...rows.map((r) => r.elevationHighFt ?? 0));

  // Hero: the first photograph of the trip, or null where there are none.
  const hero = rows.find((r) => r.photo)?.photo ?? null;
  if (!hero) {
    todo.push(`- **${trip.slug}** — no photographs anywhere in this trip; hero is null and cards fall back to a rule.`);
  } else {
    todo.push(
      `- **${trip.slug}** — hero is just the first photograph of the first entry ` +
      `(\`${hero.split('/').pop()}\`). Pick the one that should carry the trip.`,
    );
  }

  // Start here: the entry with the most prose, as a defensible default.
  const startHere = [...rows].sort((a, b) => b.body.length - a.body.length)[0]?.slug;

  const countryNames = meta.countries.map((c) => COUNTRY_NAMES[c] ?? c);
  // UTC throughout. Formatting in local time shifted every date back a day for
  // anyone west of Greenwich, so the summary disagreed with the page header.
  const fmtRange = (() => {
    const o: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', timeZone: 'UTC' };
    const a = start.toLocaleDateString('en-GB', o);
    const b = end.toLocaleDateString('en-GB', { ...o, year: 'numeric' });
    return `${a} – ${b}`;
  })();

  // Factual, not voiced. Flagged for rewriting.
  const summary =
    `${rows.length} entries from ${countryNames.slice(0, 3).join(', ')}` +
    `${countryNames.length > 3 ? ` and ${countryNames.length - 3} more` : ''}, ${fmtRange}.`;
  todo.push(`- **${trip.slug}** — summary is auto-derived: _"${summary}"_ — replace with two sentences in your own voice.`);

  if (meta.confirm) todo.push(`  - ⚠ ${meta.confirm}`);

  const body = [
    '---',
    `title: ${q(trip.title)}`,
    `shortTitle: ${q(meta.shortTitle)}`,
    `year: ${trip.year}`,
    `dateStart: ${iso(start)}`,
    `dateEnd: ${iso(end)}`,
    `countries: [${meta.countries.map(q).join(', ')}]`,
    `regions: [${meta.regions.map(q).join(', ')}]`,
    `summary: ${q(summary)}`,
    'summaryNeedsReview: true',
    `hero: ${hero ? q(hero) : 'null'}`,
    'stats:',
    `  days: ${days}`,
    `  entries: ${rows.length}`,
    ...(trekMiles > 0 ? [`  trekMiles: ${Math.round(trekMiles)}`] : []),
    ...(maxElevationFt > 0 ? [`  maxElevationFt: ${maxElevationFt}`] : []),
    `  countriesCount: ${meta.countries.length}`,
    `featured: ${trip.slug === 'k2pakistanseasia2024'}`,
    ...(startHere ? [`startHere: ${q(startHere)}`] : []),
    '---',
    '',
  ].join('\n');

  await mkdir(join(ROOT, 'src/content/trips'), { recursive: true });
  await writeFile(join(ROOT, `src/content/trips/${trip.slug}.mdx`), body, 'utf8');
  written++;
  console.log(
    `${trip.slug.padEnd(50)} entries=${String(rows.length).padStart(3)} days=${String(days).padStart(3)} ` +
    `trek=${String(Math.round(trekMiles)).padStart(3)}mi maxEl=${maxElevationFt || '—'} hero=${hero ? 'yes' : 'NONE'}`,
  );
}

await writeFile(
  join(ROOT, 'TRIPS-TODO.md'),
  ['# Trips — what needs a human',
    '',
    'Generated by `scripts/gen-trips.ts`. Everything measurable was derived from the',
    'entries. Everything below is a judgement call or a piece of writing that is yours.',
    '',
    ...todo, ''].join('\n'),
  'utf8',
);

console.log(`\ntrips generated: ${written}   stats-only refresh: ${refreshed}`);
if (refreshed) {
  console.log('hand-edited trips kept their summary, hero and dates. --force overrides.');
}
console.log(`TRIPS-TODO.md has ${todo.length} items`);
