sha: 0069f02
files: packages/core/src/model/{annotation,textLayer,paperRecord}.ts, packages/core/src/reader/**, packages/core/src/library/{layout,paperMetadata,conflicts,mutations,search}/**, packages/core/src/libraryUi/**, packages/{vscode,browser,terminal}/src/**, documents/contracts/{library-format,reader-host}.md
source: Explore scout

## Annotations and sidecar
- model/annotation.ts: {id, paperId, type highlight|note|comment|tag, pageNumber, content, color?, position?, createdAt, updatedAt}; position is 0..1 of the page.
- reader/sidecar/paperSidecarStore.ts: per-paper queue 33-41; addHighlight 79-92; addNote 97-100 (type "note", no position); updateAnnotation 117-128 (content only); deleteAnnotation 134-142. paperData.ts normalises (drops unknown top-level keys), fixed key order.
- Path: .research/papers/<id>/data.json (library/layout.ts:12,48-63); browser IndexedDB appdata/<id>/data.json (library-format.md:55).
- Merge: library/conflicts/sidecarMerge.ts:20-37 (union by id, newer mtime wins); node pass conflicts/node/sidecarConflictMerge.ts:115-137 matches only original===data.json. Contract library-format.md:327.
- type "note" is only created via protocol (reader/host/annotationMessages.ts:36-40); no reader UI sends it (selectionBubble.ts:119 sends highlight). sidecar/previewStore.ts:27 refuses addNote.

## Drawing
- reader/dom/highlights/pageHighlights.ts:28-58: layer `.rd-hl-layer` rebuilt on pdf.js `textlayerrendered` (PLATFORM: pdf.js drops page children on re-render), inserted before `.textLayer`; boxes in percent of the page, so zoom needs no recompute; pointer-events none (styles/reader.css:256). Page found by `#viewer .page[data-page-number=N]`; unrendered pages have no layer (virtualised by pdf.js).
- pageFrame.ts: content box px and boxInPage to 0..1. textRects.ts re-finds the text for per-line boxes. No rotation code in highlights.

## Protocol and sidebar
- protocol/webviewToHost.ts:31-40: createAnnotation {type highlight|note, pageNumber, content, color?, position?}, deleteAnnotation, updateAnnotation {id, content}, exportAnnotations. hostToWebview.ts:13,19: init, updateAnnotations. Guards webviewGuard.ts:39-45 (update needs non-empty content). Host pushes the full list after each write (annotationMessages.ts:34-62). Contract reader-host.md:21-25.
- dom/sidebar/annotationsTab.ts: page groups, 140-char preview, jump, delete, copy/export; no edit.

## annotationsMarkdown.ts
- reader/annotationsMarkdown.ts: formatAnnotationsMarkdown renders title, citation, per-page quotes with colour, notes as paragraphs; used by reader/host/exportAnnotations.ts.

## Paper record `note` (metadata.yaml key)
- core: model/paperRecord.ts:20; library/paperMetadata.ts:56; mutations/paperRecordWrite.ts:3-35, paperFields.ts:56-65; search/searchDoc.ts:25,33, matchPaper.ts:10, query.ts, aliases.ts, syntaxHelp.ts:14, parseQuery.ts:45-52.
- library-ui: state/libraryViewStore.ts:67; dom/flows/paper/paperCommands.ts:38; dom/detail/noteEditor.ts, detailActions.ts:100; list/tray/fileFacts.ts:60, shortNote.ts; protocol/messages.ts:39, messageGuards.ts:65.
- vscode: ui/list/host/messageHandler.ts:49, paperHandlers.ts:20; core/paperService.ts:127,170.
- browser: popup/index.html:42, index.ts:16, saveFlow.ts:119-122; captureMessages.ts:11; background/handlers/capture.ts:99; capture/captureService.ts:42,136; storage/libraryMutations.ts:22,120; libraryUi/host/hostController.ts:65, handlers/paperHandlers.ts:22.
- terminal: cli/show/showText.ts:27; ui/preview.ts:89; keymap.ts:84, keyDispatch.ts:102; actions/paperFieldActions.ts:57-68 ($EDITOR); library/papers/paperService.ts:122.
- Contracts: library-format.md:86,97; library-ui-host.md:61,128; share-link.md:48.
- Review comments (reader-host.md:46, addReviewComment) are unrelated.

## Text layer
- model/textLayer.ts holds only a verdict (state native|ocr|missing|failed, counts, reason); no line or word boxes. Geometry exists only live in the DOM `.textLayer` (highlights/textRects.ts, hover/textGeometry.ts).
