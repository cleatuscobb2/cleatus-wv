/**
 * Copy the variable fonts out of node_modules into public/fonts.
 *
 * Self-hosted rather than CDN-linked: no third-party request on a page whose
 * whole point is that it still works in fifteen years. The copies are committed.
 *
 * Archivo uses the `wdth` build because §6.3 asks for the Expanded axis; the
 * `standard` build carries weight only.
 */
import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/fonts');

const WANTED: [pkg: string, file: string, as: string][] = [
  ['@fontsource-variable/archivo', 'archivo-latin-wdth-normal.woff2', 'archivo-variable.woff2'],
  ['@fontsource-variable/source-serif-4', 'source-serif-4-latin-wght-normal.woff2', 'source-serif-4-variable.woff2'],
  ['@fontsource-variable/source-serif-4', 'source-serif-4-latin-wght-italic.woff2', 'source-serif-4-italic-variable.woff2'],
  ['@fontsource-variable/jetbrains-mono', 'jetbrains-mono-latin-wght-normal.woff2', 'jetbrains-mono-variable.woff2'],
];

await mkdir(OUT, { recursive: true });

for (const [pkg, file, as] of WANTED) {
  const src = join(ROOT, 'node_modules', pkg, 'files', file);
  await copyFile(src, join(OUT, as));
  console.log(`${as.padEnd(38)} ← ${pkg}/files/${file}`);
}

const written = await readdir(OUT);
console.log(`\npublic/fonts: ${written.join(', ')}`);
