# Session 2c — Problem list: core ordering and host collection

- **Wave:** 2, runs together with 2a, 2b, 2d–2i
- **Starts from:** wave 1 committed
- **Ends with:** a function that turns one build of a root into ordered `PdfProblem[]` with PDF areas and a cite count (D8); wired into `previewRoots` by 3a
- **Owns:** `packages/core/src/writing/problems/` (new), `packages/core/src/writing/index.ts`, `packages/vscode/src/writing/preview/problems/` (new), their tests
- **Research:** research/writing-core.md
- **Budget:** one conversation, main thread under about 70k, at most four delegated packages.

Wave rules: plan.md §6. R3: confirm the problem kinds 1b put on `LocatedProblem` before the brief goes out (`grep -n "kind" packages/core/src/writing/latex/build/buildResult.ts`).

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2c.1 | Core `orderPdfProblems` (pure) | behaviour | implementer (sonnet) | unit tests pass | [ ] |
| 2c.2 | Host `pdfProblemsOf`: gather inputs, place through SyncTeX or Typst cite targets | behaviour | implementer (sonnet) | host tests pass | [ ] |
| 2c.3 | Finish, commit | — | `finish` on Owns, `commit-splitter` with the file list | gate passes | [ ] |

## 2c.1 — Core ordering

- **Goal:** one ordered problem list per build: undefined citations, undefined references, overfull boxes, preprint entries.
- **Read only:** `core/src/reader/previewProtocol.ts:82-101` (`PdfProblem`, `PdfProblemKind`); `core/src/writing/latex/build/buildResult.ts` (whole, `LocatedProblem`); `core/src/writing/latex/log/explainTexMessage.ts:70-100`; `core/src/writing/bibLint/index.ts:1-6` (`BibFinding`, preprint kind); `core/src/writing/review/pdfCitationTargets.ts:1-28`.
- **Decided:** `writing/problems/orderPdfProblems.ts`: `orderPdfProblems(input: { build: readonly LocatedProblem[]; preprints: readonly { key: string; message: string; file?: string; line?: number }[]; place(p: { kind: PdfProblemKind; subject?: string; file?: string; line?: number }): PageArea | undefined }): PdfProblem[]`. Placed problems in reading order (page, top, left), then unplaced by file and line; duplicates (same kind + subject + file + line) collapse. Overfull only for `\hbox` (1b). Export from `writing/problems/index.ts` and `writing/index.ts`. Runtime-neutral (no `node:*`).
- **Seams:** consumed only by 2c.2.
- **Done when:** `__tests__/writing/problems/orderPdfProblems.test.ts` pins order, collapse, unplaced tail; core `writing` tests pass.
- **Do not touch:** `writing/citations/`, `writing/checks/`, `writing/latex/build/`.

## 2c.2 — Host collection

- **Goal:** for a project root after a build, the host returns `{ pdfProblems, cites }`.
- **Read only:** `vscode/src/writing/preview/projectPreview/previewPanelSource.ts:30-55` (what deps exist: `synctex`, `typstCites`, `builds.problemsOf`); `vscode/src/writing/preview/sourceLinks/projectSynctex.ts:1-52`; `vscode/src/writing/preview/roots/previewRootsMessage.ts:1-45`; `core/src/writing/citations/citationKeys.ts:40-62` (`citedKeys`); `core/src/writing/latex/source/project/collectProjectSources.ts` (signature only).
- **Decided:** `preview/problems/pdfProblemsOf.ts`: `pdfProblemsOf(deps: { problemsOf(root): readonly LocatedProblem[]; preprints(project): Promise<…>; synctex(): Promise<SynctexLike | undefined>; typstCites(): readonly CiteTarget[]; readSources(project, root): Promise<{ file: string; text: string }[]> }, project, root): Promise<{ pdfProblems: PdfProblem[]; cites: number }>`. LaTeX: place by SyncTeX source line → area; Typst: place only `undefinedCitation`/`preprint` via cite targets by key (D8). `cites` = distinct cited keys in the root's sources. Paths in `file` are project-relative `/`-separated as in `previewRootsMessage.ts:16-19`. Log a failed SyncTeX load once with the root and fall back to unplaced.
- **Seams:** provides S5 `pdfProblemsOf` from `preview/problems/index.ts`.
- **Done when:** tests with fake synctex and fake typst targets; vscode `writing/preview` tests pass.
- **Do not touch:** `preview/roots/**`, `preview/projectPreview/**` (2a), `previewPorts.ts`.
