/**
 * Parse the italic stat line that opens each trek entry into structured data.
 *
 * Every observed form, all from the 2024 Karakoram trek:
 *   Askole to Jhula, 13 miles, 10.5k elevation
 *   Jhula to Paiju, 13 miles (total 23 miles), 11.5k elevation.
 *   Goro II to Concordia, 9 miles (total 53 miles), 15.4 elevation
 *   Rest day (total 53 miles), 15.4 elevation
 *   Ali Camp to Khuispang, 6 miles (total 67 miles), 18.5k elevation @ GG La down to 15.1k
 *
 * Anything that does not parse cleanly is returned with `null` fields and a
 * reason. The caller logs it for human review. Nothing is guessed.
 */

export interface Leg {
  from: string | null;
  to: string | null;
  distanceMi: number | null;
  cumulativeMi: number | null;
  elevationHighFt: number | null;
  elevationLowFt: number | null;
}

export interface LegParse {
  leg: Leg;
  /** Fields the parser had to interpret rather than read literally. */
  assumptions: string[];
  /** Why a field was left null. */
  problems: string[];
  matched: boolean;
}

/**
 * `18.5k` → 18500. A bare `15.4` is written without the k on two lines; at
 * Karakoram altitudes it can only mean thousands of feet, but the reading is an
 * interpretation, so callers are told about it.
 */
function elevationFt(raw: string): { ft: number | null; assumed: boolean } {
  const m = raw.match(/^(\d+(?:\.\d+)?)\s*(k)?$/i);
  if (!m) return { ft: null, assumed: false };
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return { ft: null, assumed: false };
  if (m[2]) return { ft: Math.round(n * 1000), assumed: false };
  // No `k`. Values under 100 are thousands-of-feet shorthand; anything else is
  // already a plain foot count.
  if (n < 100) return { ft: Math.round(n * 1000), assumed: true };
  return { ft: Math.round(n), assumed: false };
}

export function parseLeg(line: string): LegParse {
  const assumptions: string[] = [];
  const problems: string[] = [];
  const leg: Leg = {
    from: null, to: null,
    distanceMi: null, cumulativeMi: null,
    elevationHighFt: null, elevationLowFt: null,
  };

  const s = line.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  if (!s) return { leg, assumptions, problems: ['empty line'], matched: false };

  // A stat line always states a distance, a cumulative total, or a rest day.
  const looksLikeStats = /\bmiles?\b|\belevation\b|\brest day\b/i.test(s);
  if (!looksLikeStats) {
    return { leg, assumptions, problems: ['not a stat line'], matched: false };
  }

  // from → to, up to the first comma or an opening paren.
  const route = s.match(/^([^,(]+?)\s+to\s+([^,(]+?)\s*(?=,|\(|$)/i);
  if (route) {
    leg.from = route[1].trim();
    leg.to = route[2].trim();
  } else if (/^rest day/i.test(s)) {
    assumptions.push('rest day — no from/to; both left null');
  } else {
    problems.push(`could not read a "X to Y" route from ${JSON.stringify(s)}`);
  }

  // Cumulative first, so the plain-distance match cannot swallow it.
  const cum = s.match(/\(\s*total\s+(\d+(?:\.\d+)?)\s*miles?\s*\)/i);
  if (cum) leg.cumulativeMi = Number(cum[1]);

  const dist = s.replace(/\([^)]*\)/g, '').match(/(\d+(?:\.\d+)?)\s*miles?/i);
  if (dist) leg.distanceMi = Number(dist[1]);
  else if (!/rest day/i.test(s)) problems.push('no leg distance found');

  // "18.5k elevation @ GG La down to 15.1k" — a high point and a finishing low.
  const high = s.match(/(\d+(?:\.\d+)?\s*k?)\s*elevation/i);
  if (high) {
    const { ft, assumed } = elevationFt(high[1].replace(/\s+/g, ''));
    leg.elevationHighFt = ft;
    if (assumed) assumptions.push(`"${high[1].trim()}" read as ${ft} ft (no "k" written)`);
    if (ft === null) problems.push(`unreadable elevation ${JSON.stringify(high[1])}`);
  } else {
    problems.push('no elevation found');
  }

  const low = s.match(/down to\s*(\d+(?:\.\d+)?\s*k?)/i);
  if (low) {
    const { ft, assumed } = elevationFt(low[1].replace(/\s+/g, ''));
    leg.elevationLowFt = ft;
    if (assumed) assumptions.push(`"down to ${low[1].trim()}" read as ${ft} ft (no "k" written)`);
  }

  return { leg, assumptions, problems, matched: true };
}
