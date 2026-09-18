# What we learned migrating WordPress to Strapi

Notes from migrating two real WordPress sites into Strapi 5 with the skill in
[`skills/wordpress-to-strapi-migration/`](../skills/wordpress-to-strapi-migration/).
Everything here was observed during the runs, not assumed.

The two sites were chosen to be opposites:

| | **Northfield Studio** | **Neuros** |
|---|---|---|
| Built with | free wordpress.org plugins, content written for this repo | Neuros 2.2.1, a commercial ThemeForest theme with its demo content |
| Size | 36 entries, 30 images | 114 entries, 389 images |
| Content types | 6 (posts, pages, services, projects, team, testimonials) | 7 (posts, pages, services, projects, case studies, team, vacancies) |
| Custom fields | ACF | Meta Box |
| Page builder | Elementor on 2 of 8 pages | Elementor on 22 of 43 pages, and on every service and case study |

The pipeline is the same for both: **export → analyze → review the config → generate
content types → migrate → verify.**

---

## 1. The REST API hides the content you most need

This is the single biggest trap, and it's silent.

WordPress only exposes a post type over `/wp-json/wp/v2/` if it was registered with
`show_in_rest => true`, and only exposes a custom field if it was registered with
`register_post_meta()`. Commercial themes routinely do neither.

- **Neuros:** four of its five custom post types (`neuros_project`, `neuros_team_member`,
  `neuros_vacancy`, `neuros_service`) are invisible to REST. So are all of its Meta Box
  fields.
- **Northfield:** the Team type is hidden, and the projects' ACF field group has
  *Show in REST API* switched off — which is ACF's default. The fields are in the database
  and in the admin, and absent from the API.

A REST-based migration that trusts what it sees would have moved the site "successfully"
and lost roughly half of it, with no error.

**What works:** a temporary must-use plugin
([`strapi-migration-helper.php`](../skills/wordpress-to-strapi-migration/templates/wordpress/strapi-migration-helper.php))
that turns `show_in_rest` on for public types and taxonomies and returns every custom
field as `migration_meta`, readable only by an authenticated editor. It also registers
`/wp-json/strapi-migration/v1/info`, so the export can report what it had to expose:

```json
{"version":"1.0.0","forced_post_types":["team"],"forced_taxonomies":["department"]}
```

On Neuros that list was `neuros_project`, `neuros_team_member`, `neuros_vacancy`,
`neuros_service` and their taxonomies. Delete the plugin when the migration is done.

**Also worth knowing:** without an application password the export only sees published
content. Drafts, scheduled and private posts, and all custom fields, need authentication.
WordPress accepts application passwords over plain HTTP only when the site is marked as a
local environment, which Local does for you.

---

## 2. What Strapi's Blocks field can and can't hold

Strapi's rich-text **Blocks** field is a JSON array validated on write. Reading Strapi
5.53's own validator (`@strapi/core`, `services/entity-validator/blocks-validator.js`)
gives the definitive list:

| Allowed | Not allowed |
|---|---|
| `paragraph`, `heading` (1–6), `list` (nested lists fine), `quote`, `code`, `image` | tables, dividers/`thematicBreak`, embeds, galleries, buttons, columns |
| inline `text` with bold / italic / underline / strikethrough / code, and `link` | anything else |

Two rules bite in practice:

1. **An `image` block must carry the whole media record** — `url`, `width`, `height`,
   `hash`, `ext`, `mime`, `size`, `provider`, `createdAt`, `updatedAt`. A URL alone is
   rejected. So images must be uploaded *before* the body is converted.
2. **Link URLs must be absolute `http(s)`/`mailto:`/`tel:`/`ftp:`, or start with `/`.**
   An in-page anchor like `#why` is invalid, so it's emitted as plain text instead.

What that means for real content, measured on our two sites:

- Tables are flattened to one paragraph per row (4 entries on Northfield).
- YouTube embeds and iframes become plain links (2 entries).
- Galleries are split into consecutive image blocks (4 entries).
- Horizontal rules are dropped.

