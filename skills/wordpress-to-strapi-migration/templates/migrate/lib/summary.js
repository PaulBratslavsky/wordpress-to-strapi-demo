/**
 * The run, as something a person can read.
 *
 * `migration-report.json` records everything and communicates nothing: it is the
 * right format for grepping and the wrong one for the five minutes after a run,
 * when the questions are what moved, what broke, and which entries should I go
 * look at. This answers those in order, and says each warning code in words —
 * "table-flattened ×4" only means something to someone who already knows.
 *
 * Codes the engine can emit are explained below. An unrecognised one still gets
 * listed with its entries, because a warning nobody explained is still a warning
 * worth seeing.
 */

const EXPLANATIONS = {
  'table-flattened': "Tables became plain paragraphs — Strapi's Blocks field has no table node. Use `--format markdown`, or `bodyMode: dynamic-zone`, to keep them.",
  table: 'The body contains a table. Blocks has no table node, so it cannot survive as a table in that field.',
  'list-item-flattened': 'Nested list items were flattened to a single level.',
  gallery: 'A gallery became consecutive images — Blocks has no gallery node. A dynamic zone keeps it as one component.',
  embed: 'An embed (YouTube, Vimeo, X …) became a plain link. A dynamic zone keeps it as `sections.embed`.',
  iframe: 'An iframe became a plain link. Blocks cannot hold arbitrary HTML.',
  'media-player': 'An audio or video player became a link to the file.',
  'raw-html': 'Raw HTML with no Blocks equivalent was reduced to its text.',
  'possible-shortcode': 'Something shaped like a shortcode survived as literal text. Whatever plugin used to render it is not coming with you.',
  'link-dropped': 'A link was dropped because Blocks cannot nest it where it appeared.',
  'page-builder': 'The entry was built with a page builder. Its layout flattens to rich text unless the type uses `bodyMode: dynamic-zone`.',
  sections: 'The body was split into components for a dynamic zone.',
  'elementor-widget-skipped': 'An Elementor widget held no prose to take — usually something structural like a grid, icon list or carousel. These are rebuild candidates.',
  'elementor-unreadable': "Elementor's stored JSON could not be parsed, so the rendered HTML was used instead.",
  'media-missing': 'A media reference had no matching file in the export.',
  'image-missing': 'An image referenced in the body was not found in the media library.',
  'image-failed': 'An image could not be uploaded to Strapi. See the files section above.',
  'image-not-embedded': 'An image could not be embedded in Blocks and was left as a link.',
  'file-link-missing': 'A link pointing at an uploaded file could not be resolved.',
  'section-image-dropped': 'An image was dropped from a component because it could not be uploaded, rather than leaving a WordPress URL behind.',
};

const LIST_CAP = 10;

const entryLabel = (w) => [w.type, w.slug || (w.wpId != null ? `#${w.wpId}` : '')].filter(Boolean).join(' ');

function groupBy(items, key) {
  const out = new Map();
  for (const item of items) {
    const k = item[key] ?? 'unknown';
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(item);
  }
  return [...out.entries()].sort((a, b) => b[1].length - a[1].length);
}

function failuresSection(failures) {
  if (!failures.length) return ['## Failures', '', 'None — every entry the migration attempted was written.', ''];

  const lines = [
    `## Failures (${failures.length})`,
    '',
    'These did not make it. Fix the cause and re-run; entries are matched on their WordPress id,',
    'so a re-run updates rather than duplicates.',
    '',
    '| Type | WordPress id | Slug | Pass | Error |',
    '|---|---|---|---|---|',
  ];
  for (const f of failures) {
    const cells = [f.type ?? '', f.wpId ?? '', f.slug ?? '', f.pass ?? 'entries', String(f.error ?? '').replace(/\|/g, '\\|')];
    lines.push(`| ${cells.join(' | ')} |`);
  }
  lines.push('');
  return lines;
}

function mediaSection(media) {
  if (!media.length) return [];
  const lines = [
    `## Files that could not be migrated (${media.length})`,
    '',
    'Each is named once with the reason. Anything using them kept working — the migration drops',
    'the reference rather than leaving a WordPress URL in your new site.',
    '',
  ];
  for (const f of media.slice(0, LIST_CAP)) lines.push(`- \`${f.url}\` — ${f.reason}`);
  if (media.length > LIST_CAP) lines.push(`- … and ${media.length - LIST_CAP} more`);
  lines.push('');
  return lines;
}

function warningsSection(warnings) {
  if (!warnings.length) return ['## Flagged for review', '', 'Nothing was flagged.', ''];

  const groups = groupBy(warnings, 'code');
  const lines = [
    `## Flagged for review (${warnings.length})`,
    '',
    'Not errors — decisions the migration made that a person should confirm.',
    '',
  ];

  for (const [code, items] of groups) {
    const entries = [...new Set(items.map(entryLabel))].filter(Boolean);
    lines.push(`### \`${code}\` — ${items.length} ${items.length === 1 ? 'time' : 'times'}, ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`, '');
    if (EXPLANATIONS[code]) lines.push(EXPLANATIONS[code], '');
    for (const entry of entries.slice(0, LIST_CAP)) {
      const detail = items.find((i) => entryLabel(i) === entry)?.detail;
      lines.push(`- ${entry}${detail ? ` — ${detail}` : ''}`);
    }
    if (entries.length > LIST_CAP) lines.push(`- … and ${entries.length - LIST_CAP} more`);
    lines.push('');
  }
  return lines;
}

export function summaryMarkdown(report) {
  const counts = report.counts ?? {};
  const failures = report.failures ?? [];
  const warnings = report.warnings ?? [];
  const media = report.media ?? [];
  const total = Object.values(counts).reduce((n, c) => n + c, 0);

  const out = [
    '# Migration summary',
    '',
    `Finished ${report.finishedAt ?? 'unknown'} · **${total} ${total === 1 ? 'entry' : 'entries'}** across ${Object.keys(counts).length} ${Object.keys(counts).length === 1 ? 'type' : 'types'}`,
    '',
  ];

  if (report.dryRun) {
    out.push('> **Dry run — nothing was written to Strapi.** Payloads were converted and previewed only.', '');
  }

  out.push('## What moved', '', '| Type | Entries |', '|---|---|');
  for (const [type, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) out.push(`| ${type} | ${n} |`);
  out.push(`| **Total** | **${total}** |`, '');

  // Menus are not entries, but they moved, and "what moved" should say so.
  if (report.navigation) {
    const { menus = 0, items = 0 } = report.navigation;
    out.push(`Navigation: ${menus} ${menus === 1 ? 'menu' : 'menus'}, ${items} ${items === 1 ? 'item' : 'items'}.`, '');
  }

  out.push(...failuresSection(failures), ...mediaSection(media), ...warningsSection(warnings));

  if (!failures.length && !warnings.length && !media.length) {
    out.push('Nothing was flagged and nothing failed — a clean run.', '');
  }

  out.push('---', '', 'Every item above is in `migration-report.json` in full.', '');
  return out.join('\n');
}
