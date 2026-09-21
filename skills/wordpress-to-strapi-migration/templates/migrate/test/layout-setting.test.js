import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLayoutSetting } from '../analyze.js';

/**
 * Neuros stores each team member's job title in `team_member_position`. The
 * word "position" put it with the theme's layout settings, and every job title
 * was dropped without a warning.
 */

test('a layout-named key holding different phrases is content', () => {
  const titles = ['CEO Neuro', 'HR Neuro', 'HR Neuro', 'CEO Neuro', 'AI Programmer', 'Manager'];
  assert.equal(isLayoutSetting('team_member_position', titles), false);
});

test('layout-named keys holding flags and tokens are still settings', () => {
  assert.equal(isLayoutSetting('header_position', ['left', 'right', 'left']), true);
  assert.equal(isLayoutSetting('page_title_status', ['on', 'off', 'on']), true);
  assert.equal(isLayoutSetting('content_width', ['1200px', '960px']), true);
  assert.equal(isLayoutSetting('sidebar_hide', [true, false]), true);
});

test('one phrase repeated on every entry is still a setting', () => {
  assert.equal(isLayoutSetting('footer_style', ['Dark footer', 'Dark footer', 'Dark footer']), true);
});

test('a key not named like a setting is never one', () => {
  assert.equal(isLayoutSetting('job_title', ['left', 'right']), false);
});
