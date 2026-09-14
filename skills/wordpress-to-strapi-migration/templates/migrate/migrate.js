import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadJson, parseArgs, requireEnv, slugify, htmlToText, getPath, asArray } from './lib/util.js';
import { checkConfig, preflight } from './lib/preflight.js';
import { buildNavigation } from './lib/navigation.js';
import { summaryMarkdown } from './lib/summary.js';
import { StrapiClient } from './lib/strapi.js';
import { MediaLibrary } from './lib/media.js';
import { LinkRewriter } from './lib/links.js';
import { MigrationState } from './lib/state.js';
import { convertContent } from './lib/content.js';
import { sectionsForEntry } from './lib/sections.js';
import { sectionsToZone } from './lib/components.js';
import { itemsOf } from './lib/source.js';

/**
 * MIGRATE — move the exported WordPress content into Strapi. Driven entirely
 * by migration.config.json; there is no per-site code in here.
 *
 *   node migrate.js [--dry-run] [--only post,category] [--limit 5] [--config ...] [--export ...]
 *
 *   pass 1  every entry: scalar fields, rich text, media (uploaded on first use)
 *   pass 2  relations (author, taxonomies, parent, related entries), by documentId
 *
 * Idempotent: entries are matched on `wpId` and uploads are remembered in
 * .migration-state.json, so re-running updates instead of duplicating.
 * --dry-run converts everything without writing to Strapi and saves each
 * payload to <export dir>/preview/<type>/<slug>.json for review.
 */

