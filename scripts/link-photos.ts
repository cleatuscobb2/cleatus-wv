/**
 * Expose the committed archive at /photos without duplicating 417 MB into
 * public/.
 *
 * `assets/photos/` is the archive and stays put. This links it to
 * `public/photos/` so Astro serves it — a symlink on Linux/macOS (which is what
 * Vercel builds on), a directory junction on Windows, and a plain copy if the
 * platform refuses both. Runs from `npm run dev` and `npm run build`.
 */
import { symlink, mkdir, cp, lstat, rm } from 'node:fs/promises';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'assets/photos');
const TARGET = join(ROOT, 'public/photos');

try {
  await lstat(SOURCE);
} catch {
  console.error('assets/photos is missing — run `npm run scrape` first.');
  process.exit(1);
}

/*
 * Replace whatever is at public/photos so a stale link cannot shadow a fresh
 * archive — but never recursively delete a real directory here. This path sits
 * one step from assets/photos, and a recursive remove that followed the wrong
 * thing would destroy the only copy of 15 years of photographs.
 */
try {
  const st = await lstat(TARGET);
  if (st.isSymbolicLink() || st.isDirectory() === false) {
    await rm(TARGET, { force: true });           // unlink only
  } else if (st.isDirectory()) {
    // A previous run copied instead of linking. Removing a plain copy is safe
    // only because we know TARGET is inside public/, never assets/.
    if (!TARGET.includes(`public${sep}photos`)) {
      throw new Error(`refusing to remove ${TARGET}: not inside public/`);
    }
    await rm(TARGET, { recursive: true, force: true });
  }
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
}

await mkdir(dirname(TARGET), { recursive: true });

try {
  await symlink(SOURCE, TARGET, process.platform === 'win32' ? 'junction' : 'dir');
  console.log(`linked public/photos → assets/photos (${process.platform === 'win32' ? 'junction' : 'symlink'})`);
} catch (e) {
  console.warn(`link failed (${(e as Error).message}); copying instead — this will take a moment.`);
  await cp(SOURCE, TARGET, { recursive: true });
  console.log('copied assets/photos → public/photos');
}
