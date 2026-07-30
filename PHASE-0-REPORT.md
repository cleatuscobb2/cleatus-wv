# Phase 0 — Migration and rescue: report

Status: **scrape and image archive complete. MDX conversion not started, pending sign-off.**

Run `node --experimental-strip-types scripts/scrape.ts` to reproduce. The run is
idempotent; images already on disk in an acceptable format are not re-fetched.

---

## What is archived

| | |
|---|---|
| Trip collections | 14 / 14 |
| Posts | **356** (~227,000 words) |
| Images | **755** (408 MB) |
| Standalone pages | 1 (`who-we-are`) |
| Committed | yes — `raw/` and `assets/photos/` are excluded from `.gitignore` on purpose |

```
raw/json/<trip>.json           full API response, every item
raw/<trip>/<slug>.html         post body HTML, verbatim
raw/<trip>/<slug>.meta.json    title, date, author, live URL, image list
raw/pages/who-we-are.{html,json}
raw/photo-manifest.json        source URL → local path, served vs source dimensions, host, EXIF flag
raw/scrape-report.json         per-trip reconciliation
raw/scrape-notes.md            180 recorded anomalies
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
| japan-2022 | 2022 | 5 | 22 | 2022-12-27 → 2024-06-13 | Beth Tisdale 1, Bethie 4 |
| africa-and-egypt-2018 | 2018 | 41 | 197 | 2018-09-16 → 2018-11-04 | Bethie 41 |
| seasiamikerachwedding2017 | 2017 | 9 | 29 | 2017-04-16 → 2017-04-24 | Bethie 9 |
| patagoniapt2andcolumbia2017 | 2017 | 22 | **0** | 2016-12-14 → 2017-01-06 | Bethie 22 |
| himalayanwinteradventure2015 | 2015 | 61 | 112 | 2015-11-27 → 2016-01-31 | Bethie 61 |
| nepal-tibet-india-golden-triangle-2015 | 2015 | 61 | 112 | 2015-11-27 → 2016-01-31 | Bethie 61 |
| patagoniaspectacular2015 | 2015 | 15 | 8 | 2014-12-19 → 2015-01-03 | Bethie 15 |
| greecelittlerussia2014 | 2014 | 14 | **0** | 2014-06-06 → 2014-06-19 | Bethie 14 |
| iceland-germany-austria-croatia-bosnia-2013 | 2013 | 18 | 46 | 2013-08-28 → 2013-09-17 | Bethie 18 |
| guatemalabelize2012 | 2012 | 9 | 3 | 2012-06-30 → 2012-07-07 | Bethie 9 |
| china-2011 | 2011 | 19 | 36 | 2011-03-17 → 2011-04-09 | Bethie 19 |
| ecuador-galapagos-bolivia-peru-macchu-picchu-2011 | 2011 | 32 | 2 | 2011-05-26 → 2011-07-20 | Bethie 32 |
| india-sjsu-trip-2009 | 2009 | 25 | 42 | 2009-06-01 → 2009-07-30 | Bethie 25 |

Note the two thinnest trips: **Patagonia Pt 2 / Colombia (2017)** and **Greece (2014)**
have no photographs anywhere in the source at all, and Ecuador/Galápagos (2011) has
two. Those are the trips most in need of photos from your own library.

---

## Findings that contradict the build brief

### 1. Full-resolution originals cannot be recovered from Squarespace

§4.2 says to "strip the `?format=` query param to get the original." That does not
work. Tested against a known 3024×4032 source:

| Request | Bytes | Pixels |
|---|---|---|
| bare URL | 1,207,340 | 2500×3333 |
| `?format=original` | 1,207,340 | 2500×3333 |
| `?format=4000w` | 1,207,340 | 2500×3333 |
| `?format=1500w` | 253,344 | 1500×2000 |

The CDN caps every image at **2500px on the long edge** and will not serve above it.
Across the 189 Squarespace-hosted images, source dimensions declared in the markup
total 2,471 MP; what the CDN actually serves totals 1,092 MP — **44% of the original
pixel data.** The worst case is a 10488×7864 panorama served at 2500×1875, 6% of its
pixels. Those masters exist only on your own drives.

### 2. Most of the photography is on Blogger, not Squarespace — and it came back bigger

Everything before 2018 was written on Blogger, and those posts still point at
Google's image host (`blogger.googleusercontent.com`). 566 of the 755 images are
Blogger-hosted. Two things follow:

- Blogger's `/sNNN/` path segment is a resize directive. The posts embed images at
  whatever size the 2009-era editor inserted — **median 320px wide.** Rewriting to
  `/s0/` returns the largest stored copy: **median 1200px, max 5472px**, recovering
  1,184 MP where the embedded thumbnails would have given a small fraction of that.
  The scraper does this rewrite.
- These images are on Google's infrastructure and will survive the Squarespace
  cancellation. That is a reprieve, not a guarantee — they are worth having locally
  either way, and now we do.

### 3. There is no GPS anywhere in the archive

I parsed the EXIF of all 755 files:

| | |
|---|---|
| Parsable EXIF block | 564 (all Blogger-hosted; Squarespace strips it entirely) |
| `DateTimeOriginal` | 200 |
| Camera make/model | 0 |
| **GPS coordinates** | **0** |

Google preserves the Exif marker and some capture timestamps but strips GPS and
camera identity; Squarespace strips everything. So §7.4's photo pins and §8's
"read EXIF for timestamps and GPS" have no data source in the archived copies. The
200 recovered timestamps are still useful for ordering photos within a post.

If your originals carry GPS, that comes back the moment you supply them.

### 4. Squarespace was silently serving a second lossy transcode

The CDN content-negotiates on `Accept`. A default `*/*` request returns WebP — 35%
smaller at identical pixel dimensions, i.e. a re-compression of an already lossy
JPEG. The first scrape pass archived WebP before I caught it. The scraper now sends
`Accept: image/jpeg,image/png,image/*;q=0.8` and everything was re-pulled as
JPEG/PNG masters. Worth knowing for any future re-run.

### 5. Two of the fourteen "trips" are the same trip

`himalayanwinteradventure2015` and `nepal-tibet-india-golden-triangle-2015` are
duplicates: 61 posts each, identical titles, identical date range
(2015-11-27 → 2016-01-31). 53 slugs match exactly; the other 8 are the same posts
with slug variants (`the-bee-that-almost-killed-me-125-day-3` vs `…-day-3-31`).
True unique post count is **295, not 356.**

**Decided:** `nepal-tibet-india-golden-triangle-2015` is canonical;
`himalayanwinteradventure2015` redirects into it.

### 6. The URL structure is not `/{trip}/{post-slug}`

§4.4 assumes most paths survive untouched. In fact **330 of 356 posts** kept
Blogger-era paths, and the live, resolving URL contains a double slash:

```
https://cleatusandthewestvirginian.com/india-sjsu-trip-2009//2009/07/the-last-blog.html
```

Only the double-slash form resolves — the clean variants all 404. Just 26 posts use
clean slugs. Every legacy path is recorded as `liveUrl` in
`raw/<trip>/<slug>.meta.json`.

**Decided:** clean canonical slugs, with 301 redirects from all 330 legacy paths.

### 7. The bylines are not "andy" and "beth"

| Byline | Posts |
|---|---|
| Bethie | 330 |
| Beth Tisdale | 23 |
| cleatus cobb | **3** |

`Bethie` is the legacy Blogger byline for Beth. Andy has written three posts, all in
2024, all on the Karakoram trek — Days 8, 9 and 11, including the Gondogoro La entry
the design concept in §6.1 is built on.

There are **no days where both wrote**, so §7.3's "on days both wrote, offer a toggle
between the two accounts" has nothing to operate on. Proceeding on the assumption
that `Bethie` and `Beth Tisdale` both map to `beth` and `cleatus cobb` to `andy` —
say so if that's wrong.

### 8. `Day N` prefixes are rare

Only the 2024 Karakoram trek uses them (11 of 25 posts). Two other posts sitewide
have one. Everything else encodes the date in the title — `Puking on Mt Olympus 6/7`,
`Hangover #1 and I'm on a Damn Ship 3/23/11`. Forward-chronological ordering
(§2 problem 5) is still fixable from `publishOn`, but the `day` field will be null
for ~95% of entries, and the trek-rail navigation in §6.1/§7.3 has a real trek to
attach to on exactly one trip.

### 9. 16 template placeholder posts, and an unresolved count gap

"Blog Post Title One/Two/Three/Four" Squarespace demo posts appear in four
collections; they are excluded. Separately, four collections report an `itemCount`
exactly four higher than the feed returns (k2 29/25, japan 9/5, africa 45/41,
nepal 65/61). The pattern strongly suggests unpublished placeholder posts that count
toward the total but aren't served publicly. **This is not verifiable from the public
API** — worth a glance in Squarespace admin before cancelling.

---

## Decisions taken

| Question | Answer |
|---|---|
| Original photographs | Andy and Beth will supply full-resolution originals. Build an EXIF-aware local import path; design assumes real photography. |
| 2015 duplicate | `nepal-tibet-india-golden-triangle-2015` canonical, other redirects in. |
| URLs | Clean slugs + 301 redirects from all legacy paths. |
| Bylines | `Bethie` and `Beth Tisdale` both map to `beth`; `cleatus cobb` maps to `andy`. Assumed, not confirmed. |

## Still to do in Phase 0

- MDX conversion (§4.3) and `migration-review.md`
- `vercel.json` redirects, `/cart` removal, sitemap (§4.4)
