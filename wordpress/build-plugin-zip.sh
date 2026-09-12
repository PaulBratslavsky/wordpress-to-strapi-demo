#!/usr/bin/env bash
# Builds northfield-demo.zip, the file readers upload in WP Admin → Plugins → Add New → Upload Plugin.
# Usage: ./wordpress/build-plugin-zip.sh   → writes wordpress/dist/northfield-demo.zip
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p dist
rm -f dist/northfield-demo.zip
zip -rq dist/northfield-demo.zip northfield-demo -x '*.DS_Store'
echo "Built $(pwd)/dist/northfield-demo.zip ($(du -h dist/northfield-demo.zip | cut -f1))"
