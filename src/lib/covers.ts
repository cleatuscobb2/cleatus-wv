/**
 * The small copies scripts/covers.ts makes of the photographs shown on the trips
 * page and the home page. A picture it hasn't copied is served as it is, so a
 * cover changed while the dev server is running still shows.
 */
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Cover { w: number; h: number; sm: string; lg?: string }
interface Manifest { photos: Record<string, Cover>; stage: Record<string, string> }

const FILE = join(process.cwd(), 'public/covers/manifest.json');
let manifest: Manifest = { photos: {}, stage: {} };
let stamp = -1;
/** Read again whenever the file changes, so `npm run covers` shows without a restart. */
function load(): Manifest {
  try {
    const at = statSync(FILE).mtimeMs;
    if (at !== stamp) {
      manifest = JSON.parse(readFileSync(FILE, 'utf8'));
      stamp = at;
    }
  } catch {
    // Not generated yet (`npm run covers`): every picture falls back to its original.
  }
  return manifest;
}

/** The copy to show at card size, or `lg` for a picture shown large. */
export function cover(src: string, size: 'sm' | 'lg' = 'sm'): string {
  const c = load().photos[src];
  return (size === 'lg' ? c?.lg : undefined) ?? c?.sm ?? src;
}

/** Its real dimensions, where known: a 180px picture must not be stretched across a screen. */
export const coverSize = (src: string): { w: number; h: number } | null => {
  const c = load().photos[src];
  return c ? { w: c.w, h: c.h } : null;
};

/** The photograph a trip shows large: its cover unless that is too small to enlarge. */
export const stagePhoto = (tripId: string, hero: string | null): string | null =>
  load().stage[tripId] ?? hero;
