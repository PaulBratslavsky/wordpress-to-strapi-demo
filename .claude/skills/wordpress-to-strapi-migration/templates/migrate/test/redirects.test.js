import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LinkRewriter } from '../lib/links.js';

/**
 * Redirects exist for the URLs a migration silently changes.
 *
 * `urlPattern: null` means "keep WordPress's URLs", and mostly that holds. But
 * a Strapi uid must be ASCII and unique per type, so some slugs cannot survive
 * the trip: an accented slug is transliterated, and a slug that collides with
 * another entry's gets suffixed. Those URLs change whether anyone asked or not,
 * which is exactly when a site quietly loses its inbound links — so the new path
 * has to follow the final slug, not the old one.
 */

const rewriter = () => new LinkRewriter({ siteUrl: 'http://demo.local' });

test('a slug that survived intact needs no redirect', () => {
  const links = rewriter();
  links.add({ link: 'http://demo.local/hello-world/', id: 1, slug: 'hello-world', pattern: null, isPost: true });
  assert.deepEqual(links.redirects, []);
});

test('redirects a slug that had to be transliterated', () => {
  const links = rewriter();
  links.add({ link: 'http://demo.local/cafe-resume-accented/', id: 1, slug: 'cafe-resume', pattern: null, isPost: true });
  assert.deepEqual(links.redirects, [
    { source: '/cafe-resume-accented/', destination: '/cafe-resume/', permanent: true },
  ]);
});

test('redirects a slug that was de-duplicated, keeping the rest of the path', () => {
  const links = rewriter();
  links.add({ link: 'http://demo.local/team/alex/', id: 2, slug: 'alex-2', pattern: null, isPost: false });
  assert.deepEqual(links.redirects, [{ source: '/team/alex/', destination: '/team/alex-2/', permanent: true }]);
});

test('internal links to a renamed entry resolve to where it actually lives', () => {
  const links = rewriter();
  links.add({ link: 'http://demo.local/team/alex/', id: 2, slug: 'alex-2', pattern: null, isPost: false });
  assert.equal(links.rewrite('http://demo.local/team/alex/'), '/team/alex-2/');
});

test('a urlPattern still decides the new path', () => {
  const links = rewriter();
  links.add({ link: 'http://demo.local/hello-world/', id: 3, slug: 'hello-world', pattern: '/blog/{slug}', isPost: true });
  assert.deepEqual(links.redirects, [{ source: '/hello-world/', destination: '/blog/hello-world', permanent: true }]);
});

test('a pattern and a changed slug agree on the final slug', () => {
  const links = rewriter();
  links.add({ link: 'http://demo.local/cafe-resume-accented/', id: 4, slug: 'cafe-resume', pattern: '/blog/{slug}', isPost: true });
  assert.equal(links.redirects[0].destination, '/blog/cafe-resume');
});

/** Drafts have no public URL to redirect from, and the front page isn't a slug. */
test('drafts and the front page produce no redirect', () => {
  const links = rewriter();
  links.add({ link: 'http://demo.local/?p=123', id: 123, slug: 'a-draft', pattern: null, isPost: true });
  links.add({ link: 'http://demo.local/', id: 6, slug: 'home', pattern: null, isPost: false });
  assert.deepEqual(links.redirects, []);
});

test('a draft is still reachable by its ?p= link', () => {
  const links = rewriter();
  // The id in the permalink is the entry's own id — that pairing is what makes the lookup work.
  links.add({ link: 'http://demo.local/?p=123', id: 123, slug: 'a-draft', pattern: null, isPost: true });
  assert.equal(links.rewrite('http://demo.local/?p=123'), '/a-draft/');
});
