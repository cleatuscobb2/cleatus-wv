/**
 * Runs after `npm run routes`: walks every legacy Squarespace URL through the
 * built routing file (.vercel/output/config.json) the way Vercel would, and
 * fails unless each one ends on a page that exists in .vercel/output/static.
 *
 * This is the offline version of the go-live check, so a routing regression is
 * caught in the build rather than by a reader following an old link.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.vercel/output';
const STATIC = join(OUT, 'static');
const routes: { src?: string; status?: number; headers?: Record<string, string>; handle?: string }[] =
  JSON.parse(readFileSync(join(OUT, 'config.json'), 'utf8')).routes;
const legacy: { source: string }[] = JSON.parse(readFileSync('raw/redirects.json', 'utf8'));

// Only the routes Vercel evaluates before the filesystem.
const end = routes.findIndex((r) => r.handle === 'filesystem');
const redirects = routes
  .slice(0, end === -1 ? routes.length : end)
  .filter((r) => r.src && r.status && r.headers?.Location)
  .map((r) => ({ re: new RegExp(r.src!), to: r.headers!.Location }));

const served = (path: string) => {
  const p = decodeURIComponent(path.split('?')[0]).replace(/\/+$/, '');
  return existsSync(join(STATIC, p, 'index.html')) || (p !== '' && existsSync(join(STATIC, p)));
};

// Follows redirects the way a browser would, collapsing `//` first as Vercel does.
function resolve(start: string) {
  let path = start;
  for (let hop = 0; hop <= 3; hop++) {
    if (served(path)) return { ok: true, path, hops: hop };
    const variants = [path, path.replace(/\/{2,}/g, '/')];
    const hit = variants.map((v) => redirects.find((r) => r.re.test(v))).find(Boolean);
    if (!hit) return { ok: false, path, hops: hop };
    path = hit.to;
  }
  return { ok: false, path, hops: 4 };
}

const failures = legacy.map((l) => ({ from: l.source, ...resolve(l.source) })).filter((r) => !r.ok);
if (failures.length) {
  console.error(`verify-routes: ${failures.length} of ${legacy.length} legacy URLs don't reach a page:`);
  for (const f of failures.slice(0, 20)) console.error(`  ${f.from} → stopped at ${f.path}`);
  process.exit(1);
}
console.log(`verify-routes: all ${legacy.length} legacy URLs reach a built page ✓`);
