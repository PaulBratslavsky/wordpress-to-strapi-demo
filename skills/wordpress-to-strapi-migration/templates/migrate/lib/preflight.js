/**
 * Checks that run before the migration writes anything.
 *
 * Every failure here is one we hit for real and only discovered mid-run, after
 * some entries had already been created: a relation pointing at a type nobody
 * generated, a dynamic zone naming a component that doesn't exist, a Strapi that
 * hadn't been restarted since `generate.js` wrote its schemas. Finding them up
 * front costs one round-trip per type and saves a half-migrated Strapi.
 */

import { SECTION_COMPONENTS, NAVIGATION_COMPONENTS } from './components.js';
import { routeFor } from './util.js';

export { routeFor };

/**
 * The transforms `migrate.js` knows how to apply — every name `analyze.js` emits,
 * including `raw`, which is the deliberate pass-through and reaches the switch's
 * default case. The list has to be exhaustive: an unknown transform falls through
 * to that same default and copies the value unchanged, so a typo is silent, and
 * anything missing here would reject a perfectly good config instead.
 */
const TRANSFORMS = new Set([
  'raw',
  'text',
  'excerpt',
  'content',
  'sections',
  'group',
  'site',
  'slug',
  'date-gmt',
  'datetime',
  'date-ymd',
  'number',
  'boolean',
  'media',
  'seo-yoast',
]);

/** Components that exist without the config defining them. */
const BUILT_IN_COMPONENTS = new Set([
  ...Object.keys(SECTION_COMPONENTS),
  ...Object.keys(NAVIGATION_COMPONENTS),
  'shared.seo',
]);

/**
 * Static problems in the config: things that cannot work no matter what Strapi
 * looks like. Returns a list of human-readable messages, empty when it's sound.
 */
export function checkConfig(config) {
  const errors = [];
  const types = config.types ?? {};
  const known = new Set(Object.keys(types));
  const components = new Set([...BUILT_IN_COMPONENTS, ...Object.keys(config.components ?? {})]);

  for (const [name, t] of Object.entries(types)) {
    for (const [fieldName, fld] of Object.entries(t.fields ?? {})) {
      const at = `${name}.${fieldName}`;

      if (fld.type === 'relation' && !known.has(fld.target)) {
        errors.push(`${at}: relation targets "${fld.target}", which no type in this config defines`);
      }

      if (fld.type === 'component' && fld.component && !components.has(fld.component)) {
        errors.push(`${at}: uses component "${fld.component}", which is not defined`);
      }

      if (fld.type === 'dynamiczone') {
        for (const uid of fld.components ?? []) {
          if (!components.has(uid)) errors.push(`${at}: dynamic zone lists component "${uid}", which is not defined`);
        }
      }

      if (fld.transform && !TRANSFORMS.has(fld.transform)) {
        errors.push(`${at}: unknown transform "${fld.transform}" (known: ${[...TRANSFORMS].join(', ')})`);
      }
    }
  }

  return errors;
}

/**
 * Which of the config's types Strapi doesn't serve yet — nearly always because
 * `generate.js` ran but Strapi wasn't restarted. `probe` takes a plural API id
 * and resolves to an HTTP status, so this stays testable without a server.
 */
export async function checkStrapi(config, probe) {
  const missing = [];
  for (const t of Object.values(config.types ?? {})) {
    const route = routeFor(t);
    if ((await probe(route)) === 404) missing.push(route);
  }
  return missing;
}

/** A `probe` backed by a real Strapi client. */
export function probeWith(strapi) {
  return async (pluralName) => {
    try {
      await strapi.request(`/api/${pluralName}?pagination[pageSize]=1`);
      return 200;
    } catch (err) {
      if (err.status) return err.status;
      throw new Error(`Strapi is not reachable at ${strapi.baseUrl} (${err.message})`);
    }
  };
}

/**
 * Runs both checks and returns the messages a caller should print before
 * refusing to start. Empty means go.
 */
export async function preflight(config, strapi) {
  const problems = checkConfig(config);
  const probe = probeWith(strapi);

  const unauthorized = [];
  const missing = [];
  for (const t of Object.values(config.types ?? {})) {
    const route = routeFor(t);
    const status = await probe(route);
    if (status === 404) missing.push(route);
    else if (status === 401 || status === 403) unauthorized.push(route);
  }

  if (missing.length) {
    problems.push(
      `Strapi doesn't serve ${missing.length} of the config's types: ${missing.join(', ')}. ` +
        'Run `node generate.js`, then restart Strapi so it loads the new schemas.'
    );
  }
  if (unauthorized.length) {
    problems.push(
      `The API token can't read ${unauthorized.join(', ')}. Use a full-access token ` +
        '(Settings → API Tokens → Full access).'
    );
  }

  return problems;
}
