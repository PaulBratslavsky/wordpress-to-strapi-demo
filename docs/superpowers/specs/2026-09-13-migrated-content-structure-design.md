# Structuring migrated content in Strapi

**Status:** approved 2026-09-13. Implements P1 of
[`skill-improvement-plan.md`](../../skill-improvement-plan.md).

## Problem

Every WordPress body currently becomes one Strapi **Blocks** field. That is right for
prose and wrong for everything else:

- Blocks has no table, embed, gallery or divider node, so those flatten. Measured on the
  demo sites: 4 entries with tables, 4 with galleries, 2 with embeds, 61 audio players.
- Page-builder pages lose their structure entirely. On Neuros that is 22 of 43 pages, 21 of
  21 services and 8 of 8 case studies, all built with Elementor.
- The structure is available. Elementor stores its sections and widgets as JSON in
  `_elementor_data`; we flatten its *rendered HTML* instead.

Strapi models this properly with components and dynamic zones, and its own reference
project does exactly that: prose in a `blocks` field, page composition in a dynamic zone.

## Decision

Two lanes, chosen per content type.

| Lane | For | Field |
|---|---|---|
| **Blocks** (default) | article-style prose: posts, services, team, testimonials | `content: blocks` |
| **Dynamic zone** | page-builder pages, and prose-with-structure when the evidence says so | `sections: dynamiczone` |
| **Markdown** (existing) | when tables matter more than structure | `content: richtext` |

`markdown` stays as-is and is not discussed further here.

The analyzer proposes the lane from evidence it already gathers, writes it into
`migration.config.json` as `bodyMode`, and the reviewer confirms it before anything is
generated. Nothing switches lanes silently.

**Proposal rule:** a type whose entries are more than half page-builder-built → `dynamic-zone`.
Otherwise → `blocks`. The reviewer can override per type.

## Components

One category, `sections`, generated only when some type uses the dynamic-zone lane.

| Component | Fields | Source |
|---|---|---|
| `sections.rich-text` | `body: blocks` | runs of ordinary prose; the fallback for anything unrecognised |
| `sections.image` | `image: media`, `caption: string`, `alt: string` | a standalone image |
| `sections.gallery` | `images: media (multiple)`, `caption: string` | WordPress gallery blocks, `[gallery]` |
| `sections.embed` | `url: string`, `provider: string`, `title: string` | oEmbed figures, iframes, video/audio players |
| `sections.table` | `rows: json`, `caption: string`, `hasHeader: boolean` | `<table>` |
| `sections.code` | `code: text`, `language: string` | `<pre><code>` |
| `sections.quote` | `quote: text`, `attribution: string` | blockquotes and pullquotes |
| `sections.cta` | `heading: string`, `text: text`, `label: string`, `url: string` | button blocks, Elementor buttons |
| `sections.feature` | `title: string`, `text: text`, `icon: string`, `image: media`, `url: string` | Elementor icon-box / image-box |
| `sections.hero` | `heading: string`, `subheading: text`, `image: media`, `label: string`, `url: string` | the first section of a builder page |

Only components a site actually needs are written. The set is data, not code: adding one is
a table entry plus a mapping rule.

**Not doing:** nesting dynamic zones inside components (Strapi doesn't allow it), and
relation-backed section components (LaunchPad's FAQ-by-relation pattern). Those are
modelling choices a human should make after the migration, not guesses a tool should make.

## How a body becomes sections

### Ordinary HTML (`bodyMode: dynamic-zone`, no page builder)

The existing cleanup runs first — captions, galleries, embeds, lazy images, shortcodes —
so the segmenter sees normalised HTML. Then, walking the body's top-level nodes:

1. Classify each node: table, gallery figure, embed figure, `<pre><code>`, blockquote,
   standalone image, button group, or prose.
2. Collapse consecutive prose nodes into one `sections.rich-text`, converted by the
   existing HTML → Markdown → Blocks pipeline.
3. Emit a matching component for each non-prose node.

An article with a table becomes: rich-text, table, rich-text. Nothing is lost, and the
prose is still one editable block.

### Elementor (`bodyMode: dynamic-zone`, `_elementor_data` present)

Parse the JSON and walk `container` / `section` / `column` nodes, collecting the widgets
inside each top-level section. Map by `widgetType`:

| Widget | Component |
|---|---|
| `heading`, `text-editor` | merged into one `sections.rich-text` per section |
| `image` | `sections.image` |
| `image-box`, `icon-box` | `sections.feature` |
| `button` | `sections.cta` |
| `testimonial` | `sections.quote` |
| `video`, `sections.embed`-like widgets | `sections.embed` |
| the first section of the page, when it has a heading plus an image or button | `sections.hero` |
| anything else | `sections.rich-text` built from its text-bearing settings; if it has none, skip and warn |

Widget settings carry media as `{id, url}`, so images resolve through the existing media
pipeline by WordPress id. Links carry `{url}` and are rewritten by the existing link
rewriter.

Unknown widgets are counted per `widgetType` in the report, so a site with many custom
widgets shows up as a number, not a surprise.

## Changes by file

- `analyze.js` — propose `bodyMode` per type; keep the existing counters as the evidence.
- `lib/sections.js` *(new)* — the segmenter: HTML → section descriptors; Elementor JSON →
  section descriptors. Pure functions, no I/O, so they are testable against fixtures.
- `lib/components.js` *(new)* — the component catalogue: schema for generation, and
  descriptor → Strapi payload for migration.
- `generate.js` — write `src/components/sections/*.json` for the components in use, and a
  `sections` dynamiczone attribute on types in that lane.
- `migrate.js` — when `bodyMode` is `dynamic-zone`, build the zone payload
  (`[{ __component: 'sections.rich-text', body: [...] }, …]`) instead of a Blocks value.
- `verify.js` — populate dynamic zones with the `on` syntax so counts and URL scans still
  work.

## Reporting

Per entry: how many sections, and of which components. Per run: a table of components used,
and unknown Elementor widgets by name and count. These go in `migration-report.json` and the
console summary, like today's warnings.

## Risks

- **Widget coverage.** We will only ever map widgets we have seen. The rich-text fallback
  keeps the content; the report says how often it was used.
- **Populate complexity.** Consumers must populate a dynamic zone with per-component `on`
  fragments. This goes in the references doc, with a working example.
- **Elementor changes.** The container/section split differs across Elementor versions. The
  walker handles both, and treats anything with `elements` as a container.
- **Over-modelling.** Ten components is already a lot to render. The default stays Blocks
  precisely so simple sites don't pay for this.

## Testing

1. Fixture tests for `lib/sections.js`: HTML in, descriptors out; Elementor JSON in,
   descriptors out.
2. Every generated `sections.rich-text` body validates against Strapi's `blocksValidator`,
   as the Blocks converter already does.
3. End-to-end on both demo sites: Northfield pages (2 Elementor pages) and Neuros
   (22 Elementor pages, 21 services, 8 case studies), then `verify.js` clean.
4. A re-run must not duplicate: dynamic zones are replaced wholesale on update.

## Out of scope

WPBakery and Divi mappers (the structure allows adding them), custom Blocks editor
extensions, comments, menus, and relation-backed section components.
