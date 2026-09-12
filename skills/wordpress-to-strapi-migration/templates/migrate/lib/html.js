import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import turndownGfm from '@joplin/turndown-plugin-gfm';

/**
 * WordPress HTML → Markdown.
 *
 * `content.rendered` from the REST API is the final HTML a theme would print:
 * blocks are rendered, shortcodes expanded (when their plugin is active), and
 * the markup is full of WordPress-isms that a generic HTML → Markdown converter
 * mangles. So before Turndown runs, `parseWordPressHtml` normalises them:
 *
 *   - lazy-loaded images (real URL in data-src / data-lazy-src)
 *   - captioned images (block <figure>, classic [caption] → .wp-caption)
 *   - galleries → one captioned image per item
 *   - embeds / iframes / <video> → a plain link (neither Markdown nor Blocks can embed)
 *   - linked images (<a href="full.jpg"><img></a>) → just the image
 *   - <pre> without <code>, shortcodes that never rendered
 *
 * Every lossy step records a warning so the migration report shows exactly
 * which entries need a human look.
 */

const { gfm } = turndownGfm;

const KNOWN_SHORTCODES = new Set(['caption', 'wp_caption', 'gallery', 'embed', 'audio', 'video', 'playlist']);
const BUILDER_SHORTCODE =
  /^(vc_|et_pb_|fusion_|av_|mk_|cs_|ux_|tatsu|rev_slider|layerslider|contact-form|wpforms|gravityform|mc4wp|elementor)/;
const SHORTCODE = /\[(\/)?([a-z][a-z0-9_-]*)((?:\s[^\]]*)?)\]/gi;

const PAGE_BUILDERS = [
  ['Elementor', /class="[^"]*\belementor/i],
  ['WPBakery', /\[vc_row|class="[^"]*\b(vc_row|wpb_)/i],
  ['Divi', /\[et_pb_|class="[^"]*\bet_pb_/i],
  ['Beaver Builder', /class="[^"]*\bfl-(builder|row)/i],
  ['Avada', /\[fusion_|class="[^"]*\bfusion-/i],
];

/** Name of the page builder that produced this HTML, or null. Cheap regex check (used by analyze too). */
export function detectPageBuilder(html = '') {
  return PAGE_BUILDERS.find(([, re]) => re.test(html))?.[0] ?? null;
}

export function parseWordPressHtml(html, { shortcodes = 'strip' } = {}) {
  const { document } = parseHTML(`<!doctype html><html><head></head><body>${html ?? ''}</body></html>`);
  const body = document.body;
  const warnings = [];
  const warn = (code, detail = '') => warnings.push({ code, detail: String(detail).slice(0, 200) });
  const $$ = (sel, root = body) => [...root.querySelectorAll(sel)];

  const builder = detectPageBuilder(html);
  if (builder) warn('page-builder', `${builder} markup — layout is flattened to rich text`);

  $$('script, style, noscript, link, meta, template').forEach((n) => n.remove());

  // Lazy-loaded images keep the real URL in a data-* attribute.
  for (const img of $$('img')) {
    const lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original');
    const src = img.getAttribute('src');
    if (lazy && (!src || src.startsWith('data:'))) img.setAttribute('src', lazy);
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
  }

  // Embeds (YouTube, Vimeo, X ...) and raw iframes / media players → a link to the source.
  for (const fig of $$('figure.wp-block-embed, div.wp-block-embed')) {
    const url =
      fig.querySelector('.wp-block-embed__wrapper')?.textContent.trim() ||
      fig.querySelector('iframe')?.getAttribute('src') ||
      '';
    fig.replaceWith(linkParagraph(document, url));
    warn('embed', url);
  }
  for (const node of $$('iframe, video, audio, object, embed')) {
    const url = node.getAttribute('src') || node.getAttribute('data') || node.querySelector('source')?.getAttribute('src') || '';
    node.replaceWith(linkParagraph(document, url));
    warn(node.localName === 'iframe' ? 'iframe' : 'media-player', url);
  }

  // Galleries → a captioned image per item (neither Markdown nor Blocks has a gallery).
  for (const g of $$('figure.wp-block-gallery, div.gallery, div.tiled-gallery')) {
    const imgs = $$('img', g);
    for (const img of imgs) {
      const fig = img.closest('figure');
      const cap =
        (fig && fig !== g ? fig.querySelector('figcaption')?.textContent : '') ||
        img.closest('.gallery-item')?.querySelector('.gallery-caption')?.textContent ||
        '';
      if (cap.trim()) img.setAttribute('title', cap.trim());
      g.parentNode.insertBefore(wrap(document, 'p', img), g);
    }
    const galleryCaption = g.querySelector(':scope > figcaption')?.textContent.trim();
    if (galleryCaption) g.parentNode.insertBefore(wrap(document, 'p', text(document, 'em', galleryCaption)), g);
    g.remove();
    warn('gallery', `${imgs.length} images`);
  }

  // Captioned images: block editor <figure>/<figcaption>, classic editor .wp-caption.
  // The caption travels as the image title → ![alt](src "caption").
  for (const fig of $$('figure, div.wp-caption')) {
    const img = fig.querySelector('img');
    if (!img) continue; // tables, quotes, etc. keep their figure
    const caption = fig.querySelector('figcaption, .wp-caption-text')?.textContent.trim();
    if (caption) img.setAttribute('title', caption);
    const link = img.closest('a');
    fig.replaceWith(wrap(document, 'p', link && fig.contains(link) ? link : img));
  }

  // Linked images: unwrap when the link just opens the image itself.
  for (const a of $$('a')) {
    const imgs = $$('img', a);
    const href = a.getAttribute('href') || '';
    if (imgs.length === 1 && !a.textContent.trim() && (/\.(jpe?g|png|gif|webp|avif|svg)(\?|$)/i.test(href) || /attachment/.test(href))) {
      a.replaceWith(imgs[0]);
    }
  }

  // Turndown only fences <pre><code>; plain <pre> would lose its whitespace.
  for (const pre of $$('pre')) {
    if (pre.querySelector('code')) continue;
    const code = document.createElement('code');
    code.textContent = pre.textContent;
    pre.textContent = '';
    pre.appendChild(code);
  }

  const tables = $$('table').length;
  if (tables) warn('table', `${tables} table(s)`);

  handleShortcodes(body, { mode: shortcodes, warn });

  return { document, body, warnings };
}

