# How to migrate from WordPress to Strapi using a Claude Code skill

By the end of this you will have moved a whole WordPress site into Strapi 5: posts, pages,
custom post types, taxonomies, authors, the media library, and the custom fields that ACF and
Meta Box store. You will not write the migration code. You point a Claude Code skill at the
WordPress site, it reads the site's own content model, proposes matching Strapi content types,
and writes a migration you review before anything moves.

We ran it against two real sites. Everything in this post is what those runs produced.

## What you end up with

A Strapi v5 project containing:

- One collection type per WordPress post type, and one per taxonomy. Categories and tags
  become real collections with relations, not text fields.
- Every entry, with its body converted to Strapi's rich-text **Blocks** field, or to a dynamic
  zone of components when the page was built with a page builder.
- The media library, uploaded file by file, with alt text and captions.
- Authors as their own collection, related to the entries they wrote.
- Your menus, as a `navigation` single type, with each item's link resolved to wherever that
  content landed in Strapi.
- Custom fields typed by what they hold: dates as dates, attachment ids as media, post ids as
  relations.
- `wpId`, `wpSite` and `wpLink` on every entry, so a second run updates instead of duplicating —
  even when one Strapi holds migrations from several WordPress sites — and so you can trace
  anything back to WordPress.
- `redirects.json` for any URL that had to change, `migration-report.json` listing every entry
  the tool was unsure about, and `migration-summary.md` saying the same thing in words.

Drafts stay drafts. Scheduled and private posts arrive as drafts with their original WordPress
status kept in a `wpStatus` field.

## Two example sites, and why two

A migration tool that only works on content you wrote yourself is not a migration tool. So the
skill was tested on two sites picked to be opposites.

| | **Northfield Studio** | **Neuros** |
|---|---|---|
| Built with | free wordpress.org plugins, content written for this repo | Neuros 2.2.1, a commercial ThemeForest theme with its demo content |
| Size | 36 entries, 30 images | 114 entries, 389 images |
| Content types | 6 (posts, pages, services, projects, team, testimonials) | 7 (posts, pages, services, projects, case studies, team, vacancies) |
| Custom fields | ACF | Meta Box |
| Page builder | Elementor on 2 of 8 pages | Elementor on 35 of 43 pages, and on every service and case study |

Northfield Studio is a fictional design agency, built by a plugin in this repository from free
plugins and public-domain photos. You can rebuild it in under a minute. It has the hard parts
on purpose: a post type hidden from the API, ACF fields hidden from the API, a classic-editor
post full of shortcodes, a draft with no slug, a scheduled post, and links to a domain that no
longer exists.

Neuros is the site nobody controls: a theme vendor's post types, a different custom-field
plugin, and Elementor everywhere. Its theme files are not in this repository. It is here
because it is the honest test, and because most of the surprises below came from it.

## Before you start

