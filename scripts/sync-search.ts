/**
 * Mirror the built Pagefind index into public/ so search also works under
 * `astro dev`, which serves public/ rather than dist/.
 *
 * Runs after `pagefind --site dist`. Harmless if the index is missing.
 */
import { cp, rm, stat } from 'node:fs/promises';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'dist/pagefind');
const DEST = join(ROOT, 'public/pagefind');

try {
  await stat(SRC);
} catch {
  console.log('no dist/pagefind yet — skipping (run `npm run build`)');
  process.exit(0);
}

// Same guard as link-photos: only ever remove inside public/.
if (!DEST.includes(`public${sep}pagefind`)) {
  throw new Error(`refusing to remove ${DEST}`);
}
await rm(DEST, { recursive: true, force: true });
await cp(SRC, DEST, { recursive: true });
console.log('synced dist/pagefind → public/pagefind (for dev)');
