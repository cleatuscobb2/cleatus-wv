/**
 * Phase A store: the working copy on this laptop, committed with local git.
 *
 * A write either lands completely, as one commit, or not at all. Versions are
 * checked for every file before any file is touched, and if a write fails
 * part-way the files already written are put back (and files it created are
 * removed).
 *
 * It commits but does not push. Publishing is a separate, explicit action.
 */
import { readFile, writeFile, readdir, mkdir, copyFile, unlink, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type Author, type ContentStore, type Edit, type WriteResult,
  ConflictError, STAGE_TOKEN, editKind, versionOf,
} from './types.ts';

const run = promisify(execFile);
/** Uploaded photos wait here until a save commits them. Outside the repo. */
const STAGING = join(tmpdir(), 'cleatus-admin-staging');

const exists = (p: string) => access(p).then(() => true, () => false);

export class FsStore implements ContentStore {
  readonly kind = 'fs' as const;

  constructor(private root: string) {}

  private abs(path: string) {
    return join(this.root, ...path.split('/'));
  }

  async read(path: string) {
    const text = await readFile(this.abs(path), 'utf8');
    return { text, version: versionOf(text) };
  }

  async list(prefix: string, ext: string) {
    const out: string[] = [];
    const walk = async (rel: string) => {
      for (const d of await readdir(this.abs(rel), { withFileTypes: true })) {
        const next = `${rel}/${d.name}`;
        if (d.isDirectory()) await walk(next);
        else if (d.name.endsWith(ext)) out.push(next);
      }
    };
    await walk(prefix.replace(/\/$/, ''));
    return out.sort();
  }

  async listDir(dir: string) {
    return readdir(this.abs(dir.replace(/\/$/, '')), { withFileTypes: true })
      .then((ds) => ds.filter((d) => d.isFile()).map((d) => d.name).sort())
      .catch(() => []);
  }

  async stage(bytes: Uint8Array) {
    const token = createHash('sha1').update(bytes).digest('hex');
    await mkdir(STAGING, { recursive: true });
    await writeFile(join(STAGING, `${token}.jpg`), bytes);
    return token;
  }

  async write(edits: Edit[], message: string, author?: Author): Promise<WriteResult> {
    if (!edits.length) throw new Error('nothing to write');
    if (!message.trim()) throw new Error('a commit message is required');
    const kinds = edits.map(editKind);

    // Check every version — and that every new file is really new — before touching anything.
    const originals = new Map<string, string>();
    const stale: string[] = [];
    for (const [i, e] of edits.entries()) {
      const there = await exists(this.abs(e.path));
      if (e.baseVersion === null) {
        if (there) stale.push(e.path);
        if (kinds[i] === 'photo' && !STAGE_TOKEN.test(e.staged!)) throw new Error(`bad upload token: ${e.path}`);
        continue;
      }
      if (!there) { stale.push(e.path); continue; }
      const { text, version } = await this.read(e.path);
      if (version !== e.baseVersion) stale.push(e.path);
      originals.set(e.path, text);
    }
    if (stale.length) throw new ConflictError(stale);

    const written: string[] = [];
    const paths = edits.map((e) => e.path);
    try {
      for (const [i, e] of edits.entries()) {
        await mkdir(dirname(this.abs(e.path)), { recursive: true });
        if (kinds[i] === 'remove') await unlink(this.abs(e.path));
        else if (kinds[i] === 'photo') await copyFile(join(STAGING, `${e.staged}.jpg`), this.abs(e.path));
        else await writeFile(this.abs(e.path), e.text!, 'utf8');
        written.push(e.path);
      }
      const args = ['commit', '--quiet', '-m', message];
      if (author) args.push(`--author=${author.name} <${author.email}>`);
      // `add` first so new files are tracked (and removals staged); `-- paths` then commits exactly
      // these files and nothing else that happens to be staged on this laptop.
      await run('git', ['add', '--', ...paths], { cwd: this.root });
      await run('git', [...args, '--', ...paths], { cwd: this.root });
    } catch (err) {
      await run('git', ['reset', '--quiet', '--', ...written], { cwd: this.root }).catch(() => {});
      for (const p of written) {
        if (originals.has(p)) await writeFile(this.abs(p), originals.get(p)!, 'utf8');
        else await unlink(this.abs(p)).catch(() => {});
      }
      throw err;
    }

    const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: this.root });
    return {
      commit: stdout.trim(),
      versions: Object.fromEntries(edits.filter((e) => e.text != null).map((e) => [e.path, versionOf(e.text!)])),
    };
  }
}

/** Local git state, for showing what is committed but not yet published. */
export async function gitStatus(root: string) {
  const ahead = await run('git', ['rev-list', '--count', 'origin/main..HEAD'], { cwd: root })
    .then((r) => Number(r.stdout.trim()))
    .catch(() => null);
  const last = await run('git', ['log', '-1', '--format=%h %s'], { cwd: root })
    .then((r) => r.stdout.trim())
    .catch(() => '');
  return { ahead, last };
}

export async function gitPush(root: string) {
  const { stdout, stderr } = await run('git', ['push', 'origin', 'HEAD'], { cwd: root });
  return `${stdout}${stderr}`.trim();
}
