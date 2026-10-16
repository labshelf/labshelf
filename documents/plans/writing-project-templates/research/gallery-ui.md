sha: fc9a469
files: packages/core/src/library-ui/protocol/**, packages/core/src/library-ui/dom/**, packages/core/src/ui/**, packages/vscode/src/ui/list/**, packages/vscode/src/libraryWebview/**, packages/vscode/build/webviews.mjs, research/mockup/Main.dc.html, research/mockup/Detail.dc.html
source: Explore scout plus main-thread reading of the mockups, 2026-10-16 (session 3)

# Gallery UI: patterns to follow and gaps found

## Patterns (paths under packages/)
- Protocol: core/src/library-ui/protocol/messages.ts:9-61 (`UiToHost`/`HostToUi`, dotted `type` names, payloads in payloads.ts); messageGuards.ts:6-78 (`isX` predicates, exhaustive `SHAPES` record :38, `parseUiMessage(raw): UiToHost | null` :69). Test: core/__tests__/library-ui/protocol/messageGuards.test.ts. Host side: vscode/src/ui/list/host/messageHandler.ts (logs and sends an error notice).
- Transport: protocol/transport.ts:6-16 `MessageEnd<Out,In> {post, subscribe}`; loopbackTransport.ts for tests; webview end vscode/src/libraryWebview/webviewChannel.ts:9.
- Mount: core/src/library-ui/dom/mountLibraryUi.ts:50 `mountLibraryUi(host, options)` returning `{..., dispose}`; entry vscode/src/libraryWebview/main.ts imports CSS from `@labshelf/core/styles/*` (core/package.json exports :33-50; a new CSS file needs an entry).
- Primitives in core/src/ui/dom/base.css: `.ls-btn`, `.ls-btn-primary`, `.ls-icon-btn`, `.ls-input`, `.ls-search`, `.ls-checkbox` (:88), `.ls-empty*` (example core/src/library-ui/dom/citationMap/citationMapStates.ts:9-20), `:focus-visible` with `--ls-focus` (:28). No chip or card class. `el`, `$` in ui/dom/dom.ts.
- Icons: core/src/ui/icons/icon.ts `icon(name)`; `grid` exists (glyphs.ts:51), also `file`, `folder`, `warning`, `search`, `check`, `external`. No new glyph needed.
- Tokens: no card token; use `--ls-widget-bg` or `--ls-sidebar-bg` with `--ls-border`, `--ls-radius`, `--ls-space-*`, `--ls-text-*`.
- Panel: vscode/src/ui/list/listWebviewPanel.ts:44-67 (singleton, `retainContextWhenHidden`, ready flag :136); listPanelHtml.ts (CSP with nonce, `img-src ${cspSource} data:`); bundles in vscode/build/webviews.mjs:15-18 `BUNDLES`.
- DOM tests: `/** @jest-environment jsdom */`; examples core/__tests__/library-ui/dom/flows/confirmRemove.test.ts, mountHarness.ts.

## Gaps S3.1 must resolve (main-thread recommendations, not yet applied)
1. **Thumbnails**: no source exposes one. Recommend `TemplateSource.thumbnail(entry): Promise<Uint8Array | undefined>` cached under `.research/templates/<source>/thumbnails/` per templates.md#cache, sent to the webview as `data:` URIs (CSP already allows `data:`; no remote img-src). Placeholder when missing or offline.
2. **Offline flag**: `list()` drops `fromCache`. Recommend `list()` returning `{entries, fromCache}` so the sidebar note shows "cached" only when true; a source that throws shows a per-source error row, the others still list.
3. **Engine warning**: no probe. Recommend a pure core `engineProblem(entry, engines)` (missing engine, or Typst `compiler` newer than the bundled one) fed by a VS Code probe: typst always; tectonic when `tectonicAsset` exists; pdflatex/lualatex/xelatex need `latexmk` and the engine on PATH.
4. **Detail file list**: entries carry no files. The Community index has `files[]`; Mine can read its tree; Universe only after download. Recommend an optional `files?: string[]` on `TemplateEntry`, shown only when known.
5. **Defer to session 5**: "Compile on this machine", "Open sample PDF" and the "Publish a template" button; no buttons without behaviour.
6. **Drop** the card's "Downloaded" mark: nothing backs it.
7. **No pill shapes** (documents/plans/core-no-pills, writing-project-workspace D22): category chips are toggle buttons with `--ls-radius-sm` and `aria-pressed`; source rows are a list with `--ls-list-active-bg`; no coloured source dots.
