# Admin and edit mode — plan

Decisions taken: **local first, public later**; **email magic-link sign-in** when it
goes public (revised 2026-11-01 — was GitHub OAuth); all four capability areas in
scope; **photographs stay in git** for now.

**Who it is for (2026-11-01):** Beth — Elizabeth Tisdale, `eliengler1` on WordPress.com
— will do most of the writing and editing. She works from a laptop, sometimes with the
repo checked out, often browser-only. So the browser admin (Phase B) is not a later
nicety; it is the version that serves the main author. Andy uses the same screens.

Nothing here is built yet. This is the plan to review before any of it lands.

---

## 1. The constraint everything else hangs off

The public site is 360 static pages with zero JavaScript bundles and 469 bytes
inline on an entry page. That is the single hardest-won property of this build and
the admin must not cost it.

So: **`output: 'static'` stays.** Only `/admin/*` and `/api/*` opt out, via
per-route `export const prerender = false`. Every public page keeps prerendering
exactly as it does today. If that ever stops being true, the admin is wrong.

## 2. Prerequisites, in order

| # | Step | Status |
|---|---|---|
| 1 | Push to GitHub | ✅ `cleatuscobb2/cleatus-wv`, public |
| 2 | Deploy to Vercel | ✅ live at cleatusandthewestvirginian.com since 2026-11-01; all 333 legacy links verified |
| 3 | Add `@astrojs/vercel` adapter | Phase B only. Phase A needs nothing. |
| 4 | Provision magic-link sign-in | Phase B only — see §5, "What Andy and Beth set up". |

## 3. Shape: one interface, two backends

The reason "local now, public later" is cheap is that every write goes through one
small seam:

```ts
interface ContentStore {
  read(path: string): Promise<{ text: string; version: string }>;
  write(edits: Edit[], message: string): Promise<void>;   // atomic, all-or-nothing
  list(glob: string): Promise<string[]>;
  putBinary(path: string, bytes: Uint8Array): Promise<void>;
}
```

- **Phase A — `FsStore`**: writes files with `node:fs`, no network, works on a plane.
  `version` is the file mtime+size.
- **Phase B — `GitHubStore`**: writes through the GitHub Git Data API with a
  repo-scoped bot token, setting the commit **author** to whoever is signed in, so
  Beth's edits still read as Beth's in the history. `version` is the blob SHA.

The UI never knows which it is talking to. Swapping backends is one line in a
factory, not a rewrite.

## 4. Phase A — local admin, no login

Runs under `npm run dev`: this laptop's files and git, no sign-in. Since Phase B
the same routes also exist in production, behind sign-in — `src/admin/mode.ts`
decides which admin is running.

The guards, because one is not enough:

1. The routes live in `src/admin/`, not `src/pages/`, and `src/admin/integration.ts`
   injects them as server routes (`prerender: false`). They run in the Vercel
   function; none is ever written out as a static file.
2. Every admin route runs `guard()` (`src/admin/guard.ts`). Hosted: no valid
   session is a 404. Local: only answers under `astro dev`. Either way every
   write needs the `x-cleatus-admin` header plus a same-origin `Origin`, so
   another site open in the same browser can't post to it.
3. `scripts/verify-build.ts` runs inside `npm run build` and fails it if an
   admin or API path exists as a static file, a sitemap lists one, an admin path
   isn't routed to the function, or a static page contains admin markup.

The last guard is the one that matters: it means shipping an unauthenticated
admin to production becomes impossible by accident rather than merely unlikely.

**Since the adapter (Phase B)** the build hands Vercel a ready-made
`.vercel/output`, and Vercel routes by its `config.json` rather than
`vercel.json`. `scripts/vercel-routes.ts` copies the 535 legacy redirects into it,
and `scripts/verify-routes.ts` walks all 333 legacy URLs through the result and
fails the build unless each one ends on a built page. `vercel.json` stays the
place to edit redirects (`npm run redirects` regenerates it).

### Views

**`/admin` — dashboard.** What is done and what is left, read live from the content.
See §7 for the proposed trends panel.

