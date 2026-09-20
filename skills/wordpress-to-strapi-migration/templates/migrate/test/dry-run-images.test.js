import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionsToZone } from '../lib/components.js';

/**
 * A dry run uploads nothing, so the media library hands back a stand-in with
 * id 0. `if (!id)` treated that 0 the same as a failed upload, so every image
 * section was dropped and warned about. One site's dry run reported 330
 * dropped images where the real run dropped 13.
 */

const ctxWith = (ensure) => {
  const warnings = [];
  return {
    ctx: {
      media: { ensure: async (ref) => ensure(ref) },
      warn: (code, detail) => warnings.push({ code, detail }),
      convertHtml: async (html) => ({ value: html, warnings: [] }),
    },
    warnings,
  };
};
const imageSection = [{ kind: 'image', src: 'http://wp.local/open-office.jpg', alt: 'Office', caption: '' }];

test('a dry run keeps its image sections instead of reporting them dropped', async () => {
  const { ctx, warnings } = ctxWith(() => ({ id: 0, dryRun: true }));
  const zone = await sectionsToZone(imageSection, ctx);

  assert.equal(zone.length, 1, 'the image section survives the dry run');
  assert.equal(zone[0].image, 0, 'the stand-in id is carried through; nothing is written in a dry run');
  assert.deepEqual(warnings, [], 'and nothing is reported as dropped');
});

test('an upload that really failed is still dropped and reported', async () => {
  const { ctx, warnings } = ctxWith(() => null);
  const zone = await sectionsToZone(imageSection, ctx);

  assert.equal(zone.length, 0);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'section-image-dropped');
  assert.match(warnings[0].detail, /open-office\.jpg/);
});
