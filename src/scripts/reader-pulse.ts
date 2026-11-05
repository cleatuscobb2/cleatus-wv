/**
 * What a reader's browser tells the site's own counter (src/admin/pulse.ts).
 * Counts, never identities: no cookie and no id. The one thing kept on the device
 * is the date of its last visit and how many visits it has made, which the browser
 * reads itself and reports only as a rough bucket ("returning, 8-30 days"), so the
 * server has nothing that links one visit to another.
 *
 * Skipped for browsers that ask not to be tracked, and inside the analytics page's
 * own preview frame.
 */
const LAST = 'cw-last';
const VISITS = 'cw-visits';
const SESSION = 'cw-session';

const widthClass = () => (innerWidth < 700 ? 'phone' : innerWidth < 1100 ? 'tablet' : 'desktop');
const send = (url: string, body: unknown) => {
  try { navigator.sendBeacon(url, JSON.stringify(body)); } catch { /* never in a reader's way */ }
};
const docHeight = () => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0, 1);

function store(kind: 'local' | 'session') {
  try { return kind === 'local' ? localStorage : sessionStorage; } catch { return null; }
}

function bucketGap(days: number) {
  if (days < 2) return '1';
  if (days <= 7) return '2-7';
  if (days <= 30) return '8-30';
  if (days <= 90) return '31-90';
  return '91+';
}
function bucketVisits(n: number) {
  if (n <= 2) return String(n);
  if (n <= 5) return '3-5';
  if (n <= 10) return '6-10';
  return '11+';
}

