# Toolchain image for the biber WebAssembly build: pinned emsdk plus the host tools the perl cross-build needs.
# build.sh builds this image and runs scripts/build-all.sh inside it.
FROM emscripten/emsdk:6.0.13

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential file xz-utils patch ca-certificates curl \
    libxml2-dev libxslt1-dev libssl-dev zlib1g-dev pkg-config \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /work
