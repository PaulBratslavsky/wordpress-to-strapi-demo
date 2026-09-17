import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The export on disk.
 *
 * Entries live one per line in <dir>/entries/<post type>.ndjson, and everything
 * else (site, types, taxonomies, terms, users, media, menus, stats) goes in
 * <dir>/export.json. Nothing is ever one giant JSON string, which is what a
 * single export.json becomes on a large site: a WordPress post with its body
 * and meta is tens of KB, so 100,000 of them is gigabytes, and Node refuses to
 * parse a string that big.
 *
 * Writing per type also gives the export a checkpoint. Each type's file is
 * complete the moment it is written, so a run that dies half way can be
 * resumed instead of started again.
 *
 * An export.json written by an older version has its entries inlined. Those
 * still load, so existing exports and fixtures keep working.
 */

const entriesDir = (dir) => path.join(dir, 'entries');
export const entryFile = (dir, slug) => path.join(entriesDir(dir), `${slug}.ndjson`);

/** Write one post type's entries, one JSON object per line. */
export function writeEntries(dir, slug, items) {
  mkdirSync(entriesDir(dir), { recursive: true });
  const body = items.map((item) => JSON.stringify(item)).join('\n');
  writeFileSync(entryFile(dir, slug), items.length ? `${body}\n` : '');
  return items.length;
}

/** Read one post type's entries back. */
export function readEntries(dir, slug) {
  const file = entryFile(dir, slug);
  if (!existsSync(file)) {
    throw new Error(`Missing ${path.relative(dir, file)}. Run export.js again, or delete ${dir} and start over.`);
  }
  const raw = readFileSync(file, 'utf8');
  const items = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      items.push(JSON.parse(line));
    } catch (err) {
      throw new Error(`${path.relative(dir, file)}: line ${items.length + 1} is not valid JSON (${err.message})`);
    }
  }
  return items;
}

/**
 * What is already on disk, as { slug: count }. The export uses this to skip
 * types it finished before it was interrupted.
 */
export function exportProgress(dir) {
  if (!existsSync(entriesDir(dir))) return {};
  const done = {};
  for (const name of readdirSync(entriesDir(dir))) {
    if (!name.endsWith('.ndjson')) continue;
    const slug = name.slice(0, -'.ndjson'.length);
    done[slug] = readEntries(dir, slug).length;
  }
  return done;
}

/**
 * Write the manifest, and any entries not already written by writeEntries.
 * Returns the manifest path.
 */
export function writeExport(dir, snapshot) {
  mkdirSync(dir, { recursive: true });
  const { entries = {}, ...rest } = snapshot;

  const entryCounts = {};
  for (const [slug, items] of Object.entries(entries)) {
    entryCounts[slug] = existsSync(entryFile(dir, slug)) && !items ? readEntries(dir, slug).length : writeEntries(dir, slug, items ?? []);
  }

  const manifest = { ...rest, entryCounts, format: 'per-type-ndjson' };
  const file = path.join(dir, 'export.json');
  writeFileSync(file, JSON.stringify(manifest, null, 2));
  return file;
}

/**
 * Load an export. `only` limits which post types are read from disk; the rest
 * come back as empty arrays, so a narrowed run does not pay for types it will
 * not touch.
 */
export function loadExport(manifestPath, { only } = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.entries) return manifest; // written before the split

  const dir = path.dirname(manifestPath);
  const wanted = only ? new Set(only) : null;
  const entries = {};
  for (const slug of Object.keys(manifest.entryCounts ?? {})) {
    entries[slug] = !wanted || wanted.has(slug) ? readEntries(dir, slug) : [];
  }
  return { ...manifest, entries };
}
