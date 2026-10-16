sha: 25a7770
files: packages/core/src/writing/latex/**, packages/core/src/writing/typst/node/runTypstBuild.ts, packages/core/src/import/node/canvas/**, packages/core/src/sync/auth/**, packages/core/src/sync/node/**, packages/vscode/src/sync/auth/**, packages/terminal/src/sync/**, packages/terminal/src/preview/thumbnailWorker.ts
source: Explore scout, 2026-10-16

# Build
- LaTeX: core/src/writing/latex/build/node/runLatexBuild.ts runLatexBuild({toolchain, projectFolder, main, outDir, signal, logger}) -> succeeded{pdf} | failed{problems} | cancelled. Commands in latexBuildCommand.ts:12-30 (tectonic -X compile; latexmk -xelatex|-pdf|-lualatex). No shell-escape flag anywhere — keep it that way (D9).
- Engines: LATEX_ENGINES in core/src/writing/project/projectFile.ts:15 (tectonic|xelatex|pdflatex|lualatex), stored as `engine` in the project file; not detected from source. explainTexMessage.ts LUA_ONLY regex only explains log errors. A source scanner would be new code.
- Typst: core/src/writing/typst/node/runTypstBuild.ts (in-process WASM, needs TypstSession + package store, optional injected fetch). Separate entry @labshelf/core/typst.

# Thumbnail
- core/src/import/node/canvas/{nativeCanvas,nativeRenderOptions,renderPagePng}.ts give PNG bytes (pdfjs-dist ~6.3 + @napi-rs/canvas). Recipe: terminal/src/preview/thumbnailWorker.ts:1-35 (page 1 at widthPx/base.width); same glue in core/src/writing/compare/node/renderInkMaps.ts — duplicated getDocument+viewport glue, extract once when templates need it. TRAP: worker must not import @labshelf/core root. vscode bundle must mark pdfjs-dist and @napi-rs/canvas external like terminal build.mjs.

# HTTP
- No shared network port; several fetch-shaped types (import/pdfFinding/types.ts:7 FetchFn, toolchain/node/downloadVerified.ts FetchLike with SHA-256 check, import/networkImport/env.ts). No ETag/If-None-Match code anywhere: catalog cache is new.

# Auth
- Google only: PKCE loopback (core/src/sync/node/pkceLoopbackAuth.ts; vscode, terminal) and implicit launchWebAuthFlow (browser/src/sync/auth/browserDriveAuth.ts). No device flow, no vscode.authentication.getSession, no GitHub auth anywhere.
- TokenStore port core/src/sync/auth/tokenStore.ts is Google-shaped TokenData; INVARIANT: its JSON shape is a cross-version contract. A GitHub token needs its own record/store, not a reuse. Stores: vscode SecretStorageTokenStore, terminal File/Keychain/SecretService, browser its own.

# Archives
- No zip/tar npm dependency. Only core/src/writing/latex/toolchain/node/extractArchive.ts (system tar; PLATFORM: Windows uses System32 tar for .zip). No archive writer. GitHub Git Data API takes loose files (blobs + tree), so publishing needs no archive; downloads can read loose files from jsDelivr or the Typst tar.gz via extractArchive.

# Risks
- Browser cannot build LaTeX at all; likely catalog consumer only. Device flow endpoints have CORS limits in browsers (Q2).
