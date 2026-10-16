# Session 1 — Core project build

- **Goal:** one core function builds a writing project, and VS Code builds through it.
- **Starts from:** plan approved.
- **Ends with:** the project build seam below in core, tested; VS Code builds through it and the VS Code code it covers is deleted. VS Code build behaviour is unchanged: its existing build tests pass.
- **Owns:** `packages/core/src/writing/build/`, `packages/vscode/src/writing/build/`, `packages/vscode/src/writing/typst/node/`

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 1.1 | Core `buildProject`, `ProjectBuildQueue`, `ToolchainPrompt`, `builtPdfPath` | behaviour | implementer (opus), tests first | core tests pass | [ ] |
| 1.2 | VS Code on the core runner; delete what it replaces | behaviour | implementer (sonnet) | VS Code build tests pass | [ ] |
| 1.3 | Check, commit | — | `check` on Owns, `git commit` of Owns | gate passes | [ ] |

## Seam this session provides

In `packages/core/src/writing/build/node/index.ts`: `buildProject(project, deps): Promise<ProjectBuildResult>`; `deps.toolchain: ToolchainPrompt` (pick an engine, confirm the Tectonic download); `ProjectBuildQueue.request(project)` cancels the running build and queues one; `builtPdfPath(project)`. Terminal sessions 2a and 2c call it. Exit-code meaning for callers: toolchain missing is its own result.

## 1.1 — Core runner

- **Goal:** one function builds a writing project (LaTeX or typst) with its toolchain choice, cache dir and value refresh, and a queue keeps one build per project.
- **Read only:** `packages/vscode/src/writing/build/node/latexBuilds.ts:1-114` (queue, cancel, build dir, values); `packages/vscode/src/writing/build/toolchain/node/toolchainSetup.ts:1-68` (first-run pick, TeX Live detection, Tectonic fallback); `packages/vscode/src/writing/build/toolchain/node/tectonicSetup.ts:1-60`; `packages/vscode/src/writing/typst/node/typstBuilds.ts:1-98`; `packages/core/src/writing/latex/build/node/runLatexBuild.ts:10-61`; `packages/core/src/writing/typst/node/runTypstBuild.ts:16-54`; `packages/vscode/src/writing/preview/builtPdf.ts:1-16`.
- **Decided:** runtime-neutral types in `core/src/writing/build/`, Node code in `core/src/writing/build/node/` (format-neutral, so not under `latex/`). Every prompt goes through `ToolchainPrompt`; no UI text decisions in core beyond the error and hint lines the build already returns. The chosen engine is written to `labshelf.yaml` through the existing project settings update.
- **Done when:** tests in `packages/core/__tests__/writing/build/`, written first, pin: format dispatch, first-run pick through a fake prompt, Tectonic declined gives a toolchain-missing result, a second request cancels the first and runs once, `builtPdfPath`. `pnpm --filter @labshelf/core typecheck && pnpm --filter @labshelf/core test`; files at most 200 lines.
- **Do not touch:** `latex/build/node/` and `typst/node/` internals in core (call them).

## 1.2 — VS Code adoption

- **Goal:** VS Code builds through `buildProject` and `ProjectBuildQueue`, with its quick pick and download prompt as the `ToolchainPrompt` adapter.
- **Read only:** `packages/vscode/src/writing/build/node/registerLatexBuild.ts:1-55`; `packages/vscode/src/writing/build/toolchain/toolchainDeps.ts:1-25`; `packages/vscode/src/writing/build/toolchain/pickCompiler.ts:1-42`; `packages/vscode/src/activation/registration/registerWritingView.ts:1-40`; `packages/core/src/writing/build/node/index.ts` (from 1.1).
- **Decided:** the status-bar messages and error notices stay in VS Code; the queue, build dir and values move. The VS Code code the runner covers is deleted in this package (AGENTS.md section 4). Risk: moving the build changes VS Code behaviour, so its existing build tests stay green.
- **Done when:** existing tests under `packages/vscode/__tests__/writing/build/` and `writing/typst/` pass, adjusted to the adapter; `pnpm --filter @labshelf/vscode typecheck && pnpm --filter @labshelf/vscode test`.
- **Do not touch:** other `packages/vscode/src/writing/` folders except import lines the deletion breaks (report them).
