import 'dotenv/config';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WordPressClient, SKIP_TYPES, SKIP_TAXONOMIES, EXCLUDED_BY_DEFAULT, restRoute } from './lib/wordpress.js';
import { parseArgs, requireEnv } from './lib/util.js';
import { writeEntries, writeExport, exportProgress } from './lib/exportfile.js';

/**
 * EXPORT — snapshot a WordPress site into wp-export/export.json via the REST
 * API. Every later step (analyze, generate, migrate) reads this snapshot, so
 * the WordPress site can be slow, remote, or switched off by migration day.
 *
 *   node export.js [--out wp-export] [--types post,page,my_cpt] [--download-media]
 *
 * --types           export only these post types (also the way to opt in to
 *                   types skipped by default, like WooCommerce `product`)
 * --download-media  also save every media file to <out>/media/ so migrate.js
 *                   uploads from disk instead of fetching from WordPress
 * --fresh           re-export post types already on disk instead of resuming
 *
 * Entries are written one type at a time to <out>/entries/<type>.ndjson, so a
 * run that is interrupted resumes where it stopped, and no step has to parse a
 * single multi-gigabyte JSON string.
 */

const STATUSES = ['publish', 'future', 'draft', 'pending', 'private'];
const USER_FIELDS = ['id', 'name', 'slug', 'description', 'url', 'link', 'avatar_urls', 'meta', 'acf'];
const MEDIA_FIELDS = ['id', 'date_gmt', 'slug', 'status', 'link', 'title', 'alt_text', 'caption', 'mime_type', 'media_type', 'source_url', 'media_details', 'post'];

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const strip = ({ _links, _embedded, ...rest }) => rest;

async function fetchCollection(wp, route, params, label) {
  const items = await wp.all(route, params, {
    onPage: (page, total, n) => process.stdout.write(`\r  ${label}: page ${page}/${total} (${n})   `),
  });
  process.stdout.write(`\r  ${label}: ${items.length}${' '.repeat(24)}\n`);
  return items;
}

