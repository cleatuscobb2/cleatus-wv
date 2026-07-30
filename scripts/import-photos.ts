/**
 * §8 — batch photo import. Point it at a folder; it reads EXIF for capture time
 * and GPS, copies the files in capture order, and prints ready-to-paste
 * <Photo /> blocks.
 *
 *   npm run import:photos -- --from "D:/DCIM/100MSDCF" --trip k2pakistanseasia2024 --entry day-9-gondogoro-la-gg-la
 *   npm run import:photos -- --from ./phone --trip japan-2022 --entry onsen --dry
 *
 * Unlike the archived images, photographs straight off a camera or phone still
 * carry EXIF — so this is also what finally puts real coordinates into the site.
 * Any GPS it finds is written to a sidecar the map can consume.
 */
import { readdir, mkdir, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const DRY = process.argv.includes('--dry');

const from = arg('from');
const trip = arg('trip');
const entry = arg('entry');

if (!from || !trip || !entry) {
  console.error(`
Usage: npm run import:photos -- --from <folder> --trip <trip-slug> --entry <entry-slug> [--dry]

Reads every image in <folder>, orders them by EXIF capture time, copies them to
assets/photos/<trip>/<entry>/ and prints <Photo /> blocks to paste into the entry.
`);
  process.exit(1);
}

const IMAGE = /\.(jpe?g|png|heic|webp)$/i;

/* --- minimal EXIF reader: capture time, GPS, orientation ------------------ */
interface Exif { taken?: string; lat?: number; lng?: number; make?: string; model?: string }

function parseExif(buf: Buffer): Exif {
  const out: Exif = {};
  const app1 = buf.indexOf(Buffer.from('Exif\0\0', 'binary'));
  if (app1 < 0) return out;
  const tiff = app1 + 6;
  if (tiff + 8 > buf.length) return out;
  const le = buf.toString('latin1', tiff, tiff + 2) === 'II';
  const u16 = (o: number) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o: number) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  if (u16(tiff + 2) !== 42) return out;

  const gps: Record<number, unknown> = {};
  const walk = (off: number, kind: 'ifd0' | 'exif' | 'gps') => {
    if (off + 2 > buf.length) return;
    const n = u16(off);
    if (n > 512) return;
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (e + 12 > buf.length) break;
      const tag = u16(e);
      const type = u16(e + 2);
      const count = u32(e + 4);
      const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
      const bytes = (sizes[type] ?? 1) * count;
      const vo = bytes <= 4 ? e + 8 : tiff + u32(e + 8);
      if (vo < 0 || vo + Math.min(bytes, 64) > buf.length) continue;
      const ascii = () => buf.toString('latin1', vo, vo + count).replace(/\0.*$/, '');
      const rat = (o: number) => { const a = u32(o), b = u32(o + 4); return b ? a / b : 0; };

      if (kind === 'ifd0') {
        if (tag === 0x010f) out.make = ascii().trim();
        if (tag === 0x0110) out.model = ascii().trim();
        if (tag === 0x8769) walk(tiff + u32(e + 8), 'exif');
        if (tag === 0x8825) walk(tiff + u32(e + 8), 'gps');
      } else if (kind === 'exif') {
        if (tag === 0x9003 && !out.taken) out.taken = ascii();
      } else {
        if (tag === 1 || tag === 3) gps[tag] = ascii();
        if (tag === 2 || tag === 4) gps[tag] = [rat(vo), rat(vo + 8), rat(vo + 16)];
      }
    }
  };
  walk(tiff + u32(tiff + 4), 'ifd0');

  const dms = (d: unknown, ref: unknown) => {
    if (!Array.isArray(d)) return undefined;
    const v = d[0] + d[1] / 60 + d[2] / 3600;
    return ref === 'S' || ref === 'W' ? -v : v;
  };
  out.lat = dms(gps[2], gps[1]);
  out.lng = dms(gps[4], gps[3]);
  return out;
}

/* --- collect ------------------------------------------------------------- */
const srcDir = resolve(from);
let names: string[];
try {
  names = (await readdir(srcDir)).filter((f) => IMAGE.test(f));
} catch {
  console.error(`Cannot read folder: ${srcDir}`);
  process.exit(1);
}
if (!names.length) {
  console.error(`No images found in ${srcDir}`);
  process.exit(1);
}

const shots = [];
for (const name of names) {
  const p = join(srcDir, name);
  const buf = await readFile(p);
  const ex = parseExif(buf);
  const mtime = (await stat(p)).mtime;
  // EXIF is "YYYY:MM:DD HH:MM:SS"; fall back to file mtime so order is never random.
  const taken = ex.taken
    ? new Date(ex.taken.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3').replace(' ', 'T'))
    : mtime;
  shots.push({ name, taken, exif: ex, hasExifTime: !!ex.taken });
}
shots.sort((a, b) => +a.taken - +b.taken);

const destRel = `assets/photos/${trip}/${entry}`;
const destDir = join(ROOT, destRel);
if (!DRY) await mkdir(destDir, { recursive: true });

const blocks: string[] = [];
const coords: { file: string; lat: number; lng: number; taken: string }[] = [];

for (const [i, s] of shots.entries()) {
  const n = String(i + 1).padStart(2, '0');
  const safe = basename(s.name).replace(/[^A-Za-z0-9._-]+/g, '_');
  const outName = `${n}-${safe}`;
  if (!DRY) await copyFile(join(srcDir, s.name), join(destDir, outName));
  blocks.push(`<Photo src="/photos/${trip}/${entry}/${outName}" caption="" />`);
  if (s.exif.lat != null && s.exif.lng != null && (s.exif.lat || s.exif.lng)) {
    coords.push({
      file: outName,
      lat: +s.exif.lat.toFixed(6),
      lng: +s.exif.lng.toFixed(6),
      taken: s.taken.toISOString(),
    });
  }
}

const withTime = shots.filter((s) => s.hasExifTime).length;
console.log(`\n${DRY ? 'would import' : 'imported'} ${shots.length} photographs`);
console.log(`  capture time from EXIF : ${withTime}/${shots.length}${withTime < shots.length ? ' (rest ordered by file date)' : ''}`);
console.log(`  GPS coordinates        : ${coords.length}/${shots.length}`);
console.log(`  destination            : ${destRel}/\n`);

if (coords.length && !DRY) {
  const sidecar = join(destDir, '_coords.json');
  await writeFile(sidecar, JSON.stringify(coords, null, 2), 'utf8');
  console.log(`  wrote ${destRel}/_coords.json — the first real coordinates in the archive.`);
  const mid = coords[Math.floor(coords.length / 2)];
  console.log(`  suggested entry frontmatter:\n`);
  console.log(`location:\n  name: ""\n  lat: ${mid.lat}\n  lng: ${mid.lng}\n`);
}

console.log('Paste into the entry where these belong:\n');
console.log(blocks.join('\n'));
console.log('');
