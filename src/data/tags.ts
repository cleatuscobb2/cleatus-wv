/**
 * The canonical tag vocabulary (§5). Validated at build time by the entries
 * schema, so an invented tag fails the build rather than quietly creating a
 * near-duplicate theme page.
 *
 * Add deliberately. Every tag here should be able to carry a page of its own
 * across more than one trip.
 */
export const TAGS = [
  'trekking',
  'altitude',
  'glacier',
  'wildlife',
  'food',
  'border-crossing',
  'gear-failure',
  'near-miss',
  'city',
  'rest-day',
  'logistics',
  'people',
  'water',
  'illness',
  'weather',
  'transport',
  'culture',
  'diving',
  'celebration',
  'history',
] as const;

export type Tag = (typeof TAGS)[number];

/** Shown on /tags and as the lede on each tag page. */
export const TAG_LABELS: Record<Tag, string> = {
  trekking: 'Trekking',
  altitude: 'Altitude',
  glacier: 'Glaciers',
  wildlife: 'Wildlife',
  food: 'Food',
  'border-crossing': 'Border crossings',
  'gear-failure': 'Gear failure',
  'near-miss': 'Near misses',
  city: 'Cities',
  'rest-day': 'Rest days',
  logistics: 'Logistics',
  people: 'People',
  water: 'Water',
  illness: 'Illness',
  weather: 'Weather',
  transport: 'Getting there',
  culture: 'Culture',
  diving: 'Diving',
  celebration: 'Celebrations',
  history: 'History',
};

/**
 * One emoji per tag, for the maps' event markers, the trip page's story flow
 * and the tag chips. Deliberately playful — they mark where things happened,
 * the writing does the rest.
 */
export const TAG_ICONS: Record<Tag, string> = {
  trekking: '🥾',
  altitude: '⛰️',
  glacier: '🧊',
  wildlife: '🐾',
  food: '🍜',
  'border-crossing': '🛂',
  'gear-failure': '🔧',
  'near-miss': '⚠️',
  city: '🏙️',
  'rest-day': '🛌',
  logistics: '🧭',
  people: '🤝',
  water: '🌊',
  illness: '🤒',
  weather: '⛈️',
  transport: '🚌',
  culture: '🏛️',
  diving: '🤿',
  celebration: '🎉',
  history: '📜',
};

/** Not a tag, but it gets an icon everywhere a tag does. */
export const BETH_CRIED_ICON = '😢';

/**
 * How it felt, 0–3 each, set per entry beside the tags. Levels rather than
 * tags because "a bit stressful" and "we thought we'd die" are the same theme
 * at very different volumes.
 */
export const METERS = ['stress', 'danger', 'effort', 'awe'] as const;
export type Meter = (typeof METERS)[number];
export const METER_LABELS: Record<Meter, string> = {
  stress: 'Stress',
  danger: 'Danger',
  effort: 'Effort',
  awe: 'Awe',
};
export const METER_ICONS: Record<Meter, string> = {
  stress: '😬',
  danger: '☠️',
  effort: '💪',
  awe: '🤩',
};
/** What each level means, for the editor's hints and the hover text. */
export const METER_LEVELS = ['none', 'some', 'a lot', 'off the charts'] as const;
