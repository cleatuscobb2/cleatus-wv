/**
 * A new trip's file — shared by `npm run new:trip` and /admin/new, where a
 * trip is started together with its first entry and lands in the same commit
 * (so the site never has a trip with nothing in it).
 */
import { COUNTRY_NAMES } from '../data/trip-meta.ts';
import { daysBetween } from './trip-edit.ts';

export interface NewTrip {
  id: string;
  title: string;
  shortTitle: string;
  dateStart: string;
  dateEnd: string;
  countries: string[];
  regions: string[];
  summary: string;
}

export const TRIP_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const tripSlugOf = (s: string) =>
  s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');

/** Check a new trip from the browser. `taken` is every trip id that already exists. */
export function validateNewTrip(raw: unknown, taken: string[]): NewTrip {
  const v = (raw ?? {}) as Record<string, unknown>;
  const text = (s: unknown, max: number, what: string, required = true) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    if (required && !t) throw new Error(`the new trip needs ${what}`);
    if (t.length > max) throw new Error(`the new trip’s ${what} is longer than ${max} characters`);
    return t;
  };

  const title = text(v.title, 120, 'a title');
  const shortTitle = text(v.shortTitle, 40, 'a short name', false) || title;
  if (shortTitle.length > 40) throw new Error('the new trip needs a short name (40 characters at most)');

  const id = String(v.id ?? '');
  if (!TRIP_SLUG.test(id) || id.length > 60) throw new Error('the new trip’s web address can only use a–z, 0–9 and hyphens');
  if (taken.includes(id)) throw new Error(`there is already a trip at /${id}/`);

  const dateStart = String(v.dateStart ?? '');
  const dateEnd = String(v.dateEnd || dateStart);
  if (!ISO_DATE.test(dateStart) || Number.isNaN(Date.parse(dateStart))) throw new Error('the new trip’s start date is not a date');
  if (!ISO_DATE.test(dateEnd) || Number.isNaN(Date.parse(dateEnd))) throw new Error('the new trip’s end date is not a date');
  if (dateEnd < dateStart) throw new Error('the new trip ends before it starts');

  if (!Array.isArray(v.countries) || !v.countries.length) throw new Error('the new trip needs at least one country');
  const countries = [...new Set(v.countries.map(String))];
  const unknown = countries.filter((c) => !(c in COUNTRY_NAMES));
  if (unknown.length) throw new Error(`not a country code: ${unknown.join(', ')}`);

  return { id, title, shortTitle, dateStart, dateEnd, countries, regions: [], summary: text(v.summary, 600, 'summary', false) };
}

const q = (s: string) => JSON.stringify(s);

/**
 * The trip file. `handEdited: true` so gen-trips only ever refreshes its
 * derived numbers; with no summary yet it is flagged for one, which puts it on
 * the /admin/trips to-do list.
 */
export function newTripFile(t: NewTrip, entries = 0): string {
  return `---
title: ${q(t.title)}
shortTitle: ${q(t.shortTitle)}
year: ${Number(t.dateStart.slice(0, 4))}
dateStart: ${t.dateStart}
dateEnd: ${t.dateEnd}
countries: [${t.countries.map(q).join(', ')}]
regions: [${t.regions.map(q).join(', ')}]
summary: ${q(t.summary)}
summaryNeedsReview: ${!t.summary}
hero: null
stats:
  days: ${daysBetween(t.dateStart, t.dateEnd)}
  entries: ${entries}
  countriesCount: ${t.countries.length}
featured: false
handEdited: true
---
`;
}
