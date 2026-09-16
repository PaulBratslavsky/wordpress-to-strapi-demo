/**
 * WordPress menus → the `navigation` single type.
 *
 * Menus were exported and then ignored, which left every migrated site without
 * its own navigation. They aren't content in the WordPress sense — they're one
 * document describing how the site is wired together — so they become a single
 * type holding every menu, rather than a collection.
 *
 * Two details matter. Items keep `parent` (the WordPress id of the item above,
 * `0` at the top level) instead of nesting components inside components, since a
 * Strapi component cannot contain itself and real menus nest arbitrarily deep.
 * And each item's URL is resolved through the same rewriter the content uses, so
 * a menu points at wherever the entry actually landed — but only when the link
 * is internal: rewriting resolves against the site URL, so an off-site link
 * would come back with its host quietly stripped.
 */

const label = (item) => item.title?.raw ?? item.title?.rendered ?? '';

const urlFor = (item, links) => {
  const url = item.url ?? '';
  if (!url || !links?.isInternal(url)) return url;
  return links.rewrite(url);
};

export function buildNavigation(menus, { links } = {}) {
  const list = menus?.menus ?? [];
  const items = menus?.items ?? [];
  if (!list.length) return null;

  return {
    menus: list.map((menu) => ({
      name: menu.name ?? '',
      slug: menu.slug ?? '',
      location: menu.locations?.[0] ?? null,
      items: items
        .filter((item) => item.menus === menu.id)
        .sort((a, b) => (a.menu_order ?? 0) - (b.menu_order ?? 0))
        .map((item) => ({
          label: label(item),
          url: urlFor(item, links),
          target: item.target || null,
          order: item.menu_order ?? 0,
          wpId: item.id,
          parent: item.parent ?? 0,
        })),
    })),
  };
}
