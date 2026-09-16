#!/usr/bin/env bash
# Boots northfield-local-site.zip the way Local does on import, then checks that
# the site actually works. Run it after build-local-site.sh and before publishing.
#
# Local's import has no scripting API, so this reproduces it: the WordPress core
# Local installs, the zip's wp-content, the zip's database loaded into a scratch
# database, and Local's own PHP serving it. It needs one running Local site to
# borrow a MySQL server from (southfield.local by default).
#
# It also checks the helper's own install path: remove it, confirm the hidden
# Team type disappears from the API, install dist/strapi-migration-helper.zip the
# way the post tells readers to, and confirm Team comes back.
#
# Usage: ./wordpress/test-local-site.sh [zip] [domain-of-a-running-local-site]
set -euo pipefail

cd "$(dirname "$0")"
ZIP="$(cd "$(dirname "${1:-dist/northfield-local-site.zip}")" && pwd)/$(basename "${1:-dist/northfield-local-site.zip}")"
DOMAIN="${2:-southfield.local}"
PORT=8899
URL="http://127.0.0.1:$PORT"
DB="northfield_bootcheck"
LOCAL="$HOME/Library/Application Support/Local"

SITE_ID="$(python3 -c "
import json,sys
for k,v in json.load(open(sys.argv[1])).items():
    if v.get('domain')==sys.argv[2]: print(k); break
" "$LOCAL/sites.json" "$DOMAIN")"
SOCK="$LOCAL/run/$SITE_ID/mysql/mysqld.sock"
[ -S "$SOCK" ] || { echo "Start $DOMAIN in Local first; the test borrows its MySQL server." >&2; exit 1; }
BIN="$(ls -d "$LOCAL/lightning-services/"mysql-*/bin/darwin-arm64/bin | head -1)"
PHP="$(ls -d "$LOCAL/lightning-services/"php-8*/bin/darwin-arm64/bin/php | head -1)"
PHP_INI="$LOCAL/run/$SITE_ID/conf/php/php.ini"
CORE="$(ls "$LOCAL/cached-wordpress/"wordpress-*.tar.gz | sort -V | tail -1)"
mysql() { "$BIN/mysql" -uroot -proot --socket="$SOCK" "$@" 2>/dev/null; }

WORK="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  mysql -e "DROP DATABASE IF EXISTS $DB" || true
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "Zip:   $ZIP"
echo "Core:  $(basename "$CORE")"

# --- assemble the site the way Local does ------------------------------------------
tar -xzf "$CORE" -C "$WORK"
SITE="$WORK/wordpress"
rm -rf "$SITE/wp-content"
unzip -q "$ZIP" -d "$WORK/zip"
mv "$WORK/zip/wp-content" "$SITE/wp-content"

mysql -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB"
mysql "$DB" < "$WORK/zip/northfield.sql"

cat > "$SITE/wp-config.php" <<PHP
<?php
define( 'DB_NAME', '$DB' );
define( 'DB_USER', 'root' );
define( 'DB_PASSWORD', 'root' );
define( 'DB_HOST', 'localhost:$SOCK' );
define( 'DB_CHARSET', 'utf8mb4' );
define( 'DB_COLLATE', '' );
define( 'WP_ENVIRONMENT_TYPE', 'local' );
define( 'WP_DEBUG', true );
define( 'WP_DEBUG_DISPLAY', true );
\$table_prefix = 'wp_';
if ( ! defined( 'ABSPATH' ) ) define( 'ABSPATH', __DIR__ . '/' );
require_once ABSPATH . 'wp-settings.php';
PHP

# Local's import rewrites the old address to the new one across the database,
# serialized-data aware but blind to JSON-escaped copies. WP-CLI's search-replace
# behaves the same way, so the booted site sees what an imported one sees.
WPCLI="/Applications/Local.app/Contents/Resources/extraResources/bin/wp-cli/wp-cli.phar"
OLD_URL="$(mysql -N "$DB" -e "SELECT option_value FROM wp_options WHERE option_name='siteurl'")"
"$PHP" -c "$PHP_INI" "$WPCLI" --path="$SITE" search-replace "$OLD_URL" "$URL" --all-tables --quiet
echo "Moved: $OLD_URL -> $URL"

