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
};
