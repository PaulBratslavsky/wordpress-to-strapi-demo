import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MediaLibrary } from '../lib/media.js';

const attachment = (over = {}) => ({
  id: 5,
  source_url: 'http://wp.test/wp-content/uploads/2024/05/logo.svg',
  mime_type: 'image/svg+xml',
  alt_text: '',
  title: { rendered: 'Logo' },
  caption: { rendered: '' },
  media_details: {},
  ...over,
});

const library = (strapi, items = [attachment()]) =>
  new MediaLibrary({
    items,
    strapi,
    state: { media: {}, save() {} },
    siteUrl: 'http://wp.test',
    strapiUrl: 'http://localhost:1337',
  });

test('a refused upload is recorded, not thrown', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(4),
    headers: { get: () => 'image/svg+xml' },
  });
  const lib = library({
    upload: async () => {
      throw new Error("POST /api/upload -> 400 File type 'image/svg+xml' is not allowed");
    },
    getFile: async () => null,
  });

  assert.equal(await lib.ensureById(5), null);
  assert.equal(lib.failures.length, 1);
  assert.equal(lib.failures[0].url, 'http://wp.test/wp-content/uploads/2024/05/logo.svg');
  assert.match(lib.failures[0].reason, /not allowed/);
});

test('a file that cannot be downloaded is recorded too', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404, headers: { get: () => null } });
  const lib = library({ upload: async () => ({ id: 1 }), getFile: async () => null });

  assert.equal(await lib.ensureById(5), null);
  assert.equal(lib.failures.length, 1);
  assert.match(lib.failures[0].reason, /404/);
});

test('the same file is only reported once', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404, headers: { get: () => null } });
  const lib = library({ upload: async () => ({ id: 1 }), getFile: async () => null });

  await lib.ensureById(5);
  await lib.ensureById(5);
  assert.equal(lib.failures.length, 1);
});
