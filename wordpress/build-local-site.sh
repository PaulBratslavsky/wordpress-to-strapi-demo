#!/usr/bin/env bash
# Builds northfield-local-site.zip: the finished demo site, packaged for Local's
# "drag a ZIP here to import a site" box. Readers import it and log in; there is
# nothing to install.
#
# It reads a running Local site on this machine (domain southfield.local by
# default) and never writes to it: the database is copied into a scratch
# database, cleaned there, and dumped.
#
# Usage: ./wordpress/build-local-site.sh [domain]
#   → writes wordpress/dist/northfield-local-site.zip
#
# What the zip contains:
#   northfield.sql   the cleaned database
#   wp-content/      theme, plugins (Elementor, ACF, CPT UI, WPZOOM Portfolio,
#                    northfield-demo, and the Strapi Migration Helper as an
#                    ordinary active plugin, copied from the skill so it is
#                    always the current version) and the 30 demo images
#
# What it leaves out on purpose:
#   - the site owner's email, password, sessions and application passwords
#   - caches and transients
set -euo pipefail

DOMAIN="${1:-southfield.local}"
DEMO_USER="admin"
DEMO_PASS="password"
DEMO_EMAIL="admin@northfield-studio.example"
SCRATCH_DB="northfield_export"
SHIP_DOMAIN="northfield.local"

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
PHP="$(ls -d "$LOCAL/lightning-services/"php-8*/bin/darwin-arm64/bin/php | head -1)"
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

-- Elementor stores layouts as JSON, where URLs are written http:\\/\\/host\\/...
-- Local's import rewrites the site address but not that escaped form, so an
-- imported site under any other name loads its Elementor images from here.
-- (Renaming a site in Local has the same blind spot, so the source may hold
-- either name.) Make those links relative, and drop the caches Elementor
-- rebuilds itself.
UPDATE wp_postmeta
   SET meta_value = REPLACE(REPLACE(meta_value,
         'http:\\\\/\\\\/$DOMAIN\\\\/', '\\\\/'),
         'http:\\\\/\\\\/$SHIP_DOMAIN\\\\/', '\\\\/')
 WHERE meta_key = '_elementor_data';
DELETE FROM wp_postmeta WHERE meta_key IN ('_elementor_element_cache', '_elementor_css');
DELETE FROM wp_options  WHERE option_name LIKE '\\_elementor\\_global\\_css' OR option_name LIKE 'elementor\\_%\\_cache%';

-- editor leftovers
DELETE FROM wp_posts WHERE post_status = 'auto-draft';
DELETE FROM wp_posts WHERE post_type IN ('revision', 'customize_changeset', 'oembed_cache');
DELETE pm FROM wp_postmeta pm LEFT JOIN wp_posts p ON p.ID = pm.post_id WHERE p.ID IS NULL;
SQL

# ship the helper as an ordinary active plugin, the way readers install it on
# their own site. active_plugins is serialized PHP, so PHP edits it.
SOCK="$SOCK" DB="$SCRATCH_DB" "$PHP" -r '
  $db = new mysqli("localhost", "root", "root", getenv("DB"), 0, getenv("SOCK"));
  $row = $db->query("SELECT option_value FROM wp_options WHERE option_name = \"active_plugins\"")->fetch_row();
  $plugins = unserialize($row[0]);
  $plugins[] = "strapi-migration-helper/strapi-migration-helper.php";
  $plugins = array_values(array_unique($plugins));
  sort($plugins);
  $stmt = $db->prepare("UPDATE wp_options SET option_value = ? WHERE option_name = \"active_plugins\"");
  $value = serialize($plugins);
  $stmt->bind_param("s", $value);
  $stmt->execute();
'

mysqldump "$SCRATCH_DB" > "$WORK/northfield.sql"

# the zip always ships as northfield.local, whatever the source site is called now.
# A plain text swap is only safe when both names are the same length, because
# WordPress stores serialized PHP with byte counts.
if [ "$DOMAIN" != "northfield.local" ]; then
  if [ "${#DOMAIN}" -ne "${#SHIP_DOMAIN}" ]; then
    echo "Refusing to build: $DOMAIN and $SHIP_DOMAIN differ in length, so the URLs cannot be swapped safely." >&2
    exit 1
  fi
  LC_ALL=C sed -i '' "s/${DOMAIN//./\\.}/$SHIP_DOMAIN/g" "$WORK/northfield.sql"
fi

# no absolute, JSON-escaped site URLs may survive: Local's import would miss them
if grep -qF -- "http:\\\\/\\\\/$SHIP_DOMAIN" "$WORK/northfield.sql"; then
  echo "Refusing to build: JSON-escaped site URLs remain, and an import under another name would break them." >&2
  exit 1
fi

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
  /wp-content/upgrade/
  /wp-content/fonts/
  /wp-content/cache/
  /wp-content/debug.log
  /wp-content/uploads/elementor/css/
  /wp-content/mu-plugins/strapi-migration-helper.php
  /wp-content/plugins/strapi-migration-helper/
)
RSYNC_ARGS=(-a --exclude '.DS_Store')
for e in "${EXCLUDES[@]}"; do RSYNC_ARGS+=(--exclude "$e"); done
rsync "${RSYNC_ARGS[@]}" "$SITE_PATH/app/public/wp-content" "$WORK/"

# the helper that makes hidden types and fields readable, from the skill itself.
# A copy in mu-plugins as well would load it twice and fatal on the constant.
mkdir -p "$WORK/wp-content/plugins/strapi-migration-helper"
cp ../skills/wordpress-to-strapi-migration/templates/wordpress/strapi-migration-helper.php \
   "$WORK/wp-content/plugins/strapi-migration-helper/"
if [ -e "$WORK/wp-content/mu-plugins/strapi-migration-helper.php" ]; then
  echo "Refusing to build: the helper is in mu-plugins as well as plugins." >&2
  exit 1
fi

# the copy must match the site file for file, apart from the exclusions above
list() { (cd "$1" && find wp-content -type f ! -name .DS_Store | sort); }
missing="$(comm -23 <(list "$SITE_PATH/app/public" | grep -vE '^wp-content/(upgrade/|fonts/|cache/|debug\.log$|uploads/elementor/css/|mu-plugins/strapi-migration-helper\.php$|plugins/strapi-migration-helper/)') <(list "$WORK"))"
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
