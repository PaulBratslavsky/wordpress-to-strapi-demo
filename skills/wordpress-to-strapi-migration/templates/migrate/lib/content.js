import { parseWordPressHtml, toMarkdown } from './html.js';
import { markdownToBlocks } from './blocks.js';

/**
 * WordPress HTML → Strapi rich text. Same order as the original script
 * (HTML → Markdown → Blocks), with the WordPress-specific work up front:
 *
 *   1. clean the HTML            (captions, galleries, embeds, lazy images, shortcodes)
 *   2. upload referenced media   and point <img>/<a> at the Strapi copies
 *   3. rewrite internal links    to their new paths
 *   4. Turndown → Markdown       — the value for a `richtext` field
 *   5. Markdown → Blocks         — the value for a `blocks` field
 *
 * Returns `{ value, warnings }`; `value` is null when there's no content.
 */
export async function convertContent(html, { format = 'blocks', media, links, shortcodes = 'strip' }) {
  const warnings = [];
  const warn = (code, detail = '') => warnings.push({ code, detail: String(detail).slice(0, 200) });

  const { body, warnings: cleanup } = parseWordPressHtml(html, { shortcodes });
  warnings.push(...cleanup);

  // Images: upload (once per attachment) and swap the src for the Strapi URL.
  const filesByUrl = new Map();
  for (const img of body.querySelectorAll('img')) {
    const src = img.getAttribute('src');
    if (!src || src.startsWith('data:')) {
      img.remove();
      continue;
    }
    let file = null;
    try {
      file = await media.ensureByUrl(src);
    } catch (err) {
      warn('image-failed', `${src}: ${err.message}`);
    }
    if (!file) {
      warn('image-missing', src);
      continue;
    }
    const url = format === 'markdown' ? media.publicUrl(file) : file.url;
    img.setAttribute('src', url);
    if (!img.getAttribute('alt') && file.alternativeText) img.setAttribute('alt', file.alternativeText);
    filesByUrl.set(url, file);
  }

  // Links: files in wp-content/uploads become Strapi media; other internal links get their new path.
  for (const a of body.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!links.isInternal(href)) continue;
    if (/\/wp-content\/uploads\//.test(href)) {
      const file = await media.ensureByUrl(href).catch(() => null);
      if (file) a.setAttribute('href', media.publicUrl(file));
      else warn('file-link-missing', href);
    } else {
      a.setAttribute('href', links.rewrite(href));
    }
  }

  const markdown = toMarkdown(body);
  if (format === 'markdown') {
    if (!markdown && String(html).trim()) warn('content-emptied', `${String(html).trim().length} characters of markup produced no text`);
    return { value: markdown || null, warnings };
  }

  const blocks = markdownToBlocks(markdown, { resolveImage: (u) => filesByUrl.get(u), warn });
  if (!blocks.length && String(html).trim()) {
    warn('content-emptied', `${String(html).trim().length} characters of markup produced no blocks`);
  }
  return { value: blocks.length ? blocks : null, warnings };
}