**`/admin/curate` — the one that earns its keep.**
All 295 entries in a dense table, 60 rows to a screen: title, trip, date, byline,
tag chips, `bethCried`. Tags toggle inline by click or keyboard. Filter by trip,
by untagged, by author. Nothing saves until you press Commit, and then it is
**one commit for the whole session**, not one per entry.

This is the difference between clearing the tagging backlog in an afternoon and
never clearing it. A conventional CMS form would make this 295 loads and 295
commits.

**`/admin/trips` — the 13 trips.**
Summary (the auto-derived text pre-filled and clearly marked as needing a rewrite),
hero picker showing every photograph in the trip, real `dateStart`/`dateEnd` to fix
Japan 2022, countries, `startHere`. Clears `TRIPS-TODO.md` directly.

**`/admin/entry/[trip]/[slug]` — prose editing.**
Raw MDX in a plain textarea (monospace, no rich-text), rendered preview beside it,
diff before save.

Deliberately **not** `contenteditable` on the rendered page. Saving edited HTML
means converting it back to MDX on every save, and that direction is lossy — the
one-way conversion in Phase 0 needed a character-level fidelity check across all
295 entries before I trusted it. The prose is the asset; it does not get a lossy
round-trip for the sake of a nicer interaction.

**`/admin/new` — new entry and photographs.**
Frontmatter form plus body. Drag photographs in: they are written to
`assets/photos/<trip>/<slug>/`, EXIF is read for capture order and GPS exactly as
`import:photos` already does, and `<Photo />` blocks are inserted in capture order.

This overlaps with the existing `content/inbox` flow on purpose. The inbox stays —
it is the thing that works from a tea house at 15,000 ft, and no browser UI beats
a text file on a bad connection.

## 5. Phase B — public, email magic-link sign-in

Chosen over GitHub OAuth because the main author should not need a GitHub account
she would never otherwise use. Passwords were never on the table.

**The flow.** Beth goes to `/admin`, types her email, and gets a sign-in link. Clicking
it sets a session cookie, and she stays signed in on that laptop for 30 days.

- `POST /api/auth/request` with an email address. The reply is always the same —
  *"if that address can sign in, a link is on its way"* — so the form never reveals
  which addresses are allowed. Only addresses in `ADMIN_EMAILS` are actually sent mail.
- The link carries a token signed with Web Crypto HMAC: email, a 15-minute expiry,
  and a nonce. **Single-use**: the nonce is recorded when spent, so a forwarded or
  intercepted link is dead once used.
- `GET /api/auth/verify` checks it and sets a signed, `httpOnly`, `Secure`,
  `SameSite=Lax` session cookie (30 days).
- Link requests are **rate-limited per address and per IP**, so nobody can use the
  form to flood Beth's inbox.
- Everything under `/admin` and `/api` (except the auth routes) checks the session
  and 404s — not 401s — when absent. An admin that does not announce itself is a
  smaller target.

**Honest history without GitHub accounts.** Commits are made by a bot token scoped to
this one repository, with the commit *author* set to the signed-in person. The log
still says Beth wrote Beth's edits.

**Mind the address that goes into public history.** The repo is public, so a commit
author's email is readable by anyone. Commits use a display address — e.g.
`beth@cleatusandthewestvirginian.com` — never the address the sign-in link is
mailed to, if that is a personal one.

**One small store.** Spent nonces and rate limits need somewhere to live. A free
Upstash Redis via the Vercel Marketplace covers both, and the comments pending queue
(§7b) later reuses it — one store, not three.

### What Andy and Beth set up

Nothing here can be done from code; each is a few minutes in a dashboard.

| | Where | What |
|---|---|---|
| 1 | **Resend** (resend.com, free tier) | Account and an API key. It sends the sign-in emails. |
| 2 | **WordPress.com DNS** | The records Resend gives for a `send.` subdomain. They live on the subdomain, so **Titan's MX and SPF on the main domain are untouched** — the same records that must never move. |
| 3 | **GitHub** | A fine-grained token for `cleatuscobb2/cleatus-wv` only, permission *Contents: read and write*. |
| 4 | **Vercel Marketplace** | Upstash Redis (free), connected to the project — it adds its own env vars. |
| 5 | **Vercel env vars** | `RESEND_API_KEY`, `GITHUB_TOKEN`, `SESSION_SECRET` (I generate it), `ADMIN_EMAILS` (both your sign-in addresses), `BETH_EMAIL` (Beth's sign-in address, so her saves are credited to her — anyone the admin doesn't recognise is credited to "Site admin"). |

