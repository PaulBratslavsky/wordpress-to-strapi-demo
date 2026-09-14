# Page builders

Most WordPress sites older than a year or two have at least some pages built with a page
builder. Those pages are the hardest part of any migration, because **the content you see is
not the content that's stored**.

## Where the content actually lives

| Builder | Stored in | What `content.rendered` gives you |
|---|---|---|
| **Elementor** | `_elementor_data` post meta: JSON of sections, columns and widgets | Elementor's rendered HTML — nested `elementor-*` wrappers |
| **WPBakery** | `post_content` itself, as `[vc_row][vc_column]…` shortcodes | the shortcodes rendered, if the plugin is active; raw shortcodes if not |
| **Divi** | `post_content`, as `[et_pb_section]…` shortcodes | same |
| **Beaver Builder** | `_fl_builder_data` post meta | rendered HTML |
| **Block editor (Gutenberg)** | `post_content`, as HTML with `<!-- wp:… -->` comments | clean semantic HTML — the easy case |

Two consequences:

1. **If the builder plugin is deactivated, the page is gone** — you get raw shortcodes or an
   empty body. Migrate with the plugin active.
2. **`content.raw` is not the same as `content.rendered`.** Elementor keeps a plain-HTML
   fallback in `post_content`; it is usually cleaner than the rendered markup but has no
   layout either.

## What this skill does

`analyze.js` counts how many entries of each type are builder-built (by markup, by
`_elementor_edit_mode`, and by page template) and proposes a `bodyMode`:

- **More than half builder-built** → `dynamic-zone`. Each top-level section becomes a Strapi
  component, read from Elementor's own JSON rather than its HTML.
- **Otherwise** → `blocks`, and the rendered HTML is flattened into one rich-text field, with
  a warning naming every affected entry.

### The Elementor widget map

| Widget | Component |
|---|---|
| `heading`, `text-editor` | merged into one `sections.rich-text` per section |
| `image` | `sections.image` |
| `icon-box`, `image-box` | `sections.feature` |
| `button` | `sections.cta` |
| `testimonial` | `sections.quote` |
| `video` | `sections.embed` |
| first section with a heading plus an image or button | `sections.hero` |
| anything else | `sections.rich-text` from its text settings, or skipped with a warning |

Unknown widgets are counted by name in the migration report, so "how much did we miss" is a
number you can look at, not a guess. To teach it a new widget, add a `case` to
`widgetDescriptor()` in `lib/sections.js` and, if it needs a new shape, an entry in
`SECTION_COMPONENTS` in `lib/components.js`.

### WPBakery and Divi

Not mapped to components yet. Their shortcodes are stripped from the rendered HTML, the inner
text is kept, and each stripped shortcode is reported. If a site is mostly WPBakery, treat
those pages as rebuild candidates and migrate only their text.

## Honest advice for a real project

Landing pages built with a builder are usually the pages a business cares most about, and
they are the ones a straight migration serves worst. Three options, in the order we'd
consider them:

1. **Rebuild them in Strapi** using components designed for the new front end. Migrate the
   text so nobody retypes it. Best result, most work.
2. **Migrate into a dynamic zone** (what this skill does) and tidy up afterwards in the
   admin. Good when pages follow a few repeating patterns.
3. **Flatten to rich text** and accept that layout is gone. Fine for pages that are mostly
   words, poor for anything with a grid of cards.

Whichever you choose, check a builder page in the Strapi admin *before* migrating the rest.
`node migrate.js --only page --limit 1` exists for exactly that.
