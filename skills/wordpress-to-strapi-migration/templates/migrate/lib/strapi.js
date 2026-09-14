/**
 * Tiny Strapi v5 REST client for the migration.
 *
 * Strapi v5 specifics this relies on:
 *  - Entries are addressed by `documentId` (a stable string), not the numeric
 *    id, and responses are flattened (no `data.attributes` like v4).
 *  - With Draft & Publish on, every document has a draft version. Looking an
 *    entry up by `wpId` with `status=draft` therefore finds it whether or not it
 *    is published. `?status=draft|published` on create/update chooses which
 *    version is written.
 *  - Files can't be uploaded while creating an entry. Upload first
 *    (POST /api/upload), then set the numeric file id on the media field.
 *    Relations take `{ set: [documentId, ...] }`.
 */

export class StrapiClient {
  constructor({ baseUrl, token }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }

  async request(path, { method = 'GET', body, headers = {} } = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...headers },
      body,
    });
    const text = await res.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(`${method} ${path} -> ${res.status} ${json?.error?.message || res.statusText}`);
      err.status = res.status;
      err.details = json?.error?.details;
      throw err;
    }
    return json;
  }

  #json(path, method, data) {
    return this.request(path, {
      method,
      body: JSON.stringify({ data }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Create an entry. `status` is 'published' or 'draft'. */
  async create(pluralApiId, data, { status = 'published' } = {}) {
    const res = await this.#json(`/api/${pluralApiId}?status=${status}`, 'POST', data);
    return res.data;
  }

  /** Update an entry by documentId. */
  async update(pluralApiId, documentId, data, { status = 'published' } = {}) {
    const res = await this.#json(`/api/${pluralApiId}/${documentId}?status=${status}`, 'PUT', data);
    return res.data;
  }

  /**
   * Write a single type. Strapi v5 has no separate create for these — one PUT
   * to the singular route both creates the document and replaces it later, so
   * re-running a migration overwrites rather than duplicating.
   */
  async putSingle(singularApiId, data, { status = 'published' } = {}) {
    const res = await this.#json(`/api/${singularApiId}?status=${status}`, 'PUT', data);
    return res.data;
  }

  /**
   * Find the entry migrated from a given WordPress id. This is what makes the
   * migration idempotent: re-running updates the same record instead of
   * creating a duplicate.
   */
  async findByWpId(pluralApiId, wpId, wpSite) {
    const lookup = async (filters) => {
      const qs = new URLSearchParams({ ...filters, 'pagination[pageSize]': '1', status: 'draft' });
      const res = await this.request(`/api/${pluralApiId}?${qs}`);
      return res.data?.[0] ?? null;
    };
    const byId = { 'filters[wpId][$eq]': String(wpId) };

    // Two WordPress sites both number their posts from 1, so the source host is
    // part of the key whenever one Strapi holds more than one migration.
    if (!wpSite) return lookup(byId);

    return (
      (await lookup({ ...byId, 'filters[wpSite][$eq]': String(wpSite) })) ??
      // Entries migrated before wpSite existed have none; match those too, so a
      // re-run updates them (and fills the field in) instead of duplicating.
      (await lookup({ ...byId, 'filters[wpSite][$null]': 'true' }))
    );
  }

  /** Number of documents in a collection (drafts included). */
  async count(pluralApiId) {
    const qs = new URLSearchParams({ 'pagination[pageSize]': '1', status: 'draft' });
    const res = await this.request(`/api/${pluralApiId}?${qs}`);
    return res.meta?.pagination?.total ?? 0;
  }

  /** Iterate every document of a collection (drafts included). */
  async *list(pluralApiId, params = {}) {
    let page = 1;
    let pageCount = 1;
    do {
      const qs = new URLSearchParams({
        'pagination[page]': String(page),
        'pagination[pageSize]': '100',
        status: 'draft',
        ...params,
      });
      const res = await this.request(`/api/${pluralApiId}?${qs}`);
      yield* res.data ?? [];
      pageCount = res.meta?.pagination?.pageCount ?? 1;
      page++;
    } while (page <= pageCount);
  }

  /** Upload one file (a Blob). Returns the media record, including its numeric `id`. */
  async upload(blob, fileName, fileInfo = {}) {
    const form = new FormData();
    form.append('files', blob, fileName);
    form.append('fileInfo', JSON.stringify(fileInfo));
    const res = await this.request('/api/upload', { method: 'POST', body: form });
    return Array.isArray(res) ? res[0] : res;
  }

  /** Fetch a media record by id, or null if it no longer exists. */
  async getFile(id) {
    try {
      return await this.request(`/api/upload/files/${id}`);
    } catch (err) {
      if (err.status === 404) return null;
      throw err;
    }
  }
}
