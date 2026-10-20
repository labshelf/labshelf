#!/bin/bash
# Builds biber for WebAssembly from pinned upstream sources inside Docker and writes the result to tools/biber-wasm/dist/.
# Intermediate builds live in the Docker volume labshelf-biber-wasm-cache; `docker volume rm` it to start from scratch.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
docker build -t labshelf-biber-wasm "$HERE"
docker volume create labshelf-biber-wasm-cache >/dev/null
mkdir -p "$HERE/dist"
docker run --rm -v labshelf-biber-wasm-cache:/cache -v "$HERE":/work -v "$HERE/dist":/dist \
  labshelf-biber-wasm bash scripts/build-all.sh
