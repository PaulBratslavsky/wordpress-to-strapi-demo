/**
 * Internal links and redirects.
 *
 * WordPress content hard-codes absolute links to the site itself
 * ("http://my-site.local/2019/05/our-kitchen/"). After migration those need
 * to point at the new frontend. Each migrated entry gets a new path from its
 * type's `urlPattern` in migration.config.json — e.g. "/blog/{slug}" — and
 * with no pattern the original path is kept, so a frontend that mirrors the
 * WordPress permalinks needs no redirects at all.
 *
 * "Kept" holds only as far as the slug does. A Strapi uid has to be ASCII and
 * unique per type, so an accented slug is transliterated and a colliding one is
 * suffixed; those URLs change whether or not anyone chose a pattern. The new
 * path therefore follows the final slug, which is what turns a silent loss of
 * inbound links into a redirect.
 *
 * Every old → new path pair that differs is collected as a redirect in the
 * `{ source, destination, permanent }` shape Next.js / Vercel understand.
 */

const withSlash = (p) => (p.endsWith('/') ? p : `${p}/`);

/** The same path, with its final segment replaced by the slug the entry ended up with. */
const withSlug = (p, slug) => p.replace(/[^/]+\/$/, `${slug}/`);

export class LinkRewriter {
  constructor({ siteUrl }) {
    this.site = new URL(siteUrl);
    this.byPath = new Map(); // old path → new path
    this.byId = new Map(); // wp post id → new path (for ?p=123 links)
    this.redirects = [];
  }

  static fill(pattern, { slug, id, oldPath }) {
    return pattern
      .replaceAll('{slug}', slug)
      .replaceAll('{id}', String(id))
      .replaceAll('{path}', oldPath.replace(/^\/|\/$/g, ''));
  }

  /** Register a migrated entry or term. `postId` is set for post-type entries (enables ?p= lookups). */
  add({ link, id, slug, pattern, isPost }) {
    if (!link) return;
    let u;
    try {
      u = new URL(link, this.site);
    } catch {
      return;
    }
    const plain = u.searchParams.has('p') || u.searchParams.has('page_id'); // drafts have no pretty permalink
    const oldPath = plain ? `/${slug}/` : withSlash(u.pathname);
    const newPath = pattern ? LinkRewriter.fill(pattern, { slug, id, oldPath }) : withSlug(oldPath, slug);
    if (isPost) this.byId.set(id, newPath);
    if (plain || oldPath === '/') return; // nothing public to redirect from (or it's the front page)
    this.byPath.set(oldPath, newPath);
    if (newPath !== oldPath) this.redirects.push({ source: oldPath, destination: newPath, permanent: true });
  }

  isInternal(href) {
    if (!href || href.startsWith('#')) return false;
    try {
      return new URL(href, this.site).host === this.site.host;
    } catch {
      return false;
    }
  }

  /** New root-relative URL for a link into the old site. Unknown internal paths stay as they were, minus the host. */
  rewrite(href) {
    const u = new URL(href, this.site);
    const id = Number(u.searchParams.get('p') || u.searchParams.get('page_id'));
    const target = this.byPath.get(withSlash(u.pathname)) ?? (id ? this.byId.get(id) : undefined);
    return target ? `${target}${u.hash}` : `${u.pathname}${u.search}${u.hash}`;
  }
}
