# Migrated Content Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the migration put WordPress bodies into a Strapi dynamic zone of section components — built from Elementor's own layout data where it exists — instead of flattening everything into one Blocks field.

**Architecture:** Two pure functions turn a body into an ordered list of plain *section descriptors*: one reads cleaned HTML, one reads Elementor's `_elementor_data` JSON. A component catalogue maps each descriptor to a Strapi component (schema for `generate.js`, payload for `migrate.js`). Content types keep today's `content: blocks` unless the analyzer proposes `bodyMode: "dynamic-zone"`, in which case they get a `sections` dynamic zone instead.

**Tech Stack:** Node 20+, ES modules, `node --test` (no new dependencies), linkedom + turndown + marked (already used), Strapi v5.

**Spec:** [`docs/superpowers/specs/2026-09-13-migrated-content-structure-design.md`](../specs/2026-09-13-migrated-content-structure-design.md)

> **Executed 2026-09-14.** All seven tasks are done; 17 tests pass (`node --test test/*.test.js`).
> Three things came out of running it on real sites and are now in the code:
> a refused upload (Strapi rejects SVG by default) must not fail the whole entry;
> `string` component fields need clamping to Strapi's 255-character limit;
> and links inside components need the same rewriting the body HTML gets.
> The unknown-widget fallback also had to read any prose-looking setting, not a fixed list,
> which cut skipped Elementor widgets from 441 to 172.

## Global Constraints

- All engine code lives in `skills/wordpress-to-strapi-migration/templates/migrate/`.
- No new npm dependencies. Tests use Node's built-in runner: `node --test`.
- ES modules only (`"type": "module"`), 2-space indent, single quotes, matching the existing files.
- Every `sections.rich-text` body must pass Strapi's `blocksValidator` (already vendored for tests at `test/strapi-blocks-validator.cjs`).
- Default behaviour must not change: with no `bodyMode` in the config, a type still gets `content: blocks`.
- Component category is `sections`; component UIDs are exactly those in the spec's table.
- Descriptor objects are plain JSON — no class instances, no DOM nodes — so they can be snapshotted in tests.

---

### Task 1: Section descriptors from HTML

**Files:**
- Create: `skills/wordpress-to-strapi-migration/templates/migrate/lib/sections.js`
- Create: `skills/wordpress-to-strapi-migration/templates/migrate/test/sections-html.test.js`

**Interfaces:**
- Consumes: `parseWordPressHtml(html, { shortcodes })` from `lib/html.js`, which returns `{ body, warnings }` where `body` is a linkedom element.
- Produces: `htmlToSections(html, options) → { sections: Descriptor[], warnings: Warning[] }`.
  `Descriptor` is one of:
  `{ kind: 'rich-text', html }`, `{ kind: 'image', src, alt, caption }`,
  `{ kind: 'gallery', images: [{ src, alt }], caption }`,
  `{ kind: 'embed', url, provider, title }`,
  `{ kind: 'table', rows: string[][], hasHeader, caption }`,
  `{ kind: 'code', code, language }`, `{ kind: 'quote', quote, attribution }`,
  `{ kind: 'cta', heading, text, label, url }`.
  `Warning` is `{ code, detail }`, same shape the engine already uses.

- [ ] **Step 1: Write the failing test**

```js
// test/sections-html.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToSections } from '../lib/sections.js';

test('collapses consecutive prose into one rich-text section', () => {
  const { sections } = htmlToSections('<p>One</p><h2>Two</h2><p>Three</p>');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].kind, 'rich-text');
  assert.match(sections[0].html, /One/);
  assert.match(sections[0].html, /Three/);
});

test('splits a table out of the prose around it', () => {
  const html = '<p>Before</p><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table><p>After</p>';
  const { sections } = htmlToSections(html);
  assert.deepEqual(sections.map((s) => s.kind), ['rich-text', 'table', 'rich-text']);
  assert.deepEqual(sections[1].rows, [['A'], ['1']]);
  assert.equal(sections[1].hasHeader, true);
});

test('emits image, gallery, embed, code and quote sections', () => {
  const html = [
    '<figure class="wp-block-image"><img src="/a.jpg" alt="A"/><figcaption>Cap</figcaption></figure>',
    '<figure class="wp-block-gallery"><figure><img src="/b.jpg" alt="B"/></figure><figure><img src="/c.jpg" alt="C"/></figure></figure>',
    '<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">https://youtu.be/abc</div></figure>',
    '<pre><code class="language-js">const x = 1;</code></pre>',
    '<blockquote><p>Quoted</p><cite>Someone</cite></blockquote>',
  ].join('');
  const { sections } = htmlToSections(html);
  assert.deepEqual(sections.map((s) => s.kind), ['image', 'gallery', 'embed', 'code', 'quote']);
  assert.equal(sections[0].caption, 'Cap');
  assert.equal(sections[1].images.length, 2);
  assert.equal(sections[2].url, 'https://youtu.be/abc');
  assert.equal(sections[3].language, 'js');
  assert.equal(sections[4].attribution, 'Someone');
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd skills/wordpress-to-strapi-migration/templates/migrate && node --test test/sections-html.test.js`
Expected: FAIL — `Cannot find module '../lib/sections.js'`.

