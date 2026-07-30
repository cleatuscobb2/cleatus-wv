# Design plan

Written before any UI code, per §10. Checked against the §6.4 avoid-list at the end.

---

## 1. The organising idea

> **You read on snow. You navigate in the dark.**

Two surfaces, and the split does real work rather than decorating.

**Reading surfaces are pale and quiet.** `--snow` ground, `--paper` for raised cards,
`--ink` text, Source Serif 4 at 19px on a 68–72 character measure. These are 800–3,000
word reads; nothing may compete with them. No accent colour appears in running prose
except on links.

**Navigation and data surfaces are dark.** `--ink` ground, `--rime` for interactive
elements, `--headlamp` reserved for *the one thing you are looking at now* — the current
day on a route line, the current trip on the archive spine. This is the beam. If it is
used for anything decorative it stops meaning anything.

That gives the palette logic in §6.2 a job: the warm/cold pairing is not a colour scheme,
it is the difference between light you are given and light you carry.

## 2. The signature element, made honest

§6.1 asks for one drawn route line in three roles, always carrying data. The archive as it
actually exists breaks the literal version: **one trip of thirteen has elevation data.**
An elevation profile that is flat and meaningless on twelve trips is decoration, which is
exactly what §6.4 forbids.

So the line is defined by what it always has, and gains detail where detail exists:

| | X axis | Y axis | Nodes |
|---|---|---|---|
| **Always** | elapsed days across the trip | flat baseline | one per entry, spaced by real date gaps |
| **With elevation** (2024 Karakoram) | elapsed days | elevation, to scale | day markers at their true altitude |

The date spacing alone is informative — it shows the rest days, the travel gaps, the
stretch in the Karakoram where entries come every single day. On the trek, the same line
rises to 18,500 ft and drops to 15,100. One graphic, degrading truthfully.

Its three roles are unchanged from the brief:

1. **Trip page** — horizontal, full content width, the trip's shape.
2. **Entry page** — the same path rotated vertical, in the left margin, sticky, showing
   where you are. Collapses to a slim top progress bar under 900px.
3. **Archive page** — the spine, 2009 at the top, now at the bottom, each trip a node.

It draws itself once on load, ~1.2s `stroke-dashoffset` ease-out, nodes appearing as the
line reaches them. Rendered complete and immediately under `prefers-reduced-motion`.
It is inline SVG generated at build time from real frontmatter — no client JS, works with
JavaScript off.

## 3. Type scale

| Role | Face | Size / spec |
|---|---|---|
| Trip title | Archivo Expanded 700 | `clamp(2.5rem, 6vw, 4.5rem)`, tight leading, wide tracking |
| Section head | Archivo Expanded 600 | 1.5rem, uppercase, letter-spaced |
| Entry title | Archivo 600 | `clamp(1.9rem, 4vw, 2.75rem)` |
| **Body** | **Source Serif 4** | **19px / 1.65, max 68ch** |
| Data | JetBrains Mono 500 | 0.8125rem, uppercase, `+0.06em` tracking |
| Caption | Source Serif 4 italic | 0.9375rem, `--stone` |

The mono is load-bearing, not texture. Every elevation, distance, coordinate, date and day
number is set in it, because that is what those numbers were when they were written down —
GPS readouts and logbook entries. It is the one thing that makes a 2011 hangover post and
a 2024 summit push feel like the same record.

## 4. Wireframes

### Trip page — "trailhead"

```
┌──────────────────────────────────────────────────────────────┐
│ CLEATUS & THE WEST VIRGINIAN   Trips · Map · Archive · About  │  ← nav, once
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   ░░░░░░░░░  hero, 52vh not 100vh, image bleeds full width   │
│   ░░░░░░░░░  title sits BELOW it, not centred on top of it   │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  K2 PAKISTAN & SE ASIA                     ← Archivo Expanded│
│  29 JUL – 11 SEP 2024                      ← mono, --stone   │
│                                                              │
│  Two sentences of summary, serif, 60ch.                      │
│  → Start here: Day 9 Gondogoro La                            │
├──────────────────────────────────────────────────────────────┤
│ ▓▓▓ DARK PANEL ▓▓▓                                           │
│  25 ENTRIES   85 MI TREK   18,500 FT   4 COUNTRIES  ← mono   │
│                                                              │
│      ╭─╮                    ●18.5k                           │
│   ●──╯ ╰──●───●──╮      ╭──╯     ╲                           │  ← route line
│  D1      D3   D5  ╰──●──╯  D9     ●D11        (draws once)   │
│  ─────────────────────────────────────────────               │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                                           │
├──────────────────────────────────────────────────────────────┤
│  ┌────┬───────────────────────────────────────────────────┐  │
│  │IMG │ DAY 1 · 29 JUL · 13 MI · 10,500 FT      ← mono    │  │
│  │ or │ Turning 50 in the Karakorum        ← Archivo      │  │
│  │ ▁▁ │ "Askole to Jhula. We left at first light and…"    │  │
│  └────┴───────────────────────────────────────────────────┘  │
│  ┌────┬───────────────────────────────────────────────────┐  │
│  │    │ DAY 2 · 30 JUL · 13 MI · 11,500 FT                │  │
│  ...  forward chronological. Day 1 first. Always.            │
├──────────────────────────────────────────────────────────────┤
│  CAST        Azam — guide · Ali — guide · … (people coll.)   │
│  AFTERWARD   link to retrospective if one exists             │
└──────────────────────────────────────────────────────────────┘
```

