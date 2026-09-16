import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWordPressHtml } from '../lib/html.js';

/**
 * Blocks cannot embed anything, so an iframe, video or audio player becomes a
 * link. It used to become a link whose text was the raw URL, which threw away
 * the only human description the embed had.
 *
 * The fixtures are real Neuros markup. Its contact page embeds a map titled
 * "London Eye, London, United Kingdom" and its home page a YouTube player titled
 * "Video Placeholder"; a reader who lands on `maps.google.com/maps?q=London%20Eye…`
 * has been given the URL and told nothing.
 */

/** `parseWordPressHtml` hands back the live `<body>` element; its markup is what we assert on. */
const body = (html) => parseWordPressHtml(html, { shortcodes: 'strip' }).body.innerHTML;

test('uses the embed title as the link text', () => {
  const html =
    '<iframe loading="lazy" src="https://maps.google.com/maps?q=London%20Eye&amp;output=embed" title="London Eye, London, United Kingdom"></iframe>';
  const out = body(html);
  assert.match(out, /London Eye, London, United Kingdom/);
  assert.match(out, /maps\.google\.com/, 'and still links to the source');
});

test('keeps the link pointing at the source', () => {
  const html = '<iframe title="Video Placeholder" src="https://www.youtube.com/embed/XHOmBV4js_E?feature=oembed"></iframe>';
  const out = body(html);
  assert.match(out, /href="https:\/\/www\.youtube\.com\/embed\/XHOmBV4js_E\?feature=oembed"/);
  assert.match(out, /Video Placeholder/);
});

test('falls back to the caption when there is no title', () => {
  const html =
    '<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">https://vimeo.com/123</div><figcaption>Our studio tour</figcaption></figure>';
  assert.match(body(html), /Our studio tour/);
});

/**
 * With neither, name the provider — "View on YouTube" beats a query string.
 * Matched case-sensitively and as element text, because the bare URL contains
 * "youtube.com" and would satisfy a looser assertion without the feature.
 */
test('names the provider when nothing describes the embed', () => {
  const html = '<iframe src="https://www.youtube.com/embed/abc123"></iframe>';
  const out = body(html);
  assert.match(out, />[^<]*YouTube[^<]*</, 'the link text names the provider rather than repeating the URL');
  assert.match(out, /href="https:\/\/www\.youtube\.com\/embed\/abc123"/);
});

test('an audio player keeps its file link', () => {
  const html = '<audio src="http://neuros.local/wp-content/uploads/2024/05/audio_sample.mp3"></audio>';
  const out = body(html);
  assert.match(out, /audio_sample\.mp3/);
});

/**
 * Neuros's home-5 has 34 audio players, none of them titled. Without a label
 * that page migrates as 34 copies of the same raw URL. A file's own name is not
 * invented information, so it is a fair thing to show.
 */
test('labels a direct media file with its filename', () => {
  const out = body('<audio src="http://neuros.local/wp-content/uploads/2024/05/audio_sample.mp3"></audio>');
  assert.match(out, />audio_sample\.mp3</, 'the link text is the filename, not the whole URL');
  assert.match(out, /href="http:\/\/neuros\.local\/wp-content\/uploads\/2024\/05\/audio_sample\.mp3"/);
});

test('leaves an ordinary page URL alone rather than calling it a file', () => {
  const out = body('<iframe src="https://example.com/some/page"></iframe>');
  assert.match(out, />https:\/\/example\.com\/some\/page</);
});

test('a video poster survives as an image, so the page is not left blank', () => {
  const html = '<video src="http://neuros.local/clip.mp4" poster="http://neuros.local/still.jpg" title="Launch film"></video>';
  const out = body(html);
  assert.match(out, /still\.jpg/, 'the poster frame is kept');
  assert.match(out, /Launch film/);
});

test('an embed with no source at all is dropped rather than left empty', () => {
  const out = body('<p>Before</p><iframe></iframe><p>After</p>');
  assert.match(out, /Before/);
  assert.match(out, /After/);
  assert.doesNotMatch(out, /<iframe/);
});

test('still reports what it converted', () => {
  const { warnings } = parseWordPressHtml(
    '<iframe title="A map" src="https://maps.google.com/maps?q=x&amp;output=embed"></iframe>',
    { shortcodes: 'strip' }
  );
  assert.ok(warnings.some((w) => w.code === 'iframe'));
});
