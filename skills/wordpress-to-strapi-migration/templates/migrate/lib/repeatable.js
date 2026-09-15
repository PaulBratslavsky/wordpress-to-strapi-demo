/**
 * Repeating custom fields → repeatable components.
 *
 * A list of experience rows stored as `json` is a blob nobody can edit in the
 * admin. Strapi's answer is a repeatable component, which needs one thing
 * WordPress does not provide: field names.
 *
 * Meta Box stores a repeater as **positional arrays** —
 * `[["2012 - 2017", "Microsoft Inc.", "Triggerfish bluntnose…"], …]` — with no
 * names anywhere. So names are invented only where a column's shape is
 * unmistakable (a URL, an icon class, a year range, a paragraph of prose).
 * Anything else keeps its position as its name, `field2`, which a reviewer can
 * map back to the second column and rename. Guessing "company" and being wrong
 * would put a falsehood in the schema, and schemas are believed.
 */

import { camel } from './util.js';

/** Long enough to be prose rather than a label. */
const LONG = 80;

const isScalar = (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const isIntLike = (v) => typeof v === 'number' || (typeof v === 'string' && /^\d+$/.test(v.trim()));
const isLong = (v) => String(v).length > LONG || String(v).includes('\n');

const typeFor = (values) => (values.some(isLong) ? 'text' : 'string');

/** A name only when the column says clearly what it is; otherwise its position. */
function columnName(values, index) {
  const strs = values.map(String);
  if (strs.every((v) => /^https?:\/\//i.test(v))) return 'url';
  if (strs.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return 'email';
  if (strs.every((v) => /^(fa[srlbdk]?[ -])?(fa|icon)-[a-z0-9-]+$/i.test(v))) return 'icon';
  if (strs.every((v) => /^\d{4}\s*[-–—]\s*(\d{4}|present|now)$/i.test(v))) return 'period';
  if (strs.some(isLong)) return 'description';
  return `field${index + 1}`;
}

/** Two columns that read the same way keep the first name; the rest fall back to position. */
function dedupe(columns) {
  const taken = new Set();
  return columns.map((col, i) => {
    if (!taken.has(col.name)) {
      taken.add(col.name);
      return col;
    }
    return { ...col, name: `field${i + 1}` };
  });
}

/**
 * The label a person sees on the component in Strapi's admin. Field names reach
 * here in camelCase (`experienceList`), and a label of "ExperienceList" reads
 * like a variable rather than a name.
 */
export const componentLabel = (name) =>
  String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * WordPress meta is multi-row, so a single value usually arrives wrapped in a
 * one-item array and the analyzer unwraps it. A one-item array whose item is
 * *itself* an array is not that: it is a repeater with one row, and unwrapping
 * it turns the row's cells into what looks like a flat list of strings — which
 * then migrates as one field holding "250+,Awesome team members".
 *
 * Objects are deliberately not covered. An ACF image arrives as `[{…}]` and has
 * to unwrap to be recognised, and telling that apart from a one-row repeater of
 * named fields is guesswork.
 */
export const wrapsRow = (v) => Array.isArray(v) && Array.isArray(v[0]);

/**
 * What a repeating field looks like, or null when it is not something a
 * component can describe — in which case the caller keeps `json`.
 *
 * `values` is one sample list per entry.
 */
export function listShape(values) {
  const rows = (values ?? []).filter((v) => Array.isArray(v) && v.length).flat();
  if (!rows.length) return null;

  // A flat list of strings: one field, repeated.
  if (rows.every(isScalar)) {
    // Lists of ids are relations, and the analyzer catches them earlier. Refusing
    // them here too means a change of ordering can never turn one into a component.
    if (rows.every(isIntLike)) return null;
    return { kind: 'scalar', columns: [{ name: 'value', type: typeFor(rows) }] };
  }

  // Meta Box's repeater: positional arrays, no names.
  if (rows.every((row) => Array.isArray(row) && row.every(isScalar))) {
    const width = Math.max(...rows.map((row) => row.length));
    const columns = [];
    for (let i = 0; i < width; i++) {
      const col = rows.map((row) => row[i]).filter((v) => v !== undefined && v !== null && v !== '');
      columns.push(col.length ? { name: columnName(col, i), type: typeFor(col) } : { name: `field${i + 1}`, type: 'string' });
    }
    return { kind: 'tuple', columns: dedupe(columns) };
  }

  // ACF Pro repeaters arrive already named.
  if (rows.every((row) => row && typeof row === 'object' && !Array.isArray(row))) {
    const keys = [];
    for (const row of rows) for (const key of Object.keys(row)) if (!keys.includes(key)) keys.push(key);
    if (!keys.length) return null;
    const columns = keys.map((key) => ({
      name: camel(key),
      key,
      type: typeFor(rows.map((row) => row[key]).filter((v) => v !== undefined && v !== null)),
    }));
    return { kind: 'object', columns: dedupe(columns) };
  }

  return null;
}
