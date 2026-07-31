/**
 * Remove the italic stat line from the prose where it is already rendered as a
 * structured block.
 *
 *   node --experimental-strip-types scripts/dedupe-stat-line.ts --dry
 *   node --experimental-strip-types scripts/dedupe-stat-line.ts
 *
 * Problem 4 in the brief was "structured data trapped in prose". The conversion
 * lifted that line into `leg` frontmatter but left the original in the body, so
 * an entry now states its distance and altitude twice — once in the stat block
 * and again in italics immediately below it.
 *
 * The removal is provable rather than clever: `leg.sourceLine` holds the exact
 * text the parser read. A paragraph is deleted only when, stripped of emphasis
 * markers and whitespace, it is character-identical to that recorded line.
 * Anything that differs by so much as a word is left alone and reported.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = join(ROOT, 'src/content/entries');
const DRY = process.argv.includes('--dry');

/** Emphasis markers and whitespace are presentation; compare what was said. */
const norm = (s: string) =>
  s.replace(/[*_]/g, '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');

let checked = 0, removed = 0;
const skipped: string[] = [];

for (const trip of await readdir(ENTRIES)) {
  for (const f of (await readdir(join(ENTRIES, trip))).filter((x) => x.endsWith('.mdx'))) {
    const path = join(ENTRIES, trip, f);
    const src = await readFile(path, 'utf8');

    const sourceLine = src.match(/^  sourceLine: "(.+)"$/m)?.[1];
    if (!sourceLine) continue;
    checked++;

    const fmEnd = src.indexOf('\n---\n', 4) + 5;
    const head = src.slice(0, fmEnd);
    const body = src.slice(fmEnd);

    const target = norm(sourceLine.replace(/\\"/g, '"'));
    const paras = body.split(/\n{2,}/);
    const hit = paras.findIndex((p) => norm(p) === target);

    if (hit === -1) {
      skipped.push(`${trip}/${f} — prose copy not found or no longer identical`);
      continue;
    }

    paras.splice(hit, 1);
    if (!DRY) await writeFile(path, head + paras.join('\n\n').replace(/^\n+/, '\n'), 'utf8');
    removed++;
    console.log(`  ${DRY ? 'would remove' : 'removed'}  ${trip}/${f}`);
  }
}

console.log(`\nentries with a recorded stat line: ${checked}`);
console.log(`${DRY ? 'would remove' : 'removed'} duplicate prose line: ${removed}`);
if (skipped.length) {
  console.log('left alone:');
  for (const s of skipped) console.log(`  ${s}`);
}
console.log('\nThe original wording is untouched in raw/ and in leg.sourceLine.');
