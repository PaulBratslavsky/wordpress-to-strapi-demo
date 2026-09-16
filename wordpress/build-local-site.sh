#!/usr/bin/env bash
# Builds northfield-local-site.zip: the finished demo site, packaged for Local's
# "drag a ZIP here to import a site" box. Readers import it and log in; there is
# nothing to install.
#
# It reads a running Local site on this machine (domain northfield.local by
# default) and never writes to it: the database is copied into a scratch
# database, cleaned there, and dumped.
#
# Usage: ./wordpress/build-local-site.sh [domain]
#   → writes wordpress/dist/northfield-local-site.zip
#
# What the zip contains:
#   northfield.sql   the cleaned database
#   wp-content/      theme, plugins (Elementor, ACF, CPT UI, WPZOOM Portfolio,
#                    northfield-demo) and the 30 demo images
#
# What it leaves out on purpose:
#   - the migration helper mu-plugin (readers install it as a tutorial step)
#   - the site owner's email, password, sessions and application passwords
#   - caches and transients
set -euo pipefail

DOMAIN="${1:-northfield.local}"
DEMO_USER="admin"
DEMO_PASS="password"
DEMO_EMAIL="admin@northfield-studio.example"
SCRATCH_DB="northfield_export"

cd "$(dirname "$0")"
OUT="$(pwd)/dist/northfield-local-site.zip"
LOCAL="$HOME/Library/Application Support/Local"

# --- find the site ---------------------------------------------------------------
read -r SITE_ID SITE_PATH < <(python3 - "$LOCAL/sites.json" "$DOMAIN" <<'EOF'
import json, sys
sites = json.load(open(sys.argv[1]))
for sid, s in sites.items():
    if s.get("domain") == sys.argv[2]:
        print(sid, s["path"].replace("~", __import__("os").path.expanduser("~"), 1))
        break
else:
    sys.exit(f"No Local site with domain {sys.argv[2]}")
EOF
)
SOCK="$LOCAL/run/$SITE_ID/mysql/mysqld.sock"
[ -S "$SOCK" ] || { echo "Site $DOMAIN is not running. Start it in Local first." >&2; exit 1; }
BIN="$(ls -d "$LOCAL/lightning-services/"mysql-*/bin/darwin-arm64/bin | head -1)"
mysql()     { "$BIN/mysql"     -uroot -proot --socket="$SOCK" "$@" 2>/dev/null; }
mysqldump() { "$BIN/mysqldump" -uroot -proot --socket="$SOCK" --skip-dump-date "$@" 2>/dev/null; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"; mysql -e "DROP DATABASE IF EXISTS $SCRATCH_DB" || true' EXIT
echo "Site:  $DOMAIN ($SITE_PATH)"

# --- database: copy, clean, dump -------------------------------------------------
mysql -e "DROP DATABASE IF EXISTS $SCRATCH_DB; CREATE DATABASE $SCRATCH_DB"
mysqldump local | mysql "$SCRATCH_DB"

mysql "$SCRATCH_DB" <<SQL
-- the demo login, documented in the post
UPDATE wp_users SET user_login='$DEMO_USER', user_nicename='$DEMO_USER',
       user_email='$DEMO_EMAIL', user_pass=MD5('$DEMO_PASS')
 WHERE ID = 1;
UPDATE wp_options SET option_value='$DEMO_EMAIL' WHERE option_name = 'admin_email';
DELETE FROM wp_options WHERE option_name IN ('new_admin_email', 'adminhash');

-- nobody else's credentials or sessions
DELETE FROM wp_usermeta WHERE meta_key IN
  ('_application_passwords', '_application_passwords_last_used', 'session_tokens');
DELETE FROM wp_options WHERE option_name = 'using_application_passwords';

-- caches that are rebuilt on demand (the font cache stores absolute paths)
DELETE FROM wp_options WHERE option_name LIKE '%\_transient\_%';
DELETE FROM wp_options WHERE option_name LIKE '%font\_files%';

-- editor leftovers
DELETE FROM wp_posts WHERE post_status = 'auto-draft';
DELETE FROM wp_posts WHERE post_type IN ('revision', 'customize_changeset', 'oembed_cache');
DELETE pm FROM wp_postmeta pm LEFT JOIN wp_posts p ON p.ID = pm.post_id WHERE p.ID IS NULL;
SQL

mysqldump "$SCRATCH_DB" > "$WORK/northfield.sql"

# refuse to ship anything that looks like it came from this machine or its owner
OWNER_EMAIL="$(mysql -N local -e 'SELECT user_email FROM wp_users WHERE ID = 1')"
for needle in "$HOME" "$OWNER_EMAIL" "'_application_passwords'" "'session_tokens'"; do
  if grep -qF -- "$needle" "$WORK/northfield.sql"; then
    echo "Refusing to build: the cleaned database still contains '$needle'." >&2
    exit 1
  fi
done

# --- files -------------------------------------------------------------------------
# Every pattern is anchored to wp-content/. An unanchored 'upgrade/' also matches
# plugins/elementor/core/upgrade/, and the imported site dies with a fatal error.
EXCLUDES=(
  /wp-content/mu-plugins/strapi-migration-helper.php
  /wp-content/upgrade/
  /wp-content/fonts/
  /wp-content/cache/
  /wp-content/debug.log
)
RSYNC_ARGS=(-a --exclude '.DS_Store')
for e in "${EXCLUDES[@]}"; do RSYNC_ARGS+=(--exclude "$e"); done
rsync "${RSYNC_ARGS[@]}" "$SITE_PATH/app/public/wp-content" "$WORK/"

# the copy must match the site file for file, apart from the exclusions above
list() { (cd "$1" && find wp-content -type f ! -name .DS_Store | sort); }
missing="$(comm -23 <(list "$SITE_PATH/app/public" | grep -vE '^wp-content/(mu-plugins/strapi-migration-helper\.php|upgrade/|fonts/|cache/|debug\.log$)') <(list "$WORK"))"
if [ -n "$missing" ]; then
  echo "Refusing to build: these files did not make it into the copy:" >&2
  echo "$missing" | head -20 >&2
  exit 1
fi

if grep -rqF --include='*.php' --include='*.json' --include='*.log' -- "$HOME" "$WORK/wp-content"; then
  echo "Refusing to build: wp-content contains a path from this machine." >&2
  exit 1
fi

# --- zip ---------------------------------------------------------------------------
mkdir -p dist
rm -f "$OUT"
(cd "$WORK" && zip -rqX "$OUT" northfield.sql wp-content)
echo "Built $OUT ($(du -h "$OUT" | cut -f1))"
echo "Import it in Local, then log in with $DEMO_USER / $DEMO_PASS."
