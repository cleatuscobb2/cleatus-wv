/**
 * Teasers on the spinning globe: as a place with photographs turns past the middle
 * of the globe, a small card opens beside it with its best picture and a line about
 * it, so a visitor sees there is something there before they stop and look.
 *
 * Places are opened as they come within a band either side of the centre line and
 * closed as they leave it. When several are in the band together, the band widens,
 * so each card stays up long enough to read. A card opens that place's photos.
 */
import type { Map as MLMap, Marker } from 'maplibre-gl';
import { esc } from './map-kit.ts';

export interface CameoPhoto {
  lat: number; lng: number; caption: string; when: string; place: string; icon?: string;
  media: { src: string; thumb?: string; poster?: string; video?: boolean }[];
}

interface Group<P> { lat: number; lng: number; posts: P[]; best: P; pic: string; title: string; line: string; meta: string; score: number }

const BASE_SPAN = 9; // degrees either side of the centre line, for a place on its own
const WIDEN = 4; // added per neighbour in the band, up to MAX_SPAN
const MAX_SPAN = 24;
const LINGER = 3; // a card already open stays a little past the edge, so it doesn't flicker

const km = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/** A caption cut to its first sentence, without hashtags or links. */
function teaser(caption: string, max = 78): string {
  const plain = caption.replace(/https?:\/\/\S+|www\.\S+/g, '').replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim();
  const first = plain.split(/(?<=[.!?])\s/)[0] ?? plain;
  return first.length > max ? `${first.slice(0, max - 1).replace(/[\s,;:–-]+\S*$/, '')}…` : first;
}

/** Posts within 60 km of each other count as one place. The best is the one with the most to say. */
function groupsOf<P extends CameoPhoto>(photos: P[]): Group<P>[] {
  const groups: { at: [number, number]; posts: P[] }[] = [];
  for (const p of photos) {
    const g = groups.find((x) => km(x.at, [p.lng, p.lat]) < 60);
    if (g) g.posts.push(p); else groups.push({ at: [p.lng, p.lat], posts: [p] });
  }
  const scoreOf = (p: P) => Math.min(teaser(p.caption, 400).length, 160) + 25 * Math.min(p.media.length, 4)
    + (p.icon ? 300 : 0) + (p.media.some((m) => !m.video) ? 40 : 0);
  return groups.flatMap(({ at, posts }) => {
    const best = [...posts].sort((a, b) => scoreOf(b) - scoreOf(a))[0];
    const still = best.media.find((m) => !m.video);
    const pic = still ? (still.thumb ?? still.src) : best.media[0]?.poster;
    if (!pic) return [];
    const n = posts.reduce((s, p) => s + p.media.length, 0);
    const years = [...new Set(posts.map((p) => p.when.match(/\d{4}/)?.[0]).filter(Boolean))].sort();
    return [{
      lng: at[0], lat: at[1], posts, best, pic,
      title: best.place,
      line: (best.icon ? `${best.icon} ` : '') + (teaser(best.caption) || 'Photographs from here'),
      meta: [`${n} ${n === 1 ? 'photo' : 'photos'}`, years.length > 1 ? `${years[0]}–${years.at(-1)}` : best.when].join(' · '),
      score: scoreOf(best) + 10 * posts.length,
    }];
  });
}

/** -180..180, the way round the globe from the centre line to here. */
const offsetFrom = (centre: number, lng: number) => ((((lng - centre) % 360) + 540) % 360) - 180;

export function startCameos<P extends CameoPhoto>(
  map: MLMap,
  ml: { Marker: typeof Marker },
  photos: P[],
  opts: { active: () => boolean; open: (posts: P[], at: [number, number]) => void },
) {
  const groups = groupsOf(photos);
  const shown = new Map<Group<P>, { marker: Marker; el: HTMLElement }>();
  let last = 0;

  const close = (g: Group<P>) => {
    const s = shown.get(g);
    if (!s) return;
    shown.delete(g);
    s.el.classList.remove('is-in');
    setTimeout(() => s.marker.remove(), 350);
  };
  const clear = () => { for (const g of [...shown.keys()]) close(g); };

  /** Above the place, or failing that below, left or right of it, clear of the cards already up. */
  const place = (g: Group<P>, w: number, h: number) => {
    const p = map.project([g.lng, g.lat]);
    const taken = [...shown.values()].map(({ el }) => el.getBoundingClientRect());
    const box = map.getCanvas().getBoundingClientRect();
    const gap = 16;
    const options: { side: string; off: [number, number] }[] = [
      { side: 'above', off: [0, -(h / 2 + gap)] }, { side: 'below', off: [0, h / 2 + gap] },
      { side: 'right', off: [w / 2 + gap, 0] }, { side: 'left', off: [-(w / 2 + gap), 0] },
    ];
    const clearOf = (o: { off: [number, number] }) => {
      const x = box.left + p.x + o.off[0] - w / 2;
      const y = box.top + p.y + o.off[1] - h / 2;
      return taken.every((r) => x + w < r.left || x > r.right || y + h < r.top || y > r.bottom);
    };
    return options.find(clearOf) ?? options[0];
  };

  const openCard = (g: Group<P>) => {
    const narrow = map.getContainer().clientWidth < 700;
    const w = narrow ? 104 : 132;
    // A 16:10 picture over two or three short lines of text.
    const h = Math.round(w * 0.625) + (narrow ? 56 : 70);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cameo';
    el.style.width = `${w}px`;
    el.setAttribute('aria-label', `Photos from ${g.title}: ${g.line}`);
    el.innerHTML = `<img src="${esc(g.pic)}" alt="" decoding="async" />
      <span class="cameo__text"><b>${esc(g.title)}</b><span class="cameo__line">${esc(g.line)}</span><span class="cameo__meta mono">${esc(g.meta)}</span></span>`;
    const pos = place(g, w, h);
    el.classList.add(`cameo--${pos.side}`);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      clear();
      // The picture on the card comes up first.
      opts.open([g.best, ...g.posts.filter((p) => p !== g.best)], [g.best.lng, g.best.lat]);
    });
    const marker = new ml.Marker({ element: el, offset: pos.off }).setLngLat([g.lng, g.lat]).addTo(map);
    shown.set(g, { marker, el });
    // Fade in once the picture is there, or shortly anyway.
    const img = el.querySelector('img')!;
    const show = () => requestAnimationFrame(() => el.classList.add('is-in'));
    if (img.complete) show(); else { img.addEventListener('load', show, { once: true }); setTimeout(show, 600); }
  };

  const tick = () => {
    const now = performance.now();
    if (now - last < 150) return;
    last = now;
    if (!opts.active()) { clear(); return; }
    const centre = map.getCenter();
    const max = map.getContainer().clientWidth < 700 ? 2 : 4;
    // Neighbours widen the band, so a crowd of places each stays up longer.
    const near = groups.filter((g) => Math.abs(offsetFrom(centre.lng, g.lng)) < MAX_SPAN && Math.abs(g.lat - centre.lat) < 62);
    const span = Math.min(MAX_SPAN, BASE_SPAN + WIDEN * Math.max(0, near.length - 1));
    for (const g of [...shown.keys()]) {
      if (Math.abs(offsetFrom(centre.lng, g.lng)) > span + LINGER) close(g);
    }
    const want = near
      .filter((g) => !shown.has(g) && Math.abs(offsetFrom(centre.lng, g.lng)) < span)
      .sort((a, b) => b.score - a.score);
    for (const g of want) {
      if (shown.size >= max) break;
      openCard(g);
    }
  };

  map.on('move', tick);
  return { clear };
}
