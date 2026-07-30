/**
 * §8 — promote plain Markdown dropped in content/inbox/ into the entries
 * collection.
 *
 *   npm run inbox            # promote everything in content/inbox
 *   npm run inbox -- --dry   # show what would happen, change nothing
 *
 * The point is that writing from a tea house at 15,000 feet on a bad connection
 * should need nothing more than a text file with three lines at the top:
 *
 *     ---
 *     title: The bee that almost killed me
 *     date: 2026-01-05
 *     author: beth
 *     ---
 *
 * Everything else is filled in here. `trip` defaults to the most recent trip,
 * so on a trip you can leave it out entirely.
 *
 * Runs before the build, and is a no-op when the inbox is empty.
 */
import { readdir, readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INBOX = join(ROOT, 'content/inbox');
const DONE = join(ROOT, 'content/inbox/promoted');
const DRY = process.argv.includes('--dry');

if (!existsSync(INBOX)) {
  await mkdir(INBOX, { recursive: true });
  console.log('created content/inbox — nothing to promote yet');
  process.exit(0);
}

const files = (await readdir(INBOX))
  .filter((f) => /\.(md|mdx|txt)$/i.test(f));

if (files.length === 0) {
  console.log('inbox is empty');
  process.exit(0);
}

const tripsDir = join(ROOT, 'src/content/trips');
const tripSlugs = (await readdir(tripsDir)).filter((f) => f.endsWith('.mdx')).map((f) => f.replace(/\.mdx$/, ''));

const dated = await Promise.all(
  tripSlugs.map(async (s) => ({
    slug: s,
    start: (await readFile(join(tripsDir, `${s}.mdx`), 'utf8')).match(/^dateStart:\s*(\S+)/m)?.[1] ?? '',
  })),
);
const latestTrip = dated.sort((a, b) => b.start.localeCompare(a.start))[0]?.slug;

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

/** Minimal frontmatter reader: `key: value` lines between --- fences. */
function split(src: string): { meta: Record<string, string>; body: string } {
  const m = src.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: src.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { meta, body: m[2].trim() };
}

let promoted = 0;
const problems: string[] = [];

for (const file of files) {
  const src = await readFile(join(INBOX, file), 'utf8');
  const { meta, body } = split(src);

  const title = meta.title || file.replace(/\.(md|mdx|txt)$/i, '').replace(/[-_]+/g, ' ');
  const trip = meta.trip || latestTrip;
  const author = (meta.author || meta.authors || 'beth').toLowerCase();
  const date = meta.date || new Date().toISOString().slice(0, 10);
  const day = meta.day && Number.isFinite(Number(meta.day)) ? Number(meta.day) : null;

  if (!trip || !tripSlugs.includes(trip)) {
    problems.push(`${file}: unknown trip "${trip}" — add a \`trip:\` line`);
    continue;
  }
  if (author !== 'andy' && author !== 'beth') {
    problems.push(`${file}: author must be andy or beth, got "${author}"`);
    continue;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    problems.push(`${file}: date must be YYYY-MM-DD, got "${date}"`);
    continue;
  }
  if (!body) {
    problems.push(`${file}: no body text — skipped rather than publishing an empty entry`);
    continue;
  }

  let slug = slugify(title);
  const dir = join(ROOT, 'src/content/entries', trip);
  if (existsSync(join(dir, `${slug}.mdx`))) {
    let n = 2;
    while (existsSync(join(dir, `${slug}-${n}.mdx`))) n++;
    slug = `${slug}-${n}`;
  }

  const out = `---
title: "${title.replace(/"/g, '\\"')}"
trip: "${trip}"
day: ${day ?? 'null'}
date: ${date}
authors: ["${author}"]
tags: []
people: []
bethCried: ${meta.bethcried === 'true' ? 'true' : 'false'}
draft: ${meta.draft === 'true' ? 'true' : 'false'}
---

${body}
`;

  console.log(`${DRY ? 'would promote' : 'promoted'}  ${file}  →  ${trip}/${slug}.mdx`);
  if (!DRY) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${slug}.mdx`), out, 'utf8');
    // Move rather than delete: the original is never destroyed.
    await mkdir(DONE, { recursive: true });
    await rename(join(INBOX, file), join(DONE, file));
  }
  promoted++;
}

if (problems.length) {
  console.log('\nnot promoted:');
  for (const p of problems) console.log(`  ${p}`);
}
console.log(`\n${DRY ? 'would promote' : 'promoted'} ${promoted} of ${files.length}`);
if (!DRY && promoted) console.log('originals moved to content/inbox/promoted/');
