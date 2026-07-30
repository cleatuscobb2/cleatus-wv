/**
 * Generate spoken readings of entries and wire them into frontmatter.
 *
 *   npm run audio -- --dry                        what it would do, and the cost
 *   npm run audio -- --provider local --limit 1   one file, using Windows' own voices
 *   npm run audio -- --provider openai            the real thing (needs OPENAI_API_KEY)
 *   npm run audio -- --entry k2pakistanseasia2024/welcome-to-pakistan
 *
 * Two providers, because the choice of voice is not mine to make:
 *
 *   local   Windows SAPI. Free, offline, and writes WAV — enormous next to MP3,
 *           and the voices are robotic. Good for proving the pipeline and
 *           judging the interface; not for 19.7 hours of archive.
 *   openai  tts-1 / tts-1-hd. MP3, about $15-31 for the whole archive.
 *
 * Neither replaces Andy and Beth reading their own entries. When a real
 * recording exists, drop it in and set `voice: beth` — the page marks it as
 * theirs and stops calling it synthetic.
 *
 * Nothing is overwritten: an entry that already has `audio:` is skipped unless
 * --force is passed.
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = join(ROOT, 'src/content/entries');
const OUT_DIR = join(ROOT, 'public/audio');

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');
const PROVIDER = (arg('provider') ?? 'local') as 'local' | 'openai';
const LIMIT = Number(arg('limit') ?? Infinity);
const ONLY = arg('entry');
const MODEL = arg('model') ?? 'tts-1';

/** Strip frontmatter, imports and components down to just the spoken words. */
function speakable(mdx: string): string {
  return mdx
    .replace(/^---[\s\S]*?\n---\n/, '')
    .replace(/^import .*$/gm, '')
    .replace(/<Photo[^>]*\/>/g, '')
    .replace(/<PhotoPair[\s\S]*?\/>/g, '')
    .replace(/<PhotoStrip[\s\S]*?\/>/g, '')
    .replace(/<Aside\b[^>]*>([\s\S]*?)<\/Aside>/g, '$1')
    .replace(/<PullQuote>([\s\S]*?)<\/PullQuote>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\([{}<])/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const fm = (s: string, k: string) =>
  s.match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))?.[1].trim().replace(/^"(.*)"$/, '$1');

/** Duration from a RIFF/WAVE header, without decoding the audio. */
function wavSeconds(buf: Buffer): number | null {
  if (buf.subarray(0, 4).toString('latin1') !== 'RIFF') return null;
  let o = 12;
  let rate = 0, bytesPerSec = 0;
  while (o + 8 <= buf.length) {
    const id = buf.subarray(o, o + 4).toString('latin1');
    const size = buf.readUInt32LE(o + 4);
    if (id === 'fmt ') { rate = buf.readUInt32LE(o + 12); bytesPerSec = buf.readUInt32LE(o + 16); }
    if (id === 'data' && bytesPerSec) return size / bytesPerSec;
    o += 8 + size + (size % 2);
  }
  return rate ? null : null;
}

/** MP3 duration by scanning frame headers — good enough for a player label. */
function mp3Seconds(buf: Buffer): number | null {
  const RATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const SAMPLES = [0, 44100, 48000, 32000];
  let o = 0;
  let seconds = 0;
  let frames = 0;
  if (buf.subarray(0, 3).toString('latin1') === 'ID3') {
    o = 10 + ((buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]);
  }
  while (o + 4 < buf.length && frames < 200000) {
    if (buf[o] !== 0xff || (buf[o + 1] & 0xe0) !== 0xe0) { o++; continue; }
    const bitrate = RATES[(buf[o + 2] >> 4) & 0x0f] * 1000;
    const rate = SAMPLES[(buf[o + 2] >> 2) & 0x03];
    if (!bitrate || !rate) { o++; continue; }
    const pad = (buf[o + 2] >> 1) & 1;
    const len = Math.floor((144 * bitrate) / rate) + pad;
    if (len <= 0) { o++; continue; }
    seconds += 1152 / rate;
    frames++;
    o += len;
  }
  return frames ? seconds : null;
}

async function synthLocal(text: string, out: string, voice: 'andy' | 'beth') {
  // Zira reads Beth's entries, David reads Andy's — the two installed voices
  // happen to map onto the two authors.
  const name = voice === 'andy' ? 'David' : 'Zira';
  const ps = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
try { $s.SelectVoice((($s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Name -like '*${name}*' })[0]).VoiceInfo.Name) } catch {}
$s.Rate = 0
$s.SetOutputToWaveFile(${JSON.stringify(out)})
$s.Speak([IO.File]::ReadAllText(${JSON.stringify(out + '.txt')}))
$s.Dispose()
`;
  await writeFile(`${out}.txt`, text, 'utf8');
  await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { maxBuffer: 1 << 26 });
}

async function synthOpenAI(text: string, out: string, voice: 'andy' | 'beth') {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      voice: voice === 'andy' ? 'onyx' : 'nova',
      input: text.slice(0, 4096), // API limit; longer entries need chunking
      response_format: 'mp3',
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 180)}`);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
}