### Rails, because this writes to an irreplaceable archive

- **`raw/` is never writable.** Not by the admin, not by any route. It is the
  evidence layer and `.gitattributes` already marks it `-text`; the store rejects
  any path under it outright.
- **Optimistic locking.** Every write carries the version it read. Mismatch means
  someone (or the other laptop) changed it first: reject and show the diff.
- **Diff before commit**, every time, including bulk.
- **Never force-push, never rewrite history.** Only additive commits.
- **Rate limit** the write endpoints, and log who wrote what.
- Admin routes carry `noindex` and stay out of the sitemap.

## 6. Build order

Revised 2026-11-01 for Beth being the main, often browser-only, author. Phase B
moves up from last to third, so she can do real work in a browser as soon as the
first editing screen exists — rather than after every screen is built locally.

1. ✅ `ContentStore` + `FsStore` + the build guard (the seam and the safety net)
2. ✅ `/admin/curate` (clears the largest backlog) — usable locally straight away
3. ✅ **Phase B**: adapter, magic-link sign-in, `GitHubStore` — puts 2 in a browser.
   Test it locally with `npm run dev:hosted -- <throwaway-branch>`: links print to
   the terminal and saves commit to that branch, never main.
4. ✅ `/admin/trips` (clears `TRIPS-TODO.md` — and shows the same list live, so
   the file is now only a snapshot from the last `gen:trips` run)
5. ✅ `/admin/entry/…` prose editor. Every body is parsed with the build's own MDX
   parser and held to what the 295 entries actually use (`src/admin/mdx.ts`):
   Markdown plus `<Photo>`, `<PullQuote>`, `<Aside>` with plain-text attributes.
   No `{…}` expressions (they run at build time, where the secrets are), no
   imports/exports, no raw HTML, no non-http(s)/mailto links. Import lines are
   managed automatically. The save endpoint re-checks on its own, so a body that
   would break the build — and with it every deploy — can't be committed.
6. `/admin/new` + photo upload

1–2 need nothing from anyone. 3 needs the five set-up steps in §5, which can happen
in parallel with 1–2.

## 7. Proposed: archive health on the dashboard

> **Flagged for confirmation.** A request came in for "health trends on the
> dashboard" — there is no health data in this archive, so this is my reading of
> it as *archive* health. If something else was meant, ignore this section.

The dashboard shows completeness, and tracks it over time so the backlog visibly
shrinks:

| Measure | Today |
|---|---|
| Entries tagged | 0 / 295 |
| Entries with `bethCried` decided | 0 / 295 |
| Trips with a written summary | 0 / 13 |
| Trips with a chosen hero | 0 / 13 |
| Entries with photographs | 643 photos across 295 entries |
| People recorded | 0 |
| Retrospectives written | 0 |
| Entries with coordinates | 0 / 295 |

**Trend** comes free and honestly: each measure is recomputed per commit, so a
sparkline per row can be built from `git log` without storing any state. It shows
real progress rather than a number invented for a dashboard.

This would also be the natural home for the flags already sitting in
`migration-review.md` — the four suspect bylines, the leg-stat assumptions — so
they get resolved rather than living in a file nobody opens.

## 7a. `/admin/readers` — who is actually reading this

Decided: Vercel Web Analytics for collection, and the page lives **behind the
login**, querying live rather than baking numbers in at deploy.

Behind the login because the data is about other people. An unlinked page is
obscurity, not protection — anyone the URL reaches would see where your readers
are and what they read. That is worth a session cookie, not a secret URL.

**Collection is already in place.** `@vercel/analytics` ships on every page in
production (~2.9 KB inline, no bundle). It is cookieless and aggregate-only, so
there is no consent banner and nothing stored on a reader's machine.

**One thing only you can do:** Web Analytics has to be switched on in the Vercel
dashboard — Project → Analytics → Enable. Until then the API returns 404 and
nothing is recorded. Data starts from the moment it is enabled; none of it is
retrospective.

