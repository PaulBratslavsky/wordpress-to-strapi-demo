import { marked } from 'marked';
import { htmlToText } from './util.js';

/**
 * Markdown → Strapi **Blocks** (the native rich-text editor format).
 *
 * The original migration script did this with a marked *renderer* plus regexes
 * for bold/italic/links, which broke on nested formatting ("**bold _and_
 * italic**"), underscores in URLs, and left images as literal "![...](...)"
 * text. This walks marked's *token tree* instead, so nesting comes for free.
 *
 * Strapi's blocks validator (@strapi/core entity-validator/blocks-validator)
 * accepts exactly these nodes, which is what this emits:
 *   block:  paragraph · heading(level 1-6) · list(format, children: list-item | list)
 *           · quote · code(language) · image(image: full media record)
 *   inline: text(bold/italic/underline/strikethrough/code) · link(url, text children)
 *
 * Anything without a Blocks equivalent is converted to the closest thing and
 * reported through `warn`: horizontal rules are dropped, tables become one
 * paragraph per row, raw HTML becomes its text.
 */

const MARKS = ['bold', 'italic', 'underline', 'strikethrough', 'code'];
const TAG_MARK = { strong: 'bold', em: 'italic', del: 'strikethrough' };
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'mailto:', 'tel:']);

/** Same rule as Strapi's validator: absolute http(s)/ftp/mailto/tel, or a root-relative path. */
export function isValidBlocksLink(url) {
  if (!url) return false;
  try {
    const u = new URL(url.startsWith('/') ? `https://example.test${url}` : url);
    return LINK_PROTOCOLS.has(u.protocol);
  } catch {
    return false;
  }
}

const emptyText = () => ({ type: 'text', text: '' });
const nonEmpty = (children) => (children.length ? children : [emptyText()]);
const sameMarks = (a, b) => MARKS.every((k) => Boolean(a[k]) === Boolean(b[k]));

function mergeText(nodes) {
  const out = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.type === 'text' && prev?.type === 'text' && sameMarks(prev, n)) prev.text += n.text;
    else out.push(n.type === 'text' ? { ...n } : n);
  }
  return out;
}

/** Trim whitespace at the edges of a paragraph (left behind by <br> next to an image). */
function trimEdges(nodes) {
  const out = nodes.filter((n) => n.type !== 'text' || n.text !== '');
  const first = out[0];
  const last = out[out.length - 1];
  if (first?.type === 'text') first.text = first.text.replace(/^\s+/, '');
  if (last?.type === 'text') last.text = last.text.replace(/\s+$/, '');
  return out.filter((n) => n.type !== 'text' || n.text !== '');
}

/** Inline tokens → Strapi inline nodes. `marks` accumulates as we descend. */
function inline(tokens = [], marks, ctx) {
  const out = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'text':
      case 'escape':
        if (t.tokens?.length) out.push(...inline(t.tokens, marks, ctx));
        else out.push({ type: 'text', text: t.text, ...marks });
        break;
      case 'strong':
      case 'em':
      case 'del':
        out.push(...inline(t.tokens, { ...marks, [TAG_MARK[t.type]]: true }, ctx));
        break;
      case 'codespan':
        out.push({ type: 'text', text: t.text, ...marks, code: true });
        break;
      case 'br':
        out.push({ type: 'text', text: '\n', ...marks });
        break;
      case 'link': {
        // A link's children may only be text nodes.
        const children = inline(t.tokens, marks, ctx).flatMap((n) => (n.type === 'text' ? [n] : n.children ?? []));
        if (isValidBlocksLink(t.href)) {
          out.push({ type: 'link', url: t.href, children: children.length ? children : [{ type: 'text', text: t.href }] });
        } else {
          out.push(...children);
          if (t.href && !t.href.startsWith('#')) ctx.warn('link-dropped', t.href);
        }
        break;
      }
      case 'image': // images are lifted to image blocks by paragraphs(); inside lists/quotes keep the alt text
        if (t.text) out.push({ type: 'text', text: t.text, ...marks });
        break;
      case 'html': {
        const tag = t.text.trim().toLowerCase();
        if (tag === '<u>') marks = { ...marks, underline: true };
        else if (tag === '</u>') marks = Object.fromEntries(Object.entries(marks).filter(([k]) => k !== 'underline'));
        else {
          const value = htmlToText(t.text);
          if (value) out.push({ type: 'text', text: value, ...marks });
        }
        break;
      }
      default:
        if (t.tokens) out.push(...inline(t.tokens, marks, ctx));
        else if (t.text) out.push({ type: 'text', text: t.text, ...marks });
    }
  }
  return mergeText(out);
}

