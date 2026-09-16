import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSince, changedSince, shouldHydrate } from '../lib/since.js';

/**
 * `--since` exists for the real cutover: migrate everything, then catch up on
 * whatever was written while you were doing it.
 *
 * Two things constrain it. WordPress gives `modified_gmt` on post-type entries
 * and on nothing else — terms and users carry no modification date in either
 * demo export — so taxonomies and authors always run, or an incremental pass
 * would create a post whose new category was never made. And a record with no
 * date is migrated rather than skipped: skipping something because its date is
 * missing is how content quietly goes absent.
 */

const entries = [
  { id: 1, slug: 'old-post', modified_gmt: '2024-02-19T17:20:28' },
  { id: 2, slug: 'fresh-post', modified_gmt: '2026-09-11T20:17:03' },
  { id: 3, slug: 'no-date-post' },
];

test('reads a plain date as the start of that day, UTC', () => {
  assert.equal(parseSince('2026-01-01').toISOString(), '2026-01-01T00:00:00.000Z');
});

test('reads a full timestamp as given', () => {
  assert.equal(parseSince('2026-09-11T20:00:00Z').toISOString(), '2026-09-11T20:00:00.000Z');
});

test('refuses something that is not a date, rather than silently migrating nothing', () => {
  assert.throws(() => parseSince('last tuesday'), /date/i);
});

test('keeps only entries modified after the cutoff', () => {
  const kept = changedSince(entries, parseSince('2026-01-01'), { kind: 'postType' });
  assert.deepEqual(kept.map((e) => e.slug), ['fresh-post', 'no-date-post']);
});

test('treats WordPress dates as UTC, matching modified_gmt', () => {
  const kept = changedSince(entries, parseSince('2024-02-19T17:30:00Z'), { kind: 'postType' });
  assert.deepEqual(kept.map((e) => e.slug), ['fresh-post', 'no-date-post']);
});

/** Terms and users have no modified date, so a cutoff cannot mean anything for them. */
test('never filters taxonomies or authors, which carry no modification date', () => {
  const terms = [{ id: 10, slug: 'design' }, { id: 11, slug: 'process' }];
  assert.equal(changedSince(terms, parseSince('2026-01-01'), { kind: 'taxonomy' }).length, 2);
  assert.equal(changedSince(terms, parseSince('2026-01-01'), { kind: 'users' }).length, 2);
});

test('no cutoff means everything, untouched', () => {
  assert.equal(changedSince(entries, null, { kind: 'postType' }), entries);
});

/**
 * Pass 2 resolves relation targets through the id map pass 1 filled in. The old
 * rule — hydrate from Strapi only when the map is empty — was right for `--only`
 * and wrong for anything that *narrows* a type: `--since` (and `--limit`) leave a
 * map holding just the few touched entries, so relations pointing at untouched
 * ones would resolve to nothing and be quietly dropped. Completeness is the
 * question, not emptiness.
 */
test('hydrates from Strapi when a type was not migrated at all', () => {
  assert.equal(shouldHydrate('category', { mapSize: 0, partial: new Set(), dryRun: false }), true);
});

test('hydrates when a type was only partly migrated this run', () => {
  assert.equal(shouldHydrate('post', { mapSize: 2, partial: new Set(['post']), dryRun: false }), true);
});

test('trusts the map when the type was migrated in full', () => {
  assert.equal(shouldHydrate('post', { mapSize: 9, partial: new Set(), dryRun: false }), false);
});

test('never reads from Strapi during a dry run', () => {
  assert.equal(shouldHydrate('post', { mapSize: 0, partial: new Set(['post']), dryRun: true }), false);
});
