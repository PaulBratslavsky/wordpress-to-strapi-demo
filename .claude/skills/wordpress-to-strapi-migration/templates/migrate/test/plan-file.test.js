import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMarkdown } from '../lib/plan.js';

const data = {
  site: { name: 'Demo Studio', home: 'http://demo.local' },
  entries: { post: [{ id: 1 }, { id: 2 }], page: [{ id: 3 }] },
  terms: { category: [{ id: 10 }] },
  users: [{ id: 1 }],
};

const config = {
  source: { url: 'http://demo.local' },
  content: { format: 'blocks' },
  types: {
    post: {
      singularName: 'post',
      pluralName: 'posts',
      displayName: 'Post',
      source: { kind: 'postType', slug: 'post' },
      bodyMode: 'blocks',
      fields: {
        title: { type: 'string', from: 'title', transform: 'text' },
        categories: { type: 'relation', relation: 'manyToMany', target: 'category', from: 'categories' },
      },
    },
    category: {
      singularName: 'category',
      pluralName: 'categories',
      displayName: 'Category',
      source: { kind: 'taxonomy', slug: 'category' },
      fields: { name: { type: 'string', from: 'name', transform: 'text' } },
      ignoredMeta: { header_color: 'looks like a theme layout/display setting' },
    },
  },
};

test('writes a plan a reviewer can read', () => {
  const md = planMarkdown(config, data, ['post: 2 entries contain tables']);
  assert.match(md, /^# Migration plan/m);
  assert.match(md, /Demo Studio/);
  assert.match(md, /\/api\/posts/);
  assert.match(md, /\/api\/categories/);
});

test('shows each field with its source and Strapi type', () => {
  const md = planMarkdown(config, data, []);
  assert.match(md, /title/);
  assert.match(md, /relation .*category/);
  assert.match(md, /blocks/); // the body mode
});

test('carries the decisions and the ignored keys through', () => {
  const md = planMarkdown(config, data, ['post: 2 entries contain tables']);
  assert.match(md, /2 entries contain tables/);
  assert.match(md, /header_color/);
});

test('counts entries per type from the export', () => {
  const md = planMarkdown(config, data, []);
  assert.match(md, /\b2\b/); // two posts
  assert.match(md, /\b1\b/); // one category
});

/**
 * Regression: `wpSite` is filled in from the site being migrated rather than read
 * from a WordPress field, and the first real plan printed "undefined" for it.
 */
test('names the transform for a field with no WordPress source', () => {
  const cfg = {
    types: {
      post: {
        singularName: 'post',
        pluralName: 'posts',
        displayName: 'Post',
        source: { kind: 'postType', slug: 'post' },
        fields: { wpSite: { type: 'string', transform: 'site' } },
      },
    },
  };
  const md = planMarkdown(cfg, data, []);
  assert.doesNotMatch(md, /undefined/);
  assert.match(md, /_site_/);
});
