import type { ContentStore } from './types.ts';
import { FsStore } from './fs-store.ts';
import { GitHubStore } from './github-store.ts';
import { HOSTED, env, requireEnv } from '../mode.ts';

/**
 * The single place that decides which store the admin writes through: this
 * laptop's files when running locally, the GitHub repository when hosted.
 * Create one per request — a GitHubStore caches what it read for that request.
 */
export function getStore(): ContentStore {
  if (!HOSTED) return new FsStore(process.cwd());
  const vercelRepo = env('VERCEL_GIT_REPO_OWNER') && env('VERCEL_GIT_REPO_SLUG')
    ? `${env('VERCEL_GIT_REPO_OWNER')}/${env('VERCEL_GIT_REPO_SLUG')}`
    : undefined;
  return new GitHubStore({
    token: requireEnv('GITHUB_TOKEN'),
    repo: env('GITHUB_REPO') ?? vercelRepo ?? 'cleatuscobb2/cleatus-wv',
    branch: env('GITHUB_BRANCH') ?? 'main',
  });
}

export { ConflictError, versionOf } from './types.ts';
export type { ContentStore, Edit, Author } from './types.ts';
