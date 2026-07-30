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
    confirm: 'SE Asia legs read from post titles: Bangkok, Singapore, Borneo (Sabah), Seoul.',
  },
  'japan-2022': {
    shortTitle: 'Japan',
    countries: ['JP'],
    regions: ['Kyoto', 'Tokyo'],
  },
  'africa-and-egypt-2018': {
    shortTitle: 'Africa & Egypt',
    countries: ['TZ', 'EG', 'AT'],
    regions: ['Kilimanjaro', 'Nile'],
    confirm:
      'Austria inferred from the Innsbruck posts at the end of the trip. Confirm whether that belongs to this trip or should be split out.',
  },
  seasiamikerachwedding2017: {
    shortTitle: 'Mike & Rach Wedding',
    countries: ['ID'],
    regions: ['Bali'],
    confirm: 'Only Bali is named in the post titles. Were there other stops?',
  },
  patagoniapt2andcolumbia2017: {
    shortTitle: 'Patagonia II & Colombia',
    countries: ['CL', 'AR', 'CO'],
    regions: ['Patagonia'],
  },
  'nepal-tibet-india-golden-triangle-2015': {
    shortTitle: 'Nepal, Tibet & India',
    countries: ['NP', 'CN', 'IN', 'DE'],
    regions: ['Himalaya', 'Tibetan Plateau', 'Golden Triangle'],
    confirm:
      'Germany comes from the Schnapps/Rotwurst posts that close the trip. Confirm it belongs here.',
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
    countries: ['IS', 'DE', 'AT', 'HR', 'BA'],
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
    confirm: 'Hong Kong and Bangkok both appear in post titles at the end of the trip.',
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
    confirm: 'Indonesia (Bintan) and Singapore appear at the end of the trip.',
  },
};

/**
 * ISO 3166-1 alpha-2 → numeric, to join our country codes onto the world-atlas
 * TopoJSON, which is keyed by numeric id. Hong Kong has no separate feature in
 * the 110m dataset (it is inside China), so it is deliberately absent and the
 * map falls back to listing it.
 */
export const COUNTRY_NUMERIC: Record<string, string> = {
  PK: '586', TH: '764', SG: '702', MY: '458', KR: '410', JP: '392',
  TZ: '834', EG: '818', AT: '040', ID: '360', CL: '152', AR: '032',
  CO: '170', NP: '524', CN: '156', IN: '356', DE: '276', GR: '300',
  RU: '643', IS: '352', HR: '191', BA: '070', GT: '320', BZ: '084',
  EC: '218', BO: '068', PE: '604',
};

/**
 * Places with no drawable polygon at 110m resolution — Singapore is below the
 * dataset's threshold, Hong Kong is folded into China. Plotted as point markers
 * so the map is complete rather than quietly missing two countries.
 * [longitude, latitude].
 */
export const POINT_MARKERS: Record<string, [number, number]> = {
  SG: [103.8198, 1.3521],
  HK: [114.1694, 22.3193],
};

export const COUNTRY_NAMES: Record<string, string> = {
  PK: 'Pakistan', TH: 'Thailand', SG: 'Singapore', MY: 'Malaysia', KR: 'South Korea',
  JP: 'Japan', TZ: 'Tanzania', EG: 'Egypt', AT: 'Austria', ID: 'Indonesia',
  CL: 'Chile', AR: 'Argentina', CO: 'Colombia', NP: 'Nepal', CN: 'China',
  IN: 'India', DE: 'Germany', GR: 'Greece', RU: 'Russia', IS: 'Iceland',
  HR: 'Croatia', BA: 'Bosnia and Herzegovina', GT: 'Guatemala', BZ: 'Belize',
  HK: 'Hong Kong', EC: 'Ecuador', BO: 'Bolivia', PE: 'Peru',
};
