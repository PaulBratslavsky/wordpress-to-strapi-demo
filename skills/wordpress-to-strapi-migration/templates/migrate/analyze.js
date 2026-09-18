import { writeFileSync } from 'node:fs';
import { loadJson, parseArgs, kebab, camel, pluralize, slugify, htmlToText, routeFor } from './lib/util.js';
import { loadExport } from './lib/exportfile.js';
import { detectPageBuilder } from './lib/html.js';
import { MediaLibrary } from './lib/media.js';
import { planMarkdown } from './lib/plan.js';
import { listShape, wrapsRow, componentLabel } from './lib/repeatable.js';
import { duplicatedCollections } from './lib/duplication.js';

/**
 * ANALYZE — read the export, print a migration plan, and write a starter
 * `migration.config.json`.
 *
 * Deterministic: it maps WordPress's fixed fields (title, content, excerpt,
 * featured image, author, taxonomies, parent, dates) by rule and INFERS types
 * for custom fields (Meta Box / ACF / registered meta) from their values. Every
 * judgment call is printed with ⚑ and recorded as a `note` in the config, so a
 * human (or Claude) can review and edit the config before generating anything.
 *
 *   node analyze.js [--export wp-export/export.json] [--out migration.config.json] [--format blocks|markdown]
 */

// Attribute names Strapi reserves (the Content-Type Builder rejects them).
const RESERVED_ATTRS = new Set([
  'id', 'documentId', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy',
  'locale', 'localizations', 'status', 'meta', 'entryId', 'strapi', 'then',
]);
const RESERVED_MODELS = new Set(['boolean', 'date', 'date-time', 'datetime', 'time', 'upload', 'document', 'then', 'file', 'folder']);

// Theme presentation settings stored as post meta — layout, not content.
const LAYOUT_KEY =
  /(^|_)(header|footer|sidebar|layout|colou?r|bg|background|style|padding|margin|font|typography|width|height|opacity|overlay|css|class|template|top_bar|page_title|breadcrumbs?|side_panel|sticky|position|align|columns?|animation|parallax|hover|hide|toggle|visibility)(_|$)/i;

// Words that look plural but aren't.
const NEVER_SINGULAR = new Set( ['news', 'press', 'series', 'status', 'analytics', 'media', 'address', 'campus'] );

/** "services" → "service", "stories" → "story"; leaves "team" and "news" alone. */
const singularize = (s) => {
  if (NEVER_SINGULAR.has(s) || /(ss|us|is)$/.test(s) || !/s$/.test(s)) return s;
  return /ies$/.test(s) ? s.replace(/ies$/, 'y') : s.replace(/s$/, '');
};

// Labels too generic to tell two types apart in the Strapi admin.
const GENERIC_LABELS = new Set( ['category', 'categories', 'tag', 'tags', 'post', 'page', 'item', 'entry', 'term'] );
const MEDIA_KEY = /(image|img|photo|logo|icon|thumb|avatar|picture|gallery|file|video|audio|cover|banner|attachment|media)/i;