Every one of those is reported as a warning with the entry's slug, so nothing is lost
quietly. **The Markdown (`richtext`) output mode keeps tables**, which is the reason the
mode exists.

> An earlier hand-written version of this migration emitted `thematicBreak` nodes for
> horizontal rules. Strapi rejects that node type, so those posts would fail to save. It
> also never converted images into image blocks, leaving `![alt](url)` as literal text.
> Both are easy mistakes to make without reading the validator.

---

## 3. Page builders store their content somewhere else

For an Elementor page, `content.rendered` from the REST API is Elementor's *rendered
HTML* — a deep nest of `<div class="elementor-...">` wrappers. The real structure lives in
the `_elementor_data` post meta as JSON: sections, columns and widgets with their settings.

Converting the rendered HTML gives you the words in the right order and throws away the
layout. That's acceptable for an article; it's poor for a landing page, which is exactly
where builders are used. On Neuros that's 35 of 43 pages, all 21 services and all 8 case
studies.

Worth knowing when you count them yourself: 35 pages carry Elementor data
(`_elementor_data` and `_elementor_edit_mode`), but only 22 show Elementor markup in
`content.rendered`. Counting the rendered HTML alone under-reports the problem by a third.

`content.raw` is different again: Elementor keeps a plain-HTML fallback there, which is
usually cleaner than the rendered markup but has no layout either.

The structured fix — mapping builder widgets to Strapi components in a dynamic zone — is
the main item in the improvement plan. See
[`skill-improvement-plan.md`](skill-improvement-plan.md).

---

## 4. How custom fields actually arrive

Both ACF and Meta Box store values as ordinary post meta, but the shapes differ, and
inference has to cope with all of it:

| What you see | What it is | Mapped to |
|---|---|---|
| `"20240415"` | ACF/Meta Box date picker | `date` (not an integer — check this before the number rule) |
| `["78","80"]` | ACF relationship | `relation`, resolved through the WordPress IDs |
| `857` on a key like `hero_image` | attachment ID | `media`, if the ID is in the media library |
| `results_headline`, `results_metric`, `results_summary` | an **ACF Group**, stored flattened | a Strapi **component**: the analyzer spots the parent-plus-siblings shape and rebuilds the nested object |
| `["AIX Team"]` | a single value in WordPress's multi-row meta table | unwrapped to `"AIX Team"` |
| `_reading_time`, `_related_service` | ACF's internal field-key references | ignored |

Theme settings arrive in the same channel and are *not* content: Neuros stores about 50
presentation keys per entry (`header_*`, `footer_*`, `page_title_*`, border radii…), and
Inspiro adds `inspiro_hide_title`. The analyzer drops keys that look like layout settings,
keys that start with `_`, and keys whose value is identical on every entry, then lists what
it dropped in the config so you can pull one back if it was content after all. On the
Neuros project type that was 67 ignored keys versus 17 kept.

---

## 5. WordPress data hazards we hit

Real sites are messy in specific, recurring ways.

**Absolute URLs to a domain that isn't yours.** The Neuros demo content pointed at the
theme vendor's server: ~4,250 image references and ~810 links to
`demo.artureanec.com`, inside Elementor JSON, post bodies, menus, a Meta Box field, widgets
and theme settings. Importers don't rewrite those. A migration that only rewrites links to
"our own domain" will faithfully carry a dependency on someone else's server into the new
CMS. Check for foreign hosts before migrating, and note that `wp search-replace` must be run
twice: once for plain URLs and once for the JSON-escaped form (`https:\/\/…`) that page
builders store.

**Pages and attachments share slugs.** An image named `journal.jpg` took the slug `journal`,
so the blog page silently became `journal-2` and `/journal/` redirected to the image file.

**Duplicate meta rows.** Importing the same content twice (a timed-out demo import, then a
repair pass) left 8,993 of 12,398 (post, key) pairs with identical duplicate rows, which
turns every custom field into a two-element array. Worth checking before migrating:

```sql
SELECT post_id, meta_key, COUNT(*) c FROM wp_postmeta
GROUP BY post_id, meta_key HAVING c > 1;
```

