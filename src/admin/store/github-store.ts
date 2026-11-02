/**
 * Phase B store: the repository on GitHub, through its API, so the admin works
 * from any browser with nothing installed.
 *
 * Reads are one GraphQL request per collection — all 295 entries come back
 * together — pinned to a single commit, so every version on a page agrees.
 *
 * A write is one commit made with the Git Data API (tree, commit, then a
 * fast-forward of the branch), so a batch lands whole or not at all. Versions
 * are checked against the branch tip first and the write is refused if any file
 * changed since it was read. If the branch moves between that check and the
 * fast-forward, the write starts again from the new tip rather than overwrite.
 * Never a force-push.
 */
import {
  type Author, type ContentStore, type Edit, type WriteResult,
  ConflictError, assertWritable, editKind, versionOf,
} from './types.ts';

interface Options {
  token: string;
  /** `owner/name` */
  repo: string;
  branch: string;
}

class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Two levels below the requested directory: collection → trip folder → entry.
const TREE_QUERY = `
query($owner: String!, $name: String!, $ref: String!, $path: String!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) {
      target { ... on Commit { oid file(path: $path) { object { ...Level } } } }
    }
  }
}
fragment File on Blob { text isTruncated isBinary }
fragment Level on Tree {
  entries { path object { ...File ... on Tree { entries { path object { ...File } } } } }
}`;

interface TreeEntry {
  path: string;
  object: { text?: string | null; isTruncated?: boolean; isBinary?: boolean; entries?: TreeEntry[] } | null;
}

/** `src/content/entries/japan-2022/x.mdx` → `src/content/entries` */
const collectionOf = (path: string) => path.split('/').slice(0, 3).join('/');

const MAX_ATTEMPTS = 3;
// Used only when a save arrives without a known person (see session.ts userFor).
const SITE_IDENTITY = { name: 'Site admin', email: 'admin@cleatusandthewestvirginian.com' };

export class GitHubStore implements ContentStore {
  readonly kind = 'github' as const;
  private owner: string;
  private name: string;
  /** Commit the cache below was read at. */
  private head: string | null = null;
  private files = new Map<string, string>();
  private loaded = new Set<string>();

  constructor(private o: Options) {
    [this.owner, this.name] = o.repo.split('/');
    if (!this.owner || !this.name) throw new Error(`bad repo: ${o.repo}`);
  }

