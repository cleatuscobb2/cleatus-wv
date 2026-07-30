/**
 * §7.8 — a share card per entry, per trip, and for the site root.
 *
 *   node --experimental-strip-types scripts/og-images.ts
 *
 * Composed as SVG in the site's own type and colours, rasterised with sharp
 * (already a dependency via astro:assets). No headless browser, no external
 * service, no network. Cards are written straight into public/og/ and skipped if
 * they already exist and are newer than this script.
 */
import { mkdir, writeFile, readdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/og');
const FONTS = join(ROOT, 'public/fonts');
const W = 1200;
const H = 630;

const INK = '#12161C';
const SNOW = '#EDF1F3';
const STONE = '#7B8592';
const HEADLAMP = '#FFC24B';
const RIME = '#7FD8E8';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Break a title onto lines that fit, measuring roughly by character width. */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur = next;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[,.;:]?$/, '')}…`;
  }
  return lines;
}

/*
 * sharp rasterises SVG through librsvg, which resolves fonts via fontconfig and
 * ignores @font-face with an embedded woff2 — worse, a multi-hundred-kilobyte
 * base64 src makes it drop the whole <style> block, so even the fallback stack
 * was lost and titles came out in a default serif.
 *
 * So: no embedding, and font families set as presentation attributes rather than
 * CSS. These stacks name the real faces first (picked up if installed) and then
 * fall through to whatever generic the machine has, staying in the right
 * category either way.
 */
const DISPLAY_STACK = "Archivo, 'Archivo Expanded', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO_STACK = "'JetBrains Mono', 'DejaVu Sans Mono', 'Courier New', monospace";

interface Card { kicker: string; title: string; meta: string }

function svg({ kicker, title, meta }: Card): string {
  const lines = wrap(title, 26, 3);
  const size = lines.length >= 3 ? 62 : lines.length === 2 ? 72 : 84;
  const startY = 300 - ((lines.length - 1) * size * 1.1) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${INK}"/>
<rect x="0" y="0" width="10" height="${H}" fill="${HEADLAMP}"/>
<text x="76" y="118" font-family="${MONO_STACK}" font-size="22" letter-spacing="2.4" fill="${RIME}">${esc(kicker.toUpperCase())}</text>
${lines.map((l, i) =>
  `<text x="76" y="${startY + i * size * 1.1}" font-family="${DISPLAY_STACK}" font-size="${size}" font-weight="700" fill="${SNOW}">${esc(l)}</text>`,
).join('\n')}
<text x="76" y="${H - 96}" font-family="${MONO_STACK}" font-size="24" letter-spacing="2" fill="${STONE}">${esc(meta)}</text>
<line x1="76" y1="${H - 66}" x2="${W - 76}" y2="${H - 66}" stroke="#2A323C" stroke-width="1"/>
<text x="76" y="${H - 32}" font-family="${MONO_STACK}" font-size="20" letter-spacing="2" fill="${STONE}">CLEATUSANDTHEWESTVIRGINIAN.COM</text>
</svg>`;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fmt = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

const fm = (src: string, key: string) =>
  src.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^"(.*)"$/, '$1') ?? null;

await mkdir(OUT, { recursive: true });
const selfMtime = (await stat(fileURLToPath(import.meta.url))).mtimeMs;

let made = 0;
let skipped = 0;

async function render(name: string, card: Card) {
  const file = join(OUT, `${name}.png`);
  if (existsSync(file) && (await stat(file)).mtimeMs > selfMtime) { skipped++; return; }
  await sharp(Buffer.from(svg(card))).png({ compressionLevel: 9 }).toFile(file);
  made++;
}

// --- trips ---------------------------------------------------------------
const tripsDir = join(ROOT, 'src/content/trips');
const tripMeta = new Map<string, { title: string; short: string }>();
for (const f of (await readdir(tripsDir)).filter((x) => x.endsWith('.mdx'))) {
  const slug = f.replace(/\.mdx$/, '');
  const src = await readFile(join(tripsDir, f), 'utf8');
  const title = fm(src, 'title') ?? slug;
  const short = fm(src, 'shortTitle') ?? title;
  const start = fm(src, 'dateStart') ?? '';
  const entries = src.match(/^\s+entries:\s*(\d+)/m)?.[1] ?? '';
  tripMeta.set(slug, { title, short });
  await render(`trip-${slug}`, {
    kicker: 'Trip',
    title,
    meta: [start ? fmt(start) : null, entries ? `${entries} entries` : null].filter(Boolean).join('  ·  '),
  });
}

// --- entries -------------------------------------------------------------
const entriesDir = join(ROOT, 'src/content/entries');
for (const trip of await readdir(entriesDir)) {
  const files = (await readdir(join(entriesDir, trip))).filter((f) => f.endsWith('.mdx'));
  for (const f of files) {
    const slug = f.replace(/\.mdx$/, '');
    const src = await readFile(join(entriesDir, trip, f), 'utf8');
    const date = fm(src, 'date');
    const day = fm(src, 'day');
    const author = src.match(/^authors:\s*\[\s*"(\w+)"/m)?.[1];
    await render(`entry-${trip}--${slug}`, {
      kicker: tripMeta.get(trip)?.short ?? trip,
      title: fm(src, 'title') ?? slug,
      meta: [
        day && day !== 'null' ? `Day ${day}` : null,
        date ? fmt(date) : null,
        author ? author[0].toUpperCase() + author.slice(1) : null,
      ].filter(Boolean).join('  ·  '),
    });
  }
}

// --- site ----------------------------------------------------------------
await render('site', {
  kicker: 'Cleatus and the West Virginian',
  title: 'Long, hard trips since 2009',
  meta: 'Andy & Beth  ·  13 trips  ·  295 entries',
});

console.log(`OG cards: ${made} written, ${skipped} already current  → public/og/`);
