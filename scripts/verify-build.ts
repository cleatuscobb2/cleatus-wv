/**
 * Runs inside `npm run build`, after `npm run routes`.
 *
 * The admin is built (Phase B), but only ever as server code that checks the
 * session on every request. What must never happen is an admin page landing in
 * the public static files, where it would be served to anyone with no check at
 * all. This fails the build if:
 *
 *   - any admin or API path exists as a static file
 *   - a sitemap lists /admin or /api
 *   - an admin or API path is not routed to the server function
 *   - a static HTML page carries the admin's request header (i.e. admin markup)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = '.vercel/output';
const STATIC = join(OUT, 'static');
const problems: string[] = [];

if (!existsSync(STATIC)) {
  console.error(`verify-build: ${STATIC} is missing — did the Vercel adapter run?`);
  process.exit(1);
}

for (const p of ['admin', 'api']) {
  if (existsSync(join(STATIC, p))) problems.push(`static/${p}/ exists — admin would be public and unauthenticated`);
}

for (const f of readdirSync(STATIC).filter((f) => /^sitemap.*\.xml$/.test(f))) {
  if (/\/(admin|api)\b/.test(readFileSync(join(STATIC, f), 'utf8'))) problems.push(`${f} lists an /admin or /api URL`);
}

// Every injected admin path must go to the function, where the session check lives.
const routes: { src?: string; dest?: string }[] = JSON.parse(readFileSync(join(OUT, 'config.json'), 'utf8')).routes;
const expected = [
  '/admin', '/admin/curate', '/admin/verify', '/admin/trips', '/admin/trips/japan-2022',
  '/admin/entry/japan-2022/all-food-122822', '/api/admin/preview', '/api/admin/entry',
  '/admin/new', '/api/admin/new', '/api/admin/photo', '/admin/places', '/api/admin/places', '/admin/readers', '/api/hit', '/admin/comments', '/api/admin/comments', '/api/comment',
  '/api/admin/curate', '/api/admin/trip', '/api/auth/request', '/api/auth/verify', '/api/auth/signout',
];
for (const path of expected) {
  const r = routes.find((r) => r.src && new RegExp(r.src).test(path));
  if (!r || r.dest !== '_render') problems.push(`${path} is not routed to the server function`);
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}
for (const f of walk(STATIC).filter((f) => f.endsWith('.html'))) {
  if (readFileSync(f, 'utf8').includes('x-cleatus-admin')) problems.push(`${f} contains admin markup`);
}

if (problems.length) {
  console.error(`verify-build: the admin is exposed in the build:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('verify-build: admin is server-only, nothing of it in the static files ✓');
