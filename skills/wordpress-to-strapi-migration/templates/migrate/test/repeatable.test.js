import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listShape, wrapsRow, componentLabel } from '../lib/repeatable.js';

/**
 * Repeating custom fields should become repeatable components rather than a
 * `json` blob nobody can edit in the admin.
 *
 * The fixtures are the real thing. Meta Box does not store "a list of objects"
 * as the plan assumed — it stores **positional arrays with no field names at
 * all**, so a component has to invent them. Names are only invented where the
 * shape is unmistakable (a URL, an icon class, a year range, a paragraph of
 * prose); everything else keeps its position as its name, so a reviewer can map
 * `field2` back to the second column and rename it. Guessing "company" and being
 * wrong puts a lie in the schema.
 */

const specialties = [['branding', 'ui', 'strategy'], ['frontend', 'backend', 'accessibility']];
const responsibilities = [['Modern trucks and cars', 'Network of warehouses', 'New techhologies']];
const experience = [
  [
    ['2012 - 2017', 'Microsoft Inc.', 'Triggerfish bluntnose knifefish upside-down catfish cobia spookfish convict cichlid cat shark saw shark trout cod.'],
    ['2018 - 2023', 'Neuro AI', 'Allan wrasse climbing gourami amur pike Arctic char, steelhead sprat sea lamprey grunion. Walleye poolfish sand goby butterfly.'],
  ],
];
const socials = [
  [
    ['fa-youtube', 'https://www.youtube.com/'],
    ['fa-linkedin-in', 'https://www.linkedin.com/'],
  ],
];
const boxes = [[['250+', 'Awesome team members']]];

test('a list of plain strings becomes a one-field repeatable', () => {
  const shape = listShape(specialties);
  assert.equal(shape.kind, 'scalar');
  assert.deepEqual(shape.columns, [{ name: 'value', type: 'string' }]);
});

test('the same holds for a single-entry sample', () => {
  assert.equal(listShape(responsibilities).kind, 'scalar');
});

test('names a column only when its shape is unmistakable', () => {
  const shape = listShape(socials);
  assert.equal(shape.kind, 'tuple');
  assert.deepEqual(shape.columns.map((c) => c.name), ['icon', 'url']);
});

test('keeps the position as the name when the column could be anything', () => {
  const shape = listShape(experience);
  assert.equal(shape.kind, 'tuple');
  // "2012 - 2017" is a year range, the last column is prose; the middle could be anything.
  assert.deepEqual(shape.columns.map((c) => c.name), ['period', 'field2', 'description']);
});

test('gives long prose a text field rather than a string', () => {
  const shape = listShape(experience);
  assert.equal(shape.columns[2].type, 'text');
  assert.equal(shape.columns[0].type, 'string');
});

test('falls back to positions entirely when nothing is recognisable', () => {
  const shape = listShape(boxes);
  assert.deepEqual(shape.columns.map((c) => c.name), ['field1', 'field2']);
});

test('reads named objects as the fields they already are', () => {
  const shape = listShape([[{ year: '2019', role: 'Designer' }, { year: '2021', role: 'Lead' }]]);
  assert.equal(shape.kind, 'object');
  assert.deepEqual(shape.columns.map((c) => c.name), ['year', 'role']);
});

/**
 * Lists of ids are relations, caught earlier by the analyzer. This returns null
 * as well, so a change of ordering cannot turn a relation into a component.
 */
test('refuses lists of ids, which are relations', () => {
  assert.equal(listShape([['419', '422'], ['423', '421']]), null);
});

test('refuses a shape it cannot describe', () => {
  assert.equal(listShape([['a', ['b'], { c: 1 }]]), null);
  assert.equal(listShape([[]]), null);
  assert.equal(listShape([]), null);
});

test('covers every column when rows are ragged', () => {
  const shape = listShape([[['a', 'b'], ['c', 'd', 'e']]]);
  assert.equal(shape.columns.length, 3);
});

/** The admin shows this label, so "ExperienceList" reads like a variable name. */
test('turns a field name into a readable component label', () => {
  assert.equal(componentLabel('experienceList'), 'Experience List');
  assert.equal(componentLabel('contactInfoItem'), 'Contact Info Item');
  assert.equal(componentLabel('specialties'), 'Specialties');
  assert.equal(componentLabel('team-specialties'), 'Team Specialties');
  assert.equal(componentLabel('team_member_boxes'), 'Team Member Boxes');
});

/**
 * Regression, caught on a fixture rather than by reasoning: a repeater with one
 * row was unwrapped like a wrapped scalar, so `[["250+", "Awesome team members"]]`
 * became a flat list and migrated as a single value, "250+,Awesome team members".
 */
test('knows a one-row repeater from a wrapped scalar', () => {
  assert.equal(wrapsRow([['250+', 'Awesome team members']]), true);
  assert.equal(wrapsRow([['2012 - 2017', 'Microsoft Inc.']]), true);
  assert.equal(wrapsRow(['just a string']), false);
  assert.equal(wrapsRow([{ id: 12, url: 'http://x/y.jpg' }]), false, 'an ACF image still unwraps');
  assert.equal(wrapsRow([]), false);
});
