# Session outline (decks)

Source for the session files. Decisions are D1–D14 in plan.yaml; the scout briefs are in this folder (`<area>.brief.yaml`). Core tests use jest (DOM tests need the `/** @jest-environment jsdom */` docblock), vscode tests use jest with `packages/vscode/__mocks__/vscode`. Every spec says: implementers never run `pnpm gate` or lint; they check only with `node scripts/agents/run.mjs typecheck <pkg>` and the spec's tests.command. Each new file starts with a one-line `// <capability>` header. A new folder gets an `index.ts` barrel.

Rules for every session after 1: package `<n>.0` (level task, runner `{agent: tester, model: opus}`) writes the hidden tests of the session's behaviour and contract specs into `documents/plans/decks/tests/<spec>/<repo path>`, one test name per acceptance id (`it("<id> …")`), fills each spec's `tests.hidden`, and runs `plan red <n> <spec>` until red. Those specs start with `tests: {hidden: [], command: "<run.mjs test …>"}` and `depends_on: ["<n>.0"]`.

## Session 1 — format core (depends: none)
Owns: documents/contracts/decks.md, packages/core/src/decks/, packages/core/src/index.ts, packages/core/__tests__/decks/, documents/plans/decks/
- 1.1 task (main, opus): write documents/contracts/decks.md (#folders, #vocabulary, #sizes, #theme, #links, #diagnostics, #mcp placeholder) from D1–D5, D14.
- 1.2 contract (implementer, opus): `decks/deckSizes.ts` (DECK_SIZE_PRESETS, parseDeckSize, formatDeckSize, deckCanvasPx), `decks/deckParse.ts` (parseDeck → DeckModel with ranges), `decks/themeCss.ts` (readThemeProperties, setThemeProperty), `decks/index.ts`, root export in `packages/core/src/index.ts`.
- 1.3 contract (implementer, opus): `decks/deckValidate.ts` validateDeck + DECK_RULES (code, severity, rule text, hint) used by deck_rules later.
- 1.4 behaviour (implementer, opus): `decks/deckEdit.ts` applyDeckEdit(html, edit) for move, resize, setText, moveSlide, addSlide, duplicateSlide, deleteSlide, setSize; theme via setThemeProperty.

## Session 2 — MCP server (depends: 1)
Owns: packages/core/src/mcp/, packages/core/src/decks/, packages/core/__tests__/mcp/, packages/core/__tests__/decks/, packages/core/package.json, packages/terminal/src/cli/, packages/terminal/src/terminalEntry.ts, packages/terminal/__tests__/cli/, documents/contracts/decks.md, documents/plans/decks/
- 2.0 tester.
- 2.1 behaviour (sonnet): `decks/deckProject.ts` (DECK_ROOTS, listDecks(fs, project), resolveDeckPath(project, relPath) confined to talks/*/ and posters/*/ after realpath, scaffoldDeck(kind, name, size) returning {html, theme} that validates), `decks/deckContext.ts` (readProjectContext bounded 64 KB with cursor: outline via writing/outline, section text by heading, figure files, bib entries via parseBibEntries).
- 2.2 contract (opus): `mcp/` JSON-RPC 2.0 server (createMcpServer({name, version, tools}) → handle(line) → reply lines; McpTool {name, description, inputSchema, call(args)}), `mcp/node/stdioTransport.ts` (runStdioServer(server, stdin, stdout, logger)). Protocol 2025-06-18.
- 2.3 contract (sonnet): `decks/node/deckTools.ts` (createDeckTools(project, deps) → the 7 tools of D6; writes validated, refused with diagnostics), terminal `cli/mcp/` runMcp + `labshelf mcp` in terminalEntry.ts runLibraryFreeCommand (skip refreshSystemLaunchers), usage line; contract decks.md#mcp. A2 over a spawned stdio pipe in a temp project.

## Session 3 — links, QR, single-file HTML (depends: 1)
Owns: packages/core/src/decks/, packages/core/src/qr/, packages/core/src/index.ts, packages/core/__tests__/decks/, packages/core/__tests__/qr/, documents/plans/decks/
- 3.0 tester.
- 3.1 behaviour (sonnet): `decks/deckLinks.ts` readDeckLinks(model), deriveLinkState(link, sources) fresh|stale|missing, updateLinkHash edit (D5). A9.
- 3.2 behaviour (opus): `qr/` encodeQr(text) → boolean[][] (byte mode, ECC M, v1–10, mask chosen by penalty), formatQrSvg(matrix, {margin}) one-line SVG without style=. Tests decode known vectors (compare against a fixed matrix for "https://labshelf.org/share/#…").
- 3.3 contract (opus): `decks/deckExport.ts` exportDeckHtml(deck, {theme, readAsset, math}) → string (D11 single-file); `decks/deckLayoutCss.ts` deckBaseCss(size) shared with the editor frame (base layout + @page). A7 (offline part: no external URL in output).

## Session 4 — PDF engine (depends: 3)
Owns: packages/core/src/decks/node/, packages/core/src/latex/node/index.ts, documents/contracts/managed-tools.md, packages/terminal/src/cli/, packages/core/__tests__/decks/, packages/terminal/__tests__/cli/, documents/plans/decks/
- 4.0 tester.
- 4.1 behaviour (sonnet): `decks/node/findChromium.ts` (env override, PATH via findExecutable, per-OS paths for Chrome, Edge, Brave, Chromium; injected exists/platform for tests), `decks/node/printPdf.ts` printDeckPdf(html, size, {chromium, run}) writes a temp file and runs runCancellable with --headless --print-to-pdf --no-pdf-header-footer; exportDeckPdf returns {kind: "pdf", path} | {kind: "fallback", htmlPath, message}.
- 4.2 contract (opus): managed chrome-headless-shell: `decks/node/managedChromium.ts` + `chromiumPin.ts` modelled on qmd/compute/node/managedPython.ts (status, install under withToolLock, staged, zip extract check), contract managed-tools#layout gains `chrome/`.
- 4.3 behaviour (sonnet): terminal `labshelf deck export <deck.html> --pdf|--html [--out]` (cli/deck/), fallback opens the HTML with `#print` via platform open. A7 with a found Chromium (skip when none).

## Session 5 — editor core I (depends: 1, 3)
Owns: packages/core/src/decks/dom/, packages/core/src/decks/editor/, packages/core/__tests__/decks/, packages/core/src/ui/tokens/tokens.ts, packages/core/src/ui/dom/tokens.css,  packages/core/package.json, packages/core/src/styles/, documents/plans/decks/
- 5.0 tester.
- 5.1 behaviour (opus): `decks/dom/deckFrame.ts` mountDeckFrame(host, {html, theme, slide, resolveAsset, loadMath}) → {frame, blocks(): BlockRect[], leaves, setSlide, update, destroy}: srcdoc + CSP meta (D7), deckBaseCss, math rendered with loadMath, no allow-scripts.
- 5.2 behaviour (opus): `decks/editor/` pure state: selection, gestures (drag/resize with 8 handles), snapDeckRect (grid 8, edges, centres, 6 screen px, Alt off, guides), createDeckHistory (snapshots), gesture → DeckEdit on release.
- 5.3 behaviour (opus): `decks/dom/openDeckEditor.ts` openDeckEditor(host, options) → controller: stage with frame + overlay handles (transform-only during drag), in-place text edit of leaves (contenteditable on the leaf in the frame, written on blur/Enter), toolbar, keyboard (D8), read-only with diagnostics list when validateDeck has errors, `history: internal|host`, onChange(deck, theme). No style= markup. Lazy export `./deckEditor` in packages/core/package.json and css `./styles/deck-editor.css` (owns gains packages/core/package.json and the css path).

## Session 6 — editor core II (depends: 5)
Owns: packages/core/src/decks/dom/, packages/core/__tests__/decks/, packages/core/package.json, documents/plans/decks/
- 6.0 tester.
- 6.1 behaviour (sonnet): slide strip (reorder by drag and keys, add, duplicate, delete with undo) + thumbnail cache (D8 raster, fallback).
- 6.2 behaviour (sonnet): theme panel + size picker (D2 presets, orientation, custom with units) + linked-block badge/Update action (uses 3.1).
- 6.3 behaviour (opus): source view (plain CodeMirror via existing deps) kept in sync both ways; build test of the `./deckEditor` chunk size (D13).

## Session 7 — presenter and poster preview (depends: 5)
Owns: packages/core/src/decks/dom/, packages/core/src/decks/present/, packages/core/__tests__/decks/, documents/plans/decks/
- 7.0 tester.
- 7.1 behaviour (opus): `decks/present/` presenter state (slide index, timer, black) + PresenterChannel port + `decks/dom/openPresenter.ts` (audience view, presenter view: notes, timer, current, next; keys D9). A5.
- 7.2 behaviour (opus): `decks/dom/openPosterPreview.ts` zoom/pan, rulers mm/in, calibration with a CalibrationStore port, smallTextThreshold(size) pure + flagged leaves. A6.

## Session 8 — VS Code (depends: 2, 4, 6, 7)
Owns: packages/vscode/src/writing/deckEditor/, packages/vscode/src/writing/projects/, packages/vscode/src/activation/, packages/vscode/src/ui/htmlShell.ts, packages/vscode/build/webviews.mjs, packages/vscode/package.json, packages/vscode/__tests__/writing/deckEditor/, packages/vscode/__tests__/ui/, documents/plans/decks/
- 8.0 tester.
- 8.1 contract (opus): custom editor provider labshelf.deckEditor (priority option, selectors D14), webview entry, deck shell CSP (D7), document sync with one WorkspaceEdit per gesture, theme.css edits through WorkspaceEdit too, asset URIs, `history: host`. A4.
- 8.2 behaviour (sonnet): commands New Talk, New Poster (scaffoldDeck, opens with the deck editor), Talks & Posters tree in the project views, Export PDF / Export HTML (node: desktopPlatform registration, exportDeckPdf, fallback openExternal + message), Present (two panels, relay), Poster Preview (calibration in globalState, setKeysForSync excluded).
- 8.3 behaviour (sonnet): build size test of dist/deckEditor (D13) and reopen-with commands.

## Session 9 — browser (depends: 4, 6, 7)
Owns: packages/browser/src/libraryUi/, packages/browser/src/platform/, packages/browser/src/helper/, packages/core/src/libraryUi/tabModel.ts, packages/core/src/helper/, packages/core/src/decks/node/, documents/contracts/helper.md, packages/browser/__tests__/, packages/core/__tests__/helper/, documents/plans/decks/
- 9.0 tester.
- 9.1 behaviour (opus): deck tab kind (tabModel + tabKinds lazy `deckTab.ts`), mounts openDeckEditor with ctx.fs reads/writes (save queue like projectNoteTab), downscaled blob proxies, present and poster preview tabs, calibration in storage.local.
- 9.2 contract (opus): Helper `printPdf` request/reply over the socket with HTML as payload and PDF as reply payload, optional `ready.capabilities: ["printPdf"]`, handler in core/helper/node using decks/node/printPdf, contract helper#messages. No protocol bump.
- 9.3 behaviour (sonnet): browser export: Helper PDF → download; else blob HTML tab with `#print` and the message; HTML export download (bx downloads, binary helper). Firefox path always prints without the Helper. A7 browser part.

## Session 10 — share (depends: 3, 8, 9)
Owns: packages/core/src/share/, packages/core/__tests__/share/, documents/contracts/share-link.md, website/src/, website/__tests__/, website/build/build.mjs, packages/vscode/src/share/, packages/vscode/src/writing/deckEditor/, packages/vscode/package.json, packages/browser/src/libraryUi/, packages/vscode/__tests__/share/, packages/browser/__tests__/libraryUi/, documents/plans/decks/
- 10.0 tester.
- 10.1 contract (opus): core deck share (D12): `share/deckShare.ts` sealDeckManifest/openDeckManifest, buildDeckShare/uploadDeckShare, openAnyShare, ShareEntry.kind, contract share-link#deck. Old paper links and decodeShareManifest untouched (regression tests).
- 10.2 behaviour (sonnet): website deck viewer (lazy bundle; share.ts branches on openAnyShare kind; presents in sandboxed frame).
- 10.3 behaviour (sonnet): Share Deck as Link in VS Code and browser (ShareHost.shareDeck), Insert QR code (writes assets/share-qr.svg and an image block via applyDeckEdit addBlock — if addBlock is not in 1.4, this spec adds it), revoke through Manage Shared Links. A8.

## Session 11 — docs and lint milestone (depends: 10), milestone: true
Owns: documents/, scripts/lint/, packages/, website/
- 11.1 task (main, opus): product.md (decks concept), ui.md (deck editor, presenter, poster preview), code.md (decks, mcp, qr placement), contracts cross-links. The milestone gate runs in the finisher.
