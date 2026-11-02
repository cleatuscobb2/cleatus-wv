/**
 * The server's own check on an uploaded photograph. The browser has already
 * resized and re-encoded it, which drops EXIF — but the server never trusts
 * that, because EXIF can carry the exact GPS position of where a photo was
 * taken, and these files are public.
 *
 * So: it must be a baseline JPEG of a sane size, and every metadata segment
 * (APP1–APP15: EXIF, XMP, ICC, maker notes…, and comments) is cut out. What is
 * left is the image itself. Pure byte surgery — no native image library.
 */

export const MAX_PHOTO_BYTES = 4_000_000; // under Vercel's 4.5 MB request cap
export const MAX_PHOTO_EDGE = 4000;

export interface CleanJpeg {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export function cleanJpeg(input: Uint8Array): CleanJpeg {
  const b = input;
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new Error('not a JPEG');
  if (b.length > MAX_PHOTO_BYTES) throw new Error('photo is too large');

  const keep: Uint8Array[] = [b.subarray(0, 2)]; // SOI
  let width = 0;
  let height = 0;
  let i = 2;

  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error('damaged JPEG');
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd9) { keep.push(b.subarray(i, i + 2)); break; } // EOI, nothing after
    if (marker >= 0xd0 && marker <= 0xd7) { keep.push(b.subarray(i, i + 2)); i += 2; continue; }

    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) throw new Error('damaged JPEG');
    const seg = b.subarray(i, i + 2 + len);

    // Start of frame: dimensions. (C4 DHT, C8 JPG and CC DAC are not frames.)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      height = (b[i + 5] << 8) | b[i + 6];
      width = (b[i + 7] << 8) | b[i + 8];
    }

    const metadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!metadata) keep.push(seg);
    i += 2 + len;

    if (marker === 0xda) {
      // Start of scan: entropy-coded data runs to the next real marker.
      let j = i;
      while (j < b.length - 1 && !(b[j] === 0xff && b[j + 1] !== 0x00 && !(b[j + 1] >= 0xd0 && b[j + 1] <= 0xd7))) j++;
      keep.push(b.subarray(i, j));
      i = j;
    }
  }

  if (!width || !height) throw new Error('not a complete JPEG');
  if (width > MAX_PHOTO_EDGE || height > MAX_PHOTO_EDGE) throw new Error('photo dimensions are too large');

  const out = new Uint8Array(keep.reduce((n, s) => n + s.length, 0));
  let o = 0;
  for (const s of keep) { out.set(s, o); o += s.length; }
  if (out[out.length - 2] !== 0xff || out[out.length - 1] !== 0xd9) throw new Error('not a complete JPEG');
  return { bytes: out, width, height };
}

/** `IMG_2041 (1).JPG` → `img-2041-1`. Names are public, so keep them plain. */
export function photoStem(name: string): string {
  return name.replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'photo';
}
