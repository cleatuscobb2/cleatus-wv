# Phase 0 — Migration and rescue: report

Status: **scrape and image archive complete. MDX conversion not started, pending sign-off.**

Run `node --experimental-strip-types scripts/scrape.ts` to reproduce. The run is
idempotent; images already on disk in a lossless-enough format are not re-fetched.

---

## What is archived

| | |
|---|---|
| Trip collections | 14 / 14 |
| Posts | **356** (~227,000 words) |
| Images | **189** (205 MB, JPEG/PNG masters) |
| Standalone pages | 1 (`who-we-are`) |
| Committed | yes — `raw/` and `assets/photos/` are excluded from `.gitignore` on purpose |

```
raw/json/<trip>.json           full API response, every item
raw/<trip>/<slug>.html         post body HTML, verbatim
raw/<trip>/<slug>.meta.json    title, date, author, live URL, image list
raw/pages/who-we-are.{html,json}
raw/photo-manifest.json        CDN URL → local path, with served vs source dimensions
raw/scrape-report.json         per-trip reconciliation
raw/scrape-notes.md            165 recorded anomalies
assets/photos/<trip>/<slug>/NN-<name>.jpg
```

Extraction went through Squarespace's `?format=json-pretty` API rather than HTML
scraping. It returns structured post records **and** an authoritative
`collection.itemCount` per trip, which is what makes "did we silently drop posts?"
an answerable question instead of a hope.

## Per-trip inventory

| Trip | Year | Posts | Images | Date range | Bylines |
|---|---|---|---|---|---|
| k2pakistanseasia2024 | 2024 | 25 | 146 | 2024-07-29 → 2024-09-11 | Beth Tisdale 22, cleatus cobb 3 |
| japan-2022 | 2022 | 5 | 13 | 2022-12-27 → 2024-06-13 | Beth Tisdale 1, Bethie 4 |
| africa-and-egypt-2018 | 2018 | 41 | 30 | 2018-09-16 → 2018-11-04 | Bethie 41 |
| seasiamikerachwedding2017 | 2017 | 9 | 0 | 2017-04-16 → 2017-04-24 | Bethie 9 |
| patagoniapt2andcolumbia2017 | 2017 | 22 | 0 | 2016-12-14 → 2017-01-06 | Bethie 22 |
| himalayanwinteradventure2015 | 2015 | 61 | 0 | 2015-11-27 → 2016-01-31 | Bethie 61 |
| nepal-tibet-india-golden-triangle-2015 | 2015 | 61 | 0 | 2015-11-27 → 2016-01-31 | Bethie 61 |
| patagoniaspectacular2015 | 2015 | 15 | 0 | 2014-12-19 → 2015-01-03 | Bethie 15 |
| greecelittlerussia2014 | 2014 | 14 | 0 | 2014-06-06 → 2014-06-19 | Bethie 14 |
| iceland-germany-austria-croatia-bosnia-2013 | 2013 | 18 | 0 | 2013-08-28 → 2013-09-17 | Bethie 18 |
| guatemalabelize2012 | 2012 | 9 | 0 | 2012-06-30 → 2012-07-07 | Bethie 9 |
| china-2011 | 2011 | 19 | 0 | 2011-03-17 → 2011-04-09 | Bethie 19 |
| ecuador-galapagos-bolivia-peru-macchu-picchu-2011 | 2011 | 32 | 0 | 2011-05-26 → 2011-07-20 | Bethie 32 |
| india-sjsu-trip-2009 | 2009 | 25 | 0 | 2009-06-01 → 2009-07-30 | Bethie 25 |

---

## Findings that contradict the build brief

### 1. Full-resolution originals cannot be recovered from the web

§4.2 says to "strip the `?format=` query param to get the original." That does not
work. Tested against a known 3024×4032 source:

| Request | Bytes | Pixels |
|---|---|---|
| bare URL | 1,207,340 | 2500×3333 |
| `?format=original` | 1,207,340 | 2500×3333 |
| `?format=4000w` | 1,207,340 | 2500×3333 |
| `?format=1500w` | 253,344 | 1500×2000 |

The CDN caps every image at **2500px on the long edge** and will not serve above it.
Across the 189 images, source dimensions declared in the markup total 2,471 MP;
what the CDN actually serves totals 1,092 MP. **44% of the original pixel data is
all that exists publicly.** The worst case is a 10488×7864 panorama served at
2500×1875 — 6% of its pixels.

The masters are on Andy and Beth's own drives, phones, or cloud backup. Nowhere else.

### 2. EXIF is stripped from all 189 images

No capture timestamps, no GPS, no camera data — verified by scanning for the APP1
Exif marker in every file. This removes the data source for §7.4's photo pins and
for §8's "batch photo import: read EXIF for timestamps and GPS."

