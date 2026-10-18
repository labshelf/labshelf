# Session 13 — remove VS Code in the browser and check performance

- **Goal:** delete everything of D2 and the typst.ts path of D4, then measure A9.
- **Starts from:** sessions 10, 11 and 12 committed; the workspace edits LaTeX and Typst through the helper.
- **Ends with:** A12; A9 with numbers; the plan `documents/plans/browser-editor/` gone.
- **Owns:** the deleted paths below, `packages/browser/build/build.mjs`, `packages/browser/package.json`, `packages/vscode/package.json`, `packages/vscode/build/host.mjs`, `packages/core/package.json` (typst.ts entries), the lockfile, `documents/contracts/editor-host.md`, `documents/plans/browser-editor/`, `documents/architecture.md` and `documents/apps/` lines about the editor page.

Runs alone: it changes manifests, build scripts and the lockfile.

| Id | Package | Level | Runner | Done when | OK |
|---|---|---|---|---|---|
| 13.1 | Deletions | task | main thread | grep finds no reference | [ ] |
| 13.2 | Perf check | behaviour | implementer (sonnet) | A9 numbers within budget | [ ] |
| 13.3 | Check, commit | — | `check` on browser, vscode, core, `git commit` of Owns | gate passes | [ ] |

## 13.1 — Deletions

Facts: `documents/plans/browser-project-workspace/research/browser-runtime.md` (Editor page, Typst in the page).

First grep every package, manifest, HTML and build script for `out/web/extension.js`, `extensionWeb`, `editorHost`, `typst_ts`, `TYPST_FONT_BASE_URL` and `@codingame`; the research says the editor page is the only consumer of the VS Code web build (`packages/browser/build/editor/bundledExtensions.mjs`). If the grep finds another consumer, stop and report it. Then delete: `packages/browser/src/editor/`; `packages/browser/build/editor/`; its call in `packages/browser/build/build.mjs:70`; the dependencies `@codingame/monaco-vscode-*`, `tinymist-web`, `vscode-languageserver`; `packages/vscode/src/extensionWeb.ts`, `src/activation/web/`, `src/writing/web/`, `__tests__/extensionWeb.test.ts`, the web target in `packages/vscode/build/host.mjs:56-62`, the `browser` field of `packages/vscode/package.json`; `packages/core/src/writing/helper/editorHost/`; the typst.ts compiler path (`openTypstSession` in `packages/core/src/writing/typst/typstSession.ts` and its wasm dependencies in `packages/core/package.json`) if nothing else uses it; `documents/contracts/editor-host.md` and links to it; `documents/plans/browser-editor/`. Update `documents/architecture.md` and `documents/apps/` where they describe the editor page.

## 13.2 — Perf check

- **Read only:** `documents/apps/README.md#verifying-changes`; `packages/browser/src/library-page/main.ts`.
- **Decided:** a script under `packages/browser/scripts/perfCheck.mjs` drives Chrome for Testing headless with CDP `Emulation.setCPUThrottlingRate(4)` on a fixture library of 2,000 papers and 50 projects, and prints: page open to sidebar painted, source tab open to editor accepting input, and the longest task while typing 200 characters. Budgets are A9: ≤ 1.5 s, ≤ 1.0 s, no task > 50 ms.
- **Done when:** the script prints numbers within budget; numbers and the machine go into the session's log line.