cat > "$WORK/router.php" <<'PHP'
<?php
$path = parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH );
$file = $_SERVER['DOCUMENT_ROOT'] . $path;
if ( $path !== '/' && file_exists( $file ) && ! is_dir( $file ) ) return false;
if ( is_dir( $file ) && file_exists( rtrim( $file, '/' ) . '/index.php' ) ) {
  require rtrim( $file, '/' ) . '/index.php'; return;
}
require $_SERVER['DOCUMENT_ROOT'] . '/index.php';
PHP

"$PHP" -c "$PHP_INI" -S "127.0.0.1:$PORT" -t "$SITE" "$WORK/router.php" > "$WORK/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 20); do curl -s -o /dev/null "$URL/wp-login.php" && break; sleep 0.5; done

# --- checks -------------------------------------------------------------------------
FAIL=0
JAR="$WORK/cookies"
check() { # name, url, must-contain
  local body code
  body="$(curl -sL -b "$JAR" -c "$JAR" -w '\n%{http_code}' "$2")"
  code="${body##*$'\n'}"; body="${body%$'\n'*}"
  if [ "$code" != 200 ] || grep -qiE 'Fatal error|critical error|Parse error' <<<"$body" || ! grep -qF -- "$3" <<<"$body"; then
    echo "FAIL  $1  ($code)"; grep -oiE '(Fatal|Parse) error[^<]{0,200}' <<<"$body" | head -2 | sed 's/^/      /' || true
    FAIL=1
  else
    echo "ok    $1"
  fi
}

check "home page (Elementor)"   "$URL/"                              "Northfield Studio"
check "blog post"               "$URL/?p=$(mysql -N "$DB" -e "SELECT ID FROM wp_posts WHERE post_type='post' AND post_status='publish' LIMIT 1")" "Northfield Studio"
check "project with ACF fields" "$URL/?post_type=portfolio_item&name=riverbend-coffee-roasters" "Riverbend"
check "REST API"                "$URL/?rest_route=/wp/v2/types"      '"portfolio_item"'

code="$(curl -s -o /dev/null -w '%{http_code}' -b "$JAR" -c "$JAR" --data-urlencode log=admin --data-urlencode pwd=password -d "testcookie=1&redirect_to=$URL/wp-admin/" -b 'wordpress_test_cookie=WP%20Cookie%20check' "$URL/wp-login.php")"
if [ "$code" = 302 ]; then echo "ok    log in as admin / password"; else echo "FAIL  log in as admin / password ($code)"; FAIL=1; fi

check "dashboard"               "$URL/wp-admin/"                     "Dashboard"
check "plugins, all active"     "$URL/wp-admin/plugins.php"          "Elementor"
check "Elementor editor"        "$URL/wp-admin/post.php?post=$(mysql -N "$DB" -e "SELECT post_id FROM wp_postmeta WHERE meta_key='_elementor_edit_mode' LIMIT 1")&action=elementor" "elementor"
check "ACF field groups"        "$URL/wp-admin/edit.php?post_type=acf-field-group" "Project details"
check "helper listed in Plugins" "$URL/wp-admin/plugins.php"         "Strapi Migration Helper"
check "helper exposes Team"     "$URL/?rest_route=/wp/v2/team"      '"type":"team"'

# the post has readers create an application password and call the helper with it
APP_PASS="$("$PHP" -c "$PHP_INI" "$WPCLI" --path="$SITE" user application-password create admin boot-check --porcelain 2>/dev/null || true)"
info="$(curl -s -u "admin:$APP_PASS" "$URL/?rest_route=/strapi-migration/v1/info")"
if [ -n "$APP_PASS" ] && grep -qF '"forced_post_types":["team"]' <<<"$info"; then
  echo "ok    application password reads the helper's info"
