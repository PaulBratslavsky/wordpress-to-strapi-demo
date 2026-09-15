import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StrapiClient } from '../lib/strapi.js';

/**
 * Two WordPress sites both number their posts from 1, so matching on `wpId`
 * alone would make one site's post 42 update the other's. Entries also carry
 * `wpSite` (the source host), and the lookup matches on the pair.
 */

function clientWithSpy() {
  const client = new StrapiClient({ baseUrl: 'http://localhost:1337', token: 'test' });
  const seen = [];
  client.request = async (path) => {
    seen.push(path);
    return { data: [] };
  };
  return { client, seen };
}

test('matches on wpId and the source site together', async () => {
  const { client, seen } = clientWithSpy();
  await client.findByWpId('posts', 42, 'neuros.local');
  assert.match(seen[0], /filters%5BwpId%5D%5B%24eq%5D=42/);
  assert.match(seen[0], /filters%5BwpSite%5D%5B%24eq%5D=neuros.local/);
});

test('falls back to wpId alone when no site is given', async () => {
  const { client, seen } = clientWithSpy();
  await client.findByWpId('posts', 42);
  assert.match(seen[0], /filters%5BwpId%5D%5B%24eq%5D=42/);
  assert.doesNotMatch(seen[0], /wpSite/);
});

test('finds entries migrated before wpSite existed, rather than duplicating them', async () => {
  const { client, seen } = clientWithSpy();
  await client.findByWpId('posts', 42, 'neuros.local');
  assert.equal(seen.length, 2, 'should try the site-scoped match, then the ones with no site');
  assert.match(seen[1], /filters%5BwpSite%5D%5B%24null%5D=true/);
});