**Drafts have no slug.** WordPress doesn't assign one until a post is published, and a
Strapi `uid` can't be empty, so slugs are generated from the title.

**Slugs aren't always ASCII.** WordPress percent-encodes non-Latin slugs; Strapi's `uid`
accepts only `A-Za-z0-9-_.~`. Those are transliterated, and every changed URL is written to
`redirects.json` in the `{ source, destination, permanent }` shape Next.js and Vercel accept.

---

## 6. Strapi-side findings

- **A fresh Strapi scaffolded with `--dbclient sqlite` and no `--dbfile` writes an empty
  `DATABASE_FILENAME=` into `.env`.** Strapi's `env()` returns that empty string rather than
  its default, so it tries to open the project directory as a database and dies with
  `SqliteError: unable to open database file`. Pass `--dbfile .tmp/data.db`, or fill the
  value in.
- **`strapi develop` fails the build on TypeScript errors**, including implicit `any` in
  `src/index.ts`. Bootstrap code needs `import type { Core } from '@strapi/strapi'` and
  typed parameters.
- **Entries are addressed by `documentId`**, not the numeric id, and every document has a
  draft version. Looking an entry up by its `wpId` with `status=draft` therefore finds it
  whether or not it's published — which is what makes re-running the migration update
  instead of duplicating.
- **Media can't be uploaded while creating an entry.** Files go up first, then the numeric
  file id is set on the media field. Relations use `{ set: [documentId] }`.
- **Two passes are required.** Entries are created first, then relations are wired, because
  a relation needs the target's `documentId` to exist.
- WordPress statuses map as: `publish` → published, everything else (`draft`, `future`,
  `private`, `pending`) → a Strapi draft, with the original kept in a `wpStatus` field.

---

## 7. Bugs the real runs exposed in our own tooling

None of these showed up in unit-sized testing; all appeared on real content.

| Symptom | Cause | Fix |
|---|---|---|
| `/api/serviceses` | WordPress type slug `services` wasn't singularised | singularise, with an exception list (`news`, `press`, …) |
| A relation targeting a type called `item` | "strip the shared theme prefix" rule turned `portfolio_item` into `item` | require three or more types to share a prefix, and never strip a prefix that is itself a type or taxonomy |
| Elementor's layout JSON proposed as a content field | underscore-prefixed keys were only filtered for one of the three meta sources | filter internals everywhere |
| ACF dates typed as integers | `"20130301"` matches the integer rule first | test the `Ymd` pattern before the number rule |
| Two content types both displayed as "Category" | WordPress labels are often generic | fall back to the type slug when the label is generic |
| Every Meta Box field typed as JSON | values arrived as one-item arrays | judge one-item (and identically repeated) arrays by their content |
| Verify reporting old-host URLs everywhere | the scan skipped `wpLink` at the top level, but populated relations carry their own | strip those keys at every depth |
| Adding `wpSite` to the match key duplicated entries | already-migrated entries had no `wpSite`, so they stopped matching and the run tried to create copies — 7 failed on `This attribute must be unique`, 2 duplicates got through | fall back to entries whose `wpSite` is null, match them and fill the field in. **Changing an idempotency key on live data needs a fallback, or a re-run silently forks your content.** |

---

## 8. Results

### Northfield Studio

12 content types generated, every entry migrated, verified clean:

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

Spot-checking the flagship post in Strapi: 18 blocks (paragraphs, headings, a code block,
an image, a list, a quote), its author, both categories, three tags, the featured image,
the sticky flag, and its ACF values including the relation to the Web Development service.
The project entry carries the ACF fields that REST had hidden: client, year, launch date,
hero image, results, and both linked services.

19 warnings, 0 failures. Three of the warnings are the deliberately broken image in the
legacy post, hotlinked from a domain that no longer exists — exactly what should be
reported rather than silently dropped.

### Neuros

14 content types (13 collections plus the `navigation` single type) generated into a **second**
Strapi project. Both sites number
their posts from 1, and entries are matched on `wpId`, so sharing one Strapi would have made
Neuros post 42 update Northfield post 42. One Strapi per source site avoids that until the
key is namespaced (P3.1 in the plan).

