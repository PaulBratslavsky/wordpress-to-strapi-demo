/**
 * `bodyMode` is the decision the review step asks you to make: how a post
 * type's body should land in Strapi.
 *
 *   blocks        prose, as Strapi's Blocks field   (the default)
 *   markdown      prose, as Markdown in a richtext field
 *   dynamic-zone  page-builder layouts, as a dynamic zone of sections.*
 *
 * analyze.js proposes one from the evidence and writes the matching field.
 * Changing it in migration.config.json used to do nothing, because generate.js
 * only read `fields`, so the documented gate was decorative: the only edit that
 * worked was rewriting the field by hand. generate.js now calls this first, so
 * the config edit the tutorial describes is the one that decides.
 */

const BODY_FIELD_SOURCE = 'content';

const SHAPES = {
  blocks: { type: 'blocks', transform: 'content' },
  markdown: { type: 'richtext', transform: 'content' },
  'dynamic-zone': { type: 'dynamiczone', transform: 'sections' },
};

/** The body field of a type, whatever it was renamed to. */
const bodyFieldOf = (t) => Object.entries(t.fields ?? {}).find(([, f]) => f.from === BODY_FIELD_SOURCE);

/**
 * Reshape a type's body field to match its `bodyMode`. Returns a description of
 * the change, or false when there was nothing to do, so callers can report it.
 */
export function applyBodyMode(t) {
  const mode = t.bodyMode;
  if (!mode) return false;
  if (!(mode in SHAPES)) {
    throw new Error(
      `${t.singularName ?? 'type'}: bodyMode "${mode}" is not one of ${Object.keys(SHAPES).join(', ')}`
    );
  }

  const found = bodyFieldOf(t);
  if (!found) return false;
  const [name, field] = found;

  const want = SHAPES[mode];
  if (field.type === want.type) return false;

  const was = field.type;
  field.type = want.type;
  field.transform = want.transform;
  if (want.type === 'dynamiczone') field.components = field.components ?? [];
  else delete field.components;

  return { field: name, from: was, to: want.type };
}
