/**
 * Browser side of photo upload: get a phone or camera photograph small enough
 * to send, the right way up, and with nothing in it but the picture.
 *
 * Drawing to a canvas and re-encoding throws away every byte of EXIF — the GPS
 * position of where it was taken included. The server strips metadata again on
 * its own (jpeg.ts); this is the first of the two. The position is read first
 * (readExif) and kept separately, in the entry's _coords.json, for the map.
 */
import { MAX_PHOTO_BYTES, photoStem } from './jpeg.ts';

/** The archive's photographs top out here; the source CDNs never gave more. */
const MAX_EDGE = 2500;

export const stemOf = photoStem;

export async function prepare(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    // `from-image` applies the EXIF orientation, so portrait shots stay upright.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(/\.(heic|heif)$/i.test(file.name) || /heic|heif/.test(file.type)
      ? "this browser can't open HEIC photos — try Safari, or export it as a JPEG first"
      : "this file couldn't be opened as a photograph");
  }

  for (const [edge, quality] of [[MAX_EDGE, 0.85], [MAX_EDGE, 0.72], [2000, 0.72], [1600, 0.7]] as const) {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; // PNGs with transparency would otherwise turn black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', quality));
    if (blob && blob.size <= MAX_PHOTO_BYTES - 50_000) {
      bitmap.close();
      return blob;
    }
  }
  bitmap.close();
  throw new Error('this photograph is too large to send, even shrunk');
}

export interface PhotoFacts {
  /** When it was taken (EXIF DateTimeOriginal, else DateTime), ms. */
  taken: number | null;
  /** Where it was taken, if the camera recorded it. */
  lat?: number;
  lng?: number;
}

/**
 * Capture time and GPS position from a photograph's EXIF, read before
 * re-encoding throws the EXIF away. The position goes to the entry's
 * `_coords.json` for the map (as `npm run import:photos` does) — never back
 * into the published photo file.
 */
export async function readExif(file: File): Promise<PhotoFacts> {
  if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) return { taken: null };
  const b = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
  try {
    let i = 2;
    while (i + 4 < b.byteLength && b.getUint8(i) === 0xff) {
      const marker = b.getUint8(i + 1);
      const len = b.getUint16(i + 2);
      if (marker === 0xe1 && b.getUint32(i + 4) === 0x45786966) return fromExif(b, i + 10);
      if (marker === 0xda) break;
      i += 2 + len;
    }
  } catch { /* unreadable EXIF: treat as none */ }
  return { taken: null };
}

function fromExif(b: DataView, t: number): PhotoFacts {
  const le = b.getUint16(t) === 0x4949;
  const u16 = (o: number) => b.getUint16(t + o, le);
  const u32 = (o: number) => b.getUint32(t + o, le);
  const ascii = (o: number, n: number) => {
    let s = '';
    for (let k = 0; k < n - 1; k++) s += String.fromCharCode(b.getUint8(t + o + k));
    return s;
  };
  /** An IFD entry: its count, its value/offset word, and where that word sits. */
  const find = (ifd: number, tag: number) => {
    const n = u16(ifd);
    for (let k = 0; k < n; k++) {
      const e = ifd + 2 + k * 12;
      if (u16(e) === tag) return { count: u32(e + 4), value: u32(e + 8), at: e + 8 };
    }
    return null;
  };
  const ifd0 = u32(4);
  const out: PhotoFacts = { taken: null };

  const exifPtr = find(ifd0, 0x8769);
  const stamp = (exifPtr && find(exifPtr.value, 0x9003)) || find(ifd0, 0x0132);
  if (stamp) {
    // "YYYY:MM:DD HH:MM:SS", read as local time like the laptop importer does.
    const m = ascii(stamp.value, stamp.count).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (m) out.taken = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }

  const gpsPtr = find(ifd0, 0x8825);
  if (gpsPtr) {
    const g = gpsPtr.value;
    // Refs are 2-byte ASCII ("N\0"), stored inside the entry itself.
    const ref = (tag: number) => { const e = find(g, tag); return e ? String.fromCharCode(b.getUint8(t + e.at)) : ''; };
    const dms = (tag: number) => {
      const e = find(g, tag);
      if (!e || e.count !== 3) return null;
      const r = (k: number) => u32(e.value + k * 8) / (u32(e.value + k * 8 + 4) || 1);
      return r(0) + r(1) / 60 + r(2) / 3600;
    };
    const lat = dms(2);
    const lng = dms(4);
    // 0,0 is what some cameras write when they have no fix.
    if (lat != null && lng != null && (lat || lng) && lat <= 90 && lng <= 180) {
      out.lat = ref(1) === 'S' ? -lat : lat;
      out.lng = ref(3) === 'W' ? -lng : lng;
    }
  }
  return out;
}
