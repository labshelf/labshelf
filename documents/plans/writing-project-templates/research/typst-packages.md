sha: 080f74b
files: packages/core/src/writing/typst/**, packages/vscode/src/writing/typst/**, packages/core/src/writing/templates/blankTemplates.ts
source: Explore scout, 2026-10-16

# Typst compile and Universe packages

- Compiler: typst.ts 0.7.0 WASM (Typst 0.14.2, INVARIANT in core/src/writing/typst/typstRelease.ts:3), extension host only. No typst CLI. Tinymist is separate (own compiler), pinned via tinymistMainPin.ts.
- Download: only `TypstPackageStore.download(spec, fetchImpl: FetchLike, signal?)` at core/src/writing/typst/node/typstPackages.ts:69-91 (exported from typst/node/index.ts:8). Target fixed to `<cache>/preview/<name>/<version>`; only namespace `preview`; name/version checked by SAFE_NAME/SAFE_VERSION (:13-14). Staging `.download-` mkdtemp, extract, rename. No logger (caller runTypstBuild.ts:44 logs). Only instantiation: vscode/src/writing/typst/node/typstCompilerHost.ts:42.
- No "download tar.gz to any dir" function. Reusable: `extractArchive(archive, "tar.gz"|"zip", dest, signal?)` core/src/writing/latex/toolchain/node/extractArchive.ts:14-21 (system tar); `FetchLike` from latex/toolchain/node/index.ts:4.
- TRAP: extractArchive has no symlink or `..` guard of its own; tar strips leading `/` and `..` but extracts symlinks. A post-extract lstat walk is new code.
- No typst.toml parser anywhere; `[template] path/entrypoint/thumbnail` and `compiler` parsing is new code. Fixture: core/__tests__/support/typstFixtures.ts:34.
- core/src/writing/templates/blankTemplates.ts exports `blankTemplate(format, title): {main, text}`, the blank main file.
- Risks: one retry; no compiler check vs 0.14.2; 17 pinned fonts.
