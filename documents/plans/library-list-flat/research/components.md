sha: c229fb5
files: packages/core/src/library-ui/**, packages/core/src/library/paperFiles/**, packages/core/src/library/format/elapsedTime.ts, packages/core/__tests__/library-ui/**
source: Explore scout 2026-10-16 (re-scout for 2a.2 and 2a.4; glyph usage and ILogger in the webview not scanned)

# Library list and detail components

Paths are under `packages/core/src/library-ui/` unless noted.

## Reuse
- `dom/list/treeNav/treeRows.ts` — any `.paper-children [role=row]` is a child row (`CHILD_ROWS`); give it `aria-level=2`, `tabindex=-1`, a click handler. Enter on a child row = `child.click()` (`dom/list/listKeys.ts:38-43`).
- `library/paperFiles/paperFile.ts` — `PaperFile {name; kind:"file"|"folder"; size?; modified: ISO; description?}`, `PaperFilesState = {status:"ready"; files} | {status:"failed"; message}`; re-exported by `protocol/payloads.ts`. Host order: paper.pdf, other files, subfolders, by name; metadata.yaml, bib.bib, dot files excluded.
- `core/src/library/format/elapsedTime.ts` `compactTime` (used in `dom/list/rowCells.ts`).
- `ui/dom/widgets/quickInput.ts:80` `inputBox({title?, prompt?, value?, placeholder?, validate?}) → Promise<string|undefined>`.
- `ui/dom/widgets/menu.ts` `MenuItem {label, icon?, lead?, checked?, hint?, danger?, disabled?, onSelect}`, `MenuEntry = MenuItem | "separator"`, `showMenu(anchor, entries, {onClose})`.
- `dom/flows/index.ts` `hostFileAction(ctx, type, id)` (paper.reveal, openExternal).
- `ui/dom/widgets/toast.ts` `toast(message, kind)`; used from `dom/hostMessages.ts` for `notice`.
- Glyphs: `open-to-side`, `folder-open`, `copy`, `folder`, `file`, `file-text`, `warning`, `more`, `loader`.
- Tokens: `--ls-file-pdf/md/ref/dir`, `--ls-row-zebra/open/selected`, `--ls-row-h`.

## Current code
- `dom/list/paperList.ts` (139 lines) — mount and render; list-local `expanded` Set (line 25, `isExpanded`/`setExpanded` 58-59), toggled only by the twistie. Reconciler built at 121-124 with inputs `[record, hasPdf, relFolder, terms, stats, job]`. Empty/loading at 63-78.
- `dom/list/paperRow.ts` — unit `.paper-row[data-id]` = `.paper-row-main[role=row aria-level=1]` + `.paper-children`; children today = one hardcoded `.child-row` for paper.pdf when `hasPdf` (48-50), click → `onOpen`. `.paper-children{display:none}` unless `.paper-row.expanded` (library-list.css ~76).
- `dom/list/rowReconciler.ts` — one node per id; INVARIANT: removes every container child it did not build.
- Store `open` (viewState.ts:33, one id, "paper whose files are shown"): written by `store.openPaper` (libraryViewStore.ts:124-136) and `flows/revealPaper.ts:20`; nothing in list code reads it. A reveal does not expand the row.
- Grouping: none. `ListPaper` (derive/listPapers.ts:13-20) has `folderPath` and `relFolder` (holder folder relative to the open folder, joined " / ", "" for own papers). Scope = `s.folder` (root `PAPERS_DIR`) + `s.includeSub`. `folderLabel(PAPERS_DIR, s.folder, "/")`.
- Protocol (protocol/messages.ts:23-28, 56): `paper.files {id}`, `paper.describeFile {id,name,description}` (empty removes), `paper.openFile|revealFile|copyFilePath {id,name}`; host→webview `files {id, state}`. `PaperStats.lastHighlight?: {page,text}`. Abstract is `PaperRecord.summary`; `note?` on the record.
- `dom/hostMessages.ts` does not handle `files`; no UI sends paper.* file messages.
- Row menu: `dom/menu/paperMenu.ts` `showPaperMenu(ctx, at, onClose?)`; contextmenu on `.paper-row` → `onMenu`; Shift F10 / ContextMenu → listKeys `case "menu"` → `openMenuAtCursor`.
- Empty states (`dom/list/emptyState.ts`): "Loading…" when loading and no papers; "No papers match in X", "All papers here are inside subfolders", "No papers here yet" + `labels.emptyHint`, missing-text-layer message.

## Tests
`__tests__/library-ui/dom/list/`: paperList, listKeys, treegrid, rowCells, rowMarks; `dom/menu/paperMenu.test.ts`, `dom/flows/revealPaper.test.ts`, `dom/mountLibraryUi.test.ts`. Harness `__tests__/library-ui/dom/mountHarness.ts`: `mountForTest(prefs, caps)` → `{lib, host, sent, container, snapshot(papers, pdfDirs, folders, stats), rows, rowIds, key, detail, click}`; `host.post(msg)` sends host→webview; `paper(id, dir, extra)`; `menuLabels()`. Files start `/** @jest-environment jsdom */`.

## Leftovers for 2a.4
- `SortKey "publication"` in state/viewState.ts:10, state/prefs.ts:51, derive/sortPapers.ts:10, library/model/types.ts:47, library/model/paperSort.ts:16 (no column uses it).
- `loc-chip`, `.ls-badge-` list pill: only negative test assertions remain (treegrid.test.ts:39, rowCells.test.ts:33). `--ls-badge-*` tokens are used elsewhere.
- `--ls-radius-pill`: arcMark.css:7, library-detail.css:91, library-list.css:58 (.status-mark), :67 (.version-chip), library-tabs.css:21, library-ui.css:70.
- `.version-chip` CSS in library-list.css:66-70 styles only the detail pane; producer `versionChipHtml` in rowCells.ts:22-32, used by detail/head/paperHead.ts.
- Narrow width: container queries drop Last read ≤720px, Authors ≤460px; Year is never dropped.
- `ui/dom/base.css` is 203 lines.
