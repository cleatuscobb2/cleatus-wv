# Writing on this site

For Beth, mostly, and for Andy. Written assuming you are tired, cold, on a phone,
and the wifi costs 400 rupees an hour.

**The short version: make a text file, put three lines at the top, save it in
`content/inbox`. That's it. Everything else on this page is optional.**

---

## On the trail — the way that always works

You need a text editor and nothing else. No internet, no build, no commands.

Make a file called anything you like, ending in `.md`, and save it into
`content/inbox/`:

```
---
title: The bee that almost killed me
date: 2026-01-05
author: beth
---

Write here. Just type. Blank line between paragraphs.

Swear as much as you like — nothing is spellchecked, corrected, or tidied up.
That is deliberate. The voice is the point.
```

Three lines at the top, between the `---` fences:

| Line | What to put | If you leave it out |
|---|---|---|
| `title:` | Whatever the entry is called | The filename is used |
| `date:` | `YYYY-MM-DD` | Today |
| `author:` | `beth` or `andy` | `beth` |

Next time anyone runs the site, those files turn into real entries automatically,
in the newest trip. **Your original file is moved, never deleted** — it ends up in
`content/inbox/promoted/`.

That is the whole offline flow. You can stop reading here.

### If it's not the newest trip

Add a `trip:` line. The names are the same as the web addresses:

```
trip: japan-2022
```

### If it's a numbered trek day

```
day: 9
```

Only the Karakoram trek uses day numbers. Everything else goes by date.

### If Beth cried

```
bethCried: true
```

It gets counted, listed on [/beth-cried-here](https://cleatusandthewestvirginian.com/beth-cried-here/),
and, once there are coordinates, marked on the map. Entirely straight-faced.

### If it isn't finished

```
draft: true
```

Drafts are kept out of the built site until you set it back to `false`.

---

## At home — with a computer

### Start a new trip

**From any browser:** start writing its first entry (**New entry**), open the
**Trip** list and choose **+ New trip…** at the bottom. Give it a title, a start
date and its countries — the short name, end date and summary can wait. The
trip goes on the site together with that first entry, as one change, and then
appears under **Trips**, where its summary, hero photograph and end date can be
filled in whenever you like.

**On the laptop with the repo**, do this once per trip, before the first entry:

```bash
npm run new:trip -- --title "Torres del Paine 2027" --countries CL,AR
```

It writes `src/content/trips/<slug>.mdx` and makes the entries folder, so you can
add entries straight away. Options: `--short` (the name used in nav and on cards),
`--slug`, `--start`, `--end`, `--regions`.

Countries are two-letter codes — `CL`, `AR`, `NP`. Every country in the world is
already known to the site (`src/data/countries.ts`), so a new one appears on the
map and in Places without anything else to do. A few that are too small for the
map's outlines — Andorra, Liechtenstein, the Maldives, Singapore — are drawn as
dots instead.

### Travel with no entries

The map counts everywhere you've been, not only the trips written up here. That
list — copied from Andy's "Countries I've Been" spreadsheet — lives in
`src/data/been-to.ts`: one line per country, with the months you were there
(`FR: ['2019-06', '2019-08']`). Countries in it with no entries are shaded a
darker teal on the map, and each month shows as a dot under the trips on the
timeline. To add a trip, add its month to the country's line (or a new line). A
month still in the future is left off until the site is next rebuilt after it.

The same file feeds the Numbers page — the year-by-year count, most-visited
countries, and the spreadsheet's tick boxes (`FLAGS`: dived, Muslim-majority,
communist at the time, lived in). Tick a new country by adding its code to the right list.

**Cities and places.** Every place an entry is pinned to (its "Where") is already a
dot on the map, named once you zoom in. For the towns you went through and never
wrote about, use **Map places** in the admin: paste a list, one place per line —
`Prague, Czech Republic 1988`, `Luang Prabang 2007 — the night market` — press
*Find them*, untick any wrong matches, and save. They're kept in
`src/content/places/visited.json` and show as yellow dots. A place in a country
that isn't in `been-to.ts` gets a warning; add the country there too. Add `(dive)` to a line, or tick 🤿, for a dive site: it gets a dive marker, and the
country's catch-all "Dived in …" marker goes away.

**Instagram.** Posts come from Instagram's *Download your information* export (JSON). `npm run ig -- import --from "<folder>" --account <name> --author <Andy or Beth>`, then `npm run ig -- geocode`, then `npm run ig -- review` for the review page. Nothing goes on the site until it's ticked there and published: the catalogue, your ticks and the home locations stay in `../cleatus-wv-instagram`, outside this public repo, and posts near home are refused. A published post gets a 📷 marker on the map and, if it has a trip, a place on that trip's page. To correct a wrong pin or attach a post to one entry, edit its line in `../cleatus-wv-instagram/decisions.json` (`pin`, `place`, `country`, `entry`) and publish again: a post with an `entry` shows on that entry instead of the trip's list.