else
  echo "FAIL  application password reads the helper's info: ${info:0:120}"; FAIL=1
fi

inactive="$(curl -s -b "$JAR" "$URL/wp-admin/plugins.php" | grep -oE 'class="inactive[^"]*" data-slug="[^"]+"' | sed 's/.*data-slug="//;s/"//' | tr '\n' ' ' || true)"
if [ -n "$inactive" ]; then echo "FAIL  inactive plugins: $inactive"; FAIL=1; fi
if grep -qiE 'Fatal error|Parse error' "$WORK/server.log"; then
  echo "FAIL  PHP errors in the server log:"; grep -iE 'Fatal error|Parse error' "$WORK/server.log" | head -3 || true; FAIL=1
fi

# every image on the pages readers look at must load from the new address
images() { # page url -> one absolute image url per line
  curl -sL "$1" | grep -oE '(src|srcset|data-src)="[^"]+"|url\([^)]+\)' \
    | sed -E 's/^(src|srcset|data-src)="//; s/"$//; s/^url\(["'"'"']?//; s/["'"'"']?\)$//' \
    | tr ',' '\n' | awk '{print $1}' | grep -iE '\.(jpe?g|png|webp|gif|svg)(\?|$)' \
    | sed -E "s#^/([^/])#$URL/\\1#" | sort -u
}
ABOUT="$(mysql -N "$DB" -e "SELECT ID FROM wp_posts WHERE post_type='page' AND post_name='about'")"
bad=""; count=0
for page in "$URL/" "$URL/?page_id=$ABOUT" "$URL/?post_type=portfolio_item&name=riverbend-coffee-roasters" "$URL/?p=$(mysql -N "$DB" -e "SELECT ID FROM wp_posts WHERE post_type='post' AND post_status='publish' LIMIT 1")"; do
  while read -r img; do
    [ -z "$img" ] && continue
    count=$((count + 1))
    case "$img" in
      *old.northfield-studio.example*) count=$((count - 1)); continue ;;  # the demo's deliberate dead link
    esac
    case "$img" in "$URL"/*) ;; *) bad+="    wrong host: $img"$'\n'; continue ;; esac
    code="$(curl -s -o /dev/null -w '%{http_code}' "$img")"
    [ "$code" = 200 ] || bad+="    $code: $img"$'\n'
  done < <(images "$page")
done
if [ "$count" -lt 10 ]; then
  echo "FAIL  images: only $count found on the checked pages"; FAIL=1
elif [ -n "$bad" ]; then
  echo "FAIL  images: $(printf '%s' "$bad" | grep -c .) of $count do not load"; printf '%s' "$bad" | head -8; FAIL=1
else
  echo "ok    all $count images load from $URL"
fi

# the helper's install path, as the post describes it for readers' own sites
HELPER_ZIP="$(pwd)/dist/strapi-migration-helper.zip"
wp() { "$PHP" -c "$PHP_INI" "$WPCLI" --path="$SITE" "$@"; }
team_code() { curl -s -o /dev/null -w '%{http_code}' "$URL/?rest_route=/wp/v2/team"; }
if [ ! -f "$HELPER_ZIP" ]; then
  echo "FAIL  helper zip missing: run ./wordpress/build-helper-zip.sh"; FAIL=1
else
  wp plugin deactivate strapi-migration-helper --quiet && wp plugin delete strapi-migration-helper --quiet
  without="$(team_code)"
  wp plugin install "$HELPER_ZIP" --activate --quiet
  with="$(team_code)"
  if [ "$without" = 404 ] && [ "$with" = 200 ]; then
    echo "ok    helper zip installs and brings back Team (404 without it, 200 with it)"
  else
    echo "FAIL  helper zip install: Team was $without without the helper, $with with it"; FAIL=1
  fi
fi

[ "$FAIL" = 0 ] && echo "PASS  the zip boots and works" || { echo "The zip is broken; do not publish it." >&2; exit 1; }
