import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elementorToSections } from '../lib/sections.js';

const page = [
  {
    elType: 'container',
    elements: [
      { elType: 'widget', widgetType: 'heading', settings: { title: 'Big claim' } },
      { elType: 'widget', widgetType: 'text-editor', settings: { editor: '<p>Sub copy</p>' } },
      { elType: 'widget', widgetType: 'button', settings: { text: 'Start', link: { url: '/contact/' } } },
      { elType: 'widget', widgetType: 'image', settings: { image: { id: 42, url: 'http://old/x.jpg' } } },
    ],
  },
  {
    elType: 'section',
    elements: [
      {
        elType: 'column',
        elements: [
          {
            elType: 'widget',
            widgetType: 'icon-box',
            settings: {
              title_text: 'Fast',
              description_text: 'Loads quickly',
              selected_icon: { value: 'fas fa-bolt' },
            },
          },
          { elType: 'widget', widgetType: 'unknown-widget', settings: { nothing: true } },
        ],
      },
    ],
  },
];

test('first section with heading plus media becomes a hero', () => {
  const { sections } = elementorToSections(page);
  assert.equal(sections[0].kind, 'hero');
  assert.equal(sections[0].heading, 'Big claim');
  assert.equal(sections[0].label, 'Start');
  assert.equal(sections[0].url, '/contact/');
  assert.equal(sections[0].mediaId, 42);
});

test('maps known widgets and reports unknown ones', () => {
  const { sections, warnings } = elementorToSections(page);
  assert.deepEqual(
    sections.slice(1).map((s) => s.kind),
    ['feature']
  );
  assert.equal(sections[1].title, 'Fast');
  assert.equal(sections[1].icon, 'fas fa-bolt');
  assert.ok(warnings.some((w) => w.code === 'elementor-widget-skipped' && w.detail.includes('unknown-widget')));
});

test('accepts the raw JSON string WordPress stores', () => {
  const { sections } = elementorToSections(JSON.stringify(page));
  assert.equal(sections[0].kind, 'hero');
});