async function main() {
  const args = parseArgs(process.argv, ['download-media', 'fresh']);
  const out = args.out || 'wp-export';
  const wp = new WordPressClient({
    baseUrl: requireEnv('WP_URL'),
    user: process.env.WP_USER,
    appPassword: process.env.WP_APP_PASSWORD,
  });

  const index = await wp.discover();
  console.log(`WordPress: ${index.name} — ${index.home || index.url}  (REST via ${wp.mode === 'pretty' ? '/wp-json/' : '?rest_route='})`);

  if (wp.authenticated) {
    try {
      const me = await wp.whoAmI();
      console.log(`Authenticated as ${me.name} (${(me.roles || []).join(', ')})`);
    } catch (err) {
      console.error(
        `\nApplication Password rejected (${err.status}). WP_USER must be the login name, not the password's label.\n` +
          `WordPress only accepts Application Passwords over HTTPS or when WP_ENVIRONMENT_TYPE is 'local' (Local sets this).`
      );
      process.exit(1);
    }
  } else {
    console.log('Not authenticated — exporting published content only. Set WP_USER + WP_APP_PASSWORD for drafts, private posts and custom fields.');
  }
  const context = wp.authenticated ? 'edit' : 'view';

  let helper = null;
  if (index.namespaces?.includes('strapi-migration/v1')) {
    helper = (await wp.get('/strapi-migration/v1/info').catch(() => ({ json: { version: 'unknown' } }))).json;
    const forced = [...(helper.forced_post_types ?? []), ...(helper.forced_taxonomies ?? [])];
    console.log(`Strapi Migration Helper ${helper.version} active${forced.length ? ` — exposed hidden types: ${forced.join(', ')}` : ''}`);
  }

  // --- Post types -----------------------------------------------------------
  const allTypes = (await wp.get('/wp/v2/types', { context })).json;
  const only = args.types ? new Set(args.types.split(',').map((s) => s.trim())) : null;
  const types = {};
  const skipped = {};
  for (const [slug, t] of Object.entries(allTypes)) {
    if (SKIP_TYPES.has(slug) && !only?.has(slug)) continue;
    if (only ? !only.has(slug) : EXCLUDED_BY_DEFAULT[slug]) {
      skipped[slug] = EXCLUDED_BY_DEFAULT[slug] || 'not in --types';
      continue;
    }
    types[slug] = t;
  }

  const allTax = (await wp.get('/wp/v2/taxonomies', { context })).json;
  const usedTax = new Set(Object.values(types).flatMap((t) => t.taxonomies || []));
  const taxonomies = Object.fromEntries(
    Object.entries(allTax).filter(([slug]) => usedTax.has(slug) && !SKIP_TAXONOMIES.has(slug))
  );

  console.log('\nContent');
  const done = args.fresh ? {} : exportProgress(out);
  const entries = {};
  for (const [slug, t] of Object.entries(types)) {
    if (slug in done) {
      console.log(`  ${t.name} (${slug}): ${done[slug]} already exported, skipping (--fresh to redo)`);
      entries[slug] = null; // already on disk; writeExport keeps it
      continue;
    }
    const params = { context, orderby: 'id', order: 'asc', ...(wp.authenticated ? { status: STATUSES } : {}) };
    let items;
    try {
      items = (await fetchCollection(wp, restRoute(t), params, `${t.name} (${slug})`)).map(strip);
    } catch (err) {
      // Some custom REST controllers reject status/orderby/context=edit — retry with defaults.
      try {
        items = (await fetchCollection(wp, restRoute(t), { context: 'view' }, `${t.name} (${slug}, published only)`)).map(strip);
      } catch (err2) {
        console.warn(`  ! ${slug}: ${err2.message}`);
        items = [];
      }
    }
    // Written now, so an interrupted run resumes instead of starting again.
    writeEntries(out, slug, items);
    entries[slug] = items;
  }

  console.log('\nTaxonomies');
  const terms = {};
  for (const [slug, tax] of Object.entries(taxonomies)) {
    try {
      terms[slug] = (await fetchCollection(wp, restRoute(tax), { context, hide_empty: false, orderby: 'id' }, `${tax.name} (${slug})`)).map(strip);
    } catch (err) {
      console.warn(`  ! ${slug}: ${err.message}`);
      terms[slug] = [];
    }
  }

  console.log('\nPeople & media');
  let users = [];
  try {
    // Only public profile fields are kept — no emails, usernames or roles in the snapshot.
    users = (await fetchCollection(wp, '/wp/v2/users', { context, orderby: 'id' }, 'Users')).map((u) => pick(u, USER_FIELDS));
  } catch (err) {
    console.warn(`  ! users: ${err.message}`);
  }
  const media = (await fetchCollection(wp, '/wp/v2/media', { context, orderby: 'id', order: 'asc' }, 'Media')).map((m) =>
    pick(m, MEDIA_FIELDS)
  );

  let menus = null;
  if (wp.authenticated) {
    try {
      const list = await wp.all('/wp/v2/menus', { context });
      const items = await wp.all('/wp/v2/menu-items', { context });
      menus = { menus: list.map(strip), items: items.map(strip) };
      console.log(`  Menus: ${list.length} (${items.length} items)`);
    } catch (err) {
      console.warn(`  ! menus: ${err.message}`);
    }
  }
  let comments = null;
  try {
    comments = await wp.total('/wp/v2/comments');
    console.log(`  Comments: ${comments} (counted, not exported)`);
  } catch {
    /* comments closed or endpoint disabled */
  }

  mkdirSync(out, { recursive: true });

  if (args['download-media']) {
    console.log('\nDownloading media files');
    mkdirSync(path.join(out, 'media'), { recursive: true });
    let done = 0;
    for (const m of media) {
      const rel = path.join('media', `${m.id}-${decodeURIComponent(path.basename(new URL(m.source_url).pathname))}`);
      if (!existsSync(path.join(out, rel))) {
        const res = await fetch(m.source_url).catch(() => null);
        if (!res?.ok) {
          console.warn(`  ! ${m.source_url} (${res?.status ?? 'network error'})`);
          continue;
        }
        writeFileSync(path.join(out, rel), Buffer.from(await res.arrayBuffer()));
      }
      m.localFile = rel;
      process.stdout.write(`\r  ${++done}/${media.length}`);
    }
    process.stdout.write('\n');
  }

  const snapshot = {
    site: {
      name: index.name,
      description: index.description,
      url: index.url,
      home: index.home || index.url,
      restMode: wp.mode,
      authenticated: wp.authenticated,
      helper,
      exportedAt: new Date().toISOString(),
    },
    types,
    taxonomies,
    entries,
    terms,
    users,
    media,
    menus,
    stats: { comments, skippedTypes: skipped },
  };
  const file = writeExport(out, snapshot);
  const counts = exportProgress(out);

  console.log(`\nWrote ${file} and ${path.join(out, 'entries')}/*.ndjson`);
  console.table(
    Object.fromEntries([
      ...Object.entries(counts).map(([k, n]) => [k, { kind: 'post type', count: n }]),
      ...Object.entries(terms).map(([k, v]) => [k, { kind: 'taxonomy', count: v.length }]),
      ['users', { kind: 'people', count: users.length }],
      ['media', { kind: 'files', count: media.length }],
    ])
  );
  for (const [slug, why] of Object.entries(skipped)) console.log(`  skipped ${slug}: ${why}`);

  const hasMeta = Object.values(entries).some((list) => list.some((e) => e.migration_meta));
  if (!helper && wp.authenticated && !hasMeta) {
    console.log(
      '\nTip: no custom fields were exported, and post types registered without REST support are invisible.\n' +
        'If the site uses a commercial theme, Meta Box, or custom post types, install the\n' +
        'Strapi Migration Helper (Plugins > Add Plugin > Upload Plugin) and export again:\n' +
        'https://github.com/PaulBratslavsky/wordpress-to-strapi-demo/releases/latest/download/strapi-migration-helper.zip'
    );
  }
  console.log('\nNext: node analyze.js');
}

main().catch((err) => {
  console.error('\nExport failed:', err.message);
  process.exit(1);
});
