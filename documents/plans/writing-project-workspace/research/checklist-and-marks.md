sha: b58f5b5
files: packages/core/src/writing/**, packages/core/src/model/**, packages/core/src/ui/**, packages/vscode/src/writing/**, packages/vscode/package.json, documents/contracts/library-format.md, documents/contracts/sync.md
source: one Explore scout, 2026-10-16

# Facts behind the Checklist, Projects list, marks, versions and hovers

## Reading list and paper status
- The project reading list is the `papers:` list in `labshelf.yaml`: `{key, doi?, cited?}[]` (library-format.md:115). `cited: true` = auto-added; no flag = added by hand (Add to Reading List).
- Core: `core/src/writing/readingList/readingList.ts` (`buildReadingList` → `{key, paper, cited, listed, opened}`). vscode: `vscode/src/writing/readingList/{projectReadingLists,readingListNodes,readingListCommands}.ts`; `isOpened` wired at `activation/registration/registerWritingView.ts:67`.
- Status is per paper in the library sidecar, not per project. `PaperRecord` (`core/src/model/paperRecord.ts:14`) has `status` only: **no status-change date anywhere**.
- Set status: `vscode/src/core/paperService.ts:76` `updatePapersStatus(ids, status)`; cycle order `nextStatus` in `core/src/model/paperStatus.ts:14`.

## Sections
- LaTeX outline: `vscode/src/writing/latexEditing/outline/registerSectionOutline.ts:8-15` scans only the open document (`scanLatexSource` via `sectionSymbols.ts`); **does not follow `\input`/`\include`**.
- Core include resolution exists, unused by the outline: `core/src/writing/latex/source/project/{collectProjectSources,resolveIncludePath}.ts`, `scan/commands/scanIncludes.ts`.
- Typst: **no heading parsing in core**.

## Signals
- TODO/FIXME detection: none exists.
- Broken `\ref`/`\cite`: `vscode/src/writing/latexEditing/labels/labelDiagnostics.ts`.
- Stale figures: `core/src/writing/figures/figureState.ts` (`status: "stale"`, `newerInputs`), read by `figures/node/readFigureStates.ts`, shown by `vscode/src/writing/figures/figureTreeItem.ts`.
- Pre-submission check: `core/src/writing/checks/runChecks.ts` (rules pages, anonymity, fonts, images, references); vscode `writing/check/node/registerCheckCommand.ts`, diagnostics `writing/check/checkDiagnostics.ts`.
- `check.pages` validated at `core/src/writing/project/userKeys.ts:53`. `core/src/writing/checks/paperBody.ts` exports `paperBody(pages: string[][]) → {contentPages, headingFound, pages}` (cuts at the references heading, drops running headers).

## Versions
- `labshelf.writing.compareVersions`: `vscode/src/writing/versions/node/registerCompareVersionsCommand.ts:18,101`, handler `(entry?: ProjectEntry)`; sides/modes in `versions/compareSides.ts` (`CURRENT_SLUG`, `pickSides`, `pickMode`); `listVersions` from `@labshelf/core/node`.
- Storage `<project>/.labshelf/versions/<slug>/{version.json, paper.pdf, sources/…}` (library-format.md:188-203).

## Hovers
- Editor: `vscode/src/writing/citations/citationHover.ts` (`CitationHoverProvider`, registered in `registerCitationProviders.ts:22`).
- Preview review mode: `core/src/writing/review/{citationEntries,citedKeysAt,pdfCitationTargets}.ts`; reader side `core/src/reader/dom/hover/referenceContent.ts`, `startup/deferredHover.ts`. Review mode is D15 of `documents/archive/writing-core.plan.md`. No "citation card" component exists by that name.

## Icons and tokens
- Core icons: `core/src/ui/icons/{icon.ts,glyphs.ts}`: SVG body strings (`STROKE_GLYPHS` 24×24, `CODICON_GLYPHS` 16×16), rendered inline by `icon.ts`.
- No TreeItem uses core icons; all use `vscode.ThemeIcon`. `vscode/src/ui/tabIcon.ts` builds a light/dark SVG pair for a WebviewPanel `iconPath` (the pattern to reuse for TreeItems).
- `--ls-radius-pill` (999px) at `core/src/ui/dom/tokens.css:95`; users in `core/src/library-ui/dom/styles/` (library-ui.css:71, library-tabs.css:21, library-list.css:53/64/69, library-detail.css:45/58/99).

## `.labshelf/` and sync
- Today: `state.json` (cursor; not synced) and `versions/<slug>/` (synced once complete) (library-format.md:170-203).
- sync.md "Projects": the `projects` namespace syncs project files including dot files, skipping `.labshelf/state.json`, `.git`, hidden in-progress version folders and `ignore:` paths, so a new `.labshelf/checklist.json` syncs by default.

## VS Code
- `engines.vscode` and `@types/vscode` `^1.98.0`; `contributes.views[].initialSize` is not used. Not checked in the d.ts.
