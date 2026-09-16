import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { htmlToText } from './util.js';

/**
 * WordPress media → Strapi media library.
 *
 * WordPress stores one attachment but serves it at many URLs: the original,
 * a "-scaled" copy for big images (WP 5.3+), and every generated size
 * ("photo-1024x683.jpg", "photo-300x200.jpg", ...). Post content references
 * whichever size the editor picked. The original script handled this by
 * stripping "-WxH" from URLs; here every known URL of every attachment is
 * indexed up front, so any size resolves to its attachment and the original
 * file is uploaded exactly once. The "-WxH" strip is kept as a fallback for
 * sizes a theme generated later.
 *
 * Uploads are remembered in `.migration-state.json`, so re-runs reuse them.
 */

const SIZE_SUFFIX = /-\d+x\d+(?=\.[a-z0-9]+$)/i;
const SCALED_SUFFIX = /-(scaled|rotated)(?=\.[a-z0-9]+$)/i;

/** Host- and scheme-independent key for an uploads URL. */
export function urlKey(url, base) {
  try {
    return decodeURIComponent(new URL(url, base).pathname).toLowerCase();
  } catch {
    return null;
  }
}

/** "svg", ".SVG", "svg, pdf" and ["svg"] all mean the same thing here. */
const extList = (value) =>
  (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((s) => String(s).trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);

const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');

const fileNameOf = (url) => {
  try {
    return decodeURIComponent(path.basename(new URL(url).pathname)) || 'file';
  } catch {
    return 'file';
  }
};

export class MediaLibrary {
  constructor({ items = [], strapi, state, siteUrl, strapiUrl, exportDir = '.', dryRun = false, uploadExternal = true, skipTypes = [], log = () => {} }) {
    Object.assign(this, { strapi, state, siteUrl, strapiUrl, exportDir, dryRun, uploadExternal, log });
    // Types to give up on before spending a download on them (--skip-types svg).
    this.skipTypes = new Set(extList(skipTypes));
    this.byId = new Map(items.map((m) => [m.id, m]));
    this.byPath = new Map();
    this.verified = new Set();
    // Files that couldn't be fetched or that Strapi refused, for the run report.
    this.failures = [];
    this.failed = new Set();
    // Remedies already given, so a refused type is explained once rather than per file.
    this.advised = new Set();
    // Uploads in progress, so entries running side by side share one upload of a shared file.
    this.inFlight = new Map();
    for (const m of items) {
      const add = (u) => {
        const k = u && urlKey(u, siteUrl);
        if (k && !this.byPath.has(k)) this.byPath.set(k, m);
      };
      add(m.source_url);
      for (const size of Object.values(m.media_details?.sizes ?? {})) add(size.source_url);
      if (m.media_details?.original_image) add(m.source_url.replace(/[^/]+$/, m.media_details.original_image));
    }
  }

  /** The attachment an uploads URL belongs to, whatever size it points at. */
  find(url) {
    const k = urlKey(url, this.siteUrl);
    if (!k) return null;
    const unsized = k.replace(SIZE_SUFFIX, '');
    return (
      this.byPath.get(k) ??
      this.byPath.get(unsized) ??
      this.byPath.get(unsized.replace(SCALED_SUFFIX, '')) ??
      this.byPath.get(unsized.replace(/(\.[a-z0-9]+)$/, '-scaled$1')) ??
      null
    );
  }

  /** Record a file we couldn't migrate, once per file, so the report can list them. */
  recordFailure(key, url, reason) {
    if (this.failed.has(key)) return null;
    this.failed.add(key);
    this.failures.push({ url, reason: String(reason).slice(0, 200) });
    return null;
  }

  /**
   * Strapi refuses some types outright — SVG unless you allow it in the upload
   * settings. Its message is the same for every file, and repeating it says
   * nothing new the second time, so the remedy is given once per type.
   */
  adviseOnRefusal(message, ext) {
    const mime = String(message).match(/File type '([^']+)' is not allowed/i)?.[1];
    if (!mime || this.advised.has(mime)) return;
    this.advised.add(mime);
    const skip = ext ? `, or re-run with --skip-types ${ext}` : '';
    this.log(
      `  ! ${mime} is refused by Strapi's upload settings. Allow the type there ` +
        `(Settings → Media Library → Upload), convert the files${skip}.`
    );
  }

  /** Absolute URL for a Strapi file (the local upload provider returns "/uploads/..."). */
  publicUrl(file) {
    return file.url?.startsWith('/') ? `${this.strapiUrl}${file.url}` : file.url;
  }

  /** Resolve any WordPress media reference — id, {id|ID|url} object, or URL — to a Strapi file. */
  async ensure(ref) {
    if (ref == null || ref === 0 || ref === '' || ref === false) return null;
    if (typeof ref === 'number' || /^\d+$/.test(String(ref))) return this.ensureById(Number(ref));
    if (typeof ref === 'object') {
      const id = ref.id ?? ref.ID;
      if (id) return this.ensureById(Number(id));
      return ref.url ? this.ensureByUrl(ref.url) : null;
    }
    return this.ensureByUrl(String(ref));
  }

  async ensureById(id) {
    const item = this.byId.get(id);
    if (!item) {
      this.log(`  ! media ${id} is not in the export (deleted, or not readable without auth)`);
      return null;
    }
    return this.#put(`wp:${id}`, {
      url: item.source_url,
      localFile: item.localFile ? path.join(this.exportDir, item.localFile) : null,
      fileName: fileNameOf(item.source_url),
      mime: item.mime_type,
      width: item.media_details?.width,
      height: item.media_details?.height,
      fileInfo: {
        alternativeText: item.alt_text || htmlToText(item.title?.rendered) || null,
        caption: htmlToText(item.caption?.rendered) || null,
      },
    });
  }

  async ensureByUrl(url) {
    let abs;
    try {
      abs = new URL(url, this.siteUrl).href;
    } catch {
      return null;
    }
    const item = this.find(abs);
    if (item) return this.ensureById(item.id);
    const external = new URL(abs).host !== new URL(this.siteUrl).host;
    if (external && !this.uploadExternal) return null;
    return this.#put(`url:${abs}`, { url: abs, fileName: fileNameOf(abs), fileInfo: {} });
  }

  async #put(key, src) {
    // Checked before the dry-run stand-in, so a dry run reports what a real one would skip.
    const ext = extOf(src.fileName || '');
    if (ext && this.skipTypes.has(ext)) {
      return this.recordFailure(key, src.url, `skipped (--skip-types ${ext})`);
    }

    if (this.dryRun) {
      // No uploads in a dry run: hand back a stand-in so conversion can proceed.
      return {
        id: 0,
        dryRun: true,
        name: src.fileName,
        url: src.url,
        width: src.width ?? 1,
        height: src.height ?? 1,
        mime: src.mime,
        alternativeText: src.fileInfo.alternativeText ?? null,
        caption: src.fileInfo.caption ?? null,
      };
    }

    // Two entries migrating at once often want the same attachment — a shared logo,
    // the same hero. Without this they would both miss the cache, both download and
    // both upload it, and the library would hold the file twice.
    const inFlight = this.inFlight.get(key);
    if (inFlight) return inFlight;

    const work = this.#fetchAndUpload(key, src, ext);
    this.inFlight.set(key, work);
    try {
      return await work;
    } finally {
      this.inFlight.delete(key);
    }
  }

  async #fetchAndUpload(key, src, ext) {
    const cached = this.state.media[key];
    if (cached) {
      if (this.verified.has(cached.id)) return cached;
      const still = await this.strapi.getFile(cached.id);
      if (still) {
        this.verified.add(still.id);
        return (this.state.media[key] = still);
      }
      delete this.state.media[key]; // Strapi was reset since the last run — upload again
    }

    let bytes;
    let type = src.mime;
    if (src.localFile && existsSync(src.localFile)) {
      bytes = await readFile(src.localFile);
    } else {
      const res = await fetch(src.url);
      if (!res.ok) {
        this.log(`  ! could not download ${src.url} (${res.status})`);
        return this.recordFailure(key, src.url, `download failed (${res.status})`);
      }
      bytes = Buffer.from(await res.arrayBuffer());
      type ??= res.headers.get('content-type')?.split(';')[0];
    }

    const blob = new Blob([bytes], { type: type || 'application/octet-stream' });
    let file;
    try {
      file = await this.strapi.upload(blob, src.fileName, { name: src.fileName, ...src.fileInfo });
    } catch (err) {
      // One rejected file shouldn't take the whole entry down with it.
      this.log(`  ! Strapi refused ${src.fileName}: ${err.message}`);
      this.adviseOnRefusal(err.message, ext);
      return this.recordFailure(key, src.url, err.message);
    }
    this.state.media[key] = file;
    this.state.save();
    this.verified.add(file.id);
    this.log(`  + uploaded ${src.fileName} → file ${file.id}`);
    return file;
  }
}
