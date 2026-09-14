/**
 * The proposed plan, written as a document instead of terminal output.
 *
 * `analyze.js` prints its plan and the terminal scrolls away, which is a poor
 * fit for the one moment in this pipeline that genuinely needs review: what
 * each WordPress field is about to become. Written next to the config, the plan
 * can be read in a pull request and the reviewer's decisions live beside the
 * file they apply to.
 */

import { routeFor } from './util.js';

/** How a field reads in the plan — the same vocabulary the config uses. */
export function fieldKind(fld) {
  switch (fld.type) {
    case 'relation':
      return `relation ${fld.relation} → ${fld.target}`;
    case 'media':
      return `media${fld.multiple ? ' (multiple)' : ''}`;
    case 'component':
      return `component ${fld.component}${fld.repeatable ? ' (repeatable)' : ''}`;
    case 'dynamiczone':
      return 'dynamic zone';
    default:
      return fld.type;
  }
}

/** How many entries the export holds for a type. */
export function entryCount(t, data) {
  const kind = t.source?.kind;
  if (kind === 'menus') return (data.menus?.menus ?? []).length;
  if (kind === 'users') return (data.users ?? []).length;
  if (kind === 'taxonomy') return (data.terms?.[t.source.slug] ?? []).length;
  return (data.entries?.[t.source?.slug] ?? []).length;
}

const escape = (s) => String(s).replace(/\|/g, '\\|');

/**
 * Where a field's value comes from. Some fields have no WordPress source at all —
 * `wpSite` is filled in from the site being migrated — so name the transform
 * rather than printing "undefined" at the reviewer.
 */
const fieldSource = (fld) =>
  fld.from == null ? (fld.transform ? `_${fld.transform}_` : '—') : `\`${escape(fld.from)}\``;

function typeSection(t, data) {
  // Users and menus have no WordPress slug behind them — naming one would print "undefined".
  const src = t.source?.slug ? `${t.source.kind} \`${t.source.slug}\`` : (t.source?.kind ?? 'unknown');
  const n = entryCount(t, data);
  const unit = t.source?.kind === 'menus' ? (n === 1 ? 'menu' : 'menus') : n === 1 ? 'entry' : 'entries';
  const lines = [
    `### ${t.displayName || t.singularName} — \`/api/${routeFor(t)}\`${t.kind === 'singleType' ? ' _(single type)_' : ''}`,
    '',
    `Source: ${src} · ${n} ${unit}${t.bodyMode ? ` · body: **${t.bodyMode}**` : ''}`,
    '',
    '| | Field | From | Strapi type |',
    '|---|---|---|---|',
  ];

  for (const [name, fld] of Object.entries(t.fields ?? {})) {
    lines.push(`| ${fld.note ? '⚑' : ''} | \`${name}\` | ${fieldSource(fld)} | ${escape(fieldKind(fld))} |`);
  }

  const ignored = Object.entries(t.ignoredMeta ?? {});
  if (ignored.length) {
    lines.push('', `<details><summary>${ignored.length} custom field(s) not migrated</summary>`, '');
    for (const [key, why] of ignored) lines.push(`- \`${key}\` — ${why}`);
    lines.push('', '</details>');
  }

  return lines.join('\n');
}

export function planMarkdown(config, data, flags = []) {
  const site = data.site ?? {};
  const types = Object.values(config.types ?? {});
  const today = new Date().toISOString().slice(0, 10);

  const out = [
    `# Migration plan — ${site.name ?? site.home ?? 'WordPress site'}`,
    '',
    `Source: ${site.home ?? config.source?.url} · generated ${today} · body format: **${config.content?.format ?? 'blocks'}**`,
    '',
    'This is a proposal, not a result. It describes what `migration.config.json` will build if',
    'you run `generate.js` as it stands. Edit the config — rename a type, drop a field, set a',
    '`urlPattern` — and re-read this file after re-running `analyze.js`.',
    '',
    `## Content types (${types.length})`,
    '',
  ];

  for (const t of types) out.push(typeSection(t, data), '');

  if (flags.length) {
    out.push(
      '## Decisions to review',
      '',
      'Each line is somewhere the analyzer had to choose. Confirm the choice or change the config.',
      ''
    );
    for (const m of flags) out.push(`- ⚑ ${m}`);
    out.push('');
  }

  out.push(
    '## Next steps',
    '',
    '1. Edit `migration.config.json` until this plan describes what you want.',
    '2. `node generate.js` — writes the Strapi schemas. Restart Strapi so it picks them up.',
    '3. `node migrate.js` — moves the content, twice (entries, then relations).',
    '4. `node verify.js` — counts what landed and flags anything still pointing at WordPress.',
    ''
  );

  return out.join('\n');
}