What the page shows, all from `get_web_analytics`:

| Panel | Dimension |
|---|---|
| Visitors and pageviews | count, with the previous period beside it |
| Most read | `requestPath`, ranked — which entries people actually finish |
| Where they are | `country`, against the trips' own countries |
| How they arrived | `referrerHostname` |
| What on | `deviceType`, `browserName`, `osName` |
| Over time | `day` / `week`, so a trip's spike is visible |

**What it will not show, and cannot.** You asked how often people come back.
Cookieless analytics deliberately cannot link one visit to the next — that needs
an identifier on the reader's device and, for European readers, consent. New vs
returning in aggregate is available; per-person histories are not. That is a
consequence of the choice not to track individuals, and worth restating on the
page itself so the absence reads as deliberate rather than broken.

Page clicks beyond navigation need explicit `track()` calls on specific elements
— worth adding only for something specific, like how often "Start here" is used.

## 7b. Comments — public, not just family

Decided: open to public readers as well as family. That is the more demanding of
the two shapes, and it settles most of the design by itself.

### Before building anything: recover the 176 you already have

The old site carries **176 comments across 103 posts** — eight on Day 9
Gondogoro La, nine on "Getting Prepared" from 2009, seven on the last day in
Nepal. The archive captured the *counts only*; not one word of the text.

They are not reachable from the JSON API (item-level returns `commentCount` and
nothing more) and the widget's endpoint is crumbed, so scraping will not get
them. The route that works is **Settings → Advanced → Import/Export → export as
WordPress XML**, which includes comment bodies and authors.

That export dies with the subscription. Restoring fifteen years of family saying
*be careful* is worth more than anything a new system collects in its first year,
and it is a five-minute job that cannot be done later.

### What "public" changes

| | Family-only | Public |
|---|---|---|
| Spam | rare | continuous, from day one |
| Abuse | negligible | has to be assumed |
| Volume | a handful per trip | unbounded |
| Moderation | occasional | a standing job |
| Personal data | people you know | strangers, incl. EU residents |

So three things stop being optional:

**Default-deny.** Nothing appears until approved. This is not primarily about
spam — it is that Andy and Beth vanish for six weeks at a time. Anything that
publishes on submission means abuse sitting on the site, in public, while they
are on a glacier and cannot see it.

**A real bot barrier.** Honeypot field, per-IP rate limit, and Cloudflare
Turnstile — free, privacy-preserving, and invisible to most readers. A public
form on 295 indexed pages gets bot traffic within days.

**A data answer.** Storing a stranger's name and email is a retention
obligation. Store a name, never display an email, and have a deletion path.

### Shape

Reader submits → serverless function validates and rate-limits → comment lands
in a pending queue → approved from `/admin/comments` in the same batch-commit UI
as the tagging view → approved comments are committed to
`src/content/comments/<trip>/<entry>/<id>.md` and the site rebuilds.

Git-backed for the reason that matters here: **their comments have already died
once.** A hosted service is exactly how the first 176 were lost. Committed to the
repo, comments sit beside the writing and survive any platform, exportable
forever.

Recovered comments land in the same collection, marked `archival: true` and
dated, so 2009's replies render alongside next year's.

Volume makes this workable: 176 comments in fifteen years is about one a month,
so a rebuild per approval costs nothing.

### Effort

Roughly a day or two **on top of** Phase B — it reuses the auth, the
`ContentStore`, and the batch-commit moderation UI. Very little of it is new
machinery; comments are mostly another content type flowing through the same
pipe.

## 8. Open questions

1. ~~GitHub accounts?~~ Settled 2026-11-01: email magic link, no GitHub needed.
2. Should the admin be able to **delete** an entry, or only set `draft: true`?
   My recommendation is draft-only: nothing in this archive should be one
   mis-click from gone.
3. ~~Vercel account?~~ Settled: the site is live on it.
4. ~~Sign-in addresses?~~ Settled 2026-11-01. The real addresses live only in the
   Vercel env var `ADMIN_EMAILS`, never in this public repo. Beth's commits show
   `Beth Tisdale <beth@cleatusandthewestvirginian.com>`; Andy's use his existing
   git identity.
