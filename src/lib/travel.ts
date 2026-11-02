import { COUNTRY_CONTINENT, COUNTRY_NAMES } from '../data/trip-meta.ts';
import { FLAGS, FLAG_NAMES, NAME_THEN } from '../data/been-to.ts';

/**
 * The travel-log half of the Numbers page: everywhere they've been, written up
 * or not. Pure — it takes the started trips and the log (beenTo()) rather than
 * reading content, so it can be run and checked outside Astro.
 *
 * A "visit" is a country in a month: France in June 2019 and again in August
 * 2019 is two. Months come from the log; a written-up trip the log has no month
 * for (Patagonia, Dec 2014) adds its start month, so the two never disagree
 * about whether they went.
 */

export interface TripLike {
  countries: string[];
  dateStart: Date;
  dateEnd: Date;
}

export interface Place { code: string; name: string; written: boolean }

export interface YearRow {
  /** One year, or a run of empty ones folded together ("1989–2004"). */
  label: string;
  year: number;
  /** Countries seen for the first time that year. */
  fresh: Place[];
  /** Countries visited at all that year. */
  visited: number;
  /** Running total at the end of the year. */
  total: number;
  /** A folded run of years with no travel logged. */
  gap?: boolean;
}

export interface TravelMetrics {
  countries: number;
  writtenUp: number;
  /** Been, no date recorded — counted, but not on the year chart. */
  undated: Place[];
  shareOfWorld: number;
  continents: { name: string; places: Place[] }[];
  visits: number;
  monthsAway: number;
  returnedTo: number;
  years: YearRow[];
  mostVisited: { place: Place; visits: number; years: string }[];
  busiestYear: { year: number; countries: number } | null;
  /** Most new countries in one year, and every year that managed it. */
  bestNewYear: { fresh: number; years: number[] } | null;
  drought: { from: number; to: number; years: number } | null;
  favouriteMonth: { month: string; times: number } | null;
  first: { place: Place; when: string } | null;
  newest: { place: Place; when: string } | null;
  flags: { key: keyof typeof FLAGS; label: string; places: Place[] }[];
}

/** The spreadsheet's own denominator: UN members, the two observer states and Taiwan. */
export const WORLD = 196;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const FLAG_LABELS: Record<keyof typeof FLAGS, string> = {
  scuba: 'countries they’ve dived in',
  muslim: 'Muslim-majority countries',
  communist: 'communist countries, at the time',
};

const monthOf = (d: Date) => d.toISOString().slice(0, 7);
const pretty = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** 2005, 2009, 2012–14 */
function spans(years: number[]): string {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < ys.length; ) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++;
    out.push(j === i ? String(ys[i]) : `${ys[i]}–${String(ys[j]).slice(-2)}`);
    i = j + 1;
  }
  return out.join(', ');
}

