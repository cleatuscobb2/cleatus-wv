import type { ContentStore } from './types.ts';
import { FsStore } from './fs-store.ts';

/**
 * The single place that decides which store the admin writes through.
 * Phase B adds `GitHubStore` here; nothing else changes.
 */
export function getStore(): ContentStore {
  return new FsStore(process.cwd());
}

export { ConflictError, versionOf } from './types.ts';
export type { ContentStore, Edit, Author } from './types.ts';
