/**
 * Runs after `astro build`: puts the 535 legacy redirects from vercel.json into
 * the routing file the Vercel adapter writes (.vercel/output/config.json).
 *
 * Once the build hands Vercel a ready-made .vercel/output, Vercel routes by
 * that file. The adapter only writes Astro's own redirects into it, so without
 * this step every old Squarespace link would quietly start to 404. The
 * conversion uses @vercel/routing-utils — the same code Vercel uses to read
 * vercel.json — so the rules behave exactly as they did before the adapter.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { getTransformedRoutes } from '@vercel/routing-utils';

const CONFIG = '.vercel/output/config.json';

const vercelJson = JSON.parse(readFileSync('vercel.json', 'utf8'));
const config = JSON.parse(readFileSync(CONFIG, 'utf8'));

const { routes: redirects, error } = getTransformedRoutes({ redirects: vercelJson.redirects });
if (error || !redirects) throw new Error(`vercel.json redirects: ${error?.message}`);

// Idempotent: running twice must not add the rules twice.
const ours = new Set(redirects.map((r) => JSON.stringify(r)));
const routes = (config.routes as unknown[]).filter((r) => !ours.has(JSON.stringify(r)));
// Redirects are checked before the filesystem, exactly as vercel.json's were.
const at = routes.findIndex((r) => (r as { handle?: string }).handle === 'filesystem');
routes.splice(at === -1 ? 0 : at, 0, ...redirects);
config.routes = routes;

writeFileSync(CONFIG, JSON.stringify(config, null, 2));
console.log(`vercel-routes: ${redirects.length} legacy redirects added to ${CONFIG}`);
