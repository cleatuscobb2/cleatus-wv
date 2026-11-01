/**
 * Runs after `astro build`: the admin is dev-only, so nothing of it may reach
 * dist/. Fails the build if any admin page, admin API, or sitemap mention of
 * /admin got through.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const problems: string[] = [];

for (const p of ['admin', 'api']) {
  if (existsSync(join(DIST, p))) problems.push(`${DIST}/${p}/ exists`);
}

for (const f of readdirSync(DIST).filter((f) => /^sitemap.*\.xml$/.test(f))) {
  if (readFileSync(join(DIST, f), 'utf8').includes('/admin')) problems.push(`${f} lists an /admin URL`);
}

// Server code from the admin would land in a function bundle, not in dist/
// pages, so check that no built file mentions the admin's private header.
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}
for (const f of walk(DIST).filter((f) => /\.(html|js|mjs)$/.test(f))) {
  if (readFileSync(f, 'utf8').includes('x-cleatus-admin')) problems.push(`${f} contains admin code`);
}

if (problems.length) {
  console.error(`verify-build: admin leaked into the build:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('verify-build: no admin output in dist/ ✓');