let turndown;
function createTurndown() {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
    strongDelimiter: '**',
  });
  td.use(gfm); // tables + strikethrough
  td.keep(['u']); // Markdown has no underline; keep the tag so Blocks can set the flag
  td.remove(['form', 'button', 'input', 'select', 'textarea', 'svg']);
  td.addRule('summary', {
    filter: 'summary',
    replacement: (content) => `\n\n**${content.trim()}**\n\n`,
  });
  return td;
}

/** Cleaned WordPress DOM (from parseWordPressHtml) → Markdown. */
export function toMarkdown(body) {
  turndown ??= createTurndown();
  return turndown
    .turndown(body.innerHTML)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// --- helpers -----------------------------------------------------------------

function wrap(document, tag, child) {
  const el = document.createElement(tag);
  el.appendChild(child);
  return el;
}

function text(document, tag, value) {
  const el = document.createElement(tag);
  el.textContent = value;
  return el;
}

function linkParagraph(document, url) {
  if (!url) return document.createTextNode('');
  const a = document.createElement('a');
  a.setAttribute('href', url);
  a.textContent = url;
  return wrap(document, 'p', a);
}

function textNodes(node, out = []) {
  for (const c of node.childNodes) {
    if (c.nodeType === 3) out.push(c);
    else if (c.nodeType === 1 && !['PRE', 'CODE'].includes(c.nodeName.toUpperCase())) textNodes(c, out);
  }
  return out;
}

/**
 * Shortcodes that reach the REST output unrendered (their plugin is gone, or
 * they sit in a page builder's fallback HTML). Known/builder shortcodes are
 * stripped (inner text kept) or kept, per `mode`. Bracketed text that merely
 * looks like one ("[Updated]") is left alone and reported.
 */
function handleShortcodes(body, { mode, warn }) {
  const html = body.innerHTML;
  const closers = new Set([...html.matchAll(/\[\/([a-z][a-z0-9_-]*)\]/gi)].map((m) => m[1].toLowerCase()));
  const found = new Map();
  const possible = new Set();
  for (const node of textNodes(body)) {
    if (!node.nodeValue.includes('[')) continue;
    node.nodeValue = node.nodeValue.replace(SHORTCODE, (m, _slash, name, attrs) => {
      const n = name.toLowerCase();
      const isShortcode = KNOWN_SHORTCODES.has(n) || BUILDER_SHORTCODE.test(n) || closers.has(n) || attrs.includes('=');
      if (!isShortcode) {
        possible.add(m);
        return m;
      }
      found.set(n, (found.get(n) || 0) + 1);
      return mode === 'keep' ? m : '';
    });
  }
  if (found.size) {
    warn(
      'shortcode',
      `${mode === 'keep' ? 'kept' : 'stripped'}: ${[...found].map(([n, c]) => `[${n}]×${c}`).join(', ')}`
    );
  }
  if (possible.size) warn('possible-shortcode', [...possible].slice(0, 5).join(' '));
}
