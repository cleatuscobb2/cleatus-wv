/**
 * Registers the admin routes — in development only (Phase A).
 *
 * The admin lives outside src/pages so Astro never picks it up on its own. This
 * integration injects the routes when the command is `dev` and does nothing
 * during `build`, so a production build cannot contain an unauthenticated
 * admin: the routes simply don't exist there. scripts/verify-build.ts checks the
 * output as a second line of defence.
 *
 * Phase B will inject them for production too, behind sign-in.
 */
import type { AstroIntegration } from 'astro';

export default function cleatusAdmin(): AstroIntegration {
  return {
    name: 'cleatus-admin',
    hooks: {
      'astro:config:setup': ({ command, injectRoute, logger }) => {
        if (command !== 'dev') return;
        const route = (pattern: string, file: string) =>
          injectRoute({ pattern, entrypoint: new URL(file, import.meta.url), prerender: false });

        route('/admin', './pages/index.astro');
        route('/admin/curate', './pages/curate.astro');
        route('/api/admin/curate', './api/curate.ts');
        route('/api/admin/git', './api/git.ts');

        logger.info('local admin at /admin (development only — never built)');
      },
    },
  };
}
