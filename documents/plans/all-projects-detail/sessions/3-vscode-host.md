# Session 3 — VS Code host for the extended port

- **Goal:** the VS Code adapter fills the new row fields, serves `detail`, and runs build, preview, open log, create file and set target for a given project.
- **Starts from:** session 1 committed.
- **Ends with:** A2–A6 on the host side (seen once session 4 lands); `pnpm --filter @labshelf/vscode typecheck` and test pass.
- **Owns:** `packages/vscode/src/writing/allProjects/` except `webview/`, `packages/vscode/src/activation/registration/registerWritingView.ts` (the `registerAllProjects` call only), `packages/vscode/__tests__/writing/allProjects/`.
- **From session 1:** `ProjectLibraryPort` needs `detail`, `build`, `preview`, `openLog`, `createFile`, `setTarget`, `openLabel` (vscode typecheck fails until then); `openItems` is still referenced in `packages/vscode/src/writing/allProjects/projectRows.ts` and its test, to delete; `readProjectDetail`/`readProjectCites` (from `@labshelf/core/node`) read sources only from `settings.main`, so pass settings with `main` filled in; `updateProjectFile` throws on a deadline that is not a real date.
- **Runs with:** sessions 2 and 4.
- **Last session:** if session 4 is already committed when this one ends, run `finish` on everything the plan touched (docs: `documents/apps/vscode.md` All projects section), then delete `documents/plans/all-projects-detail/`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3.1 | Rows and detail | behaviour | implementer (sonnet) | adapter tests pass | [ ] |
| 3.2 | Actions: build, preview, open log, create file, set target | behaviour | implementer (sonnet), after 3.1 | adapter tests pass | [ ] |
| 3.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 3.1 — Rows and detail

- **Goal:** `list()` returns cites, unresolved cites, build mark and target; `detail(id)` returns `readProjectDetail` with the session build summary.
- **Read only:** `documents/plans/all-projects-detail/research/vscode-host.md`, `research/data-shapes.md` (Row, Detail), `packages/vscode/src/writing/allProjects/{index,projectLibrary,projectRows}.ts`, `packages/vscode/src/writing/build/buildOutcomes.ts`, `packages/vscode/src/writing/preview/projectPreview/rootBuilds.ts` (exports only), `packages/vscode/src/writing/preview/roots/rawLogFile.ts`, `packages/vscode/src/activation/registration/registerWritingView.ts` lines 236-255, `packages/vscode/__tests__/writing/allProjects/projectLibrary.test.ts`.
- **Decided:**
  - Delete `openItems` from `projectRows.ts` and stop reading the sidebar count for it.
  - New `projectBuildState.ts` ("Summarises a project's build in this session for All projects."): from `BuildOutcomes.last(folder)` and `RootBuilds` problems of `builtRoots(folder)` → `ProjectBuildSummary` (warnings/errors counted by severity, `first` = first warning or error); `building` when any root is building; no outcome → `earlier` with the PDF mtime when the main root's PDF exists, else `never`.
  - New `projectDetailSource.ts`: `detail(id)` calls core `readProjectDetail` with the library papers (find how `writing/citations/bibliographySync.ts` gets them), the summary, the main root's PDF path (find it where the preview resolves it) and `rawLogFile(...)` for LaTeX. `list()` adds `readProjectCites` per project, cached per folder by modified time like `lastModified`.
  - `onDidChange` also fires on `BuildOutcomes.onDidChange` and when a root's build state changes.
  - `registerAllProjects` gets `outcomes` and `previews` (or the `RootBuilds` inside it) from `registerWritingView.ts:241-251`.
  - Keep `projectLibrary.ts` the wiring only; `allProjects/` stays at ≤8 files.
- **Done when:** `projectLibrary.test.ts` (or a new `projectBuildState.test.ts`) pins: no outcome + PDF → `earlier`; failed outcome → `failed` with errors; warnings only → `warnings`; cites cache reused until modified changes. Tests fail first, then pass; vscode typecheck passes.
- **Do not touch:** `webview/`, core.

## 3.2 — Actions

- **Goal:** the five new port actions work for any project, not only the active editor's.
- **Read only:** `research/vscode-host.md`, `research/data-shapes.md` (Port and protocol), `packages/vscode/src/writing/allProjects/projectLibrary.ts` (after 3.1), `packages/vscode/src/activation/registration/registerWritingView.ts` lines 110-170 (`recompileRoot`, builders), `packages/vscode/src/writing/preview/commands/registerShowPreview.ts`, `packages/vscode/src/writing/preview/roots/writingActions.ts` lines 55-75, `packages/vscode/src/writing/preview/limits/setCheckLimits.ts` (how it writes `labshelf.yaml`).
- **Decided:**
  - New `projectHostActions.ts`. `build(id)`: save dirty files of that project, then request a build of its main root through the same path `recompileRoot` uses. `preview(id)`: open the project (`labshelf.writing.openProject`), then `labshelf.writing.showPreview`. `openLog(id)`: open `rawLogFile` for the main root in an editor; error "No build log yet" when missing. `createFile(id, path)`: resolve inside the project folder and re-check that the result stays inside it; refuse an existing file with "<path> already exists"; create parent folders and an empty file, then open it. `setTarget(id, target)`: `updateProjectFile` with `{ target }`, then `projects.reload()`.
  - `openLabel()` returns "Open in VS Code".
  - Every failure throws with the project folder in the message; `serveAllProjects` logs and posts it.
- **Done when:** tests pin `createFile` refusing a path that escapes the folder after resolution and an existing file, and `setTarget(null)` removing the key; they fail first, then pass; vscode typecheck and tests pass.
- **Do not touch:** `webview/`, core, the build command itself.
