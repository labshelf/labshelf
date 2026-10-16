# Session 2b — Build options: auto compile, engine, options menu

- **Wave:** 2, runs together with 2a, 2c–2i
- **Starts from:** wave 1 committed
- **Ends with:** A3 (setting honoured on save for `.tex` and `.typ`; engine change reaches labshelf.yaml) through host functions and the options menu, fixture-driven
- **Owns:** `packages/vscode/src/writing/build/node/registerLatexBuild.ts`, `packages/vscode/src/writing/typst/node/registerTypstBuild.ts`, `packages/vscode/src/writing/build/options/` (new), `packages/vscode/src/writing/build/index.ts`, `packages/core/src/reader/dom/preview/header/options/` (new), `packages/core/src/reader/dom/styles/preview-options.css` (new), their tests
- **Research:** research/preview.md
- **Budget:** one conversation, main thread under about 70k, at most four delegated packages.

Wave rules: plan.md §6. Port and roots wiring is 3a's; composition is 3b's.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 2b.1 | Auto compile honoured by both save listeners and Typst live compile | behaviour | implementer (sonnet) | tests pass | [ ] |
| 2b.2 | `buildOptions`, `setAutoCompile`, `setEngine` host functions | behaviour | implementer (sonnet) | tests pass | [ ] |
| 2b.3 | Header options menu | behaviour | implementer (sonnet) | jsdom tests pass | [ ] |
| 2b.4 | Finish, commit | — | `finish` on Owns, `commit-splitter` with the file list | gate passes | [ ] |

## 2b.1 — Auto compile (D6)

- **Goal:** with `labshelf.writing.autoCompile` off, saving a `.tex` or `.typ` and editing a `.typ` start no build; the command and Recompile still build.
- **Read only:** `vscode/src/writing/build/node/registerLatexBuild.ts:1-55`; `vscode/src/writing/typst/node/registerTypstBuild.ts:1-58`; `packages/vscode/package.json` (grep `autoCompile`).
- **Decided:** `build/options/autoCompile.ts` exports `autoCompileOn(): boolean` (reads `vscode.workspace.getConfiguration("labshelf.writing").get("autoCompile", true)`) and `onAutoCompileChange(fn): Disposable`. Both listeners check it inside the handler (not at registration), so a change applies without reload. Log a skipped save at debug level once per change of the setting, not per save.
- **Done when:** tests with the setting off and on for both listeners; vscode tests on `writing/build` and `writing/typst` pass.
- **Do not touch:** `build/node/latexBuilds.ts`, `build/node/index.ts` (2h).

## 2b.2 — Options host functions (D5)

- **Goal:** the host can describe and change the build options a preview shows.
- **Read only:** `vscode/src/writing/build/toolchain/pickCompiler.ts:1-42`; `toolchainDeps.ts:1-25` (`saveEngine`); `core/src/reader/previewProtocol.ts:100-110` (`BuildOptions`); `core/src/reader/previewRequests.ts:40-46`.
- **Decided:** `build/options/buildOptions.ts`: `buildOptions(project): Omit<BuildOptions, "includeOnly">` (`engine` only for `format === "latex"`, default as the build resolves it); `setAutoCompile(on)` writes the setting at the global target; `setEngine(deps, project, engine)` calls `saveEngine`. Export them and `autoCompileOn`, `onAutoCompileChange` from `build/options/index.ts` and `build/index.ts`.
- **Seams:** provides S7.
- **Done when:** unit tests for typst (no engine) and latex; setEngine writes through `saveEngine` (mocked); tests pass.

## 2b.3 — Options menu (A3)

- **Goal:** a header menu with an "Auto compile" check item and, for LaTeX roots, the four engines as a radio list.
- **Read only:** `core/src/reader/dom/preview/header/previewHeader.ts:1-83`; `core/src/reader/dom/chrome/statusPill.ts:1-101` (menu pattern); `core/src/reader/previewProtocol.ts:100-140`; `research/mockup.html:126-141` (menu CSS), `:418-423`.
- **Decided:** `mountOptionsMenu(slot, { post }): { setRoots(roots: PreviewRoots): void }` in `header/options/optionsMenu.ts` with `index.ts`; gear icon button, `aria-haspopup="menu"`; hidden while `roots.options` is absent. Items: Auto compile (checked) → `post({command:"setAutoCompile", on})`; separator; engines from `LATEX_ENGINES` with `engineLabel`, checked = current → `post({command:"setEngine", engine})`; no engine section when `options.engine` is absent.
- **Seams:** provides S3 (options).
- **Done when:** jsdom tests: hidden without options, typst has no engines, posts; core `reader` tests pass.
- **Do not touch:** `mountPreviewChrome.ts`, `header/index.ts`, `styles/preview.css`.
