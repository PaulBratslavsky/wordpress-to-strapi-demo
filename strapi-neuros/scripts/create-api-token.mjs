/**
 * Headless helper: ensure an admin user exists, then mint a full-access API
 * token and print it. Handy for CI / automated runs of the migration.
 *
 * In the tutorial, readers create this token by hand in the admin panel
 * (Settings -> API Tokens -> Create new API Token -> Full access). This script
 * just automates that for reproducible end-to-end runs.
 *
 *   node scripts/create-api-token.mjs
 *
 * Env (all optional, sensible defaults shown):
 *   STRAPI_URL=http://localhost:1337
 *   ADMIN_EMAIL=admin@example.com
 *   ADMIN_PASSWORD=Password123!
 *   TOKEN_NAME=migration
 */

const STRAPI_URL = process.env.STRAPI_URL || 'http://localhost:1337';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Password123!';
const TOKEN_NAME = process.env.TOKEN_NAME || 'migration';

async function api(path, body, token) {
  const res = await fetch(`${STRAPI_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function getAdminJwt() {
  // First boot: register the first admin. Returns a JWT.
  const register = await api('/admin/register-admin', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    firstname: 'Admin',
  });
  if (register.ok) return register.json.data.token;

  // Already registered: log in instead.
  const login = await api('/admin/login', {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
  });
  if (login.ok) return login.json.data.token;

  throw new Error(
    `Could not authenticate admin (register: ${register.status}, login: ${login.status}). ` +
      `If the admin already exists with a different password, set ADMIN_EMAIL / ADMIN_PASSWORD.`
  );
}

async function main() {
  const jwt = await getAdminJwt();

  const created = await api(
    '/admin/api-tokens',
    {
      name: `${TOKEN_NAME}-${Date.now()}`,
      description: 'Full-access token for the WordPress -> Strapi migration',
      type: 'full-access',
      lifespan: null,
    },
    jwt
  );

  if (!created.ok) {
    throw new Error(`Failed to create API token (status ${created.status}): ${JSON.stringify(created.json)}`);
  }

  // accessKey is only returned once, at creation time.
  process.stdout.write(created.json.data.accessKey + '\n');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
