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
  text: string;
  /** The version the editor read. If the file has changed since, the write is refused. */
  baseVersion: string;
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
}

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

export function assertWritable(path: string): void {
  if (typeof path !== 'string' || !path) throw new Error('empty path');
  if (path.includes('\\') || path.includes('\0')) throw new Error(`bad path: ${path}`);
  if (path.startsWith('/') || /(^|\/)\.\.(\/|$)/.test(path)) throw new Error(`bad path: ${path}`);
  if (path.startsWith('raw/') || path.includes('/raw/')) throw new Error(`raw/ is never writable: ${path}`);
  if (!WRITABLE.some((w) => path.startsWith(w))) throw new Error(`not a content path: ${path}`);
}