1. **The WordPress site, reachable over HTTP.** Local, staging, or production.
2. **An application password.** In WP Admin go to Users, Profile, Application Passwords. An
   application password is a per-tool password that WordPress accepts for API requests. Without
   one you get published content only: no drafts, no private posts, no custom fields. WordPress
   accepts these over plain HTTP only on a site marked as a local environment, which
   [Local](https://localwp.com) does for you.
3. **The helper plugin.** Copy `templates/wordpress/strapi-migration-helper.php` into
   `wp-content/mu-plugins/`. The next section explains why this is the most important step on
   the list.
4. **A Strapi v5 project.** If you do not have one:

   ```bash
   npx create-strapi-app@latest my-strapi --no-run --skip-cloud --typescript \
     --dbclient sqlite --dbfile .tmp/data.db
   ```

   Pass `--dbfile`. Without it Strapi writes an empty `DATABASE_FILENAME=` into `.env`, then
   tries to open the project directory as a database and dies with
   `SqliteError: unable to open database file`.
5. **One Strapi project per WordPress site.** Entries are matched on their WordPress id, and
   two sites both number their posts from 1. We ran Neuros into a second Strapi on port 1338
   for exactly that reason.

## The pipeline

The skill runs a fixed sequence with one human checkpoint in the middle:

```
export  →  analyze  →  review config  →  generate  →  migrate  →  verify
(code)     (code)      (you + Claude)    (code)       (code)      (code)
```

Each step writes a file the next one reads, so you can stop, look at the file, and re-run any
step on its own.

### 1. Set up the engine

```bash
cp -R templates/migrate ./migrate && cd migrate
npm install
cp .env.example .env
```

Fill in `.env`: `WP_URL`, `WP_USER` (your WordPress login name, not the label you gave the
application password), `WP_APP_PASSWORD`, `STRAPI_URL`, and `STRAPI_API_TOKEN`. Get the Strapi
token from Settings, API Tokens, Create new API Token, Full access.

### 2. Export

```bash
node export.js                 # --download-media to keep a local copy of every file
```

This snapshots every post type, taxonomy, author, and media record into
`wp-export/export.json`. Everything after this point reads the snapshot, so WordPress can be
slow, remote, or switched off on migration day.

The export tells you whether the helper plugin is active and which hidden types it had to
expose. It also exports your menus, which do get migrated, and counts comments, which do not.

### 3. Analyze

```bash
node analyze.js                # --format markdown to store bodies as Markdown instead of Blocks
```

This reads the snapshot and prints a plan: every content type, every field, and the Strapi type
proposed for it. Judgment calls are marked with `⚑`. It writes two files alongside:
`migration.config.json`, which drives everything downstream, and `migration-plan.md`, the same
plan as a document — each type with its entry count, a table of every field and what it becomes,
the custom fields it chose to drop and why. The terminal scrolls away; the document is something
you can reread, or put in a pull request for someone else to check.

WordPress's fixed fields are mapped by rule: title, body, excerpt, featured image, author,
taxonomies, parent, dates. Custom fields are guessed from their values, which is where the
flags come from.

Each line of the plan looks like this:

```
■ Service  (postType neuros_service, 21) → api::service.service  /api/services  [body: dynamic-zone]
```

### 4. Review the config

This is the gate, and it is the step worth slowing down for. Read `migration-plan.md` first —
it is the plan in prose — then edit the config, which is a plain JSON file:

```json
{
  "source": { "url": "http://neuros.local", "export": "wp-export/export.json" },
  "content": { "format": "blocks", "shortcodes": "strip", "uploadExternalImages": true },
  "types": {
    "service": {
      "source": { "kind": "postType", "slug": "neuros_service" },
      "singularName": "service",
      "pluralName": "services",
      "displayName": "Service",
      "urlPattern": null,
      "bodyMode": "dynamic-zone",
      "fields": {
        "title": { "type": "string", "from": "title", "transform": "text" },
        "slug": { "type": "uid", "targetField": "title", "from": "slug", "transform": "slug" },
        "content": { "type": "dynamiczone", "components": [], "from": "content", "transform": "sections" },
        "wpId": { "type": "integer", "from": "id", "transform": "raw" }
      },
      "ignoredMeta": {
        "_elementor_data": "Elementor layout JSON (see references/page-builders.md)"
      }
    }
  }
}
```

Four things to check:

- **`bodyMode` per type.** `blocks` for prose, `dynamic-zone` for page-builder pages,
  `markdown` when tables matter more than structure. The analyzer proposes it from evidence;
  you confirm it.
- **`fields`.** Rename anything awkward, delete what you do not want.
- **`ignoredMeta`.** Keys the analyzer dropped as theme settings. Read this list. If something
  in it was actually content, move it back into `fields`.
- **`urlPattern`.** Leave it `null` to keep WordPress's URLs, or set `/blog/{slug}` and get a
  `redirects.json` for every path that changes. Some slugs change whether you ask or not — a
  Strapi uid has to be ASCII and unique per type, so accented slugs are transliterated and
  colliding ones suffixed — and those get a redirect either way. That is the case worth
  catching, because it is how a migration quietly loses its inbound links.

Editing this file costs minutes. Re-running a migration you got wrong costs a lot more.

### 5. Generate the Strapi schema

```bash
node generate.js --out ../my-strapi          # --force to overwrite existing types
```

This writes content types and any components the config needs. It detects whether your project
is TypeScript or JavaScript from `tsconfig.json`, because a TypeScript build silently drops
stray `.js` files and the routes then 404. Content types that already exist are left alone
unless you pass `--force`.

`strapi develop` reloads on its own when the files appear. Do not restart it.

### 6. Migrate and verify

```bash
node migrate.js --dry-run     # converts everything, writes previews, touches nothing
node migrate.js               # --only post,page and --limit 5 while you iterate
node verify.js
```

`--dry-run` writes each entry's payload to `wp-export/preview/<type>/<slug>.json` so you can
read what would be created.

Both commands start with a preflight, which refuses to begin rather than half-migrate. It
checks the config for relations pointing at types nobody defined, dynamic zones naming
components that do not exist, and unknown transforms; then it asks Strapi whether it is
actually serving every type the config expects, which catches the most common mistake of all —
`generate.js` ran, but Strapi had not reloaded — and whether the token can read them. Every
problem is reported at once, before anything is written.

The real run happens in two passes. Pass 1 creates every entry with its scalar fields, rich
text, and media. Pass 2 wires up relations. It has to be two passes, because a relation needs
the target entry to exist first. Entries are matched on their WordPress id *and* their source
site, so re-running updates instead of duplicating, and one Strapi can hold migrations from
several WordPress sites without one site's post 42 overwriting another's.

Your menus are written after pass 1, once every entry has its new URL, so the navigation points
at the migrated content rather than back at WordPress.

Real cutovers are rarely one migration. People keep publishing while you work, so
`--since 2026-01-01` narrows a run to what WordPress says changed after a date. Only post types
can be filtered — terms and users carry no modification date, so they always run, because
skipping them would create a post whose new category was never made — and an entry with no date
is migrated rather than skipped. Slugs and links are still computed from the whole set, so
nothing shifts underneath the content you already moved.

`verify.js` then compares Strapi against the export: counts per type, entries whose fields
still contain the old WordPress host, and media fields that had a value in WordPress but are
empty in Strapi. It exits non-zero on any mismatch.

The run also writes `migration-summary.md`, which is the one to read first. It says what moved,
what failed and where, and groups every warning by kind with a sentence explaining what that
kind means — `table-flattened ×4` is only useful if you already know what it implies — then
names the entries behind each one. The JSON report keeps everything; the summary tells you
where to look.

## The trap that costs you half the site

WordPress shows a post type at `/wp-json/wp/v2/` only if it was registered with
`show_in_rest => true`. It shows a custom field only if it was registered with
`register_post_meta()`. Commercial themes routinely do neither, and nothing tells you.

On the two test sites:

- **Neuros:** four of its five custom post types (`neuros_project`, `neuros_team_member`,
  `neuros_vacancy`, `neuros_service`) are invisible to the REST API. So is every Meta Box
  field.
- **Northfield:** the Team post type is hidden, and the projects' ACF field group has *Show in
  REST API* switched off. That is ACF's default. The fields are in the database and visible in
  WP Admin, and absent from the API.

A migration that trusts what the API shows it would have moved either site "successfully" and
lost roughly half of it, with no error anywhere.

The fix is a temporary must-use plugin. A must-use plugin is a PHP file in
`wp-content/mu-plugins/` that WordPress loads automatically, with nothing to activate.
`strapi-migration-helper.php` does three things:

1. Turns `show_in_rest` on for public post types and taxonomies that opted out.
2. Returns every custom field on an entry as `migration_meta`, to logged-in editors only.
3. Registers `/wp-json/strapi-migration/v1/info`, so the export can report what it had to
   expose:

   ```json
   {"version":"1.0.0","forced_post_types":["team"],"forced_taxonomies":["department"]}
   ```

On Neuros that list was the four hidden post types and their taxonomies. The plugin changes
nothing on the front end. Delete it when the migration is done.

## How the content is shaped in Strapi

Strapi's **Blocks** field is its native rich-text editor. The value is a JSON array that Strapi
validates on write, and the list of node types it accepts is short:

| Allowed | Not allowed |
|---|---|
| `paragraph`, `heading` (1-6), `list` (nesting is fine), `quote`, `code`, `image` | tables, dividers, embeds, galleries, buttons, columns |
| inline `text` with bold, italic, underline, strikethrough and code, plus `link` | anything else |

Two rules bite in real content. An `image` node must carry the entire media record, not just a
URL, which is why files are uploaded before any body is converted. And link URLs must be
absolute `http(s)`, `mailto:`, `tel:`, `ftp:`, or start with `/`. An in-page anchor like `#why`
is rejected, so it is written out as plain text instead.

Measured on the two sites: tables flatten to one paragraph per row (4 entries on Northfield),
YouTube embeds and iframes become plain links (2 entries), galleries become consecutive image
blocks (4 entries), horizontal rules are dropped. Every one of those is reported as a warning
naming the entry, so nothing disappears quietly. The Markdown mode (`--format markdown`) keeps
tables, which is the reason that mode exists.

### Page-builder pages get components instead

For an Elementor page, the `content.rendered` the API returns is Elementor's rendered HTML: a
deep nest of `<div class="elementor-...">` wrappers. The real structure is in the
`_elementor_data` post meta, as JSON describing sections and widgets.

Flattening the rendered HTML gives you the words in the right order and throws the layout away.
That is fine for an article and poor for a landing page, which is what people build with page
builders.

So there is a second lane. A **component** in Strapi is a reusable group of fields stored
inside a parent entry. A **dynamic zone** is an ordered list of mixed components, so an editor
can compose a page from varied sections. When a type's entries are mostly builder-built, the
analyzer proposes `bodyMode: "dynamic-zone"`, reads Elementor's own JSON, and maps each widget
to a component:

| Elementor widget | Component |
|---|---|
| `heading`, `text-editor` | merged into one `sections.rich-text` per section |
| `image` | `sections.image` |
| `icon-box`, `image-box` | `sections.feature` |
| `button` | `sections.cta` |
| `testimonial` | `sections.quote` |
| `video` | `sections.embed` |
| first section with a heading plus an image or button | `sections.hero` |
| anything else | `sections.rich-text` from its text settings, or skipped and counted |

The fallback is the part that matters. An unknown widget degrades to rich text instead of
vanishing, and unknown widget types are counted by name in the report.

Which lane each type got, and what came out:

| Site | Blocks | Dynamic zone |
|---|---|---|
| Northfield | posts, services, team, testimonials, projects | pages (2 of 8 are Elementor, so we opted in by hand at the review step) |
| Neuros | posts, projects, team members, vacancies | pages (35 of 43), services (21 of 21), case studies (8 of 8), proposed automatically |

| | Northfield | Neuros |
|---|---|---|
| Entries with a zone | 7 of 8 pages (the Journal page has no body of its own) | 68 (43 pages, 21 services, 8 case studies) |
| Sections created | 23 | 913 |
| Components used | rich-text 11, feature 6, cta 3, hero 1, quote 1, image 1 | rich-text 567, image 317, feature 19, hero 8, quote 2 |
| Failures | 0 | 0 |

Northfield's home page arrives as hero, rich text, six features, quote, call to action, with
the hero image attached and every link rewritten to a local path (`/work/`,
`/services/brand-strategy/`, `/contact/`).

For a site whose pages are mostly words, the dynamic zone buys little over Blocks. For a
theme-built marketing site it is the difference between a wall of flattened HTML and something
an editor can work with. How good it gets depends on how many of the theme's widgets the mapper
recognizes.

## What ACF and Meta Box fields become

ACF (Advanced Custom Fields) and Meta Box are the two common plugins for adding custom fields
to WordPress. Both store values as ordinary post meta, and both produce shapes that need
interpreting:

| What you see | What it is | Mapped to |
|---|---|---|
| `"20240415"` | a date picker | `date`, tested before the integer rule so it does not become a number |
| `["78","80"]` | an ACF relationship | `relation`, resolved through the WordPress ids |
| `857` on a key like `hero_image` | an attachment id | `media`, if that id is in the media library |
| `results_headline`, `results_metric`, `results_summary` | an ACF **Group**, stored flattened | one component: `results: { headline, metric, summary }` |
| `["AIX Team"]` | a single value in WordPress's multi-row meta table | unwrapped to `"AIX Team"` — unless the item is itself a row, which means a repeater with one row |
| `["branding", "ui", "strategy"]` | a list of values | a repeatable component with one `value` field |
| `[["2012 - 2017", "Microsoft Inc.", "…"], …]` | a Meta Box repeater: positional rows, no field names anywhere | a repeatable component. Columns are named only where the shape is unmistakable (`period`, `url`, `icon`, `description`); anything else keeps its position as `fieldN` for you to rename, because a guessed name that is wrong ends up believed |
| `_reading_time`, `_related_service` | ACF's internal field-key references | ignored |

Theme settings arrive through the same channel and are not content. Neuros stores about 50
presentation keys per entry: `header_*`, `footer_*`, `page_title_*`, border radii. The
Inspiro theme on Northfield adds `inspiro_hide_title`. The analyzer drops keys that look like
layout settings, keys starting with `_`, and keys whose value is identical on every entry. It
lists what it dropped in `ignoredMeta` so you can pull one back if it was content after all.
On the Neuros project type that was 67 ignored keys against 17 kept.

## What the runs produced

**Northfield Studio.** 12 content types generated, every entry migrated, verified clean:

```
┌────────────────┬───────────┬────────┬─────────────┬──────────────┬─────┐
│ (index)        │ wordpress │ strapi │ oldHostRefs │ missingMedia │ ok  │
├────────────────┼───────────┼────────┼─────────────┼──────────────┼─────┤
│ author         │ 4         │ 4      │ 0           │ 0            │ '✓' │
│ category       │ 7         │ 7      │ 0           │ 0            │ '✓' │
│ tag            │ 8         │ 8      │ 0           │ 0            │ '✓' │
│ industry       │ 5         │ 5      │ 0           │ 0            │ '✓' │
│ department     │ 3         │ 3      │ 0           │ 0            │ '✓' │
│ portfolio      │ 5         │ 5      │ 0           │ 0            │ '✓' │
│ post           │ 9         │ 9      │ 0           │ 0            │ '✓' │
│ page           │ 8         │ 8      │ 0           │ 0            │ '✓' │
│ service        │ 5         │ 5      │ 0           │ 0            │ '✓' │
│ team           │ 4         │ 4      │ 0           │ 0            │ '✓' │
│ testimonial    │ 4         │ 4      │ 0           │ 0            │ '✓' │
│ portfolio-item │ 6         │ 6      │ 0           │ 0            │ '✓' │
└────────────────┴───────────┴────────┴─────────────┴──────────────┴─────┘
```

19 warnings, 0 failures. Three warnings are a deliberately broken image in the legacy post,
hotlinked from a domain that no longer exists, which is what should happen rather than a silent
drop. The flagship post arrived with 18 blocks, its author, both categories, three tags, the
featured image and the sticky flag. The project entries carry the ACF fields the REST API had
hidden: client, year, launch date, hero image, results, and both linked services.

**Neuros.** 13 content types, 343 entries and terms created, 204 media files uploaded, 0
failures, 156 warnings. Every count matches the export. Twelve of the 13 types verify clean.
On the first run `verify.js` flagged 12 pages and 5 projects for still containing the old
WordPress host. Two specific problems, both worth knowing before you run a real migration:

1. **Strapi rejects SVG uploads by default.** Every attempt to upload the theme's logos
   returned `File type 'image/svg+xml' is not allowed`, so 13 images stayed as WordPress URLs
   inside 12 pages. The new site would have loaded its own logo from the old CMS. Allow the
   type in Strapi's upload settings, or convert the files, before migrating a theme that uses
   SVG. The migration now drops a refused image and reports it as `section-image-dropped`
   instead of leaving the old URL behind, which is why those pages verify clean in the second
   run further down. It also names the refused type once with the fix rather than repeating
   Strapi's message per file, and `--skip-types svg` gives up on the type before spending a
   download on it — on this export that is 18 SVGs attempted, or none.
2. **A media caption that quotes the old URL looks like a leftover.** Five projects were
   flagged for containing the WordPress host. The file had migrated fine: the field holds an
   attachment id, it became a media field, and the MP3 is in the Strapi library. The old URL
   is inside the *attachment's caption*, because that is what the caption says in WordPress.
   The migration was right and the check was too blunt. Worth knowing, because you will chase
   this one before you find it.

Neither is a failure of the content model. Every entry, term, relation and featured image
arrived. Both are the kind of thing that only shows up when you check.

After fixing those, every type on both sites verifies clean. `verify.js` now reports two
different things separately: content still pointing at WordPress, which fails the check, and
a URL sitting inside a media caption, which is just what the caption says. The migration also
prints every file it could not move, with the reason:

```
2 file(s) could not be migrated (listed under "media" in migration-report.json):
  http://neuros.local/wp-content/uploads/2024/02/Logo.svg
    POST /api/upload -> 400 File type 'image/svg+xml' is not allowed
```

Two files rather than thirteen, because each file is attempted once and those two logos were
used in thirteen places.

The other warnings from that first run, with every body going into a Blocks field:

| Warning | Count | What happened |
|---|---|---|
| `page-builder` | 53 | Elementor entries flattened to rich text |
| `media-player` | 61 | an audio player reused across Elementor pages became a link |
| `iframe` | 2 | embedded frames became links |
| `possible-shortcode` | 1 | `[woocommerce_my_account]`, on a site without WooCommerce installed |

## What does not come across

Say this part out loud before you promise anyone a date.

- **Tables, dividers, embeds and galleries inside Blocks.** Blocks has no node for them. Tables
  flatten to paragraphs, embeds become links, galleries become consecutive images, horizontal
  rules are dropped. Use the Markdown mode to keep tables, or the dynamic zone to keep the
  structure.
- **Comments.** Counted and reported, not migrated. Strapi has no built-in comments. Use a
  plugin, or model a `comment` collection with a relation to the entry.
- **Menu nesting, as nesting.** Menus themselves do migrate, into a `navigation` single type.
  But a Strapi component cannot contain itself, so items are a flat list where each one carries
  the id of its parent, rather than components nested inside components. Any depth survives;
  your front end does the nesting.
- **WooCommerce products.** Skipped by default. Prices, variations and stock live in
  WooCommerce's own tables, which means the WooCommerce REST API, not this.
- **SVG files.** Rejected by Strapi's upload settings unless you allow the type. The migration
  now says so once — naming the type and the three ways out — instead of repeating Strapi's
  message per file, and `--skip-types svg` stops it attempting them at all.
- **Theme widgets with no text of their own.** On Neuros, a fixed list of known Elementor
  widgets skipped 441 of them. Making the fallback read any prose-looking setting cut that to
  172. The rest are genuinely structural: team grids, icon lists, carousels that pull from a
  custom post type. Those are rebuild candidates, and the report names them with counts.
- **Multilingual content** (WPML, Polylang). Migrate one language, then map the rest onto
  Strapi's i18n yourself.

Two hazards live in the source site rather than in Strapi. The Neuros demo content pointed at
the theme vendor's server: roughly 4,250 image references and 810 links to
`demo.artureanec.com`, inside Elementor JSON, post bodies, menus, a Meta Box field, widgets and
theme settings. Importers do not rewrite those, and `wp search-replace` has to run twice, once
for plain URLs and once for the JSON-escaped form (`https:\/\/…`) page builders store. And
importing the same content twice leaves duplicate meta rows, which turn every custom field into
a two-element array: on our repaired Neuros site, 8,993 of 12,398 (post, key) pairs.

> **This skill is a starting point, not a one-click migration.** I want to be direct about
> that, because the failure mode here is trusting a green checkmark.
>
> Every site has unknowns. Fields nobody registered for the API. A page builder storing layout
> somewhere the API never shows you. A plugin someone installed in 2019 and forgot. The skill
> cannot know about those in advance. What it can do is report honestly: name every entry it
> was unsure about, count every widget it did not recognize, and tell you which URLs still
> point at the old server.
>
> So treat migration as a loop, not a command. Run the pipeline. Read what it flagged. Adjust
> the config. Run it again. Entries are matched on their WordPress id, so re-running updates
> rather than duplicates, which is what makes the loop cheap.
>
> Running Claude Code alongside the skill is what makes that loop work. The review step is a
> conversation: you read the plan together, you say "that field is a date, not an integer" or
> "these pages should be a dynamic zone", and the config changes. The tool produces evidence.
> You decide what matters. Neither half is enough on its own.

## Try it

Everything here is in
[github.com/PaulBratslavsky/wordpress-to-strapi-demo](https://github.com/PaulBratslavsky/wordpress-to-strapi-demo):
the demo site, the skill, the migration scripts, and the full notes from both runs.

What to do first, in order:

1. **Build Northfield Studio.** Create a blank site in Local, install the Inspiro theme and
   four free plugins (Elementor, WPZOOM Portfolio, Custom Post Type UI, Advanced Custom
   Fields), then upload the `northfield-demo` plugin and click Tools, Northfield Demo, Create
   demo content. It takes under a minute, and `wp northfield reset` puts it back.
2. **Export without the helper plugin, then with it.** Compare the two `export.json` files. The
   Team post type and the project ACF fields appear only in the second one. That difference is
   the reason the helper exists, and it lands better on your own screen than in a table.
3. **Run `node analyze.js` and read the plan.** Look at the `⚑` lines and at `ignoredMeta`.
   Change something in `migration.config.json` and run it again.
4. **Migrate one entry before you migrate the site.** `node migrate.js --only page --limit 1`,
   then open it in the Strapi admin. Do this with a page-builder page. It is the fastest way to
   find out whether the dynamic zone gives you what you want.
5. **Then point it at your own site.** That is the part the skill was written for.
