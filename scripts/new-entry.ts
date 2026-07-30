/**
 * Scaffold a new entry (§8).
 *
 *   npm run new:entry -- --trip k2pakistanseasia2024 --title "Day 12 Home"
 *   npm run new:entry -- --trip japan-2022 --title "Onsen" --author andy --day 4
 *
 * With no --trip it uses the most recent one. With no --date it uses today.
 * Prints the path it wrote so you can open it straight away.
 */
import { writeFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

const title = arg('title');
if (!title) {
  console.error(`
Usage: npm run new:entry -- --title "Day 12 Home" [options]

  --title   required. The entry title.
  --trip    trip slug. Defaults to the most recent trip.
  --author  andy | beth. Defaults to beth.
  --date    YYYY-MM-DD. Defaults to today.
  --day     trek day number, if this is part of a numbered trek.
`);
  process.exit(1);
}

const tripsDir = join(ROOT, 'src/content/trips');
const tripFiles = (await readdir(tripsDir)).filter((f) => f.endsWith('.mdx'));
const tripSlugs = tripFiles.map((f) => f.replace(/\.mdx$/, ''));

let trip = arg('trip');
if (!trip) {
  // Most recent by dateStart in frontmatter.
  const dated = await Promise.all(
    tripSlugs.map(async (s) => {
      const src = await readFile(join(tripsDir, `${s}.mdx`), 'utf8');
      return { slug: s, start: src.match(/^dateStart:\s*(\S+)/m)?.[1] ?? '' };
    }),
  );
  trip = dated.sort((a, b) => b.start.localeCompare(a.start))[0]?.slug;
}
if (!trip || !tripSlugs.includes(trip)) {
  console.error(`Unknown trip "${trip}". Available:\n  ${tripSlugs.join('\n  ')}`);
  process.exit(1);
}

const author = (arg('author') ?? 'beth').toLowerCase();
if (author !== 'andy' && author !== 'beth') {
  console.error(`--author must be "andy" or "beth", got "${author}"`);
  process.exit(1);
}

const date = arg('date') ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`--date must be YYYY-MM-DD, got "${date}"`);
  process.exit(1);
}

const dayArg = arg('day');
const day = dayArg ? Number(dayArg) : null;
if (dayArg && !Number.isFinite(day)) {
  console.error(`--day must be a number, got "${dayArg}"`);
  process.exit(1);
}

let slug = slugify(title);
const dir = join(ROOT, 'src/content/entries', trip);
await mkdir(dir, { recursive: true });
// Never clobber an existing entry.
if (existsSync(join(dir, `${slug}.mdx`))) {
  let n = 2;
  while (existsSync(join(dir, `${slug}-${n}.mdx`))) n++;
  slug = `${slug}-${n}`;
}

const body = `---
title: "${title.replace(/"/g, '\\"')}"
trip: "${trip}"
day: ${day ?? 'null'}
date: ${date}
authors: ["${author}"]
tags: []
people: []
bethCried: false
draft: true
---

Write here. Plain paragraphs, blank line between them. Nothing is auto-corrected —
swearing, spelling and voice all survive exactly as typed.

Photographs go inline where they belong:

{/* <Photo src="/photos/${trip}/${slug}/01-name.jpg" caption="" /> */}

Other things available: <PhotoPair />, <PhotoStrip />, <Aside term="">…</Aside>,
<PullQuote>…</PullQuote>. None of them need importing.

Set draft: false when it is ready to publish.
`;

const rel = `src/content/entries/${trip}/${slug}.mdx`;
await writeFile(join(ROOT, rel), body, 'utf8');
console.log(`\n  ${rel}\n`);
console.log(`  trip   ${trip}`);
console.log(`  date   ${date}${day != null ? `   day ${day}` : ''}`);
console.log(`  author ${author}`);
console.log(`\n  It is a draft — set draft: false to publish.\n`);
