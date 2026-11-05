/**
 * A photo viewer that floats over the page instead of leaving it. A native
 * <dialog>, so it sits above everything (a fullscreen map included), keeps
 * keyboard focus inside, closes on Esc, and hands focus back afterwards.
 *
 * Whatever opens it stays a real link to the photo, so a photo still opens with
 * no JavaScript, and ctrl-click still means a new tab.
 */
import '../styles/lightbox.css';

export interface Slide { src: string; caption?: string; meta?: string }

let dialog: HTMLDialogElement | null = null;
let slides: Slide[] = [];
let n = 0;

const part = <T extends HTMLElement>(s: string) => dialog!.querySelector<T>(s)!;

function show() {
  const s = slides[n];
  const img = part<HTMLImageElement>('.lb__img');
  // Blank first, so a slow photo doesn't sit under the last one's caption.
  img.removeAttribute('src');
  img.src = s.src;
  const cap = part('.lb__cap');
  cap.textContent = s.caption ?? '';
  cap.hidden = !s.caption;
  cap.scrollTop = 0;
  const meta = part('.lb__meta');
  meta.textContent = s.meta ?? '';
  meta.hidden = !s.meta;
  const many = slides.length > 1;
  part('.lb__count').textContent = many ? `${n + 1} / ${slides.length}` : '';
  part('.lb__nav--prev').hidden = !many;
  part('.lb__nav--next').hidden = !many;
  // Have the next one ready before it's asked for.
  if (many) new Image().src = slides[(n + 1) % slides.length].src;
}

function step(d: number) {
  if (slides.length < 2) return;
  n = (n + d + slides.length) % slides.length;
  show();
}

function build() {
  const d = document.createElement('dialog');
  d.className = 'lb';
  d.setAttribute('aria-label', 'Photo viewer');
  d.innerHTML = `
    <button type="button" class="lb__close" aria-label="Close" autofocus>×</button>
    <button type="button" class="lb__nav lb__nav--prev" aria-label="Previous photo">‹</button>
    <button type="button" class="lb__nav lb__nav--next" aria-label="Next photo">›</button>
    <figure class="lb__fig">
      <div class="lb__stage"><img class="lb__img" alt="" /></div>
      <figcaption class="lb__text">
        <span class="lb__count" aria-live="polite"></span>
        <p class="lb__cap"></p>
        <p class="lb__meta"></p>
      </figcaption>
    </figure>`;
  document.body.append(d);
  dialog = d;

  part('.lb__close').addEventListener('click', () => d.close());
  part('.lb__nav--prev').addEventListener('click', () => step(-1));
  part('.lb__nav--next').addEventListener('click', () => step(1));
  // A click anywhere but the photo, its words or a button closes it.
  d.addEventListener('click', (e) => {
    if (!(e.target as Element).closest('.lb__img, .lb__text, button')) d.close();
  });
  d.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') step(-1);
    if (e.key === 'ArrowRight') step(1);
  });
  // Swipe between photos. Two fingers are a pinch, and left alone.
  let startX: number | null = null;
  d.addEventListener('touchstart', (e) => { startX = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
  d.addEventListener('touchend', (e) => {
    if (startX == null) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  }, { passive: true });
  // The page behind stays where it was, and stops scrolling, while this is open.
  d.addEventListener('close', () => {
    document.documentElement.classList.remove('lb-open');
    part<HTMLImageElement>('.lb__img').removeAttribute('src');
  });
  return d;
}

export function openLightbox(list: Slide[], start = 0) {
  if (!list.length) return;
  const d = dialog ?? build();
  slides = list;
  n = Math.min(Math.max(start, 0), list.length - 1);
  show();
  document.documentElement.classList.add('lb-open');
  if (!d.open) d.showModal();
}

/** A plain click, not one asking for a new tab or a download. */
export const plainClick = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
