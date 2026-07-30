import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwind from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://cleatusandthewestvirginian.com',
  integrations: [mdx(), sitemap()],
  vite: { plugins: [tailwind()] },
  markdown: { shikiConfig: { theme: 'github-dark' } },
  build: { format: 'directory' },
});