- [ ] **Step 3: Implement `htmlToSections`**

```js
// lib/sections.js
import { parseWordPressHtml } from './html.js';

const text = (el) => (el?.textContent ?? '').trim();

function tableDescriptor(table) {
  const rows = [...table.querySelectorAll('tr')].map((tr) =>
    [...tr.querySelectorAll('th,td')].map((cell) => text(cell))
  );
  return {
    kind: 'table',
    rows,
    hasHeader: Boolean(table.querySelector('thead th, tr th')),
    caption: text(table.closest('figure')?.querySelector('figcaption')),
  };
}

function classify(node) {
  if (node.nodeType !== 1) return null;
  const el = node;
  const table = el.matches?.('table') ? el : el.querySelector?.('table');
  if (table) return tableDescriptor(table);

  const images = [...(el.querySelectorAll?.('img') ?? [])];
  const isGallery = el.matches?.('figure.wp-block-gallery, .gallery') || images.length > 1;
  if (isGallery && images.length) {
    return {
      kind: 'gallery',
      images: images.map((img) => ({ src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' })),
      caption: text(el.querySelector(':scope > figcaption')),
    };
  }

  const embedWrapper = el.matches?.('figure.wp-block-embed, .wp-block-embed') ? el : null;
  if (embedWrapper) {
    const url = text(embedWrapper.querySelector('.wp-block-embed__wrapper')) || embedWrapper.querySelector('iframe')?.getAttribute('src') || '';
    return { kind: 'embed', url, provider: providerOf(url), title: text(embedWrapper.querySelector('figcaption')) };
  }

  const pre = el.matches?.('pre') ? el : null;
  if (pre) {
    const code = pre.querySelector('code');
    const language = (code?.getAttribute('class') || '').replace(/.*language-([a-z0-9+#-]+).*/i, '$1');
    return { kind: 'code', code: code ? code.textContent : pre.textContent, language: language && language !== code?.getAttribute('class') ? language : '' };
  }

  if (el.matches?.('blockquote, figure.wp-block-pullquote')) {
    const cite = el.querySelector('cite');
    const attribution = text(cite);
    if (cite) cite.remove();
    return { kind: 'quote', quote: text(el), attribution };
  }

  if (images.length === 1 && !text(el).replace(text(el.querySelector('figcaption')) || '', '').trim()) {
    const img = images[0];
    return {
      kind: 'image',
      src: img.getAttribute('src'),
      alt: img.getAttribute('alt') || '',
      caption: text(el.querySelector('figcaption')),
    };
  }

  if (el.matches?.('.wp-block-buttons')) {
    const link = el.querySelector('a');
    if (link) return { kind: 'cta', heading: '', text: '', label: text(link), url: link.getAttribute('href') || '' };
  }
  return null;
}

function providerOf(url = '') {
  const host = (url.match(/^https?:\/\/([^/]+)/i) || [])[1] || '';
  if (/youtu/i.test(host)) return 'youtube';
  if (/vimeo/i.test(host)) return 'vimeo';
  if (/twitter|x\.com/i.test(host)) return 'twitter';
  return host.replace(/^www\./, '');
}

export function htmlToSections(html, options = {}) {
  const { body, warnings } = parseWordPressHtml(html, options);
  const sections = [];
  let prose = [];
  const flush = () => {
    const markup = prose.join('').trim();
    if (markup) sections.push({ kind: 'rich-text', html: markup });
    prose = [];
  };
  for (const node of [...body.childNodes]) {
    const descriptor = classify(node);
    if (descriptor) {
      flush();
      sections.push(descriptor);
    } else if (node.nodeType === 1) {
      prose.push(node.outerHTML);
    } else if (node.textContent.trim()) {
      prose.push(`<p>${node.textContent.trim()}</p>`);
    }
  }
  flush();
  return { sections, warnings };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/sections-html.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/wordpress-to-strapi-migration/templates/migrate/lib/sections.js skills/wordpress-to-strapi-migration/templates/migrate/test/sections-html.test.js
git commit -m "feat(migrate): split WordPress HTML into section descriptors"
```

