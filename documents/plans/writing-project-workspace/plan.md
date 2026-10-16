# Plan: Overleaf-like writing workspace in VS Code

Status: in progress (session 6 of 8)
Size: GG — new view model, per-root builds, preview chrome, a reader-host and two library-format changes; grows if Typst root detection needs Tinymist
Pending decisions: 0

## 1. Goal

A writing project in VS Code behaves like an Overleaf project: Projects lists every project wherever it lives, opening one swaps the list for it, and its sources and one PDF preview open and close together. The preview follows the focused source and shows build errors itself. The open project centres on a Checklist that fills itself from existing signals and holds the reading list; preview and hovers show what the library knows about each citation.

## 2. Decisions

Facts: [research/current-state.md](research/current-state.md), [research/checklist-and-marks.md](research/checklist-and-marks.md).

- [x] **D1** Source stays in the native editor, the preview is a webview beside it: Monaco would lose Tinymist and the LabShelf providers.
- [x] **D2** The file tree is LabShelf's own, read from disk, independent of `workspaceFolders`.
- [x] **D3** One side-bar slot, the view titled **Projects**, shows either the project list or the open project, switched by the `labshelf.writing.projectOpen` context key; a back action closes the project.
- [x] **D4** A project is a unit: opening it opens its main document and one preview; closing it closes its source tabs and the preview. Closing only the preview keeps the project open.
- [x] **D5** The preview shows the focused source's PDF when it is a root, else the main PDF. A root is a LaTeX file with `\documentclass`, or a Typst file no other project file `#include`s/`#import`s.
- [x] **D6** A failing focused root shows the main PDF with "<file>: <n> error(s)" (opens the logs); a failing main opens the logs view. A failed build never replaces a shown PDF.
- [x] **D7** Focus changes never rebuild; each root keeps its last PDF and SyncTeX. One build per project; a newer request aborts the running one.
- [x] **D8** Writing-only chrome (Recompile, code↔PDF arrows, error notice, logs, page chip) is one core module mounted only in preview mode, in a toolbar actions slot.
- [x] **D9** Logs view: `parseTexLog` / Typst problems (severity tabs, hint, file:line jump), "Open raw log".
- [x] **D10** Native editor actions: `editor/title` Recompile, show in preview, bold, italic; Cmd+Enter / Cmd+B / Cmd+I scoped to LaTeX/Typst files of a project.
- [x] **D11** An open project shows five views in this order: Files, Outline, Checklist (expanded); Figures, Versions (collapsed, with their count in the header). Empty views are hidden, and there is no Reading list view. The side bar stays sparse everywhere.
- [x] **D12** Outline lists the focused source's sections from `executeDocumentSymbolProvider`, marks the current one, reveals on click; a LabShelf Typst heading provider runs only without Tinymist.
- [x] **D13** Project rows: Arc mark + name + "N open" (open auto and manual items, Reading excluded), sectioned In library / External folders; broken reads "folder missing". Expanded: main + engine, last build this session (memory), Reading "x of y", stale figures. Counts load lazily per row.
- [x] **D14** Checklist groups start collapsed, one summary row each, open state remembered. A view-title toggle switches By kind / By section, saved per project. Sections come from the core scanners per file; items in an included file go under its name (symbols do not follow includes, verified); project-wide items under "Whole project".
- [x] **D15** Auto items, fast signals only, gone when resolved: TODOs (`\todo{…}`, `% TODO/FIXME`, Typst `// TODO/FIXME`), broken refs/cites, stale figures, page limit exceeded; scanned on open and per saved file. The full check runs only from "Run check".
- [x] **D16** Reading group = project reading list: Unread/Reading papers; Done fold into "N read" (newest first, dated); "+ Add paper" runs Add to Reading List; a mark click cycles `nextStatus`. By section: a paper sits under the section citing it; uncited stay in Reading.
- [x] **D17** Manual items live in `.labshelf/checklist.json`, synced by the `projects` namespace and shared with coauthors. The contract is in library-format.md; sync.md changes only if its conflict rule would drop items.
- [x] **D18** The paper sidecar gains optional `statusChangedAt` (ISO), set on every status change, dating "N read"; older records show no date (verified: none exists today).
- [x] **D19** The preview page chip shows "<body pages> of <limit>" from core `paperBody`, only when `check.pages` is set: warn tone at the limit, err over it.
- [x] **D20** Versions: click opens the PDF; menu "Compare with current" / "Compare with…" (`labshelf.writing.compareVersions`).
- [x] **D21** Editor hover (extends `CitationHoverProvider`): MarkdownString with title, byline, two abstract lines, up to three highlights with page, "Also cited in §…", Open paper. Preview: a core citation card extending review mode, tabs Highlights · Abstract · Cited in.
- [x] **D22** One **Arc** mark for every status, progress and colour code, in the core icon set; apps never draw their own. Shape and hover: [sessions/06.md](sessions/06.md#s61--arc-mark-in-core).

## 3. Scope

- **In:** VS Code app (Projects view, open-project views, builds, preview glue, menus, keybindings, hovers); core reader preview chrome, citation card, Arc mark, root detection, Typst heading scan, checklist model.
- **Out:** outline across includes; Typst source↔PDF sync ([typst-source-sync](../typst-source-sync/plan.md)); Code/Visual editor; Recompile dropdown; build history; project search; browser and terminal apps; pill removal ([core-no-pills](../core-no-pills/plan.md)); easy-line savers; drag paper to cite; cite↔highlight evidence, unused-evidence panel, preview provenance, version slider, colour-blind preview, edit in PDF; posters, beamer, template gallery; a Reading list view.
- **Contracts touched:** [reader-host.md](../../contracts/reader-host.md#preview) (toolbar actions, recompile, logs, notice, page chip, citation card data); [library-format.md](../../contracts/library-format.md) (`.labshelf/checklist.json`, sidecar `statusChangedAt`); [sync.md](../../contracts/sync.md) only per D17.

## 4. Acceptance criteria

- [x] **A1** With VS Code open on any folder, Projects lists the library's projects and the registered external folders.
- [x] **A2** Opening a project replaces the list with its views; the file tree hides the build dir and `.labshelf/` and marks the main file; back returns to the list.
- [x] **A3** File tree: open, new file/folder, rename, delete (confirmed); follows outside changes.
- [x] **A4** Opening a project opens the main and exactly one preview; more sources never open a second preview.
- [x] **A5** Closing the project closes its tabs and preview; on an unsaved-changes prompt, cancel keeps it open.
- [x] **A6** Focusing a root shows its PDF, an included chapter shows the main PDF, and a non-project tab changes nothing.
- [x] **A7** A failing focused root shows the main PDF with "<file>: <n> error(s)"; clicking opens its logs.
- [x] **A8** A failing main opens the logs; Back to PDF shows the last good PDF.
- [x] **A9** Same-basename roots in two folders keep separate PDF, log, SyncTeX.
- [x] **A10** Preview toolbar has Recompile and code→PDF / PDF→code; the paper reader toolbar has none.
- [x] **A11** Logs view: All / Errors / Warnings / Info counts, file:line jumps, Open raw log.
- [x] **A12** D10 actions work in project files; Cmd+B elsewhere toggles the side bar.
- [x] **A13** Typecheck and tests pass for core and vscode; the browser reader boots (headless check).
- [x] **A14** Outline shows the focused file's sections, marks the current one, follows tabs and edits, and reveals on click; Typst works without Tinymist.
- [ ] **A15** Figures and Versions appear only while a project is open, collapsed with their count in the header, and are hidden when empty.
- [ ] **A16** Project rows match D13, and the list renders before any count.
- [ ] **A17** Checklist groups start collapsed, keep their open state across reloads, and switch By kind / By section from the view title, remembered per project.
- [ ] **A18** Adding `% TODO x` and saving adds an item; removing it and saving removes it; a broken `\ref`, a stale figure and an exceeded page limit each appear and clear.
- [ ] **A19** By section places items under their heading, items in an included file under its name, and project-wide items under "Whole project".
- [ ] **A20** Reading behaves as D16; a paper set Done shows under "N read" with today's date.
- [ ] **A21** Manual items added, checked, deleted land in `.labshelf/checklist.json` and reach a second machine via sync.
- [ ] **A22** The page chip behaves as D19; no `check.pages`, no chip.
- [ ] **A23** Clicking a version opens its PDF; both compare actions open the comparison.
- [ ] **A24** A cite key hover and a preview citation hover show D21's content; every mark in this plan's UI is an Arc mark.

## 5. Design

| Piece | Lives in | Notes |
|---|---|---|
| Root detection | `core/src/writing/project/` | pure; LaTeX `\documentclass`, Typst include/import graph |
| Build output per root | `core/src/writing/{latex/build,typst}/node/` | outDir `<buildDir>/<root path slug>/` |
| Build state, focus follower, session | `vscode/src/writing/{build,preview,session}/` | keyed (project, root); `tabGroups` close; `workspaceState` |
| Projects list, file tree, outline | `vscode/src/writing/{tree,outline}/` | TreeDataProviders with `when`; Typst heading scan in `core/src/writing/typst/` |
| Preview chrome, citation card | `core/src/reader/dom/{preview,hover}/` | tokens and core icons only |
| Arc mark | `core/src/ui/icons/` | SVG builder (tone, progress); vscode writes light/dark files for TreeItem `iconPath` as `tabIcon.ts` does |
| Checklist model | `core/src/writing/checklist/` | pure: signals + sections + manual items → groups; `node/` reads/writes `checklist.json` |
| Checklist view | `vscode/src/writing/checklist/` | TreeDataProvider; title toggle via two commands and a context key |

`vscode/src/writing/` is over 8 files at the top level; new code goes in subfolders, and `projectsTreeProvider.ts`, `projectStore.ts`, `openProjectMain.ts` move into `tree/` and `session/`.

## 6. Sessions

| Session | File | Deliverable | Commit |
|---|---|---|---|
| 1 | [sessions/01.md](sessions/01.md) | Root detection and per-root builds | yes |
| 2 | [sessions/02.md](sessions/02.md) | Project session unit and focus-following preview | yes |
| 3 | [sessions/03.md](sessions/03.md) | Preview chrome: slot, recompile, arrows, notice, logs | yes |
| 4 | [sessions/04.md](sessions/04.md) | Open-project views: Files, Outline, Figures | yes |
| 5 | [sessions/05.md](sessions/05.md) | Editor actions, keybindings, extension-host check | yes |
| 6 | [sessions/06.md](sessions/06.md) | Arc mark, Projects list, checklist model and contracts | yes |
| 7 | [sessions/07.md](sessions/07.md) | Checklist view, Reading group, page chip | yes |
| 8 | [sessions/08.md](sessions/08.md) | Versions view and both hovers | yes |

Runner tiers: **H** session model; **M** Sonnet; **L** Haiku.

## 7. Risks

- **R1** Closing tabs with unsaved changes: use `tabGroups.close` and respect its result.
- **R2** Cmd+B/Cmd+I override defaults: scope `when` to latex/typst and `labshelf.writing.inProject`.
- **R3** The Typst include graph is regex-based: fall back to main when unsure.
- **R4** Old `<buildDir>/<base>.*` files: delete on the first per-root build.
- **R5** Providers may assume the workspace: session 5 checks an outside project.
- **R6** Two coauthors edit `checklist.json` offline: session 6 checks sync.md's conflict rule and adds a per-item merge only if items would be lost.
- **R7** Native tree icons cannot read CSS variables: the Arc builder takes resolved tone values from core tokens, never hex in the app.

## 8. Log

See [log.md](log.md).
