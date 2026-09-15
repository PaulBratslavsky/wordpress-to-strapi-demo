import { readFileSync } from 'node:fs';
import he from 'he';

/** Small, dependency-light helpers shared by every step of the pipeline. */

export const kebab = (s) =>
  String(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();

export const camel = (s) =>
  String(s)
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());

export const pluralize = (s) =>
  /[^aeiou]y$/.test(s) ? s.replace(/y$/, 'ies') : /(s|x|z|ch|sh)$/.test(s) ? `${s}es` : `${s}s`;

/**
 * A Strapi `uid` must match /^[A-Za-z0-9-_.~]*$/. WordPress slugs can be
 * percent-encoded UTF-8 ("cr%c3%a8me-brulee"), so decode, fold accents to
 * ASCII, and collapse anything else to hyphens.
 */
export function slugify(input) {
  let s = String(input ?? '');
  try {
    s = decodeURIComponent(s);
  } catch {
    /* not percent-encoded */
  }
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Decode HTML entities (&#8217; &amp; &hellip; ...) that WordPress adds to rendered strings. */
export const decode = (s) => he.decode(String(s ?? ''));

/** Rendered HTML → plain text (keeps paragraph/line breaks). */
export function htmlToText(html) {
  return decode(
    String(html ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Read "a.b.c" from an object; returns undefined for any missing hop. */
export const getPath = (obj, p) =>
  String(p)
    .split('.')
    .reduce((o, k) => (o == null ? undefined : o[k]), obj);

export const loadJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

export const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/**
 * Minimal argv parser: `--key value` pairs, plus boolean flags listed in `bools`.
 *   parseArgs(process.argv, ['dry-run']) → { export: '...', 'dry-run': true }
 */
/**
 * Where a configured type answers. A Strapi single type lives at its singular
 * route (`/api/navigation`), a collection at the plural one (`/api/posts`), and
 * several places — preflight, the plan, the analyzer's report — need to agree.
 */
export const routeFor = (t) => (t.kind === 'singleType' ? t.singularName : t.pluralName);

export function parseArgs(argv, bools = []) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (bools.includes(key)) out[key] = true;
    else out[key] = argv[++i];
  }
  return out;
}

export function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}
