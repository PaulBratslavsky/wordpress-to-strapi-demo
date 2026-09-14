# Improving the WordPress → Strapi migration skill

Written after migrating two real sites end to end. Every item below is grounded in
something that actually happened during those runs; the evidence is quoted with each one.
Findings in [`migration-findings.md`](migration-findings.md).

Priorities are ordered by how much they change the quality of a migration, not by effort.

> **Status, 2026-09-14:** P1.1 and P1.2 are **built and run against both sites** — per-type
> `bodyMode`, the HTML segmenter, the ten `sections.*` components, and the Elementor widget
> mapper. See the design at
> [`superpowers/specs/2026-09-13-migrated-content-structure-design.md`](superpowers/specs/2026-09-13-migrated-content-structure-design.md)
> and the results in [`migration-findings.md`](migration-findings.md).
>
> **Done since:** 1.3's ACF Group → component half, 2.1 (media failures reported rather than
> fatal), 2.3 (menus → a navigation single type), 2.7 (caption URLs counted apart from stale
> content), 3.1 (`wpSite` namespacing), 3.3 (preflight) and 3.5 (the written plan file),
> alongside 4.1–4.3.
>
> **Still open:** 1.3's repeating lists, 1.4, 2.2, 2.4–2.6, 3.2, 3.4 and 4.4.

---

## P1 — Structure content the way Strapi is meant to be used

Today every body becomes one Blocks field. That matches Strapi's own blog template and is
right for prose, but it throws away structure that Strapi can hold perfectly well.

### 1.1 A per-type `bodyMode`, chosen from evidence

Add `bodyMode: "blocks" | "markdown" | "dynamic-zone"` per content type in
`migration.config.json`. The analyzer already counts what matters — page-builder entries,
tables, embeds, galleries — so it proposes the mode and the reviewer confirms it before
anything is generated.

Proposed rule: prose → `blocks`; a type whose entries are mostly page-builder pages →
`dynamic-zone`; a type whose bodies are full of tables → `markdown` or `dynamic-zone`.

*Evidence:* on Neuros, 35 of 43 pages, 21 of 21 services and 8 of 8 case studies are
Elementor-built. On Northfield, 4 entries contain tables that flatten to paragraphs today.

### 1.2 Elementor → components, from `_elementor_data`

Convert the builder's own JSON rather than its rendered HTML. Each top-level section
becomes a component in a dynamic zone; each widget maps to a component by `widgetType`:

| Elementor widget | Component |
|---|---|
| `heading`, `text-editor` | `sections.rich-text` |
| `image` | `sections.image` |
| `image-box`, `icon-box` | `sections.feature` |
| `button` | `sections.cta` |
| `testimonial` | `sections.quote` |
| `video`, embeds | `sections.embed` |
| anything unrecognised | `sections.rich-text` (its rendered HTML) |

The fallback is the important part: an unknown widget degrades to rich text instead of
disappearing. The same segmenter serves `bodyMode: "dynamic-zone"` for non-builder HTML,
splitting a body into runs of rich text plus table/embed/gallery components.

*Evidence:* `content.rendered` for an Elementor page is nested `elementor-*` wrappers;
the structure only exists in `_elementor_data`, which the helper plugin already exposes.

**Status: awaiting sign-off** on the two-lane approach (prose → Blocks, builder pages →
dynamic zone) before implementation.

### 1.3 ACF Group → component — **done**; repeating lists still open

An ACF Group used to land as flattened sibling fields (`resultsHeadline`, `resultsMetric`,
`resultsSummary`). The analyzer now detects that shape — a parent key holding nothing beside
`<parent>_<sub>` siblings — defines the component in the config, and the migration assembles
the nested object. Verified on the demo site: `results: { headline, metric, summary }`.

Still open: **lists of objects** (Meta Box's `team_member_experience_list`, ACF Pro
repeaters) should become *repeatable* components. The analyzer flags them with that advice
but still stores them as `json`. Relations and rich text inside a component are coerced to
strings, deliberately — those are modelling decisions for a human.

