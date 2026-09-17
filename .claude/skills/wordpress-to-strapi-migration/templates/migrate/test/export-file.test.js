import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeExport, loadExport, writeEntries, exportProgress } from '../lib/exportfile.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'wpexport-'));

const snapshot = () => ({
  site: { name: 'Northfield', home: 'http://northfield.local' },
  types: { post: { name: 'Posts' }, portfolio_item: { name: 'Projects' } },
  taxonomies: { category: { name: 'Categories' } },
  entries: {
    post: [
      { id: 1, title: { rendered: 'One' } },
      { id: 2, title: { rendered: 'Two' }, content: { rendered: 'line one\nline two' } },
    ],
    portfolio_item: [{ id: 419, title: { rendered: 'Riverbend' } }],
  },
  terms: { category: [{ id: 7, name: 'Studio' }] },
  users: [{ id: 11, name: 'Jordan' }],
  media: [{ id: 30, source_url: 'http://northfield.local/a.jpg' }],
  menus: [],
  stats: { comments: 5 },
});

test('the manifest holds no entries, and each post type gets its own file', () => {
  const dir = tmp();
  writeExport(dir, snapshot());

  const manifest = JSON.parse(readFileSync(path.join(dir, 'export.json'), 'utf8'));
  assert.equal(manifest.entries, undefined, 'entries must not be inlined in the manifest');
  assert.deepEqual(manifest.entryCounts, { post: 2, portfolio_item: 1 });
  assert.deepEqual(manifest.site, snapshot().site);
  assert.deepEqual(manifest.terms, snapshot().terms);

  assert.ok(existsSync(path.join(dir, 'entries', 'post.ndjson')));
  assert.ok(existsSync(path.join(dir, 'entries', 'portfolio_item.ndjson')));

  const lines = readFileSync(path.join(dir, 'entries', 'post.ndjson'), 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, 2, 'one entry per line, whatever the entry contains');
  assert.equal(JSON.parse(lines[1]).content.rendered, 'line one\nline two');

  rmSync(dir, { recursive: true, force: true });
});

test('loading rebuilds exactly what was exported', () => {
  const dir = tmp();
  const original = snapshot();
  writeExport(dir, original);

  const loaded = loadExport(path.join(dir, 'export.json'));
  assert.deepEqual(loaded.entries, original.entries);
  assert.deepEqual(loaded.types, original.types);
  assert.deepEqual(loaded.users, original.users);
  assert.deepEqual(loaded.media, original.media);
  assert.deepEqual(loaded.stats, original.stats);

  rmSync(dir, { recursive: true, force: true });
});

test('only the requested types are read from disk', () => {
  const dir = tmp();
  writeExport(dir, snapshot());
  rmSync(path.join(dir, 'entries', 'portfolio_item.ndjson'));

  const loaded = loadExport(path.join(dir, 'export.json'), { only: ['post'] });
  assert.equal(loaded.entries.post.length, 2);
  assert.deepEqual(loaded.entries.portfolio_item, [], 'a type that was not asked for loads as empty');

  rmSync(dir, { recursive: true, force: true });
});

test('a missing entry file is an error, not a silently empty type', () => {
  const dir = tmp();
  writeExport(dir, snapshot());
  rmSync(path.join(dir, 'entries', 'post.ndjson'));

  assert.throws(() => loadExport(path.join(dir, 'export.json')), /post\.ndjson/);

  rmSync(dir, { recursive: true, force: true });
});

test('an old single-file export still loads', () => {
  const dir = tmp();
  const legacy = snapshot();
  writeFileSync(path.join(dir, 'export.json'), JSON.stringify(legacy));

  const loaded = loadExport(path.join(dir, 'export.json'));
  assert.deepEqual(loaded.entries, legacy.entries);

  rmSync(dir, { recursive: true, force: true });
});

test('a type written to disk survives a crash before the manifest', () => {
  const dir = tmp();
  writeEntries(dir, 'post', snapshot().entries.post);

  assert.deepEqual(exportProgress(dir), { post: 2 });
  assert.equal(existsSync(path.join(dir, 'export.json')), false, 'no manifest yet');

  // the next run sees what is already on disk and can skip it
  writeExport(dir, snapshot());
  assert.deepEqual(loadExport(path.join(dir, 'export.json')).entries.post, snapshot().entries.post);

  rmSync(dir, { recursive: true, force: true });
});

test('every script that reads the export goes through loadExport', () => {
  // verify.js once read export.json with loadJson. When entries moved into
  // per-type files it kept parsing the manifest, found no `entries`, and threw
  // "Cannot convert undefined or null to object" on a valid export.
  const dir = path.join(import.meta.dirname, '..');
  for (const script of ['export.js', 'analyze.js', 'migrate.js', 'verify.js', 'generate.js']) {
    const src = readFileSync(path.join(dir, script), 'utf8');
    const readsExport = /loadJson\([^)]*export/i.test(src);
    assert.equal(readsExport, false, `${script} parses the export itself; use loadExport so split exports work`);
  }
});