---

### Task 2: Section descriptors from Elementor data

**Files:**
- Modify: `skills/wordpress-to-strapi-migration/templates/migrate/lib/sections.js`
- Create: `skills/wordpress-to-strapi-migration/templates/migrate/test/sections-elementor.test.js`

**Interfaces:**
- Produces: `elementorToSections(data) → { sections: Descriptor[], warnings: Warning[] }` where `data` is the parsed `_elementor_data` array (or a JSON string). Adds two descriptor kinds:
  `{ kind: 'feature', title, text, icon, src, url }` and `{ kind: 'hero', heading, subheading, src, label, url }`.
- Media inside Elementor settings arrives as `{ id, url }`; descriptors carry `src` (the URL) and `mediaId` (the WordPress attachment id) so Task 4 can resolve either.

- [ ] **Step 1: Write the failing test**

```js
// test/sections-elementor.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elementorToSections } from '../lib/sections.js';

const page = [
  {
    elType: 'container',
    elements: [
      { elType: 'widget', widgetType: 'heading', settings: { title: 'Big claim' } },
      { elType: 'widget', widgetType: 'text-editor', settings: { editor: '<p>Sub copy</p>' } },
      { elType: 'widget', widgetType: 'button', settings: { text: 'Start', link: { url: '/contact/' } } },
      { elType: 'widget', widgetType: 'image', settings: { image: { id: 42, url: 'http://old/x.jpg' } } },
    ],
  },
  {
    elType: 'section',
    elements: [
      { elType: 'column', elements: [
        { elType: 'widget', widgetType: 'icon-box', settings: { title_text: 'Fast', description_text: 'Loads quickly', selected_icon: { value: 'fas fa-bolt' } } },
        { elType: 'widget', widgetType: 'unknown-widget', settings: { nothing: true } },
      ] },
    ],
  },
];

test('first section with heading plus media becomes a hero', () => {
  const { sections } = elementorToSections(page);
  assert.equal(sections[0].kind, 'hero');
  assert.equal(sections[0].heading, 'Big claim');
  assert.equal(sections[0].label, 'Start');
  assert.equal(sections[0].url, '/contact/');
  assert.equal(sections[0].mediaId, 42);
});

test('maps known widgets and reports unknown ones', () => {
  const { sections, warnings } = elementorToSections(page);
  assert.deepEqual(sections.slice(1).map((s) => s.kind), ['feature']);
  assert.equal(sections[1].title, 'Fast');
  assert.equal(sections[1].icon, 'fas fa-bolt');
  assert.ok(warnings.some((w) => w.code === 'elementor-widget-skipped' && w.detail.includes('unknown-widget')));
});

test('accepts the raw JSON string WordPress stores', () => {
  const { sections } = elementorToSections(JSON.stringify(page));
  assert.equal(sections[0].kind, 'hero');
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/sections-elementor.test.js`
Expected: FAIL — `elementorToSections is not a function`.

- [ ] **Step 3: Implement `elementorToSections`**

