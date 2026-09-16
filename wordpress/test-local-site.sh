#!/usr/bin/env bash
# Boots northfield-local-site.zip the way Local does on import, then checks that
# the site actually works. Run it after build-local-site.sh and before publishing.
#
# Local's import has no scripting API, so this reproduces it: the WordPress core
# Local installs, the zip's wp-content, the zip's database loaded into a scratch
# database, and Local's own PHP serving it. It needs one running Local site to
# borrow a MySQL server from (northfield.local by default).
#
# Usage: ./wordpress/test-local-site.sh [zip] [domain-of-a-running-local-site]
set -euo pipefail

cd "$(dirname "$0")"
ZIP="$(cd "$(dirname "${1:-dist/northfield-local-site.zip}")" && pwd)/$(basename "${1:-dist/northfield-local-site.zip}")"
DOMAIN="${2:-northfield.local}"
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
mysql "$DB" -e "UPDATE wp_options SET option_value='$URL' WHERE option_name IN ('siteurl','home')"

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

inactive="$(curl -s -b "$JAR" "$URL/wp-admin/plugins.php" | grep -oE 'class="inactive[^"]*" data-slug="[^"]+"' | sed 's/.*data-slug="//;s/"//' | tr '\n' ' ' || true)"
if [ -n "$inactive" ]; then echo "FAIL  inactive plugins: $inactive"; FAIL=1; fi
if grep -qiE 'Fatal error|Parse error' "$WORK/server.log"; then
  echo "FAIL  PHP errors in the server log:"; grep -iE 'Fatal error|Parse error' "$WORK/server.log" | head -3 || true; FAIL=1
fi

[ "$FAIL" = 0 ] && echo "PASS  the zip boots and works" || { echo "The zip is broken; do not publish it." >&2; exit 1; }
