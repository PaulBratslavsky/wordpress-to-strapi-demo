/**
 * Incremental runs: `--since <date>`.
 *
 * The real cutover is not one migration, it is a migration followed by catching
 * up on everything written while you were migrating. `--since` narrows a run to
 * the entries WordPress says changed after a point in time.
 *
 * Three rules, each of them a way to lose content if you get it wrong:
 *
 *   - **Only post types can be filtered.** WordPress reports `modified_gmt` on
 *     entries and on nothing else — terms and users carry no modification date in
 *     either demo export — so taxonomies and authors always run. Skipping them
 *     would create a post whose new category was never made.
 *   - **A record with no date is migrated.** Absent evidence of a change is not
 *     evidence of no change, and the cost of being wrong is missing content.
 *   - **Slugs and links are not filtered** (that happens in the caller). Slugs are
 *     de-duplicated across the whole set and every entry's URL is registered for
 *     link rewriting, so narrowing that pass would change slugs and break links.
 */

/** Kinds that carry a modification date. Everything else is migrated whole. */
const DATED_KINDS = new Set(['postType']);

export function parseSince(value) {
  if (!value) return null;
  const text = String(value).trim();
  // A bare date means the start of that day in UTC, to match `modified_gmt`.
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00Z` : text;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`--since needs a date like 2026-01-01 or 2026-01-01T12:00:00Z, not "${value}"`);
  }
  return date;
}

/** WordPress writes `modified_gmt` without a zone; it is UTC. */
function modifiedAt(item) {
  const raw = item.modified_gmt || item.modified;
  if (!raw) return null;
  const when = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(raw) ? raw : `${raw}Z`);
  return Number.isNaN(when.getTime()) ? null : when;
}

export function changedSince(items, since, source = {}) {
  if (!since || !DATED_KINDS.has(source.kind)) return items;
  return items.filter((item) => {
    const when = modifiedAt(item);
    return when === null || when >= since;
  });
}

/**
 * Whether pass 2 has to read a type's `wpId → documentId` pairs back from Strapi
 * before it can resolve relations into that type.
 *
 * The question is whether this run's map is *complete*, not whether it is empty.
 * An empty map means the type wasn't migrated at all (`--only`), which the old
 * rule caught. A map holding only the few entries `--since` or `--limit` touched
 * is non-empty and still incomplete — and a relation pointing at an untouched
 * entry would resolve to nothing and be dropped without a word.
 */
export function shouldHydrate(target, { mapSize = 0, partial = new Set(), dryRun = false } = {}) {
  if (dryRun) return false;
  if (!mapSize) return true;
  return partial.has(target);
}
