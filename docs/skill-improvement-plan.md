# Improving the WordPress → Strapi migration skill

Written after migrating two real sites end to end. Every item below is grounded in
something that actually happened during those runs; the evidence is quoted with each one.
Findings in [`migration-findings.md`](migration-findings.md).

Priorities are ordered by how much they change the quality of a migration, not by effort.

> **Status, 2026-09-14:** P1.1 and P1.2 are **built and run against both sites** — per-type
> `bodyMode`, the HTML segmenter, the ten `sections.*` components, and the Elementor widget
> mapper. See the design at
> [`superpowers/specs/2026-09-13-migrated-content-structure-design.md`](superpowers/specs/2026-09-13-migrated-content-structure-design.md)
> and the results in [`migration-findings.md`](migration-findings.md). P1.3 (ACF Group →
> component) and everything in P2–P4 except `SKILL.md` and the references are still open.

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

*Evidence:* on Neuros, 22 of 43 pages, 21 of 21 services and 8 of 8 case studies are
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
| `testimonial` | `sections.testimonial` |
| `video`, embeds | `sections.embed` |
| anything unrecognised | `sections.rich-text` (its rendered HTML) |

The fallback is the important part: an unknown widget degrades to rich text instead of
disappearing. The same segmenter serves `bodyMode: "dynamic-zone"` for non-builder HTML,
splitting a body into runs of rich text plus table/embed/gallery components.

*Evidence:* `content.rendered` for an Elementor page is nested `elementor-*` wrappers;
the structure only exists in `_elementor_data`, which the helper plugin already exposes.

**Status: awaiting sign-off** on the two-lane approach (prose → Blocks, builder pages →
dynamic zone) before implementation.

### 1.3 ACF Group and repeating lists → components

An ACF Group currently lands as flattened sibling fields (`resultsHeadline`,
`resultsMetric`, `resultsSummary`). It should become a single-component field. Lists of
objects (Meta Box's `team_member_experience_list`, ACF repeaters on ACF Pro sites) should
become repeatable components; the analyzer already flags them with exactly that advice.

### 1.4 Follow LaunchPad's reusable-section pattern

Strapi's reference project models list-style sections as a component holding a heading plus
a **relation** to a real collection, rather than duplicating content inline. Where a
WordPress page embeds a testimonial or FAQ list, prefer a relation to the migrated
collection over copying the text.

---

## P2 — Close the fidelity gaps the runs exposed

### 2.1 Media that can't be fetched

13 images on Neuros failed to download and stayed as original URLs in the body. Add:
retries with backoff, a `--media-report` listing every unreachable file with the entries
that use it, and a config choice between leaving the original URL and dropping the image.

*Evidence:* `image-failed` ×13 on Neuros, ×1 on Northfield (a deliberately dead domain).

### 2.2 Audio, video and iframes

61 `media-player` and 2 `iframe` warnings on Neuros became plain links. With 1.2 in place
they become `sections.embed`; until then, at least preserve the poster image and title.

### 2.3 Menus → a Navigation single type

Menus are exported (2 menus, 11 items on Northfield) and then ignored. Generate a
`navigation` single type with a repeatable `link` component, resolving each item to the
migrated entry so links point at real content.

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

### 2.7 Custom fields that hold media URLs

Meta Box's `project_audio_file` stores a URL to an MP3 on the old site. It was migrated as
a string, so five projects still point at WordPress for their audio. When a field's values
are URLs under `/wp-content/uploads/`, treat it as media: upload the file and store the
Strapi media reference.

---

## P3 — Robustness

### 3.1 Namespace the idempotency key

Entries are matched on `wpId`. Two WordPress sites migrated into one Strapi would collide,
because both number their posts from 1. Add `wpSite` (the source host) and match on the
pair. We sidestepped this in testing by running a second Strapi.

### 3.2 Parallel uploads and resume

204 media uploads ran sequentially on Neuros. A small concurrency limit (4–6) and a resume
flag would matter on a site with thousands of images. The upload cache already survives
restarts, so this is mostly plumbing.

### 3.3 Preflight checks

Before writing anything: Strapi reachable, token valid and full-access, target types
present, WordPress reachable and authenticated, helper plugin installed. Fail with one
clear message instead of a mid-run error.

*Evidence:* two separate Strapi startup failures cost real time —
`DATABASE_FILENAME=` empty (SQLite opening a directory) and a TypeScript error in the
bootstrap file. Both are detectable up front.

### 3.4 Incremental runs

Add `--since <date>` so a second pass only touches entries modified after the first. Useful
for the real-world pattern of migrating, then catching up on content written during the
cutover.

### 3.5 A written plan file

`analyze.js` prints its plan to the terminal. Also write `migration-plan.md` so the plan can
be reviewed in a pull request, and so the reviewer's decisions live next to the config.

---

## P4 — Make it a usable skill

### 4.1 `SKILL.md` (blocking)

The skill has no `SKILL.md`, so Claude can't load it. It needs: when to trigger, the
prerequisites, the five steps, the review gate before generating, and the Strapi v5 rules
the engine depends on.

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
