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

const library = (strapi, items = [attachment()], extra = {}) =>
  new MediaLibrary({
    items,
    strapi,
    state: { media: {}, save() {} },
    siteUrl: 'http://wp.test',
    strapiUrl: 'http://localhost:1337',
    ...extra,
  });

const refuses = () => ({
  upload: async () => {
    throw new Error("POST /api/upload -> 400 File type 'image/svg+xml' is not allowed");
  },
  getFile: async () => null,
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

/**
 * Neuros has 18 SVGs. Repeating Strapi's raw rejection 18 times tells nobody what
 * to do about it, so the fix is said once per type while each file is still named.
 */
test('explains how to fix a refused type once, however many files hit it', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(4),
    headers: { get: () => 'image/svg+xml' },
  });
  const logs = [];
  const items = [attachment(), attachment({ id: 6, source_url: 'http://wp.test/wp-content/uploads/2024/05/mark.svg' })];
  const lib = library(refuses(), items, { log: (m) => logs.push(m) });

  await lib.ensureById(5);
  await lib.ensureById(6);

  const advice = logs.filter((l) => l.includes('--skip-types'));
  assert.equal(advice.length, 1, 'the remedy is stated once, not once per file');
  assert.match(advice[0], /image\/svg\+xml/);
  assert.equal(lib.failures.length, 2, 'but both files are still recorded');
  assert.ok(logs.some((l) => l.includes('logo.svg')) && logs.some((l) => l.includes('mark.svg')));
});

test('--skip-types gives up on a type before spending a download on it', async () => {
  let fetched = 0;
  let uploaded = 0;
  globalThis.fetch = async () => {
    fetched++;
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4), headers: { get: () => 'image/svg+xml' } };
  };
  const strapi = {
    upload: async () => {
      uploaded++;
      return { id: 1 };
    },
    getFile: async () => null,
  };
  const lib = library(strapi, [attachment()], { skipTypes: ['svg'] });

  assert.equal(await lib.ensureById(5), null);
  assert.equal(fetched, 0, 'nothing is downloaded for a type we already know is skipped');
  assert.equal(uploaded, 0);
  assert.equal(lib.failures.length, 1);
  assert.match(lib.failures[0].reason, /skip/i);
});

/**
 * Once entries migrate concurrently, two of them referencing the same attachment
 * arrive together. Both would miss the cache, both would download, and both would
 * upload — the same logo twice in the media library. Concurrent callers have to
 * share one upload.
 */
test('uploads a file once when two entries ask for it at the same time', async () => {
  let uploads = 0;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    await new Promise((r) => setTimeout(r, 5));
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(4), headers: { get: () => 'image/png' } };
  };
  const lib = library(
    {
      upload: async () => {
        uploads++;
        await new Promise((r) => setTimeout(r, 5));
        return { id: 42 };
      },
      getFile: async () => null,
    },
    [attachment({ mime_type: 'image/png', source_url: 'http://wp.test/wp-content/uploads/2024/05/logo.png' })]
  );

  const [a, b] = await Promise.all([lib.ensureById(5), lib.ensureById(5)]);
  assert.equal(uploads, 1, 'one upload, not two');
  assert.equal(fetches, 1, 'and one download');
  assert.equal(a.id, 42);
  assert.equal(b.id, 42, 'both callers get the same file');
});

test('a type that was not skipped still uploads', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(4),
    headers: { get: () => 'image/svg+xml' },
  });
  const lib = library({ upload: async () => ({ id: 9 }), getFile: async () => null }, [attachment()], { skipTypes: ['pdf'] });

  const file = await lib.ensureById(5);
  assert.equal(file.id, 9);
  assert.deepEqual(lib.failures, []);
});
