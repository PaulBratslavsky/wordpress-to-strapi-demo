import 'dotenv/config';
import { loadJson, parseArgs, requireEnv, getPath } from './lib/util.js';
import { StrapiClient } from './lib/strapi.js';
import { itemsOf } from './lib/source.js';

/**
 * VERIFY — check Strapi against the export.
 *
 *   node verify.js [--config migration.config.json] [--export wp-export/export.json]
 *
 * Per type: document count vs. the export, entries whose content still points
 * at the old WordPress host (unconverted links/images), and media fields that
 * had a value in WordPress but are empty in Strapi. Exits 1 on any mismatch.
 */

// Fields that intentionally keep the old URL.
const KEEP_OLD_URLS = new Set(['wpLink', 'avatarUrl', 'website']);

/**
 * Count strings that still mention the old WordPress host, split in two.
 *
 * A media record carries its WordPress caption and alt text verbatim, and those
 * sometimes quote the file's old URL. That is the caption's content, not a link
 * still pointing at the old site, so it's counted separately rather than
 * reported as a migration problem. Fields in KEEP_OLD_URLS are skipped at every
 * depth, because populated relations carry their own wpLink.
 */
function oldHostHits(value, oldHost) {
  const hits = { content: 0, captions: 0 };
  const walk = (node, inMedia) => {
    if (Array.isArray(node)) return node.forEach((v) => walk(v, inMedia));
    if (node && typeof node === 'object') {
      const isMedia = Boolean(node.url && (node.mime || node.provider || node.ext));
      for (const [key, v] of Object.entries(node)) {
        if (KEEP_OLD_URLS.has(key)) continue;
        walk(v, inMedia || isMedia);
      }
      return;
    }
    if (typeof node === 'string' && node.includes(`//${oldHost}`)) hits[inMedia ? 'captions' : 'content'] += 1;
  };
  walk(value, false);
  return hits;
}

/**
 * Strapi v5 populates a dynamic zone per component, so a plain `populate=*`
 * leaves `sections` empty — and anything inside it would go unchecked.
 */
function populateFor(type) {
  const params = { populate: '*' };
  for (const [name, field] of Object.entries(type.fields ?? {})) {
    if (field.type !== 'dynamiczone') continue;
    for (const uid of field.components ?? []) params[`populate[${name}][on][${uid}][populate]`] = '*';
  }
  return params;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadJson(args.config || 'migration.config.json');
  const data = loadJson(args.export || config.source?.export || 'wp-export/export.json');
  const strapi = new StrapiClient({ baseUrl: process.env.STRAPI_URL || 'http://localhost:1337', token: requireEnv('STRAPI_API_TOKEN') });
  const oldHost = new URL(data.site.home).host;

  const rows = {};
  let problems = 0;
  for (const t of Object.values(config.types)) {
    // A single type holds one document with no per-entry counts to compare
    // against — navigation is reported by migrate.js as it writes it.
    if (t.kind === 'singleType') continue;
    const items = itemsOf(data, t);
    const byWpId = new Map(items.map((i) => [i.id, i]));
    const mediaFields = Object.entries(t.fields).filter(([, f]) => f.type === 'media');
    let actual = 0;
    let oldHostRefs = 0;
    let captionRefs = 0;
    let missingMedia = 0;
    for await (const doc of strapi.list(t.pluralName, populateFor(t))) {
      actual++;
      const hits = oldHostHits(doc, oldHost);
      if (hits.content) oldHostRefs++;
      if (hits.captions) captionRefs++;
      const item = byWpId.get(doc.wpId);
      for (const [name, f] of mediaFields) {
        const had = getPath(item, f.from);
        const hasNow = Array.isArray(doc[name]) ? doc[name].length : doc[name];
        if (had && !(Array.isArray(had) && !had.length) && !hasNow) missingMedia++;
      }
    }
    // A caption quoting an old URL is not a migration problem, so it doesn't fail the check.
    const ok = actual === items.length && !oldHostRefs && !missingMedia;
    if (!ok) problems++;
    rows[t.singularName] = { wordpress: items.length, strapi: actual, oldHostRefs, inCaptions: captionRefs, missingMedia, ok: ok ? '✓' : '✗' };
  }
  console.table(rows);
  if (problems) {
    console.log('oldHostRefs: entries whose content still contains the WordPress URL (search migration-report.json for file-link-missing / image-missing).');
    console.log('inCaptions: the URL appears inside a media caption or alt text, copied from WordPress. Not counted as a problem.');
    process.exitCode = 1;
  } else {
    console.log('Everything in the export is in Strapi.');
  }
}

main().catch((err) => {
  console.error('Verify failed:', err.message);
  process.exit(1);
});
