import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTION_COMPONENTS, componentsFor, sectionsToZone } from '../lib/components.js';

const ctx = {
  media: { ensure: async (ref) => (ref ? { id: 7, url: '/uploads/x.jpg' } : null) },
  convertHtml: async (html) => ({
    value: [{ type: 'paragraph', children: [{ type: 'text', text: html }] }],
    warnings: [],
  }),
};

test('catalogue schemas are valid Strapi components', () => {
  for (const [uid, entry] of Object.entries(SECTION_COMPONENTS)) {
    assert.match(uid, /^sections\.[a-z-]+$/);
    assert.ok(entry.schema.collectionName.startsWith('components_sections_'));
    assert.ok(Object.keys(entry.schema.attributes).length > 0);
  }
});

test('componentsFor lists only what the sections need', () => {
  assert.deepEqual(
    componentsFor([
      { kind: 'rich-text', html: '' },
      { kind: 'table', rows: [] },
    ]).sort(),
    ['sections.rich-text', 'sections.table']
  );
});

test('sectionsToZone builds a dynamic zone payload with resolved media', async () => {
  const zone = await sectionsToZone(
    [
      { kind: 'rich-text', html: '<p>Hi</p>' },
      { kind: 'image', src: '/a.jpg', alt: 'A', caption: 'C' },
      { kind: 'table', rows: [['A'], ['1']], hasHeader: true, caption: '' },
    ],
    ctx
  );
  assert.deepEqual(
    zone.map((c) => c.__component),
    ['sections.rich-text', 'sections.image', 'sections.table']
  );
  assert.equal(zone[1].image, 7);
  assert.deepEqual(zone[2].rows, [['A'], ['1']]);
  assert.equal(zone[0].body[0].type, 'paragraph');
});
