import { parseHTML } from 'linkedom';

/**
 * Split a WordPress body into an ordered list of **section descriptors** —
 * plain objects describing what each part of the body is.
 *
 * Two sources, same output shape:
 *   htmlToSections()      reads the post's HTML
 *   elementorToSections() reads Elementor's own layout JSON (_elementor_data)
 *
 * Descriptors are deliberately dumb (no DOM nodes, no Strapi types) so they can
 * be tested directly and turned into components by lib/components.js.
 *
 * This runs on the RAW body, before the cleanup in lib/html.js: that cleanup
 * turns galleries and embeds into plain paragraphs, which is exactly the
 * structure we're trying to keep. Prose runs are handed to the normal
 * HTML → Markdown → Blocks pipeline afterwards.
 */

const clean = (value) => (value ?? '').replace(/\s+/g, ' ').trim();
const text = (el) => clean(el?.textContent);
const directChild = (el, selector) => [...(el?.children ?? [])].find((c) => c.matches?.(selector)) ?? null;

export function providerOf(url = '') {
  const host = (String(url).match(/^https?:\/\/([^/]+)/i) || [])[1] || '';
  if (/youtu/i.test(host)) return 'youtube';
  if (/vimeo/i.test(host)) return 'vimeo';
  if (/twitter|x\.com/i.test(host)) return 'twitter';
  if (/soundcloud/i.test(host)) return 'soundcloud';
  return host.replace(/^www\./, '');
}

function tableDescriptor(table) {
  const rows = [...table.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((cell) => text(cell)));
  const figure = table.closest?.('figure');
  return {
    kind: 'table',
    rows,
    hasHeader: Boolean(table.querySelector('thead th') || table.querySelector('tr th')),
    caption: text(figure && directChild(figure, 'figcaption')),
  };
}

function galleryDescriptor(el) {
  const images = [...el.querySelectorAll('img')].map((img) => {
    const figure = img.closest('figure');
    return {
      src: img.getAttribute('src') || '',
      alt: img.getAttribute('alt') || '',
      caption: figure && figure !== el ? text(directChild(figure, 'figcaption')) : '',
    };
  });
  return { kind: 'gallery', images, caption: text(directChild(el, 'figcaption')) };
}

function embedDescriptor(el) {
  const wrapper = el.querySelector('.wp-block-embed__wrapper');
  const iframe = el.querySelector('iframe');
  const media = el.querySelector('video, audio');
  const url =
    text(wrapper) ||
    iframe?.getAttribute('src') ||
    media?.getAttribute('src') ||
    media?.querySelector('source')?.getAttribute('src') ||
    '';
  // A figcaption where there is one, otherwise whatever the iframe called itself —
  // the same description the Blocks lane keeps, so neither lane loses more than the other.
  const title = text(directChild(el, 'figcaption')) || clean(iframe?.getAttribute('title'));
  return { kind: 'embed', url, provider: providerOf(url), title };
}