const isEmpty = (v) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const isIntLike = (v) => Number.isInteger(v) || (typeof v === 'string' && /^-?\d{1,11}$/.test(v));
const pascal = (s) => camel(s).replace(/^./, (c) => c.toUpperCase());
const titleCase = (s) => s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Guess a Strapi field for a custom field from the values seen across entries. */
export function infer(key, values, ctx) {
  let vals = values.filter((v) => !isEmpty(v));
  if (!vals.length) return { skip: 'always empty' };

  // WordPress meta is multi-row, so a single value often arrives as a one-item
  // array — and a site that was imported twice has the same value in every row.
  // Judge those by their content instead of calling them JSON.
  const allArrays = vals.every((v) => Array.isArray(v));
  const identical = (v) => new Set(v.map((x) => JSON.stringify(x))).size === 1;
  // …unless the one item is itself a row: that is a repeater with a single row,
  // and unwrapping it would pass its cells off as a flat list of strings.
  if (allArrays && vals.every((v) => (v.length === 1 || identical(v)) && !wrapsRow(v))) vals = vals.map((v) => v[0]);

  const str = vals.every((v) => typeof v === 'string');
  const mediaish = MEDIA_KEY.test(key);

  if (vals.every((v) => typeof v === 'boolean')) return { type: 'boolean', transform: 'boolean' };
  // Meta Box / get_post_meta store toggles as strings: "on"/"off", "yes"/"no", or "0"/"1" on a flag-like key.
  const lower = vals.map((v) => String(v).toLowerCase());
  if (lower.every((v) => ['on', 'off', 'yes', 'no', 'true', 'false'].includes(v))) return { type: 'boolean', transform: 'boolean' };
  if (lower.every((v) => v === '0' || v === '1') && /(^|_)(is|has|show|hide|enable|disable|status)(_|$)/i.test(key)) {
    return { type: 'boolean', transform: 'boolean' };
  }
  // ACF/Meta Box date pickers store "Ymd" strings, which otherwise look like integers.
  if (str && vals.every((v) => /^(19|20)\d{6}$/.test(v))) {
    return { type: 'date', transform: 'date-ymd', note: 'Ymd date string (date picker)' };
  }
  if (vals.every(isIntLike)) {
    if (mediaish && vals.every((v) => ctx.mediaIds.has(Number(v)))) return { type: 'media', multiple: false, transform: 'media' };
    const target = sameTarget(vals.map(Number), ctx);
    if (target && /(^|_)(related|post|page|parent|author|member|project|service|link|ref|id)s?(_|$)/i.test(key)) {
      return { type: 'relation', relation: 'manyToOne', targetWp: target, note: `values are ${target} ids` };
    }
    return { type: 'integer', transform: 'number' };
  }
  if (vals.every((v) => typeof v === 'number' || (typeof v === 'string' && /^-?\d*\.\d+$/.test(v)))) return { type: 'decimal', transform: 'number' };
  if (vals.every((v) => Array.isArray(v) && v.every(isIntLike))) {
    const ids = vals.flat().map(Number);
    if (ids.every((id) => ctx.mediaIds.has(id))) return { type: 'media', multiple: true, transform: 'media' };
    const target = sameTarget(ids, ctx);
    if (target) return { type: 'relation', relation: 'manyToMany', targetWp: target, note: `values are ${target} ids` };
    return { type: 'json', transform: 'raw', note: 'list of numbers' };
  }
  if (vals.every((v) => v && typeof v === 'object' && !Array.isArray(v) && (v.ID || v.id || v.url) && (v.width || v.mime_type || v.sizes || v.filename))) {
    return { type: 'media', multiple: false, transform: 'media', note: 'ACF image/file object' };
  }
  if (str) {
    if (vals.every((v) => /^\d{8}$/.test(v))) return { type: 'date', transform: 'date-ymd', note: 'Ymd date string (ACF date picker)' };
    if (vals.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return { type: 'date', transform: 'raw' };
    if (vals.every((v) => /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(v))) return { type: 'datetime', transform: 'datetime' };
    if (vals.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return { type: 'email', transform: 'raw' };
    if (mediaish && vals.every((v) => /^https?:\/\//.test(v) && ctx.library.find(v))) return { type: 'media', multiple: false, transform: 'media', note: 'uploads URL' };
    if (vals.some((v) => /<\/?[a-z][^>]*>/i.test(v))) {
      // Markup carrying no prose (an inline <svg> icon, say) has nothing for a
      // rich-text field to hold: Blocks has no node for it, so converting it
      // yields an empty field and the value is gone. Keep it as a string.
      if (vals.every((v) => !htmlToText(v).trim())) {
        return { type: 'text', transform: 'raw', note: 'markup with no text (SVG or similar) → kept as a string' };
      }
      return { type: ctx.richType, transform: 'content', note: 'contains HTML → converted like the body' };
    }
    return { type: vals.some((v) => v.length > 255 || v.includes('\n')) ? 'text' : 'string', transform: 'raw' };
  }
  // A repeating field Strapi can hold as a repeatable component. Lists of ids were
  // already claimed as relations above, and listShape refuses them again.
  const shape = listShape(vals);
  if (shape) {
    const note =
      shape.kind === 'scalar'
        ? 'list of strings → repeatable component with one "value" field (a collection + relation may suit tags better)'
        : shape.kind === 'object'
          ? 'repeater → repeatable component, using its own key names'
          : `repeater stored as positional rows → repeatable component (${shape.columns.map((c) => c.name).join(', ')}); ` +
            'columns are named only where the shape is unmistakable — rename any fieldN';
    return { type: 'list', shape, note };
  }
  return { type: 'json', transform: 'raw', note: 'mixed or nested values' };
}

/**
 * Which lane a type's bodies belong in. More than half the entries built with a
 * page builder means the structure is worth keeping, so those go to a dynamic
 * zone; ordinary prose stays in one Blocks field.
 */
export function proposeBodyMode({ items, builderCount, format }) {
  if (format === 'markdown') return 'markdown';
  return items > 0 && builderCount / items > 0.5 ? 'dynamic-zone' : 'blocks';
}

/**
 * ACF Group fields arrive flattened: the group's own key holds nothing, and its
 * subfields are stored beside it as `<group>_<sub>`. Spotting that shape lets a
 * group become one Strapi component instead of a row of loose sibling fields.
 */
export function detectFieldGroups(sample) {
  const keys = Object.keys(sample ?? {}).filter((k) => !k.startsWith('_'));
  const groups = {};
  for (const key of keys) {
    const value = sample[key];
    if (value !== '' && value !== null && value !== undefined) continue; // a parent holds nothing
    const subs = keys.filter((k) => k.startsWith(`${key}_`)).map((k) => k.slice(key.length + 1));
    if (subs.length >= 2) groups[key] = subs;
  }
  return groups;
}

function sameTarget(ids, ctx) {
  const types = new Set(ids.map((id) => ctx.postTypeOf.get(id)));
  return types.size === 1 && !types.has(undefined) ? [...types][0] : null;
}

/**
 * A theme/plugin prefix worth stripping from type slugs: neuros_project,
 * neuros_service, neuros_vacancy → "neuros_". Needs three or more types to
 * avoid mangling families like portfolio_item / portfolio_layout (which would
 * otherwise become "item" and "layout"), and never strips a prefix that is
 * itself one of the site's types or taxonomies.
 */
function sharedPrefix(slugs, known) {
  const counts = {};
  for (const s of slugs) {
    const m = s.match(/^([a-z0-9]+)_/);
    if (m) counts[m[1]] = (counts[m[1]] || 0) + 1;
  }
  return Object.entries(counts)
    .filter(([prefix, n]) => n >= 3 && !known.has(prefix))
    .map(([prefix]) => `${prefix}_`);
}

function main() {
  const args = parseArgs(process.argv);
  const exportPath = args.export || 'wp-export/export.json';
  const outPath = args.out || 'migration.config.json';
  const format = args.format || 'blocks';
  const data = loadExport(exportPath);
  const site = data.site;
  const richType = format === 'markdown' ? 'richtext' : 'blocks';

  const library = new MediaLibrary({ items: data.media, siteUrl: site.home });
  const ctx = {
    richType,
    library,
    mediaIds: new Set(data.media.map((m) => m.id)),
    postTypeOf: new Map(Object.entries(data.entries).flatMap(([t, list]) => list.map((e) => [e.id, t]))),
  };

  // --- naming ------------------------------------------------------------------
  const customSlugs = [
    ...Object.keys(data.entries).filter((s) => !['post', 'page'].includes(s)),
    ...Object.keys(data.terms).filter((s) => !['category', 'post_tag'].includes(s)),
  ];
  const prefixes = sharedPrefix(customSlugs, new Set([...Object.keys(data.entries), ...Object.keys(data.terms)]));
  const baseName = (slug) => {
    if (slug === 'post_tag') return 'tag';
    const p = prefixes.find((x) => slug.startsWith(x));
    return singularize(kebab(p ? slug.slice(p.length) : slug));
  };
  /** WordPress labels are often just "Category" or "Item"; fall back to the slug then. */
  const displayName = (label, slug) =>
    label && !GENERIC_LABELS.has(String(label).toLowerCase()) ? label : titleCase(baseName(slug));
  const names = {}; // "postType:post" | "taxonomy:category" | "users" → singularName
  const taken = new Set();
  const claim = (key, wanted) => {
    let s = RESERVED_MODELS.has(wanted) ? `${wanted}-item` : wanted;
    while (taken.has(s)) s = `${s}-2`;
    taken.add(s);
    names[key] = s;
    return s;
  };

  const usedAuthors = new Set(Object.values(data.entries).flatMap((list) => list.map((e) => e.author).filter(Boolean)));
  const authors = data.users.filter((u) => usedAuthors.has(u.id));
  if (authors.length) claim('users', 'author');
  for (const slug of Object.keys(data.terms)) if (data.terms[slug].length) claim(`taxonomy:${slug}`, baseName(slug));
  for (const slug of Object.keys(data.entries)) if (data.entries[slug].length) claim(`postType:${slug}`, baseName(slug));

  const config = {
    source: { url: site.home, export: exportPath },
    content: { format, shortcodes: 'strip', uploadExternalImages: true, absoluteMediaUrls: true },
    types: {},
    components: {},
  };
  const flags = [];
  const flag = (msg) => flags.push(msg);

  const makeType = (key, source, displayName) => {
    const singularName = names[key];
    const pluralName = pluralize(singularName) === singularName ? `${singularName}-entries` : pluralize(singularName);
    return (config.types[singularName] = { source, singularName, pluralName, displayName, urlPattern: null, fields: {} });
  };

  /** Custom fields from registered meta, ACF, and the helper's migration_meta. */
  function addCustomFields(t, items, typeLabel) {
    const seen = new Set(Object.keys(t.fields));
    const ignored = {};
    const typePrefix = `${t.singularName.replace(/-/g, '_')}_`;
    const sources = [
      ['meta', (e) => e.meta],
      ['acf', (e) => (Array.isArray(e.acf) ? null : e.acf)],
      ['migration_meta', (e) => e.migration_meta],
    ];
    const handled = new Set();
    for (const [src, get] of sources) {
      const keys = new Set(items.flatMap((e) => Object.keys(get(e) ?? {})));

      // Flattened ACF Groups become a component, so `results_headline` and its
      // siblings arrive as one `results` object rather than three stray fields.
      const sample = {};
      for (const key of keys) sample[key] = items.map((e) => get(e)?.[key]).find((v) => v !== undefined);
      for (const [parent, subs] of Object.entries(detectFieldGroups(sample))) {
        const uid = `groups.${t.singularName}-${kebab(parent)}`;
        const attributes = {};
        const groupFields = {};
        for (const sub of subs) {
          const sourceKey = `${parent}_${sub}`;
          const guess = infer(sourceKey, items.map((e) => get(e)?.[sourceKey]), ctx);
          if (guess.skip) continue;
          const { targetWp, note, transform, from, ...attr } = guess;
          // Keep component fields simple: relations and rich text inside a
          // component are a modelling decision, not something to guess at.
          attributes[camel(sub)] = ['relation', 'blocks', 'richtext'].includes(attr.type) ? { type: 'string' } : attr;
          groupFields[camel(sub)] = { key: sourceKey, transform: transform ?? 'raw' };
        }
        if (Object.keys(attributes).length < 2) continue;
        handled.add(parent);
        subs.forEach((sub) => handled.add(`${parent}_${sub}`));
        config.components[uid] = { displayName: titleCase(parent), attributes };
        t.fields[camel(parent)] = {
          type: 'component',
          component: uid,
          repeatable: false,
          from: src,
          transform: 'group',
          group: groupFields,
        };
        flag(`${t.singularName}.${camel(parent)}: ${subs.length} flattened keys → component ${uid}`);
      }

      for (const key of keys) {
        if (handled.has(key)) continue; // registered meta wins over the raw copy
        handled.add(key);
        const values = items.map((e) => get(e)?.[key]);

        // Underscore-prefixed keys are plugin/theme bookkeeping wherever they appear
        // (ACF's field references, Elementor's layout JSON, WordPress internals).
        if (key.startsWith('_')) {
          ignored[key] = '_elementor_data' === key ? 'Elementor layout JSON (see references/page-builders.md)' : 'internal plugin meta';
          continue;
        }
        if ('footnotes' === key) continue;

        // ACF fields are deliberate content; only guess about raw meta.
        if (src !== 'acf') {
          if (LAYOUT_KEY.test(key)) {
            ignored[key] = 'looks like a theme layout/display setting';
            continue;
          }
          const distinct = new Set(values.filter((v) => !isEmpty(v)).map((v) => JSON.stringify(v)));
          if (items.length > 3 && distinct.size === 1 && values.every((v) => !isEmpty(v))) {
            ignored[key] = 'same value on every entry — probably a theme default';
            continue;
          }
        }
        const guess = infer(key, values, ctx);
        if (guess.skip) {
          ignored[key] = guess.skip;
          continue;
        }
        let name = camel(key.startsWith(typePrefix) ? key.slice(typePrefix.length) : key);
        if (RESERVED_ATTRS.has(name) || seen.has(name) || /^(strapi|__)/.test(name)) name = `custom${pascal(name)}`;
        seen.add(name);
        const { targetWp, shape, ...field } = guess;
        if (targetWp) field.target = names[`postType:${targetWp}`];

        // A repeating field becomes its own component, the way a flattened group does.
        if (field.type === 'list' && shape) {
          const uid = `lists.${t.singularName}-${kebab(name)}`;
          config.components[uid] = {
            displayName: componentLabel(name),
            attributes: Object.fromEntries(shape.columns.map((c) => [c.name, { type: c.type }])),
          };
          t.fields[name] = {
            type: 'component',
            component: uid,
            repeatable: true,
            from: `${src}.${key}`,
            transform: 'list',
            list: { kind: shape.kind, columns: shape.columns.map((c) => ({ name: c.name, ...(c.key ? { key: c.key } : {}) })) },
          };
          flag(`${typeLabel}.${name} ← ${src}.${key}: ${field.note}`);
          continue;
        }

        t.fields[name] = { ...field, from: `${src}.${key}` };
        if (field.note) flag(`${typeLabel}.${name} ← ${src}.${key}: ${field.note}`);
      }
    }
    if (Object.keys(ignored).length) t.ignoredMeta = ignored;
  }

  // --- authors ----------------------------------------------------------------
  if (authors.length) {
    const t = makeType('users', { kind: 'users' }, 'Author');
    t.fields = {
      name: { type: 'string', from: 'name', transform: 'text' },
      slug: { type: 'uid', targetField: 'name', from: 'slug', transform: 'slug' },
      ...(authors.some((u) => u.description) && { bio: { type: 'text', from: 'description', transform: 'text' } }),
      ...(authors.some((u) => u.url) && { website: { type: 'string', from: 'url', transform: 'raw' } }),
      avatarUrl: { type: 'string', from: 'avatar_urls.96', transform: 'raw' },
      wpId: { type: 'integer', from: 'id', transform: 'raw' },
      wpSite: { type: 'string', transform: 'site' },
    };
    if (data.users.length > authors.length) flag(`author: ${data.users.length - authors.length} WordPress users never authored exported content and are not migrated`);
  }

  // --- taxonomies -------------------------------------------------------------
  for (const [slug, list] of Object.entries(data.terms)) {
    if (!list.length) continue;
    const tax = data.taxonomies[slug];
    const t = makeType(`taxonomy:${slug}`, { kind: 'taxonomy', slug }, displayName(tax.labels?.singular_name, slug));
    t.urlPattern = null;
    t.fields = {
      name: { type: 'string', from: 'name', transform: 'text' },
      slug: { type: 'uid', targetField: 'name', from: 'slug', transform: 'slug' },
      ...(list.some((x) => x.description) && { description: { type: 'text', from: 'description', transform: 'text' } }),
      ...(tax.hierarchical && list.some((x) => x.parent) && { parent: { type: 'relation', relation: 'manyToOne', target: t.singularName, from: 'parent' } }),
      wpId: { type: 'integer', from: 'id', transform: 'raw' },
      wpSite: { type: 'string', transform: 'site' },
      wpLink: { type: 'string', from: 'link', transform: 'raw' },
    };
    addCustomFields(t, list, t.singularName);
  }

  // --- post types -------------------------------------------------------------
  for (const [slug, items] of Object.entries(data.entries)) {
    if (!items.length) {
      flag(`${slug}: no entries — skipped`);
      continue;
    }
    const wpType = data.types[slug];
    const t = makeType(`postType:${slug}`, { kind: 'postType', slug }, displayName(wpType.labels?.singular_name, slug));
    const has = (fn) => items.some(fn);
    const f = t.fields;
    const count = (fn) => items.filter(fn).length;
    const html = (e) => e.content?.rendered || '';
    const builder = count(
      (e) => detectPageBuilder(html(e)) || e.migration_meta?._elementor_edit_mode === 'builder' || /^elementor/.test(e.template || '')
    );
    t.bodyMode = proposeBodyMode({ items: items.length, builderCount: builder, format });

    if (has((e) => htmlToText(e.title?.rendered))) f.title = { type: 'string', from: 'title', transform: 'text' };
    f.slug = { type: 'uid', ...(f.title && { targetField: 'title' }), from: 'slug', transform: 'slug' };
    if (has((e) => e.content?.rendered?.trim())) {
      f.content =
        t.bodyMode === 'dynamic-zone'
          ? { type: 'dynamiczone', components: [], from: 'content', transform: 'sections' }
          : { type: richType, from: 'content', transform: 'content' };
    }
    if (has((e) => htmlToText(e.excerpt?.raw || e.excerpt?.rendered))) f.excerpt = { type: 'text', from: 'excerpt', transform: 'excerpt' };
    if (has((e) => e.featured_media)) f.featuredImage = { type: 'media', multiple: false, from: 'featured_media', transform: 'media' };
    if (names.users && has((e) => e.author)) f.author = { type: 'relation', relation: 'manyToOne', target: names.users, from: 'author' };
    for (const taxSlug of wpType.taxonomies || []) {
      const target = names[`taxonomy:${taxSlug}`];
      const restBase = data.taxonomies[taxSlug]?.rest_base || taxSlug;
      if (target && has((e) => e[restBase]?.length)) {
        f[camel(restBase === 'tags' ? 'tags' : restBase.replace(/^[a-z0-9]+_/, (p) => (prefixes.includes(p) ? '' : p)))] = {
          type: 'relation',
          relation: 'manyToMany',
          target,
          from: restBase,
        };
      }
    }
    if (wpType.hierarchical && has((e) => e.parent)) f.parent = { type: 'relation', relation: 'manyToOne', target: t.singularName, from: 'parent' };
    if (has((e) => e.menu_order)) f.menuOrder = { type: 'integer', from: 'menu_order', transform: 'number' };
    if (has((e) => e.sticky)) f.sticky = { type: 'boolean', from: 'sticky', transform: 'boolean' };
    if (has((e) => e.format && e.format !== 'standard')) f.postFormat = { type: 'string', from: 'format', transform: 'raw' };
    f.publishedDate = { type: 'datetime', from: 'date_gmt', transform: 'date-gmt' };
    if (has((e) => e.status !== 'publish')) f.wpStatus = { type: 'string', from: 'status', transform: 'raw' };
    if (has((e) => e.yoast_head_json)) f.seo = { type: 'component', component: 'shared.seo', from: 'yoast_head_json', transform: 'seo-yoast' };
    f.wpId = { type: 'integer', from: 'id', transform: 'raw' };
    f.wpSite = { type: 'string', transform: 'site' };
    f.wpLink = { type: 'string', from: 'link', transform: 'raw' };
    if (slug === 'post') t.urlPattern = null;

    addCustomFields(t, items, t.singularName);

    // Content scan: the things that won't survive a straight conversion.
    if (builder) {
      flag(
        t.bodyMode === 'dynamic-zone'
          ? `${t.singularName}: ${builder}/${items.length} entries built with a page builder → their sections become a dynamic zone`
          : `${t.singularName}: ${builder}/${items.length} entries built with a page builder — too few to assume, so the layout flattens to rich text. Set "bodyMode": "dynamic-zone" on ${t.singularName} in migration.config.json to keep the sections instead (see references/page-builders.md)`
      );
    }
    const embeds = count((e) => /wp-block-embed|<iframe/i.test(html(e)));
    if (embeds) flag(`${t.singularName}: ${embeds} entries contain embeds/iframes → converted to links`);
    const tables = count((e) => /<table/i.test(html(e)));
    if (tables && format === 'blocks') flag(`${t.singularName}: ${tables} entries contain tables → flattened in Blocks (use --format markdown to keep them)`);
    const shortcodes = count((e) => /\[(vc_|et_pb_|fusion_|[a-z_-]+\s[^\]]*=)/i.test(htmlToText(html(e))));
    if (shortcodes) flag(`${t.singularName}: ${shortcodes} entries contain unrendered shortcodes → stripped (content.shortcodes)`);
    const external = count((e) => [...html(e).matchAll(/<img[^>]+src="([^"]+)"/g)].some(([, src]) => !src.includes(new URL(site.home).host) && /^https?:/.test(src)));
    if (external) flag(`${t.singularName}: ${external} entries hotlink images from other sites → downloaded and uploaded (content.uploadExternalImages)`);
    const emptySlug = count((e) => !e.slug);
    if (emptySlug) flag(`${t.singularName}: ${emptySlug} entries have no slug (unpublished drafts) → generated from the title`);
    const nonAscii = count((e) => e.slug && slugify(e.slug) !== e.slug);
    if (nonAscii) flag(`${t.singularName}: ${nonAscii} slugs aren't valid Strapi uids (accents / encoded characters) → transliterated; redirects.json covers the old URLs`);
    const dupes = items.length - new Set(items.map((e) => e.slug).filter(Boolean)).size - emptySlug;
    if (dupes > 0) flag(`${t.singularName}: ${dupes} duplicate slugs (e.g. same slug under different parents) → suffixed -2, -3`);
  }

  if (data.stats?.comments)
    flag(
      `${data.stats.comments} comments exist and are not migrated — Strapi has none built in. ` +
        'Either install a comments plugin, or add a "comment" collection (author, email, body, date, ' +
        'approved) with a relation to the entry and move them yourself.'
    );
  if (data.menus?.menus?.length && !config.types.navigation) {
    config.types.navigation = {
      source: { kind: 'menus' },
      kind: 'singleType',
      singularName: 'navigation',
      pluralName: 'navigations',
      displayName: 'Navigation',
      urlPattern: null,
      fields: { menus: { type: 'component', component: 'navigation.menu', repeatable: true } },
    };
    const itemCount = data.menus.items?.length ?? 0;
    flag(`${data.menus.menus.length} menus (${itemCount} items) → a "navigation" single type; links resolve to the migrated entries`);
  }
  if (!site.authenticated) flag('export was unauthenticated — only published content; custom fields and drafts are missing');
  for (const [slug, why] of Object.entries(data.stats?.skippedTypes || {})) flag(`${slug} not exported: ${why}`);

  // --- pages that repeat a collection ------------------------------------------
  // Reported, never rewritten: deciding that a paragraph *is* a given entry is a
  // modelling call, and a confident wrong guess would replace real page content.
  const widgetTypesOf = (entry) => {
    let raw = entry.migration_meta?._elementor_data ?? entry.meta?._elementor_data;
    if (Array.isArray(raw)) raw = raw[0];
    if (typeof raw !== 'string' || !raw.trim()) return [];
    const out = [];
    const walk = (nodes) => {
      for (const node of nodes ?? []) {
        if (node.widgetType) out.push(node.widgetType);
        walk(node.elements);
      }
    };
    try {
      walk(JSON.parse(raw));
    } catch {
      // Unreadable layout JSON is already reported by the converter.
    }
    return out;
  };

  const postTypes = Object.values(config.types).filter((t) => t.source.kind === 'postType');
  const titlesOf = (t) =>
    (data.entries[t.source.slug] ?? []).map((e) => htmlToText(e.title?.rendered || e.title?.raw || '')).filter(Boolean);
  const duplicates = [];
  for (const t of postTypes) {
    const others = postTypes.filter((o) => o !== t).map((o) => ({ name: o.singularName, titles: titlesOf(o) }));
    if (!others.length) continue;
    for (const entry of data.entries[t.source.slug] ?? []) {
      const page = { text: htmlToText(entry.content?.rendered || ''), widgets: widgetTypesOf(entry) };
      for (const found of duplicatedCollections(page, others)) {
        duplicates.push({ owner: t.singularName, slug: entry.slug || `#${entry.id}`, ...found });
      }
    }
  }
  // Grouped by what they duplicate: "12 pages build a service listing" is a decision,
  // where six page names and a hidden remainder is an inventory.
  const groups = new Map();
  for (const d of duplicates) {
    const key = `${d.owner}|${d.type}|${d.signal}|${d.detail}`;
    const group = groups.get(key) ?? { ...d, slugs: [] };
    group.slugs.push(d.slug);
    groups.set(key, group);
  }
  for (const g of groups.values()) {
    const n = g.slugs.length;
    const examples = g.slugs.slice(0, 3).map((s) => `"${s}"`).join(', ') + (n > 3 ? ', …' : '');
    const subject = `${n} ${g.owner} ${n === 1 ? 'entry' : 'entries'} (${examples})`;
    const advice = `→ relate ${n === 1 ? 'it' : 'them'} to the migrated ${g.type} collection rather than keeping a copy`;
    flag(
      g.signal === 'widget'
        ? `${subject} ${n === 1 ? 'builds' : 'build'} a ${g.type} listing with the ${g.detail} widget ${advice}`
        : `${subject} ${n === 1 ? 'repeats' : 'repeat'} ${g.type} titles inline ${advice}`
    );
  }

  // --- report -------------------------------------------------------------------
  console.log(`\nMigration plan for ${site.name} (${site.home}) — body format: ${format}\n`);
  for (const t of Object.values(config.types)) {
    const src = t.source.slug ? `${t.source.kind} ${t.source.slug}` : t.source.kind;
    const n =
      t.source.kind === 'users'
        ? authors.length
        : t.source.kind === 'menus'
          ? (data.menus?.menus?.length ?? 0)
          : t.source.kind === 'taxonomy'
            ? data.terms[t.source.slug].length
            : data.entries[t.source.slug].length;
    console.log(
      `■ ${t.displayName}  (${src}, ${n}) → api::${t.singularName}.${t.singularName}  /api/${routeFor(t)}${t.kind === 'singleType' ? ' (single type)' : ''}${t.bodyMode ? `  [body: ${t.bodyMode}]` : ''}`
    );
    for (const [name, fld] of Object.entries(t.fields)) {
      const kind = fld.type === 'relation' ? `relation ${fld.relation} → ${fld.target}` : fld.type === 'media' ? `media${fld.multiple ? ' (multiple)' : ''}` : fld.type === 'component' ? `component ${fld.component}` : fld.type;
      const from = fld.from ?? (fld.transform ? `(${fld.transform})` : '—');
      console.log(`    ${fld.note ? '⚑' : '-'} ${name.padEnd(20)} ← ${String(from).padEnd(34)} ${kind}`);
    }
    const ign = Object.keys(t.ignoredMeta || {});
    if (ign.length) console.log(`    · ignored ${ign.length} custom field(s): ${ign.slice(0, 8).join(', ')}${ign.length > 8 ? ', …' : ''}`);
    console.log('');
  }
  if (flags.length) {
    console.log('Decisions to review (⚑):');
    for (const m of flags) console.log(`  ⚑ ${m}`);
  }

  writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n');

  // The same plan as a document, so it can be reviewed in a pull request
  // rather than in whatever is left of the terminal scrollback.
  const planPath = outPath.replace(/[^/\\]+$/, 'migration-plan.md');
  writeFileSync(planPath, planMarkdown(config, data, flags));

  console.log(`\nWrote ${outPath}. Review it (rename types, drop or add fields, set urlPattern), then run generate.js.`);
  console.log(`Wrote ${planPath} — the same plan, readable and reviewable.`);
}

// Run only as a CLI: the tests import proposeBodyMode from this file.
if (/analyze\.js$/.test(process.argv[1] ?? '')) main();
