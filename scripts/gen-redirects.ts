/**
 * Build vercel.json's redirects from raw/redirects.json.
 *
 *   node --experimental-strip-types scripts/gen-redirects.ts
 *
 * Kept separate from convert.ts on purpose: that script regenerates every entry
 * from raw/, so re-running it just to touch redirects would wipe out any later
 * edits to the entries.
 *
 * Why each double-slash source is emitted twice:
 *
 * About 200 of the old Blogger-era URLs contain a double slash, like
 * `/trip//2016/01/post.html`, because the import kept a leading slash in the
 * urlId. Vercel collapses `//` to `/` with its own 308 *before* it evaluates
 * redirect rules, so a rule written for the literal double-slash path never
 * matches; the request lands on the collapsed path, finds no rule, and 404s.
 * That was only discovered once the real domain went live (2026-11-01): 200 of
 * 333 legacy links were dead-ending.
 *
 * So every such source also gets a rule for its collapsed form. The chain is
 * then `//` → (Vercel) → `/` → (this rule) → new page: two permanent hops,
 * which browsers and search engines follow without complaint. The literal form
 * stays as well, in case Vercel ever stops normalising.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Redirect { source: string; destination: string }
const raw: Redirect[] = JSON.parse(await readFile(join(ROOT, 'raw/redirects.json'), 'utf8'));

const collapse = (p: string) => p.replace(/\/{2,}/g, '/');

const bySource = new Map<string, string>();
const conflicts: string[] = [];
let collapsedAdded = 0;

function add(source: string, destination: string) {
  if (source === destination) return;
  const existing = bySource.get(source);
  if (existing && existing !== destination) {
    conflicts.push(`${source}\n    → ${existing}\n    → ${destination}`);
    return;
  }
  bySource.set(source, destination);
}

for (const r of raw) {
  add(r.source, r.destination);
  const c = collapse(r.source);
  if (c !== r.source) {
    if (!bySource.has(c)) collapsedAdded++;
    add(c, r.destination);
  }
}

// The Squarespace commerce routes the brief asks to remove.
add('/cart', '/');
add('/checkout', '/');

if (conflicts.length) {
  console.error(`${conflicts.length} sources map to two different pages — refusing to guess:`);
  for (const c of conflicts) console.error(`  ${c}`);
  process.exit(1);
}

const rules = [...bySource].map(([source, destination]) => ({ source, destination, permanent: true }));
await writeFile(join(ROOT, 'vercel.json'), `${JSON.stringify({ redirects: rules }, null, 2)}\n`, 'utf8');

console.log(`legacy redirects in raw/redirects.json : ${raw.length}`);
console.log(`collapsed-slash variants added         : ${collapsedAdded}`);
console.log(`vercel.json rules written              : ${rules.length}`);