### 3. Squarespace was silently serving a second lossy transcode

The CDN content-negotiates on `Accept`. A default `*/*` request returns WebP —
35% smaller at identical pixel dimensions, i.e. a re-compression of an already
lossy JPEG. The first scrape pass archived WebP before I caught it. The scraper now
sends `Accept: image/jpeg,image/png,image/*;q=0.8` and all 189 files were re-pulled
as JPEG/PNG masters. Worth knowing for any future re-run.

### 4. Ten of fourteen trips have no photographs at all

Only 2024 (146), 2018 (30), and 2022 (13) carry images. **2009 through 2017 —
eleven years, 224 posts — have zero.** This is not a scraping artifact; those post
bodies contain no image references of any kind.

This directly undercuts §6 and §7.2/§7.3, which assume photography throughout:
trip hero images, card thumbnails, interleaved `<Photo />` / `<PhotoPair />` /
`<PhotoStrip />` in the narrative. For 80% of the archive there is nothing to
interleave.

### 5. Two of the fourteen "trips" are the same trip

`himalayanwinteradventure2015` and `nepal-tibet-india-golden-triangle-2015` are
duplicates: 61 posts each, identical titles, identical date range
(2015-11-27 → 2016-01-31). 53 slugs match exactly; the other 8 are the same posts
with slug variants (`the-bee-that-almost-killed-me-125-day-3` vs
`…-day-3-31`). True unique post count is therefore **295, not 356.**

### 6. The URL structure is not `/{trip}/{post-slug}`

§4.4 assumes most paths survive untouched. In fact **330 of 356 posts** were
imported from a Blogger-era blog and kept legacy paths. The live, resolving URL
contains a double slash:

```
https://cleatusandthewestvirginian.com/india-sjsu-trip-2009//2009/07/the-last-blog.html
```

Only the double-slash form resolves — the clean variants all 404. Just 26 posts
(2024, plus one from 2022) use clean slugs. Every legacy path is recorded in
`raw/<trip>/<slug>.meta.json` as `liveUrl`, so a complete redirect map can be
generated.

### 7. The bylines are not "andy" and "beth"

Three distinct bylines exist, and the split is extremely lopsided:

| Byline | Posts |
|---|---|
| Bethie | 330 |
| Beth Tisdale | 23 |
| cleatus cobb | **3** |

`Bethie` and `Beth Tisdale` are presumably both Beth, the former being the legacy
Blogger byline. Andy has written three posts, all in 2024, all on the Karakoram trek
(Days 8, 9, 11 — including the Gondogoro La entry the design concept is built on).

There are **no days where both wrote**, so §7.3's "on days both wrote, offer a
toggle between the two accounts" has nothing to operate on.

### 8. `Day N` prefixes are rare

Only the 2024 Karakoram trek uses them (11 of 25 posts). Two other posts sitewide
have one. Everything else encodes the date in the title instead — `Puking on Mt
Olympus 6/7`, `Hangover #1 and I'm on a Damn Ship 3/23/11`. Forward-chronological
ordering (§2 problem 5) is still fixable from `publishOn`, but the `day` field will
be null for ~95% of entries, and the trek-rail navigation in §6.1/§7.3 only has a
real trek to attach to on one trip.

### 9. 16 Squarespace template placeholder posts, and a count gap

"Blog Post Title One/Two/Three/Four" demo posts appear in four collections; they are
excluded from the archive. Separately, four collections report an `itemCount` four
higher than the feed returns (k2 29/25, japan 9/5, africa 45/41, nepal 65/61).
The pattern — always exactly four — strongly suggests unpublished placeholder posts
that count toward the total but aren't served publicly. **This is not verifiable
from the public API.** Worth a glance in Squarespace admin before cancelling, to
confirm nothing real is hiding there.

---

## Open questions blocking conversion

1. **The 2015 duplicate** — which collection is canonical, and should the other
   redirect into it?
2. **Photographs for 2009–2017** — do they exist off-site? If they can be supplied
   with EXIF intact, the design holds as written and the maps get real photo pins.
   If not, the design needs to work for text-only trips.
3. **URLs** — my recommendation is clean canonical slugs plus 301 redirects from
   all 330 legacy double-slash paths. Preserves every inbound link and fixes the
   URLs permanently. Confirm before I generate the redirect map.
4. **Bylines** — confirm `Bethie` = `Beth Tisdale` = beth, and that `cleatus cobb`
   = andy.

## Explicitly not done yet

- MDX conversion (§4.3) and `migration-review.md`
- `vercel.json` redirects and sitemap (§4.4)
- Everything from Phase 1 onward