### 1.4 Follow LaunchPad's reusable-section pattern

Strapi's reference project models list-style sections as a component holding a heading plus
a **relation** to a real collection, rather than duplicating content inline. Where a
WordPress page embeds a testimonial or FAQ list, prefer a relation to the migrated
collection over copying the text.

---

## P2 — Close the fidelity gaps the runs exposed

### 2.1 Media that can't be fetched — **done**

Every file the migration can't move is recorded once with its reason, printed at the end of
the run, and written to `migration-report.json` under `media`. A refused upload no longer
takes the entry down with it.

Still open: retries with backoff, and a config choice between dropping the image and leaving
the original URL in place.

*Evidence:* on Neuros the report names the two SVGs Strapi refuses
(`File type 'image/svg+xml' is not allowed`), used across thirteen places.

### 2.2 Audio, video and iframes

61 `media-player` and 2 `iframe` warnings on Neuros became plain links. With 1.2 in place
they become `sections.embed`; until then, at least preserve the poster image and title.

### 2.3 Menus → a Navigation single type — **done**

Menus were exported and then ignored, which left every migrated site without its navigation.
The analyzer now proposes a `navigation` single type — a repeatable `navigation.menu`, each
holding repeatable `navigation.link` items — and the migration fills it in after pass 1, when
every entry's new URL is known, so a menu points at the migrated content rather than at
WordPress. Verified on Northfield: 2 menus, 11 items, Footer 3 / Main 8.

Two things shaped the model:

- **Items are flat, carrying `parent`** (the WordPress id of the item above, `0` at the top).
  A Strapi component cannot contain itself, so nesting components would cap menus at whatever
  depth the schema hard-codes; Northfield's menu is already two deep.
- **Only internal links are rewritten.** Rewriting resolves against the site URL, so passing
  an off-site link through it would silently strip the host — the demo's
  `https://social.example/…` item would have become `/northfield-studio`.

This is the engine's first single type, so `generate.js` learned `kind`, `strapi.js` a
single-type PUT (idempotent by nature — one document, overwritten), and preflight that a
single type answers at its singular route. Both collection passes and `verify.js` skip them.

### 2.4 Comments

Not migrated, by design, but the tool should say what the options are (a Strapi comments
plugin, or a `comment` collection with a relation to the entry) rather than only counting
them.

### 2.5 Redirects that are actually useful

`redirects.json` was empty on both runs because URLs are preserved by default. Ship
`urlPattern` presets (`/blog/{slug}`, `/{path}`) and emit redirects whenever a slug is
transliterated or de-duplicated, which is exactly when a site silently loses SEO.

### 2.6 File types Strapi rejects