**US states.** Home isn't counted among the countries, so the map shades the US by state instead. The states not yet visited are listed in `src/data/us-states.ts` (`NOT_YET`); take one off the list once you've been.

Then open the trip file and write the **summary** — two sentences, your words.
That's the only part nothing else can do for you.

### Editing a trip

**From any browser:** <https://cleatusandthewestvirginian.com/admin/trips> lists
the trips and what each still needs. Open one to write its summary, fix its
names and dates, set its countries and "start here" entry, and pick its hero from
every photograph in the trip. **Review & publish** shows exactly what will change;
**Publish** saves it as one change and the live site updates a minute or two later.
Fixing the dates fixes the day count with them.

**By hand:** open `src/content/trips/<slug>.mdx` and change it. Everything is
editable: summary, hero image, dates, countries, `startHere`, `featured`.

**One thing to know.** `npm run gen:trips` recalculates the derived numbers —
day count, entry count, trek miles, highest point — for every trip. On a trip a
person has edited it refreshes *only those numbers* (the day count from the
trip's own dates) and leaves the summary, hero and dates alone. It knows from
either of these lines:

```
summaryNeedsReview: false
handEdited: true
```

The admin writes `handEdited: true` on every save. **If you edit a trip file by
hand, add `handEdited: true` yourself**, or the next run will replace what you
wrote. `summaryNeedsReview: true` just means the summary is still the imported
placeholder.

(`--force` overrides all of that and regenerates everything. There is rarely a
reason to use it.)

### Fixing the words in an entry

From any browser: sign in at `/admin`, open **Tags & bylines**, find the entry
(the **Find** box searches titles and opening lines) and click **edit** next to
its title. The text is on the left, how the page will look on the right, updated
as you type.

The text is checked as you go. If something would break the site — a curly brace,
a stray `<`, a tag the site doesn't know — it's listed under the text with its
line number (click the number to jump there), and saving waits until it's fixed.
**Formatting**, above the text, lists everything you can use. **Review & publish**
shows every word you changed before anything is saved.

### Start a new entry

**From any browser:** sign in at `/admin` and press **Write a new entry** (or
**New entry** in the bar). Choose the trip, check the date, add a trek day if it
is one, write. **Add photos** (or drag them onto the page) puts them in where the
cursor is, in the order they were taken — straight off a phone is fine. They are
shrunk to the site's size, and **where each was taken is kept for the map**: it is
saved to the entry's `_coords.json`, exactly as `import:photos` does, while the
photo file itself is cleaned of all its hidden data.

**Tags** sit above the text: tap the ones that fit (and **Beth cried**, where it
applies). They're the same tags as on the Tags page, and the same row is in the
editor for an entry that already exists.

Tick **Draft — not on the site** to save it without publishing; untick it later
in the same editor to publish. Photos and text land together, as one change.

(Photos from an iPhone in HEIC format open in Safari; in other browsers, export
them as JPEG first.)

**On the laptop with the repo:**

```bash
npm run new:entry -- --title "Day 12 Home"
```

It picks the newest trip and today's date, and prints the file it made. Options:
`--trip`, `--author`, `--date`, `--day`.

### Add photographs

Point it at the folder off your camera or phone:

```bash
npm run import:photos -- --from "D:/DCIM/100MSDCF" --trip k2pakistanseasia2024 --entry day-9-gondogoro-la-gg-la
```

It reads the EXIF, puts them in **the order they were taken**, copies them into
the right place, and prints the lines to paste into your entry:

```
<Photo src="/photos/k2pakistanseasia2024/day-9-gondogoro-la-gg-la/01-IMG_2702.jpg" caption="" />
```

Paste each one **where it belongs in the writing** — between the paragraphs it
illustrates. That is the single biggest improvement over the old site, where every
photo was dumped in a heap at the bottom.

Add `--dry` to see what it would do without touching anything.

> **Your photos still have GPS in them; the ones on the old site do not.** Squarespace
> and Google stripped it from all 755 archived images. When you import from the
> original files, `import:photos` writes the coordinates to a `_coords.json` beside
> them — those are the first real coordinates this site has ever had, and they are
> what will eventually put pins on the map.

### See it

```bash
npm run dev
```

Then open http://localhost:4321. It reloads as you type.

### Publish

```bash
npm run build
```

Then commit and push. Vercel does the rest.

---

## Things you can put in the writing

None of these need importing. Just type them.

**A photograph**

```
<Photo src="/photos/…" caption="Ali Camp, 3am" />
```

**Two side by side**

```
<PhotoPair shots={[{src: "/photos/…a.jpg"}, {src: "/photos/…b.jpg"}]} caption="" />
```

**A run of them**

```
<PhotoStrip shots={[{src: "/photos/…1.jpg"}, {src: "/photos/…2.jpg"}]} caption="" />
```

**An explanation, without breaking the story**

```
<Aside term="Gondogoro La">
A 5,585 m pass linking the Baltoro and Hushe valleys. People die on the descent.
</Aside>
```

**A line worth pulling out** — once or twice per entry at most, or it stops working:

```
<PullQuote>We passed the fuck out.</PullQuote>
```

---

## Trek stats

If an entry is a trek day, this block puts the numbers in a proper panel at the top
instead of a line of italics:

```
leg:
  from: "Ali Camp"
  to: "Khuispang"
  distanceMi: 6
  cumulativeMi: 67
  elevationHighFt: 18500
  elevationLowFt: 15100
```

Leave out anything you don't have. It is fine for a field to be missing — it is not
fine to guess it.

## Tags

Only these words work, and the build fails if you invent one — that is on purpose,
so you never end up with `wildlife` and `animals` as two separate pages:

`trekking` · `altitude` · `glacier` · `wildlife` · `food` · `border-crossing` ·
`gear-failure` · `near-miss` · `city` · `rest-day` · `logistics` · `people` ·
`water` · `illness` · `weather` · `transport` · `culture` · `diving` ·
`celebration` · `history`

Each has an emoji (in `src/data/tags.ts`) — that's the icon on the maps.

```
tags: ["trekking", "altitude"]
```

To add a new one, put it in `src/data/tags.ts` first (with an icon).

### How it felt, and where

Beside the tags, every entry can say how the day felt and where it happened.
Both show on the trip page (the story, its map, the "read these first" picks and
the mood strip) and on the globe at /map/.

- **How it felt** — four dials, 0 to 3: **Stress**, **Danger**, **Effort**,
  **Awe** (0 none · 1 some · 2 a lot · 3 off the charts). Leave one "not rated"
  if it doesn't apply.
- **Where** — a place name, plus a position for the map. Type the place and press
  **Find on map**, then pick the right match. A photo whose camera recorded where
  it was taken fills this in by itself. While a trip is under way, the newest
  entry with a position is "where we are now" on the trip page.

In the file they're one line each:

```
meters: {"stress":2,"danger":3,"effort":2,"awe":3}
location: {"name":"Concordia","lat":35.7436,"lng":76.5133}
```

**The first pass was a machine's.** On 2 November 2026 every entry got a proposed
place, tags and dials, read from its own text, and "Beth cried" was set only where
the entry says so in as many words. Places are pinned to the town, camp or park,
not a GPS track, and the dials are a stranger's reading of your days — change
anything that's wrong in the editor.

**One entry at a time:** the row of tags above the text in the entry editor
(**New entry**, or **edit** next to an entry's title).

**Tagging lots of entries at once — from any browser:**

1. Go to <https://cleatusandthewestvirginian.com/admin>, type your email, press
   **Send me a link**.
2. Open the email ("Your sign-in link"), click **Sign in**, then **Sign in** again
   on the page it opens. The link works once, for 15 minutes. You stay signed in
   on that browser for 30 days.
3. **Tags & bylines** shows every entry as one row, with a checkbox per tag plus
   Beth-cried and the byline. Tick down a column, press **Review & publish**,
   check the list, press **Publish**. The live site updates a minute or two later.

If two of you edit the same entry at once, the second save is refused rather than
overwriting the first — it tells you which entry, and nothing is lost on the site.

**On the laptop with the repo**, the same screen is at
<http://localhost:4321/admin/curate> under `npm run dev`, with no sign-in. There,
saving makes a local commit and **Publish to live site** pushes it — so run
`git pull` first if anyone has edited through the website since.

---

## Readers' comments

Anyone can leave a comment under an entry. **None appears until one of you
publishes it.** When something is waiting you get one email (at most one an hour)
with a link to `/admin/comments`. There: tick the ones to keep, press
**Publish selected** (they show on the site a minute or two later), and
**Delete selected** for the rest — deleted ones aren't kept anywhere. A published
comment can be taken down again with **Take down**.

Only a name and the words are collected — no email addresses — and comments
always show as plain text, so nothing a stranger types can change the page.

---

## When something goes wrong

**"Unknown trip"** — the `trip:` line doesn't match. Run `npm run new:entry` with no
options to see the list.

**The build fails after you added a tag** — it isn't in the vocabulary above.

**A photo doesn't show** — the path must start `/photos/`, not `/assets/photos/`.

**Search finds nothing** — run `npm run build` once; the index is built from the
finished site.

**You want an entry gone** — set `draft: true`. Deleting the file also works, but the
original is always still in `raw/`, which is never touched.

---

## What is where

```
content/inbox/          drop plain .md files here
src/content/entries/    the entries, one folder per trip
src/content/trips/      one file per trip: title, dates, summary, hero
src/data/been-to.ts     every country you've been, by month — for the map
src/content/people/     guides, cooks, porters — empty until you fill it
src/content/retrospectives/   looking back, years later
assets/photos/          every photograph
raw/                    the untouched backup of the old Squarespace site
```

**Never edit anything in `raw/`.** It is the only complete copy of the old site and
it is deliberately frozen.
