# What WordPress hides, and how it stores things

Everything here has bitten a real migration. Skim it before promising a timeline.

## The REST API only shows what was registered for it

A post type appears at `/wp-json/wp/v2/` only if it was registered with
`show_in_rest => true`; a custom field appears only if it was registered with
`register_post_meta()`. Commercial themes and their companion plugins routinely do neither.

On one commercial theme we tested, four of five custom post types and *every* custom field
were invisible. A REST-based migration would have completed "successfully" with half the site
missing and no error anywhere.

**Fix:** install the Strapi Migration Helper plugin
([zip](https://github.com/PaulBratslavsky/wordpress-to-strapi-demo/releases/latest/download/strapi-migration-helper.zip), or `templates/wordpress/strapi-migration-helper.php` zipped inside a
`strapi-migration-helper/` folder) through Plugins → Add Plugin → Upload Plugin, and activate it.
It turns on `show_in_rest` for public types and taxonomies, returns all custom fields as
`migration_meta` to authenticated editors, and exposes `/wp-json/strapi-migration/v1/info`
so the export can report what it had to reveal. Delete it afterwards.

**Also:** ACF field groups default to *Show in REST API = off*. A site can use ACF heavily and
show you nothing through the API.

## Authentication

Without an application password you get published content only — no drafts, no scheduled or
private posts, no custom fields. WordPress only accepts application passwords over HTTPS, or
on a site whose `WP_ENVIRONMENT_TYPE` is `local` (Local sets this for you). The username is
the login name, not the label you gave the password.

## How custom fields arrive

| What you see | What it is |
|---|---|
| `"20240415"` | a date picker (ACF, Meta Box). Check this before treating it as a number |
| `["78","80"]` | an ACF relationship: WordPress post ids |
| `857` on a key like `hero_image` | an attachment id |
| `results_headline`, `results_metric` | an ACF **Group**, stored flattened |
| `["Some text"]` | a single value in WordPress's multi-row meta table |
| `_reading_time` | ACF's internal reference to the field definition — ignore anything starting with `_` |

Theme settings arrive in the same channel and are not content. One theme stored ~50
presentation keys per entry (`header_*`, `page_title_*`, border radii). The analyzer drops
keys that look like layout, keys starting with `_`, and keys whose value is identical on
every entry — and lists what it dropped in `ignoredMeta` so you can pull one back.

## Data hazards

**URLs pointing at someone else's server.** Demo content imported from a theme keeps the
vendor's URLs — in our test site, ~4,250 image references and ~810 links to the theme
author's demo site, inside page-builder JSON, post bodies, menus, widgets and theme settings.
Check for foreign hosts before migrating:

```sql
SELECT COUNT(*) FROM wp_posts WHERE post_content LIKE '%//other-domain.com%';
```

Fixing them needs `wp search-replace` run twice: once for plain URLs, once for the
JSON-escaped form (`https:\/\/…`) that page builders store.

**Duplicate meta rows.** Importing content twice leaves identical duplicate rows, which turn
every custom field into a two-element array:

```sql
SELECT post_id, meta_key, COUNT(*) c FROM wp_postmeta
GROUP BY post_id, meta_key HAVING c > 1;
```

**Pages and attachments share slugs.** An image named `journal.jpg` takes the slug `journal`,
so a page of that name silently becomes `journal-2`.

**Drafts have no slug.** WordPress assigns one at publish time. Strapi's `uid` can't be
empty, so slugs are generated from the title.

**Slugs aren't always ASCII.** WordPress percent-encodes non-Latin slugs; Strapi's `uid`
allows only `A-Za-z0-9-_.~`. Those get transliterated, and every changed URL lands in
`redirects.json`.

## Media

- WordPress serves one attachment at many URLs: the original, a `-scaled` copy for large
  images, and every generated size (`photo-1024x683.jpg`). The engine indexes all of them so
  each file uploads once.
- Alt text lives in `_wp_attachment_image_alt`, captions in the attachment's excerpt. Both
  are carried over.
- **Strapi rejects SVG uploads by default** (`File type 'image/svg+xml' is not allowed`).
  Theme logos are usually SVG. Allow the type in Strapi's upload settings or convert the
  files, or they stay pointing at WordPress.
- A custom field holding an uploads URL (an MP3, a PDF) migrates as a string unless you map
  it to `media` in the config.

## Not migrated

- **Comments** — counted and reported. Strapi has no built-in comments; use a plugin or model
  a `comment` collection yourself.
- **Menus** — exported when authenticated, but not created in Strapi. Model navigation as a
  single type if you need it.
- **WooCommerce products** — skipped by default. Prices, variations and stock live in
  WooCommerce's own tables; use the WooCommerce REST API for those.
- **Multilingual (WPML/Polylang)** — out of scope. Migrate one language, then map the rest
  onto Strapi's i18n.