139 entries and terms created (114 post-type entries + 25 terms), plus 7 menus with 138 items,
172 media files uploaded, **0 failures**.

> An earlier version of this page said "343 entries and terms". That figure was entries + terms +
> media added together. The counts per type below were right and are unchanged.

The site has 389 attachments but only 172 files were uploaded, because the migration uploads what
the content actually references — featured images, images in bodies, media fields — and leaves
orphaned uploads behind. If you need the whole library, export with `--download-media` and import
it separately.

The media count depends on which lane a type takes. Reading Elementor's rendered HTML (the Blocks
lane) picks up every `<img>` on the page; reading its stored layout (the dynamic-zone lane, which
the analyzer now proposes for pages, services and case studies) picks up what the widgets
reference. The zone lane uploads fewer files and leaves nothing pointing at WordPress: the earlier
Blocks run left 13 WordPress URLs inside 12 pages, and the zone run leaves none, reporting
`section-image-dropped` instead.

Every count matches the export:

```
┌───────────────────┬───────────┬────────┬─────────────┬──────────────┬─────┐
│ (index)           │ wordpress │ strapi │ oldHostRefs │ missingMedia │ ok  │
├───────────────────┼───────────┼────────┼─────────────┼──────────────┼─────┤
│ category          │ 5         │ 5      │ 0           │ 0            │ '✓' │
│ tag               │ 6         │ 6      │ 0           │ 0            │ '✓' │
│ project-category  │ 3         │ 3      │ 0           │ 0            │ '✓' │
│ services-category │ 4         │ 4      │ 0           │ 0            │ '✓' │
│ services-tag      │ 5         │ 5      │ 0           │ 0            │ '✓' │
│ case-study-tag    │ 2         │ 2      │ 0           │ 0            │ '✓' │
│ post              │ 14        │ 14     │ 0           │ 0            │ '✓' │
│ page              │ 43        │ 43     │ 12          │ 0            │ '✗' │
│ project           │ 17        │ 17     │ 5           │ 0            │ '✗' │
│ team-member       │ 6         │ 6      │ 0           │ 0            │ '✓' │
│ vacancy           │ 5         │ 5      │ 0           │ 0            │ '✓' │
│ service           │ 21        │ 21     │ 0           │ 0            │ '✓' │
│ case-study        │ 8         │ 8      │ 0           │ 0            │ '✓' │
└───────────────────┴───────────┴────────┴─────────────┴──────────────┴─────┘
```

The 17 flagged entries are two specific, explainable problems — both worth knowing before
anyone runs a real migration:

1. **Strapi rejects SVG uploads by default.** Every attempt to upload the theme's logos
   returned `File type 'image/svg+xml' is not allowed`, so 13 images stayed as WordPress
   URLs inside 12 pages. The new site would load its own logo from the old CMS. Allow the
   type in Strapi's upload settings, or convert the files, before migrating a theme that
   uses SVG.
2. **A media caption that contains the old URL looks like a leftover, and isn't.** Five
   projects were flagged for still containing the WordPress host. The file itself migrated
   correctly: `project_audio_file` holds an attachment id, became a Strapi media field, and
   the MP3 is in the library. The old URL is inside the *attachment's caption*, which in
   WordPress is literally the text
   `http://neuros.local/…/audio_sample.mp3 "Impact Moderato"…`. The migration was right and
   the check was too blunt — `verify.js` should report a URL inside a caption separately from
   content that still points at the old site.

Neither is a failure of the content model — every entry, taxonomy term, relation and
featured image arrived — but both are the kind of thing that only shows up when you check.

**Where both sites ended up.** After fixing the two problems above, every type on both sites
verifies clean:

```
│ project           │ 17        │ 17     │ 0           │ 5          │ 0            │ '✓' │
                                           oldHostRefs   inCaptions   missingMedia
```

