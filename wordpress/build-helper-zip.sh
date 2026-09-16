#!/usr/bin/env bash
# Builds strapi-migration-helper.zip, the plugin readers upload in
# WP Admin → Plugins → Add Plugin → Upload Plugin before a migration.
# Usage: ./wordpress/build-helper-zip.sh   → writes wordpress/dist/strapi-migration-helper.zip
set -euo pipefail

cd "$(dirname "$0")"
SRC=../skills/wordpress-to-strapi-migration/templates/wordpress/strapi-migration-helper.php
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/strapi-migration-helper" dist
cp "$SRC" "$WORK/strapi-migration-helper/"
rm -f dist/strapi-migration-helper.zip
(cd "$WORK" && zip -rqX "$OLDPWD/dist/strapi-migration-helper.zip" strapi-migration-helper)
echo "Built $(pwd)/dist/strapi-migration-helper.zip ($(du -h dist/strapi-migration-helper.zip | cut -f1))"
