---
name: wordpress-to-strapi-migration
description: >-
  Migrate a WordPress site (posts, pages, custom post types, taxonomies,
  authors, media, custom fields) into Strapi v5. Use whenever someone wants to
  move, migrate, import or export content from WordPress to Strapi, or says
  "migrate my WordPress site to Strapi", "import WordPress posts into Strapi",
  "move WordPress content to a headless CMS", "WordPress to Strapi", or similar
  — including when they only mention part of it, such as ACF fields, Elementor
  pages or a WooCommerce-free content migration. Works for ANY WordPress site:
  it reads the site through the REST API, derives matching Strapi content types,
  and generates a migration you review and run. Also use it to diagnose a
  half-finished WordPress → Strapi migration.
compatibility: Requires Node.js 20+, a WordPress site reachable over HTTP, and a Strapi v5 project.
---

# WordPress → Strapi migration

> **This is a generator, not a fixed migrator.** Point it at any WordPress site. It reads the
> site's own content model, proposes matching Strapi content types, and writes a migration
> you review before anything moves. Nothing about a particular site is hard-coded.

> **Migration is iterative.** Real sites hide things: fields that aren't in the API, page
> builders, plugins nobody remembers installing. Expect to run the pipeline, read what it
> flagged, adjust the config, and run it again. That loop — a tool that reports honestly plus
> a human deciding what matters — is the point. Claude Code is the right partner for it
> because each run produces evidence you can act on together.

## How it works

```
export  →  analyze  →  review config  →  generate  →  migrate  →  verify
(code)     (code)      (you + Claude)    (code)       (code)      (code)
```

Each step writes a file the next one reads, so you can stop, inspect and re-run anything.

```
templates/
├── migrate/                     # the engine — run these
│   ├── export.js                # WordPress REST API → wp-export/export.json
│   ├── analyze.js               # export → migration plan + migration.config.json
│   ├── generate.js              # config → Strapi content types and components
│   ├── migrate.js               # export + config → Strapi (entries, media, relations)
│   ├── verify.js                # Strapi vs. the export
│   ├── lib/                     # wordpress, strapi, html, blocks, sections, components, media, links
│   └── test/                    # node --test test/*.test.js
├── wordpress/
│   └── strapi-migration-helper.php   # temporary mu-plugin: exposes hidden types and fields
└── strapi/
    ├── src/index.ts             # optional: grant public read to migrated types
    └── scripts/create-api-token.mjs  # mint a full-access token headlessly
references/
├── wordpress-gotchas.md         # what WordPress hides, and how it stores things
├── page-builders.md             # Elementor and friends
└── strapi-content-modeling.md   # Blocks vs components vs dynamic zones
```

## Prerequisites

1. **The WordPress site, reachable.** Local, staging or production.
2. **An application password.** WP Admin → Users → Profile → Application Passwords. Without
   it you only get published content and no custom fields. WordPress accepts application
   passwords over plain HTTP only on sites marked as a local environment.
3. **The helper plugin** — copy `templates/wordpress/strapi-migration-helper.php` into
   `wp-content/mu-plugins/`. Commercial themes routinely register post types and custom
   fields without REST access; without this you will migrate a site-shaped hole and never see
   an error. Delete it when the migration is done.
4. **A Strapi v5 project.** If there isn't one:
   `npx create-strapi-app@latest my-strapi --no-run --skip-cloud --typescript --dbclient sqlite --dbfile .tmp/data.db`
   Pass `--dbfile`: with an empty `DATABASE_FILENAME` Strapi tries to open the project
   directory as a database and dies with `SqliteError: unable to open database file`.
5. **One Strapi per WordPress site.** Entries are matched on `wpId`, and two sites both
   number their posts from 1.

## Steps

### 1. Set up the engine

```bash
cp -R templates/migrate ./migrate && cd migrate
npm install
cp .env.example .env     # WP_URL, WP_USER, WP_APP_PASSWORD, STRAPI_URL, STRAPI_API_TOKEN
```

Get the Strapi token from the admin panel (Settings → API Tokens → Full access), or run
`node <strapi>/scripts/create-api-token.mjs`.

### 2. Export

```bash
node export.js                 # add --download-media to keep a local copy of every file
```

Snapshots every post type, taxonomy, author and media record into `wp-export/export.json`.
It reports whether the helper plugin is active and which hidden types it exposed. If it says
no custom fields were found and the site uses a commercial theme, install the helper and
export again.

### 3. Analyze

```bash
node analyze.js                # --format markdown to store bodies as Markdown instead of Blocks
```

Prints the plan — every content type, every field's proposed Strapi mapping, and the
judgment calls marked `⚑` — and writes two files: `migration.config.json`, which drives
everything downstream, and `migration-plan.md`, the same plan as a document you can read
after the terminal has scrolled away or put in front of someone in a pull request.

### 4. Review the config — **the gate**

This is where a human decides. Read `migration-plan.md` — it lists each type with its entry
count, a table of every field and what it becomes, the custom fields that were dropped and
why, and the decisions worth a second look — then edit `migration.config.json` before
generating anything:

- **`bodyMode` per type** — `blocks` for prose (the default), `dynamic-zone` for
  page-builder pages, `markdown` if tables matter more than structure. The analyzer proposes
  it from the evidence; you confirm.
