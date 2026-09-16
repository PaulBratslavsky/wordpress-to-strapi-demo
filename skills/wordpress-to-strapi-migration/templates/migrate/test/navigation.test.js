import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNavigation } from '../lib/navigation.js';
import { schemaFor, componentsInUse } from '../generate.js';
import { routeFor } from '../lib/preflight.js';

/**
 * Menus were exported and then ignored. They become a `navigation` single type:
 * one entry holding every menu, each with its items in order, each item's URL
 * resolved to wherever that content landed in Strapi.
 *
 * The fixtures mirror the demo site: two menus, two levels of nesting, and the
 * three kinds of item WordPress produces (a page, a taxonomy archive, and a
 * custom link pointing off-site).
 */

const menus = [
  { id: 113, name: 'Main Menu', slug: 'main-menu', locations: ['primary'] },
  { id: 114, name: 'Footer Menu', slug: 'footer-menu', locations: ['footer'] },
];

const items = [
  { id: 445, title: { raw: 'Work' }, url: 'http://northfield.local/work/', type: 'post_type', object: 'page', object_id: 407, parent: 0, menu_order: 2, target: '', menus: 113 },
  { id: 442, title: { raw: 'Home' }, url: 'http://northfield.local/', type: 'post_type', object: 'page', object_id: 406, parent: 0, menu_order: 1, target: '', menus: 113 },
  { id: 446, title: { raw: 'Design articles' }, url: 'http://northfield.local/category/design/', type: 'taxonomy', object: 'category', object_id: 12, parent: 445, menu_order: 1, target: '', menus: 113 },
  { id: 460, title: { raw: 'Follow us' }, url: 'https://social.example/northfield-studio', type: 'custom', object: 'custom', parent: 0, menu_order: 3, target: '_blank', menus: 113 },
  { id: 450, title: { raw: 'Privacy Policy' }, url: 'http://northfield.local/privacy-policy/', type: 'post_type', object: 'page', object_id: 413, parent: 0, menu_order: 1, target: '', menus: 114 },
];

/** Stands in for LinkRewriter: /work/ moved, everything else internal kept its path. */
const links = {
  isInternal: (href) => href.startsWith('http://northfield.local'),
  rewrite: (href) => (href.includes('/work/') ? '/projects/' : new URL(href).pathname),
};

test('groups items under the menu they belong to', () => {
  const nav = buildNavigation({ menus, items }, { links });
  assert.equal(nav.menus.length, 2);
  const main = nav.menus.find((m) => m.slug === 'main-menu');
  assert.equal(main.name, 'Main Menu');
  assert.equal(main.location, 'primary');
  assert.equal(main.items.length, 4);
  assert.equal(nav.menus.find((m) => m.slug === 'footer-menu').items.length, 1);
});

test('puts the items in the order WordPress gave them', () => {
  const main = buildNavigation({ menus, items }, { links }).menus.find((m) => m.slug === 'main-menu');
  assert.deepEqual(
    main.items.filter((i) => !i.parent).map((i) => i.label),
    ['Home', 'Work', 'Follow us']
  );
});

test('resolves an internal link to where the content now lives', () => {
  const main = buildNavigation({ menus, items }, { links }).menus.find((m) => m.slug === 'main-menu');
  assert.equal(main.items.find((i) => i.label === 'Work').url, '/projects/');
});

/** Rewriting resolves against the site URL, so an off-site link would lose its host. */
test('leaves an external link exactly as it was', () => {
  const main = buildNavigation({ menus, items }, { links }).menus.find((m) => m.slug === 'main-menu');
  const external = main.items.find((i) => i.label === 'Follow us');
  assert.equal(external.url, 'https://social.example/northfield-studio');
  assert.equal(external.target, '_blank');
});

test('keeps nesting as a parent reference, since a component cannot contain itself', () => {
  const main = buildNavigation({ menus, items }, { links }).menus.find((m) => m.slug === 'main-menu');
  const child = main.items.find((i) => i.label === 'Design articles');
  assert.equal(child.parent, 445);
  assert.equal(child.wpId, 446);
  assert.equal(main.items.find((i) => i.label === 'Home').parent, 0);
});

test('a site with no menus produces nothing to write', () => {
  assert.equal(buildNavigation({ menus: [], items: [] }, { links }), null);
  assert.equal(buildNavigation(undefined, { links }), null);
});

test('generates navigation as a single type, and everything else as a collection', () => {
  const nav = schemaFor({
    kind: 'singleType',
    singularName: 'navigation',
    pluralName: 'navigations',
    displayName: 'Navigation',
    source: { kind: 'menus' },
    fields: { menus: { type: 'component', component: 'navigation.menu', repeatable: true } },
  });
  assert.equal(nav.kind, 'singleType');
  assert.deepEqual(nav.attributes.menus, { type: 'component', repeatable: true, component: 'navigation.menu' });

  const post = schemaFor({
    singularName: 'post',
    pluralName: 'posts',
    displayName: 'Post',
    source: { kind: 'postType', slug: 'post' },
    fields: { title: { type: 'string' } },
  });
  assert.equal(post.kind, 'collectionType');
});

test('a single type is probed at its singular route', () => {
  assert.equal(routeFor({ kind: 'singleType', singularName: 'navigation', pluralName: 'navigations' }), 'navigation');
  assert.equal(routeFor({ singularName: 'post', pluralName: 'posts' }), 'posts');
});

/**
 * Regression: the first generated schema wrote navigation.menu without
 * navigation.link, which is the component holding its items — Strapi cannot
 * load a component that references one it hasn't been given.
 */
test('writes the components that a component itself depends on', () => {
  const cfg = {
    types: {
      navigation: {
        kind: 'singleType',
        singularName: 'navigation',
        pluralName: 'navigations',
        fields: { menus: { type: 'component', component: 'navigation.menu', repeatable: true } },
      },
    },
  };
  const used = componentsInUse(cfg);
  assert.ok(used.includes('navigation.menu'));
  assert.ok(used.includes('navigation.link'), 'navigation.menu holds its items in navigation.link');
});
