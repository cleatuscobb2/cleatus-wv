/**
 * The prose editor's safety net (ADMIN-PLAN.md §4, `/admin/entry`).
 *
 * MDX is more than Markdown: `{…}` runs JavaScript when the site builds, and the
 * build can see the site's secrets. A stray `<` or `{` also fails the build —
 * and one broken entry stops every deploy, not just its own page. So an edited
 * body is parsed with the same parser the build uses, and only what the 295
 * entries actually use is allowed: Markdown, plus three components with plain
 * text attributes. No expressions, no imports, no raw HTML.
 *
 * The editor never shows the `import` line; it is written back automatically
 * for whichever components the body uses.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import remarkSmartypants from 'remark-smartypants';
import { toHast, type State } from 'mdast-util-to-hast';
import { toHtml } from 'hast-util-to-html';
import type { Root, RootContent } from 'mdast';
import type { Element, ElementContent } from 'hast';

interface Attr {
  required?: boolean;
  oneOf?: string[];
  /** Must be a path under /photos/. */
  photo?: boolean;
}
interface Spec {
  importLine: string;
  attrs: Record<string, Attr>;
  children: boolean;
}

/** Order here is the order import lines are written in. */
export const COMPONENTS: Record<string, Spec> = {
  Photo: {
    importLine: "import Photo from '../../../components/Photo.astro';",
    attrs: { src: { required: true, photo: true }, alt: {}, caption: {}, size: { oneOf: ['text', 'wide', 'full'] } },
    children: false,
  },
  PullQuote: {
    importLine: "import PullQuote from '../../../components/PullQuote.astro';",
    attrs: { attribution: {} },
    children: true,
  },
  Aside: {
    importLine: "import Aside from '../../../components/Aside.astro';",
    attrs: { term: { required: true } },
    children: true,
  },
};

export interface Problem {
  line: number | null;
  message: string;
}

const processor = unified().use(remarkParse).use(remarkMdx).use(remarkGfm);
/**
 * Relative links are fine; anything with a scheme must be http(s) or mailto.
 * Whitespace and control characters are dropped first because browsers ignore
 * them inside a scheme — `java\tscript:` still runs.
 */