The thumbnail cell collapses to a thin mono rule when a trip has no photographs, so the
two image-less trips read as deliberate rather than broken.

### Entry page

```
┌──────────────────────────────────────────────────────────────┐
│ CLEATUS & THE WEST VIRGINIAN   Trips · Map · Archive · About  │
├────┬─────────────────────────────────────────────────────────┤
│    │  K2 PAKISTAN & SE ASIA ›                    ← mono, sm  │
│ ●D1│  Day 9 Gondogoro La (GG La)!                            │
│ │  │  BETH · 18 AUG 2024                                     │
│ ●D3│  ┌───────────────────────────────────────────────────┐  │
│ │  │  │ ALI CAMP → KHUISPANG                    ← mono    │  │  leg block:
│ │  │  │ 6 MI · 67 MI TOTAL · ▲18,500 FT · ▼15,100 FT      │  │  structured,
│ ◉D9│  └───────────────────────────────────────────────────┘  │  not italic prose
│ │  │                                                         │
│ │  │  Up at 11 for our 11:30 PM departure. The entire camp   │
│ │  │  was bustling with nervous energy and people probably   │  ← 68ch serif
│ │  │  didn't get much rest…                                  │
│ │  │                                                         │
│ │  │  ┌─────────────────────────────────────────────────┐    │
│ │  │  │  ░░░░░░ photo, interleaved where it belongs ░░░ │    │  ← the single
│ │  │  └─────────────────────────────────────────────────┘    │    biggest
│ │  │  caption, serif italic, --stone                         │    reading win
│ │  │                                                         │
│ │  │  ╭──────────────────────────────────────────╮           │
│ │  │  │ ⓘ GONDOGORO LA  A 5,585 m pass linking   │           │  ← <Aside>
│ │  │  │   the Baltoro and Hushe valleys…         │           │
│ │  │  ╰──────────────────────────────────────────╯           │
│ ●D11  … prose continues …                                    │
│ ▲  │                                                         │
│rail│  ┌──────────────────┬──────────────────┐                │
│stky│  │ ‹ DAY 8          │          DAY 10 › │  ← forward    │
└────┴──┴──────────────────┴──────────────────┴────────────────┘
```

Under 900px the rail becomes a 3px progress bar pinned below the nav; the prose keeps the
full width.

## 5. Motion

One orchestrated moment: the route line draws on load, once, on trip and archive pages.
Everywhere else, 150ms on hover and focus only. `prefers-reduced-motion: reduce` renders
the line complete with no animation. Nothing animates on scroll.

## 6. Checked against §6.4

| Forbidden | Status |
|---|---|
| Cream + high-contrast serif + terracotta | Not present. Ground is `--snow` #EDF1F3, a cold pale grey-blue. No warm neutral anywhere; the only warm value in the system is `--headlamp`, used as a point accent. |
| Numbered markers where content is not sequential | Day numbers appear **only** on the 2024 Karakoram trek, the one genuinely sequential run. Every other trip is marked by date. Trip cards are not numbered. |
| Parallax, scroll-jacking, animated counters, gradient text | None. The only animation is the one-shot line draw. |
| Full-viewport hero + centred text, every page | Hero is 52vh, on trip pages only, and the title sits **below** the image rather than floating over it. Entry pages open on type. |

### Self-critique — what I changed and why

Two things in my first pass were the generic answer, and I rewrote them.

**The stat strip was a row of big numbers.** Four large numerals with small labels under
them is the house style of every SaaS landing page, and §6.4 rules out animated counters
for the same reason. It is now a single line of mono at caption size on the dark panel,
reading like an instrument label rather than an achievement. The numbers are evidence,
not a scoreboard — nobody walks 85 miles to a stat card.

**The entry list was a three-across card grid with a big thumbnail.** That is a blog
archive template, and it fails this material twice: it breaks the sequence a trek depends
on, and it collapses on the two trips with no photographs at all. It is now a single
forward-ordered column of full-width rows with a small fixed-size thumbnail cell — which
degrades to a mono rule when there is no image, keeps Day 1 unambiguously first, and lets
the leg stats sit on the same line as the title where they can actually be compared
down the column.

I also rejected the literal reading of the elevation-profile signature element, for the
reason given in §2 above: it would have been a flat, meaningless graphic on twelve of
thirteen trips.
