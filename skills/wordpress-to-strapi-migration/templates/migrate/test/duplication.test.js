import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplicatedCollections } from '../lib/duplication.js';

/**
 * LaunchPad models a list-style section as a component holding a heading plus a
 * **relation** to a real collection, rather than copying the content inline. A
 * migrated WordPress page usually arrives with the copy: the "work" page repeats
 * its portfolio entries as text, and the migration has no way to know those are
 * the same six entries it just created as a collection.
 *
 * This only ever reports. Rewriting a page section into a relation means
 * deciding that some paragraph *is* a given entry, and a confident wrong guess
 * would replace real page content with a link to the wrong thing. So the
 * analyzer says what it noticed and a human decides.
 *
 * Both signals are taken from the real exports: Northfield's "work" page repeats
 * 5 of 6 portfolio titles, and Neuros builds its listings from Elementor widgets
 * that name the collection outright (`neuros_projects_listing`).
 */

const portfolio = {
  name: 'portfolio-item',
  titles: [
    'Riverbend Coffee Roasters',
    'Summit Trail Outfitters',
    'Harbor Family Clinic',
    'Maple Street Bakery',
    'Voltline Solar Dashboard',
    'Northwind Logistics',
  ],
};

const vacancy = { name: 'vacancy', titles: ['AI Research Scientist', 'Machine learning engineer'] };

test('flags a page that repeats several titles from one collection', () => {
  const text = 'Our work: Riverbend Coffee Roasters, Summit Trail Outfitters, Harbor Family Clinic and more.';
  const found = duplicatedCollections({ text }, [portfolio]);
  assert.equal(found.length, 1);
  assert.equal(found[0].type, 'portfolio-item');
  assert.equal(found[0].signal, 'titles');
  assert.equal(found[0].matched, 3);
  assert.equal(found[0].total, 6);
});

/** One mention is a sentence about a project, not a listing of them. */
test('ignores a single passing mention', () => {
  const text = 'We wrote about Riverbend Coffee Roasters last year, and it went well.';
  assert.deepEqual(duplicatedCollections({ text }, [portfolio]), []);
});

test('flags an Elementor listing widget even when the page text holds no titles', () => {
  const found = duplicatedCollections({ text: '', widgets: ['neuros_heading', 'neuros_projects_listing'] }, [
    { name: 'project', titles: ['Health CareIQ', 'Secure Shield'] },
  ]);
  assert.equal(found.length, 1);
  assert.equal(found[0].signal, 'widget');
  assert.equal(found[0].detail, 'neuros_projects_listing');
});

test('matches a widget whose name is plural or hyphenated', () => {
  const team = [{ name: 'team-member', titles: ['Alan Begham'] }];
  assert.equal(duplicatedCollections({ widgets: ['neuros_team_members'] }, team)[0]?.type, 'team-member');

  const study = [{ name: 'case-study', titles: ['Enhancing Financial Security'] }];
  assert.equal(duplicatedCollections({ widgets: ['neuros_case_study_listing'] }, study)[0]?.type, 'case-study');
});

test('says nothing about widgets that name no collection', () => {
  const widgets = ['neuros_heading', 'text-editor', 'image', 'counter', 'accordion'];
  assert.deepEqual(duplicatedCollections({ text: '', widgets }, [portfolio]), []);
});

test('reports a collection once, however many signals point at it', () => {
  const found = duplicatedCollections(
    { text: 'AI Research Scientist and Machine learning engineer', widgets: ['neuros_vacancy_listing'] },
    [vacancy]
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].type, 'vacancy');
});

test('finds several collections on one page', () => {
  const found = duplicatedCollections(
    { text: 'AI Research Scientist, Machine learning engineer', widgets: ['neuros_projects_listing'] },
    [vacancy, { name: 'project', titles: ['Health CareIQ'] }]
  );
  assert.deepEqual(found.map((f) => f.type).sort(), ['project', 'vacancy']);
});

test('an empty page has nothing to say', () => {
  assert.deepEqual(duplicatedCollections({}, [portfolio]), []);
  assert.deepEqual(duplicatedCollections({ text: 'Hello' }, []), []);
});

/** Short titles match too loosely to be evidence of anything. */
test('ignores titles too short to be distinctive', () => {
  const tiny = { name: 'tag-ish', titles: ['AI', 'ML', 'Data'] };
  assert.deepEqual(duplicatedCollections({ text: 'We use AI and ML on Data every day.' }, [tiny]), []);
});
