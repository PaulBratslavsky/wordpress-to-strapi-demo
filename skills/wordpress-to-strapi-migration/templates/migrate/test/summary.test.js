import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryMarkdown } from '../lib/summary.js';

/**
 * `migration-report.json` records everything and reads like nothing. The summary
 * answers the three questions someone actually has after a run: what moved, what
 * broke, and which entries should I go look at — with each warning code said in
 * words, because "table-flattened ×4" only means something if you already know.
 */

const report = {
  finishedAt: '2026-09-14T20:36:25.715Z',
  dryRun: false,
  counts: { post: 9, page: 8, author: 4 },
  failures: [
    { type: 'page', wpId: 41, slug: 'about', error: 'content[0].heading must be at most 255 characters' },
    { type: 'post', wpId: 12, pass: 'relations', error: 'Invalid relation' },
  ],
  media: [{ url: 'http://demo.local/logo.svg', reason: "File type 'image/svg+xml' is not allowed" }],
  warnings: [
    { type: 'post', wpId: 433, slug: 'new-studio-space', code: 'table-flattened', detail: '1 table(s)' },
    { type: 'post', wpId: 437, slug: 'five-accessibility-fixes', code: 'table-flattened', detail: '2 table(s)' },
    { type: 'post', wpId: 433, slug: 'new-studio-space', code: 'iframe', detail: 'https://youtube.com/embed/x' },
    { type: 'page', wpId: 50, slug: 'home', code: 'some-future-code', detail: 'whatever' },
  ],
};

test('leads with what moved', () => {
  const md = summaryMarkdown(report);
  assert.match(md, /^# Migration summary/m);
  assert.match(md, /\bpost\b/);
  assert.match(md, /\b9\b/);
  assert.match(md, /21/); // 9 + 8 + 4 entries in total
});

test('names the entries that failed, with enough to find them', () => {
  const md = summaryMarkdown(report);
  assert.match(md, /about/);
  assert.match(md, /41/);
  assert.match(md, /at most 255 characters/);
  assert.match(md, /relations/); // the pass a failure happened in
});

test('groups warnings by kind and counts them', () => {
  const md = summaryMarkdown(report);
  assert.match(md, /table-flattened/);
  assert.match(md, /2/); // two entries hit it
});

test('says what a warning means, not just its code', () => {
  const md = summaryMarkdown(report);
  assert.match(md, /table/i);
  assert.match(md, /paragraph|markdown|dynamic.zone/i);
});

test('degrades gracefully for a code it has no explanation for', () => {
  const md = summaryMarkdown(report);
  assert.match(md, /some-future-code/);
  assert.doesNotMatch(md, /undefined/);
});

test('names the entries behind a warning so they can be checked', () => {
  const md = summaryMarkdown(report);
  assert.match(md, /new-studio-space/);
  assert.match(md, /five-accessibility-fixes/);
});

test('lists files that could not be migrated, with the reason', () => {
  const md = summaryMarkdown(report);
  assert.match(md, /logo\.svg/);
  assert.match(md, /not allowed/);
});

test('a clean run says so instead of leaving empty sections', () => {
  const md = summaryMarkdown({
    finishedAt: '2026-09-14T20:36:25.715Z',
    dryRun: false,
    counts: { post: 9 },
    failures: [],
    media: [],
    warnings: [],
  });
  assert.doesNotMatch(md, /undefined/);
  assert.match(md, /nothing|clean|no failures/i);
});

test('counts the menus that moved, which are not entries', () => {
  const md = summaryMarkdown({ ...report, navigation: { menus: 2, items: 11 } });
  assert.match(md, /Navigation: 2 menus, 11 items/);
});

test('says nothing about navigation when the site had no menus', () => {
  const md = summaryMarkdown({ ...report, navigation: null });
  assert.doesNotMatch(md, /Navigation:/);
});

test('a dry run is unmistakable, so nobody thinks content moved', () => {
  const md = summaryMarkdown({ ...report, dryRun: true });
  assert.match(md, /dry run/i);
  assert.match(md, /nothing was written|not written|no changes/i);
});
