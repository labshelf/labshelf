sha: ce0112e
files: packages/core/src/ui/**, packages/core/src/model/**, packages/core/src/library/**, packages/core/src/writing/**, packages/vscode/src/ui/**, packages/vscode/src/writing/**, packages/vscode/package.json, documents/contracts/library-format.md, documents/contracts/sync.md
source: four Explore scouts, 2026-10-16 (session 6)

# Facts behind the Arc mark, checklist contracts, checklist model and Projects list

## Icons and tokens (S6.1)
- core/src/ui/icons/: `glyphs.ts` (STROKE_GLYPHS 24-grid, CODICON_GLYPHS 16-grid, LOGO_SVG), `icon.ts` `icon(name)` → inline SVG string, no width/height, `aria-hidden`. index exports `icon`, `IconName`. Test `core/__tests__/ui/icons.test.ts` iterates the glyph maps (no snapshots).
- core/src/ui/dom/: base.css, dom.ts (`$`, `el`, …), theme.ts, tokens.css + vscodeHost.css (generated), settings/, widgets/ (dialog, menu, overlay, quickInput, toast + toast.css). Component CSS sits beside its TS (`widgets/toast.css`), exported as `@labshelf/core/styles/toast.css` (core/package.json:41), imported by vscode webview main.ts:8 and browser HTML `<link>`. CSS tests read the file (`__tests__/ui/dom/toastCss.test.ts`).
- Tokens are generated from `core/src/ui/tokens/colorTokens.ts` (`token(dark, light)`), `pnpm --filter @labshelf/core tokens`; guarded by `__tests__/ui/tokensCss.test.ts`, `vscodeHostCss.test.ts`. vscodeHost.css maps tokens to `var(--vscode-*)` via `vscodeHostMap.ts`. No `ok`/`accent`/desaturated tokens: closest `--ls-error` #f85149/#a1260d, `--ls-warning` #cca700/#bf8803, `--ls-green` #89d185/#388a34, `--ls-blue` #3794ff/#007acc (dark/light).
- vscode/src/ui/tabIcon.ts: static `media/labshelf-tab-{light,dark}.svg` pair via `Uri.joinPath(extensionUri, 'media', …)`; no files written, no globalStorageUri, no test.
- ThemeIcons to replace: vscode/src/writing/figures/figureTreeItem.ts:11,27 (`stale: sync, missing: warning, fresh: graph`). readingList/ has no TreeItem icons. Projects rows: tree/projectsTreeProvider.ts:22,27.
- No headless check for core DOM; `.claude/skills/verify/` has a CDP + Playwright headless-shell recipe.

## statusChangedAt and checklist.json (S6.2)
- Single status choke point: core/src/library/mutations/paperFields.ts `setPaperStatus` (:36) and `updatePaperFields` (:25) → `applyPatch` (:52-70, has a `changed` check at :59) → `writePaperRecord(ctx, record, {ownsStatus})` (paperRecordWrite.ts:22-52; `ownsStatus:false` re-reads status from disk via `keptStatus`). Every app's status write goes through these (browser libraryMutations.ts:68, terminal paperService.ts:125-139, vscode core/paperService.ts:76-86,175).
- Record: core/src/model/paperRecord.ts:9-35 (`pdfRequestedAt?: string|null` is the model optional field); parse `core/src/library/paperMetadata.ts:20-60`; serialize `core/src/import/bibtex/bibtexService.ts:21-24 (OWNED_KEYS), 40-90 (carryOverUserKeys keeps unknown keys)`. New-paper status: library/mutations/import/newPaper.ts:32.
- Contract: library-format.md:51-82 `## metadata.yaml` (status row :63); `## .labshelf/state.json` :175-191, `## .labshelf/versions/` :193.
- Reader/writer pattern: core/src/writing/project/node/projectStateFile.ts (missing → undefined; non-object → WARN log; writer throws on corrupt file, writes with `writeFileAtomic`); pure half in `writing/project/deviceLocal/{projectState,parseJsonObject}.ts`.
- sync.md:29-62 "Projects": `.labshelf/state.json` ignored (:38, code `core/src/sync/engine/pipeline/projectIgnore.ts`); "Conflicts keep both copies" (:62) → concurrent checklist.json edits lose no item (conflict copy). R6: sync.md stays unchanged.
- `core/src/writing/checklist/` does not exist.

## Checklist model inputs (S6.3)
All under core/src/writing/ (W/). Lines are zero-based everywhere.
- Headings: W/backlinks/sourceHeadings.ts:13 `sourceHeadings(format, text): {line, title}[]` (both formats). Nearest-heading idiom: W/backlinks/citationSites.ts:31-45 (`heading.line <= line`); `citationSites(format, text) → {key, line, section|undefined}[]` (private `lineStarts`/`lineOf`).
- LaTeX: `scanLatexSource(text)` → `LatexSourceFacts {labels, refs, sections, macros, includes}` (W/latex/source/facts.ts:58-64). Typst: `scanTypstHeadings(text)` (W/typst/source/typstHeadings.ts:47).
- Project files: W/latex/source/project/collectProjectSources.ts:31 `collectProjectSources(mainPath, reader{read(rel)})` → `{files: {path, facts}[], missing}`; pure, LaTeX only, main first then depth-first. Typst: only `findRoots` exported from W/project/roots/rootDetection.ts:68 (include resolution private).
- Cites: W/citations/citationKeys.ts:55 `citedKeys(format, text) → {key, start, end}[]` (offsets; blanks comments). Backlinks: W/backlinks/backlinkIndex.ts:5-12 `Backlink {project, file, line, section}`, `BacklinkIndex = ReadonlyMap<key, Backlink[]>`.
- Broken refs: W/latex/source/project/undefinedRefs.ts:12 `undefinedRefs(files) → {path, ref: RefFact}[]` (LaTeX only); vscode labelDiagnostics.ts:10-24 only maps to Diagnostics.
- Figures: W/figures/figureState.ts:12-15 `FigureState` missing|stale{newerInputs}|fresh; `readFigureStates` node-only.
- Pages: W/checks/paperBody.ts:34, W/checks/pdfRules.ts:9 `pageLimitFindings(body, limit)`; `CheckFinding` W/checks/checkTypes.ts:3-15.
- Reading: W/readingList/readingList.ts:6-38 `ReadingListEntry {key, paper?, cited, listed, opened}`; `PaperStatus`, `nextStatus` core/src/model/paperStatus.ts:5,14.
- No TODO scanner exists. Tests: core/__tests__/writing/<domain>/*.test.ts, Jest ESM, imports `../../../src/writing/x/index`.

## Projects list (S6.4)
- Row builder: vscode/src/writing/tree/projectsTreeProvider.ts:12-31 `projectTreeItem(entry)`; provider `WritingTreeProvider implements TreeDataProvider<ProjectEntry>` (55 lines), `onDidChangeTreeData` is `EventEmitter<void>` (needs `<Node|undefined>` for per-item refresh). Nodes are raw core `ProjectEntry` (core/src/writing/project/projectEntry.ts:1-17: ready {folder, location library|external, settings, main} | broken {folder, location, reason}). Today: flat list, no children, `book`/`warning` ThemeIcons, description = main or reason, `item.id = folder`, contextValue `labshelfProject[External]` / `labshelfProjectBroken[External]`.
- Commands get the row as argument (`[entry]`); package.json:538-575 view/item/context regexes `/^labshelfProject(External)?$/`, reveal `/^labshelfProject/`, removeProject `/External$/` — section and child nodes need contextValues that match none.
- Source: `WritingProjects.list()` sync (vscode/src/writing/session/projectStore.ts:17-52), `onDidChange` after `reload()`.
- Build state: vscode/src/writing/preview/buildPreviews.ts:31-45 `BuildPreviews implements BuildListener` (build/buildListener.ts:12-19: building(folder, root), finished(project, root, result{status, problems}, trigger)); `states` deletes on success; no event, no timestamp. A tree needs its own listener storing last result per project.
- Reading: `ProjectReadingLists.of(project)` (readingList/projectReadingLists.ts:21-35) async → entries {key, paper?: PaperRecord, cited, listed, opened}. Figures: `ProjectFigures.children(project)` (figures/projectFigures.ts:19-29) → FigureNode[] with state.status "stale"|"fresh"; skip when `settings.figures` undefined.
- Invalidation pattern: figures/figureWatchers.ts:24-47 (per ready project, debounced 300ms, rebuilt on list change).
- registerProjectViews.ts:23-43 builds the provider with `projects, figures, session, logger` — no readingLists/previews yet; composition root vscode/src/activation/registration/registerWritingView.ts (previews line 112, readingLists line 62).
- Tests: vscode/__tests__/writing/tree/projectsTreeProvider.test.ts, fixtures `readyEntry`, `fakeProjects` in __tests__/support/writingFixtures.ts.
- tree/ has 5 source files (+index); room for 3.
- package.json:393-397 view `labshelf.writing` "Projects", when `!labshelf.writing.projectOpen`.
