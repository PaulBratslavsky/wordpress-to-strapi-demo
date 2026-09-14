import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadJson, parseArgs, kebab } from './lib/util.js';
import { SECTION_COMPONENTS } from './lib/components.js';

/**
 * GENERATE — write Strapi v5 content types (and components) from
 * migration.config.json. Deterministic: same config → same schema.
 *
 *   node generate.js --out <strapi-project> [--config migration.config.json] [--js] [--force]
 *
 * TypeScript vs JavaScript is detected from the project (tsconfig.json); --js
 * forces JavaScript. A TS project silently drops stray .js files from its
 * build, so the extension has to match. Content types that already exist are
 * left untouched unless --force, since they may hold your own changes.
 */

const snake = (s) => kebab(s).replace(/-/g, '_');
const FIELD_TYPES = new Set([
  'string', 'text', 'richtext', 'blocks', 'uid', 'integer', 'biginteger', 'decimal', 'float', 'boolean',
  'date', 'datetime', 'time', 'email', 'json', 'enumeration', 'media', 'relation', 'component', 'dynamiczone',
]);

// Components the analyzer can reference.
const COMPONENTS = {
  'shared.seo': {
    collectionName: 'components_shared_seos',
    info: { displayName: 'SEO', icon: 'search', description: 'Search and social metadata (migrated from Yoast)' },
    options: {},
    attributes: {
      metaTitle: { type: 'string' },
      metaDescription: { type: 'text' },
      canonicalUrl: { type: 'string' },
      noIndex: { type: 'boolean', default: false },
      ogImage: { type: 'media', multiple: false, allowedTypes: ['images'] },
    },
  },
  // Section components, for types whose bodies migrate into a dynamic zone.
  ...Object.fromEntries(Object.entries(SECTION_COMPONENTS).map(([uid, entry]) => [uid, entry.schema])),
};

export function attribute(field) {
  switch (field.type) {
    case 'dynamiczone':
      // An empty list means "whatever the catalogue offers".
      return {
        type: 'dynamiczone',
        components: field.components?.length ? field.components : Object.keys(SECTION_COMPONENTS),
      };
    case 'uid':
      return { type: 'uid', ...(field.targetField && { targetField: field.targetField }) };
    case 'media':
      return { type: 'media', multiple: Boolean(field.multiple), allowedTypes: ['images', 'files', 'videos', 'audios'] };
    case 'relation':
      return { type: 'relation', relation: field.relation, target: `api::${field.target}.${field.target}` };
    case 'component':
      return { type: 'component', repeatable: Boolean(field.repeatable), component: field.component };
    case 'enumeration':
      return { type: 'enumeration', enum: field.enum };
    default:
      return { type: field.type };
  }
}

function schemaFor(t) {
  return {
    kind: 'collectionType',
    collectionName: snake(t.pluralName),
    info: {
      singularName: t.singularName,
      pluralName: t.pluralName,
      displayName: t.displayName,
      description: `Migrated from WordPress (${t.source.kind}${t.source.slug ? `: ${t.source.slug}` : ''})`,
    },
    options: { draftAndPublish: true },
    pluginOptions: {},
    attributes: Object.fromEntries(Object.entries(t.fields).map(([name, f]) => [name, attribute(f)])),
  };
}

function validate(config) {
  const errors = [];
  const types = config.types || {};
  for (const t of Object.values(types)) {
    if (t.singularName === t.pluralName) errors.push(`${t.singularName}: singularName and pluralName must differ`);
    for (const [name, f] of Object.entries(t.fields)) {
      if (!FIELD_TYPES.has(f.type)) errors.push(`${t.singularName}.${name}: unknown field type "${f.type}"`);
      if (f.type === 'relation' && !types[f.target]) errors.push(`${t.singularName}.${name}: relation target "${f.target}" is not a type in the config`);
      if (f.type === 'component' && !COMPONENTS[f.component]) errors.push(`${t.singularName}.${name}: component "${f.component}" has no definition in generate.js`);
      if (f.type === 'enumeration' && !Array.isArray(f.enum)) errors.push(`${t.singularName}.${name}: enumeration needs an "enum" array`);
      if (f.type === 'dynamiczone') {
        for (const uid of f.components ?? []) {
          if (!COMPONENTS[uid]) errors.push(`${t.singularName}.${name}: component "${uid}" has no definition in generate.js`);
        }
      }
    }
  }
  return errors;
}

