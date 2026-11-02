/**
 * Registers the admin routes.
 *
 * The admin lives outside src/pages so Astro never picks it up on its own. Every
 * route is server-rendered (`prerender: false`), so in production it runs in the
 * Vercel function, where guard.ts checks the session on each request — nothing
 * of it is ever written out as a static file. scripts/verify-build.ts fails the
 * build if that ever stops being true.
 *
 * Under `astro dev` the same routes are the local, no-sign-in admin (mode.ts).
 */
import type { AstroIntegration } from 'astro';

export default function cleatusAdmin(): AstroIntegration {
  return {
    name: 'cleatus-admin',
    hooks: {
      'astro:config:setup': ({ command, injectRoute, logger }) => {
        const route = (pattern: string, file: string) =>
          injectRoute({ pattern, entrypoint: new URL(file, import.meta.url), prerender: false });

        route('/admin', './pages/index.astro');
        route('/admin/curate', './pages/curate.astro');
        route('/admin/verify', './pages/verify.astro');
        route('/admin/trips', './pages/trips.astro');
        route('/admin/trips/[trip]', './pages/trip.astro');
        route('/api/admin/curate', './api/curate.ts');
        route('/api/admin/trip', './api/trip.ts');
        route('/admin/entry/[trip]/[slug]', './pages/entry.astro');
        route('/api/admin/preview', './api/entry-preview.ts');
        route('/api/admin/entry', './api/entry-save.ts');
        route('/api/admin/git', './api/git.ts');
        route('/api/auth/request', './api/auth-request.ts');
        route('/api/auth/verify', './api/auth-verify.ts');
        route('/api/auth/signout', './api/auth-signout.ts');

        if (command === 'dev') {
          const hosted = process.env.ADMIN_HOSTED === '1';
          logger.info(hosted ? 'hosted admin (sign-in + GitHub) at /admin' : 'local admin at /admin (no sign-in, this laptop only)');
        }
      },
    },
  };
}
