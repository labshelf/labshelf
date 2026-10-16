#!/bin/sh
# Builds the library list fixture from the repo sources and screenshots it into .verify/library/.
set -e
root=$(cd "$(dirname "$0")/../.." && pwd)
out=${1:-$root/.verify/library}
mkdir -p "$out"
# TRAP: the fixture imports @labshelf/core like a webview does, so it resolves through the vscode package's node_modules.
NODE_PATH="$root/packages/vscode/node_modules" "$root/node_modules/.bin/esbuild" "$root/scripts/verify-library/mountFixture.ts" \
  --bundle --outdir="$out/dist" --format=iife --target=es2022 \
  --tsconfig="$root/packages/vscode/tsconfig.webview.json" --loader:.svg=text --log-level=warning
printf '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="dist/mountFixture.css"></head><body><script src="dist/mountFixture.js"></script></body></html>\n' > "$out/index.html"
node "$root/scripts/verify-library/shoot.mjs" "$out"
