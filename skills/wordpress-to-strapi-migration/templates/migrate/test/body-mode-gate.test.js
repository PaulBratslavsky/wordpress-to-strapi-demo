import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBodyMode } from '../lib/bodymode.js';
import { checkStrapi, probeWith } from '../lib/preflight.js';

/**
 * The review step both SKILL.md and the tutorial point at says: set `bodyMode`
 * per type in migration.config.json, then generate. That did nothing, because
 * analyze.js baked the body field's shape and generate.js never looked at
 * bodyMode again. An end-to-end run found it.
 */

const pageWith = (content, bodyMode) => ({
  singularName: 'page',
  pluralName: 'pages',
  bodyMode,
  fields: { title: { type: 'string', from: 'title' }, content },
});

const blocks = { type: 'blocks', from: 'content', transform: 'content' };
const zone = { type: 'dynamiczone', components: [], from: 'content', transform: 'sections' };

test('bodyMode dynamic-zone turns a Blocks body into a dynamic zone', () => {
  const t = pageWith({ ...blocks }, 'dynamic-zone');
  const changed = applyBodyMode(t);

  assert.equal(t.fields.content.type, 'dynamiczone');
  assert.equal(t.fields.content.transform, 'sections');
  assert.equal(t.fields.content.from, 'content');
  assert.ok(changed, 'reports the change so generate.js can print it');
});

test('bodyMode blocks turns a dynamic zone back into a Blocks field', () => {
  const t = pageWith({ ...zone }, 'blocks');
  assert.ok(applyBodyMode(t));

  assert.equal(t.fields.content.type, 'blocks');
  assert.equal(t.fields.content.transform, 'content');
  assert.equal(t.fields.content.components, undefined);
});

test('bodyMode markdown gives a richtext body', () => {
  const t = pageWith({ ...zone }, 'markdown');
  assert.ok(applyBodyMode(t));
  assert.equal(t.fields.content.type, 'richtext');
  assert.equal(t.fields.content.transform, 'content');
});

test('a body that already matches bodyMode is left alone', () => {
  const t = pageWith({ ...zone, components: ['sections.hero'] }, 'dynamic-zone');
  assert.equal(applyBodyMode(t), false);
  assert.deepEqual(t.fields.content.components, ['sections.hero'], 'a hand-picked component list survives');
});

test('a type with no body field, or no bodyMode, is untouched', () => {
  const noBody = { singularName: 'tag', pluralName: 'tags', bodyMode: 'dynamic-zone', fields: { name: { type: 'string' } } };
  assert.equal(applyBodyMode(noBody), false);

  const noMode = pageWith({ ...blocks }, undefined);
  assert.equal(applyBodyMode(noMode), false);
  assert.equal(noMode.fields.content.type, 'blocks');
});

test('an unknown bodyMode is reported, not silently ignored', () => {
  const t = pageWith({ ...blocks }, 'dynamiczone'); // the Strapi word, not the config's
  assert.throws(() => applyBodyMode(t), /dynamiczone/);
});

/**
 * Preflight refused to start on any site with menus: an empty single type
 * answers 404, exactly like a type Strapi does not serve, and migrate.js is
 * what creates the first navigation document.
 */

const navConfig = {
  types: {
    navigation: { kind: 'singleType', singularName: 'navigation', pluralName: 'navigation', fields: {} },
    post: { singularName: 'post', pluralName: 'posts', fields: {} },
  },
};

const fakeStrapi = ({ status, allow, optionsFails = false }) => ({
  baseUrl: 'http://localhost:1337',
  async request(path) {
    const route = path.split('?')[0].replace('/api/', '');
    const code = status[route] ?? 404;
    if (code === 200) return { data: [] };
    const err = new Error(`GET ${path} -> ${code}`);
    err.status = code;
    throw err;
  },
  async allowedMethods(path) {
    if (optionsFails) throw new Error('OPTIONS not supported');
    return allow[path.replace('/api/', '')] ?? ['HEAD', 'GET'];
  },
});

test('an empty single type does not count as missing', async () => {
  const probe = probeWith(
    fakeStrapi({
      status: { posts: 200, navigation: 404 },
      allow: { posts: ['HEAD', 'GET', 'POST'], navigation: ['HEAD', 'GET', 'PUT', 'DELETE'] },
    })
  );
  assert.deepEqual(await checkStrapi(navConfig, probe), []);
});

test('a type Strapi really does not serve is still reported', async () => {
  const probe = probeWith(
    fakeStrapi({ status: { posts: 200, navigation: 404 }, allow: { posts: ['HEAD', 'GET', 'POST'] } })
  );
  assert.deepEqual(await checkStrapi(navConfig, probe), ['navigation']);
});

test('a missing collection is still reported when OPTIONS is unavailable', async () => {
  const probe = probeWith(fakeStrapi({ status: { posts: 404, navigation: 404 }, allow: {}, optionsFails: true }));
  assert.deepEqual(await checkStrapi(navConfig, probe), ['posts'], 'single types are let through, collections are not');
});

/**
 * Applying bodyMode in generate.js alone was worse than not applying it: Strapi
 * got a dynamic zone while migrate.js still sent Blocks, and every page failed
 * with "__component is a required field". Every script must load the config
 * through the same door.
 */
test('loadConfig applies bodyMode, and every script uses it', async () => {
  const { loadConfig } = await import('../lib/config.js');
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;

  const dir = mkdtempSync(path.join(tmpdir(), 'cfg-'));
  const file = path.join(dir, 'migration.config.json');
  writeFileSync(file, JSON.stringify({ types: { page: pageWith({ ...blocks }, 'dynamic-zone') } }));

  const seen = [];
  const config = loadConfig(file, { onChange: (t, c) => seen.push(`${t.singularName}.${c.field}`) });
  assert.equal(config.types.page.fields.content.type, 'dynamiczone');
  assert.deepEqual(seen, ['page.content']);
  rmSync(dir, { recursive: true, force: true });

  const root = path.join(import.meta.dirname, '..');
  for (const script of ['generate.js', 'migrate.js', 'verify.js']) {
    const src = readFileSync(path.join(root, script), 'utf8');
    assert.match(src, /loadConfig\(/, `${script} must load the config through loadConfig`);
    assert.doesNotMatch(src, /loadJson\([^)]*config/i, `${script} still loads the config raw, so bodyMode would not apply`);
  }
});