function safeUrl(url: string): boolean {
  const u = url.replace(/[\u0000- \u007f]/g, '');
  const scheme = u.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  return !scheme || scheme === 'http' || scheme === 'https' || scheme === 'mailto';
}
const PHOTO = /^\/photos\/[^\s"'<>\\]+$/;

type AnyNode = RootContent & {
  name?: string | null;
  attributes?: { type: string; name?: string; value?: unknown }[];
  children?: AnyNode[];
  url?: string;
  position?: { start: { line: number } };
};

/** Parse and check a body. `tree` is present only when there are no problems. */
export function checkBody(body: string): { problems: Problem[]; tree?: Root; components: string[] } {
  let tree: Root;
  try {
    tree = processor.parse(body) as Root;
  } catch (err) {
    const e = err as { line?: number; reason?: string; message: string };
    return { problems: [{ line: e.line ?? null, message: friendly(e.reason ?? e.message) }], components: [] };
  }

  const problems: Problem[] = [];
  const used = new Set<string>();
  const at = (n: AnyNode) => n.position?.start.line ?? null;

  const walk = (nodes: AnyNode[] | undefined) => {
    for (const n of nodes ?? []) {
      switch (n.type as string) {
        case 'mdxjsEsm':
          problems.push({ line: at(n), message: 'Lines starting with import or export aren\'t allowed — photos and quotes are imported automatically.' });
          break;
        case 'mdxFlowExpression':
        case 'mdxTextExpression':
          problems.push({ line: at(n), message: 'Curly braces { } run code when the site builds, so they aren\'t allowed. To show a brace as text, type \\{ or \\}.' });
          break;
        case 'mdxJsxFlowElement':
        case 'mdxJsxTextElement':
          checkElement(n, problems, used);
          break;
        case 'link':
        case 'image':
        case 'definition':
          if (n.url && !safeUrl(n.url)) problems.push({ line: at(n), message: `That link (${n.url.slice(0, 40)}) isn't a web address.` });
          break;
      }
      walk(n.children);
    }
  };
  walk(tree.children as AnyNode[]);

  const components = Object.keys(COMPONENTS).filter((c) => used.has(c));
  return problems.length ? { problems, components } : { problems, tree, components };
}

function checkElement(n: AnyNode, problems: Problem[], used: Set<string>) {
  const line = n.position?.start.line ?? null;
  const name = n.name ?? '';
  if (!name) return void problems.push({ line, message: 'Empty tags <> </> aren\'t allowed.' });
  if (/^[a-z]/.test(name)) {
    return void problems.push({ line, message: `HTML tags like <${name}> aren't allowed — use Markdown instead. To show a < as text, type \\<.` });
  }
  const spec = COMPONENTS[name];
  if (!spec) {
    return void problems.push({ line, message: `<${name}> isn't something this site knows. Allowed: ${Object.keys(COMPONENTS).map((c) => `<${c}>`).join(', ')}.` });
  }
  used.add(name);

  const seen = new Set<string>();
  for (const a of n.attributes ?? []) {
    if (a.type !== 'mdxJsxAttribute' || !a.name) {
      problems.push({ line, message: `<${name}> can't take {…} — only attributes like name="text".` });
      continue;
    }
    const rule = spec.attrs[a.name];
    if (!rule) { problems.push({ line, message: `<${name}> doesn't have a "${a.name}". It takes: ${Object.keys(spec.attrs).join(', ')}.` }); continue; }
    if (typeof a.value !== 'string') { problems.push({ line, message: `<${name}> ${a.name} needs a value in quotes, like ${a.name}="…".` }); continue; }
    if (rule.oneOf && !rule.oneOf.includes(a.value)) problems.push({ line, message: `<${name}> ${a.name} must be one of: ${rule.oneOf.join(', ')}.` });
    if (rule.photo && !PHOTO.test(a.value)) problems.push({ line, message: `<${name}> src must be a photo path starting /photos/.` });
    seen.add(a.name);
  }
  for (const [attr, rule] of Object.entries(spec.attrs)) {
    if (rule.required && !seen.has(attr)) problems.push({ line, message: `<${name}> needs ${attr}="…".` });
  }
  if (!spec.children && n.children?.length) problems.push({ line, message: `<${name} /> can't have anything inside it — close it with />.` });
}

/** Parser messages, made readable for someone who isn't a programmer. */
function friendly(reason: string): string {
  if (/Unexpected character .* before name|Unexpected lazy line|Unexpected end of file in name/i.test(reason)) {
    return `A < is being read as the start of a tag. To show a < as text, type \\<. (${reason})`;
  }
  if (/expression|acorn|Could not parse/i.test(reason)) {
    return `A { is being read as code. To show a brace as text, type \\{. (${reason})`;
  }
  if (/Expected a closing tag/i.test(reason)) return `A tag is opened but never closed. (${reason})`;
  return reason;
}

// ---- preview -------------------------------------------------------------

const attr = (n: AnyNode, key: string) => {
  const a = n.attributes?.find((x) => x.name === key);
  return typeof a?.value === 'string' ? a.value : undefined;
};

/** The same markup the site's components produce, so the preview looks like the page. */
function component(state: State, node: AnyNode): Element {
  const el = (tag: string, cls: string, children: ElementContent[], props: Record<string, string> = {}): Element =>
    ({ type: 'element', tagName: tag, properties: { className: cls ? cls.split(' ') : undefined, ...props }, children });
  const text = (value: string): ElementContent => ({ type: 'text', value });
  const kids = state.all(node as never) as ElementContent[];

  switch (node.name) {
    case 'Photo': {
      const caption = attr(node, 'caption');
      return el('figure', `photo photo--${attr(node, 'size') ?? 'wide'}`, [
        el('img', '', [], { src: attr(node, 'src') ?? '', alt: attr(node, 'alt') ?? '', loading: 'lazy' }),
        ...(caption ? [el('figcaption', '', [text(caption)])] : []),
      ]);
    }
    case 'PullQuote': {
      const by = attr(node, 'attribution');
      return el('blockquote', 'pull', [el('p', 'pull__text', kids), ...(by ? [el('cite', 'pull__cite', [text(by)])] : [])]);
    }
    case 'Aside':
      return el('aside', 'note', [el('p', 'note__term', [text(attr(node, 'term') ?? '')]), el('div', 'note__body', kids)]);
    default:
      return el('span', '', []);
  }
}

/** Render a checked body to HTML for the preview pane. Only call with a tree from checkBody. */
export function renderPreview(tree: Root): string {
  const t = unified().use(remarkSmartypants).runSync(structuredClone(tree)) as Root;
  const hast = toHast(t, {
    handlers: { mdxJsxFlowElement: component as never, mdxJsxTextElement: component as never },
  });
  return toHtml(hast);
}

// ---- splitting the file ---------------------------------------------------

/**
 * Frontmatter (through its closing `---\n`), the body without its import lines,
 * and which allowed components those import lines brought in.
 */
export function splitEntry(text: string): { head: string; body: string; imported: string[] } {
  const close = text.indexOf('\n---\n', 3);
  if (!text.startsWith('---') || close < 0) throw new Error('no frontmatter');
  const head = text.slice(0, close + 5);
  let rest = text.slice(close + 5).replace(/^\n/, '');
  // The import block, then the one blank line after it.
  const block = rest.match(/^(?:import [^\n]*\n)+\n?/);
  if (block) rest = rest.slice(block[0].length);
  const imported = Object.keys(COMPONENTS).filter((c) => block?.[0].includes(COMPONENTS[c].importLine));
  return { head, body: rest, imported };
}

/**
 * Put a file back together, importing every component the body uses plus any
 * the file already imported (harmless if unused, and an unchanged save then
 * reproduces the file byte for byte).
 */
export function joinEntry(head: string, body: string, components: string[]): string {
  const imports = Object.keys(COMPONENTS).filter((c) => components.includes(c)).map((c) => COMPONENTS[c].importLine);
  const clean = `${body.replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`;
  return `${head}\n${imports.length ? `${imports.join('\n')}\n\n` : ''}${clean}`;
}
