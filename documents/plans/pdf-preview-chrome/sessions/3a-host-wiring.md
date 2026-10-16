# Session 3a — Host wiring: preview ports and roots

- **Goal:** Every preview request from the webview has a host handler, and the roots message carries all wave-2 data.
- **Starts from:** sessions 2g, 2h and 2j committed
- **Ends with:** host side of A3, A7, A9–A13, with Compare / Mark / Checks commands running. **A3** Options menu toggles auto compile (setting respected on save for `.tex` and `.typ`) and switches the LaTeX engine; the change reaches labshelf.yaml. **A7** Footer shows `N cites · M to fix` (host supplies `cites`, `pdfProblems`). **A9** Card actions: Replace, Update, Add each edit the source or library and mark the PDF stale. **A10** Limit meter and popover read and write `check.pages`, `check.words`, `check.countUpTo`; words count across `\include`/`\input`. **A11** `N checks` runs Check Before Submitting; Compare Versions and Mark Version buttons run the existing commands. **A12** `<file> only` builds with `\includeonly`. **A13** Export saves a project zip and an arXiv zip with a trimmed `.bib`, and opens the PDF externally.
- **Owns:** `packages/vscode/src/writing/preview/previewPorts.ts`, `packages/vscode/src/writing/preview/index.ts`, `packages/vscode/src/writing/preview/projectPreview/**`, `packages/vscode/src/writing/preview/roots/**`, `packages/vscode/src/activation/registration/registerWritingView.ts` (only to pass a dependency in or push `previews` to `context.subscriptions`), their tests

Context: sessions 2g, 2h, 2j provide these functions under `packages/vscode/src/writing/`; a mismatch with the shapes below goes back to the caller, not into their files. Another plan (writing-2-submission-tools, typst-source-sync) may touch the preview messages: run `git worktree list` first.

Seams used (file: shape):
- S5 `preview/problems/`: `pdfProblemsOf` → `{ pdfProblems, cites }`.
- S6 `preview/limits/`: `rootWords(deps: { readerFor(folder) }, project, root)`, `setCheckLimits(projects: Pick<WritingProjects, "data" | "reload">, project, change)`, `CheckCounts` (`get`, `record`, `onChange`).
- S7 `build/options/`: `buildOptions`, `setAutoCompile`, `setEngine`, `onAutoCompileChange`.
- S8 `build/node/includeOnly.ts`: `IncludeOnlyState.option(project, root, focusedFile)`, `.set(folder, on)`. If this file does not exist (2h reported no-go), skip `setIncludeOnly` and the `includeOnly` field.
- S9 `export/`: `exportProject(deps, project, root, target)`.
- S10 `preview/citationFixes/`: `withCitationFixes(deps, entries)`, `fixCitation(deps, project, fix)`.
- `BuildPreviews.dispose()` exists; push `previews` to `context.subscriptions` in `registerWritingView.ts`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 3a.1 | Port handlers | behaviour | implementer (sonnet); glue, no per-handler tests | typecheck passes | [ ] |
| 3a.2 | Roots fields and resend triggers | behaviour | implementer (sonnet); test for roots fields and resend | roots tests pass | [ ] |
| 3a.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 3a.1 — Port handlers

- **Goal:** `createPreviewPorts` implements `runCommand`, `setAutoCompile`, `setEngine`, `setIncludeOnly`, `setCheckLimits`, `fixCitation`, `exportProject`, and `lookupCitation` returns entries with fixes.
- **Read only:** `packages/core/src/reader/host/ports.ts:26-58`; `packages/vscode/src/writing/preview/previewPorts.ts:1-30`; `packages/vscode/src/writing/preview/projectPreview/previewPanelSource.ts:30-60`; `packages/vscode/src/writing/preview/roots/writingActions.ts:1-82`; the seams above.
- **Decided:** `runCommand(id)` → `vscode.commands.executeCommand("labshelf.writing." + id, projectEntry)` (ids match the commands). Each handler acts on the panel's project and shown root; after `setAutoCompile`, `setEngine`, `setIncludeOnly`, `setCheckLimits` the roots are resent (3a.2). `lookupCitation` = the existing citations lookup (`preview/citations/`) then `withCitationFixes`.
- **Done when:** `pnpm --filter @labshelf/vscode typecheck` and the `writing/preview` tests pass.
- **Do not touch:** the other folders under `build/options`, `build/node`, `preview/problems`, `preview/limits`, `preview/citationFixes`, `preview/citations`, `export`, `preview/stale`.

## 3a.2 — Roots fields

- **Goal:** `previewRootsMessage` fills `options`, `pdfProblems`, `cites`, `words`, `wordLimit`, `countUpTo`, `checks`, and is resent when any of them changes.
- **Read only:** `packages/vscode/src/writing/preview/roots/previewRootsMessage.ts:1-45`; `packages/vscode/src/writing/preview/projectPreview/buildPreviews.ts:100-157`; `packages/core/src/reader/previewProtocol.ts:100-140`; the seams above.
- **Decided:** per built root: `pdfProblemsOf` (S5) and `rootWords` (S6); project level: `buildOptions` (S7) plus `includeOnly` from `IncludeOnlyState.option` (S8), `check.words`/`check.countUpTo`, `CheckCounts.get` into `PreviewRoot.checks`. Resend on: build end, `onAutoCompileChange`, labshelf.yaml reload, `CheckCounts.onChange`, editor focus change (includeOnly file). Count after the build, not per keystroke. `pdfProblemsOf` deps `preprints(project)` and `readSources(project, root)` have no helper (`collectProjectSources` is LaTeX-only): write them here, Typst sources included. `rootWords` needs `readerFor`: `createProjectSourceReader(vscode.Uri.file(folder), logger)` from `latexEditing/project/projectSourceReader.ts` fits. Pass `onFindings: counts.record` to `registerCheckCommand`. Export `preview/limits` from `preview/index.ts`. `projectBibRecords` (in `preview/citations/`) reads only top-level `*.bib` in the project folder: pass it the project's `.bib` paths from `project.settings.bibliography` and subfolders; the dep comes from `previewPanelSource.ts`.
- **Done when:** `previewRootsMessage` tests for each field and its absence; a `buildPreviews` test that a check run resends; tests pass; files ≤ 200 lines (split `buildPreviews.ts` by responsibility if it passes).
- **Do not touch:** as 3a.1.
