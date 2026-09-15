import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkConfig, checkStrapi } from '../lib/preflight.js';

const config = {
  types: {
    post: {
      singularName: 'post',
      pluralName: 'posts',
      fields: {
        title: { type: 'string', from: 'title', transform: 'text' },
        author: { type: 'relation', relation: 'manyToOne', target: 'author', from: 'author' },
      },
    },
    author: { singularName: 'author', pluralName: 'authors', fields: { name: { type: 'string', from: 'name' } } },
  },
  components: {},
};

test('a config whose relations all resolve has nothing to report', () => {
  assert.deepEqual(checkConfig(config), []);
});

test('names a relation target that is not in the config', () => {
  const broken = {
    types: {
      post: {
        singularName: 'post',
        pluralName: 'posts',
        fields: { author: { type: 'relation', relation: 'manyToOne', target: 'ghost', from: 'author' } },
      },
    },
  };
  const errors = checkConfig(broken);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ghost/);
});

test('names a dynamic-zone component that has no definition', () => {
  const broken = {
    types: {
      page: {
        singularName: 'page',
        pluralName: 'pages',
        fields: { content: { type: 'dynamiczone', components: ['sections.rich-text', 'sections.nope'], from: 'content' } },
      },
    },
    components: {},
  };
  assert.match(checkConfig(broken)[0], /sections\.nope/);
});

test('names an unknown transform', () => {
  const broken = {
    types: {
      post: { singularName: 'post', pluralName: 'posts', fields: { title: { type: 'string', from: 'title', transform: 'wizardry' } } },
    },
  };
  assert.match(checkConfig(broken)[0], /wizardry/);
});

test('reports content types that do not exist in Strapi yet', async () => {
  const probe = async (plural) => (plural === 'authors' ? 404 : 200);
  assert.deepEqual(await checkStrapi(config, probe), ['authors']);
});

test('says nothing when every type is there', async () => {
  assert.deepEqual(await checkStrapi(config, async () => 200), []);
});

/**
 * Regression: the first live run rejected every valid config, because the
 * analyzer's pass-through transform wasn't in the known list. The check is only
 * useful if it stays silent on the configs the analyzer actually writes.
 */
test("accepts every transform the analyzer emits, including the pass-through", () => {
  const emitted = [
    'raw', 'text', 'excerpt', 'content', 'sections', 'group', 'site', 'slug',
    'date-gmt', 'datetime', 'date-ymd', 'number', 'boolean', 'media', 'seo-yoast',
  ];
  const fields = Object.fromEntries(emitted.map((tr) => [tr.replace(/-/g, ''), { type: 'string', from: 'x', transform: tr }]));
  const cfg = { types: { post: { singularName: 'post', pluralName: 'posts', fields } } };
  assert.deepEqual(checkConfig(cfg), []);
});
