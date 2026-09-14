# WordPress to Strapi migration demo

A free example WordPress site, a Claude Code skill that migrates it to [Strapi](https://strapi.io), and notes from testing on a commercial theme.

---

## Highlights

- **Reproducible starting point.** One plugin builds a complete agency website on free wordpress.org plugins, with public-domain images. No paid theme needed.
- **Realistic migration problems built in.** A custom post type hidden from the REST API, custom fields hidden from REST, Elementor pages, a classic-editor post full of shortcodes, drafts, scheduled posts and internal links.
- **One click to build, one click to remove**, from WP Admin or WP-CLI.
- **Migration engine included.** Export → analyze → generate Strapi content types → migrate → verify.

---

## What's in this repo

| Folder | What it is |
|---|---|
| [`wordpress/`](wordpress/) | The **Northfield Studio** demo site: a WordPress plugin that builds it, plus setup instructions |
| [`skills/wordpress-to-strapi-migration/`](skills/wordpress-to-strapi-migration/) | The Claude Code skill and the migration scripts it runs |
| [`docs/wordpress-setup-notes.md`](docs/wordpress-setup-notes.md) | What went wrong importing a commercial ThemeForest theme's demo, and how we fixed it |

---

## Quick start

1. Install [Local](https://localwp.com) and create a blank WordPress site.
2. Install the Inspiro theme and four free plugins: Elementor, WPZOOM Portfolio, Custom Post Type UI, Advanced Custom Fields.
3. Upload the `northfield-demo` plugin, then go to **Tools → Northfield Demo → Create demo content**.

> Step-by-step instructions, a WP-CLI version and troubleshooting: [`wordpress/README.md`](wordpress/README.md)

---

## The example site

**Northfield Studio** is a fictional design agency. Its content is spread across the places real WordPress sites keep it:

| Content | Where it lives |
|---|---|
| 8 pages | Block editor; Home and About built with Elementor |
| 9 blog posts | Block editor, plus one legacy classic-editor post |
| 5 services, 4 team members, 4 testimonials | Custom post types from Custom Post Type UI, with ACF fields |
| 6 projects | WPZOOM Portfolio, with ACF fields |
| 30 images, 26 terms, 2 menus, 5 comments | Media library, taxonomies, menus |

---

## Migrating to Strapi

The skill in [`skills/wordpress-to-strapi-migration/`](skills/wordpress-to-strapi-migration/) reads a site through the [WordPress REST API](https://developer.wordpress.org/rest-api/) and generates matching [Strapi v5](https://docs.strapi.io) content types. It then moves the entries, media and relations into Strapi and reports anything it couldn't convert cleanly.

> **Status:** run end to end against both example sites. See [what we learned](docs/migration-findings.md) and the [improvement plan](docs/skill-improvement-plan.md) for what's built and what's still open.

Treat it as a starting point. Every WordPress site has its own quirks: page builders, custom fields, plugins. Migration works best as an iterative loop: run the skill, review what it flagged, adjust, and run again.

---

## License

- The Northfield Demo plugin is licensed [GPL-2.0-or-later](https://www.gnu.org/licenses/gpl-2.0.html), like all WordPress plugins.
- Photos are [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain), credited in [`CREDITS.md`](wordpress/northfield-demo/assets/images/CREDITS.md).
- All companies, people and `.example` domains in the demo content are fictional.
- Commercial theme files used for testing are not part of this repository.
