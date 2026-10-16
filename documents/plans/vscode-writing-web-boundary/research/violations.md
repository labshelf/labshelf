sha: 4110b6c
files: packages/vscode/src/writing/**, packages/vscode/src/continue/**, packages/vscode/src/ui/list/host/projectSource.ts, packages/vscode/src/activation/**, .dependency-cruiser.cjs
source: pnpm run lint:deps, 2026-10-16 (session 3 start)

# Violations left (14, all D5)

Paths under packages/vscode/src/. All come from the eight D5 files:

- `writing/versions/registerCompareVersionsCommand.ts` → `packages/core/src/node/index.ts` (vscode-no-node-packages-outside-node-folder)
- `writing/typst/typstCompilerHost.ts` → `packages/core/src/writing/typst/node/index.ts` (vscode-no-node-packages-outside-node-folder)
- `writing/typst/typstBuilds.ts` → `packages/core/src/writing/typst/node/index.ts` (vscode-no-node-packages-outside-node-folder)
- `writing/typst/typstBuilds.ts` → `packages/core/src/node/index.ts` (vscode-no-node-packages-outside-node-folder)
- `writing/figures/regenerateFigure.ts` → `packages/core/src/node/index.ts` (vscode-no-node-packages-outside-node-folder)
- `writing/check/registerCheckCommand.ts` → `packages/core/src/node/index.ts` (vscode-no-node-packages-outside-node-folder)
- `writing/build/toolchain/toolchainSetup.ts` → `packages/core/src/node/index.ts` (vscode-no-node-packages-outside-node-folder)
- `writing/build/toolchain/tectonicSetup.ts` → `packages/core/src/node/index.ts` (vscode-no-node-packages-outside-node-folder)
- `writing/build/latexBuilds.ts` → `packages/core/src/writing/typst/node/index.ts` (vscode-no-node-packages-outside-node-folder)
- `writing/build/latexBuilds.ts` → `packages/core/src/node/index.ts` (vscode-no-node-packages-outside-node-folder)
- `writing/versions/registerCompareVersionsCommand.ts` → `path` (vscode-no-node-builtins-outside-node-folder)
- `writing/typst/typstCompilerHost.ts` → `fs/promises` (vscode-no-node-builtins-outside-node-folder)
- `writing/typst/typstBuilds.ts` → `path` (vscode-no-node-builtins-outside-node-folder)
- `writing/build/latexBuilds.ts` → `path` (vscode-no-node-builtins-outside-node-folder)
