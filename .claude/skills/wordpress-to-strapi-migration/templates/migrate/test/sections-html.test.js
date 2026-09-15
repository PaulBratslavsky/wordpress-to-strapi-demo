import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToSections } from '../lib/sections.js';

test('collapses consecutive prose into one rich-text section', () => {
  const { sections } = htmlToSections('<p>One</p><h2>Two</h2><p>Three</p>');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].kind, 'rich-text');
  assert.match(sections[0].html, /One/);
  assert.match(sections[0].html, /Three/);
});

test('splits a table out of the prose around it', () => {
  const html =
    '<p>Before</p><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><p>After</p>';
  const { sections } = htmlToSections(html);
  assert.deepEqual(
    sections.map((s) => s.kind),
    ['rich-text', 'table', 'rich-text']
  );
  assert.deepEqual(sections[1].rows, [['A'], ['1']]);
  assert.equal(sections[1].hasHeader, true);
});

test('emits image, gallery, embed, code and quote sections', () => {
  const html = [
    '<figure class="wp-block-image"><img src="/a.jpg" alt="A"/><figcaption>Cap</figcaption></figure>',
    '<figure class="wp-block-gallery"><figure><img src="/b.jpg" alt="B"/></figure><figure><img src="/c.jpg" alt="C"/></figure></figure>',
    '<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">https://youtu.be/abc</div></figure>',
    '<pre><code class="language-js">const x = 1;</code></pre>',
    '<blockquote><p>Quoted</p><cite>Someone</cite></blockquote>',
  ].join('');
  const { sections } = htmlToSections(html);
  assert.deepEqual(
    sections.map((s) => s.kind),
    ['image', 'gallery', 'embed', 'code', 'quote']
  );
  assert.equal(sections[0].caption, 'Cap');
  assert.equal(sections[1].images.length, 2);
  assert.equal(sections[2].url, 'https://youtu.be/abc');
  assert.equal(sections[3].language, 'js');
  assert.equal(sections[4].attribution, 'Someone');
});
