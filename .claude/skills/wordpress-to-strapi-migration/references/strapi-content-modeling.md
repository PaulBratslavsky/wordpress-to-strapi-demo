# Shaping the Strapi model

Use this when deciding what the migrated content should look like on the Strapi side.
WordPress gives you posts, taxonomies and a pile of meta; Strapi has richer primitives, and
picking the right one is most of the work.

## The primitives

- **Collection type** — many entries of one shape (posts, services, authors). Has its own
  API and can be related to.
- **Single type** — exactly one entry site-wide (global settings, a navigation).
- **Component** — a reusable group of fields stored *inside* a parent. Repeatable or not.
  Not addressable on its own; its data is copied per parent.
- **Dynamic zone** — an ordered list of *mixed* components, so editors compose a page from
  varied sections.
- **Relation** — a link between collection types, one-way or two-way.
- **Fields** — `string`, `text`, `richtext` (Markdown), **`blocks`** (the native rich-text
  editor), `uid` (slugs), numbers, `boolean`, dates, `enumeration`, `json`, `email`, `media`.

## Choosing, for content coming from WordPress

| WordPress thing | Strapi |
|---|---|
| Post type | collection type |
| Taxonomy | collection type + `manyToMany` relation — not a text field |
| Author | collection type (not a Strapi admin user) |
| Post body, ordinary prose | **`blocks`** |
| Post body, page-builder page | **dynamic zone** of section components |
| A group of fields that repeats (an ACF Group, a list of experience entries) | component, repeatable when it's a list |
| ACF relationship / post object | relation |
| Site-wide settings, navigation | single type |
| Anything you'll filter or sort by | its own field, not buried in a component |

### What Strapi's own project does

Strapi's reference project, [LaunchPad](https://github.com/strapi/LaunchPad), is worth
copying:

- An article's body is **one `blocks` field**. Prose is prose.
- **Pages** get a dynamic zone with ~10 section components (hero, features, testimonials,
  pricing, FAQ, CTA).
- Articles also get a *small* trailing dynamic zone (related articles, CTA) — composition
  after the prose, not instead of it.
- List-style sections hold a heading plus a **relation** to a real collection (FAQ,
  testimonials, logos) instead of duplicating that content inline.
- One shared `seo` component on every routable type.

## The Blocks field, precisely

Strapi validates the value on write. Allowed nodes:

`paragraph`, `heading` (levels 1–6), `list` (nested lists allowed), `quote`, `code`,
`image`; inline: `text` with bold / italic / underline / strikethrough / code, and `link`.

Consequences worth knowing before you promise fidelity:

- **No table, divider, embed or gallery node.** Tables flatten to paragraphs, embeds become
  links, galleries become consecutive images. Use the Markdown mode to keep tables, or the
  dynamic-zone mode to keep all of it.
- **Image nodes need the whole media record** (url, width, height, hash, ext, mime, size,
  provider, timestamps), so media must be uploaded before bodies are converted.
- **Link URLs** must be absolute `http(s)`, `mailto:`, `tel:`, `ftp:`, or start with `/`.
  In-page anchors (`#section`) are not valid and become plain text.

The admin editor can be extended with custom block types (`addRichTextBlocks`), but the data
then only renders in front ends that know about them. Components are the portable option.

## Dynamic zones: the cost

- **Populate is per component.** `populate=*` will not fill a dynamic zone's contents:

  ```
  /api/pages?populate[sections][on][sections.hero][populate]=*
            &populate[sections][on][sections.rich-text][populate]=*
  ```

  Centralise that in a route middleware rather than repeating it in every front-end query.
- **Each component needs a renderer** in the front end, keyed by `__component`.
- **Zones get unwieldy past ~15 components**, and deeply nested components hurt query
  performance.
- **Dynamic zones can't nest** inside a component that is itself in a dynamic zone.

That is why the default here stays `blocks`, and the dynamic zone is opt-in per content type
where the evidence justifies it.

## A checklist for the review step

- Is every taxonomy a collection with a relation, rather than a string?
- Does each type have a `uid` slug, and does it match the old URL where you need redirects?
- Are ACF groups modelled as components rather than flattened siblings?
- Is anything you'll query by (a year, a client, a status) a real field?
- Do page-builder pages need sections, or would rebuilding them be honest and faster?
- Is `wpId` present on every type? It is what makes a re-run update instead of duplicate.
