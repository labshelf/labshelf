# Session 2h — `\includeonly` build and `<file> only` toggle

- **Goal:** With the toggle on, the shown LaTeX root builds only the focused included file and keeps other chapters' numbering.
- **Starts from:** plan approved; wave-1 protocol (`BuildOptions.includeOnly`, `setIncludeOnly` request) committed
- **Ends with:** host functions and the header toggle (wired later by 3a and 3b), or a reported no-go with the toggle left out. **A12** `<file> only` appears only in projects using `\include` and builds with `\includeonly`, keeping other chapters' numbering.
- **Owns:** `packages/core/src/writing/latex/build/**`, `packages/vscode/src/writing/build/node/latexBuilds.ts`, `packages/vscode/src/writing/build/node/includeOnly.ts`, `packages/vscode/src/writing/build/node/index.ts`, `packages/core/src/reader/dom/preview/header/only/` (new), their tests

Context: risk — latexmk with `\includeonly` may break `.aux` reuse, so the spike decides before any code. Provides seams S8 (host `IncludeOnlyState`) and S3 (header piece `mountOnlyToggle`). Research: `research/preview.md`.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2h.1 | Spike: latexmk `-usepretex='\includeonly{…}'` vs a generated wrapper root; go/no-go in the final report | task | main thread | decision reported | [ ] |
| 2h.2 | Core command flag, host state, header toggle | behaviour | implementer (sonnet); tests for the command args and `option` only | A12 | [ ] |
| 2h.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## 2h.1 — Spike

- Build a two-chapter `\include` thesis in the scratchpad with latexmk, then rebuild with only chapter 2; check page and section numbers of chapter 2 and that a full build after it is still right. Tectonic: check whether the same approach works; if not, the toggle is hidden for Tectonic (say so in the report). On no-go, stop: skip 2h.2 and report that the toggle is left out.

## 2h.2 — Include-only build (A12)

- **Goal:** with the toggle on, the shown root builds only the included file the editor focuses, keeping other chapters' numbering.
- **Read only:** `packages/core/src/writing/latex/build/latexBuildCommand.ts:1-27`, `buildResult.ts`; `packages/vscode/src/writing/build/node/latexBuilds.ts:1-114`; `packages/core/src/reader/previewProtocol.ts:100-110` (`BuildOptions.includeOnly`); `packages/core/src/reader/dom/preview/header/previewHeader.ts:1-83`; `documents/plans/pdf-preview-chrome/research/mockup.html:191` (`#only`).
- **Decided:** `latexBuildCommand` takes an optional `includeOnly?: string` (path relative to the root, no extension) applied as the spike chose. Host `includeOnly.ts`: `IncludeOnlyState` per project folder (in memory, off by default) with `option(project, root, focusedFile): BuildOptions["includeOnly"]` — present only when the root's sources use `\include` and the focused file is one of them; `set(folder, on)`; `latexBuilds.ts` passes the file when on. Export from `build/node/index.ts`. Header `only/onlyToggle.ts`: `mountOnlyToggle(slot, { post }): { setRoots(roots: PreviewRoots) }` — button text `<file> only`, `aria-pressed`, hidden when `options.includeOnly` is absent → `post({ command: "setIncludeOnly", on })`. Add an `only/index.ts` barrel.
- **Done when:** core test of the command args; host test of `option` (no `\include` → absent); typecheck and tests of core and vscode pass. No test for the toggle layout.
- **Do not touch:** `build/node/registerLatexBuild.ts`, `build/index.ts`, `build/options/`, `mountPreviewChrome.ts`, `header/index.ts` (3b wires the toggle).
