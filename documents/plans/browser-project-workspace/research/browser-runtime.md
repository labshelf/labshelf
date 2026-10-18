sha: 7c2715b7
files: packages/browser/src/{editor,helper,reader,library-page,storage/projects}/**, packages/browser/build/**, packages/core/src/writing/templates/**, packages/core/src/reader/**, packages/vscode/build/host.mjs
source: Explore scouts, 2026-10-18

## Templates
- Gallery UI + protocol are core (core/src/writing/templates/dom/mountTemplateGallery.ts, protocol/). Community source is runtime-neutral: `createCommunitySource({fetch, cache, logger})` (sources/communitySource.ts:18-84).
- vscode host: vscode/src/writing/templates/galleryHost.ts:1-141 (vscode-free except through deps), useTemplate.ts:1-29 (vscode-free), projectTitlePrompt.ts (vscode input box), node/templateSources.ts:1-41 and node/registerTemplates.ts:28-64 (composition).
- Node-only in core/src/writing/templates/node/: universeSource.ts (tar.gz via node tar), mineSource.ts (fs folder under the library root), fsTemplateCache.ts.
- Project creation: `createProjectFromTemplate` via `createProjectData` over a LibraryFileSystem; the vscode web build already calls it with `posixPathOps` (vscode/src/activation/web/webAdapters.ts:50).
- Contract: documents/contracts/templates.md.

## Typst in the page
- packages/browser/src/editor/typst/: pageTypstSession.ts (28 lines; takes BrowserProjects + onFileWritten; wasm from `new URL("typst/typst_ts_web_compiler_bg.wasm", location.href)`; packages unresolved), typstHostCompiler.ts (maps to the editor-host command), typstFonts.ts (fonts from TYPST_FONT_BASE_URL, sha256-checked), projectSnapshot.ts. Core engine: `openTypstSession` (core/src/writing/typst/typstSession.ts) → `{pdf, diagnostics, citations}`.
- typst wasm is 28.3 MB; deps in packages/core/package.json. MV3 forbids eval and blob: workers: typst.ts runs only with the text patches in packages/browser/build/editor/cspPatches.mjs (fail the build when versions change).

## LaTeX
- `ILatexHelper` (core/src/writing/helper/latexHelper.ts:9-39); browser impl packages/browser/src/helper/client/ (createBrowserLatexHelper, project/syncProject.ts, buildProject.ts returns SHA-256-checked PDF bytes). Workbench-free check: packages/browser/src/editor/host/latexHelperCheck.ts, helperSetupPanel.ts.

## Reader
- `startReader({boot, transport, perf, pdf})` (core/src/reader/dom/reader.ts:36-60) uses fixed element ids from READER_SHELL_BODY (core/src/reader/shell.ts), once per document: embed through an iframe of the browser reader page (packages/browser/src/reader/index.ts:1-170).
- Preview mode exists: `boot.preview: true`, buildStatus messages, `reloadDocument {pdfUrl}` keeps the position (core/src/reader/dom/session/documentReload.ts:22-60, dom/startup/hostMessages.ts:39). The browser page sets preview:false.

## Editor page (to delete)
- packages/browser/src/editor/{workbench,workers,fileSystem,host,webview,typst}; packages/browser/build/editor/{buildEditor,bundledExtensions,cspPatches,tinymistVsix,vscodeAssets,webviewHost}.mjs called from build/build.mjs:70; deps `@codingame/monaco-vscode-*` (21 packages), tinymist-web, vscode-languageserver.
- The vscode web build (packages/vscode/build/host.mjs:56-62 → out/web/extension.js; src/extensionWeb.ts; src/activation/web/; src/writing/web/; __tests__/extensionWeb.test.ts; package.json "browser") has one consumer: build/editor/bundledExtensions.mjs.
- Contract documents/contracts/editor-host.md describes the workbench host commands.
- CodeMirror is not a dependency anywhere.
