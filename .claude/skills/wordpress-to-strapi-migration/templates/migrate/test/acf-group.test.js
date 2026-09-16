import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectFieldGroups } from '../analyze.js';

test('finds an ACF group from its flattened meta keys', () => {
  const groups = detectFieldGroups({
    client_name: 'Riverbend Coffee Roasters',
    results: '',
    results_headline: 'Wholesale orders up 40%',
    results_metric: '+40%',
    results_summary: 'Measured over the six months after launch.',
  });
  assert.deepEqual(groups, { results: ['headline', 'metric', 'summary'] });
});

test('a single prefixed sibling is not a group', () => {
  assert.deepEqual(detectFieldGroups({ project: '', project_year: '2024' }), {});
});

test('a parent that holds a value is a field, not a group', () => {
  assert.deepEqual(detectFieldGroups({ title: 'Hello', title_color: '#fff', title_size: '12' }), {});
});

test('several groups side by side', () => {
  const groups = detectFieldGroups({
    results: '',
    results_headline: 'a',
    results_metric: 'b',
    contact: '',
    contact_email: 'x@example.com',
    contact_phone: '555',
    contact_hours: '9-5',
  });
  assert.deepEqual(groups, { results: ['headline', 'metric'], contact: ['email', 'phone', 'hours'] });
});