  private async api(path: string, init: { method?: string; body?: unknown } = {}) {
    const res = await fetch(`https://api.github.com${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${this.o.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'cleatus-wv-admin',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const out = await res.json().catch(() => null);
    if (!res.ok) throw new GitHubError(res.status, `GitHub ${init.method ?? 'GET'} ${path}: ${res.status} ${out?.message ?? ''}`);
    return out;
  }

  private get repoPath() {
    return `/repos/${this.owner}/${this.name}`;
  }

  private forget() {
    this.head = null;
    this.files.clear();
    this.loaded.clear();
  }

  /** Reads every file under `dir` at the branch tip into the cache. */
  private async load(dir: string) {
    const out = await this.api('/graphql', {
      method: 'POST',
      body: {
        query: TREE_QUERY,
        variables: { owner: this.owner, name: this.name, ref: `refs/heads/${this.o.branch}`, path: dir },
      },
    });
    if (out.errors?.length) throw new Error(`GitHub GraphQL: ${out.errors[0].message}`);
    const commit = out.data?.repository?.ref?.target;
    if (!commit?.oid) throw new Error(`branch not found: ${this.o.branch}`);

    // The tip moved since the last load: everything cached is from an older commit.
    if (this.head && this.head !== commit.oid) this.forget();
    this.head = commit.oid;

    const walk = async (entries: TreeEntry[] | undefined) => {
      for (const e of entries ?? []) {
        const obj = e.object;
        if (!obj) continue;
        if (obj.entries) await walk(obj.entries);
        else if ('text' in obj && !obj.isBinary) {
          this.files.set(e.path, obj.isTruncated || obj.text == null ? await this.fetchOne(e.path) : obj.text);
        }
      }
    };
    await walk(commit.file?.object?.entries);
    this.loaded.add(dir);
  }

  /** One file through the REST API, for anything GraphQL truncated. */
  private async fetchOne(path: string) {
    const out = await this.api(`${this.repoPath}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${this.head}`);
    return Buffer.from(out.content, 'base64').toString('utf8');
  }

  async read(path: string) {
    assertWritable(path); // content paths only — the same fence as writes
    const dir = collectionOf(path);
    if (!this.loaded.has(dir)) await this.load(dir);
    const text = this.files.get(path);
    if (text === undefined) throw new Error(`not found: ${path}`);
    return { text, version: versionOf(text) };
  }

  async list(prefix: string, ext: string) {
    const dir = prefix.replace(/\/$/, '');
    if (!this.loaded.has(dir)) await this.load(dir);
    return [...this.files.keys()].filter((p) => p.startsWith(`${dir}/`) && p.endsWith(ext)).sort();
  }

  /** File names directly in `dir` at `ref` (default: the tip this store read). */
  private async dirAt(dir: string, ref: string) {
    try {
      const out = await this.api(`${this.repoPath}/contents/${dir.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`);
      return Array.isArray(out) ? out.filter((x: { type: string }) => x.type === 'file').map((x: { name: string }) => x.name).sort() : [];
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) return [];
      throw err;
    }
  }

  async listDir(dir: string) {
    return this.dirAt(dir.replace(/\/$/, ''), this.head ?? this.o.branch);
  }

  /**
   * Uploads the bytes as a git blob. Nothing points at it until a write puts it
   * in a commit; GitHub discards blobs that never get used.
   */
  async stage(bytes: Uint8Array) {
    const out = await this.api(`${this.repoPath}/git/blobs`, {
      method: 'POST',
      body: { content: Buffer.from(bytes).toString('base64'), encoding: 'base64' },
    });
    return String(out.sha);
  }

  async write(edits: Edit[], message: string, author?: Author): Promise<WriteResult> {
    if (!edits.length) throw new Error('nothing to write');
    if (!message.trim()) throw new Error('a commit message is required');
    const kinds = edits.map(editKind);

    for (let attempt = 1; ; attempt++) {
      const ref = await this.api(`${this.repoPath}/git/ref/heads/${this.o.branch}`);
      if (ref.object.sha !== this.head) this.forget();

      // Check every version against the tip before writing anything — and that
      // every file being created doesn't exist yet.
      const stale: string[] = [];
      const dirs = new Map<string, string[]>();
      for (const [i, e] of edits.entries()) {
        if (kinds[i] === 'photo') {
          const dir = e.path.slice(0, e.path.lastIndexOf('/'));
          if (!dirs.has(dir)) dirs.set(dir, await this.dirAt(dir, ref.object.sha));
          if (dirs.get(dir)!.includes(e.path.slice(dir.length + 1))) stale.push(e.path);
          continue;
        }
        const cur = await this.read(e.path).catch(() => null);
        if (e.baseVersion === null ? cur !== null : !cur || cur.version !== e.baseVersion) stale.push(e.path);
      }
      if (stale.length) throw new ConflictError(stale);

      const parent = this.head ?? ref.object.sha;
      const base = await this.api(`${this.repoPath}/git/commits/${parent}`);
      const tree = await this.api(`${this.repoPath}/git/trees`, {
        method: 'POST',
        body: {
          base_tree: base.tree.sha,
          tree: edits.map((e, i) => kinds[i] === 'photo'
            ? { path: e.path, mode: '100644', type: 'blob', sha: e.staged }
            : { path: e.path, mode: '100644', type: 'blob', content: e.text }),
        },
      });
      const commit = await this.api(`${this.repoPath}/git/commits`, {
        method: 'POST',
        body: {
          message,
          tree: tree.sha,
          parents: [parent],
          // Author and committer are both the signed-in person, so the history
          // credits them alone. Only an unidentified save falls back to the site.
          author: { ...(author ?? SITE_IDENTITY), date: new Date().toISOString() },
          committer: { ...(author ?? SITE_IDENTITY), date: new Date().toISOString() },
        },
      });

      try {
        await this.api(`${this.repoPath}/git/refs/heads/${this.o.branch}`, {
          method: 'PATCH',
          body: { sha: commit.sha, force: false },
        });
      } catch (err) {
        // 422: the branch moved after the check. Go round again from the new
        // tip; the version check decides whether that is a real conflict.
        if (err instanceof GitHubError && err.status === 422 && attempt < MAX_ATTEMPTS) {
          this.forget();
          continue;
        }
        throw err;
      }

      this.head = commit.sha;
      const texts = edits.filter((e) => e.text != null);
      for (const e of texts) this.files.set(e.path, e.text!);
      return {
        commit: String(commit.sha).slice(0, 7),
        versions: Object.fromEntries(texts.map((e) => [e.path, versionOf(e.text!)])),
      };
    }
  }
}
