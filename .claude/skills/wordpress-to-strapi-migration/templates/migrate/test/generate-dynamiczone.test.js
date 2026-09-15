import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attribute, componentsInUse } from '../generate.js';
import { SECTION_COMPONENTS } from '../lib/components.js';

test('a dynamiczone field becomes a Strapi dynamiczone attribute', () => {
  const attr = attribute({ type: 'dynamiczone', components: ['sections.rich-text', 'sections.table'] });
  assert.deepEqual(attr, { type: 'dynamiczone', components: ['sections.rich-text', 'sections.table'] });
});

test('an empty component list falls back to the whole catalogue', () => {
  const attr = attribute({ type: 'dynamiczone', components: [] });
  assert.deepEqual(attr.components, Object.keys(SECTION_COMPONENTS));
});

test('componentsInUse collects both section and normal components', () => {
  const config = {
    types: {
      page: {
        fields: {
          sections: { type: 'dynamiczone', components: ['sections.hero'] },
          seo: { type: 'component', component: 'shared.seo' },
        },
      },
    },
  };
  assert.deepEqual(componentsInUse(config).sort(), ['sections.hero', 'shared.seo']);
});
