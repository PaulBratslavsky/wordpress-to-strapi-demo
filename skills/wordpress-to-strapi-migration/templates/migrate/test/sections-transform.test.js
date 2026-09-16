import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionsForEntry } from '../lib/sections.js';

test('prefers Elementor data when the entry has it', () => {
  const entry = {
    content: { rendered: '<p>fallback</p>' },
    migration_meta: {
      _elementor_data: JSON.stringify([
        {
          elType: 'container',
          elements: [{ elType: 'widget', widgetType: 'heading', settings: { title: 'From Elementor' } }],
        },
      ]),
    },
  };
  const { sections, source } = sectionsForEntry(entry, {});
  assert.equal(source, 'elementor');
  assert.match(sections[0].html, /From Elementor/);
});

test('falls back to the rendered HTML', () => {
  const { sections, source } = sectionsForEntry({ content: { rendered: '<p>Just prose</p>' } }, {});
  assert.equal(source, 'html');
  assert.equal(sections[0].kind, 'rich-text');
});