function codeDescriptor(pre) {
  const code = pre.querySelector('code');
  const className = code?.getAttribute('class') || '';
  const language = (className.match(/language-([a-z0-9+#-]+)/i) || [, ''])[1];
  return { kind: 'code', code: (code ?? pre).textContent.replace(/\n+$/, ''), language };
}

function quoteDescriptor(el) {
  const cite = el.querySelector('cite');
  const attribution = text(cite);
  if (cite) cite.remove();
  return { kind: 'quote', quote: text(el), attribution };
}

function imageDescriptor(el, img) {
  const caption = text(el.querySelector('figcaption, .wp-caption-text'));
  return {
    kind: 'image',
    src: img.getAttribute('src') || '',
    alt: img.getAttribute('alt') || '',
    caption: caption || img.getAttribute('title') || '',
  };
}

/** What is this top-level node? Returns a descriptor, or null for ordinary prose. */
function classify(el) {
  if (!el.matches) return null;

  const table = el.matches('table') ? el : el.querySelector('table');
  if (table) return tableDescriptor(table);

  const images = [...el.querySelectorAll('img')];
  if (el.matches('figure.wp-block-gallery, div.gallery, .tiled-gallery') || images.length > 1) {
    if (images.length) return galleryDescriptor(el);
  }

  if (el.matches('figure.wp-block-embed, div.wp-block-embed, figure.wp-block-video, figure.wp-block-audio') || el.querySelector('iframe')) {
    return embedDescriptor(el);
  }

  const pre = el.matches('pre') ? el : el.querySelector('pre');
  if (pre) return codeDescriptor(pre);

  if (el.matches('blockquote, figure.wp-block-pullquote')) return quoteDescriptor(el);

  if (images.length === 1) {
    const caption = text(el.querySelector('figcaption, .wp-caption-text'));
    const body = text(el).replace(caption, '').trim();
    if (!body) return imageDescriptor(el, images[0]);
  }

  if (el.matches('.wp-block-buttons')) {
    const link = el.querySelector('a');
    if (link) return { kind: 'cta', heading: '', text: '', label: text(link), url: link.getAttribute('href') || '' };
  }

  return null;
}

/**
 * @param {string} html  a post body, as WordPress stores/renders it
 * @returns {{ sections: object[], warnings: object[] }}
 */
export function htmlToSections(html) {
  const { document } = parseHTML(`<!doctype html><html><body>${html ?? ''}</body></html>`);
  const sections = [];
  const warnings = [];
  let prose = [];

  const flush = () => {
    const markup = prose.join('').trim();
    if (markup) sections.push({ kind: 'rich-text', html: markup });
    prose = [];
  };

  for (const node of [...document.body.childNodes]) {
    if (node.nodeType === 3) {
      if (node.textContent.trim()) prose.push(`<p>${node.textContent.trim()}</p>`);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const descriptor = classify(node);
    if (descriptor) {
      flush();
      sections.push(descriptor);
    } else {
      prose.push(node.outerHTML);
    }
  }
  flush();
  return { sections, warnings };
}

// --- Elementor ---------------------------------------------------------------

const stripTags = (html = '') => clean(String(html).replace(/<[^>]+>/g, ' '));

// Themes ship their own widgets (neuros_heading, av_textblock, …) with their own
// setting names, so the fallback reads any setting that looks like prose rather
// than a fixed list. Presentation settings are skipped by name.
// Only keys that name a video. `link` is not one: a button carries link.url,
// and treating that as an embed turned every call-to-action into a video.
const VIDEO_KEYS = ['youtube_url', 'vimeo_url', 'dailymotion_url', 'video_url', 'hosted_url'];

const TEXTY_KEY = /(title|heading|subtitle|text|editor|description|content|caption|excerpt|quote|label|summary)/i;
const NON_TEXT_KEY =
  /(color|colour|size|width|height|align|url|link|_id\b|class|type|status|style|margin|padding|icon|image|background|animation|order|position|speed|delay|tag|target|effect|typography|font|weight|spacing|transform|decoration|shadow|border|radius|offset|opacity|zoom|gap|column|row)/i;

// Elementor stores enum settings as bare words. They match no prose test, and a
// theme that names one `title_typography_typography` used to end up with
// "custom" appended to its heading.
const ENUM_VALUE = /^(custom|classic|default|none|yes|no|left|right|center|justify|top|bottom|middle|solid|dashed|dotted|square|circle|rounded|inherit|initial|auto|on|off|true|false|gradient|slide|fade)$/i;

const widgetText = (settings) => {
  const parts = [];
  for (const [key, value] of Object.entries(settings ?? {})) {
    if (typeof value !== 'string' || !value.trim()) continue;
    if (NON_TEXT_KEY.test(key) || !TEXTY_KEY.test(key)) continue;
    if (ENUM_VALUE.test(value.trim())) continue;
    parts.push(/<[a-z][\s\S]*>/i.test(value) ? value : `<p>${value}</p>`);
  }
  return parts.join('\n');
};

/** Every widget inside a top-level Elementor node, in document order. */
function widgetsOf(node, out = []) {
  if (node?.elType === 'widget') out.push(node);
  for (const child of node?.elements ?? []) widgetsOf(child, out);
  return out;
}

function widgetDescriptor(widget, warn) {
  const s = widget.settings ?? {};
  const media = s.image ?? s.background_image ?? null;
  switch (widget.widgetType) {
    case 'heading':
      return { kind: 'rich-text', html: `<h2>${s.title ?? ''}</h2>` };
    case 'text-editor':
      return { kind: 'rich-text', html: s.editor ?? '' };
    case 'image':
      return { kind: 'image', src: media?.url ?? '', mediaId: media?.id, alt: s.caption ?? '', caption: s.caption ?? '' };
    case 'icon-box':
    case 'image-box':
      return {
        kind: 'feature',
        title: s.title_text ?? '',
        text: s.description_text ?? '',
        icon: s.selected_icon?.value ?? '',
        src: media?.url ?? '',
        mediaId: media?.id,
        url: s.link?.url ?? '',
      };
    case 'button':
      return { kind: 'cta', heading: '', text: '', label: s.text ?? '', url: s.link?.url ?? '' };
    case 'testimonial':
      return {
        kind: 'quote',
        quote: stripTags(s.testimonial_content ?? ''),
        attribution: [s.testimonial_name, s.testimonial_job].filter(Boolean).join(', '),
      };
    case 'google_maps': {
      const address = String(s.address ?? '').trim();
      if (!address) break;
      return {
        kind: 'embed',
        url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
        provider: 'google-maps',
        title: address,
      };
    }
    case 'video':
      return {
        kind: 'embed',
        url: s.youtube_url ?? s.vimeo_url ?? s.hosted_url?.url ?? '',
        provider: s.video_type ?? '',
        title: '',
      };
    default: {
      // Themes ship their own video and map widgets (Neuros has
      // neuros_video_button on 23 pages). Match on what the settings hold
      // rather than on the widget's name, which is theme-specific.
      const videoUrl = VIDEO_KEYS.map((k) => (typeof s[k] === 'string' ? s[k] : s[k]?.url)).find(
        (v) => typeof v === 'string' && /^https?:\/\//.test(v)
      );
      if (videoUrl) {
        return { kind: 'embed', url: videoUrl, provider: providerOf(videoUrl), title: s.button_text ?? s.video_button_text ?? '' };
      }

      const html = widgetText(s);
      if (html) return { kind: 'rich-text', html };
      warn('elementor-widget-skipped', `${widget.widgetType} (no text content)`);
      return null;
    }
  }
}

/** Merge neighbouring prose so one section doesn't become a pile of scraps. */
function mergeProse(descriptors) {
  return descriptors.reduce((out, d) => {
    const prev = out[out.length - 1];
    if (d.kind === 'rich-text' && prev?.kind === 'rich-text') prev.html += `\n${d.html}`;
    else out.push({ ...d });
    return out;
  }, []);
}

/**
 * @param {Array|string} data  parsed _elementor_data, or the raw JSON string
 * @returns {{ sections: object[], warnings: object[] }}
 */
export function elementorToSections(data) {
  const warnings = [];
  const warn = (code, detail) => warnings.push({ code, detail: String(detail).slice(0, 200) });

  let tree = data;
  if (typeof tree === 'string') {
    try {
      tree = JSON.parse(tree);
    } catch {
      warn('elementor-unreadable', 'could not parse _elementor_data');
      return { sections: [], warnings };
    }
  }
  if (!Array.isArray(tree)) return { sections: [], warnings };

  const sections = [];
  for (const [index, top] of tree.entries()) {
    const descriptors = mergeProse(widgetsOf(top).map((w) => widgetDescriptor(w, warn)).filter(Boolean));
    const heading = descriptors.find((d) => d.kind === 'rich-text');
    const image = descriptors.find((d) => d.kind === 'image');
    const cta = descriptors.find((d) => d.kind === 'cta');

    // A first section that leads with words plus a picture or a button is a hero.
    if (index === 0 && heading && (image || cta)) {
      const headline = (heading.html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i) || [, ''])[1];
      const headingText = stripTags(headline) || stripTags(heading.html);
      const rest = stripTags(heading.html.replace(/<h[1-6][\s\S]*?<\/h[1-6]>/i, ''));
      // Strapi caps a `string` field at 255 characters; anything longer belongs
      // in the subheading rather than failing the whole entry.
      sections.push({
        kind: 'hero',
        heading: headingText.slice(0, 255),
        subheading: [headingText.length > 255 ? headingText.slice(255) : '', rest].filter(Boolean).join(' ').trim(),
        src: image?.src ?? '',
        mediaId: image?.mediaId,
        label: cta?.label ?? '',
        url: cta?.url ?? '',
      });
      sections.push(...descriptors.filter((d) => d !== heading && d !== image && d !== cta));
      continue;
    }
    sections.push(...descriptors);
  }
  return { sections, warnings };
}

/** Elementor's own data when the entry has it, otherwise the rendered HTML. */
export function sectionsForEntry(entry, options = {}) {
  const data = entry?.migration_meta?._elementor_data;
  if (data) {
    const { sections, warnings } = elementorToSections(data);
    if (sections.length) return { sections, warnings, source: 'elementor' };
  }
  const html = entry?.content?.rendered ?? entry?.content ?? '';
  const { sections, warnings } = htmlToSections(String(html), options);
  return { sections, warnings, source: 'html' };
}
