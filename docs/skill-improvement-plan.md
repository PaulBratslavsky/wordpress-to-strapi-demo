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
> fatal), 2.3 (menus → a navigation single type), 2.5 (redirects for slugs that change), 2.7
> (caption URLs counted apart from stale content), 3.1 (`wpSite` namespacing), 3.3 (preflight),
> 3.5 (the written plan file), 4.4 (the readable run summary), 2.6 (refused file types) and
> 2.4 (what to do about comments), 3.4 (incremental runs), 1.3's repeating lists and 2.2
> (embeds keep their description), alongside 4.1–4.3.
>
> **Still open:** 1.4 and 3.2.

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

### 1.3 ACF Group → component, and repeating lists → repeatable components — **done**

An ACF Group used to land as flattened sibling fields (`resultsHeadline`, `resultsMetric`,
`resultsSummary`). The analyzer now detects that shape — a parent key holding nothing beside
`<parent>_<sub>` siblings — defines the component in the config, and the migration assembles
the nested object. Verified on the demo site: `results: { headline, metric, summary }`.

Repeating fields are now repeatable components too, rather than a `json` blob nobody can edit
in the admin. Both demo sites end with **no `json` fields left at all**.

The plan assumed these were "lists of objects". They aren't: Meta Box stores a repeater as
**positional arrays with no field names anywhere** — `[["2012 - 2017", "Microsoft Inc.",
"Triggerfish bluntnose…"], …]` — so a component has to invent them. Names are invented only
where a column's shape is unmistakable (a URL, an icon class, a year range, a paragraph of
prose); everything else keeps its position, `field2`, which a reviewer can trace to the second
column and rename. Guessing "company" and being wrong would put a falsehood in the schema, and
schemas get believed.

*Evidence:* Northfield `team.specialties` → `lists.team-specialties` with one `value` field,
migrating as `[{value: "ui"}, {value: "ux"}]`. Neuros `team_member_experience_list` →
`lists.team-member-experience-list` with `period, field2, description`, migrating as two rows
of real values. Lists of ids stay relations — all 14 Northfield and 6 Neuros relations survive
untouched, and `listShape` refuses id lists a second time so a change of ordering could never
turn a relation into a component.

**A bug found by fixture, not by reasoning.** WordPress meta is multi-row, so the analyzer
unwraps a one-item array to its value — and a repeater with a single row is a one-item array.
`[["250+", "Awesome team members"]]` was unwrapped into a flat list and migrated as one field
holding `"250+,Awesome team members"`. Neither demo site showed it, because the only real
single-row repeater is filtered earlier as a theme default; a synthetic fixture caught it. A
one-item array whose item is itself an array is now left alone.

Still deliberately out: relations and rich text inside a component are coerced to strings —
those are modelling decisions for a human. And a single-row repeater of *named objects* is
still read as one object, because an ACF image arrives as `[{…}]` and must unwrap to be
recognised; telling those two apart is guesswork.

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

### 2.2 Audio, video and iframes — **done**

Blocks cannot embed anything, so an iframe, video or audio player becomes a link. It used to
become a link whose text was the raw URL, which threw away the only human description the
embed had. The link now carries it: the `title` attribute, else the figcaption, else a named
provider ("View on YouTube"), else — for a link straight to a file — the file's own name.
Both lanes keep the same information: `sections.embed` now falls back to the iframe's title
where there is no caption.

*Evidence, all from the real Neuros export:* the contacts page's map migrated as
`maps.google.com/maps?q=London%20Eye%2C%20London…` and now reads **"London Eye, London,
United Kingdom"**; the home page's player now reads **"Video Placeholder"**; and home-5's
**34** untitled audio players, previously 34 copies of one long URL, now read
`audio_sample.mp3`.

*Supported but unexercised:* a `poster` frame is kept as an image, so a video leaves a picture
behind rather than a bare link. No embed in either demo site has a `poster` attribute, so that
path is covered by tests only.

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

### 2.4 Comments — **done**

Still not migrated, by design — but the analyzer no longer just counts them. The flag now says
what the two options are: install a comments plugin, or add a `comment` collection (author,
email, body, date, approved) with a relation to the entry and move them yourself. The flag
travels into `migration-plan.md` with the rest of the decisions, which is where someone is
actually deciding what to do about them.

### 2.5 Redirects that are actually useful — **done**

`redirects.json` was empty on both runs because URLs are preserved by default — but the gap
underneath was worse than "no redirect". With `urlPattern: null` the new path was the *old*
path, so when a slug could not survive the trip (a Strapi uid must be ASCII and unique per
type, so accented slugs are transliterated and colliding ones suffixed) the entry moved and
nothing recorded it. `rewrite()` then resolved internal links to the old path too, pointing
migrated content at a URL that no longer existed.

