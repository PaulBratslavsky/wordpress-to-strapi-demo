import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Persistent migration state (`.migration-state.json`).
 *
 * Remembers which WordPress media files were already uploaded to Strapi (and
 * the Strapi file record they became) so re-runs don't upload duplicates. Entries
 * don't need this: they're matched in Strapi by their `wpId` field.
 */
export class MigrationState {
  constructor(file = '.migration-state.json') {
    this.file = file;
    this.data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    this.data.media ??= {};
  }

  get media() {
    return this.data.media;
  }

  save() {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2) + '\n');
  }
}