```js
// lib/sections.js  (append)

const widgetText = (settings) =>
  [settings.title, settings.editor, settings.description_text, settings.text, settings.title_text]
    .filter((v) => typeof v === 'string' && v.trim())
    .join('\n');

/** Every widget inside one top-level section, in order. */
function widgetsOf(node, out = []) {
  if (node.elType === 'widget') out.push(node);
  for (const child of node.elements ?? []) widgetsOf(child, out);
  return out;
}

function widgetDescriptor(widget, warn) {
  const s = widget.settings ?? {};
  const media = s.image ?? s.background_image ?? null;
  switch (widget.widgetType) {
    case 'heading':
    case 'text-editor':
      return { kind: 'rich-text', html: s.editor || `<h2>${s.title ?? ''}</h2>` };
    case 'image':
      return { kind: 'image', src: media?.url ?? '', mediaId: media?.id, alt: s.caption ?? '', caption: s.caption ?? '' };
    case 'icon-box':
    case 'image-box':
      return {
        kind: 'feature',
        title: s.title_text ?? '',
        text: s.description_text ?? '',
        icon: s.selected_icon?.value ?? '',
        src: media?.url ?? '',
        mediaId: media?.id,
        url: s.link?.url ?? '',
      };
    case 'button':
      return { kind: 'cta', heading: '', text: '', label: s.text ?? '', url: s.link?.url ?? '' };
    case 'testimonial':
      return { kind: 'quote', quote: s.testimonial_content ?? '', attribution: [s.testimonial_name, s.testimonial_job].filter(Boolean).join(', ') };
    case 'video':
      return { kind: 'embed', url: s.youtube_url ?? s.vimeo_url ?? s.hosted_url?.url ?? '', provider: s.video_type ?? '', title: '' };
    default: {
      const html = widgetText(s);
      if (html) return { kind: 'rich-text', html };
      warn('elementor-widget-skipped', `${widget.widgetType} (no text content)`);
      return null;
    }
  }
}

/** Merge consecutive rich-text descriptors so a section isn't split into scraps. */
function mergeProse(descriptors) {
  return descriptors.reduce((out, d) => {
    const prev = out[out.length - 1];
    if (d.kind === 'rich-text' && prev?.kind === 'rich-text') prev.html += `\n${d.html}`;
    else out.push({ ...d });
    return out;
  }, []);
}

export function elementorToSections(data) {
  const warnings = [];
  const warn = (code, detail) => warnings.push({ code, detail: String(detail).slice(0, 200) });
  let tree = data;
  if (typeof tree === 'string') {
    try {
      tree = JSON.parse(tree);
    } catch {
      warn('elementor-unreadable', 'could not parse _elementor_data');
      return { sections: [], warnings };
    }
  }
  const sections = [];
  for (const [index, top] of (Array.isArray(tree) ? tree : []).entries()) {
    const descriptors = mergeProse(widgetsOf(top).map((w) => widgetDescriptor(w, warn)).filter(Boolean));
    const heading = descriptors.find((d) => d.kind === 'rich-text');
    const image = descriptors.find((d) => d.kind === 'image');
    const cta = descriptors.find((d) => d.kind === 'cta');
    // A first section that leads with words plus a picture or a button is a hero.
    if (index === 0 && heading && (image || cta)) {
      sections.push({
        kind: 'hero',
        heading: (heading.html.match(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/i) || [, ''])[1] || stripTags(heading.html),
        subheading: stripTags(heading.html.replace(/<h[1-6][\s\S]*?<\/h[1-6]>/i, '')),
        src: image?.src ?? '',
        mediaId: image?.mediaId,
        label: cta?.label ?? '',
        url: cta?.url ?? '',
      });
      sections.push(...descriptors.filter((d) => d !== heading && d !== image && d !== cta));
      continue;
    }
    sections.push(...descriptors);
  }
  return { sections, warnings };
}

const stripTags = (html = '') => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/sections-elementor.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/wordpress-to-strapi-migration/templates/migrate/lib/sections.js skills/wordpress-to-strapi-migration/templates/migrate/test/sections-elementor.test.js
git commit -m "feat(migrate): build section descriptors from Elementor layout data"
```

---

### Task 3: The component catalogue

**Files:**
- Create: `skills/wordpress-to-strapi-migration/templates/migrate/lib/components.js`
- Create: `skills/wordpress-to-strapi-migration/templates/migrate/test/components.test.js`

**Interfaces:**
- Consumes: descriptors from Tasks 1–2.
- Produces:
  - `SECTION_COMPONENTS: Record<uid, { kinds: string[], schema: object }>` — the catalogue.
  - `componentsFor(sections) → string[]` — the component UIDs a list of descriptors needs.
  - `sectionsToZone(sections, ctx) → Promise<object[]>` — Strapi dynamic-zone payload, where
    `ctx = { media, links, convertHtml }`; `convertHtml(html) → Promise<{ value, warnings }>`
    is `convertContent` bound to Blocks output, `media.ensure(ref)` resolves a WordPress
    media id or URL to a Strapi file.

- [ ] **Step 1: Write the failing test**

