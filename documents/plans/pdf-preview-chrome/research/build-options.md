sha: 8967fae7
files: packages/vscode/src/writing/build/node/registerLatexBuild.ts, packages/vscode/src/writing/typst/node/registerTypstBuild.ts, packages/vscode/src/writing/build/toolchain/*, packages/vscode/src/writing/build/index.ts, packages/vscode/package.json, packages/core/src/reader/previewProtocol.ts
source: Explore scout, 2026-10-16 (session 2b, host side)

# Build options (host)

- **Setting:** `labshelf.writing.autoCompile` is contributed in `packages/vscode/package.json:1002` (boolean, default true); nothing in `packages/vscode/src` reads it.
- **LaTeX save listener:** `registerLatexBuild.ts` (55 lines), `registerLatexBuild(deps: LatexBuildDeps): LatexBuilds`; `onSave` at :35 (source ext filter, `latexProjectOf`, `buildRootOf`, 300ms debounce, `builds.request(folder, root, "save")` at :44); subscribed at :50 via `onDidSaveTextDocument`.
- **Typst listeners:** `registerTypstBuild.ts` (58 lines); local `schedule(project, file, trigger: "live"|"save", delay)` at :31; `onDidChangeTextDocument` (live, only with a preview, 150ms) at :46-49; `onDidSaveTextDocument` (300ms) at :51-54.
- **Tests:** `vscode/__tests__/writing/build/node/registerLatexBuild.test.ts`, `vscode/__tests__/writing/typst/node/registerTypstBuild.test.ts`; saves fired with `workspace._fireDocumentEvent("save", doc)`; fixtures `fakeHost, fakeProjects, readyEntry` from `__tests__/support/writingFixtures`.
- **vscode mock:** `packages/vscode/__mocks__/vscode/api/workspace.js:24` — `getConfiguration` reads `workspace._config[section][key]` (fallback honoured); set with `workspace._config['labshelf.writing'] = { autoCompile: false }` (as in `__tests__/sync/syncControllerLock.test.ts:220`); `workspace._fireConfigChange(section)` exists.
- **Engine write:** `build/toolchain/toolchainDeps.ts:15` `saveEngine(deps: Pick<ToolchainDeps,"host"|"projects">, project, engine): Promise<boolean>` writes labshelf.yaml and reloads; false without `host.current()`. `pickCompiler.ts:32` reads `project.settings.engine`.
- **Project type:** `ReadyProject` from `packages/vscode/src/writing/mainDocument.ts:6`; `project.settings.format` ("latex"|"typst"), `project.settings.engine` (`LatexEngine | undefined`).
- **No effective-engine resolver:** an absent engine means "not chosen"; `toolchain/node/toolchainSetup.ts:62` (`ensureToolchain`) picks one at build time. So `buildOptions` reports `engine` as `project.settings.engine` and the menu shows no checked engine when it is absent.
- **Core types:** `BuildOptions` at `core/src/reader/previewProtocol.ts:103-108` (`autoCompile`, `engine?`, `includeOnly?`); `LATEX_ENGINES`, `LatexEngine`, `engineLabel` all import from `@labshelf/core` (as `pickCompiler.ts:4`).
- **Logger:** `ILogger` (`core/src/ports/logger.ts:4`) has only `log(level, module, message, context?)` and `error(...)` — no `debug` method; get it via `deps.host.current()?.logger`. Neither register file logs today.
- **build/index.ts** exports no options module; `build/options/` does not exist.
