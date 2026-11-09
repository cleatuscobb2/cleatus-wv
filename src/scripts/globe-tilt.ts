/**
 * Where the spinning globe looks, north to south. As it turns, it leans toward the
 * densest bunch of photographs and entries coming up, so it dips down to Patagonia
 * and rises to the north of Norway instead of circling the same latitude all the way.
 *
 * Worked out once, as a latitude for every 5 degrees of longitude.
 */
export interface Weighted { lat: number; lng: number; w: number }

const STEP = 5; // degrees of longitude per sample
const AHEAD = 40; // how far ahead, in the direction of turn, the globe looks for what's coming
const REACH = 600; // km: points this close together count as one bunch
const MIN_LAT = -48; // far enough south to centre Patagonia without staring at Antarctica
const MAX_LAT = 64; // and far enough north to bring the top of Norway into view
const QUIET = 22; // where it settles over empty ocean

const km = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};
/** -180..180, the way round from a to b. */
const around = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

export function spinLatitude(points: Weighted[]): (lng: number) => number {
  // Bunch the points, so one dense spot outweighs many scattered ones.
  const bunches: { at: [number, number]; w: number }[] = [];
  for (const p of points) {
    const b = bunches.find((x) => km(x.at, [p.lng, p.lat]) < REACH);
    if (b) b.w += p.w; else bunches.push({ at: [p.lng, p.lat], w: p.w });
  }
  // For each longitude, the latitude of the strongest bunch just ahead, nearer ones counting more.
  const raw = Array.from({ length: 360 / STEP }, (_, i) => {
    const lng = -180 + i * STEP;
    let best: { lat: number; score: number } | null = null;
    for (const b of bunches) {
      const d = around(lng, b.at[0]);
      if (d < -10 || d > AHEAD) continue;
      // Places near the equator are in view from any middle latitude, so far north and far
      // south count for more, and sheer numbers for a little less: that is what makes it dip
      // to Patagonia and climb to Norway rather than hovering over Africa.
      const reach = 1 + (b.at[1] / 30) ** 2;
      const score = b.w ** 0.6 * reach * Math.exp(-(((d - AHEAD / 3) / (AHEAD / 2)) ** 2));
      if (!best || score > best.score) best = { lat: b.at[1], score };
    }
    return best ? Math.min(MAX_LAT, Math.max(MIN_LAT, best.lat)) : QUIET;
  });
  // Soften the hand-overs between bunches.
  const smooth = raw.map((_, i) => {
    let s = 0;
    for (let k = -2; k <= 2; k++) s += raw[(i + k + raw.length) % raw.length];
    return s / 5;
  });
  return (lng: number) => {
    const x = (((lng + 180) % 360) + 360) % 360 / STEP;
    const i = Math.floor(x);
    const t = x - i;
    return smooth[i % smooth.length] * (1 - t) + smooth[(i + 1) % smooth.length] * t;
  };
}

/** One second of turn: the next latitude, eased toward the goal no faster than `max` degrees. */
export const leanToward = (lat: number, goal: number, max = 5.5) =>
  lat + Math.max(-max, Math.min(max, (goal - lat) * 0.26));

/**
 * Degrees of longitude for that second. The turn slows while there is a long way to lean,
 * so the globe drifts down to Patagonia or up to Norway instead of sweeping past them.
 */
export const turnStep = (lat: number, goal: number, full = 2) =>
  full * Math.max(0.25, 1 - Math.abs(goal - lat) / 45);
