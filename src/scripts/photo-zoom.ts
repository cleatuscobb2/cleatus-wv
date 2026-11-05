/**
 * Blog photos (<Photo />, <PhotoPair />, <PhotoStrip />) open in the photo viewer,
 * stepping through every photo on the page in order. Each is a real link to the
 * file, so with no JavaScript, or on ctrl-click, it still opens by itself.
 */
import { openLightbox, plainClick, type Slide } from './lightbox.ts';

const slide = (a: HTMLAnchorElement): Slide => ({
  src: a.href,
  alt: a.querySelector('img')?.alt ?? '',
  caption: a.closest('figure')?.querySelector('figcaption')?.textContent?.trim() ?? '',
});

document.addEventListener('click', (e) => {
  const a = (e.target as Element).closest?.<HTMLAnchorElement>('a[data-zoom]');
  if (!a || !plainClick(e)) return;
  e.preventDefault();
  const all = [...document.querySelectorAll<HTMLAnchorElement>('a[data-zoom]')];
  openLightbox(all.map(slide), all.indexOf(a));
});
