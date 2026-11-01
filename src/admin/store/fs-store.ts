/**
 * Phase A store: the working copy on this laptop, committed with local git.
 *
 * A write either lands completely, as one commit, or not at all. Versions are
 * checked for every file before any file is touched, and if a write fails
 * part-way the files already written are put back.
 *
 * It commits but does not push. Publishing is a separate, explicit action.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  type Author, type ContentStore, type Edit, type WriteResult,
  ConflictError, assertWritable, versionOf,
} from './types.ts';

const run = promisify(execFile);

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

  async write(edits: Edit[], message: string, author?: Author): Promise<WriteResult> {
    if (!edits.length) throw new Error('nothing to write');
    if (!message.trim()) throw new Error('a commit message is required');
    for (const e of edits) assertWritable(e.path);

    // Check every version before touching anything.
    const originals = new Map<string, string>();
    const stale: string[] = [];
    for (const e of edits) {
      const { text, version } = await this.read(e.path);
      if (version !== e.baseVersion) stale.push(e.path);
      originals.set(e.path, text);
    }
    if (stale.length) throw new ConflictError(stale);

    const written: string[] = [];
    try {
      for (const e of edits) {
        await writeFile(this.abs(e.path), e.text, 'utf8');
        written.push(e.path);
      }
      const args = ['commit', '--quiet', '-m', message];
      if (author) args.push(`--author=${author.name} <${author.email}>`);
      // `-- paths` commits exactly these files and nothing else that happens to
      // be staged on this laptop.
      await run('git', [...args, '--', ...edits.map((e) => e.path)], { cwd: this.root });
    } catch (err) {
      for (const p of written) await writeFile(this.abs(p), originals.get(p)!, 'utf8');
      throw err;
    }

    const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: this.root });
    return {
      commit: stdout.trim(),
      versions: Object.fromEntries(edits.map((e) => [e.path, versionOf(e.text)])),
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
