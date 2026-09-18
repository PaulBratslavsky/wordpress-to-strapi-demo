import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elementorToSections } from '../lib/sections.js';

/**
 * Shapes taken from the Neuros theme's own Elementor data, where a re-run found
 * three faults: a theme video widget vanished, a Google Map vanished, and
 * typography settings were glued into headings.
 */
const page = (widgetType, settings) => [
  { elType: 'section', elements: [{ elType: 'column', elements: [{ elType: 'widget', widgetType, settings }] }] },
];
const run = (data) => elementorToSections(JSON.stringify(data));

test('a theme video widget becomes an embed, not a skipped widget', () => {
  const { sections } = run(
    page('neuros_video_button', {
      youtube_url: 'https://www.youtube.com/watch?v=XHOmBV4js_E',
      vimeo_url: 'https://vimeo.com/235215203',
      button_text: 'Watch video',
      icon_bg_background: 'classic',
    })
  );
  const embed = sections.find((s) => s.kind === 'embed');
  assert.ok(embed, `expected an embed, got ${JSON.stringify(sections.map((s) => s.kind))}`);
  assert.equal(embed.url, 'https://www.youtube.com/watch?v=XHOmBV4js_E', 'the first real video URL wins');
});

test('a Google Map becomes an embed rather than disappearing', () => {
  const { sections } = run(page('google_maps', { address: '1 Infinite Loop, Cupertino', zoom: { size: 10 } }));
  const embed = sections.find((s) => s.kind === 'embed');
  assert.ok(embed, `expected an embed, got ${JSON.stringify(sections.map((s) => s.kind))}`);
  assert.match(embed.url, /maps/i);
  assert.match(embed.title, /Infinite Loop/);
});

test('typography settings are not glued into heading text', () => {
  const { sections } = run(
    page('neuros_heading', {
      title: '<p>Unleashing the Potential of Artificial Intelligence</p>',
      subtitle: 'This is subheading element',
      title_typography_typography: 'custom',
      title_typography_font_weight: '600',
      content_letter_spacing: '0.5',
    })
  );
  const text = sections.map((s) => s.html ?? '').join(' ');
  assert.match(text, /Unleashing the Potential/);
  assert.doesNotMatch(text, /custom/, 'a typography enum is not prose');
  assert.doesNotMatch(text, /600/);
});

test('a widget with nothing readable is still reported, not silently dropped', () => {
  const { sections, warnings } = run(page('neuros_divider', { gap: '20', style: 'solid' }));
  assert.equal(sections.length, 0);
  assert.ok(warnings.some((w) => w.code === 'elementor-widget-skipped'));
});

test('a link is not a video', () => {
  // Elementor's own button widget is a call to action.
  const own = run(page('button', { text: 'Read more', link: { url: 'http://example.com/services/' } }));
  assert.deepEqual(own.sections.map((s) => s.kind), ['cta']);

  // A theme's button falls back to its prose. Either way it must not become an
  // embed: keying on `link` turned every call to action into a video.
  const theme = run(page('neuros_button', { text: 'Read more', link: { url: 'http://example.com/services/' } }));
  assert.ok(!theme.sections.some((s) => s.kind === 'embed'), JSON.stringify(theme.sections));
});