function imageBlock(token, ctx) {
  const file = ctx.resolveImage(token.href);
  // An image node needs a real, sized media record (the validator requires width/height, hash, ...).
  if (!file || !file.width || !file.height) {
    ctx.warn('image-not-embedded', token.href);
    const label = token.text || token.href;
    return {
      type: 'paragraph',
      children: [isValidBlocksLink(token.href) ? { type: 'link', url: token.href, children: [{ type: 'text', text: label }] } : { type: 'text', text: label }],
    };
  }
  return {
    type: 'image',
    image: {
      ...file,
      alternativeText: token.text || file.alternativeText || null,
      caption: token.title || file.caption || null,
    },
    children: [emptyText()],
  };
}

/** A paragraph's inline tokens, split so every image becomes its own image block. */
function paragraphs(tokens, ctx) {
  const out = [];
  let run = [];
  const flush = () => {
    const children = trimEdges(inline(run, {}, ctx));
    if (children.length) out.push({ type: 'paragraph', children });
    run = [];
  };
  for (const t of tokens) {
    const img =
      t.type === 'image' ? t : t.type === 'link' && t.tokens?.length === 1 && t.tokens[0].type === 'image' ? t.tokens[0] : null;
    if (img) {
      flush();
      out.push(imageBlock(img, ctx));
    } else {
      run.push(t);
    }
  }
  flush();
  return out;
}

function list(token, ctx, depth) {
  const children = [];
  for (const item of token.items) {
    const inlineTokens = [];
    const nested = [];
    for (const c of item.tokens) {
      if (c.type === 'list') nested.push(c);
      else if (c.type === 'space') continue;
      else if (c.type === 'text' || c.type === 'paragraph') {
        if (inlineTokens.length) inlineTokens.push({ type: 'br' });
        inlineTokens.push(...(c.tokens ?? [{ type: 'text', text: c.text }]));
      } else {
        if (inlineTokens.length) inlineTokens.push({ type: 'br' });
        inlineTokens.push({ type: 'text', text: c.text ?? c.raw ?? '' });
        ctx.warn('list-item-flattened', c.type);
      }
    }
    children.push({ type: 'list-item', children: nonEmpty(trimEdges(inline(inlineTokens, {}, ctx))) });
    for (const n of nested) children.push(list(n, ctx, depth + 1));
  }
  return { type: 'list', format: token.ordered ? 'ordered' : 'unordered', indentLevel: depth, children };
}

function quote(tokens, ctx) {
  const parts = [];
  for (const t of tokens) {
    if (t.type === 'space') continue;
    const nodes = t.tokens ? inline(t.tokens, {}, ctx) : [{ type: 'text', text: t.text ?? t.raw ?? '' }];
    if (parts.length) parts.push({ type: 'text', text: '\n' });
    parts.push(...nodes);
  }
  return { type: 'quote', children: nonEmpty(trimEdges(mergeText(parts))) };
}

function table(token, ctx) {
  ctx.warn('table-flattened', `${token.rows.length} rows → paragraphs (use the Markdown format to keep tables)`);
  const row = (cells, bold) => ({
    type: 'paragraph',
    children: nonEmpty(
      mergeText(cells.flatMap((c, i) => [...(i ? [{ type: 'text', text: ' | ' }] : []), ...inline(c.tokens, bold ? { bold: true } : {}, ctx)]))
    ),
  });
  return [row(token.header, true), ...token.rows.map((r) => row(r, false))];
}

function blocksFrom(tokens, ctx) {
  const out = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'space':
      case 'def':
        break;
      case 'heading':
        out.push({ type: 'heading', level: Math.min(Math.max(t.depth, 1), 6), children: nonEmpty(trimEdges(inline(t.tokens, {}, ctx))) });
        break;
      case 'paragraph':
        out.push(...paragraphs(t.tokens, ctx));
        break;
      case 'text':
        out.push(...paragraphs(t.tokens ?? [{ type: 'text', text: t.text }], ctx));
        break;
      case 'list':
        out.push(list(t, ctx, 0));
        break;
      case 'blockquote':
        out.push(quote(t.tokens, ctx));
        break;
      case 'code':
        out.push({ type: 'code', language: t.lang || 'plaintext', children: [{ type: 'text', text: t.text }] });
        break;
      case 'table':
        out.push(...table(t, ctx));
        break;
      case 'hr':
        break; // no divider node in Blocks
      case 'html': {
        const value = htmlToText(t.text);
        if (value) out.push({ type: 'paragraph', children: [{ type: 'text', text: value }] });
        ctx.warn('raw-html', t.text.trim().slice(0, 80));
        break;
      }
      default:
        if (t.tokens) out.push(...blocksFrom(t.tokens, ctx));
    }
  }
  return out;
}

/**
 * @param {string} markdown
 * @param {object} options
 * @param {(url: string) => object | undefined} options.resolveImage  Strapi media record for an image URL.
 * @param {(code: string, detail?: string) => void} [options.warn]
 * @returns {Array} Strapi Blocks value (possibly empty).
 */
export function markdownToBlocks(markdown, { resolveImage = () => undefined, warn = () => {} } = {}) {
  const tokens = marked.lexer(markdown ?? '', { gfm: true });
  return blocksFrom(tokens, { resolveImage, warn });
}
