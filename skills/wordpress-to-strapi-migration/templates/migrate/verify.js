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

async function main() {
  const args = parseArgs(process.argv);
  const config = loadJson(args.config || 'migration.config.json');
  const data = loadJson(args.export || config.source?.export || 'wp-export/export.json');
  const strapi = new StrapiClient({ baseUrl: process.env.STRAPI_URL || 'http://localhost:1337', token: requireEnv('STRAPI_API_TOKEN') });
  const oldHost = new URL(data.site.home).host;

  const rows = {};
  let problems = 0;
  for (const t of Object.values(config.types)) {
    const items = itemsOf(data, t);
    const byWpId = new Map(items.map((i) => [i.id, i]));
    const mediaFields = Object.entries(t.fields).filter(([, f]) => f.type === 'media');
    let actual = 0;
    let oldHostRefs = 0;
    let missingMedia = 0;
    for await (const doc of strapi.list(t.pluralName, { populate: '*' })) {
      actual++;
      const scanned = Object.fromEntries(Object.entries(doc).filter(([k]) => !KEEP_OLD_URLS.has(k)));
      if (JSON.stringify(scanned).includes(`//${oldHost}`)) oldHostRefs++;
      const item = byWpId.get(doc.wpId);
      for (const [name, f] of mediaFields) {
        const had = getPath(item, f.from);
        const hasNow = Array.isArray(doc[name]) ? doc[name].length : doc[name];
        if (had && !(Array.isArray(had) && !had.length) && !hasNow) missingMedia++;
      }
    }
    const ok = actual === items.length && !oldHostRefs && !missingMedia;
    if (!ok) problems++;
    rows[t.singularName] = { wordpress: items.length, strapi: actual, oldHostRefs, missingMedia, ok: ok ? '✓' : '✗' };
  }
  console.table(rows);
  if (problems) {
    console.log('oldHostRefs: entries whose fields still contain the WordPress URL (search migration-report.json for file-link-missing / image-missing).');
    process.exitCode = 1;
  } else {
    console.log('Everything in the export is in Strapi.');
  }
}

main().catch((err) => {
  console.error('Verify failed:', err.message);
  process.exit(1);
});
