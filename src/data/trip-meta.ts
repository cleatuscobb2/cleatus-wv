/**
 * Per-trip facts that cannot be derived from the archive.
 *
 * Countries and regions are read off the trip titles and the post titles inside
 * each trip (Seoul, Danum Valley, Bangkok, Innsbruck…), not invented. Anything
 * uncertain is marked `confirm` so it surfaces in TRIPS-TODO.md for Andy and
 * Beth rather than being quietly asserted.
 *
 * `summary` is deliberately absent here: summaries are voice, and voice is
 * theirs to write. scripts/gen-trips.ts derives a factual placeholder and flags
 * every one of them for rewriting.
 */
import { COUNTRIES } from './countries.ts';

export interface TripMeta {
  shortTitle: string;
  countries: string[];
  regions: string[];
  /** Notes for the humans: what the generator was unsure about. */
  confirm?: string;
}

export const TRIP_META: Record<string, TripMeta> = {
  k2pakistanseasia2024: {
    shortTitle: 'K2 & SE Asia',
    countries: ['PK', 'TH', 'SG', 'MY', 'KR'],
    regions: ['Karakoram', 'Baltoro', 'Borneo'],
  },
  'japan-2022': {
    shortTitle: 'Japan',
    countries: ['JP'],
    regions: ['Kyoto', 'Tokyo'],
  },
  'africa-and-egypt-2018': {
    shortTitle: 'Africa & Egypt',
    countries: ['CH', 'FR', 'KE', 'TZ', 'RW', 'UG', 'AE', 'EG', 'AT'],
    regions: ['Kilimanjaro', 'Nile'],
  },
  seasiamikerachwedding2017: {
    shortTitle: 'Mike & Rach Wedding',
    countries: ['ID', 'TH'],
    regions: ['Bali'],
  },
  patagoniapt2andcolumbia2017: {
    shortTitle: 'Patagonia II & Colombia',
    countries: ['CL', 'AR', 'CO'],
    regions: ['Patagonia'],
  },
  'nepal-tibet-india-golden-triangle-2015': {
    shortTitle: 'Nepal, Tibet & India',
    countries: ['NP', 'CN', 'IN', 'LK', 'MV', 'DE', 'FR'],
    regions: ['Himalaya', 'Tibetan Plateau', 'Golden Triangle'],
  },
  patagoniaspectacular2015: {
    shortTitle: 'Patagonia',
    countries: ['CL', 'AR'],
    regions: ['Patagonia', 'Torres del Paine'],
  },
  greecelittlerussia2014: {
    shortTitle: 'Greece & Russia',
    countries: ['GR', 'RU'],
    regions: ['Santorini', 'Mount Olympus'],
  },
  'iceland-germany-austria-croatia-bosnia-2013': {
    shortTitle: 'Iceland to Bosnia',
    countries: ['IS', 'DE', 'CH', 'AT', 'IT', 'HR', 'BA'],
    regions: [],
  },
  guatemalabelize2012: {
    shortTitle: 'Guatemala & Belize',
    countries: ['GT', 'BZ'],
    regions: [],
  },
  'china-2011': {
    shortTitle: 'China',
    countries: ['CN', 'HK', 'TH'],
    regions: ['Yangtze'],
  },
  'ecuador-galapagos-bolivia-peru-macchu-picchu-2011': {
    shortTitle: 'Andes & Galápagos',
    countries: ['EC', 'BO', 'PE'],
    regions: ['Galápagos', 'Andes', 'Machu Picchu'],
  },
  'india-sjsu-trip-2009': {
    shortTitle: 'India (where it started)',
    countries: ['IN', 'ID', 'SG'],
    regions: ['Karnataka'],
  },
};

/**
 * ISO 3166-1 alpha-2 → numeric, to join our country codes onto the world-atlas
 * TopoJSON, which is keyed by numeric id. Built from countries.ts, so any
 * country a trip names can be drawn; one too small for the 110m dataset falls
 * back to POINT_MARKERS below, or to being listed under the map.
 */
export const COUNTRY_NUMERIC: Record<string, string> = Object.fromEntries(
  COUNTRIES.filter((c) => c.numeric).map((c) => [c.code, c.numeric as string]),
);

/**
 * Places with no drawable polygon at 110m resolution — Singapore, Andorra,
 * Liechtenstein and the Maldives are below the dataset's threshold, Hong Kong is
 * folded into China. Plotted as point markers so the map is complete rather than
 * quietly missing them. [longitude, latitude].
 */
export const POINT_MARKERS: Record<string, [number, number]> = {
  SG: [103.8198, 1.3521],
  HK: [114.1694, 22.3193],
  AD: [1.5218, 42.5063],
  LI: [9.5554, 47.166],
  MV: [73.5093, 4.1755],
};

/** Continent per country, for the overview page. */
export const COUNTRY_CONTINENT: Record<string, string> = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.continent]));

/** Display names, for every country a trip can name. */
export const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.name]));
