import { loadJson } from './util.js';
import { applyBodyMode } from './bodymode.js';

/**
 * Load migration.config.json the way every step must see it.
 *
 * `bodyMode` is the review step's decision, so it has to be applied before the
 * config is used, and by every script: generate.js writes the schema from it,
 * migrate.js decides how to convert each body from it, and verify.js reads the
 * shape back. Applying it in generate.js alone produced the worst outcome of
 * the three: Strapi got a dynamic zone while the migration still sent Blocks,
 * and every page failed with "__component is a required field".
 *
 * `onChange` is called for each field that was reshaped, so a CLI can say so.
 */
export function loadConfig(file, { onChange } = {}) {
  const config = loadJson(file);
  for (const t of Object.values(config.types ?? {})) {
    const change = applyBodyMode(t);
    if (change && onChange) onChange(t, change);
  }
  return config;
}
