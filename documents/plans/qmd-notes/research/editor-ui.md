sha: 0069f02
files: packages/browser/src/writing/editor/**, packages/core/src/latex/{hover,source}/**, packages/core/src/writing/insert/**, packages/core/src/ui/**, packages/core/package.json, packages/vscode/build/*.mjs, packages/browser/build/build.mjs, packages/vscode/src/**/*Html.ts, packages/browser/manifest.chrome.json
source: Explore scout

## Reuse
- `packages/core/src/latex/hover/renderMathSvg.ts:1-40` `renderMathSvg(tex, display, macros)`: MathJax SVG string (liteAdaptor, fontCache local), throws on parse error. Import only via `@labshelf/core/math` (TRAP: ~2.5 MB CJS with side effects; never from the core root).
- `packages/core/src/library/paper/paperLink.ts:17-34`: `labshelf:` regex, parse, format, find.
- `packages/core/src/ui/dom/widgets/{menu,dialog,quickInput,toast,overlay}.ts`; icons `packages/core/src/ui/icons/{icon,glyphs,codiconGlyphs}.ts` (add a name to glyphs).
- `packages/core/src/writing/insert/*`: runtime-neutral LaTeX/Typst snippet builders.
- LaTeX scan `packages/core/src/latex/source/scanLatexSource.ts` + `commands/{scanReferences,scanSections,scanMacros,scanIncludes}`; `facts.ts:1-70` `LatexSourceFacts {labels, refs, sections, macros, includes}` with zero-based `LatexRange`. Cite positions: confirm in scan/ before relying.

## Current state
- CodeMirror 6 only in `packages/browser/src/writing/editor/` (LaTeX, Typst, BibTeX); VS Code uses its native editor. `y-codemirror.next` only in `editor/collab/binding/collabExtensions.ts:6,41`.
- No Markdown parser or renderer anywhere; no .qmd code. `reader/annotationsMarkdown.ts` only generates Markdown.
- `yaml` ^2.7.1 in core and terminal (values, userKeys, merge/mergeableTextFile, typst language).
- Component shape: folder under `<domain>/dom/` with index.ts, .ts files, a self-contained .css using `var(--ls-*)`; exported in core package.json as `"./styles/<name>.css"`; folder index re-exported by `packages/core/src/dom/index.ts`; `@labshelf/core/dom` = `packages/core/src/ui/dom/index.ts`. Tokens regenerate with `pnpm --filter @labshelf/core tokens`.

## Bundling and CSP
- VS Code webviews: `packages/vscode/build/webviews.mjs` `BUNDLES` map (lines 10-21), one esbuild call, esm, no splitting. Host keeps core deps external (`build/host.mjs:18,30`).
- Browser: `packages/browser/build/build.mjs` `ENTRIES` (lines 14-30), library page splits chunks; CSS imported as text.
- CSP: list/library/details webviews `style-src ${cspSource}` with no unsafe-inline, no wasm (`vscode/src/libraryUi/listPanelHtml.ts:28`). Reader webview allows `'unsafe-inline'` styles and wasm (`pdf-viewer/renderer/readerDocument.ts:24`). Browser `script-src 'self' 'wasm-unsafe-eval'` (`manifest.chrome.json:72-73`).

## Risks
- MathJax SVG and ProseMirror carry `style=` attributes: check against webviews whose CSP forbids inline styles.
- MathJax is in no webview/browser bundle yet; needs lazy loading (webviews build has no splitting).
- No y-prosemirror; collab on qmd needs it.
- No execution port for code cells exists.