```js
// test/components.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTION_COMPONENTS, componentsFor, sectionsToZone } from '../lib/components.js';

const ctx = {
  media: { ensure: async (ref) => (ref ? { id: 7, url: '/uploads/x.jpg' } : null) },
  convertHtml: async (html) => ({ value: [{ type: 'paragraph', children: [{ type: 'text', text: html }] }], warnings: [] }),
};

test('catalogue schemas are valid Strapi components', () => {
  for (const [uid, entry] of Object.entries(SECTION_COMPONENTS)) {
    assert.match(uid, /^sections\.[a-z-]+$/);
    assert.ok(entry.schema.collectionName.startsWith('components_sections_'));
    assert.ok(Object.keys(entry.schema.attributes).length > 0);
  }
});

test('componentsFor lists only what the sections need', () => {
  assert.deepEqual(
    componentsFor([{ kind: 'rich-text', html: '' }, { kind: 'table', rows: [] }]).sort(),
    ['sections.rich-text', 'sections.table']
  );
});

test('sectionsToZone builds a dynamic zone payload with resolved media', async () => {
  const zone = await sectionsToZone(
    [
      { kind: 'rich-text', html: '<p>Hi</p>' },
      { kind: 'image', src: '/a.jpg', alt: 'A', caption: 'C' },
      { kind: 'table', rows: [['A'], ['1']], hasHeader: true, caption: '' },
    ],
    ctx
  );
  assert.deepEqual(zone.map((c) => c.__component), ['sections.rich-text', 'sections.image', 'sections.table']);
  assert.equal(zone[1].image, 7);
  assert.deepEqual(zone[2].rows, [['A'], ['1']]);
  assert.equal(zone[0].body[0].type, 'paragraph');
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/components.test.js`
Expected: FAIL — `Cannot find module '../lib/components.js'`.

- [ ] **Step 3: Implement the catalogue**

```js
// lib/components.js
const component = (name, icon, attributes) => ({
  collectionName: `components_sections_${name.replace(/-/g, '_')}s`,
  info: { displayName: name.replace(/(^|-)(\w)/g, (_, d, c) => (d ? ' ' : '') + c.toUpperCase()), icon },
  options: {},
  attributes,
});

const media = (multiple = false) => ({ type: 'media', multiple, allowedTypes: ['images', 'files', 'videos'] });

export const SECTION_COMPONENTS = {
  'sections.rich-text': { kinds: ['rich-text'], schema: component('rich-text', 'align-left', { body: { type: 'blocks' } }) },
  'sections.image': { kinds: ['image'], schema: component('image', 'picture', { image: media(), caption: { type: 'string' }, alt: { type: 'string' } }) },
  'sections.gallery': { kinds: ['gallery'], schema: component('gallery', 'grid', { images: media(true), caption: { type: 'string' } }) },
  'sections.embed': { kinds: ['embed'], schema: component('embed', 'play', { url: { type: 'string' }, provider: { type: 'string' }, title: { type: 'string' } }) },
  'sections.table': { kinds: ['table'], schema: component('table', 'grid', { rows: { type: 'json' }, caption: { type: 'string' }, hasHeader: { type: 'boolean', default: true } }) },
  'sections.code': { kinds: ['code'], schema: component('code', 'code', { code: { type: 'text' }, language: { type: 'string' } }) },
  'sections.quote': { kinds: ['quote'], schema: component('quote', 'quote', { quote: { type: 'text' }, attribution: { type: 'string' } }) },
  'sections.cta': { kinds: ['cta'], schema: component('cta', 'cursor', { heading: { type: 'string' }, text: { type: 'text' }, label: { type: 'string' }, url: { type: 'string' } }) },
  'sections.feature': { kinds: ['feature'], schema: component('feature', 'star', { title: { type: 'string' }, text: { type: 'text' }, icon: { type: 'string' }, image: media(), url: { type: 'string' } }) },
  'sections.hero': { kinds: ['hero'], schema: component('hero', 'landscape', { heading: { type: 'string' }, subheading: { type: 'text' }, image: media(), label: { type: 'string' }, url: { type: 'string' } }) },
};

const UID_BY_KIND = Object.fromEntries(
  Object.entries(SECTION_COMPONENTS).flatMap(([uid, entry]) => entry.kinds.map((kind) => [kind, uid]))
);

export function componentsFor(sections) {
  return [...new Set(sections.map((s) => UID_BY_KIND[s.kind]).filter(Boolean))];
}

export async function sectionsToZone(sections, ctx) {
  const zone = [];
  for (const s of sections) {
    const __component = UID_BY_KIND[s.kind];
    if (!__component) continue;
    const fileFor = async (descriptor) => (await ctx.media.ensure(descriptor.mediaId ?? descriptor.src))?.id;
    switch (s.kind) {
      case 'rich-text': {
        const { value, warnings } = await ctx.convertHtml(s.html);
        warnings?.forEach((w) => ctx.warn?.(w.code, w.detail));
        if (value) zone.push({ __component, body: value });
        break;
      }
      case 'image':
        zone.push({ __component, image: await fileFor(s), caption: s.caption || undefined, alt: s.alt || undefined });
        break;
      case 'gallery': {
        const ids = [];
        for (const img of s.images) {
          const file = await ctx.media.ensure(img.mediaId ?? img.src);
          if (file) ids.push(file.id);
        }
        zone.push({ __component, images: ids, caption: s.caption || undefined });
        break;
      }
      case 'table':
        zone.push({ __component, rows: s.rows, caption: s.caption || undefined, hasHeader: Boolean(s.hasHeader) });
        break;
      case 'hero':
      case 'feature':
        zone.push({ __component, ...s, kind: undefined, src: undefined, mediaId: undefined, image: await fileFor(s) });
        break;
      default:
        zone.push({ __component, ...s, kind: undefined });
    }
  }
  return zone.map((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)));
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `node --test test/components.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add skills/wordpress-to-strapi-migration/templates/migrate/lib/components.js skills/wordpress-to-strapi-migration/templates/migrate/test/components.test.js
git commit -m "feat(migrate): add the sections component catalogue"
```

---

### Task 4: Propose `bodyMode` in the analyzer

**Files:**
- Modify: `skills/wordpress-to-strapi-migration/templates/migrate/analyze.js`
- Create: `skills/wordpress-to-strapi-migration/templates/migrate/test/body-mode.test.js`

**Interfaces:**
- Produces: `proposeBodyMode({ items, builderCount, format }) → 'blocks' | 'dynamic-zone' | 'markdown'`, exported from `analyze.js` so it can be tested without running the CLI.
- Writes `bodyMode` on each type in `migration.config.json`, and sets the content field to
  `{ type: 'dynamiczone', from: 'content', transform: 'sections' }` when the mode is `dynamic-zone`.

- [ ] **Step 1: Write the failing test**

```js
// test/body-mode.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeBodyMode } from '../analyze.js';

