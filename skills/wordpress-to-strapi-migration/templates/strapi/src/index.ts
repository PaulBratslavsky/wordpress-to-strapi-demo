/**
 * Grants the Public role read access (find / findOne) to every API content
 * type, so migrated content can be checked at /api/<plural> without a token.
 * Runs on every boot and only adds missing permissions.
 *
 * If your project's src/index.ts already has a bootstrap, merge
 * grantPublicRead() into it instead of replacing the file.
 */
async function grantPublicRead(strapi) {
  const publicRole = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'public' } });
  if (!publicRole) return;

  for (const [uid, contentType] of Object.entries<any>(strapi.contentTypes)) {
    if (!uid.startsWith('api::')) continue;
    const actions = contentType.kind === 'singleType' ? ['find'] : ['find', 'findOne'];
    for (const action of actions) {
      const permission = `${uid}.${action}`;
      const exists = await strapi.db
        .query('plugin::users-permissions.permission')
        .findOne({ where: { action: permission, role: publicRole.id } });
      if (!exists) {
        await strapi.db.query('plugin::users-permissions.permission').create({ data: { action: permission, role: publicRole.id } });
      }
    }
  }
}

export default {
  register() {},
  async bootstrap({ strapi }) {
    await grantPublicRead(strapi);
  },
};
