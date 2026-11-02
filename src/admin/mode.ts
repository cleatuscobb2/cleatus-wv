/**
 * Which admin is running.
 *
 * - **Local** (`astro dev`): this laptop's files and git, no sign-in. Phase A.
 * - **Hosted** (the live site): email sign-in, edits committed through GitHub.
 *   Phase B.
 *
 * `ADMIN_HOSTED=1` runs the hosted admin under `astro dev`, for testing the
 * sign-in flow and the GitHub store without deploying (see scripts/dev-hosted.ts).
 */
export const HOSTED = Boolean(import.meta.env?.PROD) || process.env.ADMIN_HOSTED === '1';

/** Read at request time, never inlined into the bundle. */
export const env = (name: string): string | undefined => process.env[name]?.trim() || undefined;

export function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

/** Where links in emails point. Fixed in production so a forged Host header can't redirect them. */
export function siteOrigin(request: Request): string {
  return import.meta.env?.PROD ? new URL(import.meta.env.SITE).origin : new URL(request.url).origin;
}
