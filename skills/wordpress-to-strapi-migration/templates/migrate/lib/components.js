/**
 * The `sections` component catalogue.
 *
 * One entry per component: the Strapi schema `generate.js` writes, and the
 * descriptor kinds it can hold. `sectionsToZone()` turns the descriptors from
 * lib/sections.js into a dynamic-zone payload, resolving media through the
 * migration's media library and rich text through the usual Blocks pipeline.
 *
 * Adding a component is a table entry plus a mapping rule — no new code paths.
 */

const title = (name) => name.replace(/(^|-)(\w)/g, (_, dash, char) => (dash ? ' ' : '') + char.toUpperCase());

const component = (name, icon, attributes) => ({
  collectionName: `components_sections_${name.replace(/-/g, '_')}s`,
  info: { displayName: title(name), icon, description: 'Migrated from WordPress' },
  options: {},
  attributes,
});

const media = (multiple = false) => ({ type: 'media', multiple, allowedTypes: ['images', 'files', 'videos', 'audios'] });

export const SECTION_COMPONENTS = {
  'sections.rich-text': {
    kinds: ['rich-text'],
    schema: component('rich-text', 'align-left', { body: { type: 'blocks' } }),
  },
  'sections.image': {
    kinds: ['image'],
    schema: component('image', 'picture', { image: media(), caption: { type: 'string' }, alt: { type: 'string' } }),
  },
  'sections.gallery': {
    kinds: ['gallery'],
    schema: component('gallery', 'grid', { images: media(true), caption: { type: 'string' } }),
  },
  'sections.embed': {
    kinds: ['embed'],
    schema: component('embed', 'play', { url: { type: 'string' }, provider: { type: 'string' }, title: { type: 'string' } }),
  },
  'sections.table': {
    kinds: ['table'],
    schema: component('table', 'grid', {
      rows: { type: 'json' },
      caption: { type: 'string' },
      hasHeader: { type: 'boolean', default: true },
    }),
  },
  'sections.code': {
    kinds: ['code'],
    schema: component('code', 'code', { code: { type: 'text' }, language: { type: 'string' } }),
  },
  'sections.quote': {
    kinds: ['quote'],
    schema: component('quote', 'quote', { quote: { type: 'text' }, attribution: { type: 'string' } }),
  },
  'sections.cta': {
    kinds: ['cta'],
    schema: component('cta', 'cursor', {
      heading: { type: 'string' },
      text: { type: 'text' },
      label: { type: 'string' },
      url: { type: 'string' },
    }),
  },
  'sections.feature': {
    kinds: ['feature'],
    schema: component('feature', 'star', {
      title: { type: 'string' },
      text: { type: 'text' },
      icon: { type: 'string' },
      image: media(),
      url: { type: 'string' },
    }),
  },
  'sections.hero': {
    kinds: ['hero'],
    schema: component('hero', 'landscape', {
      heading: { type: 'string' },
      subheading: { type: 'text' },
      image: media(),
      label: { type: 'string' },
      url: { type: 'string' },
    }),
  },
};

const UID_BY_KIND = Object.fromEntries(
  Object.entries(SECTION_COMPONENTS).flatMap(([uid, entry]) => entry.kinds.map((kind) => [kind, uid]))
);

/** The component uids a list of descriptors needs. */
export function componentsFor(sections) {
  return [...new Set(sections.map((s) => UID_BY_KIND[s.kind]).filter(Boolean))];
}

const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''));

/**
 * Descriptors → Strapi dynamic-zone payload.
 *
 * @param {object[]} sections
 * @param {object} ctx
 * @param {{ ensure: (ref: any) => Promise<object|null> }} ctx.media
 * @param {(html: string) => Promise<{ value: any, warnings?: object[] }>} ctx.convertHtml
 * @param {(code: string, detail?: string) => void} [ctx.warn]
 */
export async function sectionsToZone(sections, ctx) {
  const zone = [];
  const fileId = async (descriptor) => (await ctx.media.ensure(descriptor.mediaId ?? descriptor.src))?.id;
  // Links inside components need the same rewriting the body HTML gets.
  const link = (url) => (url && ctx.links?.isInternal(url) ? ctx.links.rewrite(url) : url);

  for (const s of sections) {
    const __component = UID_BY_KIND[s.kind];
    if (!__component) continue;

    switch (s.kind) {
      case 'rich-text': {
        const { value, warnings } = await ctx.convertHtml(s.html);
        warnings?.forEach((w) => ctx.warn?.(w.code, w.detail));
        if (value) zone.push({ __component, body: value });
        break;
      }
      case 'image': {
        // An image Strapi wouldn't accept (SVG, by default) leaves an empty card
        // behind. Drop the component and say so instead.
        const id = await fileId(s);
        if (!id) {
          ctx.warn?.('section-image-dropped', s.src || String(s.mediaId ?? ''));
          break;
        }
        zone.push(defined({ __component, image: id, caption: s.caption, alt: s.alt }));
        break;
      }
      case 'gallery': {
        const ids = [];
        for (const img of s.images ?? []) {
          const file = await ctx.media.ensure(img.mediaId ?? img.src);
          if (file) ids.push(file.id);
        }
        if (!ids.length) {
          ctx.warn?.('section-gallery-dropped', `${(s.images ?? []).length} images`);
          break;
        }
        zone.push(defined({ __component, images: ids, caption: s.caption }));
        break;
      }
      case 'table':
        zone.push(defined({ __component, rows: s.rows, caption: s.caption, hasHeader: Boolean(s.hasHeader) }));
        break;
      case 'hero':
      case 'feature': {
        const { kind, src, mediaId, ...rest } = s;
        zone.push(defined({ __component, ...rest, url: link(rest.url), image: await fileId(s) }));
        break;
      }
      default: {
        const { kind, ...rest } = s;
        zone.push(defined({ __component, ...rest, ...(rest.url ? { url: link(rest.url) } : {}) }));
      }
    }
  }

  // Strapi rejects a `string` field longer than 255 characters. Page builders
  // happily produce longer headings, and one of them shouldn't fail the entry.
  return zone.map((entry) => {
    const attributes = SECTION_COMPONENTS[entry.__component]?.schema.attributes ?? {};
    return Object.fromEntries(
      Object.entries(entry).map(([key, value]) => [
        key,
        attributes[key]?.type === 'string' && typeof value === 'string' && value.length > 255
          ? `${value.slice(0, 252)}…`
          : value,
      ])
    );
  });
}
