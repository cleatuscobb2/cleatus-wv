/**
 * The one seam every admin write goes through (ADMIN-PLAN.md §3).
 *
 * Phase A implements it with the local filesystem and a local git commit
 * (`FsStore`). Phase B swaps in the GitHub API (`GitHubStore`) so the same
 * screens work from a browser with nothing installed. Nothing above this
 * interface knows which one it is talking to.
 */
import { createHash } from 'node:crypto';

export interface Edit {
  /** Repo-relative, forward slashes, e.g. `src/content/entries/japan-2022/onsen.mdx`. */
  path: string;
  /** New text of a content file. Exactly one of `text` / `staged`. */
  text?: string;
  /** A photograph uploaded earlier with `stage()`: the token it returned. */
  staged?: string;
  /**
   * The version the editor read; the write is refused if the file has changed
   * since. `null` creates a file, and is refused if one is already there.
   */
  baseVersion: string | null;
}

export interface Author {
  name: string;
  email: string;
}

export interface WriteResult {
  /** Short hash of the commit that now holds the change. */
  commit: string;
  /** New version of every path written. */
  versions: Record<string, string>;
}

export interface ContentStore {
  readonly kind: 'fs' | 'github';
  read(path: string): Promise<{ text: string; version: string }>;
  /** Every file under `prefix` ending in `ext`, repo-relative. */
  list(prefix: string, ext: string): Promise<string[]>;
  /** All-or-nothing: either every edit lands in one commit, or none do. */
  write(edits: Edit[], message: string, author?: Author): Promise<WriteResult>;
  /**
   * Hold a photograph until a write commits it, without committing anything.
   * Returns a token for `Edit.staged`. Abandoned uploads are simply never used.
   */
  stage(bytes: Uint8Array): Promise<string>;
  /** File names directly inside `dir` — empty if it doesn't exist. */
  listDir(dir: string): Promise<string[]>;
}

/** Tokens from `stage()` are always a 40-hex-digit hash. */
export const STAGE_TOKEN = /^[0-9a-f]{40}$/;

/** Thrown when a file changed between being read and being written. */
export class ConflictError extends Error {
  constructor(public paths: string[]) {
    super(`changed since it was loaded: ${paths.join(', ')}`);
  }
}

/** Content hash, so the same text has the same version on every machine. */
export const versionOf = (text: string) => createHash('sha1').update(text, 'utf8').digest('hex');

/*
 * Where the admin may write. Deliberately narrow: content only. In particular
 * `raw/` — the untouched archive of the original site — is unreachable from
 * here by construction, not by convention.
 */
const WRITABLE = ['src/content/'];

/** Photographs: new JPEGs in an entry's own folder, nothing else. */
export const PHOTO_PATH = /^assets\/photos\/[a-z0-9-]+\/[a-z0-9-]+\/\d{2,3}-[a-z0-9][a-z0-9-]*\.jpg$/;
/** Where each photo in an entry's folder was taken, for the map (as import:photos writes it). */
export const COORDS_PATH = /^assets\/photos\/[a-z0-9-]+\/[a-z0-9-]+\/_coords\.json$/;

export function assertWritable(path: string, kind: 'text' | 'photo' = 'text'): void {
  if (typeof path !== 'string' || !path) throw new Error('empty path');
  if (path.includes('\\') || path.includes('\0')) throw new Error(`bad path: ${path}`);
  if (path.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(path)) throw new Error(`bad path: ${path}`);
  if (path.startsWith('raw/') || path.includes('/raw/')) throw new Error(`raw/ is never writable: ${path}`);
  if (kind === 'photo') {
    if (!PHOTO_PATH.test(path)) throw new Error(`not a photo path: ${path}`);
    return;
  }
  if (!WRITABLE.some((w) => path.startsWith(w)) && !COORDS_PATH.test(path)) throw new Error(`not a content path: ${path}`);
}

/** Checks the shape of an edit and returns what kind of file it writes. */
export function editKind(e: Edit): 'text' | 'photo' {
  const isText = typeof e.text === 'string';
  const isPhoto = typeof e.staged === 'string';
  if (isText === isPhoto) throw new Error(`an edit needs exactly one of text or staged: ${e.path}`);
  if (isPhoto && (!STAGE_TOKEN.test(e.staged!) || e.baseVersion !== null)) throw new Error(`photos can only be added: ${e.path}`);
  const kind = isPhoto ? 'photo' : 'text';
  assertWritable(e.path, kind);
  return kind;
}
