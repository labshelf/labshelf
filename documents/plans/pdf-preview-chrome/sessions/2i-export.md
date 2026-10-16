# Session 2i — Export: project zip, arXiv bundle, system viewer

- **Wave:** 2, runs together with 2a–2h; **in its own worktree** (adds a dependency)
- **Starts from:** wave 1 committed
- **Ends with:** A13 through `exportProject` and the header Export menu (wired by 3a/3b)
- **Owns:** `packages/core/src/writing/project/export/` (new), `packages/core/src/writing/project/index.ts`, `packages/vscode/src/writing/export/` (new), `packages/vscode/package.json`, `pnpm-lock.yaml`, `packages/core/src/reader/dom/preview/header/export/` (new), their tests
- **Research:** research/writing-core.md
- **Budget:** one conversation, main thread under about 70k, at most four delegated packages.

Wave rules: plan.md §6. Worktree: `git worktree add ../labshelf-2i`, `pnpm install`; merge back after the commit. Ladder: no zip library is installed in core or vscode; add `fflate` to vscode (a zip writer with CRC and UTF-8 names is longer and riskier by hand).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2i.1 | Core file sets: project and arXiv bundle with trimmed `.bib` | behaviour | implementer (sonnet) | unit tests pass | [ ] |
| 2i.2 | Host `exportProject` and header Export menu | behaviour | implementer (sonnet) | tests pass | [ ] |
| 2i.3 | Finish, commit | — | `finish` on Owns, `commit-splitter` with the file list | gate passes | [ ] |

## 2i.1 — File sets (D9)

- **Goal:** the list of files a project zip and an arXiv bundle contain.
- **Read only:** `core/src/writing/project/index.ts:1-17`; `core/src/writing/latex/source/project/collectProjectSources.ts` (signature); `core/src/writing/citations/citationKeys.ts:40-62`; `core/src/writing/bibLint/index.ts:1-6` (`bibEntries`); `core/src/writing/citations/bibliographyFile.ts` (which `.bib` the root uses).
- **Decided:** `project/export/exportFiles.ts`, runtime-neutral, over a read port: `projectFiles(list: string[]): string[]` drops build output, `.labshelf`, `labshelf.bib`, VCS folders; `arxivBundle(sources, bibText, citedKeys): { files: string[]; bib: { path: string; text: string } }` — `.bib` holds only cited entries of the user's `.bib`, never `labshelf.bib` (TRAP in research), keeps the `.bbl` when present. Export from `project/index.ts`.
- **Done when:** unit tests: trimmed bib, `labshelf.bib` never included, build output dropped.

## 2i.2 — Host and menu (A13)

- **Goal:** Export menu items Project zip / arXiv zip / Open PDF in system viewer.
- **Read only:** `core/src/reader/previewRequests.ts:10-11`, `:48`; `core/src/reader/dom/preview/header/previewHeader.ts:1-83`; `core/src/reader/dom/chrome/statusPill.ts:1-101`; `vscode/src/writing/preview/builtPdf.ts:1-16`.
- **Decided:** `vscode/src/writing/export/exportProject.ts`: `exportProject(deps, project, root, target: ExportTarget): Promise<void>` — save dialog (default name `<id>.zip` / `<id>-arxiv.zip`), zip with `fflate` `zipSync`, write with `vscode.workspace.fs`; `systemViewer` → `vscode.env.openExternal` on the built PDF; cancel is silent, failures log and show a message. Header `export/exportMenu.ts`: `mountExportMenu(slot, { post }): { setRoots(roots) }`, `upload` icon, three items → `post({command:"exportProject", target})`.
- **Seams:** provides S9 (host), S3 (export).
- **Done when:** host test with fake fs and dialog; jsdom menu test; vscode build bundles `fflate`; tests pass.
- **Do not touch:** `mountPreviewChrome.ts`, `header/index.ts`, `previewPorts.ts`.
