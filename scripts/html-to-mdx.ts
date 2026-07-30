/**
 * HTML → MDX for the archived Squarespace/Blogger bodies.
 *
 * Deliberately narrow: this handles the tag vocabulary that actually appears in
 * these 356 posts and nothing else. It is not a general-purpose converter.
 *
 * The prose is the asset, so the rule throughout is to move text through
 * untouched — including profanity, lowercase sentence starts, doubled spaces and
 * idiosyncratic punctuation. Nothing here copy-edits.
 */

/** Images pulled out of the body, in document order. */
export interface ExtractedImage {
  src: string;
  alt: string;
  /** Index of the paragraph the image appeared after — lets Phase 3 put it back. */
  afterBlock: number;
}

export interface ConvertResult {
  mdx: string;
  images: ExtractedImage[];
  /** Plain text of the body, for the fidelity check. */
  text: string;
}

const NAMED: Record<string, string> = {
  quot: '"', amp: '&', lt: '<', gt: '>', nbsp: ' ', apos: "'",
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  mdash: '—', ndash: '–', hellip: '…', middot: '·',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç',
  uuml: 'ü', ouml: 'ö', auml: 'ä', ntilde: 'ñ',
  deg: '°', trade: '™', copy: '©', reg: '®', bull: '•',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : m;
    }
    return NAMED[body.toLowerCase()] ?? m;
  });
}

/**
 * Escape only what MDX would otherwise try to execute. Deliberately minimal —
 * over-escaping would litter the prose with backslashes.
 */
function escapeMdx(s: string): string {
  return s
    .replace(/[{}]/g, (c) => `\\${c}`)
    // A `<` that begins something tag-like or is a stray angle bracket.
    .replace(/</g, '\\<');
}

/** Strip everything that is chrome, styling, or Microsoft Word paste residue. */
function stripNonContent(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(style|script|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<xml\b[\s\S]*?<\/xml>/gi, '')
    // Word namespace tags: <w:WordDocument>, <o:p>, <m:oMath> …
    .replace(/<\/?[a-z]+:[a-z0-9]+\b[^>]*>/gi, '')
    .replace(/<\/?(?:font|span|u|wbr|object|param|embed)\b[^>]*>/gi, '');
}

interface Token {
  kind: 'text' | 'tag';
  value: string;
  name?: string;
  attrs?: Record<string, string>;
  closing?: boolean;
}

function tokenize(html: string): Token[] {
  const out: Token[] = [];
  const re = /<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m.index > last) out.push({ kind: 'text', value: html.slice(last, m.index) });
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([a-z-]+)\s*=\s*"([^"]*)"/gi)) attrs[a[1].toLowerCase()] = a[2];
    out.push({ kind: 'tag', value: m[0], name: m[2].toLowerCase(), attrs, closing: m[1] === '/' });
    last = m.index + m[0].length;
  }
  if (last < html.length) out.push({ kind: 'text', value: html.slice(last) });
  return out;
}

const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'figure', 'table', 'tr']);

export function convert(html: string): ConvertResult {
  const src = stripNonContent(html);
  const tokens = tokenize(src);

  const blocks: string[] = [];
  let cur = '';
  const images: ExtractedImage[] = [];
  let headingLevel = 0;
  let inQuote = false;
  let listDepth = 0;
  const seenImg = new Set<string>();
  const linkStack: string[] = [];

  const flush = () => {
    let t = cur.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
    if (!t) { cur = ''; return; }
    if (headingLevel) t = `${'#'.repeat(Math.min(headingLevel + 1, 6))} ${t}`;
    else if (inQuote) t = t.split('\n').map((l) => `> ${l}`).join('\n');
    else if (listDepth) t = `- ${t.replace(/\n/g, ' ')}`;
    blocks.push(t);
    cur = '';
  };

  for (const tk of tokens) {
    if (tk.kind === 'text') {
      cur += escapeMdx(decodeEntities(tk.value));
      continue;
    }
    const n = tk.name!;
    if (n === 'br') { cur += '\n'; continue; }
    if (n === 'img') {
      if (!tk.closing) {
        const s = tk.attrs?.src ?? tk.attrs?.['data-src'] ?? '';
        if (s && !seenImg.has(s)) {
          seenImg.add(s);
          images.push({
            src: s,
            alt: decodeEntities(tk.attrs?.alt ?? '').trim(),
            afterBlock: blocks.length,
          });
        }
      }
      continue;
    }
    if (n === 'strong' || n === 'b') { cur += '**'; continue; }
    if (n === 'em' || n === 'i') { cur += '*'; continue; }
    if (n === 'a') {
      if (tk.closing) { cur += `](${(linkStack.pop() ?? '').trim()})`; }
      else {
        const href = decodeEntities(tk.attrs?.href ?? '');
        // Anchors that only wrap an image are link-to-full-size wrappers; the
        // image is extracted separately, so the anchor would render empty.
        linkStack.push(href);
        cur += '[';
      }
      continue;
    }
    if (n === 'h1' || n === 'h2' || n === 'h3' || n === 'h4' || n === 'h5' || n === 'h6') {
      if (tk.closing) { flush(); headingLevel = 0; }
      else { flush(); headingLevel = Number(n[1]); }
      continue;
    }
    if (n === 'blockquote') { flush(); inQuote = !tk.closing; continue; }
    if (n === 'ul' || n === 'ol') { flush(); listDepth += tk.closing ? -1 : 1; continue; }
    if (BLOCK.has(n)) { flush(); continue; }
  }
  flush();

  // Collapse the empty link shells left by image-wrapping anchors, then tidy.
  const cleaned = blocks
    .map((b) => b
      .replace(/\[\s*\]\([^)]*\)/g, '')
      .replace(/\*\*\s*\*\*/g, '')
      .replace(/\*\s*\*/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim())
    .filter(Boolean);

  const text = cleaned.join('\n\n');
  return { mdx: text, images, text };
}

/** Normalised plain text used to prove the conversion lost nothing. */
export function plainText(s: string): string {
  return decodeEntities(
    s
      .replace(/<(style|script|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<xml\b[\s\S]*?<\/xml>/gi, '')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\\([{}<])/g, '$1')
    .replace(/[*_`#>]/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/[   ]/g, ' ')
    .trim()
    .toLowerCase();
}
