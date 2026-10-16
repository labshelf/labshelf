# Session 2h — `\includeonly` build and `<file> only` toggle

- **Wave:** 2, runs together with 2a–2g, 2i
- **Starts from:** wave 1 committed
- **Ends with:** A12 through host functions and the header toggle (wired by 3a/3b), or a logged no-go with the toggle left out
- **Owns:** `packages/core/src/writing/latex/build/**`, `packages/vscode/src/writing/build/node/latexBuilds.ts`, `packages/vscode/src/writing/build/node/includeOnly.ts` (new), `packages/vscode/src/writing/build/node/index.ts`, `packages/core/src/reader/dom/preview/header/only/` (new), their tests
- **Research:** research/preview.md
- **Budget:** one conversation, main thread under about 70k, at most four delegated packages.

Wave rules: plan.md §6. R4: the spike decides before any package goes out.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2h.1 | Spike: latexmk `-usepretex='\includeonly{…}'` vs a generated wrapper root; other chapters keep numbering from `.aux`; go/no-go line in log.md | task | main thread | decision logged | [ ] |
| 2h.2 | Core command flag, host state, header toggle | behaviour | implementer (sonnet) | A12 in tests | [ ] |
| 2h.3 | Finish, commit | — | `finish` on Owns, `commit-splitter` with the file list | gate passes | [ ] |

## 2h.1 — Spike

- Build a two-chapter `\include` thesis in the scratchpad with latexmk, then rebuild with only chapter 2; check page and section numbers of chapter 2 and that a full build after it is still right. Tectonic: check whether the same approach works; if not, the toggle is hidden for Tectonic (write it in the log line).

## 2h.2 — Include-only build (A12)

- **Goal:** with the toggle on, the shown root builds only the included file the editor focuses, keeping other chapters' numbering.
- **Read only:** `core/src/writing/latex/build/latexBuildCommand.ts:1-27`, `buildResult.ts`; `vscode/src/writing/build/node/latexBuilds.ts:1-114`; `core/src/reader/previewProtocol.ts:100-110` (`BuildOptions.includeOnly`); `core/src/reader/dom/preview/header/previewHeader.ts:1-83`; `research/mockup.html:191` (`#only`).
- **Decided:** `latexBuildCommand` takes an optional `includeOnly?: string` (path relative to the root, no extension) applied as the spike chose. Host `includeOnly.ts`: `IncludeOnlyState` per project folder (in memory, off by default) with `option(project, root, focusedFile): BuildOptions["includeOnly"]` — present only when the root's sources use `\include` and the focused file is one of them; `set(folder, on)`; `latexBuilds.ts` passes the file when on. Export from `build/node/index.ts`. Header `only/onlyToggle.ts`: `mountOnlyToggle(slot, { post }): { setRoots(roots) }` — button text `<file> only`, `aria-pressed`, hidden when `options.includeOnly` is absent → `post({command:"setIncludeOnly", on})`.
- **Seams:** provides S8 (host), S3 (only).
- **Done when:** core test of the command args; host test of `option` (no `\include` → absent); jsdom toggle test; tests pass.
- **Do not touch:** `build/node/registerLatexBuild.ts`, `build/index.ts`, `build/options/` (2b), `mountPreviewChrome.ts`, `header/index.ts`.
