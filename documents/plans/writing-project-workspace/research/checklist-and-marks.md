sha: fc9a469
files: packages/core/src/writing/checklist/**, packages/core/src/reader/**, packages/core/src/writing/checks/**, packages/core/src/ui/**, packages/vscode/src/writing/**, packages/vscode/package.json, documents/contracts/reader-host.md
source: three Explore scouts, 2026-10-16 (session 7)

# Facts for the Checklist view, Reading group and page chip

## Signals
- core writing/checklist/node `readChecklistSignals(project, logger) → {sources, todos, brokenRefs, staleFigures, manual}` does all disk work (main + LaTeX includes; Typst main only, no broken refs); never throws (WARN + empty). `readManualItems`, `updateChecklist(folder, edit)` (atomic, throws on malformed file).
- core `buildChecklist(input, "kind"|"section") → {groups (non-empty), openCount}`; input `{todos, brokenRefs, staleFigures, pageOverflow?, manual, reading: ReadingItem[], placeSection, citeSections}`; `sectionPlacer(sources, main)`, `citeSections(sources, main)`. Group ids by kind: todo/ref/figure/pages/manual/reading; by section: section ids, "#reading", "#whole-project". Items union by `kind`: todo|ref|figure|pages|manual|reading. openCount excludes Reading.
- Pure manual edits: `addManualItem(doc,{id,text,now})`, `setManualItemDone`, `removeManualItem`.
- vscode tree/projectCounts.ts:22-29 already calls buildChecklist for "N open" with `reading: []`, `pageOverflow: undefined`; debounced 300ms per-folder watcher.
- Diagnostics (not needed: core scan covers refs): labelDiagnostics source "LabShelf", collection "labshelf-labels". No unknown-cite diagnostic.
- View template: vscode figures/projectFiguresView.ts:20-66 (reload counter, attach(treeView) description, setContext in publish — INVARIANT: from reload, not getChildren). Watchers: figures/figureWatchers.ts:24-47. Tests: __tests__/writing/figures/projectFiguresView.test.ts, fixtures __tests__/support/writingFixtures.ts (readyEntry, fakeProjects, fakeLogger). vscode mock __mocks__/vscode/index.js.
- Session: session/projectSession.ts `project`, `onDidChange(ReadyProject|undefined)`; context keys projectOpen/inProject. Views package.json:393-420 (figures uses `labshelf.writing.hasFigures`, collapsed). registerProjectViews.ts:23-58, composition registerWritingView.ts ~164-185. tree/ has 7 files (full) → new `writing/checklist/` folder.

## Reading list
- vscode readingList/ (projectReadingLists.ts `of(project) → ReadingList`, readingListCommands.ts `labshelf.writing.addToReadingList(target: ProjectEntry)`), imported by writing/index.ts:9, registerWritingView.ts:7,62-75,92,170,185, tree/registerProjectViews.ts, tree/projectsTreeProvider.ts:22,65, tree/projectRows.ts:70 detailLines (`entries`, `neverOpened`). package.json :371 command, :583 menu, :702 palette.
- core readingList `buildReadingList` → entries {key, paper?, cited, listed, opened}. `nextStatus`, `PaperStatus` core/model/paperStatus.ts. `statusChangedAt?` on PaperRecord (stamped in paperFields.ts:60).
- Status write: `services.paperService.updatePapersStatus(ids, status) → failed ids` (vscode core/paperService.ts:76), reached by `controller.currentServices()?.paperService` (registerWritingView.ts:67,178).
- Backlinks: vscode writing/backlinks/projectBacklinkIndex.ts (`index()`, `onDidChange`, debounced 1s); core citeSections already covers by-section placement from sources.
- Arc icons: vscode ui/arcMarkIcons.ts `arcIcon(tone, progress) → {light,dark}` (baked out/marks, tones err/warn/ok/accent × none/half/full).

## Page chip
- preview protocol: `PreviewRoots` core/reader/previewProtocol.ts:60-65; WebviewToHost in reader/protocol.ts ~128-150; host handlers reader/host/previewMessages.ts:16-52 via PreviewPorts; vscode previewPorts.ts:14, roots/previewRootsMessage.ts:38 (input has `project`).
- mountPreviewChrome.ts:37 deps {actions, banner, post, logs, visiblePoint}; called only from reader/dom/startup/buildReaderUi.ts:70-73; state via applyRoots/applyBuild from startup/hostMessages.ts:42-43. preview/ has 6 files.
- `paperBody(pages: string[][])` writing/checks/paperBody.ts:34; check splits lines in checks/node/readPdfFacts.ts:25-34 (hasEOL). `check.pages` in writing/project/userKeys.ts:12-15. `arcMarkElement(tone, progress, label)` ui/dom/widgets/arcMark.ts:5.
- Contract: reader-host.md `## Preview` lines 27-42, bullets `- **Topic.** …`.