`verify.js` now separates the two: `oldHostRefs` is content still pointing at WordPress and
fails the check; `inCaptions` is a URL sitting inside a media caption copied from WordPress,
which is reported and not treated as a problem.

The migration also lists every file it couldn't move, with the reason:

```
2 file(s) could not be migrated (listed under "media" in migration-report.json):
  http://neuros.local/wp-content/uploads/2024/02/Logo.svg
    POST /api/upload -> 400 File type 'image/svg+xml' is not allowed
```

Two files, not thirteen: uploads are attempted once per file, and those two SVGs were used
across thirteen places. That distinction matters when you're judging how much is actually
broken.

Other warnings from this run, and what they mean:

| Warning | Count | What happened |
|---|---|---|
| `page-builder` | 53 | Elementor entries flattened to rich text |
| `media-player` | 61 | an audio player reused across Elementor pages became a link |
| `iframe` | 2 | embedded frames became links |
| `possible-shortcode` | 1 | `[woocommerce_my_account]` on the My Account page — WooCommerce isn't installed, so WordPress never rendered it either |

One more thing the run made obvious: **Neuros has a single author.** Demo importers assign
everything to the importing user, so the author relation is real but uninteresting. On a
genuine client site this is where you'd check that author accounts, not just names, came
across.

---

## 9. Second pass: page-builder content into dynamic zones

Everything above flattens page-builder pages into one rich-text field. We then built the
other lane — bodies as a **dynamic zone of components**, read from Elementor's own layout
data — and ran both sites again.

**The lane is chosen from evidence, per content type.** More than half the entries built with
a page builder means the structure is worth keeping:

| Site | Blocks | Dynamic zone |
|---|---|---|
| Northfield | posts, services, team, testimonials, projects | pages (2 of 8 are Elementor, so we opted in by hand at the review step) |
| Neuros | posts, projects, team members, vacancies | **pages (35/43), services (21/21), case studies (8/8)** — proposed automatically |

**What came out:**

| | Northfield | Neuros |
|---|---|---|
| Entries with a zone | 7 of 8 pages (the Journal page has no body of its own) | 68 (43 pages, 21 services, 8 case studies) |
| Sections created | 23 | 913 |
| Components used | rich-text 11, feature 6, cta 3, hero 1, quote 1, image 1 | rich-text 567, image 317, feature 19, hero 8, quote 2 |
| Failures | 0 | 0 |

Northfield's home page now arrives as hero → rich text → six features → quote → call to
action, with the hero image attached and every component link rewritten to a local path
(`/work/`, `/services/brand-strategy/`, `/contact/`). Both sites verify clean.

### What running it taught us

- **A refused upload must not fail the entry.** Strapi rejects SVG, and in the Blocks lane
  that was a warning; in the component lane it threw and took 13 whole pages down with it.
  Uploads now degrade: the image component is dropped, reported as `section-image-dropped`,
  and the rest of the page migrates.
- **Component `string` fields are capped at 255 characters.** Page-builder headings blow
  straight through that. Three pages failed on `content[0].heading must be at most 255
  characters` before we clamped the heading and moved the overflow into the subheading.
- **Links inside components need the same rewriting as body HTML.** The first run produced
  perfectly structured heroes pointing at `http://northfield.local/work/`.
- **Theme widgets are the real coverage problem.** Neuros's widgets are custom
  (`neuros_heading`, `neuros_team_members`, `neuros_image_carousel`…), so a fixed list of
  known widget types skipped 441 of them. Making the fallback read *any* prose-looking
  setting cut that to 172, and the rest are genuinely structural widgets (team grids, icon
  lists, carousels that pull from a custom post type) with no text of their own. Those are
  rebuild candidates, and the report names them with counts.

### The honest summary

For a site whose pages are mostly words, the dynamic zone buys little over Blocks. For a
theme-built marketing site, it is the difference between a wall of flattened HTML and
something an editor can work with — but the fidelity you get depends entirely on how many of
the theme's widgets the mapper knows. Budget time to teach it the ten widgets a given site
actually uses, and treat carousels and CPT-driven grids as things to rebuild rather than
migrate.
