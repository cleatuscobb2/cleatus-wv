/**
 * Teasers on the spinning globe: as a place with photographs turns past the middle
 * of the globe, a small card opens beside it with its best picture and the place's
 * name, so a visitor sees there is something there before they stop and look.
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

interface Group<P> { lat: number; lng: number; posts: P[]; best: P; pics: string[]; title: string; score: number }

const BASE_SPAN = 9; // degrees either side of the centre line, for a place on its own
const WIDEN = 4; // added per neighbour in the band, up to MAX_SPAN
const MAX_SPAN = 24;
const LINGER = 3; // a card already open stays a little past the edge, so it doesn't flicker
const TURN = 2800; // ms each overlapping card spends in front before the next comes forward
const FLIP = 2400; // ms each picture shows on a card before the next fades in
const MAX_PICS = 6;

const km = (a: [number, number], b: [number, number]) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b[1] - a[1]) * r) / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(((b[0] - a[0]) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

/** How much a caption says, without hashtags or links. */
const words = (caption: string) =>
  caption.replace(/https?:\/\/\S+|www\.\S+/g, '').replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim().length;

/** Posts within 60 km of each other count as one place. The best is the one with the most to say. */
function groupsOf<P extends CameoPhoto>(photos: P[]): Group<P>[] {
  const groups: { at: [number, number]; posts: P[] }[] = [];
  for (const p of photos) {
    const g = groups.find((x) => km(x.at, [p.lng, p.lat]) < 60);
    if (g) g.posts.push(p); else groups.push({ at: [p.lng, p.lat], posts: [p] });
  }
  const scoreOf = (p: P) => Math.min(words(p.caption), 160) + 25 * Math.min(p.media.length, 4)
    + (p.icon ? 300 : 0) + (p.media.some((m) => !m.video) ? 40 : 0);
  return groups.flatMap(({ at, posts }) => {
    const ranked = [...posts].sort((a, b) => scoreOf(b) - scoreOf(a));
    const best = ranked[0];
    // Every picture from the place, the best post's first: stills as they are, videos by their poster.
    const pics = [...new Set(ranked.flatMap((p) => p.media.map((m) => (m.video ? m.poster : (m.thumb ?? m.src)))))]
      .filter((x): x is string => Boolean(x))
      .slice(0, MAX_PICS);
    if (!pics.length) return [];
    return [{ lng: at[0], lat: at[1], posts, best, pics, title: best.place, score: scoreOf(best) + 10 * posts.length }];
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
  // Each card keeps the band it opened with, so a neighbour leaving doesn't cut it short.
  const shown = new Map<Group<P>, { marker: Marker; el: HTMLElement; span: number; flip?: number }>();
  let last = 0;

  const close = (g: Group<P>) => {
    const s = shown.get(g);
    if (!s) return;
    shown.delete(g);
    clearInterval(s.flip);
    s.el.classList.remove('is-in');
    s.el.classList.add('is-out');
    // Gone once the fade out (map.astro, .cameo.is-out) has run.
    setTimeout(() => s.marker.remove(), 1000);
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

  const openCard = (g: Group<P>, span: number) => {
    const narrow = map.getContainer().clientWidth < 700;
    const w = narrow ? 73 : 92;
    // A 16:10 picture over the place's name.
    const h = Math.round(w * 0.625) + (narrow ? 22 : 26); // up to two lines of name
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cameo';
    el.style.width = `${w}px`;
    el.setAttribute('aria-label', `Photos from ${g.title}`);
    el.innerHTML = `<span class="cameo__pic"><img class="is-shown" src="${esc(g.pics[0])}" alt="" decoding="async" /></span><span class="cameo__text"><b>${esc(g.title)}</b></span>`;
    const pos = place(g, w, h);
    el.classList.add(`cameo--${pos.side}`);
    // A press on a card is not the globe being grabbed, so it doesn't stop the spin before the click lands.
    for (const ev of ['mousedown', 'touchstart', 'pointerdown'] as const) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      clear();
      // The picture on the card comes up first.
      opts.open([g.best, ...g.posts.filter((p) => p !== g.best)], [g.best.lng, g.best.lat]);
    });
    // MapLibre sets the marker element's own position and opacity, so the fade runs on the card inside it.
    const pin = document.createElement('div');
    pin.className = 'cameo-pin';
    pin.append(el);
    const marker = new ml.Marker({ element: pin, offset: pos.off }).setLngLat([g.lng, g.lat]).addTo(map);
    shown.set(g, { marker, el, span });
    // Fade in once the picture is ready to draw, so it never pops in after the card.
    const img = el.querySelector('img')!;
    let shownYet = false;
    const show = () => {
      if (shownYet || el.classList.contains('is-out')) return;
      shownYet = true;
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
    };
    img.decode().then(show, show);
    setTimeout(show, 1500);
    if (g.pics.length > 1) shown.get(g)!.flip = flipThrough(el, g.pics);
  };

  /** A place with several pictures cross-fades through them while its card is up. */
  const flipThrough = (el: HTMLElement, pics: string[]) => {
    const frame = el.querySelector<HTMLElement>('.cameo__pic')!;
    let at = 0;
    return window.setInterval(() => {
      const next = (at + 1) % pics.length;
      const img = new Image();
      img.alt = '';
      img.decoding = 'async';
      img.src = pics[next];
      // Fade the next one in over the current, once it can be drawn, then drop the old.
      img.decode().then(() => {
        if (!el.isConnected) return;
        const old = frame.querySelector('img.is-shown');
        frame.append(img);
        requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add('is-shown')));
        setTimeout(() => old?.remove(), 1000);
        at = next;
      }, () => { at = next; });
    }, FLIP);
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
    for (const [g, s] of [...shown]) {
      if (Math.abs(offsetFrom(centre.lng, g.lng)) > Math.max(span, s.span) + LINGER) close(g);
    }
    // Places come in from the east as the globe turns. One already past the middle would
    // only flash up before it leaves, so it waits for the next time round.
    const want = near
      .filter((g) => {
        const d = offsetFrom(centre.lng, g.lng);
        return !shown.has(g) && d < span && d > -LINGER;
      })
      .sort((a, b) => b.score - a.score);
    for (const g of want) {
      if (shown.size >= max) break;
      openCard(g, span);
    }
    takeTurns(now);
  };

  /**
   * Cards drift into each other as the globe turns and leans. Where they overlap, each
   * comes to the front in turn, the others stepping back and dimming, so all get seen.
   */
  const takeTurns = (now: number) => {
    const live = [...shown.entries()].filter(([, s]) => !s.el.classList.contains('is-out'));
    const rects = live.map(([, s]) => s.el.getBoundingClientRect());
    const touch = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 4 && b.left < a.right - 4 && a.top < b.bottom - 4 && b.top < a.bottom - 4;
    // Bunch cards that overlap, directly or through a neighbour.
    const bunch = live.map((_, i) => i);
    const root = (i: number): number => (bunch[i] === i ? i : (bunch[i] = root(bunch[i])));
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) if (touch(rects[i], rects[j])) bunch[root(i)] = root(j);
    }
    const members = new Map<number, number[]>();
    live.forEach((_, i) => members.set(root(i), [...(members.get(root(i)) ?? []), i]));
    for (const idx of members.values()) {
      // A steady order, so the turns go round rather than jumping about.
      idx.sort((a, b) => groups.indexOf(live[a][0]) - groups.indexOf(live[b][0]));
      const front = idx.length > 1 ? idx[Math.floor(now / TURN) % idx.length] : idx[0];
      for (const i of idx) {
        const { el } = live[i][1];
        const back = i !== front;
        el.classList.toggle('is-back', back);
        el.parentElement!.style.zIndex = back ? '1' : '2';
      }
    }
  };

  map.on('move', tick);
  return { clear };
}