async function main() {
  const args = parseArgs(process.argv, ['dry-run']);
  const configPath = args.config || 'migration.config.json';
  const config = loadJson(configPath);
  const exportPath = args.export || config.source?.export || 'wp-export/export.json';
  const data = loadJson(exportPath);
  const exportDir = path.dirname(exportPath);
  const dryRun = Boolean(args['dry-run']);
  const only = args.only ? new Set(args.only.split(',').map((s) => s.trim())) : null;
  const limit = args.limit ? Number(args.limit) : Infinity;

  const siteUrl = data.site.home;
  const strapiUrl = (process.env.STRAPI_URL || 'http://localhost:1337').replace(/\/$/, '');
  // Part of the idempotency key: one Strapi can hold migrations from several sites.
  const sourceHost = new URL(siteUrl).host;
  const strapi = new StrapiClient({ baseUrl: strapiUrl, token: dryRun ? process.env.STRAPI_API_TOKEN || '' : requireEnv('STRAPI_API_TOKEN') });
  const state = new MigrationState();
  const media = new MediaLibrary({
    items: data.media,
    strapi,
    state,
    siteUrl,
    strapiUrl,
    exportDir,
    dryRun,
    uploadExternal: config.content?.uploadExternalImages !== false,
    log: console.log,
  });
  const links = new LinkRewriter({ siteUrl });
  // Single types hold one document each and have no WordPress entries to walk,
  // so both passes below work on the collections only.
  const allTypes = Object.values(config.types);
  const types = allTypes.filter((t) => t.kind !== 'singleType');
  const selected = (t) => !only || only.has(t.singularName);

  // Refuse to start on a config that can't work, or a Strapi that hasn't loaded
  // the generated schemas yet. Half a migration is worse than none.
  const problems = dryRun ? checkConfig(config) : await preflight(config, strapi);
  if (problems.length) {
    console.error('\nPreflight found problems:\n');
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error('');
    process.exit(1);
  }

  // Final slugs up front: Strapi uids must be ASCII and unique per type, and
  // links/redirects need to know every entry's new URL before any content converts.
  const slugs = {};
  for (const t of types) {
    const used = new Set();
    slugs[t.singularName] = new Map();
    for (const item of itemsOf(data, t)) {
      const title = htmlToText(item.title?.raw || item.title?.rendered || item.name || '');
      const base = slugify(item.slug) || slugify(title) || `${t.singularName}-${item.id}`;
      let slug = base;
      for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
      used.add(slug);
      slugs[t.singularName].set(item.id, slug);
      links.add({ link: item.link, id: item.id, slug, pattern: t.urlPattern, isPost: t.source.kind === 'postType' });
    }
  }

  async function valueFor(item, field, t, warn) {
    let raw = getPath(item, field.from);
    // Mirror analyze.js: a scalar field whose value arrived as a one-item array
    // (or the same value repeated) is that value.
    if (Array.isArray(raw) && raw.length && field.type !== 'json' && field.type !== 'relation' && !field.multiple) {
      const identical = new Set(raw.map((x) => JSON.stringify(x))).size === 1;
      if (raw.length === 1 || identical) raw = raw[0];
    }
    switch (field.transform ?? 'raw') {
      case 'text': {
        const v = raw && typeof raw === 'object' ? raw.raw?.trim() || raw.rendered : raw;
        return v == null || v === '' ? undefined : htmlToText(v) || undefined;
      }
      case 'excerpt': {
        const v = raw && typeof raw === 'object' ? raw.raw?.trim() || raw.rendered : raw;
        const text = htmlToText(v)
          .replace(/\s*\[(…|\.\.\.)\]\s*$/u, '') // auto-excerpt "[…]"
          .replace(/\s*(Continue reading|Read more)\b.*$/is, '')
          .trim();
        return text || undefined;
      }
      case 'content': {
        const html = raw && typeof raw === 'object' ? raw.rendered : raw;
        if (!html || !String(html).trim()) return undefined;
        const { value, warnings } = await convertContent(String(html), {
          format: field.type === 'richtext' ? 'markdown' : 'blocks',
          media,
          links,
          shortcodes: config.content?.shortcodes ?? 'strip',
        });
        warnings.forEach((w) => warn(w.code, w.detail));
        return value ?? undefined;
      }
      case 'sections': {
        // Elementor's own layout when the entry has it, otherwise the body HTML.
        const { sections, warnings: found, source } = sectionsForEntry(item, {
          shortcodes: config.content?.shortcodes ?? 'strip',
        });
        found.forEach((w) => warn(w.code, w.detail));
        if (!sections.length) return undefined;
        warn('sections', `${sections.length} sections from ${source}`);
        return sectionsToZone(sections, {
          media,
          links,
          warn,
          convertHtml: (html) =>
            convertContent(html, {
              format: 'blocks',
              media,
              links,
              shortcodes: config.content?.shortcodes ?? 'strip',
            }),
        });
      }
      case 'group': {
        // An ACF Group, stored flattened as `<group>_<sub>` beside its own key.
        const container = raw && typeof raw === 'object' ? raw : {};
        const value = {};
        for (const [name, sub] of Object.entries(field.group ?? {})) {
          let v = container[sub.key];
          if (Array.isArray(v) && v.length === 1) v = v[0];
          if (v === undefined || v === null || v === '') continue;
          value[name] = sub.transform === 'number' ? Number(v) : v;
        }
        return Object.keys(value).length ? value : undefined;
      }
      case 'site':
        return sourceHost;
      case 'slug':
        return slugs[t.singularName].get(item.id);
      case 'date-gmt': {
        const v = raw || item.date;
        if (!v || v.startsWith('0000')) return undefined;
        return /(Z|[+-]\d\d:\d\d)$/.test(v) ? v : `${v}Z`;
      }
      case 'datetime': {
        const d = raw ? new Date(String(raw).replace(' ', 'T')) : null;
        return d && !Number.isNaN(d.getTime()) ? d.toISOString() : undefined;
      }
      case 'date-ymd': {
        const s = String(raw ?? '');
        return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6)}` : undefined;
      }
      case 'number': {
        if (raw === '' || raw == null) return undefined;
        const n = Number(raw);
        return Number.isFinite(n) ? n : undefined;
      }
      case 'boolean':
        if (raw === '' || raw == null) return undefined;
        return typeof raw === 'boolean' ? raw : ['1', 'on', 'yes', 'true'].includes(String(raw).toLowerCase());
      case 'media': {
        if (field.multiple) {
          const ids = [];
          for (const ref of asArray(raw)) {
            const file = await media.ensure(ref);
            if (file) ids.push(file.id);
            else warn('media-missing', JSON.stringify(ref));
          }
          return ids.length ? ids : undefined;
        }
        const ref = Array.isArray(raw) ? raw[0] : raw;
        const file = await media.ensure(ref);
        if (!file && ref) warn('media-missing', JSON.stringify(ref));
        return file ? file.id : undefined;
      }
      case 'seo-yoast': {
        if (!raw || typeof raw !== 'object') return undefined;
        const img = raw.og_image?.[0]?.url;
        const file = img ? await media.ensureByUrl(img).catch(() => null) : null;
        return {
          metaTitle: raw.title ? htmlToText(raw.title) : undefined,
          metaDescription: raw.description || raw.og_description || undefined,
          canonicalUrl: raw.canonical ? links.rewrite(raw.canonical) : undefined,
          noIndex: raw.robots?.index === 'noindex',
          ...(file && { ogImage: file.id }),
        };
      }
      default: {
        if (raw === '' || raw == null) return undefined;
        if (field.type === 'string' || field.type === 'text') return typeof raw === 'string' ? raw : JSON.stringify(raw);
        if (['integer', 'decimal', 'float', 'biginteger'].includes(field.type)) {
          const n = Number(raw);
          return Number.isFinite(n) ? n : undefined;
        }
        return raw;
      }
    }
  }

  const idMaps = Object.fromEntries(types.map((t) => [t.singularName, new Map()])); // type → wpId → documentId
  const statusOf = new Map();
  const counts = {};
  const warnings = [];
  const failures = [];
  const previewDir = path.join(exportDir, 'preview');

  // --- Pass 1: entries ----------------------------------------------------------
  for (const t of types.filter(selected)) {
    const items = itemsOf(data, t).slice(0, limit);
    console.log(`\n■ ${t.displayName} → /api/${t.pluralName}  (${items.length})`);
    for (const item of items) {
      const slug = slugs[t.singularName].get(item.id);
      const found = [];
      const warn = (code, detail = '') => found.push({ code, detail: String(detail).slice(0, 200) });
      try {
        const payload = {};
        for (const [name, field] of Object.entries(t.fields)) {
          if (field.type === 'relation') continue; // pass 2
          const v = await valueFor(item, field, t, warn);
          if (v !== undefined) payload[name] = v;
        }
        const status = t.source.kind === 'postType' && item.status !== 'publish' ? 'draft' : 'published';
        let verb = '·';
        if (dryRun) {
          mkdirSync(path.join(previewDir, t.singularName), { recursive: true });
          writeFileSync(path.join(previewDir, t.singularName, `${slug}.json`), JSON.stringify({ status, payload, warnings: found }, null, 2));
        } else {
          const existing = await strapi.findByWpId(t.pluralName, item.id, sourceHost);
          const rec = existing
            ? await strapi.update(t.pluralName, existing.documentId, payload, { status })
            : await strapi.create(t.pluralName, payload, { status });
          verb = existing ? '~' : '+';
          idMaps[t.singularName].set(item.id, rec.documentId);
          statusOf.set(`${t.singularName}:${item.id}`, status);
        }
        counts[t.singularName] = (counts[t.singularName] || 0) + 1;
        warnings.push(...found.map((w) => ({ type: t.singularName, wpId: item.id, slug, ...w })));
        console.log(`  ${verb} ${slug}${status === 'draft' ? ' (draft)' : ''}${found.length ? `  ⚠ ${[...new Set(found.map((w) => w.code))].join(', ')}` : ''}`);
      } catch (err) {
        failures.push({ type: t.singularName, wpId: item.id, slug, error: err.message, details: err.details });
        console.log(`  ✗ ${slug}: ${err.message}${err.details ? `  ${JSON.stringify(err.details).slice(0, 400)}` : ''}`);
      }
    }
  }

  // --- Pass 2: relations ----------------------------------------------------------
  async function idMapFor(target) {
    const map = idMaps[target];
    if (map.size || dryRun) return map;
    // Target type wasn't migrated in this run (--only): read its wpId → documentId from Strapi.
    const params = { 'fields[0]': 'wpId', 'filters[wpSite][$eq]': sourceHost };
    for await (const doc of strapi.list(config.types[target].pluralName, params)) map.set(doc.wpId, doc.documentId);
    return map;
  }

  if (!dryRun) {
    console.log('\n■ Linking relations');
    let linked = 0;
    for (const t of types.filter(selected)) {
      const relFields = Object.entries(t.fields).filter(([, f]) => f.type === 'relation');
      if (!relFields.length) continue;
      for (const item of itemsOf(data, t).slice(0, limit)) {
        const documentId = idMaps[t.singularName].get(item.id);
        if (!documentId) continue;
        const rel = {};
        for (const [name, f] of relFields) {
          const map = await idMapFor(f.target);
          const ids = asArray(getPath(item, f.from))
            .map(Number)
            .filter(Boolean)
            .map((id) => map.get(id))
            .filter(Boolean);
          if (ids.length) rel[name] = { set: f.relation.endsWith('ToOne') ? ids.slice(0, 1) : ids };
        }
        if (!Object.keys(rel).length) continue;
        try {
          await strapi.update(t.pluralName, documentId, rel, { status: statusOf.get(`${t.singularName}:${item.id}`) });
          linked++;
        } catch (err) {
          failures.push({ type: t.singularName, wpId: item.id, pass: 'relations', error: err.message, details: err.details });
          console.log(`  ✗ ${t.singularName} ${item.id}: ${err.message}`);
        }
      }
    }
    console.log(`  linked ${linked} entries`);
  }

  // --- Navigation -----------------------------------------------------------------
  // After pass 1, every entry has a slug registered with the rewriter, so menu
  // links can resolve to where the content actually landed.
  let navigation = null;
  const navType = allTypes.find((t) => t.source?.kind === 'menus');
  if (navType && selected(navType)) {
    const nav = buildNavigation(data.menus, { links });
    if (!nav) {
      console.log('\n■ Navigation — no menus in the export, nothing to write');
    } else {
      const itemCount = nav.menus.reduce((n, m) => n + m.items.length, 0);
      navigation = { menus: nav.menus.length, items: itemCount };
      console.log(`\n■ Navigation → /api/${navType.singularName}  (${nav.menus.length} menus, ${itemCount} items)`);
      for (const m of nav.menus) console.log(`  · ${m.name}${m.location ? ` [${m.location}]` : ''} — ${m.items.length} items`);
      if (dryRun) {
        console.log('  (dry run — not written)');
      } else {
        try {
          await strapi.putSingle(navType.singularName, nav);
        } catch (err) {
          failures.push({ type: navType.singularName, pass: 'navigation', error: err.message, details: err.details });
          console.log(`  ✗ ${err.message}`);
        }
      }
    }
  }

  // --- Report ---------------------------------------------------------------------
  writeFileSync('redirects.json', JSON.stringify(links.redirects, null, 2) + '\n');
  const report = { finishedAt: new Date().toISOString(), dryRun, counts, navigation, failures, media: media.failures, warnings };
  writeFileSync('migration-report.json', JSON.stringify(report, null, 2) + '\n');
  // The same run, written for a person rather than for grep.
  writeFileSync('migration-summary.md', summaryMarkdown(report));

  console.log(`\n${dryRun ? 'Dry run' : 'Migration'} complete.`);
  console.table(counts);
  const byCode = warnings.reduce((acc, w) => ((acc[w.code] = (acc[w.code] || 0) + 1), acc), {});
  if (warnings.length) {
    console.log('Warnings by kind (details in migration-report.json):');
    console.table(byCode);
  }
  if (media.failures.length) {
    console.log(`\n${media.failures.length} file(s) could not be migrated (listed under "media" in migration-report.json):`);
    for (const f of media.failures.slice(0, 5)) console.log(`  ${f.url}\n    ${f.reason}`);
    if (media.failures.length > 5) console.log(`  … and ${media.failures.length - 5} more`);
  }
  console.log(`${links.redirects.length} redirect(s) → redirects.json`);
  if (dryRun) console.log(`Previews → ${previewDir}/<type>/<slug>.json`);
  if (failures.length) {
    console.log(`\n${failures.length} failure(s) — see migration-report.json`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
