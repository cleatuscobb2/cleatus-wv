# Admin and edit mode — plan

Decisions taken: **local first, public later**; **GitHub OAuth** when it goes public;
all four capability areas in scope; **photographs stay in git** for now.

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

These are facts, not choices — none of the below exists yet.

| # | Step | Why |
|---|---|---|
| 1 | `git remote add origin …` and push (~399 MB) | Nothing is backed up anywhere but this laptop. Do this regardless of the admin. |
| 2 | Deploy to Vercel | Needed before any public admin. Also the first time the redirects and `/cart` removal get exercised for real. |
| 3 | Add `@astrojs/vercel` adapter | Only for Phase B. Phase A needs nothing. |

Step 1 is worth doing this week whatever happens to this plan. A 15-year archive
that exists on one machine inside a OneDrive folder is one disk failure from the
situation Phase 0 was built to prevent.

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
- **Phase B — `GitHubStore`**: writes through the GitHub Contents API as the
  signed-in user. `version` is the blob SHA.

The UI never knows which it is talking to. Swapping backends is one line in a
factory, not a rewrite.

## 4. Phase A — local admin, no login

Runs only under `npm run dev`. **The build must refuse to emit these routes.**

Two guards, because one is not enough:

1. Every admin route begins `if (import.meta.env.PROD) return new Response(null, { status: 404 })`.
2. `scripts/verify-build.ts` fails the build if `dist/admin` or `dist/api` exists.

That second guard is the one that matters: it means shipping an unauthenticated
admin to production becomes impossible by accident rather than merely unlikely.

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

## 5. Phase B — public, GitHub OAuth

- A GitHub OAuth app; `/api/auth/login` → GitHub → `/api/auth/callback`.
- Callback exchanges the code, checks the login against a two-name allowlist in
  `ADMIN_LOGINS`, and sets a signed, `httpOnly`, `SameSite=Lax`, `Secure` session
  cookie. Signed with Web Crypto HMAC — no JWT library needed.
- The user's token is what commits, so **history stays honest**: Beth's edits say
  Beth. That is the whole reason for choosing OAuth over a shared password on an
  archive whose value is partly its provenance.
- Everything under `/admin` and `/api` (except the auth routes) checks the session
  and 404s — not 401s — when absent. An admin that does not announce itself is a
  smaller target.

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

## 6. What I would build first

1. `ContentStore` + `FsStore` + the build guard (the seam and the safety net)
2. `/admin/curate` (clears the largest backlog)
3. `/admin/trips` (clears `TRIPS-TODO.md`)
4. `/admin/entry/…` prose editor
5. `/admin/new` + photo upload
6. Phase B: adapter, OAuth, `GitHubStore`

Stopping after 3 would already be worth it.

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

## 8. Open questions

1. Do you both have GitHub accounts? OAuth needs one each. If Beth would rather
   not, say so and Phase B becomes passkeys instead — same rails, different door.
2. Should the admin be able to **delete** an entry, or only set `draft: true`?
   My recommendation is draft-only: nothing in this archive should be one
   mis-click from gone.
3. Is a Vercel account already set up, or is that a step too?
