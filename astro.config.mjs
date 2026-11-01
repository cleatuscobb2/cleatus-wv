import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwind from '@tailwindcss/vite';
import cleatusAdmin from './src/admin/integration.ts';

export default defineConfig({
  site: 'https://cleatusandthewestvirginian.com',
  // cleatusAdmin only injects routes under `astro dev`; the build never sees them.
  integrations: [mdx(), sitemap(), cleatusAdmin()],
  vite: { plugins: [tailwind()] },
  markdown: { shikiConfig: { theme: 'github-dark' } },
  build: { format: 'directory' },
});