The new path now follows the final slug — the old path with its last segment replaced — so a
changed slug produces both a redirect and correct internal links, while an unchanged slug
still produces neither. The plan document explains `urlPattern` and its usual presets
(`/blog/{slug}`, `/{path}`, `{id}`) where the reviewer decides.

*Honest evidence:* the logic is covered by `test/redirects.test.js`, but **neither demo site
exercises it**. Northfield: 64 slugs, none accented, none colliding. Neuros: 139 slugs, one
that changes (`refund_returns` → `refund-returns`) — and that one is WooCommerce's sample
page, a draft whose permalink is `?page_id=12`, so it has no public URL to redirect from.
Zero redirects is the correct output for both. A site with accented or colliding published
slugs would be the real test.

### 2.6 File types Strapi rejects — **done**

Strapi refuses SVG uploads by default (`File type 'image/svg+xml' is not allowed`). Every theme
logo on Neuros hit this, and the run repeated Strapi's message once per file — which says
nothing new the second time, and never says what to do about it.

Now the rejection is recognised and the remedy given **once per type**, naming the type and the
three ways out: allow it in Settings → Media Library → Upload, convert the files, or re-run with
`--skip-types svg`. That flag gives up on a type before spending a download on it, and is checked
ahead of the dry-run stand-in so a dry run reports what a real one would skip. Every file is
still recorded individually, and `migration-summary.md` groups them by reason, so one refused
type reads as one problem with a count rather than as many.

*Evidence:* driven over the real Neuros export (18 SVGs among 389 files) with a Strapi that
refuses them: 18 failures recorded, **1** advice line rather than 18, and with `--skip-types svg`
the same 18 recorded for **0** downloads instead of 18 wasted ones.

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

### 3.4 Incremental runs — **done**

`--since <date>` narrows a run to the entries WordPress says changed after a point in time —
the real cutover pattern, where you migrate and then catch up on whatever was written while
you were migrating. Three rules, each of them a way to lose content if you get it wrong:

- **Only post types are filtered.** WordPress reports `modified_gmt` on entries and nothing
  else — 0 of 64 terms and users on Northfield, 0 of 26 on Neuros — so taxonomies and authors
  always run. Skipping them would create a post whose new category was never made.
- **A record with no date is migrated.** Absent evidence of a change is not evidence of no
  change, and the cost of being wrong is missing content.
- **Slugs and links are never filtered.** Slugs de-duplicate across the whole set and every
  entry's URL is registered for link rewriting, so narrowing that pass would change slugs and
  break internal links. `--since` narrows only what gets written.

Building it exposed a **latent bug that also affected `--limit`**. Pass 2 resolves relations
through the id map pass 1 fills in, and hydrated the rest from Strapi only when that map was
*empty* — correct for `--only`, wrong for anything that narrows a type. A map holding just the
few entries `--since` touched is non-empty and still incomplete, so relations pointing at
untouched entries would have resolved to nothing and been dropped silently. The question is now
completeness rather than emptiness, and hydration happens once per type instead of per entry.

*Evidence:* on Northfield, `--since 2020-01-01` writes 7 pages instead of 8 — exactly the one
page last modified in 2019 — while authors, categories, posts and services stay whole. A
date it cannot parse is refused outright rather than quietly migrating nothing.

*Not yet exercised:* the pass-2 hydration path is covered by unit tests only. Pass 2 does not
run in a dry run, so confirming it against a live Strapi needs an API token.

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

### 4.4 Reporting — **done**

`migration-report.json` is complete and communicates nothing. Every run now also writes
`migration-summary.md`, which answers the three questions anyone actually has afterwards: what
moved (a table of types and counts, plus the menus, which are not entries but did move), what
failed (each entry with its id, slug, pass and error), and what was flagged.

The flagged section is the point. Warnings are grouped by code, counted, and — this is the part
the JSON cannot do — **said in words**: `table-flattened ×4` only means something to someone who
already knows, so each of the twenty codes the engine can emit carries a sentence explaining what
happened and what to do about it. An unrecognised code is still listed with its entries, because a
warning nobody explained is still worth seeing. Each group then names the specific entries, which
is what turns a report into a to-do list.

*Evidence:* rendered from the Northfield run — 68 entries across 12 types, navigation 2 menus /
11 items, 16 warnings across six codes, each naming the posts and pages to look at.

Still open, and visible in that output: `table` and `table-flattened` fire on the same four
entries, so the reader is told one fact twice. The fix belongs in the converter, which emits both,
not in the summary that faithfully reports them.

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
