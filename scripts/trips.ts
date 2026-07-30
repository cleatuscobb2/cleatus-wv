/**
 * The 14 trip collections on cleatusandthewestvirginian.com, newest first.
 * `slug` is the Squarespace collection urlId and the live top-level path.
 */
export interface TripSource {
  slug: string;
  title: string;
  year: number;
}

export const TRIPS: TripSource[] = [
  { slug: 'k2pakistanseasia2024', title: 'K2 Pakistan / SE Asia', year: 2024 },
  { slug: 'japan-2022', title: 'Japan', year: 2022 },
  { slug: 'africa-and-egypt-2018', title: 'Africa and Egypt', year: 2018 },
  { slug: 'seasiamikerachwedding2017', title: 'SE Asia Adventure Wedding (Mike & Rach)', year: 2017 },
  { slug: 'patagoniapt2andcolumbia2017', title: 'Patagonia Part 2, with a little Colombia', year: 2017 },
  { slug: 'himalayanwinteradventure2015', title: 'Himalayan Winter Adventure', year: 2015 },
  { slug: 'nepal-tibet-india-golden-triangle-2015', title: 'Nepal, Tibet, India Golden Triangle', year: 2015 },
  { slug: 'patagoniaspectacular2015', title: 'Patagonia Spectacular', year: 2015 },
  { slug: 'greecelittlerussia2014', title: 'Greece and a little Russia', year: 2014 },
  { slug: 'iceland-germany-austria-croatia-bosnia-2013', title: 'Iceland, Germany, Austria, Croatia, Bosnia', year: 2013 },
  { slug: 'guatemalabelize2012', title: 'Guatemala, Belize', year: 2012 },
  { slug: 'china-2011', title: 'China', year: 2011 },
  { slug: 'ecuador-galapagos-bolivia-peru-macchu-picchu-2011', title: 'Ecuador, Galápagos, Bolivia, Peru, Machu Picchu', year: 2011 },
  { slug: 'india-sjsu-trip-2009', title: 'India SJSU Trip', year: 2009 },
];

/** Standalone (non-collection) pages worth archiving. */
export const PAGES = ['who-we-are'];

export const BASE = 'https://cleatusandthewestvirginian.com';

/**
 * Squarespace template demo posts that shipped with the theme and were never
 * deleted. They carry a foreign site id in their assetUrl and a fixed body.
 */
export const PLACEHOLDER_TITLE = /^Blog Post Title (One|Two|Three|Four)$/i;