Strapi refuses SVG uploads by default (`File type 'image/svg+xml' is not allowed`). Every
theme logo on Neuros hit this, so 13 images stayed as WordPress URLs in migrated bodies —
the site's own logo now loads from the old CMS. The migration should detect the rejection,
say so once with the fix (allow the type in Strapi's upload settings, or convert to PNG),
and offer `--skip-types svg` rather than failing per image.

*Evidence:* `image-failed ×13` on Neuros, all `.svg`, across pages that share a logo.

### 2.7 Old URLs inside media captions and alt text — **done**

Five Neuros projects were reported as "still containing the old WordPress host". Chasing it
down: the file itself migrated correctly (`audioFile` → a Strapi media record), and the old
URL is sitting inside the **attachment's caption**, which in WordPress is literally the text
`http://neuros.local/wp-content/uploads/2024/05/audio_sample.mp3 "Impact Moderato"…`.

So the migration is right and the check is wrong. `verify.js` should count a URL inside a
media record's `caption` or `alternativeText` separately from content that still points at
the old site, and say which it found. Optionally, offer to rewrite uploads URLs inside
captions at migration time.

*(An earlier version of this item claimed the field held a URL that migrated as a string.
That was wrong: `project_audio_file` holds an attachment id, and it became a media field.)*

---

## P3 — Robustness

### 3.1 Namespace the idempotency key — **done**

Every type now carries `wpSite` (the source host) alongside `wpId`, and lookups match on the
pair, so one Strapi can hold migrations from several WordPress sites without one site's post
42 updating another's.

**Changing a key mid-stream is its own hazard, and it bit us.** With the site added to the
match, already-migrated entries (which had no `wpSite`) stopped matching, so the run tried to
create second copies: 7 entries failed on `This attribute must be unique` and 2 duplicates
got through before we stopped. The lookup now falls back to entries whose `wpSite` is null,
matching them and filling the field in. Re-running against both sites then updated all 36 and
343 entries in place, with nothing duplicated.

### 3.2 Parallel uploads and resume

204 media uploads ran sequentially on Neuros. A small concurrency limit (4–6) and a resume
flag would matter on a site with thousands of images. The upload cache already survives
restarts, so this is mostly plumbing.

### 3.3 Preflight checks — **done**

`migrate.js` now refuses to start on a config that can't work or a Strapi that isn't ready,
printing every problem at once instead of failing partway through:

- a relation whose target no type defines,
- a dynamic zone or component field naming a component that doesn't exist,
- an unknown `transform` (a typo here used to fail silently),
- content types Strapi doesn't serve — nearly always `generate.js` ran but Strapi wasn't
  restarted — named with that fix,
- a token that can't read them, pointing at Settings → API Tokens → Full access.

`--dry-run` runs the config half only, so it still works without a token. The checks live in
`lib/preflight.js` and are covered by `test/preflight.test.js`.

*Evidence:* two separate Strapi startup failures cost real time —
`DATABASE_FILENAME=` empty (SQLite opening a directory) and a TypeScript error in the
bootstrap file. Both are detectable up front.

### 3.4 Incremental runs

Add `--since <date>` so a second pass only touches entries modified after the first. Useful
for the real-world pattern of migrating, then catching up on content written during the
cutover.

### 3.5 A written plan file — **done**

`analyze.js` still prints its plan, and now also writes `migration-plan.md` beside the
config: every type with its source and entry count, a table of each field (what it came
from, what it becomes), the custom fields it chose not to migrate and why, and the
decisions worth a second look. The one moment in this pipeline that genuinely needs review
is no longer terminal scrollback — it's a file that fits in a pull request.

---

## P4 — Make it a usable skill

### 4.1 `SKILL.md` — **done**

Written: when to trigger, the prerequisites, the six steps, the review gate before
generating, and the Strapi v5 rules the engine depends on. Without it the skill could not
load at all.

### 4.2 References

- `page-builders.md` — Elementor, WPBakery, Divi: where content lives and what survives.
- `wordpress-gotchas.md` — the hidden-REST problem, application passwords, duplicate meta,
  slug collisions, foreign-host URLs.
- `strapi-content-modeling.md` — Blocks vs components vs dynamic zones, with the LaunchPad
  patterns and the populate syntax a dynamic zone needs.

### 4.3 Tests

Fixture-based tests for the converter: HTML in, Blocks out, validated against Strapi's own
`blocksValidator`. Add the fixtures that caused bugs (nested formatting, linked images,
lazy-loaded images, `[caption]`, galleries, tables). A recorded export from the demo site
makes the whole pipeline testable without WordPress running.

### 4.4 Reporting

`migration-report.json` is complete but unreadable at a glance. Emit a short Markdown
summary: what moved, what was flagged, and the exact entries a human should look at.

---

## Suggested order

1. `SKILL.md` and references (4.1, 4.2) — without them the skill can't be used at all.
2. Preflight checks and the plan file (3.3, 3.5) — cheap, and they remove the two failure
   modes that cost us the most time.
3. The `bodyMode` setting plus the HTML segmenter and component set (1.1, plus the generic
   half of 1.2).
4. The Elementor mapper (the rest of 1.2) and ACF Group components (1.3).
5. Media reporting, menus, redirects (2.1, 2.3, 2.5).
6. Everything in P3 that's left.