// ---------------------------------------------------------------- collect ---
interface Job { trip: string; slug: string; path: string; text: string; voice: 'andy' | 'beth'; has: boolean }
const jobs: Job[] = [];

for (const trip of await readdir(ENTRIES)) {
  for (const f of (await readdir(join(ENTRIES, trip))).filter((x) => x.endsWith('.mdx'))) {
    const slug = f.replace(/\.mdx$/, '');
    if (ONLY && `${trip}/${slug}` !== ONLY) continue;
    const path = join(ENTRIES, trip, f);
    const src = await readFile(path, 'utf8');
    const author = src.match(/^authors:\s*\[\s*"(\w+)"/m)?.[1] as 'andy' | 'beth' | undefined;
    jobs.push({
      trip, slug, path,
      text: speakable(src),
      voice: author ?? 'beth',
      has: /^audio:/m.test(src),
    });
  }
}

const todo = jobs.filter((j) => (FORCE || !j.has) && j.text.length > 0).slice(0, LIMIT);
const chars = todo.reduce((n, j) => n + j.text.length, 0);
const words = todo.reduce((n, j) => n + j.text.split(/\s+/).length, 0);

console.log(`entries matched   ${jobs.length}`);
console.log(`already have audio${' '.repeat(0)}  ${jobs.filter((j) => j.has).length}`);
console.log(`to generate       ${todo.length}`);
console.log(`characters        ${chars.toLocaleString()}`);
console.log(`est. narration    ${(words / 150 / 60).toFixed(1)} h at 150 wpm`);
if (PROVIDER === 'openai') {
  const per1M = MODEL === 'tts-1-hd' ? 30 : 15;
  console.log(`est. cost         ~$${((chars / 1e6) * per1M).toFixed(2)}  (${MODEL})`);
}
if (DRY) {
  console.log('\n--dry: nothing written.');
  for (const j of todo.slice(0, 10)) console.log(`  would read  ${j.trip}/${j.slug}  (${j.text.length} chars, ${j.voice})`);
  process.exit(0);
}

// ------------------------------------------------------------------ write ---
await mkdir(OUT_DIR, { recursive: true });
let done = 0;
const failures: string[] = [];

for (const j of todo) {
  const dir = join(OUT_DIR, j.trip);
  await mkdir(dir, { recursive: true });
  const ext = PROVIDER === 'local' ? 'wav' : 'mp3';
  const abs = join(dir, `${j.slug}.${ext}`);
  const rel = `/audio/${j.trip}/${j.slug}.${ext}`;

  try {
    if (PROVIDER === 'local') await synthLocal(j.text, abs, j.voice);
    else await synthOpenAI(j.text, abs, j.voice);

    const buf = await readFile(abs);
    const secs = ext === 'wav' ? wavSeconds(buf) : mp3Seconds(buf);
    const size = (await stat(abs)).size;

    const block = [
      'audio:',
      `  src: "${rel}"`,
      ...(secs ? [`  durationSec: ${Math.round(secs)}`] : []),
      `  bytes: ${size}`,
      `  type: "${ext === 'wav' ? 'audio/wav' : 'audio/mpeg'}"`,
      '  voice: "synthetic"',
    ].join('\n');

    let src = await readFile(j.path, 'utf8');
    src = src.replace(/^audio:\n(?:  .*\n)*/m, '');           // drop any previous block
    src = src.replace(/^(tags:)/m, `${block}\n$1`);            // sit it just above tags
    await writeFile(j.path, src, 'utf8');

    if (existsSync(`${abs}.txt`)) await import('node:fs/promises').then((m) => m.rm(`${abs}.txt`, { force: true }));
    done++;
    console.log(`  ${String(done).padStart(3)}/${todo.length}  ${j.trip}/${j.slug}  ${secs ? Math.round(secs) + 's' : '?'}  ${(size / 1024 / 1024).toFixed(1)} MB`);
  } catch (e) {
    failures.push(`${j.trip}/${j.slug}: ${(e as Error).message}`);
  }
}

console.log(`\nwritten ${done}/${todo.length}`);
if (failures.length) {
  console.log('failed:');
  for (const f of failures) console.log(`  ${f}`);
}