- **`fields`** — rename anything awkward, delete what you don't want, and check
  `ignoredMeta` for keys that were dropped as theme settings but are actually content.
- **`urlPattern`** — leave `null` to keep WordPress's URLs, or set `/blog/{slug}` and get a
  `redirects.json` for the paths that change.
- **Relations and types** — singular/plural names, and which taxonomies become collections.
- **Pages that duplicate a collection** — the plan flags where a page repeats entries it could
  relate to instead, the way LaunchPad models a list section. Nothing is rewritten: deciding
  that a paragraph *is* a given entry is yours to make.

Show the plan to the person you're working with. This is the step that decides whether the
migration is right, and it costs minutes compared with re-running everything.

### 5. Generate the Strapi schema

```bash
node generate.js --out ../my-strapi           # --force to overwrite existing types
```

Writes content types and any components the config needs. `strapi develop` reloads by
itself — don't restart the user's server; wait for the reload and poll `/api/<plural>`.

### 6. Migrate

```bash
node migrate.js --dry-run     # converts everything, writes previews, touches nothing
node migrate.js               # for real; --only post,page, --limit N, --skip-types svg
node migrate.js --since 2026-01-01   # catch up on what changed since the last run
node verify.js
```

Both runs start with preflight, which refuses to begin rather than half-migrate: it catches
relations pointing at types nobody defined, dynamic zones naming components that don't
exist, unknown transforms, content types Strapi isn't serving yet (usually `generate.js` ran
but Strapi hasn't reloaded), and a token without full access. `--dry-run` runs the config
checks only, so it works without a token.

Pass 1 creates entries with their scalars, rich text and media. Pass 2 wires relations by
`documentId`. Re-running updates instead of duplicating.

`--since <date>` narrows a run to entries WordPress says changed after then — the cutover
pattern of migrating, then catching up on what was written meanwhile. Only post types can be
filtered (terms and users carry no modification date, so they always run), an entry with no
date is migrated rather than skipped, and slugs and links are still computed from the whole
set so nothing moves or breaks.

`verify.js` compares counts per type, finds entries that still contain the old WordPress
host, and finds media fields that had a value in WordPress but are empty in Strapi.

Every run writes `migration-report.json` (everything, for grepping) and `migration-summary.md`
(the same run for a person): what moved, what failed with the id and slug of each entry, files
that could not be migrated, and the warnings grouped by kind — each explained in a sentence and
listing the entries behind it. Read the summary, then go look at what it names.

Strapi refuses some file types outright (SVG, unless you allow it in Settings → Media Library →
Upload). The migration says so once, naming the type and the fix, and keeps going — one refused
file never takes an entry down with it. `--skip-types svg` gives up on a type before spending a
download on it.

## What maps to what

| WordPress | Strapi |
|---|---|
| Post type (post, page, CPT) | collection type; `bodyMode` decides the body field |
| Taxonomy (category, tag, custom) | collection type + `manyToMany` relation |
| Author | `author` collection (users who wrote exported content only) |
| Featured image, ACF image, gallery | `media`, uploaded to the library first |
| Post body | `blocks` (default), `richtext` (Markdown), or a `sections` dynamic zone |
| Embed, iframe, audio/video player | a link keeping the embed's title or caption (else the provider, else the file name); `sections.embed` in a dynamic zone. A `poster` frame is kept as an image |
| ACF / Meta Box / registered meta | typed by value: string, text, integer, boolean, date, email, json, media, relation |
| Repeating field (Meta Box repeater, list of values) | repeatable component; positional rows are named only where the shape is clear (`url`, `icon`, `period`, `description`), otherwise `fieldN` to rename |
| ACF relationship / post object | `relation` |
| Parent page, parent term | self-relation |
| `publish` / everything else | published / draft, with the original in `wpStatus` |
| Permalink | `wpLink`, plus `redirects.json` when the path changes |
| Menus | `navigation` single type — repeatable `navigation.menu`, each with `navigation.link` items whose URLs resolve to the migrated entries |
| Comments, WooCommerce products | **not migrated** — reported, not moved |

## Strapi v5 rules the engine bakes in

- Entries are addressed by **`documentId`**, not the numeric id; responses are flattened.
- Every document has a draft version, so lookups use `status=draft`; `?status=draft|published`
  chooses which version a write touches.
- **Media is set by numeric file id** (`featuredImage: 12`), and files must be uploaded
  before the entry that references them. Relations use `{ set: [documentId] }`.
- The **Blocks** field accepts only `paragraph`, `heading`, `list`, `quote`, `code` and
  `image`; image nodes need the full media record. Tables, dividers and embeds have no node,
  which is what the dynamic-zone mode is for.
- Generated files must match the project's language: `.ts` for TypeScript (the default),
  `.js` with `--js`. A TS build drops stray `.js`, so routes silently 404.

## Before you promise anything

Read [`references/wordpress-gotchas.md`](references/wordpress-gotchas.md) — hidden content
types, duplicate meta, slug collisions, URLs pointing at someone else's server. For sites
built with Elementor or similar, read [`references/page-builders.md`](references/page-builders.md).
For how to shape the target model, [`references/strapi-content-modeling.md`](references/strapi-content-modeling.md).

> **Tip:** enable the [Strapi docs MCP](https://docs.strapi.io/cms/ai/docs-mcp-server) and
> check Strapi specifics against it as you design the schema.
