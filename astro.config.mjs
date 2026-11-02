import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwind from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';
import cleatusAdmin from './src/admin/integration.ts';

export default defineConfig({
  site: 'https://cleatusandthewestvirginian.com',
  // Every public page is still prerendered. The adapter exists for the admin's
  // server routes; scripts/vercel-routes.ts carries vercel.json's redirects over.
  adapter: vercel(),
  // Without this, server routes see every request as https://localhost/… (Astro
  // ignores the Host header unless the domain is listed), so each same-site POST
  // looks cross-site and is refused. www never reaches the function — it 308s.
  security: { allowedDomains: [{ hostname: 'cleatusandthewestvirginian.com', protocol: 'https' }] },
  integrations: [
    mdx(),
    // The sitemap would otherwise list the admin's server routes too.
    sitemap({ filter: (page) => !/^\/(admin|api)(\/|$)/.test(new URL(page).pathname) }),
    cleatusAdmin(),
  ],
  vite: { plugins: [tailwind()] },
  markdown: { shikiConfig: { theme: 'github-dark' } },
  build: { format: 'directory' },
});
