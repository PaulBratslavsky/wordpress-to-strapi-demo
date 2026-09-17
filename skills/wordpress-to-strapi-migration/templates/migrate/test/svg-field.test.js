import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertContent } from '../lib/content.js';

/**
 * Neuros stores each service's icon as inline <svg> markup in a custom field.
 * The analyzer typed it as Blocks ("contains HTML"), Blocks has no SVG node, and
 * all 21 icons arrived as null with no warning of any kind. Markup that carries
 * no prose is a string, not a rich-text body.
 */

const ctx = () => ({ richType: 'blocks', mediaIds: new Set(), library: { find: () => null }, postTypeOf: new Map() });

const SVG = '<svg viewBox="0 0 100 89" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M99 57L1 2z"/></svg>';

test('a field holding only markup is kept as text, not converted to Blocks', async () => {
  const { infer } = await import('../analyze.js');
  const f = infer('service_icon_svg', [SVG], ctx());
  assert.equal(f.type, 'text');
  assert.equal(f.transform, 'raw');
  assert.match(f.note, /no text/i);
});

test('HTML that does carry prose is still converted', async () => {
  const { infer } = await import('../analyze.js');
  const f = infer('summary', ['<p>Real words, <strong>marked up</strong>.</p>'], ctx());
  assert.equal(f.type, 'blocks');
  assert.equal(f.transform, 'content');
});

test('markup mixed with prose counts as prose', async () => {
  const { infer } = await import('../analyze.js');
  const f = infer('summary', [`${SVG}<p>Deep learning</p>`], ctx());
  assert.equal(f.type, 'blocks');
});

test('converting content that yields nothing reports it instead of dropping it', async () => {
  const { value, warnings } = await convertContent(SVG, { format: 'blocks' });
  const empty = !value || (Array.isArray(value) && value.length === 0);
  assert.ok(empty, 'Blocks genuinely cannot hold an SVG');
  assert.ok(
    warnings.some((w) => w.code === 'content-emptied'),
    `a field that had ${SVG.length} characters and produced nothing must warn; got ${JSON.stringify(warnings)}`
  );
});