export function travelMetrics(trips: TripLike[], been: Record<string, string[]>, now = new Date()): TravelMetrics {
  const written = new Set(trips.flatMap((t) => t.countries));
  const place = (code: string): Place => ({ code, name: COUNTRY_NAMES[code] ?? code, written: written.has(code) });
  /** The name it had in that month — Czechoslovakia in 1988, not Czechia. */
  const placeIn = (code: string, month: string): Place => {
    const then = NAME_THEN[code];
    return then && month < then[0] ? { ...place(code), name: then[1] } : place(code);
  };
  const byName = (a: Place, b: Place) => a.name.localeCompare(b.name);

  // --- every country, with its months ----------------------------------------
  const months = new Map<string, Set<string>>();
  for (const [code, ms] of Object.entries(been)) months.set(code, new Set(ms));
  for (const t of trips) {
    const from = monthOf(t.dateStart);
    const to = monthOf(t.dateEnd);
    for (const code of t.countries) {
      const set = months.get(code) ?? new Set<string>();
      if (![...set].some((m) => m >= from && m <= to)) set.add(from);
      months.set(code, set);
    }
  }
  const codes = [...months.keys()];
  const dated = codes.filter((c) => months.get(c)!.size > 0);
  const firstOf = new Map(dated.map((c) => [c, [...months.get(c)!].sort()[0]]));

  // --- where ------------------------------------------------------------------
  const conts = new Map<string, Place[]>();
  for (const c of codes) {
    const k = COUNTRY_CONTINENT[c] ?? 'Elsewhere';
    conts.set(k, [...(conts.get(k) ?? []), place(c)]);
  }
  const continents = [...conts.entries()]
    .map(([name, places]) => ({ name, places: places.sort(byName) }))
    .sort((a, b) => b.places.length - a.places.length || a.name.localeCompare(b.name));

  // --- visits -----------------------------------------------------------------
  const allMonths = [...months.values()].flatMap((s) => [...s]);
  const visits = allMonths.length;
  const away = new Set(allMonths);

  const mostVisited = dated
    .map((c) => ({ place: place(c), visits: months.get(c)!.size, years: spans([...months.get(c)!].map((m) => Number(m.slice(0, 4)))) }))
    .filter((x) => x.visits > 1)
    .sort((a, b) => b.visits - a.visits || byName(a.place, b.place));

  const perCalendarMonth = new Array(12).fill(0);
  for (const m of away) perCalendarMonth[Number(m.slice(5, 7)) - 1]++;
  const fav = perCalendarMonth.indexOf(Math.max(...perCalendarMonth));

  // --- years ------------------------------------------------------------------
  const visitedIn = new Map<number, Set<string>>();
  for (const [code, set] of months) {
    for (const m of set) {
      const y = Number(m.slice(0, 4));
      visitedIn.set(y, (visitedIn.get(y) ?? new Set()).add(code));
    }
  }
  const freshIn = new Map<number, string[]>();
  for (const [code, m] of firstOf) {
    const y = Number(m.slice(0, 4));
    freshIn.set(y, [...(freshIn.get(y) ?? []), code]);
  }

  const years: YearRow[] = [];
  const y0 = Math.min(...visitedIn.keys());
  const y1 = Math.max(now.getUTCFullYear(), ...visitedIn.keys());
  let total = 0;
  for (let y = y0; y <= y1; y++) {
    if (!visitedIn.has(y)) {
      // Fold a long silence into one row; a single quiet year keeps its own.
      let end = y;
      while (end + 1 <= y1 && !visitedIn.has(end + 1)) end++;
      if (end - y >= 2) {
        years.push({ label: `${y}–${end}`, year: y, fresh: [], visited: 0, total, gap: true });
        y = end;
        continue;
      }
    }
    const fresh = (freshIn.get(y) ?? []).map((c) => placeIn(c, firstOf.get(c)!)).sort(byName);
    total += fresh.length;
    years.push({ label: String(y), year: y, fresh, visited: visitedIn.get(y)?.size ?? 0, total });
  }

  const real = years.filter((r) => !r.gap);
  const busiest = [...real].sort((a, b) => b.visited - a.visited || b.year - a.year)[0];
  const most = Math.max(0, ...real.map((r) => r.fresh.length));

  /*
   * Longest run of years with travel but nothing new — the folded silence before
   * 2005 isn't a drought, they just weren't going anywhere.
   */
  let drought: TravelMetrics['drought'] = null;
  for (let i = 0; i < real.length; ) {
    if (real[i].fresh.length || !real[i].visited) { i++; continue; }
    let j = i;
    while (j + 1 < real.length && !real[j + 1].fresh.length && real[j + 1].year === real[j].year + 1) j++;
    const n = j - i + 1;
    if (!drought || n > drought.years) drought = { from: real[i].year, to: real[j].year, years: n };
    i = j + 1;
  }

  const order = [...firstOf.entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  const firstE = order[0];
  const newestE = order[order.length - 1];

  // --- the spreadsheet's tick boxes ----------------------------------------------
  const flags = (Object.keys(FLAGS) as (keyof typeof FLAGS)[]).map((key) => ({
    key,
    label: FLAG_LABELS[key],
    places: (FLAGS[key] as readonly string[])
      .filter((c) => months.has(c))
      .map((c) => ({ ...place(c), name: FLAG_NAMES[key]?.[c] ?? COUNTRY_NAMES[c] ?? c }))
      .sort(byName),
  }));

  return {
    countries: codes.length,
    writtenUp: written.size,
    undated: codes.filter((c) => !months.get(c)!.size).map(place).sort(byName),
    shareOfWorld: Math.round((codes.length / WORLD) * 100),
    continents,
    visits,
    monthsAway: away.size,
    returnedTo: mostVisited.length,
    years,
    mostVisited,
    busiestYear: busiest ? { year: busiest.year, countries: busiest.visited } : null,
    bestNewYear: most ? { fresh: most, years: real.filter((r) => r.fresh.length === most).map((r) => r.year) } : null,
    drought,
    favouriteMonth: away.size ? { month: MONTHS[fav], times: perCalendarMonth[fav] } : null,
    first: firstE ? { place: placeIn(firstE[0], firstE[1]), when: pretty(firstE[1]) } : null,
    newest: newestE ? { place: placeIn(newestE[0], newestE[1]), when: pretty(newestE[1]) } : null,
    flags,
  };
}
