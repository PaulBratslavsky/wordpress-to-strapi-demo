/**
 * Pages that repeat a collection, the LaunchPad way round.
 *
 * Strapi's reference project models a list-style section as a component holding
 * a heading plus a **relation** to a real collection. A migrated WordPress page
 * arrives with the opposite: the "work" page holds its portfolio entries as
 * copy, and nothing connects that copy to the six entries the migration just
 * created as a collection. The result is a site that has the same content twice
 * and no way to know it.
 *
 * This only reports. Rewriting a section into a relation means deciding that a
 * given paragraph *is* a given entry, and a confident wrong guess replaces real
 * page content with a link to the wrong thing — so the analyzer says what it
 * noticed, in the plan, and a person decides.
 *
 * Two signals, each covering the other's blind spot:
 *
 *   - **Titles.** Several of a collection's titles appearing in one page's text.
 *     Works whatever built the page, including plain HTML.
 *   - **Widgets.** A page builder's own listing widget, which names the
 *     collection outright (`neuros_projects_listing`). Precise, but only exists
 *     where the page was built with a builder.
 */

/** A title has to be long enough that finding it in prose means something. */
const MIN_TITLE = 8;

/** Enough matches to be a listing rather than a sentence mentioning one entry. */
const MIN_MATCHES = 2;

const singular = (word) => word.replace(/s$/i, '');
const tokens = (value) =>
  String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map(singular);

/** A widget names a collection when every word of the collection's name is in it. */
function widgetNaming(widget, collections) {
  const words = new Set(tokens(widget));
  return collections.find((c) => {
    const needed = tokens(c.name);
    return needed.length > 0 && needed.every((w) => words.has(w));
  });
}

function titleMatches(text, collection) {
  const distinctive = (collection.titles ?? []).filter((t) => String(t ?? '').trim().length >= MIN_TITLE);
  const matched = new Set(distinctive.filter((t) => text.includes(t)));
  return { matched: matched.size, total: (collection.titles ?? []).length, distinctive: distinctive.length };
}

/**
 * Which collections a page appears to be duplicating.
 *
 * `page` is `{ text, widgets }`; `collections` is `[{ name, titles }]` — the
 * caller passes every type *except* the page's own.
 */
export function duplicatedCollections(page = {}, collections = [], { minMatches = MIN_MATCHES } = {}) {
  const text = String(page.text ?? '');
  const widgets = page.widgets ?? [];
  const found = new Map();

  // The precise signal first, so it wins where both fire.
  for (const widget of widgets) {
    const collection = widgetNaming(widget, collections);
    if (!collection || found.has(collection.name)) continue;
    const { matched, total } = titleMatches(text, collection);
    found.set(collection.name, { type: collection.name, signal: 'widget', detail: widget, matched, total });
  }

  for (const collection of collections) {
    if (found.has(collection.name)) continue;
    const { matched, total, distinctive } = titleMatches(text, collection);
    if (!distinctive || matched < minMatches) continue;
    found.set(collection.name, { type: collection.name, signal: 'titles', detail: '', matched, total });
  }

  return [...found.values()];
}