function writeType(root, t, ext, force) {
  const base = path.join(root, 'src', 'api', t.singularName);
  const schemaFile = path.join(base, 'content-types', t.singularName, 'schema.json');
  if (existsSync(schemaFile) && !force) return false;

  for (const dir of [path.dirname(schemaFile), path.join(base, 'controllers'), path.join(base, 'routes'), path.join(base, 'services')]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(schemaFile, JSON.stringify(schemaFor(t), null, 2) + '\n');

  const uid = `api::${t.singularName}.${t.singularName}`;
  const factory = (fn) =>
    ext === 'ts'
      ? `import { factories } from '@strapi/strapi';\n\nexport default factories.${fn}('${uid}');\n`
      : `'use strict';\n\nconst { factories } = require('@strapi/strapi');\n\nmodule.exports = factories.${fn}('${uid}');\n`;
  writeFileSync(path.join(base, 'controllers', `${t.singularName}.${ext}`), factory('createCoreController'));
  writeFileSync(path.join(base, 'routes', `${t.singularName}.${ext}`), factory('createCoreRouter'));
  writeFileSync(path.join(base, 'services', `${t.singularName}.${ext}`), factory('createCoreService'));
  return true;
}

function writeComponent(root, uid, def) {
  const [category, name] = uid.split('.');
  const file = path.join(root, 'src', 'components', category, `${name}.json`);
  if (existsSync(file)) {
    const existing = JSON.parse(readFileSync(file, 'utf8'));
    const missing = Object.keys(def.attributes).filter((a) => !existing.attributes?.[a]);
    if (missing.length) console.warn(`  ! component ${uid} already exists without: ${missing.join(', ')} — add them or those values will be dropped`);
    else console.log(`  = component ${uid} (exists)`);
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(def, null, 2) + '\n');
  console.log(`  + component ${uid}`);
}

/** Every component uid the config needs, from component fields and dynamic zones alike. */
export function componentsInUse(config) {
  const uids = new Set();
  for (const t of Object.values(config.types ?? {})) {
    for (const f of Object.values(t.fields ?? {})) {
      if (f.type === 'component') uids.add(f.component);
      if (f.type === 'dynamiczone') {
        (f.components?.length ? f.components : Object.keys(SECTION_COMPONENTS)).forEach((uid) => uids.add(uid));
      }
    }
  }
  return [...uids];
}

function main() {
  const a = parseArgs(process.argv, ['js', 'force']);
  if (!a.out) {
    console.error('Usage: node generate.js --out <strapi-project> [--config migration.config.json] [--js] [--force]');
    process.exit(1);
  }
  if (!existsSync(path.join(a.out, 'package.json')) || !readFileSync(path.join(a.out, 'package.json'), 'utf8').includes('@strapi/strapi')) {
    console.error(`${a.out} doesn't look like a Strapi project (no @strapi/strapi in package.json).`);
    process.exit(1);
  }
  const config = loadJson(a.config || 'migration.config.json');
  const errors = validate(config);
  if (errors.length) {
    console.error('Config problems — fix migration.config.json first:\n  ' + errors.join('\n  '));
    process.exit(1);
  }

  const ext = a.js || !existsSync(path.join(a.out, 'tsconfig.json')) ? 'js' : 'ts';
  let written = 0;
  for (const t of Object.values(config.types)) {
    if (writeType(a.out, t, ext, a.force)) {
      console.log(`  + ${t.singularName}  (/api/${t.pluralName})`);
      written++;
    } else {
      console.log(`  = ${t.singularName} exists — skipped (use --force to overwrite)`);
    }
  }
  for (const uid of componentsInUse(config)) writeComponent(a.out, uid, COMPONENTS[uid]);

  console.log(`\nGenerated ${written} content type(s) into ${path.join(a.out, 'src')} (.${ext}).`);
  console.log('`strapi develop` reloads on its own when the files appear — no restart needed. Then run migrate.js.');
}

// Run only as a CLI: the tests import attribute and componentsInUse from this file.
if (/generate\.js$/.test(process.argv[1] ?? '')) main();