function start() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.globalPrivacyControl || navigator.doNotTrack === '1') return;
  if (window.top !== window.self) return;

  // --- the view ---------------------------------------------------------------------
  const session = store('session');
  const landing = !session?.getItem(SESSION);
  if (landing) session?.setItem(SESSION, '1');

  let gap: string | undefined;
  let visits: string | undefined;
  if (landing) {
    const local = store('local');
    const today = new Date().toISOString().slice(0, 10);
    const last = local?.getItem(LAST);
    const count = Number(local?.getItem(VISITS) ?? 0) + 1;
    if (last) gap = bucketGap(Math.round((Date.parse(today) - Date.parse(last)) / 864e5));
    visits = bucketVisits(count);
    local?.setItem(LAST, today);
    local?.setItem(VISITS, String(Math.min(count, 9999)));
  }

  const url = new URL(location.href);
  const now = new Date();
  send('/api/hit', {
    p: location.pathname,
    r: document.referrer,
    l: landing ? 1 : 0,
    g: gap,
    nv: visits,
    w: widthClass(),
    sz: `${screen.width}x${screen.height}`,
    lg: (navigator.language || '').slice(0, 2).toLowerCase(),
    dm: matchMedia('(prefers-color-scheme: dark)').matches ? 1 : 0,
    h: now.getHours(),
    wd: now.getDay(),
    us: url.searchParams.get('utm_source') ?? undefined,
    uc: url.searchParams.get('utm_campaign') ?? undefined,
  });

  // --- how long, how far ------------------------------------------------------------
  const TIMES = [10, 30, 60, 180, 600];
  const DEPTHS = [25, 50, 75, 90, 100];
  let seconds = 0;
  let sentSeconds = 0;
  let sentTime = 0;
  let lastActive = Date.now();
  const crossedDepths: number[] = [];
  const active = () => { lastActive = Date.now(); };
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'scroll', 'touchstart']) {
    addEventListener(ev, active, { passive: true, capture: true });
  }
  // Time counts only while the tab is showing and they've done something in the last 30s.
  setInterval(() => {
    if (document.visibilityState === 'visible' && Date.now() - lastActive < 30_000 && seconds < 3600) seconds++;
  }, 1000);

  const depthNow = () => Math.min(100, ((scrollY + innerHeight) / docHeight()) * 100);
  let sentDepth = 0;
  const noteDepth = () => {
    const d = depthNow();
    for (const b of DEPTHS) {
      if (d >= b - 0.5 && b > sentDepth && !crossedDepths.includes(b)) crossedDepths.push(b);
    }
  };
  addEventListener('scroll', noteDepth, { passive: true });

  // --- where they click -------------------------------------------------------------
  const clicks: [number, number, string, string][] = [];
  let dead = 0;
  let rage = 0;
  const recent: { t: number; x: number; y: number }[] = [];
  const clean = (s: string | null | undefined) =>
    (s ?? '').replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} .,:;!?'&()/_#+-]/gu, '').trim().slice(0, 40);

  addEventListener('pointerup', (e) => {
    if (e.button !== 0 || clicks.length >= 25) return;
    const el = e.target as Element | null;
    if (!el?.closest) return;
    const x = Math.max(0, Math.min(49, Math.floor((e.clientX / innerWidth) * 50)));
    const y = Math.max(0, Math.min(199, Math.floor(((e.clientY + scrollY) / docHeight()) * 200)));

    const hit = el.closest('a,button,summary,label,input,select,textarea,[role=button]');
    let kind = 'dead';
    let label = '';
    if (hit?.tagName === 'A') {
      const a = hit as HTMLAnchorElement;
      if (a.hasAttribute('data-zoom')) kind = 'photo';
      else if (a.closest('.ig__strip, .igp__media')) kind = 'instagram';
      else if (a.host === location.host) { kind = 'link'; label = a.pathname; }
      else { kind = 'out'; label = a.hostname.replace(/^www\./, ''); }
    } else if (hit) {
      kind = 'ui';
      label = clean(hit.getAttribute('aria-label') || hit.textContent);
    } else if (el.tagName === 'CANVAS') {
      kind = 'map';
    } else if (el.tagName === 'IMG') {
      // Someone tried to open a picture that isn't clickable.
      kind = 'dead-photo';
    }
    if (kind === 'dead' || kind === 'dead-photo') dead++;

    const t = Date.now();
    recent.push({ t, x: e.clientX, y: e.clientY });
    while (recent.length && t - recent[0].t > 800) recent.shift();
    if (recent.length >= 3 && recent.every((r) => Math.abs(r.x - e.clientX) < 40 && Math.abs(r.y - e.clientY) < 40)) {
      rage++;
      recent.length = 0;
    }
    clicks.push([x, y, kind, label]);
  }, { passive: true, capture: true });

  // --- how fast it felt -------------------------------------------------------------
  let lcp = 0;
  let cls = 0;
  let inp = 0;
  const watch = (type: string, fn: (e: PerformanceEntry & Record<string, unknown>) => void, opts: Record<string, unknown> = {}) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((x) => fn(x as never)))
        .observe({ type, buffered: true, ...opts } as PerformanceObserverInit);
    } catch { /* not every browser has every metric */ }
  };
  watch('largest-contentful-paint', (e) => { lcp = e.startTime; });
  watch('layout-shift', (e) => { if (!e.hadRecentInput) cls += Number(e.value ?? 0); });
  watch('event', (e) => { if (e.duration > inp) inp = e.duration; }, { durationThreshold: 40 });

  // --- what they searched for -------------------------------------------------------
  let sentQuery = '';
  const queryNow = () => {
    if (!location.pathname.startsWith('/search')) return null;
    const box = document.querySelector<HTMLInputElement>('#search input');
    const q = box?.value.trim().toLowerCase() ?? '';
    if (q.length < 2 || q === sentQuery) return null;
    const message = document.querySelector('.pagefind-ui__message')?.textContent ?? '';
    return { q, zero: /^\s*(no results|0 results)/i.test(message) };
  };

  // --- the report, each time the page is left or hidden -----------------------------
  let first = true;
  const flush = () => {
    noteDepth();
    const newTimes = TIMES.filter((b) => seconds >= b && b > sentTime);
    const depths = crossedDepths.splice(0);
    if (depths.length) sentDepth = Math.max(sentDepth, ...depths);
    const q = queryNow();
    const delta = seconds - sentSeconds;
    if (!first && !delta && !depths.length && !clicks.length && !q) return;
    send('/api/pulse', {
      p: location.pathname,
      w: widthClass(),
      f: first ? 1 : 0,
      t: delta,
      tb: newTimes,
      sb: depths,
      c: clicks.splice(0),
      d: dead,
      rg: rage,
      ...(first ? { lcp: Math.round(lcp), cls: Math.round(cls * 1000) / 1000, inp: Math.round(inp) } : {}),
      ...(q ? { q: q.q, qz: q.zero ? 1 : 0 } : {}),
    });
    if (q) sentQuery = q.q;
    if (newTimes.length) sentTime = Math.max(...newTimes);
    sentSeconds = seconds;
    dead = 0;
    rage = 0;
    first = false;
  };
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', flush);
}

try { start(); } catch { /* a counter must never break a page */ }
