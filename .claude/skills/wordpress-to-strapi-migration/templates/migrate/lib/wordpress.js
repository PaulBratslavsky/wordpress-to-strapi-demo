/**
 * WordPress REST API client for the export step.
 *
 * - Discovers the API root at /wp-json/, falling back to ?rest_route= for
 *   sites still on "Plain" permalinks (where /wp-json/ 404s).
 * - Paginates with per_page=100 (the REST maximum) and the X-WP-TotalPages
 *   header. The old single-request script only ever saw the first 10 posts.
 * - Authenticates with an Application Password (HTTP Basic). With auth we can
 *   ask for `context=edit` (raw content, every status) instead of `view`.
 */

// Post types that are exposed over REST but aren't content to migrate.
export const SKIP_TYPES = new Set([
  'attachment', // handled as media
  'nav_menu_item',
  'wp_block', // synced patterns are already rendered into content
  'wp_template',
  'wp_template_part',
  'wp_navigation',
  'wp_global_styles',
  'wp_font_family',
  'wp_font_face',
  // page-builder templates, forms and shop internals — site chrome, not content
  'elementor_library',
  'elementor-hf',
  'elementor_snippet',
  'elementor_font',
  'elementor_icons',
  'e-floating-buttons',
  'wpforms',
  'wpcf7_contact_form',
  'mc4wp-form',
  'product_variation',
  'shop_order',
  'shop_coupon',
]);

// Content types skipped unless named explicitly with --types, and why.
export const EXCLUDED_BY_DEFAULT = {
  product:
    'WooCommerce products keep prices, variations and stock in WooCommerce tables — migrate them with the WooCommerce REST API',
};

export const SKIP_TAXONOMIES = new Set([
  'nav_menu',
  'wp_pattern_category',
  'wp_theme',
  'wp_template_part_area',
  'link_category',
  'post_format',
]);

/** REST route for a post type or taxonomy object returned by /wp/v2/types or /wp/v2/taxonomies. */
export const restRoute = (obj) => `/${obj.rest_namespace || 'wp/v2'}/${obj.rest_base || obj.slug}`;

export class WordPressClient {
  constructor({ baseUrl, user, appPassword }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.auth =
      user && appPassword
        ? `Basic ${Buffer.from(`${user}:${appPassword.replace(/\s+/g, '')}`).toString('base64')}`
        : null;
    this.mode = 'pretty'; // 'pretty' → /wp-json/..., 'query' → /?rest_route=...
  }

  get authenticated() {
    return Boolean(this.auth);
  }

  url(route, params = {}) {
    const u =
      this.mode === 'pretty' ? new URL(`${this.baseUrl}/wp-json${route}`) : new URL(`${this.baseUrl}/`);
    if (this.mode === 'query') u.searchParams.set('rest_route', route);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
    }
    return u.href;
  }

  async get(route, params = {}) {
    const url = this.url(route, params);
    const res = await fetch(url, {
      headers: { Accept: 'application/json', ...(this.auth ? { Authorization: this.auth } : {}) },
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* HTML error page, maintenance mode, etc. */
    }
    if (!res.ok || json === null) {
      const err = new Error(`GET ${url} -> ${res.status} ${json?.message || text.slice(0, 160)}`);
      err.status = res.status;
      err.code = json?.code;
      err.notJson = json === null;
      throw err;
    }
    return { json, headers: res.headers };
  }

  /** Locate the REST API and return its index (site name, url, namespaces). */
  async discover() {
    try {
      return (await this.get('/')).json;
    } catch (err) {
      if (err.status !== 404 && !err.notJson) throw err;
      this.mode = 'query';
      return (await this.get('/')).json;
    }
  }

  /**
   * Confirm the Application Password works. WordPress silently ignores Basic
   * auth when application passwords are unavailable (no HTTPS and
   * WP_ENVIRONMENT_TYPE isn't 'local'), which shows up here as a 401.
   */
  async whoAmI() {
    return (await this.get('/wp/v2/users/me', { context: 'edit' })).json;
  }

  /** Fetch every page of a collection route. */
  async all(route, params = {}, { onPage } = {}) {
    const items = [];
    let page = 1;
    let totalPages = 1;
    do {
      const { json, headers } = await this.get(route, { per_page: 100, ...params, page });
      if (!Array.isArray(json)) break;
      items.push(...json);
      totalPages = Number(headers.get('x-wp-totalpages') || 1);
      onPage?.(page, totalPages, items.length);
      page++;
    } while (page <= totalPages);
    return items;
  }

  /** Total item count for a route without downloading it. */
  async total(route, params = {}) {
    const { headers } = await this.get(route, { per_page: 1, ...params });
    return Number(headers.get('x-wp-total') || 0);
  }
}
