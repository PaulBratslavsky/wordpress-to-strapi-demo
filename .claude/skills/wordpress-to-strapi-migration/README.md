# WordPress → Strapi migration skill

A [Claude Code](https://claude.com/claude-code) skill that reads any WordPress site through its REST API, derives matching [Strapi 5](https://docs.strapi.io) content types, and migrates the content once you have approved the plan.

---

## Highlights

- **Works on any WordPress site.** Nothing about a particular site is hard-coded; the content model is derived from the site itself.
- **Finds the content WordPress hides.** Post types and custom fields missing from the REST API are the one migration failure that reports success.
- **You approve the model before anything is written.** The run stops at a plan you can read and edit.
- **Page-builder layouts survive** as Strapi components in a dynamic zone, rather than flattening to HTML.
- **Safe to re-run.** Entries are matched on their WordPress id and source site, so a second run updates rather than duplicates.
- **Reports honestly.** Every judgment call is a warning naming the entry behind it.

---

## Overview

WordPress stores content and presentation together. Strapi stores content as fields and leaves rendering to whatever consumes the API. A migration therefore is not a copy: every field has to be sorted into content that moves, presentation that stays behind, and the ambiguous pile in between. That sorting is the work, and it needs a person.

This skill automates everything around that decision. It snapshots the site, proposes a content model with its reasoning, stops, and then does the mechanical work once you agree. It is a generator, not a fixed migrator: the same pipeline handles a five-page brochure site and a commercial theme with Meta Box fields and Elementor layouts.

> Full prose walkthrough, with screenshots: [the tutorial](../../docs/blog/wordpress-to-strapi.md). What two real runs found: [migration findings](../../docs/migration-findings.md).

---

## Quick start

Install the skill, then describe your site to Claude Code:

```bash
npx skills add PaulBratslavsky/wordpress-to-strapi-demo -g --agent claude-code --yes
```

```
Migrate my WordPress site at http://my-site.local into the Strapi project
at ./my-strapi, running on http://localhost:1337. My WordPress user is admin
and the application password is xxxx xxxx xxxx xxxx xxxx xxxx. Start with a dry run.
```

Claude copies the engine, fills in its `.env`, runs the export and the analysis, then **stops and shows you the plan**. Read it, change what it got wrong, and tell Claude to continue.

> Never used it before? Practise on the [demo site](../../wordpress/README.md) first: one zip, imported into [Local](https://localwp.com), with the hard parts already in it.

---

## Prerequisites

1. **The WordPress site, reachable** over HTTP. Local, staging or production.
2. **An application password** (WP Admin → Users → Profile → Application Passwords). Without one you get published content only, and no custom fields.
3. **The [helper plugin](../../wordpress/README.md#prepare-the-site-for-migration)**, installed like any plugin. Themes routinely register post types and fields without REST access; without this you migrate a site-shaped hole and see no error.
4. **A Strapi 5 project**, and one Strapi per WordPress site (entries are matched on `wpId`, and two sites both number their posts from 1).

---

## How it works

Six steps. Five are code; one is you.

```
export → analyze → review → generate → migrate → verify
(code)   (code)    (YOU)    (code)     (code)    (code)
```

Each step writes a file the next one reads, so you can stop anywhere, inspect, and re-run one step without repeating the others.

| Step | Reads | Writes | What it does |
|---|---|---|---|
| `export.js` | WordPress REST API | `wp-export/` | Snapshots every post type, taxonomy, author, menu and media record. One `entries/<type>.ndjson` per type plus a manifest, so nothing is ever one huge JSON string, and an interrupted run resumes. |
| `analyze.js` | the export | `migration.config.json`, `migration-plan.md` | Infers the content model: field types from values, relations from ids, which bodies are page-builder layouts. Flags every judgment call. |
| **review** | `migration-plan.md` | your edits | **The gate.** Rename types and fields, drop what you do not want, set `bodyMode` per type, choose the URL scheme. |
| `generate.js` | the config | Strapi schema files | Writes content types and the components they need. |
| `migrate.js` | export + config | Strapi entries | Two passes: entries with their scalars, rich text and media, then relations by `documentId`. |
| `verify.js` | export + Strapi | a table | Compares counts per type, finds entries still pointing at the old host, and media fields that lost their file. |

### The decisions it makes for you

Some conversions are safe because the evidence is in the data, and the engine just does them: a flattened ACF group becomes one component, `"20240415"` becomes a date, a repeating field becomes a repeatable component, theme settings are dropped, a shared vendor prefix is stripped.

Others are yours, and the engine will not guess: whether a page that lists six projects should become a relation to them, whether a text field holding repeated values should become its own collection, and how each type's body should land. That last one is `bodyMode`:

| `bodyMode` | Body becomes | Use for |
|---|---|---|
| `blocks` (default) | Strapi's Blocks field | prose |
| `markdown` | a richtext field | when tables matter more than structure |
| `dynamic-zone` | an ordered list of `sections.*` components | page-builder layouts |

The analyzer proposes one from the evidence and says why. Changing it in `migration.config.json` is what the review step is for.

### What it will not do

Comments, WooCommerce products and multilingual content are reported, not moved. Embeds become links. Menu nesting arrives flat, with each item carrying its parent id. Media moves because an entry references it, so files attached to nothing stay behind.

> The whole map, including which WordPress construct becomes which Strapi field: [SKILL.md](SKILL.md).

---

## Running the engine yourself

The scripts are plain Node, so the skill is not required:

```bash
cp -R templates/migrate ./migrate && cd migrate
npm install
cp .env.example .env          # WP_URL, WP_USER, WP_APP_PASSWORD, STRAPI_URL, STRAPI_API_TOKEN

node export.js                # --download-media to keep local copies; --fresh to re-export
node analyze.js               # --format markdown for Markdown bodies
# read migration-plan.md, edit migration.config.json
node generate.js --out ../my-strapi
node migrate.js --dry-run     # converts everything, writes previews, touches nothing
node migrate.js               # --only post,page   --limit 20   --since 2026-01-01
node verify.js
```

Both migrate runs start with a preflight that refuses to begin rather than half-migrate: relations pointing at types nobody defined, dynamic zones naming components that do not exist, unknown transforms, types Strapi is not serving yet, or a token that cannot write.

Every run writes `migration-report.json` for grepping and `migration-summary.md` for reading: what moved, what failed with the id and slug of each entry, and the warnings grouped by kind with a sentence explaining each.

---

## Layout

```
SKILL.md                  what Claude reads: the pipeline, the rules, the gotchas
references/               wordpress-gotchas · page-builders · strapi-content-modeling
templates/
├── migrate/              the engine (export, analyze, generate, migrate, verify)
│   ├── lib/              wordpress, strapi, html, blocks, sections, components, media, links …
│   └── test/             node --test test/*.test.js   (137 tests)
├── wordpress/            the temporary helper plugin
└── strapi/               optional public-read bootstrap, headless token script
```

Adding support for a widget or a field type is usually a table entry plus a mapping rule: the component catalogue is `lib/components.js`, and the Elementor widget map is `lib/sections.js`. Every run reports the widgets it skipped, with counts, which is the to-do list for that file.

---

## Limits

Built for sites in the hundreds to low thousands of entries. The largest tested run is 343 entries and 204 files. A whole-site run holds every entry in memory, so six figures needs the streaming work in [the improvement plan](../../docs/skill-improvement-plan.md) or a different approach entirely; the tutorial's [What breaks at 100,000 entries](../../docs/blog/wordpress-to-strapi.md) section covers what to do instead.

---

## License

GPL-2.0-or-later, like the WordPress plugin it ships with. See [the repository root](../../README.md).
