import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeBodyMode } from '../analyze.js';

test('mostly page-builder entries get a dynamic zone', () => {
  assert.equal(proposeBodyMode({ items: 43, builderCount: 22, format: 'blocks' }), 'dynamic-zone');
  assert.equal(proposeBodyMode({ items: 21, builderCount: 21, format: 'blocks' }), 'dynamic-zone');
});

test('ordinary prose stays on blocks', () => {
  assert.equal(proposeBodyMode({ items: 9, builderCount: 0, format: 'blocks' }), 'blocks');
  assert.equal(proposeBodyMode({ items: 8, builderCount: 2, format: 'blocks' }), 'blocks');
});

test('the markdown format is never overridden', () => {
  assert.equal(proposeBodyMode({ items: 43, builderCount: 43, format: 'markdown' }), 'markdown');
});
