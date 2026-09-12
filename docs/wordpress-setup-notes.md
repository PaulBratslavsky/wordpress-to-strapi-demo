# WordPress starting point — setup notes

How the `neuros.local` demo site was built, and the snags hit along the way.
Raw material for the blog post's "Set up the WordPress site" section.

## Stack

| Piece | Version / value |
|---|---|
| Local (localwp.com) | 10.1.2 — site `neuros`, domain `neuros.local`, "Preferred" environment |
| WordPress | 7.1 (PHP 8.2.29, nginx 1.26.1, MySQL 8.4.0) |
| Theme | Neuros 2.2.1 (ThemeForest) — **not redistributable**, kept in `reference-projects/` (git-ignored) |
| Required plugins | Neuros Plugin 2.2.1 (bundled in the theme), Elementor 4.2.4, Meta Box 5.15.0, Ultimate Addons for Elementor Lite (`header-footer-elementor`) 2.9.4 |
| Demo importer | One Click Demo Import 3.4.1 |
| Skipped on purpose | WooCommerce — products are a separate migration topic; without it the importer just skips the 10 products and their attributes |

## Steps (GUI version, for readers)

1. **Local → + → Create a new site** → name `neuros` → Preferred → set admin user/password.
2. **WP Admin → Appearance → Themes → Add New → Upload Theme** → `neuros.zip` → Activate.
3. Install the plugins the theme's notice asks for (Neuros Plugin, Elementor, Ultimate Addons for Elementor Lite, Meta Box) plus **One Click Demo Import**.
4. **Appearance → Import Demo Data → Neuros** (light). Leave the tab open until it says it's finished.
5. **Users → Profile → Application Passwords** → name `strapi-migration` → copy the password (used by the export).
6. Copy `skills/wordpress-to-strapi-migration/templates/wordpress/strapi-migration-helper.php` into `wp-content/mu-plugins/` (see "Hidden content" below).

Don't drag the theme zip onto Local — Local's import expects a *site* export (wp-content + database) and fails with "The archive has no wp-content folder".

## Same thing from the command line (what was actually run)

- Site created through Local's local GraphQL API (`~/Library/Application Support/Local/graphql-connection-info.json` → `addSite` mutation; introspection is off, the schema lives in `app.asar`).
- WP-CLI run with Local's own PHP + `wp-cli.phar`, with `PHPRC` pointing at the site's `run/<id>/conf/php` so it finds the MySQL socket (same environment as Local's "Open site shell").
- `wp theme activate neuros`, `wp plugin install elementor meta-box header-footer-elementor one-click-demo-import --activate`, `wp plugin activate neuros-plugin` (unzipped from `themes/neuros/core/tgm/src/neuros-plugin.zip`).
- `wp ocdi import --predefined=0 --url=http://neuros.local`

## Snags

1. **Import died after 5 minutes.** One Click Demo Import calls `set_time_limit(300)` (filter `ocdi/set_time_limit_for_demo_data_import`), and the demo downloads ~380 images from the theme vendor's server. PHP killed it mid-download: 127 images in, zero pages/posts, no menus or front page. Fix: re-run with the limit lifted:
   `wp ocdi import --predefined=0 --exec='WP_CLI::add_wp_hook("ocdi/set_time_limit_for_demo_data_import", function () { return 0; });'`
   (In the browser importer, clicking Import again resumes it.) The theme's pre-import hook deletes all posts/pages/attachments first, so a re-run starts clean.
2. **The full re-run still skipped 9 entries** (3 projects, 6 services) with nothing in the log — not the time limit, not the title+date duplicate check. Cause not found. Filled in with the core importer, which skips anything that already exists:
   `wp plugin install wordpress-importer --activate && wp import import.xml --authors=skip`
3. **…which duplicated every menu item** (the core importer doesn't de-dupe `nav_menu_item`). Deleted the second copies (all IDs above the first import's range) → back to 139.
4. WordPress's default "Privacy Policy" draft sat next to the demo's own copy — deleted the default.
5. **The site still pointed at the vendor's demo server.** Importers don't rewrite URLs inside page-builder JSON, menus, custom fields or widgets, so ~4,250 image references and ~810 links still went to `https://demo.artureanec.com/themes/neuros/…` (199 `_elementor_data` rows, 83 post bodies, menu items, a Meta Box field, widgets, theme mods). For the migration that's the wrong starting point — the skill only treats same-host links as internal, and would have pulled images from the vendor. Fixed with:
   - a database backup first (`wp db export … --socket=<Local's mysqld.sock>` — plain `wp db export` looks for `/tmp/mysql.sock` and writes an empty file),
   - downloading the 38 referenced files that only existed on the vendor server (resized variants like `-600x505`) into the same `uploads/2024/..` paths — the importer had kept the original year/month folders, so the other 430 already matched,
   - `wp search-replace` for `…/themes/neuros-dark` then `…/themes/neuros` → `http://neuros.local`, each in plain and JSON-escaped (`https:\/\/…`) form, `--skip-columns=guid --precise`,
   - deleting the "Dark Version" menu item, Elementor's `_elementor_element_cache` rows, and flushing Elementor CSS.
   The only remaining mention is a testimonial sentence naming the vendor.

   This is also a migration lesson in itself: demo-built sites (and sites moved between domains without a proper search-replace) carry absolute URLs to hosts that aren't the site. Check for foreign hosts in content before migrating.

## Final content (matches the demo's import.xml)

| Type | Count | Notes |
|---|---|---|
| page | 41 published + 2 drafts | 35 built with Elementor |
| post | 14 | block editor (Gutenberg) |
| neuros_service | 21 | Elementor |
| neuros_project | 17 | mostly Meta Box fields |
| neuros_case_study | 8 | Elementor |
| neuros_team_member | 6 | Meta Box fields |
| neuros_vacancy | 5 | Meta Box fields |
| attachment | 389 | includes duplicate uploads from the demo itself ("Logo" ×6, "Group" ×6) and logos re-sideloaded by the customizer import |
| nav_menu_item | 139 | 7 menus |
| elementor-hf | 35 | header/footer templates — site chrome, not content |

## Hidden content (callout for the guide)

Four of the five Neuros post types (`neuros_project`, `neuros_team_member`, `neuros_vacancy`, `neuros_service`) and **every Meta Box field** are registered without REST support, so `/wp-json/wp/v2/` doesn't show them at all. A REST-based export would silently miss them. The helper mu-plugin turns `show_in_rest` on for public types/taxonomies and returns all custom fields as `migration_meta` (to authenticated editors only). Delete it after migrating.

## Credentials

`.local-secrets/neuros.env` (git-ignored): WP admin login + the `strapi-migration` application password.