test('mostly page-builder entries get a dynamic zone', () => {
  assert.equal(proposeBodyMode({ items: 43, builderCount: 22, format: 'blocks' }), 'dynamic-zone');
  assert.equal(proposeBodyMode({ items: 21, builderCount: 21, format: 'blocks' }), 'dynamic-zone');
});

test('ordinary prose stays on blocks', () => {
  assert.equal(proposeBodyMode({ items: 9, builderCount: 0, format: 'blocks' }), 'blocks');
  assert.equal(proposeBodyMode({ items: 8, builderCount: 2, format: 'blocks' }), 'blocks');
});

test('the markdown format is never overridden', () => {
  assert.equal(proposeBodyMode({ items: 43, builderCount: 43, format: 'markdown' }), 'markdown');
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/body-mode.test.js`
Expected: FAIL — `proposeBodyMode is not a function`.

- [ ] **Step 3: Implement and wire it in**

In `analyze.js`, export the rule and use it where the content field is defined:

```js
/** More than half the entries built with a page builder → the page-builder lane. */
export function proposeBodyMode({ items, builderCount, format }) {
  if (format === 'markdown') return 'markdown';
  return items > 0 && builderCount / items > 0.5 ? 'dynamic-zone' : 'blocks';
}
```

Inside the post-type loop, after `builder` is counted (it is already computed for the
warning), replace the content-field assignment with:

```js
    const bodyMode = proposeBodyMode({ items: items.length, builderCount: builder, format });
    t.bodyMode = bodyMode;
    if (has((e) => e.content?.rendered?.trim())) {
      f.content =
        bodyMode === 'dynamic-zone'
          ? { type: 'dynamiczone', components: [], from: 'content', transform: 'sections' }
          : { type: richType, from: 'content', transform: 'content' };
    }
```

Move the `builder` count above the field definitions so it is available, and mention the
choice in the printed plan:

```js
    console.log(`■ ${t.displayName}  (${src}, ${n}) → api::${t.singularName}.${t.singularName}  /api/${t.pluralName}  [body: ${t.bodyMode ?? 'n/a'}]`);
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node --test test/`
Expected: PASS — all four test files.

- [ ] **Step 5: Commit**

```bash
git add skills/wordpress-to-strapi-migration/templates/migrate/analyze.js skills/wordpress-to-strapi-migration/templates/migrate/test/body-mode.test.js
git commit -m "feat(analyze): propose a body mode per content type"
```

---

### Task 5: Generate components and the dynamic-zone attribute

**Files:**
- Modify: `skills/wordpress-to-strapi-migration/templates/migrate/generate.js`
- Create: `skills/wordpress-to-strapi-migration/templates/migrate/test/generate-dynamiczone.test.js`

**Interfaces:**
- Consumes: `SECTION_COMPONENTS` from `lib/components.js`; `bodyMode` and the `dynamiczone`
  field from Task 4.
- Produces: `src/components/sections/<name>.json` files, and a content-type attribute
  `{ type: 'dynamiczone', components: [...] }`.

- [ ] **Step 1: Write the failing test**

```js
// test/generate-dynamiczone.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attribute, componentsInUse } from '../generate.js';
import { SECTION_COMPONENTS } from '../lib/components.js';

test('a dynamiczone field becomes a Strapi dynamiczone attribute', () => {
  const attr = attribute({ type: 'dynamiczone', components: ['sections.rich-text', 'sections.table'] });
  assert.deepEqual(attr, { type: 'dynamiczone', components: ['sections.rich-text', 'sections.table'] });
});

test('an empty component list falls back to the whole catalogue', () => {
  const attr = attribute({ type: 'dynamiczone', components: [] });
  assert.deepEqual(attr.components, Object.keys(SECTION_COMPONENTS));
});

test('componentsInUse collects both section and normal components', () => {
  const config = { types: { page: { fields: { sections: { type: 'dynamiczone', components: ['sections.hero'] }, seo: { type: 'component', component: 'shared.seo' } } } } };
  assert.deepEqual(componentsInUse(config).sort(), ['sections.hero', 'shared.seo']);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/generate-dynamiczone.test.js`
Expected: FAIL — `attribute is not exported`.

- [ ] **Step 3: Implement**

In `generate.js`: export `attribute`, add the `dynamiczone` case, merge the section
catalogue into the component definitions, and collect components from both field types.

```js
import { SECTION_COMPONENTS } from './lib/components.js';

const COMPONENTS = {
  'shared.seo': { /* unchanged */ },
  ...Object.fromEntries(Object.entries(SECTION_COMPONENTS).map(([uid, entry]) => [uid, entry.schema])),
};

export function attribute(field) {
  switch (field.type) {
    case 'dynamiczone':
      return { type: 'dynamiczone', components: field.components?.length ? field.components : Object.keys(SECTION_COMPONENTS) };
    // …existing cases unchanged…
  }
}

export function componentsInUse(config) {
  const uids = new Set();
  for (const t of Object.values(config.types)) {
    for (const f of Object.values(t.fields)) {
      if (f.type === 'component') uids.add(f.component);
      if (f.type === 'dynamiczone') (f.components?.length ? f.components : Object.keys(SECTION_COMPONENTS)).forEach((u) => uids.add(u));
    }
  }
  return [...uids];
}
```

Add `dynamiczone` to `FIELD_TYPES`, and in `main()` replace the component-collection block
with `for (const uid of componentsInUse(config)) writeComponent(a.out, uid, COMPONENTS[uid]);`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node --test test/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add skills/wordpress-to-strapi-migration/templates/migrate/generate.js skills/wordpress-to-strapi-migration/templates/migrate/test/generate-dynamiczone.test.js
git commit -m "feat(generate): write section components and dynamic-zone attributes"
```

---

### Task 6: Migrate bodies into the dynamic zone

**Files:**
- Modify: `skills/wordpress-to-strapi-migration/templates/migrate/migrate.js`
- Modify: `skills/wordpress-to-strapi-migration/templates/migrate/verify.js`
- Create: `skills/wordpress-to-strapi-migration/templates/migrate/test/sections-transform.test.js`

**Interfaces:**
- Consumes: `htmlToSections`, `elementorToSections`, `sectionsToZone`, `componentsFor`.
- Produces: the `sections` transform in `valueFor`, chosen when a field's type is
  `dynamiczone`. Elementor data is read from `migration_meta._elementor_data` when present.

- [ ] **Step 1: Write the failing test**

```js
// test/sections-transform.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sectionsForEntry } from '../lib/sections.js';

test('prefers Elementor data when the entry has it', () => {
  const entry = {
    content: { rendered: '<p>fallback</p>' },
    migration_meta: { _elementor_data: JSON.stringify([{ elType: 'container', elements: [{ elType: 'widget', widgetType: 'heading', settings: { title: 'From Elementor' } }] }]) },
  };
  const { sections, source } = sectionsForEntry(entry, {});
  assert.equal(source, 'elementor');
  assert.match(sections[0].html, /From Elementor/);
});

test('falls back to the rendered HTML', () => {
  const { sections, source } = sectionsForEntry({ content: { rendered: '<p>Just prose</p>' } }, {});
  assert.equal(source, 'html');
  assert.equal(sections[0].kind, 'rich-text');
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test test/sections-transform.test.js`
Expected: FAIL — `sectionsForEntry is not a function`.

- [ ] **Step 3: Implement**

Add to `lib/sections.js`:

```js
/** Elementor's own data if the entry has it, otherwise the rendered HTML. */
export function sectionsForEntry(entry, options = {}) {
  const data = entry.migration_meta?._elementor_data;
  if (data) {
    const { sections, warnings } = elementorToSections(data);
    if (sections.length) return { sections, warnings, source: 'elementor' };
  }
  const html = entry.content?.rendered ?? entry.content ?? '';
  const { sections, warnings } = htmlToSections(String(html), options);
  return { sections, warnings, source: 'html' };
}
```

In `migrate.js`, add the transform:

```js
      case 'sections': {
        const { sections, warnings: found, source } = sectionsForEntry(item, { shortcodes: config.content?.shortcodes ?? 'strip' });
        found.forEach((w) => warn(w.code, w.detail));
        if (!sections.length) return undefined;
        warn('sections', `${sections.length} from ${source}`);
        return sectionsToZone(sections, {
          media,
          warn,
          convertHtml: (html) => convertContent(html, { format: 'blocks', media, links, shortcodes: config.content?.shortcodes ?? 'strip' }),
        });
      }
```

In `verify.js`, populate dynamic zones explicitly so the URL scan still sees inside them:

```js
const populateFor = (t) => {
  const zones = Object.entries(t.fields).filter(([, f]) => f.type === 'dynamiczone');
  if (!zones.length) return { populate: '*' };
  const params = { populate: '*' };
  for (const [name, f] of zones) {
    for (const uid of f.components ?? []) params[`populate[${name}][on][${uid}][populate]`] = '*';
  }
  return params;
};
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `node --test test/`
Expected: PASS — six test files.

- [ ] **Step 5: Commit**

```bash
git add skills/wordpress-to-strapi-migration/templates/migrate/lib/sections.js skills/wordpress-to-strapi-migration/templates/migrate/migrate.js skills/wordpress-to-strapi-migration/templates/migrate/verify.js skills/wordpress-to-strapi-migration/templates/migrate/test/sections-transform.test.js
git commit -m "feat(migrate): fill dynamic zones from HTML and Elementor sections"
```

---

### Task 7: End-to-end on both demo sites

**Files:**
- Modify: `docs/migration-findings.md` (add a "dynamic zone" results section)

**Interfaces:** none — this task runs the pipeline and records what happened.

- [ ] **Step 1: Regenerate the Northfield schema with the new lane**

```bash
cd <run-northfield>
node analyze.js --format blocks          # page should now propose bodyMode: dynamic-zone
grep -n '"bodyMode"' migration.config.json
node generate.js --out <strapi> --force
```
Expected: `src/components/sections/*.json` written, `page` gains a `sections` dynamiczone.

- [ ] **Step 2: Migrate and check one page**

```bash
node migrate.js --only page
curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:1337/api/pages?filters[slug][$eq]=home&populate[sections][on][sections.hero][populate]=*&populate[sections][on][sections.rich-text][populate]=*' | head -c 600
```
Expected: a `sections` array whose first entry is `sections.hero` with a resolved image.

- [ ] **Step 3: Run the Neuros site the same way**

```bash
cd <run-neuros>
node analyze.js --format blocks   # page, service and case-study should propose dynamic-zone
node generate.js --out <strapi-neuros> --force
node migrate.js --only page,service,case-study
node verify.js
```
Expected: counts unchanged, `sections` populated, unknown-widget warnings listed by name.

- [ ] **Step 4: Record the outcome**

Add to `docs/migration-findings.md`: how many sections each site produced, the component
mix, and the unknown Elementor widgets by name and count.

- [ ] **Step 5: Commit**

```bash
git add docs/migration-findings.md
git commit -m "docs: record dynamic-zone migration results for both sites"
```

---

## Self-review

- **Spec coverage:** `bodyMode` (Task 4), component set (Task 3), HTML segmentation (Task 1), Elementor mapping (Task 2), generation (Task 5), migration and verify (Task 6), reporting via the `sections` and `elementor-widget-skipped` warnings (Tasks 2 and 6), end-to-end testing (Task 7). The spec's "markdown lane unchanged" is covered by `proposeBodyMode` returning `markdown` untouched.
- **Placeholders:** none — every step has runnable code or an exact command.
- **Type consistency:** descriptor kinds (`rich-text`, `image`, `gallery`, `embed`, `table`, `code`, `quote`, `cta`, `feature`, `hero`) are identical across Tasks 1, 2, 3 and 6; `SECTION_COMPONENTS` keys match the spec's UIDs; `sectionsToZone`, `componentsFor`, `componentsInUse`, `attribute`, `proposeBodyMode` and `sectionsForEntry` are each defined once and used with the same signature everywhere.
