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

### Start a new entry

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
`water` · `illness`

```
tags: ["trekking", "altitude"]
```

To add a new one, put it in `src/data/tags.ts` first.

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
src/content/people/     guides, cooks, porters — empty until you fill it
src/content/retrospectives/   looking back, years later
assets/photos/          every photograph
raw/                    the untouched backup of the old Squarespace site
```

**Never edit anything in `raw/`.** It is the only complete copy of the old site and
it is deliberately frozen.
