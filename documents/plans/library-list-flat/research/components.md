sha: 252a0ed
files: packages/core/src/library-ui/**, packages/core/src/library/format/relativeTime.ts, packages/core/__tests__/library-ui/**
source: Explore scout 2026-10-16

# Library list and detail components

Paths are under `packages/core/src/library-ui/dom/` unless they start with `core/`.

## Reuse
- `list/columnHeads.ts:12-38` sortable heads (click flips dir, `ctx.prefs.save`); `paintColumnHeads` sets `.sorted`/`.asc`; edit COLUMNS.
- `../derive/sortPapers.ts`, `../state/viewState.ts:10`: SortKey = title|creator|year|publication|lastRead|status; `firstSortDir` puts dates newest first; saved by `state/prefs.ts`.
- `../derive/listPapers.ts:13-30`: `ListPaper.relFolder` (" / "-joined, relative to the open folder) and `folderPath`: basis for group labels and own-papers-first order.
- `header/breadcrumb.ts:12-31` `renderCrumbs`: crumbs, library icon, drop targets, count badge.
- `list/rowReconciler.ts`: id-keyed DOM reuse; paper unit (row + tray) stays one node.
- `list/rowCells.ts`: `lastReadHtml`, `typeIconHtml`, `tagChipsHtml`, `versionChipHtml`, `marksHtml`.
- `list/paperRow.ts:59-72` `wireMain` (contextmenu, drag); `list/listKeys.ts` + `../../listKeymap.ts` keyboard map.
- `detail/head/paperHead.ts:50-72` title, byline, `detail-meta` from `venueLine`, Open PDF primary, status segment, tag row; `detail/head/tagRow.ts` tags; `detail/tabs/tabBar.ts` Details/Annotations/Notes/Related (the target set); `detail/tabs/fileSection.ts`; `menu/paperMenu.ts`; `flows/citeCopy.ts` (`CITE_LABEL`).
- `flows/revealPaper.ts` `revealPaper(ctx, id)`: opens the folder if out of scope, clears hiding filters, selects, scrolls.
- `core/src/ui/icons/arcMark.ts` arc mark + `STATUS_ARC` (uncommitted in the working tree).

## Exists but differs
- Columns: twistie, type icon, Title (version chip, 3 tag chips, `loc-chip`, marks), Creator, Year, Publication, Last read, Status. Target drops Publication and the in-title chips.
- Grouping: none; flat sorted list; nested paper shows a `loc-chip`. `includeSub` defaults true.
- Row: `.paper-row` > `.paper-row-main` (grid) + `.paper-children` with one PDF child row when `.expanded` (paperRow.ts:50-53); expanded set in memory (paperList.ts).
- Status: pill `.ls-badge-{status}` (core/src/ui/dom/base.css:99-106), cycles on click.
- Times: `relativeTime` "3d ago"/"yesterday".
- Selection `.selected` = `--ls-list-active-bg` (styles/library-list.css:26-28); `.cursor` lighter; outline on `.paper-list:focus` (:29), not `:focus-visible`. No zebra.
- ARIA: `.paper-list` role=listbox aria-multiselectable; rows aria-selected; no row role.
- Header: breadcrumb always shown, also at root; no status/All papers scope.
- Detail head: [Open/Continue primary | copyKey, copyCite, move, more]; status segment; "+ Tag" input; venue lacks "› folder".

## Missing
Compact time; dot/arc marks in rows; group labels; paper unit tone + file tray; facts sentence; hover file actions; venue "› folder"; Cite ⌄, status ⌄; `:focus-visible`; zebra; scope-aware breadcrumb.

## How apps mount it
- `packages/vscode/src/libraryWebview/main.ts` → `mountLibraryUi` + `@labshelf/core/styles/library-ui.css`.
- `packages/browser/src/library-page/main.ts` → `mountLibraryUi` (`withSidebar:true`); `index.html` links `../ui/styles/library-ui.css`.
- `mountLibraryUi.ts` (77 lines) is the one composition point; list via `list/paperList.ts` in `shell/frame.ts`.

## Size risks
detail/detailPane.ts 164, list/paperList.ts 152 (grouping would pass 200), list/paperRow.ts 92, detail/detailActions.ts 134, state/libraryViewStore.ts 160; styles/library-detail.css 126, library-list.css 98. `dom/list/` has 7 files (limit 8) and `derive/` 9: new group/tray and derive code go in subfolders.

## Tests
`core/__tests__/library-ui/`: dom/list/{paperList,listKeys,rowMarks}, dom/detail/{detailPane,askAuthor}, dom/mountLibraryUi + mountHarness.ts, derive/{sortPapers,listPapers,folders,folderTree}, state/, listKeymap. relativeTime under `core/__tests__/library/`.
