/**
 * Everywhere Andy and Beth have been, written up or not — the "Been To" tab of
 * Andy's "Countries I've Been" spreadsheet (rev B), transcribed 2026-11-02.
 *
 * Each country lists the months they were there, 'YYYY-MM' — or just 'YYYY' when
 * the month isn't known (it then sits mid-year on the timeline and counts as a
 * visit, but not as a month away). An empty list means been, but no date recorded. A month still in the future is a trip that's booked:
 * it isn't counted or drawn until a build on or after that month.
 *
 * The trips themselves (src/content/trips) stay the record of what was written;
 * this is only for the map and its timeline, so the count of countries is the
 * whole of it rather than just the 13 trips with entries. To add a trip that has
 * no entries, add its month here. Codes are ISO alpha-2 (src/data/countries.ts).
 */
export const BEEN_TO: Record<string, string[]> = {
  AD: [], // undated
  AE: ['2018-10'],
  AR: ['2016-12'],
  AT: ['2013-09', '2018-11'],
  BA: ['2013-09'],
  BO: ['2011-07'],
  BZ: ['2006-03', '2012-07', '2012-12'],
  CA: ['2022-02', '2022-12', '2023-10', '2026-06'],
  CH: ['2005-07', '2009-06', '2009-12', '2012-04', '2013-03', '2013-09', '2014-08', '2016-01', '2018-11', '2019-06', '2019-08', '2019-10', '2019-12', '2023-04', '2024-02', '2024-06'],
  CL: ['2011-07', '2016-12'],
  CN: ['2011-03', '2015-12', '2016-01'], // sheet rows China + Tibet
  CO: ['2016-12', '2017-01'],
  CR: ['2012-12', '2025-12'],
  CZ: ['1988-08'], // sheet rows Czech Republic (undated) + Czechoslovakia (Aug 1988)
  DE: ['2005-07', '2009-06', '2009-12', '2012-04', '2013-03', '2013-09', '2014-08', '2016-01', '2016-09', '2016-10', '2017-02', '2018-11', '2019-06', '2019-08', '2019-10', '2019-12', '2022-07', '2022-10', '2023-04', '2024-02', '2024-06', '2025-06'],
  DK: [], // undated
  EC: ['2011-07'],
  EG: ['2018-10'],
  ES: ['2009-12', '2019-10'],
  FJ: ['2006-08'],
  FR: ['2005-07', '2009-06', '2009-12', '2012-04', '2013-03', '2013-09', '2014-08', '2016-01', '2016-09', '2016-10', '2017-02', '2018-11', '2019-06', '2019-08', '2019-10', '2019-12', '2022-07', '2022-10', '2023-04', '2024-02', '2024-06', '2025-06'],
  GB: [], // sheet row England (undated)
  GR: ['2014-06'],
  GT: ['2012-07', '2012-12'],
  HK: ['2026-12'],
  HN: ['2012-12'],
  HR: ['2013-09'],
  ID: ['2007-12', '2017-04'],
  IN: ['2009-07', '2016-01'],
  IS: ['2013-08', '2017-09'],
  IT: ['2013-09', '2022-07', '2022-08'],
  JP: ['2007-12', '2022-12', '2023-01', '2024-12', '2025-02', '2026-02'],
  KE: ['2018-09'],
  KH: ['2007-12'],
  KR: ['2024-09'],
  LA: ['2007-12'],
  LI: ['2009-12', '2013-09'],
  LK: ['2016-01'],
  MA: ['2009-12'],
  MV: ['2016-01'],
  MX: ['2008-07', '2016-07', '2018-06', '2021-12', '2025-08', '2025-12', '2026-01', '2026-08'],
  MY: ['2024-08', '2024-09'],
  NI: ['2012-12'],
  NL: ['2009-12'],
  NO: ['2019-10'],
  NP: ['2009-07', '2015-12', '2016-01'],
  NZ: ['2026-06'],
  PE: ['2011-07'],
  PH: ['2018'], // added 2026-11-02, month not known
  PK: ['2024-08'],
  PT: ['2025-06'],
  RU: ['2014-06'],
  RW: ['2018-10'],
  SE: ['2017-09'],
  SG: ['2007-12', '2024-08'],
  SI: ['2013-09'],
  TH: ['2007-12', '2011-03', '2017-04', '2024-08'],
  TR: ['2019-12', '2020-01'],
  TW: ['2026-12'],
  TZ: ['2018-09'],
  UG: ['2018-10'],
  VN: ['2026-12'],
};

/**
 * The spreadsheet's tick-box columns, for the Numbers page. Only countries that
 * have been visited count, so a booked trip's ticks wait like its months do.
 */
export const FLAGS = {
  /** Scuba: dived there. */
  scuba: ['BZ', 'FJ', 'ID', 'MX', 'TH', 'EC', 'HN', 'IS', 'MV', 'CO', 'TZ'],
  /** Muslim-majority countries. */
  muslim: ['ID', 'MA', 'MV', 'EG', 'AE', 'TR', 'PK', 'MY'],
  /** Communist when they were there — hence Czechoslovakia, 1988. */
  communist: ['LA', 'CN', 'RU', 'CZ', 'VN'],
} as const satisfies Record<string, readonly string[]>;

/** How a country reads in a FLAGS list when its modern name would mislead. */
export const FLAG_NAMES: Partial<Record<keyof typeof FLAGS, Record<string, string>>> = {
  communist: { CZ: 'Czechoslovakia (1988)', CN: 'China & Tibet' },
};

/** Countries that were called something else when they went: [renamed in, old name]. */
export const NAME_THEN: Record<string, [string, string]> = {
  CZ: ['1993-01', 'Czechoslovakia'],
};

const MONTH = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
for (const [code, months] of Object.entries(BEEN_TO)) {
  for (const m of months) if (!MONTH.test(m)) throw new Error(`been-to.ts: ${code} has a bad month "${m}" (want YYYY-MM, or YYYY)`);
}

/** The current month as 'YYYY-MM', so a booked trip waits until it has happened. */
export const thisMonth = (now = new Date()) => now.toISOString().slice(0, 7);

/** Visits that have happened, by country. A country with only future months is left out. */
export function beenTo(now = new Date()): Record<string, string[]> {
  const cut = thisMonth(now);
  return Object.fromEntries(
    Object.entries(BEEN_TO)
      .map(([code, months]) => [code, months.filter((m) => m <= cut)] as const)
      .filter(([code, months]) => months.length > 0 || BEEN_TO[code].length === 0),
  );
}

/** 2005, 2009, 2012–14 — years, with runs collapsed. */
export function yearSpans(months: string[]): string {
  const ys = [...new Set(months.map((m) => Number(m.slice(0, 4))))].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < ys.length; ) {
    let j = i;
    while (j + 1 < ys.length && ys[j + 1] === ys[j] + 1) j++;
    out.push(j === i ? String(ys[i]) : `${ys[i]}–${String(ys[j]).slice(-2)}`);
    i = j + 1;
  }
  return out.join(', ');
}
